/** Fetches the public OpenRouter decision-model catalogue without an API key. */
export interface OpenRouterModel { id: string; name: string }
export const OPENROUTER_CATALOG_URL = "https://openrouter.ai/api/frontend/v1/catalog/models";
export const OPENROUTER_CATALOG_CACHE_KEY = "botOpenRouterCatalog";
export const OPENROUTER_CATALOG_TTL_MS = 5 * 60 * 1000;

interface CatalogEntry {
  slug?: string; id?: string; name?: string; output_modalities?: string[];
}

/** Keeps one catalogue entry with a usable identifier, preferring its slug. */
export function toOpenRouterModel(entry: CatalogEntry): OpenRouterModel | null {
  const slug = typeof entry.slug === "string" ? entry.slug : "";
  const fallback = typeof entry.id === "string" ? entry.id : "";
  const id = slug || fallback;
  if (!id) return null;
  const name = typeof entry.name === "string" && entry.name ? entry.name : id;
  return { id, name };
}

/** Drops exact duplicate slugs so the dropdown lists each model once. */
export function dedupeOpenRouterModels(models: OpenRouterModel[]): OpenRouterModel[] {
  const seen = new Set<string>();
  return models.filter(
    /** Skips slugs that already produced a dropdown entry. */
    (model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
}

/** Keeps decision-capable entries sorted by display name for the dropdown. */
export function selectDecisionModels(payload: unknown): OpenRouterModel[] {
  const data = payload && typeof payload === "object" ? payload as { data?: unknown } : { data: [] };
  if (!Array.isArray(data.data)) return [];
  return dedupeOpenRouterModels(data.data
    .filter(
      /** Accepts only entries that can answer decision questions. */
      (entry): entry is CatalogEntry => !!entry && typeof entry === "object" &&
        Array.isArray((entry as CatalogEntry).output_modalities) &&
        (entry as CatalogEntry).output_modalities!.includes("decisions"))
    .map(
      /** Normalizes slugs and display names into dropdown entries. */
      (entry) => toOpenRouterModel(entry))
    .filter(
      /** Drops catalogue rows without a usable identifier. */
      (model): model is OpenRouterModel => model !== null)
    .sort(
      /** Orders the dropdown alphabetically by display name. */
      (left, right) => left.name.localeCompare(right.name)));
}

/** Reports whether a stored catalogue timestamp is still fresh enough to display. */
export function isCatalogFresh(fetchedAt: unknown, now: number): boolean {
  return typeof fetchedAt === "number" && Number.isFinite(fetchedAt) && now - fetchedAt <= OPENROUTER_CATALOG_TTL_MS;
}

/** Reads the stored catalogue when it is younger than the given age. */
export async function readCatalogCache(maxAgeMs: number = OPENROUTER_CATALOG_TTL_MS): Promise<{ models: OpenRouterModel[]; fetchedAt: number } | null> {
  try {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
    const stored = await chrome.storage.local.get(OPENROUTER_CATALOG_CACHE_KEY);
    const cached = stored[OPENROUTER_CATALOG_CACHE_KEY] as { fetchedAt?: unknown; models?: unknown } | undefined;
    if (!cached || !Array.isArray(cached.models) || typeof cached.fetchedAt !== "number") return null;
    if (Date.now() - cached.fetchedAt > maxAgeMs) return null;
    const models = dedupeOpenRouterModels(cached.models.filter(
      /** Restores only well-formed entries from extension storage. */
      (model): model is OpenRouterModel => !!model && typeof model === "object" &&
        typeof (model as OpenRouterModel).id === "string" && typeof (model as OpenRouterModel).name === "string"));
    return { models, fetchedAt: cached.fetchedAt };
  } catch { return null; }
}

/** Fetches the live decision-model list without authentication and refreshes the cache. */
export async function fetchOpenRouterCatalog(signal?: AbortSignal): Promise<OpenRouterModel[]> {
  const response = await fetch(OPENROUTER_CATALOG_URL, ...(signal ? [{ signal } as const] : []));
  if (!response.ok) throw new Error(`Model catalogue request failed (${response.status}).`);
  const models = selectDecisionModels(await response.json() as unknown);
  try {
    await chrome.storage.local.set({ [OPENROUTER_CATALOG_CACHE_KEY]: { fetchedAt: Date.now(), models } });
  } catch { /* Storage quota failures must not break the catalogue load. */ }
  return models;
}

/** Loads cached models instantly, falling back to stale entries when the network fails. */
export async function loadOpenRouterModels(options?: { forceRefresh?: boolean; signal?: AbortSignal }): Promise<{ models: OpenRouterModel[]; fromCache: boolean }> {
  if (!options?.forceRefresh) {
    const cached = await readCatalogCache();
    if (cached) return { models: cached.models, fromCache: true };
  }
  try {
    return { models: await fetchOpenRouterCatalog(options?.signal), fromCache: false };
  } catch (error) {
    const stale = await readCatalogCache(Number.POSITIVE_INFINITY);
    if (stale) return { models: stale.models, fromCache: true };
    throw error;
  }
}
