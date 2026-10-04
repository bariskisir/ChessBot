/** Exercises offline Lichess rounds, follow-up navigation, and training with the real extension. */
import { build } from "esbuild";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import type {} from "../tests/lichess-fixture";
import type {} from "../tests/lichess-puzzle-fixture";

/** Builds one controlled page script without writing browser artifacts. */
async function fixtureScript(entry: string): Promise<string> {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: "iife", target: "chrome120", loader: { ".css": "text" } });
  const output = result.outputFiles[0];
  if (!output) throw new Error("Missing Lichess fixture bundle.");
  return output.text;
}

/** Serves both round navigation and training locally, keeping live Lichess games untouched. */
async function openFixture(context: BrowserContext, errors: string[], script: string, address: string): Promise<Page> {
  const page = await context.newPage();
  page.on("pageerror",
    /** Captures extension and fixture failures for the shared suite assertion. */
    (error) => errors.push(error.message));
  await page.route("https://lichess.org/**",
    /** Emulates the intermediate lobby before returning to the supplied round fixture. */
    (route) => route.fulfill({ contentType: "text/html", body: new URL(route.request().url()).pathname === "/"
      ? '<!doctype html><html><body><script>setTimeout(() => location.href = "/NeWg1234/white", 400)</script></body></html>'
      : `<!doctype html><html><body><script>${script}</script></body></html>` }));
  await page.goto(address);
  await expect(page.getByRole("button", { name: "START", exact: true })).toBeEnabled();
  return page;
}

/** Runs the Lichess checks independently of the Chess.com fixture and assertions. */
export async function verifyLichess(context: BrowserContext, errors: string[]): Promise<void> {
  const [lichessScript, puzzleScript] = await Promise.all([
    fixtureScript("tests/lichess-fixture.ts"), fixtureScript("tests/lichess-puzzle-fixture.ts"),
  ]);
  const lichessPage = await openFixture(context, errors, lichessScript, "https://lichess.org/uEYiEOQf/black");
  await expect(lichessPage.locator(".bot-panel-header h3")).toContainText("CHESS BOT");
  await lichessPage.getByRole("button", { name: "Toggle Settings" }).click();
  await lichessPage.getByLabel("AUTO PLAY", { exact: true }).uncheck();
  await lichessPage.getByRole("button", { name: "START", exact: true }).click();
  await expect(lichessPage.getByRole("status")).toHaveText("Analyzing Board", { timeout: 25000 });
  await expect(lichessPage.locator("cg-board > square.bot-highlight")).toHaveCount(2);
  await lichessPage.getByRole("button", { name: "STOP", exact: true }).click();
  const clockHarness = await build({ entryPoints: ["src/board.ts"], bundle: true, write: false, format: "iife", globalName: "ChessbotBoardTest", target: "chrome120" });
  await lichessPage.addScriptTag({ content: clockHarness.outputFiles[0]!.text });
  const clock = await lichessPage.evaluate(
    /** Reads the owned Black clock after manually flipping its board to White. */
    () => {
      window.lichessFixture.setMoves(["e4"], "w");
      window.lichessFixture.setClock(180000, 2000, 180000, 150000);
      return window.ChessbotBoardTest.readClock();
    });
  expect(clock?.incrementMs).toBe(2000);
  expect(clock?.initialMs).toBe(180000);
  expect(clock?.remainingMs).toBeGreaterThan(149000);
  expect(clock?.remainingMs).toBeLessThanOrEqual(150000);
  expect(clock?.running).toBe(true);
  const bootstrap = await lichessPage.evaluate(
    /** Verifies numeric round metadata when the visible control is absent. */
    () => {
      document.querySelector(".game__meta .setup")!.remove();
      const script = document.createElement("script");
      script.type = "application/json";
      script.textContent = JSON.stringify({ game: { id: "uEYiEOQf" }, clock: { initial: 300, increment: 3 } });
      document.body.append(script);
      const known = window.ChessbotBoardTest.readClock();
      script.remove();
      return { known, unknown: window.ChessbotBoardTest.readClock() };
    });
  expect(bootstrap.known?.initialMs).toBe(300000);
  expect(bootstrap.known?.incrementMs).toBe(3000);
  expect(bootstrap.unknown?.incrementMs).toBe(0);
  await lichessPage.evaluate(
    /** Removes the timed fixture after verifying ownership and restores its drawing direction. */
    () => { window.lichessFixture.setClock(null); window.lichessFixture.setMoves(["e4"], "b"); });
  await lichessPage.evaluate(
    /** Reproduces the user's zero-move Lichess page, which has no app element. */
    () => { history.replaceState(null, "", "/I6QeHeX0"); window.lichessFixture.setMoves([], "w", false); });
  await expect(lichessPage.locator("i5d app")).toHaveCount(0);
  await lichessPage.getByRole("button", { name: "START", exact: true }).click();
  await expect(lichessPage.getByRole("status")).toHaveText("Analyzing Board", { timeout: 25000 });
  await expect(lichessPage.locator("cg-board > square.bot-highlight")).toHaveCount(2);
  await lichessPage.getByRole("button", { name: "STOP", exact: true }).click();
  await lichessPage.getByLabel("AUTO PLAY", { exact: true }).check();
  await lichessPage.getByRole("button", { name: "START", exact: true }).click();
  await expect.poll(
    /** Confirms legal position tracking continues when SAN history remains hidden. */
    () => lichessPage.evaluate(
      /** Reads the fixture's trusted move count. */
      () => window.lichessFixture.counts.moves), { timeout: 25000 }).toBe(1);
  await expect(lichessPage.getByRole("status")).toHaveText("Opponent's turn", { timeout: 25000 });
  await lichessPage.getByRole("button", { name: "STOP", exact: true }).click();
  await lichessPage.getByLabel("AUTO PLAY", { exact: true }).uncheck();
  await lichessPage.evaluate(
    /** Verifies a white-oriented board after both sides have moved. */
    () => { history.replaceState(null, "", "/uEYiEOQf/white"); window.lichessFixture.setMoves(["e4", "e5"], "w"); });
  await lichessPage.getByRole("button", { name: "START", exact: true }).click();
  await expect(lichessPage.getByRole("status")).toHaveText("Analyzing Board", { timeout: 25000 });
  await lichessPage.locator("i5d app z7yx").last().evaluate(
    /** Simulates board pieces arriving before the corresponding SAN node. */
    (node) => node.remove());
  await expect(lichessPage.getByRole("status")).toHaveText("Waiting for board position...");
  await lichessPage.getByRole("button", { name: "STOP", exact: true }).click();
  await lichessPage.evaluate(
    /** Flips the view without changing the player's black URL side. */
    () => { history.replaceState(null, "", "/uEYiEOQf/black"); window.lichessFixture.setMoves([], "w"); });
  await lichessPage.getByRole("button", { name: "START", exact: true }).click();
  await expect(lichessPage.getByRole("status")).toHaveText("Opponent's turn", { timeout: 25000 });
  await lichessPage.getByRole("button", { name: "STOP", exact: true }).click();
  await lichessPage.evaluate(
    /** Restores a black-oriented position for the trusted input check. */
    () => { history.replaceState(null, "", "/uEYiEOQfgP1v/black"); window.lichessFixture.setMoves(["e4"], "b"); window.lichessFixture.counts.moves = 0; });
  await lichessPage.getByLabel("AUTO PLAY", { exact: true }).check();
  await lichessPage.getByRole("button", { name: "START", exact: true }).click();
  await expect.poll(
    /** Waits for a trusted Chessground-style drag to change the board. */
    () => lichessPage.evaluate(
      /** Reads the number of legal drags accepted by the fixture. */
      () => window.lichessFixture.counts.moves), { timeout: 25000 }).toBe(1);
  await lichessPage.getByRole("button", { name: "STOP", exact: true }).click();
  await lichessPage.getByLabel("AUTO PLAY", { exact: true }).uncheck();
  await lichessPage.getByLabel("AUTO NEW MATCH", { exact: true }).check();
  await lichessPage.getByLabel("AUTO REMATCH", { exact: true }).check();
  await lichessPage.evaluate(
    /** Makes both Lichess follow-up controls available after the game. */
    () => window.lichessFixture.gameOver());
  await lichessPage.getByRole("button", { name: "START", exact: true }).click();
  await expect(lichessPage).toHaveURL("https://lichess.org/NeWg1234/white", { timeout: 12000 });
  await expect(lichessPage.getByRole("button", { name: "STOP", exact: true })).toBeVisible({ timeout: 10000 });
  await expect(lichessPage.getByRole("status")).toHaveText("Analyzing Board", { timeout: 25000 });
  await lichessPage.getByRole("button", { name: "STOP", exact: true }).click();
  await lichessPage.getByRole("button", { name: "Toggle Settings" }).click();
  await lichessPage.getByLabel("AUTO NEW MATCH", { exact: true }).uncheck();
  await lichessPage.evaluate(
    /** Exposes a rematch after the new-opponent precedence check. */
    () => window.lichessFixture.gameOver());
  await lichessPage.getByRole("button", { name: "START", exact: true }).click();
  await expect(lichessPage).toHaveURL("https://lichess.org/RmTc1234/white", { timeout: 12000 });
  await expect(lichessPage.getByRole("button", { name: "STOP", exact: true })).toBeVisible({ timeout: 10000 });
  await lichessPage.getByRole("button", { name: "STOP", exact: true }).click();
  await lichessPage.reload();
  await expect(lichessPage.getByRole("button", { name: "START", exact: true })).toBeVisible();
  await lichessPage.close();
  const puzzlePage = await openFixture(context, errors, puzzleScript, "https://lichess.org/training/mix/pXYzT");
  await puzzlePage.getByRole("button", { name: "START", exact: true }).click();
  await expect(puzzlePage.getByRole("status")).toHaveText("Analyzing Board", { timeout: 25000 });
  await expect(puzzlePage.locator("cg-board > square.bot-highlight")).toHaveCount(2);
  await puzzlePage.getByRole("button", { name: "STOP", exact: true }).click();
  await puzzlePage.evaluate(
    /** Confirms puzzle ownership survives a manual board flip. */
    () => window.lichessPuzzleFixture.flip());
  await puzzlePage.getByRole("button", { name: "START", exact: true }).click();
  await expect(puzzlePage.getByRole("status")).toHaveText("Analyzing Board", { timeout: 25000 });
  await puzzlePage.getByRole("button", { name: "STOP", exact: true }).click();
  await puzzlePage.getByRole("button", { name: "Toggle Settings" }).click();
  await puzzlePage.getByLabel("AUTO PLAY", { exact: true }).check();
  await puzzlePage.getByRole("button", { name: "START", exact: true }).click();
  await expect.poll(
    /** Waits for another trusted move after correct-move feedback and the puzzle reply. */
    () => puzzlePage.evaluate(
      /** Reads accepted puzzle drags. */
      () => window.lichessPuzzleFixture.counts.moves), { timeout: 30000 }).toBe(2);
  await puzzlePage.waitForTimeout(650);
  await expect.poll(
    /** Correct feedback also shows View the solution but must not trigger it. */
    () => puzzlePage.evaluate(
      /** Reads unintended solution clicks. */
      () => window.lichessPuzzleFixture.counts.solutionViews)).toBe(0);
  await puzzlePage.getByRole("button", { name: "STOP", exact: true }).click();
  await puzzlePage.evaluate(
    /** Shows the failed feedback and its solution control. */
    () => window.lichessPuzzleFixture.fail());
  await puzzlePage.getByRole("button", { name: "START", exact: true }).click();
  await expect.poll(
    /** Waits for the failure-only solution action. */
    () => puzzlePage.evaluate(
      /** Reads solution clicks. */
      () => window.lichessPuzzleFixture.counts.solutionViews), { timeout: 10000 }).toBe(1);
  await expect.poll(
    /** Waits for the subsequent Continue training action. */
    () => puzzlePage.evaluate(
      /** Reads next-puzzle clicks. */
      () => window.lichessPuzzleFixture.counts.continues), { timeout: 10000 }).toBe(1);
  await puzzlePage.getByRole("button", { name: "STOP", exact: true }).click();
  await puzzlePage.close();
}
