/**
 * Trackers (Settings → Trackers) and their answers on days. A tracker with answers is never deleted, only put
 * away (archived), so a day keeps what was recorded on it. Every change to a day's answers refreshes the day
 * (tracker_count, has_content) in the same transaction.
 */
import type { DayTrackerValue, TrackerInput, TrackerMonths, TrackerPatch, TrackerRecord, TrackerSummary } from '@core/api';
import { firstDayOfMonth, lastDayOfMonth, type DateKey, type MonthKey } from '@core/dates';
import {
  cleanTrackerLabel,
  isTrackerValue,
  MAX_ACTIVE_TRACKERS,
  MAX_TRACKERS,
  type TrackerKind,
} from '@core/trackers';
import { UserFacingError, ValidationError } from '@core/validation';
import type { Db } from './database';
import type { EntriesStore } from './entries';

interface TrackerRow {
  id: number;
  label: string;
  kind: TrackerKind;
  position: number;
  archived: number;
  days: number;
}

const LIST_SQL = `
  SELECT t.id, t.label, t.kind, t.position, t.archived,
    (SELECT COUNT(*) FROM tracker_values v WHERE v.tracker_id = t.id) AS days
  FROM trackers t`;

/** Active trackers first, in their order; then the ones put away. */
const ORDER = 'ORDER BY t.archived, t.position, t.id';

function toRecord(row: TrackerRow): TrackerRecord {
  return { id: row.id, label: row.label, kind: row.kind, position: row.position, archived: row.archived === 1, days: row.days };
}

interface SummaryRow {
  id: number;
  label: string;
  kind: TrackerKind;
  archived: number;
  days: number;
  yes: number;
  average: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function toSummary(row: SummaryRow): TrackerSummary {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    archived: row.archived === 1,
    days: row.days,
    yes: row.kind === 'check' ? row.yes : 0,
    average: row.kind === 'scale' && row.average !== null ? round1(row.average) : null,
  };
}

export class TrackerStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => string,
    private readonly entries: EntriesStore,
  ) {}

  list(): TrackerRecord[] {
    return this.db.all<TrackerRow>(`${LIST_SQL} ${ORDER}`).map(toRecord);
  }

  get(id: number): TrackerRecord {
    const row = this.db.get<TrackerRow>(`${LIST_SQL} WHERE t.id = ?`, [id]);
    if (!row) throw new UserFacingError('unknown-tracker', 'That tracker could not be found.');
    return toRecord(row);
  }

  private activeCount(): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM trackers WHERE archived = 0')!.n;
  }

  private validLabel(input: string, exceptId?: number): string {
    const label = cleanTrackerLabel(input);
    if (!label) throw new ValidationError('Please give the tracker a name.');
    const key = label.toLocaleLowerCase();
    const clash = this.db
      .all<{ id: number; label: string }>('SELECT id, label FROM trackers')
      .find((t) => t.id !== exceptId && t.label.toLocaleLowerCase() === key);
    if (clash) throw new UserFacingError('duplicate-tracker', `You already have a tracker called “${clash.label}”.`);
    return label;
  }

  create(input: TrackerInput): TrackerRecord {
    return this.db.transaction(() => {
      const label = this.validLabel(input.label);
      if (this.activeCount() >= MAX_ACTIVE_TRACKERS) {
        throw new UserFacingError('too-many-trackers', `Up to ${MAX_ACTIVE_TRACKERS} trackers can be on a day’s page. Put one away first.`);
      }
      const total = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM trackers')!.n;
      if (total >= MAX_TRACKERS) throw new UserFacingError('too-many-trackers', `You can keep up to ${MAX_TRACKERS} trackers.`);
      const now = this.now();
      const { lastInsertRowid } = this.db.run(
        `INSERT INTO trackers (label, kind, position, created_at, updated_at)
         VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM trackers), ?, ?)`,
        [label, input.kind, now, now],
      );
      return this.get(lastInsertRowid);
    });
  }

  /** Renames a tracker, puts it away or brings it back. Its kind can change only while it has no answers. */
  update(id: number, patch: TrackerPatch): TrackerRecord {
    return this.db.transaction(() => {
      const current = this.get(id);
      const label = patch.label === undefined ? current.label : this.validLabel(patch.label, id);
      if (patch.kind !== undefined && patch.kind !== current.kind && current.days > 0) {
        throw new UserFacingError(
          'tracker-in-use',
          `“${current.label}” already has answers, so it can’t change from ${current.kind === 'check' ? 'yes or no' : 'a scale'}. Add a new tracker instead.`,
        );
      }
      const archived = patch.archived ?? current.archived;
      if (current.archived && !archived && this.activeCount() >= MAX_ACTIVE_TRACKERS) {
        throw new UserFacingError('too-many-trackers', `Up to ${MAX_ACTIVE_TRACKERS} trackers can be on a day’s page. Put one away first.`);
      }
      // A tracker brought back goes to the end of the list.
      const position =
        current.archived && !archived
          ? this.db.get<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM trackers WHERE archived = 0')!.p
          : current.position;
      this.db.run('UPDATE trackers SET label = ?, kind = ?, archived = ?, position = ?, updated_at = ? WHERE id = ?', [
        label,
        patch.kind ?? current.kind,
        archived ? 1 : 0,
        position,
        this.now(),
        id,
      ]);
      return this.get(id);
    });
  }

  /** Puts the active trackers in this order (the ones put away keep theirs). */
  reorder(ids: number[]): TrackerRecord[] {
    const active = this.db.all<{ id: number }>('SELECT id FROM trackers WHERE archived = 0').map((r) => r.id);
    const unique = new Set(ids);
    if (unique.size !== ids.length || ids.length !== active.length || !active.every((id) => unique.has(id))) {
      throw new UserFacingError('invalid-order', 'Could not reorder the trackers. Please try again.');
    }
    this.db.transaction(() => {
      ids.forEach((id, position) => this.db.run('UPDATE trackers SET position = ? WHERE id = ?', [position, id]));
    });
    return this.list();
  }

  /** Deletes a tracker that was never answered (or whose answers were all cleared). */
  remove(id: number): void {
    this.db.transaction(() => {
      const tracker = this.get(id);
      if (tracker.days > 0) {
        throw new UserFacingError('tracker-in-use', `“${tracker.label}” has answers on ${tracker.days === 1 ? 'a day' : `${tracker.days} days`}. Put it away instead, so they’re kept.`);
      }
      this.db.run('DELETE FROM trackers WHERE id = ?', [id]);
    });
  }

  forDay(date: DateKey): DayTrackerValue[] {
    return this.db
      .all<{ tracker_id: number; value: number }>(
        `SELECT v.tracker_id, v.value FROM tracker_values v JOIN trackers t ON t.id = v.tracker_id
         WHERE v.entry_date = ? ORDER BY t.archived, t.position, t.id`,
        [date],
      )
      .map((r) => ({ trackerId: r.tracker_id, value: r.value }));
  }

  /**
   * Answers a tracker for a day, or clears the answer (null). A tracker that was put away can still be changed
   * on the days that already have an answer for it, but not answered on new ones.
   */
  setForDay(date: DateKey, id: number, value: number | null): DayTrackerValue[] {
    return this.db.transaction(() => {
      const tracker = this.get(id);
      if (value === null) {
        const { changes } = this.db.run('DELETE FROM tracker_values WHERE entry_date = ? AND tracker_id = ?', [date, id]);
        if (changes > 0) this.dayChanged(date);
        return this.forDay(date);
      }
      if (!isTrackerValue(tracker.kind, value)) throw new ValidationError('Invalid answer.');
      const has = this.db.get('SELECT 1 AS x FROM tracker_values WHERE entry_date = ? AND tracker_id = ?', [date, id]);
      if (tracker.archived && !has) {
        throw new UserFacingError('tracker-archived', `“${tracker.label}” was put away. Bring it back in Settings → Trackers to use it.`);
      }
      this.entries.ensure(date);
      this.db.run(
        `INSERT INTO tracker_values (entry_date, tracker_id, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (entry_date, tracker_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [date, id, value, this.now()],
      );
      this.dayChanged(date);
      return this.forDay(date);
    });
  }

  /**
   * Puts back an answer from a day in Recently removed: only if the tracker still exists, the answer fits it and
   * the day has no answer of its own for it by now. Works for trackers that were put away meanwhile, too.
   */
  restoreValue(date: DateKey, id: number, value: number): void {
    const tracker = this.db.get<{ kind: TrackerKind }>('SELECT kind FROM trackers WHERE id = ?', [id]);
    if (!tracker || !isTrackerValue(tracker.kind, value)) return;
    this.entries.ensure(date);
    this.db.run(
      `INSERT INTO tracker_values (entry_date, tracker_id, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (entry_date, tracker_id) DO NOTHING`,
      [date, id, value, this.now()],
    );
  }

  private dayChanged(date: DateKey): void {
    this.db.run('UPDATE entries SET updated_at = ? WHERE date = ?', [this.now(), date]);
    this.entries.refresh(date);
  }

  /** What was recorded for each tracker between two days (only trackers with answers), in list order. */
  summaries(from: DateKey, to: DateKey): TrackerSummary[] {
    return this.db
      .all<SummaryRow>(
        `SELECT t.id, t.label, t.kind, t.archived, COUNT(*) AS days,
           SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END) AS yes, AVG(v.value) AS average
         FROM tracker_values v JOIN trackers t ON t.id = v.tracker_id
         WHERE v.entry_date BETWEEN ? AND ?
         GROUP BY t.id ORDER BY t.archived, t.position, t.id`,
        [from, to],
      )
      .map(toSummary);
  }

  /** For each tracker answered in these months: days, yes-days and the average, month by month. */
  byMonth(months: MonthKey[]): TrackerMonths[] {
    if (months.length === 0) return [];
    const rows = this.db.all<{ id: number; label: string; kind: TrackerKind; month: string; days: number; yes: number; average: number }>(
      `SELECT t.id, t.label, t.kind, substr(v.entry_date, 1, 7) AS month, COUNT(*) AS days,
         SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END) AS yes, AVG(v.value) AS average
       FROM tracker_values v JOIN trackers t ON t.id = v.tracker_id
       WHERE v.entry_date BETWEEN ? AND ?
       GROUP BY t.id, month ORDER BY t.archived, t.position, t.id`,
      [firstDayOfMonth(months[0]), lastDayOfMonth(months[months.length - 1])],
    );
    const byTracker = new Map<number, { label: string; kind: TrackerKind; perMonth: Map<string, (typeof rows)[number]> }>();
    for (const row of rows) {
      const tracker = byTracker.get(row.id) ?? { label: row.label, kind: row.kind, perMonth: new Map() };
      tracker.perMonth.set(row.month, row);
      byTracker.set(row.id, tracker);
    }
    return [...byTracker].map(([id, { label, kind, perMonth }]) => ({
      id,
      label,
      kind,
      months: months.map((month) => {
        const row = perMonth.get(month);
        if (!row) return { month, days: 0, yes: 0, average: null };
        return {
          month,
          days: row.days,
          yes: row.kind === 'check' ? row.yes : 0,
          average: row.kind === 'scale' ? round1(row.average) : null,
        };
      }),
    }));
  }
}
