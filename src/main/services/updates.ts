/**
 * Checks GitHub for a newer mJournal while "Check for new versions" is on: once
 * each time mJournal starts, then about once a day while it stays open, and
 * whenever the person clicks "Check now". The request carries nothing about the
 * person or their journal. Nothing is downloaded by itself: only "Update"
 * downloads and installs the new version (updateInstaller.ts), and where this
 * copy can't do that, "Get it" links to GitHub. How the update went is kept in
 * the status (`result`) until the person has seen it: a failure right away, a
 * finished update after mJournal has opened again. What the newer version
 * changes is asked for only when the person opens "What's new" (changes()).
 */
import { UserFacingError } from '@core/validation';
import {
  changesBetween,
  CHECK_INTERVAL_MS,
  isNewerVersion,
  parseVersion,
  releaseVersion,
  type InstallKind,
  type UpdateChanges,
  type UpdateResult,
  type UpdateState,
  type UpdateStatus,
} from '@core/updates';

/** Remembered between starts, so mJournal doesn't ask again every time it opens. */
export interface SavedUpdateCheck {
  checkedAt: string;
  /** The newest released version, or null while nothing has been released. */
  released: string | null;
}

/**
 * Remembered from the moment an update starts installing until the person has seen how it went: mJournal closes
 * while it installs, so only the next start can tell whether it worked.
 */
export interface PendingUpdate {
  /** The version being installed. */
  version: string;
  /** The version that was running. */
  previous: string;
}

/** What an installation reports while it runs. */
export interface InstallProgress {
  /** Part of the download that has arrived, from 0 to 1, or null while the size isn't known. */
  downloaded(fraction: number | null): void;
  /** The download is complete and checked; it is being installed now. */
  installing(): void;
}

export interface UpdateInstall {
  kind: InstallKind;
  /**
   * Downloads and installs `version`, then mJournal closes (and opens again in the new version). Rejects when it
   * can't; a UserFacingError's message is shown to the person.
   */
  install(version: string, progress: InstallProgress): Promise<void>;
}

export interface UpdateCheckerOptions {
  currentVersion: string;
  /** GitHub's latest-release answer, or null when nothing has been released yet. Rejects when GitHub can't be reached. */
  fetchLatestRelease: () => Promise<unknown>;
  /** GitHub's list of the newest releases (RELEASES_API), for "What's new". Rejects when GitHub can't be reached. */
  fetchReleases?: () => Promise<unknown>;
  /** Whether automatic checks are on. */
  enabled: () => boolean;
  load: () => unknown;
  save: (check: SavedUpdateCheck) => void;
  /** The PendingUpdate remembered by an earlier start, if any. */
  loadPending?: () => unknown;
  /** Remembers an update that is being installed; null forgets it. */
  savePending?: (pending: PendingUpdate | null) => void;
  onChange: (status: UpdateStatus) => void;
  onError?: (err: unknown) => void;
  /** How this copy installs a new version itself; missing when it can't (the portable app, development builds). */
  installer?: UpdateInstall | null;
  now?: () => Date;
}

const INSTALL_FAILED = 'The update couldn’t be installed. Try again, or get it from GitHub.';
const CHANGES_FAILED = 'GitHub couldn’t be reached just now, so what’s new can’t be shown. Are you online?';

interface Installation {
  version: string;
  phase: 'downloading' | 'installing';
  progress: number | null;
}

/** After a failed check (offline, GitHub busy), try again a few hours later instead of a day later. */
export const RETRY_AFTER_FAILURE_MS = 3 * 60 * 60 * 1000;

function isPendingUpdate(value: unknown): value is PendingUpdate {
  if (typeof value !== 'object' || value === null) return false;
  const { version, previous } = value as Record<string, unknown>;
  return (
    typeof version === 'string' && parseVersion(version) !== null && typeof previous === 'string' && parseVersion(previous) !== null
  );
}

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
  private installation: Installation | null = null;
  private installError: string | null = null;
  private result: UpdateResult | null = null;
  /** Whether GitHub has been asked since mJournal started: every start asks once, however recently it asked before. */
  private askedSinceStart = false;
  /** What's new up to the newer version, asked for once while mJournal stays open (or being asked for). */
  private changesAsked: { latest: string; answer: Promise<UpdateChanges> } | null = null;

  constructor(private readonly options: UpdateCheckerOptions) {
    const saved = options.load();
    this.saved = isSavedCheck(saved) ? saved : null;
    // An update was being installed when mJournal closed: it worked if this is (at least) the new version.
    const pending = options.loadPending?.();
    if (isPendingUpdate(pending)) {
      this.result = {
        outcome: isNewerVersion(pending.version, options.currentVersion) ? 'failed' : 'installed',
        version: pending.version,
        previous: pending.previous,
        error: null,
      };
    }
  }

  status(): UpdateStatus {
    const { currentVersion, installer } = this.options;
    const released = this.saved?.released ?? null;
    const latest =
      this.installation?.version ?? (released !== null && isNewerVersion(released, currentVersion) ? released : null);
    let state: UpdateState;
    if (this.installation) state = this.installation.phase;
    else if (this.running) state = 'checking';
    else if (latest) state = 'available';
    else if (this.failedAt !== null) state = 'failed';
    else if (this.saved) state = 'up-to-date';
    else state = this.options.enabled() ? 'idle' : 'off';
    return {
      state,
      current: currentVersion,
      latest,
      checkedAt: this.saved?.checkedAt ?? null,
      installer: installer?.kind ?? null,
      progress: this.installation?.progress ?? null,
      installError: this.installError,
      result: this.result,
    };
  }

  /** The person has seen how the update went (closed its window), so it isn't shown again. */
  dismissResult(): UpdateStatus {
    if (this.result) {
      this.result = null;
      this.rememberPending(null);
      this.notify();
    }
    return this.status();
  }

  /**
   * Downloads and installs the newer version (the "Update" button); mJournal then closes and opens again.
   * Resolves with the new status and never rejects: when it fails, the status says why.
   */
  async install(): Promise<UpdateStatus> {
    const { installer } = this.options;
    const { latest } = this.status();
    if (!installer || !latest || this.installation) return this.status();
    const { currentVersion } = this.options;
    const installation: Installation = { version: latest, phase: 'downloading', progress: null };
    this.installation = installation;
    this.installError = null;
    // A new try replaces what the window said about the last one.
    if (this.result) {
      this.result = null;
      this.rememberPending(null);
    }
    this.notify();
    try {
      await installer.install(latest, {
        downloaded: (fraction) => {
          if (installation.phase !== 'downloading') return;
          // Whole percents are enough for the progress bar, and keep the messages to the window few.
          const percent = fraction === null || !Number.isFinite(fraction) ? null : Math.floor(Math.min(1, Math.max(0, fraction)) * 100);
          const progress = percent === null ? null : percent / 100;
          if (progress === installation.progress) return;
          installation.progress = progress;
          this.notify();
        },
        installing: () => {
          installation.phase = 'installing';
          installation.progress = null;
          // Before mJournal closes to install, so the next start can say whether it worked.
          this.rememberPending({ version: latest, previous: currentVersion });
          this.notify();
        },
      });
      // mJournal is closing now; it stays "installing" until then.
    } catch (err) {
      this.installation = null;
      this.installError = err instanceof UserFacingError ? err.message : INSTALL_FAILED;
      // mJournal stays open, so the window says so right away instead of at the next start.
      this.result = { outcome: 'failed', version: latest, previous: currentVersion, error: this.installError };
      this.rememberPending(null);
      this.notify();
    }
    return this.status();
  }

  /**
   * What the newer version changes ("What's new"): the notes of every release after this version, up to the newer
   * one, newest first. Asks GitHub only the first time it's opened (and again after a failure). Nothing when no newer
   * version is known. Rejects with a UserFacingError when GitHub can't be reached.
   */
  async changes(): Promise<UpdateChanges> {
    const { latest } = this.status();
    const { fetchReleases, currentVersion } = this.options;
    if (!latest) return { releases: [], complete: true };
    let asked = this.changesAsked;
    if (asked?.latest !== latest) {
      const answer = (async () => {
        if (!fetchReleases) throw new Error('This copy can’t ask GitHub for release notes');
        const changes = changesBetween(await fetchReleases(), currentVersion, latest);
        if (!changes) throw new Error('GitHub answered with something that is not a list of releases');
        return changes;
      })();
      asked = { latest, answer };
      this.changesAsked = asked;
      answer.catch((err: unknown) => {
        // Not kept, so opening it again asks again.
        if (this.changesAsked?.answer === answer) this.changesAsked = null;
        this.options.onError?.(err);
      });
    }
    try {
      return await asked.answer;
    } catch {
      throw new UserFacingError('offline', CHANGES_FAILED);
    }
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
    } finally {
      this.askedSinceStart = true;
    }
  }

  private rememberPending(pending: PendingUpdate | null): void {
    try {
      this.options.savePending?.(pending);
    } catch (err) {
      this.options.onError?.(err);
    }
  }

  private schedule(minDelayMs: number): void {
    this.clearTimer();
    if (!this.automatic || !this.options.enabled()) return;
    const now = this.now().getTime();
    // The first check after start is due right away; after that, a day after the last answer.
    let due = this.askedSinceStart && this.saved ? Date.parse(this.saved.checkedAt) + CHECK_INTERVAL_MS : now;
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
