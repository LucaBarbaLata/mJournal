/**
 * Autosave. Edits are scheduled per field ("body", "answer:joy-01", …) and
 * written after a short pause in typing. Saves for the same field run in
 * order; failures are kept for retry. The status drives the "Saved" indicator,
 * and flush() writes everything immediately (before closing or navigating).
 */
import { useSyncExternalStore } from 'react';
import { errorMessage } from './api';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export interface SaveSnapshot {
  status: SaveStatus;
  lastSavedAt: number | null;
  error: string | null;
}

interface Job {
  run: () => Promise<void>;
  timer: number | null;
}

export const DEFAULT_SAVE_DELAY = 650;

class SaveQueue {
  private readonly scheduled = new Map<string, Job>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly failed = new Map<string, () => Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private active = 0;
  private snapshot: SaveSnapshot = { status: 'saved', lastSavedAt: null, error: null };

  schedule(key: string, run: () => Promise<void>, delay = DEFAULT_SAVE_DELAY): void {
    const previous = this.scheduled.get(key);
    if (previous?.timer) window.clearTimeout(previous.timer);
    const job: Job = { run, timer: null };
    this.scheduled.set(key, job);
    this.failed.delete(key);
    if (delay <= 0) void this.start(key);
    else job.timer = window.setTimeout(() => void this.start(key), delay);
    this.update();
  }

  /** Saves now, for actions such as choosing a mood. */
  saveNow(key: string, run: () => Promise<void>): Promise<void> {
    this.schedule(key, run, 0);
    return this.chains.get(key) ?? Promise.resolve();
  }

  private start(key: string): Promise<void> {
    const job = this.scheduled.get(key);
    if (!job) return this.chains.get(key) ?? Promise.resolve();
    this.scheduled.delete(key);
    if (job.timer) window.clearTimeout(job.timer);
    this.active++;
    this.update();
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous
      .then(job.run)
      .then(
        () => {
          this.snapshot = { ...this.snapshot, lastSavedAt: Date.now() };
          this.failed.delete(key);
        },
        (err: unknown) => {
          this.failed.set(key, job.run);
          this.snapshot = { ...this.snapshot, error: errorMessage(err) };
        },
      )
      .finally(() => {
        this.active--;
        if (this.chains.get(key) === next) this.chains.delete(key);
        this.update();
      });
    this.chains.set(key, next);
    return next;
  }

  /** Writes all pending edits now and waits for every save to finish. */
  async flush(): Promise<void> {
    for (const key of [...this.scheduled.keys()]) void this.start(key);
    await Promise.all([...this.chains.values()]);
  }

  retry(): void {
    for (const [key, run] of [...this.failed]) {
      this.failed.delete(key);
      this.schedule(key, run, 0);
    }
  }

  hasUnsaved(): boolean {
    return this.scheduled.size > 0 || this.active > 0 || this.failed.size > 0;
  }

  private update(): void {
    const status: SaveStatus =
      this.active > 0 ? 'saving' : this.failed.size > 0 ? 'error' : this.scheduled.size > 0 ? 'pending' : 'saved';
    this.snapshot = { ...this.snapshot, status, error: status === 'error' ? this.snapshot.error : null };
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SaveSnapshot => this.snapshot;
}

export const saveQueue = new SaveQueue();

export function useSaveStatus(): SaveSnapshot {
  return useSyncExternalStore(saveQueue.subscribe, saveQueue.getSnapshot);
}
