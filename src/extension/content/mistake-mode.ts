/**
 * Finds intentionally suboptimal moves when mistake mode is enabled and safe.
 */
import type { BotSettings, EngineAnalysis, MistakeCache, MistakeResult, PlayerColor } from "../shared/types";
import { makeMove } from "./chessboard";
import { askLocalStockfish } from "./engine-client";

/**
 * Converts mate scores into large centipawn-like values for comparisons.
 */
function scoreForComparison(analysis: EngineAnalysis): number {
  if (analysis.mate) {
    return analysis.mate > 0 ? 100 : -100;
  }

  return analysis.eval ?? 0;
}

/**
 * Returns whether the evaluated continuation is still not losing for the user.
 */
function isStillSafeForUser(evalValue: number, userColor: PlayerColor): boolean {
  return userColor === "w" ? evalValue >= 0 : evalValue <= 0;
}

/**
 * Returns whether a safe mistake reaches the target evaluation window.
 */
function isIdealMistake(evalValue: number, userColor: PlayerColor): boolean {
  return userColor === "w" ? evalValue <= 1.5 : evalValue >= -1.5;
}

/**
 * Chooses the worse of two safe suboptimal moves from the user's perspective.
 */
function chooseWorseSuboptimal(
  current: MistakeResult | null,
  candidate: MistakeResult,
  userColor: PlayerColor,
): MistakeResult {
  if (!current) {
    return candidate;
  }

  const currentEval = current.eval ?? 0;
  const candidateEval = candidate.eval ?? 0;

  if (userColor === "w") {
    return candidateEval < currentEval ? candidate : current;
  }

  return candidateEval > currentEval ? candidate : current;
}

/**
 * Creates or reuses the mistake cache for the current position.
 */
export function getMistakeCache(
  existingCache: MistakeCache | undefined,
  fen: string,
  userColor: PlayerColor,
  evalValue: number,
  settings: BotSettings,
): MistakeCache {
  if (existingCache?.fen === fen) {
    return existingCache;
  }

  const shouldTrigger = settings.mistakeProbability > 0 && Math.random() * 100 < settings.mistakeProbability;
  const isWinning = (userColor === "w" && evalValue > 1.5) || (userColor === "b" && evalValue < -1.5);

  return {
    fen,
    shouldTrigger,
    isWinning,
    processed: false,
    result: null,
  };
}

/**
 * Searches lower-ranked Stockfish lines for a safe mistake candidate.
 */
export async function findMistake(
  fen: string,
  userColor: PlayerColor,
  settings: BotSettings,
): Promise<MistakeResult | null> {
  const multiPvData = await askLocalStockfish(fen, 1, 3);
  const candidates = Array.isArray(multiPvData) ? multiPvData : [multiPvData];
  let bestSuboptimal: MistakeResult | null = null;

  for (const candidate of candidates) {
    if (!candidate.move) {
      continue;
    }

    const nextFen = makeMove(fen, candidate.move);

    if (!nextFen) {
      continue;
    }

    const analysisData = await askLocalStockfish(nextFen, settings.depth);
    const analysis = Array.isArray(analysisData) ? analysisData[0] : analysisData;
    const evalValue = scoreForComparison(analysis ?? {});

    if (!isStillSafeForUser(evalValue, userColor)) {
      continue;
    }

    if (isIdealMistake(evalValue, userColor)) {
      return { move: candidate.move, type: "ideal" };
    }

    bestSuboptimal = chooseWorseSuboptimal(
      bestSuboptimal,
      { move: candidate.move, eval: evalValue, type: "suboptimal" },
      userColor,
    );
  }

  return bestSuboptimal;
}
