/** Electron implementations of the dialogs and shell actions the API needs. */
import { app, dialog, Notification, shell, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { DesktopStatus, Settings } from '@core/api';
import { RELEASES_PAGE } from '@core/updates';
import { UserFacingError } from '@core/validation';
import type { Platform } from './api';

export function electronPlatform(
  getWindow: () => BrowserWindow | null,
  settingsChanged: (settings: Settings) => void,
  updates: Platform['updates'],
  desktopStatus: () => DesktopStatus,
  portable: { app: boolean; journalBesideApp: boolean },
): Platform {
  // Look dialog functions up at call time (not destructured) so tests can stub them.
  const parent = () => getWindow() ?? undefined;
  return {
    appVersion: app.getVersion(),
    platformName: process.platform,
    // Windows only shows notifications from installed apps (a Start-menu shortcut carries the app's id).
    notificationsSupported: Notification.isSupported() && !portable.app,
    portableApp: portable.app,
    journalBesideApp: portable.journalBesideApp,

    async chooseImages() {
      const options: Electron.OpenDialogOptions = {
        title: 'Add photos',
        buttonLabel: 'Add to this day',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] }],
      };
      const win = parent();
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled ? [] : result.filePaths;
    },

    async chooseBackupFile() {
      const options: Electron.OpenDialogOptions = {
        title: 'Choose an mJournal backup',
        buttonLabel: 'Check this backup',
        properties: ['openFile'],
        filters: [{ name: 'mJournal backup', extensions: ['zip', 'mjbackup'] }],
      };
      const win = parent();
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    },

    async chooseFolder(title) {
      const options: Electron.OpenDialogOptions = {
        title,
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      };
      const win = parent();
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
    },

    async chooseSaveLocation(defaultName, filter) {
      const options: Electron.SaveDialogOptions = {
        title: 'Save',
        defaultPath: join(app.getPath('documents'), defaultName),
        filters: [filter],
      };
      const win = parent();
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      return result.canceled || !result.filePath ? null : result.filePath;
    },

    showItemInFolder(path) {
      shell.showItemInFolder(path);
    },

    async openFolder(path) {
      const error = await shell.openPath(path);
      if (error) throw new UserFacingError('open-failed', `The folder couldn't be opened: ${error}`);
    },

    settingsChanged,
    updates,
    desktopStatus,

    async openReleasePage() {
      // Always this fixed address, never one that came from the network.
      await shell.openExternal(RELEASES_PAGE);
    },
  };
}
