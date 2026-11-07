/**
 * Photos attached to days.
 *
 * Removing a photo only marks it as removed ("Recently removed" in Settings);
 * the file stays on disk until the user deletes it permanently, and even then
 * it is kept while any other photo still uses the same file.
 */
import type { GalleryPage, ImportResult, JournalMonthCount, PhotoRecord } from '@core/api';
import type { DateKey } from '@core/dates';
import { GALLERY_PAGE_SIZE, MAX_GALLERY_LIMIT, MAX_IMPORT_BATCH, MAX_PHOTOS_PER_DAY } from '@core/photos';
import { makeExcerpt } from '@core/text';
import { UserFacingError } from '@core/validation';
import { randomUUID } from 'node:crypto';
import { PhotoRejection, type PhotoFiles } from '../services/photoFiles';
import type { Db } from './database';
import type { EntriesStore } from './entries';

interface PhotoRow {
  id: string;
  entry_date: string;
  file: string;
  sha256: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  original_name: string;
  caption: string;
  favorite: number;
  position: number;
  has_thumbnail: number;
  created_at: string;
  removed_at: string | null;
}

export type PhotoSource = { name: string; path: string } | { name: string; data: Uint8Array };

export { MAX_IMPORT_BATCH, MAX_PHOTOS_PER_DAY };
export const MAX_CAPTION_LENGTH = 500;
export const MEDIA_SCHEME = 'mj-media';

export class PhotoStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => string,
    readonly files: PhotoFiles,
    private readonly entries: EntriesStore,
  ) {}

  private toRecord(row: PhotoRow): PhotoRecord {
    return {
      id: row.id,
      date: row.entry_date,
      caption: row.caption,
      originalName: row.original_name,
      mime: row.mime,
      bytes: row.bytes,
      width: row.width,
      height: row.height,
      favorite: row.favorite === 1,
      position: row.position,
      createdAt: row.created_at,
      removedAt: row.removed_at,
      hasThumbnail: row.has_thumbnail === 1,
      missing: !this.files.exists(row.file),
      url: `${MEDIA_SCHEME}://photo/${row.id}`,
      thumbUrl: `${MEDIA_SCHEME}://thumb/${row.id}`,
    };
  }

  private row(id: string): PhotoRow {
    const row = this.db.get<PhotoRow>('SELECT * FROM photos WHERE id = ?', [id]);
    if (!row) throw new UserFacingError('unknown-photo', 'That photo could not be found.');
    return row;
  }

  get(id: string): PhotoRecord {
    return this.toRecord(this.row(id));
  }

  forDay(date: DateKey): PhotoRecord[] {
    return this.db
      .all<PhotoRow>('SELECT * FROM photos WHERE entry_date = ? AND removed_at IS NULL ORDER BY position, created_at', [
        date,
      ])
      .map((row) => this.toRecord(row));
  }

  inRange(from: DateKey, to: DateKey): PhotoRecord[] {
    return this.db
      .all<PhotoRow>(
        `SELECT * FROM photos WHERE removed_at IS NULL AND entry_date BETWEEN ? AND ?
         ORDER BY entry_date, position, created_at`,
        [from, to],
      )
      .map((row) => this.toRecord(row));
  }

  async importSources(date: DateKey, sources: PhotoSource[]): Promise<ImportResult> {
    const result: ImportResult = { imported: [], rejected: [] };
    if (sources.length > MAX_IMPORT_BATCH) {
      throw new UserFacingError('too-many-photos', `Please add up to ${MAX_IMPORT_BATCH} photos at a time.`);
    }
    for (const source of sources) {
      const name = source.name.slice(0, 255);
      try {
        const count = this.db.get<{ n: number }>(
          'SELECT COUNT(*) AS n FROM photos WHERE entry_date = ? AND removed_at IS NULL',
          [date],
        )!.n;
        if (count >= MAX_PHOTOS_PER_DAY) {
          throw new PhotoRejection(`A day can hold up to ${MAX_PHOTOS_PER_DAY} photos.`);
        }
        const data = 'path' in source ? await this.files.readSource(source.path) : source.data;
        const stored = await this.files.store(data);
        const id = randomUUID();
        this.db.transaction(() => {
          this.entries.ensure(date);
          const position = this.db.get<{ p: number }>(
            'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM photos WHERE entry_date = ?',
            [date],
          )!.p;
          const existingThumb = this.db.get<{ has_thumbnail: number; width: number | null; height: number | null }>(
            'SELECT has_thumbnail, width, height FROM photos WHERE sha256 = ? ORDER BY has_thumbnail DESC LIMIT 1',
            [stored.sha256],
          );
          const now = this.now();
          this.db.run(
            `INSERT INTO photos (id, entry_date, file, sha256, mime, bytes, width, height, original_name, position,
               has_thumbnail, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              date,
              stored.file,
              stored.sha256,
              stored.mime,
              stored.bytes,
              existingThumb?.width ?? null,
              existingThumb?.height ?? null,
              name,
              position,
              existingThumb?.has_thumbnail ?? 0,
              now,
            ],
          );
          this.db.run('UPDATE entries SET updated_at = ? WHERE date = ?', [now, date]);
          this.entries.refresh(date);
        });
        result.imported.push(this.get(id));
      } catch (err) {
        const reason =
          err instanceof PhotoRejection || err instanceof UserFacingError
            ? err.message
            : "Something went wrong while adding this photo.";
        result.rejected.push({ name, reason });
      }
    }
    return result;
  }

  update(id: string, patch: { caption?: string; favorite?: boolean }): PhotoRecord {
    const row = this.row(id);
    this.db.transaction(() => {
      this.db.run('UPDATE photos SET caption = ?, favorite = ? WHERE id = ?', [
        patch.caption ?? row.caption,
        patch.favorite === undefined ? row.favorite : patch.favorite ? 1 : 0,
        id,
      ]);
      if (patch.caption !== undefined && patch.caption !== row.caption) {
        this.db.run('UPDATE entries SET updated_at = ? WHERE date = ?', [this.now(), row.entry_date]);
      }
      this.entries.refresh(row.entry_date);
    });
    return this.get(id);
  }

  reorder(date: DateKey, ids: string[]): void {
    const current = this.forDay(date).map((p) => p.id);
    const unique = new Set(ids);
    if (unique.size !== ids.length || ids.length !== current.length || !current.every((id) => unique.has(id))) {
      throw new UserFacingError('invalid-order', 'Could not reorder the photos. Please try again.');
    }
    this.db.transaction(() => {
      ids.forEach((id, position) => this.db.run('UPDATE photos SET position = ? WHERE id = ?', [position, id]));
    });
  }

  /** Moves a photo to the end of another day. Both days' counts and search text are updated. */
  moveToDay(id: string, date: DateKey): PhotoRecord {
    const row = this.row(id);
    if (row.removed_at) {
      throw new UserFacingError('photo-removed', 'This photo is in Recently removed. Restore it first, then move it.');
    }
    if (row.entry_date === date) return this.get(id);
    this.db.transaction(() => {
      const count = this.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM photos WHERE entry_date = ? AND removed_at IS NULL',
        [date],
      )!.n;
      if (count >= MAX_PHOTOS_PER_DAY) {
        throw new UserFacingError('day-full', `That day already holds ${MAX_PHOTOS_PER_DAY} photos.`);
      }
      this.entries.ensure(date);
      const position = this.db.get<{ p: number }>(
        'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM photos WHERE entry_date = ? AND removed_at IS NULL',
        [date],
      )!.p;
      const now = this.now();
      this.db.run('UPDATE photos SET entry_date = ?, position = ? WHERE id = ?', [date, position, id]);
      this.db.run('UPDATE entries SET updated_at = ? WHERE date IN (?, ?)', [now, row.entry_date, date]);
      this.entries.refresh(row.entry_date);
      this.entries.refresh(date);
    });
    return this.get(id);
  }

  /** Moves a photo to "Recently removed". The file is kept. */
  remove(id: string): void {
    const row = this.row(id);
    if (row.removed_at) return;
    this.db.transaction(() => {
      this.db.run('UPDATE photos SET removed_at = ? WHERE id = ?', [this.now(), id]);
      this.entries.refresh(row.entry_date);
    });
  }

  restore(id: string): PhotoRecord {
    const row = this.row(id);
    if (!row.removed_at) return this.get(id);
    this.db.transaction(() => {
      this.entries.ensure(row.entry_date);
      const position = this.db.get<{ p: number }>(
        'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM photos WHERE entry_date = ? AND removed_at IS NULL',
        [row.entry_date],
      )!.p;
      this.db.run('UPDATE photos SET removed_at = NULL, position = ? WHERE id = ?', [position, id]);
      this.entries.refresh(row.entry_date);
    });
    return this.get(id);
  }

  /** Permanently deletes a photo that is already in "Recently removed". */
  async deleteForever(id: string): Promise<void> {
    const row = this.row(id);
    if (!row.removed_at) {
      throw new UserFacingError('not-removed', 'Remove the photo from its day first, then delete it from Recently removed.');
    }
    const stillUsed = this.db.transaction(() => {
      this.db.run('DELETE FROM photos WHERE id = ?', [id]);
      return this.db.get('SELECT 1 AS used FROM photos WHERE sha256 = ? LIMIT 1', [row.sha256]) !== undefined;
    });
    if (!stillUsed) await this.files.deleteStored(row.file, row.sha256);
  }

  listRemoved(): PhotoRecord[] {
    return this.db
      .all<PhotoRow>('SELECT * FROM photos WHERE removed_at IS NOT NULL ORDER BY removed_at DESC')
      .map((row) => this.toRecord(row));
  }

  /** The newest photos in a date range, newest day first, at most `limit` of them. */
  gallery(filter: { from?: DateKey; to?: DateKey; limit?: number }): GalleryPage {
    const limit = Math.min(Math.max(filter.limit ?? GALLERY_PAGE_SIZE, 1), MAX_GALLERY_LIMIT);
    const rows = this.db.all<PhotoRow & { mood: string | null; body: string }>(
      `SELECT p.*, e.mood, e.body FROM photos p JOIN entries e ON e.date = p.entry_date
       WHERE p.removed_at IS NULL AND p.entry_date >= ? AND p.entry_date <= ?
       ORDER BY p.entry_date DESC, p.position, p.created_at, p.id
       LIMIT ?`,
      [filter.from ?? '0000-00-00', filter.to ?? '9999-99-99', limit + 1],
    );
    return {
      photos: rows
        .slice(0, limit)
        .map((row) => ({ ...this.toRecord(row), mood: row.mood, excerpt: makeExcerpt(row.body, 160) })),
      hasMore: rows.length > limit,
    };
  }

  galleryMonths(): JournalMonthCount[] {
    return this.db.all<JournalMonthCount>(
      `SELECT substr(entry_date, 1, 7) AS month, COUNT(*) AS count FROM photos
       WHERE removed_at IS NULL GROUP BY month ORDER BY month DESC`,
    );
  }

  /**
   * Forgets every thumbnail, so each is made again. A restore starts with an empty thumbnails folder
   * while the restored database still says which photos had one.
   */
  forgetThumbnails(): void {
    this.db.run('UPDATE photos SET has_thumbnail = 0 WHERE has_thumbnail = 1');
  }

  async saveThumbnail(id: string, data: Uint8Array, width: number, height: number): Promise<void> {
    const row = this.row(id);
    await this.files.writeThumbnail(row.sha256, data);
    this.db.run(
      'UPDATE photos SET has_thumbnail = 1, width = COALESCE(width, ?), height = COALESCE(height, ?) WHERE sha256 = ?',
      [width, height, row.sha256],
    );
  }

  /** Path of the original or thumbnail for the media protocol, or null if unknown. */
  mediaPath(kind: 'photo' | 'thumb', id: string): string | null {
    const row = this.db.get<{ file: string; sha256: string }>('SELECT file, sha256 FROM photos WHERE id = ?', [id]);
    if (!row) return null;
    return kind === 'photo' ? this.files.absolute(row.file) : this.files.thumbnailPath(row.sha256);
  }

  /** Every distinct stored file still referenced by a photo row (for backups). */
  referencedFiles(): { file: string; sha256: string }[] {
    return this.db.all<{ file: string; sha256: string }>('SELECT DISTINCT file, sha256 FROM photos ORDER BY file');
  }

  stats(): { active: number; removed: number; missing: number; bytes: number } {
    const rows = this.db.all<{ file: string; removed_at: string | null }>('SELECT file, removed_at FROM photos');
    const files = new Set<string>();
    let missing = 0;
    for (const row of rows) {
      if (!this.files.exists(row.file)) missing++;
      files.add(row.file);
    }
    let bytes = 0;
    for (const file of files) bytes += this.files.sizeOf(file);
    return {
      active: rows.filter((r) => !r.removed_at).length,
      removed: rows.filter((r) => r.removed_at).length,
      missing,
      bytes,
    };
  }
}
