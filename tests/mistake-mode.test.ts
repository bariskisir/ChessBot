/** Verifies keep-floor mistake selection and cancelable automation delays. */
import assert from "node:assert/strict";
import test from "node:test";
import { chooseMistake, playerScore } from "../src/mistake-mode";
import { delay } from "../src/engine-client";

/** Rejects anything below the keep floor and takes the weakest qualifier. */
function safeMistakes(): void {
  assert.equal(chooseMistake(null, "e2e4", 1.9, 2), null);
  assert.equal(chooseMistake(null, "e2e4", -0.1, 0), null);
  assert.equal(chooseMistake(null, "a2a3", 2, 2)?.type, "mistake");
  assert.equal(chooseMistake(null, "a2a3", 0, 0)?.type, "mistake");
  const keeping = chooseMistake(null, "e2e4", 4, 2);
  const weaker = chooseMistake(keeping, "d2d4", 2.5, 2);
  assert.equal(weaker?.move, "d2d4");
  assert.equal(weaker?.type, "mistake");
  assert.equal(chooseMistake(weaker, "g1f3", 3, 2), weaker);
}
test("mistake mode keeps every blunder above the keep-eval floor", safeMistakes);

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
