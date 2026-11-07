/**
 * The optional evening reminder. It can only appear while mJournal is running
 * (open, minimized or in the tray; also stated in Settings), and stays quiet on
 * days that already have an entry. The portable mJournal can't show it: Windows
 * only shows notifications from installed apps.
 */
import { Notification, powerMonitor } from 'electron';
import type { Settings } from '@core/api';
import { log } from './log';

export class Reminder {
  private timer: NodeJS.Timeout | null = null;
  private settings: Settings | null = null;

  constructor(
    private readonly hasEntryToday: () => boolean,
    private readonly onClick: () => void,
    /** False where notifications can't be shown (the portable app). */
    private readonly canNotify: boolean,
  ) {
    powerMonitor.on('resume', () => this.schedule());
  }

  update(settings: Settings): void {
    this.settings = settings;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const settings = this.settings;
    if (!settings?.reminderEnabled || !this.canNotify || !Notification.isSupported()) return;
    const [hours, minutes] = settings.reminderTime.split(':').map(Number);
    const now = new Date();
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    this.timer = setTimeout(() => {
      this.fire();
      this.schedule();
    }, next.getTime() - now.getTime());
  }

  private fire(): void {
    try {
      if (this.hasEntryToday()) return;
      const name = this.settings?.displayName.trim();
      const notification = new Notification({
        title: 'mJournal',
        body: name ? `A quiet moment for today's page, ${name}?` : "A quiet moment for today's page?",
        silent: true,
      });
      notification.on('click', this.onClick);
      notification.show();
    } catch (err) {
      log.warn('Could not show the reminder', err);
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
