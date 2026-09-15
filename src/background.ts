/** Routes document-scoped requests to the local Stockfish offscreen host. */
import type { EngineRequest, EngineResponse } from "./shared";
let creating: Promise<void> | null = null;

/** Creates one offscreen document when several tabs connect simultaneously. */
async function ensureHost(): Promise<void> {
  if (creating) return creating;
  if (await chrome.offscreen.hasDocument()) return;
  if (creating) return creating;
  creating = chrome.offscreen.createDocument({ url: "offscreen.html", reasons: [chrome.offscreen.Reason.WORKERS], justification: "Run bundled Stockfish 18 locally." });
  try { await creating; } finally { creating = null; }
}

/** Derives ownership from the sender before forwarding a request. */
async function route(request: EngineRequest, sender: chrome.runtime.MessageSender): Promise<EngineResponse | undefined> {
  await ensureHost();
  return chrome.runtime.sendMessage({ ...request, target: "engine", owner: `${sender.tab?.id ?? "extension"}:${sender.documentId ?? sender.url}` });
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
