/** Reads color-owned Lichess round clocks independently of board orientation. */
import { ClockReader, readTimeControl, type GameClock, type TimeControl } from "./clock";
import { lichessBoard, lichessGameId } from "./lichess-dom";
import { userColor } from "./lichess-board";
const reader = new ClockReader();
let bootstrapCache: { gameId: string | null; script: Element; control: TimeControl } | null = null;

/** Reads only validated numeric clock metadata from the current round bootstrap. */
function bootstrapControl(): TimeControl | null {
  const gameId = lichessGameId(location.pathname);
  if (bootstrapCache?.gameId === gameId && bootstrapCache.script.isConnected) return bootstrapCache.control;
  for (const script of document.querySelectorAll("script:not([src])")) {
    const text = script.textContent ?? "";
    if (gameId && !new RegExp(`"id"\\s*:\\s*"${gameId}"`).test(text)) continue;
    const clock = /"clock"\s*:\s*(\{[^{}]{1,1000}\})/.exec(text);
    if (!clock) continue;
    try {
      const value: unknown = JSON.parse(clock[1]!);
      if (!value || typeof value !== "object") continue;
      const { initial, increment } = value as { initial?: unknown; increment?: unknown };
      if (typeof initial === "number" && Number.isFinite(initial) && initial > 0 && initial <= 86400 &&
          typeof increment === "number" && Number.isFinite(increment) && increment >= 0 && increment <= 3600) {
        const control = { initialMs: initial * 1000, incrementMs: increment * 1000 };
        bootstrapCache = { gameId, script, control };
        return control;
      }
    } catch { /* Ignore unrelated or incomplete page data. */ }
  }
  return null;
}

/** Leaves training and untimed boards immediate instead of inventing match clocks. */
export function readClock(): GameClock | null {
  const context = lichessBoard();
  if (!context || context.mode !== "round") return null;
  const color = userColor(), name = color === "w" ? "white" : "black";
  const clock = context.root.querySelector(`.rclock-${name}`);
  const time = clock?.querySelector(".time") ?? null;
  if (!time) return null;
  let control = readTimeControl(".game__meta .setup .clock, .game__meta [data-time-control]") ?? bootstrapControl();
  if (control && clock?.querySelector(".bar.berserk, .berserked")) control = { initialMs: control.initialMs / 2, incrementMs: 0 };
  return reader.read(time, control, clock?.classList.contains("running") ?? false, `${lichessGameId(location.pathname)}:${color}`);
}
