/** Coordinates panel behavior with cancelable local analysis and automation. */
import { Chess } from "chess.js";
import { boardBusy, canPlay, canResumePromotion, clearHighlights, getBoard, highlight, isCurrentPosition, readClock, readPosition, resumePromotion, samePosition, userColor } from "./board";
import { findGameAction, type GameAction } from "./automation";
import { delay, stopAnalysis } from "./engine-client";
import { analyzeMove } from "./move-analysis";
import { executeMove } from "./move-execution";
import type { PlayerPosition } from "./providers/position";
import { DEFAULT_SETTINGS, normalizeSettings, type Settings, type Variation, type PanelPosition } from "./shared";
import { loadSettings, saveSettings } from "./storage";
import { currentProvider } from "./providers";
import { armFollowup, clearFollowup, takeFollowup } from "./followup-session";
import { TurnTiming } from "./timing/turn-timing";
import { MoveSelectionBudget } from "./timing/move-selection-budget";

export interface PanelState {
  settings: Settings; loaded: boolean; running: boolean; fen: string;
  move: string; evaluation: Variation | undefined; status: string; color: string; player: "w" | "b";
}

type PendingAction = { kind: "move"; position: PlayerPosition } | { kind: "promotion" } | { kind: "game" };

/** Owns one panel session and prevents canceled work from issuing later board actions. */
export class Controller {
  state: PanelState = { settings: DEFAULT_SETTINGS, loaded: false, running: false, fen: "", move: "---", evaluation: undefined, status: "Waiting...", color: "#9ca3af", player: "w" };
  private timer: ReturnType<typeof setInterval>;
  private operation = new AbortController();
  private lastPosition = "";
  private pendingAction: PendingAction | null = null;
  private disposed = false;
  private handledButtons = new WeakSet<HTMLElement>();
  private promotionFailed = false;
  private observer: MutationObserver;
  private frame = 0;
  private candidatePosition = "";
  private observedTurn: { key: string; startedAt: number } | null = null;

  /** Observes visible board changes immediately, with periodic tracking as a fallback. */
  constructor(private readonly render: (state: PanelState) => void) {
    this.observer = new MutationObserver(this.onBoardMutation);
    this.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "data-figurine"] });
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
    const selector = currentProvider()?.mutationSelector;
    if (!selector) return;
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
    this.pendingAction = null;
    this.candidatePosition = "";
    clearHighlights();
    void stopAnalysis();
  }

  /** Starts board analysis from the START control. */
  start = (): void => {
    clearFollowup();
    this.cancel();
    this.promotionFailed = false;
    this.observedTurn = null;
    this.lastPosition = "";
    this.patch({ running: true, status: "Starting...", color: "#10b981" });
    this.poll();
  };

  /** Stops every pending action from the STOP control. */
  stop = (): void => {
    clearFollowup();
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
    if (fen && !this.state.running && currentProvider()?.resumeAfterNavigation && takeFollowup()) { this.start(); return; }
    if (!this.state.running || this.pendingAction?.kind === "game") return;
    if (fen && !boardBusy()) {
      const key = `${fen}:${player}`;
      if (this.observedTurn?.key !== key) this.observedTurn = { key, startedAt: Date.now() };
    }
    if (this.pendingAction) {
      const position = this.pendingAction.kind === "move" ? this.pendingAction.position : null;
      if (position && fen && !boardBusy() && (!samePosition(fen, position.fen) || player !== position.player)) {
        this.cancel();
        this.lastPosition = "";
        this.patch({ status: "Board changed - checking position...", color: "#10b981" });
        this.schedulePoll();
      }
      return;
    }
    if (this.state.settings.autoPlay && canResumePromotion()) {
      if (!this.promotionFailed) {
        this.cancel();
        this.pendingAction = { kind: "promotion" };
        void this.recoverPromotion(this.operation.signal);
      }
      return;
    }
    this.promotionFailed = false;
    const action = findGameAction(this.state.settings);
    if (!action) this.handledButtons = new WeakSet<HTMLElement>();
    if (action && !this.handledButtons.has(action.button)) {
      this.cancel();
      this.pendingAction = { kind: "game" };
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

  /** Delays follow-up actions while honoring STOP and preserving Lichess navigation. */
  private async runGameAction(action: GameAction, signal: AbortSignal): Promise<void> {
    try {
      const puzzle = action.kind === "puzzle";
      const wait = puzzle ? 500 : 2500;
      this.patch({ move: "---", status: `${puzzle ? "Puzzle" : "Game Over"} - Waiting ${wait / 1000}s for ${action.name}...`, color: "#f59e0b" });
      await delay(wait, signal);
      const current = findGameAction(this.state.settings);
      if (current?.button !== action.button || !action.button.isConnected) return;
      this.handledButtons.add(action.button);
      const resume = action.kind === "round" && action.resumeOnNavigation, address = location.href;
      if (resume) armFollowup();
      action.button.click();
      this.patch({ status: `${action.name} clicked - Waiting ${wait / 1000}s...`, color: "#3b82f6" });
      await delay(wait, signal);
      if (resume && location.href === address) clearFollowup();
      this.lastPosition = "";
      this.patch({ status: puzzle ? `${action.name} clicked` : "New Game Started", color: "#10b981" });
    } catch (error) { if (!signal.aborted) this.reportError(error); }
    finally { if (!signal.aborted) { this.pendingAction = null; this.lastPosition = ""; this.schedulePoll(); } }
  }

  /** Recovers a stuck promotion before normal board detection rejects the dragging pawn. */
  private async recoverPromotion(signal: AbortSignal): Promise<void> {
    try {
      this.patch({ status: "Completing promotion...", color: "#3b82f6" });
      await resumePromotion(this.state.move, signal);
      this.lastPosition = "";
    } catch (error) {
      if (!signal.aborted) { this.promotionFailed = true; this.reportError(error); }
    } finally { if (!signal.aborted) { this.pendingAction = null; this.schedulePoll(); } }
  }

  /** Coordinates selection and automatic input while keeping each operation tied to its position. */
  private async analyze(fen: string, player: "w" | "b", signal: AbortSignal): Promise<void> {
    const settings = this.state.settings;
    try {
      signal.throwIfAborted();
      const chess = new Chess(fen);
      if (chess.isGameOver()) { this.patch({ status: chess.isCheckmate() ? "Checkmate" : "Game Over - Draw", color: "#9ca3af" }); return; }
      if (chess.turn() !== player) {
        clearHighlights();
        this.patch({ move: "---", status: "Opponent's turn", color: "#9ca3af" });
        return;
      }
      const position = { fen, player };
      const timing = new TurnTiming(settings,
        /** Reads corrected live clocks without losing the time spent settling this position. */
        () => {
          const clock = readClock();
          if (!clock) return null;
          const weights = { p: 0, n: 1, b: 1, r: 2, q: 4, k: 0 };
          let material = 0;
          for (const row of chess.board()) for (const piece of row) if (piece) material += weights[piece.type];
          return { ...clock, completedMoves: Math.max(0, Number(fen.split(" ")[5]) - 1), materialPhase: Math.min(1, material / 24), quietHalfMoves: Number(fen.split(" ")[4]), lagMs: 250 };
        }, this.observedTurn?.startedAt ?? Date.now());
      const budget = settings.autoPlay && canPlay(fen) ? new MoveSelectionBudget(fen, timing.remainingAnalysisMs) : undefined;
      /** Keeps the complete main, evaluation, and alternative searches inside one turn budget. */
      const select = (scope: AbortSignal) => analyzeMove(position, settings, scope,
        /** Publishes analysis progress only while this operation still owns the panel. */
        (progress) => { if (!scope.aborted) this.patch(progress); }, budget);
      const choice = budget ? await budget.run(signal, select) : await select(signal);
      if (!choice) return;
      const { move, mistake, evaluation } = choice;
      if (evaluation) this.patch({ evaluation });
      this.patch({ move: move.toUpperCase(), status: mistake ? "Mistake Mode!" : "Analyzing Board", color: mistake ? "#ef4444" : "#10b981" });
      if (!settings.autoPlay || !canPlay(fen)) { highlight(move, mistake ? "mistake" : undefined); return; }
      await timing.wait(signal,
        /** Shows only the remaining share after settling, queued work, and analysis. */
        (remainingMs) => this.patch({ status: `Waiting ${(remainingMs / 1000).toFixed(1)}s...`, color: "#3b82f6" }));
      if (!isCurrentPosition(position)) return;
      this.pendingAction = { kind: "move", position };
      const outcome = await executeMove(position, choice, settings, signal,
        /** Keeps late input and retry reports from overwriting STOP or a new position. */
        (progress) => { if (!signal.aborted) this.patch(progress); }, budget);
      signal.throwIfAborted();
      if (!outcome.accepted) {
        if (samePosition(readPosition() ?? "", fen)) this.patch({ status: "Move not accepted - press START to retry", color: "#f59e0b" });
        else this.patch({ status: "Waiting for board position...", color: "#f59e0b" });
        return;
      }
      this.patch({ status: "Move played - waiting for next position...", color: "#10b981" });
      if (outcome.choice.mistake) highlight(outcome.choice.move, "mistake");
    } catch (error) { if (!signal.aborted) this.reportError(error); }
    finally { if (!signal.aborted) { this.pendingAction = null; this.schedulePoll(); } }
  }

  /** Displays an actionable engine failure without dropping the panel. */
  private reportError(error: unknown): void { this.patch({ status: error instanceof Error ? error.message : String(error), color: "#ef4444" }); }

  /** Releases observers, frame callbacks, and pending actions when the panel unmounts. */
  dispose = (): void => { this.disposed = true; this.observer.disconnect(); cancelAnimationFrame(this.frame); clearInterval(this.timer); this.cancel(); };
}
