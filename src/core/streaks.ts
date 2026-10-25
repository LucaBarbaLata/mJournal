/**
 * Journaling streaks.
 *
 * Rules (also shown to the user in Insights):
 * - A day counts when anything was saved for it: a mood, energy, words or a photo.
 * - A streak is a run of consecutive calendar days that count.
 * - The current streak is the run ending today. If today has nothing yet, the run
 *   ending yesterday is still current, because the day isn't over.
 * - Days after `today` are ignored, so clock changes can't inflate a streak.
 * - Dates are calendar days, so month ends, year ends, leap days and
 *   daylight-saving changes need no special handling.
 */
import { dayNumber, fromDayNumber, isDateKey, type DateKey } from './dates';

export interface StreakSummary {
  current: number;
  currentStart: DateKey | null;
  longest: number;
  longestStart: DateKey | null;
  longestEnd: DateKey | null;
}

export function computeStreaks(days: Iterable<DateKey>, today: DateKey): StreakSummary {
  const todayNumber = dayNumber(today);
  const numbers = new Set<number>();
  for (const day of days) {
    if (!isDateKey(day)) continue;
    const n = dayNumber(day);
    if (n <= todayNumber) numbers.add(n);
  }

  const summary: StreakSummary = { current: 0, currentStart: null, longest: 0, longestStart: null, longestEnd: null };
  if (numbers.size === 0) return summary;

  const sorted = [...numbers].sort((a, b) => a - b);
  let runStart = sorted[0];
  let previous = sorted[0];
  const closeRun = (start: number, end: number) => {
    const length = end - start + 1;
    // ">=" keeps the most recent run when two are equally long.
    if (length >= summary.longest) {
      summary.longest = length;
      summary.longestStart = fromDayNumber(start);
      summary.longestEnd = fromDayNumber(end);
    }
  };
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n !== previous + 1) {
      closeRun(runStart, previous);
      runStart = n;
    }
    previous = n;
  }
  closeRun(runStart, previous);

  const anchor = numbers.has(todayNumber) ? todayNumber : numbers.has(todayNumber - 1) ? todayNumber - 1 : null;
  if (anchor !== null) {
    let start = anchor;
    while (numbers.has(start - 1)) start--;
    summary.current = anchor - start + 1;
    summary.currentStart = fromDayNumber(start);
  }
  return summary;
}
