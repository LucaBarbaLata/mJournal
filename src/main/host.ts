/**
 * Owns the open journal and anything that replaces it (restoring a backup or
 * a daily snapshot). Electron-free, so the complete backup → restore flow is
 * unit-tested.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { BackupInspection, LockedBackup, RestoreResult } from '@core/api';
import { UserFacingError } from '@core/validation';
import { Journal, type JournalOptions } from './journal';
import { DATABASE_FILE } from './paths';
import { stageBackup, type StagedBackup } from './services/backup';
import {
  decryptBackup,
  keyFromPassword,
  keyMatches,
  readEncryptedHeader,
  type BackupKey,
  type EncryptedHeader,
} from './services/backupCrypto';
import { swapInDatabase, swapInStagedBackup } from './services/restore';
import { listSnapshots } from './services/snapshots';
import { Db } from './store/database';
import { LATEST_SCHEMA_VERSION } from './store/migrations';

const STAGED_BACKUP_TTL_MS = 30 * 60 * 1000;
/** Names of the daily safety snapshots and the copies made before upgrades (see services/snapshots.ts). */
const SNAPSHOT_FILE_RE = /^mJournal-[A-Za-z0-9._-]{1,160}\.db$/;
const notRestored = 'Nothing was restored and your journal has not been changed.';

type StagedItem = { createdAt: number } & (
  | { kind: 'backup'; backup: StagedBackup; encrypted: boolean }
  | { kind: 'snapshot'; dir: string }
  /** A password-protected backup waiting for its password. */
  | { kind: 'locked'; file: string; header: EncryptedHeader }
);

export class JournalHost {
  private current: Journal;
  private readonly staged = new Map<string, StagedItem>();

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

  private newToken(): string {
    return randomBytes(16).toString('hex');
  }

  private currentCounts(): { entries: number; photos: number } {
    return this.current.db.get<{ entries: number; photos: number }>(
      `SELECT (SELECT COUNT(*) FROM entries WHERE has_content) AS entries,
              (SELECT COUNT(*) FROM photos WHERE removed_at IS NULL) AS photos`,
    )!;
  }

  /**
   * Validates a backup file and keeps it staged until the user confirms or cancels. A password-protected
   * backup made with the remembered key opens right away; any other needs its password (unlockBackup).
   */
  async inspectBackup(file: string, rememberedKey: BackupKey | null = null): Promise<BackupInspection | LockedBackup> {
    await this.discardExpired();
    let header: EncryptedHeader | null;
    try {
      header = existsSync(file) ? await readEncryptedHeader(file) : null;
    } catch (err) {
      if (err instanceof UserFacingError) throw err;
      throw new UserFacingError('not-found', 'That backup file could not be opened.');
    }
    if (!header) return this.stageZip(file);
    if (rememberedKey && keyMatches(rememberedKey, header)) return this.stageEncrypted(file, header, rememberedKey);
    const token = this.newToken();
    this.staged.set(token, { kind: 'locked', file, header, createdAt: Date.now() });
    return { needsPassword: true, token, fileName: basename(file) };
  }

  /** Opens a password-protected backup with its password. A wrong password leaves it waiting for another try. */
  async unlockBackup(token: string, password: string): Promise<BackupInspection> {
    const item = this.staged.get(token);
    if (!item || item.kind !== 'locked') {
      throw new UserFacingError('restore-expired', 'This restore has expired. Please choose the backup file again.');
    }
    const key = await keyFromPassword(password, item.header);
    if (!key) {
      throw new UserFacingError('wrong-password', 'That password doesn’t open this backup. Check it and try again.');
    }
    this.staged.delete(token);
    return this.stageEncrypted(item.file, item.header, key);
  }

  private async stageZip(file: string, shown?: { fileName: string; bytes: number }): Promise<BackupInspection> {
    const backup = await stageBackup(file, this.current.paths.temp, LATEST_SCHEMA_VERSION);
    if (shown) Object.assign(backup, shown);
    const token = this.newToken();
    this.staged.set(token, { kind: 'backup', backup, encrypted: Boolean(shown), createdAt: Date.now() });
    return {
      token,
      kind: 'backup',
      encrypted: Boolean(shown),
      fileName: backup.fileName,
      createdAt: backup.manifest.createdAt,
      appVersion: backup.manifest.appVersion,
      schemaVersion: backup.manifest.schemaVersion,
      bytes: backup.bytes,
      counts: backup.manifest.counts,
      warnings: backup.warnings,
      current: this.currentCounts(),
    };
  }

  /** Decrypts into a private folder, then checks the .zip like any other backup. The decrypted copy is removed. */
  private async stageEncrypted(file: string, header: EncryptedHeader, key: BackupKey): Promise<BackupInspection> {
    await mkdir(this.current.paths.temp, { recursive: true });
    const dir = await mkdtemp(join(this.current.paths.temp, 'decrypt-'));
    try {
      const zip = join(dir, 'backup.zip');
      await decryptBackup(file, header, key, zip);
      return await this.stageZip(zip, { fileName: basename(file), bytes: (await stat(file)).size });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Checks one of the daily safety snapshots and keeps a copy staged until the user confirms or cancels. */
  async inspectSnapshot(name: string): Promise<BackupInspection> {
    await this.discardExpired();
    const snapshotsDir = this.current.paths.snapshots;
    const info = SNAPSHOT_FILE_RE.test(name) ? listSnapshots(snapshotsDir).find((s) => s.name === name) : undefined;
    if (!info) throw new UserFacingError('unknown-snapshot', 'That snapshot could not be found. It may have been tidied away.');
    await mkdir(this.current.paths.temp, { recursive: true });
    const dir = await mkdtemp(join(this.current.paths.temp, 'restore-'));
    try {
      const staged = join(dir, DATABASE_FILE);
      await copyFile(join(snapshotsDir, name), staged);
      let db: Db;
      try {
        db = Db.open(staged);
      } catch {
        throw new UserFacingError('damaged', `This snapshot can't be opened. ${notRestored}`);
      }
      let schemaVersion: number;
      let counts: BackupInspection['counts'];
      let missing: number;
      try {
        if (db.integrityCheck() !== 'ok') throw new UserFacingError('damaged', `This snapshot is damaged. ${notRestored}`);
        schemaVersion = db.userVersion;
        if (schemaVersion < 1) throw new UserFacingError('damaged', `This snapshot is incomplete. ${notRestored}`);
        if (schemaVersion > LATEST_SCHEMA_VERSION) {
          throw new UserFacingError('newer-version', `This snapshot was made by a newer version of mJournal. ${notRestored}`);
        }
        const n = (sql: string) => db.get<{ n: number }>(sql)!.n;
        counts = {
          entries: n('SELECT COUNT(*) AS n FROM entries WHERE has_content'),
          photos: n('SELECT COUNT(*) AS n FROM photos WHERE removed_at IS NULL'),
          monthlyReflections: n("SELECT COUNT(DISTINCT month) AS n FROM monthly_reflections WHERE answer <> ''"),
        };
        // Photos stay as they are: a snapshot only holds the database.
        missing = db
          .all<{ file: string }>('SELECT DISTINCT file FROM photos WHERE removed_at IS NULL')
          .filter(({ file }) => !this.current.photos.files.exists(file)).length;
      } catch (err) {
        if (err instanceof UserFacingError) throw err;
        throw new UserFacingError('damaged', `This snapshot can't be read (${(err as Error).message}). ${notRestored}`);
      } finally {
        db.close();
      }
      const token = this.newToken();
      this.staged.set(token, { kind: 'snapshot', dir, createdAt: Date.now() });
      return {
        token,
        kind: 'snapshot',
        encrypted: false,
        fileName: name,
        createdAt: info.createdAt,
        appVersion: '',
        schemaVersion,
        bytes: info.bytes,
        counts,
        warnings:
          missing > 0
            ? [
                `${missing} photo${missing === 1 ? '' : 's'} this snapshot mentions ${missing === 1 ? 'is' : 'are'} no longer in the photos folder. ` +
                  `${missing === 1 ? 'It' : 'They'} will appear as missing.`,
              ]
            : [],
        current: this.currentCounts(),
      };
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
    }
  }

  async cancelRestore(token: string): Promise<void> {
    const item = this.staged.get(token);
    this.staged.delete(token);
    if (item?.kind === 'backup') await rm(item.backup.dir, { recursive: true, force: true });
    if (item?.kind === 'snapshot') await rm(item.dir, { recursive: true, force: true });
  }

  private async discardExpired(): Promise<void> {
    for (const [token, item] of this.staged) {
      if (Date.now() - item.createdAt > STAGED_BACKUP_TTL_MS) await this.cancelRestore(token);
    }
  }

  /**
   * Replaces the journal with a staged backup or snapshot. The current journal is moved, not deleted, into
   * backups/previous-journal-<time> (for a snapshot only the database: photos stay where they are). On any
   * failure the original journal is put back and reopened.
   */
  async restore(token: string): Promise<RestoreResult> {
    const item = this.staged.get(token);
    if (!item || item.kind === 'locked') {
      throw new UserFacingError('restore-expired', 'This restore has expired. Please choose the backup file again.');
    }
    this.staged.delete(token);
    const stagingDir = item.kind === 'backup' ? item.backup.dir : item.dir;
    const paths = this.current.paths;
    this.current.close();
    let swap;
    try {
      swap =
        item.kind === 'backup'
          ? await swapInStagedBackup(paths, stagingDir, this.clock())
          : await swapInDatabase(paths, join(stagingDir, DATABASE_FILE), this.clock());
    } catch (err) {
      this.current = Journal.open(this.root, this.options);
      await rm(stagingDir, { recursive: true, force: true });
      throw new UserFacingError(
        'restore-failed',
        `The ${item.kind} could not be restored (${(err as Error).message}). Your journal has not been changed.`,
      );
    }
    try {
      const restored = Journal.open(this.root, this.options);
      restored.refreshDerived();
      // A restored backup starts with an empty thumbnails folder, whatever its database says.
      if (item.kind === 'backup') restored.photos.forgetThumbnails();
      this.current = restored;
    } catch (err) {
      await swap.rollback();
      this.current = Journal.open(this.root, this.options);
      throw new UserFacingError(
        'restore-failed',
        `The restored journal could not be opened (${(err as Error).message}). Your previous journal has been put back.`,
      );
    } finally {
      await rm(stagingDir, { recursive: true, force: true });
    }
    return { previousDataPath: swap.previousDir };
  }

  async close(): Promise<void> {
    for (const token of [...this.staged.keys()]) await this.cancelRestore(token);
    this.current.close();
  }
}
