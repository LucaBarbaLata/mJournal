/**
 * The PIN lock in the interface. While locked, nothing of the journal is
 * mounted: the whole app (and every piece of loaded data) is replaced by the
 * lock screen, and the main process refuses journal requests anyway.
 *
 * Locking always saves pending edits first. mJournal locks after the chosen
 * time without input, from Ctrl+L or the sidebar, and when the main process
 * asks (the computer goes to sleep or its screen locks).
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { FREE_TRIES, type LockStatus } from '@core/lock';
import { api, native } from './api';
import { saveQueue } from './saveQueue';

export interface LockState {
  status: LockStatus;
  /** Saves pending edits, then locks (only when a PIN is set). */
  lockNow: () => Promise<void>;
  /** For answers from api.lock.* calls. */
  setStatus: (status: LockStatus) => void;
}

const LockContext = createContext<LockState | null>(null);

export function useLock(): LockState {
  const value = useContext(LockContext);
  if (!value) throw new Error('useLock must be used inside <LockProvider>');
  return value;
}

/** Shown if the lock can't be asked about: better a lock screen than the journal. */
const UNKNOWN: LockStatus = { enabled: true, locked: true, autoLockMinutes: 0, retryAt: null, triesBeforePause: FREE_TRIES };

/** Counted as using mJournal for the automatic lock. */
const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const;
const IDLE_CHECK_MS = 5000;

export function LockProvider({
  fallback,
  locked,
  children,
}: {
  fallback: ReactNode;
  locked: (status: LockStatus, setStatus: (status: LockStatus) => void) => ReactNode;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<LockStatus | null>(null);

  const lockNow = useCallback(async () => {
    // Failed saves stay queued and can be retried after unlocking.
    await saveQueue.flush().catch(() => undefined);
    try {
      setStatus(await api.lock.lock());
    } catch {
      setStatus(UNKNOWN);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api.lock.status().then(
      (s) => alive && setStatus(s),
      () => alive && setStatus(UNKNOWN),
    );
    const stopChanged = native.onLockChanged((s) => setStatus(s));
    const stopRequest = native.onLockRequest(() => lockNow());
    return () => {
      alive = false;
      stopChanged();
      stopRequest();
    };
  }, [lockNow]);

  // Lock after the chosen number of minutes without input.
  const idleMinutes = status?.enabled && !status.locked ? status.autoLockMinutes : 0;
  useEffect(() => {
    if (!idleMinutes) return;
    let lastActive = Date.now();
    const active = () => {
      lastActive = Date.now();
    };
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, active, { capture: true, passive: true });
    const timer = window.setInterval(() => {
      if (Date.now() - lastActive >= idleMinutes * 60_000) void lockNow();
    }, IDLE_CHECK_MS);
    return () => {
      window.clearInterval(timer);
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, active, { capture: true });
    };
  }, [idleMinutes, lockNow]);

  if (!status) return <>{fallback}</>;
  return (
    <LockContext.Provider value={{ status, lockNow, setStatus }}>
      {status.locked ? locked(status, setStatus) : children}
    </LockContext.Provider>
  );
}
