/** Selects local-engine moves with Stockfish 19 evaluation on initial and retry searches. */
import { Chess } from "chess.js";
import { isCurrentPosition } from "./board";
import { analyzePosition } from "./engine-client";
import { EVALUATION_ENGINE, getEngine } from "./engines";
import { evaluatePosition, findMistake, playerScore } from "./mistake-mode";
import { chooseMatingMove, chooseVerifiedAverageMove } from "./move-selection";
import type { PlayerPosition } from "./providers/position";
import type { Settings, Variation } from "./shared";
import type { MoveSelectionBudget } from "./timing/move-selection-budget";

export interface MoveChoice { move: string; mistake: boolean; evaluation: Variation | undefined }
export interface MoveProgress { status: string; color: string; move?: string; evaluation?: Variation }
export type ReportProgress = (progress: MoveProgress) => void;

/** Publishes Stockfish scores before move selection can consume the current turn budget. */
export async function analyzeMove(position: PlayerPosition, settings: Settings, signal: AbortSignal, report: ReportProgress, budget?: MoveSelectionBudget): Promise<MoveChoice | null> {
  const { fen, player } = position;
  signal.throwIfAborted();
  if (new Chess(fen).turn() !== player) return null;
  let evaluation: Variation | undefined;
  if (settings.engine !== EVALUATION_ENGINE.id || settings.depth < EVALUATION_ENGINE.verificationDepth || budget?.getSearchDeadline() != null) {
    report({ status: "Evaluating position...", color: "#3b82f6" });
    evaluation = await evaluatePosition(fen, settings, signal, budget?.getEvaluationDeadline);
    if (!isCurrentPosition(position)) return null;
    if (evaluation) {
      budget?.rememberEvaluation(evaluation);
      report({ status: "Thinking...", color: "#3b82f6", evaluation });
    }
  }
  report({ status: "Thinking...", color: "#3b82f6" });
  const result = await analyzePosition(fen, { ...settings, lines: settings.averageMove ? settings.lines : 1 }, signal, budget?.getSearchDeadline);
  if (!isCurrentPosition(position)) return null;
  const mainVariation = result.variations[0];
  if ((!mainVariation || mainVariation.depth < settings.depth && mainVariation.mate === null && new Chess(fen).moves().length > 1) && !result.timeLimited) {
    throw new Error(`${getEngine(settings.engine).name} reached depth ${mainVariation?.depth ?? 0}, below the selected depth ${settings.depth}. Move withheld.`);
  }
  if (settings.engine === EVALUATION_ENGINE.id && mainVariation && (!evaluation || mainVariation.depth >= evaluation.depth)) evaluation = mainVariation;
  if (evaluation) {
    budget?.rememberEvaluation(evaluation);
    report({ status: "Thinking...", color: "#3b82f6", evaluation });
  }
  budget?.remember({ move: result.bestMove, mistake: false, evaluation });
  const matingMove = settings.averageMove ? chooseMatingMove([...result.variations, ...(evaluation ? [evaluation] : [])], player) : null;
  let move = matingMove ?? result.bestMove, mistake = false;
  if (settings.averageMove && !matingMove) {
    report({ status: "Verifying average move...", color: "#3b82f6" });
    move = await chooseVerifiedAverageMove(fen, result.variations, player, settings, signal, budget?.getSearchDeadline) ?? move;
  }
  budget?.remember({ move, mistake, evaluation });
  const score = evaluation ? playerScore(evaluation, player) : 0;
  if (!matingMove && evaluation && score >= settings.mistakeKeep && Math.random() * 100 < settings.mistakeProbability) {
    report({ status: "Attempting to find mistake...", color: "#f59e0b" });
    const candidate = await findMistake(fen, player, settings, signal, result.bestMove, score, budget?.getSearchDeadline);
    if (candidate) { move = candidate.move; mistake = true; }
  }
  signal.throwIfAborted();
  budget?.remember({ move, mistake, evaluation });
  return isCurrentPosition(position) ? { move, mistake, evaluation } : null;
}
