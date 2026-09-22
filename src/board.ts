/** Reads Chess.com positions from visible markup and applies human-like legal moves. */
import { Chess } from "chess.js";
import { delay } from "./engine-client";
import type { MistakeType } from "./mistake-mode";

/** Finds the current board after site navigation or board replacement. */
export function getBoard(): HTMLElement | null { return document.querySelector("wc-chess-board, chess-board"); }

/** Collects visible pieces by file-rank key without inventing hidden state. */
function readCells(board: HTMLElement): Map<string, string> {
  const cells = new Map<string, string>();
  for (const piece of board.querySelectorAll(".piece")) {
    const type = /\b([wb])([prnbqk])\b/.exec(piece.className), square = /\bsquare-([1-8])([1-8])\b/.exec(piece.className);
    if (type && square) cells.set(`${square[1]}${square[2]}`, type[1] === "w" ? type[2]!.toUpperCase() : type[2]!);
  }
  return cells;
}

/** Serializes piece cells into a placement field. */
function serializePlacement(cells: Map<string, string>): string {
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

/** Serializes visible pieces without inventing castling or en passant rights. */
export function readPlacement(board: HTMLElement): string { return serializePlacement(readCells(board)); }

/** Expands a placement field into one entry per square, starting from a8. */
function expandPlacement(placement: string): string[] {
  const squares: string[] = [];
  for (const char of placement.replace(/\//g, "")) {
    if (char >= "1" && char <= "8") for (let i = 0; i < Number(char); i++) squares.push("");
    else squares.push(char);
  }
  return squares;
}

/** Reads the side to move from the move list, falling back to the site's turn markers. */
function readTurn(board: HTMLElement): "w" | "b" {
  const moveList = document.querySelector("wc-simple-move-list");
  const selected = moveList?.querySelector(".node.selected");
  if (selected) return selected.classList.contains("white-move") ? "b" : "w";
  const rows = moveList ? [...moveList.querySelectorAll(".main-line-row")] : [];
  if (rows.length) {
    const nodes = rows.at(-1)?.querySelectorAll(".node").length ?? 0;
    if (nodes === 1) return "b";
    return "w";
  }
  const bottom = document.querySelector("#board-layout-player-bottom"), top = document.querySelector("#board-layout-player-top");
  if (bottom?.querySelector(".clock-player-turn, .player-info.active")) return board.classList.contains("flipped") ? "b" : "w";
  if (top?.querySelector(".clock-player-turn, .player-info.active")) return board.classList.contains("flipped") ? "w" : "b";
  return "w";
}

/** Guesses castling rights from unmoved back-rank pieces, honoring recorded king moves. */
function readCastling(squares: string[]): string {
  let whiteKingSide = squares[60] === "K" && squares[63] === "R";
  let whiteQueenSide = squares[60] === "K" && squares[56] === "R";
  let blackKingSide = squares[4] === "k" && squares[7] === "r";
  let blackQueenSide = squares[4] === "k" && squares[0] === "r";
  for (const node of document.querySelectorAll("wc-simple-move-list .node")) {
    const text = (node.textContent ?? "").trim(), white = node.classList.contains("white-move");
    if (text.startsWith("K") || text.includes("O-O")) {
      if (white) whiteKingSide = whiteQueenSide = false;
      else blackKingSide = blackQueenSide = false;
    }
  }
  return `${whiteKingSide ? "K" : ""}${whiteQueenSide ? "Q" : ""}${blackKingSide ? "k" : ""}${blackQueenSide ? "q" : ""}` || "-";
}

/** Counts full moves from the move list, defaulting to the opening position. */
function readMoveNumber(turn: "w" | "b"): number {
  const rows = [...document.querySelectorAll("wc-simple-move-list .main-line-row")];
  const last = rows.at(-1);
  if (!last) return 1;
  return rows.length + (turn === "w" && last.querySelectorAll(".node").length === 2 ? 1 : 0);
}

/** Builds a validated FEN from cell contents using inferred rights and counters. */
function inferFen(cells: Map<string, string>, board: HTMLElement): string | null {
  const placement = serializePlacement(cells);
  const squares = expandPlacement(placement);
  if (squares.length !== 64) return null;
  const turn = readTurn(board);
  const fen = `${placement} ${turn} ${readCastling(squares)} - 0 ${readMoveNumber(turn)}`;
  try { return new Chess(fen).fen(); } catch { return null; }
}

/** Waits for visible pieces and recorded moves to agree before exposing a playable position. */
export function readPosition(): string | null {
  const board = getBoard();
  if (!board) return null;
  const placement = readPlacement(board);
  const chess = new Chess();
  const nodes = document.querySelectorAll("wc-simple-move-list .node");
  try {
    for (const node of nodes) {
      const figurine = node.querySelector("[data-figurine]")?.getAttribute("data-figurine") ?? "";
      const san = (figurine + (node.textContent ?? "")).replace(/[!?]/g, "").trim();
      if (san) chess.move(san);
      if (node.classList.contains("selected")) break;
    }
  } catch { return null; }
  if (chess.fen().split(" ")[0] === placement) return chess.fen();
  if (nodes.length) return null;
  return inferFen(readCells(board), board);
}

/** Compares tactical positions while ignoring halfmove and fullmove counters. */
export function samePosition(first: string, second: string): boolean {
  const a = first.split(" "), b = second.split(" ");
  return a.length >= 4 && a.slice(0, 4).join(" ") === b.slice(0, 4).join(" ");
}

/** Removes suggestion squares while leaving the site's own highlights untouched. */
export function clearHighlights(): void { for (const element of document.querySelectorAll("div.highlight[data-tone]")) element.remove(); }

/** Converts a square to board indices using the current board orientation. */
function coordinates(square: string, board: HTMLElement): { file: number; rank: number } {
  const file = square.charCodeAt(0) - 97, rank = Number(square[1]) - 1, flipped = board.classList.contains("flipped");
  return { file: flipped ? 7 - file : file, rank: flipped ? rank : 7 - rank };
}

/** Highlights a legal UCI move without blocking board interaction. */
export function highlight(move: string, mistake?: MistakeType): void {
  clearHighlights();
  const board = getBoard();
  if (!board || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return;
  for (const square of [move.slice(0, 2), move.slice(2, 4)]) {
    const point = coordinates(square, board), mark = document.createElement("div");
    mark.className = "highlight";
    mark.dataset.file = String(point.file);
    mark.dataset.rank = String(point.rank);
    mark.dataset.end = square === move.slice(0, 2) ? "from" : "to";
    mark.dataset.tone = mistake === "mistake" ? "mistake" : "default";
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

/** Returns a random value inside a range for human-like timing and placement. */
function varied(min: number, max: number): number { return min + Math.random() * (max - min); }

/** Picks a press point inside a square, avoiding the machine-like exact center. */
function squarePoint(rect: DOMRect, file: number, rank: number): { x: number; y: number } {
  const wide = rect.width / 8, high = rect.height / 8;
  return { x: rect.left + file * wide + wide / 2 + varied(-0.3, 0.3) * wide, y: rect.top + rank * high + high / 2 + varied(-0.3, 0.3) * high };
}

/** Presses a piece down without lifting, starting a synthetic drag gesture. */
function pressDown(target: Element, x: number, y: number): void {
  const options = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
  target.dispatchEvent(new PointerEvent("pointerdown", { ...options, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 1 }));
  target.dispatchEvent(new MouseEvent("mousedown", { ...options, buttons: 1 }));
}

/** Sends one mid-drag event carrying the pointer position of the current step. */
function dispatchDragEvent(target: Element, type: "pointermove" | "mousemove", x: number, y: number): void {
  const options = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 };
  if (type === "pointermove") target.dispatchEvent(new PointerEvent(type, { ...options, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  else target.dispatchEvent(new MouseEvent(type, options));
}

/** Releases a drag with the click the site expects at the drop square. */
function releaseDrag(target: Element, x: number, y: number): void {
  const options = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
  target.dispatchEvent(new PointerEvent("pointerup", { ...options, pointerId: 1, pointerType: "mouse", isPrimary: true }));
  target.dispatchEvent(new MouseEvent("mouseup", options));
  target.dispatchEvent(new MouseEvent("click", options));
}

/** Drops instantly unless animated travel and human pacing are requested. */
async function dragMove(board: HTMLElement, from: string, to: string, signal: AbortSignal, animateMoves: boolean): Promise<void> {
  const rect = board.getBoundingClientRect();
  const origin = coordinates(from, board), destination = coordinates(to, board);
  const start = squarePoint(rect, origin.file, origin.rank), end = squarePoint(rect, destination.file, destination.rank);
  pressDown(document.elementFromPoint(start.x, start.y) ?? board, start.x, start.y);
  if (!animateMoves) {
    const target = document.elementFromPoint(end.x, end.y) ?? board;
    dispatchDragEvent(target, "pointermove", end.x, end.y);
    dispatchDragEvent(target, "mousemove", end.x, end.y);
    releaseDrag(document.elementFromPoint(end.x, end.y) ?? board, end.x, end.y);
    return;
  }
  await delay(varied(20, 35), signal);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const steps = Math.max(3, Math.min(5, Math.round(distance / 60)));
  const normal = distance > 0 ? { x: -(end.y - start.y) / distance, y: (end.x - start.x) / distance } : { x: 0, y: 0 };
  const bend = varied(-0.18, 0.18) * distance;
  const control = { x: (start.x + end.x) / 2 + normal.x * bend, y: (start.y + end.y) / 2 + normal.y * bend };
  for (let step = 1; step <= steps; step++) {
    signal.throwIfAborted();
    if (getBoard() !== board) throw new Error("Board changed during move.");
    const t = step / steps, inverse = 1 - t;
    const x = inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x + varied(-1.5, 1.5);
    const y = inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y + varied(-1.5, 1.5);
    const target = document.elementFromPoint(x, y) ?? board;
    dispatchDragEvent(target, "pointermove", x, y);
    dispatchDragEvent(target, "mousemove", x, y);
    await delay(varied(10, 15), signal);
  }
  releaseDrag(document.elementFromPoint(end.x, end.y) ?? board, end.x, end.y);
}

/** Sends the full input sequence required by promotion choices. */
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
  const board = getBoard();
  const chooser = board && promotionWindow(board);
  if (!board || !chooser || !chooser.querySelector(`.promotion-piece.${userColor()}q`)) return false;
  const rebuilt = unpromote(board);
  return !!rebuilt && canPlay(rebuilt.fen);
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
      dispatchClick(target, rect.left + rect.width * varied(0.35, 0.65), rect.top + rect.height * varied(0.35, 0.65));
      nextClick = Date.now() + 400;
    }
    await delay(100, signal);
  }
  throw new Error("Promotion was not accepted. Press STOP, then START to retry.");
}

/** Converts an algebraic square into the file-rank key used by piece cells. */
function cellKey(square: string): string { return `${square.charCodeAt(0) - 96}${square[1]}`; }

/** Finds a promotion pawn stuck on its target square after an interrupted drag. */
function pendingPawn(board: HTMLElement): { color: "w" | "b"; square: string } | null {
  const pawn = board.querySelector(".piece.wp.dragging, .piece.bp.dragging");
  const match = /\b([wb])p\b/.exec(pawn?.className ?? "");
  const destination = /\bsquare-([1-8])([18])\b/.exec(pawn?.className ?? "");
  if (!match || !destination) return null;
  return { color: match[1] as "w" | "b", square: `${"abcdefgh"[Number(destination[1]) - 1]}${destination[2]}` };
}

/** Rebuilds the pre-drag position by returning a stuck pawn to a legal origin. */
function unpromote(board: HTMLElement): { fen: string; destination: string } | null {
  const pending = pendingPawn(board);
  if (!pending) return null;
  const cells = readCells(board);
  const file = pending.square.charCodeAt(0) - 97, rank = Number(pending.square[1]);
  const squareKey = cellKey(pending.square);
  const back = pending.color === "w" ? rank - 1 : rank + 1;
  const origins: { square: string; key: string }[] = [];
  for (const offset of [0, -1, 1]) {
    const originFile = file + offset;
    if (originFile < 0 || originFile > 7 || back < 1 || back > 8) continue;
    origins.push({ square: `${"abcdefgh"[originFile]}${back}`, key: `${originFile + 1}${back}` });
  }
  const enemy = pending.color === "w" ? "p" : "P";
  for (const occupant of [null, enemy]) {
    if (occupant) cells.set(squareKey, occupant);
    else cells.delete(squareKey);
    for (const origin of origins) {
      if (cells.has(origin.key)) continue;
      cells.set(origin.key, pending.color === "w" ? "P" : "p");
      const fen = inferFen(cells, board);
      cells.delete(origin.key);
      if (!fen) continue;
      const promotions = new Chess(fen).moves({ verbose: true }).filter(
        /** Accepts only origins with a legal promotion onto the displayed square. */
        (move) => !!move.promotion && move.from === origin.square && move.to === pending.square);
      if (promotions.length) return { fen, destination: pending.square };
    }
  }
  return null;
}

/** Completes an already-open chooser using the reconstructed pre-drag position. */
export async function resumePromotion(moveHint: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const board = getBoard();
  if (!board || !canResumePromotion()) throw new Error("No player promotion is available.");
  const rebuilt = unpromote(board);
  if (!rebuilt) throw new Error("Cannot identify the pending promotion square.");
  const chess = new Chess(rebuilt.fen);
  const color = chess.turn();
  const hint = moveHint.toLowerCase();
  const candidates = chess.moves({ verbose: true }).filter(
    /** Restricts recovery to legal promotions on the pawn's displayed destination. */
    (move) => !!move.promotion && move.to === rebuilt.destination);
  const chosen = candidates.find(
    /** Preserves the engine's requested underpromotion when its complete move matches. */
    (move) => `${move.from}${move.to}${move.promotion}` === hint) ?? candidates.find(
    /** Defaults an interrupted promotion without a saved move to a legal queen promotion. */
    (move) => move.promotion === "q");
  if (!chosen) throw new Error("Cannot identify the pending promotion square.");
  const cells = readCells(board);
  cells.delete(cellKey(chosen.from));
  cells.set(rebuilt.destination, color === "w" ? chosen.promotion!.toUpperCase() : chosen.promotion!);
  await choosePromotion(board, color, chosen.promotion!, serializePlacement(cells), signal);
}

/** Revalidates a suggested move and applies it instantly unless animation is enabled. */
export async function playMove(fen: string, move: string, signal: AbortSignal, animateMoves = false): Promise<boolean> {
  signal.throwIfAborted();
  const board = getBoard();
  if (!board || !samePosition(readPosition() ?? "", fen) || !canPlay(fen)) return false;
  const chess = new Chess(fen);
  try { chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] ?? "q" }); } catch { return false; }
  await dragMove(board, move.slice(0, 2), move.slice(2, 4), signal, animateMoves);
  if (move[4]) {
    await choosePromotion(board, fen.split(" ")[1] as "w" | "b", move[4], chess.fen().split(" ")[0]!, signal);
  }
  return true;
}
