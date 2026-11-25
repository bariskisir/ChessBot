/** Replays Chess.com move lists whose piece letters depend on the site language. */
import { Chess, type PieceSymbol } from "chess.js";
import { placementOf } from "./position";

/** One displayed move reduced to the parts every site language writes identically. */
interface Notation {
  castle: "O-O" | "O-O-O" | null;
  piece: string;
  file: string;
  rank: string;
  to: string;
  promotion: string;
}

type Letters = ReadonlyMap<string, PieceSymbol>;

/** Bounds the ambiguity search so an unexpected list cannot stall the observer. */
const SEARCH_LIMIT = 4096;

/** Localized piece letters are any symbol that cannot belong to coordinates or move marks. */
const SAN = /(?<castle>[O0]-[O0](?:-[O0])?)|(?<piece>[^\sa-h\d x:=+#.\-!?()]?)(?<file>[a-h]?)(?<rank>[1-8]?)[x:]?(?<to>[a-h][1-8])(?:=?(?<promotion>[^\sa-h\d x:=+#.\-!?()]))?/u;

/** Extracts the move from node text, ignoring annotations, timestamps, and spacing. */
export function parseNotation(text: string): Notation | null {
  // Figurine lists put whitespace between the icon and the square ("N f3").
  const groups = SAN.exec(text.replace(/\s+/g, ""))?.groups;
  if (!groups) return null;
  if (groups.castle) return { castle: groups.castle.length > 3 ? "O-O-O" : "O-O", piece: "", file: "", rank: "", to: "", promotion: "" };
  return { castle: null, piece: groups.piece ?? "", file: groups.file ?? "", rank: groups.rank ?? "", to: groups.to ?? "", promotion: groups.promotion ?? "" };
}

/** Checks one letter against the language mapping learned so far, extending it when new. */
function learn(letters: Letters, letter: string, piece: PieceSymbol): Letters | null {
  const known = letters.get(letter);
  if (known) return known === piece ? letters : null;
  return new Map(letters).set(letter, piece);
}

/** Converts an English SAN piece letter into the piece it names. */
function pieceOf(letter: string): PieceSymbol { return letter.toLowerCase() as PieceSymbol; }

/**
 * Lists the legal moves a localized notation can denote, each with its implied letters.
 * Chess.com writes canonical SAN, so only the piece letters differ from chess.js output;
 * plain SAN strings avoid the per-move FEN work of verbose move generation.
 */
function candidates(chess: Chess, notation: Notation, letters: Letters): { san: string; letters: Letters }[] {
  const found: { san: string; letters: Letters }[] = [];
  for (const san of chess.moves()) {
    const legal = parseNotation(san);
    if (!legal || legal.castle !== notation.castle) continue;
    if (notation.castle) { found.push({ san, letters }); continue; }
    if (legal.to !== notation.to || legal.file !== notation.file || legal.rank !== notation.rank) continue;
    if (!legal.piece !== !notation.piece || !legal.promotion !== !notation.promotion) continue;
    let learned: Letters | null = letters;
    if (notation.piece) learned = learn(learned, notation.piece, pieceOf(legal.piece));
    if (learned && notation.promotion) learned = learn(learned, notation.promotion, pieceOf(legal.promotion));
    if (learned) found.push({ san, letters: learned });
  }
  return found;
}

/**
 * Finds the unique legal game whose displayed moves end on the visible placement.
 * Piece letters are learned instead of assumed, so English, localized, and figurine
 * lists replay alike; ambiguous early letters are settled by later moves or the board.
 */
export function replayHistory(texts: readonly string[], placement: string): string | null {
  const notations: Notation[] = [];
  for (const text of texts) {
    if (!text.trim()) continue;
    const notation = parseNotation(text);
    if (!notation) return null;
    notations.push(notation);
  }
  const chess = new Chess();
  let budget = SEARCH_LIMIT, result: string | null = null, solutions = 0;
  /** Depth-first search over the moves each notation allows, stopping at a second solution. */
  const search = (index: number, letters: Letters): void => {
    if (solutions > 1 || --budget < 0) return;
    const notation = notations[index];
    if (!notation) {
      if (placementOf(chess.fen()) !== placement) return;
      if (result !== chess.fen()) solutions++;
      result = chess.fen();
      return;
    }
    for (const option of candidates(chess, notation, letters)) {
      chess.move(option.san);
      search(index + 1, option.letters);
      chess.undo();
      if (solutions > 1) return;
    }
  };
  search(0, new Map());
  return solutions === 1 && budget >= 0 ? result : null;
}
