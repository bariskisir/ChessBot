/** Provides a shared transport for the selected analysis engine. */
import type { Analysis, EngineResponse, Settings } from "./shared";

/** Requests the selected engine and rejects canceled or malformed responses. */
export async function analyzePosition(fen: string, settings: Settings, signal: AbortSignal): Promise<Analysis> {
  signal.throwIfAborted();
  const response: EngineResponse = await chrome.runtime.sendMessage({ target: "background", action: "analyze", fen, settings });
  signal.throwIfAborted();
  if (!response || "error" in response) throw new Error(response?.error ?? "No response from the selected engine.");
  if (response.result.fen !== fen) throw new Error("The analyzed position changed.");
  return response.result;
}

/** Cancels only this document's outstanding engine requests. */
export async function stopAnalysis(): Promise<void> {
  try { await chrome.runtime.sendMessage({ target: "background", action: "stop" }); } catch { /* The extension may be reloading. */ }
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
