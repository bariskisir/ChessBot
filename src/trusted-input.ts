/** Serializes trusted Lichess gestures per tab and cancels them by document and request ID. */
import { delay } from "./engine-client";
import { validGesture, type InputGesture, type InputPoint, type InputRequest, type InputResponse } from "./input-protocol";

const jobs = new Map<string, AbortController>();
const tabs = new Map<number, Promise<InputResponse>>();

/** Keeps all mouse events consistent, including cleanup after an interrupted drag. */
async function mouse(target: chrome.debugger.Debuggee, type: string, point: InputPoint): Promise<void> {
  await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
    type, ...point, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1,
  });
}

/** Acquires debugger access only for the duration of one cancelable gesture. */
async function dispatch(tabId: number, gesture: InputGesture, signal: AbortSignal): Promise<InputResponse> {
  const target: chrome.debugger.Debuggee = { tabId };
  const points = gesture.kind === "click" ? [gesture.point] : gesture.points;
  const first = points[0];
  if (!first) return { error: "Invalid Lichess input coordinates." };
  let attached = false, pressed = false, current = first;
  try {
    signal.throwIfAborted();
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    signal.throwIfAborted();
    await mouse(target, "mousePressed", current);
    pressed = true;
    if (gesture.kind === "drag") for (const point of points.slice(1)) {
      signal.throwIfAborted();
      current = point;
      await mouse(target, "mouseMoved", current);
      if (gesture.interval) await delay(gesture.interval, signal);
    }
    signal.throwIfAborted();
    await mouse(target, "mouseReleased", current);
    pressed = false;
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (pressed) await mouse(target, "mouseReleased", first).catch(
      /** A closed tab can reject cleanup without changing the original failure. */
      () => undefined);
    if (attached) await chrome.debugger.detach(target).catch(
      /** Chrome may have detached automatically when the document navigated away. */
      () => undefined);
  }
}

/** Validates the sender, then queues or cancels its gesture without crossing tab ownership. */
export async function handleInput(request: InputRequest, sender: chrome.runtime.MessageSender): Promise<InputResponse> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || (sender.frameId !== undefined && sender.frameId !== 0) ||
    !/^https:\/\/(?:www\.)?lichess\.org\//.test(sender.url ?? "")) return { error: "Lichess input requires a Lichess tab." };
  if (typeof request.id !== "string" || !request.id || request.id.length > 100) return { error: "Invalid input request ID." };
  const key = `${tabId}:${sender.documentId ?? sender.url}:${request.id}`;
  if (request.action === "cancel") { jobs.get(key)?.abort(); return { ok: true }; }
  if (request.action !== "play" || !validGesture(request.gesture, sender.tab?.width ?? 10000, sender.tab?.height ?? 10000)) {
    return { error: "Invalid Lichess input coordinates." };
  }
  if (jobs.has(key) || jobs.size >= 12) return { error: "Lichess input is busy. Try again shortly." };
  const controller = new AbortController();
  const timer = setTimeout(
    /** Expires queued gestures too, so stale input cannot run after a newer position appears. */
    () => controller.abort(new Error("Lichess input timed out.")), 2500);
  jobs.set(key, controller);
  const gesture = request.gesture;
  const previous = tabs.get(tabId) ?? Promise.resolve({ ok: true } as const);
  const current = previous.then(
    /** Waits for the preceding release and detach before acquiring the same tab again. */
    () => dispatch(tabId, gesture, controller.signal));
  tabs.set(tabId, current);
  try { return await current; }
  finally {
    clearTimeout(timer);
    jobs.delete(key);
    if (tabs.get(tabId) === current) tabs.delete(tabId);
  }
}
