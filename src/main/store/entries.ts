/**
 * Daily entries and prompt answers.
 *
 * There is at most one entry per calendar day. Any change to a day's content
 * also refreshes its derived columns (word count, counters, has_content) and
 * its search-index row inside the same transaction, so they never drift.
 */
import type { AnswerInput, AnswerRecord, DaySummary, EntryPatch, EntryRecord } from '@core/api';
import { dayNumber, firstDayOfMonth, lastDayOfMonth, type DateKey, type MonthKey } from '@core/dates';
import { countWords, makeExcerpt } from '@core/text';
import { UserFacingError } from '@core/validation';
import type { Db } from './database';

export interface EntryRow {
  date: string;
  body: string;
  mood: string | null;
  mood_note: string;
  energy: number | null;
  favorite: number;
  word_count: number;
  has_text: number;
  answer_count: number;
  photo_count: number;
  favorite_moments: number;
  has_content: number;
  created_at: string;
  updated_at: string;
}

interface AnswerRow {
  id: number;
  entry_date: string;
  prompt_id: string;
  prompt_text: string;
  answer: string;
  favorite: number;
  position: number;
  updated_at: string;
}

/** Entry columns plus the first answer, used to build excerpts. */
const SUMMARY_SELECT = `
  SELECT e.*,
    (SELECT a.answer FROM answers a
      WHERE a.entry_date = e.date AND a.answer <> ''
      ORDER BY a.position LIMIT 1) AS first_answer
  FROM entries e`;

type SummaryRow = EntryRow & { first_answer: string | null };

export function toEntryRecord(row: EntryRow): EntryRecord {
  return {
    date: row.date,
    body: row.body,
    mood: row.mood,
    moodNote: row.mood_note,
    energy: row.energy,
    favorite: row.favorite === 1,
    wordCount: row.word_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAnswerRecord(row: AnswerRow): AnswerRecord {
  return {
    id: row.id,
    date: row.entry_date,
    promptId: row.prompt_id,
    promptText: row.prompt_text,
    answer: row.answer,
    favorite: row.favorite === 1,
    position: row.position,
    updatedAt: row.updated_at,
  };
}

export function toDaySummary(row: SummaryRow): DaySummary {
  const source = [row.body, row.first_answer ?? '', row.mood_note].find((text) => text.trim() !== '') ?? '';
  return {
    date: row.date,
    mood: row.mood,
    energy: row.energy,
    favorite: row.favorite === 1,
    hasWriting: row.has_text === 1,
    answerCount: row.answer_count,
    photoCount: row.photo_count,
    wordCount: row.word_count,
    excerpt: makeExcerpt(source),
  };
}

export class EntriesStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => string,
    private readonly moodExists: (key: string) => boolean,
  ) {}

  get(date: DateKey): EntryRecord | null {
    const row = this.db.get<EntryRow>('SELECT * FROM entries WHERE date = ?', [date]);
    return row ? toEntryRecord(row) : null;
  }

  /** Creates an empty entry row for the day if there isn't one yet. */
  ensure(date: DateKey): void {
    const now = this.now();
    this.db.run('INSERT OR IGNORE INTO entries (date, created_at, updated_at) VALUES (?, ?, ?)', [date, now, now]);
  }

  private touch(date: DateKey): void {
    this.db.run('UPDATE entries SET updated_at = ? WHERE date = ?', [this.now(), date]);
  }

  update(date: DateKey, patch: EntryPatch): EntryRecord {
    if (patch.mood != null && !this.moodExists(patch.mood)) {
      throw new UserFacingError('unknown-mood', 'That mood no longer exists. Please choose another one.');
    }
    return this.db.transaction(() => {
      this.ensure(date);
      const sets: string[] = [];
      const params: (string | number | null)[] = [];
      const set = (column: string, value: string | number | null) => {
        sets.push(`${column} = ?`);
        params.push(value);
      };
      if (patch.body !== undefined) set('body', patch.body);
      if (patch.mood !== undefined) set('mood', patch.mood);
      if (patch.moodNote !== undefined) set('mood_note', patch.moodNote);
      if (patch.energy !== undefined) set('energy', patch.energy);
      if (patch.favorite !== undefined) set('favorite', patch.favorite ? 1 : 0);
      if (sets.length > 0) {
        set('updated_at', this.now());
        this.db.run(`UPDATE entries SET ${sets.join(', ')} WHERE date = ?`, [...params, date]);
      }
      this.refresh(date);
      return this.get(date)!;
    });
  }

  /**
   * Deletes a day's writing, mood and answers. Its photos are not deleted:
   * they move to "Recently removed", where they can be restored.
   */
  remove(date: DateKey): void {
    this.db.transaction(() => {
      this.db.run('UPDATE photos SET removed_at = ? WHERE entry_date = ? AND removed_at IS NULL', [this.now(), date]);
      this.db.run('DELETE FROM entries WHERE date = ?', [date]);
      this.db.run('DELETE FROM search_index WHERE rowid = ?', [dayNumber(date)]);
    });
  }

  answers(date: DateKey): AnswerRecord[] {
    return this.db
      .all<AnswerRow>('SELECT * FROM answers WHERE entry_date = ? ORDER BY position, id', [date])
      .map(toAnswerRecord);
  }

  saveAnswer(date: DateKey, input: AnswerInput): AnswerRecord {
    return this.db.transaction(() => {
      this.ensure(date);
      const now = this.now();
      const existing = this.db.get<{ id: number }>('SELECT id FROM answers WHERE entry_date = ? AND prompt_id = ?', [
        date,
        input.promptId,
      ]);
      if (existing) {
        this.db.run('UPDATE answers SET answer = ?, prompt_text = ?, updated_at = ? WHERE id = ?', [
          input.answer,
          input.promptText,
          now,
          existing.id,
        ]);
      } else {
        const next = this.db.get<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM answers WHERE entry_date = ?', [
          date,
        ])!.p;
        this.db.run(
          `INSERT INTO answers (entry_date, prompt_id, prompt_text, answer, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [date, input.promptId, input.promptText, input.answer, next, now, now],
        );
      }
      this.touch(date);
      this.refresh(date);
      return toAnswerRecord(
        this.db.get<AnswerRow>('SELECT * FROM answers WHERE entry_date = ? AND prompt_id = ?', [date, input.promptId])!,
      );
    });
  }

  removeAnswer(date: DateKey, promptId: string): void {
    this.db.transaction(() => {
      const { changes } = this.db.run('DELETE FROM answers WHERE entry_date = ? AND prompt_id = ?', [date, promptId]);
      if (changes > 0) {
        this.touch(date);
        this.refresh(date);
      }
    });
  }

  setAnswerFavorite(date: DateKey, promptId: string, favorite: boolean): void {
    this.db.transaction(() => {
      this.db.run('UPDATE answers SET favorite = ? WHERE entry_date = ? AND prompt_id = ?', [
        favorite ? 1 : 0,
        date,
        promptId,
      ]);
      this.refresh(date);
    });
  }

  /** Recalculates the derived columns and search text of one day. */
  refresh(date: DateKey): void {
    const entry = this.db.get<{ body: string; mood_note: string }>('SELECT body, mood_note FROM entries WHERE date = ?', [
      date,
    ]);
    const rowid = dayNumber(date);
    if (!entry) {
      this.db.run('DELETE FROM search_index WHERE rowid = ?', [rowid]);
      return;
    }
    const answers = this.db.all<{ answer: string; favorite: number }>(
      'SELECT answer, favorite FROM answers WHERE entry_date = ? ORDER BY position, id',
      [date],
    );
    const photos = this.db.all<{ caption: string; favorite: number }>(
      'SELECT caption, favorite FROM photos WHERE entry_date = ? AND removed_at IS NULL',
      [date],
    );
    const answered = answers.filter((a) => a.answer.trim() !== '');
    const hasText = entry.body.trim() !== '' || entry.mood_note.trim() !== '' || answered.length > 0;
    const words =
      countWords(entry.body) + countWords(entry.mood_note) + answered.reduce((n, a) => n + countWords(a.answer), 0);
    const favoriteMoments = answered.filter((a) => a.favorite === 1).length + photos.filter((p) => p.favorite === 1).length;
    this.db.run(
      `UPDATE entries SET word_count = ?, has_text = ?, answer_count = ?, photo_count = ?, favorite_moments = ?
       WHERE date = ?`,
      [words, hasText ? 1 : 0, answered.length, photos.length, favoriteMoments, date],
    );

    this.db.run('DELETE FROM search_index WHERE rowid = ?', [rowid]);
    const notes = [entry.mood_note, ...photos.map((p) => p.caption)].filter((t) => t.trim() !== '').join('\n');
    if (hasText || notes) {
      this.db.run('INSERT INTO search_index (rowid, body, answers, notes) VALUES (?, ?, ?, ?)', [
        rowid,
        entry.body,
        answered.map((a) => a.answer).join('\n\n'),
        notes,
      ]);
    }
  }

  /** Recalculates every day; used after migrations and restores. */
  refreshAll(): void {
    this.db.transaction(() => {
      this.db.exec('DELETE FROM search_index');
      for (const { date } of this.db.all<{ date: string }>('SELECT date FROM entries')) this.refresh(date);
    });
  }

  summaries(from: DateKey, to: DateKey): DaySummary[] {
    return this.db
      .all<SummaryRow>(`${SUMMARY_SELECT} WHERE e.has_content AND e.date BETWEEN ? AND ? ORDER BY e.date`, [from, to])
      .map(toDaySummary);
  }

  monthSummaries(month: MonthKey): DaySummary[] {
    return this.summaries(firstDayOfMonth(month), lastDayOfMonth(month));
  }

  /** Entries written on the same day and month in earlier years, newest first. */
  onThisDay(date: DateKey): DaySummary[] {
    return this.db
      .all<SummaryRow>(
        `${SUMMARY_SELECT} WHERE e.has_content AND substr(e.date, 6) = ? AND e.date < ? ORDER BY e.date DESC LIMIT 5`,
        [date.slice(5), date],
      )
      .map(toDaySummary);
  }

  /** Every date that counts as journaled, oldest first. */
  contentDays(): DateKey[] {
    return this.db.all<{ date: string }>('SELECT date FROM entries WHERE has_content ORDER BY date').map((r) => r.date);
  }
}
