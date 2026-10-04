/** Selects local-engine mistakes whose Stockfish 19 evaluation preserves the keep floor. */
import { Chess } from "chess.js";
import { analyzePosition } from "./engine-client";
import { EVALUATION_ENGINE } from "./engines";
import type { SearchDeadline, Settings, Variation } from "./shared";
export type MistakeType = "mistake";
export interface MistakeResult { move: string; score: number; type: MistakeType }

/** Converts White-relative evaluations into a comparable score for the player. */
export function playerScore(variation: Variation | undefined, color: "w" | "b"): number {
  if (!variation) return 0;
  const whiteScore = variation.mate !== null ? Math.sign(variation.mate) * 100 : variation.score;
  return color === "w" ? whiteScore : -whiteScore;
}

/** Keeps the weakest candidate with a finite score at or above the keep floor. */
export function chooseMistake(current: MistakeResult | null, move: string, score: number, keep: number): MistakeResult | null {
  if (!Number.isFinite(score) || score < keep) return current;
  return !current || score < current.score ? { move, score, type: "mistake" } : current;
}

/** Uses Stockfish 19 at verification depth within the main search's turn deadline. */
export async function evaluatePosition(fen: string, settings: Settings, signal: AbortSignal, getDeadline?: SearchDeadline): Promise<Variation | undefined> {
  const result = await analyzePosition(fen, { ...settings, engine: EVALUATION_ENGINE.id, depth: Math.max(EVALUATION_ENGINE.verificationDepth, settings.depth), lines: 1 }, signal, getDeadline);
  return result.variations[0];
}

/** Requires completed Stockfish 19 post-move verification before an intentional mistake. */
export async function findMistake(fen: string, color: "w" | "b", settings: Settings, signal: AbortSignal, bestMove: string, currentScore: number, getDeadline?: SearchDeadline): Promise<MistakeResult | null> {
  const candidates = await analyzePosition(fen, { ...settings, depth: 3, lines: 10 }, signal, getDeadline);
  const verificationDepth = Math.max(EVALUATION_ENGINE.verificationDepth, settings.depth);
  let selected: MistakeResult | null = null;
  for (const candidate of candidates.variations) {
    const move = candidate.moves[0];
    if (!move || move === bestMove) continue;
    signal.throwIfAborted();
    const chess = new Chess(fen);
    try { chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] ?? "q" }); } catch { continue; }
    if (chess.isCheckmate()) continue;
    let score = 0;
    if (!chess.isDraw()) {
      const verified = await evaluatePosition(chess.fen(), settings, signal, getDeadline);
      if (!verified || verified.depth < verificationDepth && verified.mate === null) continue;
      score = playerScore(verified, color);
    }
    if (score >= currentScore) continue;
    selected = chooseMistake(selected, move, score, settings.mistakeKeep);
    if (selected && selected.score <= settings.mistakeKeep) return selected;
  }
  return selected;
}
