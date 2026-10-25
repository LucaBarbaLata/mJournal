/**
 * Schema migrations.
 *
 * The schema version lives in SQLite's `PRAGMA user_version`. Each migration
 * runs in its own transaction together with the version bump, so a failure
 * leaves the database exactly as it was. Before migrating a journal that
 * already holds data, a full snapshot is written next to it, so the only copy
 * of the user's data is never modified without a fallback.
 *
 * Never edit a released migration: add a new one with the next version number.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MOODS } from '@core/moods';
import { UserFacingError } from '@core/validation';
import type { Db } from './database';

export interface Migration {
  version: number;
  description: string;
  up(db: Db, now: string): void;
}

const SCHEMA_V1 = `
CREATE TABLE entries (
  date             TEXT PRIMARY KEY NOT NULL,
  body             TEXT NOT NULL DEFAULT '',
  mood             TEXT,
  mood_note        TEXT NOT NULL DEFAULT '',
  energy           INTEGER CHECK (energy BETWEEN 1 AND 5),
  favorite         INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  -- Derived values, recalculated whenever anything about the day changes.
  word_count       INTEGER NOT NULL DEFAULT 0,
  has_text         INTEGER NOT NULL DEFAULT 0,
  answer_count     INTEGER NOT NULL DEFAULT 0,
  photo_count      INTEGER NOT NULL DEFAULT 0,
  favorite_moments INTEGER NOT NULL DEFAULT 0,
  has_content      INTEGER GENERATED ALWAYS AS
                     (has_text OR mood IS NOT NULL OR energy IS NOT NULL OR photo_count > 0) VIRTUAL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
) STRICT;

CREATE TABLE answers (
  id          INTEGER PRIMARY KEY,
  entry_date  TEXT NOT NULL REFERENCES entries (date) ON DELETE CASCADE,
  prompt_id   TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  answer      TEXT NOT NULL DEFAULT '',
  favorite    INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (entry_date, prompt_id)
) STRICT;

-- Photos deliberately have no foreign key to entries: deleting an entry moves
-- its photos to "Recently removed" instead of deleting them.
CREATE TABLE photos (
  id            TEXT PRIMARY KEY NOT NULL,
  entry_date    TEXT NOT NULL,
  file          TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  mime          TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  width         INTEGER,
  height        INTEGER,
  original_name TEXT NOT NULL DEFAULT '',
  caption       TEXT NOT NULL DEFAULT '',
  favorite      INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  position      INTEGER NOT NULL DEFAULT 0,
  has_thumbnail INTEGER NOT NULL DEFAULT 0 CHECK (has_thumbnail IN (0, 1)),
  created_at    TEXT NOT NULL,
  removed_at    TEXT
) STRICT;
CREATE INDEX photos_by_day ON photos (entry_date, position);
CREATE INDEX photos_by_hash ON photos (sha256);

-- The featured question of each day, saved the first time the day is shown.
CREATE TABLE daily_prompts (
  date        TEXT PRIMARY KEY NOT NULL,
  prompt_id   TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  shuffles    INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
  assigned_at TEXT NOT NULL
) STRICT;

CREATE TABLE prompt_prefs (
  prompt_id  TEXT PRIMARY KEY NOT NULL,
  favorite   INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  hidden     INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE custom_prompts (
  id          INTEGER PRIMARY KEY,
  text        TEXT NOT NULL,
  in_rotation INTEGER NOT NULL DEFAULT 1 CHECK (in_rotation IN (0, 1)),
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE moods (
  key        TEXT PRIMARY KEY NOT NULL,
  label      TEXT NOT NULL,
  icon       TEXT NOT NULL,
  color      TEXT NOT NULL,
  position   INTEGER NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  built_in   INTEGER NOT NULL DEFAULT 0 CHECK (built_in IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE monthly_reflections (
  month      TEXT NOT NULL,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (month, question)
) STRICT;

CREATE TABLE settings (
  key        TEXT PRIMARY KEY NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Full-text search. The rowid of each row is the day number of the entry date.
CREATE VIRTUAL TABLE search_index USING fts5 (
  body,
  answers,
  notes,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'Initial schema',
    up(db, now) {
      db.exec(SCHEMA_V1);
      DEFAULT_MOODS.forEach((mood, position) => {
        db.run(
          `INSERT INTO moods (key, label, icon, color, position, built_in, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          [mood.key, mood.label, mood.icon, mood.color, position, now, now],
        );
      });
    },
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export interface MigrationOutcome {
  from: number;
  to: number;
  snapshotPath: string | null;
}

function hasUserTables(db: Db): boolean {
  const row = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'");
  return (row?.n ?? 0) > 0;
}

export function migrate(
  db: Db,
  {
    snapshotDir,
    now = () => new Date(),
    migrations = MIGRATIONS,
  }: { snapshotDir: string; now?: () => Date; migrations?: readonly Migration[] },
): MigrationOutcome {
  const latest = migrations[migrations.length - 1].version;
  const from = db.userVersion;
  if (from > latest) {
    throw new UserFacingError(
      'newer-version',
      'This journal was saved by a newer version of mJournal. Please update mJournal to open it — your data has not been changed.',
    );
  }
  if (from === latest) return { from, to: from, snapshotPath: null };

  let snapshotPath: string | null = null;
  if (from > 0 || hasUserTables(db)) {
    mkdirSync(snapshotDir, { recursive: true });
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    snapshotPath = join(snapshotDir, `mJournal-before-migration-v${from}-${stamp}.db`);
    if (existsSync(snapshotPath)) snapshotPath = snapshotPath.replace(/\.db$/, `-${process.pid}.db`);
    db.snapshotTo(snapshotPath);
  }

  for (const migration of migrations) {
    if (migration.version <= from) continue;
    db.transaction(() => {
      migration.up(db, now().toISOString());
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
  return { from, to: latest, snapshotPath };
}
