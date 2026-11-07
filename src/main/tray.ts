/**
 * The tray icon (the notification area on Windows, the panel on Linux), shown while "Keep mJournal in the tray"
 * is on. Closing the window then only hides it, so the evening reminder and the quick-note shortcut keep working.
 *
 * On Linux the icon needs a tray area: most desktops have one; GNOME needs the AppIndicator extension (Zorin OS and
 * Ubuntu include it).
 */
import { Menu, nativeImage, Tray } from 'electron';
import { readFileSync } from 'node:fs';
import tray16 from '../../resources/tray-16.png?asset';
import tray32 from '../../resources/tray-32.png?asset';
import { log } from './log';

export interface TrayActions {
  open: () => void;
  quickNote: () => void;
  quit: () => void;
}

function trayImage(): Electron.NativeImage {
  // Linux panels are usually 22–24 px high: the 32 px drawing, scaled down, looks best there.
  if (process.platform === 'linux') return nativeImage.createFromPath(tray32);
  const image = nativeImage.createEmpty();
  image.addRepresentation({ scaleFactor: 1, buffer: readFileSync(tray16) });
  image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(tray32) });
  return image;
}

export class TrayIcon {
  private tray: Tray | null = null;

  constructor(private readonly actions: TrayActions) {}

  get shown(): boolean {
    return this.tray !== null && !this.tray.isDestroyed();
  }

  show(): void {
    if (this.shown) return;
    try {
      this.tray = new Tray(trayImage());
      this.tray.setToolTip('mJournal');
      this.tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Open mJournal', click: () => this.actions.open() },
          { label: 'Quick note…', click: () => this.actions.quickNote() },
          { type: 'separator' },
          { label: 'Quit mJournal', click: () => this.actions.quit() },
        ]),
      );
      // A click opens mJournal (on Linux the menu opens instead, as the desktop decides).
      this.tray.on('click', () => this.actions.open());
    } catch (err) {
      log.warn('Could not show the tray icon', err);
      this.tray = null;
    }
  }

  hide(): void {
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy();
    this.tray = null;
  }
}
