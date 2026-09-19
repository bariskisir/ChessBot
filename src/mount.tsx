/** Mounts the ChessBot panel as an isolated React interface. */
import { createRoot } from "react-dom/client";
import { App } from "./app";
import styles from "./styles/index.scss";

/** Remembers the mounted panel so a second mount needs no page-visible identifier. */
let host: HTMLElement | null = null;

/** Creates one isolated React root for the floating panel. */
export function mount(): void {
  if (host?.isConnected) return;
  host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" }), style = document.createElement("style"), root = document.createElement("div");
  style.textContent = styles;
  shadow.append(style, root);
  document.body.append(host);
  createRoot(root).render(<App />);
}
