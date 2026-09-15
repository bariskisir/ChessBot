/** Restores probability-based safe mistakes using only local Stockfish searches. */
import { Chess } from "chess.js";
import { analyzePosition } from "./engine-client";
import type { Settings, Variation } from "./shared";
export type MistakeType = "ideal" | "suboptimal";
export interface MistakeResult { move: string; score: number; type: MistakeType }

/** Converts White-relative evaluations into a comparable score for the player. */
export function playerScore(variation: Variation | undefined, color: "w" | "b"): number {
  if (!variation) return 0;
  const whiteScore = variation.mate !== null ? Math.sign(variation.mate) * 100 : variation.score;
  return color === "w" ? whiteScore : -whiteScore;
}

/** Chooses the weakest non-losing candidate, prioritizing the zero-to-1.5 window. */
export function chooseMistake(current: MistakeResult | null, move: string, score: number): MistakeResult | null {
  if (score < 0) return current;
  if (score <= 1.5) return { move, score, type: "ideal" };
  if (current?.type === "ideal") return current;
  return !current || score < current.score ? { move, score, type: "suboptimal" } : current;
}

/** Rechecks shallow candidates at the configured depth before accepting a safe mistake. */
export async function findMistake(fen: string, color: "w" | "b", settings: Settings, signal: AbortSignal, bestMove: string): Promise<MistakeResult | null> {
  const candidates = await analyzePosition(fen, { ...settings, depth: 1, lines: 3 }, signal);
  let selected: MistakeResult | null = null;
  for (const candidate of candidates.variations) {
    const move = candidate.moves[0];
    if (!move || move === bestMove) continue;
    signal.throwIfAborted();
    const chess = new Chess(fen);
    try { chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] ?? "q" }); } catch { continue; }
    if (chess.isCheckmate()) continue;
    const result = await analyzePosition(chess.fen(), { ...settings, lines: 1 }, signal);
    if (!result.variations[0] && !chess.isDraw()) continue;
    selected = chooseMistake(selected, move, playerScore(result.variations[0], color));
    if (selected?.type === "ideal") return selected;
  }
  return selected;
}
