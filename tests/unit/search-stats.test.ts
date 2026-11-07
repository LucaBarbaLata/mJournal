import { describe, expect, it } from 'vitest';
import { addDays } from '@core/dates';
import { HIGHLIGHT_END, HIGHLIGHT_START } from '@core/text';
import { PNG_1PX, openJournal } from './helpers';

async function sampleJournal() {
  const journal = openJournal();
  journal.entries.update('2026-09-02', { body: 'Bought a croissant at the new café', mood: 'happy', energy: 4 });
  journal.entries.update('2026-10-01', { body: 'Rain all afternoon.', mood: 'calm', energy: 2 });
  journal.entries.saveAnswer('2026-10-05', { promptId: 'joy-02', promptText: 'Who or what made me smile?', answer: 'My grandmother’s stories' });
  journal.entries.update('2026-10-10', { mood: 'tired', moodNote: 'Exams week' });
  journal.entries.update('2026-10-12', { body: 'Favorite day ever', favorite: true });
  await journal.photos.importSources('2026-10-15', [{ name: 'lake.png', data: PNG_1PX }]);
  journal.photos.update(journal.photos.forDay('2026-10-15')[0].id, { caption: 'Swans on the lake' });
  journal.entries.update('2026-10-20', { body: '   ' }); // empty: never listed
  return journal;
}

describe('search', () => {
  it('finds words in writing, answers, mood notes and captions', async () => {
    const journal = await sampleJournal();
    const find = (text: string) => journal.search.search({ text }).results.map((r) => r.date);
    expect(find('croissant')).toEqual(['2026-09-02']);
    expect(find('grandmother')).toEqual(['2026-10-05']);
    expect(find('exams')).toEqual(['2026-10-10']);
    expect(find('swans')).toEqual(['2026-10-15']);
    expect(find('nothing-like-this')).toEqual([]);
  });

  it('matches word beginnings and ignores accents and case', async () => {
    const journal = await sampleJournal();
    expect(journal.search.search({ text: 'CROISS' }).results.map((r) => r.date)).toEqual(['2026-09-02']);
    expect(journal.search.search({ text: 'cafe' }).results.map((r) => r.date)).toEqual(['2026-09-02']);
    expect(journal.search.search({ text: 'rain afternoon' }).results.map((r) => r.date)).toEqual(['2026-10-01']);
  });

  it('returns snippets with highlight markers and safe input handling', async () => {
    const journal = await sampleJournal();
    const [result] = journal.search.search({ text: 'croissant' }).results;
    expect(result.snippet).toContain(`${HIGHLIGHT_START}croissant${HIGHLIGHT_END}`);
    expect(journal.search.search({ text: '" OR 1=1 --' }).results).toBeDefined();
    expect(journal.search.search({ text: '***' }).results).toHaveLength(6);
  });

  it('lists every saved day, newest first, without empty days', async () => {
    const journal = await sampleJournal();
    const page = journal.search.search({});
    expect(page.results.map((r) => r.date)).toEqual(['2026-10-15', '2026-10-12', '2026-10-10', '2026-10-05', '2026-10-01', '2026-09-02']);
    expect(page.total).toBe(6);
    expect(journal.search.search({ order: 'oldest' }).results[0].date).toBe('2026-09-02');
  });

  it('filters by date range, mood, photos and favorites', async () => {
    const journal = await sampleJournal();
    const dates = (q: Parameters<typeof journal.search.search>[0]) => journal.search.search(q).results.map((r) => r.date);
    expect(dates({ from: '2026-10-01', to: '2026-10-10' })).toEqual(['2026-10-10', '2026-10-05', '2026-10-01']);
    expect(dates({ moods: ['happy', 'calm'] })).toEqual(['2026-10-01', '2026-09-02']);
    expect(dates({ withPhotos: true })).toEqual(['2026-10-15']);
    expect(dates({ favoritesOnly: true })).toEqual(['2026-10-12']);
    expect(dates({ text: 'rain', moods: ['happy'] })).toEqual([]);
    journal.entries.setAnswerFavorite('2026-10-05', 'joy-02', true);
    expect(dates({ favoritesOnly: true })).toEqual(['2026-10-12', '2026-10-05']);
  });

  it('pages through long histories with a cursor', () => {
    const journal = openJournal();
    for (let i = 0; i < 75; i++) journal.entries.update(addDays('2026-01-01', i), { body: `Day ${i}` });
    const first = journal.search.search({ limit: 30 });
    expect(first.results).toHaveLength(30);
    expect(first.total).toBe(75);
    const second = journal.search.search({ limit: 30, cursor: first.nextCursor });
    const third = journal.search.search({ limit: 30, cursor: second.nextCursor });
    expect(third.results).toHaveLength(15);
    expect(third.nextCursor).toBeNull();
    const all = [...first.results, ...second.results, ...third.results].map((r) => r.date);
    expect(new Set(all).size).toBe(75);
  });

  it('counts entries per month for the filters', async () => {
    const journal = await sampleJournal();
    expect(journal.search.months()).toEqual([
      { month: '2026-10', count: 5 },
      { month: '2026-09', count: 1 },
    ]);
  });
});

describe('statistics', () => {
  it('summarizes streaks, totals and this month', async () => {
    const journal = openJournal();
    for (const date of ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) journal.entries.update(date, { mood: 'calm' });
    journal.entries.update('2026-10-10', { body: 'one two three' });
    journal.entries.update('2026-09-30', { energy: 3 });
    const s = journal.stats.overview('2026-10-24', 'month');
    expect(s.streak).toMatchObject({ current: 4, currentStart: '2026-10-20', longest: 4 });
    expect(s.totalEntries).toBe(6);
    expect(s.totalWords).toBe(3);
    expect(s.daysThisMonth).toBe(5);
    expect(s.firstEntryDate).toBe('2026-09-30');
  });

  it('counts mood-only and photo-only days toward the streak', async () => {
    const journal = openJournal();
    journal.entries.update('2026-10-22', { mood: 'sad' });
    await journal.photos.importSources('2026-10-23', [{ name: 'a.png', data: PNG_1PX }]);
    journal.entries.update('2026-10-24', { energy: 1 });
    expect(journal.stats.overview('2026-10-24', 'all').streak.current).toBe(3);
  });

  it('reports months across a year boundary', () => {
    const journal = openJournal();
    journal.entries.update('2025-12-31', { mood: 'happy', energy: 5 });
    journal.entries.update('2026-01-01', { mood: 'happy', energy: 3 });
    journal.entries.update('2026-01-02', { mood: 'tired' });
    const s = journal.stats.overview('2026-01-15', 'year');
    expect(s.entriesPerMonth).toHaveLength(12);
    expect(s.entriesPerMonth.at(-1)).toEqual({ month: '2026-01', count: 2 });
    expect(s.entriesPerMonth.at(-2)).toEqual({ month: '2025-12', count: 1 });
    expect(s.entriesPerMonth[0].month).toBe('2025-02');
    expect(s.streak.longest).toBe(3);
    expect(s.moodDistribution.counts).toEqual([
      { mood: 'happy', count: 2 },
      { mood: 'tired', count: 1 },
    ]);
    expect(s.moodByMonth.at(-1)).toEqual({ month: '2026-01', total: 2, counts: { happy: 1, tired: 1 } });
    expect(s.energyByMonth.at(-1)).toEqual({ month: '2026-01', average: 3, days: 1 });
    expect(s.energyByMonth.at(-2)).toEqual({ month: '2025-12', average: 5, days: 1 });
  });

  it('limits the mood distribution to the chosen period', () => {
    const journal = openJournal();
    journal.entries.update('2026-06-01', { mood: 'sad' });
    journal.entries.update('2026-10-02', { mood: 'happy' });
    expect(journal.stats.overview('2026-10-24', 'month').moodDistribution.counts).toEqual([{ mood: 'happy', count: 1 }]);
    expect(journal.stats.overview('2026-10-24', 'all').moodDistribution.total).toBe(2);
  });

  it('lays out a whole year of moods, including leap years', () => {
    const journal = openJournal();
    journal.entries.update('2024-02-29', { mood: 'wonderful' });
    journal.entries.update('2024-03-01', { body: 'no mood' });
    const year = journal.stats.yearInMoods(2024);
    expect(year.days).toHaveLength(366);
    expect(year.days.find((d) => d.date === '2024-02-29')).toEqual({ date: '2024-02-29', mood: 'wonderful', hasEntry: true });
    expect(year.days.find((d) => d.date === '2024-03-01')).toEqual({ date: '2024-03-01', mood: null, hasEntry: true });
    expect(journal.stats.yearInMoods(2026).days).toHaveLength(365);
  });
});

describe('search phrases and exclusions', () => {
  it('keeps quoted words together and leaves out days with excluded words', async () => {
    const journal = await sampleJournal();
    journal.entries.update('2026-10-03', { body: 'A croissant in the rain' });
    const dates = (text: string) => journal.search.search({ text }).results.map((r) => r.date);
    expect(dates('croissant')).toEqual(['2026-10-03', '2026-09-02']);
    expect(dates('croissant -rain')).toEqual(['2026-09-02']);
    expect(dates('"new café"')).toEqual(['2026-09-02']);
    expect(dates('"café new"')).toEqual([]);
    expect(dates('-rain')).toEqual(journal.search.search({}).results.map((r) => r.date)); // nothing to look for: everything
  });
});

describe('searching reflections and letters', () => {
  it('finds monthly and yearly reflections, newest first, within the chosen dates', () => {
    const journal = openJournal();
    journal.reflections.save('2026-03', 'learned', 'Walking every morning helps');
    journal.reflections.save('2026-09', 'letter', 'Dear me, keep walking');
    journal.years.save(2025, 'proud', 'I walked the whole coast');
    const hits = (text: string, range = {}) => journal.writing.search(text, range).map((h) => `${h.kind}:${h.ref}`);
    expect(hits('walk')).toEqual(['month:2026-09', 'month:2026-03', 'year:2025']);
    expect(hits('walk', { from: '2026-06-01' })).toEqual(['month:2026-09']);
    expect(hits('walk', { to: '2025-12-31' })).toEqual(['year:2025']);
    expect(journal.writing.search('coast')[0].snippet).toContain(`${HIGHLIGHT_START}coast${HIGHLIGHT_END}`);
    // Changing an answer replaces what is found.
    journal.reflections.save('2026-03', 'learned', 'Swimming helps');
    expect(hits('walking')).toEqual(['month:2026-09']);
    expect(hits('swimming')).toEqual(['month:2026-03']);
  });
});

describe('the year in review', () => {
  it('counts the year, month by month, with each month’s intention', async () => {
    const journal = openJournal();
    journal.entries.update('2026-01-05', { body: 'New year walk', mood: 'happy', energy: 4 });
    journal.entries.update('2026-01-06', { mood: 'happy' });
    journal.entries.update('2026-03-10', { mood: 'calm', energy: 2, favorite: true });
    journal.entries.update('2025-12-31', { mood: 'tired' }); // another year
    journal.reflections.save('2026-01', 'intention', 'Slow mornings');
    journal.tags.setForDay('2026-03-10', 'Walk', true);
    const { imported } = await journal.photos.importSources('2026-03-10', [{ name: 'a.png', data: PNG_1PX }]);
    journal.photos.update(imported[0].id, { favorite: true });
    journal.years.save(2026, 'proud', 'Kept going');

    const recap = journal.years.recap(2026);
    expect(recap).toMatchObject({
      year: 2026,
      daysInYear: 365,
      daysWithEntries: 3,
      moodCounts: [
        { mood: 'happy', count: 2 },
        { mood: 'calm', count: 1 },
      ],
      averageEnergy: 3,
      energyDays: 2,
      photoCount: 1,
      tags: [{ label: 'Walk', count: 1 }],
      reflection: { proud: 'Kept going' },
    });
    expect(recap.months).toHaveLength(12);
    expect(recap.months[0]).toEqual({ month: '2026-01', days: 2, topMood: 'happy', intention: 'Slow mornings' });
    expect(recap.months[2]).toMatchObject({ days: 1, topMood: 'calm', intention: '' });
    expect(recap.moments.map((m) => [m.date, m.kind])).toEqual([['2026-03-10', 'favorite-day']]);
    expect(recap.photos.map((p) => p.id)).toEqual([imported[0].id]);
    expect(journal.writing.search('going')).toMatchObject([{ kind: 'year', ref: '2026' }]);
    expect(() => journal.years.save(2026, 'not-a-question', 'x')).toThrow(/unknown/);
    expect(journal.years.recap(2024).daysInYear).toBe(366);
  });

  it('keeps a mix of moments spread over the year', () => {
    const journal = openJournal();
    for (let month = 1; month <= 12; month++) {
      journal.entries.update(`2026-${String(month).padStart(2, '0')}-15`, { body: `Day ${month}`, favorite: true });
    }
    const moments = journal.years.recap(2026).moments;
    // At most six favorite days, spread from January to December.
    expect(moments.filter((m) => m.kind === 'favorite-day').map((m) => m.date.slice(5, 7))).toEqual(['01', '03', '05', '08', '10', '12']);
  });
});

describe('more gentle insights', () => {
  it('count moods by weekday, energy by mood, words and photos per month, and tags', async () => {
    const journal = openJournal();
    journal.entries.update('2026-10-19', { mood: 'happy', energy: 4, body: 'one two three' }); // a Monday
    journal.entries.update('2026-10-26', { mood: 'happy', energy: 2 }); // a Monday
    journal.entries.update('2026-10-24', { mood: 'calm' }); // a Saturday, no energy
    journal.tags.setForDay('2026-10-24', 'Walk', true);
    journal.tags.setForDay('2026-10-19', 'Walk', true);
    await journal.photos.importSources('2026-10-24', [{ name: 'a.png', data: PNG_1PX }]);
    const s = journal.stats.overview('2026-10-31', 'month');
    expect(s.moodByWeekday).toHaveLength(7);
    expect(s.moodByWeekday[1]).toEqual({ weekday: 1, total: 2, counts: { happy: 2 } });
    expect(s.moodByWeekday[6]).toEqual({ weekday: 6, total: 1, counts: { calm: 1 } });
    expect(s.energyByMood).toEqual([{ mood: 'happy', average: 3, days: 2 }]);
    expect(s.wordsByMonth.at(-1)).toEqual({ month: '2026-10', words: 3 });
    expect(s.photosByMonth.at(-1)).toEqual({ month: '2026-10', count: 1 });
    expect(s.tagCounts).toEqual([{ tag: 'walk', label: 'Walk', count: 2 }]);
  });
});
