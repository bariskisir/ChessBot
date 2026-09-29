/** Verifies forced-mate priority and non-losing average-quality move selection. */
import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { chooseAverageMove, chooseMatingMove, chooseVerifiedAverageMove, rankAverageMoves } from "../src/move-selection";
import { DEFAULT_SETTINGS, type Variation } from "../src/shared";

/** Builds a White-relative variation with one leading move. */
function variation(move: string, score: number, mate: number | null = null): Variation {
  return { depth: 12, score, mate, moves: [move], nodes: 1000 };
}

/** Picks the safe candidate closest to the group average for White. */
function whiteAverage(): void {
  const variations = [variation("e2e4", 1), variation("d2d4", 0.5), variation("g1f3", 0), variation("a2a3", -2)];
  assert.equal(chooseAverageMove(variations, "w"), "d2d4");
  assert.equal(chooseAverageMove([variation("e2e4", 1), variation("a2a3", -0.5)], "w"), "e2e4");
  assert.equal(chooseAverageMove([variation("a2a3", -0.2)], "w"), null);
  assert.equal(chooseAverageMove([], "w"), null);
}

/** Converts White-relative scores before averaging for Black. */
function blackAverage(): void {
  const variations = [variation("e7e5", -1), variation("c7c5", -0.4), variation("a7a6", -0.1), variation("b7b5", 0.5)];
  assert.equal(chooseAverageMove(variations, "b"), "c7c5");
}

/** Orders every non-losing candidate from closest-to-average to farthest. */
function rankedAverage(): void {
  const variations = [variation("e2e4", 3), variation("d2d4", 2.5), variation("c2c4", 1.2), variation("g1f3", 0.2), variation("a2a3", -2)];
  assert.deepEqual(rankAverageMoves(variations, "w"), ["c2c4", "d2d4", "e2e4", "g1f3"]);
  assert.deepEqual(rankAverageMoves([], "w"), []);
}
test("average move selection keeps White's non-losing candidates", whiteAverage);
test("average move selection respects the player's color", blackAverage);
test("average candidates rank from closest-to-average to farthest", rankedAverage);

/** Keeps a mate-in-three even when centipawn alternatives sit closer to the average. */
function whiteMate(): void {
  const mating = variation("e2e4", 0, 3), first = variation("d2d4", 4), second = variation("g1f3", 2);
  const variations = [mating, first, second];
  assert.equal(chooseAverageMove(variations, "w"), "e2e4");
  assert.deepEqual(rankAverageMoves(variations, "w"), ["e2e4"]);
  assert.equal(chooseAverageMove([first, mating, second], "w"), "e2e4");
}
test("average selection follows a winning mate from any variation", whiteMate);

/** Recognizes negative White-relative mate scores as wins for Black. */
function blackMate(): void {
  const variations = [variation("e7e5", -4), variation("c7c5", 0, -3), variation("g8f6", 0, -5)];
  assert.equal(chooseAverageMove(variations, "b"), "c7c5");
  assert.deepEqual(rankAverageMoves(variations, "b"), ["c7c5"]);
}
test("average selection follows Black's shortest winning mate", blackMate);

/** Finishes sooner when mates differ and retains engine order when they tie. */
function shortestMate(): void {
  const variations = [variation("e2e4", 0, 5), variation("d2d4", 0, 3), variation("g1f3", 0, 3)];
  assert.equal(chooseAverageMove(variations, "w"), "d2d4");
  assert.equal(chooseAverageMove([...variations, variation("c2c4", 0, 1)], "w"), "c2c4");
}
test("winning mates prefer the shortest distance and stable ties", shortestMate);

/** Does not confuse losing, terminal, or empty mate lines with a playable win. */
function ignoredMates(): void {
  const safe = [variation("e2e4", 3), variation("d2d4", 2), variation("g1f3", 1)];
  const empty = { ...variation("a2a3", 0, 1), moves: [] };
  assert.equal(chooseMatingMove([variation("a2a3", 0, -1), variation("b2b3", 0, 0), empty], "w"), null);
  assert.equal(chooseMatingMove([variation("a7a6", 0, 1)], "b"), null);
  assert.equal(chooseAverageMove([...safe, variation("a2a3", 0, -1), empty], "w"), "d2d4");
  assert.equal(chooseMatingMove([], "w"), null);
}
test("opponent mates and missing moves do not trigger mate priority", ignoredMates);

/** Avoids replacing a known mate through extra searches while retaining STOP cancellation. */
async function verifiedMate(): Promise<void> {
  const controller = new AbortController();
  const variations = [variation("e2e4", 4), variation("d2d4", 0, 3), variation("g1f3", 2)];
  assert.equal(await chooseVerifiedAverageMove(new Chess().fen(), variations, "w", DEFAULT_SETTINGS, controller.signal), "d2d4");
  controller.abort();
  await assert.rejects(chooseVerifiedAverageMove(new Chess().fen(), variations, "w", DEFAULT_SETTINGS, controller.signal));
}
test("verified average selection preserves mates and respects cancellation", verifiedMate);
