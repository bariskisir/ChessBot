/** Connects Lichess board, trusted-input, and follow-up operations to the provider contract. */
import * as board from "./lichess-board";
import * as input from "./lichess-input";
import { findGameAction } from "./lichess-automation";
import { readClock } from "./lichess-clock";
import type { Provider } from "./provider";

export const lichess: Provider = {
  name: "lichess.org",
  mutationSelector: ".round__app, .game__meta, .puzzle-play, .racer-app, .storm-app",
  resumeAfterNavigation: true,
  ...board,
  ...input,
  readClock,
  findGameAction,
};
