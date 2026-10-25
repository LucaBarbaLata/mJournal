/**
 * Owns the open journal and anything that replaces it (restoring a backup).
 * Electron-free, so the complete backup → restore flow is unit-tested.
 */
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { BackupInspection, RestoreResult } from '@core/api';
import { UserFacingError } from '@core/validation';
import { Journal, type JournalOptions } from './journal';
import { stageBackup, type StagedBackup } from './services/backup';
import { swapInStagedBackup } from './services/restore';
import { LATEST_SCHEMA_VERSION } from './store/migrations';

const STAGED_BACKUP_TTL_MS = 30 * 60 * 1000;

export class JournalHost {
  private current: Journal;
  private readonly staged = new Map<string, { backup: StagedBackup; createdAt: number }>();

  private constructor(
    readonly root: string,
    private readonly options: JournalOptions,
    journal: Journal,
  ) {
    this.current = journal;
  }

  static open(root: string, options: JournalOptions = {}): JournalHost {
    return new JournalHost(root, options, Journal.open(root, options));
  }

  get journal(): Journal {
    return this.current;
  }

  private clock(): Date {
    return (this.options.clock ?? (() => new Date()))();
  }

  /** Validates a backup file and keeps it staged until the user confirms or cancels. */
  async inspectBackup(file: string): Promise<BackupInspection> {
    await this.discardExpired();
    const backup = await stageBackup(file, this.current.paths.temp, LATEST_SCHEMA_VERSION);
    const token = randomBytes(16).toString('hex');
    this.staged.set(token, { backup, createdAt: Date.now() });
    const counts = this.current.db.get<{ entries: number; photos: number }>(
      `SELECT (SELECT COUNT(*) FROM entries WHERE has_content) AS entries,
              (SELECT COUNT(*) FROM photos WHERE removed_at IS NULL) AS photos`,
    )!;
    return {
      token,
      fileName: backup.fileName,
      createdAt: backup.manifest.createdAt,
      appVersion: backup.manifest.appVersion,
      schemaVersion: backup.manifest.schemaVersion,
      bytes: backup.bytes,
      counts: backup.manifest.counts,
      warnings: backup.warnings,
      current: counts,
    };
  }

  async cancelRestore(token: string): Promise<void> {
    const item = this.staged.get(token);
    this.staged.delete(token);
    if (item) await rm(item.backup.dir, { recursive: true, force: true });
  }

  private async discardExpired(): Promise<void> {
    for (const [token, item] of this.staged) {
      if (Date.now() - item.createdAt > STAGED_BACKUP_TTL_MS) await this.cancelRestore(token);
    }
  }

  /**
   * Replaces the journal with a staged backup. The current journal is moved,
   * not deleted, into backups/previous-journal-<time>. On any failure the
   * original journal is put back and reopened.
   */
  async restore(token: string): Promise<RestoreResult> {
    const item = this.staged.get(token);
    if (!item) {
      throw new UserFacingError('restore-expired', 'This restore has expired. Please choose the backup file again.');
    }
    this.staged.delete(token);
    const paths = this.current.paths;
    this.current.close();
    let swap;
    try {
      swap = await swapInStagedBackup(paths, item.backup.dir, this.clock());
    } catch (err) {
      this.current = Journal.open(this.root, this.options);
      await rm(item.backup.dir, { recursive: true, force: true });
      throw new UserFacingError(
        'restore-failed',
        `The backup could not be restored (${(err as Error).message}). Your journal has not been changed.`,
      );
    }
    try {
      const restored = Journal.open(this.root, this.options);
      restored.entries.refreshAll();
      this.current = restored;
    } catch (err) {
      await swap.rollback();
      this.current = Journal.open(this.root, this.options);
      throw new UserFacingError(
        'restore-failed',
        `The restored journal could not be opened (${(err as Error).message}). Your previous journal has been put back.`,
      );
    } finally {
      await rm(item.backup.dir, { recursive: true, force: true });
    }
    return { previousDataPath: swap.previousDir };
  }

  async close(): Promise<void> {
    for (const token of [...this.staged.keys()]) await this.cancelRestore(token);
    this.current.close();
  }
}
