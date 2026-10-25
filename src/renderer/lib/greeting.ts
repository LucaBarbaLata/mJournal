/** A warm, understated greeting for the time of day. */
import { hashString } from '@core/promptSelection';
import type { DateKey } from '@core/dates';

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export function dayPart(now: Date): DayPart {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export function greeting(now: Date, name: string): string {
  const who = name.trim();
  switch (dayPart(now)) {
    case 'morning':
      return who ? `Good morning, ${who}` : 'Good morning';
    case 'afternoon':
      return who ? `Good afternoon, ${who}` : 'Good afternoon';
    case 'evening':
      return who ? `Good evening, ${who}` : 'Good evening';
    case 'night':
      return who ? `Still up, ${who}?` : 'Hello, night owl';
  }
}

const WELCOMES = [
  'This page is just for you.',
  'Write as much or as little as you like.',
  'Small moments count too.',
  'However today went, you are welcome here.',
  'No need for perfect sentences.',
  'A few words are plenty.',
  'Take a breath. There is no rush.',
  'Ordinary days are worth remembering.',
];

/** A gentle line under the greeting; stable for a given day. */
export function welcomeLine(date: DateKey): string {
  return WELCOMES[hashString(`welcome-${date}`) % WELCOMES.length];
}
