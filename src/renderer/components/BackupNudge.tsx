/**
 * A gentle suggestion on Today when the journal has had no complete backup for a while (see BackupStatus.remind):
 * the journal lives only on this computer. "Not now" quiets it for two weeks.
 */
import { api } from '../lib/api';
import { useApp } from '../lib/app';
import { invalidate, useQuery } from '../lib/data';
import { href, navigate } from '../lib/router';
import { Icon } from './Icon';

export function BackupNudge() {
  const { info } = useApp();
  const status = useQuery('backup-status', () => api.data.backupStatus(), ['data', 'settings']);
  if (!status.data?.remind) return null;
  const never = status.data.lastBackupAt === null;
  // In portable mode the journal is the "mJournal Data" folder beside the app, often on a USB drive.
  const where = info.journalBesideApp ? 'in its mJournal Data folder' : 'on this computer';
  const lost = info.journalBesideApp ? 'if that drive is ever lost or fails' : 'if this computer ever fails';
  return (
    <aside className="tip backup-nudge" aria-label="Backup reminder">
      <span className="tip-icon" aria-hidden="true">
        <Icon name="download" size={18} />
      </span>
      <div className="tip-body">
        <p>
          <strong>Your journal lives only {where}.</strong>{' '}
          {never
            ? `It hasn’t been backed up yet. A backup on another drive keeps it safe ${lost}.`
            : 'Its last complete backup is more than a month old. A fresh one keeps everything since then safe too.'}
        </p>
        <div className="row-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate(href.settings('backup'))}>
            Set up backups
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void api.data.snoozeBackupReminder().then(() => invalidate('data'))}
          >
            Not now
          </button>
        </div>
      </div>
    </aside>
  );
}
