/** Selects a legal chess move through OpenRouter's Jev Decisions API. */
import { analyzeDecision, buildMoveDecision, parseMoveDecision, type MoveDecision } from "./decision";
import type { Analysis } from "./shared";
import type { JevLog } from "./jev-log";

export const JEV_MODEL = "~typesafe/jev-latest";
export const JEV_URL = "https://openrouter.ai/api/alpha/decisions";

/** Adds the OpenRouter model alias to the complete legal move choice. */
export function buildDecision(fen: string): MoveDecision {
  return { model: JEV_MODEL, ...buildMoveDecision(fen) };
}

/** Preserves Jev's validation error without inventing an evaluation or fallback. */
export function parseDecision(payload: unknown, fen: string, legalMoves: string[]): Analysis {
  return parseMoveDecision(payload, fen, legalMoves, "Jev");
}

/** Uses only OpenRouter credentials and the Jev endpoint for this decision. */
export function analyzeJev(fen: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onLog?: (entry: JevLog) => void): Promise<Analysis> {
  return analyzeDecision(fen, apiKey, signal, { name: "Jev", service: "OpenRouter", url: JEV_URL, buildDecision }, fetcher, onLog);
}
