/** Verifies keep-floor mistake selection and cancelable automation delays. */
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { Chess } from "chess.js";
import { chooseMistake, playerScore } from "../src/mistake-mode";
import { delay } from "../src/engine-client";
import { ENGINES } from "../src/engines";
import { DEFAULT_SETTINGS, type Analysis, type EngineRequest, type Variation } from "../src/shared";

const bundle = buildSync({ entryPoints: ["src/mistake-mode.ts"], bundle: true, write: false, format: "iife", globalName: "MistakeModeTest", platform: "browser" }).outputFiles[0]!.text;

/** Exercises post-move searches through the production engine transport in isolation. */
function harness(respond: (request: EngineRequest) => Analysis) {
  const requests: EngineRequest[] = [];
  const context = { chrome: { runtime: {
    /** Returns controlled engine scores without sharing globals between tests. */
    sendMessage: async (request: EngineRequest) => { requests.push(request); return { result: respond(request) }; },
  } } };
  runInNewContext(bundle, context);
  const exports = (context as typeof context & { MistakeModeTest: typeof import("../src/mistake-mode") }).MistakeModeTest;
  return { findMistake: exports.findMistake, requests };
}

/** Builds completed or interrupted engine results using White-relative scores. */
function analysis(request: EngineRequest, score: number, moves: string[], depth = request.settings.depth, mate: number | null = null): Analysis {
  return { fen: request.fen, bestMove: moves[0] ?? "(none)", variations: moves.map(
    /** Gives each candidate a legal leading move and the requested score. */
    (move): Variation => ({ depth, score, mate, moves: [move], nodes: 100 })) };
}

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
  for (const score of [NaN, Infinity, -Infinity]) assert.equal(chooseMistake(null, "e2e4", score, 2), null);
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

/** Requires Stockfish 19 to check mistakes proposed by every engine for both colors. */
async function postMoveKeepFloor(): Promise<void> {
  for (const engine of ENGINES) for (const color of ["w", "b"] as const) for (const depth of [7, 18]) {
    const game = new Chess();
    if (color === "b") game.move("e4");
    const fen = game.fen(), sign = color === "w" ? 1 : -1;
    const bestMove = color === "w" ? "e2e4" : "e7e5";
    const unsafeMove = color === "w" ? "d2d4" : "d7d5";
    const safeMove = color === "w" ? "g1f3" : "g8f6";
    const safePosition = new Chess(fen);
    safePosition.move({ from: safeMove.slice(0, 2), to: safeMove.slice(2, 4) });
    const h = harness(
      /** Makes one apparent +2 mistake fall below the floor when Stockfish 19 verifies it. */
      (request) => {
        if (request.fen === fen) return analysis(request, sign * 4, [bestMove, unsafeMove, safeMove]);
        const score = request.fen === safePosition.fen() ? 2 : request.settings.engine !== "stockfish-19" || request.settings.depth < Math.max(15, depth) ? 2 : 1.5;
        return analysis(request, sign * score, [color === "w" ? "e7e5" : "d2d4"]);
      });
    const deadline = Date.now() + 10000;
    const result = await h.findMistake(fen, color, { ...DEFAULT_SETTINGS, engine: engine.id, depth, mistakeKeep: 2 }, new AbortController().signal, bestMove, 4,
      /** Shares the main turn's deadline with every candidate search. */
      () => deadline);
    assert.equal(result?.move, safeMove, `${engine.name}, ${color}, depth ${depth}`);
    assert.equal(result.score, 2);
    assert.equal(h.requests.length, 3);
    assert.equal(h.requests[0]?.settings.engine, engine.id);
    for (const request of h.requests) assert.equal(request.deadline, deadline);
    for (const request of h.requests.slice(1)) {
      assert.notEqual(request.fen, fen);
      assert.equal(request.settings.engine, "stockfish-19");
      assert.equal(request.settings.depth, Math.max(15, depth));
      assert.equal(request.settings.lines, 1);
    }
  }
}
test("mistakes preserve +2 after the move for all engines and both colors", postMoveKeepFloor);

/** Withholds a mistake when its verified score is below the floor or its search is incomplete. */
async function unsafeOrIncompleteSearch(): Promise<void> {
  const fen = new Chess().fen();
  for (const engine of ENGINES) for (const incomplete of [true, false]) {
    const h = harness(
      /** Offers a candidate whose optimistic partial score cannot establish the keep floor. */
      (request) => request.fen === fen ? analysis(request, 4, ["e2e4", "d2d4"])
        : { ...analysis(request, incomplete ? 2.5 : 1.99, ["e7e5"], incomplete ? 3 : request.settings.depth), timeLimited: incomplete });
    const result = await h.findMistake(fen, "w", { ...DEFAULT_SETTINGS, engine: engine.id, depth: 7, mistakeKeep: 2 }, new AbortController().signal, "e2e4", 4);
    assert.equal(result, null, `${engine.name}, incomplete: ${incomplete}`);
  }
}
test("below-floor and incomplete post-move searches cannot authorize a mistake", unsafeOrIncompleteSearch);

/** Treats terminal draws as zero even if an engine would report a material advantage. */
async function drawnMistake(): Promise<void> {
  const fen = "7k/5K2/6Q1/8/8/8/8/8 w - - 0 1";
  for (const keep of [0, 2]) {
    const h = harness(
      /** Reports a misleading positive score if a terminal draw is searched. */
      (request) => analysis(request, request.fen === fen ? 4 : 3, request.fen === fen ? ["g6h6", "g6f5"] : ["h8h7"]));
    const result = await h.findMistake(fen, "w", { ...DEFAULT_SETTINGS, mistakeKeep: keep }, new AbortController().signal, "g6h6", 4);
    assert.equal(result?.move ?? null, keep === 0 ? "g6f5" : null);
    if (result) assert.equal(result.score, 0);
    assert.equal(h.requests.length, 1);
  }
}
test("a mistake ending in a draw only qualifies with a zero keep floor", drawnMistake);

/** Ensures STOP immediately cancels pending delays rather than executing them later. */
async function cancellation(): Promise<void> {
  const controller = new AbortController();
  const waiting = delay(10000, controller.signal);
  controller.abort();
  await assert.rejects(waiting);
  await assert.rejects(delay(10, controller.signal));
}
test("automatic action delays abort immediately", cancellation);
