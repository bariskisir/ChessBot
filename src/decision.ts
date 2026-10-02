/** Shares legal move choices, cancellation and masked traffic across decision providers. */
import { Chess } from "chess.js";
import type { Analysis } from "./shared";
import { redactLog, type JevLog } from "./jev-log";

export interface MoveDecision {
  model?: string;
  state: string;
  questions: { move: { type: "choice"; instructions: string; criteria: Record<string, string> } };
}
interface DecisionProvider {
  name: string; service: string; url: string;
  buildDecision: (fen: string) => MoveDecision;
}
interface DecisionRequest {
  url: string; method: "POST" | "GET"; body?: unknown;
}

/** Keeps submitted UCI moves and their state descriptions aligned with provider limits. */
export function buildMoveDecision(fen: string, maxOptions?: number): MoveDecision {
  const chess = new Chess(fen);
  const criteria: Record<string, string> = {};
  for (const move of chess.moves({ verbose: true }).slice(0, maxOptions)) {
    criteria[`${move.from}${move.to}${move.promotion ?? ""}`] = move.san;
  }
  if (Object.keys(criteria).length === 0) throw new Error("No legal moves in this position.");
  return {
    state: `Choose the strongest chess move for ${chess.turn() === "w" ? "White" : "Black"} to play.\nFEN: ${fen}\nLegal moves (UCI: SAN): ${JSON.stringify(criteria)}`,
    questions: { move: { type: "choice", instructions: "Select exactly one legal move that gives the side to move the best winning chances. Consider checks, captures, threats, king safety and material.", criteria } },
  };
}

/** Rejects malformed or out-of-list decisions instead of playing a fallback move. */
export function parseMoveDecision(payload: unknown, fen: string, legalMoves: string[], provider: string): Analysis {
  const data = payload as { answers?: { move?: { choice?: unknown } } } | null;
  const move = data?.answers?.move?.choice;
  if (typeof move !== "string" || !legalMoves.includes(move)) throw new Error(`${provider} did not return a legal move. Press START to retry.`);
  return { fen, bestMove: move, variations: [] };
}

/** Logs each HTTP exchange and validates its payload before marking it successful. */
export async function requestDecision<T>(request: DecisionRequest, apiKey: string, signal: AbortSignal, service: string, readResponse: (payload: unknown) => T, fetcher: typeof fetch = fetch, onLog?: (entry: JevLog) => void): Promise<T> {
  signal.throwIfAborted();
  if (!apiKey.trim()) throw new Error(`Enter ${service === "OpenRouter" ? "an" : "a"} ${service} API key in Settings.`);
  const started = Date.now();
  const headers = { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" };
  const entry: JevLog = {
    id: crypto.randomUUID(), startedAt: new Date(started).toISOString(), durationMs: null, status: "pending",
    request: { url: request.url, method: request.method, headers: { ...headers, Authorization: "Bearer [REDACTED]" }, body: request.body ?? null },
    response: null, error: null,
  };
  onLog?.(redactLog(entry, apiKey));
  try {
    const init: RequestInit = { method: request.method, headers, signal };
    if (request.body !== undefined) init.body = JSON.stringify(request.body);
    const response = await fetcher(request.url, init);
    entry.response = { status: response.status, headers: Object.fromEntries(response.headers), body: null };
    const raw = await response.text();
    let payload: unknown = raw;
    try { payload = JSON.parse(raw); } catch { /* Preserve non-JSON provider errors verbatim. */ }
    entry.response.body = payload;
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`${service} request failed (HTTP ${response.status}). Check your API key and connection; see the logs for details.`);
    const result = readResponse(payload);
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

/** Uses the provider's schema and submitted move list to validate a direct decision. */
export async function analyzeDecision(fen: string, apiKey: string, signal: AbortSignal, provider: DecisionProvider, fetcher: typeof fetch = fetch, onLog?: (entry: JevLog) => void): Promise<Analysis> {
  signal.throwIfAborted();
  if (!apiKey.trim()) throw new Error(`Enter ${provider.service === "OpenRouter" ? "an" : "a"} ${provider.service} API key in Settings.`);
  const body = provider.buildDecision(fen);
  return requestDecision({ url: provider.url, method: "POST", body }, apiKey, signal, provider.service,
    /** Rejects choices outside this request before their traffic is marked successful. */
    (payload) => parseMoveDecision(payload, fen, Object.keys(body.questions.move.criteria), provider.name), fetcher, onLog);
}
