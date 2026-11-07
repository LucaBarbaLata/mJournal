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
import { DEFAULT_TAGS, tagKey } from '@core/tags';
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

/**
 * Version 2 (mJournal 1.2): tags (a tag on its own makes a day count, like a mood), days kept in "Recently
 * removed", prompts asked every day, letters to future days, the yearly reflection, and a search index for
 * writing that isn't part of a day (monthly and yearly reflections, opened letters).
 *
 * `has_content` is a generated column, which SQLite can't alter: it is dropped and added again with the new
 * rule. Nothing else refers to it in the schema, so no table has to be rebuilt.
 */
const SCHEMA_V2 = `
ALTER TABLE entries ADD COLUMN tag_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entries DROP COLUMN has_content;
ALTER TABLE entries ADD COLUMN has_content INTEGER GENERATED ALWAYS AS
  (has_text OR mood IS NOT NULL OR energy IS NOT NULL OR photo_count > 0 OR tag_count > 0) VIRTUAL;

-- The tag vocabulary. name is the key (the label in lower case).
CREATE TABLE tags (
  name       TEXT PRIMARY KEY NOT NULL,
  label      TEXT NOT NULL,
  quick      INTEGER NOT NULL DEFAULT 0 CHECK (quick IN (0, 1)),
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Tags on days: picked as a chip and/or written as #tag in the day's text (kept in sync by refresh()).
CREATE TABLE entry_tags (
  entry_date TEXT NOT NULL REFERENCES entries (date) ON DELETE CASCADE,
  tag        TEXT NOT NULL REFERENCES tags (name) ON UPDATE CASCADE,
  picked     INTEGER NOT NULL DEFAULT 0 CHECK (picked IN (0, 1)),
  written    INTEGER NOT NULL DEFAULT 0 CHECK (written IN (0, 1)),
  PRIMARY KEY (entry_date, tag)
) STRICT;
CREATE INDEX entry_tags_by_tag ON entry_tags (tag, entry_date);

-- Days deleted with "Delete entry": what they held (JSON) and the photos that went to Recently removed with them.
CREATE TABLE removed_days (
  id         INTEGER PRIMARY KEY,
  date       TEXT NOT NULL,
  data       TEXT NOT NULL,
  photo_ids  TEXT NOT NULL,
  removed_at TEXT NOT NULL
) STRICT;

-- Prompts asked every day (bit 0 = Sunday … bit 6 = Saturday).
CREATE TABLE pinned_prompts (
  prompt_id  TEXT PRIMARY KEY NOT NULL,
  weekdays   INTEGER NOT NULL DEFAULT 127 CHECK (weekdays BETWEEN 1 AND 127),
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
) STRICT;

-- Letters to a future day, sealed until then.
CREATE TABLE capsules (
  id         INTEGER PRIMARY KEY,
  open_on    TEXT NOT NULL,
  written_on TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  opened_at  TEXT
) STRICT;
CREATE INDEX capsules_by_day ON capsules (open_on);

CREATE TABLE yearly_reflections (
  year       INTEGER NOT NULL,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (year, question)
) STRICT;

-- Full-text search over writing that isn't part of a day. kind: 'month', 'year' or 'capsule'; ref: '2026-03',
-- '2026' or the letter's id.
CREATE VIRTUAL TABLE writing_index USING fts5 (
  kind UNINDEXED,
  ref UNINDEXED,
  text,
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
  {
    version: 2,
    description: 'Tags, recently removed days, prompts asked every day, letters, yearly reflections, writing search',
    up(db, now) {
      db.exec(SCHEMA_V2);
      DEFAULT_TAGS.forEach((label, position) => {
        db.run(
          'INSERT INTO tags (name, label, quick, position, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)',
          [tagKey(label), label, position, now, now],
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
