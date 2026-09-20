/** Persists masked per-tab histories across page reloads and serializes updates with clears. */
import type { JevHistory, JevLog } from "./jev-log";

interface LogStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

/** Owns history writes so page reloads cannot lose an in-flight response or revive cleared calls. */
export class JevLogStore {
  private queues = new Map<number, Promise<unknown>>();

  /** Accepts session storage in production and isolated storage in tests. */
  constructor(private readonly storage: LogStorage) {}

  /** Serializes reads, writes and clears for a tab without mixing independent histories. */
  private enqueue(tab: number, update?: JevLog | "clear"): Promise<JevHistory> {
    const previous = this.queues.get(tab) ?? Promise.resolve();
    const task = previous.catch(
      /** Allows a later operation to recover from a storage failure. */
      () => {}).then(
      /** Applies one update to the persisted snapshot in request order. */
      async () => {
        const key = `jevLogs:${tab}`;
        const saved = (await this.storage.get(key))[key] as JevHistory | undefined;
        const history: JevHistory = saved ?? { revision: 0, entries: [] };
        if (!update) return history;
        let entries = [...history.entries];
        if (update === "clear") entries = [];
        else {
          const index = entries.findIndex(
            /** Associates completion with a recorded request rather than counting it twice. */
            (entry) => entry.id === update.id);
          if (index >= 0) entries[index] = update;
          else if (update.status === "pending") entries.push(update);
          else return history;
        }
        const next = { revision: history.revision + 1, entries };
        await this.storage.set({ [key]: next });
        return next;
      });
    this.queues.set(tab, task);
    return task;
  }

  /** Reads this tab's complete history, including calls started before a reload. */
  read(tab: number): Promise<JevHistory> { return this.enqueue(tab); }
  /** Removes saved calls and prevents their late responses from recreating them. */
  clear(tab: number): Promise<JevHistory> { return this.enqueue(tab, "clear"); }
  /** Stores an already-redacted lifecycle event and returns the resulting snapshot. */
  record(tab: number, entry: JevLog): Promise<JevHistory> { return this.enqueue(tab, entry); }
}
