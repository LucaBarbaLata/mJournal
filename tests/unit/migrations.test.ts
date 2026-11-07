import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Journal } from '../../src/main/journal';
import { Db } from '../../src/main/store/database';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, migrate, type Migration } from '../../src/main/store/migrations';
import { fakeClock, openJournal, tempDir } from './helpers';

describe('migrations', () => {
  it('creates the latest schema with default moods on a clean start', () => {
    const journal = openJournal();
    expect(journal.db.userVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(journal.migration.snapshotPath).toBeNull();
    expect(journal.moods.list()).toHaveLength(10);
    expect(existsSync(journal.paths.database)).toBe(true);
  });

  it('is a no-op when the schema is current', () => {
    const journal = openJournal();
    expect(migrate(journal.db, { snapshotDir: journal.paths.snapshots })).toEqual({
      from: LATEST_SCHEMA_VERSION,
      to: LATEST_SCHEMA_VERSION,
      snapshotPath: null,
    });
  });

  it('upgrades an existing journal, keeps its data and snapshots it first', () => {
    const dir = tempDir();
    const journal = openJournal(dir);
    journal.entries.update('2026-10-24', { body: 'Written before the upgrade', mood: 'happy' });
    journal.close();

    const next = LATEST_SCHEMA_VERSION + 1;
    const v2: Migration = {
      version: next,
      description: 'Add a weather column (test only)',
      up: (db) => db.exec("ALTER TABLE entries ADD COLUMN weather TEXT NOT NULL DEFAULT ''"),
    };
    const db = Db.open(join(dir, 'mjournal.db'));
    const outcome = migrate(db, { snapshotDir: join(dir, 'backups', 'automatic'), now: fakeClock(), migrations: [...MIGRATIONS, v2] });
    expect(outcome.from).toBe(LATEST_SCHEMA_VERSION);
    expect(outcome.to).toBe(next);
    expect(outcome.snapshotPath && existsSync(outcome.snapshotPath)).toBe(true);
    expect(db.userVersion).toBe(next);
    expect(db.get<{ body: string; weather: string }>('SELECT body, weather FROM entries')).toEqual({
      body: 'Written before the upgrade',
      weather: '',
    });
    db.close();

    // The snapshot is an intact copy of the pre-upgrade journal.
    const snapshot = Db.open(outcome.snapshotPath!);
    expect(snapshot.userVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(snapshot.get<{ body: string }>('SELECT body FROM entries')?.body).toBe('Written before the upgrade');
    snapshot.close();
  });

  it('rolls back a failing migration and leaves the data as it was', () => {
    const dir = tempDir();
    const journal = openJournal(dir);
    journal.entries.update('2026-10-24', { body: 'Precious words' });
    journal.close();

    const broken: Migration = {
      version: LATEST_SCHEMA_VERSION + 1,
      description: 'Fails halfway (test only)',
      up: (db) => {
        db.exec('ALTER TABLE entries ADD COLUMN half_done TEXT');
        db.exec('THIS IS NOT SQL');
      },
    };
    const db = Db.open(join(dir, 'mjournal.db'));
    expect(() => migrate(db, { snapshotDir: join(dir, 'snap'), migrations: [...MIGRATIONS, broken] })).toThrow();
    expect(db.userVersion).toBe(LATEST_SCHEMA_VERSION);
    const columns = db.all<{ name: string }>('PRAGMA table_info(entries)').map((c) => c.name);
    expect(columns).not.toContain('half_done');
    expect(db.get<{ body: string }>('SELECT body FROM entries')?.body).toBe('Precious words');
    db.close();
  });

  it('upgrades a 1.1 journal (version 1) to version 2 with every day still counted', () => {
    const dir = tempDir();
    // A version 1 journal, written the way mJournal 1.1 did.
    const db = Db.open(join(dir, 'mjournal.db'));
    migrate(db, { snapshotDir: join(dir, 'backups', 'automatic'), migrations: MIGRATIONS.slice(0, 1) });
    expect(db.userVersion).toBe(1);
    const now = '2026-10-01T10:00:00.000Z';
    const day = (date: string, columns: Record<string, string | number | null>) => {
      const names = ['date', 'created_at', 'updated_at', ...Object.keys(columns)];
      db.run(`INSERT INTO entries (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`, [
        date,
        now,
        now,
        ...Object.values(columns),
      ]);
    };
    day('2026-09-01', { body: 'A long #walk by the sea with #Family', has_text: 1, word_count: 8 });
    day('2026-09-02', { mood: 'calm' });
    day('2026-09-03', { energy: 4 });
    day('2026-09-04', {}); // an empty row: still doesn't count
    db.run(
      "INSERT INTO answers (entry_date, prompt_id, prompt_text, answer, created_at, updated_at) VALUES ('2026-09-02', 'joy-01', 'Q', 'Tea #reading', ?, ?)",
      [now, now],
    );
    db.run("INSERT INTO monthly_reflections (month, question, answer, updated_at) VALUES ('2026-09', 'letter', 'Dear me, lighthouse', ?)", [now]);
    db.close();

    const journal = Journal.open(dir, { clock: fakeClock('2026-10-01T12:00:00Z') });
    expect(journal.db.userVersion).toBe(2);
    expect(journal.migration.snapshotPath && existsSync(journal.migration.snapshotPath)).toBe(true);
    expect(journal.entries.contentDays()).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(journal.entries.answers('2026-09-02').map((a) => a.answer)).toEqual(['Tea #reading']);
    // #tags already in old writing became tags, joining the default quick chips.
    expect(journal.entries.tags('2026-09-01').map((t) => [t.label, t.written, t.picked])).toEqual([
      ['Family', true, false],
      ['Walk', true, false],
    ]);
    expect(journal.entries.tags('2026-09-02').map((t) => t.name)).toEqual(['reading']);
    expect(journal.tags.list().filter((t) => t.quick)).toHaveLength(8);
    // Reflections are searchable now.
    expect(journal.writing.search('lighthouse')).toMatchObject([{ kind: 'month', ref: '2026-09' }]);
    journal.close();
  });

  it('refuses to open a journal from a newer version without changing it', () => {
    const dir = tempDir();
    const journal = openJournal(dir);
    journal.entries.update('2026-10-24', { body: 'From the future' });
    journal.db.exec('PRAGMA user_version = 99');
    journal.close();
    const before = readFileSync(join(dir, 'mjournal.db'));
    expect(() => Journal.open(dir)).toThrow(/newer version of mJournal/);
    expect(readFileSync(join(dir, 'mjournal.db')).equals(before)).toBe(true);
  });

  it('reports an unreadable database without overwriting it', () => {
    const dir = tempDir();
    const garbage = Buffer.from('this is definitely not a SQLite database '.repeat(200));
    writeFileSync(join(dir, 'mjournal.db'), garbage);
    expect(() => Journal.open(dir)).toThrow();
    expect(readFileSync(join(dir, 'mjournal.db')).equals(garbage)).toBe(true);
    expect(readdirSync(dir)).toContain('mjournal.db');
  });
});
