/**
 * Provides default settings and validation helpers for ChessBot configuration.
 */
import type { BotSettings, EngineType } from "./types";

export const DEFAULT_SETTINGS: BotSettings = {
  engineType: "local",
  depth: 18,
  thinkingTime: 100,
  autoPlay: true,
  autoPlayDelay: 0,
  autoNewMatch: false,
  autoRematch: false,
  panelPos: { top: "10px", right: "10px" },
  mistakeProbability: 0,
};

/**
 * Returns the maximum supported search depth for the selected engine.
 */
export function getMaxDepth(engineType: EngineType): number {
  return engineType === "local" ? 30 : 18;
}

/**
 * Restricts a numeric value to an inclusive range.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalizes user settings loaded from storage or UI events.
 */
export function normalizeSettings(settings: BotSettings): BotSettings {
  const maxDepth = getMaxDepth(settings.engineType);

  return {
    ...settings,
    depth: clamp(settings.depth, 1, maxDepth),
    thinkingTime: clamp(settings.thinkingTime, 1, 100),
    autoPlayDelay: clamp(settings.autoPlayDelay, 0, 10_000),
    mistakeProbability: clamp(settings.mistakeProbability, 0, 100),
  };
}
