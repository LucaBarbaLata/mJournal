/**
 * The built-in library of reflection questions.
 *
 * Ids are permanent: answers and the daily rotation refer to them. Add new
 * prompts with new ids at the end of a category and never renumber or reuse one.
 * To retire a prompt, move its id to RETIRED_PROMPT_IDS instead of deleting it.
 */

export const PROMPT_CATEGORIES = [
  { key: 'gratitude', label: 'Gratitude' },
  { key: 'joy', label: 'Joy & delight' },
  { key: 'growth', label: 'Growth & pride' },
  { key: 'self', label: 'Knowing myself' },
  { key: 'connection', label: 'People & connection' },
  { key: 'letting-go', label: 'Letting go & self-kindness' },
  { key: 'looking-forward', label: 'Looking forward' },
  { key: 'memory', label: 'Moments & memories' },
  { key: 'creativity', label: 'Songs, stories & ideas' },
  { key: 'nature', label: 'Nature & places' },
  { key: 'rest', label: 'Rest & care' },
  { key: 'playful', label: 'Just for fun' },
] as const;

export type BuiltInCategory = (typeof PROMPT_CATEGORIES)[number]['key'];
export type PromptCategory = BuiltInCategory | 'custom';

export interface BuiltInPrompt {
  id: string;
  text: string;
  category: BuiltInCategory;
}

const LIBRARY: Record<BuiltInCategory, string[]> = {
  gratitude: [
    'What am I grateful for right now?',
    "What is something small that I'm thankful for today?",
    "Who is someone I'm grateful to have in my life, and why?",
    'What is something I usually overlook but appreciate today?',
    'What comfort did I enjoy today that I might take for granted?',
    "What part of my daily routine am I quietly thankful for?",
    'What is a recent kindness someone showed me?',
    'What is something my body helped me do today?',
    'What is one thing about my home that I love?',
    "What is a simple pleasure I'm glad exists?",
    'What is something I have now that I once wished for?',
    'Which meal, snack or drink am I grateful for today?',
    'What made me feel safe or cared for recently?',
    "What is a lesson I'm grateful to have learned, even if it was hard?",
    "What is a sound, smell or texture I'm thankful for today?",
    'Who made my day a little easier?',
    'What is an object that made life a bit better today?',
    'What about today would I miss if it were gone?',
  ],
  joy: [
    'What was one moment I genuinely enjoyed today?',
    'Who or what made me smile?',
    'What small thing made today better?',
    'When did I laugh today?',
    'What was the best part of my day, even if it was tiny?',
    'What did I do today just for fun?',
    'What looked beautiful to me today?',
    'What made me feel light or carefree?',
    'What was a little surprise that brightened my day?',
    'What is something that delighted me recently?',
    'When did time seem to fly today?',
    'What made me feel excited, even for a moment?',
    'What is a cozy moment from today I want to keep?',
    'What made me feel like a kid again?',
    'What is a compliment I received or gave today?',
    'What was the most comforting part of today?',
  ],
  growth: [
    'What is something I am proud of?',
    'What challenged me, and what did I learn from it?',
    'What is one thing I did today that took courage?',
    'What progress did I make, however small?',
    "What is a skill I'm slowly getting better at?",
    'What did I handle better than I would have a year ago?',
    'What is something I finished, started or kept going with?',
    'When did I keep going even though it was hard?',
    'What is a mistake I made that taught me something?',
    'What is something I tried for the first time?',
    'What would I like to practice tomorrow?',
    'What is a goal that matters to me right now, and why?',
    'What did I do today that my future self will thank me for?',
    'Where did I show patience today?',
    "What is something I understand now that I didn't before?",
    'What is a compliment I deserve to give myself today?',
  ],
  self: [
    'What did I learn about myself today?',
    'When did I feel most like myself?',
    'Which feeling visited me most today, and what was it trying to tell me?',
    'What is something I need more of right now?',
    'What is something I need less of right now?',
    'What drained my energy today, and what restored it?',
    'What is a value I lived by today?',
    'If my mood today were weather, what would it be?',
    "What is something I've been thinking about a lot lately?",
    'What made me feel calm today?',
    "What is a boundary I'm glad I have, or wish I had?",
    "What am I curious about right now?",
    'How did I take care of myself today?',
    'What do I want to say "yes" to more often?',
    'What do I want to say "no" to more often?',
    'What part of today felt most true to who I am?',
    'What does a good day look like for me lately?',
    "What is something I'd like people to know about me?",
  ],
  connection: [
    'Who did I enjoy spending time with recently?',
    'What was a good conversation I had today?',
    "Who is someone I'd like to reach out to soon?",
    "How did I make someone's day a little better?",
    'What is something a friend said that stayed with me?',
    'Who made me feel understood?',
    'Which memory with someone I love made me smile today?',
    'Who inspires me, and what do I admire about them?',
    'What do I appreciate about the people I live with or grew up with?',
    'Who would I like to thank, and for what?',
    'What did I learn from someone else today?',
    'When did I feel like I belonged?',
    'What is a kind thing I could do for someone tomorrow?',
    'Who did I think about today?',
  ],
  'letting-go': [
    'What is something I want to let go of?',
    'What would I tell myself if I could revisit this morning?',
    'What worry can I set down for tonight?',
    'What is something I can forgive myself for?',
    "What didn't go as planned, and how can I be gentle with myself about it?",
    'What would I say to a friend who had the day I had?',
    'What is something out of my control that I can stop carrying?',
    "What is one thing I don't need to be perfect at?",
    'What would make tomorrow feel a little lighter?',
    'What feeling am I ready to make peace with?',
    "What am I allowed to rest from?",
    'What did today teach me about being kind to myself?',
    'What expectation can I loosen a little?',
    'What do I want to leave in today, rather than bring into tomorrow?',
  ],
  'looking-forward': [
    'What am I looking forward to?',
    "What is something I'm excited to try?",
    'What would make tomorrow a good day?',
    "What is a small adventure I'd like to have this month?",
    "What is a place I'd love to visit someday?",
    'What is one thing I want to remember to do this week?',
    "What is a dream I'm quietly holding onto?",
    "What am I hopeful about?",
    'What would I like my life to feel like a year from now?',
    'What is a tiny step I could take toward something I want?',
    "What is a plan I'm looking forward to with someone?",
    'What season, event or day am I counting down to?',
    'What would I like to learn next?',
    'What would I like to create, make or build?',
  ],
  memory: [
    'What would I like to remember about today?',
    "What is a detail from today I don't want to forget?",
    'If today had a title, what would it be?',
    "What was a picture-worthy moment today, even if I didn't take a photo?",
    'How would I describe today in three words?',
    'What memory came back to me today?',
    'What did today smell, sound or taste like?',
    'Where was I happiest today?',
    'What is something I noticed for the first time?',
    'What made today different from yesterday?',
    'What moment from this week do I want to hold onto?',
    'What would I want to tell my future self about this time in my life?',
    'What childhood memory still makes me smile?',
    'What everyday moment would I miss someday?',
    'What did the light look like today?',
    'What small ritual made today feel like mine?',
  ],
  creativity: [
    "What song describes today's mood?",
    'What song have I had on repeat lately, and why?',
    'What book, show or film has been on my mind?',
    'What idea excited me today?',
    'What did I create or make today, even if it was small?',
    'What quote or line resonated with me recently?',
    'What is something beautiful I saw someone make?',
    'If today were a scene in a film, what would be happening?',
    "What is a hobby I'd love to spend more time on?",
    'What color would describe today, and why?',
    'What is something interesting I learned or read recently?',
    'If I could sketch one moment from today, what would I draw?',
    "What story, game or world have I been enjoying?",
    'What song reminds me of someone special?',
  ],
  nature: [
    'What did the sky look like today?',
    'Where did I feel most at ease today?',
    'What is something in nature I noticed recently?',
    'What place feels like home to me?',
    'How did the weather shape my day?',
    'What is my favorite spot nearby, and why?',
    'Which season do I love, and what do I love about it?',
    'When did I last feel the sun, wind or rain, and how did it feel?',
    'What plant, animal or pet made me smile?',
    'What walk or journey did I enjoy?',
    "What view would I like to see again?",
    'What sound from outside did I notice today?',
  ],
  rest: [
    'How is my body feeling right now?',
    'What helped me rest today?',
    'What is one kind thing I did for my body today?',
    'What would feel nourishing right now?',
    'How did I sleep, and how did it shape my day?',
    'What is my favorite way to unwind?',
    'When did I take a pause today?',
    'What does my ideal cozy evening look like?',
    'What is something gentle I could do for myself tomorrow?',
    'What gave me energy today?',
    'What comfort food, drink or ritual helps me?',
    'What would make my space feel calmer?',
  ],
  playful: [
    'If today were a flavor, what would it taste like?',
    'What would a pet, real or imaginary, say about my day?',
    "Which three songs would be on today's playlist?",
    'What tiny thing would I add to a "perfect day" list?',
    'If I had a superpower for one day, what would I do with it?',
    'What would I put in a time capsule from this week?',
    'What made me say "aww" lately?',
    'What silly thing made me laugh?',
    'What is my current comfort show, song or snack?',
    'What would a cozy version of tomorrow look like?',
    'If this week were a chapter in a book, what would it be called?',
    "What small treat would I love to give myself this week?",
  ],
};

export const BUILT_IN_PROMPTS: readonly BuiltInPrompt[] = PROMPT_CATEGORIES.flatMap(({ key }) =>
  LIBRARY[key].map((text, i) => ({ id: `${key}-${String(i + 1).padStart(2, '0')}`, text, category: key })),
);

/** Ids that have been retired from the library (kept so old answers stay readable). */
export const RETIRED_PROMPT_IDS: readonly string[] = [];

const byId = new Map(BUILT_IN_PROMPTS.map((p) => [p.id, p]));

export function findBuiltInPrompt(id: string): BuiltInPrompt | undefined {
  return byId.get(id);
}

export function categoryLabel(category: PromptCategory): string {
  if (category === 'custom') return 'My prompts';
  return PROMPT_CATEGORIES.find((c) => c.key === category)?.label ?? 'Prompts';
}

export const CUSTOM_PROMPT_PREFIX = 'custom-';
export const MAX_PROMPT_LENGTH = 300;

export function customPromptId(rowId: number): string {
  return `${CUSTOM_PROMPT_PREFIX}${rowId}`;
}

export function parseCustomPromptId(id: string): number | null {
  if (!id.startsWith(CUSTOM_PROMPT_PREFIX)) return null;
  const n = Number(id.slice(CUSTOM_PROMPT_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Questions for the monthly letter-to-self, in display order. */
export const MONTHLY_QUESTIONS = [
  { key: 'meaningful', text: 'What made this month meaningful?' },
  { key: 'favorites', text: 'What were my favorite moments?' },
  { key: 'difficult', text: 'What was difficult?' },
  { key: 'learned', text: 'What did I learn about myself?' },
  { key: 'surprised', text: 'What surprised me?' },
  { key: 'proud', text: 'What am I proud of?' },
  { key: 'leave-behind', text: 'What do I want to leave behind?' },
  { key: 'carry-forward', text: 'What do I want to carry into next month?' },
] as const;

/** The free-form "Dear me…" letter stored alongside the monthly answers. */
export const MONTHLY_LETTER_KEY = 'letter';

export const MONTHLY_KEYS: readonly string[] = [...MONTHLY_QUESTIONS.map((q) => q.key), MONTHLY_LETTER_KEY];
