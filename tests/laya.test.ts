/** Verifies Laya job envelopes, option limits, credential masking and cancelable polling offline. */
import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { analyzeLaya, buildLayaDecision, LAYA_BASE_URL, LAYA_MODEL, LAYA_URL } from "../src/laya";
import { buildDecision } from "../src/jev";
import type { JevLog } from "../src/jev-log";

const MANY_MOVES = "7k/8/1Q1Q1Q2/8/1Q1Q1Q2/8/8/K7 w - - 0 1";
const JOB_ID = "01J9Z3K6V8X2N4QH7R5T0WBC1D";
const ANSWER = { model: "laya-1.0.0", answers: { move: { type: "choice", choice: "e2e4", probabilities: { e2e4: 0.8 }, confidence: 0.7 } }, usage: { input_tokens: 296, output_tokens: 20 } };

/** Builds documented job envelopes without storing any production credential. */
function job(status: string, result: unknown = null, id: string = JOB_ID) {
  return { id, object: "job", status, model: LAYA_MODEL, metadata: null, result, error: null };
}

/** Preserves the first 50 moves in generation order with the provider's required model. */
function legalOptions(): void {
  const initial = buildLayaDecision(new Chess().fen());
  assert.equal(Object.keys(initial.questions.move.criteria).length, 20);
  assert.equal(initial.questions.move.criteria.e2e4, "e4");
  assert.equal(initial.model, LAYA_MODEL);
  for (const [fen, move] of [
    ["r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1"],
    ["7k/8/8/3pP3/8/8/8/K7 w - d6 0 1", "e5d6"],
    ["7k/P7/6K1/8/8/8/8/8 w - - 0 1", "a7a8n"],
  ] as const) assert.ok(buildLayaDecision(fen).questions.move.criteria[move]);
  const complete = buildDecision(MANY_MOVES).questions.move.criteria;
  const body = buildLayaDecision(MANY_MOVES);
  assert.ok(Object.keys(complete).length > 50);
  assert.deepEqual(Object.entries(body.questions.move.criteria), Object.entries(complete).slice(0, 50));
  assert.ok(body.state.endsWith(JSON.stringify(body.questions.move.criteria)));
  for (const move of Object.keys(complete).slice(50)) assert.ok(!body.state.includes(move));
  assert.throws(
    /** A terminal position cannot be submitted as a choice question. */
    () => buildLayaDecision("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"), /No legal moves/);
}
test("Laya submits laya-latest with the first 50 legal moves without limiting Jev", legalOptions);

/** Checks completed job responses, endpoint boundaries and sanitization of provider echoes. */
async function transport(): Promise<void> {
  const fen = new Chess().fen();
  const controller = new AbortController();
  const key = "laya_sk_fixture-secret";
  const entries: JevLog[] = [];
  /** Captures independently masked lifecycle snapshots. */
  const receive = (entry: JevLog): void => { entries.push(entry); };
  /** Responds with a completed job whose decision is nested under result. */
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, LAYA_URL);
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${key}`);
    assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
    assert.equal(init?.signal, controller.signal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, LAYA_MODEL);
    assert.ok(body.state.includes(fen));
    assert.equal(body.questions.move.type, "choice");
    return Response.json({ ...job("completed", ANSWER), echo: key }, { headers: { "x-request-id": JOB_ID } });
  };
  assert.deepEqual(await analyzeLaya(fen, ` ${key} `, controller.signal, fetcher, receive), { fen, bestMove: "e2e4", variations: [] });
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.status, "pending");
  assert.equal(entries[1]?.status, "success");
  assert.equal(entries[1]?.request.url, LAYA_URL);
  assert.equal(entries[1]?.response?.headers["x-request-id"], JOB_ID);
  assert.deepEqual((entries[1]?.response?.body as { result: unknown }).result, ANSWER);
  assert.equal((entries[1]?.response?.body as { echo: string }).echo, "[REDACTED]");
  assert.ok(!JSON.stringify(entries).includes(key));
}
test("Laya reads result.answers and logs raw masked job traffic without an evaluation", transport);

/** Polls queued and processing jobs while retaining every authenticated HTTP exchange. */
async function polling(): Promise<void> {
  const fen = new Chess().fen();
  const controller = new AbortController();
  const entries: JevLog[] = [];
  let calls = 0;
  /** Collects POST and GET lifecycle snapshots for the shared viewer. */
  const receive = (entry: JevLog): void => { entries.push(entry); };
  /** Runs a queued-to-processing-to-completed sequence with consistent job identity. */
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(init?.signal, controller.signal);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture");
    if (calls === 1) {
      assert.equal(url, LAYA_URL);
      assert.equal(init?.method, "POST");
      return Response.json(job("queued"), { status: 202 });
    }
    assert.equal(url, `${LAYA_BASE_URL}/jobs/${JOB_ID}`);
    assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined);
    return Response.json(job(calls === 2 ? "processing" : "completed", calls === 2 ? null : ANSWER));
  };
  assert.equal((await analyzeLaya(fen, "fixture", controller.signal, fetcher, receive)).bestMove, "e2e4");
  assert.equal(calls, 3);
  assert.equal(entries.length, 6);
  assert.equal(entries[1]?.response?.status, 202);
  assert.equal(entries[3]?.request.method, "GET");
  assert.equal(entries[3]?.request.body, null);
  assert.equal(entries[5]?.status, "success");
  assert.deepEqual((entries[5]?.response?.body as { result: unknown }).result, ANSWER);
  assert.ok(!JSON.stringify(entries).includes("fixture"));
}
test("Laya polls queued jobs by id and logs each request", polling);

/** Rejects HTTP errors, malformed jobs and choices absent from the submitted options. */
async function failures(): Promise<void> {
  const fen = new Chess().fen();
  const signal = new AbortController().signal;
  let calls = 0;
  /** Detects accidental network work when the required key is missing. */
  const unused: typeof fetch = async () => { calls++; return Response.json({}); };
  await assert.rejects(analyzeLaya(fen, " ", signal, unused), /Laya API key/);
  assert.equal(calls, 0);
  for (const status of [401, 404, 422, 429, 503]) {
    /** Simulates provider refusal without exposing a sensitive response as the user error. */
    const refused: typeof fetch = async () => new Response("private", { status });
    await assert.rejects(analyzeLaya(fen, "fixture", signal, refused), new RegExp(`Laya request failed \\(HTTP ${status}\\)`));
  }
  for (const payload of [null, {}, ANSWER, job("unknown"), job("queued", null, "../elsewhere")]) {
    /** Supplies malformed or non-job replies at the transport boundary. */
    const invalid: typeof fetch = async () => Response.json(payload);
    await assert.rejects(analyzeLaya(fen, "fixture", signal, invalid), /invalid job/);
  }
  for (const result of [null, {}, { answers: { move: { choice: "e2e5" } } }]) {
    /** Supplies invalid decisions inside otherwise completed jobs. */
    const invalid: typeof fetch = async () => Response.json(job("completed", result));
    await assert.rejects(analyzeLaya(fen, "fixture", signal, invalid), /Laya did not return a legal move/);
  }
  const omitted = Object.keys(buildDecision(MANY_MOVES).questions.move.criteria)[50];
  assert.ok(omitted);
  /** Returns a legal move that was excluded by the provider's option limit. */
  const excluded: typeof fetch = async () => Response.json(job("completed", { answers: { move: { choice: omitted } } }));
  await assert.rejects(analyzeLaya(MANY_MOVES, "fixture", signal, excluded), /legal move/);
}
test("Laya refuses HTTP errors, malformed jobs and choices outside the first 50 moves", failures);

/** Handles failed jobs returned with HTTP 200 and rejects a poll for the wrong job. */
async function failedJobs(): Promise<void> {
  const fen = new Chess().fen();
  const entries: JevLog[] = [];
  /** Retains the raw failure while masking its echoed key. */
  const receive = (entry: JevLog): void => { entries.push(entry); };
  /** Returns a failed job independently of its successful HTTP status. */
  const failed: typeof fetch = async () => Response.json({ ...job("failed"), error: { type: "worker", message: "Failed for fixture-secret" } });
  await assert.rejects(analyzeLaya(fen, "fixture-secret", new AbortController().signal, failed, receive), /Laya job failed/);
  assert.equal(entries[1]?.status, "error");
  assert.equal(entries[1]?.response?.status, 200);
  assert.ok(!JSON.stringify(entries).includes("fixture-secret"));
  let calls = 0;
  /** Changes identity after accepting a queued job to simulate an unrelated completion. */
  const wrongJob: typeof fetch = async () => {
    calls++;
    return Response.json(calls === 1 ? job("queued") : job("completed", ANSWER, "01J9Z3K6V8X2N4QH7R5T0WBC1E"));
  };
  await assert.rejects(analyzeLaya(fen, "fixture", new AbortController().signal, wrongJob), /invalid job/);
}
test("Laya rejects failed jobs and unrelated polled results", failedJobs);

/** Rejects canceled requests and interrupts queued waits before another poll is sent. */
async function cancellation(): Promise<void> {
  const fen = new Chess().fen();
  const controller = new AbortController();
  const entries: JevLog[] = [];
  /** Retains the canceled status for inspection. */
  const receive = (entry: JevLog): void => { entries.push(entry); };
  /** Returns a valid move only after STOP has canceled the operation. */
  const late: typeof fetch = async () => { controller.abort(); return Response.json(job("completed", ANSWER)); };
  await assert.rejects(analyzeLaya(fen, "fixture", controller.signal, late, receive), { name: "AbortError" });
  assert.equal(entries[1]?.status, "canceled");
  /** Fails if a request reaches the network with an already canceled signal. */
  const unused: typeof fetch = async () => { throw new Error("Unexpected request"); };
  await assert.rejects(analyzeLaya(fen, "fixture", controller.signal, unused), { name: "AbortError" });
  const waiting = new AbortController();
  let calls = 0;
  /** Cancels after the queued POST completes, before its delay can start another request. */
  const stop = (entry: JevLog): void => { if (entry.status === "success") waiting.abort(); };
  /** Accepts one queued job so leaked polling would increment the request count. */
  const queued: typeof fetch = async () => { calls++; return Response.json(job("queued"), { status: 202 }); };
  await assert.rejects(analyzeLaya(fen, "fixture", waiting.signal, queued, stop), { name: "AbortError" });
  assert.equal(calls, 1);
  const pollingController = new AbortController();
  calls = 0;
  /** Returns a completed poll only after STOP has canceled its signal. */
  const latePoll: typeof fetch = async () => {
    calls++;
    if (calls === 1) return Response.json(job("processing"), { status: 202 });
    pollingController.abort();
    return Response.json(job("completed", ANSWER));
  };
  await assert.rejects(analyzeLaya(fen, "fixture", pollingController.signal, latePoll, receive), { name: "AbortError" });
  assert.equal(entries.at(-1)?.request.method, "GET");
  assert.equal(entries.at(-1)?.status, "canceled");
}
test("Laya STOP rejects late replies and cancels queued polling", cancellation);

/** Avoids the API's minimum two-option requirement when chess permits only one move. */
async function forcedMove(): Promise<void> {
  const fen = "7k/8/6K1/8/8/8/8/R7 b - - 0 1";
  /** Fails if a forced move accidentally reaches the network. */
  const unused: typeof fetch = async () => { throw new Error("Unexpected request"); };
  assert.deepEqual(await analyzeLaya(fen, "fixture", new AbortController().signal, unused), { fen, bestMove: "h8g8", variations: [] });
}
test("Laya handles forced moves without submitting a one-option choice", forcedMove);
