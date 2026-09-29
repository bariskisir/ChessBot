/** Selects one site adapter from the current URL without inspecting opponent type. */
import { chesscom } from "./chesscom";
import { lichess } from "./lichess";
import type { Provider } from "./provider";

/** Chooses an adapter only for a supported HTTPS host. */
export function providerFor(url: URL): Provider | null {
  if (url.protocol !== "https:") return null;
  if (url.hostname === "chess.com" || url.hostname.endsWith(".chess.com")) return chesscom;
  if (url.hostname === "lichess.org" || url.hostname === "www.lichess.org") return lichess;
  return null;
}

/** Returns the adapter for the current page. */
export function currentProvider(): Provider | null { return providerFor(new URL(location.href)); }
