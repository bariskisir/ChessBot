/** Preserves ChessBot settings while migrating them into extension storage. */
import { normalizeSettings, type Settings } from "./shared";

/** Loads the saved settings, including automation preferences and panel position. */
export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get("botSettings");
  if (stored.botSettings) return normalizeSettings(stored.botSettings);
  let legacy: unknown = null;
  try { legacy = JSON.parse(localStorage.getItem("bot-settings") ?? "null"); } catch { /* Ignore corrupt legacy settings. */ }
  const settings = normalizeSettings(legacy);
  await saveSettings(settings);
  return settings;
}

/** Saves the full preference set without storing an engine selector. */
export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ botSettings: normalizeSettings(settings) });
}
