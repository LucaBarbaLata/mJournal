/** Small text utilities shared by the main process and the interface. */

/** Maximum length of any single text field (about 40 pages of writing). */
export const MAX_TEXT_LENGTH = 200_000;

let segmenter: Intl.Segmenter | null | undefined;

function wordSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
  }
  return segmenter;
}

/** Counts words in any language, falling back to whitespace splitting. */
export function countWords(text: string): number {
  if (!text.trim()) return 0;
  const seg = wordSegmenter();
  if (!seg) return text.trim().split(/\s+/u).length;
  let count = 0;
  for (const part of seg.segment(text)) if (part.isWordLike) count++;
  return count;
}

/** Collapses whitespace and trims to roughly `maxChars`, ending on a word boundary. */
export function makeExcerpt(text: string, maxChars = 220): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  if (flat.length <= maxChars) return flat;
  const cut = flat.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!?-]+$/u, '')}…`;
}

/** Markers used by search snippets to wrap matched words (never present in normal text). */
export const HIGHLIGHT_START = '\u0001';
export const HIGHLIGHT_END = '\u0002';

/** Splits a snippet into plain and highlighted parts for safe rendering. */
export function splitHighlights(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let rest = snippet;
  while (rest.length > 0) {
    const start = rest.indexOf(HIGHLIGHT_START);
    if (start === -1) {
      parts.push({ text: rest, match: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), match: false });
    const end = rest.indexOf(HIGHLIGHT_END, start + 1);
    const stop = end === -1 ? rest.length : end;
    parts.push({ text: rest.slice(start + 1, stop), match: true });
    rest = end === -1 ? '' : rest.slice(end + 1);
  }
  return parts.filter((p) => p.text.length > 0);
}

/** Removes characters that must never be stored: NUL and the highlight markers. */
export function sanitizeText(text: string): string {
  return text.replace(/[\u0000\u0001\u0002]/gu, '');
}
