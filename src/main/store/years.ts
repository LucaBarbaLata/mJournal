/**
 * The year in review: what was recorded in a year (counts only, nothing
 * interpreted), month by month with each month's intention, moments picked by
 * the same published rules as the monthly recap, a few photos, and the
 * person's own reflection on the year.
 */
import type { PhotoRecord, YearRecap } from '@core/api';
import { isLeapYear, makeDateKey, makeMonthKey, monthOf } from '@core/dates';
import { MONTHLY_INTENTION_KEY, YEARLY_KEYS } from '@core/prompts';
import { UserFacingError } from '@core/validation';
import type { Db } from './database';
import type { EntriesStore } from './entries';
import { pickMoments } from './moments';
import type { PhotoStore } from './photos';
import type { WritingIndex } from './writingIndex';

export const YEAR_MOMENTS = 12;
export const YEAR_PHOTOS = 12;

/** Up to `n` items, evenly spread over the list. */
function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.round((i * (items.length - 1)) / Math.max(1, n - 1))]);
}

export class YearStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => string,
    private readonly entries: EntriesStore,
    private readonly photos: PhotoStore,
    private readonly writing: WritingIndex,
  ) {}

  reflection(year: number): { answers: Record<string, string>; updatedAt: string | null } {
    const answers: Record<string, string> = {};
    let updatedAt: string | null = null;
    for (const row of this.db.all<{ question: string; answer: string; updated_at: string }>(
      'SELECT question, answer, updated_at FROM yearly_reflections WHERE year = ?',
      [year],
    )) {
      answers[row.question] = row.answer;
      if (!updatedAt || row.updated_at > updatedAt) updatedAt = row.updated_at;
    }
    return { answers, updatedAt };
  }

  save(year: number, key: string, answer: string): { updatedAt: string } {
    if (!YEARLY_KEYS.includes(key)) throw new UserFacingError('unknown-question', 'That reflection question is unknown.');
    const updatedAt = this.now();
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO yearly_reflections (year, question, answer, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (year, question) DO UPDATE SET answer = excluded.answer, updated_at = excluded.updated_at`,
        [year, key, answer, updatedAt],
      );
      this.writing.indexYear(year);
    });
    return { updatedAt };
  }

  recap(year: number): YearRecap {
    const from = makeDateKey(year, 1, 1);
    const to = makeDateKey(year, 12, 31);
    const days = this.entries.summaries(from, to);

    const moodCounts = new Map<string, number>();
    let energyTotal = 0;
    let energyDays = 0;
    for (const day of days) {
      if (day.mood) moodCounts.set(day.mood, (moodCounts.get(day.mood) ?? 0) + 1);
      if (day.energy != null) {
        energyTotal += day.energy;
        energyDays++;
      }
    }

    const intentions = new Map(
      this.db
        .all<{ month: string; answer: string }>(
          "SELECT month, answer FROM monthly_reflections WHERE question = ? AND answer <> '' AND month BETWEEN ? AND ?",
          [MONTHLY_INTENTION_KEY, makeMonthKey(year, 1), makeMonthKey(year, 12)],
        )
        .map((r) => [r.month, r.answer.trim()]),
    );
    const months = Array.from({ length: 12 }, (_, i) => {
      const month = makeMonthKey(year, i + 1);
      const inMonth = days.filter((d) => monthOf(d.date) === month);
      const counts = new Map<string, number>();
      for (const d of inMonth) if (d.mood) counts.set(d.mood, (counts.get(d.mood) ?? 0) + 1);
      const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return { month, days: inMonth.length, topMood: top ? top[0] : null, intention: intentions.get(month) ?? '' };
    });

    // Photos: the favorites first, then the others spread over the year.
    const all: PhotoRecord[] = this.photos.inRange(from, to);
    const favorites = all.filter((p) => p.favorite);
    const photos = [
      ...spread(favorites, YEAR_PHOTOS),
      ...spread(
        all.filter((p) => !p.favorite),
        Math.max(0, YEAR_PHOTOS - favorites.length),
      ),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position);

    const tags = this.db.all<{ label: string; count: number }>(
      `SELECT t.label, COUNT(*) AS count FROM entry_tags et JOIN tags t ON t.name = et.tag
       WHERE et.entry_date BETWEEN ? AND ? GROUP BY et.tag ORDER BY count DESC, t.label COLLATE NOCASE LIMIT 10`,
      [from, to],
    );

    const { answers, updatedAt } = this.reflection(year);
    return {
      year,
      daysInYear: isLeapYear(year) ? 366 : 365,
      daysWithEntries: days.length,
      moodCounts: [...moodCounts]
        .map(([mood, count]) => ({ mood, count }))
        .sort((a, b) => b.count - a.count || a.mood.localeCompare(b.mood)),
      averageEnergy: energyDays > 0 ? Math.round((energyTotal / energyDays) * 10) / 10 : null,
      energyDays,
      totalWords: days.reduce((n, d) => n + d.wordCount, 0),
      photoCount: all.length,
      months,
      moments: pickMoments(this.db, days, from, to, {
        max: YEAR_MOMENTS,
        period: 'year',
        perKind: { 'favorite-day': 6, 'favorite-answer': 4, photos: 2 },
      }),
      photos,
      tags,
      reflection: answers,
      reflectionUpdatedAt: updatedAt,
    };
  }
}
