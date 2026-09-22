/** Tests defensive settings and UCI score handling at engine boundaries. */
import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { DEFAULT_SETTINGS, normalizeSettings, parseInfo } from "../src/shared";

/** Rejects corrupt settings and keeps move animation opt-in for saved preferences. */
function settingsValidation(): void {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.depth, 7);
  assert.equal(DEFAULT_SETTINGS.autoPlayDelay, 2500);
  assert.equal(DEFAULT_SETTINGS.autoPlay, true);
  assert.equal(DEFAULT_SETTINGS.analyzeOpponent, false);
  assert.equal(DEFAULT_SETTINGS.autoNewMatch, true);
  assert.equal(DEFAULT_SETTINGS.mistakeProbability, 25);
  assert.equal(DEFAULT_SETTINGS.mistakeKeep, 2);
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

/** Preserves half-pawn keep choices and migrates the legacy threshold to the keep floor. */
function mistakeKeepFloor(): void {
  assert.equal(normalizeSettings({}).mistakeKeep, 2);
  for (let keep = 0; keep <= 5; keep += 0.5) assert.equal(normalizeSettings({ mistakeKeep: keep }).mistakeKeep, keep);
  for (const keep of [NaN, Infinity, "2", null]) assert.equal(normalizeSettings({ mistakeKeep: keep }).mistakeKeep, 2);
  assert.equal(normalizeSettings({ mistakeKeep: -1 }).mistakeKeep, 0);
  assert.equal(normalizeSettings({ mistakeKeep: 6 }).mistakeKeep, 5);
  assert.equal(normalizeSettings({ mistakeKeep: 1.7 }).mistakeKeep, 1.5);
  assert.equal(normalizeSettings({ mistakeThreshold: 3 }).mistakeKeep, 3);
}
test("mistake keep-eval retains half-pawn steps and migrates the legacy threshold", mistakeKeepFloor);

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
