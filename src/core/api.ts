/**
 * The contract between the interface (renderer) and the main process.
 *
 * The renderer calls `window.mjournal.<namespace>.<method>(...)`; the preload
 * script forwards each call over IPC and the main process validates the input
 * before doing any work. API_METHODS lists every callable method, and the
 * compile-time check below keeps it in sync with the MJournalApi interface.
 */
import type { DateFormatPreference, DateKey, MonthKey, WeekStart } from './dates';
import type { LockStatus } from './lock';
import type { MoodColor, MoodIcon } from './moods';
import type { PromptCategory } from './prompts';
import type { StreakSummary } from './streaks';
import type { UpdateStatus } from './updates';

// ---------------------------------------------------------------------------
// Records

export interface EntryRecord {
  date: DateKey;
  body: string;
  mood: string | null;
  moodNote: string;
  energy: number | null;
  favorite: boolean;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface EntryPatch {
  body?: string;
  mood?: string | null;
  moodNote?: string;
  energy?: number | null;
  favorite?: boolean;
}

export interface AnswerRecord {
  id: number;
  date: DateKey;
  promptId: string;
  /** The question as it was worded when answered. */
  promptText: string;
  answer: string;
  favorite: boolean;
  position: number;
  updatedAt: string;
}

export interface AnswerInput {
  promptId: string;
  promptText: string;
  answer: string;
}

export interface PhotoRecord {
  id: string;
  date: DateKey;
  caption: string;
  originalName: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  favorite: boolean;
  position: number;
  createdAt: string;
  removedAt: string | null;
  hasThumbnail: boolean;
  /** True when the image file is no longer on disk. */
  missing: boolean;
  url: string;
  thumbUrl: string;
}

export interface DayData {
  date: DateKey;
  entry: EntryRecord | null;
  answers: AnswerRecord[];
  photos: PhotoRecord[];
}

/** Compact description of a day, used by the calendar, history and recaps. */
export interface DaySummary {
  date: DateKey;
  mood: string | null;
  energy: number | null;
  favorite: boolean;
  hasWriting: boolean;
  answerCount: number;
  photoCount: number;
  wordCount: number;
  excerpt: string;
}

export interface FeaturedPrompt {
  date: DateKey;
  promptId: string;
  text: string;
  category: PromptCategory;
  favorite: boolean;
  skipped: boolean;
  shuffles: number;
}

export interface PromptInfo {
  id: string;
  text: string;
  category: PromptCategory;
  favorite: boolean;
  hidden: boolean;
  custom: boolean;
  /** For custom prompts: whether it can appear as the daily question. */
  inRotation: boolean;
}

export interface MoodRecord {
  key: string;
  label: string;
  icon: MoodIcon;
  color: MoodColor;
  position: number;
  hidden: boolean;
  builtIn: boolean;
}

export interface MoodInput {
  label: string;
  icon: MoodIcon;
  color: MoodColor;
}

export interface MoodPatch {
  label?: string;
  icon?: MoodIcon;
  color?: MoodColor;
  hidden?: boolean;
}

export interface ImportResult {
  imported: PhotoRecord[];
  rejected: { name: string; reason: string }[];
}

export interface GalleryPhoto extends PhotoRecord {
  mood: string | null;
  excerpt: string;
}

export interface SearchQuery {
  text?: string;
  from?: DateKey;
  to?: DateKey;
  moods?: string[];
  withPhotos?: boolean;
  favoritesOnly?: boolean;
  order?: 'newest' | 'oldest';
  /** Continue after this date (exclusive), from the previous page's nextCursor. */
  cursor?: DateKey | null;
  limit?: number;
}

export interface SearchResult extends DaySummary {
  /** Text around the matches, with HIGHLIGHT_START/END markers; null without a text query. */
  snippet: string | null;
}

export interface SearchPage {
  results: SearchResult[];
  nextCursor: DateKey | null;
  total: number;
}

export interface JournalMonthCount {
  month: MonthKey;
  count: number;
}

export interface NotableMoment {
  date: DateKey;
  kind: 'favorite-day' | 'favorite-answer' | 'longest-entry' | 'photos';
  /** Plain explanation of why this moment was picked. */
  reason: string;
  title: string | null;
  excerpt: string;
  mood: string | null;
}

export interface MonthRecap {
  month: MonthKey;
  daysInMonth: number;
  daysWithEntries: number;
  moodCounts: { mood: string; count: number }[];
  moodDays: number;
  averageEnergy: number | null;
  energyDays: number;
  totalWords: number;
  photoCount: number;
  days: DaySummary[];
  photos: PhotoRecord[];
  moments: NotableMoment[];
  reflection: Record<string, string>;
  reflectionUpdatedAt: string | null;
}

export type StatsRange = 'month' | 'quarter' | 'year' | 'all';

export interface StatsOverview {
  today: DateKey;
  streak: StreakSummary;
  totalEntries: number;
  totalWords: number;
  totalPhotos: number;
  firstEntryDate: DateKey | null;
  daysThisMonth: number;
  entriesPerMonth: JournalMonthCount[];
  moodDistribution: { range: StatsRange; total: number; counts: { mood: string; count: number }[] };
  moodByMonth: { month: MonthKey; total: number; counts: Record<string, number> }[];
  energyByMonth: { month: MonthKey; average: number | null; days: number }[];
}

export interface YearInMoods {
  year: number;
  days: { date: DateKey; mood: string | null; hasEntry: boolean }[];
}

export type ThemePreference = 'system' | 'light' | 'dark';
export type WritingFont = 'serif' | 'sans' | 'hand';

export interface Settings {
  displayName: string;
  theme: ThemePreference;
  dateFormat: DateFormatPreference;
  weekStartsOn: WeekStart;
  writingFont: WritingFont;
  showStreaks: boolean;
  reduceMotion: boolean;
  autoSnapshots: boolean;
  reminderEnabled: boolean;
  reminderTime: string;
  /** Whether the welcome guide has been finished or skipped. */
  onboardingDone: boolean;
  /** Ids of the one-time tips the user has dismissed. */
  dismissedTips: string[];
  /** Whether mJournal asks GitHub about once a day if a newer version is out. */
  checkForUpdates: boolean;
  /** The newer version whose note the user put away with "Not now" ("" for none). */
  dismissedUpdate: string;
}

export interface AppInfo {
  name: 'mJournal';
  version: string;
  platform: string;
  dataDir: string;
  notificationsSupported: boolean;
}

export interface DataInfo {
  dataDir: string;
  databasePath: string;
  photosDir: string;
  backupsDir: string;
  databaseBytes: number;
  photoCount: number;
  photoBytes: number;
  removedPhotoCount: number;
  missingPhotoCount: number;
  entryCount: number;
  schemaVersion: number;
  snapshots: { name: string; createdAt: string; bytes: number }[];
  previousJournals: { name: string; path: string }[];
  encryptedAtRest: false;
}

export interface SaveResult {
  canceled: boolean;
  path?: string;
  bytes?: number;
}

export interface BackupInspection {
  token: string;
  fileName: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  bytes: number;
  counts: { entries: number; photos: number; monthlyReflections: number };
  warnings: string[];
  current: { entries: number; photos: number };
}

export interface RestoreResult {
  /** Where the journal that was replaced has been kept. */
  previousDataPath: string;
}

// ---------------------------------------------------------------------------
// The API

export interface MJournalApi {
  app: {
    info(): Promise<AppInfo>;
  };
  entries: {
    getDay(date: DateKey): Promise<DayData>;
    update(date: DateKey, patch: EntryPatch): Promise<EntryRecord>;
    remove(date: DateKey): Promise<void>;
    saveAnswer(date: DateKey, input: AnswerInput): Promise<AnswerRecord>;
    removeAnswer(date: DateKey, promptId: string): Promise<void>;
    setAnswerFavorite(date: DateKey, promptId: string, favorite: boolean): Promise<void>;
    month(month: MonthKey): Promise<DaySummary[]>;
    onThisDay(date: DateKey): Promise<DaySummary[]>;
  };
  prompts: {
    featured(date: DateKey): Promise<FeaturedPrompt | null>;
    shuffle(date: DateKey): Promise<FeaturedPrompt | null>;
    setSkipped(date: DateKey, skipped: boolean): Promise<FeaturedPrompt | null>;
    library(): Promise<PromptInfo[]>;
    setFavorite(promptId: string, favorite: boolean): Promise<void>;
    setHidden(promptId: string, hidden: boolean): Promise<void>;
    createCustom(text: string): Promise<PromptInfo>;
    updateCustom(promptId: string, patch: { text?: string; inRotation?: boolean }): Promise<PromptInfo>;
    archiveCustom(promptId: string): Promise<void>;
  };
  moods: {
    list(): Promise<MoodRecord[]>;
    create(input: MoodInput): Promise<MoodRecord>;
    update(key: string, patch: MoodPatch): Promise<MoodRecord>;
    reorder(keys: string[]): Promise<MoodRecord[]>;
    resetDefaults(): Promise<MoodRecord[]>;
  };
  photos: {
    pickAndImport(date: DateKey): Promise<ImportResult>;
    importFiles(date: DateKey, paths: string[]): Promise<ImportResult>;
    importData(date: DateKey, files: { name: string; data: Uint8Array }[]): Promise<ImportResult>;
    update(id: string, patch: { caption?: string; favorite?: boolean }): Promise<PhotoRecord>;
    reorder(date: DateKey, ids: string[]): Promise<void>;
    remove(id: string): Promise<void>;
    restore(id: string): Promise<PhotoRecord>;
    deleteForever(id: string): Promise<void>;
    listRemoved(): Promise<PhotoRecord[]>;
    gallery(filter: { from?: DateKey; to?: DateKey }): Promise<GalleryPhoto[]>;
    galleryMonths(): Promise<JournalMonthCount[]>;
    saveThumbnail(id: string, data: Uint8Array, width: number, height: number): Promise<void>;
    showInFolder(id: string): Promise<void>;
  };
  journal: {
    search(query: SearchQuery): Promise<SearchPage>;
    months(): Promise<JournalMonthCount[]>;
  };
  months: {
    recap(month: MonthKey): Promise<MonthRecap>;
    saveReflection(month: MonthKey, key: string, answer: string): Promise<{ updatedAt: string }>;
  };
  stats: {
    overview(today: DateKey, range: StatsRange): Promise<StatsOverview>;
    yearInMoods(year: number): Promise<YearInMoods>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: Partial<Settings>): Promise<Settings>;
  };
  data: {
    info(): Promise<DataInfo>;
    openFolder(which: 'data' | 'backups'): Promise<void>;
    exportJson(): Promise<SaveResult>;
    exportCsv(): Promise<SaveResult>;
    createBackup(): Promise<SaveResult>;
    inspectBackup(): Promise<BackupInspection | null>;
    restoreBackup(token: string): Promise<RestoreResult>;
    cancelRestore(token: string): Promise<void>;
    /** Shows a backup or export saved during this session in the file manager. */
    showSavedFile(path: string): Promise<void>;
  };
  updates: {
    status(): Promise<UpdateStatus>;
    /** Asks GitHub right away (the "Check now" button). */
    check(): Promise<UpdateStatus>;
    /** Opens the releases page on GitHub in the browser. Nothing is downloaded by mJournal itself. */
    openReleasePage(): Promise<void>;
  };
  /** The optional PIN lock. Only status, unlock and lock can be called while locked. */
  lock: {
    status(): Promise<LockStatus>;
    /** Unlocks with the right PIN. A wrong one leaves it locked; the status says when the next try is allowed. */
    unlock(pin: string): Promise<LockStatus>;
    lock(): Promise<LockStatus>;
    /** Turns the PIN on (currentPin null) or changes it (currentPin needed). */
    setPin(currentPin: string | null, newPin: string): Promise<LockStatus>;
    removePin(currentPin: string): Promise<LockStatus>;
    setAutoLock(minutes: number): Promise<LockStatus>;
  };
}

/** Helpers that live only in the preload script (no IPC round trip). */
export interface NativeBridge {
  /** The file-system path of a dropped File, or "" if it has none. */
  pathForFile(file: unknown): string;
  /** Called when the window is about to close so pending edits can be saved. */
  onFlushRequest(callback: () => Promise<void> | void): () => void;
  /** Called when the main process asks the interface to open a route, e.g. from a reminder. */
  onNavigate(callback: (hash: string) => void): () => void;
  /** Called whenever the update check's status changes. */
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  /** Called when the main process wants to lock (the computer goes to sleep): save edits, then lock. */
  onLockRequest(callback: () => Promise<void> | void): () => void;
  /** Called whenever the lock changes, e.g. when the main process had to lock by itself. */
  onLockChanged(callback: (status: LockStatus) => void): () => void;
}

type MethodNames<T> = { [K in keyof T]: readonly (keyof T[K] & string)[] };

export const API_METHODS = {
  app: ['info'],
  entries: ['getDay', 'update', 'remove', 'saveAnswer', 'removeAnswer', 'setAnswerFavorite', 'month', 'onThisDay'],
  prompts: [
    'featured',
    'shuffle',
    'setSkipped',
    'library',
    'setFavorite',
    'setHidden',
    'createCustom',
    'updateCustom',
    'archiveCustom',
  ],
  moods: ['list', 'create', 'update', 'reorder', 'resetDefaults'],
  photos: [
    'pickAndImport',
    'importFiles',
    'importData',
    'update',
    'reorder',
    'remove',
    'restore',
    'deleteForever',
    'listRemoved',
    'gallery',
    'galleryMonths',
    'saveThumbnail',
    'showInFolder',
  ],
  journal: ['search', 'months'],
  months: ['recap', 'saveReflection'],
  stats: ['overview', 'yearInMoods'],
  settings: ['get', 'update'],
  data: [
    'info',
    'openFolder',
    'exportJson',
    'exportCsv',
    'createBackup',
    'inspectBackup',
    'restoreBackup',
    'cancelRestore',
    'showSavedFile',
  ],
  updates: ['status', 'check', 'openReleasePage'],
  lock: ['status', 'unlock', 'lock', 'setPin', 'removePin', 'setAutoLock'],
} as const satisfies MethodNames<MJournalApi>;

// Compile-time check that every method of MJournalApi is listed above.
type Unlisted = {
  [K in keyof MJournalApi]: Exclude<keyof MJournalApi[K], (typeof API_METHODS)[K][number]>;
}[keyof MJournalApi];
const everyMethodListed: [Unlisted] extends [never] ? true : Unlisted = true;
void everyMethodListed;

export const IPC_PREFIX = 'mj:';

export function channelName(namespace: string, method: string): string {
  return `${IPC_PREFIX}${namespace}.${method}`;
}

/** What travels back over IPC; the preload turns failures into MJournalError. */
export type IpcEnvelope<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

/** Main-to-renderer event channels. */
export const EVENTS = {
  flushRequest: 'mj-event:flush-request',
  flushDone: 'mj-event:flush-done',
  navigate: 'mj-event:navigate',
  updateStatus: 'mj-event:update-status',
  lockRequest: 'mj-event:lock-request',
  lockChanged: 'mj-event:lock-changed',
} as const;
