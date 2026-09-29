/** Copies the pinned npm Stockfish engine and its license into public vendor assets. */
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Copies the pinned lite-single worker under the generic names loaded by the engine. */
async function main(): Promise<void> {
  const require = createRequire(import.meta.url);
  const packageRoot = dirname(require.resolve("stockfish/package.json"));
  const bin = join(packageRoot, "bin");
  const script = (await readdir(bin)).find(
    /** Selects the single-threaded Lite worker regardless of the pinned major version. */
    (name) => /-lite-single\.js$/.test(name));
  if (!script) throw new Error("Pinned stockfish package has no lite-single worker.");
  const destination = fileURLToPath(new URL("../public/vendor/", import.meta.url));
  await mkdir(destination, { recursive: true });
  await copyFile(join(bin, script), join(destination, "stockfish.js"));
  await copyFile(join(bin, script.replace(/\.js$/, ".wasm")), join(destination, "stockfish.wasm"));
  await copyFile(join(packageRoot, "Copying.txt"), join(destination, "STOCKFISH-LICENSE.txt"));
}
await main();
