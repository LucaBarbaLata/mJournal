/**
 * One open journal: the database plus its photo library. This class knows
 * nothing about Electron, so tests can open a journal in a temporary folder.
 */
import { mkdirSync } from 'node:fs';
import { Db } from './store/database';
import { EntriesStore } from './store/entries';
import { migrate, type MigrationOutcome } from './store/migrations';
import { MoodStore } from './store/moods';
import { PhotoStore } from './store/photos';
import { PromptStore } from './store/prompts';
import { ReflectionStore } from './store/reflections';
import { SearchStore } from './store/search';
import { defaultSettings, SettingsStore } from './store/settings';
import { StatsStore } from './store/stats';
import { dataPaths, type DataPaths } from './paths';
import { PhotoFiles } from './services/photoFiles';
import { UserFacingError } from '@core/validation';

export interface JournalOptions {
  /** Source of the current time (tests use a fixed clock). */
  clock?: () => Date;
  /** Two-letter region code used to pick default date settings, e.g. "US". */
  regionCode?: string;
}

export class Journal {
  readonly entries: EntriesStore;
  readonly prompts: PromptStore;
  readonly moods: MoodStore;
  readonly photos: PhotoStore;
  readonly reflections: ReflectionStore;
  readonly search: SearchStore;
  readonly stats: StatsStore;
  readonly settings: SettingsStore;

  private constructor(
    readonly paths: DataPaths,
    readonly db: Db,
    readonly clock: () => Date,
    readonly migration: MigrationOutcome,
    regionCode: string,
  ) {
    const now = () => clock().toISOString();
    this.moods = new MoodStore(db, now);
    this.entries = new EntriesStore(db, now, (key) => this.moods.exists(key));
    this.prompts = new PromptStore(db, now);
    this.photos = new PhotoStore(db, now, new PhotoFiles(paths.photos, paths.thumbnails), this.entries);
    this.reflections = new ReflectionStore(db, now, this.entries, this.photos);
    this.search = new SearchStore(db);
    this.stats = new StatsStore(db, this.entries);
    this.settings = new SettingsStore(db, now, defaultSettings(regionCode));
  }

  static open(root: string, { clock = () => new Date(), regionCode = '' }: JournalOptions = {}): Journal {
    const paths = dataPaths(root);
    for (const dir of [paths.root, paths.photos, paths.thumbnails, paths.backups]) mkdirSync(dir, { recursive: true });

    let db: Db;
    try {
      db = Db.open(paths.database);
    } catch (err) {
      throw new UserFacingError(
        'database-unreadable',
        `mJournal couldn't open its database (${(err as Error).message}). Your files have not been changed.`,
      );
    }
    try {
      const check = db.get<{ quick_check: string }>('PRAGMA quick_check')?.quick_check;
      if (check !== 'ok') {
        throw new UserFacingError(
          'database-damaged',
          'The journal database appears to be damaged. Your files have not been changed — you can restore a backup.',
        );
      }
      const migration = migrate(db, { snapshotDir: paths.snapshots, now: clock });
      const journal = new Journal(paths, db, clock, migration, regionCode);
      if (migration.from > 0 && migration.from !== migration.to) journal.entries.refreshAll();
      return journal;
    } catch (err) {
      db.close();
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}
