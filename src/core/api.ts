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

/** A tag on one day: tapped as a chip (picked) and/or written as #tag in the day's text. */
export interface DayTag {
  /** The tag's key: its label in lower case. */
  name: string;
  label: string;
  picked: boolean;
  written: boolean;
}

/** A tag in the vocabulary (Settings → Tags). */
export interface TagRecord {
  name: string;
  label: string;
  /** Shown as a one-tap chip on the day page. */
  quick: boolean;
  position: number;
  /** Days that have this tag. */
  days: number;
  /** Whether it appears as #tag in some day's writing (then it can only be renamed there). */
  written: boolean;
}

export interface DayData {
  date: DateKey;
  entry: EntryRecord | null;
  answers: AnswerRecord[];
  photos: PhotoRecord[];
  tags: DayTag[];
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
  /** Labels of the day's tags. */
  tags: string[];
}

/** A day deleted with "Delete entry", kept in Settings → Recently removed until restored or deleted for good. */
export interface RemovedDay {
  id: number;
  date: DateKey;
  removedAt: string;
  excerpt: string;
  mood: string | null;
  answerCount: number;
  photoCount: number;
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

/** A prompt asked every day (or on some weekdays) on Today's page. */
export interface PinnedPrompt {
  promptId: string;
  text: string;
  category: PromptCategory;
  /** Bit 0 = Sunday … bit 6 = Saturday; 127 = every day. */
  weekdays: number;
}

/** A letter to a future day. It stays sealed until that day; it can be changed only on the day it was written. */
export interface CapsuleInfo {
  id: number;
  openOn: DateKey;
  writtenOn: DateKey;
  /** Still waiting for its day: the text isn't shown (null). */
  sealed: boolean;
  /** Written today and still waiting: it can be changed until the end of the day. */
  editable: boolean;
  body: string | null;
  openedAt: string | null;
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

/** Photos for the Memories gallery, newest day first, up to the requested number. */
export interface GalleryPage {
  photos: GalleryPhoto[];
  /** True when more photos match than were returned. */
  hasMore: boolean;
}

export interface SearchQuery {
  text?: string;
  from?: DateKey;
  to?: DateKey;
  moods?: string[];
  withPhotos?: boolean;
  favoritesOnly?: boolean;
  /** Tag keys: days with any of them. */
  tags?: string[];
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

/** The year in review: a letter to yourself about a whole year. */
export interface YearRecap {
  year: number;
  daysInYear: number;
  daysWithEntries: number;
  moodCounts: { mood: string; count: number }[];
  averageEnergy: number | null;
  energyDays: number;
  totalWords: number;
  photoCount: number;
  /** Each month: how many days, the most recorded mood, and the intention that was set. */
  months: { month: MonthKey; days: number; topMood: string | null; intention: string }[];
  moments: NotableMoment[];
  /** Up to 12 photos: favorites first, then spread over the year. */
  photos: PhotoRecord[];
  tags: { label: string; count: number }[];
  reflection: Record<string, string>;
  reflectionUpdatedAt: string | null;
}

/** A monthly or yearly reflection, or an opened letter, that matched a search. */
export interface WritingResult {
  kind: 'month' | 'year' | 'capsule';
  /** '2026-03' for a month, '2026' for a year, the letter's id for a letter. */
  ref: string;
  /** Text around the matches, with HIGHLIGHT_START/END markers. */
  snippet: string;
  /** For a letter: the day it opened and the day it was written. */
  openOn?: DateKey;
  writtenOn?: DateKey;
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
  /** Moods per weekday in the chosen period (weekday 0 = Sunday). */
  moodByWeekday: { weekday: number; total: number; counts: Record<string, number> }[];
  /** Average energy on the days with each mood, in the chosen period (only days with both). */
  energyByMood: { mood: string; average: number; days: number }[];
  /** The last 12 months. */
  wordsByMonth: { month: MonthKey; words: number }[];
  photosByMonth: { month: MonthKey; count: number }[];
  /** The most used tags in the chosen period. */
  tagCounts: { tag: string; label: string; count: number }[];
}

export interface YearInMoods {
  year: number;
  days: { date: DateKey; mood: string | null; hasEntry: boolean }[];
}

export type ThemePreference = 'system' | 'light' | 'dark';
export type WritingFont = 'serif' | 'sans' | 'hand';

/** How large mJournal draws everything, in percent (the window's zoom). */
export const TEXT_SIZES = [90, 100, 110, 125, 150] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** Shortcuts that open a quick note from anywhere on the computer ('' = none). */
export const QUICK_NOTE_SHORTCUTS = ['CommandOrControl+Alt+J', 'CommandOrControl+Shift+J', 'CommandOrControl+Alt+N'] as const;
export type QuickNoteShortcut = '' | (typeof QUICK_NOTE_SHORTCUTS)[number];

export type BackupFrequency = 'daily' | 'weekly';
/** How many automatic backups are kept in their folder. */
export const AUTO_BACKUP_KEEP = [5, 10, 20] as const;
export type AutoBackupKeep = (typeof AUTO_BACKUP_KEEP)[number];

export interface Settings {
  displayName: string;
  theme: ThemePreference;
  dateFormat: DateFormatPreference;
  weekStartsOn: WeekStart;
  writingFont: WritingFont;
  textSize: TextSize;
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
  /** Complete backups made by themselves into the chosen folder (see BackupStatus.folder). */
  autoBackup: boolean;
  autoBackupFrequency: BackupFrequency;
  autoBackupKeep: AutoBackupKeep;
  /** Closing the window keeps mJournal running in the tray (the notification area), for the reminder. */
  keepInTray: boolean;
  /** Start mJournal in the background when signing in to the computer. */
  openAtLogin: boolean;
  quickNoteShortcut: QuickNoteShortcut;
}

/** What the desktop integration can do on this computer, and what is on. */
export interface DesktopStatus {
  /** Whether this copy can open at sign-in (not portable copies, development builds or other systems). */
  canOpenAtLogin: boolean;
  /** Whether this copy may stay in the tray when closed (not when the journal is in a "mJournal Data" folder). */
  canKeepInTray: boolean;
  /** Whether the tray icon is shown right now. */
  trayShown: boolean;
  /** The quick-note shortcut, and whether it could be claimed (another app may already use it). */
  shortcut: { accelerator: string; registered: boolean } | null;
}

export interface AppInfo {
  name: 'mJournal';
  version: string;
  platform: string;
  dataDir: string;
  notificationsSupported: boolean;
  /**
   * The portable mJournal .exe. It can't open at sign-in (that would leave a Run entry on the computer it
   * visits), show reminders (Windows only shows notifications from installed apps) or install updates itself.
   */
  portableApp: boolean;
  /**
   * The journal is the "mJournal Data" folder next to the portable .exe or the AppImage — often on a USB drive.
   * Then mJournal doesn't stay in the tray or open at sign-in, so it isn't running when that drive is unplugged.
   */
  journalBesideApp: boolean;
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
  /** A complete backup (.zip or password-protected), or one of the daily safety snapshots. */
  kind: 'backup' | 'snapshot';
  /** Whether the backup file was protected with a password. */
  encrypted: boolean;
  fileName: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  bytes: number;
  counts: { entries: number; photos: number; monthlyReflections: number };
  warnings: string[];
  current: { entries: number; photos: number };
}

/** A password-protected backup that needs its password before it can be checked (data.unlockBackup). */
export interface LockedBackup {
  needsPassword: true;
  token: string;
  fileName: string;
}

/** Automatic backups, the backup password and the gentle reminder on Today. */
export interface BackupStatus {
  /** The folder automatic backups go to, or null when none is chosen. */
  folder: string | null;
  /** Whether that folder can be reached right now (a USB drive may be unplugged). */
  folderAvailable: boolean;
  /** When the last complete backup was made, by hand or automatically. */
  lastBackupAt: string | null;
  lastAuto: { at: string; file: string; bytes: number } | null;
  /** Why the last automatic backup failed; cleared by the next one that works. */
  lastError: { at: string; message: string } | null;
  /** When the next automatic backup is due (null while they are off). */
  nextDueAt: string | null;
  /** Whether backups are protected with a password. */
  encrypted: boolean;
  /** Whether an automatic backup is being written right now. */
  running: boolean;
  /** Whether Today should gently suggest making a backup. */
  remind: boolean;
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
    desktopStatus(): Promise<DesktopStatus>;
  };
  entries: {
    getDay(date: DateKey): Promise<DayData>;
    update(date: DateKey, patch: EntryPatch): Promise<EntryRecord>;
    /** Deletes a day; it waits in Recently removed (removedId) until restored or deleted for good. */
    remove(date: DateKey): Promise<{ removedId: number | null }>;
    listRemoved(): Promise<RemovedDay[]>;
    /** Puts a removed day back without overwriting anything written since. Returns its date. */
    restoreRemoved(id: number): Promise<DateKey>;
    deleteRemoved(id: number): Promise<void>;
    /** Picks or un-picks a tag on a day (creating the tag if it's new). */
    setTag(date: DateKey, label: string, picked: boolean): Promise<DayTag[]>;
    /** Adds a paragraph to the end of the day's free writing (a quick note). */
    appendToBody(date: DateKey, text: string): Promise<EntryRecord>;
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
    pinned(): Promise<PinnedPrompt[]>;
    /** Asks a prompt every day, or on some weekdays (bitmask); null stops asking. At most 3. */
    setPinned(promptId: string, weekdays: number | null): Promise<PinnedPrompt[]>;
  };
  tags: {
    list(): Promise<TagRecord[]>;
    forDay(date: DateKey): Promise<DayTag[]>;
    /** A new quick chip. */
    create(label: string): Promise<TagRecord>;
    update(name: string, patch: { label?: string; quick?: boolean }): Promise<TagRecord>;
    reorder(names: string[]): Promise<TagRecord[]>;
    /** Un-picks the tag everywhere; it stays only where it is written as #tag. */
    remove(name: string): Promise<void>;
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
    /** Moves a photo to the end of another day. */
    moveToDay(id: string, date: DateKey): Promise<PhotoRecord>;
    remove(id: string): Promise<void>;
    restore(id: string): Promise<PhotoRecord>;
    deleteForever(id: string): Promise<void>;
    listRemoved(): Promise<PhotoRecord[]>;
    /** The newest `limit` photos (GALLERY_PAGE_SIZE by default) in the date range. */
    gallery(filter: { from?: DateKey; to?: DateKey; limit?: number }): Promise<GalleryPage>;
    galleryMonths(): Promise<JournalMonthCount[]>;
    saveThumbnail(id: string, data: Uint8Array, width: number, height: number): Promise<void>;
    showInFolder(id: string): Promise<void>;
  };
  journal: {
    search(query: SearchQuery): Promise<SearchPage>;
    /** Monthly and yearly reflections and opened letters that match (sealed letters never do). */
    searchWriting(query: { text: string; from?: DateKey; to?: DateKey }): Promise<WritingResult[]>;
    months(): Promise<JournalMonthCount[]>;
  };
  months: {
    recap(month: MonthKey): Promise<MonthRecap>;
    saveReflection(month: MonthKey, key: string, answer: string): Promise<{ updatedAt: string }>;
    /** The month's intention ("" when none was set). */
    intention(month: MonthKey): Promise<string>;
  };
  years: {
    recap(year: number): Promise<YearRecap>;
    saveReflection(year: number, key: string, answer: string): Promise<{ updatedAt: string }>;
  };
  capsules: {
    list(): Promise<CapsuleInfo[]>;
    forDay(date: DateKey): Promise<CapsuleInfo[]>;
    /** Starts a letter to a future day. */
    create(openOn: DateKey): Promise<CapsuleInfo>;
    save(id: number, body: string): Promise<CapsuleInfo>;
    remove(id: number): Promise<void>;
    /** Marks a letter as read once its day has come. */
    markOpened(id: number): Promise<CapsuleInfo>;
    /** Days in a month with a letter (for the calendar). */
    datesInMonth(month: MonthKey): Promise<DateKey[]>;
  };
  stats: {
    overview(today: DateKey, range: StatsRange): Promise<StatsOverview>;
    /** Just the streak, for the chip on Today (much lighter than the overview). */
    streak(today: DateKey): Promise<StreakSummary>;
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
    /** Asks for a backup file and checks it; a password-protected one first needs unlockBackup. */
    inspectBackup(): Promise<BackupInspection | LockedBackup | null>;
    /** Opens a password-protected backup chosen with inspectBackup. A wrong password can be tried again. */
    unlockBackup(token: string, password: string): Promise<BackupInspection>;
    /** Checks one of the daily safety snapshots (by its file name) for restoring. */
    inspectSnapshot(name: string): Promise<BackupInspection>;
    restoreBackup(token: string): Promise<RestoreResult>;
    cancelRestore(token: string): Promise<void>;
    backupStatus(): Promise<BackupStatus>;
    /** Shows a folder picker for automatic backups. */
    chooseBackupFolder(): Promise<BackupStatus>;
    clearBackupFolder(): Promise<BackupStatus>;
    /** Makes an automatic backup right away. */
    backUpNow(): Promise<BackupStatus>;
    /** "Not now" on Today's backup reminder: quiet for two weeks. */
    snoozeBackupReminder(): Promise<BackupStatus>;
    /** Protects new backups with this password, or stops protecting them (null). */
    setBackupPassword(password: string | null): Promise<BackupStatus>;
    /** Shows a backup or export saved during this session in the file manager. */
    showSavedFile(path: string): Promise<void>;
  };
  updates: {
    status(): Promise<UpdateStatus>;
    /** Asks GitHub right away (the "Check now" button). */
    check(): Promise<UpdateStatus>;
    /**
     * Downloads and installs the newer version, then mJournal closes and opens again (the "Update" button). Only
     * does something while a newer version is available and `installer` isn't null. Resolves with the status; when
     * installing fails, its `installError` and `result` say why.
     */
    install(): Promise<UpdateStatus>;
    /** The person closed the window that says how the update went (`result`); it isn't shown again. */
    dismissResult(): Promise<UpdateStatus>;
    /** Opens the releases page on GitHub in the browser (for copies that can't install updates themselves). */
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
  /** Called when the quick-note shortcut or the tray's "Quick note…" is used. */
  onQuickNote(callback: () => void): () => void;
}

type MethodNames<T> = { [K in keyof T]: readonly (keyof T[K] & string)[] };

export const API_METHODS = {
  app: ['info', 'desktopStatus'],
  entries: [
    'getDay',
    'update',
    'remove',
    'listRemoved',
    'restoreRemoved',
    'deleteRemoved',
    'setTag',
    'appendToBody',
    'saveAnswer',
    'removeAnswer',
    'setAnswerFavorite',
    'month',
    'onThisDay',
  ],
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
    'pinned',
    'setPinned',
  ],
  tags: ['list', 'forDay', 'create', 'update', 'reorder', 'remove'],
  moods: ['list', 'create', 'update', 'reorder', 'resetDefaults'],
  photos: [
    'pickAndImport',
    'importFiles',
    'importData',
    'update',
    'reorder',
    'moveToDay',
    'remove',
    'restore',
    'deleteForever',
    'listRemoved',
    'gallery',
    'galleryMonths',
    'saveThumbnail',
    'showInFolder',
  ],
  journal: ['search', 'searchWriting', 'months'],
  months: ['recap', 'saveReflection', 'intention'],
  years: ['recap', 'saveReflection'],
  capsules: ['list', 'forDay', 'create', 'save', 'remove', 'markOpened', 'datesInMonth'],
  stats: ['overview', 'streak', 'yearInMoods'],
  settings: ['get', 'update'],
  data: [
    'info',
    'openFolder',
    'exportJson',
    'exportCsv',
    'createBackup',
    'inspectBackup',
    'unlockBackup',
    'inspectSnapshot',
    'restoreBackup',
    'cancelRestore',
    'showSavedFile',
    'backupStatus',
    'chooseBackupFolder',
    'clearBackupFolder',
    'backUpNow',
    'snoozeBackupReminder',
    'setBackupPassword',
  ],
  updates: ['status', 'check', 'install', 'dismissResult', 'openReleasePage'],
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
  quickNote: 'mj-event:quick-note',
} as const;
