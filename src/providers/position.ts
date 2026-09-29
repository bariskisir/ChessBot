/** Shares FEN comparisons, placement serialization, and legal history tracking. */
import { Chess, type Color } from "chess.js";

export interface PlayerPosition { fen: string; player: Color }

/** Compares legal position state without letting move counters trigger another action. */
export function samePosition(first: string, second: string): boolean {
  const a = first.split(" "), b = second.split(" ");
  return a.length >= 4 && b.length >= 4 && a.slice(0, 4).join(" ") === b.slice(0, 4).join(" ");
}

/** Extracts the piece placement shared by visible boards and reconstructed histories. */
export function placementOf(fen: string): string { return fen.split(" ")[0] ?? ""; }

/** Serializes algebraic square keys so providers use the same empty-square rules. */
export function serializePlacement(cells: ReadonlyMap<string, string>): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = "", empty = 0;
    for (const file of "abcdefgh") {
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

/** Preserves hidden rights only when the visible board has one legal continuation. */
export class PositionTracker {
  private fen: string | null = null;
  private rejectedPlacement: string | null = null;

  /** Starts a fresh session or adopts an authoritative move-list reconstruction. */
  reset(fen: string | null = null): void { this.fen = fen; this.rejectedPlacement = null; }

  /** Searches at most two plies to tolerate a reply arriving between observer checks. */
  follow(placement: string): string | null {
    if (!this.fen) return null;
    if (placementOf(this.fen) === placement) return this.fen;
    if (this.rejectedPlacement === placement) return null;
    const game = new Chess(this.fen), matches = new Set<string>();
    for (const first of game.moves()) {
      game.move(first);
      if (placementOf(game.fen()) === placement) matches.add(game.fen());
      else for (const second of game.moves()) {
        game.move(second);
        if (placementOf(game.fen()) === placement) matches.add(game.fen());
        game.undo();
      }
      game.undo();
    }
    if (matches.size !== 1) { this.rejectedPlacement = placement; return null; }
    this.fen = matches.values().next().value ?? null;
    this.rejectedPlacement = null;
    return this.fen;
  }
}
