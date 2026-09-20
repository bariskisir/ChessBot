/** Coordinates panel behavior with cancelable local analysis and automation. */
import { Chess } from "chess.js";
import { boardBusy, canPlay, canResumePromotion, clearHighlights, getBoard, highlight, playMove, readPosition, resumePromotion, samePosition, userColor } from "./board";
import { findGameAction, type GameAction } from "./automation";
import { analyzePosition, delay, stopAnalysis } from "./engine-client";
import { findMistake, playerScore } from "./mistake-mode";
import { chooseAverageMove } from "./move-selection";
import { DEFAULT_SETTINGS, normalizeSettings, type Settings, type Variation, type PanelPosition } from "./shared";
import { loadSettings, saveSettings } from "./storage";

export interface PanelState {
  settings: Settings; loaded: boolean; running: boolean; fen: string;
  move: string; evaluation: Variation | undefined; status: string; color: string; player: "w" | "b";
}

/** Owns one panel session and prevents canceled work from issuing later board actions. */
export class Controller {
  state: PanelState = { settings: DEFAULT_SETTINGS, loaded: false, running: false, fen: "", move: "---", evaluation: undefined, status: "Waiting...", color: "#9ca3af", player: "w" };
  private timer: ReturnType<typeof setInterval>;
  private operation = new AbortController();
  private lastPosition = "";
  private gameAction = false;
  private executing = false;
  private disposed = false;
  private handledButtons = new WeakSet<HTMLElement>();
  private promotionFailed = false;
  private observer: MutationObserver;
  private frame = 0;
  private candidatePosition = "";

  /** Observes visible board changes immediately, with periodic tracking as a fallback. */
  constructor(private readonly render: (state: PanelState) => void) {
    this.observer = new MutationObserver(this.onBoardMutation);
    this.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "data-figurine"] });
    this.timer = setInterval(this.poll, 300);
    void this.initialize();
  }

  /** Coalesces related piece, move-list, and clock updates into one frame. */
  private schedulePoll = (): void => {
    if (!this.disposed && !this.frame) this.frame = requestAnimationFrame(this.onBoardFrame);
  };

  /** Releases the scheduled frame before checking or stabilizing a new position. */
  private onBoardFrame = (): void => { this.frame = 0; this.poll(); };

  /** Ignores unrelated page activity while detecting board replacement and turn changes. */
  private onBoardMutation = (records: MutationRecord[]): void => {
    const selector = "wc-chess-board, chess-board, wc-simple-move-list, #board-layout-player-bottom, #board-layout-player-top";
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest(selector)) { this.schedulePoll(); return; }
      for (const node of [...record.addedNodes, ...record.removedNodes]) {
        if (node instanceof Element && (node.matches(selector) || node.querySelector(selector))) { this.schedulePoll(); return; }
      }
    }
  };

  /** Loads persisted preferences without starting analysis automatically. */
  private async initialize(): Promise<void> {
    try { const settings = await loadSettings(); if (!this.disposed) this.patch({ settings, loaded: true }); }
    catch { if (!this.disposed) this.patch({ loaded: true, status: "Settings could not be loaded", color: "#ef4444" }); }
  }

  /** Publishes an immutable snapshot for React. */
  private patch(update: Partial<PanelState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...update };
    this.render(this.state);
  }

  /** Stores a complete preference set and reports failures in the status area. */
  private async persist(): Promise<void> {
    try { await saveSettings(this.state.settings); }
    catch { this.patch({ status: "Settings could not be saved", color: "#ef4444" }); }
  }

  /** Cancels searches, delayed moves, and delayed game-over actions together. */
  private cancel(): void {
    this.operation.abort();
    this.operation = new AbortController();
    this.gameAction = false;
    this.executing = false;
    this.candidatePosition = "";
    clearHighlights();
    void stopAnalysis();
  }

  /** Starts board analysis from the START control. */
  start = (): void => {
    this.cancel();
    this.promotionFailed = false;
    this.lastPosition = "";
    this.patch({ running: true, status: "Starting...", color: "#10b981" });
    this.poll();
  };

  /** Stops every pending action from the STOP control. */
  stop = (): void => {
    this.cancel();
    this.lastPosition = "";
    this.patch({ running: false, move: "---", status: "Stopped", color: "#ef4444" });
  };

  /** Applies a changed setting and restarts the current calculation if needed. */
  updateSettings = (update: Partial<Settings>): void => {
    this.patch({ settings: normalizeSettings({ ...this.state.settings, ...update }) });
    void this.persist();
    this.cancel();
    this.lastPosition = "";
    this.poll();
  };

  /** Saves panel movement without interrupting an active engine calculation. */
  updatePosition = (panelPos: PanelPosition): void => {
    this.patch({ settings: normalizeSettings({ ...this.state.settings, panelPos }) });
    void this.persist();
  };

  /** Requires a new position to settle across frames before starting immediate analysis. */
  private poll = (): void => {
    if (this.disposed || !this.state.loaded) return;
    const fen = readPosition() ?? "", player = userColor();
    if (fen !== this.state.fen || player !== this.state.player) this.patch({ fen, player });
    if (!this.state.running || this.gameAction || this.executing) return;
    if (this.state.settings.autoPlay && canResumePromotion()) {
      if (!this.promotionFailed) {
        this.cancel();
        this.executing = true;
        void this.recoverPromotion(this.operation.signal);
      }
      return;
    }
    this.promotionFailed = false;
    const action = findGameAction(this.state.settings);
    if (!action) this.handledButtons = new WeakSet<HTMLElement>();
    if (action && !this.handledButtons.has(action.button)) {
      this.cancel();
      this.gameAction = true;
      void this.runGameAction(action, this.operation.signal);
      return;
    }
    if (!fen || boardBusy()) {
      this.candidatePosition = "";
      if (this.lastPosition) { this.cancel(); this.lastPosition = ""; }
      this.patch({ status: getBoard() ? "Waiting for board position..." : "Waiting for board...", color: "#f59e0b" });
      return;
    }
    const key = `${fen}:${player}`;
    if (key === this.lastPosition) return;
    if (key !== this.candidatePosition) {
      this.cancel();
      this.lastPosition = "";
      this.candidatePosition = key;
      this.schedulePoll();
      return;
    }
    this.cancel();
    this.lastPosition = key;
    void this.analyze(fen, player, this.operation.signal);
  };

  /** Repeats the 2.5-second game-over delays while honoring STOP. */
  private async runGameAction(action: GameAction, signal: AbortSignal): Promise<void> {
    try {
      this.patch({ move: "---", status: `Game Over - Waiting 2.5s for ${action.name}...`, color: "#f59e0b" });
      await delay(2500, signal);
      const current = findGameAction(this.state.settings);
      if (current?.button !== action.button || !action.button.isConnected) return;
      this.handledButtons.add(action.button);
      action.button.click();
      this.patch({ status: `${action.name} clicked - Waiting 2.5s...`, color: "#3b82f6" });
      await delay(2500, signal);
      this.lastPosition = "";
      this.patch({ status: "New Game Started", color: "#10b981" });
    } catch (error) { if (!signal.aborted) this.reportError(error); }
    finally { if (!signal.aborted) { this.gameAction = false; this.lastPosition = ""; } }
  }

  /** Recovers a stuck promotion before normal board detection rejects the dragging pawn. */
  private async recoverPromotion(signal: AbortSignal): Promise<void> {
    try {
      this.patch({ status: "Completing promotion...", color: "#3b82f6" });
      await resumePromotion(this.state.move, signal);
      this.lastPosition = "";
    } catch (error) {
      if (!signal.aborted) { this.promotionFailed = true; this.reportError(error); }
    } finally { if (!signal.aborted) this.executing = false; }
  }

  /** Searches one line unless averaging needs candidates, releasing input when the move is accepted. */
  private async analyze(fen: string, player: "w" | "b", signal: AbortSignal): Promise<void> {
    const settings = this.state.settings;
    try {
      signal.throwIfAborted();
      const chess = new Chess(fen);
      if (chess.isGameOver()) { this.patch({ status: chess.isCheckmate() ? "Checkmate" : "Game Over - Draw", color: "#9ca3af" }); return; }
      this.patch({ status: "Thinking...", color: "#3b82f6" });
      const started = Date.now();
      const result = await analyzePosition(fen, { ...settings, lines: settings.averageMove ? settings.lines : 1 }, signal);
      await delay(Math.max(0, settings.thinkingTime - (Date.now() - started)), signal);
      if (!samePosition(readPosition() ?? "", fen) || userColor() !== player) return;
      const evaluation = result.variations[0];
      if (evaluation) this.patch({ evaluation });
      const playerTurn = chess.turn() === player;
      let move = result.bestMove;
      let mistake: "ideal" | "suboptimal" | undefined;
      if (playerTurn && settings.averageMove) {
        move = chooseAverageMove(result.variations, player) ?? move;
      } else if (playerTurn && playerScore(evaluation, player) > 1.5 && Math.random() * 100 < settings.mistakeProbability) {
        this.patch({ status: "Attempting to find mistake...", color: "#f59e0b" });
        const candidate = await findMistake(fen, player, settings, signal, move);
        if (candidate) { move = candidate.move; mistake = candidate.type; }
      }
      signal.throwIfAborted();
      if (!samePosition(readPosition() ?? "", fen) || userColor() !== player) return;
      const showMove = playerTurn || settings.analyzeOpponent;
      this.patch({ move: showMove ? move.toUpperCase() : "---", status: !playerTurn ? "Opponent's turn" : mistake === "ideal" ? "Mistake Mode!" : mistake === "suboptimal" ? "Suboptimal Mode" : "Analyzing Board", color: !playerTurn ? "#9ca3af" : mistake === "ideal" ? "#ef4444" : mistake === "suboptimal" ? "#f97316" : "#10b981" });
      if (!playerTurn || !settings.autoPlay || !canPlay(fen)) { if (showMove) highlight(move, mistake); else clearHighlights(); return; }
      const moveDelay = Math.floor(Math.random() * (settings.autoPlayDelay + 1));
      this.patch({ status: moveDelay ? `Waiting ${Math.ceil(moveDelay / 100) / 10}s...` : "Playing move...", color: "#3b82f6" });
      await delay(moveDelay, signal);
      if (!samePosition(readPosition() ?? "", fen) || userColor() !== player) return;
      this.executing = true;
      if (!await playMove(fen, move, signal, settings.animateMoves)) return;
      if (mistake) highlight(move, mistake);
      const deadline = Date.now() + 700;
      while (Date.now() < deadline) {
        const current = readPosition();
        if (current && !boardBusy() && !samePosition(current, fen)) break;
        await delay(25, signal);
      }
      if (samePosition(readPosition() ?? "", fen)) this.patch({ status: "Move not accepted - press START to retry", color: "#f59e0b" });
    } catch (error) { if (!signal.aborted) this.reportError(error); }
    finally { if (!signal.aborted) { this.executing = false; this.schedulePoll(); } }
  }

  /** Displays an actionable engine failure without dropping the panel. */
  private reportError(error: unknown): void { this.patch({ status: error instanceof Error ? error.message : String(error), color: "#ef4444" }); }

  /** Releases observers, frame callbacks, and pending actions when the panel unmounts. */
  dispose = (): void => { this.disposed = true; this.observer.disconnect(); cancelAnimationFrame(this.frame); clearInterval(this.timer); this.cancel(); };
}
