/**
 * "Moments to revisit", picked only by these published rules (also explained in the app):
 * 1. days marked as a favorite, 2. answers marked as a favorite moment,
 * 3. the period's longest entry (40+ words), 4. days with three or more photos.
 * The month and the year in review use the same rules; a year keeps a mix of
 * kinds and spreads them over the year.
 */
import type { DaySummary, NotableMoment } from '@core/api';
import type { DateKey } from '@core/dates';
import { makeExcerpt } from '@core/text';
import type { Db } from './database';

/** A day needs at least this many words to be shown as the period's longest entry. */
export const LONGEST_ENTRY_MIN_WORDS = 40;
/** A day needs at least this many photos to be shown as a photo-filled day. */
export const PHOTO_DAY_MIN_PHOTOS = 3;

export interface MomentOptions {
  max: number;
  period: 'month' | 'year';
  /** At most this many of each kind (spread evenly over the period). No limit when left out. */
  perKind?: Partial<Record<NotableMoment['kind'], number>>;
}

/** Up to `n` items, evenly spread over the list (first and last included). */
function spread<T>(items: T[], n: number | undefined): T[] {
  if (n === undefined || items.length <= n) return items;
  if (n <= 0) return [];
  if (n === 1) return [items[0]];
  return Array.from({ length: n }, (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]);
}

export function pickMoments(db: Db, days: DaySummary[], from: DateKey, to: DateKey, options: MomentOptions): NotableMoment[] {
  const { max, period, perKind = {} } = options;
  const moments: NotableMoment[] = [];
  const seenDays = new Set<string>();
  const add = (moment: NotableMoment, dayLevel: boolean) => {
    if (moments.length >= max) return;
    if (dayLevel && seenDays.has(moment.date)) return;
    if (dayLevel) seenDays.add(moment.date);
    moments.push(moment);
  };

  for (const day of spread(
    days.filter((d) => d.favorite),
    perKind['favorite-day'],
  )) {
    add(
      { date: day.date, kind: 'favorite-day', reason: 'You marked this day as a favorite.', title: null, excerpt: day.excerpt, mood: day.mood },
      true,
    );
  }

  const favoriteAnswers = db.all<{ entry_date: string; prompt_text: string; answer: string; mood: string | null }>(
    `SELECT a.entry_date, a.prompt_text, a.answer, e.mood FROM answers a JOIN entries e ON e.date = a.entry_date
     WHERE a.favorite = 1 AND a.answer <> '' AND a.entry_date BETWEEN ? AND ? ORDER BY a.entry_date, a.position`,
    [from, to],
  );
  for (const answer of spread(favoriteAnswers, perKind['favorite-answer'])) {
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
        reason: `Your longest entry this ${period} (${longest.wordCount.toLocaleString('en')} words).`,
        title: null,
        excerpt: longest.excerpt,
        mood: longest.mood,
      },
      true,
    );
  }

  const photoDays = [...days].filter((d) => d.photoCount >= PHOTO_DAY_MIN_PHOTOS).sort((a, b) => b.photoCount - a.photoCount);
  for (const day of perKind.photos === undefined ? photoDays : photoDays.slice(0, perKind.photos)) {
    add(
      { date: day.date, kind: 'photos', reason: `${day.photoCount} photos from this day.`, title: null, excerpt: day.excerpt, mood: day.mood },
      true,
    );
  }

  return moments.sort((a, b) => a.date.localeCompare(b.date));
}
