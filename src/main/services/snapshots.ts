/**
 * Automatic safety snapshots: a daily copy of the database (text, moods,
 * settings, photo references) in backups/automatic. Photo files are not
 * copied here; they are never deleted silently, and full backups include them.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Journal } from '../journal';
import { fileStamp } from './fsutil';

export const SNAPSHOT_PREFIX = 'mJournal-snapshot-';
export const SNAPSHOTS_KEPT = 10;
const SNAPSHOT_INTERVAL_MS = 20 * 60 * 60 * 1000;

export interface SnapshotInfo {
  name: string;
  createdAt: string;
  bytes: number;
}

export function listSnapshots(dir: string): SnapshotInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith('mJournal-') && name.endsWith('.db'))
    .map((name) => {
      const info = statSync(join(dir, name));
      return { name, createdAt: info.mtime.toISOString(), bytes: info.size };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function takeSnapshot(journal: Journal): string {
  const dir = journal.paths.snapshots;
  mkdirSync(dir, { recursive: true });
  let target = join(dir, `${SNAPSHOT_PREFIX}${fileStamp(journal.clock())}.db`);
  for (let n = 2; existsSync(target); n++) target = join(dir, `${SNAPSHOT_PREFIX}${fileStamp(journal.clock())}-${n}.db`);
  journal.db.snapshotTo(target);
  journal.settings.setInternal('lastSnapshotAt', journal.clock().toISOString());
  pruneSnapshots(dir);
  return target;
}

/** Keeps the newest automatic snapshots. Pre-migration snapshots are never pruned. */
export function pruneSnapshots(dir: string, keep = SNAPSHOTS_KEPT): void {
  const automatic = listSnapshots(dir).filter((s) => s.name.startsWith(SNAPSHOT_PREFIX));
  for (const old of automatic.slice(keep)) rmSync(join(dir, old.name), { force: true });
}

/** Takes the daily snapshot if it is enabled and the last one is old enough. */
export function maybeTakeDailySnapshot(journal: Journal): string | null {
  if (!journal.settings.get().autoSnapshots) return null;
  const hasEntries = journal.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM entries')!.n > 0;
  if (!hasEntries) return null;
  const last = journal.settings.getInternal<string>('lastSnapshotAt');
  if (last && journal.clock().getTime() - new Date(last).getTime() < SNAPSHOT_INTERVAL_MS) return null;
  return takeSnapshot(journal);
}
