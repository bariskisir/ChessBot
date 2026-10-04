/** Recreates the supplied Lichess round markup with trusted board input. */
import { Chess } from "chess.js";
import fixtureStyles from "./lichess-fixture.css";

const game = new Chess();
const counts = { moves: 0, rematches: 0, newMatches: 0 };
const shell = document.createElement("main");
shell.className = "round";
shell.innerHTML = '<aside class="game__meta"><section class="status"></section></aside><div class="round__app variant-standard"><div class="round__app__board main-board"><div class="cg-wrap orientation-black manipulable"><cg-container><cg-board></cg-board></cg-container></div></div><i5d><a class="fbt analysis" href="/I6QeHeX0/white/analysis#0">Analysis board</a><app></app></i5d><div class="rcontrols"><div class="follow-up"></div></div></div>';
const board = shell.querySelector<HTMLElement>("cg-board")!;
const wrap = shell.querySelector<HTMLElement>(".cg-wrap")!;
let origin = "";
let showHistory = true;

/** Maps a viewport point to the board's current orientation. */
function squareAt(x: number, y: number): string {
  const rect = board.getBoundingClientRect();
  const file = Math.floor((x - rect.left) / (rect.width / 8)), rank = Math.floor((y - rect.top) / (rect.height / 8));
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return "";
  return wrap.classList.contains("orientation-black") ? `${"abcdefgh"[7 - file]}${rank + 1}` : `${"abcdefgh"[file]}${8 - rank}`;
}

/** Renders the piece transforms and SAN tags present in a round page. */
function render(): void {
  for (const color of ["w", "b"] as const) shell.querySelector(`.rclock-${color === "w" ? "white" : "black"}`)?.classList.toggle("running", game.turn() === color);
  board.replaceChildren();
  const black = wrap.classList.contains("orientation-black");
  for (const row of game.board()) for (const piece of row) if (piece) {
    const element = document.createElement("piece");
    element.className = `${piece.color === "w" ? "white" : "black"} ${{ p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }[piece.type]}`;
    const file = piece.square.charCodeAt(0) - 97, rank = Number(piece.square[1]) - 1;
    element.style.transform = `translate(${(black ? 7 - file : file) * 60}px, ${(black ? rank : 7 - rank) * 60}px)`;
    board.append(element);
  }
  const history = game.history();
  let list = shell.querySelector("i5d app");
  if (!showHistory || !history.length) { list?.remove(); return; }
  if (!list) { list = document.createElement("app"); shell.querySelector("i5d")!.append(list); }
  list.replaceChildren();
  for (const [index, san] of history.entries()) {
    if (index % 2 === 0) { const number = document.createElement("qzm"); number.textContent = String(Math.floor(index / 2) + 1); list.append(number); }
    const move = document.createElement("z7yx"); move.textContent = san;
    if (index === history.length - 1) move.className = "a1t";
    list.append(move);
  }
}

/** Adds color-owned round clocks and visible increment metadata for timing checks. */
function setClock(initialMs: number | null, incrementMs = 0, whiteMs = initialMs ?? 0, blackMs = initialMs ?? 0): void {
  for (const element of shell.querySelectorAll(".rclock, .setup")) element.remove();
  if (initialMs === null) return;
  const setup = document.createElement("div"), control = document.createElement("span");
  setup.className = "setup";
  control.className = "clock";
  control.textContent = `${initialMs / 60000}+${incrementMs / 1000}`;
  setup.append(control);
  shell.querySelector(".game__meta")!.append(setup);
  for (const [name, remainingMs] of [["white", whiteMs], ["black", blackMs]] as const) {
    const clock = document.createElement("div"), time = document.createElement("div");
    clock.className = `rclock rclock-${name}`;
    clock.classList.toggle("running", game.turn() === (name === "white" ? "w" : "b"));
    time.className = "time";
    time.textContent = `${Math.floor(remainingMs / 60000)}:${((remainingMs % 60000) / 1000).toFixed(1).padStart(4, "0")}`;
    clock.append(time);
    shell.querySelector(".round__app")!.append(clock);
  }
}

/** Loads a standard game prefix and switches board orientation. */
function setMoves(moves: string[], color: "w" | "b", historyVisible = true): void {
  game.reset();
  for (const move of moves) game.move(move);
  showHistory = historyVisible;
  wrap.classList.toggle("orientation-black", color === "b");
  wrap.classList.toggle("orientation-white", color === "w");
  shell.querySelector(".game__meta > section.status")!.textContent = "";
  shell.querySelector(".follow-up")!.replaceChildren();
  origin = "";
  render();
}

/** Accepts a trusted drag using the same input boundary as Chessground. */
function release(event: MouseEvent): void {
  if (!event.isTrusted || !origin) return;
  const target = squareAt(event.clientX, event.clientY), from = origin;
  origin = "";
  if (!target || target === from) return;
  try { game.move({ from, to: target, promotion: "q" }); counts.moves++; render(); } catch { /* Ignore an illegal test drag. */ }
}

/** Exposes result controls from the supplied round markup. */
function gameOver(): void {
  shell.querySelector(".game__meta > section.status")!.textContent = "Game over";
  const actions = shell.querySelector(".follow-up")!;
  actions.innerHTML = '<button class="fbt rematch">Rematch</button><button class="fbt new-opponent">New opponent</button>';
  actions.querySelector(".rematch")!.addEventListener("click",
    /** Navigates to a new round as Lichess does for an accepted rematch. */
    () => { counts.rematches++; location.href = "/RmTc1234/white"; });
  actions.querySelector(".new-opponent")!.addEventListener("click",
    /** Visits the lobby before Lichess assigns another round URL. */
    () => { counts.newMatches++; location.href = "/?hook_like=uEYiEOQf"; });
}

declare global { interface Window { lichessFixture: { setMoves: typeof setMoves; fen: () => string; counts: typeof counts; gameOver: typeof gameOver; setClock: typeof setClock } } }
window.lichessFixture = { setMoves, setClock, fen:
  /** Returns the fixture's current legal position. */
  () => game.fen(), counts, gameOver };
board.addEventListener("mousedown",
  /** Ignores synthetic events as production Chessground does. */
  (event) => { if (event.isTrusted) origin = squareAt(event.clientX, event.clientY); });
document.addEventListener("mouseup", release);
const style = document.createElement("style");
style.textContent = fixtureStyles;
document.head.append(style);
document.body.append(shell);
setMoves(location.pathname.startsWith("/uEYiEOQf") ? ["e4"] : [], location.pathname.endsWith("/black") ? "b" : "w");
