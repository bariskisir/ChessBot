/**
 * Handles persistent content-script settings stored in page localStorage.
 */
import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/settings";
import type { BotSettings } from "../shared/types";

const SETTINGS_KEY = "bot-settings";

/**
 * Loads saved bot settings and merges them with current defaults.
 */
export function loadSettings(): BotSettings {
  const rawSettings = localStorage.getItem(SETTINGS_KEY);

  if (!rawSettings) {
    return DEFAULT_SETTINGS;
  }

  try {
    return normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...JSON.parse(rawSettings),
    });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Persists bot settings for future page loads.
 */
export function saveSettings(settings: BotSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
}
