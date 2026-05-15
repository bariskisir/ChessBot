/**
 * Provides DOM helpers shared by the content script modules.
 */

/**
 * Returns an element by id with a precise TypeScript type.
 */
export function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/**
 * Returns an element by selector with a precise TypeScript type.
 */
export function qs<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector(selector) as T | null;
}

/**
 * Returns every element matching a selector with a precise TypeScript type.
 */
export function qsa<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll(selector)) as T[];
}

/**
 * Parses an input value as an integer with a fallback.
 */
export function readIntegerInput(input: HTMLInputElement, fallback: number): number {
  const parsed = Number.parseInt(input.value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Updates text content when the element exists.
 */
export function setText(id: string, value: string | number): void {
  const element = byId<HTMLElement>(id);

  if (element) {
    element.innerText = String(value);
  }
}
