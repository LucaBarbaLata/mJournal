/**
 * "This day changed somewhere else": after undoing a deleted day, or adding a
 * quick note, an open day page reloads its editor with the stored data (its own
 * pending edits are always saved first).
 */
import { useSyncExternalStore } from 'react';
import type { DateKey } from '@core/dates';

const versions = new Map<DateKey, number>();
const listeners = new Set<() => void>();

export function refreshDay(date: DateKey): void {
  versions.set(date, (versions.get(date) ?? 0) + 1);
  for (const listener of [...listeners]) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Changes whenever refreshDay(date) is called. */
export function useDayVersion(date: DateKey): number {
  return useSyncExternalStore(subscribe, () => versions.get(date) ?? 0);
}
