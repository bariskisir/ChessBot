/** Renders the ChessBot window and every local-engine control in React. */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Controller, type PanelState } from "./controller";
import { DEFAULT_SETTINGS, type Settings, type PanelPosition } from "./shared";
import icon from "../public/icons/icon.svg";

interface SettingProps { settings: Settings; change: (update: Partial<Settings>) => void }

/** Carries continuous panel coordinates to SCSS without presentational declarations. */
interface PanelVars extends CSSProperties { "--bot-top"?: string | undefined; "--bot-right"?: string | undefined; "--bot-left"?: string | undefined }

/** Carries the continuous evaluation share to SCSS without presentational declarations. */
interface EvalVars extends CSSProperties { "--bot-white"?: string | undefined }

/** Maps engine status colors to SCSS tone names so TS never declares colors. */
const STATUS_TONES: Record<string, string> = { "#9ca3af": "muted", "#10b981": "success", "#3b82f6": "info", "#ef4444": "danger", "#f59e0b": "warning", "#f97316": "ember" };

/** Renders a compact checkbox for persisted automation and animation preferences. */
function Toggle({ label, name, settings, change }: SettingProps & { label: string; name: "autoPlay" | "autoNewMatch" | "autoRematch" | "analyzeOpponent" | "averageMove" | "animateMoves" }) {
  return <div className="bot-setting-item"><label className="bot-checkbox-label"><input type="checkbox" checked={settings[name]} onChange={
    /** Saves the selected automation preference. */
    (event) => change({ [name]: event.target.checked })} /><span>{label}</span></label></div>;
}

/** Renders a slider in display units while preserving its stored numeric units. */
function Slider({ label, name, max, min = 0, step = 1, scale = 1, suffix = "", settings, change }: SettingProps & { label: string; name: "autoPlayDelay" | "mistakeProbability" | "depth" | "lines"; max: number; min?: number; step?: number; scale?: number; suffix?: string }) {
  const value = settings[name] / scale;
  return <div className="bot-setting-item"><label htmlFor={`bot-${name}`}><span>{label}</span><span>{value}{suffix}</span></label><input id={`bot-${name}`} aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={
    /** Converts the displayed value back to the stored units. */
    (event) => change({ [name]: Number(event.target.value) * scale })} /></div>;
}

/** Pairs Auto Play with its delay using the shared toggle-and-slider layout. */
function AutoPlay({ settings, change }: SettingProps) {
  const seconds = settings.autoPlayDelay / 1000;
  return <div className="bot-setting-item bot-toggle-slider-row">
    <label className="bot-checkbox-label"><input type="checkbox" checked={settings.autoPlay} onChange={
      /** Toggles automatic play and enables or disables its delay control. */
      (event) => change({ autoPlay: event.target.checked })} /><span>AUTO PLAY</span></label>
    <label className="bot-inline-slider-label" htmlFor="bot-autoPlayDelay"><span>RANDOM DELAY</span><span>{seconds}s</span><input id="bot-autoPlayDelay" aria-label="RANDOM DELAY" type="range" min="0" max="10" step="0.1" value={seconds} disabled={!settings.autoPlay} onChange={
      /** Stores the displayed delay in milliseconds for the move executor. */
      (event) => change({ autoPlayDelay: Number(event.target.value) * 1000 })} /></label>
  </div>;
}

/** Uses one variation when averaging is disabled while retaining the preferred candidate count. */
function AverageMove({ settings, change }: SettingProps) {
  const lines = settings.averageMove ? settings.lines : 1;
  return <div className="bot-setting-item bot-toggle-slider-row">
    <label className="bot-checkbox-label"><input type="checkbox" checked={settings.averageMove} onChange={
      /** Enables candidate selection without discarding the saved variation count. */
      (event) => change({ averageMove: event.target.checked })} /><span>AVERAGE MOVE</span></label>
    <label className="bot-inline-slider-label" htmlFor="bot-lines"><span>VARIATIONS</span><span>{lines}</span><input id="bot-lines" aria-label="VARIATIONS" type="range" min="1" max="10" step="1" value={lines} disabled={!settings.averageMove} onChange={
      /** Stores the candidate count used when averaging is enabled. */
      (event) => change({ lines: Number(event.target.value) })} /></label>
  </div>;
}

/** Pairs five-percent mistake steps with a keep floor enabled for nonzero probability. */
function MistakeMode({ settings, change }: SettingProps) {
  return <div className="bot-setting-item bot-toggle-slider-row bot-mistake-row">
    <label className="bot-inline-slider-label" htmlFor="bot-mistakeProbability"><span>MISTAKE</span><span>{settings.mistakeProbability}%</span><input id="bot-mistakeProbability" aria-label="MISTAKE" type="range" min="0" max="100" step="5" value={settings.mistakeProbability} onChange={
      /** Keeps mistake probability independent of the base move selector. */
      (event) => change({ mistakeProbability: Number(event.target.value) })} /></label>
    <label className="bot-inline-slider-label" htmlFor="bot-mistakeKeep"><span>KEEP EVAL</span><span>{settings.mistakeKeep.toFixed(1)}</span><input id="bot-mistakeKeep" aria-label="KEEP EVAL" type="range" min="0" max="5" step="0.5" value={settings.mistakeKeep} disabled={settings.mistakeProbability === 0} onChange={
      /** Saves the minimum advantage a mistake may keep. */
      (event) => change({ mistakeKeep: Number(event.target.value) })} /></label>
  </div>;
}

/** Renders the white/black evaluation bar and board-oriented presentation. */
function Evaluation({ state }: { state: PanelState }) {
  const evaluation = state.evaluation;
  const score = evaluation?.score ?? 0, mate = evaluation?.mate;
  const hasMate = mate !== undefined && mate !== null;
  const white = hasMate ? mate > 0 ? 100 : 0 : 50 + Math.max(-10, Math.min(10, score)) * 5;
  const text = hasMate ? `${mate < 0 ? "-" : ""}M${Math.abs(mate)}` : `${score > 0 ? "+" : ""}${score.toFixed(2)}`;
  const whiteLabel = white >= 50;
  const labelFirst = whiteLabel === (state.player === "w");
  const bar: EvalVars = { "--bot-white": `${white}%` };
  const label = <div id="bot-eval-text" className="bot-eval-text" data-on={whiteLabel ? "white" : "black"} data-anchor={labelFirst ? "right" : "left"}>{text}</div>;
  return <div id="bot-eval-container" className="bot-eval-container" aria-label={`Evaluation ${text}`}>
    <div id="bot-eval-bar" className="bot-eval-bar" data-player={state.player} style={bar}>
      <div id="bot-eval-white" className="bot-eval-segment white">{whiteLabel && label}</div>
      <div id="bot-eval-black" className="bot-eval-segment black">{!whiteLabel && label}</div>
    </div>
  </div>;
}

/** Groups paired settings and labels the displayed move with the selected selection mode. */
export function App() {
  const [state, setState] = useState<PanelState>({ settings: DEFAULT_SETTINGS, loaded: false, running: false, fen: "", move: "---", evaluation: undefined, status: "Waiting...", color: "#9ca3af", player: "w" });
  const [advanced, setAdvanced] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const controller = useRef<Controller | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  /** Mounts the behavior controller and cancels all work on unmount. */
  useEffect(() => {
    const instance = new Controller(setState);
    controller.current = instance;
    /** Removes tracking, searches, and queued board clicks. */
    return () => instance.dispose();
  }, []);

  /** Persists a setting through the behavior controller. */
  function change(update: Partial<Settings>): void { controller.current?.updateSettings(update); }

  /** Starts board analysis using the START button. */
  function start(): void { controller.current?.start(); }

  /** Stops analysis and every queued automatic action. */
  function stop(): void { controller.current?.stop(); }

  /** Opens the advanced controls beneath the footer arrow. */
  function toggleAdvanced(): void { setAdvanced(!advanced); }

  /** Captures header dragging with the same saved top/left coordinates. */
  function beginDrag(event: PointerEvent<HTMLElement>): void {
    if (event.button !== 0) return;
    const rect = panel.current!.getBoundingClientRect();
    drag.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  /** Moves the panel while keeping its header within reach. */
  function moveDrag(event: PointerEvent<HTMLElement>): void {
    if (!drag.current) return;
    const width = panel.current!.getBoundingClientRect().width;
    setPosition({ top: `${Math.max(0, Math.min(innerHeight - 50, event.clientY - drag.current.y))}px`, left: `${Math.max(0, Math.min(innerWidth - width, event.clientX - drag.current.x))}px` });
  }

  /** Saves the dropped panel position for the next page load. */
  function finishDrag(): void {
    if (!drag.current) return;
    drag.current = null;
    if (position) controller.current?.updatePosition(position);
  }

  const saved = position ?? state.settings.panelPos;
  const style: PanelVars = { "--bot-top": saved.top, "--bot-right": saved.left ? "auto" : saved.right ?? "10px" };
  if (saved.left) style["--bot-left"] = saved.left;
  const controls = { settings: state.settings, change };
  return <div id="bot-overlay-panel" ref={panel} data-anchored={saved.left ? "left" : "right"} style={style}>
    <div className="bot-panel-header" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}><h3><img src={icon} width="16" height="16" alt="" draggable={false} />CHESS.COM BOT<span className="bot-version">v{chrome.runtime.getManifest().version}</span></h3></div>
    <div className="bot-controls-row"><button id={state.running ? "bot-panel-stop" : "bot-panel-start"} className="bot-panel-btn" onClick={state.running ? stop : start} disabled={!state.loaded}>{state.running ? "STOP" : "START"}</button></div>
    <div id="bot-move-display"><span className="label">{state.settings.averageMove ? "AVERAGE MOVE" : "BEST MOVE"}</span><span className="value" id="best-move-text">{state.move}</span><Evaluation state={state} /></div>
    <div id="bot-status-text" className="bot-status-text" data-tone={STATUS_TONES[state.color] ?? "muted"} role="status">{state.status}</div>
    <div id="bot-panel-footer"><button id="bot-advanced-toggle" className={advanced ? "open" : ""} title="Toggle Settings" aria-label="Toggle Settings" aria-expanded={advanced} aria-controls="bot-advanced-panel" onClick={toggleAdvanced}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg></button></div>
    <div id="bot-advanced-panel" className={`bot-advanced-section ${advanced ? "open" : ""}`} hidden={!advanced}>
      <AutoPlay {...controls} />
      <Toggle label="AUTO NEW MATCH" name="autoNewMatch" {...controls} />
      <Toggle label="AUTO REMATCH" name="autoRematch" {...controls} />
      <Toggle label="ANALYZE OPPONENT" name="analyzeOpponent" {...controls} />
      <AverageMove {...controls} />
      <Toggle label="ANIMATE MOVES" name="animateMoves" {...controls} />
      <MistakeMode {...controls} />
      <Slider label="DEPTH" name="depth" min={1} max={30} {...controls} />
    </div>
  </div>;
}
