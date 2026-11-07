/**
 * Automatic safety snapshots: a daily copy of the database (text, moods,
 * settings, photo references) in backups/automatic. Photo files are not
 * copied here; they are never deleted silently, and full backups include them.
 *
 * mJournal checks about every hour while it runs, so a copy is made at most
 * once a day even when it stays open for weeks. Older copies thin out: the
 * newest of each of the last 7 days, 4 weeks and 6 months that have one are kept.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { addDays, makeDateKey, weekday, type DateKey } from '@core/dates';
import type { Journal } from '../journal';
import { fileStamp } from './fsutil';

export const SNAPSHOT_PREFIX = 'mJournal-snapshot-';
export const SNAPSHOT_RETENTION = { days: 7, weeks: 4, months: 6 } as const;
const SNAPSHOT_INTERVAL_MS = 20 * 60 * 60 * 1000;
/** How often a running mJournal checks whether a snapshot is due. */
export const SNAPSHOT_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** "mJournal-snapshot-2026-10-24-2041.db", optionally with "-2" for a second copy in the same minute. */
const SNAPSHOT_NAME_RE = /^mJournal-snapshot-(\d{4})-(\d{2})-(\d{2})-(\d{4})(?:-(\d{1,4}))?\.db$/;

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

/** The day an automatic snapshot was taken (from its name) and a key that sorts newer copies later. */
function snapshotStamp(name: string): { day: DateKey; order: string } | null {
  const match = SNAPSHOT_NAME_RE.exec(name);
  if (!match) return null;
  const [, year, month, day, time, copy] = match;
  return {
    day: makeDateKey(Number(year), Number(month), Number(day)),
    order: `${year}-${month}-${day}-${time}-${(copy ?? '1').padStart(4, '0')}`,
  };
}

/**
 * Names of the automatic snapshots to keep: the newest of each of the last
 * `days` days, `weeks` weeks (starting on Monday) and `months` months that
 * have one. Names that don't look like automatic snapshots are always kept.
 */
export function snapshotsToKeep(names: readonly string[], retention = SNAPSHOT_RETENTION): Set<string> {
  const keep = new Set<string>();
  const dated: { name: string; day: DateKey; order: string }[] = [];
  for (const name of names) {
    const stamp = snapshotStamp(name);
    if (stamp) dated.push({ name, ...stamp });
    else keep.add(name);
  }
  dated.sort((a, b) => b.order.localeCompare(a.order));
  const days = new Set<string>();
  const weeks = new Set<string>();
  const months = new Set<string>();
  for (const { name, day } of dated) {
    const week = addDays(day, -((weekday(day) + 6) % 7));
    const month = day.slice(0, 7);
    let kept = false;
    if (!days.has(day) && days.size < retention.days) {
      days.add(day);
      kept = true;
    }
    if (!weeks.has(week) && weeks.size < retention.weeks) {
      weeks.add(week);
      kept = true;
    }
    if (!months.has(month) && months.size < retention.months) {
      months.add(month);
      kept = true;
    }
    if (kept) keep.add(name);
  }
  return keep;
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

/** Thins out the automatic snapshots (see snapshotsToKeep). Pre-migration snapshots are never pruned. */
export function pruneSnapshots(dir: string, retention = SNAPSHOT_RETENTION): void {
  const automatic = listSnapshots(dir)
    .map((s) => s.name)
    .filter((name) => name.startsWith(SNAPSHOT_PREFIX));
  const keep = snapshotsToKeep(automatic, retention);
  for (const name of automatic) if (!keep.has(name)) rmSync(join(dir, name), { force: true });
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
