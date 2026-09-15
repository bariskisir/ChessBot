/** Rasterizes the supplied SVG into the exact transparent PNG sizes used by Chrome. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

/** Renders the artwork without changing its paths, colors, or proportions. */
async function main(): Promise<void> {
  const icons = resolve(dirname(fileURLToPath(import.meta.url)), "../public/icons");
  const svg = await readFile(resolve(icons, "icon.svg"), "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style></head><body>${svg}</body></html>`);
    for (const size of [16, 32, 48, 128]) {
      await page.setViewportSize({ width: size, height: size });
      const png = await page.screenshot({ path: resolve(icons, `icon-${size}.png`), omitBackground: true });
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
    }
    console.log("Generated and verified transparent icons: 16, 32, 48, and 128 px.");
  } finally { await browser.close(); }
}
await main();
