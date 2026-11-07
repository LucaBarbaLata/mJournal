import { describe, expect, it } from 'vitest';
import { findMatches, parseSearch, toFtsQuery } from '@core/search';
import { HIGHLIGHT_END, HIGHLIGHT_START, countWords, makeExcerpt, sanitizeText, splitHighlights } from '@core/text';

describe('text helpers', () => {
  it('counts words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n ')).toBe(0);
    expect(countWords('A quiet, lovely evening.')).toBe(4);
    expect(countWords("It's a café-day!")).toBeGreaterThanOrEqual(3);
  });

  it('makes excerpts on word boundaries', () => {
    expect(makeExcerpt('  short\n\ntext ')).toBe('short text');
    const long = 'word '.repeat(100);
    const excerpt = makeExcerpt(long, 50);
    expect(excerpt.length).toBeLessThanOrEqual(51);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).not.toContain('  ');
  });

  it('splits highlighted snippets safely', () => {
    const snippet = `a ${HIGHLIGHT_START}cozy${HIGHLIGHT_END} <b>day</b>`;
    expect(splitHighlights(snippet)).toEqual([
      { text: 'a ', match: false },
      { text: 'cozy', match: true },
      { text: ' <b>day</b>', match: false },
    ]);
    expect(splitHighlights(`${HIGHLIGHT_START}unclosed`)).toEqual([{ text: 'unclosed', match: true }]);
  });

  it('strips control characters that must not be stored', () => {
    expect(sanitizeText(`a\u0000b${HIGHLIGHT_START}c`)).toBe('abc');
  });
});

describe('search query building', () => {
  it('turns words into prefix terms', () => {
    expect(toFtsQuery('Grateful  sun')).toBe('"grateful"* "sun"*');
  });

  it('never passes FTS syntax or punctuation through', () => {
    expect(toFtsQuery('hello OR (NEAR world) *')).toBe('"hello"* "or"* "near"* "world"*');
    expect(toFtsQuery('***')).toBeNull();
    expect(toFtsQuery('')).toBeNull();
    expect(toFtsQuery('"a" AND "b')).toBe('"a"* "and"* "b"*');
  });

  it('keeps quoted words together and leaves out words after a minus', () => {
    expect(toFtsQuery('"long walk" sea')).toBe('"long walk"* "sea"*');
    expect(toFtsQuery('walk -rain -"cold wind"')).toBe('("walk"*) NOT ("rain"* OR "cold wind"*)');
    // Only exclusions: nothing to look for.
    expect(toFtsQuery('-rain')).toBeNull();
    expect(toFtsQuery('walk - ')).toBe('"walk"*');
    // An unfinished quote still counts as a phrase.
    expect(toFtsQuery('"by the s')).toBe('"by the s"*');
    expect(parseSearch('Walk walk WALK')).toEqual({ terms: [{ words: ['walk'] }], exclude: [] });
  });

  it('finds the matching words in text for highlighting', () => {
    const ranges = (text: string, query: string) => findMatches(text, parseSearch(query)).map(([a, b]) => text.slice(a, b));
    expect(ranges('A long Walk by the sea, walking home', 'walk')).toEqual(['Walk', 'walking']);
    expect(ranges('A long walk by the sea', '"walk by the s"')).toEqual(['walk by the sea']);
    expect(ranges('Café au lait at the CAFE', 'cafe')).toEqual(['Café', 'CAFE']);
    expect(ranges('nothing here', 'walk')).toEqual([]);
    expect(ranges('rainy rain', '-rain')).toEqual([]); // exclusions are never highlighted
    expect(findMatches('a walk walk', parseSearch('walk "walk walk"'))).toEqual([[2, 11]]);
  });

  it('keeps accented and non-Latin words', () => {
    expect(toFtsQuery('café 日記')).toBe('"café"* "日記"*');
  });
});
