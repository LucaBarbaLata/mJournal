/** Where data lives, what mJournal does (and doesn't do) with it, and recently removed days and photos. */
import { useEffect } from 'react';
import type { RemovedDay } from '@core/api';
import { todayKey } from '@core/dates';
import { confirm } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { MoodIcon } from '../../components/MoodIcon';
import { PhotoImage, photoAlt } from '../../components/Photo';
import { api, errorMessage } from '../../lib/api';
import { useApp } from '../../lib/app';
import { invalidate, useQuery } from '../../lib/data';
import { refreshDay } from '../../lib/dayRefresh';
import { href, navigate } from '../../lib/router';
import { ensureThumbnails } from '../../lib/thumbnails';
import { toast } from '../../components/Toasts';
import { SettingsSection } from '../SettingsView';
import { formatBytes } from './BackupSettings';

/** How to turn on disk encryption, in the words of the operating system mJournal runs on. */
function diskEncryptionHint(platform: string): string {
  if (platform === 'win32') return 'BitLocker or “Device encryption” in Windows settings';
  if (platform === 'linux') return 'on Linux, full-disk encryption is usually set up while installing the system';
  if (platform === 'darwin') return 'FileVault in System Settings';
  return 'see your system’s settings';
}

export function DataSettings() {
  const { info: app } = useApp();
  const info = useQuery('data-info', () => api.data.info(), ['data', 'entries', 'photos']);
  const data = info.data;
  return (
    <SettingsSection id="data" title="Data & privacy">
      <div className="data-location">
        <h3>Where your journal lives</h3>
        <code className="path">{data?.dataDir ?? '…'}</code>
        <div className="row-actions">
          <button type="button" className="btn btn-sm" onClick={() => void api.data.openFolder('data')}>
            <Icon name="folder" size={15} /> Open data folder
          </button>
        </div>
        {data && (
          <p className="muted data-stats">
            {data.entryCount} days · {data.photoCount} photos ({formatBytes(data.photoBytes)}) · database {formatBytes(data.databaseBytes)}
          </p>
        )}
        {data && data.missingPhotoCount > 0 && (
          <p className="notice">
            <Icon name="info" size={16} />
            <span>
              {data.missingPhotoCount} {data.missingPhotoCount === 1 ? 'photo file is' : 'photo files are'} missing from the photos
              folder. Those photos show a placeholder; restoring a backup can bring them back.
            </span>
          </p>
        )}
      </div>

      <ul className="privacy-list">
        <li>
          <Icon name="lock" size={20} />
          <div>
            <h3>Private by design</h3>
            <p className="muted">
              No account, no cloud, no ads, no analytics. mJournal never sends your writing or photos anywhere — search, stats
              and backups all happen on this computer.
            </p>
          </div>
        </li>
        <li>
          <Icon name="info" size={20} />
          <div>
            <h3>Not encrypted by mJournal</h3>
            <p className="muted">
              Your journal is stored as ordinary files in your user folder. Anyone who can sign in to your computer account could
              open them. To protect it, use a password on your account and turn on device encryption ({diskEncryptionHint(app.platform)}).
              A PIN (Settings → PIN lock) keeps mJournal itself closed, but doesn’t encrypt the files. Backups are only
              encrypted when you set a password for them (Backup &amp; export) — otherwise keep them somewhere private.
            </p>
          </div>
        </li>
        <li>
          <Icon name="leaf" size={20} />
          <div>
            <h3>Gentle on your computer</h3>
            <p className="muted">
              Nothing runs in the background when mJournal is closed — unless you choose to keep it in the tray. Its small
              troubleshooting log never contains your journal’s content.
            </p>
          </div>
        </li>
      </ul>

      {data && data.previousJournals.length > 0 && (
        <div className="previous-journals">
          <h3>Journals kept after a restore</h3>
          <p className="muted">When you restored a backup, the journal it replaced was moved here. You can delete these folders yourself once you’re sure.</p>
          <ul>
            {data.previousJournals.map((p) => (
              <li key={p.path}>
                <code className="path">{p.path}</code>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-sm" onClick={() => void api.data.openFolder('backups')}>
            <Icon name="folder" size={15} /> Open backups folder
          </button>
        </div>
      )}
    </SettingsSection>
  );
}

/** Days and photos that were removed, waiting until they are restored or deleted for good. */
export function RemovedItems() {
  const { format, mood: moodFor } = useApp();
  const removed = useQuery('removed-photos', () => api.photos.listRemoved(), ['photos']);
  const removedDays = useQuery('removed-days', () => api.entries.listRemoved(), ['entries', 'photos']);
  const photos = removed.data ?? [];
  const days = removedDays.data ?? [];
  useEffect(() => ensureThumbnails(photos), [photos]);

  const restoreDay = async (day: RemovedDay) => {
    try {
      const date = await api.entries.restoreRemoved(day.id);
      invalidate('entries', 'photos', 'tags');
      refreshDay(date);
      toast(`${format.long(date)} is back`, { label: 'Open day', onClick: () => navigate(href.day(date)) });
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const deleteDay = async (day: RemovedDay) => {
    const ok = await confirm({
      title: 'Delete this day for good?',
      body: `What you wrote on ${format.long(day.date)} is deleted permanently. Its photos stay below until you delete them too. Complete backups made earlier still contain the day.`,
      confirmLabel: 'Delete permanently',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.entries.deleteRemoved(day.id);
      invalidate('entries');
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const restore = async (id: string) => {
    try {
      await api.photos.restore(id);
      invalidate('photos', 'entries');
      toast('Photo restored to its day');
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const deleteForever = async (id: string) => {
    const ok = await confirm({
      title: 'Delete this photo permanently?',
      body: 'The photo file is deleted from mJournal’s folder (unless another day uses the same file). This can’t be undone — though complete backups made earlier still contain it.',
      confirmLabel: 'Delete permanently',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.photos.deleteForever(id);
      invalidate('photos', 'data');
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  return (
    <SettingsSection
      id="removed"
      title="Recently removed"
      description="Days you delete and photos you remove wait here, untouched, until you restore them or delete them for good."
    >
      <h3 className="sub-heading">Days</h3>
      {days.length === 0 ? (
        <p className="muted">Nothing here.</p>
      ) : (
        <ul className="removed-days">
          {days.map((day) => {
            const mood = moodFor(day.mood);
            return (
              <li key={day.id}>
                <span className="removed-day-text">
                  <strong>{format.long(day.date)}</strong>
                  <span className="muted">
                    {mood && <MoodIcon icon={mood.icon} color={mood.color} size={16} title={mood.label} />}{' '}
                    {day.excerpt ||
                      [day.answerCount && `${day.answerCount} answers`, day.photoCount && `${day.photoCount} photos`].filter(Boolean).join(' · ') ||
                      'A saved day'}
                  </span>
                  <span className="muted removed-when">Deleted {format.medium(todayKey(new Date(day.removedAt)))}</span>
                </span>
                <span className="removed-actions">
                  <button type="button" className="btn btn-sm" onClick={() => void restoreDay(day)}>
                    <Icon name="restore" size={14} /> Restore
                  </button>
                  <button type="button" className="icon-btn" aria-label="Delete permanently" title="Delete permanently" onClick={() => void deleteDay(day)}>
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="sub-heading">Photos</h3>
      {photos.length === 0 ? (
        <p className="muted">Nothing here.</p>
      ) : (
        <ul className="removed-grid">
          {photos.map((photo) => (
            <li key={photo.id}>
              <span className="removed-photo">
                <PhotoImage photo={photo} alt={photoAlt(photo, format.long(photo.date))} />
              </span>
              <span className="removed-date">{format.medium(photo.date)}</span>
              <span className="removed-actions">
                <button type="button" className="btn btn-sm" onClick={() => void restore(photo.id)}>
                  <Icon name="restore" size={14} /> Restore
                </button>
                <button type="button" className="icon-btn" aria-label="Delete permanently" title="Delete permanently" onClick={() => void deleteForever(photo.id)}>
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
