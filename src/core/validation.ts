/**
 * Input checks for data arriving over IPC or from files. Every handler in the
 * main process validates its arguments with these before touching storage.
 */
import { isDateKey, isMonthKey, type DateKey, type MonthKey } from './dates';
import { MAX_TEXT_LENGTH, sanitizeText } from './text';

/** An error whose message is safe and helpful to show to the user. */
export class UserFacingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export class ValidationError extends UserFacingError {
  constructor(message: string) {
    super('invalid-input', message);
    this.name = 'ValidationError';
  }
}

export function expectDateKey(value: unknown, what = 'date'): DateKey {
  if (!isDateKey(value)) throw new ValidationError(`Invalid ${what}.`);
  return value;
}

export function expectMonthKey(value: unknown, what = 'month'): MonthKey {
  if (!isMonthKey(value)) throw new ValidationError(`Invalid ${what}.`);
  return value;
}

export function expectText(value: unknown, what = 'text', max = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string') throw new ValidationError(`Invalid ${what}.`);
  if (value.length > max) throw new ValidationError(`The ${what} is too long.`);
  return sanitizeText(value);
}

export function expectNonEmptyText(value: unknown, what: string, max = MAX_TEXT_LENGTH): string {
  const text = expectText(value, what, max).trim();
  if (!text) throw new ValidationError(`Please enter ${what}.`);
  return text;
}

export function expectBoolean(value: unknown, what = 'value'): boolean {
  if (typeof value !== 'boolean') throw new ValidationError(`Invalid ${what}.`);
  return value;
}

export function expectInteger(value: unknown, min: number, max: number, what = 'number'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`Invalid ${what}.`);
  }
  return value;
}

export function expectOneOf<T extends string | number>(value: unknown, options: readonly T[], what = 'option'): T {
  if (!options.includes(value as T)) throw new ValidationError(`Invalid ${what}.`);
  return value as T;
}

export function expectObject(value: unknown, what = 'input'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`Invalid ${what}.`);
  }
  return value as Record<string, unknown>;
}

export function expectArray(value: unknown, maxLength: number, what = 'list'): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) throw new ValidationError(`Invalid ${what}.`);
  return value;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Ids are short tokens of letters, digits, "-" and "_". */
export function expectId(value: unknown, what = 'id'): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new ValidationError(`Invalid ${what}.`);
  return value;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}
