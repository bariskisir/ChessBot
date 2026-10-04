/** Keeps time-trouble move selection active until a different match is observed. */
import type { GameClock } from "../providers/clock";
import type { Settings } from "../shared";
import { isFirstGameMove } from "./turn-timing";

/** Preserves the user's Average Move preference while overriding it for one low-clock match. */
export class MatchSelection {
  averageDisabled = false;
  private gameKey = "";
  private fen = "";
  private remainingMs: number | null = null;

  /** Recognizes navigation or a fresh opening clock without mistaking increments for a new match. */
  observe(gameKey: string, fen: string, clock: GameClock | null): boolean {
    if (!fen) return false;
    const before = this.averageDisabled;
    const freshOpening = this.fen && fen !== this.fen && isFirstGameMove(fen) &&
      (!isFirstGameMove(this.fen) || fen.split(" ")[1] === "w");
    const restoredClock = !clock || (clock.remainingMs >= clock.initialMs * 0.9 && clock.remainingMs > (this.remainingMs ?? 0));
    if (gameKey !== this.gameKey || (freshOpening && restoredClock)) this.averageDisabled = false;
    if (clock && clock.remainingMs < 5000) this.averageDisabled = true;
    this.gameKey = gameKey;
    this.fen = fen;
    this.remainingMs = clock?.remainingMs ?? null;
    return before !== this.averageDisabled;
  }

  /** Uses a single best-move candidate without persisting a change to the user's checkbox. */
  settings(preferences: Settings): Settings { return this.averageDisabled ? { ...preferences, averageMove: false } : preferences; }

  /** Starts a confirmed follow-up game with the user's normal selection preference. */
  reset(): void { this.averageDisabled = false; this.gameKey = ""; this.fen = ""; this.remainingMs = null; }
}
