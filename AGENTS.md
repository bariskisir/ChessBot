# AGENTS.md

Guidance for AI coding agents working in this repository. Read this before changing code.

## What this project is

ChessBot is a **Chrome Manifest V3 extension** that adds a floating analysis panel to
**Chess.com and Lichess**. The panel analyses the current board with selectable **local Stockfish and Lozza engines**
and can optionally play moves and start follow-up games automatically.

- Version: `2.10.0` (see `package.json` and `public/manifest.json`).
- Engines are **100% local**. Lozza 2 is the default; the advanced settings menu lists
  Lozza 2, Lozza 5, Stockfish 10 and Stockfish 19 Lite by increasing reference Elo.
  There is no remote engine, no API key, and no network calls for analysis.
- The overlay behaves the **same regardless of opponent type** (computer bot or human).
  Do **not** reintroduce route/path gating such as `/play/(computer|bots)` checks.
- Stack: React 19 + TypeScript + SCSS (compiled to text and injected into a shadow root),
  bundled with esbuild, tested with `node:test` and Playwright.
- Styling lives only in `src/styles/` modules (`index.scss` for the shadow-root panel,
  `board.scss` for page-world highlight squares injected once by `content.ts`).
  TS/TSX files declare no presentation: dynamic values reach SCSS only as `data-*`
  attributes or `--bot-*` CSS variables.

## Commands

```sh
npm ci                 # install dependencies (Node.js 22+)
npm run check          # tsc --noEmit  +  scripts/check-comments.ts
npm test               # unit tests: tsx --test tests/*.test.ts
npm run test:browser   # Playwright: loads the real unpacked dist/ extension
npm run build          # builds dist/ (esbuild + sass + public assets + vendor)
npm run icons          # regenerates public/icons/icon-*.png from icon.svg
```

`npm run check` must pass before any change is considered done. If you add or edit a
function, update its documentation comment as described below.

Pushing a `v*` tag (matching `public/manifest.json`) triggers `.github/workflows/release.yml`,
which runs check, unit tests, and build, then attaches `dist.zip` (the `dist/` folder) to the
release — the same asset layout as previous releases.

To use the extension manually: `npm run build`, open `chrome://extensions`, enable
Developer mode, **Load unpacked**, select `dist/`, then refresh a Chess.com or Lichess tab.

## Architecture

Four browser entry points are bundled into `dist/`:

| Source | Output | Role |
| --- | --- | --- |
| `src/background.ts` | `background.js` | MV3 service worker. Routes document-scoped engine requests to the offscreen document and sends trusted input to Lichess through the debugger API. |
| `src/engine.ts` | `offscreen.js` | Runs inside the offscreen document. Owns the selected engine worker, a job queue, per-owner cancellation, startup and no-progress watchdogs, depth limits, MultiPV, and version-specific UCI identity verification. |
| `src/lozza-worker.ts` | `lozza-worker.js` | Adapts the pinned Lozza sources to MultiPV, coordinate moves and normalized UCI mate scores. |
| `src/content.ts` | `content.js` | Isolated world. Calls `mount()`. |

Content/UI flow (isolated world):

- `src/content.ts` → `src/mount.tsx` (creates an id-free shadow host) →
  `src/app.tsx` (React panel) → `src/controller.ts` (behaviour).
- `src/engine-client.ts` talks to `background` via `chrome.runtime.sendMessage`
  (`analyzePosition`, `stopAnalysis`, and an abortable `delay`).
- `src/shared.ts` holds protocol/types, `DEFAULT_SETTINGS`, `normalizeSettings`, and
  `parseInfo` (UCI → Variation, scores normalised to White).
- `src/engines.ts` holds the fixed local worker catalogue, version identities, reference
  ratings, verification depths, and the fixed Stockfish 19 Lite evaluation engine.
  Worker URLs must never come from persisted settings.
- `src/storage.ts` persists `Settings` in `chrome.storage.local` and migrates the
  legacy `bot-settings` localStorage entry on first load.
- `src/providers/` contains the provider contract, host selection, shared FEN utilities,
  and separate board, input, and follow-up implementations. Lichess mode detection and
  coordinates live in `lichess-dom.ts`; `lichess-board.ts` reconstructs standard rounds
  and training from SAN and follows known positions when round history is hidden.
  Racer and Storm use visible last-move markers and legal continuations, with estimated
  FEN state when a new puzzle omits its history.
- `src/move-analysis.ts` combines selected-engine moves with Stockfish 19 Lite evaluation,
  average selection, and mistake settings.
  `src/move-execution.ts` owns input confirmation and three retries at one-second intervals;
  each retry performs fresh analysis using the complete selection policy.
- `src/input-protocol.ts`, `src/input-client.ts`, and `src/trusted-input.ts` share typed
  trusted gestures, propagate cancellation, and serialize debugger access per tab.
- `src/board.ts` and `src/automation.ts` delegate common operations to the selected provider.
- `src/followup-session.ts` carries a one-use Lichess follow-up marker through same-tab
  navigation so an automatically started round resumes the running controller.
- `src/providers/chesscom-arena.ts` retries arena matchmaking three times at three-second
  intervals before selecting another started, joinable standard arena of the same time class
  with the greatest remaining duration. Unknown classes default to blitz. Tournament lookup
  uses fixed Chess.com service URLs; native Join/Next Game controls own registration and queueing.
  `src/tournament-session.ts` preserves continuation and game-scoped public arena metadata
  across navigation. STOP clears continuation; active queues never trigger another tournament.
- Chess.com sends synthetic drags. Lichess Chessground rejects untrusted input, so Lichess
  Auto Play sends short trusted drags through `chrome.debugger` and requires its permission.
- `src/mistake-mode.ts` picks the weakest alternative that keeps eval above the keep floor.
- `src/move-selection.ts` prioritizes the shortest winning mate, otherwise picking a
  non-losing average-quality move from the engine's MultiPV list when `averageMove` is enabled.

Key behaviour in `src/controller.ts`:

- A mutation observer tracks board/history/clock changes and coalesces checks into
  animation frames; a 300ms `poll()` remains as a fallback. New positions must settle
  across checks, and recorded history must agree with the visible pieces.
- The selected engine stays alive between searches. Stockfish cancellation drains output
  through `bestmove`; Lozza's synchronous searches are canceled by terminating the worker.
  The host retains at most two verified workers: Stockfish 19 for evaluation and the
  selected move engine. Evaluation/move switches reuse them after output is consumed;
  selecting another move engine discards the old alternative before the next job.
- Move confirmation observes board changes independently of input acknowledgements.
  Input expires after 3 seconds; acknowledged input has a 700ms confirmation deadline.
  STOP or expiry aborts the provider gesture and its pending trusted-input request.
- A single `AbortController` (`operation`) is replaced by `cancel()`; STOP, new
  settings, new positions, and game-over actions all cancel pending work.
- One `pendingAction` union distinguishes move input, promotion recovery, and follow-up
  actions; a `WeakSet` of handled buttons prevents repeat clicks and replayed actions.
  Arena results also use the page and position to retain their three-attempt limit when
  the site replaces the button. Auto New Match/Tournament also controls arena tournament continuation;
  disabling it cancels retries and clears pending arena navigation.
- Analysis and Auto Play only run on the player's turn; opponent positions issue no
  engine requests and display no suggested move.
- Searches use depth limits. Timed Auto Play can use the best available legal move when
  its complete turn budget expires; analysis without a clock still requires the selected depth.
- Dynamic Delay defaults on and distributes live match time over an increment-aware,
  rolling 50-move forecast. Settling, queued searches, and all verification share one turn
  target. Its toggle sits beside Auto Play; disabling it reveals Random Delay on the next row.
  Manual random targets also deduct elapsed work. Each player's first game move skips
  Dynamic and Random Delay. Untimed dynamic games add no waiting.
- In Lichess training, failed feedback opens the solution and then clicks Continue
  training only while Auto Play is enabled; correct feedback never triggers it.
- Displayed position evaluation and average/mistake verification always use Stockfish 19
  Lite at a minimum requested depth of 15, or the selected depth when higher. The selected
  engine supplies move candidates. Timed turns start with a Stockfish evaluation bounded
  to a quarter of the remaining budget and at most one second; untimed turns reuse an
  adequate Stockfish 19 main search or evaluate separately before other main searches.
  Evaluation is published immediately and retained in timed fallbacks; a shallower main
  search cannot replace a deeper evaluation. Unsearched emergency scores cannot replace
  the bar with zero. An unavailable score displays `---`.
  Incomplete post-move verification cannot authorize an intentional mistake. Timed
  fallback moves never publish another engine's score. Proved mates and sole legal moves
  can finish early.
- Average Move follows the shortest winning mate found in MultiPV or deep evaluation,
  bypassing average selection and intentional mistakes. Otherwise, average candidates
  are verified with Stockfish 19 Lite in rank order and must stay at or above zero.
- `src/timing/match-selection.ts` disables averaging after the player's clock falls below
  five seconds, retaining Best Move for that match through increments, retries, settings,
  and STOP/START. New game routes, confirmed follow-ups, and fresh opening clocks restore
  the saved preference. Active average searches are canceled; gestures already sent retain
  their confirmation deadline and subsequent retries use the live match policy.

## Build details

`scripts/build.ts` bundles each entry as IIFE for `chrome120`, `minify: false`,
inline legal comments, source maps, and an SCSS esbuild plugin that compiles `.scss`
to compressed CSS text (never page-global CSS). It wipes and recreates `dist/`, copies
`public/*` and `public/vendor/*`.

- **Never edit `dist/`** — it is generated and deleted on every build.
- Treat `public/vendor/stockfish.js`, `public/vendor/stockfish.wasm`, and `public/vendor/STOCKFISH-LICENSE.txt` as generated output copied unchanged from the pinned `stockfish` npm package by `scripts/prepare-vendor.ts`; change the package version instead of editing them.
- `public/vendor/stockfish-10/` is generated from the pinned `stockfish-10` npm alias.
  Lozza 2 and 5 sources are vendored unchanged at the commits documented in README.md;
  compatibility code belongs in `src/lozza-worker.ts`.
- Third-party license texts live only beside their engines under `public/vendor/`.

## Code conventions

These are enforced by `scripts/check-comments.ts` and `tsc`:

1. **Every authored `.ts`/`.tsx` file under `src/`, `scripts/`, and `tests/` must start
   with a `/** ... */` English file comment.**
2. **Every function implementation must have a documentation comment** (a `/** ... */`
   or `//` comment immediately above it, or above/on its containing declaration).
   This includes arrow functions, methods, constructors, getters, and setters.
   Add the comment when you add the function, or `npm run check` fails.
3. TypeScript is strict with `noUncheckedIndexedAccess` and
   `exactOptionalPropertyTypes`; avoid non-null assertions unless already justified.
4. Keep identifiers and comments in **English**.
5. Prefer arrow functions assigned to class fields for methods that are passed as
   callbacks (see `controller.ts` `start`, `stop`, etc.) so `this` stays bound.
6. **Do not describe this project as a rebuild of, or a copy of, any earlier
   version.** Do not reference a previous release in code, comments, or docs.
   Describe current behaviour directly.
7. Match the existing terse, intent-explaining comment style; comments should explain
   *why*, not restate the code.

## Testing

- Unit tests live in `tests/*.test.ts` and run with `node:test` via `tsx`.
- `scripts/browser-test.ts` (Playwright) builds a fixture, intercepts
  `https://www.chess.com/play/computer` and serves `tests/board-fixture.ts`, then loads
  the real unpacked `dist/` extension. It verifies panel controls, evaluation updates,
  highlights, real auto-play clicks, STOP cancellation, promotions, rematch/new-match
  precedence, persisted settings, dragging, offline operation, and tab isolation.
- The fixture exposes `window.chessbotFixture` (`setFen`, `gameOver`, counters,
  `openPromotion`, `configurePromotion`). Its presentation lives in
  `tests/board-fixture.css`. Extend it when adding browser coverage.
- Intercepted Lichess fixtures verify round and training board reading, both
  orientations, trusted input, partial history, and follow-up controls through
  `scripts/lichess-browser-test.ts`.
- `scripts/tournament-browser-test.ts` intercepts all Chess.com requests to verify arena
  retry spacing, time-class and remaining-duration selection, navigation continuation,
  disabled settings, active queue handling, missing metadata, and STOP cancellation.
- `scripts/engine-browser-test.ts` verifies every real bundled worker's identity, legal
  White/Black analysis, MultiPV, promotions, mates and deadlines, plus persisted engine
  selection and Auto Play through the real offscreen host.
- The suite must not touch a signed-in live game.
- No screenshot/artifact files are produced anymore; do not add new ones.

## Dependency / asset policy

- Runtime deps: `chess.js`, `react`, `react-dom`, plus pinned `stockfish` and `stockfish-10` npm engine sources. Do not add libraries without a
  clear need; this project intentionally has no UI framework beyond React and no CSS
  framework.
- Keep the engine local-only and the extension free of remote code.
- ChessBot application code is MIT (`LICENSE`); Stockfish and the pinned Lozza sources are GPL-3.0.

