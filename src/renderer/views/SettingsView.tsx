/** Settings: personal touches, appearance, moods, prompts, backups and privacy. */
import { useEffect, useState, type ReactNode } from 'react';
import type { Settings, ThemePreference, WritingFont } from '@core/api';
import { formatLongDate, todayKey, type DateFormatPreference } from '@core/dates';
import type { UpdateStatus } from '@core/updates';
import { Icon, type IconName } from '../components/Icon';
import { LogoMark, Wordmark } from '../components/Logo';
import { openReleasePage } from '../components/UpdateNotice';
import { api, errorMessage } from '../lib/api';
import { useApp, type AppState } from '../lib/app';
import { withThemeFade } from '../lib/motion';
import { scrollMainTo } from '../lib/scroll';
import { useToday } from '../lib/time';
import { useUpdateStatus } from '../lib/updates';
import { BackupSettings } from './settings/BackupSettings';
import { DataSettings, RemovedPhotos } from './settings/DataSettings';
import { MoodSettings } from './settings/MoodSettings';
import { PromptSettings } from './settings/PromptSettings';
import './settings.css';

const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'you', label: 'You', icon: 'sparkle' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'dates', label: 'Dates & calendar', icon: 'calendar' },
  { id: 'moods', label: 'Moods', icon: 'heart' },
  { id: 'prompts', label: 'Prompts', icon: 'quote' },
  { id: 'streaks', label: 'Streaks & reminder', icon: 'bell' },
  { id: 'backup', label: 'Backup & export', icon: 'download' },
  { id: 'data', label: 'Data & privacy', icon: 'lock' },
  { id: 'removed', label: 'Recently removed', icon: 'trash' },
  { id: 'guide', label: 'Guide & tips', icon: 'leaf' },
  { id: 'updates', label: 'Updates', icon: 'sprout' },
  { id: 'about', label: 'Shortcuts & about', icon: 'info' },
];

export function SettingsView({ section }: { section: string | null }) {
  useEffect(() => {
    if (!section) return;
    // After the shell's own scroll-to-top for the new route.
    const frame = requestAnimationFrame(() => scrollMainTo(document.getElementById(`settings-${section}`)));
    return () => cancelAnimationFrame(frame);
  }, [section]);

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div className="page-heading">
          <p className="eyebrow">Settings</p>
          <h1>Make it yours</h1>
          <p className="subtitle muted">Everything here is saved on this computer, right away.</p>
        </div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#/settings/${s.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    scrollMainTo(document.getElementById(`settings-${s.id}`), 'smooth');
                  }}
                >
                  <Icon name={s.icon} size={16} /> {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="settings-content">
          <YouSettings />
          <AppearanceSettings />
          <DateSettings />
          <MoodSettings />
          <PromptSettings />
          <StreakSettings />
          <BackupSettings />
          <DataSettings />
          <RemovedPhotos />
          <GuideSettings />
          <UpdateSettings />
          <AboutSettings />
        </div>
      </div>
    </div>
  );
}

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="card settings-section" id={`settings-${id}`} aria-labelledby={`settings-${id}-title`}>
      <div className="settings-section-head">
        <h2 id={`settings-${id}-title`}>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function useSetting() {
  const { settings, updateSettings } = useApp();
  const [error, setError] = useState<string | null>(null);
  const set = async (patch: Partial<Settings>) => {
    try {
      setError(null);
      await updateSettings(patch);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return { settings, set, error };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="notice error" role="alert">
      <Icon name="info" size={16} />
      <span>{error}</span>
    </p>
  );
}

function YouSettings() {
  const { settings, set, error } = useSetting();
  const [name, setName] = useState(settings.displayName);
  useEffect(() => {
    if (name === settings.displayName) return;
    const timer = window.setTimeout(() => void set({ displayName: name.trim() }), 500);
    return () => window.clearTimeout(timer);
  }, [name]);
  return (
    <SettingsSection id="you" title="You" description="mJournal has no accounts. This is only used for your greeting.">
      <label className="field narrow-field">
        <span className="field-label">What should mJournal call you?</span>
        <input
          className="input"
          value={name}
          maxLength={40}
          placeholder="Your name or nickname (optional)"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <ErrorLine error={error} />
    </SettingsSection>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={15} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AppearanceSettings() {
  const { settings, set, error } = useSetting();
  return (
    <SettingsSection id="appearance" title="Appearance">
      <div className="setting-row">
        <div>
          <h3>Theme</h3>
          <p className="muted">The dark theme is made for cozy evening writing.</p>
        </div>
        <Segmented<ThemePreference>
          label="Theme"
          value={settings.theme}
          onChange={(theme) => void withThemeFade(() => set({ theme }))}
          options={[
            { value: 'light', label: 'Light', icon: 'sun' },
            { value: 'dark', label: 'Dark', icon: 'moon' },
            { value: 'system', label: 'Match system', icon: 'monitor' },
          ]}
        />
      </div>
      <div className="setting-row">
        <div>
          <h3>Writing font</h3>
          <p className={`muted font-preview font-${settings.writingFont}`}>Today I noticed the light on the wall…</p>
        </div>
        <Segmented<WritingFont>
          label="Writing font"
          value={settings.writingFont}
          onChange={(writingFont) => void set({ writingFont })}
          options={[
            { value: 'serif', label: 'Classic' },
            { value: 'sans', label: 'Clean' },
            { value: 'hand', label: 'Handwritten' },
          ]}
        />
      </div>
      <div className="setting-row">
        <div>
          <h3>Reduce motion</h3>
          <p className="muted">Turns off animations. mJournal also follows your system’s reduced-motion setting.</p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={settings.reduceMotion} onChange={(event) => void set({ reduceMotion: event.target.checked })} />
          <span className="visually-hidden">Reduce motion</span>
        </label>
      </div>
      <ErrorLine error={error} />
    </SettingsSection>
  );
}

function DateSettings() {
  const { settings, set, error } = useSetting();
  const today = useToday();
  const formats: { value: DateFormatPreference; label: string }[] = [
    { value: 'month-first', label: 'Month first' },
    { value: 'day-first', label: 'Day first' },
    { value: 'iso', label: 'Year-month-day' },
  ];
  return (
    <SettingsSection id="dates" title="Dates & calendar">
      <fieldset className="radio-list">
        <legend>Date format</legend>
        {formats.map((f) => (
          <label key={f.value} className="radio-option">
            <input
              type="radio"
              name="date-format"
              checked={settings.dateFormat === f.value}
              onChange={() => void set({ dateFormat: f.value })}
            />
            <span className="radio-label">{f.label}</span>
            <span className="muted">{formatLongDate(today, f.value)}</span>
          </label>
        ))}
      </fieldset>
      <div className="setting-row">
        <div>
          <h3>First day of the week</h3>
          <p className="muted">Used by the calendar.</p>
        </div>
        <Segmented<'0' | '1' | '6'>
          label="First day of the week"
          value={String(settings.weekStartsOn) as '0' | '1' | '6'}
          onChange={(v) => void set({ weekStartsOn: Number(v) as 0 | 1 | 6 })}
          options={[
            { value: '1', label: 'Monday' },
            { value: '0', label: 'Sunday' },
            { value: '6', label: 'Saturday' },
          ]}
        />
      </div>
      <ErrorLine error={error} />
    </SettingsSection>
  );
}

function StreakSettings() {
  const { settings, set, error } = useSetting();
  const { info } = useApp();
  return (
    <SettingsSection id="streaks" title="Streaks & reminder">
      <div className="setting-row">
        <div>
          <h3>Show my journaling streak</h3>
          <p className="muted">A small encouragement on Today and in Insights. Turn it off any time — nothing else changes.</p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={settings.showStreaks} onChange={(event) => void set({ showStreaks: event.target.checked })} />
          <span className="visually-hidden">Show my journaling streak</span>
        </label>
      </div>
      <div className="setting-row">
        <div>
          <h3>Evening reminder</h3>
          <p className="muted">
            mJournal doesn’t run in the background, so this gentle reminder can only appear{' '}
            <strong>while mJournal is open</strong> (minimized is fine). It stays quiet on days you’ve already written.
          </p>
          {!info.notificationsSupported && <p className="notice">Notifications aren’t available on this system.</p>}
        </div>
        <div className="reminder-controls">
          <label className="switch">
            <input
              type="checkbox"
              disabled={!info.notificationsSupported}
              checked={settings.reminderEnabled}
              onChange={(event) => void set({ reminderEnabled: event.target.checked })}
            />
            <span className="visually-hidden">Evening reminder</span>
          </label>
          <label>
            <span className="visually-hidden">Reminder time</span>
            <input
              type="time"
              className="input time-input"
              value={settings.reminderTime}
              disabled={!settings.reminderEnabled || !info.notificationsSupported}
              onChange={(event) => event.target.value && void set({ reminderTime: event.target.value })}
            />
          </label>
        </div>
      </div>
      <ErrorLine error={error} />
    </SettingsSection>
  );
}

function GuideSettings() {
  const { settings, set, error } = useSetting();
  return (
    <SettingsSection
      id="guide"
      title="Guide & tips"
      description="A short welcome tour, and small one-time tips around the app."
    >
      <div className="row-actions">
        <button type="button" className="btn" onClick={() => void set({ onboardingDone: false })}>
          <Icon name="sparkle" size={16} /> Open the welcome guide
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={settings.dismissedTips.length === 0}
          onClick={() => void set({ dismissedTips: [] })}
        >
          <Icon name="restore" size={16} /> Show tips again
        </button>
      </div>
      <ErrorLine error={error} />
    </SettingsSection>
  );
}

function describeUpdate(status: UpdateStatus, format: AppState['format']): string {
  const checked = status.checkedAt
    ? ` Last checked ${format.medium(todayKey(new Date(status.checkedAt)))} at ${format.time(status.checkedAt)}.`
    : '';
  switch (status.state) {
    case 'checking':
      return 'Asking GitHub…';
    case 'available':
      return `mJournal ${status.latest} is out. You have ${status.current}.`;
    case 'failed':
      return `GitHub couldn’t be reached just now. Are you online?${checked}`;
    case 'up-to-date':
      return `You have the newest version.${checked}`;
    case 'idle':
    case 'off':
      return 'Not checked yet.';
  }
}

function UpdateSettings() {
  const { settings, set, error } = useSetting();
  const { format } = useApp();
  const [status, setStatus] = useUpdateStatus();
  const checkNow = async () => {
    try {
      setStatus(await api.updates.check());
    } catch {
      // The status line already says when GitHub couldn't be reached.
    }
  };
  return (
    <SettingsSection id="updates" title="Updates">
      <div className="setting-row">
        <div>
          <h3>Check for new versions</h3>
          <p className="muted">
            About once a day, mJournal asks GitHub whether a newer version is out. That’s the only thing it ever asks the
            internet: nothing about you or your journal is sent, and nothing is downloaded or installed by itself.
          </p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.checkForUpdates}
            onChange={(event) => void set({ checkForUpdates: event.target.checked })}
          />
          <span className="visually-hidden">Check for new versions</span>
        </label>
      </div>
      <div className="update-row">
        <p className="update-status" aria-live="polite">
          {status ? describeUpdate(status, format) : ''}
        </p>
        <div className="row-actions">
          {status?.state === 'available' && (
            <button type="button" className="btn btn-primary" onClick={openReleasePage}>
              <Icon name="download" size={16} /> Get mJournal {status.latest}
            </button>
          )}
          <button type="button" className="btn" disabled={status?.state === 'checking'} onClick={() => void checkNow()}>
            <Icon name="restore" size={16} /> Check now
          </button>
        </div>
      </div>
      <ErrorLine error={error} />
    </SettingsSection>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl + 1 … 6', 'Today, Calendar, Journal, Memories, Monthly, Insights'],
  ['Ctrl + ,', 'Settings'],
  ['Ctrl + F', 'Search your journal'],
  ['Ctrl + S', 'Save now (mJournal also saves as you type)'],
  ['Alt + ← / →', 'Previous / next day'],
  ['Arrow keys', 'Move around the calendar; Page Up / Page Down change month'],
  ['Esc', 'Close a dialog or photo'],
];

function AboutSettings() {
  const { info } = useApp();
  return (
    <SettingsSection id="about" title="Shortcuts & about">
      <table className="shortcut-table">
        <tbody>
          {SHORTCUTS.map(([keys, action]) => (
            <tr key={keys}>
              <th scope="row">
                <span className="kbd">{keys}</span>
              </th>
              <td>{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="about">
        <LogoMark size={44} />
        <div>
          <p className="about-name">
            <Wordmark /> <span className="muted">version {info.version}</span>
          </p>
          <p className="hand about-motto">My life doesn’t have to be perfect for it to be beautiful.</p>
          <p className="muted">A private place for the good, difficult, ordinary and meaningful moments. No accounts, ads or tracking.</p>
          <p className="muted about-license">
            Free and open source under the MIT License. Made with Electron, React and the Fraunces, Nunito and Caveat
            fonts; their licenses are in THIRD-PARTY-NOTICES.txt in the mJournal folder.
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}
