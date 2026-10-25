/** The user's mood vocabulary. Moods are never deleted, only hidden, so old entries keep their meaning. */
import type { MoodInput, MoodPatch, MoodRecord } from '@core/api';
import { DEFAULT_MOODS, MAX_MOODS, type MoodColor, type MoodIcon } from '@core/moods';
import { UserFacingError } from '@core/validation';
import { randomBytes } from 'node:crypto';
import type { Db } from './database';

interface MoodRow {
  key: string;
  label: string;
  icon: string;
  color: string;
  position: number;
  hidden: number;
  built_in: number;
}

function toMoodRecord(row: MoodRow): MoodRecord {
  return {
    key: row.key,
    label: row.label,
    icon: row.icon as MoodIcon,
    color: row.color as MoodColor,
    position: row.position,
    hidden: row.hidden === 1,
    builtIn: row.built_in === 1,
  };
}

export class MoodStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => string,
  ) {}

  list(): MoodRecord[] {
    return this.db.all<MoodRow>('SELECT * FROM moods ORDER BY position, key').map(toMoodRecord);
  }

  exists(key: string): boolean {
    return this.db.get('SELECT 1 AS found FROM moods WHERE key = ?', [key]) !== undefined;
  }

  private get(key: string): MoodRecord {
    const row = this.db.get<MoodRow>('SELECT * FROM moods WHERE key = ?', [key]);
    if (!row) throw new UserFacingError('unknown-mood', 'That mood could not be found.');
    return toMoodRecord(row);
  }

  private assertUniqueLabel(label: string, exceptKey?: string): void {
    const clash = this.list().find(
      (m) => m.key !== exceptKey && m.label.trim().toLowerCase() === label.trim().toLowerCase(),
    );
    if (clash) throw new UserFacingError('duplicate-mood', `You already have a mood called "${clash.label}".`);
  }

  create(input: MoodInput): MoodRecord {
    if (this.list().length >= MAX_MOODS) {
      throw new UserFacingError('too-many-moods', `You can have up to ${MAX_MOODS} moods.`);
    }
    this.assertUniqueLabel(input.label);
    const key = `custom-${randomBytes(4).toString('hex')}`;
    const now = this.now();
    const position = this.db.get<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM moods')!.p;
    this.db.run(
      `INSERT INTO moods (key, label, icon, color, position, built_in, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [key, input.label, input.icon, input.color, position, now, now],
    );
    return this.get(key);
  }

  update(key: string, patch: MoodPatch): MoodRecord {
    const current = this.get(key);
    if (patch.label !== undefined) this.assertUniqueLabel(patch.label, key);
    if (patch.hidden === true && this.list().filter((m) => !m.hidden && m.key !== key).length === 0) {
      throw new UserFacingError('last-mood', 'Keep at least one mood visible.');
    }
    this.db.run('UPDATE moods SET label = ?, icon = ?, color = ?, hidden = ?, updated_at = ? WHERE key = ?', [
      patch.label ?? current.label,
      patch.icon ?? current.icon,
      patch.color ?? current.color,
      (patch.hidden ?? current.hidden) ? 1 : 0,
      this.now(),
      key,
    ]);
    return this.get(key);
  }

  reorder(keys: string[]): MoodRecord[] {
    const existing = this.list().map((m) => m.key);
    const unique = new Set(keys);
    if (unique.size !== keys.length || keys.length !== existing.length || !existing.every((k) => unique.has(k))) {
      throw new UserFacingError('invalid-order', 'Could not reorder the moods. Please try again.');
    }
    this.db.transaction(() => {
      keys.forEach((key, position) => this.db.run('UPDATE moods SET position = ? WHERE key = ?', [position, key]));
    });
    return this.list();
  }

  /** Restores the original moods and their order. Custom moods are kept after them. */
  resetDefaults(): MoodRecord[] {
    const now = this.now();
    this.db.transaction(() => {
      DEFAULT_MOODS.forEach((mood, position) => {
        this.db.run(
          `INSERT INTO moods (key, label, icon, color, position, hidden, built_in, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)
           ON CONFLICT (key) DO UPDATE SET label = excluded.label, icon = excluded.icon, color = excluded.color,
             position = excluded.position, hidden = 0, updated_at = excluded.updated_at`,
          [mood.key, mood.label, mood.icon, mood.color, position, now, now],
        );
      });
      const customs = this.db.all<{ key: string }>('SELECT key FROM moods WHERE built_in = 0 ORDER BY position, key');
      customs.forEach(({ key }, i) =>
        this.db.run('UPDATE moods SET position = ? WHERE key = ?', [DEFAULT_MOODS.length + i, key]),
      );
    });
    return this.list();
  }
}
