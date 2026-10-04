/** Restores automatic new-match and rematch detection with cancelable delays. */
import type { Settings } from "../shared";
import { isShown, visible } from "./dom";
import type { GameAction } from "./provider";
import { findArenaNextButton } from "./chesscom-arena-dom";

/** Reads the clickable label with a layout-independent fallback. */
function label(button: HTMLElement): string {
  return (button.innerText || button.textContent || "").trim();
}

/** Finds regular new-match controls separately from arena matchmaking. */
function findNewButton(): HTMLElement | null {
  const legacy = visible('[data-cy="game-over-modal-new-game-button"]');
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

/** Lets arena continuation use its own retry policy before regular new games and rematches. */
export function findGameAction(settings: Settings): GameAction | null {
  const arena = findArenaNextButton();
  if (arena && settings.autoNewMatch) return { button: arena, name: "Next Arena Game", kind: "arena" };
  const next = findNewButton();
  if (settings.autoNewMatch && next) return { button: next, name: "New Game", kind: "round" };
  if (!settings.autoRematch) return null;
  const rematch = findRematchButton();
  if (rematch) return { button: rematch, name: "Rematch", kind: "round" };
  return null;
}
