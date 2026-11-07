/**
 * A gentle suggestion on Today when the journal has had no complete backup for a while (see BackupStatus.remind):
 * the journal lives only on this computer. "Not now" quiets it for two weeks.
 */
import { api } from '../lib/api';
import { invalidate, useQuery } from '../lib/data';
import { href, navigate } from '../lib/router';
import { Icon } from './Icon';

export function BackupNudge() {
  const status = useQuery('backup-status', () => api.data.backupStatus(), ['data', 'settings']);
  if (!status.data?.remind) return null;
  const never = status.data.lastBackupAt === null;
  return (
    <aside className="tip backup-nudge" aria-label="Backup reminder">
      <span className="tip-icon" aria-hidden="true">
        <Icon name="download" size={18} />
      </span>
      <div className="tip-body">
        <p>
          <strong>Your journal lives only on this computer.</strong>{' '}
          {never
            ? 'It hasn’t been backed up yet. A backup on a USB drive or another disk keeps it safe if this computer ever fails.'
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
