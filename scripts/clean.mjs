/**
 * Removes generated extension build output.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Deletes the dist directory created by the build script.
 */
async function main() {
  await rm(join(process.cwd(), "dist"), { recursive: true, force: true });
}

await main();
