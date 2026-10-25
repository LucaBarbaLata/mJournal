/**
 * Monthly recaps: recorded statistics for a month, its photos, a few notable
 * moments picked by simple published rules, and the user's own reflection.
 */
import type { DaySummary, MonthRecap, NotableMoment } from '@core/api';
import { firstDayOfMonth, lastDayOfMonth, monthLength, type MonthKey } from '@core/dates';
import { MONTHLY_KEYS } from '@core/prompts';
import { makeExcerpt } from '@core/text';
import { UserFacingError } from '@core/validation';
import type { Db } from './database';
import type { EntriesStore } from './entries';
import type { PhotoStore } from './photos';

/** A day needs at least this many words to be shown as the month's longest entry. */
export const LONGEST_ENTRY_MIN_WORDS = 40;
/** A day needs at least this many photos to be shown as a photo-filled day. */
export const PHOTO_DAY_MIN_PHOTOS = 3;
export const MAX_MOMENTS = 6;

export class ReflectionStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => string,
    private readonly entries: EntriesStore,
    private readonly photos: PhotoStore,
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
    this.db.run(
      `INSERT INTO monthly_reflections (month, question, answer, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (month, question) DO UPDATE SET answer = excluded.answer, updated_at = excluded.updated_at`,
      [month, key, answer, updatedAt],
    );
    return { updatedAt };
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
      moments: this.moments(month, days),
      reflection: answers,
      reflectionUpdatedAt: updatedAt,
    };
  }

  /**
   * Notable moments, chosen only by these rules (also explained in the app):
   * 1. days marked as a favorite, 2. answers marked as a favorite moment,
   * 3. the month's longest entry, 4. days with several photos.
   */
  private moments(month: MonthKey, days: DaySummary[]): NotableMoment[] {
    const moments: NotableMoment[] = [];
    const seenDays = new Set<string>();
    const add = (moment: NotableMoment, dayLevel: boolean) => {
      if (moments.length >= MAX_MOMENTS) return;
      if (dayLevel && seenDays.has(moment.date)) return;
      if (dayLevel) seenDays.add(moment.date);
      moments.push(moment);
    };

    for (const day of days.filter((d) => d.favorite)) {
      add(
        { date: day.date, kind: 'favorite-day', reason: 'You marked this day as a favorite.', title: null, excerpt: day.excerpt, mood: day.mood },
        true,
      );
    }

    const favoriteAnswers = this.db.all<{ entry_date: string; prompt_text: string; answer: string; mood: string | null }>(
      `SELECT a.entry_date, a.prompt_text, a.answer, e.mood FROM answers a JOIN entries e ON e.date = a.entry_date
       WHERE a.favorite = 1 AND a.answer <> '' AND a.entry_date BETWEEN ? AND ? ORDER BY a.entry_date, a.position`,
      [firstDayOfMonth(month), lastDayOfMonth(month)],
    );
    for (const answer of favoriteAnswers) {
      add(
        {
          date: answer.entry_date,
          kind: 'favorite-answer',
          reason: 'You saved this answer as a favorite moment.',
          title: answer.prompt_text,
          excerpt: makeExcerpt(answer.answer, 260),
          mood: answer.mood,
        },
        false,
      );
    }

    const longest = [...days].sort((a, b) => b.wordCount - a.wordCount)[0];
    if (longest && longest.wordCount >= LONGEST_ENTRY_MIN_WORDS) {
      add(
        {
          date: longest.date,
          kind: 'longest-entry',
          reason: `Your longest entry this month (${longest.wordCount.toLocaleString('en')} words).`,
          title: null,
          excerpt: longest.excerpt,
          mood: longest.mood,
        },
        true,
      );
    }

    for (const day of [...days].filter((d) => d.photoCount >= PHOTO_DAY_MIN_PHOTOS).sort((a, b) => b.photoCount - a.photoCount)) {
      add(
        { date: day.date, kind: 'photos', reason: `${day.photoCount} photos from this day.`, title: null, excerpt: day.excerpt, mood: day.mood },
        true,
      );
    }

    return moments.sort((a, b) => a.date.localeCompare(b.date));
  }
}
