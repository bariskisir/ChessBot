/** Centralizes Lichess page modes, player ownership, and Chessground coordinates. */
import type { Color } from "chess.js";
import type { InputPoint } from "../input-protocol";

export type LichessMode = "round" | "training" | "racer" | "storm";
export interface LichessBoard { board: HTMLElement; root: HTMLElement; mode: LichessMode; orientation: Color }
const boards: ReadonlyArray<readonly [LichessMode, string, string]> = [
  ["round", ".round__app__board.main-board", ".round__app"],
  ["training", ".puzzle__board.main-board", ".puzzle-play"],
  ["racer", ".puz-board", ".racer--play:not(.racer--post)"],
  ["storm", ".puz-board", ".storm--play"],
];

/** Resolves one page mode so downstream reads share the same board and orientation. */
export function lichessBoard(): LichessBoard | null {
  for (const [mode, container, scope] of boards) {
    const board = document.querySelector<HTMLElement>(`${scope} ${container} .cg-wrap cg-board`);
    const root = board?.closest<HTMLElement>(scope);
    if (board && root) return { board, root, mode, orientation: board.closest(".cg-wrap")?.classList.contains("orientation-black") ? "b" : "w" };
  }
  return null;
}

/** Extracts stable round identity without depending on player tokens or view direction. */
export function lichessGameId(pathname: string): string | null {
  return /^\/([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/|$)/.exec(pathname)?.[1] ?? null;
}

/** Uses ownership hints before orientation, which can change when the board is flipped. */
export function playerColor(context: LichessBoard): Color {
  const { root, mode, orientation } = context;
  if (mode === "storm") {
    const pov = root.querySelector(".puz-clock__pov")?.textContent ?? "";
    if (/play the black pieces/i.test(pov)) return "b";
    if (/play the white pieces/i.test(pov)) return "w";
  }
  if (mode === "training") {
    const king = root.querySelector(".puzzle__feedback .player piece.king");
    if (king?.classList.contains("black")) return "b";
    if (king?.classList.contains("white")) return "w";
    const moves = root.querySelectorAll(".puzzle__moves .tview2 > move");
    for (let index = moves.length - 1; index >= 0; index--) {
      if (moves[index]?.classList.contains("good")) return index % 2 === 0 ? "w" : "b";
    }
  }
  if (mode === "round") {
    const canonical = document.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? "";
    const analysis = root.querySelector("a.analysis[href]")?.getAttribute("href") ?? "";
    for (const address of [location.pathname, canonical, analysis]) {
      const side = /\/[a-zA-Z0-9]{8}(?:[a-zA-Z0-9]{4})?\/(white|black)(?:\/|#|$)/.exec(address)?.[1];
      if (side) return side === "white" ? "w" : "b";
    }
  }
  return orientation;
}

/** Distinguishes real round completion from the empty result placeholder. */
export function roundEnded(): boolean {
  return !!document.querySelector(".round__app .result-wrap .status, .game__meta > section.status:not(:empty)");
}

/** Converts algebraic coordinates into the board's visible square indices. */
export function squareIndices(square: string, orientation: Color): { file: number; rank: number } {
  const file = square.charCodeAt(0) - 97, rank = Number(square[1]) - 1;
  return { file: orientation === "b" ? 7 - file : file, rank: orientation === "b" ? rank : 7 - rank };
}

/** Rejects moving or malformed transforms instead of rounding them into another position. */
export function elementSquare(element: HTMLElement, context: LichessBoard, rect = context.board.getBoundingClientRect()): string | null {
  const transform = /translate(?:3d)?\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec(element.style.transform);
  if (rect.width <= 0 || rect.height <= 0 || !transform) return null;
  const file = Number(transform[1]) * 8 / rect.width, rank = Number(transform[2]) * 8 / rect.height;
  const x = Math.round(file), y = Math.round(rank);
  if (!Number.isFinite(file) || !Number.isFinite(rank) || x < 0 || x > 7 || y < 0 || y > 7 || Math.abs(file - x) > 0.02 || Math.abs(rank - y) > 0.02) return null;
  return `${"abcdefgh"[context.orientation === "b" ? 7 - x : x]}${context.orientation === "b" ? y + 1 : 8 - y}`;
}

/** Converts a square into a viewport point for trusted pointer input. */
export function squarePoint(square: string, context: LichessBoard): InputPoint {
  const rect = context.board.getBoundingClientRect(), point = squareIndices(square, context.orientation);
  return { x: rect.left + (point.file + 0.5) * rect.width / 8, y: rect.top + (point.rank + 0.5) * rect.height / 8 };
}
