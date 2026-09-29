/** Serializes document-owned searches while keeping the local Stockfish worker warm. */
import { Chess } from "chess.js";
import { normalizeSettings, parseInfo, type EngineRequest, type EngineResponse, type Variation } from "./shared";
interface Job { request: EngineRequest; respond: (response: EngineResponse) => void }
const queue: Job[] = [];
let active: Job | null = null, worker: Worker | null = null;
let phase: "idle" | "booting" | "preparing" | "searching" | "stopping" = "idle";
let timeout: ReturnType<typeof setTimeout> | undefined;
let variations: Variation[] = [], verified = false;
const engineTimeouts = { startup: 20000, searchIdle: 60000, stopping: 2000 };
let progressNodes = 0, progressDepth = 0;

/** Arms the watchdog for engine startup or a period without search progress. */
function armTimeout(milliseconds: number): void {
  clearTimeout(timeout);
  timeout = setTimeout(onTimeout, milliseconds);
}

/** Allows long searches to continue while Stockfish keeps reporting useful progress. */
function refreshSearchTimeout(): void {
  if (phase !== "searching" || !active) return;
  armTimeout(engineTimeouts.searchIdle);
}

/** Prevents repeated informational messages from keeping a stalled search alive indefinitely. */
function noteSearchProgress(line: string): void {
  const nodes = Number(/\bnodes (\d+)/.exec(line)?.[1] ?? 0), depth = Number(/\bdepth (\d+)/.exec(line)?.[1] ?? 0);
  if (nodes <= progressNodes && depth <= progressDepth) return;
  progressNodes = Math.max(progressNodes, nodes);
  progressDepth = Math.max(progressDepth, depth);
  refreshSearchTimeout();
}

/** Reuses a healthy worker only after its search output has been fully consumed. */
function finish(response: EngineResponse, reset = false): void {
  clearTimeout(timeout);
  if (reset) { worker?.terminate(); worker = null; verified = false; }
  phase = "idle";
  const job = active;
  active = null;
  variations = [];
  job?.respond(response);
  pump();
}

/** Replaces a stuck worker so queued documents can continue independently. */
function onTimeout(): void { finish({ error: "Stockfish timed out. Please try again." }, true); }

/** Drains canceled searches through bestmove before assigning output to another document. */
function onEngineMessage(event: MessageEvent<string>): void {
  if (typeof event.data !== "string") return;
  const line = event.data.trim();
  if (phase === "booting") {
    if (line.startsWith("id name ")) verified = /^id name Stockfish 19\b/.test(line);
    if (line !== "uciok") return;
    if (!verified) { finish({ error: "The bundled engine is not Stockfish 19." }, true); return; }
    worker!.postMessage("setoption name Hash value 32");
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
    worker!.postMessage(`go depth ${depth}`);
  } else if (line.startsWith("info ") && phase === "searching" && active) {
    noteSearchProgress(line);
    const parsed = parseInfo(line, active.request.fen);
    if (parsed && parsed.index >= 0 && parsed.index < active.request.settings.lines) variations[parsed.index] = parsed.variation;
  } else if (line.startsWith("bestmove ")) {
    if (phase === "stopping") { finish({ error: "Analysis canceled." }); return; }
    if (phase !== "searching" || !active) return;
    finish({ result: { fen: active.request.fen, bestMove: line.split(" ")[1] ?? "(none)", variations: variations.filter(Boolean) } });
  }
}

/** Starts queued searches only after worker initialization or cancellation has settled. */
function pump(): void {
  if (phase !== "idle") return;
  active ??= queue.shift() ?? null;
  if (!active) return;
  variations = [];
  progressNodes = progressDepth = 0;
  try {
    new Chess(active.request.fen);
    armTimeout(engineTimeouts.startup);
    if (!worker) {
      const current = new Worker("stockfish.js");
      worker = current;
      phase = "booting";
      verified = false;
      /** Ignores already-queued callbacks from workers replaced after failure. */
      current.onmessage = (event) => { if (worker === current) onEngineMessage(event); };
      /** Reports failures only for the currently owned worker. */
      current.onerror = (event) => { if (worker === current) finish({ error: `Stockfish could not start: ${event.message}` }, true); };
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
  queue.push({ request: { ...request, settings: normalizeSettings(request.settings) }, respond });
  pump();
  return true;
}
chrome.runtime.onMessage.addListener(onRequest);
