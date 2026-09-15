/** Provides a deterministic computer board for testing the actual unpacked extension. */
import { Chess, type Square } from "chess.js";
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

/** Renders piece classes and square coordinates understood by the extension. */
function render(): void {
  board.replaceChildren();
  for (let rank = 8; rank >= 1; rank--) for (let file = 1; file <= 8; file++) {
    const square = document.createElement("div");
    square.style.cssText = `position:absolute;left:${(file - 1) * 12.5}%;top:${(8 - rank) * 12.5}%;width:12.5%;height:12.5%;background:${(file + rank) % 2 ? "#eeeed2" : "#769656"}`;
    board.append(square);
  }
  for (const row of game.board()) for (const piece of row) if (piece) {
    const element = document.createElement("div"), file = piece.square.charCodeAt(0) - 96, rank = Number(piece.square[1]);
    element.className = `piece ${piece.color}${piece.type} square-${file}${rank}`;
    element.textContent = symbols[piece.type]!;
    element.style.cssText = `position:absolute;left:${(file - 1) * 12.5}%;top:${(8 - rank) * 12.5}%;width:12.5%;height:12.5%;display:grid;place-items:center;font:56px 'Segoe UI Symbol';color:${piece.color === "w" ? "white" : "#222"};text-shadow:0 1px 2px #000`;
    board.append(element);
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
  pawn.style.left = `${(to.charCodeAt(0) - 97) * 12.5}%`;
  pawn.style.top = `${(8 - Number(to[1])) * 12.5}%`;
  await new Promise(
    /** Delays the chooser while the pawn remains in the site's dragging state. */
    (resolve) => setTimeout(resolve, promotionDelay));
  const chooser = document.createElement("div");
  chooser.className = "promotion-window top promotion-window--visible";
  chooser.style.cssText = "position:absolute;top:0;left:0;width:70px;background:white;z-index:20";
  for (const piece of ["b", "n", "q", "r"]) {
    const option = document.createElement("div");
    option.className = `promotion-piece ${color}${piece}`;
    option.style.cssText = "height:60px;color:black;font-size:40px;cursor:pointer";
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

/** Adds the game-over buttons and records their actual click behavior. */
function gameOver(both: boolean): void {
  for (const element of document.querySelectorAll(".fixture-action")) element.remove();
  const rematch = document.createElement("button");
  rematch.className = "fixture-action";
  rematch.dataset.control = "rematch";
  rematch.textContent = "Rematch";
  /** Records a rematch and resets the fixture board. */
  function rematchClick(): void { counters.rematches++; finishGame(); }
  rematch.onclick = rematchClick;
  document.body.append(rematch);
  if (both) {
    const next = document.createElement("button");
    next.className = "fixture-action";
    next.dataset.cy = "game-over-modal-new-game-button";
    next.textContent = "New Game";
    /** Records a new-match action and resets the fixture board. */
    function newClick(): void { counters.newMatches++; finishGame(); }
    next.onclick = newClick;
    document.body.append(next);
  }
}

/** Removes the result controls and initializes the next computer game. */
function finishGame(): void { for (const element of document.querySelectorAll(".fixture-action")) element.remove(); game.reset(); render(); }

/** Clears action counters between independent automation checks. */
function resetCounters(): void { counters.moves = 0; counters.rematches = 0; counters.newMatches = 0; }

declare global { interface Window { chessbotFixture: { setFen: typeof setFen; gameOver: typeof gameOver; counters: typeof counters; resetCounters: typeof resetCounters; openPromotion: typeof openPromotion; configurePromotion: typeof configurePromotion } } }
window.chessbotFixture = { setFen, gameOver, counters, resetCounters, openPromotion, configurePromotion };
board.style.cssText = "display:block;position:relative;width:560px;height:560px;margin:32px";
board.addEventListener("click", click);
document.body.style.cssText = "background:#302e2b;color:#ddd;font:14px Arial";
document.body.append(board);
if (!localStorage.getItem("bot-settings")) localStorage.setItem("bot-settings", JSON.stringify({ autoPlay: false, depth: 6, autoPlayDelay: 0, mistakeProbability: 0, panelPos: { top: "10px", right: "10px" } }));
render();
