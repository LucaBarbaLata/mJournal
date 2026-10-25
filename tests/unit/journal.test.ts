import { describe, expect, it } from 'vitest';
import { DEFAULT_MOODS } from '@core/moods';
import { BUILT_IN_PROMPTS } from '@core/prompts';
import { fakeClock, openJournal, reopen, tempDir } from './helpers';

describe('daily entries', () => {
  it('creates a new entry and reads it back', () => {
    const journal = openJournal();
    const entry = journal.entries.update('2026-10-24', { body: 'A slow, lovely evening walk.' });
    expect(entry.date).toBe('2026-10-24');
    expect(entry.body).toBe('A slow, lovely evening walk.');
    expect(entry.wordCount).toBe(5);
    expect(journal.entries.get('2026-10-24')?.body).toBe('A slow, lovely evening walk.');
    expect(journal.entries.get('2026-10-23')).toBeNull();
  });

  it('keeps edits after reopening the journal', () => {
    const clock = fakeClock();
    let journal = openJournal(tempDir(), clock);
    journal.entries.update('2026-10-24', { body: 'First draft' });
    clock.advance(60_000);
    journal.entries.update('2026-10-24', { body: 'First draft, continued later.' });
    journal = reopen(journal);
    const entry = journal.entries.get('2026-10-24')!;
    expect(entry.body).toBe('First draft, continued later.');
    expect(entry.updatedAt > entry.createdAt).toBe(true);
  });

  it('stores entries on different dates independently', () => {
    const journal = openJournal();
    journal.entries.update('2026-10-22', { body: 'Tuesday' });
    journal.entries.update('2026-10-23', { body: 'Wednesday', mood: 'calm' });
    journal.entries.update('2026-11-01', { body: 'November', energy: 4 });
    expect(journal.entries.get('2026-10-22')?.body).toBe('Tuesday');
    expect(journal.entries.get('2026-10-23')?.mood).toBe('calm');
    expect(journal.entries.monthSummaries('2026-10').map((d) => d.date)).toEqual(['2026-10-22', '2026-10-23']);
    expect(journal.entries.monthSummaries('2026-11')).toHaveLength(1);
  });

  it('persists mood and energy, including a mood-only day', () => {
    let journal = openJournal();
    journal.entries.update('2026-10-24', { mood: 'tired', energy: 2 });
    journal.entries.update('2026-10-24', { moodNote: 'Long day at school.' });
    journal = reopen(journal);
    const entry = journal.entries.get('2026-10-24')!;
    expect(entry.mood).toBe('tired');
    expect(entry.energy).toBe(2);
    expect(entry.moodNote).toBe('Long day at school.');
    expect(entry.body).toBe('');
    expect(journal.entries.contentDays()).toEqual(['2026-10-24']);

    journal.entries.update('2026-10-24', { mood: 'calm', energy: null });
    expect(journal.entries.get('2026-10-24')?.mood).toBe('calm');
    expect(journal.entries.get('2026-10-24')?.energy).toBeNull();
  });

  it('rejects unknown moods and out-of-range energy', () => {
    const journal = openJournal();
    expect(() => journal.entries.update('2026-10-24', { mood: 'ecstatic-ish' })).toThrow(/mood/);
    expect(() => journal.entries.update('2026-10-24', { energy: 7 })).toThrow();
    expect(journal.entries.get('2026-10-24')?.energy ?? null).toBeNull();
  });

  it('does not count an entry that was emptied again', () => {
    const journal = openJournal();
    journal.entries.update('2026-10-24', { body: 'hello' });
    journal.entries.update('2026-10-24', { body: '   \n' });
    expect(journal.entries.contentDays()).toEqual([]);
  });

  it('saves prompt answers and preserves them while editing other parts', () => {
    let journal = openJournal();
    journal.entries.saveAnswer('2026-10-24', {
      promptId: 'gratitude-01',
      promptText: 'What am I grateful for right now?',
      answer: 'Warm tea.',
    });
    journal.entries.saveAnswer('2026-10-24', { promptId: 'joy-02', promptText: 'Who or what made me smile?', answer: 'My cat.' });
    journal.entries.update('2026-10-24', { body: 'Some free writing.' });
    journal.entries.saveAnswer('2026-10-24', {
      promptId: 'gratitude-01',
      promptText: 'What am I grateful for right now?',
      answer: 'Warm tea and a good book.',
    });
    journal = reopen(journal);
    const answers = journal.entries.answers('2026-10-24');
    expect(answers.map((a) => [a.promptId, a.answer])).toEqual([
      ['gratitude-01', 'Warm tea and a good book.'],
      ['joy-02', 'My cat.'],
    ]);
    expect(journal.entries.get('2026-10-24')?.body).toBe('Some free writing.');

    journal.entries.setAnswerFavorite('2026-10-24', 'joy-02', true);
    journal.entries.removeAnswer('2026-10-24', 'gratitude-01');
    expect(journal.entries.answers('2026-10-24').map((a) => [a.promptId, a.favorite])).toEqual([['joy-02', true]]);
  });

  it('deletes an entry but keeps its photos recoverable', async () => {
    const journal = openJournal();
    journal.entries.update('2026-10-24', { body: 'To be deleted' });
    journal.entries.saveAnswer('2026-10-24', { promptId: 'joy-01', promptText: 'Q', answer: 'A' });
    const { PNG_1PX } = await import('./helpers');
    const result = await journal.photos.importSources('2026-10-24', [{ name: 'a.png', data: PNG_1PX }]);
    journal.entries.remove('2026-10-24');
    expect(journal.entries.get('2026-10-24')).toBeNull();
    expect(journal.entries.answers('2026-10-24')).toEqual([]);
    const removed = journal.photos.listRemoved();
    expect(removed.map((p) => p.id)).toEqual([result.imported[0].id]);
    expect(removed[0].missing).toBe(false);
  });

  it('finds entries from the same day in earlier years', () => {
    const journal = openJournal();
    journal.entries.update('2024-10-24', { body: 'Two years ago' });
    journal.entries.update('2025-10-24', { body: 'One year ago' });
    journal.entries.update('2025-10-25', { body: 'Not the same day' });
    expect(journal.entries.onThisDay('2026-10-24').map((d) => d.date)).toEqual(['2025-10-24', '2024-10-24']);
  });
});

describe('featured daily question', () => {
  it('stays the same for a date across restarts and library changes', () => {
    let journal = openJournal();
    const first = journal.prompts.featured('2026-10-24')!;
    expect(BUILT_IN_PROMPTS.some((p) => p.id === first.promptId)).toBe(true);
    journal.prompts.createCustom('What colour was my day?');
    journal = reopen(journal);
    expect(journal.prompts.featured('2026-10-24')!.promptId).toBe(first.promptId);
  });

  it('changes on request and remembers the new question', () => {
    let journal = openJournal();
    const first = journal.prompts.featured('2026-10-24')!;
    const second = journal.prompts.shuffle('2026-10-24')!;
    expect(second.promptId).not.toBe(first.promptId);
    expect(second.shuffles).toBe(1);
    journal = reopen(journal);
    expect(journal.prompts.featured('2026-10-24')!.promptId).toBe(second.promptId);
  });

  it('does not repeat recent questions on nearby days', () => {
    const journal = openJournal();
    const ids = new Set<string>();
    for (let day = 1; day <= 31; day++) {
      ids.add(journal.prompts.featured(`2026-10-${String(day).padStart(2, '0')}`)!.promptId);
    }
    expect(ids.size).toBe(31);
  });

  it('can be skipped for a day without losing it', () => {
    const journal = openJournal();
    const prompt = journal.prompts.featured('2026-10-24')!;
    expect(journal.prompts.setSkipped('2026-10-24', true)!.skipped).toBe(true);
    const back = journal.prompts.setSkipped('2026-10-24', false)!;
    expect(back.skipped).toBe(false);
    expect(back.promptId).toBe(prompt.promptId);
  });

  it('supports favorites, hiding and custom prompts', () => {
    const journal = openJournal();
    journal.prompts.setFavorite('joy-03', true);
    journal.prompts.setHidden('joy-04', true);
    const custom = journal.prompts.createCustom('What did I cook today?');
    expect(custom.id).toMatch(/^custom-\d+$/);
    const library = journal.prompts.library();
    expect(library.find((p) => p.id === 'joy-03')?.favorite).toBe(true);
    expect(library.find((p) => p.id === custom.id)?.text).toBe('What did I cook today?');
    expect(journal.prompts.rotationPool()).not.toContain('joy-04');
    expect(journal.prompts.rotationPool()).toContain(custom.id);

    journal.prompts.updateCustom(custom.id, { inRotation: false });
    expect(journal.prompts.rotationPool()).not.toContain(custom.id);
    journal.prompts.archiveCustom(custom.id);
    expect(journal.prompts.library().some((p) => p.id === custom.id)).toBe(false);
    expect(journal.prompts.resolve(custom.id)?.text).toBe('What did I cook today?');
    expect(() => journal.prompts.setFavorite('no-such-prompt', true)).toThrow();
  });
});

describe('moods', () => {
  it('starts with the default vocabulary', () => {
    const journal = openJournal();
    expect(journal.moods.list().map((m) => m.label)).toEqual(DEFAULT_MOODS.map((m) => m.label));
  });

  it('can be customized without breaking old entries', () => {
    const journal = openJournal();
    journal.entries.update('2026-10-20', { mood: 'okay' });
    const custom = journal.moods.create({ label: 'Cozy', icon: 'heart', color: 'peach' });
    journal.moods.update('okay', { label: 'Meh', hidden: true });
    expect(journal.entries.get('2026-10-20')?.mood).toBe('okay');
    expect(journal.moods.list().find((m) => m.key === 'okay')).toMatchObject({ label: 'Meh', hidden: true });
    journal.entries.update('2026-10-24', { mood: custom.key });
    expect(() => journal.moods.create({ label: 'cozy', icon: 'star', color: 'gold' })).toThrow(/already/);

    const keys = journal.moods.list().map((m) => m.key).reverse();
    expect(journal.moods.reorder(keys).map((m) => m.key)).toEqual(keys);
    expect(() => journal.moods.reorder(keys.slice(1))).toThrow();

    const reset = journal.moods.resetDefaults();
    expect(reset.slice(0, DEFAULT_MOODS.length).map((m) => m.label)).toEqual(DEFAULT_MOODS.map((m) => m.label));
    expect(reset.at(-1)?.key).toBe(custom.key);
  });

  it('keeps at least one mood visible', () => {
    const journal = openJournal();
    const moods = journal.moods.list();
    for (const mood of moods.slice(1)) journal.moods.update(mood.key, { hidden: true });
    expect(() => journal.moods.update(moods[0].key, { hidden: true })).toThrow(/at least one/);
  });
});

describe('monthly reflections', () => {
  it('persist across restarts and stay editable', () => {
    let journal = openJournal();
    journal.reflections.save('2026-10', 'meaningful', 'Finishing my art project.');
    journal.reflections.save('2026-10', 'letter', 'Dear me, you did well.');
    journal = reopen(journal);
    journal.reflections.save('2026-10', 'meaningful', 'Finishing my art project with Sam.');
    const recap = journal.reflections.recap('2026-10');
    expect(recap.reflection).toEqual({ meaningful: 'Finishing my art project with Sam.', letter: 'Dear me, you did well.' });
    expect(recap.reflectionUpdatedAt).not.toBeNull();
    expect(journal.reflections.recap('2026-09').reflection).toEqual({});
    expect(() => journal.reflections.save('2026-10', 'not-a-question', 'x')).toThrow();
  });

  it('separates recorded statistics from moments chosen by clear rules', () => {
    const journal = openJournal();
    journal.entries.update('2026-10-01', { mood: 'happy', energy: 4, body: 'word '.repeat(60) });
    journal.entries.update('2026-10-02', { mood: 'happy', energy: 2, favorite: true, body: 'A favourite day' });
    journal.entries.update('2026-10-03', { mood: 'calm' });
    journal.entries.update('2026-11-01', { mood: 'sad', energy: 1 });
    const recap = journal.reflections.recap('2026-10');
    expect(recap.daysWithEntries).toBe(3);
    expect(recap.daysInMonth).toBe(31);
    expect(recap.moodCounts).toEqual([
      { mood: 'happy', count: 2 },
      { mood: 'calm', count: 1 },
    ]);
    expect(recap.averageEnergy).toBe(3);
    expect(recap.energyDays).toBe(2);
    expect(recap.moments.map((m) => [m.date, m.kind])).toEqual([
      ['2026-10-01', 'longest-entry'],
      ['2026-10-02', 'favorite-day'],
    ]);
    expect(recap.moments[0].reason).toMatch(/longest entry/);
  });
});

describe('settings', () => {
  it('uses regional defaults, validates updates and persists them', () => {
    let journal = openJournal();
    expect(journal.settings.get()).toMatchObject({ dateFormat: 'day-first', weekStartsOn: 1, theme: 'system' });
    journal.settings.update({ theme: 'dark', weekStartsOn: 0, displayName: 'Mia' });
    expect(() => journal.settings.update({ theme: 'neon' })).toThrow();
    expect(() => journal.settings.update({ unknownSetting: true })).toThrow();
    journal = reopen(journal);
    expect(journal.settings.get()).toMatchObject({ theme: 'dark', weekStartsOn: 0, displayName: 'Mia' });
  });

  it('remembers the welcome guide and dismissed tips, with strict validation', () => {
    let journal = openJournal();
    expect(journal.settings.get()).toMatchObject({ onboardingDone: false, dismissedTips: [] });
    journal.settings.update({ onboardingDone: true, dismissedTips: ['calendar', 'journal'] });
    expect(() => journal.settings.update({ dismissedTips: ['../etc'] })).toThrow();
    expect(() => journal.settings.update({ dismissedTips: 'calendar' })).toThrow();
    expect(() => journal.settings.update({ onboardingDone: 'yes' })).toThrow();
    journal = reopen(journal);
    expect(journal.settings.get()).toMatchObject({ onboardingDone: true, dismissedTips: ['calendar', 'journal'] });
  });

  it('checks for new versions by default and remembers a put-away update note', () => {
    let journal = openJournal();
    expect(journal.settings.get()).toMatchObject({ checkForUpdates: true, dismissedUpdate: '' });
    journal.settings.update({ checkForUpdates: false, dismissedUpdate: '1.2.3' });
    expect(() => journal.settings.update({ dismissedUpdate: 'v1.2.3' })).toThrow();
    expect(() => journal.settings.update({ dismissedUpdate: '1.2' })).toThrow();
    expect(() => journal.settings.update({ checkForUpdates: 'no' })).toThrow();
    journal = reopen(journal);
    expect(journal.settings.get()).toMatchObject({ checkForUpdates: false, dismissedUpdate: '1.2.3' });
  });

  it('falls back to defaults when a stored value is malformed', () => {
    const journal = openJournal();
    journal.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('theme', '{oops', 'x')");
    journal.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('weekStartsOn', '3', 'x')");
    expect(journal.settings.get()).toMatchObject({ theme: 'system', weekStartsOn: 1 });
  });
});
