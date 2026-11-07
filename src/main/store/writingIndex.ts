/**
 * Full-text search over writing that isn't part of a day: monthly reflections
 * (with the intention and the "Dear me" letter), yearly reflections and letters
 * to the future once they have opened. Sealed letters are never indexed.
 */
import type { DateKey, MonthKey } from '@core/dates';
import { toFtsQuery } from '@core/search';
import type { Db } from './database';

export type WritingKind = 'month' | 'year' | 'capsule';

export interface WritingHit {
  kind: WritingKind;
  /** '2026-03' for a month, '2026' for a year, the letter's id for a letter. */
  ref: string;
  snippet: string;
  /** For a letter: the day it opened and the day it was written. */
  openOn?: string;
  writtenOn?: string;
}

export const MAX_WRITING_RESULTS = 50;

export class WritingIndex {
  constructor(private readonly db: Db) {}

  private put(kind: WritingKind, ref: string, text: string): void {
    this.db.run('DELETE FROM writing_index WHERE kind = ? AND ref = ?', [kind, ref]);
    if (text.trim()) this.db.run('INSERT INTO writing_index (kind, ref, text) VALUES (?, ?, ?)', [kind, ref, text]);
  }

  indexMonth(month: MonthKey): void {
    const answers = this.db.all<{ answer: string }>(
      "SELECT answer FROM monthly_reflections WHERE month = ? AND answer <> '' ORDER BY question",
      [month],
    );
    this.put('month', month, answers.map((a) => a.answer).join('\n\n'));
  }

  indexYear(year: number): void {
    const answers = this.db.all<{ answer: string }>(
      "SELECT answer FROM yearly_reflections WHERE year = ? AND answer <> '' ORDER BY question",
      [year],
    );
    this.put('year', String(year), answers.map((a) => a.answer).join('\n\n'));
  }

  /** Indexes a letter if its day has come; a sealed one is removed from the index instead. */
  indexCapsule(id: number, today: DateKey): void {
    const row = this.db.get<{ body: string; open_on: string }>('SELECT body, open_on FROM capsules WHERE id = ?', [id]);
    this.put('capsule', String(id), row && row.open_on <= today ? row.body : '');
  }

  /** Letters whose day has come but that aren't in the index yet (mJournal wasn't open on that day). */
  indexOpenedCapsules(today: DateKey): void {
    const due = this.db.all<{ id: number }>(
      `SELECT id FROM capsules WHERE open_on <= ? AND body <> ''
         AND NOT EXISTS (SELECT 1 FROM writing_index w WHERE w.kind = 'capsule' AND w.ref = CAST(capsules.id AS TEXT))`,
      [today],
    );
    for (const { id } of due) this.indexCapsule(id, today);
  }

  removeCapsule(id: number): void {
    this.db.run("DELETE FROM writing_index WHERE kind = 'capsule' AND ref = ?", [String(id)]);
  }

  /** Rebuilds the whole index (after a migration or a restore). */
  reindexAll(today: DateKey): void {
    this.db.transaction(() => {
      this.db.exec('DELETE FROM writing_index');
      for (const { month } of this.db.all<{ month: string }>('SELECT DISTINCT month FROM monthly_reflections')) this.indexMonth(month);
      for (const { year } of this.db.all<{ year: number }>('SELECT DISTINCT year FROM yearly_reflections')) this.indexYear(year);
      this.indexOpenedCapsules(today);
    });
  }

  /** Matching reflections and opened letters, newest first; `from`/`to` limit the months, years and letter days. */
  search(text: string, range: { from?: DateKey; to?: DateKey } = {}): WritingHit[] {
    const fts = toFtsQuery(text);
    if (!fts) return [];
    const rows = this.db.all<{ kind: WritingKind; ref: string; snippet: string }>(
      `SELECT w.kind, w.ref, snippet(writing_index, 2, char(1), char(2), '…', 16) AS snippet
       FROM writing_index w WHERE writing_index MATCH ? LIMIT ?`,
      [fts, MAX_WRITING_RESULTS * 4],
    );
    const letterDays = new Map(
      this.db
        .all<{ id: number; open_on: string; written_on: string }>('SELECT id, open_on, written_on FROM capsules')
        .map((r) => [String(r.id), r] as const),
    );
    // The period each result covers, to filter by the search's dates and to sort newest first.
    const span = (hit: { kind: WritingKind; ref: string }): [string, string] => {
      if (hit.kind === 'month') return [`${hit.ref}-01`, `${hit.ref}-31`];
      if (hit.kind === 'year') return [`${hit.ref}-01-01`, `${hit.ref}-12-31`];
      const day = letterDays.get(hit.ref)?.open_on ?? '0000-00-00';
      return [day, day];
    };
    return rows
      .filter((hit) => {
        const [start, end] = span(hit);
        return (!range.from || end >= range.from) && (!range.to || start <= range.to);
      })
      .sort((a, b) => span(b)[1].localeCompare(span(a)[1]) || a.kind.localeCompare(b.kind))
      .slice(0, MAX_WRITING_RESULTS)
      .map((hit) => {
        const letter = hit.kind === 'capsule' ? letterDays.get(hit.ref) : undefined;
        return letter ? { ...hit, openOn: letter.open_on, writtenOn: letter.written_on } : hit;
      });
  }
}
