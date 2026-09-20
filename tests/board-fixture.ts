/** Provides a deterministic computer board for testing the actual unpacked extension. */
import { Chess, type Square } from "chess.js";
import fixtureStyles from "./board-fixture.css";
const game = new Chess();
const board = document.createElement("wc-chess-board") as HTMLElement & { game: { getFEN: () => string } };
let selected = "";
let dragFrom = "";
const counters = { moves: 0, rematches: 0, newMatches: 0 };
let promotionDelay = 0;
let promotionAccepted = true;
const symbols: Record<string, string> = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };

/** Returns the exact position through the site's board contract. */
function getFEN(): string { return game.fen(); }
board.game = { getFEN };

/** Mirrors the site's turn markers so the extension reads the side to move without helpers. */
function updateClocks(): void {
  let bottom = document.querySelector("#board-layout-player-bottom"), top = document.querySelector("#board-layout-player-top");
  if (!(bottom instanceof HTMLElement) || !(top instanceof HTMLElement)) {
    bottom = document.createElement("div");
    bottom.id = "board-layout-player-bottom";
    top = document.createElement("div");
    top.id = "board-layout-player-top";
    document.body.append(bottom, top);
  }
  const orientation = board.classList.contains("flipped") ? "b" : "w";
  for (const [container, active] of [[bottom, game.turn() === orientation], [top, game.turn() !== orientation]] as const) {
    let marker = container.querySelector(".player-info");
    if (!marker) {
      marker = document.createElement("div");
      marker.className = "player-info";
      container.append(marker);
    }
    marker.classList.toggle("active", active);
  }
}

/** Renders board cells and piece classes understood by the extension. */
function render(): void {
  updateClocks();
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

/** Returns the exact position for test synchronization without page markers. */
function currentFen(): string { return game.fen(); }

/** Converts client coordinates into a board square, rejecting out-of-board points. */
function pointToSquare(clientX: number, clientY: number): string {
  const rect = board.getBoundingClientRect();
  const file = Math.floor((clientX - rect.left) / rect.width * 8), rank = 8 - Math.floor((clientY - rect.top) / rect.height * 8);
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return "";
  return `${"abcdefgh"[file]}${rank}`;
}

/** Applies one fixture move, opening the promotion chooser for pawns on the last rank. */
function applyMove(from: string, to: string): void {
  if (game.get(from as Square)?.type === "p" && (to[1] === "8" || to[1] === "1")) {
    void openPromotion(from, to);
    return;
  }
  try { game.move({ from, to, promotion: "q" }); counters.moves++; render(); } catch { /* Ignore invalid synthetic moves. */ }
}

/** Records a drag start so synthetic pointer drags resolve like human piece drags. */
function press(event: PointerEvent): void {
  const square = pointToSquare(event.clientX, event.clientY);
  if (square) dragFrom = square;
}

/** Accepts synthetic drags and square clicks and applies a legal fixture move. */
function click(event: MouseEvent): void {
  const square = pointToSquare(event.clientX, event.clientY);
  if (!square) return;
  if (dragFrom && dragFrom !== square) {
    const from = dragFrom;
    dragFrom = "";
    applyMove(from, square);
    return;
  }
  dragFrom = "";
  if (!selected) { selected = square; return; }
  const from = selected;
  selected = "";
  applyMove(from, square);
}

/** Loads another position while leaving the panel mounted. */
function setFen(fen: string): void { game.load(fen); selected = ""; dragFrom = ""; render(); }

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
      const gesture = events.filter(
        /** Allows pointer travel between the press and release of a drag. */
        (type) => type !== "pointermove" && type !== "mousemove");
      if (gesture.join(",") !== "pointerdown,mousedown,pointerup,mouseup,click") return;
      game.move({ from, to, promotion: piece });
      counters.moves++;
      render();
    }
    for (const type of ["pointerdown", "mousedown", "pointermove", "mousemove", "pointerup", "mouseup", "click"]) option.addEventListener(type, onInput);
    chooser.append(option);
  }
  board.append(chooser);
}

/** Adds regular or arena result controls and records their actual click behavior. */
function gameOver(both: boolean, arena = false): void {
  for (const element of document.querySelectorAll(".fixture-action")) element.remove();
  const shell = document.createElement("div");
  shell.className = arena ? "fixture-action board-modal-component" : "fixture-action game-over-modal-shell-buttons";
  const row = document.createElement("div");
  row.className = arena ? "game-over-arena-button-component" : "game-over-secondary-actions-row-component";
  shell.append(row);
  if (both) {
    const next = document.createElement("button");
    next.className = "cc-button-component cc-button-secondary cc-button-large cc-bg-secondary";
    if (arena) next.classList.add("game-over-arena-button-button");
    next.type = "button";
    const nextLabel = document.createElement("span");
    nextLabel.textContent = arena ? "Next Arena Game" : "New 1 + 1";
    next.append(nextLabel);
    /** Records a new-match action and resets the fixture board. */
    function newClick(): void { counters.newMatches++; finishGame(); }
    next.onclick = newClick;
    row.append(next);
    if (arena) {
      const finding = document.createElement("button");
      finding.className = "game-over-arena-button-button game-over-arena-button-finding";
      finding.textContent = "Finding Next Game...";
      finding.hidden = true;
      /** Makes an accidental click on the search indicator fail the match-count assertion. */
      finding.onclick = () => { counters.newMatches += 100; };
      row.prepend(finding);
    }
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

declare global { interface Window { chessbotFixture: { setFen: typeof setFen; fen: typeof currentFen; gameOver: typeof gameOver; counters: typeof counters; resetCounters: typeof resetCounters; openPromotion: typeof openPromotion; configurePromotion: typeof configurePromotion } } }

/** Injects the fixture presentation so the mock declares no styles. */
function injectStyles(): void {
  if (document.querySelector("style[data-fixture-board]")) return;
  const style = document.createElement("style");
  style.dataset.fixtureBoard = "";
  style.textContent = fixtureStyles;
  document.head.append(style);
}

window.chessbotFixture = { setFen, fen: currentFen, gameOver, counters, resetCounters, openPromotion, configurePromotion };
board.addEventListener("pointerdown", press);
board.addEventListener("click", click);
new MutationObserver(
  /** Refreshes turn markers when the board orientation changes beneath the fixture. */
  () => updateClocks()).observe(board, { attributes: true, attributeFilter: ["class"] });
document.body.append(board);
injectStyles();
if (!localStorage.getItem("bot-settings")) localStorage.setItem("bot-settings", JSON.stringify({ autoPlay: false, depth: 6, autoPlayDelay: 0, mistakeProbability: 0, analyzeOpponent: true, panelPos: { top: "10px", right: "10px" } }));
render();
