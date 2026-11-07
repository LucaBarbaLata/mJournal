/**
 * Days deleted with "Delete entry" wait in Recently removed, like photos do, until they are restored or deleted
 * for good. A removed day keeps its writing, mood, energy, answers and picked tags (as versioned JSON) and the
 * photos that went to Recently removed with it.
 *
 * Restoring never overwrites anything: if the day got new writing in the meantime, empty fields are filled,
 * different text is added after a blank line, and the current mood and energy stay.
 */
import type { RemovedDay } from '@core/api';
import { dayNumber, type DateKey } from '@core/dates';
import { makeExcerpt } from '@core/text';
import { UserFacingError } from '@core/validation';
import type { Db } from './database';
import type { EntriesStore, EntryRow } from './entries';
import type { PhotoStore } from './photos';
import type { TagStore } from './tags';

interface SavedDay {
  v: 1;
  entry: { body: string; mood: string | null; moodNote: string; energy: number | null; favorite: boolean; createdAt: string } | null;
  answers: { promptId: string; promptText: string; answer: string; favorite: boolean }[];
  tags: string[];
}

interface RemovedRow {
  id: number;
  date: string;
  data: string;
  photo_ids: string;
  removed_at: string;
}

function parse(row: RemovedRow): { day: SavedDay; photoIds: string[] } {
  try {
    const day = JSON.parse(row.data) as SavedDay;
    const photoIds = JSON.parse(row.photo_ids) as unknown;
    if (day.v !== 1 || !Array.isArray(day.answers) || !Array.isArray(day.tags) || !Array.isArray(photoIds)) throw new Error('shape');
    return { day, photoIds: photoIds.filter((id): id is string => typeof id === 'string') };
  } catch {
    throw new UserFacingError('damaged-removed-day', 'This removed day can’t be read any more.');
  }
}

/** Adds `extra` to `current` after a blank line, unless it's empty or already there. */
function merge(current: string, extra: string): string {
  if (!extra.trim()) return current;
  if (!current.trim()) return extra;
  if (current.includes(extra.trim())) return current;
  return `${current.trimEnd()}\n\n${extra}`;
}

export class RemovedDaysStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => string,
    private readonly entries: EntriesStore,
    private readonly photos: PhotoStore,
    private readonly tags: TagStore,
  ) {}

  /** Deletes the day and keeps it in Recently removed. Returns its id there, or null when the day was empty. */
  remove(date: DateKey): number | null {
    return this.db.transaction(() => {
      const entry = this.db.get<EntryRow>('SELECT * FROM entries WHERE date = ?', [date]);
      const answers = this.db.all<{ prompt_id: string; prompt_text: string; answer: string; favorite: number }>(
        "SELECT prompt_id, prompt_text, answer, favorite FROM answers WHERE entry_date = ? AND answer <> '' ORDER BY position, id",
        [date],
      );
      const tags = this.db
        .all<{ label: string }>(
          'SELECT t.label FROM entry_tags et JOIN tags t ON t.name = et.tag WHERE et.entry_date = ? AND et.picked = 1',
          [date],
        )
        .map((r) => r.label);
      const photoIds = this.db
        .all<{ id: string }>('SELECT id FROM photos WHERE entry_date = ? AND removed_at IS NULL ORDER BY position', [date])
        .map((r) => r.id);
      const hasSomething =
        photoIds.length > 0 ||
        answers.length > 0 ||
        tags.length > 0 ||
        (entry !== undefined &&
          (entry.body.trim() !== '' || entry.mood_note.trim() !== '' || entry.mood !== null || entry.energy !== null || entry.favorite === 1));
      if (!hasSomething) {
        this.entries.remove(date);
        return null;
      }
      const saved: SavedDay = {
        v: 1,
        entry: entry
          ? {
              body: entry.body,
              mood: entry.mood,
              moodNote: entry.mood_note,
              energy: entry.energy,
              favorite: entry.favorite === 1,
              createdAt: entry.created_at,
            }
          : null,
        answers: answers.map((a) => ({ promptId: a.prompt_id, promptText: a.prompt_text, answer: a.answer, favorite: a.favorite === 1 })),
        tags,
      };
      // Moves the photos to Recently removed and deletes the day, its answers and tags.
      this.entries.remove(date);
      const { lastInsertRowid } = this.db.run(
        'INSERT INTO removed_days (date, data, photo_ids, removed_at) VALUES (?, ?, ?, ?)',
        [date, JSON.stringify(saved), JSON.stringify(photoIds), this.now()],
      );
      return lastInsertRowid;
    });
  }

  list(): RemovedDay[] {
    return this.db
      .all<RemovedRow>('SELECT * FROM removed_days ORDER BY removed_at DESC, id DESC')
      .map((row) => {
        let day: SavedDay | null = null;
        let photoIds: string[] = [];
        try {
          ({ day, photoIds } = parse(row));
        } catch {
          // Listed anyway, so it can be deleted.
        }
        const source = [day?.entry?.body ?? '', ...(day?.answers.map((a) => a.answer) ?? []), day?.entry?.moodNote ?? ''].find(
          (text) => text.trim() !== '',
        );
        return {
          id: row.id,
          date: row.date,
          removedAt: row.removed_at,
          excerpt: makeExcerpt(source ?? '', 160),
          mood: day?.entry?.mood ?? null,
          answerCount: day?.answers.length ?? 0,
          photoCount: photoIds.length,
        };
      });
  }

  /** Puts a removed day back, merging with anything written on that day since. Returns the date. */
  restore(id: number): DateKey {
    return this.db.transaction(() => {
      const row = this.db.get<RemovedRow>('SELECT * FROM removed_days WHERE id = ?', [id]);
      if (!row) throw new UserFacingError('unknown-removed-day', 'That day is no longer in Recently removed.');
      const { day, photoIds } = parse(row);
      const date = row.date;
      this.entries.ensure(date);
      const current = this.entries.get(date)!;
      if (day.entry) {
        this.entries.update(date, {
          body: merge(current.body, day.entry.body),
          moodNote: merge(current.moodNote, day.entry.moodNote),
          mood: current.mood ?? day.entry.mood,
          energy: current.energy ?? day.entry.energy,
          favorite: current.favorite || day.entry.favorite,
        });
        this.db.run('UPDATE entries SET created_at = MIN(created_at, ?) WHERE date = ?', [day.entry.createdAt, date]);
      }
      for (const answer of day.answers) {
        const existing = this.entries.answers(date).find((a) => a.promptId === answer.promptId);
        this.entries.saveAnswer(date, {
          promptId: answer.promptId,
          promptText: existing?.promptText ?? answer.promptText,
          answer: merge(existing?.answer ?? '', answer.answer),
        });
        if (answer.favorite) this.entries.setAnswerFavorite(date, answer.promptId, true);
      }
      for (const label of day.tags) {
        try {
          this.tags.setForDay(date, label, true);
        } catch {
          // A tag that can't be added (the day is full of tags) is left out.
        }
      }
      for (const photoId of photoIds) {
        const photo = this.db.get<{ entry_date: string; removed_at: string | null }>('SELECT entry_date, removed_at FROM photos WHERE id = ?', [photoId]);
        if (photo?.removed_at && photo.entry_date === date) this.photos.restore(photoId);
      }
      this.db.run('DELETE FROM removed_days WHERE id = ?', [id]);
      this.entries.refresh(date);
      // A day that ends up empty (nothing was left to restore) doesn't linger in the search index.
      if (!this.db.get<{ x: number }>('SELECT has_content AS x FROM entries WHERE date = ?', [date])?.x) {
        this.db.run('DELETE FROM search_index WHERE rowid = ?', [dayNumber(date)]);
      }
      return date;
    });
  }

  /** Deletes a removed day for good. Its photos stay in Recently removed photos. */
  deleteForever(id: number): void {
    const { changes } = this.db.run('DELETE FROM removed_days WHERE id = ?', [id]);
    if (changes === 0) throw new UserFacingError('unknown-removed-day', 'That day is no longer in Recently removed.');
  }
}
