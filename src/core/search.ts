/** Turning what the user types into a safe SQLite FTS5 query. */

export const MAX_SEARCH_TERMS = 12;

/**
 * Splits text into words and matches each as a prefix ("grat" finds
 * "grateful"). Only letters and digits survive, so the result can never
 * contain FTS operators or quotes from user input. Returns null when nothing
 * searchable remains.
 */
export function toFtsQuery(text: string): string | null {
  const words = text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const unique = [...new Set(words)].slice(0, MAX_SEARCH_TERMS);
  if (unique.length === 0) return null;
  return unique.map((word) => `"${word}"*`).join(' ');
}
