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

/** Checks whether an element is rendered and enabled. */
function isShown(element: HTMLElement): boolean {
  if (!element.getClientRects().length || element.hasAttribute("disabled")) return false;
  return !(element instanceof HTMLButtonElement && element.disabled);
}

/** Reads the clickable label with a layout-independent fallback. */
function label(button: HTMLElement): string {
  return (button.innerText || button.textContent || "").trim();
}

/** Finds regular and arena new-match controls while excluding arena search indicators. */
function findNewButton(): HTMLElement | null {
  const legacy = visible('[data-cy="game-over-modal-new-game-button"], [data-cy="next-arena-game-button"], .game-over-arena-button-component button.game-over-arena-button-button:not(.game-over-arena-button-finding)');
  if (legacy) return legacy;
  const scoped = document.querySelectorAll<HTMLElement>(
    ".game-over-modal-shell-buttons button, .game-over-secondary-actions-row-component button, .game-over-modal-component button, .board-modal-component button",
  );
  for (const button of scoped) {
    if (isShown(button) && /^new(\s|$)/i.test(label(button))) return button;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("button")) {
    if (!isShown(button)) continue;
    if (/^new(\s|$)/i.test(label(button))) return button;
    if (/^new(\s|$)/i.test((button.getAttribute("aria-label") || "").trim())) return button;
  }
  return null;
}

/** Finds the rematch control via stable attributes before text fallback. */
function findRematchButton(): HTMLElement | null {
  const legacy = visible('button[data-control="rematch"], .game-over-button-component.game-over-button-primary');
  if (legacy) return legacy;
  for (const button of document.querySelectorAll<HTMLButtonElement>("button")) {
    if (isShown(button) && (button.getAttribute("aria-label") || "").trim().toLowerCase() === "rematch") return button;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("button")) {
    if (isShown(button) && /rematch/i.test(label(button))) return button;
  }
  return null;
}

/** Selects the new-match action before rematch when both are enabled. */
export function findGameAction(settings: Settings): GameAction | null {
  const next = findNewButton();
  if (settings.autoNewMatch && next) return { button: next, name: "New Game" };
  if (!settings.autoRematch) return null;
  const rematch = findRematchButton();
  if (rematch) return { button: rematch, name: "Rematch" };
  return null;
}
