/** Defines credential-safe Jev traffic records shared by the transport and viewer. */
export interface JevLog {
  id: string; startedAt: string; durationMs: number | null;
  status: "pending" | "success" | "error" | "canceled";
  request: { url: string; method: string; headers: Record<string, string>; body: unknown };
  response: { status: number; headers: Record<string, string>; body: unknown } | null;
  error: string | null;
}
export interface JevHistory { revision: number; entries: JevLog[] }
export interface JevLogMessage { target: "jev-logs"; history: JevHistory }
export interface JevHistoryRequest { target: "jev-log-store"; action: "get" | "clear" }

/** Adds only reported dollar costs, including charged failures, without estimating missing usage. */
export function totalJevCost(entries: JevLog[]): number {
  let total = 0;
  for (const entry of entries) {
    const body = entry.response?.body as { usage?: { cost?: unknown } } | null | undefined;
    const cost = body?.usage?.cost;
    if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) total += cost;
  }
  return total;
}

/** Removes credentials even when a provider echoes them inside a response or error. */
export function redactLog(entry: JevLog, apiKey: string): JevLog {
  const encoded = JSON.stringify(apiKey.trim()).slice(1, -1);
  let json = JSON.stringify(entry);
  if (encoded) json = json.split(encoded).join("[REDACTED]");
  return JSON.parse(json.replace(/Bearer [^"\\\s]+/gi, "Bearer [REDACTED]")) as JevLog;
}

/** Pretty-prints probability maps in descending order without modifying captured traffic. */
export function formatLogBody(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body,
    /** Reorders only numeric probability maps, preserving the rest of the raw structure. */
    (key, value: unknown) => {
      if (key !== "probabilities" || !value || typeof value !== "object" || Array.isArray(value)) return value;
      const entries = Object.entries(value);
      if (!entries.every(
        /** Leaves unexpected provider formats intact for inspection. */
        ([, probability]) => typeof probability === "number" && Number.isFinite(probability))) return value;
      return Object.fromEntries(entries.sort(
        /** Places the most probable legal moves first in the displayed JSON. */
        ([, left], [, right]) => Number(right) - Number(left)));
    }, 2) ?? "";
}
