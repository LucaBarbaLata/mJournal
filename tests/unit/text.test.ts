import { describe, expect, it } from 'vitest';
import { toFtsQuery } from '@core/search';
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

  it('drops FTS syntax and punctuation from user input', () => {
    expect(toFtsQuery('"hello" OR (NEAR world) -x *')).toBe('"hello"* "or"* "near"* "world"* "x"*');
    expect(toFtsQuery('***')).toBeNull();
    expect(toFtsQuery('')).toBeNull();
  });

  it('keeps accented and non-Latin words', () => {
    expect(toFtsQuery('café 日記')).toBe('"café"* "日記"*');
  });
});
