import { describe, expect, it } from 'vitest';
import { cleanTagLabel, extractHashtags, isValidTagLabel, tagKey } from '../../src/core/tags';
import { buildCsv, buildJsonExport } from '../../src/main/services/exporter';
import { openJournal } from './helpers';

describe('#tags in text', () => {
  it('finds words after a #, once each, and leaves look-alikes alone', () => {
    const tags = (text: string) => extractHashtags(text).map((t) => t.label);
    expect(tags('A long #walk with #Family, then #walk again.')).toEqual(['walk', 'Family']);
    expect(tags('#Beach-day and #2026goals and #café')).toEqual(['Beach-day', '2026goals', 'café']);
    // Not tags: numbers alone, C#, HTML entities, headings, doubled hashes, a trailing dash.
    expect(tags('#2026 #1 C# &#39; # heading ##twice')).toEqual([]);
    expect(tags('#yoga- #ends_')).toEqual(['yoga', 'ends']);
    expect(extractHashtags('#Walk #WALK')).toEqual([{ key: 'walk', label: 'Walk' }]);
  });

  it('tidies and checks labels typed into a tag field', () => {
    expect(cleanTagLabel('  #Day   off ')).toBe('Day off');
    expect(isValidTagLabel('Day off')).toBe(true);
    expect(isValidTagLabel('2026')).toBe(false);
    expect(isValidTagLabel('a/b')).toBe(false);
    expect(tagKey('Ｗalk')).toBe('walk'); // full-width letters fold to the same tag
  });
});

describe('tags on days', () => {
  it('count a day on their own, like a mood', () => {
    const j = openJournal();
    j.tags.setForDay('2026-10-24', 'Walk', true);
    expect(j.entries.contentDays()).toEqual(['2026-10-24']);
    expect(j.entries.tags('2026-10-24')).toEqual([{ name: 'walk', label: 'Walk', picked: true, written: false }]);
    expect(j.stats.streak('2026-10-24').current).toBe(1);
    expect(j.entries.monthSummaries('2026-10')[0].tags).toEqual(['Walk']);
    j.tags.setForDay('2026-10-24', 'walk', false);
    expect(j.entries.contentDays()).toEqual([]);
  });

  it('follow the #words in a day’s writing, answers, mood note and captions', () => {
    const j = openJournal();
    j.entries.update('2026-10-24', { body: 'Coffee with #Ana', moodNote: 'tired after #work' });
    j.entries.saveAnswer('2026-10-24', { promptId: 'joy-01', promptText: 'Q', answer: 'the #garden' });
    expect(j.entries.tags('2026-10-24').map((t) => [t.name, t.written])).toEqual([
      ['work', true], // a quick chip comes first
      ['ana', true],
      ['garden', true],
    ]);
    // A half-typed #tag doesn't linger: it disappears once the text changes.
    j.entries.update('2026-10-24', { body: 'Coffee with #An' });
    j.entries.update('2026-10-24', { body: 'Coffee with friends' });
    expect(j.entries.tags('2026-10-24').map((t) => t.name)).toEqual(['work', 'garden']);
    expect(j.tags.list().some((t) => t.name === 'an' || t.name === 'ana')).toBe(false);
    // A picked tag stays when it's no longer written.
    j.tags.setForDay('2026-10-24', 'Garden', true);
    j.entries.saveAnswer('2026-10-24', { promptId: 'joy-01', promptText: 'Q', answer: 'the roses' });
    expect(j.entries.tags('2026-10-24').find((t) => t.name === 'garden')).toMatchObject({ picked: true, written: false });
  });

  it('can be found by search and by the tag filter', () => {
    const j = openJournal();
    j.tags.setForDay('2026-10-20', 'Walk', true);
    j.entries.update('2026-10-21', { body: 'Rainy #walk to the shop' });
    j.entries.update('2026-10-22', { body: 'Stayed in', mood: 'calm' });
    const dates = (query: Parameters<typeof j.search.search>[0]) => j.search.search(query).results.map((r) => r.date);
    expect(dates({ tags: ['walk'] })).toEqual(['2026-10-21', '2026-10-20']);
    // A day tagged by tapping "Walk" is found by the word too.
    expect(dates({ text: 'walk' })).toEqual(['2026-10-21', '2026-10-20']);
    expect(j.search.search({ tags: ['walk'] }).results[0].tags).toEqual(['Walk']);
  });

  it('can be renamed, made quick chips, reordered and removed', () => {
    const j = openJournal();
    const yoga = j.tags.create('Yoga');
    expect(yoga).toMatchObject({ name: 'yoga', quick: true, days: 0 });
    j.tags.setForDay('2026-10-24', 'Yoga', true);
    expect(j.tags.update('yoga', { label: 'Stretching' })).toMatchObject({ name: 'stretching', label: 'Stretching', days: 1 });
    expect(j.entries.tags('2026-10-24').map((t) => t.label)).toEqual(['Stretching']);
    expect(j.search.search({ text: 'stretching' }).results).toHaveLength(1);
    // A tag written in the text can only be renamed there.
    j.entries.update('2026-10-23', { body: 'Out with #Mia' });
    expect(() => j.tags.update('mia', { label: 'Mia Rose' })).toThrow(/Change it there/);
    expect(j.tags.update('mia', { label: 'MIA' }).label).toBe('MIA'); // same tag, other spelling: fine
    expect(() => j.tags.update('stretching', { label: 'Walk' })).toThrow(/already a tag/);
    // Order of the quick chips.
    const quick = j.tags.list().filter((t) => t.quick).map((t) => t.name);
    j.tags.reorder([...quick].reverse());
    expect(j.tags.list().filter((t) => t.quick).map((t) => t.name)).toEqual([...quick].reverse());
    // Removing un-picks it everywhere; a #written tag stays where it is written.
    j.tags.remove('stretching');
    expect(j.entries.tags('2026-10-24')).toEqual([]);
    expect(j.tags.list().some((t) => t.name === 'stretching')).toBe(false);
    j.tags.setForDay('2026-10-23', 'MIA', true);
    j.tags.remove('mia');
    expect(j.entries.tags('2026-10-23')).toMatchObject([{ name: 'mia', picked: false, written: true }]);
  });

  it('are part of exports', () => {
    const j = openJournal();
    j.tags.setForDay('2026-10-24', 'Family', true);
    j.entries.update('2026-10-24', { body: 'Dinner #cooking' });
    const json = buildJsonExport(j, '1.2.0');
    expect(json.entries[0].tags).toEqual(['cooking', 'Family']);
    expect(json.tags.some((t) => t.label === 'Family' && t.days === 1)).toBe(true);
    const [header, row] = buildCsv(j).split('\r\n');
    expect(header.endsWith(',tags,trackers')).toBe(true);
    expect(row.endsWith('"cooking, Family",""')).toBe(true);
  });
});
