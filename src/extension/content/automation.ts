/**
 * Handles automatic Chess.com actions such as moves, new games, and rematches.
 */
import type { BotSettings } from "../shared/types";
import { getBoardElement, getUserColor } from "./chessboard";
import { qs, qsa } from "./dom";
import { setStatus } from "./overlay";

export interface AutomationState {
  isAnalyzing: boolean;
  isMoveExecuting: boolean;
  isRematching: boolean;
}

/**
 * Waits for the requested number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

/**
 * Returns true when a value is a finite screen coordinate.
 */
function isFiniteCoordinate(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * Returns true when a UCI move contains valid source and target squares.
 */
function isValidUciMove(moveUci: string): boolean {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(moveUci);
}

/**
 * Computes the screen center of a chess square on the current board orientation.
 */
function squareToClientPoint(board: HTMLElement, square: string): { clientX: number; clientY: number } | null {
  const file = square.charCodeAt(0) - 96;
  const rank = Number.parseInt(square[1] ?? "", 10);

  if (file < 1 || file > 8 || rank < 1 || rank > 8) {
    return null;
  }

  const isFlipped = board.classList.contains("flipped");
  const xPercent = isFlipped ? (8 - file) * 12.5 + 6.25 : (file - 1) * 12.5 + 6.25;
  const yPercent = isFlipped ? (rank - 1) * 12.5 + 6.25 : (8 - rank) * 12.5 + 6.25;
  const rect = board.getBoundingClientRect();
  const clientX = rect.left + (rect.width * xPercent) / 100;
  const clientY = rect.top + (rect.height * yPercent) / 100;

  if (!isFiniteCoordinate(clientX) || !isFiniteCoordinate(clientY)) {
    return null;
  }

  return {
    clientX,
    clientY,
  };
}

/**
 * Dispatches the mouse and pointer events Chess.com expects for a click.
 */
function dispatchSyntheticClick(dispatcher: HTMLElement, clientX: number, clientY: number): boolean {
  if (!isFiniteCoordinate(clientX) || !isFiniteCoordinate(clientY)) {
    return false;
  }

  const baseOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    button: 0,
  };

  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    if (type.startsWith("pointer")) {
      dispatcher.dispatchEvent(
        new PointerEvent(type, {
          ...baseOptions,
          pointerId: 1,
          isPrimary: true,
        }),
      );
      continue;
    }

    dispatcher.dispatchEvent(new MouseEvent(type, baseOptions));
  }

  return true;
}

/**
 * Simulates a click on either a board square or an existing HTML element.
 */
function simulateClick(board: HTMLElement, target: string | HTMLElement): boolean {
  if (typeof target === "string") {
    const point = squareToClientPoint(board, target);

    if (!point) {
      return false;
    }

    return dispatchSyntheticClick(board, point.clientX, point.clientY);
  }

  const rect = target.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  return dispatchSyntheticClick(target, clientX, clientY);
}

/**
 * Attempts to click the promotion piece matching the engine move suffix.
 */
async function choosePromotionPiece(board: HTMLElement, promotionChar: string): Promise<void> {
  const userColor = getUserColor();
  const targetPiece = `${userColor}${promotionChar}`;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await delay(100);

    const promotionButton =
      qs<HTMLElement>(`.promotion-piece.${targetPiece}`) ??
      qs<HTMLElement>(`.promotion-piece[class*="${targetPiece}"]`) ??
      qs<HTMLElement>(`.promotion-piece[class*="${promotionChar}"]`);

    if (promotionButton && promotionButton.offsetParent !== null) {
      await delay(200);
      const clicked = simulateClick(board, promotionButton);

      if (!clicked) {
        return;
      }

      promotionButton.click();
      return;
    }
  }
}

/**
 * Executes a UCI move on Chess.com by simulating board clicks.
 */
export async function executeMove(
  moveUci: string,
  settings: BotSettings,
  state: AutomationState,
  onComplete: () => void,
): Promise<void> {
  if (!isValidUciMove(moveUci) || state.isMoveExecuting) {
    return;
  }

  state.isMoveExecuting = true;

  try {
    if (settings.autoPlayDelay > 0) {
      await delay(Math.floor(Math.random() * (settings.autoPlayDelay + 1)));
    }

    const board = getBoardElement();

    if (!board) {
      throw new Error("Board not found");
    }

    const fromClicked = simulateClick(board, moveUci.slice(0, 2));

    if (!fromClicked) {
      throw new Error(`Invalid source square coordinates for move ${moveUci}`);
    }

    await delay(150);

    const toClicked = simulateClick(board, moveUci.slice(2, 4));

    if (!toClicked) {
      throw new Error(`Invalid target square coordinates for move ${moveUci}`);
    }

    if (moveUci.length > 4) {
      await choosePromotionPiece(board, moveUci[4]?.toLowerCase() ?? "q");
    }
  } catch (error) {
    console.error("ExecuteMove Error:", error);
  } finally {
    globalThis.setTimeout(() => {
      state.isMoveExecuting = false;
      onComplete();
    }, 400);
  }
}

/**
 * Finds a visible Chess.com game-over modal or action button.
 */
function findGameOverElements(): {
  hasModal: boolean;
  newMatchButton: HTMLElement | null;
  rematchButton: HTMLElement | null;
} {
  const modal =
    qs<HTMLElement>(".game-over-modal-content") ??
    qs<HTMLElement>(".game-over-modal-container") ??
    qs<HTMLElement>(".board-modal-modal") ??
    qs<HTMLElement>(".game-over-modal-component") ??
    qs<HTMLElement>(".game-result-overlay");
  const newMatchButton =
    qs<HTMLElement>('[data-cy="game-over-modal-new-game-button"]') ??
    qs<HTMLElement>('[data-cy="next-arena-game-button"]');
  const primaryRematchButton =
    qs<HTMLElement>('button[data-control="rematch"]') ??
    qs<HTMLElement>(".game-over-button-component.game-over-button-primary");
  const textRematchButton =
    qsa<HTMLElement>("button").find((button) => button.innerText.includes("Rematch")) ?? null;

  return {
    hasModal: Boolean(modal),
    newMatchButton,
    rematchButton: primaryRematchButton ?? textRematchButton,
  };
}

/**
 * Performs a delayed game-over action and restarts analysis afterwards.
 */
function scheduleGameOverAction(
  button: HTMLElement,
  waitingStatus: string,
  clickedStatus: string,
  state: AutomationState,
  stopDetection: () => void,
  startDetection: () => void,
): void {
  state.isRematching = true;
  state.isAnalyzing = false;
  stopDetection();
  setStatus(waitingStatus, "#f59e0b");

  globalThis.setTimeout(() => {
    button.click();
    setStatus(clickedStatus, "#3b82f6");

    globalThis.setTimeout(() => {
      state.isRematching = false;
      state.isAnalyzing = true;
      startDetection();
      setStatus("New Game Started", "#10b981");
    }, 2500);
  }, 2500);
}

/**
 * Checks for game-over UI and optionally starts a new game or rematch.
 */
export function checkGameEnd(
  settings: BotSettings,
  state: AutomationState,
  stopDetection: () => void,
  startDetection: () => void,
): void {
  if (state.isRematching) {
    return;
  }

  const { hasModal, newMatchButton, rematchButton } = findGameOverElements();

  if (!hasModal && !newMatchButton && !rematchButton) {
    return;
  }

  if (settings.autoNewMatch && newMatchButton) {
    scheduleGameOverAction(
      newMatchButton,
      "Game Over - Waiting 2.5s for New Game...",
      "New Game clicked - Waiting 2.5s...",
      state,
      stopDetection,
      startDetection,
    );
    return;
  }

  if (settings.autoRematch && rematchButton) {
    scheduleGameOverAction(
      rematchButton,
      "Game Over - Waiting 2.5s for Rematch...",
      "Rematch clicked - Waiting 2.5s...",
      state,
      stopDetection,
      startDetection,
    );
  }
}
