/**
 * A request to open the quick-note box (from the global shortcut or the tray). It is remembered above the PIN
 * lock, so when mJournal was locked the box opens right after unlocking.
 */
import { useSyncExternalStore } from 'react';

let pending = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function requestQuickNote(): void {
  pending = true;
  notify();
}

/** Takes the request (once), so the box opens one time per request; the next request is noticed again. */
export function takeQuickNoteRequest(): boolean {
  const was = pending;
  pending = false;
  if (was) notify();
  return was;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useQuickNoteRequested(): boolean {
  return useSyncExternalStore(subscribe, () => pending);
}
