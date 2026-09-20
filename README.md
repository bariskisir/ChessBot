# ChessBot

![ChessBot Demo](gameplay.gif)

ChessBot is a powerful Chrome Extension designed for **Chess.com**. It integrates advanced engine analysis directly into your browser, allowing you to observe, analyze, and learn from a top-tier chess engine in real-time.

## 🚀 Purpose & Vision

The primary goal of this extension is **education through observation**.

*   **Engine vs. Bot Matchups**: It is built to simulate matches between different engines and Chess.com's computer personalities (bots).
*   **Learning Tool**: By watching how high-level engines (like Stockfish 18) navigate complex positions against AI, players can improve their tactical awareness and positional understanding.

> [!WARNING]
> **STRICT FAIR PLAY POLICY**
> This application is strictly for educational purposes. **DO NOT use this tool to gain an unfair advantage against real human players.** Using chess bots in competitive matches against humans is a violation of Chess.com's Terms of Service and undermines the spirit of the game.

## ✨ Key Features

*   **stockfish-18**: The default engine runs entirely in your browser via WASM, works offline, and keeps its calculations on your device.
*   **openrouter-jev**: Uses OpenRouter's `~typesafe/jev-latest` Decisions API to choose one move from the complete legal move list for the current FEN. Only the player's turn is analyzed. Stockfish never runs for Jev requests; depth, variations, evaluation, opponent analysis, average moves and mistake mode are unavailable in this mode.
*   **Real-time Evaluation Bar**: A dynamic, responsive eval bar that shows the advantage from the current player's perspective.
*   **Auto Play Mode**: Automatically execute engine moves with a customizable random delay to simulate match flows.
*   **Auto New Match & Auto Rematch**: Detect game over and start the next game automatically, with 2.5-second delays.
*   **Mistake Mode**: Play safe, non-losing suboptimal moves within a configurable probability window.
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

## ⚙️ How to Use

1.  Navigate to any game or analysis page on [Chess.com](https://www.chess.com/play/computer).
2.  The **ChessBot** panel will appear on the screen.
3.  Click **START** to begin board detection and analysis.
4.  Toggle **AUTO PLAY** if you want the bot to make moves automatically (ideal for engine-vs-bot matches).
5.  Use the **Advanced Settings** (arrow icon) to adjust Auto New Match, Auto Rematch, average move selection, random delay, mistake probability, engine variations (MultiPV), and depth.

To use Jev, open Advanced Settings, choose **openrouter-jev** under **ENGINE**, enter your **OPENROUTER API KEY**, and click **START**. Enable **AUTO PLAY** to execute its selected move. The key is saved in local extension storage (not encrypted or synced). Jev sends the FEN and legal moves to OpenRouter and requires internet access and API credit. It makes a structured move decision rather than a Stockfish search; no centipawn evaluation is shown. Invalid decisions and API errors stop that position's action; press STOP and START to retry. STOP, engine changes and position changes cancel pending requests and prevent late moves. The local **stockfish-18** engine requires no key.

The request uses TypeSafe's [Choice format](https://docs.typesafe.ai/primitives/choice) through OpenRouter's Decisions endpoint, with the [Jev Latest alias](https://openrouter.ai/~typesafe/jev-latest).

Open Advanced Settings with the arrow and click **jev-logs** at the bottom of that menu. A log panel with 25% more width and height than the main panel opens immediately to its left and moves with it. **Request** and **Response** expand to show their headers and formatted JSON bodies; Response is open by default. Probability maps are displayed from highest to lowest without modifying the captured response. Logging continues while the viewer is closed. **Auto-follow**, beside **Next**, selects the newest call by default; **Previous** and **Next** pause following for manual inspection. API keys are masked before logs leave the background worker, including keys echoed in response bodies. Every call is saved per tab in extension session storage with no count limit, so page refreshes preserve its history during the browser session. The footer totals reported usage costs in USD across all saved calls. The trash icon clears the history and its total, including suppression of late responses for deleted calls. Failed and canceled calls remain available until cleared.

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
