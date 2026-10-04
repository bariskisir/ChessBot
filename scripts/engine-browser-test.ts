/** Exercises every bundled engine in Chromium and through the extension's actual panel. */
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { ENGINES, type EngineDefinition } from "../src/engines";
import { parseInfo } from "../src/shared";

const startFen = new Chess().fen();

/** Boots a real packaged worker and records its UCI output through a complete search. */
async function search(page: Page, engine: EngineDefinition, fen: string, lines: number, movetime?: number): Promise<{ output: string[]; elapsed: number }> {
  return page.evaluate(
    /** Keeps every engine asset on the extension origin and reports startup or search failures. */
    ({ workerUrl, fen, lines, movetime }) => new Promise<{ output: string[]; elapsed: number }>(
      /** Drives UCI readiness before submitting a bounded or depth-limited position. */
      (resolve, reject) => {
        const worker = new Worker(workerUrl), output: string[] = [], started = Date.now();
        const timeout = setTimeout(
          /** Releases a stalled real worker instead of letting the browser suite hang. */
          () => { worker.terminate(); reject(new Error(`Worker timed out: ${workerUrl}\n${output.slice(-10).join("\n")}`)); }, 20000);
        /** Propagates a startup failure with the selected worker path. */
        worker.onerror = (event) => { clearTimeout(timeout); worker.terminate(); reject(new Error(`${workerUrl}: ${event.message}`)); };
        /** Collects all score lines before accepting the final bestmove. */
        worker.onmessage = (event: MessageEvent<unknown>) => {
          if (typeof event.data !== "string") return;
          const line = event.data.trim();
          output.push(line);
          if (line === "uciok") {
            worker.postMessage("setoption name Hash value 32");
            worker.postMessage(`setoption name MultiPV value ${lines}`);
            worker.postMessage("ucinewgame");
            worker.postMessage("isready");
          } else if (line === "readyok") {
            worker.postMessage(`position fen ${fen}`);
            worker.postMessage(movetime === undefined ? "go depth 4" : `go depth 30 movetime ${movetime}`);
          } else if (line.startsWith("bestmove ")) {
            clearTimeout(timeout);
            worker.terminate();
            resolve({ output, elapsed: Date.now() - started });
          }
        };
        worker.postMessage("uci");
      }), { workerUrl: engine.worker, fen, lines, movetime });
}

/** Verifies identity, legal root variations, mate scores, promotions and deadlines for all versions. */
export async function verifyEngineWorkers(context: BrowserContext): Promise<void> {
  const service = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = await context.newPage();
  await context.setOffline(true);
  await page.goto(new URL("offscreen.html", service.url()).href);
  try {
    const black = new Chess();
    black.move("e4");
    for (const engine of ENGINES) {
      for (const fen of [startFen, black.fen(), "7k/P7/6K1/8/8/8/8/8 w - - 0 1", "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1", "7k/8/5K2/8/8/8/8/7R b - - 0 1"]) {
        const lines = fen === startFen || fen === black.fen() || fen.includes("/7R ") ? 3 : 1;
        const { output } = await search(page, engine, fen, lines);
        assert.ok(output.some(
          /** Confirms the worker is the pinned engine version rather than a generic fallback. */
          (line) => engine.identity.test(line)), `${engine.name}: wrong identity`);
        const variations = new Map<number, NonNullable<ReturnType<typeof parseInfo>>>();
        for (const line of output) { const parsed = parseInfo(line, fen); if (parsed) variations.set(parsed.index, parsed); }
        assert.equal(variations.size, Math.min(lines, new Chess(fen).moves().length), `${engine.name}: missing MultiPV at ${fen}\n${output.slice(-10).join("\n")}`);
        const roots = new Set<string>();
        for (const { variation } of variations.values()) {
          const move = variation.moves[0]!;
          assert.ok(!roots.has(move), `${engine.name}: duplicate root move ${move}`);
          roots.add(move);
          assert.ok(variation.depth >= 4 || variation.mate !== null || new Chess(fen).moves().length === 1, `${engine.name}: insufficient depth`);
          assert.ok(Number.isFinite(variation.score));
          const game = new Chess(fen);
          assert.ok(game.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] ?? "q" }));
        }
        const bestMove = [...output].reverse().find(
          /** Selects the only final response, after all adapter-generated variations. */
          (line) => line.startsWith("bestmove "))?.split(" ")[1];
        assert.equal(bestMove, variations.get(0)?.variation.moves[0]);
        if (fen.includes("/P7/")) assert.match(bestMove!, /^a7a8[qrbn]$/);
        if (fen.includes("/5Q2/")) assert.equal(variations.get(0)?.variation.mate, 1, `${engine.name}: mate score\n${output.slice(-10).join("\n")}`);
      }
      const limited = await search(page, engine, startFen, 3, 150);
      assert.ok(limited.elapsed < 5000, `${engine.name}: ignored movetime`);
      const move = [...limited.output].reverse().find(
        /** Extracts the legal fallback produced within the bounded search. */
        (line) => line.startsWith("bestmove "))?.split(" ")[1]!;
      assert.ok(new Chess().move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] ?? "q" }));
      console.log(`Passed ${engine.name}: real worker, White/Black analysis, MultiPV, promotion, mate and movetime.`);
    }
  } finally { await page.close(); await context.setOffline(false); }
}

/** Checks selection persistence, real offscreen analysis and automatic input for each engine. */
export async function verifyEngineSelections(page: Page, setRange: (page: Page, label: string, value: string) => Promise<void>): Promise<void> {
  await setRange(page, "DEPTH", "4");
  await setRange(page, "VARIATIONS", "3");
  for (const engine of ENGINES) {
    await setRange(page, "DEPTH", engine.id === "lozza-2" ? "7" : "4");
    await setRange(page, "VARIATIONS", engine.id === "lozza-2" ? "10" : "3");
    await page.getByLabel("ENGINE", { exact: true }).selectOption(engine.id);
    await page.reload();
    await expect(page.getByRole("button", { name: "START", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Toggle Settings" }).click();
    await expect(page.getByLabel("ENGINE", { exact: true })).toHaveValue(engine.id);
    await page.getByRole("button", { name: "START", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Analyzing Board", { timeout: 25000 });
    await expect(page.locator("#best-move-text")).toHaveText(/^[A-H][1-8][A-H][1-8][QRBN]?$/);
    await page.getByLabel("AUTO PLAY", { exact: true }).check();
    await expect.poll(
      /** Confirms the selected engine reaches actual fixture input through the production controller. */
      () => page.evaluate(() => window.chessbotFixture.counters.moves), { timeout: 25000 }).toBe(1);
    await page.getByRole("button", { name: "STOP", exact: true }).click();
    await page.getByLabel("AUTO PLAY", { exact: true }).uncheck();
    await page.evaluate(
      /** Restores a new board so each engine gets an independent automatic move check. */
      (fen) => { window.chessbotFixture.setFen(fen); window.chessbotFixture.resetCounters(); }, startFen);
    console.log(`Passed ${engine.name}: selector, persistence, offscreen analysis, Average Move and Auto Play.`);
  }
  await page.getByLabel("ENGINE", { exact: true }).selectOption("stockfish-19");
  await setRange(page, "DEPTH", "6");
  await setRange(page, "VARIATIONS", "10");
}
