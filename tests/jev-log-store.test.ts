/** Verifies refresh persistence, serialized clearing, tab isolation and reported dollar totals. */
import assert from "node:assert/strict";
import test from "node:test";
import { JevLogStore } from "../src/jev-log-store";
import { totalJevCost, type JevLog } from "../src/jev-log";

/** Creates an already-masked lifecycle record without requiring a provider request. */
function record(id: string, status: JevLog["status"] = "pending", cost?: unknown): JevLog {
  return { id, startedAt: "2026-09-20T00:00:00Z", durationMs: null, status,
    request: { url: "https://openrouter.ai/api/alpha/decisions", method: "POST", headers: { Authorization: "Bearer [REDACTED]" }, body: {} },
    response: status === "pending" ? null : { status: 200, headers: {}, body: { usage: { cost } } }, error: null };
}

/** Preserves complete histories across store recreation and suppresses cleared completions. */
async function persistence(): Promise<void> {
  const data: Record<string, unknown> = {};
  const storage = {
    /** Mimics Chrome's independent structured-clone reads. */
    async get(key: string): Promise<Record<string, unknown>> { return structuredClone({ [key]: data[key] }); },
    /** Mimics Chrome's independent structured-clone writes. */
    async set(values: Record<string, unknown>): Promise<void> { Object.assign(data, structuredClone(values)); },
  };
  const store = new JevLogStore(storage);
  await Promise.all([store.record(1, record("one")), store.record(1, record("one", "success", 0.00012345)), store.record(2, record("other"))]);
  const restored = new JevLogStore(storage);
  assert.equal((await restored.read(1)).entries.length, 1);
  assert.equal(totalJevCost((await restored.read(1)).entries), 0.00012345);
  await restored.record(1, record("pending"));
  await Promise.all([restored.clear(1), restored.record(1, record("pending", "success", 1))]);
  assert.deepEqual((await restored.read(1)).entries, []);
  assert.equal((await restored.read(2)).entries[0]?.id, "other");
  for (let index = 0; index < 105; index++) await restored.record(1, record(`request-${index}`));
  assert.equal((await new JevLogStore(storage).read(1)).entries.length, 105);
}
test("saved Jev histories survive reloads, isolate tabs and clear pending responses", persistence);

/** Adds only actual nonnegative provider costs, including charges on canceled calls. */
function costs(): void {
  const entries = [record("one", "success", 0.001), record("two", "canceled", 0.002), record("pending"), record("missing", "error"), record("invalid", "success", "1"), record("negative", "error", -1)];
  assert.equal(totalJevCost(entries), 0.003);
  assert.equal(totalJevCost([]), 0);
}
test("cost totals use reported usage without inventing prices for missing responses", costs);
