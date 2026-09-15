/** Mounts the ChessBot panel as an isolated React interface. */
import { createRoot } from "react-dom/client";
import { App } from "./app";
import styles from "./styles/index.scss";

/** Creates one isolated React root for the floating panel. */
export function mount(): void {
  if (document.getElementById("chessbot-root")) return;
  const host = document.createElement("div");
  host.id = "chessbot-root";
  const shadow = host.attachShadow({ mode: "open" }), style = document.createElement("style"), root = document.createElement("div");
  style.textContent = styles;
  shadow.append(style, root);
  document.body.append(host);
  createRoot(root).render(<App />);
}
