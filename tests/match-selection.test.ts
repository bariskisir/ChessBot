/** Verifies that low-clock best selection lasts for the match and preserves saved preferences. */
import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { DEFAULT_SETTINGS } from "../src/shared";
import { MatchSelection } from "../src/timing/match-selection";
const opening = new Chess().fen();

/** Applies the strict five-second boundary and retains the override after increments and corrections. */
function lowClockLatch(): void {
  const policy = new MatchSelection(), clock = { initialMs: 180000, incrementMs: 10000, remainingMs: 5000, running: false };
  policy.observe("game:w", opening, clock);
  assert.equal(policy.averageDisabled, false);
  policy.observe("game:w", opening, { ...clock, remainingMs: 4999 });
  assert.equal(policy.settings(DEFAULT_SETTINGS).averageMove, false);
  const game = new Chess();
  game.move("e4");
  policy.observe("game:w", game.fen(), { ...clock, remainingMs: 12000 });
  assert.equal(policy.averageDisabled, true);
  policy.observe("game:w", game.fen(), null);
  assert.equal(policy.averageDisabled, true);
  assert.equal(DEFAULT_SETTINGS.averageMove, true);
}
test("below five seconds disables averaging for the whole game despite increments", lowClockLatch);

/** Restores the preferred selector for navigation, rematches, and both player colors. */
function nextMatchRestoresAverage(): void {
  for (const player of ["w", "b"] as const) {
    const policy = new MatchSelection(), game = new Chess();
    game.move("e4"); game.move("e5");
    policy.observe(`game:${player}`, game.fen(), { initialMs: 180000, incrementMs: 2000, remainingMs: 2000, running: true });
    const next = new Chess();
    if (player === "b") next.move("d4");
    policy.observe(`game:${player}`, next.fen(), { initialMs: 180000, incrementMs: 2000, remainingMs: 180000, running: true });
    assert.equal(policy.settings(DEFAULT_SETTINGS).averageMove, true);
    policy.observe(`game:${player}`, next.fen(), { initialMs: 180000, incrementMs: 2000, remainingMs: 1000, running: true });
    policy.observe(`next-game:${player}`, next.fen(), { initialMs: 180000, incrementMs: 2000, remainingMs: 180000, running: true });
    assert.equal(policy.averageDisabled, false);
  }
}
test("a new same-page match or game route restores average selection for either color", nextMatchRestoresAverage);
