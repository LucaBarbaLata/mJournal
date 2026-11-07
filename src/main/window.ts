/**
 * The main window: security settings, title bar, context menu, size memory and safe closing. With "Keep mJournal
 * in the tray", closing saves first and then only hides the window (see `hideOnClose`).
 */
import { BrowserWindow, Menu, ipcMain, nativeTheme, screen, type MenuItemConstructorOptions } from 'electron';
import { EVENTS } from '@core/api';
import { CHROME_COLORS } from '@core/theme';
import { log } from './log';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const DEFAULT_STATE: WindowState = { width: 1280, height: 840, maximized: false };
/** The smallest window at 100 % text size; larger text sizes raise it (see applyTextSize in index.ts). */
export const MIN_WINDOW_WIDTH = 640;
export const MIN_WINDOW_HEIGHT = 520;
const TITLE_BAR_HEIGHT = 40;
const FLUSH_TIMEOUT_MS = 3000;

/** Keeps a remembered position only if it is still visible on a connected screen. */
function usableState(saved: WindowState | undefined): WindowState {
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return DEFAULT_STATE;
  const state = { ...saved, width: Math.max(MIN_WINDOW_WIDTH, saved.width), height: Math.max(MIN_WINDOW_HEIGHT, saved.height) };
  if (state.x === undefined || state.y === undefined) return state;
  const visible = screen.getAllDisplays().some(({ workArea: a }) => {
    return state.x! < a.x + a.width - 80 && state.x! + state.width > a.x + 80 && state.y! >= a.y - 10 && state.y! < a.y + a.height - 80;
  });
  return visible ? state : { ...state, x: undefined, y: undefined };
}

export function chromeColors() {
  return CHROME_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
}

export function createMainWindow(options: {
  preload: string;
  url: string;
  icon?: string;
  savedState?: WindowState;
  saveState: (state: WindowState) => void;
  isTrustedUrl: (url: string) => boolean;
  /** Whether closing should only hide the window (kept in the tray, and mJournal isn't quitting). */
  hideOnClose?: () => boolean;
  /** Called after the window was hidden instead of closed (its edits are saved by then). */
  onHidden?: () => void;
  /** Opened at sign-in: start hidden (in the tray) or minimized instead of in front. */
  startHidden?: 'tray' | 'minimized' | false;
}): BrowserWindow {
  const state = usableState(options.savedState);
  const colors = chromeColors();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    title: 'mJournal',
    icon: options.icon,
    backgroundColor: colors.background,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 13 } }
      : { titleBarOverlay: { color: colors.background, symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: options.preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // Linux has no system spell checker for Chromium to use, only dictionaries downloaded from Google.
      spellcheck: process.platform !== 'linux',
    },
  });

  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => {
    if (options.startHidden === 'tray') return;
    if (options.startHidden === 'minimized') {
      win.showInactive();
      win.minimize();
      return;
    }
    win.show();
  });

  // Nothing may open new windows or navigate away from the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!options.isTrustedUrl(url)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  const updateChrome = () => {
    const next = chromeColors();
    win.setBackgroundColor(next.background);
    if (process.platform !== 'darwin') win.setTitleBarOverlay({ color: next.background, symbolColor: next.symbol });
  };
  nativeTheme.on('updated', updateChrome);

  win.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) });
      }
      if (params.dictionarySuggestions.length === 0) items.push({ label: 'No spelling suggestions', enabled: false });
      items.push({
        label: 'Add to dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' });
      items.push({ type: 'separator' }, { role: 'selectAll' });
    } else if (params.selectionText) {
      items.push({ role: 'copy' });
    }
    if (items.length > 0) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Ask the interface to save pending edits before closing (or hiding); never wait forever.
  let closing = false;
  let flushed = false;
  let timeout: NodeJS.Timeout | null = null;
  const onFlushed = (event: Electron.IpcMainEvent) => {
    if (event.sender !== win.webContents) return;
    finishClose();
  };
  const finishClose = () => {
    if (flushed || !closing) return;
    ipcMain.removeListener(EVENTS.flushDone, onFlushed);
    if (timeout) clearTimeout(timeout);
    timeout = null;
    if (options.hideOnClose?.()) {
      // Kept in the tray: everything is saved, the window just goes out of sight.
      closing = false;
      win.hide();
      options.onHidden?.();
      return;
    }
    flushed = true;
    win.close();
  };
  win.on('close', (event) => {
    if (!closing) {
      options.saveState({ ...win.getNormalBounds(), maximized: win.isMaximized() });
    }
    if (flushed || win.webContents.isCrashed()) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    ipcMain.on(EVENTS.flushDone, onFlushed);
    win.webContents.send(EVENTS.flushRequest);
    timeout = setTimeout(() => {
      if (!flushed) log.warn('The interface did not confirm saving before closing; closing anyway.');
      finishClose();
    }, FLUSH_TIMEOUT_MS);
  });
  win.on('closed', () => nativeTheme.removeListener('updated', updateChrome));

  win.webContents.on('render-process-gone', (_event, details) => log.error(`Renderer stopped: ${details.reason}`));

  void win.loadURL(options.url);
  return win;
}
