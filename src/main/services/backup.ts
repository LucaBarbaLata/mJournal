/**
 * Complete backups: one .zip holding a manifest, a consistent copy of the
 * database and every photo file.
 *
 * Restoring is deliberately paranoid. An archive is only accepted when every
 * entry name is on an allowlist (so absolute paths, "..", symlinks and stray
 * files are rejected), its contents match the manifest exactly, every file's
 * SHA-256 matches, and the extracted database passes SQLite's integrity check.
 * All of this happens in a staging folder; the live journal is untouched
 * until the user confirms (see restore.ts).
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { UserFacingError } from '@core/validation';
import type { Journal } from '../journal';
import { Db } from '../store/database';
import { renameWithRetry } from './fsutil';

export const BACKUP_KIND = 'mjournal-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const MANIFEST_NAME = 'mjournal-backup.json';
export const DATABASE_NAME = 'mjournal.db';
const PHOTO_ENTRY_RE = /^photos\/([0-9a-f]{2})\/([0-9a-f]{64})\.(jpg|png|webp|gif|avif)$/;
const DIRECTORY_ENTRY_RE = /^photos\/([0-9a-f]{2}\/)?$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 200_000;
const MAX_TOTAL_BYTES = 64 * 1024 ** 3;
const REQUIRED_TABLES = ['entries', 'answers', 'photos', 'moods', 'monthly_reflections', 'settings', 'daily_prompts'];

export interface BackupManifest {
  app: 'mJournal';
  kind: typeof BACKUP_KIND;
  formatVersion: number;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  counts: { entries: number; photos: number; monthlyReflections: number };
  database: { path: typeof DATABASE_NAME; sha256: string; bytes: number };
  photos: { path: string; sha256: string; bytes: number }[];
  /** Photo files the database refers to that were missing or damaged when the backup was made. */
  missingPhotos: string[];
}

export class BackupError extends UserFacingError {}

const notRestored = 'Nothing was restored and your journal has not been changed.';

async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

function countRows(dbPath: string): BackupManifest['counts'] {
  const db = Db.open(dbPath);
  try {
    const n = (sql: string) => db.get<{ n: number }>(sql)!.n;
    return {
      entries: n('SELECT COUNT(*) AS n FROM entries WHERE has_content'),
      photos: n('SELECT COUNT(*) AS n FROM photos WHERE removed_at IS NULL'),
      monthlyReflections: n("SELECT COUNT(DISTINCT month) AS n FROM monthly_reflections WHERE answer <> ''"),
    };
  } finally {
    db.close();
  }
}

/** Writes a complete backup to `target`. The file only appears once it is complete. */
export async function writeBackup(
  journal: Journal,
  target: string,
  appVersion: string,
): Promise<{ bytes: number; manifest: BackupManifest }> {
  await mkdir(journal.paths.temp, { recursive: true });
  const temp = await mkdtemp(join(journal.paths.temp, 'backup-'));
  const partial = `${target}.partial`;
  try {
    const dbCopy = join(temp, DATABASE_NAME);
    journal.db.snapshotTo(dbCopy);
    const counts = countRows(dbCopy);
    const database = await hashFile(dbCopy);

    const photos: BackupManifest['photos'] = [];
    const missingPhotos: string[] = [];
    for (const { file, sha256 } of journal.photos.referencedFiles()) {
      const entryPath = `photos/${file}`;
      try {
        const actual = await hashFile(journal.photos.files.absolute(file));
        if (actual.sha256 === sha256) photos.push({ path: entryPath, sha256, bytes: actual.bytes });
        else missingPhotos.push(entryPath);
      } catch {
        missingPhotos.push(entryPath);
      }
    }

    const manifest: BackupManifest = {
      app: 'mJournal',
      kind: BACKUP_KIND,
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion,
      schemaVersion: journal.db.userVersion,
      createdAt: journal.clock().toISOString(),
      counts,
      database: { path: DATABASE_NAME, sha256: database.sha256, bytes: database.bytes },
      photos,
      missingPhotos,
    };

    const zip = new yazl.ZipFile();
    const mtime = journal.clock();
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), MANIFEST_NAME, { mtime });
    zip.addFile(dbCopy, DATABASE_NAME, { mtime });
    for (const photo of photos) {
      // Photos are already compressed; storing them as-is keeps backups fast.
      zip.addFile(journal.photos.files.absolute(photo.path.slice('photos/'.length)), photo.path, {
        compress: false,
        mtime,
      });
    }
    zip.end();
    await pipeline(zip.outputStream, createWriteStream(partial));
    const handle = await open(partial, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(partial, target);
    return { bytes: (await stat(target)).size, manifest };
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Reading and validating a backup

export interface StagedBackup {
  dir: string;
  fileName: string;
  bytes: number;
  manifest: BackupManifest;
  warnings: string[];
}

function isSymlink(entry: yauzl.Entry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0o170000;
  return unixMode === 0o120000;
}

function listEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    zip.on('entry', (entry: yauzl.Entry) => {
      entries.push(entry);
      if (entries.length > MAX_ENTRIES) {
        reject(new BackupError('too-many-files', `This backup contains too many files. ${notRestored}`));
        return;
      }
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', (err: Error) =>
      reject(new BackupError('unsafe-archive', `This backup contains an unsafe or damaged file name (${err.message}). ${notRestored}`)),
    );
    zip.readEntry();
  });
}

function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)));
  });
}

async function readEntryText(zip: yauzl.ZipFile, entry: yauzl.Entry, limit: number): Promise<string> {
  if (entry.uncompressedSize > limit) throw new BackupError('manifest-too-large', `The backup manifest is too large. ${notRestored}`);
  const stream = await openEntry(zip, entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new BackupError('manifest-too-large', `The backup manifest is too large. ${notRestored}`);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Copies one archive entry to `target`, verifying its size and SHA-256 on the way. */
async function extractVerified(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
  target: string,
  expected: { sha256: string; bytes: number },
): Promise<void> {
  const hash = createHash('sha256');
  let bytes = 0;
  const verify = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > expected.bytes) {
        callback(new Error('Entry is larger than its manifest says.'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(await openEntry(zip, entry), verify, createWriteStream(target, { flags: 'wx' }));
  } catch {
    throw new BackupError('damaged-file', `A file in this backup is damaged or incomplete (${entry.fileName}). ${notRestored}`);
  }
  if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256) {
    throw new BackupError('damaged-file', `A file in this backup failed its integrity check (${entry.fileName}). ${notRestored}`);
  }
}

function parseManifest(text: string, latestSchema: number): BackupManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BackupError('bad-manifest', `The backup manifest is not readable. ${notRestored}`);
  }
  const bad = () => new BackupError('bad-manifest', `The backup manifest is incomplete or malformed. ${notRestored}`);
  if (typeof value !== 'object' || value === null) throw bad();
  const m = value as Partial<BackupManifest>;
  if (m.app !== 'mJournal' || m.kind !== BACKUP_KIND) {
    throw new BackupError('not-a-backup', `This file isn't an mJournal backup. ${notRestored}`);
  }
  if (typeof m.formatVersion !== 'number' || m.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupError('newer-version', `This backup was made by a newer version of mJournal. Please update mJournal first. ${notRestored}`);
  }
  if (!Number.isInteger(m.schemaVersion) || (m.schemaVersion as number) < 1) throw bad();
  if ((m.schemaVersion as number) > latestSchema) {
    throw new BackupError('newer-version', `This backup was made by a newer version of mJournal. Please update mJournal first. ${notRestored}`);
  }
  const isFileInfo = (f: unknown): f is { path: string; sha256: string; bytes: number } =>
    typeof f === 'object' &&
    f !== null &&
    typeof (f as { path: unknown }).path === 'string' &&
    typeof (f as { sha256: unknown }).sha256 === 'string' &&
    SHA_RE.test((f as { sha256: string }).sha256) &&
    Number.isInteger((f as { bytes: unknown }).bytes) &&
    (f as { bytes: number }).bytes >= 0;
  if (!isFileInfo(m.database) || m.database.path !== DATABASE_NAME) throw bad();
  if (!Array.isArray(m.photos) || !m.photos.every(isFileInfo)) throw bad();
  for (const photo of m.photos) {
    const match = PHOTO_ENTRY_RE.exec(photo.path);
    // Photo files are named after their content hash; the two must agree.
    if (!match || match[2] !== photo.sha256 || match[1] !== photo.sha256.slice(0, 2)) throw bad();
  }
  if (typeof m.createdAt !== 'string' || typeof m.appVersion !== 'string') throw bad();
  const counts = m.counts ?? { entries: 0, photos: 0, monthlyReflections: 0 };
  return {
    ...(m as BackupManifest),
    counts: {
      entries: Number(counts.entries) || 0,
      photos: Number(counts.photos) || 0,
      monthlyReflections: Number(counts.monthlyReflections) || 0,
    },
    missingPhotos: Array.isArray(m.missingPhotos) ? m.missingPhotos.filter((p) => typeof p === 'string') : [],
  };
}

/**
 * Validates `archive` and extracts it into a new folder under `stagingRoot`.
 * Throws BackupError (and removes the staging folder) if anything is wrong.
 */
export async function stageBackup(archive: string, stagingRoot: string, latestSchema: number): Promise<StagedBackup> {
  let info;
  try {
    info = await stat(archive);
  } catch {
    throw new BackupError('not-found', 'That backup file could not be opened.');
  }
  if (!info.isFile() || info.size === 0) throw new BackupError('not-a-backup', `This file isn't an mJournal backup. ${notRestored}`);

  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.openPromise(archive, {
      lazyEntries: true,
      autoClose: false,
      strictFileNames: true,
      validateEntrySizes: true,
      decodeStrings: true,
    });
  } catch {
    throw new BackupError('not-a-backup', `This file isn't an mJournal backup (it is not a readable zip archive). ${notRestored}`);
  }

  await mkdir(stagingRoot, { recursive: true });
  const dir = await mkdtemp(join(stagingRoot, 'restore-'));
  try {
    const entries = await listEntries(zip);
    const files = new Map<string, yauzl.Entry>();
    let total = 0;
    for (const entry of entries) {
      const name = entry.fileName;
      if (entry.isEncrypted()) throw new BackupError('unsafe-archive', `This backup contains encrypted files. ${notRestored}`);
      if (isSymlink(entry)) throw new BackupError('unsafe-archive', `This backup contains a link to another location. ${notRestored}`);
      if (DIRECTORY_ENTRY_RE.test(name)) continue;
      if (name !== MANIFEST_NAME && name !== DATABASE_NAME && !PHOTO_ENTRY_RE.test(name)) {
        throw new BackupError('unexpected-file', `This backup contains an unexpected file ("${name.slice(0, 80)}"). ${notRestored}`);
      }
      if (files.has(name)) throw new BackupError('unsafe-archive', `This backup lists the same file twice. ${notRestored}`);
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
        throw new BackupError('unsafe-archive', `This backup uses an unsupported compression method. ${notRestored}`);
      }
      total += entry.uncompressedSize;
      if (total > MAX_TOTAL_BYTES) throw new BackupError('too-large', `This backup is too large to restore. ${notRestored}`);
      files.set(name, entry);
    }

    const manifestEntry = files.get(MANIFEST_NAME);
    const dbEntry = files.get(DATABASE_NAME);
    if (!manifestEntry || !dbEntry) {
      throw new BackupError('not-a-backup', `This file isn't a complete mJournal backup. ${notRestored}`);
    }
    const manifest = parseManifest(await readEntryText(zip, manifestEntry, MAX_MANIFEST_BYTES), latestSchema);

    const listed = new Map(manifest.photos.map((p) => [p.path, p]));
    const archived = [...files.keys()].filter((name) => PHOTO_ENTRY_RE.test(name));
    if (archived.length !== listed.size || archived.some((name) => !listed.has(name))) {
      throw new BackupError('mismatch', `The files in this backup don't match its manifest. ${notRestored}`);
    }
    if (dbEntry.uncompressedSize !== manifest.database.bytes) {
      throw new BackupError('mismatch', `The database in this backup doesn't match its manifest. ${notRestored}`);
    }

    await extractVerified(zip, dbEntry, join(dir, DATABASE_NAME), manifest.database);
    for (const photo of manifest.photos) {
      const entry = files.get(photo.path)!;
      if (entry.uncompressedSize !== photo.bytes) {
        throw new BackupError('mismatch', `The files in this backup don't match its manifest. ${notRestored}`);
      }
      const [, prefix, hash, ext] = PHOTO_ENTRY_RE.exec(photo.path)!;
      await mkdir(join(dir, 'photos', prefix), { recursive: true });
      await extractVerified(zip, entry, join(dir, 'photos', prefix, `${hash}.${ext}`), photo);
    }

    const warnings = verifyStagedDatabase(join(dir, DATABASE_NAME), manifest, dir);
    return { dir, fileName: basename(archive), bytes: info.size, manifest, warnings };
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    if (err instanceof BackupError) throw err;
    throw new BackupError('damaged', `This backup could not be read (${(err as Error).message}). ${notRestored}`);
  } finally {
    zip.close();
  }
}

/** Opens the extracted database and checks it is intact and complete. Returns warnings. */
function verifyStagedDatabase(path: string, manifest: BackupManifest, dir: string): string[] {
  let db: Db;
  try {
    db = Db.open(path);
  } catch {
    throw new BackupError('damaged', `The database in this backup can't be opened. ${notRestored}`);
  }
  try {
    if (db.integrityCheck() !== 'ok') {
      throw new BackupError('damaged', `The database in this backup is damaged. ${notRestored}`);
    }
    if (db.userVersion !== manifest.schemaVersion) {
      throw new BackupError('mismatch', `The database version doesn't match the backup manifest. ${notRestored}`);
    }
    const tables = new Set(
      db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name),
    );
    if (!REQUIRED_TABLES.every((t) => tables.has(t))) {
      throw new BackupError('damaged', `The database in this backup is incomplete. ${notRestored}`);
    }
    const referenced = db.all<{ file: string }>('SELECT DISTINCT file FROM photos');
    const missing = referenced.filter(({ file }) => !existsSync(join(dir, 'photos', ...file.split('/')))).length;
    const warnings: string[] = [];
    if (missing > 0) {
      warnings.push(
        `${missing} photo${missing === 1 ? ' was' : 's were'} already missing when this backup was made. ` +
          'They will appear as missing photos.',
      );
    }
    return warnings;
  } finally {
    db.close();
  }
}
