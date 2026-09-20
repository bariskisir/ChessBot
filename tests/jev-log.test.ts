/** Verifies raw traffic logging never exposes credentials, including provider echoes. */
import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { analyzeJev } from "../src/jev";
import { formatLogBody, type JevLog } from "../src/jev-log";

/** Captures pending and completed snapshots with readable structured bodies. */
async function successfulTraffic(): Promise<void> {
  const entries: JevLog[] = [];
  const key = 'sk-secret-"quoted\\key';
  /** Echoes the key to ensure response sanitization happens before publishing. */
  const fetcher: typeof fetch = async () => Response.json({ answers: { move: { choice: "e2e4" } }, echo: key });
  /** Captures independently sanitized snapshots. */
  const receive = (entry: JevLog): void => { entries.push(entry); };
  await analyzeJev(new Chess().fen(), key, new AbortController().signal, fetcher, receive);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.status, "pending");
  assert.equal(entries[1]?.status, "success");
  assert.equal(entries[0]?.id, entries[1]?.id);
  assert.equal(entries[1]?.response?.status, 200);
  assert.equal(entries[1]?.request.headers.Authorization, "Bearer [REDACTED]");
  assert.equal((entries[1]?.response?.body as { echo: string }).echo, "[REDACTED]");
  assert.ok(!JSON.stringify(entries).includes("sk-secret"));
  assert.ok(formatLogBody(entries[1]?.response?.body).includes('\n  "answers": {'));
}
test("Jev logs pending and raw completed traffic with masked credentials", successfulTraffic);

/** Keeps raw HTTP error bodies and marks canceled requests without logging secrets. */
async function failedTraffic(): Promise<void> {
  const entries: JevLog[] = [];
  /** Collects error and cancellation snapshots. */
  const receive = (entry: JevLog): void => { entries.push(entry); };
  /** Simulates a non-JSON gateway error that echoes the credential. */
  const failed: typeof fetch = async () => new Response("Gateway rejected sk-private", { status: 502 });
  await assert.rejects(analyzeJev(new Chess().fen(), "sk-private", new AbortController().signal, failed, receive), /HTTP 502/);
  assert.equal(entries[1]?.response?.body, "Gateway rejected [REDACTED]");
  assert.equal(entries[1]?.status, "error");
  const controller = new AbortController();
  /** Cancels a pending request as STOP would. */
  const canceled: typeof fetch = async () => { controller.abort(); throw new Error("Bearer sk-private"); };
  await assert.rejects(analyzeJev(new Chess().fen(), "sk-private", controller.signal, canceled, receive));
  assert.equal(entries[3]?.status, "canceled");
  assert.equal(entries[3]?.error, "Bearer [REDACTED]");
  assert.ok(!JSON.stringify(entries).includes("sk-private"));
}
test("Jev logs non-JSON errors and cancellation safely", failedTraffic);

/** Sorts move probabilities for display while keeping the original response unchanged. */
function sortedProbabilities(): void {
  const body = { answers: { move: { choice: "e2e4", probabilities: { a2a3: 0.05, e2e4: 0.8, d2d4: 0.15 } } } };
  const original = JSON.stringify(body);
  const displayed = JSON.parse(formatLogBody(body));
  assert.deepEqual(Object.keys(displayed.answers.move.probabilities), ["e2e4", "d2d4", "a2a3"]);
  assert.equal(JSON.stringify(body), original);
  assert.equal(formatLogBody("Non-JSON error"), "Non-JSON error");
  assert.deepEqual(JSON.parse(formatLogBody({ probabilities: { unknown: "unavailable" } })), { probabilities: { unknown: "unavailable" } });
}
test("displayed probabilities descend without changing raw traffic", sortedProbabilities);
