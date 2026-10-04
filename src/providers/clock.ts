/** Parses visible match clocks and keeps elapsed time flowing between display updates. */
export interface TimeControl { initialMs: number; incrementMs: number }
export interface GameClock extends TimeControl { remainingMs: number; running: boolean }

/** Accepts real clock displays while excluding dates, labels, and correspondence timers. */
export function parseClockMs(text: string): number | null {
  const value = text.replace(/[\s\u200e\u200f]/g, "").replace(/,/g, ".");
  if (!/^\d{1,3}(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(value)) return null;
  const parts = value.split(":").map(Number);
  if (parts.length > 1 && parts.slice(1).some(
    /** Rejects malformed minute and second fields. */
    (part) => part >= 60)) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return Math.round(seconds * 1000);
}

/** Accepts plus and pipe increment notation or an explicit minute-only control. */
export function parseTimeControl(text: string): TimeControl | null {
  const value = text.replace(/½/g, "0.5").replace(/¼/g, "0.25").replace(/¾/g, "0.75").replace(/,/g, ".");
  const match = /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:min(?:ute)?s?\s*)?[+|]\s*(\d+(?:\.\d+)?)/i.exec(value)
    ?? /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*min(?:ute)?s?\b/i.exec(value);
  if (!match) return null;
  const initialMs = Number(match[1]) * 60000, incrementMs = Number(match[2] ?? 0) * 1000;
  return initialMs > 0 && initialMs <= 86400000 && incrementMs <= 3600000 ? { initialMs, incrementMs } : null;
}

/** Restricts control discovery to site-owned metadata instead of unrelated page numbers. */
export function readTimeControl(selector: string): TimeControl | null {
  for (const element of document.querySelectorAll(selector)) {
    for (const value of [element.getAttribute("data-time-control"), element.getAttribute("title"), element.getAttribute("aria-label"), element.textContent]) {
      const control = value ? parseTimeControl(value) : null;
      if (control) return control;
    }
  }
  return null;
}

/** Tracks one player's clock and falls back conservatively when its control is unavailable. */
export class ClockReader {
  private observation: { element: Element; key: string; shownMs: number; updatedAt: number; initialMs: number; running: boolean } | null = null;
  /** Interpolates the displayed clock without resetting elapsed time on each poll. */
  read(element: Element | null, control: TimeControl | null, running: boolean, key: string, now = Date.now()): GameClock | null {
    if (!element) { this.observation = null; return null; }
    const shownMs = parseClockMs(element.textContent ?? "");
    if (shownMs === null) { this.observation = null; return null; }
    const previous = this.observation;
    if (!previous || previous.element !== element || previous.key !== key)
      this.observation = { element, key, shownMs, updatedAt: now, initialMs: control?.initialMs ?? shownMs, running };
    else if (shownMs !== previous.shownMs || running !== previous.running)
      this.observation = { ...previous, shownMs, updatedAt: now, running };
    const observation = this.observation!;
    return {
      remainingMs: Math.max(0, shownMs - (running ? Math.max(0, now - observation.updatedAt) : 0)),
      initialMs: control?.initialMs ?? observation.initialMs, incrementMs: control?.incrementMs ?? 0, running,
    };
  }
}
