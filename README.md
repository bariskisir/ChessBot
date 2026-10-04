# ChessBot

![ChessBot Demo](gameplay.gif)

ChessBot is a Chrome extension for **Chess.com** and **Lichess**. It shows local Stockfish analysis beside supported game boards.

## 🚀 Purpose & Vision

The primary goal of this extension is **education through observation**.

*   **Engine vs. Bot Matchups**: It is built to simulate matches between different engines and Chess.com's computer personalities (bots).
*   **Learning Tool**: By watching how high-level engines (like Stockfish 19) navigate complex positions against AI, players can improve their tactical awareness and positional understanding.

> [!WARNING]
> **STRICT FAIR PLAY POLICY**
> This application is strictly for educational purposes. **DO NOT use it to gain an unfair advantage against human players.** Chess.com prohibits engine assistance in competitive play. [Lichess Fair Play](https://lichess.org/page/fair-play) prohibits engine help during human games and programmatic GUI moves even against its AI; use the Lichess features only where its rules permit them.

## ✨ Key Features

*   **Local Stockfish 19**: Runs entirely in your browser via WASM. There is no remote engine or API configuration, and all calculations stay on your device.
*   **Real-time Evaluation Bar**: A dynamic, responsive eval bar that shows the advantage from the current player's perspective.
*   **Auto Play Mode**: Automatically execute engine moves with dynamic clock allocation, or a customizable random delay.
*   **Auto New Match & Auto Rematch**: Detect game over and start the next game automatically, with 2.5-second delays. On Lichess, an automated follow-up keeps the bot running after navigation to the new round.
*   **Mistake Mode**: With the configured probability, play the weakest engine alternative that still keeps your advantage above **KEEP EVAL**. Keep defaults to 2 pawns and is adjustable from 0 to 5 in 0.5 steps beside Mistake. At 0% mistakes are disabled. If no alternative stays above the floor, or you are already below it, keep the normal selection.
*   **Smooth UI**: A modern, draggable overlay panel that stays out of your way and remembers its position.
*   **Customizable Depth**: Adjust analysis depth from 1 to 30 to balance speed and power.

## 🛠️ Installation

1. Download the latest release: https://github.com/bariskisir/ChessBot/releases/latest/download/dist.zip
2. Unzip the archive.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `dist` folder.

To build from source instead:

```sh
npm ci
npm run check
npm test
npm run build
```

Then load the generated `dist` directory as an unpacked extension.

Install and build hooks copy the pinned `stockfish@19.0.0` single-threaded Lite worker, WASM binary, and license into `public/vendor`. To change the engine, bump the package version instead of editing the vendor files.

## ⚙️ How to Use

1.  Navigate to a game on [Chess.com](https://www.chess.com/play/computer), a standard round on [Lichess](https://lichess.org/), or [Lichess training](https://lichess.org/training). The Lichess adapter reads the visible Chessground board and move list.
2.  The **ChessBot** panel will appear on the screen.
3.  Click **START** to begin board detection and analysis.
4.  Toggle **AUTO PLAY** if you want the bot to make moves automatically (ideal for engine-vs-bot matches).
5.  Use the **Advanced Settings** (arrow icon) to adjust Dynamic Delay, Auto New Match, Auto Rematch, average move selection, mistake probability, engine variations (MultiPV), and depth.

**DYNAMIC DELAY** defaults on beside **AUTO PLAY**. It distributes the remaining match time over an initial 40-move forecast, includes future increments, and extends the forecast as long games develop. Board settling, queued analysis, deep evaluation, and alternative searches share the same turn budget. Time trouble removes intentional waiting and bounds analysis to preserve time for input. Untimed games and training add no dynamic wait. Turn Dynamic Delay off to reveal **RANDOM DELAY** on the next row; its saved maximum remains available and elapsed analysis is deducted from the random target. When a site's time control is unavailable, allocation uses its visible remaining clock conservatively without assuming an increment.

Lichess Auto Play uses Chrome's `debugger` permission because Chessground ignores synthetic mouse events. Chrome will show a debugging notice while each move is sent. Training puzzles require a visible move history so the current position can be reconstructed. When Lichess rounds hide their move list, position reading follows legal moves from an observed starting board. Unsupported variants and a midgame reload without visible history remain unanalyzed.

Puzzle Racer and Puzzle Storm read the visible board, last-move markers, and legal continuations. A new timed puzzle has no visible history, so its initial FEN omits unknown castling and en passant rights; positions requiring those rights may have incomplete suggestions.

Unaccepted or stalled move input retries up to three times with a one-second wait and fresh analysis using the current Average/Mistake settings. Each input attempt has a three-second limit. STOP cancels pending analysis, delays, and trusted gestures.

In Lichess training, Auto Play opens the solution only after a failed move and then continues to the next puzzle. Correct intermediate moves keep the puzzle in progress.

## 💡 Optimal Settings for Auto Features

To ensure **Auto New Match** and **Auto Rematch** functions correctly without interruptions, please disable the following features in your settings:

### Coach Settings
*   Motivational messages
*   Reminders
*   Voice
*   Puzzles
*   Show puzzle goals
*   Show mistake feedback
*   Show chat hints

### Interface Settings
*   Show Streaks
*   Collect puzzle points
*   Show post-game feedback
*   Enable Special Themes
*   Show piece icons in game notation

## ⚖️ Ethics & Responsibility

Respect the chess community. This tool is meant to be a companion for learning and bot-testing. Always maintain high standards of sportsmanship.
