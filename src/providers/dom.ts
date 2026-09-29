/** Shares visibility checks for provider-owned controls. */

/** Ignores hidden or disabled controls before scheduling an automatic action. */
export function isShown(element: HTMLElement): boolean {
  return !!element.getClientRects().length && !element.hasAttribute("disabled") &&
    !(element instanceof HTMLButtonElement && element.disabled) &&
    getComputedStyle(element).visibility !== "hidden";
}

/** Finds the first actionable control without assuming the first DOM match is visible. */
export function visible(selector: string, root: ParentNode = document): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>(selector)) if (isShown(element)) return element;
  return null;
}
