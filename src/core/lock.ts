/**
 * Rules for the optional PIN lock, shared by the main process and the interface.
 *
 * The PIN keeps mJournal's window closed to other people using the computer.
 * It does not encrypt the journal (see docs/ARCHITECTURE.md → "The PIN lock").
 */

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

const PIN_RE = /^\d{4,8}$/;

/** A PIN is 4 to 8 digits. */
export function isValidPin(value: unknown): value is string {
  return typeof value === 'string' && PIN_RE.test(value);
}

/** Choices for "Lock automatically after … of not using mJournal" (0 = never). */
export const AUTO_LOCK_MINUTES = [0, 1, 5, 15, 30, 60] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_MINUTES)[number];
export const DEFAULT_AUTO_LOCK_MINUTES: AutoLockMinutes = 5;

/** Wrong PINs allowed before mJournal asks you to wait. */
export const FREE_TRIES = 5;

/**
 * How long to wait after this many wrong PINs in a row: nothing for the first
 * few, then 30 seconds, 1 minute, 5 minutes and 15 minutes from then on.
 */
export function wrongPinPause(failures: number): number {
  if (failures < FREE_TRIES) return 0;
  const steps = [30_000, 60_000, 5 * 60_000];
  return steps[failures - FREE_TRIES] ?? 15 * 60_000;
}

/** What the interface may know about the lock. Never contains the PIN or its hash. */
export interface LockStatus {
  /** Whether a PIN is set. */
  enabled: boolean;
  locked: boolean;
  /** Minutes without using mJournal before it locks itself (0 = never). */
  autoLockMinutes: AutoLockMinutes;
  /** After too many wrong PINs: when the next try is allowed (ISO time), otherwise null. */
  retryAt: string | null;
  /** Wrong PINs that can still be entered before a pause. */
  triesBeforePause: number;
}
