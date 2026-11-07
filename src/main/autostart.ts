/**
 * "Open mJournal when I sign in". It then starts with --hidden: in the tray when "Keep mJournal in the tray" is
 * on, otherwise minimized — either way ready for the evening reminder.
 *
 * - Windows: the usual Run entry (app.setLoginItemSettings), pointing at the installed mJournal.exe or at the
 *   portable .exe itself (PORTABLE_EXECUTABLE_FILE), never at its temporary unpacked copy.
 * - Linux: an XDG autostart file, $XDG_CONFIG_HOME/autostart/mjournal.desktop, pointing at the AppImage or at
 *   the installed program. It is written again at every start, in case the AppImage was moved.
 * - Development builds and other systems: not available.
 */
import { app } from 'electron';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { desktopEntry, HIDDEN_ARG } from './desktopEntry';
import { log } from './log';

export { HIDDEN_ARG };

/** The program to start at sign-in, or null when this copy can't open at sign-in. */
export function autostartExecutable(): string | null {
  if (!app.isPackaged) return null;
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  if (process.platform === 'linux') {
    const appImage = process.env.APPIMAGE;
    return appImage && isAbsolute(appImage) ? appImage : process.execPath;
  }
  return null;
}

function autostartFile(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.config'), 'autostart', 'mjournal.desktop');
}

/** Turns opening at sign-in on or off for this copy of mJournal. */
export function applyOpenAtLogin(enabled: boolean): void {
  const executable = autostartExecutable();
  if (!executable) return;
  try {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: enabled, path: executable, args: [HIDDEN_ARG] });
    } else if (process.platform === 'linux') {
      const file = autostartFile();
      if (enabled) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, desktopEntry(executable));
      } else if (existsSync(file)) {
        rmSync(file, { force: true });
      }
    }
  } catch (err) {
    log.warn('Could not change opening at sign-in', err);
  }
}
