/** Starts the React companion panel on Chess.com. */
import { mount } from "./mount";
import boardStyles from "./styles/board.scss";

/** Injects highlight styling into the page world, where board squares live. */
function injectBoardStyles(): void {
  if (document.querySelector("style[data-chessbot-board]")) return;
  const style = document.createElement("style");
  style.dataset.chessbotBoard = "";
  style.textContent = boardStyles;
  document.head.append(style);
}

injectBoardStyles();
mount();
