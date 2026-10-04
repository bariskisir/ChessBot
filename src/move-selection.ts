/** Preserves forced mates before picking average-quality moves from the engine's MultiPV list. */
import { Chess } from "chess.js";
import { evaluatePosition, playerScore } from "./mistake-mode";
import type { SearchDeadline, Settings, Variation } from "./shared";

/** Keeps the shortest winning mate, with engine order breaking equal-length ties. */
export function chooseMatingMove(variations: Variation[], color: "w" | "b"): string | null {
  let move: string | null = null, shortest = Infinity;
  for (const variation of variations) {
    const candidate = variation.moves[0];
    if (!candidate || variation.mate === null) continue;
    const mate = color === "w" ? variation.mate : -variation.mate;
    if (mate > 0 && mate < shortest) { move = candidate; shortest = mate; }
  }
  return move;
}

/** Preserves a winning mate or ranks non-losing variations by closeness to the average. */
export function rankAverageMoves(variations: Variation[], color: "w" | "b"): string[] {
  const matingMove = chooseMatingMove(variations, color);
  if (matingMove) return [matingMove];
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

/** Picks a winning mate before considering the closest non-losing score to the average. */
export function chooseAverageMove(variations: Variation[], color: "w" | "b"): string | null {
  return rankAverageMoves(variations, color)[0] ?? null;
}

/** Verifies average-ranked moves without extending the current turn's search deadline. */
export async function chooseVerifiedAverageMove(fen: string, variations: Variation[], color: "w" | "b", settings: Settings, signal: AbortSignal, getDeadline?: SearchDeadline): Promise<string | null> {
  signal.throwIfAborted();
  const matingMove = chooseMatingMove(variations, color);
  if (matingMove) return matingMove;
  for (const candidate of rankAverageMoves(variations, color)) {
    signal.throwIfAborted();
    const chess = new Chess(fen);
    try { chess.move({ from: candidate.slice(0, 2), to: candidate.slice(2, 4), promotion: candidate[4] ?? "q" }); } catch { continue; }
    if (chess.isCheckmate()) return candidate;
    const verified = await evaluatePosition(chess.fen(), settings, signal, getDeadline);
    if (!verified && !chess.isDraw()) continue;
    if (playerScore(verified, color) >= 0) return candidate;
  }
  return null;
}
