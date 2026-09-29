/** Connects the Chess.com board and result controls to the common provider contract. */
import * as board from "./chesscom-board";
import { findGameAction } from "./chesscom-automation";
import type { Provider } from "./provider";

export const chesscom: Provider = {
  name: "chess.com",
  mutationSelector: "wc-chess-board, chess-board, wc-simple-move-list, #board-layout-player-bottom, #board-layout-player-top",
  ...board,
  findGameAction,
};
