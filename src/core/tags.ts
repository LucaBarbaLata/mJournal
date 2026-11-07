/**
 * Tags describe a day: tap one of the quick chips on the day page, or write
 * #something anywhere in the day's writing, answers, mood note or captions.
 * A tag's key is its label in lower case (NFKC), so "#Walk" and "walk" are one tag.
 */

export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_DAY = 50;
export const MAX_TAGS = 500;

/** The quick chips a new journal starts with (they can be renamed, reordered or removed). */
export const DEFAULT_TAGS = ['Family', 'Friends', 'Work', 'Walk', 'Exercise', 'Reading', 'Nature', 'Rest'] as const;

/**
 * "#walk", "#Beach-day", "#2026goals" — a "#" that doesn't follow a letter, digit, "_", "&" or another "#",
 * so "C#", "&#39;" and "##" aren't tags. A tag needs at least one letter: "#2026" or "#1" isn't one.
 */
const HASHTAG_RE = /(?<![\p{L}\p{N}_&#])#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
const LABEL_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u;

export function tagKey(label: string): string {
  return label.normalize('NFKC').trim().toLowerCase();
}

/** Tidies a label typed into a tag field: no leading "#", single spaces, at most MAX_TAG_LENGTH characters. */
export function cleanTagLabel(label: string): string {
  return label
    .normalize('NFKC')
    .replace(/^[\s#]+/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_TAG_LENGTH)
    .trim();
}

/** Letters, numbers, spaces, "-" and "_", with at least one letter. */
export function isValidTagLabel(label: string): boolean {
  return label.length > 0 && label.length <= MAX_TAG_LENGTH && LABEL_RE.test(label) && /\p{L}/u.test(label);
}

/** The #tags in a piece of text, each once (the first spelling wins). */
export function extractHashtags(text: string): { key: string; label: string }[] {
  if (!text.includes('#')) return [];
  const found = new Map<string, string>();
  for (const match of text.matchAll(HASHTAG_RE)) {
    const label = match[1].replace(/[-_]+$/u, '').slice(0, MAX_TAG_LENGTH);
    if (!/\p{L}/u.test(label)) continue;
    const key = tagKey(label);
    if (!found.has(key)) found.set(key, label);
  }
  return [...found].map(([key, label]) => ({ key, label }));
}
