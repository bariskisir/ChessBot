/** Selects a legal move through Laya API's cancelable job queue. */
import { buildMoveDecision, parseMoveDecision, requestDecision, type MoveDecision } from "./decision";
import { delay } from "./engine-client";
import type { Analysis } from "./shared";
import type { JevLog } from "./jev-log";

export const LAYA_BASE_URL = "https://laya-api.de/api/v1";
export const LAYA_URL = `${LAYA_BASE_URL}/systemone?wait=10`;
export const LAYA_MODEL = "laya-latest";
interface LayaJob { id: string; result: Analysis | null }

/** Sends the first 50 legal moves in generation order with the required model alias. */
export function buildLayaDecision(fen: string): MoveDecision {
  return { model: LAYA_MODEL, ...buildMoveDecision(fen, 50) };
}

/** Validates job identity and terminal status before accepting its nested move decision. */
function readJob(payload: unknown, fen: string, legalMoves: string[], expectedId?: string): LayaJob {
  const job = payload as { id?: unknown; object?: unknown; status?: unknown; result?: unknown } | null;
  if (!job || job.object !== "job" || typeof job.id !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(job.id) || expectedId !== undefined && job.id !== expectedId) {
    throw new Error("Laya returned an invalid job. Press START to retry.");
  }
  if (job.status === "failed") throw new Error("Laya job failed. See laya-logs for details and press START to retry.");
  if (job.status === "completed") return { id: job.id, result: parseMoveDecision(job.result, fen, legalMoves, "Laya") };
  if (job.status !== "queued" && job.status !== "processing") throw new Error("Laya returned an invalid job status. Press START to retry.");
  return { id: job.id, result: null };
}

/** Polls queued jobs with abortable waits and handles forced moves without an invalid choice. */
export async function analyzeLaya(fen: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onLog?: (entry: JevLog) => void): Promise<Analysis> {
  signal.throwIfAborted();
  if (!apiKey.trim()) throw new Error("Enter a Laya API key in Settings.");
  const body = buildLayaDecision(fen);
  const legalMoves = Object.keys(body.questions.move.criteria);
  const onlyMove = legalMoves[0];
  if (legalMoves.length === 1 && onlyMove) return { fen, bestMove: onlyMove, variations: [] };
  let job = await requestDecision({ url: LAYA_URL, method: "POST", body }, apiKey, signal, "Laya",
    /** Parses completed or queued replies inside their logged HTTP exchange. */
    (payload) => readJob(payload, fen, legalMoves), fetcher, onLog);
  while (!job.result) {
    await delay(1000, signal);
    const id = job.id;
    job = await requestDecision({ url: `${LAYA_BASE_URL}/jobs/${encodeURIComponent(id)}`, method: "GET" }, apiKey, signal, "Laya",
      /** Prevents unrelated jobs and unsubmitted moves from completing this position. */
      (payload) => readJob(payload, fen, legalMoves, id), fetcher, onLog);
  }
  signal.throwIfAborted();
  return job.result;
}
