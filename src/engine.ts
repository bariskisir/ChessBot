/** Serializes document-owned searches and switches between verified local engine workers. */
import { Chess } from "chess.js";
import { EVALUATION_ENGINE, getEngine, type EngineDefinition, type EngineId } from "./engines";
import { normalizeSettings, parseInfo, type EngineRequest, type EngineResponse, type Variation } from "./shared";
interface Job { request: EngineRequest; respond: (response: EngineResponse) => void }
const queue: Job[] = [];
let active: Job | null = null, worker: Worker | null = null;
let workerEngine: EngineDefinition | null = null;
const warmWorkers = new Map<EngineId, Worker>();
let phase: "idle" | "booting" | "preparing" | "searching" | "stopping" = "idle";
let timeout: ReturnType<typeof setTimeout> | undefined;
let variations: Variation[] = [], verified = false;
const engineTimeouts = { startup: 20000, searchIdle: 60000, stopping: 2000 };
const searchProgress = new Map<number, { nodes: number; depth: number }>();

/** Arms the watchdog for engine startup or a period without search progress. */
function armTimeout(milliseconds: number): void {
  clearTimeout(timeout);
  timeout = setTimeout(onTimeout, milliseconds);
}

/** Allows long searches to continue while the engine keeps reporting useful progress. */
function refreshSearchTimeout(): void {
  if (phase !== "searching" || !active) return;
  armTimeout(engineTimeouts.searchIdle);
}

/** Prevents repeated informational messages from keeping a stalled search alive indefinitely. */
function noteSearchProgress(line: string): void {
  const nodes = Number(/\bnodes (\d+)/.exec(line)?.[1] ?? 0), depth = Number(/\bdepth (\d+)/.exec(line)?.[1] ?? 0);
  const rank = Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1);
  const progress = searchProgress.get(rank) ?? { nodes: 0, depth: 0 };
  if (nodes <= progress.nodes && depth <= progress.depth) return;
  searchProgress.set(rank, { nodes: Math.max(progress.nodes, nodes), depth: Math.max(progress.depth, depth) });
  refreshSearchTimeout();
}

/** Reuses a healthy worker only after its search output has been fully consumed. */
function finish(response: EngineResponse, reset = false): void {
  clearTimeout(timeout);
  if (reset) { worker?.terminate(); worker = null; workerEngine = null; verified = false; }
  phase = "idle";
  const job = active;
  active = null;
  variations = [];
  job?.respond(response);
  pump();
}

/** Replaces a stuck worker so queued documents can continue independently. */
function onTimeout(): void { finish({ error: `${workerEngine?.name ?? "Engine"} timed out. Please try again.` }, true); }

/** Drains canceled searches through bestmove before assigning output to another document. */
function onEngineMessage(event: MessageEvent<string>): void {
  if (typeof event.data !== "string") return;
  const line = event.data.trim();
  if (phase === "booting") {
    if (line.startsWith("id name ")) verified = workerEngine?.identity.test(line) ?? false;
    if (line !== "uciok") return;
    if (!verified) { finish({ error: `The bundled engine is not ${workerEngine?.name ?? "the selected engine"}.` }, true); return; }
    worker!.postMessage(`setoption name Hash value ${workerEngine?.id === "stockfish-10" ? 16 : 32}`);
    phase = "idle";
    clearTimeout(timeout);
    pump();
  } else if (line === "readyok" && phase === "preparing") {
    phase = "idle";
    if (!active) { clearTimeout(timeout); pump(); return; }
    worker!.postMessage(`position fen ${active.request.fen}`);
    const { depth } = active.request.settings;
    phase = "searching";
    refreshSearchTimeout();
    const remainingMs = active.request.deadline === undefined ? null : Math.max(1, active.request.deadline - Date.now());
    worker!.postMessage(`go depth ${depth}${remainingMs === null ? "" : ` movetime ${Math.floor(remainingMs)}`}`);
  } else if (line.startsWith("info ") && phase === "searching" && active) {
    noteSearchProgress(line);
    const parsed = parseInfo(line, active.request.fen);
    if (parsed && parsed.index >= 0 && parsed.index < active.request.settings.lines) variations[parsed.index] = parsed.variation;
  } else if (line.startsWith("bestmove ")) {
    if (phase === "stopping") { finish({ error: "Analysis canceled." }); return; }
    if (phase !== "searching" || !active) return;
    finish({ result: { fen: active.request.fen, bestMove: line.split(" ")[1] ?? "(none)", variations: variations.filter(Boolean), ...(active.request.deadline !== undefined ? { timeLimited: true } : {}) } });
  }
}

/** Starts queued searches only after worker initialization or cancellation has settled. */
function pump(): void {
  if (phase !== "idle") return;
  active ??= queue.shift() ?? null;
  if (!active) return;
  variations = [];
  searchProgress.clear();
  try {
    new Chess(active.request.fen);
    armTimeout(engineTimeouts.startup);
    const selected = getEngine(active.request.settings.engine);
    if (worker && workerEngine?.id !== selected.id) {
      // Retain verified workers so alternating evaluation and move searches do not repeat startup.
      if (workerEngine && verified) warmWorkers.set(workerEngine.id, worker);
      else worker.terminate();
      worker = null;
      workerEngine = null;
      verified = false;
    }
    for (const [id, cached] of warmWorkers) {
      if (selected.id !== EVALUATION_ENGINE.id && id !== EVALUATION_ENGINE.id && id !== selected.id) { cached.terminate(); warmWorkers.delete(id); }
    }
    if (!worker && warmWorkers.has(selected.id)) {
      worker = warmWorkers.get(selected.id)!;
      warmWorkers.delete(selected.id);
      workerEngine = selected;
      verified = true;
    }
    if (!worker) {
      workerEngine = selected;
      const current = new Worker(selected.worker);
      worker = current;
      phase = "booting";
      verified = false;
      /** Ignores already-queued callbacks from workers replaced after failure. */
      current.onmessage = (event) => { if (worker === current) onEngineMessage(event); };
      /** Resets failed active searches and discards failed parked workers. */
      current.onerror = (event) => {
        if (worker === current) finish({ error: `${selected.name} ${phase === "booting" ? "could not start" : "search failed"}: ${event.message}` }, true);
        else if (warmWorkers.get(selected.id) === current) { current.terminate(); warmWorkers.delete(selected.id); }
      };
      current.postMessage("uci");
    } else {
      phase = "preparing";
      worker.postMessage(`setoption name MultiPV value ${active.request.settings.lines}`);
      worker.postMessage("isready");
    }
  } catch (error) { finish({ error: error instanceof Error ? error.message : String(error) }, true); }
}

/** Acknowledges cancellation immediately while draining only the owner's active search. */
function cancel(owner: string): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i]!.request.owner === owner) queue.splice(i, 1)[0]!.respond({ error: "Analysis canceled." });
  }
  if (active?.request.owner !== owner) return;
  const job = active;
  active = null;
  variations = [];
  job.respond({ error: "Analysis canceled." });
  if (phase === "searching") {
    if (!workerEngine?.interruptible) { finish({ error: "Analysis canceled." }, true); return; }
    phase = "stopping";
    armTimeout(engineTimeouts.stopping);
    worker!.postMessage("stop");
  }
}

/** Validates requests and queues searches without mixing results between tabs. */
function onRequest(request: EngineRequest, _sender: chrome.runtime.MessageSender, respond: (response: unknown) => void): true | undefined {
  if (request?.target !== "engine") return;
  cancel(request.owner);
  if (request.action === "stop") { respond({ stopped: true }); return; }
  if (request.action !== "analyze" || typeof request.fen !== "string" || request.fen.length > 200 || /[\r\n]/.test(request.fen)) { respond({ error: "Invalid engine request." }); return; }
  if (queue.length >= 12) { respond({ error: "Engine busy. Try again shortly." }); return; }
  const { deadline, ...payload } = request;
  const boundedDeadline = typeof deadline === "number" && Number.isFinite(deadline) ? { deadline } : {};
  queue.push({ request: { ...payload, settings: normalizeSettings(request.settings), ...boundedDeadline }, respond });
  pump();
  return true;
}
chrome.runtime.onMessage.addListener(onRequest);
