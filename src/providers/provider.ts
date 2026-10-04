/** Describes the board and game controls supplied by one chess website. */
import type { MistakeType } from "../mistake-mode";
import type { Settings } from "../shared";
import type { GameClock } from "./clock";

export type GameAction = { button: HTMLElement } & (
  { kind: "round"; name: "New Game" | "Rematch"; resumeOnNavigation?: true } |
  { kind: "arena"; name: "Next Arena Game" } |
  { kind: "puzzle"; name: "View Solution" | "Continue Training" }
);

export interface Provider {
  readonly name: "chess.com" | "lichess.org";
  readonly mutationSelector: string;
  readonly resumeAfterNavigation?: true;
  getBoard(): HTMLElement | null;
  readPosition(): string | null;
  userColor(): "w" | "b";
  readClock(): GameClock | null;
  canPlay(fen: string): boolean;
  boardBusy(): boolean;
  clearHighlights(): void;
  highlight(move: string, mistake?: MistakeType): void;
  canResumePromotion(): boolean;
  resumePromotion(moveHint: string, signal: AbortSignal): Promise<void>;
  playMove(fen: string, move: string, signal: AbortSignal, animateMoves?: boolean): Promise<boolean>;
  findGameAction(settings: Settings): GameAction | null;
}
