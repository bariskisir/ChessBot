/** Builds the TypeScript extension and compiles SCSS into isolated React style text. */
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { compile } from "sass";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
const scss: Plugin = { name: "scss-text",
  /** Registers SCSS compilation as a text import for shadow-root styles. */
  setup(builder) {
    builder.onLoad({ filter: /\.scss$/ },
      /** Compiles an SCSS file without creating page-global CSS. */
      (args) => ({ contents: compile(args.path, { style: "compressed" }).css, loader: "text" }));
  },
};

/** Builds a single browser entry point with production React and readable source maps. */
async function bundle(entry: string, name: string): Promise<void> {
  await build({ entryPoints: [resolve(root, "src", entry)], outfile: resolve(output, name), bundle: true, format: "iife", target: "chrome120", sourcemap: true, minify: false, legalComments: "inline", loader: { ".svg": "dataurl" }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [scss] });
}

/** Recreates only the repository's generated distribution directory. */
async function main(): Promise<void> {
  if (output !== resolve(root, "dist") || dirname(output) !== root) throw new Error("Unsafe output directory.");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await Promise.all([bundle("background.ts", "background.js"), bundle("engine.ts", "offscreen.js"), bundle("bridge.ts", "bridge.js"), bundle("content.ts", "content.js")]);
  for (const name of ["manifest.json", "offscreen.html", "icons"]) await cp(resolve(root, "public", name), resolve(output, name), { recursive: true });
  await cp(resolve(root, "public/vendor"), output, { recursive: true });
  console.log("Built ChessBot 2.0.0 → dist (React, TypeScript, SCSS, local Stockfish 18)");
}
await main();
