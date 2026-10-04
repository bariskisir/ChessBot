/** Provides a single local Stockfish transport for analysis and mistake searches. */
import type { Analysis, EngineResponse, SearchDeadline, Settings } from "./shared";
let stopping: Promise<void> = Promise.resolve();

/** Orders cancellation before a bounded search and releases canceled queued requests immediately. */
export async function analyzePosition(fen: string, settings: Settings, signal: AbortSignal, getDeadline?: SearchDeadline): Promise<Analysis> {
  await stopping;
  signal.throwIfAborted();
  let rejectCancellation!: (reason: unknown) => void;
  const cancelled = new Promise<never>(
    /** Keeps a lost engine reply from withholding an expired turn. */
    (_resolve, reject) => { rejectCancellation = reject; });
  /** Releases this owner's engine work without waiting for its background response. */
  const abort = (): void => { void stopAnalysis(); rejectCancellation(signal.reason); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const deadline = getDeadline?.();
    const response: EngineResponse = await Promise.race([
      chrome.runtime.sendMessage({ target: "background", action: "analyze", fen, settings, ...(deadline != null ? { deadline } : {}) }), cancelled,
    ]);
    signal.throwIfAborted();
    if (!response || "error" in response) throw new Error(response?.error ?? "No response from Stockfish.");
    if (response.result.fen !== fen) throw new Error("The analyzed position changed.");
    return response.result;
  } finally { signal.removeEventListener("abort", abort); }
}

/** Orders document cancellations before subsequent requests without waiting for engine draining. */
export function stopAnalysis(): Promise<void> {
  stopping = stopping.then(
    /** Keeps cancellation ordering even while the background host is being created. */
    async () => { try { await chrome.runtime.sendMessage({ target: "background", action: "stop" }); } catch { /* The extension may be reloading. */ } });
  return stopping;
}

/** Waits for a delay while allowing STOP to immediately cancel pending actions. */
export function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise(
    /** Registers a timer and an abort listener that clean up one another. */
    (resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      /** Resolves the delay and removes its abort listener. */
      function complete(): void { signal.removeEventListener("abort", abort); resolve(); }
      /** Cancels the timer and rejects the interrupted wait. */
      function abort(): void { clearTimeout(timer); reject(signal.reason); }
      const timer = setTimeout(complete, milliseconds);
      signal.addEventListener("abort", abort, { once: true });
    });
}
