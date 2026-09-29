/** Sends cancelable trusted gestures without retaining a stalled background acknowledgement. */
import type { InputGesture, InputRequest, InputResponse } from "./input-protocol";

/** Propagates STOP and attempt timeouts to the service worker as well as the local caller. */
export function sendTrustedInput(gesture: InputGesture, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  return new Promise<void>(
    /** Owns one response listener and releases it on either cancellation or acknowledgement. */
    (resolve, reject) => {
      /** Prevents a canceled gesture from issuing any further debugger commands. */
      function abort(): void {
        void Promise.resolve().then(
          /** Turns a synchronous context-reload failure into a handled transport rejection. */
          () => chrome.runtime.sendMessage({ target: "lichess-input", action: "cancel", id } satisfies InputRequest)).catch(
          /** The old extension context may already have disappeared during reload. */
          () => undefined);
        reject(signal.reason);
      }
      signal.addEventListener("abort", abort, { once: true });
      void Promise.resolve().then(
        /** Skips requests canceled before the transport is ready to send. */
        () => { signal.throwIfAborted(); return chrome.runtime.sendMessage({ target: "lichess-input", action: "play", id, gesture } satisfies InputRequest); }).then(
        /** Ignores late replies after the caller has canceled the gesture. */
        (response: InputResponse | undefined) => {
          signal.removeEventListener("abort", abort);
          if (signal.aborted) return;
          if (!response || "error" in response) reject(new Error(response?.error ?? "Lichess input did not respond."));
          else resolve();
        },
        /** Reports a transport failure without retaining the cancellation listener. */
        (error: unknown) => { signal.removeEventListener("abort", abort); if (!signal.aborted) reject(error); });
    });
}
