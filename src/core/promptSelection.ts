/**
 * Deterministic choice of the featured daily question.
 *
 * The same date, pool and history always produce the same prompt. The choice
 * is also saved the first time a day is shown, so later changes to the
 * library (an app update, a new custom prompt) never change a day's question.
 */
import type { DateKey } from './dates';

/** How many days a featured question is kept out of rotation. */
export const RECENT_WINDOW_DAYS = 90;

/** 32-bit FNV-1a with a murmur-style finaliser for a good spread on short inputs. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface SelectionInput {
  date: DateKey;
  /** All prompt ids currently eligible for the daily rotation. */
  pool: readonly string[];
  /** Prompt ids featured recently (they are skipped while alternatives exist). */
  recentlyShown?: ReadonlySet<string>;
  /** Prompt ids that must not be chosen (for example the current one when shuffling). */
  exclude?: ReadonlySet<string>;
  /** Changes the choice for "another question"; 0 for the original pick. */
  salt?: number;
}

export function selectFeaturedPrompt({
  date,
  pool,
  recentlyShown = new Set(),
  exclude = new Set(),
  salt = 0,
}: SelectionInput): string | null {
  // Sorting makes the result independent of the order the pool was built in.
  const eligible = [...new Set(pool)].filter((id) => !exclude.has(id)).sort();
  if (eligible.length === 0) return null;
  const fresh = eligible.filter((id) => !recentlyShown.has(id));
  const candidates = fresh.length > 0 ? fresh : eligible;
  return candidates[hashString(`${date}#${salt}`) % candidates.length];
}
