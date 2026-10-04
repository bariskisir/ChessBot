/** Reproduces stalled move transports and verifies visible retry and cancellation behavior. */
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { Chess } from "chess.js";
import type { Controller } from "../src/controller";
import type { Provider } from "../src/providers/provider";
import type { GameClock } from "../src/providers/clock";
import { DEFAULT_SETTINGS, type EngineRequest, type EngineResponse, type Settings, type Variation } from "../src/shared";

const bundle = buildSync({
  stdin: { contents: 'export { Controller } from "./src/controller"; export { chesscom } from "./src/providers/chesscom";', resolveDir: process.cwd() },
  bundle: true, write: false, format: "iife", globalName: "ControllerTest", platform: "browser",
}).outputFiles[0]!.text;

/** Drives the production controller with controlled searches, input, and time. */
function harness(settings: Partial<Settings> = {}, variations?: (request: EngineRequest) => Variation[]) {
  let now = 0, nextTimer = 0, position = new Chess().fen(), heldSearch: number | null = null;
  const timers = new Map<number, { at: number; callback: () => void; interval: number | null }>();
  const statuses: string[] = [], moves: string[] = [], attempts: AbortSignal[] = [], searches: EngineRequest[] = [];
  const replies: Array<(accepted: boolean) => void> = [];
  const engineReplies: Array<() => void> = [];
  let clock: GameClock | null = null, clockUpdatedAt = 0;
  /** Makes deadlines advance together with the fixture's timers. */
  class FixtureDate extends Date { static now(): number { return now; } }
  /** Keeps DOM observation inert while regular board polling remains active. */
  class Observer { observe(): void {} disconnect(): void {} }
  /** Schedules timeout, frame, and interval callbacks on the same controlled clock. */
  function schedule(callback: () => void, milliseconds: number, interval: number | null = null): number {
    const id = ++nextTimer;
    timers.set(id, { at: now + milliseconds, callback, interval });
    return id;
  }
  const context = {
    Date: FixtureDate, URL, AbortController, AbortSignal, DOMException,
    location: new URL("https://www.chess.com/play/computer"),
    document: { documentElement: {} }, MutationObserver: Observer,
    /** Records timers without depending on wall-clock delays. */
    setTimeout: (callback: () => void, milliseconds: number) => schedule(callback, milliseconds),
    /** Lets the controller's fallback poll continue during stalled input. */
    setInterval: (callback: () => void, milliseconds: number) => schedule(callback, milliseconds, milliseconds),
    /** Cancels a queued timeout or interval. */
    clearTimeout: (id: number) => timers.delete(id),
    /** Removes a disposed controller's fallback poll. */
    clearInterval: (id: number) => timers.delete(id),
    /** Coalesces position checks on the next fixture frame. */
    requestAnimationFrame: (callback: () => void) => schedule(callback, 16),
    /** Removes an abandoned frame during disposal. */
    cancelAnimationFrame: (id: number) => timers.delete(id),
    sessionStorage: { /** Keeps follow-up state absent in the fixture. */ removeItem: () => undefined },
    chrome: {
      storage: { local: {
        /** Defaults to deterministic input while allowing move-policy regression coverage. */
        get: async () => ({ botSettings: { ...DEFAULT_SETTINGS, autoPlayDelay: 0, averageMove: false, mistakeProbability: 0, autoNewMatch: false, ...settings } }),
      } },
      runtime: {
        /** Supplies deterministic searches while counting fresh retry analyses. */
        sendMessage: async (request: EngineRequest) => {
          if (request.action === "stop") return { stopped: true };
          searches.push(request);
          const bestMove = request.fen.split(" ")[1] === "w" ? "e2e4" : "e7e5";
          const response: EngineResponse = { result: { fen: request.fen, bestMove, variations: variations?.(request) ?? [{ depth: request.settings.depth, score: 0, mate: null, moves: [bestMove], nodes: 100 }] } };
          if (searches.length === heldSearch) return new Promise<EngineResponse>(
            /** Retains one reply to simulate a retry search that is still running. */
            (resolve) => engineReplies.push(
              /** Delivers the canceled search later to check stale-result isolation. */
              () => resolve(response)));
          return response;
        },
      },
    },
  };
  runInNewContext(bundle, context);
  const exports = (context as typeof context & { ControllerTest: { Controller: typeof Controller; chesscom: Provider } }).ControllerTest;
  Object.assign(exports.chesscom, {
    /** Reads the fixture position without needing a DOM board renderer. */
    readPosition: () => position,
    /** Keeps ownership fixed independently of the current turn. */
    userColor: () => "w",
    /** Decrements the configured clock so queue and search time remain visible. */
    readClock: () => clock ? { ...clock, remainingMs: Math.max(0, clock.remainingMs - (clock.running ? now - clockUpdatedAt : 0)) } : null,
    /** Allows input only on the fixture player's turn. */
    canPlay: (fen: string) => fen.split(" ")[1] === "w",
    /** Leaves board animations and promotions out of transport regressions. */
    boardBusy: () => false,
    /** Prevents promotion recovery from affecting normal input attempts. */
    canResumePromotion: () => false,
    /** Keeps unrelated game actions absent. */
    findGameAction: () => null,
    /** Ignores marks while preserving the real controller's cancellation path. */
    clearHighlights: () => undefined,
    /** Ignores opponent suggestion marks in the fixture. */
    highlight: () => undefined,
    /** Retains input responses to simulate a background callback that never arrives. */
    playMove: (_fen: string, move: string, signal: AbortSignal) => {
      attempts.push(signal);
      moves.push(move);
      return new Promise<boolean>(
        /** Allows a late transport acknowledgement after the controller has moved on. */
        (resolve) => replies.push(resolve));
    },
  });
  const controller = new exports.Controller(
    /** Records user-visible states rather than private controller flags. */
    (state) => statuses.push(state.status));
  /** Flushes nested message and analysis promises before advancing another timer. */
  async function flush(): Promise<void> { for (let index = 0; index < 20; index++) await Promise.resolve(); }
  /** Advances all due input, observer, and fallback timers in chronological order. */
  async function advance(milliseconds: number): Promise<void> {
    await flush();
    const target = now + milliseconds;
    for (;;) {
      const next = [...timers.entries()].sort(
        /** Selects the next deadline regardless of timer creation order. */
        (first, second) => first[1].at - second[1].at)[0];
      if (!next || next[1].at > target) break;
      const [id, timer] = next;
      now = timer.at;
      if (timer.interval === null) timers.delete(id);
      else timer.at += timer.interval;
      timer.callback();
      await flush();
    }
    now = target;
    await flush();
  }
  /** Changes only the readable board position while input responses remain pending. */
  function setPosition(fen: string): void { position = fen; }
  /** Holds a selected engine request without delaying later position analyses. */
  function holdSearch(index: number): void { heldSearch = index; }
  /** Applies an authoritative match clock or a later correction. */
  function setClock(value: GameClock): void { clock = value; clockUpdatedAt = now; }
  return { controller, statuses, moves, attempts, searches, replies, engineReplies, advance, setPosition, holdSearch, setClock };
}

/** Converts a missing input callback into three fresh searches and a bounded final failure. */
async function stalledInputRetries(): Promise<void> {
  const h = harness();
  await h.advance(0);
  h.controller.start();
  await h.advance(200);
  assert.equal(h.controller.state.status, "Playing move...");
  await h.advance(3000);
  assert.ok(h.statuses.includes("Move not accepted - retrying (1/3)..."));
  await h.advance(14000);
  assert.equal(h.attempts.length, 4);
  assert.equal(h.searches.length, 4);
  assert.equal(h.controller.state.status, "Move not accepted - press START to retry");
  assert.ok(h.attempts.every(
    /** Ensures stalled inputs cannot retain live signals after their deadlines. */
    (signal) => signal.aborted));
  for (let retry = 1; retry <= 3; retry++) assert.ok(h.statuses.includes(`Reanalyzing position (retry ${retry}/3)...`));
  h.controller.dispose();
}
test("stalled input callbacks visibly retry three times and stop", stalledInputRetries);

/** Releases execution on a changed board even if the background input acknowledgement is lost. */
async function boardChangeWithoutReply(): Promise<void> {
  const h = harness();
  await h.advance(0);
  h.controller.start();
  await h.advance(200);
  const game = new Chess();
  game.move("e4");
  h.setPosition(game.fen());
  await h.advance(500);
  assert.equal(h.controller.state.status, "Opponent's turn");
  assert.equal(h.attempts.length, 1);
  assert.equal(h.attempts[0]?.aborted, true);
  h.replies[0]?.(true);
  await h.advance(10000);
  assert.equal(h.controller.state.status, "Opponent's turn");
  assert.equal(h.attempts.length, 1);
  h.controller.dispose();
}
test("a board change ends Playing move without waiting for an input reply", boardChangeWithoutReply);

/** Lets an opponent position cancel a retry search instead of retaining the execution lock. */
async function boardChangeDuringRetrySearch(): Promise<void> {
  const h = harness();
  h.holdSearch(2);
  await h.advance(0);
  h.controller.start();
  await h.advance(4500);
  assert.equal(h.controller.state.status, "Reanalyzing position (retry 1/3)...");
  const game = new Chess();
  game.move("e4");
  h.setPosition(game.fen());
  await h.advance(500);
  assert.equal(h.controller.state.status, "Opponent's turn");
  h.engineReplies[0]?.();
  await h.advance(10000);
  assert.equal(h.attempts.length, 1);
  assert.equal(h.controller.state.status, "Opponent's turn");
  h.controller.dispose();
}
test("position changes release execution while a retry search is pending", boardChangeDuringRetrySearch);

/** Cancels a stuck attempt immediately and prevents its delayed retry from issuing input. */
async function stopDuringInput(): Promise<void> {
  const h = harness();
  await h.advance(0);
  h.controller.start();
  await h.advance(200);
  h.controller.stop();
  await h.advance(0);
  assert.equal(h.attempts[0]?.aborted, true);
  await h.advance(15000);
  assert.equal(h.attempts.length, 1);
  assert.equal(h.controller.state.status, "Stopped");
  h.controller.dispose();
}
test("STOP cancels a stalled move without later retries", stopDuringInput);

/** Prevents average selection and even guaranteed mistakes from replacing a MultiPV mate. */
async function averageMateInput(): Promise<void> {
  const h = harness({ averageMove: true, mistakeProbability: 100, depth: 15 },
    /** Places the mate outside the main variation to require scanning every line. */
    () => [
      { depth: 15, score: 4, mate: null, moves: ["e2e4"], nodes: 100 },
      { depth: 15, score: 0, mate: 3, moves: ["g1f3"], nodes: 100 },
      { depth: 15, score: 2, mate: null, moves: ["d2d4"], nodes: 100 },
    ]);
  try {
    await h.advance(0);
    h.controller.start();
    await h.advance(200);
    assert.deepEqual(h.moves, ["g1f3"]);
    assert.equal(h.searches.length, 1);
    assert.equal(h.controller.state.status, "Playing move...");
  } finally { h.controller.dispose(); }
}
test("Average Move plays a MultiPV mate without averaging or intentional mistakes", averageMateInput);

/** Preserves a mate first discovered by the authoritative depth-15 evaluation. */
async function deepAverageMateInput(): Promise<void> {
  const h = harness({ engine: "stockfish-19", averageMove: true, mistakeProbability: 100, depth: 7 },
    /** Keeps the shallow search unaware of the mate found by its deeper follow-up. */
    (request) => request.settings.depth === 15
      ? [{ depth: 15, score: 0, mate: 3, moves: ["d2d4"], nodes: 100 }]
      : [
        { depth: 7, score: 4, mate: null, moves: ["e2e4"], nodes: 100 },
        { depth: 7, score: 2, mate: null, moves: ["g1f3"], nodes: 100 },
      ]);
  try {
    await h.advance(0);
    h.controller.start();
    await h.advance(200);
    assert.deepEqual(h.moves, ["d2d4"]);
    assert.equal(h.searches.length, 2);
    assert.equal(h.searches[1]?.settings.depth, 15);
    assert.equal(h.controller.state.status, "Playing move...");
  } finally { h.controller.dispose(); }
}
test("Average Move follows a mate found in deep evaluation", deepAverageMateInput);

/** Deducts a held engine response from the complete increment-aware turn target. */
async function dynamicTurnIncludesSearch(): Promise<void> {
  const h = harness({ dynamicDelay: true, autoPlayDelay: 10000 });
  try {
    h.setClock({ remainingMs: 180000, initialMs: 180000, incrementMs: 2000, running: true });
    h.holdSearch(1);
    await h.advance(0);
    h.controller.start();
    await h.advance(2000);
    assert.equal(h.attempts.length, 0);
    assert.ok(h.searches[0]!.deadline! > 6000 && h.searches[0]!.deadline! < 6400);
    h.engineReplies[0]?.();
    await h.advance(4000);
    assert.equal(h.attempts.length, 0);
    assert.match(h.controller.state.status, /^Waiting 0\.\ds\.\.\.$/);
    await h.advance(400);
    assert.equal(h.attempts.length, 1);
  } finally { h.controller.dispose(); }
}
test("dynamic timing includes queued analysis rather than adding a full wait afterward", dynamicTurnIncludesSearch);

/** Releases an expired queued search and ignores its later response. */
async function expiredQueueUsesLegalMove(): Promise<void> {
  const h = harness();
  try {
    h.setClock({ remainingMs: 180000, initialMs: 180000, incrementMs: 2000, running: true });
    h.holdSearch(1);
    await h.advance(0);
    h.controller.start();
    await h.advance(6500);
    assert.equal(h.attempts.length, 1);
    const game = new Chess();
    assert.ok(game.move({ from: h.moves[0]!.slice(0, 2), to: h.moves[0]!.slice(2, 4) }));
    h.setPosition(game.fen());
    await h.advance(500);
    h.engineReplies[0]?.();
    await h.advance(1000);
    assert.equal(h.attempts.length, 1);
    assert.equal(h.controller.state.status, "Opponent's turn");
  } finally { h.controller.dispose(); }
}
test("an engine queue cannot outlast the dynamic turn budget", expiredQueueUsesLegalMove);

/** Cancels a pending dynamic wait immediately when the live clock is corrected downward. */
async function lowClockRemovesWait(): Promise<void> {
  const h = harness();
  try {
    h.setClock({ remainingMs: 300000, initialMs: 300000, incrementMs: 3000, running: true });
    await h.advance(0);
    h.controller.start();
    await h.advance(200);
    assert.match(h.controller.state.status, /^Waiting/);
    h.setClock({ remainingMs: 2000, initialMs: 300000, incrementMs: 3000, running: true });
    await h.advance(150);
    assert.equal(h.attempts.length, 1);
  } finally { h.controller.dispose(); }
}
test("time trouble removes dynamic waiting instead of spending a future increment", lowClockRemovesWait);

/** Prevents delayed input after STOP without relying on another board update. */
async function stopDuringDynamicWait(): Promise<void> {
  const h = harness();
  try {
    h.setClock({ remainingMs: 180000, initialMs: 180000, incrementMs: 2000, running: true });
    await h.advance(0);
    h.controller.start();
    await h.advance(200);
    assert.match(h.controller.state.status, /^Waiting/);
    h.controller.stop();
    await h.advance(10000);
    assert.equal(h.attempts.length, 0);
    assert.equal(h.controller.state.status, "Stopped");
  } finally { h.controller.dispose(); }
}
test("STOP cancels dynamic waiting without later input", stopDuringDynamicWait);

/** Withholds an incomplete unlimited result instead of relaxing depth in analysis-only mode. */
async function unlimitedDepthRemainsRequired(): Promise<void> {
  const h = harness({ autoPlay: false, depth: 15 },
    /** Returns an incomplete search without declaring a clock deadline. */
    () => [{ depth: 3, score: 0, mate: null, moves: ["e2e4"], nodes: 100 }]);
  try {
    await h.advance(0);
    h.controller.start();
    await h.advance(200);
    assert.match(h.controller.state.status, /below the selected depth 15/);
    assert.equal(h.attempts.length, 0);
    assert.equal(h.searches[0]?.deadline, undefined);
  } finally { h.controller.dispose(); }
}
test("analysis without automatic clock budgeting still requires its selected depth", unlimitedDepthRemainsRequired);
