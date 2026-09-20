/** Routes document-scoped requests to Stockfish or cancelable Jev decisions. */
import { analyzeJev } from "./jev";
import { normalizeSettings } from "./shared";
import type { EngineRequest, EngineResponse } from "./shared";
import type { JevHistory, JevHistoryRequest, JevLog, JevLogMessage } from "./jev-log";
import { JevLogStore } from "./jev-log-store";
const logStore = new JevLogStore(chrome.storage.session);
let creating: Promise<void> | null = null;
const pending = new Map<string, AbortController>();
const revisions = new Map<string, number>();

/** Creates one offscreen document when several tabs connect simultaneously. */
async function ensureHost(): Promise<void> {
  if (creating) return creating;
  if (await chrome.offscreen.hasDocument()) return;
  if (creating) return creating;
  creating = chrome.offscreen.createDocument({ url: "offscreen.html", reasons: [chrome.offscreen.Reason.WORKERS], justification: "Run bundled Stockfish 18 locally." });
  try { await creating; } finally { creating = null; }
}

/** Routes cancelable engine work and sends masked traffic only to its originating document. */
async function route(request: EngineRequest, sender: chrome.runtime.MessageSender): Promise<EngineResponse | undefined> {
  const owner = `${sender.tab?.id ?? "extension"}:${sender.documentId ?? sender.url}`;
  const revision = (revisions.get(owner) ?? 0) + 1;
  revisions.set(owner, revision);
  pending.get(owner)?.abort();
  pending.delete(owner);
  const settings = normalizeSettings(request.settings);
  if (request.action === "stop" || settings.engine === "openrouter-jev") {
    if (creating) await creating;
    const hasHost = await chrome.offscreen.hasDocument();
    if (revisions.get(owner) !== revision) return { error: "Analysis canceled." };
    if (hasHost) await chrome.runtime.sendMessage({ target: "engine", action: "stop", owner });
    if (request.action === "stop") return;
    if (revisions.get(owner) !== revision) return { error: "Analysis canceled." };
    const controller = new AbortController();
    pending.set(owner, controller);
    /** Aborts stalled requests without leaving a pending move behind. */
    const timer = setTimeout(() => controller.abort(), 25000);
    /** Persists masked traffic before notifying the tab, including its replacement after reload. */
    function publish(entry: JevLog): void {
      const tab = sender.tab?.id;
      if (tab === undefined) return;
      void logStore.record(tab, entry).then(
        /** Sends the current persisted snapshot to the live viewer. */
        (history) => notifyLogs(tab, history)).catch(
        /** Reports persistence errors without interrupting move selection. */
        () => chrome.tabs.sendMessage(tab, { target: "jev-log-error", error: "Jev logs could not be saved." }).catch(
          /** A closed tab has no viewer to notify. */
          () => {}));
    }
    try { return { result: await analyzeJev(request.fen, settings.openRouterKey, controller.signal, fetch, publish) }; }
    catch (error) { return { error: controller.signal.aborted ? "Jev analysis canceled or timed out." : error instanceof Error ? error.message : "Jev request failed." }; }
    finally { clearTimeout(timer); if (pending.get(owner) === controller) pending.delete(owner); }
  }
  await ensureHost();
  if (revisions.get(owner) !== revision) return { error: "Analysis canceled." };
  return chrome.runtime.sendMessage({ ...request, settings: { ...settings, openRouterKey: "" }, target: "engine", owner });
}

/** Keeps the response channel open until a bounded engine search finishes. */
function onMessage(request: EngineRequest, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void): true | undefined {
  if (request?.target !== "background" || !["analyze", "stop"].includes(request.action)) return;
  route(request, sender).then(respond,
    /** Reports startup and messaging errors to the requesting interface. */
    (error: unknown) => respond({ error: error instanceof Error ? error.message : String(error) }));
  return true;
}

chrome.runtime.onMessage.addListener(onMessage);

/** Notifies the current tab document without coupling logs to the engine's document owner. */
async function notifyLogs(tab: number, history: JevHistory): Promise<void> {
  const message: JevLogMessage = { target: "jev-logs", history };
  try { await chrome.tabs.sendMessage(tab, message); } catch { /* A reload restores the saved history on mount. */ }
}

/** Serves log reads and explicit clears without canceling engine work. */
function onLogMessage(request: JevHistoryRequest, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void): true | undefined {
  if (request?.target !== "jev-log-store" || !["get", "clear"].includes(request.action) || sender.tab?.id === undefined) return;
  const tab = sender.tab.id;
  const task = request.action === "clear" ? logStore.clear(tab) : logStore.read(tab);
  task.then(
    /** Returns the saved snapshot and updates any live viewer after clearing. */
    (history) => { respond({ history }); if (request.action === "clear") void notifyLogs(tab, history); },
    /** Keeps storage errors visible instead of silently losing history. */
    () => respond({ error: "Jev logs could not be loaded or cleared." }));
  return true;
}
chrome.runtime.onMessage.addListener(onLogMessage);
