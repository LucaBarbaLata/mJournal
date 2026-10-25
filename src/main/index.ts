/**
 * mJournal main process: starts the app, opens the journal and the window.
 *
 * Where data lives:
 * - Journal (database, photos, backups): %APPDATA%\mJournal on Windows,
 *   or the folder in MJOURNAL_DATA_DIR, or "mJournal Data" next to a
 *   portable mJournal.exe if that folder exists.
 * - Browser engine caches: %LOCALAPPDATA%\mJournal\Chromium (no journal content).
 * Development builds use "mJournal-dev" so they never touch a real journal.
 */
import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell } from 'electron';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EVENTS } from '@core/api';
import { todayKey } from '@core/dates';
import { LATEST_RELEASE_API } from '@core/updates';
import { UserFacingError } from '@core/validation';
import icon from '../../resources/icon.png?asset';
import { createApi } from './api';
import { JournalHost } from './host';
import { registerIpc } from './ipc';
import { log, setLogFile } from './log';
import { dataPaths } from './paths';
import { electronPlatform } from './platform';
import { APP_ORIGIN, handleAppProtocol, handleMediaProtocol, registerSchemes } from './protocols';
import { Reminder } from './reminders';
import { fileStamp } from './services/fsutil';
import { maybeTakeDailySnapshot } from './services/snapshots';
import { UpdateChecker } from './services/updates';
import { createMainWindow, type WindowState } from './window';

registerSchemes();

function configurePaths(): string {
  const override = process.env.MJOURNAL_DATA_DIR;
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR ? join(process.env.PORTABLE_EXECUTABLE_DIR, 'mJournal Data') : null;
  let journalDir: string;
  let engineDir: string;
  if (override) {
    journalDir = resolve(override);
    engineDir = join(journalDir, '.chromium');
  } else if (portableDir && existsSync(portableDir)) {
    journalDir = portableDir;
    engineDir = join(portableDir, '.chromium');
  } else {
    const name = app.isPackaged ? 'mJournal' : 'mJournal-dev';
    journalDir = join(app.getPath('appData'), name);
    const local = process.platform === 'win32' && process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA : app.getPath('appData');
    engineDir = join(local, name, 'Chromium');
  }
  app.setPath('userData', engineDir);
  app.setPath('sessionData', engineDir);
  return journalDir;
}

const journalDir = configurePaths();
const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? `${APP_ORIGIN}/index.html`;
const isTrustedUrl = (url: string) =>
  url.startsWith(`${APP_ORIGIN}/`) ||
  (process.env.ELECTRON_RENDERER_URL !== undefined && url.startsWith(process.env.ELECTRON_RENDERER_URL));

let host: JournalHost | null = null;
let mainWindow: BrowserWindow | null = null;
let reminder: Reminder | null = null;
let updates: UpdateChecker | null = null;

// End-to-end tests point the update check at a local server instead of GitHub.
const testUpdateFeed = app.isPackaged ? undefined : process.env.MJOURNAL_UPDATE_URL;

/** The only request mJournal sends to the internet (see services/updates.ts). */
async function fetchLatestRelease(): Promise<unknown> {
  // Its own in-memory session: no cookies, no cache, nothing shared with the window.
  const ses = session.fromPartition('mjournal-update-check', { cache: false });
  const response = await ses.fetch(testUpdateFeed ?? LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mJournal' },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null; // Nothing has been released yet.
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return response.json();
}

if (process.platform === 'win32') app.setAppUserModelId('app.mjournal');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => focusWindow());
  app.whenReady().then(start).catch((err) => {
    log.error('Startup failed', err);
    dialog.showErrorBox('mJournal', `mJournal could not start.\n\n${(err as Error).message}`);
    app.quit();
  });
}

function focusWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hardenSessions(): void {
  const ses = session.defaultSession;
  // mJournal never needs the camera, microphone, location, notifications prompts and so on.
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write');
  // Keep the spell checker offline: on Windows and macOS it uses the system dictionary.
  if (process.platform === 'linux') ses.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:9/');
}

function applyTheme(theme: 'system' | 'light' | 'dark'): void {
  nativeTheme.themeSource = theme;
}

/** Offers a safe way forward when the journal can't be opened. Never deletes anything. */
async function recoverFromOpenFailure(err: unknown): Promise<JournalHost | null> {
  const message = err instanceof Error ? err.message : String(err);
  const isNewer = err instanceof UserFacingError && err.code === 'newer-version';
  const buttons = isNewer ? ['Open data folder', 'Quit'] : ['Open data folder', 'Set it aside and start a new journal', 'Quit'];
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    title: 'mJournal',
    message: "mJournal couldn't open your journal",
    detail: `${message}\n\nData folder: ${journalDir}`,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });
  if (choice === 0) {
    await shell.openPath(journalDir);
    return null;
  }
  if (isNewer || choice !== 1) return null;
  const confirm = dialog.showMessageBoxSync({
    type: 'question',
    title: 'mJournal',
    message: 'Set the current journal aside?',
    detail:
      'The current database file will be moved (not deleted) into backups/damaged-journal-… inside the data folder. ' +
      'mJournal will then start with an empty journal, where you can restore a backup from Settings.',
    buttons: ['Move it aside', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (confirm !== 0) return null;
  const paths = dataPaths(journalDir);
  const aside = join(paths.backups, `damaged-journal-${fileStamp()}`);
  mkdirSync(aside, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(paths.database + suffix)) renameSync(paths.database + suffix, join(aside, `mjournal.db${suffix}`));
  }
  log.warn(`Moved an unreadable database aside to ${aside}`);
  return JournalHost.open(journalDir, { regionCode: app.getLocaleCountryCode() });
}

async function start(): Promise<void> {
  setLogFile(join(journalDir, 'logs', 'mjournal.log'));
  log.info(`mJournal ${app.getVersion()} starting`);
  hardenSessions();
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
      : null,
  );

  try {
    host = JournalHost.open(journalDir, { regionCode: app.getLocaleCountryCode() });
  } catch (err) {
    log.error('Could not open the journal', err);
    host = await recoverFromOpenFailure(err).catch((recoveryError) => {
      log.error('Recovery failed', recoveryError);
      return null;
    });
    if (!host) {
      app.quit();
      return;
    }
  }
  const journalHost = host;

  handleAppProtocol(join(__dirname, '../renderer'));
  handleMediaProtocol((kind, id) => journalHost.journal.photos.mediaPath(kind, id));

  reminder = new Reminder(
    () => journalHost.journal.entries.contentDays().includes(todayKey()),
    () => {
      focusWindow();
      mainWindow?.webContents.send(EVENTS.navigate, '#/today');
    },
  );

  updates = new UpdateChecker({
    currentVersion: app.getVersion(),
    fetchLatestRelease,
    enabled: () => journalHost.journal.settings.get().checkForUpdates,
    load: () => journalHost.journal.settings.getInternal('updateCheck'),
    save: (check) => journalHost.journal.settings.setInternal('updateCheck', check),
    onChange: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(EVENTS.updateStatus, status);
    },
    onError: (err) => log.warn('Could not check for a new version', err),
  });
  const updateChecker = updates;

  const platform = electronPlatform(
    () => mainWindow,
    (settings) => {
      applyTheme(settings.theme);
      reminder?.update(settings);
      updateChecker.settingsChanged();
    },
    updateChecker,
  );
  registerIpc(createApi(journalHost, platform), isTrustedUrl);

  const settings = journalHost.journal.settings.get();
  applyTheme(settings.theme);
  reminder.update(settings);

  mainWindow = createMainWindow({
    preload: join(__dirname, '../preload/index.js'),
    url: rendererUrl,
    icon,
    savedState: journalHost.journal.settings.getInternal<WindowState>('windowState'),
    saveState: (state) => {
      try {
        journalHost.journal.settings.setInternal('windowState', state);
      } catch (err) {
        log.warn('Could not remember the window size', err);
      }
    },
    isTrustedUrl,
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Automatic checks only in the released app (and in tests that bring their own feed).
  if (app.isPackaged || testUpdateFeed) updateChecker.start(testUpdateFeed ? 300 : 10_000);

  // The daily safety snapshot runs after the window is up so startup stays quick.
  setTimeout(() => {
    try {
      const snapshot = maybeTakeDailySnapshot(journalHost.journal);
      if (snapshot) log.info('Saved the daily safety snapshot');
    } catch (err) {
      log.warn('Could not save the daily safety snapshot', err);
    }
  }, 4000);
}

app.on('window-all-closed', () => {
  reminder?.dispose();
  updates?.stop();
  const closing = host?.close() ?? Promise.resolve();
  host = null;
  closing
    .catch((err) => log.error('Error while closing the journal', err))
    .finally(() => app.quit());
});
