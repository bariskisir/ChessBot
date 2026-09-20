/** Verifies warm-worker reuse and cancellation boundaries without depending on engine speed. */
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { DEFAULT_SETTINGS, type EngineRequest, type EngineResponse } from "../src/shared";

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
    constructor() { workers.push(this); }
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
  function request(owner: string, action: "analyze" | "stop" = "analyze", lines = 10) {
    const replies: EngineResponse[] = [];
    listener({ target: "engine", owner, action, fen, settings: { ...DEFAULT_SETTINGS, lines } }, {},
      /** Collects responses without hiding duplicate completions. */
      (response) => replies.push(response));
    return replies;
  }
  /** Completes identity verification and the first readiness barrier. */
  function boot(): FakeWorker {
    const worker = workers[0]!;
    worker.emit("id name Stockfish 18");
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
  worker.emit("id name Stockfish 18");
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
  current.emit("id name Stockfish 18");
  current.emit("uciok");
  current.emit("readyok");
  current.emit("bestmove e2e4");
  assert.equal(next.length, 1);
}
test("stuck cancellation replaces the worker and ignores stale callbacks", stuckWorker);
