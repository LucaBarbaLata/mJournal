import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayNumber,
  daysInMonth,
  diffDays,
  formatDayMonth,
  formatLongDate,
  formatMediumDate,
  formatMonthYear,
  fromDayNumber,
  isDateKey,
  isMonthKey,
  lastDayOfMonth,
  monthDays,
  monthGrid,
  toDateKey,
  weekday,
  weekdayNames,
} from '@core/dates';

describe('date keys', () => {
  it('validates real calendar dates only', () => {
    expect(isDateKey('2026-10-24')).toBe(true);
    expect(isDateKey('2024-02-29')).toBe(true);
    expect(isDateKey('2023-02-29')).toBe(false);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('2026-04-31')).toBe(false);
    expect(isDateKey('2026-1-5')).toBe(false);
    expect(isDateKey('../etc')).toBe(false);
    expect(isDateKey(20261024)).toBe(false);
    expect(isMonthKey('2026-10')).toBe(true);
    expect(isMonthKey('2026-00')).toBe(false);
  });

  it('uses the local calendar date of a Date', () => {
    expect(toDateKey(new Date(2026, 9, 24, 23, 59))).toBe('2026-10-24');
    expect(toDateKey(new Date(2026, 9, 25, 0, 0))).toBe('2026-10-25');
  });

  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    // Daylight-saving changes (e.g. 2026-03-29 and 2026-10-25 in Europe) don't matter.
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('round-trips day numbers and computes differences', () => {
    for (const key of ['1970-01-01', '1999-12-31', '2000-02-29', '2026-10-24', '1900-01-01']) {
      expect(fromDayNumber(dayNumber(key))).toBe(key);
    }
    expect(diffDays('2027-01-01', '2026-12-31')).toBe(1);
    expect(diffDays('2025-01-01', '2024-01-01')).toBe(366);
  });

  it('knows weekdays and month lengths', () => {
    expect(weekday('2026-10-24')).toBe(6); // Saturday
    expect(weekday('1970-01-01')).toBe(4); // Thursday
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(lastDayOfMonth('2026-11')).toBe('2026-11-30');
    expect(monthDays('2026-02')).toHaveLength(28);
  });

  it('moves between months and years', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(addMonths('2026-10', -22)).toBe('2024-12');
    expect(addMonths('2026-10', 15)).toBe('2028-01');
  });
});

describe('month grid', () => {
  it('always has six full weeks starting on the chosen weekday', () => {
    for (const weekStart of [0, 1, 6] as const) {
      const grid = monthGrid('2026-10', weekStart);
      expect(grid).toHaveLength(6);
      for (const week of grid) {
        expect(week).toHaveLength(7);
        expect(weekday(week[0])).toBe(weekStart);
      }
      expect(grid.flat()).toContain('2026-10-01');
      expect(grid.flat()).toContain('2026-10-31');
    }
  });

  it('starts on the 1st when the month begins on the week start', () => {
    // 2026-06-01 is a Monday.
    expect(monthGrid('2026-06', 1)[0][0]).toBe('2026-06-01');
    expect(monthGrid('2026-06', 0)[0][0]).toBe('2026-05-31');
  });

  it('names weekdays in display order', () => {
    expect(weekdayNames(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(weekdayNames(0)[0]).toBe('Sun');
    expect(weekdayNames(6)[0]).toBe('Sat');
  });
});

describe('formatting', () => {
  it('formats dates in the preferred order without shifting the day', () => {
    expect(formatLongDate('2026-10-24', 'day-first')).toBe('Saturday, 24 October 2026');
    expect(formatLongDate('2026-10-24', 'month-first')).toBe('Saturday, October 24, 2026');
    expect(formatLongDate('2026-10-24', 'iso')).toBe('Saturday, 2026-10-24');
    expect(formatMediumDate('2026-01-01', 'month-first')).toBe('Jan 1, 2026');
    expect(formatMediumDate('2026-01-01', 'day-first')).toBe('1 Jan 2026');
    expect(formatDayMonth('2026-12-31', 'day-first')).toBe('31 December');
    expect(formatMonthYear('2026-10')).toBe('October 2026');
  });
});
