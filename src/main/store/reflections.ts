/**
 * Monthly recaps: recorded statistics for a month, its photos, a few notable
 * moments picked by simple published rules, and the user's own reflection.
 */
import type { MonthRecap } from '@core/api';
import { firstDayOfMonth, lastDayOfMonth, monthLength, type MonthKey } from '@core/dates';
import { MONTHLY_INTENTION_KEY, MONTHLY_KEYS } from '@core/prompts';
import { UserFacingError } from '@core/validation';
import type { Db } from './database';
import type { EntriesStore } from './entries';
import { pickMoments } from './moments';
import type { PhotoStore } from './photos';
import type { WritingIndex } from './writingIndex';

export { LONGEST_ENTRY_MIN_WORDS, PHOTO_DAY_MIN_PHOTOS } from './moments';
export const MAX_MOMENTS = 6;

export class ReflectionStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => string,
    private readonly entries: EntriesStore,
    private readonly photos: PhotoStore,
    private readonly writing: WritingIndex,
  ) {}

  reflection(month: MonthKey): { answers: Record<string, string>; updatedAt: string | null } {
    const rows = this.db.all<{ question: string; answer: string; updated_at: string }>(
      'SELECT question, answer, updated_at FROM monthly_reflections WHERE month = ?',
      [month],
    );
    const answers: Record<string, string> = {};
    let updatedAt: string | null = null;
    for (const row of rows) {
      answers[row.question] = row.answer;
      if (!updatedAt || row.updated_at > updatedAt) updatedAt = row.updated_at;
    }
    return { answers, updatedAt };
  }

  save(month: MonthKey, key: string, answer: string): { updatedAt: string } {
    if (!MONTHLY_KEYS.includes(key)) throw new UserFacingError('unknown-question', 'That reflection question is unknown.');
    const updatedAt = this.now();
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO monthly_reflections (month, question, answer, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (month, question) DO UPDATE SET answer = excluded.answer, updated_at = excluded.updated_at`,
        [month, key, answer, updatedAt],
      );
      this.writing.indexMonth(month);
    });
    return { updatedAt };
  }

  /** The month's intention, or "" when none was set. */
  intention(month: MonthKey): string {
    return (
      this.db.get<{ answer: string }>('SELECT answer FROM monthly_reflections WHERE month = ? AND question = ?', [
        month,
        MONTHLY_INTENTION_KEY,
      ])?.answer ?? ''
    );
  }

  recap(month: MonthKey): MonthRecap {
    const days = this.entries.monthSummaries(month);
    const counts = new Map<string, number>();
    let energyTotal = 0;
    let energyDays = 0;
    for (const day of days) {
      if (day.mood) counts.set(day.mood, (counts.get(day.mood) ?? 0) + 1);
      if (day.energy != null) {
        energyTotal += day.energy;
        energyDays++;
      }
    }
    const moodCounts = [...counts.entries()]
      .map(([mood, count]) => ({ mood, count }))
      .sort((a, b) => b.count - a.count || a.mood.localeCompare(b.mood));
    const { answers, updatedAt } = this.reflection(month);
    return {
      month,
      daysInMonth: monthLength(month),
      daysWithEntries: days.length,
      moodCounts,
      moodDays: days.filter((d) => d.mood).length,
      averageEnergy: energyDays > 0 ? Math.round((energyTotal / energyDays) * 10) / 10 : null,
      energyDays,
      totalWords: days.reduce((n, d) => n + d.wordCount, 0),
      photoCount: days.reduce((n, d) => n + d.photoCount, 0),
      days,
      photos: this.photos.inRange(firstDayOfMonth(month), lastDayOfMonth(month)),
      moments: pickMoments(this.db, days, firstDayOfMonth(month), lastDayOfMonth(month), { max: MAX_MOMENTS, period: 'month' }),
      reflection: answers,
      reflectionUpdatedAt: updatedAt,
    };
  }
}
