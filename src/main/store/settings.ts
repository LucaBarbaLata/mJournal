/**
 * User settings (stored as JSON values per key) plus a few internal values
 * such as the window position. Malformed stored values fall back to defaults.
 */
import type { Settings } from '@core/api';
import { isClockTime, UserFacingError, ValidationError } from '@core/validation';
import type { Db } from './database';

export const MAX_NAME_LENGTH = 40;

type Validators = { [K in keyof Settings]: (value: unknown) => value is Settings[K] };

const oneOf =
  <T>(...options: T[]) =>
  (value: unknown): value is T =>
    options.includes(value as T);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

const VALIDATORS: Validators = {
  displayName: (v): v is string => typeof v === 'string' && v.length <= MAX_NAME_LENGTH,
  theme: oneOf('system', 'light', 'dark'),
  dateFormat: oneOf('month-first', 'day-first', 'iso'),
  weekStartsOn: oneOf(0, 1, 6),
  writingFont: oneOf('serif', 'sans', 'hand'),
  showStreaks: isBoolean,
  reduceMotion: isBoolean,
  autoSnapshots: isBoolean,
  reminderEnabled: isBoolean,
  reminderTime: isClockTime,
  onboardingDone: isBoolean,
  dismissedTips: (v): v is string[] =>
    Array.isArray(v) && v.length <= 50 && v.every((id) => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id)),
};

export function defaultSettings(regionCode: string): Settings {
  const monthFirst = ['US', 'PH', 'FM', 'MH', 'PW', 'BZ'].includes(regionCode.toUpperCase());
  return {
    displayName: '',
    theme: 'system',
    dateFormat: monthFirst ? 'month-first' : 'day-first',
    weekStartsOn: ['US', 'CA', 'JP', 'BR', 'MX', 'PH', 'IL'].includes(regionCode.toUpperCase()) ? 0 : 1,
    writingFont: 'serif',
    showStreaks: true,
    reduceMotion: false,
    autoSnapshots: true,
    reminderEnabled: false,
    reminderTime: '20:30',
    onboardingDone: false,
    dismissedTips: [],
  };
}

const INTERNAL_PREFIX = 'internal.';

export class SettingsStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => string,
    private readonly defaults: Settings,
  ) {}

  get(): Settings {
    const settings: Settings = { ...this.defaults, dismissedTips: [...this.defaults.dismissedTips] };
    const rows = this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    for (const { key, value } of rows) {
      if (!(key in VALIDATORS)) continue;
      try {
        const parsed: unknown = JSON.parse(value);
        if (VALIDATORS[key as keyof Settings](parsed)) (settings as unknown as Record<string, unknown>)[key] = parsed;
      } catch {
        // Ignore a malformed value; the default applies.
      }
    }
    return settings;
  }

  update(patch: Record<string, unknown>): Settings {
    const entries = Object.entries(patch);
    for (const [key, value] of entries) {
      const validate = VALIDATORS[key as keyof Settings];
      if (!validate) throw new ValidationError(`Unknown setting "${key}".`);
      if (!validate(value)) throw new UserFacingError('invalid-setting', `That value isn't valid for "${key}".`);
    }
    this.db.transaction(() => {
      for (const [key, value] of entries) this.write(key, value);
    });
    return this.get();
  }

  private write(key: string, value: unknown): void {
    this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), this.now()],
    );
  }

  getInternal<T>(key: string): T | undefined {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [INTERNAL_PREFIX + key]);
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }

  setInternal(key: string, value: unknown): void {
    this.write(INTERNAL_PREFIX + key, value);
  }
}
