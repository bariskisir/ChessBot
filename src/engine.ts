/** Serializes isolated Stockfish 18 searches across browser tabs. */
import { Chess } from "chess.js";
import { normalizeSettings, parseInfo, type EngineRequest, type EngineResponse, type Variation } from "./shared";
interface Job { request: EngineRequest; respond: (response: EngineResponse) => void }
const queue: Job[] = [];
let active: Job | null = null, worker: Worker | null = null;
let timeout: ReturnType<typeof setTimeout> | undefined;
let variations: Variation[] = [], verified = false;

/** Destroys the completed worker so stale output cannot leak into another search. */
function finish(response: EngineResponse): void {
  clearTimeout(timeout);
  worker?.terminate();
  worker = null;
  const job = active;
  active = null;
  job?.respond(response);
  pump();
}

/** Rejects initialization or searches that exceed their allotted time. */
function onTimeout(): void { finish({ error: "Stockfish timed out. Please try again." }); }

/** Verifies engine identity and handles the UCI readiness and search protocol. */
function onEngineMessage(event: MessageEvent<string>): void {
  if (!active || typeof event.data !== "string") return;
  const line = event.data.trim();
  if (line.startsWith("id name ")) verified = /^id name Stockfish 18\b/.test(line);
  if (line === "uciok") {
    if (!verified) { finish({ error: "The bundled engine is not Stockfish 18." }); return; }
    worker!.postMessage("setoption name Hash value 32");
    worker!.postMessage(`setoption name MultiPV value ${active.request.settings.lines}`);
    worker!.postMessage("isready");
  } else if (line === "readyok") {
    worker!.postMessage(`position fen ${active.request.fen}`);
    const { depth, time } = active.request.settings;
    worker!.postMessage(`go depth ${depth}${time > 0 ? ` movetime ${time}` : ""}`);
  } else if (line.startsWith("info ")) {
    const parsed = parseInfo(line, active.request.fen);
    if (parsed && parsed.index >= 0 && parsed.index < active.request.settings.lines) variations[parsed.index] = parsed.variation;
  } else if (line.startsWith("bestmove ")) {
    finish({ result: { fen: active.request.fen, bestMove: line.split(" ")[1] ?? "(none)", variations: variations.filter(Boolean) } });
  }
}

/** Reports worker failures to the interface. */
function onEngineError(event: ErrorEvent): void { finish({ error: `Stockfish could not start: ${event.message}` }); }

/** Starts the next queued position using bundled JavaScript and WebAssembly. */
function pump(): void {
  if (active || queue.length === 0) return;
  active = queue.shift()!;
  variations = [];
  verified = false;
  try {
    new Chess(active.request.fen);
    worker = new Worker("stockfish.js");
    worker.onmessage = onEngineMessage;
    worker.onerror = onEngineError;
    timeout = setTimeout(onTimeout, Math.max(20000, active.request.settings.time + 15000));
    worker.postMessage("uci");
  } catch (error) { finish({ error: error instanceof Error ? error.message : String(error) }); }
}

/** Cancels only jobs belonging to a specific document. */
function cancel(owner: string): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i]!.request.owner === owner) queue.splice(i, 1)[0]!.respond({ error: "Analysis canceled." });
  }
  if (active?.request.owner === owner) finish({ error: "Analysis canceled." });
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
