/**
 * Mood vocabulary and energy scale.
 *
 * Moods are stored by key. The default vocabulary can be renamed, reordered,
 * hidden or extended in Settings; hidden moods stay readable on old entries.
 * Colors are palette names (not hex values) so each theme can render them.
 */

export const MOOD_COLORS = [
  'gold',
  'rose',
  'sage',
  'sand',
  'lavender',
  'mist',
  'sky',
  'coral',
  'mauve',
  'blend',
  'peach',
  'mint',
] as const;
export type MoodColor = (typeof MOOD_COLORS)[number];

/** Face illustrations plus a few symbols for custom moods. */
export const MOOD_ICONS = [
  'radiant',
  'happy',
  'calm',
  'okay',
  'tired',
  'anxious',
  'sad',
  'frustrated',
  'overwhelmed',
  'mixed',
  'heart',
  'star',
  'sun',
  'moon',
  'cloud',
  'rain',
  'leaf',
  'flower',
] as const;
export type MoodIcon = (typeof MOOD_ICONS)[number];

export interface MoodDefinition {
  key: string;
  label: string;
  icon: MoodIcon;
  color: MoodColor;
}

export const DEFAULT_MOODS: readonly MoodDefinition[] = [
  { key: 'wonderful', label: 'Wonderful', icon: 'radiant', color: 'gold' },
  { key: 'happy', label: 'Happy', icon: 'happy', color: 'rose' },
  { key: 'calm', label: 'Calm', icon: 'calm', color: 'sage' },
  { key: 'okay', label: 'Okay', icon: 'okay', color: 'sand' },
  { key: 'tired', label: 'Tired', icon: 'tired', color: 'lavender' },
  { key: 'anxious', label: 'Anxious', icon: 'anxious', color: 'mist' },
  { key: 'sad', label: 'Sad', icon: 'sad', color: 'sky' },
  { key: 'frustrated', label: 'Frustrated', icon: 'frustrated', color: 'coral' },
  { key: 'overwhelmed', label: 'Overwhelmed', icon: 'overwhelmed', color: 'mauve' },
  { key: 'mixed', label: 'Mixed feelings', icon: 'mixed', color: 'blend' },
];

export const MAX_MOOD_LABEL_LENGTH = 32;
export const MAX_MOODS = 30;

export interface EnergyLevel {
  value: 1 | 2 | 3 | 4 | 5;
  label: string;
  description: string;
}

export const ENERGY_LEVELS: readonly EnergyLevel[] = [
  { value: 1, label: 'Very low', description: 'Running on empty' },
  { value: 2, label: 'Low', description: 'A little drained' },
  { value: 3, label: 'Steady', description: 'Getting by fine' },
  { value: 4, label: 'High', description: 'Feeling lively' },
  { value: 5, label: 'Very high', description: 'Full of energy' },
];

export function energyLabel(value: number | null | undefined): string | null {
  return ENERGY_LEVELS.find((level) => level.value === value)?.label ?? null;
}

export function isMoodColor(value: unknown): value is MoodColor {
  return typeof value === 'string' && (MOOD_COLORS as readonly string[]).includes(value);
}

export function isMoodIcon(value: unknown): value is MoodIcon {
  return typeof value === 'string' && (MOOD_ICONS as readonly string[]).includes(value);
}
