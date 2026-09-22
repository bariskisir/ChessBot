/** Picks a deliberately average-quality move from the engine's MultiPV list. */
import { Chess } from "chess.js";
import { evaluatePosition, playerScore } from "./mistake-mode";
import type { Settings, Variation } from "./shared";

/** Ranks non-losing variations from closest-to-average to farthest. */
export function rankAverageMoves(variations: Variation[], color: "w" | "b"): string[] {
  const scored: { move: string; score: number; order: number }[] = [];
  let total = 0;
  for (const variation of variations) {
    const move = variation.moves[0];
    if (!move) continue;
    const score = playerScore(variation, color);
    if (score < 0) continue;
    scored.push({ move, score, order: scored.length });
    total += score;
  }
  if (scored.length === 0) return [];
  const average = total / scored.length;
  /** Orders candidates by closeness to the average score. */
  const byCloseness = (left: { score: number; order: number }, right: { score: number; order: number }): number =>
    Math.abs(left.score - average) - Math.abs(right.score - average) || right.order - left.order;
  /** Keeps only the move text for the controller. */
  const toMove = (candidate: { move: string }): string => candidate.move;
  return scored.sort(byCloseness).map(toMove);
}

/** Picks the non-losing variation whose score sits closest to the group average. */
export function chooseAverageMove(variations: Variation[], color: "w" | "b"): string | null {
  return rankAverageMoves(variations, color)[0] ?? null;
}

/** Plays the first average-ranked move whose deep score stays at or above zero. */
export async function chooseVerifiedAverageMove(fen: string, variations: Variation[], color: "w" | "b", settings: Settings, signal: AbortSignal): Promise<string | null> {
  for (const candidate of rankAverageMoves(variations, color)) {
    signal.throwIfAborted();
    const chess = new Chess(fen);
    try { chess.move({ from: candidate.slice(0, 2), to: candidate.slice(2, 4), promotion: candidate[4] ?? "q" }); } catch { continue; }
    if (chess.isCheckmate()) return candidate;
    const verified = await evaluatePosition(chess.fen(), settings, signal);
    if (!verified && !chess.isDraw()) continue;
    if (playerScore(verified, color) >= 0) return candidate;
  }
  return null;
}
