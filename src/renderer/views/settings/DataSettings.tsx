/** Where data lives, what mJournal does (and doesn't do) with it, and recently removed photos. */
import { useEffect } from 'react';
import { confirm } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { PhotoImage, photoAlt } from '../../components/Photo';
import { api, errorMessage } from '../../lib/api';
import { useApp } from '../../lib/app';
import { invalidate, useQuery } from '../../lib/data';
import { ensureThumbnails } from '../../lib/thumbnails';
import { toast } from '../../components/Toasts';
import { SettingsSection } from '../SettingsView';
import { formatBytes } from './BackupSettings';

export function DataSettings() {
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
              open them. To protect it, use a password on your account and turn on device encryption (BitLocker or “Device
              encryption” in Windows settings). Backups aren’t encrypted either — keep them somewhere private.
            </p>
          </div>
        </li>
        <li>
          <Icon name="leaf" size={20} />
          <div>
            <h3>Gentle on your computer</h3>
            <p className="muted">
              Nothing runs in the background when mJournal is closed. Its small troubleshooting log never contains your
              journal’s content.
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

export function RemovedPhotos() {
  const { format } = useApp();
  const removed = useQuery('removed-photos', () => api.photos.listRemoved(), ['photos']);
  const photos = removed.data ?? [];
  useEffect(() => ensureThumbnails(photos), [photos]);

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
      title="Recently removed photos"
      description="Photos you remove from a day wait here, with their files untouched, until you restore or delete them."
    >
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
