/**
 * Reflection prompts: the featured question of each day, favorites, hidden
 * prompts and the user's own custom prompts.
 */
import type { FeaturedPrompt, PromptInfo } from '@core/api';
import { addDays, type DateKey } from '@core/dates';
import { RECENT_WINDOW_DAYS, selectFeaturedPrompt } from '@core/promptSelection';
import {
  BUILT_IN_PROMPTS,
  RETIRED_PROMPT_IDS,
  customPromptId,
  findBuiltInPrompt,
  parseCustomPromptId,
  type PromptCategory,
} from '@core/prompts';
import { UserFacingError } from '@core/validation';
import type { Db } from './database';

interface DailyPromptRow {
  date: string;
  prompt_id: string;
  prompt_text: string;
  shuffles: number;
  skipped: number;
}

interface CustomPromptRow {
  id: number;
  text: string;
  in_rotation: number;
  archived: number;
}

interface PrefRow {
  prompt_id: string;
  favorite: number;
  hidden: number;
}

export const MAX_CUSTOM_PROMPTS = 500;

export class PromptStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => string,
  ) {}

  private prefs(): Map<string, PrefRow> {
    return new Map(this.db.all<PrefRow>('SELECT * FROM prompt_prefs').map((row) => [row.prompt_id, row]));
  }

  private customRows(includeArchived = false): CustomPromptRow[] {
    return this.db.all<CustomPromptRow>(
      `SELECT id, text, in_rotation, archived FROM custom_prompts ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY id`,
    );
  }

  /** Text and category of any prompt id, including archived custom prompts. */
  resolve(id: string): { text: string; category: PromptCategory } | null {
    const builtIn = findBuiltInPrompt(id);
    if (builtIn) return { text: builtIn.text, category: builtIn.category };
    const rowId = parseCustomPromptId(id);
    if (rowId === null) return null;
    const row = this.db.get<{ text: string }>('SELECT text FROM custom_prompts WHERE id = ?', [rowId]);
    return row ? { text: row.text, category: 'custom' } : null;
  }

  library(): PromptInfo[] {
    const prefs = this.prefs();
    const retired = new Set(RETIRED_PROMPT_IDS);
    const builtIns: PromptInfo[] = BUILT_IN_PROMPTS.filter((p) => !retired.has(p.id)).map((p) => ({
      id: p.id,
      text: p.text,
      category: p.category,
      favorite: prefs.get(p.id)?.favorite === 1,
      hidden: prefs.get(p.id)?.hidden === 1,
      custom: false,
      inRotation: true,
    }));
    const customs: PromptInfo[] = this.customRows().map((row) => {
      const id = customPromptId(row.id);
      return {
        id,
        text: row.text,
        category: 'custom' as const,
        favorite: prefs.get(id)?.favorite === 1,
        hidden: prefs.get(id)?.hidden === 1,
        custom: true,
        inRotation: row.in_rotation === 1,
      };
    });
    return [...customs, ...builtIns];
  }

  /** Prompt ids that may appear as the featured question. */
  rotationPool(): string[] {
    return this.library()
      .filter((p) => !p.hidden && p.inRotation)
      .map((p) => p.id);
  }

  private recentlyShown(date: DateKey): Set<string> {
    const rows = this.db.all<{ prompt_id: string }>(
      'SELECT prompt_id FROM daily_prompts WHERE date BETWEEN ? AND ? AND date <> ?',
      [addDays(date, -RECENT_WINDOW_DAYS), addDays(date, RECENT_WINDOW_DAYS), date],
    );
    return new Set(rows.map((r) => r.prompt_id));
  }

  private toFeatured(row: DailyPromptRow): FeaturedPrompt {
    const resolved = this.resolve(row.prompt_id);
    const pref = this.db.get<PrefRow>('SELECT * FROM prompt_prefs WHERE prompt_id = ?', [row.prompt_id]);
    return {
      date: row.date,
      promptId: row.prompt_id,
      // The saved wording is shown even if the prompt was later edited or retired.
      text: row.prompt_text,
      category: resolved?.category ?? 'custom',
      favorite: pref?.favorite === 1,
      skipped: row.skipped === 1,
      shuffles: row.shuffles,
    };
  }

  /** The day's featured question, chosen and saved on first request. */
  featured(date: DateKey): FeaturedPrompt | null {
    const existing = this.db.get<DailyPromptRow>('SELECT * FROM daily_prompts WHERE date = ?', [date]);
    if (existing) return this.toFeatured(existing);
    const id = selectFeaturedPrompt({ date, pool: this.rotationPool(), recentlyShown: this.recentlyShown(date) });
    if (!id) return null;
    const resolved = this.resolve(id)!;
    this.db.run(
      'INSERT INTO daily_prompts (date, prompt_id, prompt_text, assigned_at) VALUES (?, ?, ?, ?)',
      [date, id, resolved.text, this.now()],
    );
    return this.featured(date);
  }

  /** Replaces the day's question with another one ("Another question"). */
  shuffle(date: DateKey): FeaturedPrompt | null {
    return this.db.transaction(() => {
      const current = this.featured(date);
      if (!current) return null;
      const salt = current.shuffles + 1;
      const id = selectFeaturedPrompt({
        date,
        pool: this.rotationPool(),
        recentlyShown: this.recentlyShown(date),
        exclude: new Set([current.promptId]),
        salt,
      });
      if (!id) return current;
      this.db.run(
        'UPDATE daily_prompts SET prompt_id = ?, prompt_text = ?, shuffles = ?, skipped = 0, assigned_at = ? WHERE date = ?',
        [id, this.resolve(id)!.text, salt, this.now(), date],
      );
      return this.featured(date);
    });
  }

  setSkipped(date: DateKey, skipped: boolean): FeaturedPrompt | null {
    const current = this.featured(date);
    if (!current) return null;
    this.db.run('UPDATE daily_prompts SET skipped = ? WHERE date = ?', [skipped ? 1 : 0, date]);
    return this.featured(date);
  }

  private assertKnown(id: string): void {
    if (!this.resolve(id)) throw new UserFacingError('unknown-prompt', 'That prompt could not be found.');
  }

  private setPref(id: string, column: 'favorite' | 'hidden', value: boolean): void {
    this.assertKnown(id);
    this.db.run(
      `INSERT INTO prompt_prefs (prompt_id, ${column}, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (prompt_id) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at`,
      [id, value ? 1 : 0, this.now()],
    );
  }

  setFavorite(id: string, favorite: boolean): void {
    this.setPref(id, 'favorite', favorite);
  }

  setHidden(id: string, hidden: boolean): void {
    this.setPref(id, 'hidden', hidden);
  }

  private customInfo(rowId: number): PromptInfo {
    const info = this.library().find((p) => p.id === customPromptId(rowId));
    if (!info) throw new UserFacingError('unknown-prompt', 'That prompt could not be found.');
    return info;
  }

  createCustom(text: string): PromptInfo {
    const count = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM custom_prompts WHERE archived = 0')!.n;
    if (count >= MAX_CUSTOM_PROMPTS) {
      throw new UserFacingError('too-many-prompts', `You can keep up to ${MAX_CUSTOM_PROMPTS} custom prompts.`);
    }
    const now = this.now();
    const { lastInsertRowid } = this.db.run('INSERT INTO custom_prompts (text, created_at, updated_at) VALUES (?, ?, ?)', [
      text,
      now,
      now,
    ]);
    return this.customInfo(lastInsertRowid);
  }

  updateCustom(id: string, patch: { text?: string; inRotation?: boolean }): PromptInfo {
    const rowId = parseCustomPromptId(id);
    const row = rowId === null ? undefined : this.db.get<CustomPromptRow>('SELECT * FROM custom_prompts WHERE id = ? AND archived = 0', [rowId]);
    if (!row || rowId === null) throw new UserFacingError('unknown-prompt', 'That prompt could not be found.');
    this.db.run('UPDATE custom_prompts SET text = ?, in_rotation = ?, updated_at = ? WHERE id = ?', [
      patch.text ?? row.text,
      patch.inRotation === undefined ? row.in_rotation : patch.inRotation ? 1 : 0,
      this.now(),
      rowId,
    ]);
    return this.customInfo(rowId);
  }

  /** Hides a custom prompt for good. Its text stays readable on answers that used it. */
  archiveCustom(id: string): void {
    const rowId = parseCustomPromptId(id);
    if (rowId === null) throw new UserFacingError('unknown-prompt', 'That prompt could not be found.');
    this.db.run('UPDATE custom_prompts SET archived = 1, updated_at = ? WHERE id = ?', [this.now(), rowId]);
  }
}
