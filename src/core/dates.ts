/**
 * Calendar-date helpers.
 *
 * mJournal stores days as local calendar dates in "YYYY-MM-DD" form (date keys)
 * and months as "YYYY-MM" (month keys). All arithmetic goes through UTC-based
 * day numbers, so daylight-saving changes and time zones can never shift a day.
 */

export type DateKey = string;
export type MonthKey = string;
export type WeekStart = 0 | 1 | 6; // Sunday, Monday, Saturday
export type DateFormatPreference = 'month-first' | 'day-first' | 'iso';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;
const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Number of days in a month; `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return (
    year >= MIN_YEAR &&
    year <= MAX_YEAR &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

export function isMonthKey(value: unknown): value is MonthKey {
  if (typeof value !== 'string') return false;
  const match = MONTH_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= MIN_YEAR && year <= MAX_YEAR && month >= 1 && month <= 12;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function makeDateKey(year: number, month: number, day: number): DateKey {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function makeMonthKey(year: number, month: number): MonthKey {
  return `${pad(year, 4)}-${pad(month)}`;
}

export function parseDateKey(key: DateKey): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(key);
  if (!match) throw new RangeError(`Not a date key: ${key}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function parseMonthKey(key: MonthKey): { year: number; month: number } {
  const match = MONTH_RE.exec(key);
  if (!match) throw new RangeError(`Not a month key: ${key}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** The local calendar date of a JavaScript Date. */
export function toDateKey(date: Date): DateKey {
  return makeDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function todayKey(now: Date = new Date()): DateKey {
  return toDateKey(now);
}

/** Days since 1970-01-01 for a calendar date. Exact integer, independent of time zones. */
export function dayNumber(key: DateKey): number {
  const { year, month, day } = parseDateKey(key);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

export function fromDayNumber(n: number): DateKey {
  const date = new Date(n * MS_PER_DAY);
  return makeDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(key: DateKey, days: number): DateKey {
  return fromDayNumber(dayNumber(key) + days);
}

/** Whole days from `b` to `a` (positive when `a` is later). */
export function diffDays(a: DateKey, b: DateKey): number {
  return dayNumber(a) - dayNumber(b);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(key: DateKey): number {
  // 1970-01-01 was a Thursday (4).
  return (((dayNumber(key) + 4) % 7) + 7) % 7;
}

export function monthOf(key: DateKey): MonthKey {
  return key.slice(0, 7);
}

export function addMonths(month: MonthKey, count: number): MonthKey {
  const { year, month: m } = parseMonthKey(month);
  const index = year * 12 + (m - 1) + count;
  return makeMonthKey(Math.floor(index / 12), (index % 12) + 1);
}

export function firstDayOfMonth(month: MonthKey): DateKey {
  return `${month}-01`;
}

export function lastDayOfMonth(month: MonthKey): DateKey {
  const { year, month: m } = parseMonthKey(month);
  return makeDateKey(year, m, daysInMonth(year, m));
}

export function monthLength(month: MonthKey): number {
  const { year, month: m } = parseMonthKey(month);
  return daysInMonth(year, m);
}

/** Every date key of a month, in order. */
export function monthDays(month: MonthKey): DateKey[] {
  const start = dayNumber(firstDayOfMonth(month));
  return Array.from({ length: monthLength(month) }, (_, i) => fromDayNumber(start + i));
}

/**
 * A six-week grid for a month view. Always 6 rows so the calendar keeps a
 * steady height; days outside the month fill the leading and trailing cells.
 */
export function monthGrid(month: MonthKey, weekStartsOn: WeekStart): DateKey[][] {
  const first = firstDayOfMonth(month);
  const offset = (weekday(first) - weekStartsOn + 7) % 7;
  const start = dayNumber(first) - offset;
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, d) => fromDayNumber(start + week * 7 + d)),
  );
}

/** Weekday numbers (0 = Sunday) in display order for a given week start. */
export function weekdayOrder(weekStartsOn: WeekStart): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);
}

// ---------------------------------------------------------------------------
// Formatting. Dates are rendered in English to match the interface; the user
// chooses month-first, day-first or ISO ordering in Settings.

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = locale + JSON.stringify(options);
  let cached = formatterCache.get(cacheKey);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    formatterCache.set(cacheKey, cached);
  }
  return cached;
}

function utcDate(key: DateKey): Date {
  return new Date(dayNumber(key) * MS_PER_DAY);
}

const localeFor = (pref: DateFormatPreference) => (pref === 'month-first' ? 'en-US' : 'en-GB');

export function weekdayName(key: DateKey, width: 'long' | 'short' = 'long'): string {
  return formatter('en-GB', { weekday: width }).format(utcDate(key));
}

/** Names of the weekdays in display order, e.g. ["Mon", "Tue", …]. */
export function weekdayNames(weekStartsOn: WeekStart, width: 'long' | 'short' | 'narrow' = 'short'): string[] {
  // 2023-01-01 was a Sunday; offset from there to name each weekday.
  return weekdayOrder(weekStartsOn).map((d) =>
    formatter('en-GB', { weekday: width }).format(utcDate(addDays('2023-01-01', d))),
  );
}

/** "Saturday, 24 October 2026" / "Saturday, October 24, 2026" / "Saturday, 2026-10-24". */
export function formatLongDate(key: DateKey, pref: DateFormatPreference): string {
  if (pref === 'iso') return `${weekdayName(key)}, ${key}`;
  return formatter(localeFor(pref), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
    utcDate(key),
  );
}

/** "24 Oct 2026" / "Oct 24, 2026" / "2026-10-24". */
export function formatMediumDate(key: DateKey, pref: DateFormatPreference): string {
  if (pref === 'iso') return key;
  return formatter(localeFor(pref), { day: 'numeric', month: 'short', year: 'numeric' }).format(utcDate(key));
}

/** "24 October" / "October 24" / "10-24". */
export function formatDayMonth(key: DateKey, pref: DateFormatPreference): string {
  if (pref === 'iso') return key.slice(5);
  return formatter(localeFor(pref), { day: 'numeric', month: 'long' }).format(utcDate(key));
}

/** "24 Oct" / "Oct 24" / "10-24". */
export function formatShortDate(key: DateKey, pref: DateFormatPreference): string {
  if (pref === 'iso') return key.slice(5);
  return formatter(localeFor(pref), { day: 'numeric', month: 'short' }).format(utcDate(key));
}

/** "October 2026". */
export function formatMonthYear(month: MonthKey): string {
  return formatter('en-GB', { month: 'long', year: 'numeric' }).format(utcDate(firstDayOfMonth(month)));
}

/** "October". */
export function formatMonthName(month: MonthKey, width: 'long' | 'short' = 'long'): string {
  return formatter('en-GB', { month: width }).format(utcDate(firstDayOfMonth(month)));
}

/** Formats an ISO timestamp as a local time such as "8:42 pm". */
export function formatClockTime(iso: string, pref: DateFormatPreference): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(pref === 'month-first' ? 'en-US' : 'en-GB', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
