/** Reproduces stalled move transports and verifies visible retry and cancellation behavior. */
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { Chess } from "chess.js";
import type { Controller } from "../src/controller";
import type { Provider } from "../src/providers/provider";
import type { GameClock } from "../src/providers/clock";
import { ENGINES } from "../src/engines";
import { DEFAULT_SETTINGS, type EngineRequest, type EngineResponse, type Settings, type Variation } from "../src/shared";

const bundle = buildSync({
  stdin: { contents: 'export { Controller } from "./src/controller"; export { chesscom } from "./src/providers/chesscom";', resolveDir: process.cwd() },
  bundle: true, write: false, format: "iife", globalName: "ControllerTest", platform: "browser",
}).outputFiles[0]!.text;

/** Drives the production controller with controlled searches, input, and time. */
function harness(settings: Partial<Settings> = {}, variations?: (request: EngineRequest) => Variation[]) {
  let now = 0, nextTimer = 0, position = new Chess().fen(), heldSearch: number | null = null, player: "w" | "b" = "w";
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
    userColor: () => player,
    /** Decrements the configured clock so queue and search time remain visible. */
    readClock: () => clock ? { ...clock, remainingMs: Math.max(0, clock.remainingMs - (clock.running ? now - clockUpdatedAt : 0)) } : null,
    /** Allows input only on the fixture player's turn. */
    canPlay: (fen: string) => fen.split(" ")[1] === player,
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
  return { controller, statuses, moves, attempts, searches, replies, engineReplies, advance, setPosition, holdSearch, setClock,
    /** Lets first-move regressions cover the Black player's own opening turn. */
    setPlayer: (color: "w" | "b") => { player = color; },
  };
}

/** Repeats selected-engine moves and Stockfish evaluation for each bounded input retry. */
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
  assert.equal(h.searches.length, 8);
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

/** Cancels the next selected-engine search after publishing the retry's Stockfish evaluation. */
async function boardChangeDuringRetrySearch(): Promise<void> {
  const h = harness();
  h.holdSearch(4);
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

/** Obtains Stockfish evaluation before preserving a selected-engine MultiPV mate. */
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
    assert.equal(h.searches.length, 2);
    assert.equal(h.searches[0]?.settings.engine, "stockfish-19");
    assert.equal(h.controller.state.status, "Playing move...");
  } finally { h.controller.dispose(); }
}
test("Average Move plays a MultiPV mate without averaging or intentional mistakes", averageMateInput);

/** Preserves a mate from the early depth-15 evaluation through a shallower main search. */
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
    assert.equal(h.searches[0]?.settings.depth, 15);
    assert.equal(h.controller.state.status, "Playing move...");
  } finally { h.controller.dispose(); }
}
test("Average Move follows a mate found in deep evaluation", deepAverageMateInput);

/** Evaluates with Stockfish first while keeping the selected engine responsible for moves. */
async function stockfishEvaluationForEveryEngine(): Promise<void> {
  for (const engine of ENGINES) for (const depth of [7, 18]) {
    const h = harness({ engine: engine.id, depth, autoPlay: false, averageMove: false, mistakeProbability: 0 },
      /** Gives Stockfish a different score and PV from the selected move engine. */
      (request) => [{ depth: request.settings.depth, score: request.settings.engine === "stockfish-19" ? 0.7 : 8, mate: null, moves: [request.settings.engine === "stockfish-19" ? "d2d4" : "e2e4"], nodes: 100 }]);
    try {
      await h.advance(0);
      h.controller.start();
      await h.advance(200);
      assert.equal(h.controller.state.evaluation?.score, 0.7, engine.name);
      assert.equal(h.controller.state.settings.engine, engine.id);
      assert.equal(h.controller.state.move, "E2E4");
      assert.equal(h.controller.state.status, "Analyzing Board");
      assert.equal(h.searches[0]?.settings.engine, "stockfish-19");
      if (engine.id === "stockfish-19" && depth >= 15) assert.equal(h.searches.length, 1);
      else {
        assert.equal(h.searches.length, 2);
        assert.equal(h.searches[0]?.settings.depth, Math.max(15, depth));
        assert.equal(h.searches[0]?.settings.lines, 1);
        assert.equal(h.searches[1]?.settings.engine, engine.id);
        assert.equal(h.searches[1]?.settings.depth, depth);
      }
    } finally { h.controller.dispose(); }
  }
}
test("every selected engine uses Stockfish 19 evaluation even with Average and Mistake disabled", stockfishEvaluationForEveryEngine);

/** Evaluates early and uses Stockfish to reject an optimistic selected-engine average candidate. */
async function stockfishVerifiesAverage(): Promise<void> {
  const afterUnsafe = new Chess();
  afterUnsafe.move("d4");
  const h = harness({ engine: "lozza-5", depth: 7, averageMove: true },
    /** Offers selected-engine candidates and contrasting Stockfish scores after their moves. */
    (request) => request.settings.engine !== "stockfish-19" ? [
      { depth: 7, score: 5, mate: null, moves: ["e2e4"], nodes: 100 },
      { depth: 7, score: 3, mate: null, moves: ["d2d4"], nodes: 100 },
      { depth: 7, score: 1, mate: null, moves: ["g1f3"], nodes: 100 },
    ] : [{ depth: 15, score: request.fen === afterUnsafe.fen() ? -1 : 0.7, mate: null, moves: ["e2e4"], nodes: 100 }]);
  try {
    await h.advance(0);
    h.controller.start();
    await h.advance(200);
    assert.deepEqual(h.moves, ["g1f3"]);
    assert.equal(h.controller.state.evaluation?.score, 0.7);
    assert.equal(h.searches.length, 4);
    assert.equal(h.searches[0]?.settings.engine, "stockfish-19");
    assert.equal(h.searches[1]?.settings.engine, "lozza-5");
    for (const search of h.searches.slice(2)) {
      assert.equal(search.settings.engine, "stockfish-19");
      assert.equal(search.settings.depth, 15);
    }
  } finally { h.controller.dispose(); }
}
test("Average Move safety uses Stockfish 19 independently of its candidate engine", stockfishVerifiesAverage);

/** Keeps a legal emergency move without publishing unavailable or stale Stockfish output. */
async function expiredEvaluationKeepsLegalMove(): Promise<void> {
  const h = harness({ engine: "lozza-2" },
    /** Gives the selected engine an unmistakable score that must never reach the panel. */
    (request) => [{ depth: request.settings.depth, score: 8, mate: null, moves: ["e2e4"], nodes: 100 }]);
  try {
    h.setClock({ remainingMs: 2000, initialMs: 180000, incrementMs: 2000, running: true });
    h.holdSearch(1);
    await h.advance(0);
    h.controller.start();
    await h.advance(500);
    assert.equal(h.moves.length, 1);
    const move = h.moves[0];
    assert.ok(move);
    assert.ok(new Chess().move({ from: move.slice(0, 2), to: move.slice(2, 4) }));
    assert.equal(h.controller.state.evaluation, undefined);
    assert.equal(h.searches[0]?.settings.engine, "stockfish-19");
    h.engineReplies[0]?.();
    await h.advance(0);
    assert.equal(h.controller.state.evaluation, undefined);
  } finally { h.controller.dispose(); }
}
test("an expired Stockfish evaluation keeps a legal move without publishing stale scores", expiredEvaluationKeepsLegalMove);

/** Cancels the initial Stockfish evaluation before issuing a selected-engine move search. */
async function stopDuringStockfishEvaluation(): Promise<void> {
  const h = harness({ engine: "lozza-5" });
  try {
    h.holdSearch(1);
    await h.advance(0);
    h.controller.start();
    await h.advance(200);
    assert.equal(h.controller.state.status, "Evaluating position...");
    h.controller.stop();
    h.engineReplies[0]?.();
    await h.advance(1000);
    assert.equal(h.controller.state.status, "Stopped");
    assert.equal(h.controller.state.evaluation, undefined);
    assert.equal(h.attempts.length, 0);
  } finally { h.controller.dispose(); }
}
test("STOP prevents held Stockfish evaluation from publishing a score or playing a move", stopDuringStockfishEvaluation);

/** Gives the bar fresh Stockfish scores before a deep selected-engine search can exhaust the turn. */
async function evaluationBeforeStalledMove(): Promise<void> {
  for (const engine of ENGINES) {
    const h = harness({ engine: engine.id, depth: 30 },
      /** Keeps the display score distinct from every non-Stockfish move-engine score. */
      (request) => [{ depth: request.settings.depth, score: request.settings.engine === "stockfish-19" ? 0.7 : 8, mate: null, moves: ["e2e4"], nodes: 100 }]);
    try {
      h.setClock({ remainingMs: 180000, initialMs: 180000, incrementMs: 2000, running: true });
      h.holdSearch(2);
      await h.advance(0);
      h.controller.start();
      await h.advance(200);
      assert.equal(h.controller.state.evaluation?.score, 0.7, engine.name);
      assert.equal(h.controller.state.status, "Thinking...");
      assert.equal(h.attempts.length, 0);
      assert.equal(h.searches[0]?.settings.engine, "stockfish-19");
      assert.equal(h.searches[1]?.settings.engine, engine.id);
      const evaluationDeadline = h.searches[0]?.deadline, moveDeadline = h.searches[1]?.deadline;
      assert.ok(evaluationDeadline !== undefined && moveDeadline !== undefined && evaluationDeadline < moveDeadline / 2);
      await h.advance(5500);
      assert.equal(h.attempts.length, 1);
      assert.equal(h.controller.state.evaluation?.score, 0.7);
      h.engineReplies[0]?.();
      await h.advance(0);
      assert.equal(h.controller.state.evaluation?.score, 0.7);
    } finally { h.controller.dispose(); }
  }
}
test("every engine publishes Stockfish evaluation before a stalled timed move search", evaluationBeforeStalledMove);

/** Publishes position evaluation without waiting for average-candidate verification to finish. */
async function evaluationBeforeVerification(): Promise<void> {
  const h = harness({ engine: "lozza-5", averageMove: true });
  try {
    h.holdSearch(3);
    await h.advance(0);
    h.controller.start();
    await h.advance(200);
    assert.equal(h.controller.state.status, "Verifying average move...");
    assert.equal(h.controller.state.evaluation?.score, 0);
    assert.equal(h.attempts.length, 0);
  } finally { h.controller.dispose(); }
}
test("the eval bar updates while average verification is still pending", evaluationBeforeVerification);

/** Prevents a canceled move search from overwriting the next position's early Stockfish score. */
async function newerEvaluationSurvivesLateMove(): Promise<void> {
  const initial = new Chess().fen();
  const h = harness({ engine: "lozza-2" },
    /** Assigns visibly different Stockfish scores before and after the opponent's reply. */
    (request) => [{ depth: request.settings.depth, score: request.settings.engine === "stockfish-19" ? request.fen === initial ? 0.7 : 2.7 : 8, mate: null, moves: ["e2e4"], nodes: 100 }]);
  try {
    h.holdSearch(2);
    await h.advance(0);
    h.controller.start();
    await h.advance(200);
    assert.equal(h.controller.state.evaluation?.score, 0.7);
    const game = new Chess();
    game.move("e4");
    game.move("e5");
    h.setPosition(game.fen());
    await h.advance(500);
    assert.equal(h.controller.state.evaluation?.score, 2.7);
    h.engineReplies[0]?.();
    await h.advance(0);
    assert.equal(h.controller.state.evaluation?.score, 2.7);
  } finally { h.controller.dispose(); }
}
test("late move replies cannot overwrite a newer position's Stockfish evaluation", newerEvaluationSurvivesLateMove);

/** Deducts early evaluation and queued move selection from the same fifty-move target. */
async function dynamicTurnIncludesSearch(): Promise<void> {
  const h = harness({ dynamicDelay: true, autoPlayDelay: 10000 });
  try {
    h.setPosition(new Chess().fen().replace(/ 1$/, " 2"));
    h.setClock({ remainingMs: 180000, initialMs: 180000, incrementMs: 2000, running: true });
    h.holdSearch(1);
    await h.advance(0);
    h.controller.start();
    await h.advance(2000);
    assert.equal(h.attempts.length, 0);
    assert.ok(h.searches[0]!.deadline! > 950 && h.searches[0]!.deadline! < 1150);
    h.engineReplies[0]?.();
    await h.advance(3000);
    assert.ok(h.searches[1]!.deadline! > 5300 && h.searches[1]!.deadline! < 5500);
    assert.equal(h.attempts.length, 0);
    assert.match(h.controller.state.status, /^Waiting 0\.\ds\.\.\.$/);
    await h.advance(650);
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
    h.setPosition(new Chess().fen().replace(/ 1$/, " 2"));
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
    h.setPosition(new Chess().fen().replace(/ 1$/, " 2"));
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

/** Plays each color's opening move without either delay while preserving later turn waiting. */
async function firstMoveHasNoDelay(): Promise<void> {
  for (const player of ["w", "b"] as const) for (const dynamicDelay of [true, false]) {
    const h = harness({ dynamicDelay, autoPlayDelay: 10000 });
    try {
      const game = new Chess();
      if (player === "b") game.move("e4");
      h.setPlayer(player);
      h.setPosition(game.fen());
      h.setClock({ remainingMs: 300000, initialMs: 300000, incrementMs: 3000, running: true });
      await h.advance(0);
      h.controller.start();
      await h.advance(200);
      assert.equal(h.attempts.length, 1, `${player}, dynamic=${dynamicDelay}`);
      assert.equal(h.statuses.some(
        /** Detects intentional waiting even if it is shorter than the fixture's advance. */
        (status) => status.startsWith("Waiting ")), false);
    } finally { h.controller.dispose(); }
  }
}
test("White and Black skip Dynamic and Random Delay on their first game move", firstMoveHasNoDelay);

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

/** Keeps every move engine and stalled-input retry on one candidate after a low-clock observation. */
async function lowClockUsesBestMove(): Promise<void> {
  for (const engine of ENGINES) {
    const h = harness({ engine: engine.id, averageMove: true });
    try {
      h.setClock({ remainingMs: 4000, initialMs: 180000, incrementMs: 10000, running: false });
      await h.advance(0);
      h.controller.start();
      await h.advance(200);
      assert.equal(h.controller.state.averageMoveDisabled, true, engine.name);
      assert.equal(h.controller.state.settings.averageMove, true);
      assert.equal(h.moves[0], "e2e4");
      h.setClock({ remainingMs: 14000, initialMs: 180000, incrementMs: 10000, running: false });
      await h.advance(4200);
      assert.ok(h.attempts.length >= 2);
      assert.equal(h.controller.state.averageMoveDisabled, true);
      for (const search of h.searches) assert.equal(search.settings.lines, 1);
      assert.equal(h.statuses.includes("Verifying average move..."), false);
      h.controller.stop(); h.controller.start();
      await h.advance(100);
      assert.equal(h.controller.state.averageMoveDisabled, true);
    } finally { h.controller.dispose(); }
  }
}
test("all engines and retries use Best Move for the low-clock game without changing preferences", lowClockUsesBestMove);

/** Cancels an outstanding average verification when the authoritative clock drops below five seconds. */
async function lowClockInterruptsAverage(): Promise<void> {
  const h = harness({ engine: "lozza-5", averageMove: true, autoPlay: false });
  try {
    h.setClock({ remainingMs: 10000, initialMs: 180000, incrementMs: 10000, running: false });
    h.holdSearch(3);
    await h.advance(0);
    h.controller.start();
    await h.advance(200);
    assert.equal(h.controller.state.status, "Verifying average move...");
    h.setClock({ remainingMs: 4999, initialMs: 180000, incrementMs: 10000, running: false });
    await h.advance(400);
    assert.equal(h.controller.state.averageMoveDisabled, true);
    assert.equal(h.controller.state.status, "Analyzing Board");
    assert.equal(h.searches.at(-1)?.settings.lines, 1);
    h.engineReplies[0]?.();
    await h.advance(0);
    assert.equal(h.controller.state.status, "Analyzing Board");
    const game = new Chess(); game.move("e4"); game.move("e5");
    h.setPosition(game.fen());
    h.setClock({ remainingMs: 14000, initialMs: 180000, incrementMs: 10000, running: false });
    await h.advance(400);
    assert.equal(h.controller.state.averageMoveDisabled, true);
    h.setPosition(new Chess().fen());
    h.setClock({ remainingMs: 180000, initialMs: 180000, incrementMs: 10000, running: false });
    await h.advance(400);
    assert.equal(h.controller.state.averageMoveDisabled, false);
    assert.equal(h.searches.some(
      /** Confirms the new match returns to the saved MultiPV preference. */
      (request) => request.settings.engine === "lozza-5" && request.settings.lines === 10 && request.fen === new Chess().fen()), true);
  } finally { h.controller.dispose(); }
}
test("crossing five seconds cancels average verification and a fresh match restores averaging", lowClockInterruptsAverage);

/** Distinguishes an already-sent gesture from average analysis performed during an input retry. */
async function lowClockDuringInputRetries(): Promise<void> {
  for (const holdRetry of [false, true]) {
    const h = harness({ engine: "lozza-5", averageMove: true, dynamicDelay: false });
    try {
      h.setClock({ remainingMs: 10000, initialMs: 180000, incrementMs: 10000, running: false });
      if (holdRetry) h.holdSearch(6);
      await h.advance(0);
      h.controller.start();
      await h.advance(200);
      assert.equal(h.attempts.length, 1);
      if (holdRetry) { await h.advance(4200); assert.equal(h.searches.length, 6); }
      h.setClock({ remainingMs: 4999, initialMs: 180000, incrementMs: 10000, running: false });
      await h.advance(400);
      assert.equal(h.controller.state.averageMoveDisabled, true);
      if (!holdRetry) {
        assert.equal(h.attempts[0]?.aborted, false);
        assert.equal(h.searches.length, 3);
        await h.advance(4200);
      } else { h.engineReplies[0]?.(); await h.advance(0); }
      assert.ok(h.attempts.length >= 2);
      for (const search of h.searches.slice(holdRetry ? 6 : 3)) assert.equal(search.settings.lines, 1);
    } finally { h.controller.dispose(); }
  }
}
test("low clocks preserve sent input and cancel average analysis inside a retry", lowClockDuringInputRetries);
