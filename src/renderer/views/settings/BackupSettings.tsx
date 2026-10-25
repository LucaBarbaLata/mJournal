/** Backups, restore and exports. Restoring is explicit, explained and reversible. */
import { useState } from 'react';
import type { BackupInspection, RestoreResult } from '@core/api';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toasts';
import { api, errorMessage } from '../../lib/api';
import { useApp } from '../../lib/app';
import { invalidate, useQuery } from '../../lib/data';
import { saveQueue } from '../../lib/saveQueue';
import { SettingsSection } from '../SettingsView';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function BackupSettings() {
  const { settings, updateSettings, format } = useApp();
  const info = useQuery('data-info', () => api.data.info(), ['data', 'entries', 'photos']);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restored, setRestored] = useState<RestoreResult | null>(null);

  const action = async (name: string, run: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    try {
      await saveQueue.flush();
      await run();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const createBackup = () =>
    action('backup', async () => {
      const result = await api.data.createBackup();
      if (result.canceled || !result.path) return;
      invalidate('data');
      const path = result.path;
      toast(`Backup saved (${formatBytes(result.bytes ?? 0)})`, {
        label: 'Show file',
        onClick: () => void api.data.showSavedFile(path),
      });
    });

  const exportAs = (kind: 'json' | 'csv') =>
    action(kind, async () => {
      const result = kind === 'json' ? await api.data.exportJson() : await api.data.exportCsv();
      if (result.canceled || !result.path) return;
      const path = result.path;
      toast(kind === 'json' ? 'Journal exported as JSON' : 'Entries exported as CSV', {
        label: 'Show file',
        onClick: () => void api.data.showSavedFile(path),
      });
    });

  const chooseBackup = () =>
    action('inspect', async () => {
      const result = await api.data.inspectBackup();
      if (result) {
        setUnderstood(false);
        setRestoreError(null);
        setInspection(result);
      }
    });

  const cancelRestore = () => {
    if (inspection) void api.data.cancelRestore(inspection.token).catch(() => undefined);
    setInspection(null);
  };

  const restore = async () => {
    if (!inspection) return;
    setBusy('restore');
    setRestoreError(null);
    try {
      await saveQueue.flush();
      const result = await api.data.restoreBackup(inspection.token);
      setInspection(null);
      setRestored(result);
    } catch (err) {
      setRestoreError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const snapshots = info.data?.snapshots ?? [];

  return (
    <SettingsSection
      id="backup"
      title="Backup & export"
      description="Your journal lives only on this computer, so a backup somewhere else — a USB drive, another disk — keeps it safe."
    >
      <div className="setting-row">
        <div>
          <h3>Complete backup</h3>
          <p className="muted">One .zip file with all your days, moods, monthly reflections, settings and photos.</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void createBackup()}>
          {busy === 'backup' ? <span className="spinner" aria-hidden="true" /> : <Icon name="download" size={16} />} Create backup…
        </button>
      </div>
      <div className="setting-row">
        <div>
          <h3>Restore from a backup</h3>
          <p className="muted">
            Checks the backup first. Restoring <strong>replaces</strong> your journal; your current one is kept in the
            backups folder.
          </p>
        </div>
        <button type="button" className="btn" disabled={busy !== null} onClick={() => void chooseBackup()}>
          {busy === 'inspect' ? <span className="spinner" aria-hidden="true" /> : <Icon name="upload" size={16} />} Restore…
        </button>
      </div>
      <div className="setting-row">
        <div>
          <h3>Export</h3>
          <p className="muted">JSON keeps everything structured; CSV opens in a spreadsheet (one row per day).</p>
        </div>
        <div className="option-buttons">
          <button type="button" className="btn" disabled={busy !== null} onClick={() => void exportAs('json')}>
            JSON
          </button>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => void exportAs('csv')}>
            CSV
          </button>
        </div>
      </div>
      {error && (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>{error}</span>
        </p>
      )}

      <div className="setting-row">
        <div>
          <h3>Daily safety snapshots</h3>
          <p className="muted">
            Once a day mJournal keeps a copy of its database (your writing, moods and settings) in the backups folder. The ten
            newest are kept. Photos aren’t copied here — use a complete backup for those.
          </p>
          {snapshots.length > 0 && (
            <p className="muted snapshot-line">
              Latest: {format.medium(snapshots[0].createdAt.slice(0, 10))} at {format.time(snapshots[0].createdAt)} ·{' '}
              {snapshots.length} kept
            </p>
          )}
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.autoSnapshots}
            onChange={(event) => void updateSettings({ autoSnapshots: event.target.checked })}
          />
          <span className="visually-hidden">Daily safety snapshots</span>
        </label>
      </div>
      <button type="button" className="btn btn-ghost btn-sm align-start" onClick={() => void api.data.openFolder('backups')}>
        <Icon name="folder" size={15} /> Open backups folder
      </button>

      <Dialog
        open={inspection !== null}
        onClose={cancelRestore}
        dismissible={busy !== 'restore'}
        title="Restore this backup?"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={cancelRestore} disabled={busy === 'restore'}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" disabled={!understood || busy === 'restore'} onClick={() => void restore()}>
              {busy === 'restore' && <span className="spinner" aria-hidden="true" />} Replace my journal
            </button>
          </>
        }
      >
        {inspection && (
          <>
            <p className="notice info">
              <Icon name="check" size={16} />
              <span>This backup passed its checks: every file is intact and readable.</span>
            </p>
            <dl className="restore-compare">
              <div>
                <dt>In the backup</dt>
                <dd>
                  <strong>{inspection.counts.entries}</strong> days · <strong>{inspection.counts.photos}</strong> photos ·{' '}
                  <strong>{inspection.counts.monthlyReflections}</strong> monthly reflections
                </dd>
                <dd className="muted">
                  Made {format.medium(inspection.createdAt.slice(0, 10))} with mJournal {inspection.appVersion} ·{' '}
                  {formatBytes(inspection.bytes)} · {inspection.fileName}
                </dd>
              </div>
              <div>
                <dt>Your journal now</dt>
                <dd>
                  <strong>{inspection.current.entries}</strong> days · <strong>{inspection.current.photos}</strong> photos
                </dd>
              </div>
            </dl>
            {inspection.warnings.length > 0 && (
              <div className="notice">
                <Icon name="info" size={16} />
                <ul>
                  {inspection.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <p>
              Restoring <strong>replaces</strong> your current journal with the backup — the two are not merged. Your current
              journal won’t be deleted: it is moved to the backups folder first, so you can go back to it.
            </p>
            <label className="check">
              <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
              I understand my current journal will be replaced by this backup.
            </label>
            {restoreError && (
              <p className="notice error" role="alert">
                <Icon name="info" size={16} />
                <span>{restoreError}</span>
              </p>
            )}
          </>
        )}
      </Dialog>

      <Dialog
        open={restored !== null}
        onClose={() => window.location.reload()}
        title="Your journal has been restored"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Continue
          </button>
        }
      >
        <p>Everything from the backup is back in place.</p>
        {restored && (
          <p className="muted">
            Your previous journal was kept here, in case you need it:
            <br />
            <code className="path">{restored.previousDataPath}</code>
          </p>
        )}
      </Dialog>
    </SettingsSection>
  );
}
