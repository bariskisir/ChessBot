/** Verifies legal OpenRouter decisions, request boundaries and cancellation without network access. */
import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { analyzeOpenRouter, buildOpenRouterDecision, JEV_URL, openRouterName, parseOpenRouterDecision } from "../src/jev";
import { normalizeSettings } from "../src/shared";

const MODEL = "~typesafe/jev-latest";

/** Covers normal moves, castling, en passant and underpromotion in the submitted list. */
function legalOptions(): void {
  const body = buildOpenRouterDecision(MODEL, new Chess().fen());
  assert.equal(body.model, MODEL);
  assert.equal(Object.keys(body.questions.move.criteria).length, 20);
  assert.equal(body.questions.move.criteria.e2e4, "e4");
  for (const [fen, move] of [
    ["r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1"],
    ["7k/8/8/3pP3/8/8/8/K7 w - d6 0 1", "e5d6"],
    ["7k/P7/6K1/8/8/8/8/8 w - - 0 1", "a7a8n"],
  ] as const) assert.ok(buildOpenRouterDecision(MODEL, fen).questions.move.criteria[move]);
  assert.throws(
    /** A terminal position cannot produce a move choice. */
    () => buildOpenRouterDecision(MODEL, "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"), /No legal moves/);
  assert.equal(normalizeSettings({ engine: "openrouter", openrouterModel: " x/y ", openRouterKey: " test " }).openrouterModel, "x/y");
  assert.equal(normalizeSettings({ engine: "openrouter", openRouterKey: " test " }).openRouterKey, "test");
  assert.equal(normalizeSettings({ engine: "unknown" }).engine, "stockfish-18");
}
test("OpenRouter receives the complete legal move list", legalOptions);

/** Derives log and error names from any catalogue slug without a hardcoded list. */
function modelNames(): void {
  assert.equal(openRouterName(""), "OpenRouter");
  assert.equal(openRouterName("  "), "OpenRouter");
  assert.equal(openRouterName(MODEL), "jev-latest");
  assert.equal(openRouterName("openai/gpt-4o"), "gpt-4o");
  assert.equal(openRouterName("plain"), "plain");
}
test("OpenRouter names come from the selected catalogue slug", modelNames);

/** Rejects empty and illegal decisions without inventing an evaluation or fallback. */
function responses(): void {
  const fen = new Chess().fen();
  for (const payload of [null, {}, { answers: {} }, { answers: { move: { choice: "e2e5" } } }]) {
    assert.throws(
      /** Invalid choices must fail before any board action. */
      () => parseOpenRouterDecision(MODEL, payload, fen, ["e2e4"]), /legal move/);
  }
  assert.deepEqual(parseOpenRouterDecision(MODEL, { answers: { move: { choice: "e2e4" } } }, fen, ["e2e4"]), { fen, bestMove: "e2e4", variations: [] });
}
test("only a legal decision can become a playable move", responses);

/** Checks the real request shape, HTTP failures and late responses after cancellation. */
async function transport(): Promise<void> {
  const fen = new Chess().fen();
  const controller = new AbortController();
  /** Returns a deterministic decision while checking the provider request. */
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, JEV_URL);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-key");
    assert.equal(init?.signal, controller.signal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, MODEL);
    assert.ok(body.state.includes(fen));
    assert.equal(body.questions.move.type, "choice");
    return Response.json({ answers: { move: { choice: "e2e4" } } });
  };
  assert.equal((await analyzeOpenRouter(MODEL, fen, "test-key", controller.signal, fetcher)).bestMove, "e2e4");
  await assert.rejects(analyzeOpenRouter("", fen, "test-key", controller.signal, fetcher), /Select an OpenRouter model/);
  await assert.rejects(analyzeOpenRouter(MODEL, fen, "", controller.signal, fetcher), /API key/);
  /** Simulates a provider refusing the credential without exposing its error body. */
  const refused: typeof fetch = async () => new Response("secret", { status: 401 });
  await assert.rejects(analyzeOpenRouter(MODEL, fen, "test-key", controller.signal, refused), /HTTP 401/);
  /** Simulates an uncooperative transport resolving after STOP. */
  const late: typeof fetch = async () => { controller.abort(); return Response.json({ answers: { move: { choice: "e2e4" } } }); };
  await assert.rejects(analyzeOpenRouter(MODEL, fen, "test-key", controller.signal, late), { name: "AbortError" });
}
test("OpenRouter transport validates requests and rejects canceled results", transport);
