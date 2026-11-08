import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isTrackerValue, MAX_ACTIVE_TRACKERS, trackerValueLabel } from '@core/trackers';
import { Journal } from '../../src/main/journal';
import { buildCsv, buildJsonExport } from '../../src/main/services/exporter';
import { Db } from '../../src/main/store/database';
import { MIGRATIONS, migrate } from '../../src/main/store/migrations';
import { fakeClock, openJournal, reopen, tempDir } from './helpers';

describe('tracker answers', () => {
  it('fit the kind of tracker', () => {
    expect(isTrackerValue('check', 1)).toBe(true);
    expect(isTrackerValue('check', 0)).toBe(true);
    expect(isTrackerValue('check', 2)).toBe(false);
    expect(isTrackerValue('scale', 0)).toBe(false);
    expect(isTrackerValue('scale', 5)).toBe(true);
    expect(isTrackerValue('scale', 3.5)).toBe(false);
    expect(trackerValueLabel('check', 0)).toBe('No');
    expect(trackerValueLabel('scale', 4)).toBe('4 of 5');
  });
});

describe('trackers', () => {
  it('are created in order, with tidy and unique names', () => {
    const j = openJournal();
    const outside = j.trackers.create({ label: '  Went   outside ', kind: 'check' });
    const sleep = j.trackers.create({ label: 'Sleep', kind: 'scale' });
    expect(outside).toMatchObject({ label: 'Went outside', kind: 'check', archived: false, days: 0 });
    expect(j.trackers.list().map((t) => t.label)).toEqual(['Went outside', 'Sleep']);
    expect(() => j.trackers.create({ label: 'sleep', kind: 'check' })).toThrow(/already have a tracker/);
    expect(() => j.trackers.create({ label: '   ', kind: 'check' })).toThrow(/name/);
    expect(j.trackers.reorder([sleep.id, outside.id]).map((t) => t.label)).toEqual(['Sleep', 'Went outside']);
    expect(() => j.trackers.reorder([sleep.id])).toThrow(/reorder/);
  });

  it('keep the day page calm: at most a few are active', () => {
    const j = openJournal();
    for (let i = 0; i < MAX_ACTIVE_TRACKERS; i++) j.trackers.create({ label: `Tracker ${i}`, kind: 'check' });
    expect(() => j.trackers.create({ label: 'One more', kind: 'check' })).toThrow(/Put one away/);
    const first = j.trackers.list()[0];
    j.trackers.update(first.id, { archived: true });
    const extra = j.trackers.create({ label: 'One more', kind: 'scale' });
    expect(() => j.trackers.update(first.id, { archived: false })).toThrow(/Put one away/);
    j.trackers.update(extra.id, { archived: true });
    // Brought back at the end of the list.
    expect(j.trackers.update(first.id, { archived: false }).position).toBe(MAX_ACTIVE_TRACKERS);
  });

  it('answer a day, count it as journaled on their own, and clear again', () => {
    const j = openJournal();
    const outside = j.trackers.create({ label: 'Went outside', kind: 'check' });
    const sleep = j.trackers.create({ label: 'Sleep', kind: 'scale' });
    expect(j.trackers.setForDay('2026-10-24', outside.id, 0)).toEqual([{ trackerId: outside.id, value: 0 }]);
    // Even a "no" is something recorded.
    expect(j.entries.contentDays()).toEqual(['2026-10-24']);
    j.trackers.setForDay('2026-10-24', sleep.id, 4);
    j.trackers.setForDay('2026-10-24', outside.id, 1);
    expect(j.trackers.forDay('2026-10-24')).toEqual([
      { trackerId: outside.id, value: 1 },
      { trackerId: sleep.id, value: 4 },
    ]);
    expect(() => j.trackers.setForDay('2026-10-24', sleep.id, 0)).toThrow(/Invalid answer/);
    expect(() => j.trackers.setForDay('2026-10-24', outside.id, 3)).toThrow(/Invalid answer/);
    expect(() => j.trackers.setForDay('2026-10-24', 999, 1)).toThrow(/could not be found/);
    expect(j.trackers.list().map((t) => t.days)).toEqual([1, 1]);

    j.trackers.setForDay('2026-10-24', outside.id, null);
    j.trackers.setForDay('2026-10-24', sleep.id, null);
    expect(j.trackers.forDay('2026-10-24')).toEqual([]);
    expect(j.entries.contentDays()).toEqual([]);
    expect(j.stats.streak('2026-10-24').current).toBe(0);
  });

  it('with answers are put away, never deleted, and keep their kind', () => {
    const j = openJournal();
    const meds = j.trackers.create({ label: 'Took my medicine', kind: 'check' });
    const unused = j.trackers.create({ label: 'Typo', kind: 'check' });
    expect(j.trackers.update(unused.id, { kind: 'scale' }).kind).toBe('scale');
    j.trackers.remove(unused.id);
    expect(j.trackers.list().map((t) => t.label)).toEqual(['Took my medicine']);

    j.trackers.setForDay('2026-10-23', meds.id, 1);
    expect(() => j.trackers.remove(meds.id)).toThrow(/Put it away instead/);
    expect(() => j.trackers.update(meds.id, { kind: 'scale' })).toThrow(/already has answers/);
    expect(j.trackers.update(meds.id, { label: 'Medicine' }).label).toBe('Medicine');

    j.trackers.update(meds.id, { archived: true });
    // Its answers stay, and can still be changed on the days that have one — but not given on new days.
    expect(j.trackers.forDay('2026-10-23')).toEqual([{ trackerId: meds.id, value: 1 }]);
    j.trackers.setForDay('2026-10-23', meds.id, 0);
    expect(() => j.trackers.setForDay('2026-10-24', meds.id, 1)).toThrow(/put away/);
    expect(j.trackers.list()).toMatchObject([{ label: 'Medicine', archived: true, days: 1 }]);
  });

  it('go to Recently removed with their day and come back without overwriting newer answers', () => {
    const j = openJournal();
    const outside = j.trackers.create({ label: 'Went outside', kind: 'check' });
    const sleep = j.trackers.create({ label: 'Sleep', kind: 'scale' });
    j.trackers.setForDay('2026-10-24', outside.id, 1);
    j.trackers.setForDay('2026-10-24', sleep.id, 2);
    const removedId = j.removedDays.remove('2026-10-24');
    expect(removedId).not.toBeNull();
    expect(j.trackers.forDay('2026-10-24')).toEqual([]);
    expect(j.entries.contentDays()).toEqual([]);

    // Meanwhile: a new answer on that day, and one tracker put away.
    j.trackers.setForDay('2026-10-24', sleep.id, 5);
    j.trackers.update(outside.id, { archived: true });
    j.removedDays.restore(removedId!);
    expect(j.trackers.forDay('2026-10-24')).toEqual([
      { trackerId: sleep.id, value: 5 },
      { trackerId: outside.id, value: 1 },
    ]);
  });

  it('keeps a day with only tracker answers in Recently removed', () => {
    const j = openJournal();
    const outside = j.trackers.create({ label: 'Went outside', kind: 'check' });
    j.trackers.setForDay('2026-10-24', outside.id, 0);
    const id = j.removedDays.remove('2026-10-24');
    expect(id).not.toBeNull();
    j.removedDays.restore(id!);
    expect(j.trackers.forDay('2026-10-24')).toEqual([{ trackerId: outside.id, value: 0 }]);
  });

  it('are summed up for a period, month by month, and in the monthly recap', () => {
    const j = openJournal(tempDir(), fakeClock('2026-10-24T18:00:00Z'));
    const outside = j.trackers.create({ label: 'Went outside', kind: 'check' });
    const sleep = j.trackers.create({ label: 'Sleep', kind: 'scale' });
    j.trackers.create({ label: 'Never answered', kind: 'check' });
    j.trackers.setForDay('2026-09-30', outside.id, 1);
    j.trackers.setForDay('2026-10-01', outside.id, 1);
    j.trackers.setForDay('2026-10-02', outside.id, 0);
    j.trackers.setForDay('2026-10-03', outside.id, 1);
    j.trackers.setForDay('2026-10-01', sleep.id, 3);
    j.trackers.setForDay('2026-10-02', sleep.id, 4);
    j.trackers.setForDay('2026-10-03', sleep.id, 4);

    const month = j.stats.overview('2026-10-24', 'month');
    expect(month.trackers).toEqual([
      { id: outside.id, label: 'Went outside', kind: 'check', archived: false, days: 3, yes: 2, average: null },
      { id: sleep.id, label: 'Sleep', kind: 'scale', archived: false, days: 3, yes: 0, average: 3.7 },
    ]);
    const history = month.trackersByMonth;
    expect(history.map((t) => t.label)).toEqual(['Went outside', 'Sleep']);
    expect(history[0].months).toHaveLength(12);
    expect(history[0].months.slice(-2)).toEqual([
      { month: '2026-09', days: 1, yes: 1, average: null },
      { month: '2026-10', days: 3, yes: 2, average: null },
    ]);
    expect(history[1].months.at(-1)).toEqual({ month: '2026-10', days: 3, yes: 0, average: 3.7 });

    expect(j.reflections.recap('2026-09').trackers).toMatchObject([{ label: 'Went outside', days: 1, yes: 1 }]);
    expect(j.reflections.recap('2026-10').trackers.map((t) => t.label)).toEqual(['Went outside', 'Sleep']);
  });

  it('are part of exports', () => {
    const j = openJournal();
    const outside = j.trackers.create({ label: 'Went outside', kind: 'check' });
    const sleep = j.trackers.create({ label: 'Sleep', kind: 'scale' });
    j.trackers.setForDay('2026-10-24', outside.id, 0);
    j.trackers.setForDay('2026-10-24', sleep.id, 4);
    const json = buildJsonExport(j, '1.3.0');
    expect(json.entries[0].trackers).toEqual([
      { tracker: 'Went outside', kind: 'check', value: 0, valueLabel: 'No' },
      { tracker: 'Sleep', kind: 'scale', value: 4, valueLabel: '4 of 5' },
    ]);
    expect(json.trackers).toEqual([
      { label: 'Went outside', kind: 'check', putAway: false, days: 1 },
      { label: 'Sleep', kind: 'scale', putAway: false, days: 1 },
    ]);
    const [header, row] = buildCsv(j).split('\r\n');
    expect(header.endsWith(',tags,trackers')).toBe(true);
    expect(row.endsWith('"Went outside: no; Sleep: 4 of 5"')).toBe(true);
  });

  it('survive a restart', () => {
    let j = openJournal();
    const sleep = j.trackers.create({ label: 'Sleep', kind: 'scale' });
    j.trackers.setForDay('2026-10-24', sleep.id, 2);
    j = reopen(j);
    expect(j.trackers.forDay('2026-10-24')).toEqual([{ trackerId: sleep.id, value: 2 }]);
  });

  it('arrive with the upgrade of a 1.2 journal (version 2), every day still counted', () => {
    const dir = tempDir();
    const db = Db.open(join(dir, 'mjournal.db'));
    migrate(db, { snapshotDir: join(dir, 'backups', 'automatic'), migrations: MIGRATIONS.slice(0, 2) });
    expect(db.userVersion).toBe(2);
    const now = '2026-10-01T10:00:00.000Z';
    db.run("INSERT INTO entries (date, mood, created_at, updated_at) VALUES ('2026-09-02', 'calm', ?, ?)", [now, now]);
    // 'walk' is one of the quick chips version 2 starts with.
    db.run("INSERT INTO entries (date, tag_count, created_at, updated_at) VALUES ('2026-09-03', 1, ?, ?)", [now, now]);
    db.run("INSERT INTO entry_tags (entry_date, tag, picked) VALUES ('2026-09-03', 'walk', 1)");
    db.run("INSERT INTO entries (date, created_at, updated_at) VALUES ('2026-09-04', ?, ?)", [now, now]);
    db.close();

    const journal = Journal.open(dir, { clock: fakeClock('2026-10-01T12:00:00Z') });
    expect(journal.db.userVersion).toBe(3);
    expect(journal.migration.snapshotPath).toMatch(/before-migration-v2/);
    expect(journal.entries.contentDays()).toEqual(['2026-09-02', '2026-09-03']);
    expect(journal.trackers.list()).toEqual([]);
    const sleep = journal.trackers.create({ label: 'Sleep', kind: 'scale' });
    journal.trackers.setForDay('2026-09-04', sleep.id, 3);
    expect(journal.entries.contentDays()).toEqual(['2026-09-02', '2026-09-03', '2026-09-04']);
    journal.close();
  });
});
