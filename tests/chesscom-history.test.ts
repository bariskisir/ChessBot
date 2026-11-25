/** Verifies Chess.com move-list replay across site languages and notation styles. */
import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { parseNotation, replayHistory } from "../src/providers/chesscom-history";
import { placementOf } from "../src/providers/position";

/** Plays English SAN to obtain the board a localized list must reproduce. */
function boardAfter(moves: readonly string[]): string {
  const chess = new Chess();
  for (const move of moves) chess.move(move);
  return chess.fen();
}

/** Replays the English, Portuguese, and German spellings of one game to the same FEN. */
function localizedLetters(): void {
  const english = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "d6", "c3", "O-O", "h3", "Qd7", "Kh2"];
  const portuguese = ["e4", "e5", "Cf3", "Cc6", "Bb5", "a6", "Ba4", "Cf6", "O-O", "Be7", "Te1", "b5", "Bb3", "d6", "c3", "O-O", "h3", "Dd7", "Rh2"];
  const german = ["e4", "e5", "Sf3", "Sc6", "Lb5", "a6", "La4", "Sf6", "O-O", "Le7", "Te1", "b5", "Lb3", "d6", "c3", "O-O", "h3", "Dd7", "Kh2"];
  const fen = boardAfter(english);
  for (const list of [english, portuguese, german]) assert.equal(replayHistory(list, placementOf(fen)), fen);
}
test("localized piece letters replay to the visible board", localizedLetters);

/** Accepts the node text Chess.com renders around moves, figurines, and annotations. */
function noisyText(): void {
  const fen = boardAfter(["e4", "c6", "Nf3", "e6"]);
  assert.equal(replayHistory([" e4 ", "c6 ", " Nf3!", "e6?! 0:05"], placementOf(fen)), fen);
  assert.deepEqual(parseNotation("e8=D+"), { castle: null, piece: "", file: "", rank: "", to: "e8", promotion: "D" });
  assert.deepEqual(parseNotation("Cbxd7#"), { castle: null, piece: "C", file: "b", rank: "", to: "d7", promotion: "" });
  assert.equal(parseNotation("O-O-O+")?.castle, "O-O-O");
  assert.equal(parseNotation("..."), null);
  // Figurine lists separate the icon letter from the square with whitespace.
  const figurine = boardAfter(["Nf3", "e6"]);
  assert.equal(replayHistory(["N f3 ", "e6 "], placementOf(figurine)), figurine);
  assert.equal(parseNotation(" N xd5+ ")?.piece, "N");
}
test("node text noise does not hide the move", noisyText);

/** Resolves localized promotions and refuses histories that disagree with the board. */
function promotionsAndMismatch(): void {
  const english = ["e4", "d5", "exd5", "c6", "dxc6", "Nf6", "cxb7", "Nbd7", "bxa8=Q"];
  const localized = ["e4", "d5", "exd5", "c6", "dxc6", "Cf6", "cxb7", "Cbd7", "bxa8=D"];
  const fen = boardAfter(english);
  assert.equal(replayHistory(localized, placementOf(fen)), fen);
  assert.equal(replayHistory(localized.slice(0, -1), placementOf(fen)), null);
  assert.equal(replayHistory(["e4", "Zz9"], placementOf(boardAfter(["e4"]))), null);
}
test("promotions resolve and stale histories stay rejected", promotionsAndMismatch);
