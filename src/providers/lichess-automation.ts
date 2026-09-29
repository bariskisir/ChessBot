/** Selects Lichess follow-up and failed-training controls without coupling them to board reading. */
import type { Settings } from "../shared";
import { visible } from "./dom";
import { lichessBoard, roundEnded } from "./lichess-dom";
import type { GameAction } from "./provider";

/** Selects failure recovery or new-opponent precedence from the active page mode. */
export function findGameAction(settings: Settings): GameAction | null {
  const context = lichessBoard();
  if (!context) return null;
  if (context.mode === "training") {
    if (!settings.autoPlay) return null;
    const failed = visible(".puzzle__feedback.fail .view_solution.show button:last-child", context.root);
    if (failed) return { button: failed, name: "View Solution", kind: "puzzle" };
    const next = visible(".puzzle__feedback.after button.continue", context.root);
    return next ? { button: next, name: "Continue Training", kind: "puzzle" } : null;
  }
  if (context.mode !== "round" || !roundEnded()) return null;
  const next = settings.autoNewMatch ? visible(".rcontrols .follow-up button.new-opponent", context.root) : null;
  if (next) return { button: next, name: "New Game", kind: "round", resumeOnNavigation: true };
  const rematch = settings.autoRematch ? visible(".rcontrols .follow-up button.rematch", context.root) : null;
  return rematch ? { button: rematch, name: "Rematch", kind: "round", resumeOnNavigation: true } : null;
}
