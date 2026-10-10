/** Tests the public OpenRouter catalogue helpers and the persisted model selection. */
import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/shared";
import { buildOpenRouterDecision } from "../src/jev";
import { dedupeOpenRouterModels, isCatalogFresh, OPENROUTER_CATALOG_TTL_MS, selectDecisionModels, toOpenRouterModel } from "../src/openrouter-catalog";

/** Prefers slugs, falls back to ids and names, and rejects anonymous entries. */
function modelMapping(): void {
  assert.deepEqual(toOpenRouterModel({ slug: "openai/gpt-4o", id: "stale", name: "GPT-4o" }), { id: "openai/gpt-4o", name: "GPT-4o" });
  assert.deepEqual(toOpenRouterModel({ id: "x/y", name: "" }), { id: "x/y", name: "x/y" });
  assert.equal(toOpenRouterModel({ name: "Nameless" }), null);
  assert.equal(toOpenRouterModel({}), null);
}
test("catalogue entries map slugs and names into dropdown models", modelMapping);

/** Keeps only decision-capable entries, removes duplicates, and sorts by name. */
function decisionFilter(): void {
  const models = selectDecisionModels({ data: [
    { slug: "b/model", name: "Beta", output_modalities: ["decisions"] },
    { slug: "a/model", name: "Alpha", output_modalities: ["decisions", "text"] },
    { slug: "a/model", name: "Alpha Duplicate", output_modalities: ["decisions"] },
    { slug: "c/model", name: "Chat Only", output_modalities: ["text"] },
    { name: "Anonymous", output_modalities: ["decisions"] },
  ] });
  assert.deepEqual(models.map(
    /** Collects dropdown identifiers in display order. */
    (model) => model.id), ["a/model", "b/model"]);
  assert.equal(models[0]!.name, "Alpha");
  assert.deepEqual(selectDecisionModels({}), []);
  assert.deepEqual(selectDecisionModels({ data: "nope" }), []);
}
test("only decision-capable catalogue entries reach the dropdown", decisionFilter);

/** Drops repeated slugs while keeping the first occurrence. */
function modelDedupe(): void {
  assert.deepEqual(dedupeOpenRouterModels([
    { id: "a/x", name: "X" }, { id: "a/x", name: "X again" }, { id: "b/y", name: "Y" },
  ]), [{ id: "a/x", name: "X" }, { id: "b/y", name: "Y" }]);
}
test("duplicate catalogue slugs collapse into one dropdown entry", modelDedupe);

/** Accepts fresh timestamps and rejects missing or expired ones at the TTL boundary. */
function cacheFreshness(): void {
  const now = 1_000_000;
  assert.equal(isCatalogFresh(now, now), true);
  assert.equal(isCatalogFresh(now - OPENROUTER_CATALOG_TTL_MS, now), true);
  assert.equal(isCatalogFresh(now - OPENROUTER_CATALOG_TTL_MS - 1, now), false);
  assert.equal(isCatalogFresh(Number.NaN, now), false);
  assert.equal(isCatalogFresh("yesterday", now), false);
}
test("catalogue freshness follows the five-minute cache window", cacheFreshness);

/** Persists any catalogue slug on the single OpenRouter engine without hardcoded models. */
function providerSettings(): void {
  assert.equal(DEFAULT_SETTINGS.engine, "stockfish-18");
  assert.equal(DEFAULT_SETTINGS.openrouterModel, "");
  assert.equal(normalizeSettings({ engine: "openrouter" }).engine, "openrouter");
  assert.equal(normalizeSettings({ engine: "openrouter", openrouterModel: "openai/gpt-4o" }).openrouterModel, "openai/gpt-4o");
  assert.equal(normalizeSettings({ engine: "openrouter", openrouterModel: "  x/y:latest  " }).openrouterModel, "x/y:latest");
  for (const junk of ["", "   ", "has space", "semi;colon", "../escape", "x".repeat(201), null, 42]) {
    assert.equal(normalizeSettings({ openrouterModel: junk }).openrouterModel, "");
  }
  assert.equal(normalizeSettings({ engine: "openrouter-jev" }).engine, "stockfish-18");
  assert.equal(normalizeSettings({ engine: "openrouter-luna" }).engine, "stockfish-18");
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  const body = buildOpenRouterDecision("example/dynamic-model", new Chess().fen());
  assert.equal(body.model, "example/dynamic-model");
  assert.equal(Object.keys(body.questions.move.criteria).length, 20);
}
test("settings keep any catalogue model on the single OpenRouter engine", providerSettings);
