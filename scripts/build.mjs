/**
 * Builds the Chrome extension by bundling TypeScript entry points and copying static assets.
 */
import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";

const rootDir = process.cwd();
const distDir = join(rootDir, "dist");
const publicDir = join(rootDir, "public");

/**
 * Removes old build output and recreates the distribution directory.
 */
async function resetDist() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
}

/**
 * Bundles an extension entry point with the requested module format.
 */
async function bundleEntry(entryPoint, outfile, format) {
  await build({
    entryPoints: [join(rootDir, entryPoint)],
    outfile: join(distDir, outfile),
    bundle: true,
    format,
    target: "chrome120",
    sourcemap: true,
    legalComments: "inline",
  });
}

/**
 * Copies manifest, styles, HTML, and vendored Stockfish artifacts into dist.
 */
async function copyStaticAssets() {
  await copyFile(join(publicDir, "manifest.json"), join(distDir, "manifest.json"));
  await copyFile(join(publicDir, "offscreen.html"), join(distDir, "offscreen.html"));
  await copyFile(join(publicDir, "styles.css"), join(distDir, "styles.css"));
  await cp(join(publicDir, "icons"), join(distDir, "icons"), { recursive: true });
  await cp(join(publicDir, "vendor"), distDir, { recursive: true });
}

/**
 * Runs the complete production build for the extension.
 */
async function main() {
  await resetDist();
  await Promise.all([
    bundleEntry("src/extension/background/service-worker.ts", "background.js", "esm"),
    bundleEntry("src/extension/content/index.ts", "content.js", "iife"),
    bundleEntry("src/extension/offscreen/stockfish-host.ts", "offscreen.js", "iife"),
  ]);
  await copyStaticAssets();
}

await main();
