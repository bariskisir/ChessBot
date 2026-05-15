/**
 * Reads Chess.com board state, converts it to FEN, and manages board highlights.
 */
import { Chess } from "chess.js";
import type { PlayerColor, MaybeMistakeType } from "../shared/types";
import { byId, qs, qsa } from "./dom";

type BoardMatrix = string[][];

/**
 * Returns the active Chess.com board element when it is present.
 */
export function getBoardElement(): HTMLElement | null {
  return qs<HTMLElement>("wc-chess-board");
}

/**
 * Infers the user color from the board orientation.
 */
export function getUserColor(): PlayerColor {
  const board = getBoardElement();
  return board?.classList.contains("flipped") ? "b" : "w";
}

/**
 * Infers whose turn it is from the move list and active player markers.
 */
export function getTurn(): PlayerColor {
  const board = getBoardElement();
  const moveList = qs<HTMLElement>("wc-simple-move-list");

  if (!board) {
    return "w";
  }

  if (moveList) {
    const selectedNode = qs<HTMLElement>(".node.selected", moveList);

    if (selectedNode) {
      return selectedNode.classList.contains("white-move") ? "b" : "w";
    }

    const rows = qsa<HTMLElement>(".main-line-row", moveList);

    if (rows.length > 0) {
      const lastRow = rows.at(-1);
      const nodes = lastRow ? qsa<HTMLElement>(".node", lastRow) : [];

      if (nodes.length === 1) {
        return "b";
      }

      if (nodes.length === 2) {
        return "w";
      }
    }

    return "w";
  }

  const bottomPlayer = qs<HTMLElement>("#board-layout-player-bottom");
  const topPlayer = qs<HTMLElement>("#board-layout-player-top");

  if (bottomPlayer?.querySelector(".clock-player-turn, .player-info.active")) {
    return board.classList.contains("flipped") ? "b" : "w";
  }

  if (topPlayer?.querySelector(".clock-player-turn, .player-info.active")) {
    return board.classList.contains("flipped") ? "w" : "b";
  }

  return "w";
}

/**
 * Builds an empty 8x8 matrix used for FEN extraction.
 */
function createEmptyBoard(): BoardMatrix {
  return Array.from({ length: 8 }, () => Array<string>(8).fill(" "));
}

/**
 * Reads piece elements from the Chess.com board into a rank/file matrix.
 */
function readPieceMatrix(boardElement: HTMLElement): BoardMatrix {
  const board = createEmptyBoard();
  const pieces = qsa<HTMLElement>(".piece", boardElement);

  for (const piece of pieces) {
    let type = "";
    let file = -1;
    let rank = -1;

    for (const className of piece.classList) {
      const typeMatch = className.match(/^([wb][prnbqk])$/);
      const squareMatch = className.match(/square-(\d)(\d)/);

      if (typeMatch?.[1]) {
        type = typeMatch[1];
      }

      if (squareMatch?.[1] && squareMatch[2]) {
        file = Number.parseInt(squareMatch[1], 10);
        rank = Number.parseInt(squareMatch[2], 10);
      }
    }

    if (type && file !== -1 && rank !== -1) {
      const fenChar = type[0] === "w" ? type[1]?.toUpperCase() : type[1];
      const row = 8 - rank;
      const col = file - 1;

      if (fenChar && board[row]?.[col] !== undefined) {
        board[row][col] = fenChar;
      }
    }
  }

  return board;
}

/**
 * Converts a matrix row into FEN placement notation.
 */
function serializeFenRow(row: string[]): string {
  let fenRow = "";
  let emptyCount = 0;

  for (const char of row) {
    if (char === " ") {
      emptyCount += 1;
      continue;
    }

    if (emptyCount > 0) {
      fenRow += String(emptyCount);
      emptyCount = 0;
    }

    fenRow += char;
  }

  return emptyCount > 0 ? fenRow + String(emptyCount) : fenRow;
}

/**
 * Estimates legal castling rights from current pieces and visible move notation.
 */
function getCastlingRights(board: BoardMatrix): string {
  const moveList = qs<HTMLElement>("wc-simple-move-list");
  let whiteKingSide = board[7]?.[4] === "K" && board[7]?.[7] === "R";
  let whiteQueenSide = board[7]?.[4] === "K" && board[7]?.[0] === "R";
  let blackKingSide = board[0]?.[4] === "k" && board[0]?.[7] === "r";
  let blackQueenSide = board[0]?.[4] === "k" && board[0]?.[0] === "r";

  if (moveList) {
    for (const node of qsa<HTMLElement>(".node", moveList)) {
      const text = node.innerText.trim();
      const isWhite = node.classList.contains("white-move");
      const isKingMove = text.startsWith("K") || text.includes("O-O");

      if (isWhite && isKingMove) {
        whiteKingSide = false;
        whiteQueenSide = false;
      }

      if (!isWhite && isKingMove) {
        blackKingSide = false;
        blackQueenSide = false;
      }
    }
  }

  const rights = [
    whiteKingSide ? "K" : "",
    whiteQueenSide ? "Q" : "",
    blackKingSide ? "k" : "",
    blackQueenSide ? "q" : "",
  ].join("");

  return rights || "-";
}

/**
 * Estimates the fullmove number from the visible move list.
 */
function getMoveNumber(turn: PlayerColor): number {
  const moveList = qs<HTMLElement>("wc-simple-move-list");

  if (!moveList) {
    return 1;
  }

  const rows = qsa<HTMLElement>(".main-line-row", moveList);
  let moveNumber = rows.length || 1;
  const lastRow = rows.at(-1);

  if (turn === "w" && lastRow && qsa<HTMLElement>(".node", lastRow).length === 2) {
    moveNumber += 1;
  }

  return moveNumber;
}

/**
 * Reads the current Chess.com board and returns a FEN string.
 */
export function getFen(): string {
  const boardElement = getBoardElement();

  if (!boardElement) {
    return "";
  }

  const board = readPieceMatrix(boardElement);
  const placement = board.map(serializeFenRow).join("/");
  const turn = getTurn();
  const castling = getCastlingRights(board);
  const moveNumber = getMoveNumber(turn);
  const fen = `${placement} ${turn} ${castling} - 0 ${moveNumber}`;
  const fenElement = byId<HTMLElement>("bot-fen-text");

  if (fenElement) {
    fenElement.innerText = fen;
  }

  return fen;
}

/**
 * Removes any move highlights created by the extension.
 */
export function clearHighlights(): void {
  for (const element of qsa<HTMLElement>(".custom-bot-highlight")) {
    element.remove();
  }
}

/**
 * Converts a UCI square to board-relative coordinates for CSS transforms.
 */
function squareToTransform(square: string, board: HTMLElement): { x: number; y: number } | null {
  if (square.length < 2) {
    return null;
  }

  const file = square.charCodeAt(0) - 96;
  const rank = Number.parseInt(square[1] ?? "", 10);

  if (file < 1 || file > 8 || rank < 1 || rank > 8) {
    return null;
  }

  if (board.classList.contains("flipped")) {
    return {
      x: (8 - file) * 100,
      y: (rank - 1) * 100,
    };
  }

  return {
    x: (file - 1) * 100,
    y: (8 - rank) * 100,
  };
}

/**
 * Adds a colored square highlight to the board.
 */
function addHighlight(board: HTMLElement, square: string, color: string): void {
  const transform = squareToTransform(square, board);

  if (!transform) {
    return;
  }

  const highlight = document.createElement("div");
  highlight.className = "highlight custom-bot-highlight";
  highlight.style.backgroundColor = color;
  highlight.style.transform = `translate(${transform.x}%, ${transform.y}%)`;
  highlight.style.zIndex = "1";
  board.appendChild(highlight);
}

/**
 * Highlights the origin and destination squares of a UCI move.
 */
export function highlightMove(move: string, mistakeType: MaybeMistakeType = false): void {
  clearHighlights();

  const board = getBoardElement();

  if (!board || move.length < 4) {
    return;
  }

  let toColor = "rgba(16, 185, 129, 0.7)";
  let fromColor = "rgba(16, 185, 129, 0.4)";

  if (mistakeType === "ideal") {
    toColor = "rgba(239, 68, 68, 0.7)";
    fromColor = "rgba(239, 68, 68, 0.4)";
  } else if (mistakeType === "suboptimal") {
    toColor = "rgba(249, 115, 22, 0.7)";
    fromColor = "rgba(249, 115, 22, 0.4)";
  }

  addHighlight(board, move.slice(0, 2), fromColor);
  addHighlight(board, move.slice(2, 4), toColor);
}

/**
 * Applies a UCI move to a FEN position and returns the resulting FEN.
 */
export function makeMove(fen: string, move: string): string | null {
  try {
    const chess = new Chess(fen);
    const moveInput: { from: string; to: string; promotion?: string } = {
      from: move.slice(0, 2),
      to: move.slice(2, 4),
    };

    if (move.length > 4 && move[4]) {
      moveInput.promotion = move[4];
    }

    const result = chess.move(moveInput);

    return result ? chess.fen() : null;
  } catch (error) {
    console.error("makeMove failed:", error);
    return null;
  }
}
