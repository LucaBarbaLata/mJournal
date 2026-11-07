/** Local full-text search and filtering over journal entries. Nothing leaves the computer. */
import type { JournalMonthCount, SearchPage, SearchQuery, SearchResult } from '@core/api';
import { toFtsQuery } from '@core/search';
import type { SQLInputValue } from 'node:sqlite';
import type { Db } from './database';
import { TAG_LABELS_SELECT, toDaySummary, type EntryRow } from './entries';

export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;

type ResultRow = EntryRow & { first_answer: string | null; tag_labels: string | null; snippet?: string | null };

export class SearchStore {
  constructor(private readonly db: Db) {}

  search(query: SearchQuery): SearchPage {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const oldestFirst = query.order === 'oldest';
    const fts = query.text ? toFtsQuery(query.text) : null;

    const where: string[] = ['e.has_content'];
    const params: SQLInputValue[] = [];
    if (fts) {
      where.push('search_index MATCH ?');
      params.push(fts);
    }
    if (query.from) {
      where.push('e.date >= ?');
      params.push(query.from);
    }
    if (query.to) {
      where.push('e.date <= ?');
      params.push(query.to);
    }
    if (query.moods && query.moods.length > 0) {
      where.push(`e.mood IN (${query.moods.map(() => '?').join(', ')})`);
      params.push(...query.moods);
    }
    if (query.withPhotos) where.push('e.photo_count > 0');
    if (query.tags && query.tags.length > 0) {
      where.push(`e.date IN (SELECT entry_date FROM entry_tags WHERE tag IN (${query.tags.map(() => '?').join(', ')}))`);
      params.push(...query.tags);
    }
    if (query.favoritesOnly) where.push('(e.favorite = 1 OR e.favorite_moments > 0)');

    const from = fts
      ? `search_index JOIN entries e ON e.date = date(search_index.rowid * 86400, 'unixepoch')`
      : 'entries e';
    const filter = where.join(' AND ');
    const total = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${from} WHERE ${filter}`, params)!.n;

    const pageWhere = [...where];
    const pageParams = [...params];
    if (query.cursor) {
      pageWhere.push(oldestFirst ? 'e.date > ?' : 'e.date < ?');
      pageParams.push(query.cursor);
    }
    const snippet = fts ? `, snippet(search_index, -1, char(1), char(2), '…', 16) AS snippet` : '';
    const rows = this.db.all<ResultRow>(
      `SELECT e.*,
         (SELECT a.answer FROM answers a WHERE a.entry_date = e.date AND a.answer <> ''
           ORDER BY a.position LIMIT 1) AS first_answer,
         ${TAG_LABELS_SELECT}
         ${snippet}
       FROM ${from}
       WHERE ${pageWhere.join(' AND ')}
       ORDER BY e.date ${oldestFirst ? 'ASC' : 'DESC'}
       LIMIT ?`,
      [...pageParams, limit + 1],
    );

    const page = rows.slice(0, limit);
    const results: SearchResult[] = page.map((row) => ({ ...toDaySummary(row), snippet: row.snippet ?? null }));
    return {
      results,
      nextCursor: rows.length > limit ? page[page.length - 1].date : null,
      total,
    };
  }

  /** Months that have entries, newest first, for the history filters. */
  months(): JournalMonthCount[] {
    return this.db.all<JournalMonthCount>(
      `SELECT substr(date, 1, 7) AS month, COUNT(*) AS count FROM entries
       WHERE has_content GROUP BY month ORDER BY month DESC`,
    );
  }
}
