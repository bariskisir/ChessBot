/** Reads the player's Chess.com clock and the current round's time control. */
import { ClockReader, readTimeControl, type GameClock } from "./clock";
import { getBoard } from "./chesscom-board";
const reader = new ClockReader();

/** Uses the bottom player's clock, which follows the Chess.com player orientation. */
export function readClock(): GameClock | null {
  const board = getBoard();
  if (!board) return null;
  const root = document.querySelector("#board-layout-player-bottom");
  const clock = root?.querySelector(".clock-component, .clock") ?? null;
  const time = clock?.querySelector(".clock-time, [data-time], [role='timer']") ?? clock;
  const running = !!clock?.matches(".clock-player-turn, .active") || !!root?.querySelector(".clock-player-turn, .player-info.active");
  const control = readTimeControl("[data-time-control], .time-control-component, .game-info-time-control, .game-info-component [title], .time-control-selector-component .selected");
  return reader.read(time, control, running, `${location.pathname}:${board.classList.contains("flipped") ? "b" : "w"}`);
}
