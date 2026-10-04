/** Includes position settling, queued analysis, and move selection in one cancelable turn target. */
import { delay } from "../engine-client";
import type { Settings } from "../shared";
import { calculateDynamicTurnBudget, transmissionReserveMs, type TurnClock } from "./dynamic-turn-budget";

/** Rechecks the current clock throughout analysis and intentional waiting. */
export class TurnTiming {
  private readonly randomTargetMs: number;
  /** Keeps the observed turn start when settings restart a calculation on the same position. */
  constructor(
    private readonly settings: Pick<Settings, "dynamicDelay" | "autoPlayDelay">,
    private readonly getClock: () => TurnClock | null,
    private readonly startedAt = Date.now(),
    private readonly now: () => number = Date.now,
    private readonly waitFor: typeof delay = delay,
    random: () => number = Math.random,
  ) { this.randomTargetMs = settings.dynamicDelay ? 0 : Math.floor(random() * (settings.autoPlayDelay + 1)); }

  /** Measures the whole turn rather than starting another delay after analysis. */
  get elapsedMs(): number { return Math.max(0, this.now() - this.startedAt); }

  /** Reconstructs the turn's starting clock while honoring server corrections. */
  private budget(clock: TurnClock) {
    return calculateDynamicTurnBudget({ ...clock, remainingMs: clock.remainingMs + (clock.running ? this.elapsedMs : 0) });
  }

  /** Bounds the complete selection pipeline, including every queued verification search. */
  remainingAnalysisMs = (): number | null => {
    const clock = this.getClock();
    if (!clock) return null;
    const safeRemainingMs = Math.max(0, clock.remainingMs - transmissionReserveMs(clock.lagMs));
    if (!this.settings.dynamicDelay) return clock.running ? safeRemainingMs : null;
    return Math.max(0, Math.min(this.budget(clock).analysisMs - this.elapsedMs, safeRemainingMs));
  };

  /** Drops artificial waiting immediately when the live clock enters time trouble. */
  remainingDelayMs = (): number => {
    const clock = this.getClock();
    if (!clock) return this.settings.dynamicDelay ? 0 : Math.max(0, this.randomTargetMs - this.elapsedMs);
    const budget = this.budget(clock);
    if (clock.remainingMs <= budget.reserveMs * 2) return 0;
    const targetMs = this.settings.dynamicDelay ? budget.totalMs : this.randomTargetMs;
    return Math.max(0, Math.min(targetMs - this.elapsedMs, clock.remainingMs - transmissionReserveMs(clock.lagMs)));
  };

  /** Waits outside the engine, updating the countdown without occupying its worker. */
  async wait(signal: AbortSignal, report: (remainingMs: number) => void): Promise<void> {
    for (;;) {
      signal.throwIfAborted();
      const remainingMs = this.remainingDelayMs();
      if (remainingMs <= 0) return;
      report(remainingMs);
      await this.waitFor(Math.min(100, remainingMs), signal);
    }
  }
}
