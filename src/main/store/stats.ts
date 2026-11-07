/** Gentle, factual statistics. Nothing here interprets or judges the data. */
import type { StatsOverview, StatsRange, YearInMoods } from '@core/api';
import { addMonths, firstDayOfMonth, makeDateKey, monthDays, monthOf, type DateKey, type MonthKey } from '@core/dates';
import { computeStreaks, type StreakSummary } from '@core/streaks';
import type { Db } from './database';
import type { EntriesStore } from './entries';

const MONTHS_SHOWN = 12;

export function rangeStart(today: DateKey, range: StatsRange): DateKey | null {
  const month = monthOf(today);
  switch (range) {
    case 'month':
      return firstDayOfMonth(month);
    case 'quarter':
      return firstDayOfMonth(addMonths(month, -2));
    case 'year':
      return firstDayOfMonth(addMonths(month, -(MONTHS_SHOWN - 1)));
    case 'all':
      return null;
  }
}

export class StatsStore {
  constructor(
    private readonly db: Db,
    private readonly entries: EntriesStore,
  ) {}

  overview(today: DateKey, range: StatsRange): StatsOverview {
    const days = this.entries.contentDays();
    const currentMonth = monthOf(today);
    const months: MonthKey[] = Array.from({ length: MONTHS_SHOWN }, (_, i) => addMonths(currentMonth, i - (MONTHS_SHOWN - 1)));
    const windowStart = firstDayOfMonth(months[0]);

    const perMonth = new Map(
      this.db
        .all<{ month: string; count: number }>(
          `SELECT substr(date, 1, 7) AS month, COUNT(*) AS count FROM entries
           WHERE has_content AND date >= ? AND date <= ? GROUP BY month`,
          [windowStart, today],
        )
        .map((r) => [r.month, r.count]),
    );

    const moodRows = this.db.all<{ month: string; mood: string; count: number }>(
      `SELECT substr(date, 1, 7) AS month, mood, COUNT(*) AS count FROM entries
       WHERE mood IS NOT NULL AND date >= ? AND date <= ? GROUP BY month, mood`,
      [windowStart, today],
    );
    const moodByMonth = months.map((month) => {
      const counts: Record<string, number> = {};
      let total = 0;
      for (const row of moodRows) {
        if (row.month !== month) continue;
        counts[row.mood] = row.count;
        total += row.count;
      }
      return { month, total, counts };
    });

    const energy = new Map(
      this.db
        .all<{ month: string; average: number; days: number }>(
          `SELECT substr(date, 1, 7) AS month, AVG(energy) AS average, COUNT(*) AS days FROM entries
           WHERE energy IS NOT NULL AND date >= ? AND date <= ? GROUP BY month`,
          [windowStart, today],
        )
        .map((r) => [r.month, r]),
    );

    const start = rangeStart(today, range);
    const distribution = this.db.all<{ mood: string; count: number }>(
      `SELECT mood, COUNT(*) AS count FROM entries
       WHERE mood IS NOT NULL AND date >= ? AND date <= ? GROUP BY mood ORDER BY count DESC, mood`,
      [start ?? '0000-00-00', today],
    );

    const totals = this.db.get<{ words: number | null }>('SELECT SUM(word_count) AS words FROM entries WHERE has_content')!;
    const photos = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM photos WHERE removed_at IS NULL')!;
    const rangeFrom = start ?? '0000-00-00';

    // Moods per weekday in the period (strftime %w: 0 = Sunday).
    const weekdayRows = this.db.all<{ weekday: number; mood: string; count: number }>(
      `SELECT CAST(strftime('%w', date) AS INTEGER) AS weekday, mood, COUNT(*) AS count FROM entries
       WHERE mood IS NOT NULL AND date >= ? AND date <= ? GROUP BY weekday, mood`,
      [rangeFrom, today],
    );
    const moodByWeekday = Array.from({ length: 7 }, (_, weekday) => {
      const counts: Record<string, number> = {};
      let total = 0;
      for (const row of weekdayRows) {
        if (row.weekday !== weekday) continue;
        counts[row.mood] = row.count;
        total += row.count;
      }
      return { weekday, total, counts };
    });

    const energyByMood = this.db
      .all<{ mood: string; average: number; days: number }>(
        `SELECT mood, AVG(energy) AS average, COUNT(*) AS days FROM entries
         WHERE mood IS NOT NULL AND energy IS NOT NULL AND date >= ? AND date <= ?
         GROUP BY mood ORDER BY days DESC, mood`,
        [rangeFrom, today],
      )
      .map((r) => ({ mood: r.mood, average: Math.round(r.average * 10) / 10, days: r.days }));

    const words = new Map(
      this.db
        .all<{ month: string; words: number }>(
          `SELECT substr(date, 1, 7) AS month, SUM(word_count) AS words FROM entries
           WHERE has_content AND date >= ? AND date <= ? GROUP BY month`,
          [windowStart, today],
        )
        .map((r) => [r.month, r.words]),
    );
    const photosPerMonth = new Map(
      this.db
        .all<{ month: string; count: number }>(
          `SELECT substr(entry_date, 1, 7) AS month, COUNT(*) AS count FROM photos
           WHERE removed_at IS NULL AND entry_date >= ? AND entry_date <= ? GROUP BY month`,
          [windowStart, today],
        )
        .map((r) => [r.month, r.count]),
    );

    const tagCounts = this.db.all<{ tag: string; label: string; count: number }>(
      `SELECT et.tag, t.label, COUNT(*) AS count FROM entry_tags et JOIN tags t ON t.name = et.tag
       WHERE et.entry_date >= ? AND et.entry_date <= ? GROUP BY et.tag ORDER BY count DESC, t.label COLLATE NOCASE LIMIT 12`,
      [rangeFrom, today],
    );

    return {
      today,
      streak: computeStreaks(days, today),
      totalEntries: days.length,
      totalWords: totals.words ?? 0,
      totalPhotos: photos.n,
      firstEntryDate: days[0] ?? null,
      daysThisMonth: days.filter((d) => d.startsWith(currentMonth) && d <= today).length,
      entriesPerMonth: months.map((month) => ({ month, count: perMonth.get(month) ?? 0 })),
      moodDistribution: {
        range,
        total: distribution.reduce((n, r) => n + r.count, 0),
        counts: distribution,
      },
      moodByMonth,
      energyByMonth: months.map((month) => {
        const row = energy.get(month);
        return { month, average: row ? Math.round(row.average * 10) / 10 : null, days: row?.days ?? 0 };
      }),
      moodByWeekday,
      energyByMood,
      wordsByMonth: months.map((month) => ({ month, words: words.get(month) ?? 0 })),
      photosByMonth: months.map((month) => ({ month, count: photosPerMonth.get(month) ?? 0 })),
      tagCounts,
    };
  }

  /** The streak alone: one small query, so Today can ask after every save. */
  streak(today: DateKey): StreakSummary {
    return computeStreaks(this.entries.contentDays(), today);
  }

  yearInMoods(year: number): YearInMoods {
    const rows = new Map(
      this.db
        .all<{ date: string; mood: string | null; has_content: number }>(
          'SELECT date, mood, has_content FROM entries WHERE date BETWEEN ? AND ?',
          [makeDateKey(year, 1, 1), makeDateKey(year, 12, 31)],
        )
        .map((r) => [r.date, r]),
    );
    const days = Array.from({ length: 12 }, (_, i) => monthDays(`${year}-${String(i + 1).padStart(2, '0')}`)).flat();
    return {
      year,
      days: days.map((date) => {
        const row = rows.get(date);
        return { date, mood: row?.mood ?? null, hasEntry: row?.has_content === 1 };
      }),
    };
  }
}
