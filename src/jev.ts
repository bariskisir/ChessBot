/** Selects legal chess moves through OpenRouter Decisions for any catalogue model. */
import { analyzeDecision, buildMoveDecision, parseMoveDecision, type MoveDecision } from "./decision";
import type { Analysis } from "./shared";
import type { JevLog } from "./jev-log";

export const JEV_URL = "https://openrouter.ai/api/alpha/decisions";

/** Engine option sharing the OpenRouter Decisions transport and API key. */
export type OpenRouterEngine = "openrouter";

/** Checks whether an engine option uses the shared OpenRouter Decisions transport. */
export function isOpenRouterEngine(engine: string): engine is OpenRouterEngine {
  return engine === "openrouter";
}

/** Derives the display name used in errors and logs from any catalogue slug. */
export function openRouterName(model: string): string {
  const slug = model.trim();
  if (!slug) return "OpenRouter";
  const short = slug.includes("/") ? slug.slice(slug.lastIndexOf("/") + 1) : slug;
  return short || slug;
}

/** Adds the selected catalogue model to the complete legal move choice. */
export function buildOpenRouterDecision(model: string, fen: string): MoveDecision {
  return { model, ...buildMoveDecision(fen) };
}

/** Validates an OpenRouter choice without inventing an evaluation or fallback. */
export function parseOpenRouterDecision(model: string, payload: unknown, fen: string, legalMoves: string[]): Analysis {
  return parseMoveDecision(payload, fen, legalMoves, openRouterName(model));
}

/** Uses only OpenRouter credentials and the Decisions endpoint for the selected model. */
export async function analyzeOpenRouter(model: string, fen: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onLog?: (entry: JevLog) => void): Promise<Analysis> {
  if (!model.trim()) throw new Error("Select an OpenRouter model in Settings.");
  const name = openRouterName(model);
  return analyzeDecision(fen, apiKey, signal, { name, service: "OpenRouter", url: JEV_URL,
    /** Builds the selected model's move choice for this position. */
    buildDecision: (position) => buildOpenRouterDecision(model, position) }, fetcher, onLog);
}
