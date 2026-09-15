/** Provides a deterministic computer board for testing the actual unpacked extension. */
import { Chess, type Square } from "chess.js";
import fixtureStyles from "./board-fixture.css";
const game = new Chess();
const board = document.createElement("wc-chess-board") as HTMLElement & { game: { getFEN: () => string } };
let selected = "";
const counters = { moves: 0, rematches: 0, newMatches: 0 };
let promotionDelay = 0;
let promotionAccepted = true;
const symbols: Record<string, string> = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };

/** Returns the exact position through the site's board contract. */
function getFEN(): string { return game.fen(); }
board.game = { getFEN };

/** Renders board cells and piece classes understood by the extension. */
function render(): void {
  board.replaceChildren();
  for (let rank = 8; rank >= 1; rank--) for (let file = 1; file <= 8; file++) {
    const cell = document.createElement("div");
    cell.className = `fixture-cell ${(file + rank) % 2 ? "light" : "dark"}`;
    cell.dataset.cell = `${"abcdefgh"[file - 1]}${rank}`;
    board.append(cell);
  }
  for (const row of game.board()) for (const piece of row) if (piece) {
    const element = document.createElement("div"), file = piece.square.charCodeAt(0) - 96, rank = Number(piece.square[1]);
    element.className = `piece ${piece.color}${piece.type} square-${file}${rank} ${piece.color === "w" ? "pw" : "pb"}`;
    element.textContent = symbols[piece.type]!;
    board.querySelector(`[data-cell="${piece.square}"]`)?.append(element);
  }
}

/** Accepts actual synthetic square clicks and applies a legal fixture move. */
function click(event: MouseEvent): void {
  const rect = board.getBoundingClientRect();
  const file = Math.floor((event.clientX - rect.left) / rect.width * 8), rank = 8 - Math.floor((event.clientY - rect.top) / rect.height * 8);
  const square = `${"abcdefgh"[file]}${rank}`;
  if (!selected) { selected = square; return; }
  if (game.get(selected as Square)?.type === "p" && (rank === 8 || rank === 1)) {
    const from = selected;
    selected = "";
    void openPromotion(from, square);
    return;
  }
  try { game.move({ from: selected, to: square, promotion: "q" }); counters.moves++; render(); } catch { /* Ignore invalid synthetic moves. */ }
  selected = "";
}

/** Loads another position while leaving the panel mounted. */
function setFen(fen: string): void { game.load(fen); selected = ""; render(); }

/** Configures delayed or rejected promotion input for regression tests. */
function configurePromotion(delay: number, accepted = true): void { promotionDelay = delay; promotionAccepted = accepted; }

/** Reproduces the supplied pending-pawn markup and requires the complete event sequence. */
async function openPromotion(from: string, to: string): Promise<void> {
  const color = game.turn();
  const pawn = board.querySelector<HTMLElement>(`.piece.${color}p.square-${from.charCodeAt(0) - 96}${from[1]}`)!;
  pawn.classList.remove(`square-${from.charCodeAt(0) - 96}${from[1]}`);
  pawn.classList.add("dragging", `square-${to.charCodeAt(0) - 96}${to[1]}`);
  board.querySelector(`[data-cell="${to}"]`)?.append(pawn);
  await new Promise(
    /** Delays the chooser while the pawn remains in the site's dragging state. */
    (resolve) => setTimeout(resolve, promotionDelay));
  const chooser = document.createElement("div");
  chooser.className = "promotion-window top promotion-window--visible";
  for (const piece of ["b", "n", "q", "r"]) {
    const option = document.createElement("div");
    option.className = `promotion-piece ${color}${piece}`;
    option.textContent = symbols[piece]!;
    const events: string[] = [];
    /** Records a complete input gesture and deliberately ignores bare HTMLElement.click calls. */
    function onInput(event: Event): void {
      event.stopPropagation();
      if (event.type === "pointerdown") events.length = 0;
      events.push(event.type);
      if (event.type !== "click" || !promotionAccepted) return;
      if (events.join(",") !== "pointerdown,mousedown,pointerup,mouseup,click") return;
      game.move({ from, to, promotion: piece });
      counters.moves++;
      render();
    }
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) option.addEventListener(type, onInput);
    chooser.append(option);
  }
  board.append(chooser);
}

/** Adds production-shaped game-over buttons and records their actual click behavior. */
function gameOver(both: boolean): void {
  for (const element of document.querySelectorAll(".fixture-action")) element.remove();
  const shell = document.createElement("div");
  shell.className = "fixture-action game-over-modal-shell-buttons";
  const row = document.createElement("div");
  row.className = "game-over-secondary-actions-row-component";
  shell.append(row);
  if (both) {
    const next = document.createElement("button");
    next.className = "cc-button-component cc-button-secondary cc-button-large cc-bg-secondary";
    next.type = "button";
    const nextLabel = document.createElement("span");
    nextLabel.textContent = "New 1 + 1";
    next.append(nextLabel);
    /** Records a new-match action and resets the fixture board. */
    function newClick(): void { counters.newMatches++; finishGame(); }
    next.onclick = newClick;
    row.append(next);
  }
  const rematch = document.createElement("button");
  rematch.className = "cc-button-component cc-button-secondary cc-button-large cc-bg-secondary";
  rematch.type = "button";
  rematch.setAttribute("aria-label", "Rematch");
  const rematchLabel = document.createElement("span");
  rematchLabel.textContent = "Rematch";
  rematch.append(rematchLabel);
  /** Records a rematch and resets the fixture board. */
  function rematchClick(): void { counters.rematches++; finishGame(); }
  rematch.onclick = rematchClick;
  row.append(rematch);
  document.body.append(shell);
}

/** Removes the result controls and initializes the next computer game. */
function finishGame(): void { for (const element of document.querySelectorAll(".fixture-action")) element.remove(); game.reset(); render(); }

/** Clears action counters between independent automation checks. */
function resetCounters(): void { counters.moves = 0; counters.rematches = 0; counters.newMatches = 0; }

declare global { interface Window { chessbotFixture: { setFen: typeof setFen; gameOver: typeof gameOver; counters: typeof counters; resetCounters: typeof resetCounters; openPromotion: typeof openPromotion; configurePromotion: typeof configurePromotion } } }

/** Injects the fixture presentation so the mock declares no styles. */
function injectStyles(): void {
  if (document.querySelector("style[data-fixture-board]")) return;
  const style = document.createElement("style");
  style.dataset.fixtureBoard = "";
  style.textContent = fixtureStyles;
  document.head.append(style);
}

window.chessbotFixture = { setFen, gameOver, counters, resetCounters, openPromotion, configurePromotion };
board.addEventListener("click", click);
document.body.append(board);
injectStyles();
if (!localStorage.getItem("bot-settings")) localStorage.setItem("bot-settings", JSON.stringify({ autoPlay: false, depth: 6, autoPlayDelay: 0, mistakeProbability: 0, analyzeOpponent: true, panelPos: { top: "10px", right: "10px" } }));
render();
