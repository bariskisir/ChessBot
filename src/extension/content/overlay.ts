/**
 * Creates and updates the ChessBot overlay panel injected into Chess.com pages.
 */
import { getMaxDepth } from "../shared/settings";
import type { BotSettings, EngineAnalysis } from "../shared/types";
import { byId, readIntegerInput } from "./dom";
import { getUserColor } from "./chessboard";

export interface OverlayCallbacks {
  onStart: () => void;
  onStop: () => void;
  onSettingsChanged: (settings: BotSettings) => void;
  stopRemoteAnalysis: () => void;
}

/**
 * Creates the static HTML markup for the overlay panel.
 */
function renderPanelHtml(settings: BotSettings): string {
  return `
    <div class="bot-panel-header">
      <h3>CHESSBOT</h3>
    </div>
    <div class="bot-controls-row">
      <button id="bot-panel-start" class="bot-panel-btn">START</button>
      <button id="bot-panel-stop" class="bot-panel-btn">STOP</button>
    </div>
    <div id="bot-move-display">
      <span class="label">BEST MOVE</span>
      <span class="value" id="best-move-text">---</span>
      <div id="bot-eval-container" class="bot-eval-container">
        <div id="bot-eval-bar" class="bot-eval-bar">
          <div id="bot-eval-white" class="bot-eval-segment white" style="width: 50%;"></div>
          <div id="bot-eval-black" class="bot-eval-segment black" style="width: 50%;"></div>
        </div>
        <div id="bot-eval-text" class="bot-eval-text">0.00</div>
      </div>
    </div>
    <div id="bot-status-text" class="bot-status-text">Status: Waiting...</div>
    <div id="bot-panel-footer">
      <button id="bot-advanced-toggle" title="Toggle Settings">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M6 9l6 6 6-6"></path>
        </svg>
      </button>
    </div>
    <div id="bot-advanced-panel" class="bot-advanced-section">
      <div class="bot-setting-item">
        <label><span>ENGINE</span></label>
        <select id="bot-engine-select" class="bot-select">
          <option value="api" ${settings.engineType === "api" ? "selected" : ""}>chess-api.com-stockfish-17</option>
          <option value="local" ${settings.engineType === "local" ? "selected" : ""}>local-stockfish-18</option>
        </select>
      </div>
      <div class="bot-setting-item">
        <label class="bot-checkbox-label">
          <span>AUTO PLAY</span>
          <input type="checkbox" id="bot-auto-play" ${settings.autoPlay ? "checked" : ""}>
        </label>
      </div>
      <div class="bot-setting-item">
        <label class="bot-checkbox-label">
          <span>AUTO NEW MATCH</span>
          <input type="checkbox" id="bot-auto-new-match" ${settings.autoNewMatch ? "checked" : ""}>
        </label>
      </div>
      <div class="bot-setting-item">
        <label class="bot-checkbox-label">
          <span>AUTO REMATCH</span>
          <input type="checkbox" id="bot-auto-rematch" ${settings.autoRematch ? "checked" : ""}>
        </label>
      </div>
      <div class="bot-setting-item">
        <label>
          <span>AUTO PLAY RANDOMIZE DELAY (MS)</span>
          <span id="delay-val">${settings.autoPlayDelay}</span>
        </label>
        <input type="range" id="bot-delay-slider" min="0" max="10000" step="100" value="${settings.autoPlayDelay}">
      </div>
      <div class="bot-setting-item">
        <label>
          <span>MISTAKE PROBABILITY (%)</span>
          <span id="mistake-val">${settings.mistakeProbability}</span>
        </label>
        <input type="range" id="bot-mistake-slider" min="0" max="100" value="${settings.mistakeProbability}">
      </div>
      <div class="bot-setting-item">
        <label>
          <span>DEPTH</span>
          <span id="depth-val">${settings.depth}</span>
        </label>
        <input type="range" id="bot-depth-slider" min="1" max="${getMaxDepth(settings.engineType)}" value="${settings.depth}">
      </div>
      <div class="bot-setting-item" id="thinking-time-container" style="display: ${settings.engineType === "local" ? "none" : "block"};">
        <label>
          <span>THINKING TIME (MS)</span>
          <span id="time-val">${settings.thinkingTime}</span>
        </label>
        <input type="range" id="bot-time-slider" min="1" max="100" value="${settings.thinkingTime}">
      </div>
      <div class="bot-debug-container">
        <span class="label">FEN</span>
        <div id="bot-fen-text" class="debug-text">---</div>
      </div>
    </div>
  `;
}

/**
 * Updates the best-move display in the overlay.
 */
export function updateBestMoveText(move: string): void {
  const element = byId<HTMLElement>("best-move-text");

  if (element) {
    element.innerText = move.toUpperCase();
  }
}

/**
 * Updates the status line and optional status color.
 */
export function setStatus(text: string, color?: string): void {
  const element = byId<HTMLElement>("bot-status-text");

  if (!element) {
    return;
  }

  element.innerText = `Status: ${text}`;

  if (color) {
    element.style.color = color;
  }
}

/**
 * Updates the evaluation bar using the current engine result.
 */
export function updateEvalBar(data: EngineAnalysis): void {
  const whiteSegment = byId<HTMLElement>("bot-eval-white");
  const blackSegment = byId<HTMLElement>("bot-eval-black");
  const text = byId<HTMLElement>("bot-eval-text");

  if (!whiteSegment || !blackSegment || !text) {
    return;
  }

  const userColor = getUserColor();
  const evalValue = data.eval ?? 0;
  const evalPrefix = evalValue > 0 ? "+" : "";

  text.innerText = data.mate
    ? evalValue > 0
      ? `M${evalValue}`
      : `-M${Math.abs(evalValue)}`
    : `${evalPrefix}${evalValue.toFixed(2)}`;

  const whitePct = data.mate
    ? evalValue > 0
      ? 100
      : 0
    : 50 + (Math.max(-10, Math.min(10, evalValue)) / 10) * 50;
  const dividerPct = userColor === "w" ? whitePct : 100 - whitePct;

  whiteSegment.style.width = `${whitePct}%`;
  blackSegment.style.width = `${100 - whitePct}%`;
  whiteSegment.style.order = userColor === "w" ? "1" : "2";
  blackSegment.style.order = userColor === "w" ? "2" : "1";
  text.style.left = `${dividerPct}%`;

  const isWhiteWinner = evalValue > 0;
  const isUserWinner = (userColor === "w" && isWhiteWinner) || (userColor === "b" && !isWhiteWinner);
  text.style.transform = isUserWinner ? "translateX(-100%)" : "translateX(0%)";
  text.style.color = isUserWinner
    ? userColor === "w"
      ? "#000000"
      : "#ffffff"
    : userColor === "w"
      ? "#ffffff"
      : "#000000";
}

/**
 * Applies saved positioning styles to the overlay panel.
 */
function positionPanel(panel: HTMLElement, settings: BotSettings): void {
  panel.style.top = settings.panelPos.top;

  if (settings.panelPos.left) {
    panel.style.left = settings.panelPos.left;
    panel.style.right = "auto";
    return;
  }

  panel.style.right = settings.panelPos.right ?? "10px";
}

/**
 * Opens or closes the advanced settings section.
 */
function bindAdvancedToggle(): void {
  const toggleButton = byId<HTMLButtonElement>("bot-advanced-toggle");
  const advancedPanel = byId<HTMLElement>("bot-advanced-panel");

  if (!toggleButton || !advancedPanel) {
    return;
  }

  /** Toggles the advanced settings section when the user clicks the footer control. */
  const handleToggle = (): void => {
    const isOpen = advancedPanel.classList.toggle("open");
    toggleButton.classList.toggle("open", isOpen);
  };

  toggleButton.addEventListener("click", handleToggle);
}

/**
 * Wires checkbox controls to the settings object.
 */
function bindCheckbox(id: string, update: (checked: boolean) => void): void {
  const input = byId<HTMLInputElement>(id);

  if (!input) {
    return;
  }

  /** Persists a checkbox state when it changes. */
  const handleChange = (): void => update(input.checked);

  input.addEventListener("change", handleChange);
}

/**
 * Wires range controls to the settings object and visible value label.
 */
function bindRange(id: string, labelId: string, update: (value: number) => void): void {
  const input = byId<HTMLInputElement>(id);

  if (!input) {
    return;
  }

  /** Persists a range value and mirrors it into the adjacent label. */
  const handleInput = (): void => {
    const value = readIntegerInput(input, 0);
    byId<HTMLElement>(labelId)?.replaceChildren(String(value));
    update(value);
  };

  input.addEventListener("input", handleInput);
}

/**
 * Wires all setting controls to the supplied settings callbacks.
 */
function bindSettingsControls(settings: BotSettings, callbacks: OverlayCallbacks): void {
  const save = (): void => callbacks.onSettingsChanged(settings);

  bindCheckbox("bot-auto-play", (checked) => {
    settings.autoPlay = checked;
    save();
  });
  bindCheckbox("bot-auto-rematch", (checked) => {
    settings.autoRematch = checked;
    save();
  });
  bindCheckbox("bot-auto-new-match", (checked) => {
    settings.autoNewMatch = checked;
    save();
  });
  bindRange("bot-depth-slider", "depth-val", (value) => {
    settings.depth = value;
    save();
  });
  bindRange("bot-time-slider", "time-val", (value) => {
    settings.thinkingTime = value;
    save();
  });
  bindRange("bot-delay-slider", "delay-val", (value) => {
    settings.autoPlayDelay = value;
    save();
  });
  bindRange("bot-mistake-slider", "mistake-val", (value) => {
    settings.mistakeProbability = value;
    save();
  });
  bindEngineSelect(settings, callbacks, save);
}

/**
 * Wires the engine selector to depth limits and engine shutdown behavior.
 */
function bindEngineSelect(settings: BotSettings, callbacks: OverlayCallbacks, save: () => void): void {
  const engineSelect = byId<HTMLSelectElement>("bot-engine-select");

  if (!engineSelect) {
    return;
  }

  /** Updates dependent UI when the selected engine changes. */
  const handleEngineChange = (): void => {
    settings.engineType = engineSelect.value === "api" ? "api" : "local";
    const timeBox = byId<HTMLElement>("thinking-time-container");
    const depthSlider = byId<HTMLInputElement>("bot-depth-slider");
    const maxDepth = getMaxDepth(settings.engineType);

    if (timeBox) {
      timeBox.style.display = settings.engineType === "local" ? "none" : "block";
    }

    if (depthSlider) {
      depthSlider.max = String(maxDepth);

      if (settings.depth > maxDepth) {
        settings.depth = maxDepth;
        depthSlider.value = String(maxDepth);
        byId<HTMLElement>("depth-val")?.replaceChildren(String(maxDepth));
      }
    }

    if (settings.engineType !== "local") {
      callbacks.stopRemoteAnalysis();
    }

    save();
  };

  engineSelect.addEventListener("change", handleEngineChange);
}

/**
 * Makes the overlay panel draggable and persists its last position.
 */
function bindDragging(panel: HTMLElement, settings: BotSettings, callbacks: OverlayCallbacks): void {
  const header = panel.querySelector<HTMLElement>(".bot-panel-header");

  if (!header) {
    return;
  }

  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  /** Starts panel dragging from the header. */
  const handleMouseDown = (event: MouseEvent): void => {
    isDragging = true;
    offsetX = event.clientX - panel.offsetLeft;
    offsetY = event.clientY - panel.offsetTop;
    header.style.cursor = "grabbing";
  };

  /** Moves the panel while dragging is active. */
  const handleMouseMove = (event: MouseEvent): void => {
    if (!isDragging) {
      return;
    }

    panel.style.left = `${event.clientX - offsetX}px`;
    panel.style.top = `${event.clientY - offsetY}px`;
    panel.style.right = "auto";
  };

  /** Finishes dragging and stores the new panel position. */
  const handleMouseUp = (): void => {
    if (!isDragging) {
      return;
    }

    isDragging = false;
    header.style.cursor = "grab";
    settings.panelPos = {
      top: panel.style.top,
      left: panel.style.left,
    };
    callbacks.onSettingsChanged(settings);
  };

  header.addEventListener("mousedown", handleMouseDown);
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
}

/**
 * Wires start and stop buttons to lifecycle callbacks.
 */
function bindRunControls(callbacks: OverlayCallbacks): void {
  byId<HTMLButtonElement>("bot-panel-start")?.addEventListener("click", callbacks.onStart);
  byId<HTMLButtonElement>("bot-panel-stop")?.addEventListener("click", callbacks.onStop);
}

/**
 * Creates the overlay once and binds every control.
 */
export function createOverlay(settings: BotSettings, callbacks: OverlayCallbacks): void {
  if (byId("bot-overlay-panel")) {
    return;
  }

  const panel = document.createElement("div");
  panel.id = "bot-overlay-panel";
  positionPanel(panel, settings);
  panel.innerHTML = renderPanelHtml(settings);
  document.body.appendChild(panel);

  bindAdvancedToggle();
  bindSettingsControls(settings, callbacks);
  bindDragging(panel, settings, callbacks);
  bindRunControls(callbacks);
}
