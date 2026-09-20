/** Tests defensive settings and UCI score handling at engine boundaries. */
import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { DEFAULT_SETTINGS, normalizeSettings, parseInfo } from "../src/shared";

/** Rejects corrupt settings and keeps move animation opt-in for saved preferences. */
function settingsValidation(): void {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.depth, 10);
  assert.equal(DEFAULT_SETTINGS.autoPlayDelay, 300);
  assert.equal(DEFAULT_SETTINGS.autoPlay, true);
  assert.equal(DEFAULT_SETTINGS.analyzeOpponent, false);
  assert.equal(DEFAULT_SETTINGS.autoNewMatch, true);
  assert.equal(DEFAULT_SETTINGS.mistakeProbability, 20);
  assert.equal(DEFAULT_SETTINGS.lines, 10);
  assert.equal(DEFAULT_SETTINGS.averageMove, true);
  assert.equal(DEFAULT_SETTINGS.animateMoves, false);
  assert.equal(normalizeSettings({ animateMoves: true }).animateMoves, true);
  assert.equal(normalizeSettings({ animateMoves: "true" }).animateMoves, false);
  assert.deepEqual(normalizeSettings({ depth: Infinity, time: -2, lines: 99, autoPlayDelay: NaN, autoPlay: "true", engineType: "api" }), { ...DEFAULT_SETTINGS, lines: 10 });
  assert.equal(normalizeSettings({ lines: -3 }).lines, 1);
  const restored = normalizeSettings({ autoPlay: false, autoNewMatch: true, autoRematch: true, autoPlayDelay: 10000, mistakeProbability: 90, panelPos: { top: "82px", left: "330px" } });
  assert.equal(restored.autoPlay, false);
  assert.equal(restored.autoNewMatch, true);
  assert.equal(restored.autoRematch, true);
  assert.equal(restored.autoPlayDelay, 10000);
  assert.equal(restored.mistakeProbability, 90);
  assert.deepEqual(restored.panelPos, { top: "82px", left: "330px" });
}
test("settings reject corrupt values and remove legacy engine selection", settingsValidation);

/** Preserves half-pawn choices and migrates missing or invalid thresholds to the default. */
function mistakeThresholds(): void {
  assert.equal(normalizeSettings({}).mistakeThreshold, 1.5);
  for (let threshold = 0; threshold <= 4; threshold += 0.5) assert.equal(normalizeSettings({ mistakeThreshold: threshold }).mistakeThreshold, threshold);
  for (const threshold of [NaN, Infinity, "2", null]) assert.equal(normalizeSettings({ mistakeThreshold: threshold }).mistakeThreshold, 1.5);
  assert.equal(normalizeSettings({ mistakeThreshold: -1 }).mistakeThreshold, 0);
  assert.equal(normalizeSettings({ mistakeThreshold: 5 }).mistakeThreshold, 4);
  assert.equal(normalizeSettings({ mistakeThreshold: 1.7 }).mistakeThreshold, 1.5);
}
test("mistake thresholds retain half-pawn steps and reject invalid preferences", mistakeThresholds);

/** Confirms centipawn and mate scores remain White-relative on Black's turn. */
function scores(): void {
  const game = new Chess();
  game.move("e4");
  const parsed = parseInfo("info depth 15 multipv 2 score cp 75 nodes 42000 pv e7e5 g1f3", game.fen());
  assert.equal(parsed?.variation.score, -0.75);
  assert.equal(parsed?.index, 1);
  assert.equal(parsed?.variation.nodes, 42000);
  assert.deepEqual(parsed?.variation.moves, ["e7e5", "g1f3"]);
  assert.equal(parseInfo("info depth 20 score mate -3 pv e7e5", game.fen())?.variation.mate, 3);
}
test("UCI scores and mates are normalized to White", scores);

/** Rejects partial or bound-only evaluations that are not exact principal variations. */
function partialLines(): void {
  assert.equal(parseInfo("info depth 1 nodes 12", new Chess().fen()), null);
  assert.equal(parseInfo("info score cp 100 lowerbound pv e2e4", new Chess().fen()), null);
}
test("partial and bounded UCI output does not replace an exact line", partialLines);
