/** Tracks this page's masked Jev traffic and presents a live, browsable request history. */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatLogBody, totalJevCost, type JevHistory, type JevLog, type JevLogMessage } from "./jev-log";

interface LogVars extends CSSProperties { "--bot-log-height": string }

/** Gives each raw traffic section an independent, keyboard-accessible disclosure arrow. */
function LogSection({ title, children, expanded = false }: { title: string; children: ReactNode; expanded?: boolean }) {
  return <details className="bot-log-section" open={expanded}>
    <summary><span>{title}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></summary>
    {children}
  </details>;
}

/** Restores per-tab traffic and shows reported costs with explicit history clearing. */
export function JevLogs({ container }: { container: HTMLDivElement | null }) {
  const [entries, setEntries] = useState<JevLog[]>([]);
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(0);
  const [automatic, setAutomatic] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [storageError, setStorageError] = useState("");
  const revision = useRef(-1);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  /** Rejects stale read responses when a newer saved snapshot has already arrived. */
  function restore(history: JevHistory): void {
    if (history.revision < revision.current) return;
    revision.current = history.revision;
    setEntries(history.entries);
    setStorageError("");
  }

  /** Subscribes before restoring storage so reloads cannot lose concurrent completions. */
  useEffect(() => {
    let disposed = false;
    /** Applies the tab's persisted snapshot or reports storage failures. */
    function receive(message: JevLogMessage | { target: "jev-log-error"; error: string }): void {
      if (message?.target === "jev-logs") restore(message.history);
      else if (message?.target === "jev-log-error") setStorageError(message.error);
    }
    chrome.runtime.onMessage.addListener(receive);
    void chrome.runtime.sendMessage({ target: "jev-log-store", action: "get" }).then(
      /** Restores only a current response while the component remains mounted. */
      (response: { history?: JevHistory; error?: string }) => {
        if (disposed) return;
        if (response?.history) restore(response.history);
        else setStorageError(response?.error ?? "Jev logs could not be loaded.");
      }).catch(
        /** Keeps failed restoration visible in the log panel. */
        () => { if (!disposed) setStorageError("Jev logs could not be loaded."); });
    /** Prevents duplicate subscriptions when the overlay unmounts. */
    return () => { disposed = true; chrome.runtime.onMessage.removeListener(receive); };
  }, []);

  /** Focuses the side panel without blocking the board or its controls. */
  useEffect(() => { if (open) closeButton.current?.focus(); }, [open]);

  const found = entries.findIndex(
    /** Resolves manual selection by identity so new calls do not shift it. */
    (entry) => entry.id === selected);
  const index = automatic ? entries.length - 1 : Math.max(0, found);
  const entry = entries[index];

  /** Toggles the docked viewer and captures its size only when opening it. */
  function toggle(): void {
    if (!open) setHeight((container?.querySelector("#bot-overlay-panel")?.getBoundingClientRect().height ?? 320) * 1.25);
    setOpen(!open);
  }
  /** Returns keyboard focus to the button without interrupting analysis. */
  function close(): void { setOpen(false); trigger.current?.focus(); }
  /** Pauses following while inspecting the preceding retained request. */
  function previous(): void { setAutomatic(false); setSelected(entries[index - 1]?.id ?? null); }
  /** Pauses following while inspecting the next retained request. */
  function next(): void { setAutomatic(false); setSelected(entries[index + 1]?.id ?? null); }
  /** Pins the current request when disabling follow and jumps to the newest when enabling it. */
  function follow(): void { setSelected(entry?.id ?? null); setAutomatic(!automatic); }

  /** Clears saved calls and their summed cost without stopping play or reviving old responses. */
  async function clear(): Promise<void> {
    try {
      const response: { history?: JevHistory; error?: string } = await chrome.runtime.sendMessage({ target: "jev-log-store", action: "clear" });
      if (!response?.history) throw new Error(response?.error ?? "Jev logs could not be cleared.");
      restore(response.history); setSelected(null); setAutomatic(true);
    } catch (error) { setStorageError(error instanceof Error ? error.message : "Jev logs could not be cleared."); }
  }

  const style: LogVars = { "--bot-log-height": `${height}px` };

  return <>
    <button id="bot-jev-logs" ref={trigger} onClick={toggle} aria-expanded={open} aria-controls="bot-jev-panel">jev-logs</button>
    {open && container && createPortal(<aside id="bot-jev-panel" className="bot-jev-panel" style={style} aria-label="Jev logs" onKeyDown={
      /** Supports Escape without making the chess board inert. */
      (event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <nav aria-label="Log navigation">
        <div className="bot-log-navigation">
          <button className="bot-log-arrow" onClick={previous} disabled={index <= 0 || !entry} aria-label="Previous" title="Previous"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
          <span aria-label="Request count">{entry ? `${index + 1}/${entries.length}` : "0/0"}</span>
          <div className="bot-log-follow"><button className="bot-log-arrow" onClick={next} disabled={index >= entries.length - 1 || !entry} aria-label="Next" title="Next"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></button>
            <label><input type="checkbox" checked={automatic} onChange={follow} />Auto-follow</label>
          </div>
          <button className="bot-log-arrow bot-log-clear" onClick={clear} aria-label="Clear Jev logs" title="Clear logs"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg></button>
          <button className="bot-log-arrow" ref={closeButton} onClick={close} aria-label="Close Jev logs" title="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
        </div>
      </nav>
      <div className="bot-log-content">
      {storageError && <p className="bot-log-error">{storageError}</p>}
      {entry ? <div className="bot-log-record" key={entry.id}>
        {entry.error && <p className="bot-log-error">{entry.error}</p>}
        <div className="bot-log-bodies">
          <LogSection title="Request">
            <LogSection title="Headers"><pre>{entry.request.method} {entry.request.url}{"\n"}{formatLogBody(entry.request.headers)}</pre></LogSection>
            <LogSection title="Body"><pre data-log="request-body">{formatLogBody(entry.request.body)}</pre></LogSection>
          </LogSection>
          <LogSection title="Response" expanded>
            <LogSection title="Headers">{entry.response ? <pre>{formatLogBody(entry.response.headers)}</pre> : <p>No response headers yet.</p>}</LogSection>
            <LogSection title="Body" expanded>{entry.response ? <pre data-log="response-body">{formatLogBody(entry.response.body)}</pre> : <p>{entry.status === "pending" ? "Waiting for response…" : "No response received."}</p>}</LogSection>
          </LogSection>
        </div>
      </div> : <p>No Jev requests yet. Calls appear here automatically when Jev plays.</p>}
      </div>
      <footer className="bot-log-cost" aria-label="Total cost">Total cost: ${totalJevCost(entries).toFixed(8)}</footer>
    </aside>, container)}
  </>;
}
