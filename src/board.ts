/** Reads verified Chess.com positions and applies legal moves on the board. */
import { Chess } from "chess.js";
import { delay } from "./engine-client";
import type { MistakeType } from "./mistake-mode";

/** Finds the current board after site navigation or board replacement. */
export function getBoard(): HTMLElement | null { return document.querySelector("wc-chess-board, chess-board"); }

/** Serializes visible pieces without inventing castling or en passant rights. */
export function readPlacement(board: HTMLElement): string {
  const cells = new Map<string, string>();
  for (const piece of board.querySelectorAll(".piece")) {
    const type = /\b([wb])([prnbqk])\b/.exec(piece.className), square = /\bsquare-([1-8])([1-8])\b/.exec(piece.className);
    if (type && square) cells.set(`${square[1]}${square[2]}`, type[1] === "w" ? type[2]!.toUpperCase() : type[2]!);
  }
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = "", empty = 0;
    for (let file = 1; file <= 8; file++) {
      const piece = cells.get(`${file}${rank}`);
      if (!piece) { empty++; continue; }
      if (empty) row += empty;
      empty = 0;
      row += piece;
    }
    rows.push(row + (empty || ""));
  }
  return rows.join("/");
}

/** Accepts exact site state or legal move replay only when it matches the board. */
export function readPosition(): string | null {
  const board = getBoard();
  if (!board) return null;
  const placement = readPlacement(board), exact = board.getAttribute("data-chessbot-fen");
  if (exact && exact.split(" ")[0] === placement) {
    try { return new Chess(exact).fen(); } catch { return null; }
  }
  const chess = new Chess();
  try {
    for (const node of document.querySelectorAll("wc-simple-move-list .node")) {
      const figurine = node.querySelector("[data-figurine]")?.getAttribute("data-figurine") ?? "";
      const san = (figurine + (node.textContent ?? "")).replace(/[!?]/g, "").trim();
      if (san) chess.move(san);
      if (node.classList.contains("selected")) break;
    }
  } catch { return null; }
  return chess.fen().split(" ")[0] === placement ? chess.fen() : null;
}

/** Removes all suggestion indicators created by this extension. */
export function clearHighlights(): void { for (const element of document.querySelectorAll(".chessbot-square")) element.remove(); }

/** Converts a square to percentages using the current board orientation. */
function coordinates(square: string, board: HTMLElement): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97, rank = Number(square[1]) - 1, flipped = board.classList.contains("flipped");
  return { x: (flipped ? 7 - file : file) * 12.5, y: (flipped ? rank : 7 - rank) * 12.5 };
}

/** Highlights a legal UCI move without blocking board interaction. */
export function highlight(move: string, mistake?: MistakeType): void {
  clearHighlights();
  const board = getBoard();
  if (!board || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return;
  for (const square of [move.slice(0, 2), move.slice(2, 4)]) {
    const point = coordinates(square, board), mark = document.createElement("div");
    mark.className = "chessbot-square";
    const color = mistake === "ideal" ? "239,68,68" : mistake === "suboptimal" ? "249,115,22" : "16,185,129";
    mark.style.cssText = `position:absolute;left:${point.x}%;top:${point.y}%;width:12.5%;height:12.5%;background:rgba(${color},${square === move.slice(0, 2) ? 0.4 : 0.7});pointer-events:none;z-index:5`;
    board.append(mark);
  }
}

/** Allows automatic input during the player's turn. */
export function canPlay(fen: string): boolean {
  const board = getBoard();
  return !!board && fen.split(" ")[1] === (board.classList.contains("flipped") ? "b" : "w");
}

/** Reads the player's color from the board orientation. */
export function userColor(): "w" | "b" { return getBoard()?.classList.contains("flipped") ? "b" : "w"; }

/** Detects active dragging or a visible promotion chooser. */
export function boardBusy(): boolean {
  return !!document.querySelector("wc-chess-board.dragging, chess-board.dragging, .piece.dragging") || !!document.querySelector<HTMLElement>(".promotion-window")?.offsetParent;
}

/** Dispatches the pointer and mouse sequence selecting a board square. */
function clickSquare(board: HTMLElement, square: string): void {
  const rect = board.getBoundingClientRect(), point = coordinates(square, board);
  const clientX = rect.left + (point.x + 6.25) * rect.width / 100, clientY = rect.top + (point.y + 6.25) * rect.height / 100;
  dispatchClick(document.elementFromPoint(clientX, clientY) ?? board, clientX, clientY);
}

/** Sends the full input sequence required by board squares and promotion choices. */
function dispatchClick(target: Element, clientX: number, clientY: number): void {
  const options = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0 };
  target.dispatchEvent(new PointerEvent("pointerdown", { ...options, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 1 }));
  target.dispatchEvent(new MouseEvent("mousedown", { ...options, buttons: 1 }));
  target.dispatchEvent(new PointerEvent("pointerup", { ...options, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  target.dispatchEvent(new MouseEvent("mouseup", options));
  target.dispatchEvent(new MouseEvent("click", options));
}

/** Finds the visible promotion chooser belonging to the active board. */
function promotionWindow(board: HTMLElement): HTMLElement | null {
  for (const window of board.querySelectorAll<HTMLElement>(".promotion-window")) {
    const style = getComputedStyle(window);
    if (window.getClientRects().length && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0") return window;
  }
  return null;
}

/** Detects an unfinished promotion that belongs to the player on the board. */
export function canResumePromotion(): boolean {
  const board = getBoard(), fen = board?.getAttribute("data-chessbot-fen");
  return !!board && !!fen && canPlay(fen) && !!promotionWindow(board)?.querySelector(`.promotion-piece.${userColor()}q`);
}

/** Chooses a promotion piece and confirms its placement instead of assuming a click succeeded. */
async function choosePromotion(board: HTMLElement, color: "w" | "b", piece: string, expected: string, signal: AbortSignal): Promise<void> {
  let nextClick = 0;
  for (let attempt = 0; attempt < 50; attempt++) {
    signal.throwIfAborted();
    if (getBoard() !== board) throw new Error("Board changed during promotion.");
    const chooser = promotionWindow(board);
    if (!chooser && readPlacement(board) === expected) return;
    const target = chooser?.querySelector<HTMLElement>(`.promotion-piece.${color}${piece}`);
    if (target && target.getClientRects().length && Date.now() >= nextClick) {
      const rect = target.getBoundingClientRect();
      dispatchClick(target, rect.left + rect.width / 2, rect.top + rect.height / 2);
      nextClick = Date.now() + 400;
    }
    await delay(100, signal);
  }
  throw new Error("Promotion was not accepted. Press STOP, then START to retry.");
}

/** Completes an already-open chooser using a legal promotion from the site's pending position. */
export async function resumePromotion(moveHint: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const board = getBoard();
  if (!board || !canResumePromotion()) throw new Error("No player promotion is available.");
  const chess = new Chess(board.getAttribute("data-chessbot-fen")!);
  const color = chess.turn();
  const pawn = board.querySelector(`.piece.${color}p.dragging`);
  const destination = /\bsquare-([1-8])([18])\b/.exec(pawn?.className ?? "");
  const square = destination ? `${"abcdefgh"[Number(destination[1]) - 1]}${destination[2]}` : null;
  const hint = moveHint.toLowerCase();
  const candidates = chess.moves({ verbose: true }).filter(
    /** Restricts recovery to legal promotions on the pawn's displayed destination. */
    (move) => !!move.promotion && (!square || move.to === square));
  const chosen = candidates.find(
    /** Preserves the engine's requested underpromotion when its complete move matches. */
    (move) => `${move.from}${move.to}${move.promotion}` === hint) ?? candidates.find(
    /** Defaults an interrupted promotion without a saved move to a legal queen promotion. */
    (move) => move.promotion === "q");
  if (!chosen || (!square && candidates.length > 4)) throw new Error("Cannot identify the pending promotion square.");
  chess.move(chosen);
  await choosePromotion(board, color, chosen.promotion!, chess.fen().split(" ")[0]!, signal);
}

/** Revalidates the position immediately before executing a suggested move. */
export async function playMove(fen: string, move: string, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  const board = getBoard();
  if (!board || readPosition() !== fen || !canPlay(fen)) return false;
  const chess = new Chess(fen);
  try { chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] ?? "q" }); } catch { return false; }
  clickSquare(board, move.slice(0, 2));
  await delay(150, signal);
  if (readPosition() !== fen || getBoard() !== board || !canPlay(fen)) return false;
  clickSquare(board, move.slice(2, 4));
  if (move[4]) {
    await choosePromotion(board, fen.split(" ")[1] as "w" | "b", move[4], chess.fen().split(" ")[0]!, signal);
  }
  return true;
}
