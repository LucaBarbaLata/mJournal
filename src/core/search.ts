/**
 * What the person types into search, turned into a safe SQLite FTS5 query and
 * into highlight ranges for the text on screen.
 *
 * - Words match as prefixes: "grat" finds "grateful".
 * - "Quoted words" must appear together, in that order (the last one still as a prefix).
 * - A leading "-" leaves out days with that word or phrase: walk -rain.
 *
 * Only letters and digits survive from what was typed, and every term is
 * quoted, so the query can never contain FTS operators from user input.
 */

export const MAX_SEARCH_TERMS = 12;

/** One word, or several that must appear together (a phrase). */
export interface SearchTerm {
  words: string[];
}

export interface ParsedSearch {
  terms: SearchTerm[];
  exclude: SearchTerm[];
}

const TOKEN_RE = /(-?)"([^"]*)"?|(-?)([^\s"]+)/gu;
const WORD_RE = /[\p{L}\p{N}]+/gu;

export function parseSearch(text: string): ParsedSearch {
  const terms: SearchTerm[] = [];
  const exclude: SearchTerm[] = [];
  const seen = new Set<string>();
  let budget = MAX_SEARCH_TERMS;
  for (const match of text.normalize('NFKC').toLowerCase().matchAll(TOKEN_RE)) {
    const negative = (match[1] ?? match[3]) === '-';
    const words = (match[2] ?? match[4] ?? '').match(WORD_RE)?.slice(0, budget) ?? [];
    if (words.length === 0) continue;
    const key = `${negative ? '-' : ''}${words.join(' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (negative ? exclude : terms).push({ words });
    budget -= words.length;
    if (budget <= 0) break;
  }
  return { terms, exclude };
}

const phrase = (term: SearchTerm) => `"${term.words.join(' ')}"*`;

/** The FTS5 query, or null when nothing searchable remains (exclusions alone find nothing). */
export function toFtsQuery(text: string): string | null {
  const { terms, exclude } = parseSearch(text);
  if (terms.length === 0) return null;
  const positive = terms.map(phrase).join(' ');
  return exclude.length === 0 ? positive : `(${positive}) NOT (${exclude.map(phrase).join(' OR ')})`;
}

/** Lower case without accents, like the search index (unicode61 with remove_diacritics). */
function fold(word: string): string {
  return word.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Where the search's words and phrases appear in `text`, as [start, end) character ranges, in order. */
export function findMatches(text: string, search: ParsedSearch): [number, number][] {
  if (search.terms.length === 0 || !text) return [];
  const words = [...text.matchAll(WORD_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length, folded: fold(m[0]) }));
  const ranges: [number, number][] = [];
  for (const term of search.terms) {
    const parts = term.words.map(fold);
    for (let i = 0; i + parts.length <= words.length; i++) {
      let matches = true;
      for (let k = 0; k < parts.length && matches; k++) {
        const word = words[i + k].folded;
        matches = k === parts.length - 1 ? word.startsWith(parts[k]) : word === parts[k];
      }
      if (matches) ranges.push([words[i].start, words[i + parts.length - 1].end]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}
