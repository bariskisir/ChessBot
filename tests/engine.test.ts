/** Verifies warm-worker reuse and cancellation boundaries without depending on engine speed. */
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { DEFAULT_SETTINGS, type EngineRequest, type EngineResponse } from "../src/shared";
import { ENGINES, getEngine, type EngineId } from "../src/engines";

const bundle = buildSync({ entryPoints: ["src/engine.ts"], bundle: true, write: false, format: "iife", platform: "browser" }).outputFiles[0]!.text;
const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Isolates each scheduler instance with manually driven worker messages and watchdogs. */
function harness() {
  const workers: FakeWorker[] = [];
  const timers = new Map<number, () => void>();
  let timer = 0;
  let listener: (request: EngineRequest, sender: object, respond: (response: EngineResponse) => void) => unknown;
  /** Captures commands while allowing deliberately late output after termination. */
  class FakeWorker {
    commands: string[] = [];
    terminated = false;
    onmessage?: (event: { data: string }) => void;
    onerror?: (event: { message: string }) => void;
    /** Exposes worker creation counts for reuse assertions. */
    constructor(readonly url: string) { workers.push(this); }
    /** Records UCI commands without synthesizing automatic replies. */
    postMessage(command: string): void { this.commands.push(command); }
    /** Retains callbacks to reproduce already-queued events from a dead worker. */
    terminate(): void { this.terminated = true; }
    /** Delivers one protocol line at a controlled point in the lifecycle. */
    emit(data: string): void { this.onmessage?.({ data }); }
  }
  runInNewContext(bundle, {
    Worker: FakeWorker,
    /** Keeps watchdog expiry deterministic. */
    setTimeout: (callback: () => void) => { timers.set(++timer, callback); return timer; },
    /** Removes completed or replaced watchdogs. */
    clearTimeout: (id: number) => timers.delete(id),
    chrome: { runtime: { onMessage: {
      /** Captures the production entry point for document requests. */
      addListener: (callback: typeof listener) => { listener = callback; },
    } } },
  });
  /** Sends one request and retains asynchronous responses for exact-count assertions. */
  function request(owner: string, action: "analyze" | "stop" = "analyze", lines = 10, deadline?: number, engine: EngineId = "stockfish-19") {
    const replies: EngineResponse[] = [];
    listener({ target: "engine", owner, action, fen, settings: { ...DEFAULT_SETTINGS, engine, lines }, ...(deadline === undefined ? {} : { deadline }) }, {},
      /** Collects responses without hiding duplicate completions. */
      (response) => replies.push(response));
    return replies;
  }
  /** Completes identity verification and the first readiness barrier. */
  function boot(): FakeWorker {
    const worker = workers[0]!;
    worker.emit("id name Stockfish 19");
    worker.emit("uciok");
    worker.emit("readyok");
    return worker;
  }
  return { workers, timers, request, boot };
}

/** Keeps a completed engine warm while clearing principal variations between searches. */
function warmReuse(): void {
  const h = harness();
  const first = h.request("a");
  const worker = h.boot();
  worker.emit("info depth 10 multipv 1 score cp 20 nodes 10 pv e2e4");
  worker.emit("bestmove e2e4");
  assert.equal(first.length, 1);
  assert.equal(worker.terminated, false);
  const second = h.request("b", "analyze", 1);
  assert.equal(h.workers.length, 1);
  assert.equal(worker.commands.at(-2), "setoption name MultiPV value 1");
  worker.emit("readyok");
  worker.emit("bestmove d2d4");
  assert.equal(second.length, 1);
  const result = second[0]!;
  assert.ok("result" in result);
  assert.equal(result.result.variations.length, 0);
  assert.equal(h.timers.size, 0);
}
test("completed searches reuse a worker without leaking variations", warmReuse);

/** Prevents old search output from completing a queued document after STOP. */
function drainCancellation(): void {
  const h = harness();
  const first = h.request("a");
  const worker = h.boot();
  const second = h.request("b");
  h.request("a", "stop");
  assert.equal(first.length, 1);
  assert.equal(worker.commands.at(-1), "stop");
  worker.emit("info depth 10 multipv 1 score cp 999 nodes 10 pv a2a3");
  worker.emit("readyok");
  assert.equal(second.length, 0);
  assert.equal(worker.commands.at(-1), "stop");
  worker.emit("bestmove a2a3");
  assert.equal(second.length, 0);
  worker.emit("readyok");
  worker.emit("bestmove e2e4");
  assert.equal(second.length, 1);
  const result = second[0]!;
  assert.ok("result" in result);
  assert.equal(result.result.bestMove, "e2e4");
  assert.equal(result.result.variations.length, 0);
  assert.equal(h.workers.length, 1);
}
test("canceled output drains before another owner starts", drainCancellation);

/** Handles STOP during initialization and option changes without starting a canceled job. */
function cancelBeforeSearch(): void {
  const h = harness();
  const first = h.request("a");
  h.request("a", "stop");
  const second = h.request("b", "analyze", 1);
  const worker = h.workers[0]!;
  worker.emit("id name Stockfish 19");
  worker.emit("uciok");
  assert.equal(worker.commands.at(-2), "setoption name MultiPV value 1");
  h.request("b", "stop");
  const third = h.request("c", "analyze", 3);
  worker.emit("readyok");
  assert.equal(worker.commands.at(-2), "setoption name MultiPV value 3");
  assert.equal(worker.commands.some(
    /** Detects an unintended search before the new readiness barrier. */
    (command) => command.startsWith("go ")), false);
  worker.emit("readyok");
  worker.emit("bestmove e2e4");
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(third.length, 1);
}
test("initialization and readiness cancellation preserve queued settings", cancelBeforeSearch);

/** Recovers a worker that ignores STOP and rejects callbacks from the terminated instance. */
function stuckWorker(): void {
  const h = harness();
  h.request("a");
  const old = h.boot();
  h.request("a", "stop");
  const next = h.request("b");
  const expire = [...h.timers.values()][0]!;
  expire();
  assert.equal(old.terminated, true);
  assert.equal(h.workers.length, 2);
  old.emit("bestmove a2a3");
  old.onerror?.({ message: "late failure" });
  assert.equal(next.length, 0);
  const current = h.workers[1]!;
  current.emit("id name Stockfish 19");
  current.emit("uciok");
  current.emit("readyok");
  current.emit("bestmove e2e4");
  assert.equal(next.length, 1);
}
test("stuck cancellation replaces the worker and ignores stale callbacks", stuckWorker);

/** Includes startup time in the UCI limit and releases the warm worker after a partial search. */
function boundedSearch(): void {
  const h = harness();
  const replies = h.request("a", "analyze", 1, Date.now() + 5000);
  const worker = h.boot();
  const command = worker.commands.at(-1)!;
  assert.match(command, /^go depth 7 movetime \d+$/);
  const duration = Number(command.split(" ").at(-1));
  assert.ok(duration > 0 && duration <= 5000);
  worker.emit("info depth 3 multipv 1 score cp 10 nodes 100 pv e2e4");
  worker.emit("bestmove e2e4");
  assert.ok(replies[0] && "result" in replies[0]);
  assert.equal(replies[0].result.timeLimited, true);
  assert.equal(replies[0].result.variations[0]?.depth, 3);
  const next = h.request("b", "analyze", 1);
  worker.emit("readyok");
  assert.equal(worker.commands.at(-1), "go depth 7");
  worker.emit("bestmove d2d4");
  assert.equal(next.length, 1);
  assert.equal(h.workers.length, 1);
}
test("deadline searches return partial analysis and make the worker available again", boundedSearch);

/** Prevents non-finite message data from becoming a malformed UCI search command. */
function invalidDeadline(): void {
  const h = harness();
  h.request("a", "analyze", 1, NaN);
  const worker = h.boot();
  assert.equal(worker.commands.at(-1), "go depth 7");
  worker.emit("bestmove e2e4");
}
test("invalid deadlines cannot reach the engine protocol", invalidDeadline);

for (const engine of ENGINES) {
  /** Verifies each catalogue entry boots its own worker and returns the selected engine's output. */
  test(`${engine.name} selects and verifies its bundled worker`, () => {
    const h = harness();
    const replies = h.request("a", "analyze", 3, undefined, engine.id);
    const worker = h.workers[0]!;
    assert.equal(worker.url, engine.worker);
    worker.emit(`id name ${engine.id === "lozza-2" ? "Lozza 2.0" : engine.id === "stockfish-10" ? "Stockfish.js 10 by T. Romstad" : engine.name.replace(" Lite", "")}`);
    worker.emit("uciok");
    assert.equal(worker.commands.at(-2), "setoption name MultiPV value 3");
    worker.emit("readyok");
    worker.emit("info depth 7 multipv 1 score cp 25 nodes 100 pv e2e4 e7e5");
    worker.emit("bestmove e2e4");
    assert.equal(replies.length, 1);
    assert.ok(replies[0] && "result" in replies[0]);
    assert.equal(replies[0].result.variations[0]?.depth, 7);
    assert.equal(replies[0].result.bestMove, "e2e4");
  });

  /** Rejects a different version even when it speaks a valid UCI protocol. */
  test(`${engine.name} rejects an unexpected engine identity`, () => {
    const h = harness();
    const replies = h.request("a", "analyze", 1, undefined, engine.id);
    const worker = h.workers[0]!;
    worker.emit("id name Stockfish 8");
    worker.emit("uciok");
    assert.ok(replies[0] && "error" in replies[0]);
    assert.match(replies[0].error, /bundled engine/);
    assert.equal(worker.terminated, true);
  });

  /** Checks each version's cancellation policy without completing the canceled response twice. */
  test(`${engine.name} cancels searches before releasing another owner's job`, () => {
    const h = harness();
    const first = h.request("a", "analyze", 1, undefined, engine.id);
    const old = h.workers[0]!;
    old.emit(`id name ${engine.id === "lozza-2" ? "Lozza 2.0" : engine.id === "stockfish-10" ? "Stockfish.js 10" : engine.name.replace(" Lite", "")}`);
    old.emit("uciok");
    old.emit("readyok");
    const next = h.request("b", "analyze", 1, undefined, engine.id);
    h.request("a", "stop");
    assert.equal(first.length, 1);
    if (engine.interruptible) {
      assert.equal(old.commands.at(-1), "stop");
      assert.equal(next.length, 0);
      old.emit("bestmove a2a3");
      old.emit("readyok");
      old.emit("bestmove e2e4");
    } else {
      assert.equal(old.terminated, true);
      const current = h.workers[1]!;
      old.emit("bestmove a2a3");
      current.emit(`id name ${engine.id === "lozza-2" ? "Lozza 2.0" : "Lozza 5"}`);
      current.emit("uciok");
      current.emit("readyok");
      current.emit("bestmove e2e4");
    }
    assert.equal(first.length, 1);
    assert.equal(next.length, 1);
  });
}

/** Tracks each sequential Lozza rank independently without treating repeated output as progress. */
function sequentialProgress(): void {
  const h = harness();
  h.request("a");
  const worker = h.boot();
  worker.emit("info depth 20 multipv 1 score cp 25 nodes 10000 pv e2e4");
  const firstTimer = [...h.timers.keys()][0];
  worker.emit("info depth 1 multipv 2 score cp 20 nodes 10 pv d2d4");
  const secondTimer = [...h.timers.keys()][0];
  assert.notEqual(secondTimer, firstTimer);
  worker.emit("info depth 1 multipv 2 score cp 20 nodes 10 pv d2d4");
  assert.equal([...h.timers.keys()][0], secondTimer);
  worker.emit("bestmove e2e4");
}
test("sequential MultiPV ranks refresh the watchdog only for new progress", sequentialProgress);

/** Switches queued tabs to their requested version and ignores callbacks from the replaced worker. */
function switchEngines(): void {
  const h = harness();
  const first = h.request("a");
  const old = h.boot();
  const next = h.request("b", "analyze", 2, undefined, "lozza-2");
  old.emit("bestmove e2e4");
  assert.equal(first.length, 1);
  assert.equal(old.terminated, false);
  const current = h.workers[1]!;
  assert.equal(current.url, getEngine("lozza-2").worker);
  old.emit("bestmove a2a3");
  old.onerror?.({ message: "late failure" });
  assert.equal(next.length, 0);
  current.emit("id name Lozza 2.0");
  current.emit("uciok");
  current.emit("readyok");
  current.emit("bestmove d2d4");
  assert.equal(next.length, 1);
}
test("queued owners switch engines without accepting stale output", switchEngines);

/** Reuses both evaluator and move workers while retaining at most one alternative engine. */
function alternatingEvaluation(): void {
  const h = harness();
  h.request("a");
  const evaluator = h.boot();
  evaluator.emit("bestmove e2e4");
  h.request("a", "analyze", 1, undefined, "lozza-2");
  const lozza = h.workers[1]!;
  lozza.emit("id name Lozza 2.0");
  lozza.emit("uciok");
  lozza.emit("readyok");
  lozza.emit("bestmove e2e4");
  for (let turn = 0; turn < 3; turn++) {
    const evaluation = h.request("a", "analyze", 1);
    assert.equal(evaluator.terminated, false);
    assert.equal(lozza.terminated, false);
    assert.equal(h.workers.length, 2);
    evaluator.emit("readyok");
    evaluator.emit("info depth 7 score cp 250 nodes 100 pv e2e4");
    evaluator.emit("bestmove e2e4");
    assert.equal(evaluation.length, 1);
    const moves = h.request("a", "analyze", 1, undefined, "lozza-2");
    lozza.emit("readyok");
    lozza.emit("bestmove e2e4");
    assert.equal(moves.length, 1);
  }
  h.request("a", "analyze", 1, undefined, "stockfish-10");
  assert.equal(lozza.terminated, true);
  assert.equal(evaluator.terminated, false);
  const replacement = h.workers[2]!;
  replacement.emit("id name Stockfish.js 10");
  replacement.emit("uciok");
  replacement.emit("readyok");
  replacement.emit("bestmove e2e4");
  const next = h.request("a");
  evaluator.emit("readyok");
  evaluator.emit("bestmove d2d4");
  assert.equal(next.length, 1);
  assert.equal(h.workers.length, 3);
}
test("evaluation and selected-engine searches reuse two workers across turns", alternatingEvaluation);

/** Cancels synchronous move work without discarding the parked Stockfish evaluator. */
function cachedCancellation(): void {
  const h = harness();
  h.request("a");
  const evaluator = h.boot();
  evaluator.emit("bestmove e2e4");
  const first = h.request("a", "analyze", 1, undefined, "lozza-2");
  const lozza = h.workers[1]!;
  lozza.emit("id name Lozza 2.0");
  lozza.emit("uciok");
  lozza.emit("readyok");
  const next = h.request("b");
  h.request("a", "stop");
  assert.equal(first.length, 1);
  assert.equal(lozza.terminated, true);
  assert.equal(evaluator.terminated, false);
  assert.equal(h.workers.length, 2);
  lozza.emit("bestmove a2a3");
  evaluator.emit("readyok");
  evaluator.emit("bestmove e2e4");
  assert.equal(next.length, 1);
}
test("canceling Lozza preserves the warm evaluator for the next owner", cachedCancellation);

/** Removes a failed idle evaluator without interrupting the active move worker. */
function cachedFailure(): void {
  const h = harness();
  h.request("a");
  const evaluator = h.boot();
  evaluator.emit("bestmove e2e4");
  const moves = h.request("a", "analyze", 1, undefined, "lozza-2");
  const lozza = h.workers[1]!;
  lozza.emit("id name Lozza 2.0");
  lozza.emit("uciok");
  lozza.emit("readyok");
  evaluator.onerror?.({ message: "idle failure" });
  assert.equal(evaluator.terminated, true);
  assert.equal(lozza.terminated, false);
  lozza.emit("bestmove e2e4");
  assert.equal(moves.length, 1);
  const next = h.request("a");
  const replacement = h.workers[2]!;
  replacement.emit("id name Stockfish 19");
  replacement.emit("uciok");
  replacement.emit("readyok");
  replacement.emit("bestmove e2e4");
  assert.equal(next.length, 1);
}
test("a failed parked evaluator is replaced without failing the move search", cachedFailure);

/** Terminates synchronous Lozza searches immediately so another tab can run without a stop watchdog. */
function cancelLozza(): void {
  const h = harness();
  const first = h.request("a", "analyze", 1, undefined, "lozza-2");
  const old = h.workers[0]!;
  old.emit("id name Lozza 2.0");
  old.emit("uciok");
  old.emit("readyok");
  const next = h.request("b");
  h.request("a", "stop");
  assert.equal(first.length, 1);
  assert.equal(old.terminated, true);
  assert.equal(h.workers.length, 2);
  old.emit("bestmove a2a3");
  const current = h.workers[1]!;
  current.emit("id name Stockfish 19");
  current.emit("uciok");
  current.emit("readyok");
  current.emit("bestmove e2e4");
  assert.equal(next.length, 1);
}
test("Lozza cancellation immediately releases the queued owner", cancelLozza);
