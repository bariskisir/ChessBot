# AGENTS.md

Guidance for AI coding agents working in this repository. Read this before changing code.

## What this project is

ChessBot is a **Chrome Manifest V3 extension** that adds a floating analysis panel to
**Chess.com and Lichess**. The panel analyses the current board with a **local Stockfish 19 WASM**
engine and can optionally play moves and start follow-up games automatically.

- Version: `2.8.0` (see `package.json` and `public/manifest.json`).
- Engine is **100% local**. There is no remote engine, no API key, no engine selector,
  and no network calls for analysis.
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

Three browser entry points are bundled into `dist/`:

| Source | Output | Role |
| --- | --- | --- |
| `src/background.ts` | `background.js` | MV3 service worker. Routes document-scoped engine requests to the offscreen document and sends trusted input to Lichess through the debugger API. |
| `src/engine.ts` | `offscreen.js` | Runs inside the offscreen document. Owns the Stockfish worker, a job queue, per-owner cancellation, startup and no-progress watchdogs, depth limits, MultiPV, and UCI identity verification (`id name Stockfish 19`). |
| `src/content.ts` | `content.js` | Isolated world. Calls `mount()`. |

Content/UI flow (isolated world):

- `src/content.ts` → `src/mount.tsx` (creates an id-free shadow host) →
  `src/app.tsx` (React panel) → `src/controller.ts` (behaviour).
- `src/engine-client.ts` talks to `background` via `chrome.runtime.sendMessage`
  (`analyzePosition`, `stopAnalysis`, and an abortable `delay`).
- `src/shared.ts` holds protocol/types, `DEFAULT_SETTINGS`, `normalizeSettings`, and
  `parseInfo` (UCI → Variation, scores normalised to White).
- `src/storage.ts` persists `Settings` in `chrome.storage.local` and migrates the
  legacy `bot-settings` localStorage entry on first load.
- `src/providers/` contains the provider contract, host selection, shared FEN utilities,
  and separate board, input, and follow-up implementations. Lichess mode detection and
  coordinates live in `lichess-dom.ts`; `lichess-board.ts` reconstructs standard rounds
  and training from SAN and follows known positions when round history is hidden.
  Racer and Storm use visible last-move markers and legal continuations, with estimated
  FEN state when a new puzzle omits its history.
- `src/move-analysis.ts` applies deep evaluation, average selection, and mistake settings.
  `src/move-execution.ts` owns input confirmation and three retries at one-second intervals;
  each retry performs fresh analysis using the complete selection policy.
- `src/input-protocol.ts`, `src/input-client.ts`, and `src/trusted-input.ts` share typed
  trusted gestures, propagate cancellation, and serialize debugger access per tab.
- `src/board.ts` and `src/automation.ts` delegate common operations to the selected provider.
- `src/followup-session.ts` carries a one-use Lichess follow-up marker through same-tab
  navigation so an automatically started round resumes the running controller.
- Chess.com sends synthetic drags. Lichess Chessground rejects untrusted input, so Lichess
  Auto Play sends short trusted drags through `chrome.debugger` and requires its permission.
- `src/mistake-mode.ts` picks the weakest alternative that keeps eval above the keep floor.
- `src/move-selection.ts` prioritizes the shortest winning mate, otherwise picking a
  non-losing average-quality move from the engine's MultiPV list when `averageMove` is enabled.

Key behaviour in `src/controller.ts`:

- A mutation observer tracks board/history/clock changes and coalesces checks into
  animation frames; a 300ms `poll()` remains as a fallback. New positions must settle
  across checks, and recorded history must agree with the visible pieces.
- Stockfish stays alive between searches. Cancellation drains output through
  `bestmove` before another search starts; stuck or failed workers are replaced.
- Move confirmation observes board changes independently of input acknowledgements.
  Input expires after 3 seconds; acknowledged input has a 700ms confirmation deadline.
  STOP or expiry aborts the provider gesture and its pending trusted-input request.
- A single `AbortController` (`operation`) is replaced by `cancel()`; STOP, new
  settings, new positions, and game-over actions all cancel pending work.
- One `pendingAction` union distinguishes move input, promotion recovery, and follow-up
  actions; a `WeakSet` of handled buttons prevents repeat clicks and replayed actions.
- Analysis and Auto Play only run on the player's turn; opponent positions issue no
  engine requests and display no suggested move.
- Searches use depth limits. Timed Auto Play can use the best available legal move when
  its complete turn budget expires; analysis without a clock still requires the selected depth.
- Dynamic Delay defaults on and distributes live match time over an increment-aware,
  rolling 40-move forecast. Settling, queued searches, and all verification share one turn
  target. Its toggle sits beside Auto Play; disabling it reveals Random Delay on the next row.
  Manual random targets also deduct elapsed work. Untimed dynamic games add no waiting.
- In Lichess training, failed feedback opens the solution and then clicks Continue
  training only while Auto Play is enabled; correct feedback never triggers it.
- Best Move with mistakes disabled uses the main search's evaluation at any selected depth.
  Average or mistake selection at depths below 15 uses an additional depth-15 evaluation.
- Average Move follows the shortest winning mate found in MultiPV or deep evaluation,
  bypassing average selection and intentional mistakes. Otherwise, average candidates
  are verified at `max(15, settings.depth)` in rank order and must stay at or above zero.

## Build details

`scripts/build.ts` bundles each entry as IIFE for `chrome120`, `minify: false`,
inline legal comments, source maps, and an SCSS esbuild plugin that compiles `.scss`
to compressed CSS text (never page-global CSS). It wipes and recreates `dist/`, copies
`public/*` and `public/vendor/*`.

- **Never edit `dist/`** — it is generated and deleted on every build.
- Treat `public/vendor/stockfish.js`, `public/vendor/stockfish.wasm`, and `public/vendor/STOCKFISH-LICENSE.txt` as generated output copied unchanged from the pinned `stockfish` npm package by `scripts/prepare-vendor.ts`; change the package version instead of editing them.
- Third-party license text lives only in `public/vendor/STOCKFISH-LICENSE.txt`.

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
- The suite must not touch a signed-in live game.
- No screenshot/artifact files are produced anymore; do not add new ones.

## Dependency / asset policy

- Runtime deps: `chess.js`, `react`, `react-dom`, plus the pinned `stockfish` npm package as the local-only engine source. Do not add libraries without a
  clear need; this project intentionally has no UI framework beyond React and no CSS
  framework.
- Keep the engine local-only and the extension free of remote code.
- ChessBot application code is MIT (`LICENSE`); Stockfish remains GPL-3.0.

