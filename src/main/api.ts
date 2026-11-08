/**
 * Implementation of the renderer API. Every argument arrives from the
 * renderer as `unknown` and is validated here before it reaches a store.
 * Electron-specific actions (dialogs, folders) come in through `Platform`.
 */
import { basename } from 'node:path';
import type { DesktopStatus, ImportResult, MJournalApi, SearchQuery, Settings } from '@core/api';
import type { UpdateStatus } from '@core/updates';
import { addDays, todayKey, type DateKey } from '@core/dates';
import { isMoodColor, isMoodIcon, MAX_MOOD_LABEL_LENGTH, type MoodColor, type MoodIcon } from '@core/moods';
import { MAX_GALLERY_LIMIT } from '@core/photos';
import { MAX_INTENTION_LENGTH, MAX_PROMPT_LENGTH, MONTHLY_INTENTION_KEY, MONTHLY_KEYS, YEARLY_KEYS } from '@core/prompts';
import { MAX_TAG_LENGTH } from '@core/tags';
import { MAX_TRACKER_LABEL_LENGTH, SCALE_MAX, TRACKER_KINDS } from '@core/trackers';
import { MAX_TEXT_LENGTH } from '@core/text';
import {
  expectArray,
  expectBoolean,
  expectDateKey,
  expectId,
  expectInteger,
  expectMonthKey,
  expectNonEmptyText,
  expectObject,
  expectOneOf,
  expectText,
  UserFacingError,
  ValidationError,
} from '@core/validation';
import type { JournalHost } from './host';
import type { AppLock } from './lock';
import { writeBackup } from './services/backup';
import { ENCRYPTED_BACKUP_EXTENSION, MAX_BACKUP_PASSWORD_LENGTH } from './services/backupCrypto';
import { Backups } from './services/backups';
import { buildCsv, buildJsonExport } from './services/exporter';
import { fileStamp, writeFileAtomic } from './services/fsutil';
import { MAX_PHOTO_BYTES, MAX_THUMBNAIL_BYTES } from './services/photoFiles';
import { listSnapshots } from './services/snapshots';
import { MAX_CAPTION_LENGTH, MAX_IMPORT_BATCH } from './store/photos';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Platform {
  appVersion: string;
  platformName: string;
  notificationsSupported: boolean;
  /** See AppInfo.portableApp and AppInfo.journalBesideApp. */
  portableApp: boolean;
  journalBesideApp: boolean;
  chooseImages(): Promise<string[]>;
  chooseBackupFile(): Promise<string | null>;
  /** A folder picker (for automatic backups). */
  chooseFolder(title: string): Promise<string | null>;
  chooseSaveLocation(defaultName: string, filter: { name: string; extensions: string[] }): Promise<string | null>;
  showItemInFolder(path: string): void;
  openFolder(path: string): Promise<void>;
  settingsChanged(settings: Settings): void;
  /** The tray, opening at sign-in and the quick-note shortcut. */
  desktopStatus(): DesktopStatus;
  /** The update check (services/updates.ts). */
  updates: { status(): UpdateStatus; check(): Promise<UpdateStatus>; install(): Promise<UpdateStatus>; dismissResult(): UpdateStatus };
  openReleasePage(): Promise<void>;
}

/** Same shape as MJournalApi, but every handler takes unvalidated arguments. */
export type ApiHandlers = {
  [N in keyof MJournalApi]: {
    [M in keyof MJournalApi[N]]: MJournalApi[N][M] extends (...args: never[]) => infer R ? (...args: unknown[]) => R : never;
  };
};

const PROMPT_ID_RE = /^[a-z0-9-]{1,40}$/;
const TOKEN_RE = /^[0-9a-f]{32}$/;

function expectPromptId(value: unknown): string {
  if (typeof value !== 'string' || !PROMPT_ID_RE.test(value)) throw new ValidationError('Invalid prompt.');
  return value;
}

function expectToken(value: unknown): string {
  if (typeof value !== 'string' || !TOKEN_RE.test(value)) throw new ValidationError('Invalid restore request.');
  return value;
}

/** Passwords are passed on exactly as typed (no clean-up), so the key never depends on how text was tidied. */
function expectPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_BACKUP_PASSWORD_LENGTH) {
    throw new ValidationError('Invalid password.');
  }
  return value;
}

const SNAPSHOT_NAME_RE = /^mJournal-[A-Za-z0-9._-]{1,160}\.db$/;

function expectSnapshotName(value: unknown): string {
  if (typeof value !== 'string' || !SNAPSHOT_NAME_RE.test(value)) throw new ValidationError('Invalid snapshot.');
  return value;
}

/** A tag's key or label as typed (the store checks the characters). */
function expectTagText(value: unknown): string {
  return expectNonEmptyText(value, 'a tag', MAX_TAG_LENGTH * 2);
}

const recordId = (value: unknown, what: string) => expectInteger(value, 1, Number.MAX_SAFE_INTEGER, what);

function expectBytes(value: unknown, max: number, what: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new ValidationError(`Invalid ${what}.`);
  if (value.byteLength > max) throw new ValidationError(`The ${what} is too large.`);
  return value;
}

function optionalDate(value: unknown, what: string): DateKey | undefined {
  return value === undefined || value === null || value === '' ? undefined : expectDateKey(value, what);
}

export function parseSearchQuery(input: unknown): SearchQuery {
  const o = expectObject(input, 'search');
  return {
    text: o.text === undefined ? undefined : expectText(o.text, 'search text', 500),
    from: optionalDate(o.from, 'start date'),
    to: optionalDate(o.to, 'end date'),
    moods: o.moods === undefined ? undefined : expectArray(o.moods, 50, 'moods').map((m) => expectId(m, 'mood')),
    withPhotos: o.withPhotos === undefined ? undefined : expectBoolean(o.withPhotos),
    favoritesOnly: o.favoritesOnly === undefined ? undefined : expectBoolean(o.favoritesOnly),
    tags: o.tags === undefined ? undefined : expectArray(o.tags, 50, 'tags').map((t) => expectTagText(t)),
    order: o.order === undefined ? undefined : expectOneOf(o.order, ['newest', 'oldest'] as const, 'order'),
    cursor: o.cursor === undefined || o.cursor === null ? null : expectDateKey(o.cursor, 'cursor'),
    limit: o.limit === undefined ? undefined : expectInteger(o.limit, 1, 100, 'limit'),
  };
}

/** All that can be called while mJournal is locked: nothing that reads or changes the journal. */
export const OPEN_WHILE_LOCKED: ReadonlySet<string> = new Set(['lock.status', 'lock.unlock', 'lock.lock']);

type HandlerTable = Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;

/** Wraps every handler not in OPEN_WHILE_LOCKED so it refuses to run while mJournal is locked. */
function guardWhileLocked(handlers: ApiHandlers, appLock: AppLock): ApiHandlers {
  const guarded: HandlerTable = {};
  for (const [namespace, methods] of Object.entries(handlers as unknown as HandlerTable)) {
    guarded[namespace] = {};
    for (const [method, handler] of Object.entries(methods)) {
      guarded[namespace][method] = OPEN_WHILE_LOCKED.has(`${namespace}.${method}`)
        ? handler
        : async (...args: unknown[]) => {
            if (appLock.isLocked()) throw new UserFacingError('locked', 'mJournal is locked.');
            return handler(...args);
          };
    }
  }
  return guarded as unknown as ApiHandlers;
}

const MAX_PIN_INPUT = 64;

export function createApi(
  host: JournalHost,
  platform: Platform,
  appLock: AppLock,
  backups: Backups = new Backups(() => host.journal, platform.appVersion),
): ApiHandlers {
  const j = () => host.journal;

  /** Days up to tomorrow can be written (a little slack for clock and time-zone changes). */
  const writableDate = (value: unknown): DateKey => {
    const date = expectDateKey(value);
    if (date > addDays(todayKey(j().clock()), 1)) throw new ValidationError("This day hasn't happened yet.");
    return date;
  };

  // Files saved this session; only these may be revealed in the file manager.
  const savedFiles = new Set<string>();

  const exportTo = async (defaultName: string, filter: { name: string; extensions: string[] }, content: () => string) => {
    const target = await platform.chooseSaveLocation(defaultName, filter);
    if (!target) return { canceled: true };
    const text = content();
    await writeFileAtomic(target, text);
    savedFiles.add(target);
    return { canceled: false, path: target, bytes: Buffer.byteLength(text) };
  };

  const handlers: ApiHandlers = {
    app: {
      info: async () => ({
        name: 'mJournal' as const,
        version: platform.appVersion,
        platform: platform.platformName,
        dataDir: host.root,
        notificationsSupported: platform.notificationsSupported,
        portableApp: platform.portableApp,
        journalBesideApp: platform.journalBesideApp,
      }),
      desktopStatus: async () => platform.desktopStatus(),
    },

    entries: {
      getDay: async (date) => {
        const d = expectDateKey(date);
        return {
          date: d,
          entry: j().entries.get(d),
          answers: j().entries.answers(d),
          photos: j().photos.forDay(d),
          tags: j().entries.tags(d),
          trackers: j().trackers.forDay(d),
        };
      },
      update: async (date, patch) => {
        const d = writableDate(date);
        const o = expectObject(patch, 'changes');
        return j().entries.update(d, {
          body: o.body === undefined ? undefined : expectText(o.body, 'entry'),
          mood: o.mood === undefined ? undefined : o.mood === null ? null : expectId(o.mood, 'mood'),
          moodNote: o.moodNote === undefined ? undefined : expectText(o.moodNote, 'mood note', 2000),
          energy: o.energy === undefined ? undefined : o.energy === null ? null : expectInteger(o.energy, 1, 5, 'energy'),
          favorite: o.favorite === undefined ? undefined : expectBoolean(o.favorite),
        });
      },
      remove: async (date) => ({ removedId: j().removedDays.remove(expectDateKey(date)) }),
      listRemoved: async () => j().removedDays.list(),
      restoreRemoved: async (id) => j().removedDays.restore(recordId(id, 'removed day')),
      deleteRemoved: async (id) => j().removedDays.deleteForever(recordId(id, 'removed day')),
      appendToBody: async (date, text) => j().entries.appendToBody(writableDate(date), expectNonEmptyText(text, 'a note', 20_000)),
      setTag: async (date, label, picked) => {
        const d = writableDate(date);
        j().tags.setForDay(d, expectTagText(label), expectBoolean(picked));
        return j().entries.tags(d);
      },
      saveAnswer: async (date, input) => {
        const o = expectObject(input, 'answer');
        return j().entries.saveAnswer(writableDate(date), {
          promptId: expectPromptId(o.promptId),
          promptText: expectNonEmptyText(o.promptText, 'a question', MAX_PROMPT_LENGTH * 2),
          answer: expectText(o.answer, 'answer', MAX_TEXT_LENGTH),
        });
      },
      removeAnswer: async (date, promptId) => j().entries.removeAnswer(expectDateKey(date), expectPromptId(promptId)),
      setAnswerFavorite: async (date, promptId, favorite) =>
        j().entries.setAnswerFavorite(expectDateKey(date), expectPromptId(promptId), expectBoolean(favorite)),
      month: async (month) => j().entries.monthSummaries(expectMonthKey(month)),
      onThisDay: async (date) => j().entries.onThisDay(expectDateKey(date)),
    },

    prompts: {
      featured: async (date) => j().prompts.featured(expectDateKey(date)),
      shuffle: async (date) => j().prompts.shuffle(expectDateKey(date)),
      setSkipped: async (date, skipped) => j().prompts.setSkipped(expectDateKey(date), expectBoolean(skipped)),
      library: async () => j().prompts.library(),
      setFavorite: async (id, favorite) => j().prompts.setFavorite(expectPromptId(id), expectBoolean(favorite)),
      setHidden: async (id, hidden) => j().prompts.setHidden(expectPromptId(id), expectBoolean(hidden)),
      createCustom: async (text) => j().prompts.createCustom(expectNonEmptyText(text, 'a question', MAX_PROMPT_LENGTH)),
      updateCustom: async (id, patch) => {
        const o = expectObject(patch, 'changes');
        return j().prompts.updateCustom(expectPromptId(id), {
          text: o.text === undefined ? undefined : expectNonEmptyText(o.text, 'a question', MAX_PROMPT_LENGTH),
          inRotation: o.inRotation === undefined ? undefined : expectBoolean(o.inRotation),
        });
      },
      archiveCustom: async (id) => j().prompts.archiveCustom(expectPromptId(id)),
      pinned: async () => j().prompts.pinned(),
      setPinned: async (id, weekdays) =>
        j().prompts.setPinned(expectPromptId(id), weekdays === null ? null : expectInteger(weekdays, 1, 127, 'weekdays')),
    },

    tags: {
      list: async () => j().tags.list(),
      forDay: async (date) => j().entries.tags(expectDateKey(date)),
      create: async (label) => j().tags.create(expectTagText(label)),
      update: async (name, patch) => {
        const o = expectObject(patch, 'changes');
        return j().tags.update(expectTagText(name), {
          label: o.label === undefined ? undefined : expectTagText(o.label),
          quick: o.quick === undefined ? undefined : expectBoolean(o.quick),
        });
      },
      reorder: async (names) => j().tags.reorder(expectArray(names, 1000, 'tags').map((n) => expectTagText(n))),
      remove: async (name) => j().tags.remove(expectTagText(name)),
    },

    trackers: {
      list: async () => j().trackers.list(),
      create: async (input) => {
        const o = expectObject(input, 'tracker');
        return j().trackers.create({
          label: expectNonEmptyText(o.label, 'a name for the tracker', MAX_TRACKER_LABEL_LENGTH * 2),
          kind: expectOneOf(o.kind, TRACKER_KINDS, 'kind of tracker'),
        });
      },
      update: async (id, patch) => {
        const o = expectObject(patch, 'changes');
        return j().trackers.update(recordId(id, 'tracker'), {
          label: o.label === undefined ? undefined : expectNonEmptyText(o.label, 'a name for the tracker', MAX_TRACKER_LABEL_LENGTH * 2),
          kind: o.kind === undefined ? undefined : expectOneOf(o.kind, TRACKER_KINDS, 'kind of tracker'),
          archived: o.archived === undefined ? undefined : expectBoolean(o.archived),
        });
      },
      reorder: async (ids) => j().trackers.reorder(expectArray(ids, 100, 'trackers').map((id) => recordId(id, 'tracker'))),
      remove: async (id) => j().trackers.remove(recordId(id, 'tracker')),
      // The store checks that the answer fits the tracker's kind.
      setForDay: async (date, id, value) =>
        j().trackers.setForDay(
          writableDate(date),
          recordId(id, 'tracker'),
          value === null ? null : expectInteger(value, 0, SCALE_MAX, 'answer'),
        ),
    },

    moods: {
      list: async () => j().moods.list(),
      create: async (input) => {
        const o = expectObject(input, 'mood');
        if (!isMoodIcon(o.icon) || !isMoodColor(o.color)) throw new ValidationError('Please choose an icon and a color.');
        return j().moods.create({
          label: expectNonEmptyText(o.label, 'a name for the mood', MAX_MOOD_LABEL_LENGTH),
          icon: o.icon,
          color: o.color,
        });
      },
      update: async (key, patch) => {
        const o = expectObject(patch, 'changes');
        if (o.icon !== undefined && !isMoodIcon(o.icon)) throw new ValidationError('Invalid icon.');
        if (o.color !== undefined && !isMoodColor(o.color)) throw new ValidationError('Invalid color.');
        return j().moods.update(expectId(key, 'mood'), {
          label: o.label === undefined ? undefined : expectNonEmptyText(o.label, 'a name for the mood', MAX_MOOD_LABEL_LENGTH),
          icon: o.icon as MoodIcon | undefined,
          color: o.color as MoodColor | undefined,
          hidden: o.hidden === undefined ? undefined : expectBoolean(o.hidden),
        });
      },
      reorder: async (keys) => j().moods.reorder(expectArray(keys, 100, 'moods').map((k) => expectId(k, 'mood'))),
      resetDefaults: async () => j().moods.resetDefaults(),
    },

    photos: {
      pickAndImport: async (date) => {
        const d = writableDate(date);
        const paths = await platform.chooseImages();
        // A large selection is added in batches; the per-day limit still reports file by file.
        const result: ImportResult = { imported: [], rejected: [] };
        for (let i = 0; i < paths.length; i += MAX_IMPORT_BATCH) {
          const batch = await j().photos.importSources(
            d,
            paths.slice(i, i + MAX_IMPORT_BATCH).map((path) => ({ name: basename(path), path })),
          );
          result.imported.push(...batch.imported);
          result.rejected.push(...batch.rejected);
        }
        return result;
      },
      importFiles: async (date, paths) => {
        const d = writableDate(date);
        const list = expectArray(paths, MAX_IMPORT_BATCH, 'files').map((p) => expectText(p, 'file path', 4096));
        return j().photos.importSources(
          d,
          list.map((path) => ({ name: basename(path), path })),
        );
      },
      importData: async (date, files) => {
        const d = writableDate(date);
        const list = expectArray(files, MAX_IMPORT_BATCH, 'files').map((file) => {
          const o = expectObject(file, 'file');
          return { name: expectText(o.name, 'file name', 255), data: expectBytes(o.data, MAX_PHOTO_BYTES, 'photo') };
        });
        return j().photos.importSources(d, list);
      },
      update: async (id, patch) => {
        const o = expectObject(patch, 'changes');
        return j().photos.update(expectId(id, 'photo'), {
          caption: o.caption === undefined ? undefined : expectText(o.caption, 'caption', MAX_CAPTION_LENGTH),
          favorite: o.favorite === undefined ? undefined : expectBoolean(o.favorite),
        });
      },
      reorder: async (date, ids) =>
        j().photos.reorder(expectDateKey(date), expectArray(ids, 200, 'photos').map((id) => expectId(id, 'photo'))),
      moveToDay: async (id, date) => j().photos.moveToDay(expectId(id, 'photo'), writableDate(date)),
      remove: async (id) => j().photos.remove(expectId(id, 'photo')),
      restore: async (id) => j().photos.restore(expectId(id, 'photo')),
      deleteForever: async (id) => j().photos.deleteForever(expectId(id, 'photo')),
      listRemoved: async () => j().photos.listRemoved(),
      gallery: async (filter) => {
        const o = expectObject(filter, 'filter');
        return j().photos.gallery({
          from: optionalDate(o.from, 'start date'),
          to: optionalDate(o.to, 'end date'),
          limit: o.limit === undefined ? undefined : expectInteger(o.limit, 1, MAX_GALLERY_LIMIT, 'limit'),
        });
      },
      galleryMonths: async () => j().photos.galleryMonths(),
      saveThumbnail: async (id, data, width, height) =>
        j().photos.saveThumbnail(
          expectId(id, 'photo'),
          expectBytes(data, MAX_THUMBNAIL_BYTES, 'thumbnail'),
          expectInteger(width, 1, 100_000, 'width'),
          expectInteger(height, 1, 100_000, 'height'),
        ),
      showInFolder: async (id) => {
        const path = j().photos.mediaPath('photo', expectId(id, 'photo'));
        if (path && existsSync(path)) platform.showItemInFolder(path);
        else await platform.openFolder(j().paths.photos);
      },
    },

    journal: {
      search: async (query) => j().search.search(parseSearchQuery(query)),
      searchWriting: async (query) => {
        const o = expectObject(query, 'search');
        return j().writing.search(expectText(o.text, 'search text', 500), {
          from: optionalDate(o.from, 'start date'),
          to: optionalDate(o.to, 'end date'),
        });
      },
      months: async () => j().search.months(),
    },

    months: {
      recap: async (month) => j().reflections.recap(expectMonthKey(month)),
      saveReflection: async (month, key, answer) => {
        const question = expectOneOf(key, MONTHLY_KEYS, 'question');
        const max = question === MONTHLY_INTENTION_KEY ? MAX_INTENTION_LENGTH : undefined;
        return j().reflections.save(expectMonthKey(month), question, expectText(answer, 'reflection', max));
      },
      intention: async (month) => j().reflections.intention(expectMonthKey(month)),
    },

    years: {
      recap: async (year) => j().years.recap(expectInteger(year, 1900, 2999, 'year')),
      saveReflection: async (year, key, answer) =>
        j().years.save(expectInteger(year, 1900, 2999, 'year'), expectOneOf(key, YEARLY_KEYS, 'question'), expectText(answer, 'reflection')),
    },

    capsules: {
      list: async () => j().capsules.list(),
      forDay: async (date) => j().capsules.forDay(expectDateKey(date)),
      create: async (openOn) => j().capsules.create(expectDateKey(openOn, 'day')),
      save: async (id, body) => j().capsules.save(recordId(id, 'letter'), expectText(body, 'letter')),
      remove: async (id) => j().capsules.remove(recordId(id, 'letter')),
      markOpened: async (id) => j().capsules.markOpened(recordId(id, 'letter')),
      datesInMonth: async (month) => j().capsules.datesInMonth(expectMonthKey(month)),
    },

    stats: {
      overview: async (today, range) =>
        j().stats.overview(expectDateKey(today), expectOneOf(range, ['month', 'quarter', 'year', 'all'] as const, 'range')),
      streak: async (today) => j().stats.streak(expectDateKey(today)),
      yearInMoods: async (year) => j().stats.yearInMoods(expectInteger(year, 1900, 2999, 'year')),
    },

    settings: {
      get: async () => j().settings.get(),
      update: async (patch) => {
        const settings = j().settings.update(expectObject(patch, 'settings'));
        platform.settingsChanged(settings);
        return settings;
      },
    },

    data: {
      info: async () => {
        const journal = j();
        const photos = journal.photos.stats();
        const backups = journal.paths.backups;
        const previousJournals = existsSync(backups)
          ? readdirSync(backups)
              .filter((name) => name.startsWith('previous-journal-'))
              .map((name) => ({ name, path: join(backups, name) }))
          : [];
        return {
          dataDir: journal.paths.root,
          databasePath: journal.paths.database,
          photosDir: journal.paths.photos,
          backupsDir: backups,
          databaseBytes: existsSync(journal.paths.database) ? statSync(journal.paths.database).size : 0,
          photoCount: photos.active,
          photoBytes: photos.bytes,
          removedPhotoCount: photos.removed,
          missingPhotoCount: photos.missing,
          entryCount: journal.entries.contentDays().length,
          schemaVersion: journal.db.userVersion,
          snapshots: listSnapshots(journal.paths.snapshots),
          previousJournals,
          encryptedAtRest: false as const,
        };
      },
      openFolder: async (which) => {
        const target = expectOneOf(which, ['data', 'backups'] as const, 'folder');
        await platform.openFolder(target === 'backups' ? j().paths.backups : j().paths.root);
      },
      exportJson: async () =>
        exportTo(`mJournal-export-${fileStamp(j().clock())}.json`, { name: 'JSON', extensions: ['json'] }, () =>
          JSON.stringify(buildJsonExport(j(), platform.appVersion), null, 2),
        ),
      exportCsv: async () =>
        exportTo(`mJournal-entries-${fileStamp(j().clock())}.csv`, { name: 'CSV spreadsheet', extensions: ['csv'] }, () =>
          buildCsv(j()),
        ),
      createBackup: async () => {
        // With a backup password, the backup is protected (a .mjbackup file) as it is written.
        const key = backups.key();
        const target = await platform.chooseSaveLocation(
          `mJournal-backup-${fileStamp(j().clock())}.${key ? ENCRYPTED_BACKUP_EXTENSION : 'zip'}`,
          key
            ? { name: 'mJournal backup (password-protected)', extensions: [ENCRYPTED_BACKUP_EXTENSION] }
            : { name: 'mJournal backup', extensions: ['zip'] },
        );
        if (!target) return { canceled: true };
        const { bytes } = await writeBackup(j(), target, platform.appVersion, { key });
        backups.noteManualBackup();
        savedFiles.add(target);
        return { canceled: false, path: target, bytes };
      },
      inspectBackup: async () => {
        const file = await platform.chooseBackupFile();
        return file ? host.inspectBackup(file, backups.key()) : null;
      },
      unlockBackup: async (token, password) => host.unlockBackup(expectToken(token), expectPassword(password)),
      inspectSnapshot: async (name) => host.inspectSnapshot(expectSnapshotName(name)),
      restoreBackup: async (token) => {
        const result = await host.restore(expectToken(token));
        // The restored journal brings its own settings (theme, text size, tray, shortcut…): apply them now.
        platform.settingsChanged(j().settings.get());
        return result;
      },
      cancelRestore: async (token) => host.cancelRestore(expectToken(token)),
      backupStatus: async () => backups.status(),
      chooseBackupFolder: async () => {
        const folder = await platform.chooseFolder('Choose a folder for automatic backups');
        if (folder) backups.setFolder(folder);
        return backups.status();
      },
      clearBackupFolder: async () => {
        backups.clearFolder();
        return backups.status();
      },
      backUpNow: async () => {
        await backups.run();
        return backups.status();
      },
      snoozeBackupReminder: async () => {
        backups.snoozeReminder();
        return backups.status();
      },
      setBackupPassword: async (password) => {
        await backups.setPassword(password === null ? null : expectPassword(password));
        return backups.status();
      },
      showSavedFile: async (path) => {
        const target = expectText(path, 'file path', 4096);
        if (savedFiles.has(target) && existsSync(target)) platform.showItemInFolder(target);
      },
    },

    updates: {
      status: async () => platform.updates.status(),
      check: async () => platform.updates.check(),
      install: async () => platform.updates.install(),
      dismissResult: async () => platform.updates.dismissResult(),
      openReleasePage: async () => platform.openReleasePage(),
    },

    lock: {
      status: async () => appLock.status(),
      unlock: async (pin) => appLock.unlock(expectText(pin, 'PIN', MAX_PIN_INPUT)),
      lock: async () => appLock.lock(),
      setPin: async (currentPin, newPin) =>
        appLock.setPin(
          currentPin === null ? null : expectText(currentPin, 'PIN', MAX_PIN_INPUT),
          expectText(newPin, 'PIN', MAX_PIN_INPUT),
        ),
      removePin: async (currentPin) => appLock.removePin(expectText(currentPin, 'PIN', MAX_PIN_INPUT)),
      setAutoLock: async (minutes) => appLock.setAutoLock(expectInteger(minutes, 0, 1440, 'time')),
    },
  };
  return guardWhileLocked(handlers, appLock);
}
