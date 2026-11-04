/** The lock screen: shown instead of the whole app while mJournal is locked. It never shows journal content. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isValidPin, PIN_MAX_LENGTH, PIN_MIN_LENGTH, type LockStatus } from '@core/lock';
import { Flower, Sparkles, Sprig } from '../components/Decorations';
import { Icon } from '../components/Icon';
import { LogoMark } from '../components/Logo';
import { api, errorMessage } from '../lib/api';
import './lock.css';

/** Keeps only digits, up to the longest PIN. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH);
}

function wrongPinMessage(status: LockStatus): string {
  if (status.retryAt) return 'That’s not it. Let’s take a short pause.';
  const left = status.triesBeforePause;
  if (left <= 2) return `That’s not it. ${left} more ${left === 1 ? 'try' : 'tries'} before a short pause.`;
  return 'That’s not the right PIN. Try again?';
}

function formatWait(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The current time, ticking every second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export function LockScreen({ status, onStatus }: { status: LockStatus; onStatus: (status: LockStatus) => void }) {
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const now = useNow(status.retryAt !== null);
  const waitMs = status.retryAt ? Date.parse(status.retryAt) - now : 0;
  const waiting = waitMs > 0;

  // Ready to type as soon as the screen appears, and again after a pause.
  useEffect(() => {
    if (!waiting && !busy) input.current?.focus();
  }, [waiting, busy]);

  // The pause is over: ask again so the screen shows how many tries are left.
  useEffect(() => {
    if (status.retryAt && !waiting) {
      setMessage(null);
      void api.lock.status().then(onStatus, () => undefined);
    }
  }, [status.retryAt, waiting, onStatus]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || waiting) return;
    if (!isValidPin(pin)) {
      setMessage(`Your PIN has ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits.`);
      return;
    }
    setBusy(true);
    try {
      const next = await api.lock.unlock(pin);
      if (next.locked) {
        setPin('');
        setShaking(true);
        setMessage(wrongPinMessage(next));
      }
      // Unlocked: the app replaces this screen.
      onStatus(next);
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-screen">
      <div className="titlebar-drag lock-titlebar" />
      <Sprig size={64} className="lock-deco lock-deco-sprig" />
      <Flower size={34} className="lock-deco lock-deco-flower" />
      <Sparkles size={48} className="lock-deco lock-deco-sparkles" />
      <form className="lock-card" onSubmit={(event) => void submit(event)} aria-labelledby="lock-title">
        <span className="lock-logo">
          <LogoMark size={56} />
        </span>
        <h1 id="lock-title">Welcome back</h1>
        <p className="muted">Enter your PIN to open your journal.</p>
        <label className="visually-hidden" htmlFor="lock-pin">
          PIN
        </label>
        <input
          id="lock-pin"
          ref={input}
          className={`input pin-input${shaking ? ' shake' : ''}`}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={PIN_MAX_LENGTH}
          value={pin}
          disabled={waiting}
          aria-invalid={message !== null && !waiting ? true : undefined}
          aria-describedby="lock-message"
          onChange={(event) => {
            setPin(digitsOnly(event.target.value));
            if (!waiting) setMessage(null);
          }}
          onAnimationEnd={() => setShaking(false)}
        />
        <button type="submit" className="btn btn-primary btn-lg lock-submit" disabled={busy || waiting || pin.length < PIN_MIN_LENGTH}>
          <Icon name="lock" size={17} /> Unlock
        </button>
        <p id="lock-message" className="lock-message" role="status" aria-live="polite">
          {waiting ? `Too many tries. You can try again in ${formatWait(waitMs)}.` : message}
        </p>
        <p className="lock-forgot">
          Forgot your PIN? “Troubleshooting” in mJournal’s README explains how to remove it. Your journal stays as it is.
        </p>
      </form>
    </div>
  );
}
