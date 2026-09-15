/** Picks a deliberately average-quality move from the engine's MultiPV list. */
import { playerScore } from "./mistake-mode";
import type { Variation } from "./shared";

/** Picks the non-losing variation whose score sits closest to the group average. */
export function chooseAverageMove(variations: Variation[], color: "w" | "b"): string | null {
  const candidates: { move: string; score: number }[] = [];
  let total = 0;
  for (const variation of variations) {
    const move = variation.moves[0];
    if (!move) continue;
    const score = playerScore(variation, color);
    if (score < 0) continue;
    candidates.push({ move, score });
    total += score;
  }
  const [first, ...rest] = candidates;
  if (!first) return null;
  if (rest.length === 0) return first.move;
  const average = total / candidates.length;
  let chosen = first;
  for (const candidate of rest) if (Math.abs(candidate.score - average) <= Math.abs(chosen.score - average)) chosen = candidate;
  return chosen.move;
}
