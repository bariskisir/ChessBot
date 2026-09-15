/** Exposes the site's exact position to the isolated extension interface. */
interface SiteBoard extends HTMLElement { game?: { getFEN?: () => string } }

/** Copies current game state when the site's board API is available. */
function publishPosition(): void {
  const board = document.querySelector<SiteBoard>("wc-chess-board, chess-board");
  if (!board) return;
  try {
    const fen = board.game?.getFEN?.();
    if (typeof fen === "string" && fen.length < 200) board.setAttribute("data-chessbot-fen", fen);
    else board.removeAttribute("data-chessbot-fen");
  } catch { board.removeAttribute("data-chessbot-fen"); }
}
setInterval(publishPosition, 250);
publishPosition();
