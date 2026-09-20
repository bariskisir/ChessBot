# AGENTS.md

Guidance for AI coding agents working in this repository. Read this before changing code.

## What this project is

ChessBot is a **Chrome Manifest V3 extension** that adds a floating analysis panel to
**Chess.com**. The panel analyses the current board with a **local Stockfish 18 WASM**
engine and can optionally play moves and start follow-up games automatically.

- Version: `2.1.0` (see `package.json` and `public/manifest.json`).
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
Developer mode, **Load unpacked**, select `dist/`, then refresh a Chess.com tab.

## Architecture

Three browser entry points are bundled into `dist/`:

| Source | Output | Role |
| --- | --- | --- |
| `src/background.ts` | `background.js` | MV3 service worker. Ensures the offscreen document exists and routes document-scoped engine requests to it, tagging each request with a per-tab `owner`. |
| `src/engine.ts` | `offscreen.js` | Runs inside the offscreen document. Owns the Stockfish worker, a job queue, per-owner cancellation, a 20s watchdog, depth/movetime limits, MultiPV, and UCI identity verification (`id name Stockfish 18`). |
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
- `src/board.ts` reads/serialises the position from visible markup only (no page-world
  helpers or marker attributes), validates legality, highlights moves with generic
  selectors, drags pieces along jittered paths with human pacing, and handles promotions.
- `src/automation.ts` finds game-over New Game / Rematch controls.
- `src/mistake-mode.ts` picks safe non-losing "mistake" candidates.
- `src/move-selection.ts` picks a non-losing average-quality move from the engine's
  MultiPV list when `averageMove` is enabled.

Key behaviour in `src/controller.ts`:

- A 300ms `poll()` tracks FEN/orientation and drives a small state machine.
- A single `AbortController` (`operation`) is replaced by `cancel()`; STOP, new
  settings, new positions, and game-over actions all cancel pending work.
- `executing`/`gameAction` flags plus a `WeakSet` of handled buttons prevent repeat
  clicks and replayed actions.
- Auto Play only plays the player's own moves; opponent suggestions are shown when
  `analyzeOpponent` is enabled.

## Build details

`scripts/build.ts` bundles each entry as IIFE for `chrome120`, `minify: false`,
inline legal comments, source maps, and an SCSS esbuild plugin that compiles `.scss`
to compressed CSS text (never page-global CSS). It wipes and recreates `dist/`, copies
`public/*` and `public/vendor/*`.

- **Never edit `dist/`** — it is generated and deleted on every build.
- **Never edit `public/vendor/*`** — unmodified upstream Stockfish assets and license.
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
- The suite must not touch a signed-in live game.
- No screenshot/artifact files are produced anymore; do not add new ones.

## Dependency / asset policy

- Runtime deps: `chess.js`, `react`, `react-dom` only. Do not add libraries without a
  clear need; this project intentionally has no UI framework beyond React and no CSS
  framework.
- Keep the engine local-only and the extension free of remote code.
- ChessBot application code is MIT (`LICENSE`); Stockfish remains GPL-3.0.

## Scope and ethics

This tool is for education and engine-vs-bot observation. It works on any Chess.com
game, but using engine assistance against human players in competitive play violates
Chess.com's Terms of Service. Keep the fair-play notice in `README.md` accurate.
