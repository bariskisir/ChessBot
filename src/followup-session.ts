/** Carries one Lichess follow-up across same-tab page navigation. */
import { lichessGameId } from "./providers/lichess-dom";
const key = "chessbot:lichess-followup";
const lifetime = 15 * 60 * 1000;

interface PendingFollowup { from: string; created: number }

/** Extracts the stable game ID from short and player-specific round URLs. */
function gameId(): string | null { return lichessGameId(location.pathname); }

/** Arms continuation immediately before an automated Lichess button navigates away. */
export function armFollowup(): void {
  const from = gameId();
  if (!from) return;
  try { sessionStorage.setItem(key, JSON.stringify({ from, created: Date.now() } satisfies PendingFollowup)); }
  catch { /* Browser storage may be unavailable on a restricted page. */ }
}

/** Clears an abandoned follow-up when the user stops or starts manually. */
export function clearFollowup(): void {
  try { sessionStorage.removeItem(key); }
  catch { /* Keep STOP usable when browser storage is unavailable. */ }
}

/** Consumes the marker only after a different valid Lichess round appears. */
export function takeFollowup(): boolean {
  const current = gameId();
  if (!current) return false;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return false;
    const pending = JSON.parse(raw) as Partial<PendingFollowup>;
    if (!pending || typeof pending.from !== "string" || !/^[a-zA-Z0-9]{8}$/.test(pending.from) || typeof pending.created !== "number" ||
      !Number.isFinite(pending.created) || Date.now() - pending.created > lifetime || pending.created > Date.now()) {
      clearFollowup();
      return false;
    }
    if (current === pending.from) return false;
    clearFollowup();
    return true;
  } catch { clearFollowup(); return false; }
}
