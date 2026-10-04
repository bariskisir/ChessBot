/** Carries arena continuation and its time class through same-tab navigation. */
import { tournamentReference, type Tournament } from "./providers/chesscom-tournaments";
const pendingKey = "chessbot:arena-followup", contextKey = "chessbot:arena-context";
const lifetime = 15 * 60 * 1000;
export interface ArenaFollowup { from: string; created: number; stage: "join" | "waiting"; tournament: Tournament | null }

/** Identifies actual game routes rather than lobby preview boards. */
export function isGamePath(path: string): boolean { return /^\/game\/(?:live\/)?\d+(?:\/|$)/.test(path); }

/** Writes only public tournament metadata while tolerating unavailable session storage. */
function write(key: string, value: object): void {
  try { sessionStorage.setItem(key, JSON.stringify(value)); }
  catch { /* Cancellation and local play remain usable without session storage. */ }
}

/** Arms a single continuation immediately before a site action can navigate away. */
export function armArenaFollowup(stage: ArenaFollowup["stage"], tournament: Tournament | null): void {
  write(pendingKey, { from: location.pathname, created: Date.now(), stage, tournament } satisfies ArenaFollowup);
}

/** Clears pending navigation without discarding the current game's tournament category. */
export function clearArenaFollowup(): void {
  try { sessionStorage.removeItem(pendingKey); }
  catch { /* STOP must not depend on browser storage access. */ }
}

/** Validates expiring markers before allowing automatic continuation on another document. */
export function readArenaFollowup(): ArenaFollowup | null {
  try {
    const raw = sessionStorage.getItem(pendingKey);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<ArenaFollowup>, tournament = tournamentReference(data?.tournament);
    if (!data || typeof data.from !== "string" || !data.from.startsWith("/") || typeof data.created !== "number" ||
      !Number.isFinite(data.created) || data.created > Date.now() || Date.now() - data.created > lifetime ||
      (data.stage !== "join" && data.stage !== "waiting") || (data.tournament !== null && !tournament) || (data.stage === "join" && !tournament)) {
      clearArenaFollowup(); return null;
    }
    return { from: data.from, created: data.created, stage: data.stage, tournament };
  } catch { clearArenaFollowup(); return null; }
}

/** Resumes only the chosen arena lobby or the next assigned game. */
export function canResumeArena(pending: ArenaFollowup): boolean {
  if (isGamePath(location.pathname) && location.pathname !== pending.from) return true;
  return !!pending.tournament && location.pathname === `/play/arena/${pending.tournament.legacyId}`;
}

/** Associates a category with this game so unrelated manually opened games cannot inherit it. */
export function saveArenaContext(tournament: Tournament | null): void {
  if (tournament) write(contextKey, { path: location.pathname, created: Date.now(), tournament });
}

/** Reads previous metadata only for the exact game where it was observed. */
export function readArenaContext(): Tournament | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(contextKey) ?? "null") as { path?: unknown; created?: unknown; tournament?: unknown } | null;
    return data?.path === location.pathname && typeof data.created === "number" && data.created <= Date.now() && Date.now() - data.created < 24 * 60 * 60 * 1000 ? tournamentReference(data.tournament) : null;
  } catch { return null; }
}
