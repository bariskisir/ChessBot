/** Verifies panel feature parity against the real bundled engine and a controlled board. */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build } from "esbuild";
import { Chess } from "chess.js";
import { chromium, expect, type Page } from "@playwright/test";
import type {} from "../tests/board-fixture";
declare global { interface Window { ChessbotBoardTest: typeof import("../src/board") } }

/** Exercises instant and animated promotions, delayed choosers, interruption, and recovery. */
async function verifyPromotions(page: Page): Promise<void> {
  const harness = await build({ entryPoints: ["src/board.ts"], bundle: true, write: false, format: "iife", globalName: "ChessbotBoardTest", target: "chrome120" });
  await page.addScriptTag({ content: harness.outputFiles[0]!.text });
  const fen = "7k/P7/6K1/8/8/8/8/8 w - - 0 1";
  for (const piece of ["q", "r", "b", "n"]) {
    await page.evaluate(
      /** Loads a legal promotion position and delays the queen chooser beyond the old timeout. */
      ({ fen, piece }) => { window.chessbotFixture.setFen(fen); window.chessbotFixture.configurePromotion(piece === "q" ? 3300 : 0); }, { fen, piece });
    await expectFen(page, fen);
    const accepted = await page.evaluate(
      /** Exercises instant and animated promotions through the production board adapter. */
      ({ fen, piece }) => window.ChessbotBoardTest.playMove(fen, `a7a8${piece}`, AbortSignal.timeout(10000), piece === "r"), { fen, piece });
    assert.equal(accepted, true);
    await expect(page.locator(`.piece.w${piece}.square-18`)).toHaveCount(1);
    await expect(page.locator(".promotion-window")).toHaveCount(0);
  }

  // Reproduce the supplied capture-promotion position, including its dragging pawn and old FEN.
  const supplied = "r2qrbk1/1Ppn1p1p/3p4/pp2p1p1/4P3/1BP2N1P/PP1N1PP1/R1BQR1K1 w - - 1 15";
  await page.evaluate(
    /** Opens the user's pending b7-a8 promotion without applying a piece choice. */
    async (fen) => { window.chessbotFixture.setFen(fen); window.chessbotFixture.configurePromotion(0); await window.chessbotFixture.openPromotion("b7", "a8"); }, supplied);
  await expectFen(page, supplied);
  await page.getByLabel("AUTO PLAY", { exact: true }).check();
  await page.getByRole("button", { name: "START", exact: true }).click();
  await expect(page.locator(".piece.wq.square-18")).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator(".promotion-window")).toHaveCount(0);
  await page.getByRole("button", { name: "STOP", exact: true }).click();

  // Confirm pending Black promotions use Black's pieces even on a flipped board.
  const blackFen = "8/8/8/8/8/6k1/p7/7K b - - 0 1";
  await page.evaluate(
    /** Creates a Black promotion chooser and flips the board to the player's perspective. */
    async (fen) => { window.chessbotFixture.setFen(fen); document.querySelector("wc-chess-board")!.classList.add("flipped"); await window.chessbotFixture.openPromotion("a2", "a1"); }, blackFen);
  await expectFen(page, blackFen);
  await page.getByRole("button", { name: "START", exact: true }).click();
  await expect(page.locator(".piece.bq.square-11")).toHaveCount(1, { timeout: 10000 });
  await page.getByRole("button", { name: "STOP", exact: true }).click();

  // A rejected input must remain cancelable instead of clicking after STOP.
  await page.evaluate(
    /** Prepares an open chooser that rejects input until the cancellation test releases it. */
    async (fen) => { document.querySelector("wc-chess-board")!.classList.remove("flipped"); window.chessbotFixture.setFen(fen); window.chessbotFixture.configurePromotion(0, false); window.chessbotFixture.resetCounters(); await window.chessbotFixture.openPromotion("a7", "a8"); }, fen);
  await expectFen(page, fen);
  await page.getByRole("button", { name: "START", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Completing promotion...");
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  await page.evaluate(
    /** Allows future clicks so a leaked retry would become observable. */
    () => window.chessbotFixture.configurePromotion(0, true));
  await page.waitForTimeout(700);
  await count(page, "moves", 0);
  await expect(page.locator(".promotion-window")).toHaveCount(1);
  await page.getByLabel("AUTO PLAY", { exact: true }).uncheck();
  await page.evaluate(
    /** Restores the normal board and counters after promotion regressions. */
    () => { window.chessbotFixture.setFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"); window.chessbotFixture.resetCounters(); });
}

/** Changes a range input through its native setter so React receives a real input event. */
async function setRange(page: Page, label: string, value: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).evaluate(
    /** Updates the browser input value and dispatches its standard change notification. */
    (element, next) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, next); element.dispatchEvent(new Event("input", { bubbles: true })); }, value);
}

/** Waits until the fixture reports the expected position without page markers. */
async function expectFen(page: Page, fen: string): Promise<void> {
  await expect.poll(
    /** Reads the fixture's actual position from the page world. */
    () => page.evaluate(() => window.chessbotFixture.fen()), { timeout: 10000 }).toBe(fen);
}

/** Waits until a fixture counter reaches the expected number of actions. */
async function count(page: Page, key: "moves" | "rematches" | "newMatches", expected: number): Promise<void> {
  await expect.poll(
    /** Reads the fixture's actual event counter. */
    () => page.evaluate(
      /** Selects one counter in the page world. */
      (name) => window.chessbotFixture.counters[name], key), { timeout: 25000 }).toBe(expected);
}

/** Verifies that both sides' moves replace the previous evaluation without a zero reset. */
async function verifyEvaluationUpdates(page: Page): Promise<void> {
  const game = new Chess();
  for (const move of ["e4", "e5"]) {
    const before = await page.locator("#bot-eval-text").textContent();
    const previousMove = await page.locator("#best-move-text").textContent();
    const trace = await page.evaluateHandle(
      /** Records every rendered evaluation while the next position is being calculated. */
      () => {
        /** Finds the panel shadow root without relying on a page-visible host identifier. */
        const root = [...document.querySelectorAll("div")].find((element) => element.shadowRoot)?.shadowRoot!;
        const samples: string[] = [root.querySelector("#bot-eval-text")!.textContent!];
        const moves: string[] = [root.querySelector("#best-move-text")!.textContent!];
        const observer = new MutationObserver(
          /** Captures every rendered evaluation and move during a position update. */
          () => { samples.push(root.querySelector("#bot-eval-text")!.textContent!); moves.push(root.querySelector("#best-move-text")!.textContent!); });
        observer.observe(root.querySelector("#bot-move-display")!, { subtree: true, childList: true, characterData: true, attributes: true });
        return { samples, moves, observer };
      });
    game.move(move);
    await page.evaluate(
      /** Advances the board while retaining the same running panel. */
      (fen) => window.chessbotFixture.setFen(fen), game.fen());
    const expectedStatus = game.turn() === "b" ? "Opponent's turn" : "Analyzing Board";
    await expect(page.getByRole("status")).toHaveText(expectedStatus, { timeout: 25000 });
    const after = await page.locator("#bot-eval-text").textContent();
    const nextMove = await page.locator("#best-move-text").textContent();
    const { samples, moves } = await trace.evaluate(
      /** Stops recording and returns all intermediate visible values. */
      (recording) => { recording.observer.disconnect(); return { samples: recording.samples, moves: recording.moves }; });
    assert.ok(samples.length > 1, `Evaluation did not update after ${move}`);
    assert.ok(samples.every(
      /** Allows only the previous value and the completed new evaluation. */
      (value) => value === before || value === after), `Transient evaluation after ${move}: ${samples.join(", ")}`);
    assert.ok(moves.every(
      /** Rejects temporary empty or reset move labels during analysis. */
      (value) => value === previousMove || value === nextMove), `Transient best move after ${move}: ${moves.join(", ")}`);
    assert.match(nextMove!, /^[A-H][1-8][A-H][1-8][QRBN]?$/);
    await expect(page.locator(".highlight[data-tone]")).toHaveCount(2);
    const suggested = game.move({ from: nextMove!.slice(0, 2).toLowerCase(), to: nextMove!.slice(2, 4).toLowerCase(), promotion: nextMove![4]?.toLowerCase() ?? "q" });
    assert.equal(suggested.color, move === "e4" ? "b" : "w");
    game.undo();
    const contrast = await page.locator("#bot-eval-text").evaluate(
      /** Checks that the label inherits a pure black or white segment background. */
      (element) => ({ background: getComputedStyle(element.parentElement!).backgroundColor, color: getComputedStyle(element).color }));
    assert.ok(contrast.background === "rgb(255, 255, 255)" && contrast.color === "rgb(0, 0, 0)" || contrast.background === "rgb(0, 0, 0)" && contrast.color === "rgb(255, 255, 255)");
    await trace.dispose();
  }
}

const fixture = await build({ entryPoints: ["tests/board-fixture.ts"], bundle: true, write: false, format: "iife", target: "chrome120", loader: { ".css": "text" } });
const fixtureScript = fixture.outputFiles[0]!.text;
const profile = await mkdtemp(resolve(tmpdir(), "chessbot-parity-"));
const extension = resolve("dist");
const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1000, height: 760 } });
const errors: string[] = [];

/** Opens an intercepted Chess.com computer page with real content scripts and a controllable board. */
async function openBoard(): Promise<Page> {
  const page = await context.newPage();
  page.on("pageerror",
    /** Captures uncaught errors from the integration page. */
    (error) => errors.push(error.message));
  await page.route("https://www.chess.com/play/computer",
    /** Serves a controlled fixture without touching a live game. */
    (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><script>${fixtureScript}</script></body></html>` }));
  await page.goto("https://www.chess.com/play/computer");
  await expect(page.getByRole("button", { name: "START", exact: true })).toBeEnabled();
  return page;
}

try {
  const page = await openBoard();
  await expect(page.locator("#best-move-text")).toHaveText("---");
  await expect(page.locator("#bot-eval-text")).toHaveText("0.00");
  await page.getByRole("button", { name: "Toggle Settings" }).click();
  await expect(page.locator("#bot-engine-select")).toHaveCount(0);
  await expect(page.locator("#bot-fen-text")).toHaveCount(0);
  for (const name of ["AUTO PLAY", "AUTO NEW MATCH", "AUTO REMATCH", "ANALYZE OPPONENT", "AVERAGE MOVE", "ANIMATE MOVES"]) await expect(page.getByLabel(name, { exact: true })).toBeVisible();
  await expect(page.getByLabel("ANIMATE MOVES", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("RANDOM DELAY", { exact: true })).toHaveAttribute("max", "10");
  await expect(page.getByLabel("RANDOM DELAY", { exact: true })).toHaveAttribute("step", "0.1");
  await expect(page.getByLabel("RANDOM DELAY", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("MISTAKE", { exact: true })).toHaveAttribute("max", "100");
  await expect(page.getByLabel("VARIATIONS", { exact: true })).toHaveAttribute("max", "10");
  await expect(page.getByLabel("DEPTH", { exact: true })).toHaveValue("6");
  await page.getByRole("button", { name: "START", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Analyzing Board", { timeout: 25000 });
  await expect(page.locator("#best-move-text")).toHaveText(/^[A-H][1-8][A-H][1-8][QRBN]?$/);
  await expect(page.locator(".highlight[data-tone]")).toHaveCount(2);
  await expect(page.locator("#bot-eval-text")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await verifyEvaluationUpdates(page);
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  await expect(page.locator(".highlight[data-tone]")).toHaveCount(0);
  await expect(page.locator("#best-move-text")).toHaveText("---");
  await verifyPromotions(page);
  await page.evaluate(
    /** Restores the initial board for the independent automation checks. */
    () => window.chessbotFixture.setFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"));

  // Exercise real automatic board input, followed by STOP during a subsequent search.
  await page.getByLabel("AUTO PLAY", { exact: true }).check();
  await expect(page.getByLabel("RANDOM DELAY", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "START", exact: true }).click();
  await count(page, "moves", 1);
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  await page.evaluate(
    /** Restores the initial fixture position after the automatic move check. */
    () => window.chessbotFixture.setFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"));
  await page.getByRole("button", { name: "START", exact: true }).click();
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  await page.waitForTimeout(1200);
  await count(page, "moves", 1);
  await page.getByLabel("AUTO PLAY", { exact: true }).uncheck();

  // STOP must cancel a pending rematch before its 2.5-second delay elapses.
  await page.getByLabel("AUTO REMATCH", { exact: true }).check();
  await page.evaluate(
    /** Makes a rematch action available to the detector. */
    () => window.chessbotFixture.gameOver(false));
  await page.getByRole("button", { name: "START", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Waiting 2.5s for Rematch");
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  await page.waitForTimeout(2800);
  await count(page, "rematches", 0);
  await page.getByRole("button", { name: "START", exact: true }).click();
  await count(page, "rematches", 1);
  await expect(page.getByRole("status")).toHaveText("Analyzing Board", { timeout: 25000 });
  await page.getByRole("button", { name: "STOP", exact: true }).click();

  // New match retains precedence when both game-over options are enabled.
  await page.getByLabel("AUTO NEW MATCH", { exact: true }).check();
  await page.evaluate(
    /** Exposes both game-over actions for the precedence check. */
    () => window.chessbotFixture.gameOver(true));
  await page.getByRole("button", { name: "START", exact: true }).click();
  await count(page, "newMatches", 1);
  await count(page, "rematches", 1);
  await page.getByRole("button", { name: "STOP", exact: true }).click();

  // Persist animation alongside slider values and the dragged panel position.
  await page.getByLabel("ANIMATE MOVES", { exact: true }).check();
  await setRange(page, "MISTAKE", "70");
  await setRange(page, "RANDOM DELAY", "3.4");
  const header = await page.locator(".bot-panel-header").boundingBox();
  assert.ok(header);
  await page.mouse.move(header.x + 40, header.y + 8);
  await page.mouse.down();
  await page.mouse.move(header.x - 40, header.y + 80, { steps: 5 });
  await page.mouse.up();
  const moved = await page.locator("#bot-overlay-panel").boundingBox();
  await page.reload();
  await expect(page.getByRole("button", { name: "START", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Toggle Settings" }).click();
  await expect(page.getByLabel("MISTAKE", { exact: true })).toHaveValue("70");
  await expect(page.getByLabel("RANDOM DELAY", { exact: true })).toHaveValue("3.4");
  await expect(page.getByLabel("AUTO NEW MATCH", { exact: true })).toBeChecked();
  await expect(page.getByLabel("AUTO REMATCH", { exact: true })).toBeChecked();
  await expect(page.getByLabel("ANIMATE MOVES", { exact: true })).toBeChecked();
  const restored = await page.locator("#bot-overlay-panel").boundingBox();
  assert.ok(moved && restored && Math.abs(moved.x - restored.x) < 2 && Math.abs(moved.y - restored.y) < 2);
  await setRange(page, "MISTAKE", "0");

  // Confirm independent engine ownership and fully local offline execution.
  const second = await openBoard();
  await context.setOffline(true);
  await Promise.all([page.getByRole("button", { name: "START", exact: true }).click(), second.getByRole("button", { name: "START", exact: true }).click()]);
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  await expect(second.getByRole("status")).toHaveText("Analyzing Board", { timeout: 25000 });
  await expect(page.getByRole("status")).toHaveText("Stopped");
  await context.setOffline(false);
  await second.getByRole("button", { name: "STOP", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 760 });
  const compact = await page.locator("#bot-overlay-panel").boundingBox();
  assert.ok(compact && compact.x >= 0 && compact.x + compact.width <= 390);
  assert.deepEqual(errors, []);
  console.log("Passed: panel controls, best move, eval bar, highlights, actual auto play, STOP cancellation, rematch, new-match precedence, setting migration, saved dragging, offline engine, and tab isolation.");
} finally { await context.close(); }
