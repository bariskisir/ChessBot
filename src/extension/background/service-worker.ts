/**
 * Coordinates extension messages between content scripts and the offscreen Stockfish host.
 */
import type { AnalysisResultMessage, AnalyzeMessage, RuntimeRequest } from "../shared/types";

type ResponseResolver = (response?: unknown) => void;

let creatingOffscreen: Promise<void> | null = null;
const pendingResolvers = new Map<string, ResponseResolver>();

/**
 * Creates a unique request id for matching async Stockfish responses.
 */
function createAnalysisId(): string {
  return `an_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

/**
 * Ensures the offscreen Stockfish document exists before local analysis starts.
 */
async function setupOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "Stockfish analysis worker host.",
  });

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

/**
 * Forwards a content-script analysis request to the offscreen Stockfish host.
 */
async function forwardAnalysisRequest(request: AnalyzeMessage, sendResponse: ResponseResolver): Promise<void> {
  const analysisId = createAnalysisId();

  try {
    await setupOffscreen();
    pendingResolvers.set(analysisId, sendResponse);
    await chrome.runtime.sendMessage({
      action: "analyzeLocal",
      fen: request.fen,
      depth: request.depth,
      id: analysisId,
      multiPv: request.multiPv ?? 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendResponse({ error: `Offscreen Setup Failed: ${message}` });
  }
}

/**
 * Resolves the content-script callback waiting for a Stockfish result.
 */
function resolveAnalysisResult(request: AnalysisResultMessage): void {
  const { id, result } = request;

  if (id && pendingResolvers.has(id)) {
    const resolve = pendingResolvers.get(id);
    resolve?.(result);
    pendingResolvers.delete(id);
    return;
  }

  if (pendingResolvers.size === 1) {
    const fallback = pendingResolvers.entries().next().value;

    if (fallback) {
      const [pendingId, resolve] = fallback;
      resolve(result);
      pendingResolvers.delete(pendingId);
    }
  }
}

/**
 * Forwards stop commands to the offscreen document.
 */
function stopAnalysis(sendResponse: ResponseResolver): void {
  void chrome.runtime.sendMessage({ action: "stopAnalysis" });
  sendResponse({ status: "stopped" });
}

/**
 * Handles all runtime messages received by the service worker.
 */
function handleMessage(request: RuntimeRequest, _sender: chrome.runtime.MessageSender, sendResponse: ResponseResolver): true | void {
  if (request.action === "analyze") {
    void forwardAnalysisRequest(request, sendResponse);
    return true;
  }

  if (request.action === "analysisResult") {
    resolveAnalysisResult(request);
    return;
  }

  if (request.action === "stopAnalysis") {
    stopAnalysis(sendResponse);
  }
}

chrome.runtime.onMessage.addListener(handleMessage);
