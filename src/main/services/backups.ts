/**
 * Automatic complete backups into a folder the person chose (a USB drive,
 * another disk, a folder their own sync tool watches), the password that
 * protects backups, and the gentle backup reminder on Today.
 *
 * Electron-free: index.ts runs `runIfDue()` a minute after start, every hour
 * and after the computer wakes up. Only files named like automatic backups are
 * ever deleted from the folder, and only beyond the number to keep.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import type { BackupStatus } from '@core/api';
import { UserFacingError } from '@core/validation';
import type { Journal } from '../journal';
import { writeBackup } from './backup';
import {
  backupPasswordProblem,
  deriveBackupKey,
  ENCRYPTED_BACKUP_EXTENSION,
  loadBackupKey,
  removeBackupKey,
  saveBackupKey,
  type BackupKey,
} from './backupCrypto';
import { fileStamp } from './fsutil';

export const AUTO_BACKUP_PREFIX = 'mJournal-auto-backup-';
const AUTO_BACKUP_RE = /^mJournal-auto-backup-(\d{4}-\d{2}-\d{2}-\d{4})(?:-(\d{1,4}))?\.(?:zip|mjbackup)$/;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** A little less than the full period, so a backup made at a slightly different time of day still counts. */
export const AUTO_BACKUP_INTERVAL_MS = { daily: 20 * HOUR, weekly: 6.5 * DAY } as const;
export const AUTO_BACKUP_CHECK_INTERVAL_MS = HOUR;
/** Today suggests a backup when the last complete one is older than this… */
export const REMIND_AFTER_MS = 30 * DAY;
/** …once the journal has at least this many days… */
export const REMIND_MIN_DAYS = 7;
/** …and "Not now" quiets it for this long. */
export const REMIND_SNOOZE_MS = 14 * DAY;

type LastAuto = NonNullable<BackupStatus['lastAuto']>;
type LastError = NonNullable<BackupStatus['lastError']>;

const isIso = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

function asLastAuto(value: unknown): LastAuto | null {
  const v = value as Partial<LastAuto> | null;
  return v && isIso(v.at) && typeof v.file === 'string' && typeof v.bytes === 'number' ? { at: v.at, file: v.file, bytes: v.bytes } : null;
}

function asLastError(value: unknown): LastError | null {
  const v = value as Partial<LastError> | null;
  return v && isIso(v.at) && typeof v.message === 'string' ? { at: v.at, message: v.message } : null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Newest first: by the time in the name, then by the "-2", "-3"… of a second backup in the same minute. */
function newestFirst(names: string[]): string[] {
  const key = (name: string) => {
    const match = AUTO_BACKUP_RE.exec(name)!;
    return `${match[1]}-${(match[2] ?? '1').padStart(4, '0')}`;
  };
  return [...names].sort((a, b) => key(b).localeCompare(key(a)));
}

export class Backups {
  private running: Promise<void> | null = null;

  constructor(
    private readonly journal: () => Journal,
    private readonly appVersion: string,
  ) {}

  /** The remembered key when backups are protected with a password, otherwise null. */
  key(): BackupKey | null {
    return loadBackupKey(this.journal().paths.backupKey);
  }

  /** Protects new backups with `password`, or stops protecting them (null). Earlier backups keep their password. */
  async setPassword(password: string | null): Promise<void> {
    const journal = this.journal();
    if (password === null) {
      await removeBackupKey(journal.paths.backupKey);
      return;
    }
    const problem = backupPasswordProblem(password);
    if (problem) throw new UserFacingError('weak-password', problem);
    await saveBackupKey(journal.paths.backupKey, await deriveBackupKey(password), journal.clock());
  }

  folder(): string | null {
    const value = this.journal().settings.getInternal<unknown>('autoBackupFolder');
    return typeof value === 'string' && value.length <= 4096 && isAbsolute(value) ? value : null;
  }

  setFolder(folder: string): void {
    if (!isAbsolute(folder)) throw new UserFacingError('invalid-folder', 'Please choose a folder.');
    const { settings } = this.journal();
    settings.setInternal('autoBackupFolder', folder);
    settings.setInternal('autoBackupError', null);
  }

  clearFolder(): void {
    const { settings } = this.journal();
    settings.setInternal('autoBackupFolder', null);
    settings.setInternal('autoBackupError', null);
  }

  /** A complete backup was made by hand: the reminder and the status count it. */
  noteManualBackup(): void {
    const journal = this.journal();
    journal.settings.setInternal('lastBackupAt', journal.clock().toISOString());
  }

  snoozeReminder(): void {
    const journal = this.journal();
    journal.settings.setInternal('backupReminderUntil', new Date(journal.clock().getTime() + REMIND_SNOOZE_MS).toISOString());
  }

  status(): BackupStatus {
    const journal = this.journal();
    const settings = journal.settings.get();
    const folder = this.folder();
    const lastAuto = asLastAuto(journal.settings.getInternal('lastAutoBackup'));
    const lastError = asLastError(journal.settings.getInternal('autoBackupError'));
    const lastBackupAt = journal.settings.getInternal<unknown>('lastBackupAt');
    const snoozedUntil = journal.settings.getInternal<unknown>('backupReminderUntil');
    const now = journal.clock().getTime();
    const interval = AUTO_BACKUP_INTERVAL_MS[settings.autoBackupFrequency];
    const days = journal.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM entries WHERE has_content')!.n;
    const backedUp = isIso(lastBackupAt) ? lastBackupAt : null;
    return {
      folder,
      folderAvailable: folder !== null && isDirectory(folder),
      lastBackupAt: backedUp,
      lastAuto,
      lastError,
      nextDueAt:
        settings.autoBackup && folder
          ? new Date(lastAuto ? Math.max(now, Date.parse(lastAuto.at) + interval) : now).toISOString()
          : null,
      encrypted: this.key() !== null,
      running: this.running !== null,
      remind:
        days >= REMIND_MIN_DAYS &&
        (!backedUp || now - Date.parse(backedUp) > REMIND_AFTER_MS) &&
        (!isIso(snoozedUntil) || now >= Date.parse(snoozedUntil)),
    };
  }

  isDue(): boolean {
    const journal = this.journal();
    const settings = journal.settings.get();
    if (!settings.autoBackup || !this.folder()) return false;
    const last = asLastAuto(journal.settings.getInternal('lastAutoBackup'));
    return !last || journal.clock().getTime() - Date.parse(last.at) >= AUTO_BACKUP_INTERVAL_MS[settings.autoBackupFrequency];
  }

  /** The scheduled check. A failure is kept for Settings to show, never thrown. */
  async runIfDue(): Promise<void> {
    if (this.isDue()) await this.run().catch(() => undefined);
  }

  /** Makes an automatic backup now. Only one is written at a time; a second call waits for the first. */
  run(): Promise<void> {
    if (!this.running) {
      this.running = this.write().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async write(): Promise<void> {
    // The journal at the start: if a restore replaces it meanwhile, this backup fails and is tried again later.
    const journal = this.journal();
    const folder = this.folder();
    try {
      if (!folder) throw new UserFacingError('no-backup-folder', 'Choose a folder for automatic backups first.');
      if (!isDirectory(folder)) {
        throw new UserFacingError(
          'backup-folder-missing',
          `The backup folder isn’t available right now — is the drive connected? (${folder})`,
        );
      }
      const key = this.key();
      const extension = key ? ENCRYPTED_BACKUP_EXTENSION : 'zip';
      const stamp = fileStamp(journal.clock());
      let target = join(folder, `${AUTO_BACKUP_PREFIX}${stamp}.${extension}`);
      for (let n = 2; existsSync(target); n++) target = join(folder, `${AUTO_BACKUP_PREFIX}${stamp}-${n}.${extension}`);
      const { bytes } = await writeBackup(journal, target, this.appVersion, { key });
      const at = journal.clock().toISOString();
      journal.settings.setInternal('lastAutoBackup', { at, file: basename(target), bytes });
      journal.settings.setInternal('lastBackupAt', at);
      journal.settings.setInternal('autoBackupError', null);
      await this.prune(folder, journal.settings.get().autoBackupKeep);
    } catch (err) {
      const message =
        err instanceof UserFacingError ? err.message : `The backup couldn’t be written (${(err as Error).message}).`;
      try {
        journal.settings.setInternal('autoBackupError', { at: journal.clock().toISOString(), message });
      } catch {
        // The journal was closed meanwhile (a restore); the next check tries again.
      }
      throw err instanceof UserFacingError ? err : new UserFacingError('backup-failed', message);
    }
  }

  /** Keeps the newest `keep` automatic backups in `folder`. Never touches any other file. */
  async prune(folder: string, keep: number): Promise<void> {
    const ours = newestFirst(readdirSync(folder).filter((name) => AUTO_BACKUP_RE.test(name)));
    for (const name of ours.slice(keep)) await rm(join(folder, name), { force: true });
  }
}
