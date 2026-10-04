/** Checks arena eligibility, remaining-time ordering, and navigation marker isolation. */
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { selectTournament, type TimeClass } from "../src/providers/chesscom-tournaments";
import type * as Session from "../src/tournament-session";
import type * as Tournaments from "../src/providers/chesscom-tournaments";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/shared";
const now = Date.parse("2026-10-04T17:25:00Z");

/** Mirrors the public HAR fields without including user or authentication data. */
function arena(id: string, minutes: number, category: TimeClass = "blitz", fields: object = {}) {
  return { id: `arena-${id}`, legacyId: id, title: category, timeClass: `TIME_CLASS_${category.toUpperCase()}`,
    startsAt: new Date(now - 60000).toISOString(), endsAt: new Date(now + minutes * 60000).toISOString(),
    type: "TOURNAMENT_TYPE_ARENA", variant: "VARIANT_CHESS", status: "TOURNAMENT_STATUS_IN_PROGRESS", joinable: true, ...fields };
}

/** Prefers remaining tournament duration over the games' exact clock or increment. */
function longestArena(): void {
  const short = arena("1", 5, "blitz", { title: "3 + 0 Blitz", timeControl: { baseMs: "180000" } });
  const long = arena("2", 25, "blitz", { title: "3 + 2 Blitz", timeControl: { baseMs: "180000", incrementMs: "2000" } });
  const tournaments = [short, long, arena("3", 60, "rapid"), arena("4", 40, "bullet")];
  assert.equal(selectTournament({ tournaments }, undefined, [], now)?.legacyId, "2");
  assert.equal(selectTournament({ tournaments }, "bullet", [], now)?.legacyId, "4");
  assert.equal(selectTournament({ tournaments }, "rapid", [], now)?.legacyId, "3");
  assert.equal(selectTournament({ tournaments }, "blitz", ["arena-2"], now)?.legacyId, "1");
  assert.equal(selectTournament({ tournaments }, "blitz", ["2", "1"], now), null);
}
test("same-class arenas choose the longest remaining duration and default to blitz", longestArena);

/** Excludes entries that the extension cannot join or play as standard chess. */
function eligibleArena(): void {
  for (const fields of [
    { startsAt: new Date(now + 1000).toISOString() }, { endsAt: new Date(now).toISOString() }, { endsAt: "invalid" },
    { status: "TOURNAMENT_STATUS_REGISTRATION" }, { status: "TOURNAMENT_STATUS_FINISHED" }, { joinable: false },
    { type: "TOURNAMENT_TYPE_SWISS" }, { variant: "VARIANT_BUGHOUSE" }, { private: true }, { titled: true },
    { verified: true }, { proctor: true }, { rules: true }, { realName: true }, { legacyId: "../other" }, { id: "https://example.com" },
  ]) assert.equal(selectTournament({ tournaments: [arena("1", 5), arena("2", 60, "blitz", fields)] }, "blitz", [], now)?.legacyId, "1");
  for (const response of [null, {}, { tournaments: {} }, { tournaments: [null, "arena"] }]) assert.equal(selectTournament(response, "blitz", [], now), null);
}
test("only started, joinable, public standard arenas qualify", eligibleArena);

/** Runs storage logic in independent tab-like contexts with an expiring controlled clock. */
function sessionMarkers(): void {
  const bundle = buildSync({ entryPoints: ["src/tournament-session.ts"], bundle: true, write: false, format: "iife", globalName: "ArenaSession" }).outputFiles[0]!.text;
  const storage = new Map<string, string>(), location = new URL("https://www.chess.com/game/100");
  let current = now;
  /** Lets marker expiration advance without wall-clock delays. */
  class Clock extends Date { static now(): number { return current; } }
  const context = { location, Date: Clock, sessionStorage: {
    /** Reads only this tab's markers. */
    getItem: (key: string) => storage.get(key) ?? null,
    /** Emulates browser navigation retaining session storage. */
    setItem: (key: string, value: string) => storage.set(key, value),
    /** Makes cancellation immediately observable. */
    removeItem: (key: string) => storage.delete(key),
  } };
  runInNewContext(bundle, context);
  const session = (context as typeof context & { ArenaSession: typeof Session }).ArenaSession;
  const chosen = selectTournament({ tournaments: [arena("2", 25)] }, "blitz", [], now)!;
  session.armArenaFollowup("join", chosen);
  const pending = session.readArenaFollowup()!;
  assert.equal(session.canResumeArena(pending), false);
  location.pathname = "/play/arena/3";
  assert.equal(session.canResumeArena(pending), false);
  location.pathname = "/play/arena/2";
  assert.equal(session.canResumeArena(pending), true);
  location.pathname = "/game/200";
  assert.equal(session.canResumeArena(pending), true);
  session.saveArenaContext(chosen);
  assert.equal(session.readArenaContext()?.timeClass, "blitz");
  location.pathname = "/game/300";
  assert.equal(session.readArenaContext(), null);
  session.clearArenaFollowup();
  assert.equal(session.readArenaFollowup(), null);
  session.armArenaFollowup("waiting", null);
  current += 15 * 60000 + 1;
  assert.equal(session.readArenaFollowup(), null);
  storage.set("chessbot:arena-followup", '{"from":"/game/100","created":0,"stage":"join","tournament":null}');
  assert.equal(session.readArenaFollowup(), null);
  storage.set("chessbot:arena-followup", "null");
  assert.equal(session.readArenaFollowup(), null);
}
test("arena continuation survives navigation, expires, and isolates unrelated games", sessionMarkers);

/** Preserves Auto New Match preferences while dropping the separate tournament flag from saved settings. */
function tournamentSettings(): void {
  assert.equal(DEFAULT_SETTINGS.autoNewMatch, true);
  assert.equal(normalizeSettings({ autoNewMatch: false, autoNewTournament: true }).autoNewMatch, false);
  assert.equal(normalizeSettings({ autoNewMatch: true, autoNewTournament: false }).autoNewMatch, true);
  assert.deepEqual(normalizeSettings({ autoNewTournament: false }), DEFAULT_SETTINGS);
  assert.equal("autoNewTournament" in normalizeSettings({ autoNewTournament: true }), false);
}
test("Auto New Match controls tournament continuation and ignores the removed setting", tournamentSettings);

/** Resolves the site's lightweight restore records before inferring the previous arena class. */
async function previousArenaDetails(): Promise<void> {
  const bundle = buildSync({ entryPoints: ["src/providers/chesscom-tournaments.ts"], bundle: true, write: false, format: "iife", globalName: "Tournaments" }).outputFiles[0]!.text;
  const calls: Array<{ method: string; body: object }> = [];
  let restored: unknown[] = [{ type: "TOURNAMENT_TYPE_ARENA", legacyId: "1" }];
  const context = { URL, AbortSignal, location: new URL("https://www.chess.com/game/100"), document: {
    /** Leaves arena result links absent as on an ordinary game route. */
    querySelectorAll: () => [],
  },
    /** Emulates the public restore and detail endpoints while verifying session-bound request options. */
    fetch: async (address: string, options: RequestInit) => {
      assert.equal(options.credentials, "include");
      assert.equal(options.method, "POST");
      const method = address.split("/").at(-1)!;
      calls.push({ method, body: JSON.parse(String(options.body)) as object });
      return new Response(JSON.stringify(method === "GetMyTournaments" ? { tournaments: restored } : { tournament: arena("1", 5, "bullet") }));
    },
  };
  runInNewContext(bundle, context);
  const api = (context as typeof context & { Tournaments: typeof Tournaments }).Tournaments;
  assert.equal((await api.currentTournament(new AbortController().signal))?.timeClass, "bullet");
  assert.deepEqual(calls, [{ method: "GetMyTournaments", body: {} }, { method: "GetTournament", body: { tournamentId: "1" } }]);
  calls.length = 0;
  restored = [...restored, { type: "TOURNAMENT_TYPE_ARENA", legacyId: "2" }];
  assert.equal(await api.currentTournament(new AbortController().signal), null);
  assert.equal(calls.length, 1);
  restored = [{ type: "TOURNAMENT_TYPE_ARENA", legacyId: "../bad" }];
  assert.equal(await api.currentTournament(new AbortController().signal), null);
}
test("single joined-arena restore IDs resolve details; ambiguous or invalid IDs use fallback", previousArenaDetails);
