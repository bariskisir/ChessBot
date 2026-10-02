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

/** Exercises queen and underpromotion gestures, delayed choosers, interruption, and stuck-window recovery. */
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
      /** Applies the requested promotion through the production board adapter. */
      ({ fen, piece }) => window.ChessbotBoardTest.playMove(fen, `a7a8${piece}`, AbortSignal.timeout(10000)), { fen, piece });
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

/** Verifies direct decisions and completed Laya jobs with credential-safe history and STOP. */
async function verifyDecisions(page: Page, engine: "openrouter-jev" | "laya"): Promise<void> {
  const provider = engine === "laya" ? "Laya" : "Jev";
  const keyLabel = engine === "laya" ? "LAYA API KEY" : "OPENROUTER API KEY";
  const key = engine === "laya" ? "fixture-laya-key" : "fixture-jev-key";
  const logLabel = engine === "laya" ? "laya-logs" : "jev-logs";
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(
    /** Installs a delayed decision fixture inside the service worker, preventing real API calls. */
    ({ engine, key }) => {
      const state = globalThis as typeof globalThis & { decisionCalls: number; savedFetch: typeof fetch };
      state.decisionCalls = 0;
      state.savedFetch = fetch;
      /** Returns direct Jev answers or a completed Laya job, even after cancellation. */
      globalThis.fetch = async (url, init) => {
        state.decisionCalls++;
        const body = JSON.parse(String(init?.body));
        const expectedUrl = engine === "laya" ? "https://laya-api.de/api/v1/systemone?wait=10" : "https://openrouter.ai/api/alpha/decisions";
        if (url !== expectedUrl || new Headers(init?.headers).get("Authorization") !== "Bearer " + key) throw new Error("Wrong decision provider or key");
        if (body.model !== (engine === "laya" ? "laya-latest" : "~typesafe/jev-latest") || !body.questions.move.criteria.e2e4) throw new Error("Invalid decision fixture request");
        await new Promise(
          /** Gives STOP time to cancel the in-flight decision. */
          (resolve) => setTimeout(resolve, 800));
        const result = { answers: { move: { choice: "e2e4" } }, usage: engine === "laya" ? { input_tokens: 296, output_tokens: 20 } : { cost: 0.00012345 } };
        return Response.json(engine === "laya" ? { id: "01J9Z3K6V8X2N4QH7R5T0WBC1D", object: "job", status: "completed", result } : result);
      };
    }, { engine, key });
  await page.getByLabel("ENGINE", { exact: true }).selectOption(engine);
  for (const label of ["DEPTH", "VARIATIONS", "AVERAGE MOVE", "MISTAKE", "ANALYZE OPPONENT"]) await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  await expect(page.locator("#bot-eval-text")).toHaveCount(0);
  if (engine === "laya") {
    const link = page.getByRole("link", { name: "laya-api.de", exact: true });
    await expect(link).toHaveAttribute("href", "https://laya-api.de");
    await expect(link).toHaveAttribute("target", "_blank");
    const linkBounds = await link.boundingBox();
    const inputBounds = await page.getByLabel(keyLabel, { exact: true }).boundingBox();
    assert.ok(linkBounds && inputBounds && linkBounds.y + linkBounds.height <= inputBounds.y);
  }
  await page.getByRole("button", { name: "START", exact: true }).click();
  await expect(page.getByRole("status")).toContainText((provider === "Jev" ? "OpenRouter" : "Laya") + " API key");
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  await page.getByLabel(keyLabel, { exact: true }).fill(key);
  await page.getByLabel("AUTO PLAY", { exact: true }).check();
  await page.getByRole("button", { name: logLabel, exact: true }).click();
  const logs = page.getByRole("complementary", { name: provider + " logs" });
  await expect(logs.getByLabel("Request count")).toHaveText("0/0");
  await expect(logs.getByLabel("Total cost")).toHaveText("Total cost: $0.00000000");
  const mainBounds = await page.locator("#bot-overlay-panel").boundingBox();
  const logBounds = await logs.boundingBox();
  assert.ok(mainBounds && logBounds);
  assert.ok(Math.abs(mainBounds.width * 1.25 - logBounds.width) < 1 && Math.abs(Math.min(mainBounds.height * 1.25, 760 - logBounds.y - 12) - logBounds.height) < 1);
  assert.ok(Math.abs(mainBounds.y - logBounds.y) < 1 && Math.abs(mainBounds.x - logBounds.x - logBounds.width - 8) < 1);
  await expect(page.getByRole("dialog", { name: provider + " logs" })).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle Settings" }).click();
  await expect(page.getByRole("button", { name: logLabel, exact: true })).toBeHidden();
  await expect(logs).toBeVisible();
  const collapsedLogBounds = await logs.boundingBox();
  assert.ok(collapsedLogBounds && Math.abs(collapsedLogBounds.height - logBounds.height) < 1 && Math.abs(collapsedLogBounds.width - logBounds.width) < 1);
  await page.getByRole("button", { name: "Toggle Settings" }).click();
  const expandedLogBounds = await logs.boundingBox();
  assert.ok(expandedLogBounds && Math.abs(expandedLogBounds.height - logBounds.height) < 1);
  await page.getByRole("button", { name: logLabel, exact: true }).click();
  await expect(logs).toHaveCount(0);
  await expect(page.getByRole("button", { name: logLabel, exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: logLabel, exact: true }).click();
  await expect(logs).toBeVisible();
  await page.getByRole("button", { name: "START", exact: true }).click();
  await count(page, "moves", 1);
  await expect(page.getByRole("status")).toHaveText("Opponent's turn");
  await expect(logs).toBeVisible();
  await expect(logs.getByLabel("Auto-follow")).toBeChecked();
  await expect(logs.getByLabel("Request count")).toHaveText("1/1");
  await expect(logs.getByLabel("Total cost")).toHaveText(engine === "laya" ? "Total cost: $0.00000000" : "Total cost: $0.00012345");
  await expect(logs).toContainText("Bearer [REDACTED]");
  await expect(logs).not.toContainText(key);
  if (engine === "laya") await expect(logs.locator('[data-log="request-body"]')).toContainText('"model": "laya-latest"');
  else await expect(logs.locator('[data-log="request-body"]')).toContainText('"model": "~typesafe/jev-latest"');
  await expect(logs.locator('[data-log="response-body"]')).toContainText('"choice": "e2e4"');
  await expect(logs.locator("details[open] > summary")).toHaveText(["Response", "Body"]);
  await expect(logs.locator('[data-log="request-body"]')).toBeHidden();
  await logs.locator("summary").filter({ hasText: /^Request$/ }).click();
  await logs.locator("details").filter({ has: page.locator(":scope > summary", { hasText: /^Request$/ }) }).locator("summary").filter({ hasText: /^Body$/ }).click();
  await expect(logs.locator('[data-log="request-body"]')).toBeVisible();
  await logs.locator("summary").filter({ hasText: /^Request$/ }).click();
  await expect(logs.locator('[data-log="request-body"]')).toBeHidden();
  await expect(logs.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
  await logs.getByRole("button", { name: "Close " + provider + " logs" }).click();
  await page.waitForTimeout(1000);
  assert.equal(await worker.evaluate(
    /** Confirms the saved opponent preference cannot send hosted decisions. */
    () => (globalThis as typeof globalThis & { decisionCalls: number }).decisionCalls), 1);
  assert.equal(await worker.evaluate(
    /** Confirms hosted decisions never create a Stockfish offscreen document. */
    () => chrome.offscreen.hasDocument()), false);
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  await page.evaluate(
    /** Resets the board for cancellation of a second decision. */
    () => { window.chessbotFixture.setFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"); window.chessbotFixture.resetCounters(); });
  await page.getByRole("button", { name: "START", exact: true }).click();
  await expect.poll(
    /** Waits for the request to actually enter the transport before STOP. */
    () => worker.evaluate(
      /** Reads only the test request counter. */
      () => (globalThis as typeof globalThis & { decisionCalls: number }).decisionCalls)).toBe(2);
  await page.getByRole("button", { name: logLabel, exact: true }).click();
  await expect(logs.getByLabel("Request count")).toHaveText("2/2");
  await logs.getByRole("button", { name: "Close " + provider + " logs" }).click();
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  await page.waitForTimeout(1200);
  await count(page, "moves", 0);
  await page.getByRole("button", { name: logLabel, exact: true }).click();
  await expect(logs.locator(".bot-log-meta")).toHaveCount(0);
  await logs.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(logs.getByLabel("Request count")).toHaveText("1/2");
  await expect(logs.getByLabel("Total cost")).toHaveText(engine === "laya" ? "Total cost: $0.00000000" : "Total cost: $0.00024690");
  await expect(logs.getByLabel("Auto-follow")).not.toBeChecked();
  await logs.getByRole("button", { name: "Next", exact: true }).click();
  await expect(logs.getByLabel("Request count")).toHaveText("2/2");
  await logs.getByRole("button", { name: "Previous", exact: true }).click();
  await logs.getByLabel("Auto-follow").check();
  await expect(logs.getByLabel("Request count")).toHaveText("2/2");
  await logs.getByRole("button", { name: "Close " + provider + " logs" }).press("Escape");
  await expect(logs).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "START", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Toggle Settings" }).click();
  await expect(page.getByLabel("ENGINE", { exact: true })).toHaveValue(engine);
  await expect(page.getByLabel(keyLabel, { exact: true })).toHaveValue(key);
  await page.getByRole("button", { name: logLabel, exact: true }).click();
  await expect(logs.getByLabel("Request count")).toHaveText("2/2");
  await expect(logs.getByLabel("Total cost")).toHaveText(engine === "laya" ? "Total cost: $0.00000000" : "Total cost: $0.00024690");
  await logs.getByRole("button", { name: "Clear " + provider + " logs" }).click();
  await expect(logs.getByLabel("Request count")).toHaveText("0/0");
  await expect(logs.getByLabel("Total cost")).toHaveText("Total cost: $0.00000000");
  await page.reload();
  await expect(page.getByRole("button", { name: "START", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Toggle Settings" }).click();
  await page.getByRole("button", { name: logLabel, exact: true }).click();
  await expect(logs.getByLabel("Request count")).toHaveText("0/0");
  await logs.getByRole("button", { name: "Close " + provider + " logs" }).click();
  await page.getByLabel(keyLabel, { exact: true }).fill("");
  await page.getByLabel("ENGINE", { exact: true }).selectOption("stockfish-18");
  await page.getByLabel("AUTO PLAY", { exact: true }).uncheck();
  await worker.evaluate(
    /** Restores the service worker transport after the isolated provider fixture. */
    () => { const state = globalThis as typeof globalThis & { savedFetch: typeof fetch }; globalThis.fetch = state.savedFetch; });
}

/** Exercises queued Laya jobs, late polls and canceled waits through the real extension. */
async function verifyLayaPolling(page: Page): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(
    /** Queues every submission and exposes delayed polls without contacting the hosted API. */
    () => {
      const state = globalThis as typeof globalThis & { layaPosts: number; layaPolls: number; layaHold: boolean; savedFetch: typeof fetch };
      state.layaPosts = 0; state.layaPolls = 0; state.layaHold = false; state.savedFetch = fetch;
      /** Checks authentication on submissions and polls, then returns raw job envelopes. */
      globalThis.fetch = async (url, init) => {
        if (new Headers(init?.headers).get("Authorization") !== "Bearer fixture-laya-poll-key") throw new Error("Wrong polling credential");
        const id = "01J9Z3K6V8X2N4QH7R5T0WBC1D";
        if (url === "https://laya-api.de/api/v1/systemone?wait=10" && init?.method === "POST") {
          state.layaPosts++;
          return Response.json({ id, object: "job", status: "queued", result: null }, { status: 202 });
        }
        if (url !== `https://laya-api.de/api/v1/jobs/${id}` || init?.method !== "GET" || init.body !== undefined) throw new Error("Invalid job poll");
        state.layaPolls++;
        if (state.layaHold) await new Promise(
          /** Makes a completed job arrive after STOP has already canceled its move. */
          (resolve) => setTimeout(resolve, 800));
        return Response.json({ id, object: "job", status: state.layaPolls === 1 ? "processing" : "completed", result: state.layaPolls === 1 ? null : { answers: { move: { choice: "e2e4" } }, usage: { input_tokens: 296, output_tokens: 20 } } });
      };
    });
  await page.getByLabel("ENGINE", { exact: true }).selectOption("laya");
  await page.getByLabel("LAYA API KEY", { exact: true }).fill("fixture-laya-poll-key");
  await page.getByLabel("AUTO PLAY", { exact: true }).check();
  await page.getByRole("button", { name: "START", exact: true }).click();
  await count(page, "moves", 1);
  await expect(page.getByRole("status")).toHaveText("Opponent's turn");
  assert.equal(await worker.evaluate(
    /** Confirms queued jobs progress through two GET polls without starting Stockfish. */
    () => (globalThis as typeof globalThis & { layaPolls: number }).layaPolls), 2);
  assert.equal(await worker.evaluate(
    /** Keeps the hosted provider independent of the local engine host. */
    () => chrome.offscreen.hasDocument()), false);
  await page.getByRole("button", { name: "laya-logs", exact: true }).click();
  const logs = page.getByRole("complementary", { name: "Laya logs" });
  await expect(logs.getByLabel("Request count")).toHaveText("3/3");
  await expect(logs).toContainText("GET https://laya-api.de/api/v1/jobs/");
  await expect(logs).not.toContainText("fixture-laya-poll-key");
  await logs.getByRole("button", { name: "Close Laya logs" }).click();
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  await page.evaluate(
    /** Restores the initial position to detect an incorrectly played late completion. */
    () => { window.chessbotFixture.setFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"); window.chessbotFixture.resetCounters(); });
  await worker.evaluate(
    /** Holds the next GET response until its operation has been canceled. */
    () => { (globalThis as typeof globalThis & { layaHold: boolean }).layaHold = true; });
  await page.getByRole("button", { name: "START", exact: true }).click();
  await expect.poll(
    /** Waits for the delayed GET to be in flight before pressing STOP. */
    () => worker.evaluate(
      /** Reads only the controlled poll counter. */
      () => (globalThis as typeof globalThis & { layaPolls: number }).layaPolls)).toBe(3);
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  await page.waitForTimeout(1200);
  await count(page, "moves", 0);
  await page.getByRole("button", { name: "laya-logs", exact: true }).click();
  await expect(logs.getByLabel("Request count")).toHaveText("5/5");
  await expect(logs.locator(".bot-log-error")).toBeVisible();
  await logs.getByRole("button", { name: "Close Laya logs" }).click();
  await page.getByRole("button", { name: "START", exact: true }).click();
  await expect.poll(
    /** Waits for a queued submission so STOP interrupts the following one-second wait. */
    () => worker.evaluate(
      /** Reads only the controlled submission counter. */
      () => (globalThis as typeof globalThis & { layaPosts: number }).layaPosts)).toBe(3);
  await page.getByRole("button", { name: "STOP", exact: true }).click();
  await page.waitForTimeout(1200);
  await count(page, "moves", 0);
  assert.equal(await worker.evaluate(
    /** Ensures cancellation of the queued wait prevents an additional GET. */
    () => (globalThis as typeof globalThis & { layaPolls: number }).layaPolls), 3);
  await page.getByRole("button", { name: "laya-logs", exact: true }).click();
  await logs.getByRole("button", { name: "Clear Laya logs" }).click();
  await logs.getByRole("button", { name: "Close Laya logs" }).click();
  await page.getByLabel("LAYA API KEY", { exact: true }).fill("");
  await page.getByLabel("ENGINE", { exact: true }).selectOption("stockfish-18");
  await page.getByLabel("AUTO PLAY", { exact: true }).uncheck();
  await worker.evaluate(
    /** Restores the transport before the independent local-engine checks. */
    () => { const state = globalThis as typeof globalThis & { savedFetch: typeof fetch }; globalThis.fetch = state.savedFetch; });
}

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
  await expect(page.getByLabel("ENGINE", { exact: true })).toHaveValue("stockfish-18");
  await expect(page.locator("#bot-fen-text")).toHaveCount(0);
  for (const name of ["AUTO PLAY", "AUTO NEW MATCH", "AUTO REMATCH", "ANALYZE OPPONENT", "AVERAGE MOVE"]) await expect(page.getByLabel(name, { exact: true })).toBeVisible();
  await expect(page.getByLabel("RANDOM DELAY", { exact: true })).toHaveAttribute("max", "10");
  await expect(page.getByLabel("RANDOM DELAY", { exact: true })).toHaveAttribute("step", "0.1");
  await expect(page.getByLabel("RANDOM DELAY", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("MISTAKE", { exact: true })).toHaveAttribute("max", "100");
  await expect(page.getByLabel("VARIATIONS", { exact: true })).toHaveAttribute("max", "10");
  await expect(page.getByLabel("DEPTH", { exact: true })).toHaveValue("6");
  await verifyDecisions(page, "openrouter-jev");
  await verifyDecisions(page, "laya");
  await verifyLayaPolling(page);
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

  // Restore and persist slider values and the dragged panel position.
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
  await page.getByRole("button", { name: "jev-logs", exact: true }).click();
  const compactLogs = await page.getByRole("complementary", { name: "Jev logs" }).boundingBox();
  const compactMain = await page.locator("#bot-overlay-panel").boundingBox();
  assert.ok(compactLogs && compactMain && compactLogs.x >= 0 && compactMain.x + compactMain.width <= 390);
  assert.ok(Math.abs(compactLogs.width - compactMain.width * 1.25) < 1 && Math.abs(compactLogs.height - Math.min(compact.height * 1.25, 760 - compactLogs.y - 12)) < 1);
  assert.deepEqual(errors, []);
  console.log("Passed: panel controls, Jev decisions, Laya jobs and canceled polling, masked logs, best move, eval bar, highlights, actual auto play, STOP cancellation, rematch, new-match precedence, setting migration, saved dragging, offline engine, and tab isolation.");
} finally { await context.close(); }
