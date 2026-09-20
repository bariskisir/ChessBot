/** Selects a legal chess move through OpenRouter's Jev Decisions API. */
import { Chess } from "chess.js";
import type { Analysis } from "./shared";
import { redactLog, type JevLog } from "./jev-log";

export const JEV_MODEL = "~typesafe/jev-latest";
export const JEV_URL = "https://openrouter.ai/api/alpha/decisions";

/** Restricts the decision to locally generated UCI moves, including promotions. */
export function buildDecision(fen: string) {
  const chess = new Chess(fen);
  const criteria: Record<string, string> = {};
  for (const move of chess.moves({ verbose: true })) {
    criteria[`${move.from}${move.to}${move.promotion ?? ""}`] = move.san;
  }
  if (Object.keys(criteria).length === 0) throw new Error("No legal moves in this position.");
  return {
    model: JEV_MODEL,
    state: `Choose the strongest chess move for ${chess.turn() === "w" ? "White" : "Black"} to play.\nFEN: ${fen}\nLegal moves (UCI: SAN): ${JSON.stringify(criteria)}`,
    questions: { move: { type: "choice", instructions: "Select exactly one legal move that gives the side to move the best winning chances. Consider checks, captures, threats, king safety and material.", criteria } },
  };
}

/** Rejects malformed or out-of-list decisions instead of playing a fallback move. */
export function parseDecision(payload: unknown, fen: string, legalMoves: string[]): Analysis {
  const data = payload as { answers?: { move?: { choice?: unknown } } } | null;
  const move = data?.answers?.move?.choice;
  if (typeof move !== "string" || !legalMoves.includes(move)) throw new Error("Jev did not return a legal move. Press START to retry.");
  return { fen, bestMove: move, variations: [] };
}

/** Captures masked traffic, including failed responses, without changing move validation. */
export async function analyzeJev(fen: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onLog?: (entry: JevLog) => void): Promise<Analysis> {
  signal.throwIfAborted();
  if (!apiKey.trim()) throw new Error("Enter an OpenRouter API key in Settings.");
  const body = buildDecision(fen);
  const started = Date.now();
  const entry: JevLog = {
    id: crypto.randomUUID(), startedAt: new Date(started).toISOString(), durationMs: null, status: "pending",
    request: { url: JEV_URL, method: "POST", headers: { Authorization: "Bearer [REDACTED]", "Content-Type": "application/json" }, body },
    response: null, error: null,
  };
  onLog?.(redactLog(entry, apiKey));
  try {
    const response = await fetcher(JEV_URL, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal,
    });
    entry.response = { status: response.status, headers: Object.fromEntries(response.headers), body: null };
    const raw = await response.text();
    let payload: unknown = raw;
    try { payload = JSON.parse(raw); } catch { /* Preserve non-JSON provider errors verbatim. */ }
    entry.response.body = payload;
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`OpenRouter request failed (HTTP ${response.status}). Check your API key, credit and connection.`);
    const result = parseDecision(payload, fen, Object.keys(body.questions.move.criteria));
    entry.status = "success";
    return result;
  } catch (error) {
    entry.status = signal.aborted ? "canceled" : "error";
    entry.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    entry.durationMs = Date.now() - started;
    onLog?.(redactLog(entry, apiKey));
  }
}
