/** Reads Chess.com's arena catalogue without carrying recorded session credentials. */
export type TimeClass = "bullet" | "blitz" | "rapid" | "daily";
export interface Tournament {
  id: string; legacyId: string; title: string; timeClass: TimeClass; endsAt: number;
}

/** Rejects non-record protocol values before inspecting tournament fields. */
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Accepts only supported site time classes, retaining increment-independent matching. */
export function timeClass(value: unknown): TimeClass | null {
  const normalized = typeof value === "string" ? value.replace(/^TIME_CLASS_/, "").toLowerCase() : "";
  return normalized === "bullet" || normalized === "blitz" || normalized === "rapid" || normalized === "daily" ? normalized : null;
}

/** Validates the small public reference also stored across same-tab navigation. */
export function tournamentReference(value: unknown): Tournament | null {
  const data = record(value), category = timeClass(data.timeClass);
  const endsAt = typeof data.endsAt === "number" ? data.endsAt : typeof data.endsAt === "string" ? Date.parse(data.endsAt) : NaN;
  if (typeof data.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(data.id) ||
    typeof data.legacyId !== "string" || !/^\d{1,20}$/.test(data.legacyId) || !category || !Number.isFinite(endsAt)) return null;
  return { id: data.id, legacyId: data.legacyId, title: typeof data.title === "string" ? data.title.slice(0,160) : category, timeClass: category, endsAt };
}

/** Excludes scheduled, inaccessible, nonstandard, ended, and already exhausted arenas. */
export function selectTournament(response: unknown, category: TimeClass = "blitz", excluded: readonly string[] = [], now = Date.now()): Tournament | null {
  const entries = record(response).tournaments;
  if (!Array.isArray(entries)) return null;
  let best: Tournament | null = null;
  for (const entry of entries) {
    const data = record(entry), tournament = tournamentReference(data);
    const startsAt = typeof data.startsAt === "string" ? Date.parse(data.startsAt) : NaN;
    if (!tournament || tournament.timeClass !== category || excluded.includes(tournament.id) || excluded.includes(tournament.legacyId) ||
      data.type !== "TOURNAMENT_TYPE_ARENA" || data.variant !== "VARIANT_CHESS" || data.status !== "TOURNAMENT_STATUS_IN_PROGRESS" ||
      data.joinable !== true || data.private === true || data.titled === true || data.verified === true || data.proctor === true ||
      data.rules === true || data.realName === true || !Number.isFinite(startsAt) || startsAt > now || tournament.endsAt <= now) continue;
    if (!best || tournament.endsAt > best.endsAt) best = tournament;
  }
  return best;
}

/** Uses the current browser session for fixed, read-only tournament service calls. */
async function request(method: "ListTournaments" | "GetTournament" | "GetMyTournaments", body: object, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const service = method === "ListTournaments" ? "tournaments-list/chesscom.tournament_list.v1.TournamentListService" : "tournaments/chesscom.tournaments.v1.TournamentService";
  const response = await fetch(`/service/${service}/${method}`, {
    method: "POST", credentials: "include", headers: { "content-type": "application/json", "connect-protocol-version": "1" },
    body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  if (!response.ok) throw new Error(`Tournament lookup failed (${response.status})`);
  return response.json();
}

/** Lists public standard arenas using the service observed in the tournament capture. */
export function listTournaments(signal: AbortSignal): Promise<unknown> {
  return request("ListTournaments", { include: ["TOURNAMENT_INCLUDE_TYPE_UNSPECIFIED", "TOURNAMENT_INCLUDE_TYPE_RCN_ARENA"] }, signal);
}

/** Resolves the previous arena's category from its route, result link, or unique restored ID. */
export async function currentTournament(signal: AbortSignal): Promise<Tournament | null> {
  let id = /^\/play\/arena\/(\d+)(?:\/|$)/.exec(location.pathname)?.[1];
  if (!id) {
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>('.game-over-arena-button-component a[href], .game-over-modal-component a[href], .board-modal-component a[href]')) {
      const url = new URL(anchor.href, location.href);
      if (url.origin === location.origin) id = /^\/play\/arena\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1];
      if (id) break;
    }
  }
  try {
    if (id) return tournamentReference(record(await request("GetTournament", { tournamentId: id }, signal)).tournament);
    const entries = record(await request("GetMyTournaments", {}, signal)).tournaments;
    if (!Array.isArray(entries)) return null;
    const arenas: Record<string, unknown>[] = [];
    for (const entry of entries) {
      const data = record(entry);
      if (data.type === "TOURNAMENT_TYPE_ARENA" && typeof data.legacyId === "string" && /^\d{1,20}$/.test(data.legacyId)) arenas.push(data);
    }
    const arena = arenas.length === 1 ? arenas[0] : null;
    if (!arena) return null;
    // Restoration records can contain only the type and legacy ID; details carry the time class.
    const details = tournamentReference(arena) ? arena : record(record(await request("GetTournament", { tournamentId: arena.legacyId }, signal)).tournament);
    if (details.variant !== "VARIANT_CHESS" || (details.status !== "TOURNAMENT_STATUS_IN_PROGRESS" && details.status !== "TOURNAMENT_STATUS_FINISHED")) return null;
    return tournamentReference(details);
  } catch { signal.throwIfAborted(); return null; }
}
