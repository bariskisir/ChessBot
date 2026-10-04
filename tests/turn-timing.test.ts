/** Checks increment-aware allocation, elapsed-turn accounting, and clock corrections. */
import assert from "node:assert/strict";
import test from "node:test";
import { calculateDynamicTurnBudget, type TurnClock } from "../src/timing/dynamic-turn-budget";
import { Chess } from "chess.js";
import { isFirstGameMove, TurnTiming } from "../src/timing/turn-timing";

const opening: TurnClock = { remainingMs: 180000, initialMs: 180000, incrementMs: 2000, completedMoves: 0, materialPhase: 1, quietHalfMoves: 0, lagMs: 0, running: true };

/** Uses a fifty-move opening forecast for every base time and increment. */
function incrementAllocation(): void {
  for (const [initialMs, incrementMs] of [[60000, 0], [120000, 1000], [180000, 0], [180000, 2000], [300000, 3000], [600000, 5000], [1800000, 20000]]) {
    const budget = calculateDynamicTurnBudget({ ...opening, initialMs: initialMs!, remainingMs: initialMs!, incrementMs: incrementMs! });
    assert.equal(budget.remainingMoves, 50);
    assert.equal(budget.totalMs, Math.floor((initialMs! - budget.reserveMs + incrementMs! * 49) / 50));
  }
}
test("opening allocation includes future increments across different time controls", incrementAllocation);

/** Retains a rolling forecast and positive clock through games longer than fifty moves. */
function longGames(): void {
  for (const incrementMs of [0, 1000, 2000, 3000, 20000]) {
    let remainingMs = opening.initialMs;
    for (let completedMoves = 0; completedMoves < 80; completedMoves++) {
      const budget = calculateDynamicTurnBudget({ ...opening, remainingMs, incrementMs, completedMoves, quietHalfMoves: 60 });
      assert.ok(budget.remainingMoves >= 8);
      remainingMs -= Math.max(budget.totalMs, 100) + 150;
      assert.ok(remainingMs > 0);
      remainingMs += incrementMs;
    }
  }
  const endgame = calculateDynamicTurnBudget({ ...opening, completedMoves: 45, materialPhase: 0 });
  const quiet = calculateDynamicTurnBudget({ ...opening, completedMoves: 45, quietHalfMoves: 64 });
  assert.ok(quiet.remainingMoves > endgame.remainingMoves);
  assert.ok(quiet.totalMs < endgame.totalMs);
  assert.equal(calculateDynamicTurnBudget({ ...opening, remainingMs: 2000 }).totalMs, 0);
  assert.ok(calculateDynamicTurnBudget({ ...opening, remainingMs: 5000, incrementMs: 60000 }).totalMs <= (5000 - 250) / 4);
}
test("long games retain time and never spend the current move's unearned increment", longGames);

/** Drives waiting without real timers while preserving a live ticking clock. */
function fixture(dynamicDelay = true) {
  let now = 0, clockMs = opening.remainingMs, updatedAt = 0, randomCalls = 0;
  const waits: number[] = [];
  const timing = new TurnTiming({ dynamicDelay, autoPlayDelay: 4000 },
    /** Returns authoritative time minus the elapsed live tick. */
    () => ({ ...opening, remainingMs: Math.max(0, clockMs - (now - updatedAt)) }), 0,
    /** Shares the same clock between timing and the fake wait. */
    () => now,
    /** Records exactly the additional time spent after analysis. */
    async (milliseconds, signal) => { signal.throwIfAborted(); waits.push(milliseconds); now += milliseconds; },
    /** Makes the manual target three seconds and counts accidental dynamic randomness. */
    () => { randomCalls++; return 0.75; });
  return { timing, waits,
    /** Accounts for work before entering intentional waiting. */
    elapse: (milliseconds: number) => { now += milliseconds; },
    /** Applies a corrected live clock without restarting the turn. */
    correct: (remainingMs: number) => { clockMs = remainingMs; updatedAt = now; },
    /** Exposes the complete turn duration for assertions. */
    elapsed: () => now,
    /** Exposes whether dynamic timing consulted manual randomness. */
    randomCalls: () => randomCalls,
  };
}

/** Deducts elapsed work from the fifty-move dynamic forecast and manual targets. */
async function elapsedAccounting(): Promise<void> {
  const dynamic = fixture();
  assert.equal(dynamic.timing.remainingAnalysisMs(), 5452);
  dynamic.elapse(2000);
  assert.equal(dynamic.timing.remainingAnalysisMs(), 3452);
  await dynamic.timing.wait(new AbortController().signal,
    /** Countdown reporting does not advance the clock itself. */
    () => undefined);
  assert.equal(dynamic.elapsed(), 5452);
  assert.equal(dynamic.waits.reduce(
    /** Totals only the extra wait after analysis. */
    (sum, ms) => sum + ms, 0), 3452);
  assert.equal(dynamic.randomCalls(), 0);
  const manual = fixture(false);
  manual.elapse(2000);
  assert.equal(manual.timing.remainingDelayMs(), 1000);
  manual.elapse(1500);
  assert.equal(manual.timing.remainingDelayMs(), 0);
  assert.equal(manual.randomCalls(), 1);
  dynamic.correct(2000);
  assert.equal(dynamic.timing.remainingDelayMs(), 0);
  const untimed = new TurnTiming({ dynamicDelay: true, autoPlayDelay: 10000 },
    /** Untimed pages supply no invented allocation. */
    () => null);
  assert.equal(untimed.remainingDelayMs(), 0);
  assert.equal(untimed.remainingAnalysisMs(), null);
}
test("turn targets include elapsed work and dynamic mode ignores manual delay", elapsedAccounting);

/** Covers both opening colors and later positions whose omitted history gives a move-one counter. */
function openingTurns(): void {
  const game = new Chess();
  assert.equal(isFirstGameMove(game.fen()), true);
  for (const move of game.moves()) {
    game.move(move);
    assert.equal(isFirstGameMove(game.fen()), true);
    game.undo();
  }
  game.move("e4");
  game.move("e5");
  assert.equal(isFirstGameMove(game.fen()), false);
  assert.equal(isFirstGameMove(game.fen().replace(/ 2$/, " 1")), false);
  assert.equal(isFirstGameMove("7k/5Q2/6K1/8/8/8/8/8 w - - 0 1"), false);
}
test("only actual White and Black opening turns bypass move delay", openingTurns);
