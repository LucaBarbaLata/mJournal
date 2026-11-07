/**
 * Letters to a future day ("time capsules"). A letter can be written and changed
 * on the day it was started; after that it stays sealed — its text isn't even
 * sent to the interface — until its day comes. A sealed letter can still be
 * deleted without reading it. Dates come from the main process's own clock, so
 * the interface can't open a letter early.
 */
import type { CapsuleInfo } from '@core/api';
import { addDays, firstDayOfMonth, lastDayOfMonth, todayKey, type DateKey, type MonthKey } from '@core/dates';
import { UserFacingError } from '@core/validation';
import type { Db } from './database';
import type { WritingIndex } from './writingIndex';

/** How far ahead a letter can go. */
export const MAX_CAPSULE_YEARS = 50;
export const MAX_CAPSULES = 1000;

interface CapsuleRow {
  id: number;
  open_on: string;
  written_on: string;
  body: string;
  opened_at: string | null;
}

export class CapsuleStore {
  constructor(
    private readonly db: Db,
    private readonly clock: () => Date,
    private readonly writing: WritingIndex,
  ) {}

  private today(): DateKey {
    return todayKey(this.clock());
  }

  private info(row: CapsuleRow, today = this.today()): CapsuleInfo {
    const editable = row.written_on === today && row.open_on > today;
    const sealed = row.open_on > today && !editable;
    return {
      id: row.id,
      openOn: row.open_on,
      writtenOn: row.written_on,
      sealed,
      editable,
      body: sealed ? null : row.body,
      openedAt: row.opened_at,
    };
  }

  private row(id: number): CapsuleRow {
    const row = this.db.get<CapsuleRow>('SELECT * FROM capsules WHERE id = ?', [id]);
    if (!row) throw new UserFacingError('unknown-letter', 'That letter could not be found.');
    return row;
  }

  /** Letters started on an earlier day but never written aren't kept. */
  private tidy(today: DateKey): void {
    this.db.run("DELETE FROM capsules WHERE body = '' AND written_on < ?", [today]);
  }

  list(): CapsuleInfo[] {
    const today = this.today();
    this.tidy(today);
    return this.db.all<CapsuleRow>('SELECT * FROM capsules ORDER BY open_on, id').map((row) => this.info(row, today));
  }

  forDay(date: DateKey): CapsuleInfo[] {
    const today = this.today();
    this.tidy(today);
    return this.db.all<CapsuleRow>('SELECT * FROM capsules WHERE open_on = ? ORDER BY id', [date]).map((row) => this.info(row, today));
  }

  datesInMonth(month: MonthKey): DateKey[] {
    return this.db
      .all<{ open_on: string }>(
        "SELECT DISTINCT open_on FROM capsules WHERE open_on BETWEEN ? AND ? AND (body <> '' OR written_on = ?) ORDER BY open_on",
        [firstDayOfMonth(month), lastDayOfMonth(month), this.today()],
      )
      .map((r) => r.open_on);
  }

  create(openOn: DateKey): CapsuleInfo {
    const today = this.today();
    if (openOn <= today) throw new UserFacingError('not-in-future', 'A letter to the future needs a day that hasn’t come yet.');
    if (openOn > addDays(today, MAX_CAPSULE_YEARS * 366)) {
      throw new UserFacingError('too-far', `A letter can go up to ${MAX_CAPSULE_YEARS} years ahead.`);
    }
    const count = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM capsules')!.n;
    if (count >= MAX_CAPSULES) throw new UserFacingError('too-many-letters', `You can keep up to ${MAX_CAPSULES} letters.`);
    const now = this.clock().toISOString();
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO capsules (open_on, written_on, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [openOn, today, '', now, now],
    );
    return this.info(this.row(lastInsertRowid), today);
  }

  save(id: number, body: string): CapsuleInfo {
    const row = this.row(id);
    const today = this.today();
    if (row.written_on !== today || row.open_on <= today) {
      throw new UserFacingError('sealed', 'This letter is sealed now. It opens on its day.');
    }
    this.db.run('UPDATE capsules SET body = ?, updated_at = ? WHERE id = ?', [body, this.clock().toISOString(), id]);
    return this.info(this.row(id), today);
  }

  remove(id: number): void {
    this.row(id);
    this.db.transaction(() => {
      this.db.run('DELETE FROM capsules WHERE id = ?', [id]);
      this.writing.removeCapsule(id);
    });
  }

  /** Called when an opened letter is shown: remembers that it was read and makes it searchable. */
  markOpened(id: number): CapsuleInfo {
    const row = this.row(id);
    const today = this.today();
    if (row.open_on > today) throw new UserFacingError('sealed', 'This letter opens on its day.');
    this.db.transaction(() => {
      if (!row.opened_at) this.db.run('UPDATE capsules SET opened_at = ? WHERE id = ?', [this.clock().toISOString(), id]);
      this.writing.indexCapsule(id, today);
    });
    return this.info(this.row(id), today);
  }
}
