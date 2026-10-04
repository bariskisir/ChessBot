/** Adapts pinned Lozza workers to MultiPV without changing their vendored source. */
import { Chess } from "chess.js";
interface LozzaRuntime {
  rootNode: { getNextMove: () => number };
  board: { formatMove?: (move: number, format: number) => string; mvFmt: number };
}
declare const lozza: LozzaRuntime;
declare const UCI_FMT: number;
declare const MATE: number;
declare const MINMATE: number;
declare const formatMove: (move: number, format: number) => string;

const scope = self as unknown as DedicatedWorkerGlobalScope;
const engine = new URL(scope.location.href).searchParams.get("engine");
if (engine !== "lozza-2" && engine !== "lozza-5") throw new Error("Unknown bundled Lozza version.");
scope.importScripts(`${engine}.js`);
lozza.board.mvFmt = UCI_FMT;
const handleCommand = scope.onmessage!;
const send = scope.postMessage.bind(scope);
const nextMove = lozza.rootNode.getNextMove.bind(lozza.rootNode);
let lines = 1, rank = 1, position = "", candidate = "", primary = "", collecting = false;
let legalMoves = 0;
let hasVariation = false, fallbackScore = "cp 0";
const excluded = new Set<string>();

/** Skips previously selected root moves while leaving every continuation unrestricted. */
lozza.rootNode.getNextMove = () => {
  let move = nextMove();
  while (move && excluded.has(lozza.board.formatMove ? lozza.board.formatMove(move, UCI_FMT) : formatMove(move, UCI_FMT))) move = nextMove();
  return move;
};

/** Converts Lozza's mate distances and mate-range centipawns to UCI full-move counts. */
function normalizeScore(message: string): string {
  let normalized = message.replace(/#/g, "");
  const mate = /\bscore mate (\d+)\b/.exec(normalized);
  if (mate) normalized = normalized.replace(/\bscore mate \d+\b/, `score mate ${Number(mate[1]) + 1}`);
  const score = Number(/\bscore cp (-?\d+)\b/.exec(normalized)?.[1] ?? 0);
  if (Math.abs(score) >= MINMATE && Math.abs(score) <= MATE) {
    const distance = Math.max(1, Math.ceil((MATE - Math.abs(score)) / 2)) * Math.sign(score);
    normalized = normalized.replace(/\bscore cp -?\d+\b/, `score mate ${distance}`);
  }
  return normalized;
}

/** Captures bestmoves and supplies a scored PV when Lozza returns its sole legal move immediately. */
scope.postMessage = (message: unknown): void => {
  if (typeof message !== "string" || !collecting) { send(message); return; }
  if (message.startsWith("bestmove ")) {
    candidate = message.split(/\s+/)[1] ?? "";
    if (!hasVariation && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(candidate)) send(`info depth 1 score ${fallbackScore} pv ${candidate} multipv ${rank}`);
    return;
  }
  const normalized = normalizeScore(message);
  fallbackScore = /\bscore ((?:cp|mate) -?\d+)\b/.exec(normalized)?.[1] ?? fallbackScore;
  if (message.startsWith("info ") && /\bpv\s+[a-h][1-8][a-h][1-8]/.test(normalized) && /\bscore (?:cp|mate)\b/.test(normalized)) {
    hasVariation = true;
    send(`${normalized} multipv ${rank}`);
  } else send(normalized);
};

/** Dispatches one synchronous UCI command to the original version-specific handler. */
function command(data: string): void {
  handleCommand.call(scope, new MessageEvent<string>("message", { data }));
  // Position loading restores the browser's SAN format in both upstream versions.
  lozza.board.mvFmt = UCI_FMT;
}

/** Searches successively weaker root choices within one shared movetime budget. */
function search(data: string): void {
  excluded.clear();
  primary = "";
  const moveTime = Number(/\bmovetime (\d+)/.exec(data)?.[1] ?? 0);
  const deadline = moveTime ? Date.now() + moveTime : null;
  collecting = true;
  try {
    const count = Math.min(lines, legalMoves);
    for (rank = 1; rank <= count; rank++) {
      const remaining = deadline === null ? null : deadline - Date.now();
      if (rank > 1 && remaining !== null && remaining <= 0) break;
      candidate = "";
      hasVariation = false;
      fallbackScore = "cp 0";
      if (rank > 1) {
        // Clear PV hash entries that may still lead through an excluded root move.
        command("ucinewgame");
        command(position);
      }
      command(remaining === null ? data : data.replace(/\bmovetime \d+/, `movetime ${Math.max(1, Math.floor(remaining / (count - rank + 1)))}`));
      if (!candidate || candidate === "0000" || candidate === "(none)" || excluded.has(candidate)) break;
      primary ||= candidate;
      excluded.add(candidate);
    }
  } finally {
    collecting = false;
    excluded.clear();
  }
  send(`bestmove ${primary || "0000"}`);
}

/** Handles adapter options and delegates ordinary UCI commands to the pinned engine. */
scope.onmessage = (event: MessageEvent<unknown>): void => {
  if (typeof event.data !== "string") return;
  const data = event.data.trim();
  if (/^setoption name MultiPV value \d+$/.test(data)) { lines = Math.max(1, Math.min(10, Number(data.split(" ").at(-1)))); return; }
  if (data.startsWith("position ")) {
    position = data;
    legalMoves = new Chess(data.startsWith("position fen ") ? data.slice(13) : undefined).moves().length;
  }
  if (data.startsWith("go ")) search(data);
  else command(data);
};
