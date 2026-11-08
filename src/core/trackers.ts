/**
 * Trackers: small things a person wants to keep an eye on each day — "Went outside", "Took my medicine",
 * "Sleep". A tracker is answered with yes or no ('check') or on a 1–5 scale ('scale'). Like a mood, an answer
 * on its own is enough for a day to count.
 */

export const TRACKER_KINDS = ['check', 'scale'] as const;
export type TrackerKind = (typeof TRACKER_KINDS)[number];

export const MAX_TRACKER_LABEL_LENGTH = 40;
/** Trackers shown on every day's page (the check-in card stays calm). */
export const MAX_ACTIVE_TRACKERS = 8;
/** Including the ones put away. */
export const MAX_TRACKERS = 50;

export const SCALE_MIN = 1;
export const SCALE_MAX = 5;

/** A few ideas for the Settings form; nothing is set up until the person adds one. */
export const TRACKER_SUGGESTIONS: readonly { label: string; kind: TrackerKind }[] = [
  { label: 'Went outside', kind: 'check' },
  { label: 'Took my medicine', kind: 'check' },
  { label: 'Moved my body', kind: 'check' },
  { label: 'Sleep', kind: 'scale' },
  { label: 'Stress', kind: 'scale' },
];

export function isTrackerKind(value: unknown): value is TrackerKind {
  return TRACKER_KINDS.includes(value as TrackerKind);
}

/** check: 0 = no, 1 = yes. scale: 1–5. */
export function isTrackerValue(kind: TrackerKind, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return false;
  return kind === 'check' ? value === 0 || value === 1 : value >= SCALE_MIN && value <= SCALE_MAX;
}

/** "Yes", "No" or "4 of 5". */
export function trackerValueLabel(kind: TrackerKind, value: number): string {
  if (kind === 'check') return value === 1 ? 'Yes' : 'No';
  return `${value} of ${SCALE_MAX}`;
}

export function trackerKindLabel(kind: TrackerKind): string {
  return kind === 'check' ? 'Yes or no' : `1 to ${SCALE_MAX}`;
}

/** Tidies a typed label: single spaces, at most MAX_TRACKER_LABEL_LENGTH characters. */
export function cleanTrackerLabel(label: string): string {
  return label.normalize('NFC').replace(/\s+/gu, ' ').trim().slice(0, MAX_TRACKER_LABEL_LENGTH).trim();
}
