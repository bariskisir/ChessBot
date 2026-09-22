/** Verifies safe-mistake selection and cancelable automation delays. */
import assert from "node:assert/strict";
import test from "node:test";
import { chooseMistake, playerScore } from "../src/mistake-mode";
import { delay } from "../src/engine-client";

/** Preserves the 1-pawn floor and chooses the weakest remaining winning move. */
function safeMistakes(): void {
  assert.equal(chooseMistake(null, "e2e4", -0.1), null);
  assert.equal(chooseMistake(null, "e2e4", 0), null);
  assert.equal(chooseMistake(null, "e2e4", 0.9), null);
  const winning = chooseMistake(null, "e2e4", 4);
  const weaker = chooseMistake(winning, "d2d4", 2);
  assert.equal(weaker?.move, "d2d4");
  assert.equal(weaker?.type, "suboptimal");
  const ideal = chooseMistake(weaker, "g1f3", 1.5);
  assert.equal(ideal?.type, "ideal");
  assert.equal(chooseMistake(ideal, "b1c3", 3), ideal);
  assert.equal(chooseMistake(null, "a2a3", 1)?.type, "ideal");
}
test("mistake mode keeps the 1-pawn floor and the 1-to-1.5 window", safeMistakes);

/** Uses the player's color when deciding whether a position is winning. */
function scores(): void {
  const variation = { depth: 12, score: -3, mate: null, nodes: 100, moves: ["e7e5"] };
  assert.equal(playerScore(variation, "b"), 3);
  assert.equal(playerScore(variation, "w"), -3);
  assert.equal(playerScore({ ...variation, mate: -2 }, "b"), 100);
}
test("mistake mode evaluates safety from either player's side", scores);

/** Ensures STOP immediately cancels pending delays rather than executing them later. */
async function cancellation(): Promise<void> {
  const controller = new AbortController();
  const waiting = delay(10000, controller.signal);
  controller.abort();
  await assert.rejects(waiting);
  await assert.rejects(delay(10, controller.signal));
}
test("automatic action delays abort immediately", cancellation);
