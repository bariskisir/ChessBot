/** Retries arena matchmaking and continues into the longest running arena of the same class. */
import { Chess } from "chess.js";
import { delay } from "../engine-client";
import { armArenaFollowup, clearArenaFollowup, isGamePath, readArenaContext, saveArenaContext, type ArenaFollowup } from "../tournament-session";
import { arenaResultShown, arenaSearching, findArenaLobbyButton, findArenaNextButton } from "./chesscom-arena-dom";
import { readPosition } from "./chesscom-board";
import { currentTournament, listTournaments, selectTournament, type Tournament } from "./chesscom-tournaments";

export interface ArenaCallbacks { status: (message: string) => void; handled: (button: HTMLElement) => void }

/** Requires a playable position and a game transition rather than a lobby preview. */
function gameArrived(from: string, before: string | null): boolean {
  if (arenaSearching() || arenaResultShown()) return false;
  const fen = readPosition();
  if (!fen || (!isGamePath(location.pathname) && !before) || (location.pathname === from && fen === before)) return false;
  try { return !new Chess(fen).isGameOver(); }
  catch { return false; }
}

/** Keeps active matchmaking pending until the next board arrives or STOP cancels it. */
async function waitForGame(from: string, before: string | null, tournament: Tournament | null, signal: AbortSignal, callbacks: ArenaCallbacks): Promise<void> {
  callbacks.status("Waiting for next arena game...");
  while (!gameArrived(from, before)) await delay(300, signal);
  signal.throwIfAborted();
  saveArenaContext(tournament);
  clearArenaFollowup();
  callbacks.status("New arena game started");
}

/** Lets the site join and subscribe to the arena before requesting another game. */
export async function continueArena(pending: ArenaFollowup, signal: AbortSignal, callbacks: ArenaCallbacks): Promise<void> {
  if (isGamePath(location.pathname) && location.pathname !== pending.from) {
    await waitForGame(pending.from, null, pending.tournament, signal, callbacks);
    return;
  }
  if (pending.stage === "waiting") {
    await waitForGame(pending.from, readPosition(), pending.tournament, signal, callbacks);
    return;
  }
  const tournament = pending.tournament;
  if (!tournament) return;
  const from = location.pathname, before = readPosition(), deadline = Date.now() + 20000;
  callbacks.status(`Joining ${tournament.title}...`);
  let joined = false, nextAt = 0, attempts = 0;
  while (!arenaSearching()) {
    signal.throwIfAborted();
    if (gameArrived(from, before)) { saveArenaContext(tournament); clearArenaFollowup(); return; }
    if (Date.now() >= deadline || tournament.endsAt <= Date.now()) throw new Error("Arena did not start matchmaking - press START to retry");
    const join = findArenaLobbyButton("Join"), next = findArenaLobbyButton("Next Game");
    if (join && !joined) {
      joined = true;
      join.click();
      nextAt = Date.now() + 3000;
    } else if (next && Date.now() >= nextAt && attempts < 3) {
      next.click();
      attempts++;
      nextAt = Date.now() + 3000;
    }
    await delay(200, signal);
  }
  armArenaFollowup("waiting", tournament);
  await waitForGame(from, before, tournament, signal, callbacks);
}

/** Refreshes the catalogue while no matching started arena is available. */
async function joinNextTournament(previous: Tournament | null, signal: AbortSignal, callbacks: ArenaCallbacks): Promise<void> {
  const category = previous?.timeClass ?? "blitz", excluded = previous ? [previous.id, previous.legacyId] : [];
  for (;;) {
    callbacks.status(`Looking for a started ${category} tournament...`);
    const tournament = selectTournament(await listTournaments(signal), category, excluded);
    signal.throwIfAborted();
    if (!tournament) {
      callbacks.status(`Waiting for a started ${category} tournament...`);
      await delay(30000, signal);
      continue;
    }
    callbacks.status(`Opening ${tournament.title}...`);
    armArenaFollowup("join", tournament);
    location.assign(`/play/arena/${tournament.legacyId}`);
    // A document navigation replaces this controller; SPA routing can keep it alive.
    const deadline = Date.now() + 15000;
    while (location.pathname !== `/play/arena/${tournament.legacyId}`) {
      if (Date.now() >= deadline) { clearArenaFollowup(); throw new Error("Arena could not open - press START to retry"); }
      await delay(200, signal);
    }
    await continueArena({ from: location.pathname, created: Date.now(), stage: "join", tournament }, signal, callbacks);
    return;
  }
}

/** Auto New Match switches tournaments after three unsuccessful requests spaced three seconds apart. */
export async function followArena(signal: AbortSignal, callbacks: ArenaCallbacks): Promise<void> {
  const from = location.pathname, before = readPosition();
  let previous = readArenaContext();
  for (let attempt = 1; attempt <= 3; attempt++) {
    signal.throwIfAborted();
    if (!arenaSearching()) {
      const button = findArenaNextButton();
      if (button) {
        callbacks.status(`Next Arena Game - attempt ${attempt}/3...`);
        callbacks.handled(button);
        armArenaFollowup("waiting", previous);
        button.click();
      }
    }
    const deadline = Date.now() + 3000;
    do {
      if (arenaSearching() || gameArrived(from, before)) {
        armArenaFollowup("waiting", previous);
        await waitForGame(from, before, previous, signal, callbacks);
        return;
      }
      await delay(Math.min(200, Math.max(1, deadline - Date.now())), signal);
    } while (Date.now() < deadline);
  }
  if (arenaSearching() || gameArrived(from, before)) {
    armArenaFollowup("waiting", previous);
    await waitForGame(from, before, previous, signal, callbacks);
    return;
  }
  clearArenaFollowup();
  previous = await currentTournament(signal) ?? previous;
  await joinNextTournament(previous, signal, callbacks);
}
