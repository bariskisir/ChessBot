/** Reconstructs Lichess positions from visible pieces, SAN history, and legal continuations. */
import { Chess, type Color } from "chess.js";
import type { MistakeType } from "../mistake-mode";
import { elementSquare, lichessBoard, lichessGameId, playerColor, roundEnded, squareIndices, type LichessBoard } from "./lichess-dom";
import { placementOf, PositionTracker, serializePlacement } from "./position";

const roles: Readonly<Record<string, string>> = { pawn: "p", knight: "n", bishop: "b", rook: "r", queen: "q", king: "k" };
const initialFen = new Chess().fen();
const tracker = new PositionTracker();
let session: { key: string; root: HTMLElement; player: Color } | null = null;

/** Keeps hidden state scoped to one round or puzzle run. */
function trackSession(context: LichessBoard): void {
  const key = `${context.mode}:${context.mode === "round" ? lichessGameId(location.pathname) : location.pathname}`;
  if (session?.key === key && session.root === context.root) return;
  tracker.reset();
  session = { key, root: context.root, player: playerColor(context) };
}

/** Keeps timed-puzzle ownership stable through manual flips and opponent replies. */
function ownedColor(context: LichessBoard): Color {
  trackSession(context);
  return context.mode === "racer" || context.mode === "storm" ? session?.player ?? playerColor(context) : playerColor(context);
}

/** Finds the active board without accepting an ended Racer board. */
export function getBoard(): HTMLElement | null { return lichessBoard()?.board ?? null; }

/** Reads player ownership independently from the board's drawing direction. */
export function userColor(): Color {
  const context = lichessBoard();
  return context ? ownedColor(context) : "w";
}

/** Excludes ghost pieces and transient drag positions from board reconstruction. */
function readCells(context: LichessBoard): Map<string, string> | null {
  const cells = new Map<string, string>();
  const rect = context.board.getBoundingClientRect();
  for (const element of context.board.querySelectorAll<HTMLElement>(":scope > piece:not(.ghost):not(.dragging)")) {
    const kind = [...element.classList].find(
      /** Accepts only piece-role classes, never Chessground decoration classes. */
      (name) => Object.hasOwn(roles, name));
    const role = kind ? roles[kind] : undefined;
    const square = elementSquare(element, context, rect);
    const color = element.classList.contains("white") ? "w" : element.classList.contains("black") ? "b" : null;
    if (!role || !square || !color || cells.has(square)) return null;
    cells.set(square, color === "w" ? role.toUpperCase() : role);
  }
  return cells.size ? cells : null;
}

/** Reads only stable piece placement for input confirmation and promotion handling. */
export function readPlacement(context: LichessBoard): string | null {
  const cells = readCells(context);
  return cells ? serializePlacement(cells) : null;
}

/** Replays SAN text while respecting round replay and ignoring training feedback glyphs. */
function historyPosition(context: LichessBoard, placement: string): string | null {
  const list = context.root.querySelector(context.mode === "training" ? ".puzzle__moves .tview2" : "i5d app");
  if (!list) return null;
  const game = new Chess();
  try {
    for (const node of list.children) {
      if (!node.matches(context.mode === "training" ? "move:not(.fail)" : "z7yx")) continue;
      let san = "";
      for (const child of node.childNodes) if (child.nodeType === Node.TEXT_NODE) san += child.textContent ?? "";
      san = san.replace(/[!?]/g, "").trim();
      if (san) game.move(san);
      if (context.mode === "round" && node.classList.contains("a1t")) break;
    }
  } catch { return null; }
  const fen = game.fen();
  if (placementOf(fen) !== placement) return null;
  tracker.reset(fen);
  return fen;
}

/** Infers whose turn follows the visible last move in timed puzzles. */
function lastMoveTurn(context: LichessBoard, cells: ReadonlyMap<string, string>): Color | null {
  const colors = new Set<Color>();
  for (const mark of context.board.querySelectorAll<HTMLElement>(":scope > square.last-move")) {
    if (!mark.getClientRects().length || mark.style.display === "none") continue;
    const square = elementSquare(mark, context), piece = square ? cells.get(square) : undefined;
    if (piece) colors.add(piece === piece.toUpperCase() ? "w" : "b");
  }
  if (colors.size !== 1) return null;
  return colors.has("w") ? "b" : "w";
}

/** Follows known timed positions before estimating a new puzzle with hidden history. */
function timedPosition(context: LichessBoard, cells: ReadonlyMap<string, string>, placement: string): string | null {
  const turn = lastMoveTurn(context, cells);
  const tracked = tracker.follow(placement);
  if (tracked) return tracked;
  try {
    const fen = new Chess(`${placement} ${turn ?? playerColor(context)} - - 0 1`).fen();
    if (session) session.player = playerColor(context);
    tracker.reset(fen);
    return fen;
  } catch { return null; }
}

/** Rejects incomplete histories and preserves legal state while round history is hidden. */
export function readPosition(): string | null {
  const context = lichessBoard();
  if (!context || (context.mode === "round" && !context.board.closest(".variant-standard"))) return null;
  trackSession(context);
  const cells = readCells(context);
  if (!cells) return null;
  const placement = serializePlacement(cells);
  if (context.mode === "storm" || context.mode === "racer") return timedPosition(context, cells, placement);
  if (context.mode === "training" || context.root.querySelector("i5d app")) return historyPosition(context, placement);
  if (placement === placementOf(initialFen)) { tracker.reset(initialFen); return initialFen; }
  return tracker.follow(placement);
}

/** Restricts automatic input to the player's turn and the live position. */
export function canPlay(fen: string): boolean {
  const context = lichessBoard();
  if (!context || fen.split(" ")[1] !== ownedColor(context)) return false;
  if (context.mode === "training") return !!context.root.querySelector(".puzzle__feedback:is(.play, .good)");
  if (context.mode !== "round") return true;
  if (roundEnded()) return false;
  const moves = context.root.querySelectorAll("i5d app z7yx"), selected = context.root.querySelector("i5d app z7yx.a1t");
  return !selected || selected === moves.item(moves.length - 1);
}

/** Detects unfinished input in every supported Lichess page mode. */
export function boardBusy(): boolean {
  const context = lichessBoard();
  return !!context?.root.querySelector("cg-board > piece.dragging, #promotion-choice");
}

/** Removes only ChessBot's passive suggestion squares. */
export function clearHighlights(): void { for (const mark of document.querySelectorAll("cg-board > square.bot-highlight")) mark.remove(); }

/** Uses the same orientation mapping for suggestion squares and pointer input. */
export function highlight(move: string, mistake?: MistakeType): void {
  clearHighlights();
  const context = lichessBoard();
  if (!context || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return;
  const endpoints = [["from", move.slice(0, 2)], ["to", move.slice(2, 4)]] as const;
  for (const [end, square] of endpoints) {
    const point = squareIndices(square, context.orientation), mark = document.createElement("square");
    mark.className = "bot-highlight";
    mark.dataset.file = String(point.file);
    mark.dataset.rank = String(point.rank);
    mark.dataset.end = end;
    mark.dataset.tone = mistake === "mistake" ? "mistake" : "default";
    context.board.append(mark);
  }
}
