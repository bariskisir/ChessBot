/**
 * Coordinates the ChessBot content script lifecycle on Chess.com pages.
 */
import type { BotSettings, EngineAnalysis, MaybeMistakeType, MistakeCache, RuntimeRequest } from "../shared/types";
import { normalizeSettings } from "../shared/settings";
import { checkGameEnd, executeMove, type AutomationState } from "./automation";
import { clearHighlights, getBoardElement, getFen, getUserColor, highlightMove } from "./chessboard";
import { qs } from "./dom";
import { analyzePosition, stopAnalysis } from "./engine-client";
import { findMistake, getMistakeCache } from "./mistake-mode";
import { createOverlay, setStatus, updateBestMoveText, updateEvalBar } from "./overlay";
import { loadSettings, saveSettings } from "./storage";

declare global {
  interface Window {
    mistakeCache?: MistakeCache;
  }
}

let settings: BotSettings = loadSettings();
let lastFen = "";
let boardObserver: MutationObserver | null = null;
let modalObserver: MutationObserver | null = null;
let debounceTimer: number | null = null;

const state: AutomationState = {
  isAnalyzing: false,
  isMoveExecuting: false,
  isRematching: false,
};

/**
 * Stores normalized settings after UI changes.
 */
function persistSettings(nextSettings: BotSettings): void {
  settings = normalizeSettings(nextSettings);
  saveSettings(settings);
}

/**
 * Clears any pending debounce timer.
 */
function clearDebounce(): void {
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/**
 * Stops all observers, clears temporary UI, and cancels local analysis.
 */
function stopDetection(): void {
  boardObserver?.disconnect();
  modalObserver?.disconnect();
  boardObserver = null;
  modalObserver = null;
  clearDebounce();
  state.isMoveExecuting = false;
  clearHighlights();
  updateBestMoveText("----");
  stopAnalysis();
}

/**
 * Returns true when a mutation was caused by the injected overlay or highlights.
 */
function isOwnMutation(mutation: MutationRecord): boolean {
  const target = mutation.target;

  if (!(target instanceof Element)) {
    return false;
  }

  return target.id.includes("bot-overlay") || target.classList.contains("custom-bot-highlight");
}

/**
 * Handles board mutations by refreshing game-over state and engine analysis.
 */
function handleBoardMutations(mutations: MutationRecord[]): void {
  checkGameEnd(settings, state, stopDetection, startDetection);

  if (mutations.some((mutation) => !isOwnMutation(mutation))) {
    void calculateBestMove();
  }
}

/**
 * Handles modal mutations that can expose game-over actions.
 */
function handleModalMutation(): void {
  checkGameEnd(settings, state, stopDetection, startDetection);
}

/**
 * Starts board and modal observers, then performs an immediate analysis pass.
 */
function startDetection(): void {
  const board = getBoardElement();
  lastFen = "";
  void calculateBestMove();

  if (!board) {
    return;
  }

  boardObserver?.disconnect();
  boardObserver = new MutationObserver(handleBoardMutations);
  boardObserver.observe(board, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  modalObserver?.disconnect();
  modalObserver = new MutationObserver(handleModalMutation);
  modalObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  checkGameEnd(settings, state, stopDetection, startDetection);
}

/**
 * Starts analysis from the overlay control.
 */
function handleStart(): void {
  state.isAnalyzing = true;
  lastFen = "";
  startDetection();
  setStatus("Analyzing Board", "#10b981");
}

/**
 * Stops analysis from the overlay control.
 */
function handleStop(): void {
  state.isAnalyzing = false;
  stopDetection();
  setStatus("Stopped", "#ef4444");
}

/**
 * Returns true when the page is temporarily unsafe for a synthetic move.
 */
function isBoardBusy(): boolean {
  const promotionWindow = qs<HTMLElement>(".promotion-window");
  const board = getBoardElement();

  if (promotionWindow && promotionWindow.offsetParent !== null) {
    return true;
  }

  return Boolean(board?.classList.contains("dragging") || board?.querySelector(".piece.dragging"));
}

/**
 * Reads the active color from a FEN string.
 */
function readTurnFromFen(fen: string): "w" | "b" {
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

/**
 * Returns the delay still needed to satisfy the configured minimum thinking time.
 */
function getRemainingThinkingDelay(startTime: number): number {
  return Math.max(0, settings.thinkingTime - (Date.now() - startTime));
}

/**
 * Schedules engine result handling after the configured thinking delay.
 */
function scheduleResultHandling(data: EngineAnalysis, turn: "w" | "b", userColor: "w" | "b", fen: string, startTime: number): void {
  window.setTimeout(() => {
    void handleResult(data, turn, userColor, fen);
  }, getRemainingThinkingDelay(startTime));
}

/**
 * Calculates the best move for the current position after a short debounce.
 */
async function calculateBestMove(): Promise<void> {
  if (!state.isAnalyzing || state.isMoveExecuting || isBoardBusy()) {
    return;
  }

  clearDebounce();

  debounceTimer = window.setTimeout(() => {
    void analyzeDebouncedPosition();
  }, 400);
}

/**
 * Reads the current FEN and submits it to the selected engine.
 */
async function analyzeDebouncedPosition(): Promise<void> {
  if (!state.isAnalyzing || state.isRematching) {
    return;
  }

  const currentFen = getFen();

  if (!currentFen) {
    setStatus("Waiting for board...", "#f59e0b");
    return;
  }

  if (currentFen === lastFen) {
    return;
  }

  lastFen = currentFen;
  setStatus("Thinking...", "#3b82f6");

  const turn = readTurnFromFen(currentFen);
  const userColor = getUserColor();
  const startTime = Date.now();

  try {
    const data = await analyzePosition(currentFen, settings);
    scheduleResultHandling(data, turn, userColor, currentFen, startTime);
  } catch {
    setStatus("Engine Error", "#ef4444");
  }
}

/**
 * Applies mistake-mode behavior to a best move when configured.
 */
async function applyMistakeMode(
  data: EngineAnalysis,
  userColor: "w" | "b",
  fen: string,
): Promise<{ move: string; mistakeType: MaybeMistakeType } | null> {
  if (!data.move) {
    return null;
  }

  let bestMove = data.move;
  let mistakeType: MaybeMistakeType = false;
  const evalValue = data.eval ?? 0;
  window.mistakeCache = getMistakeCache(window.mistakeCache, fen, userColor, evalValue, settings);
  const cache = window.mistakeCache;

  if (!cache.shouldTrigger || !cache.isWinning) {
    return { move: bestMove, mistakeType };
  }

  if (cache.processed) {
    if (cache.result) {
      bestMove = cache.result.move;
      mistakeType = cache.result.type;
    } else {
      setStatus("No safe mistake found. Playing best.", "#10b981");
    }

    return { move: bestMove, mistakeType };
  }

  if (cache.searching) {
    setStatus("Attempting to find mistake...", "#f59e0b");
    return null;
  }

  cache.searching = true;
  setStatus("Attempting to find mistake...", "#f59e0b");

  try {
    cache.result = await findMistake(fen, userColor, settings);
  } catch (error) {
    console.error("Mistake search failed", error);
  } finally {
    cache.processed = true;
    cache.searching = false;
  }

  if (cache.result) {
    bestMove = cache.result.move;
    mistakeType = cache.result.type;
  } else {
    setStatus("No safe mistake found. Playing best.", "#10b981");
  }

  return { move: bestMove, mistakeType };
}

/**
 * Updates UI and optionally executes the chosen move.
 */
async function playOrHighlightMove(move: string, mistakeType: MaybeMistakeType): Promise<void> {
  updateBestMoveText(move);

  if (!mistakeType) {
    setStatus(`Analyzing Board (Depth ${settings.depth})`, "#10b981");
  } else if (mistakeType === "ideal") {
    setStatus("Mistake Mode!", "#ef4444");
  } else {
    setStatus("Suboptimal Mode", "#f97316");
  }

  if (!settings.autoPlay) {
    highlightMove(move, mistakeType);
    return;
  }

  clearHighlights();
  await executeMove(move, settings, state, () => {
    lastFen = "";

    if (state.isAnalyzing) {
      void calculateBestMove();
    }
  });

  if (mistakeType) {
    highlightMove(move, mistakeType);
  }
}

/**
 * Handles an engine result for the latest analyzed position.
 */
async function handleResult(data: EngineAnalysis, turn: "w" | "b", userColor: "w" | "b", fen: string): Promise<void> {
  updateEvalBar(data);

  if (turn !== userColor) {
    setStatus("Opponent's turn", "#9ca3af");
    clearHighlights();
    updateBestMoveText("---");
    return;
  }

  if (!data.move) {
    setStatus(data.error ?? "No move found", "#ef4444");
    return;
  }

  const selectedMove = await applyMistakeMode(data, userColor, fen);

  if (!selectedMove) {
    return;
  }

  await playOrHighlightMove(selectedMove.move, selectedMove.mistakeType);
}

/**
 * Creates the overlay and connects it to the content-script lifecycle.
 */
function bootstrapOverlay(): void {
  createOverlay(settings, {
    onStart: handleStart,
    onStop: handleStop,
    onSettingsChanged: persistSettings,
    stopRemoteAnalysis: stopAnalysis,
  });
}

/**
 * Handles extension messages sent to the content script.
 */
function handleRuntimeMessage(request: RuntimeRequest, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): void {
  if (request.action === "start") {
    bootstrapOverlay();
    sendResponse({ status: "injected" });
  }
}

chrome.runtime.onMessage.addListener(handleRuntimeMessage);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapOverlay);
} else {
  bootstrapOverlay();
}
