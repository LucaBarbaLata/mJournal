/**
 * The tag vocabulary (Settings → Tags). Tags on days live in entry_tags, kept
 * in sync by EntriesStore.refresh(): picked chips stay until un-picked, #tags
 * follow the text. A tag's key (`name`) is its label in lower case.
 */
import type { DateKey } from '@core/dates';
import type { TagRecord } from '@core/api';
import { cleanTagLabel, isValidTagLabel, MAX_TAGS, tagKey } from '@core/tags';
import { UserFacingError, ValidationError } from '@core/validation';
import type { Db } from './database';
import type { EntriesStore } from './entries';

interface TagRow {
  name: string;
  label: string;
  quick: number;
  position: number;
  days: number;
  written_days: number;
}

const LIST_SQL = `
  SELECT t.name, t.label, t.quick, t.position,
    (SELECT COUNT(*) FROM entry_tags et WHERE et.tag = t.name) AS days,
    (SELECT COUNT(*) FROM entry_tags et WHERE et.tag = t.name AND et.written = 1) AS written_days
  FROM tags t`;

function toRecord(row: TagRow): TagRecord {
  return {
    name: row.name,
    label: row.label,
    quick: row.quick === 1,
    position: row.position,
    days: row.days,
    written: row.written_days > 0,
  };
}

/** Checks a label typed by the person and returns it tidied. */
export function validTagLabel(input: string): string {
  const label = cleanTagLabel(input);
  if (!isValidTagLabel(label)) {
    throw new ValidationError('A tag can use letters, numbers, spaces, “-” and “_”, and needs at least one letter.');
  }
  return label;
}

export class TagStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => string,
    private readonly entries: EntriesStore,
  ) {}

  /** Quick chips first (in their order), then the others alphabetically. */
  list(): TagRecord[] {
    return this.db.all<TagRow>(`${LIST_SQL} ORDER BY t.quick DESC, t.position, t.label COLLATE NOCASE`).map(toRecord);
  }

  get(name: string): TagRecord {
    const row = this.db.get<TagRow>(`${LIST_SQL} WHERE t.name = ?`, [name]);
    if (!row) throw new UserFacingError('unknown-tag', 'That tag could not be found.');
    return toRecord(row);
  }

  /** The tag for a label, created (not as a quick chip) if it's new. Returns its key. */
  ensure(label: string): string {
    const clean = validTagLabel(label);
    const name = tagKey(clean);
    if (!this.db.get('SELECT 1 AS x FROM tags WHERE name = ?', [name])) {
      const count = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tags')!.n;
      if (count >= MAX_TAGS) throw new UserFacingError('too-many-tags', `You can keep up to ${MAX_TAGS} tags.`);
      const now = this.now();
      this.db.run(
        `INSERT INTO tags (name, label, quick, position, created_at, updated_at)
         VALUES (?, ?, 0, (SELECT COALESCE(MAX(position), -1) + 1 FROM tags), ?, ?)`,
        [name, clean, now, now],
      );
    }
    return name;
  }

  /** A new quick chip (or an existing tag made one). */
  create(label: string): TagRecord {
    return this.db.transaction(() => {
      const name = this.ensure(label);
      this.db.run('UPDATE tags SET quick = 1, updated_at = ? WHERE name = ?', [this.now(), name]);
      return this.get(name);
    });
  }

  /** Picks or un-picks a tag on a day, creating it if needed. */
  setForDay(date: DateKey, label: string, picked: boolean): void {
    this.db.transaction(() => {
      if (picked) {
        this.entries.setTagPicked(date, this.ensure(label), true);
      } else {
        const name = tagKey(cleanTagLabel(label));
        if (this.db.get('SELECT 1 AS x FROM tags WHERE name = ?', [name])) this.entries.setTagPicked(date, name, false);
      }
    });
  }

  /**
   * Renames a tag or makes it a quick chip (or not). A rename that changes the tag's key isn't possible while
   * the tag is written as #tag somewhere: the next edit of that text would bring the old name back.
   */
  update(name: string, patch: { label?: string; quick?: boolean }): TagRecord {
    return this.db.transaction(() => {
      const tag = this.get(name);
      let key = name;
      if (patch.label !== undefined) {
        const label = validTagLabel(patch.label);
        key = tagKey(label);
        if (key !== name) {
          if (tag.written) {
            throw new UserFacingError(
              'tag-written',
              `“${tag.label}” is written as #${tag.label} in your writing. Change it there, and the tag follows.`,
            );
          }
          if (this.db.get('SELECT 1 AS x FROM tags WHERE name = ?', [key])) {
            throw new UserFacingError('tag-exists', `There is already a tag called “${label}”.`);
          }
        }
        // entry_tags follows the new key (ON UPDATE CASCADE).
        this.db.run('UPDATE tags SET name = ?, label = ?, updated_at = ? WHERE name = ?', [key, label, this.now(), name]);
        this.refreshDaysWith(key);
      }
      if (patch.quick !== undefined) {
        this.db.run('UPDATE tags SET quick = ?, updated_at = ? WHERE name = ?', [patch.quick ? 1 : 0, this.now(), key]);
      }
      return this.get(key);
    });
  }

  reorder(names: string[]): TagRecord[] {
    const known = new Set(this.db.all<{ name: string }>('SELECT name FROM tags').map((r) => r.name));
    if (new Set(names).size !== names.length || names.some((n) => !known.has(n))) {
      throw new UserFacingError('invalid-order', 'Could not reorder the tags. Please try again.');
    }
    this.db.transaction(() => {
      names.forEach((name, position) => this.db.run('UPDATE tags SET position = ? WHERE name = ?', [position, name]));
    });
    return this.list();
  }

  /** Un-picks the tag on every day. It stays only where it is written as #tag; otherwise it's gone. */
  remove(name: string): void {
    this.db.transaction(() => {
      this.get(name);
      const days = this.db.all<{ entry_date: string }>('SELECT entry_date FROM entry_tags WHERE tag = ? AND picked = 1', [name]);
      this.db.run('UPDATE tags SET quick = 0 WHERE name = ?', [name]);
      this.db.run('UPDATE entry_tags SET picked = 0 WHERE tag = ?', [name]);
      for (const { entry_date } of days) this.entries.refresh(entry_date);
      // Not written anywhere: refresh() already removed it, or it was on no day at all.
      if (!this.db.get('SELECT 1 AS x FROM entry_tags WHERE tag = ?', [name])) this.db.run('DELETE FROM tags WHERE name = ?', [name]);
    });
  }

  private refreshDaysWith(name: string): void {
    for (const { entry_date } of this.db.all<{ entry_date: string }>('SELECT entry_date FROM entry_tags WHERE tag = ?', [name])) {
      this.entries.refresh(entry_date);
    }
  }
}
