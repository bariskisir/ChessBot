/** Starts the React companion panel on Chess.com. */
import { mount } from "./mount";
import boardStyles from "./styles/board.scss";

/** Keeps the injected page style for deduplication without leaving a marker attribute. */
let boardStyle: HTMLStyleElement | null = null;

/** Injects highlight styling into the page world, where board squares live. */
function injectBoardStyles(): void {
  if (boardStyle?.isConnected) return;
  boardStyle = document.createElement("style");
  boardStyle.textContent = boardStyles;
  document.head.append(boardStyle);
}

injectBoardStyles();
mount();
