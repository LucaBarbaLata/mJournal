/** Settings → PIN lock: turn the PIN on or off, change it, and choose when mJournal locks itself. */
import { useState, type FormEvent } from 'react';
import { AUTO_LOCK_MINUTES, isValidPin, PIN_MAX_LENGTH, type AutoLockMinutes, type LockStatus } from '@core/lock';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toasts';
import { api, errorMessage } from '../../lib/api';
import { useApp } from '../../lib/app';
import { useLock } from '../../lib/lock';
import { digitsOnly } from '../LockScreen';
import { SettingsSection } from '../SettingsView';

type Mode = 'set' | 'change' | 'remove';

function autoLockLabel(minutes: AutoLockMinutes): string {
  if (minutes === 0) return 'Never';
  if (minutes === 60) return 'After 1 hour';
  return `After ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

export function PinSettings() {
  const { status, lockNow, setStatus } = useLock();
  const { info } = useApp();
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setAutoLock = async (minutes: AutoLockMinutes) => {
    try {
      setError(null);
      setStatus(await api.lock.setAutoLock(minutes));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  // The "screen locked" signal exists on Windows and macOS, not on Linux.
  const alsoWhen =
    info.platform === 'linux'
      ? 'when your computer goes to sleep'
      : 'when your computer goes to sleep or you lock your screen';

  return (
    <SettingsSection
      id="pin"
      title="PIN lock"
      description="Ask for a PIN whenever mJournal opens, so other people using this computer can’t read your journal."
    >
      {status.enabled ? (
        <>
          <div className="setting-row">
            <div>
              <h3>Lock automatically</h3>
              <p className="muted">
                After this long without using mJournal. It also locks every time it starts, and {alsoWhen}.
              </p>
            </div>
            <label>
              <span className="visually-hidden">Lock automatically</span>
              <select
                className="select auto-lock-select"
                value={status.autoLockMinutes}
                onChange={(event) => void setAutoLock(Number(event.target.value) as AutoLockMinutes)}
              >
                {AUTO_LOCK_MINUTES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {autoLockLabel(minutes)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row-actions pin-actions">
            <button type="button" className="btn btn-primary" onClick={() => void lockNow()}>
              <Icon name="lock" size={16} /> Lock now
            </button>
            <button type="button" className="btn" onClick={() => setMode('change')}>
              <Icon name="pencil" size={16} /> Change PIN…
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode('remove')}>
              Turn off PIN…
            </button>
          </div>
        </>
      ) : (
        <div className="row-actions pin-actions">
          <button type="button" className="btn btn-primary" onClick={() => setMode('set')}>
            <Icon name="lock" size={16} /> Set a PIN…
          </button>
        </div>
      )}
      <p className="notice">
        <Icon name="info" size={16} />
        <span>
          The PIN keeps mJournal closed; it doesn’t encrypt your journal, so someone who can open your files could still
          read them (see Data & privacy). If you forget it, close mJournal and delete <code>lock.json</code> in the data
          folder — your journal stays as it is.
        </span>
      </p>
      {error && (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>{error}</span>
        </p>
      )}
      {mode && (
        <PinDialog
          mode={mode}
          onClose={() => setMode(null)}
          onDone={(next) => {
            setStatus(next);
            setMode(null);
            toast(
              mode === 'set'
                ? 'PIN set. mJournal will ask for it next time it opens.'
                : mode === 'change'
                  ? 'PIN changed.'
                  : 'PIN turned off.',
            );
          }}
        />
      )}
    </SettingsSection>
  );
}

const TITLES: Record<Mode, string> = {
  set: 'Set a PIN',
  change: 'Change your PIN',
  remove: 'Turn off the PIN',
};

function PinField({
  label,
  value,
  onChange,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="input pin-field-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={PIN_MAX_LENGTH}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(digitsOnly(event.target.value))}
      />
    </label>
  );
}

function PinDialog({ mode, onClose, onDone }: { mode: Mode; onClose: () => void; onDone: (status: LockStatus) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (mode !== 'remove') {
      if (!isValidPin(next)) return setError('A PIN is 4 to 8 digits.');
      if (next !== repeat) return setError('The two PINs aren’t the same. Please type it again.');
    }
    setBusy(true);
    setError(null);
    try {
      const status =
        mode === 'remove' ? await api.lock.removePin(current) : await api.lock.setPin(mode === 'change' ? current : null, next);
      onDone(status);
    } catch (err) {
      setError(errorMessage(err));
      setCurrent('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={TITLES[mode]}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="pin-form" className={`btn ${mode === 'remove' ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>
            {mode === 'set' ? 'Set PIN' : mode === 'change' ? 'Change PIN' : 'Turn off'}
          </button>
        </>
      }
    >
      <form id="pin-form" className="pin-form" onSubmit={(event) => void submit(event)}>
        {mode === 'set' && (
          <p className="muted">
            You’ll type it whenever mJournal opens: 4 to 8 digits that you’ll remember and others won’t guess. mJournal
            can’t show it to you again later.
          </p>
        )}
        {mode === 'remove' && <p className="muted">mJournal will open without asking for a PIN.</p>}
        {mode !== 'set' && <PinField label="Current PIN" value={current} onChange={setCurrent} autoFocus />}
        {mode !== 'remove' && (
          <>
            <PinField label="New PIN" value={next} onChange={setNext} autoFocus={mode === 'set'} />
            <PinField label="New PIN again" value={repeat} onChange={setRepeat} />
          </>
        )}
        {error && (
          <p className="notice error" role="alert">
            <Icon name="info" size={16} />
            <span>{error}</span>
          </p>
        )}
      </form>
    </Dialog>
  );
}
