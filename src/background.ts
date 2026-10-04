/** Routes document-scoped requests to the local chess-engine offscreen host. */
import type { EngineRequest, EngineResponse } from "./shared";
import type { InputRequest } from "./input-protocol";
import { handleInput } from "./trusted-input";
let creating: Promise<void> | null = null;

/** Creates one offscreen document when several tabs connect simultaneously. */
async function ensureHost(): Promise<void> {
  if (creating) return creating;
  if (await chrome.offscreen.hasDocument()) return;
  if (creating) return creating;
  creating = chrome.offscreen.createDocument({ url: "offscreen.html", reasons: [chrome.offscreen.Reason.WORKERS], justification: "Run bundled chess engines locally." });
  try { await creating; } finally { creating = null; }
}

/** Derives ownership from the sender before forwarding a request. */
async function route(request: EngineRequest, sender: chrome.runtime.MessageSender): Promise<EngineResponse | undefined> {
  await ensureHost();
  return chrome.runtime.sendMessage({ ...request, target: "engine", owner: `${sender.tab?.id ?? "extension"}:${sender.documentId ?? sender.url}` });
}

/** Keeps the response channel open until a bounded engine search finishes. */
function onMessage(request: EngineRequest | InputRequest, sender: chrome.runtime.MessageSender, respond: (response: unknown) => void): true | undefined {
  if (request?.target === "lichess-input") {
    handleInput(request, sender).then(respond,
      /** Returns an input error to the content script. */
      (error: unknown) => respond({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (request?.target !== "background" || !["analyze", "stop"].includes(request.action)) return;
  route(request, sender).then(respond,
    /** Reports startup and messaging errors to the requesting interface. */
    (error: unknown) => respond({ error: error instanceof Error ? error.message : String(error) }));
  return true;
}

chrome.runtime.onMessage.addListener(onMessage);
