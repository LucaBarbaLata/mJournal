/**
 * Checks GitHub for a newer mJournal: about once a day while "Check for new
 * versions" is on, and whenever the person clicks "Check now". The request
 * carries nothing about the person or their journal, and nothing is ever
 * downloaded: the interface mentions the new version and links to GitHub.
 */
import { CHECK_INTERVAL_MS, isNewerVersion, parseVersion, releaseVersion, type UpdateState, type UpdateStatus } from '@core/updates';

/** Remembered between starts, so mJournal doesn't ask again every time it opens. */
export interface SavedUpdateCheck {
  checkedAt: string;
  /** The newest released version, or null while nothing has been released. */
  released: string | null;
}

export interface UpdateCheckerOptions {
  currentVersion: string;
  /** GitHub's latest-release answer, or null when nothing has been released yet. Rejects when GitHub can't be reached. */
  fetchLatestRelease: () => Promise<unknown>;
  /** Whether automatic checks are on. */
  enabled: () => boolean;
  load: () => unknown;
  save: (check: SavedUpdateCheck) => void;
  onChange: (status: UpdateStatus) => void;
  onError?: (err: unknown) => void;
  now?: () => Date;
}

/** After a failed check (offline, GitHub busy), try again a few hours later instead of a day later. */
export const RETRY_AFTER_FAILURE_MS = 3 * 60 * 60 * 1000;

function isSavedCheck(value: unknown): value is SavedUpdateCheck {
  if (typeof value !== 'object' || value === null) return false;
  const { checkedAt, released } = value as Record<string, unknown>;
  return (
    typeof checkedAt === 'string' &&
    !Number.isNaN(Date.parse(checkedAt)) &&
    (released === null || (typeof released === 'string' && parseVersion(released) !== null))
  );
}

export class UpdateChecker {
  private saved: SavedUpdateCheck | null;
  private failedAt: number | null = null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private automatic = false;
  private firstDelayMs = 0;

  constructor(private readonly options: UpdateCheckerOptions) {
    const saved = options.load();
    this.saved = isSavedCheck(saved) ? saved : null;
  }

  status(): UpdateStatus {
    const { currentVersion } = this.options;
    const released = this.saved?.released ?? null;
    const latest = released !== null && isNewerVersion(released, currentVersion) ? released : null;
    let state: UpdateState;
    if (this.running) state = 'checking';
    else if (latest) state = 'available';
    else if (this.failedAt !== null) state = 'failed';
    else if (this.saved) state = 'up-to-date';
    else state = this.options.enabled() ? 'idle' : 'off';
    return { state, current: currentVersion, latest, checkedAt: this.saved?.checkedAt ?? null };
  }

  /** Asks GitHub now. Resolves with the new status; never rejects. */
  async check(): Promise<UpdateStatus> {
    if (!this.running) {
      this.running = this.ask().finally(() => {
        this.running = null;
        if (this.automatic) this.schedule(0);
        this.notify();
      });
      this.notify();
    }
    await this.running;
    return this.status();
  }

  /** Starts automatic checks: the first after `firstDelayMs` (so start-up stays quick), then about once a day. */
  start(firstDelayMs: number): void {
    this.automatic = true;
    this.firstDelayMs = firstDelayMs;
    this.schedule(firstDelayMs);
  }

  /** Applies a changed "Check for new versions" setting right away. */
  settingsChanged(): void {
    if (this.automatic && !this.running) this.schedule(this.firstDelayMs);
    this.notify();
  }

  stop(): void {
    this.automatic = false;
    this.clearTimer();
  }

  private async ask(): Promise<void> {
    try {
      const answer = await this.options.fetchLatestRelease();
      const released = answer === null ? null : releaseVersion(answer);
      if (answer !== null && released === null) throw new Error('GitHub answered with something that is not a release');
      this.saved = { checkedAt: this.now().toISOString(), released };
      this.failedAt = null;
      try {
        this.options.save(this.saved);
      } catch (err) {
        this.options.onError?.(err);
      }
    } catch (err) {
      this.failedAt = this.now().getTime();
      this.options.onError?.(err);
    }
  }

  private schedule(minDelayMs: number): void {
    this.clearTimer();
    if (!this.automatic || !this.options.enabled()) return;
    const now = this.now().getTime();
    let due = this.saved ? Date.parse(this.saved.checkedAt) + CHECK_INTERVAL_MS : now;
    if (this.failedAt !== null) due = Math.max(due, this.failedAt + RETRY_AFTER_FAILURE_MS);
    // Never wait longer than the interval, even if the clock was turned back.
    const delay = Math.min(Math.max(due - now, minDelayMs), CHECK_INTERVAL_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.check();
    }, delay);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private notify(): void {
    this.options.onChange(this.status());
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
