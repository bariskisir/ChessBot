/** Locks the average-quality move picker to non-losing, middle-scored variations. */
import assert from "node:assert/strict";
import test from "node:test";
import { chooseAverageMove, rankAverageMoves } from "../src/move-selection";
import type { Variation } from "../src/shared";

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
test("average move selection respects the player's color", blackAverage);
test("average candidates rank from closest-to-average to farthest", rankedAverage);
