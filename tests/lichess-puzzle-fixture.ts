/** Recreates the supplied Lichess training board and move list offline. */
import { Chess } from "chess.js";
import fixtureStyles from "./lichess-fixture.css";

const game = new Chess();
const moves = "d4 e5 c4 exd4 Qxd4 Nc6 Qd1 Nf6 Nf3 Bc5 e3 O-O Be2 Re8 O-O d6 b3 Bf5 Bb2 Qe7 Nc3 Rad8 Nd5 Nxd5 Qxd5 Ne5 Rad1 c6 Qd2 Ng4 h3 Nxe3 Qc3 f6".split(" ");
for (const san of moves) game.move(san);
const counts = { moves: 0, solutionViews: 0, continues: 0 };
const shell = document.createElement("main");
shell.className = "puzzle puzzle-play";
shell.innerHTML = '<div class="puzzle__board main-board"><div class="cg-wrap orientation-white manipulable"><cg-container><cg-board></cg-board></cg-container></div></div><div class="puzzle__tools"><div class="puzzle__moves areplay"><div class="tview2 tview2-column"></div></div><div class="puzzle__feedback play"><div class="player"><div class="no-square"><piece class="king white"></piece></div><div class="instruction"><strong>Your turn</strong><em>Find the best move for white.</em></div></div><div class="view_solution show"><button>Get a hint</button><button>View the solution</button></div></div></div>';
const board = shell.querySelector<HTMLElement>("cg-board")!;
const wrap = shell.querySelector<HTMLElement>(".cg-wrap")!;
const list = shell.querySelector<HTMLElement>(".tview2")!;
let origin = "";
let lastGoodPly = -1;

/** Maps a trusted pointer to a board square in either orientation. */
function squareAt(x: number, y: number): string {
  const rect = board.getBoundingClientRect();
  const file = Math.floor((x - rect.left) / (rect.width / 8)), rank = Math.floor((y - rect.top) / (rect.height / 8));
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return "";
  return wrap.classList.contains("orientation-black") ? `${"abcdefgh"[7 - file]}${rank + 1}` : `${"abcdefgh"[file]}${8 - rank}`;
}

/** Keeps the rendered pieces and SAN history aligned with the legal position. */
function render(): void {
  board.replaceChildren();
  const black = wrap.classList.contains("orientation-black");
  for (const row of game.board()) for (const piece of row) if (piece) {
    const element = document.createElement("piece");
    element.className = `${piece.color === "w" ? "white" : "black"} ${{ p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }[piece.type]}`;
    const file = piece.square.charCodeAt(0) - 97, rank = Number(piece.square[1]) - 1;
    element.style.transform = `translate(${(black ? 7 - file : file) * 60}px, ${(black ? rank : 7 - rank) * 60}px)`;
    board.append(element);
  }
  list.replaceChildren();
  const history = game.history();
  for (const [index, san] of history.entries()) {
    if (index % 2 === 0) { const number = document.createElement("index"); number.textContent = String(Math.floor(index / 2) + 1); list.append(number); }
    const node = document.createElement("move");
    node.className = index === lastGoodPly ? "good" : index === history.length - 1 ? "active" : index === moves.length - 1 ? "current" : "hist";
    node.textContent = san;
    if (index === lastGoodPly) { const glyph = document.createElement("glyph"); glyph.textContent = "✓"; node.append(glyph); }
    list.append(node);
  }
}

/** Replies after a correct move so a multi-move training puzzle can continue. */
function reply(): void {
  const move = game.moves()[0];
  if (move) { game.move(move); render(); }
}

/** Accepts only the trusted drag path sent by the extension. */
function release(event: MouseEvent): void {
  if (!event.isTrusted || !origin) return;
  const target = squareAt(event.clientX, event.clientY), from = origin;
  origin = "";
  if (!target || target === from) return;
  try {
    const ply = game.history().length;
    game.move({ from, to: target, promotion: "q" });
    lastGoodPly = ply;
    counts.moves++;
    const feedback = shell.querySelector<HTMLElement>(".puzzle__feedback")!;
    feedback.className = "puzzle__feedback good";
    feedback.innerHTML = '<div class="player"><div class="icon">✓</div><div class="instruction"><strong>Best move!</strong><em>Keep going…</em></div></div><div class="view_solution show"><button>Get a hint</button><button>View the solution</button></div>';
    render();
    if (counts.moves === 1) setTimeout(reply, 200);
  }
  catch { /* The fixture ignores illegal drags as Chessground does. */ }
}

/** Exposes failure feedback while keeping the position at the last accepted move. */
function fail(): void {
  const wrong = document.createElement("move");
  wrong.className = "fail";
  wrong.innerHTML = 'Rxf7<glyph title="Puzzle failed">✗</glyph>';
  list.append(wrong);
  const feedback = shell.querySelector<HTMLElement>(".puzzle__feedback")!;
  feedback.className = "puzzle__feedback fail";
  feedback.innerHTML = '<div class="player"><div class="icon">✗</div><div class="instruction"><strong>That\'s not the move!</strong><em>Try something else.</em></div></div><div class="view_solution show"><button>Get a hint</button><button>View the solution</button></div>';
}

/** Follows the failure-to-solution-to-next-puzzle controls from Lichess. */
function onAction(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const feedback = shell.querySelector<HTMLElement>(".puzzle__feedback")!;
  if (target.closest(".view_solution.show button:last-child")) {
    counts.solutionViews++;
    feedback.className = "puzzle__feedback after";
    feedback.innerHTML = '<div class="complete">Puzzle complete!</div><button class="continue">Continue training</button>';
  } else if (target.closest(".puzzle__feedback.after button.continue")) {
    counts.continues++;
    game.reset();
    for (const san of moves) game.move(san);
    lastGoodPly = -1;
    feedback.className = "puzzle__feedback play";
    feedback.innerHTML = '<div class="player"><div class="no-square"><piece class="king white"></piece></div><div class="instruction"><strong>Your turn</strong><em>Find the best move for white.</em></div></div><div class="view_solution show"><button>Get a hint</button><button>View the solution</button></div>';
    render();
  }
}

declare global { interface Window { lichessPuzzleFixture: { fen: () => string; counts: typeof counts; flip: () => void; fail: typeof fail } } }
window.lichessPuzzleFixture = {
  fen: /** Returns the current training position. */ () => game.fen(),
  counts,
  flip: /** Flips only the visible board, preserving the puzzle player's side. */ () => {
    wrap.classList.toggle("orientation-black");
    wrap.classList.toggle("orientation-white");
    render();
  },
  fail,
};
shell.addEventListener("click", onAction);
board.addEventListener("mousedown",
  /** Begins a move only when Chrome sends trusted input. */
  (event) => { if (event.isTrusted) origin = squareAt(event.clientX, event.clientY); });
document.addEventListener("mouseup", release);
const style = document.createElement("style");
style.textContent = fixtureStyles;
document.head.append(style);
document.body.append(shell);
render();
