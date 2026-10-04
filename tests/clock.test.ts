/** Verifies clock parsing and interpolation independently of chess-site page markup. */
import assert from "node:assert/strict";
import test from "node:test";
import { ClockReader, parseClockMs, parseTimeControl } from "../src/providers/clock";

/** Accepts ordinary, hour, and fractional clocks while rejecting unrelated labels. */
function clockFormats(): void {
  assert.equal(parseClockMs("3:02"), 182000);
  assert.equal(parseClockMs("00:09.7"), 9700);
  assert.equal(parseClockMs("1:02:03"), 3723000);
  assert.equal(parseClockMs("0:00,25"), 250);
  assert.equal(parseClockMs("9.4"), 9400);
  for (const value of ["", "Unlimited", "3 days", "1:62", "25:99:00", "-3", "NaN"]) assert.equal(parseClockMs(value), null);
  assert.deepEqual(parseTimeControl("Blitz • 5+3"), { initialMs: 300000, incrementMs: 3000 });
  assert.deepEqual(parseTimeControl("2 + 1"), { initialMs: 120000, incrementMs: 1000 });
  assert.deepEqual(parseTimeControl("5 | 3"), { initialMs: 300000, incrementMs: 3000 });
  assert.deepEqual(parseTimeControl("3 min"), { initialMs: 180000, incrementMs: 0 });
  assert.deepEqual(parseTimeControl("0,5 + 2"), { initialMs: 30000, incrementMs: 2000 });
  assert.deepEqual(parseTimeControl("½+0"), { initialMs: 30000, incrementMs: 0 });
  assert.equal(parseTimeControl("3:02"), null);
  assert.equal(parseTimeControl("Unlimited"), null);
}
test("clock and time-control formats stay distinct", clockFormats);

/** Keeps time decreasing between DOM updates and resets it on authoritative corrections. */
function clockInterpolation(): void {
  const reader = new ClockReader();
  const element = { textContent: "3:00" } as Element;
  const control = { initialMs: 180000, incrementMs: 2000 };
  assert.equal(reader.read(element, control, true, "game:w", 0)?.remainingMs, 180000);
  assert.equal(reader.read(element, control, true, "game:w", 800)?.remainingMs, 179200);
  element.textContent = "2:59";
  assert.equal(reader.read(element, control, true, "game:w", 1000)?.remainingMs, 179000);
  assert.equal(reader.read(element, control, true, "game:w", 1500)?.remainingMs, 178500);
  assert.equal(reader.read(element, control, false, "game:w", 1700)?.remainingMs, 179000);
  assert.equal(reader.read(element, control, false, "game:w", 3000)?.remainingMs, 179000);
  element.textContent = "0:02.0";
  assert.equal(reader.read(element, control, true, "game:w", 4000)?.remainingMs, 2000);
  assert.equal(reader.read(element, control, true, "game:w", 7000)?.remainingMs, 0);
  assert.equal(reader.read(null, control, true, "game:w", 7100), null);
}
test("live clocks interpolate, pause, correct and clamp without restarting on every poll", clockInterpolation);
