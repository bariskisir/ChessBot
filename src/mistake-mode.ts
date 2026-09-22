/** Restores probability-based safe mistakes using only local Stockfish searches. */
import { Chess } from "chess.js";
import { analyzePosition } from "./engine-client";
import type { Settings, Variation } from "./shared";
export type MistakeType = "mistake";
export interface MistakeResult { move: string; score: number; type: MistakeType }

/** Converts White-relative evaluations into a comparable score for the player. */
export function playerScore(variation: Variation | undefined, color: "w" | "b"): number {
  if (!variation) return 0;
  const whiteScore = variation.mate !== null ? Math.sign(variation.mate) * 100 : variation.score;
  return color === "w" ? whiteScore : -whiteScore;
}

/** Keeps the weakest candidate that never drops the player below the keep floor. */
export function chooseMistake(current: MistakeResult | null, move: string, score: number, keep: number): MistakeResult | null {
  if (score < keep) return current;
  return !current || score < current.score ? { move, score, type: "mistake" } : current;
}

/** Reads the authoritative position score from a deep single-line search without choosing a move. */
export async function evaluatePosition(fen: string, settings: Settings, signal: AbortSignal): Promise<Variation | undefined> {
  const result = await analyzePosition(fen, { ...settings, depth: 15, lines: 1 }, signal);
  return result.variations[0];
}

/** Scans ten depth-3 candidates and rechecks each survivor at full depth before accepting a mistake. */
export async function findMistake(fen: string, color: "w" | "b", settings: Settings, signal: AbortSignal, bestMove: string, currentScore: number): Promise<MistakeResult | null> {
  const candidates = await analyzePosition(fen, { ...settings, depth: 3, lines: 10 }, signal);
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
    const score = playerScore(result.variations[0], color);
    if (score >= currentScore) continue;
    selected = chooseMistake(selected, move, score, settings.mistakeKeep);
    if (selected && selected.score <= settings.mistakeKeep) return selected;
  }
  return selected;
}
