/** Delegates game-over actions to the active website provider. */
import { currentProvider } from "./providers";
import type { Settings } from "./shared";
import type { GameAction } from "./providers/provider";
export type { GameAction } from "./providers/provider";

/** Finds a visible and enabled game-over action for the current site. */
export function findGameAction(settings: Settings): GameAction | null { return currentProvider()?.findGameAction(settings) ?? null; }
