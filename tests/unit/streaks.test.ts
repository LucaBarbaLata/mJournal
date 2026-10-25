import { describe, expect, it } from 'vitest';
import { addDays } from '@core/dates';
import { computeStreaks } from '@core/streaks';

const run = (start: string, length: number) => Array.from({ length }, (_, i) => addDays(start, i));

describe('computeStreaks', () => {
  it('is zero for an empty journal', () => {
    expect(computeStreaks([], '2026-10-24')).toEqual({
      current: 0,
      currentStart: null,
      longest: 0,
      longestStart: null,
      longestEnd: null,
    });
  });

  it('counts a single entry today', () => {
    const s = computeStreaks(['2026-10-24'], '2026-10-24');
    expect(s.current).toBe(1);
    expect(s.currentStart).toBe('2026-10-24');
    expect(s.longest).toBe(1);
  });

  it('keeps the streak alive until today is over', () => {
    const s = computeStreaks(run('2026-10-20', 4), '2026-10-24'); // 20–23, nothing yet today
    expect(s.current).toBe(4);
    expect(s.currentStart).toBe('2026-10-20');
  });

  it('resets after a missed day without touching the longest streak', () => {
    const days = [...run('2026-10-01', 10), ...run('2026-10-21', 3)]; // 1–10 and 21–23
    const s = computeStreaks(days, '2026-10-24'); // 23 was the last day; 24 still open
    expect(s.current).toBe(3);
    expect(s.longest).toBe(10);
    expect(s.longestStart).toBe('2026-10-01');
    expect(s.longestEnd).toBe('2026-10-10');

    const later = computeStreaks(days, '2026-10-25'); // two empty days: 24 and 25 so far
    expect(later.current).toBe(0);
    expect(later.currentStart).toBeNull();
    expect(later.longest).toBe(10);
  });

  it('continues across month and year boundaries', () => {
    expect(computeStreaks(run('2026-12-29', 5), '2027-01-02').current).toBe(5);
    expect(computeStreaks(run('2026-10-30', 4), '2026-11-02').current).toBe(4);
  });

  it('handles leap days', () => {
    expect(computeStreaks(['2024-02-28', '2024-02-29', '2024-03-01'], '2024-03-01').current).toBe(3);
    // 2023 has no Feb 29, so Feb 28 → Mar 1 is consecutive.
    expect(computeStreaks(['2023-02-27', '2023-02-28', '2023-03-01'], '2023-03-01').current).toBe(3);
    // In 2024 skipping Feb 29 breaks the run.
    expect(computeStreaks(['2024-02-28', '2024-03-01'], '2024-03-01').current).toBe(1);
  });

  it('ignores duplicates, invalid keys, ordering and future days', () => {
    const s = computeStreaks(
      ['2026-10-24', '2026-10-22', 'nonsense', '2026-10-23', '2026-10-23', '2026-10-30', '2026-10-31'],
      '2026-10-24',
    );
    expect(s.current).toBe(3);
    expect(s.longest).toBe(3);
  });

  it('prefers the most recent run when two are equally long', () => {
    const s = computeStreaks([...run('2026-01-01', 3), ...run('2026-05-01', 3)], '2026-10-24');
    expect(s.longest).toBe(3);
    expect(s.longestStart).toBe('2026-05-01');
  });

  it('handles a long history efficiently', () => {
    const days = run('2016-01-01', 3000);
    const s = computeStreaks(days, addDays('2016-01-01', 2999));
    expect(s.current).toBe(3000);
    expect(s.longest).toBe(3000);
  });
});
