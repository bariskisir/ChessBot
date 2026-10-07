/** Selects legal chess moves through OpenRouter Decisions for Jev, Clef, Luna and Liquid models. */
import { analyzeDecision, buildMoveDecision, parseMoveDecision, type MoveDecision } from "./decision";
import type { Analysis } from "./shared";
import type { JevLog } from "./jev-log";

export const JEV_MODEL = "~typesafe/jev-latest";
export const CLEF_MODEL = "cloudflare/clef";
export const CLEF_FLASH_MODEL = "cloudflare/clef-flash";
export const LUNA_MODEL = "openai/gpt-6-luna-decisions";
export const LIQUID_MODEL = "liquid/d1";
export const JEV_URL = "https://openrouter.ai/api/alpha/decisions";

/** Engine options sharing the OpenRouter Decisions transport and API key. */
export type OpenRouterEngine = "openrouter-jev" | "openrouter-clef" | "openrouter-clef-flash" | "openrouter-luna" | "openrouter-liquid";

/** Maps each OpenRouter engine option to its Decisions model. */
export const OPENROUTER_MODELS: Record<OpenRouterEngine, string> = {
  "openrouter-jev": JEV_MODEL,
  "openrouter-clef": CLEF_MODEL,
  "openrouter-clef-flash": CLEF_FLASH_MODEL,
  "openrouter-luna": LUNA_MODEL,
  "openrouter-liquid": LIQUID_MODEL,
};

/** Checks whether an engine option uses the shared OpenRouter Decisions transport. */
export function isOpenRouterEngine(engine: string): engine is OpenRouterEngine {
  return engine === "openrouter-jev" || engine === "openrouter-clef" || engine === "openrouter-clef-flash" || engine === "openrouter-luna" || engine === "openrouter-liquid";
}

/** Returns the display name used in errors and logs for an OpenRouter engine. */
export function openRouterName(engine: OpenRouterEngine | string): string {
  if (engine === "openrouter-clef") return "Clef";
  if (engine === "openrouter-clef-flash") return "Clef Flash";
  if (engine === "openrouter-luna") return "Luna 6";
  if (engine === "openrouter-liquid") return "Liquid D1";
  return "Jev";
}

/** Adds the selected OpenRouter model alias to the complete legal move choice. */
export function buildOpenRouterDecision(engine: OpenRouterEngine | string, fen: string): MoveDecision {
  const model = (OPENROUTER_MODELS as Record<string, string>)[engine] ?? JEV_MODEL;
  return { model, ...buildMoveDecision(fen) };
}

/** Adds the OpenRouter model alias to the complete legal move choice. */
export function buildDecision(fen: string): MoveDecision {
  return { model: JEV_MODEL, ...buildMoveDecision(fen) };
}

/** Validates an OpenRouter choice without inventing an evaluation or fallback. */
export function parseOpenRouterDecision(engine: OpenRouterEngine | string, payload: unknown, fen: string, legalMoves: string[]): Analysis {
  return parseMoveDecision(payload, fen, legalMoves, openRouterName(engine));
}

/** Preserves Jev's validation error without inventing an evaluation or fallback. */
export function parseDecision(payload: unknown, fen: string, legalMoves: string[]): Analysis {
  return parseMoveDecision(payload, fen, legalMoves, "Jev");
}

/** Uses only OpenRouter credentials and the Decisions endpoint for the selected model. */
export function analyzeOpenRouter(engine: OpenRouterEngine | string, fen: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onLog?: (entry: JevLog) => void): Promise<Analysis> {
  const name = openRouterName(engine);
  return analyzeDecision(fen, apiKey, signal, { name, service: "OpenRouter", url: JEV_URL,
    /** Builds the selected model's move choice for this position. */
    buildDecision: (position) => buildOpenRouterDecision(engine, position) }, fetcher, onLog);
}

/** Uses only OpenRouter credentials and the Jev endpoint for this decision. */
export function analyzeJev(fen: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onLog?: (entry: JevLog) => void): Promise<Analysis> {
  return analyzeOpenRouter("openrouter-jev", fen, apiKey, signal, fetcher, onLog);
}

/** Uses only OpenRouter credentials and the Clef endpoint for this decision. */
export function analyzeClef(fen: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onLog?: (entry: JevLog) => void): Promise<Analysis> {
  return analyzeOpenRouter("openrouter-clef", fen, apiKey, signal, fetcher, onLog);
}

/** Uses only OpenRouter credentials and the Clef Flash endpoint for this decision. */
export function analyzeClefFlash(fen: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onLog?: (entry: JevLog) => void): Promise<Analysis> {
  return analyzeOpenRouter("openrouter-clef-flash", fen, apiKey, signal, fetcher, onLog);
}

/** Uses only OpenRouter credentials and the Luna 6 endpoint for this decision. */
export function analyzeLuna(fen: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onLog?: (entry: JevLog) => void): Promise<Analysis> {
  return analyzeOpenRouter("openrouter-luna", fen, apiKey, signal, fetcher, onLog);
}

/** Uses only OpenRouter credentials and the Liquid D1 endpoint for this decision. */
export function analyzeLiquid(fen: string, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onLog?: (entry: JevLog) => void): Promise<Analysis> {
  return analyzeOpenRouter("openrouter-liquid", fen, apiKey, signal, fetcher, onLog);
}
