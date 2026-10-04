/** Exercises the real pinned Lozza sources through their worker adapter, including empty searches. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContext, runInContext } from "node:vm";
import { buildSync } from "esbuild";
import { Chess } from "chess.js";
import { parseInfo } from "../src/shared";

const bundle = buildSync({ entryPoints: ["src/lozza-worker.ts"], bundle: true, write: false, format: "iife", platform: "browser" }).outputFiles[0]!.text;

/** Runs the upstream browser worker with a clock that can expire before its first root result. */
function harness(engine: string) {
  const output: string[] = [];
  let expired = false, tick = 0;
  /** Makes the one-millisecond timeout deterministic instead of relying on machine speed. */
  class Clock extends Date { static now(): number { return expired ? tick += 10 : Date.now(); } }
  const context = createContext({
    URL, MessageEvent, Date: Clock, WorkerGlobalScope: class {},
    location: { href: `https://extension.local/lozza-worker.js?engine=${engine}` },
    performance: { /** Supports Lozza 5's monotonic search clock. */ now: () => expired ? tick += 10 : performance.now() },
    /** Retains the actual UCI transport rather than mocking search results. */
    postMessage: (message: string) => output.push(message.trim()),
  });
  context.self = context;
  /** Loads unchanged vendored code into the same global scope as importScripts. */
  context.importScripts = (file: string) => runInContext(readFileSync(`public/vendor/${file}`, "utf8"), context, { filename: file });
  runInContext(bundle, context);
  /** Delivers commands with a runtime limit so a broken engine cannot hang the suite. */
  function command(data: string): void {
    runInContext(`self.onmessage(new MessageEvent("message", {data: ${JSON.stringify(data)}}))`, context, { timeout: 15000 });
  }
  return { output, command,
    /** Switches between normal search time and immediate timeout. */
    expire: (value: boolean) => { expired = value; },
    /** Confirms UCI analysis leaves the caller's root position intact. */
    fen: (): string => runInContext("lozza.board.fen(lozza.board.turn)", context) as string,
  };
}

for (const engine of ["lozza-2", "lozza-5"]) {
  /** Covers expired White, Black and promotion searches followed by healthy worker reuse. */
  test(`${engine} returns legal timed fallbacks without applying an empty move`, () => {
    const h = harness(engine);
    const game = new Chess();
    const start = game.fen();
    game.move("e4");
    h.command("uci");
    h.command("setoption name MultiPV value 10");
    for (const fen of [start, game.fen(), "7k/P7/6K1/8/8/8/8/8 w - - 0 1", "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1"]) {
      h.expire(true);
      h.command(`position fen ${fen}`);
      const root = h.fen();
      h.output.length = 0;
      h.command("go depth 30 movetime 1");
      const best = h.output.at(-1)?.split(" ")[1] ?? "";
      const played = new Chess(fen);
      assert.ok(played.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] ?? "q" }));
      if (engine === "lozza-2" && fen.includes("/5Q2/")) assert.equal(played.isCheckmate(), true);
      assert.equal(h.fen(), root);
      if (engine === "lozza-2") assert.equal(h.output.some(
        /** An emergency move has no searched score and must not manufacture one. */
        (line) => parseInfo(line, fen)), false);
    }
    h.expire(false);
    h.command(`position fen ${start}`);
    const root = h.fen();
    h.command("setoption name MultiPV value 1");
    h.output.length = 0;
    h.command("go depth 1");
    const variations = new Map<number, string>();
    for (const line of h.output) {
      const parsed = parseInfo(line, start);
      if (parsed) variations.set(parsed.index, parsed.variation.moves[0]!);
    }
    assert.equal(variations.size, 1);
    assert.equal(h.fen(), root);
    h.command("position fen 7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
    h.command("go depth 3");
    assert.equal(h.output.at(-1), "bestmove 0000");
  });
}
