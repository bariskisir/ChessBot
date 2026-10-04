/** Distinguishes arena matchmaking controls from buttons that cancel the queue. */
import { isShown, visible } from "./dom";

/** Reads labels consistently across real site markup and controlled fixtures. */
function label(button: HTMLElement): string { return (button.innerText || button.textContent || button.getAttribute("aria-label") || "").trim(); }

/** Checks indicator visibility without excluding disabled search buttons. */
function displayed(element: HTMLElement): boolean { return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden"; }

/** Locates only the arena action, excluding Finding Next Game and Cancel. */
export function findArenaNextButton(): HTMLElement | null {
  const button = visible('[data-cy="next-arena-game-button"], .game-over-arena-button-component button.game-over-arena-button-button:not(.game-over-arena-button-finding)');
  if (button && !/finding|cancel/i.test(label(button))) return button;
  for (const candidate of document.querySelectorAll<HTMLButtonElement>("button")) {
    if (isShown(candidate) && /^next arena game$/i.test(label(candidate))) return candidate;
  }
  return null;
}

/** Treats both result and lobby waiting states as successful matchmaking. */
export function arenaSearching(): boolean {
  for (const indicator of document.querySelectorAll<HTMLElement>(".game-over-arena-button-finding, .arena-footer-component button")) {
    if (displayed(indicator) && (indicator.classList.contains("game-over-arena-button-finding") || /^cancel$/i.test(label(indicator)))) return true;
  }
  return false;
}

/** Restricts Join and Next Game to the chosen arena's native footer. */
export function findArenaLobbyButton(name: "Join" | "Next Game"): HTMLElement | null {
  for (const button of document.querySelectorAll<HTMLElement>(".arena-footer-component button")) {
    if (isShown(button) && label(button).toLowerCase() === name.toLowerCase()) return button;
  }
  return null;
}

/** Prevents old result positions and lobby previews from being mistaken for a new game. */
export function arenaResultShown(): boolean {
  for (const element of document.querySelectorAll<HTMLElement>(".game-over-arena-button-component, .game-over-modal-component, .board-modal-component")) {
    if (displayed(element)) return true;
  }
  return false;
}
