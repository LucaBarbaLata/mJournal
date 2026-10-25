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
    expect(migrate(journal.db, { snapshotDir: journal.paths.snapshots })).toEqual({ from: 1, to: 1, snapshotPath: null });
  });

  it('upgrades an existing journal, keeps its data and snapshots it first', () => {
    const dir = tempDir();
    const journal = openJournal(dir);
    journal.entries.update('2026-10-24', { body: 'Written before the upgrade', mood: 'happy' });
    journal.close();

    const v2: Migration = {
      version: 2,
      description: 'Add a weather column (test only)',
      up: (db) => db.exec("ALTER TABLE entries ADD COLUMN weather TEXT NOT NULL DEFAULT ''"),
    };
    const db = Db.open(join(dir, 'mjournal.db'));
    const outcome = migrate(db, { snapshotDir: join(dir, 'backups', 'automatic'), now: fakeClock(), migrations: [...MIGRATIONS, v2] });
    expect(outcome.from).toBe(1);
    expect(outcome.to).toBe(2);
    expect(outcome.snapshotPath && existsSync(outcome.snapshotPath)).toBe(true);
    expect(db.userVersion).toBe(2);
    expect(db.get<{ body: string; weather: string }>('SELECT body, weather FROM entries')).toEqual({
      body: 'Written before the upgrade',
      weather: '',
    });
    db.close();

    // The snapshot is an intact copy of the pre-upgrade journal.
    const snapshot = Db.open(outcome.snapshotPath!);
    expect(snapshot.userVersion).toBe(1);
    expect(snapshot.get<{ body: string }>('SELECT body FROM entries')?.body).toBe('Written before the upgrade');
    snapshot.close();
  });

  it('rolls back a failing migration and leaves the data as it was', () => {
    const dir = tempDir();
    const journal = openJournal(dir);
    journal.entries.update('2026-10-24', { body: 'Precious words' });
    journal.close();

    const broken: Migration = {
      version: 2,
      description: 'Fails halfway (test only)',
      up: (db) => {
        db.exec('ALTER TABLE entries ADD COLUMN half_done TEXT');
        db.exec('THIS IS NOT SQL');
      },
    };
    const db = Db.open(join(dir, 'mjournal.db'));
    expect(() => migrate(db, { snapshotDir: join(dir, 'snap'), migrations: [...MIGRATIONS, broken] })).toThrow();
    expect(db.userVersion).toBe(1);
    const columns = db.all<{ name: string }>('PRAGMA table_info(entries)').map((c) => c.name);
    expect(columns).not.toContain('half_done');
    expect(db.get<{ body: string }>('SELECT body FROM entries')?.body).toBe('Precious words');
    db.close();
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
