/** Defines the local engine protocol and validates persisted preferences. */
export interface PanelPosition { top: string; left?: string; right?: string }
export interface Settings {
  depth: number; time: number; lines: number; autoPlay: boolean;
  autoPlayDelay: number; autoNewMatch: boolean; autoRematch: boolean; analyzeOpponent: boolean;
  mistakeProbability: number; thinkingTime: number; panelPos: PanelPosition;
}
export interface Variation { depth: number; score: number; mate: number | null; moves: string[]; nodes: number }
export interface Analysis { fen: string; bestMove: string; variations: Variation[] }
export interface EngineRequest { target: "background" | "engine"; action: "analyze" | "stop"; owner: string; fen: string; settings: Settings }
export type EngineResponse = { result: Analysis } | { error: string };
export const DEFAULT_SETTINGS: Settings = {
  depth: 18, time: 0, lines: 1, autoPlay: true, autoPlayDelay: 0,
  autoNewMatch: false, autoRematch: false, analyzeOpponent: true, mistakeProbability: 0,
  thinkingTime: 100, panelPos: { top: "10px", right: "10px" },
};

/** Clamps finite numeric settings to their supported integer range. */
function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

/** Discards obsolete engine settings and rejects malformed stored values. */
export function normalizeSettings(value: unknown): Settings {
  const data = value && typeof value === "object" ? value as Partial<Settings> : {};
  const panelPos: PanelPosition = { top: positionValue(data.panelPos?.top, "10px") };
  if (data.panelPos?.left !== undefined) panelPos.left = positionValue(data.panelPos.left, "10px");
  else panelPos.right = positionValue(data.panelPos?.right, "10px");
  return {
    depth: bounded(data.depth, 18, 1, 30), time: bounded(data.time, 0, 0, 15000), lines: bounded(data.lines, 1, 1, 3),
    autoPlay: typeof data.autoPlay === "boolean" ? data.autoPlay : true,
    autoPlayDelay: bounded(data.autoPlayDelay, 0, 0, 10000), autoNewMatch: data.autoNewMatch === true,
    autoRematch: data.autoRematch === true, analyzeOpponent: data.analyzeOpponent !== false, mistakeProbability: bounded(data.mistakeProbability, 0, 0, 100),
    thinkingTime: bounded(data.thinkingTime, 100, 1, 100), panelPos,
  };
}

/** Accepts only finite pixel positions from persisted panel settings. */
function positionValue(value: unknown, fallback: string): string {
  return typeof value === "string" && /^-?\d+(\.\d+)?px$/.test(value) && Number.isFinite(parseFloat(value)) ? value : fallback;
}

/** Parses UCI principal variations and converts scores to White's perspective. */
export function parseInfo(line: string, fen: string): { index: number; variation: Variation } | null {
  const score = /\bscore (cp|mate) (-?\d+)/.exec(line), pv = /\bpv (.+)/.exec(line);
  if (!score || !pv || /\b(lowerbound|upperbound)\b/.test(line)) return null;
  const value = Number(score[2]) * (fen.split(" ")[1] === "b" ? -1 : 1);
  return { index: Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1) - 1, variation: {
    depth: Number(/\bdepth (\d+)/.exec(line)?.[1] ?? 0), score: score[1] === "cp" ? value / 100 : 0,
    mate: score[1] === "mate" ? value : null, moves: pv[1]!.trim().split(/\s+/), nodes: Number(/\bnodes (\d+)/.exec(line)?.[1] ?? 0),
  } };
}
