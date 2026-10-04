/** Bounds the complete selection policy while retaining a legal move for time trouble. */
import { Chess } from "chess.js";
import type { MoveChoice } from "../move-analysis";
import type { SearchDeadline } from "../shared";

/** Lets queued or deep searches finish only within the current turn's live budget. */
export class MoveSelectionBudget {
  private fallback: MoveChoice;
  /** Keeps a legal emergency move even when the engine queue outlasts the clock budget. */
  constructor(private readonly fen: string, private readonly remainingMs: () => number | null) {
    const legal = new Chess(fen).moves({ verbose: true });
    const move = legal.find(
      /** Preserves immediate mate before considering other emergency moves. */
      (candidate) => candidate.san.endsWith("#")) ?? legal[0];
    if (!move) throw new Error("There is no legal move in this position.");
    this.fallback = { move: `${move.from}${move.to}${move.promotion ?? ""}`, mistake: false, evaluation: undefined };
  }

  /** Allows only verified legal choices to replace the emergency fallback. */
  remember(choice: MoveChoice): void {
    try {
      new Chess(this.fen).move({ from: choice.move.slice(0, 2), to: choice.move.slice(2, 4), promotion: choice.move[4] ?? "q" });
      this.fallback = choice;
    } catch { /* Stale or partial output cannot replace a legal move. */ }
  }

  /** Leaves time for bestmove delivery before the application-level cutoff. */
  getSearchDeadline: SearchDeadline = () => {
    const remainingMs = this.remainingMs();
    return remainingMs === null ? null : Date.now() + Math.max(1, remainingMs - 100);
  };

  /** Cancels only this document's selection when its clock budget expires or STOP is pressed. */
  async run(signal: AbortSignal, select: (scope: AbortSignal) => Promise<MoveChoice | null>): Promise<MoveChoice | null> {
    signal.throwIfAborted();
    if ((this.remainingMs() ?? Infinity) <= 0) return this.fallback;
    const controller = new AbortController();
    const scope = AbortSignal.any([signal, controller.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expire!: (choice: MoveChoice) => void, rejectCancellation!: (reason: unknown) => void;
    const deadline = new Promise<MoveChoice>(
      /** Separates budget exhaustion from explicit user cancellation. */
      (resolve, reject) => { expire = resolve; rejectCancellation = reject; });
    /** Rejects the whole operation instead of playing its fallback after STOP. */
    const cancelled = (): void => rejectCancellation(signal.reason);
    signal.addEventListener("abort", cancelled, { once: true });
    /** Rechecks corrections while the operation is queued or calculating alternatives. */
    const check = (): void => {
      const remainingMs = this.remainingMs();
      if (remainingMs !== null && remainingMs <= 0) {
        expire(this.fallback);
        controller.abort(new DOMException("The turn analysis budget was exhausted.", "TimeoutError"));
        return;
      }
      timer = setTimeout(check, remainingMs === null ? 50 : Math.max(1, Math.min(50, remainingMs)));
    };
    try {
      check();
      const choice = await Promise.race([select(scope), deadline]);
      signal.throwIfAborted();
      return choice;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancelled);
    }
  }
}
