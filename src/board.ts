/** Exposes common board operations while selecting the current site's provider. */
import { currentProvider } from "./providers";
import type { MistakeType } from "./mistake-mode";
import type { GameClock } from "./providers/clock";
import { samePosition, type PlayerPosition } from "./providers/position";
export { samePosition } from "./providers/position";

/** Finds the board belonging to the current provider. */
export function getBoard(): HTMLElement | null { return currentProvider()?.getBoard() ?? null; }
/** Reads a validated current position. */
export function readPosition(): string | null { return currentProvider()?.readPosition() ?? null; }
/** Reads the side controlled by the user. */
export function userColor(): "w" | "b" { return currentProvider()?.userColor() ?? "w"; }
/** Reads only a visible match clock from the current site. */
export function readClock(): GameClock | null { return currentProvider()?.readClock() ?? null; }
/** Detects a drag or promotion chooser. */
export function boardBusy(): boolean { return currentProvider()?.boardBusy() ?? false; }
/** Removes ChessBot's suggestions. */
export function clearHighlights(): void { currentProvider()?.clearHighlights(); }
/** Marks a suggested move. */
export function highlight(move: string, mistake?: MistakeType): void { currentProvider()?.highlight(move, mistake); }
/** Restricts automatic moves to the player's turn. */
export function canPlay(fen: string): boolean { return currentProvider()?.canPlay(fen) ?? false; }
/** Finds an interrupted promotion supported by the current provider. */
export function canResumePromotion(): boolean { return currentProvider()?.canResumePromotion() ?? false; }
/** Completes an interrupted promotion. */
export async function resumePromotion(moveHint: string, signal: AbortSignal): Promise<void> { await currentProvider()?.resumePromotion(moveHint, signal); }
/** Sends a legal move to the current site. */
export async function playMove(fen: string, move: string, signal: AbortSignal, animateMoves = false): Promise<boolean> {
  return await currentProvider()?.playMove(fen, move, signal, animateMoves) ?? false;
}
/** Revalidates ownership as well as legal position state before using an asynchronous result. */
export function isCurrentPosition(position: PlayerPosition): boolean {
  return samePosition(readPosition() ?? "", position.fen) && userColor() === position.player;
}
