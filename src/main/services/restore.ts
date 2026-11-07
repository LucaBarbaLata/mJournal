/**
 * Swapping a validated, staged backup into the data folder.
 *
 * The current journal is never deleted or overwritten: its database and
 * photos are moved (renamed, which is instant on the same drive) into
 * backups/previous-journal-<time>/ before the restored files move in. If any
 * step fails, every move is undone in reverse order.
 */
import { existsSync } from 'node:fs';
import { mkdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataPaths } from '../paths';
import { fileStamp, renameWithRetry } from './fsutil';

export interface SwapResult {
  previousDir: string;
  /** Puts the original journal back. Safe to call once after a failed swap. */
  rollback(): Promise<void>;
}

async function previousJournalDir(paths: DataPaths, now: Date): Promise<string> {
  let previousDir = join(paths.backups, `previous-journal-${fileStamp(now)}`);
  for (let n = 2; existsSync(previousDir); n++) previousDir = join(paths.backups, `previous-journal-${fileStamp(now)}-${n}`);
  await mkdir(previousDir, { recursive: true });
  return previousDir;
}

/**
 * Puts a staged copy of the database in place (restoring a daily snapshot). Only the database moves into
 * backups/previous-journal-<time>: the photos folder stays as it is, because a snapshot doesn't hold photos.
 */
export async function swapInDatabase(paths: DataPaths, stagedDatabase: string, now: Date): Promise<SwapResult> {
  const previousDir = await previousJournalDir(paths, now);
  const moves: [from: string, to: string][] = [];
  const rollback = async () => {
    for (const [from, to] of moves.reverse()) await renameWithRetry(to, from);
    moves.length = 0;
  };
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const file = paths.database + suffix;
      if (existsSync(file)) {
        await renameWithRetry(file, join(previousDir, `mjournal.db${suffix}`));
        moves.push([file, join(previousDir, `mjournal.db${suffix}`)]);
      }
    }
    await renameWithRetry(stagedDatabase, paths.database);
    moves.push([stagedDatabase, paths.database]);
  } catch (err) {
    await rollback();
    throw err;
  }
  return { previousDir, rollback };
}

export async function swapInStagedBackup(paths: DataPaths, stagingDir: string, now: Date): Promise<SwapResult> {
  const previousDir = await previousJournalDir(paths, now);

  const moves: [from: string, to: string][] = [];
  const move = async (from: string, to: string) => {
    await renameWithRetry(from, to);
    moves.push([from, to]);
  };
  const rollback = async () => {
    for (const [from, to] of moves.reverse()) {
      // An empty placeholder folder may now sit where a moved one was; rmdir only removes empty folders.
      if (existsSync(from)) await rmdir(from).catch(() => undefined);
      await renameWithRetry(to, from);
    }
    moves.length = 0;
  };

  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const file = paths.database + suffix;
      if (existsSync(file)) await move(file, join(previousDir, `mjournal.db${suffix}`));
    }
    if (existsSync(paths.photos)) await move(paths.photos, join(previousDir, 'photos'));
    if (existsSync(paths.thumbnails)) await move(paths.thumbnails, join(previousDir, 'thumbnails'));

    await move(join(stagingDir, 'mjournal.db'), paths.database);
    const stagedPhotos = join(stagingDir, 'photos');
    if (existsSync(stagedPhotos)) await move(stagedPhotos, paths.photos);
    else await mkdir(paths.photos, { recursive: true });
    await mkdir(paths.thumbnails, { recursive: true });
  } catch (err) {
    await rollback();
    throw err;
  }
  return { previousDir, rollback };
}
