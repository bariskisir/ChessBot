/** Applies legal Lichess moves through cancelable trusted input and promotion choices. */
import { Chess } from "chess.js";
import { delay } from "../engine-client";
import { sendTrustedInput } from "../input-client";
import type { InputPoint } from "../input-protocol";
import { canPlay, getBoard, readPlacement, readPosition } from "./lichess-board";
import { lichessBoard, squarePoint, type LichessBoard } from "./lichess-dom";
import { placementOf, samePosition } from "./position";

const promotionRoles: Readonly<Record<string, string>> = { q: "queen", r: "rook", b: "bishop", n: "knight" };

/** Interpolates one short gesture while leaving Chrome input ownership to the service worker. */
async function drag(from: InputPoint, to: InputPoint, signal: AbortSignal, animate: boolean): Promise<void> {
  const points = [from], steps = animate ? 6 : 2;
  for (let index = 1; index <= steps; index++) points.push({ x: from.x + (to.x - from.x) * index / steps, y: from.y + (to.y - from.y) * index / steps });
  await sendTrustedInput({ kind: "drag", points, interval: animate ? 18 : 8 }, signal);
}

/** Finds a visible chooser option without sending a click to a hidden square. */
function promotionOption(context: LichessBoard, role: string): HTMLElement | null {
  const piece = promotionRoles[role];
  if (!piece) return null;
  for (const choice of context.root.querySelectorAll<HTMLElement>(".main-board #promotion-choice square")) {
    if (choice.getClientRects().length && choice.querySelector(`piece.${piece}`)) return choice;
  }
  return null;
}

/** Confirms promotion placement and rejects a replaced board before another chooser click. */
async function finishPromotion(context: LichessBoard, role: string, expected: string, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 6000;
  let nextClick = 0;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (getBoard() !== context.board) throw new Error("Lichess board changed during promotion.");
    if (readPlacement(context) === expected && !context.root.querySelector("#promotion-choice")) return;
    const option = promotionOption(context, role);
    if (option && Date.now() >= nextClick) {
      const rect = option.getBoundingClientRect();
      await sendTrustedInput({ kind: "click", point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } }, signal);
      nextClick = Date.now() + 400;
    }
    await delay(50, signal);
  }
  throw new Error("Lichess promotion was not accepted.");
}

/** Lichess chooser handling belongs to the originating move operation. */
export function canResumePromotion(): boolean { return false; }

/** Rejects recovery without the originating move and its expected final placement. */
export async function resumePromotion(_moveHint: string, _signal: AbortSignal): Promise<void> {
  throw new Error("Restart analysis to retry a Lichess promotion.");
}

/** Validates position state immediately before sending a trusted drag. */
export async function playMove(fen: string, move: string, signal: AbortSignal, animateMoves = false): Promise<boolean> {
  signal.throwIfAborted();
  const context = lichessBoard();
  if (!context || !samePosition(readPosition() ?? "", fen) || !canPlay(fen)) return false;
  const game = new Chess(fen);
  try { game.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] ?? "q" }); } catch { return false; }
  await drag(squarePoint(move.slice(0, 2), context), squarePoint(move.slice(2, 4), context), signal, animateMoves);
  if (move[4]) await finishPromotion(context, move[4], placementOf(game.fen()), signal);
  return true;
}
