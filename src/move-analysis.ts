/** Selects moves with authoritative evaluation and the same settings on initial and retry searches. */
import { Chess } from "chess.js";
import { isCurrentPosition } from "./board";
import { analyzePosition } from "./engine-client";
import { evaluatePosition, findMistake, playerScore } from "./mistake-mode";
import { chooseVerifiedAverageMove } from "./move-selection";
import type { PlayerPosition } from "./providers/position";
import type { Settings, Variation } from "./shared";

export interface MoveChoice { move: string; mistake: boolean; evaluation: Variation | undefined }
export interface MoveProgress { status: string; color: string; move?: string; evaluation?: Variation }
export type ReportProgress = (progress: MoveProgress) => void;

/** Requires the selected depth and adds deep verification only for average or mistake selection. */
export async function analyzeMove(position: PlayerPosition, settings: Settings, signal: AbortSignal, report: ReportProgress): Promise<MoveChoice | null> {
  const { fen, player } = position;
  signal.throwIfAborted();
  if (new Chess(fen).turn() !== player) return null;
  report({ status: "Thinking...", color: "#3b82f6" });
  const result = await analyzePosition(fen, { ...settings, lines: settings.averageMove ? settings.lines : 1 }, signal);
  if (!isCurrentPosition(position)) return null;
  let evaluation = result.variations[0];
  if (!evaluation || evaluation.depth < settings.depth) {
    throw new Error(`Stockfish reached depth ${evaluation?.depth ?? 0}, below the selected depth ${settings.depth}. Move withheld.`);
  }
  if (settings.depth < 15 && (settings.averageMove || settings.mistakeProbability > 0)) {
    report({ status: "Evaluating position...", color: "#3b82f6" });
    evaluation = await evaluatePosition(fen, settings, signal) ?? evaluation;
    if (!isCurrentPosition(position)) return null;
  }
  let move = result.bestMove, mistake = false;
  if (settings.averageMove) {
    report({ status: "Verifying average move...", color: "#3b82f6" });
    move = await chooseVerifiedAverageMove(fen, result.variations, player, settings, signal) ?? move;
  }
  const score = evaluation ? playerScore(evaluation, player) : 0;
  if (evaluation && score >= settings.mistakeKeep && Math.random() * 100 < settings.mistakeProbability) {
    report({ status: "Attempting to find mistake...", color: "#f59e0b" });
    const candidate = await findMistake(fen, player, settings, signal, result.bestMove, score);
    if (candidate) { move = candidate.move; mistake = true; }
  }
  signal.throwIfAborted();
  return isCurrentPosition(position) ? { move, mistake, evaluation } : null;
}
