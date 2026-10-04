/** Verifies arena retry timing, tournament selection, navigation, and cancellation offline. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import type {} from "../tests/tournament-fixture";
import type { TimeClass } from "../src/providers/chesscom-tournaments";

interface ServiceCall { method: string; body: Record<string, unknown> }

/** Supplies only public tournament fields needed by the real selection policy. */
function tournament(id: string, minutes: number, category: TimeClass = "blitz", fields: object = {}) {
  return { id: `arena-${id}`, legacyId: id, title: id === "202" ? "3 + 2 Blitz" : category,
    timeClass: `TIME_CLASS_${category.toUpperCase()}`, type: "TOURNAMENT_TYPE_ARENA", variant: "VARIANT_CHESS",
    status: "TOURNAMENT_STATUS_IN_PROGRESS", joinable: true, startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + minutes * 60000).toISOString(), ...fields };
}

/** Serves every site request locally, including navigation and the HAR's service methods. */
async function openArena(context: BrowserContext, errors: string[], script: string, previous: TimeClass | null = "blitz", empty = false, restorePrevious = false) {
  const calls: ServiceCall[] = [], page = await context.newPage();
  page.on("pageerror",
    /** Includes fixture and extension failures in the shared browser-suite assertion. */
    (error) => errors.push(error.message));
  await page.route("https://www.chess.com/**",
    /** Never permits the fixture to access a signed-in game or actual tournament service. */
    async (route) => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path.startsWith("/service/")) {
        const method = path.split("/").at(-1)!;
        const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
        calls.push({ method, body });
        const response = method === "GetTournament" ? { tournament: tournament("100", -1, previous ?? "blitz", { status: "TOURNAMENT_STATUS_FINISHED" }) }
          : method === "ListTournaments" ? { tournaments: empty ? [] : [
            tournament("100", 90, previous ?? "blitz", previous ? {} : { status: "TOURNAMENT_STATUS_FINISHED" }), tournament("201", 5), tournament("202", 25),
            tournament("203", 45, "bullet"), tournament("204", 60, "rapid"),
            tournament("205", 120, "blitz", { status: "TOURNAMENT_STATUS_REGISTRATION", startsAt: new Date(Date.now() + 60000).toISOString() }),
            tournament("206", 100, "blitz", { variant: "VARIANT_BUGHOUSE" }),
          ] } : method === "GetMyTournaments" && restorePrevious ? { tournaments: [{ type: "TOURNAMENT_TYPE_ARENA", legacyId: "100" }] } : {};
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
      } else if (request.isNavigationRequest()) {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><script>${script}</script></body></html>` });
      } else await route.abort();
    });
  await page.goto("https://www.chess.com/game/100");
  await expect(page.getByRole("button", { name: "START", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Toggle Settings" }).click();
  await page.getByLabel("AUTO PLAY", { exact: true }).uncheck();
  await page.getByLabel("AUTO NEW MATCH/TOURNAMENT", { exact: true }).check();
  await page.getByLabel("AUTO REMATCH", { exact: true }).uncheck();
  if (!previous || restorePrevious) await page.evaluate(
    /** Removes the result link to exercise restored metadata and the unknown-category fallback. */
    () => window.arenaFixture.setup({ previousId: null }));
  return { page, calls };
}

/** Reads actual site button clicks independently from panel status text. */
async function attempts(page: Page): Promise<number[]> { return page.evaluate(
  /** Returns request times from the current fixture document. */
  () => window.arenaFixture.clicks); }

/** Runs arena-specific coverage through real content scripts and the real offscreen engine. */
export async function verifyTournaments(context: BrowserContext, errors: string[]): Promise<void> {
  const bundle = await build({ entryPoints: ["tests/tournament-fixture.ts"], bundle: true, write: false, format: "iife", target: "chrome120", loader: { ".css": "text" } });
  const script = bundle.outputFiles[0]!.text;
  const first = await openArena(context, errors, script);
  const autoMatch = await first.page.getByLabel("AUTO NEW MATCH/TOURNAMENT", { exact: true }).boundingBox();
  const rematch = await first.page.getByLabel("AUTO REMATCH", { exact: true }).boundingBox();
  assert.ok(autoMatch && rematch && autoMatch.y < rematch.y);
  await expect(first.page.getByLabel("AUTO NEW TOURNAMENT", { exact: true })).toHaveCount(0);
  await first.page.getByRole("button", { name: "START", exact: true }).click();
  await expect.poll(
    /** Waits for all three real attempts while the old page is still visible. */
    async () => (await attempts(first.page)).length, { timeout: 8000 }).toBe(3);
  const times = await attempts(first.page);
  assert.ok(times[1]! - times[0]! >= 2950 && times[2]! - times[1]! >= 2950);
  assert.equal(first.calls.length, 0);
  await first.page.waitForURL("**/play/arena/202", { timeout: 6000 });
  await expect(first.page.getByRole("status")).toHaveText("Waiting for next arena game...");
  assert.deepEqual(first.calls.map(
    /** Checks that selection leads to native registration followed by native matchmaking. */
    (call) => call.method), ["GetTournament", "ListTournaments", "RegisterToTournament", "NextGame"]);
  assert.equal(first.calls[0]?.body.tournamentId, "100");
  assert.equal(first.calls[2]?.body.tournamentId, "arena-202");
  await first.page.evaluate(
    /** Assigns another game via hard navigation to exercise automatic controller continuation. */
    () => window.arenaFixture.arrive());
  await first.page.waitForURL("**/game/200");
  await expect(first.page.getByRole("button", { name: "STOP", exact: true })).toBeVisible();
  await expect(first.page.getByRole("status")).toHaveText("Analyzing Board", { timeout: 25000 });
  await first.page.getByRole("button", { name: "STOP", exact: true }).click();
  await first.page.close();

  // An active queue remains valid even when pairing takes longer than all three retry slots.
  const searching = await openArena(context, errors, script);
  await searching.page.evaluate(
    /** Makes the first attempt start a disabled Finding Next Game indicator. */
    () => window.arenaFixture.setup({ searchStarts: true }));
  await searching.page.getByRole("button", { name: "START", exact: true }).click();
  await expect(searching.page.getByRole("status")).toHaveText("Waiting for next arena game...");
  await searching.page.waitForTimeout(9500);
  assert.equal((await attempts(searching.page)).length, 1);
  assert.deepEqual(searching.calls, []);
  assert.equal(await searching.page.evaluate(
    /** Confirms that successful matchmaking was never canceled by the extension. */
    () => window.arenaFixture.cancelClicks()), 0);
  await searching.page.getByRole("button", { name: "STOP", exact: true }).click();
  await searching.page.reload();
  await expect(searching.page.getByRole("button", { name: "START", exact: true })).toBeEnabled();
  await searching.page.close();

  // STOP before the second request cancels both retries and subsequent tournament lookup.
  const stopped = await openArena(context, errors, script);
  await stopped.page.getByRole("button", { name: "START", exact: true }).click();
  await expect.poll(
    /** Detects the first immediate request before STOP is issued. */
    async () => (await attempts(stopped.page)).length).toBe(1);
  await stopped.page.getByRole("button", { name: "STOP", exact: true }).click();
  await stopped.page.waitForTimeout(3500);
  assert.equal((await attempts(stopped.page)).length, 1);
  assert.deepEqual(stopped.calls, []);
  await stopped.page.close();

  // Auto New Match cancels active retries and persists the same opt-out for games and tournaments.
  const disabled = await openArena(context, errors, script);
  await disabled.page.getByRole("button", { name: "START", exact: true }).click();
  await expect.poll(
    /** Changes the single controlling setting during the first pending retry interval. */
    async () => (await attempts(disabled.page)).length).toBe(1);
  await disabled.page.getByLabel("AUTO NEW MATCH/TOURNAMENT", { exact: true }).uncheck();
  await disabled.page.waitForTimeout(3500);
  assert.equal((await attempts(disabled.page)).length, 1);
  assert.deepEqual(disabled.calls, []);
  await disabled.page.getByRole("button", { name: "STOP", exact: true }).click();
  await disabled.page.reload();
  await expect(disabled.page.getByRole("button", { name: "START", exact: true })).toBeEnabled();
  await disabled.page.getByRole("button", { name: "Toggle Settings" }).click();
  await expect(disabled.page.getByLabel("AUTO NEW MATCH/TOURNAMENT", { exact: true })).not.toBeChecked();
  await disabled.page.getByRole("button", { name: "START", exact: true }).click();
  await disabled.page.waitForTimeout(3500);
  assert.equal((await attempts(disabled.page)).length, 0);
  assert.deepEqual(disabled.calls, []);
  await disabled.page.getByRole("button", { name: "STOP", exact: true }).click();
  await disabled.page.close();

  // A lightweight restore record resolves bullet metadata before comparing longer arenas.
  const bullet = await openArena(context, errors, script, "bullet", false, true);
  await bullet.page.getByRole("button", { name: "START", exact: true }).click();
  await bullet.page.waitForURL("**/play/arena/203", { timeout: 15000 });
  await expect(bullet.page.getByRole("status")).toHaveText("Waiting for next arena game...");
  assert.equal(bullet.calls[0]?.method, "GetMyTournaments");
  assert.equal(bullet.calls[1]?.method, "GetTournament");
  await bullet.page.getByRole("button", { name: "Toggle Settings" }).click();
  await bullet.page.getByLabel("AUTO NEW MATCH/TOURNAMENT", { exact: true }).uncheck();
  assert.equal(await bullet.page.evaluate(
    /** Ensures STOP leaves the site's queue cancellation control untouched. */
    () => window.arenaFixture.cancelClicks()), 0);
  await bullet.page.evaluate(
    /** Assigns a queued game after the setting was disabled to catch stale navigation markers. */
    () => window.arenaFixture.arrive());
  await bullet.page.waitForURL("**/game/200");
  await expect(bullet.page.getByRole("button", { name: "START", exact: true })).toBeEnabled();
  await bullet.page.waitForTimeout(500);
  await expect(bullet.page.getByRole("button", { name: "START", exact: true })).toBeEnabled();
  await bullet.page.close();

  // Missing metadata uses blitz, and an empty list waits for an actually started arena.
  const unknown = await openArena(context, errors, script, null);
  await unknown.page.getByRole("button", { name: "START", exact: true }).click();
  await unknown.page.waitForURL("**/play/arena/202", { timeout: 15000 });
  await expect(unknown.page.getByRole("status")).toHaveText("Waiting for next arena game...");
  assert.equal(unknown.calls[0]?.method, "GetMyTournaments");
  await unknown.page.getByRole("button", { name: "STOP", exact: true }).click();
  await unknown.page.close();
  const empty = await openArena(context, errors, script, null, true);
  await empty.page.getByRole("button", { name: "START", exact: true }).click();
  await expect(empty.page.getByRole("status")).toHaveText("Waiting for a started blitz tournament...", { timeout: 15000 });
  await empty.page.getByRole("button", { name: "STOP", exact: true }).click();
  await empty.page.waitForTimeout(500);
  assert.equal(empty.calls.length, 2);
  await empty.page.close();
}
