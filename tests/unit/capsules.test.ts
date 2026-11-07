import { describe, expect, it } from 'vitest';
import { PNG_1PX, fakeClock, openJournal, tempDir } from './helpers';

const DAY = 24 * 3600 * 1000;

describe('letters to a future day', () => {
  it('can be changed on the day they are written, then stay sealed until their day', () => {
    const clock = fakeClock('2026-10-24T09:00:00');
    const j = openJournal(tempDir(), clock);
    expect(() => j.capsules.create('2026-10-24')).toThrow(/hasn’t come yet/);
    expect(() => j.capsules.create('2099-01-01')).toThrow(/50 years/);
    const letter = j.capsules.create('2026-10-27');
    expect(letter).toMatchObject({ openOn: '2026-10-27', writtenOn: '2026-10-24', editable: true, sealed: false, body: '' });
    expect(j.capsules.save(letter.id, 'Dear me, did the move go well?').body).toBe('Dear me, did the move go well?');
    expect(j.capsules.datesInMonth('2026-10')).toEqual(['2026-10-27']);

    clock.advance(DAY); // the next day: sealed, its text isn't given out any more
    expect(j.capsules.forDay('2026-10-27')).toMatchObject([{ sealed: true, editable: false, body: null }]);
    expect(() => j.capsules.save(letter.id, 'changed')).toThrow(/sealed/);
    expect(() => j.capsules.markOpened(letter.id)).toThrow(/opens on its day/);
    // Not searchable while sealed.
    expect(j.writing.search('move')).toEqual([]);

    clock.advance(2 * DAY); // its day
    const [open] = j.capsules.forDay('2026-10-27');
    expect(open).toMatchObject({ sealed: false, editable: false, body: 'Dear me, did the move go well?', openedAt: null });
    expect(j.capsules.markOpened(letter.id).openedAt).not.toBeNull();
    expect(j.writing.search('move')).toMatchObject([{ kind: 'capsule', ref: String(letter.id) }]);
  });

  it('can be deleted unread, and empty ones started on an earlier day are tidied away', () => {
    const clock = fakeClock('2026-10-24T09:00:00');
    const j = openJournal(tempDir(), clock);
    const kept = j.capsules.create('2027-01-01');
    j.capsules.save(kept.id, 'Happy new year');
    j.capsules.create('2027-02-02'); // started, never written
    clock.advance(DAY);
    expect(j.capsules.list().map((l) => l.openOn)).toEqual(['2027-01-01']);
    j.capsules.remove(kept.id);
    expect(j.capsules.list()).toEqual([]);
  });

  it('become searchable when mJournal starts on or after their day', () => {
    const clock = fakeClock('2026-10-24T09:00:00');
    const dir = tempDir();
    let j = openJournal(dir, clock);
    const letter = j.capsules.create('2026-10-26');
    j.capsules.save(letter.id, 'Remember the lighthouse');
    j.close();
    clock.advance(3 * DAY);
    j = openJournal(dir, clock);
    expect(j.writing.search('lighthouse')).toMatchObject([{ kind: 'capsule' }]);
  });
});

describe('recently removed days', () => {
  async function dayWithEverything(j: ReturnType<typeof openJournal>) {
    j.entries.update('2026-10-22', { body: 'Picnic by the lake', mood: 'happy', energy: 4, favorite: true });
    j.entries.saveAnswer('2026-10-22', { promptId: 'joy-01', promptText: 'What made me smile?', answer: 'Ducks' });
    j.entries.setAnswerFavorite('2026-10-22', 'joy-01', true);
    j.tags.setForDay('2026-10-22', 'Nature', true);
    const { imported } = await j.photos.importSources('2026-10-22', [{ name: 'a.png', data: PNG_1PX }]);
    return imported[0].id;
  }

  it('keep a deleted day so it can be restored exactly', async () => {
    const j = openJournal();
    const photoId = await dayWithEverything(j);
    const id = j.removedDays.remove('2026-10-22')!;
    expect(j.entries.get('2026-10-22')).toBeNull();
    expect(j.entries.contentDays()).toEqual([]);
    expect(j.photos.listRemoved().map((p) => p.id)).toEqual([photoId]);
    expect(j.removedDays.list()).toMatchObject([{ id, date: '2026-10-22', excerpt: 'Picnic by the lake', mood: 'happy', photoCount: 1 }]);
    expect(j.search.search({ text: 'picnic' }).results).toEqual([]);

    expect(j.removedDays.restore(id)).toBe('2026-10-22');
    expect(j.entries.get('2026-10-22')).toMatchObject({ body: 'Picnic by the lake', mood: 'happy', energy: 4, favorite: true });
    expect(j.entries.answers('2026-10-22')).toMatchObject([{ promptId: 'joy-01', answer: 'Ducks', favorite: true }]);
    expect(j.entries.tags('2026-10-22').map((t) => t.label)).toEqual(['Nature']);
    expect(j.photos.forDay('2026-10-22').map((p) => p.id)).toEqual([photoId]);
    expect(j.removedDays.list()).toEqual([]);
    expect(j.search.search({ text: 'picnic' }).results).toHaveLength(1);
  });

  it('never overwrite what was written on that day since', async () => {
    const j = openJournal();
    await dayWithEverything(j);
    const id = j.removedDays.remove('2026-10-22')!;
    j.entries.update('2026-10-22', { body: 'Wrote again later', mood: 'tired' });
    j.entries.saveAnswer('2026-10-22', { promptId: 'joy-01', promptText: 'What made me smile?', answer: 'A song' });
    j.removedDays.restore(id);
    expect(j.entries.get('2026-10-22')).toMatchObject({
      body: 'Wrote again later\n\nPicnic by the lake',
      mood: 'tired',
      energy: 4,
    });
    expect(j.entries.answers('2026-10-22')[0].answer).toBe('A song\n\nDucks');
  });

  it('are not kept when the day was empty, and can be deleted for good', async () => {
    const j = openJournal();
    expect(j.removedDays.remove('2026-10-01')).toBeNull();
    await dayWithEverything(j);
    const id = j.removedDays.remove('2026-10-22')!;
    j.removedDays.deleteForever(id);
    expect(j.removedDays.list()).toEqual([]);
    expect(() => j.removedDays.restore(id)).toThrow(/no longer in Recently removed/);
    // The photo is still in Recently removed photos.
    expect(j.photos.listRemoved()).toHaveLength(1);
  });
});

describe('prompts asked every day', () => {
  it('are at most three, on the weekdays chosen', () => {
    const j = openJournal();
    expect(j.prompts.setPinned('joy-01', 127)).toMatchObject([{ promptId: 'joy-01', weekdays: 127 }]);
    j.prompts.setPinned('joy-02', 0b0111110); // Monday to Friday
    j.prompts.setPinned('joy-03', 1);
    expect(() => j.prompts.setPinned('joy-04', 127)).toThrow(/Up to 3/);
    expect(() => j.prompts.setPinned('joy-01', 0)).toThrow(/at least one day/);
    expect(() => j.prompts.setPinned('nope-99', 127)).toThrow(/could not be found/);
    j.prompts.setPinned('joy-02', 64); // changing the days doesn't count as another one
    expect(j.prompts.pinned().map((p) => [p.promptId, p.weekdays])).toEqual([
      ['joy-01', 127],
      ['joy-02', 64],
      ['joy-03', 1],
    ]);
    j.prompts.setPinned('joy-03', null);
    expect(j.prompts.pinned()).toHaveLength(2);
  });

  it('stop being asked when their custom prompt is removed', () => {
    const j = openJournal();
    const custom = j.prompts.createCustom('What did I cook?');
    j.prompts.setPinned(custom.id, 127);
    j.prompts.archiveCustom(custom.id);
    expect(j.prompts.pinned()).toEqual([]);
  });
});

describe('the monthly intention', () => {
  it('is kept with the month, searchable, and not counted as one of the questions', () => {
    const j = openJournal();
    expect(j.reflections.intention('2026-10')).toBe('');
    j.reflections.save('2026-10', 'intention', 'Slow mornings');
    expect(j.reflections.intention('2026-10')).toBe('Slow mornings');
    expect(j.reflections.recap('2026-10').reflection.intention).toBe('Slow mornings');
    expect(j.writing.search('mornings')).toMatchObject([{ kind: 'month', ref: '2026-10' }]);
  });
});
