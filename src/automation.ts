/** Restores automatic new-match and rematch detection with cancelable delays. */
import type { Settings } from "./shared";
export interface GameAction { button: HTMLElement; name: "New Game" | "Rematch" }

/** Finds a visible game-over control among the supported selectors. */
function visible(selector: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    if (element.getClientRects().length && !element.hasAttribute("disabled")) return element;
  }
  return null;
}

/** Selects the new-match action before rematch when both are enabled. */
export function findGameAction(settings: Settings): GameAction | null {
  const next = visible('[data-cy="game-over-modal-new-game-button"], [data-cy="next-arena-game-button"]');
  if (settings.autoNewMatch && next) return { button: next, name: "New Game" };
  if (!settings.autoRematch) return null;
  const rematch = visible('button[data-control="rematch"], .game-over-button-component.game-over-button-primary');
  if (rematch) return { button: rematch, name: "Rematch" };
  for (const button of document.querySelectorAll<HTMLButtonElement>("button")) {
    if (button.getClientRects().length && !button.disabled && button.innerText.includes("Rematch")) return { button, name: "Rematch" };
  }
  return null;
}
