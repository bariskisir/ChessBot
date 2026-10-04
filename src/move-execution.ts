/** Confirms board changes independently of input acknowledgements and bounds move retries. */
import { boardBusy, canPlay, isCurrentPosition, playMove, readPosition, samePosition } from "./board";
import { delay, stopAnalysis } from "./engine-client";
import { analyzeMove, type MoveChoice, type ReportProgress } from "./move-analysis";
import type { PlayerPosition } from "./providers/position";
import type { Settings } from "./shared";
import type { MoveSelectionBudget } from "./timing/move-selection-budget";

const retryLimit = 3, retryDelay = 1000, inputTimeout = 3000, confirmationTimeout = 700;
export interface MoveOutcome { accepted: boolean; choice: MoveChoice }

/** Cancels the provider gesture on STOP or expiry, including lost background replies. */
async function attemptMove(fen: string, move: string, settings: Settings, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  const attempt = new AbortController();
  /** Propagates cancellation synchronously instead of waiting for another board check. */
  const abort = (): void => attempt.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  let rejected = false, deadline = Date.now() + inputTimeout;
  void playMove(fen, move, attempt.signal, settings.animateMoves).then(
    /** Uses a shorter confirmation deadline after the input path completes. */
    (accepted) => {
      if (attempt.signal.aborted) return;
      rejected = !accepted;
      deadline = Math.min(deadline, Date.now() + confirmationTimeout);
    },
    /** Makes a failed transport eligible for the same bounded retry policy. */
    () => { if (!attempt.signal.aborted) rejected = true; });
  try {
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const current = readPosition();
      if (current && !boardBusy() && !samePosition(current, fen)) return true;
      if (rejected) return false;
      await delay(25, signal);
    }
    return false;
  } finally {
    signal.removeEventListener("abort", abort);
    attempt.abort();
  }
}

/** Recomputes retries using the live match policy within the same turn budget. */
export async function executeMove(position: PlayerPosition, initial: MoveChoice, settings: Settings, signal: AbortSignal, report: ReportProgress, budget?: MoveSelectionBudget, getSettings?: () => Settings, onInput?: (pending: boolean) => void): Promise<MoveOutcome> {
  let choice = initial;
  for (let attempt = 0; attempt <= retryLimit; attempt++) {
    signal.throwIfAborted();
    if (!isCurrentPosition(position) || !canPlay(position.fen)) return { accepted: false, choice };
    if (attempt > 0) {
      await stopAnalysis();
      await delay(retryDelay, signal);
      if (!isCurrentPosition(position) || !canPlay(position.fen)) return { accepted: false, choice };
      const retryStatus = `Reanalyzing position (retry ${attempt}/${retryLimit})...`;
      const retrySettings = getSettings?.() ?? settings;
      /** Uses the same selection deadline after a rejected or stalled input. */
      const select = (scope: AbortSignal) => analyzeMove(position, retrySettings, scope,
        /** Keeps the visible retry number through every stage of move selection. */
        (progress) => report({ ...progress, status: retryStatus }), budget);
      const candidate = budget ? await budget.run(signal, select) : await select(signal);
      if (!candidate || !canPlay(position.fen)) return { accepted: false, choice };
      choice = candidate;
    }
    const status = attempt ? `Playing move (retry ${attempt}/${retryLimit})...` : "Playing move...";
    report({ move: choice.move.toUpperCase(), status, color: "#3b82f6", ...(choice.evaluation ? { evaluation: choice.evaluation } : {}) });
    onInput?.(true);
    try { if (await attemptMove(position.fen, choice.move, settings, signal)) return { accepted: true, choice }; }
    finally { onInput?.(false); }
    if (attempt < retryLimit) report({ status: `Move not accepted - retrying (${attempt + 1}/${retryLimit})...`, color: "#f59e0b" });
  }
  return { accepted: false, choice };
}
