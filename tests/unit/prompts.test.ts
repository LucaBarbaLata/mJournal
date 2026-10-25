import { describe, expect, it } from 'vitest';
import { addDays } from '@core/dates';
import { BUILT_IN_PROMPTS, PROMPT_CATEGORIES, findBuiltInPrompt, parseCustomPromptId } from '@core/prompts';
import { hashString, selectFeaturedPrompt } from '@core/promptSelection';

const pool = BUILT_IN_PROMPTS.map((p) => p.id);

describe('prompt library', () => {
  it('is substantial, varied and has unique ids and questions', () => {
    expect(BUILT_IN_PROMPTS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(pool).size).toBe(pool.length);
    expect(new Set(BUILT_IN_PROMPTS.map((p) => p.text.toLowerCase())).size).toBe(pool.length);
    for (const { key } of PROMPT_CATEGORIES) {
      expect(BUILT_IN_PROMPTS.filter((p) => p.category === key).length).toBeGreaterThanOrEqual(10);
    }
  });

  it('keeps ids stable', () => {
    expect(findBuiltInPrompt('gratitude-01')?.text).toBe('What am I grateful for right now?');
    expect(findBuiltInPrompt('joy-01')?.text).toBe('What was one moment I genuinely enjoyed today?');
    expect(findBuiltInPrompt('creativity-01')?.text).toBe("What song describes today's mood?");
  });

  it('includes every example question from the brief', () => {
    const texts = new Set(BUILT_IN_PROMPTS.map((p) => p.text));
    for (const q of [
      'What am I grateful for right now?',
      'What is something I am proud of?',
      'Who or what made me smile?',
      'What did I learn about myself today?',
      'What am I looking forward to?',
      'What is something I want to let go of?',
      'What would I like to remember about today?',
      'When did I feel most like myself?',
      'What small thing made today better?',
      'What challenged me, and what did I learn from it?',
      'What would I tell myself if I could revisit this morning?',
      'What is something I usually overlook but appreciate today?',
    ]) {
      expect(texts.has(q)).toBe(true);
    }
  });

  it('parses custom prompt ids strictly', () => {
    expect(parseCustomPromptId('custom-12')).toBe(12);
    expect(parseCustomPromptId('custom-0')).toBeNull();
    expect(parseCustomPromptId('custom-1.5')).toBeNull();
    expect(parseCustomPromptId('joy-01')).toBeNull();
  });
});

describe('featured prompt selection', () => {
  it('is deterministic for a date', () => {
    const a = selectFeaturedPrompt({ date: '2026-10-24', pool });
    const b = selectFeaturedPrompt({ date: '2026-10-24', pool: [...pool].reverse() });
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it('varies from day to day', () => {
    const picks = new Set(
      Array.from({ length: 30 }, (_, i) => selectFeaturedPrompt({ date: addDays('2026-10-01', i), pool })),
    );
    expect(picks.size).toBeGreaterThan(25);
  });

  it('never repeats within the recent window while alternatives exist', () => {
    const shown = new Set<string>();
    let date = '2026-01-01';
    for (let i = 0; i < 90; i++) {
      const pick = selectFeaturedPrompt({ date, pool, recentlyShown: shown })!;
      expect(shown.has(pick)).toBe(false);
      shown.add(pick);
      date = addDays(date, 1);
    }
  });

  it('falls back to the full pool when every prompt was shown recently', () => {
    const small = ['a', 'b'];
    expect(small).toContain(selectFeaturedPrompt({ date: '2026-10-24', pool: small, recentlyShown: new Set(small) }));
  });

  it('respects exclusions and changes with the salt', () => {
    const first = selectFeaturedPrompt({ date: '2026-10-24', pool })!;
    const other = selectFeaturedPrompt({ date: '2026-10-24', pool, exclude: new Set([first]), salt: 1 });
    expect(other).not.toBe(first);
    expect(selectFeaturedPrompt({ date: '2026-10-24', pool: [first], exclude: new Set([first]) })).toBeNull();
    expect(selectFeaturedPrompt({ date: '2026-10-24', pool: [] })).toBeNull();
  });

  it('hashes consistently', () => {
    expect(hashString('2026-10-24#0')).toBe(hashString('2026-10-24#0'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});
