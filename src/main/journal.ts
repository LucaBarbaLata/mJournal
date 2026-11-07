/**
 * One open journal: the database plus its photo library. This class knows
 * nothing about Electron, so tests can open a journal in a temporary folder.
 */
import { mkdirSync } from 'node:fs';
import { todayKey } from '@core/dates';
import { CapsuleStore } from './store/capsules';
import { Db } from './store/database';
import { EntriesStore } from './store/entries';
import { migrate, type MigrationOutcome } from './store/migrations';
import { MoodStore } from './store/moods';
import { PhotoStore } from './store/photos';
import { PromptStore } from './store/prompts';
import { ReflectionStore } from './store/reflections';
import { RemovedDaysStore } from './store/removedDays';
import { SearchStore } from './store/search';
import { defaultSettings, SettingsStore } from './store/settings';
import { StatsStore } from './store/stats';
import { TagStore } from './store/tags';
import { WritingIndex } from './store/writingIndex';
import { YearStore } from './store/years';
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
  readonly tags: TagStore;
  readonly removedDays: RemovedDaysStore;
  readonly capsules: CapsuleStore;
  readonly writing: WritingIndex;
  readonly years: YearStore;
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
    this.writing = new WritingIndex(db);
    this.reflections = new ReflectionStore(db, now, this.entries, this.photos, this.writing);
    this.tags = new TagStore(db, now, this.entries);
    this.removedDays = new RemovedDaysStore(db, now, this.entries, this.photos, this.tags);
    this.capsules = new CapsuleStore(db, clock, this.writing);
    this.years = new YearStore(db, now, this.entries, this.photos, this.writing);
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
      if (migration.from > 0 && migration.from !== migration.to) journal.refreshDerived();
      // Letters whose day came while mJournal was closed become searchable.
      else journal.writing.indexOpenedCapsules(todayKey(clock()));
      return journal;
    } catch (err) {
      db.close();
      throw err;
    }
  }

  /** Recalculates everything derived from the data: day counters, #tags, both search indexes. */
  refreshDerived(): void {
    this.entries.refreshAll();
    this.writing.reindexAll(todayKey(this.clock()));
  }

  close(): void {
    this.db.close();
  }
}
