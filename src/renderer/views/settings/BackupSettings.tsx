/**
 * Backups, restore and exports. Restoring is explicit, explained and reversible. Automatic backups go to a
 * folder the person chose; a backup password protects every new backup (the key stays on this computer).
 */
import { useState } from 'react';
import { AUTO_BACKUP_KEEP, type BackupInspection, type BackupStatus, type RestoreResult } from '@core/api';
import { todayKey } from '@core/dates';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toasts';
import { api, errorMessage } from '../../lib/api';
import { useApp } from '../../lib/app';
import { invalidate, useQuery } from '../../lib/data';
import { saveQueue } from '../../lib/saveQueue';
import { Segmented, SettingsSection } from '../SettingsView';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** The minimum the main process accepts too (services/backupCrypto.ts). */
const MIN_PASSWORD = 8;

export function BackupSettings() {
  const { settings, updateSettings, format, info: app } = useApp();
  const info = useQuery('data-info', () => api.data.info(), ['data', 'entries', 'photos']);
  const status = useQuery('backup-status', () => api.data.backupStatus(), ['data', 'settings']);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restored, setRestored] = useState<RestoreResult | null>(null);
  // A password-protected backup waiting for its password.
  const [locked, setLocked] = useState<{ token: string; fileName: string } | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [choosingSnapshot, setChoosingSnapshot] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState(false);

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

  const showInspection = (result: BackupInspection) => {
    setUnderstood(false);
    setRestoreError(null);
    setInspection(result);
  };

  const chooseBackup = () =>
    action('inspect', async () => {
      const result = await api.data.inspectBackup();
      if (!result) return;
      if ('needsPassword' in result) {
        setUnlockPassword('');
        setUnlockError(null);
        setLocked({ token: result.token, fileName: result.fileName });
      } else {
        showInspection(result);
      }
    });

  const unlock = async () => {
    if (!locked) return;
    setBusy('unlock');
    setUnlockError(null);
    try {
      const result = await api.data.unlockBackup(locked.token, unlockPassword);
      setLocked(null);
      setUnlockPassword('');
      showInspection(result);
    } catch (err) {
      setUnlockError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const cancelUnlock = () => {
    if (locked) void api.data.cancelRestore(locked.token).catch(() => undefined);
    setLocked(null);
    setUnlockPassword('');
  };

  const chooseSnapshot = (name: string) =>
    action('inspect', async () => {
      setChoosingSnapshot(false);
      showInspection(await api.data.inspectSnapshot(name));
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
  const isSnapshot = inspection?.kind === 'snapshot';

  return (
    <SettingsSection
      id="backup"
      title="Backup & export"
      description={
        app.journalBesideApp
          ? 'Your journal lives only in the mJournal Data folder next to mJournal, so a backup on another drive keeps it safe if that one is lost or fails.'
          : 'Your journal lives only on this computer, so a backup somewhere else — a USB drive, another disk — keeps it safe.'
      }
    >
      <div className="setting-row">
        <div>
          <h3>Complete backup</h3>
          <p className="muted">
            One file with all your days, moods, monthly reflections, settings and photos.
            {status.data?.encrypted ? ' It is protected with your backup password.' : ''}
          </p>
          {status.data?.lastBackupAt && (
            <p className="muted snapshot-line">
              Last complete backup: {format.medium(todayKey(new Date(status.data.lastBackupAt)))} at {format.time(status.data.lastBackupAt)}
            </p>
          )}
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

      {status.data && <AutomaticBackups status={status.data} onChanged={() => invalidate('data')} />}

      <div className="setting-row">
        <div>
          <h3>Password for backups</h3>
          <p className="muted">
            {status.data?.encrypted
              ? 'New backups are protected with your password: without it, nobody can open them. Backups made earlier keep the password (or none) they were made with.'
              : 'Backups aren’t protected yet: anyone who finds one could read it. A password keeps a backup on a USB stick or in a cloud folder private.'}
          </p>
        </div>
        <div className="option-buttons">
          <button type="button" className="btn" onClick={() => setPasswordDialog(true)}>
            <Icon name="key" size={16} /> {status.data?.encrypted ? 'Change password…' : 'Set a password…'}
          </button>
          {status.data?.encrypted && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                void action('password', async () => {
                  await api.data.setBackupPassword(null);
                  invalidate('data');
                  toast('New backups won’t be protected with a password');
                })
              }
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="setting-row">
        <div>
          <h3>Daily safety snapshots</h3>
          <p className="muted">
            Once a day mJournal keeps a copy of its database (your writing, moods and settings) in the backups folder, also
            while it stays open. The newest copy of each of the last 7 days, 4 weeks and 6 months is kept. Photos aren’t
            copied here — use a complete backup for those.
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
      <div className="row-actions align-start">
        <button
          type="button"
          className="btn btn-sm"
          disabled={snapshots.length === 0 || busy !== null}
          onClick={() => setChoosingSnapshot(true)}
        >
          <Icon name="restore" size={15} /> Restore a snapshot…
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void api.data.openFolder('backups')}>
          <Icon name="folder" size={15} /> Open backups folder
        </button>
      </div>

      <PasswordDialog open={passwordDialog} change={Boolean(status.data?.encrypted)} onClose={() => setPasswordDialog(false)} />

      <Dialog
        open={choosingSnapshot}
        onClose={() => setChoosingSnapshot(false)}
        title="Restore a snapshot"
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => setChoosingSnapshot(false)}>
            Cancel
          </button>
        }
      >
        <p className="muted">
          A snapshot puts back your writing, moods, reflections and settings as they were then. Photos stay as they are now.
          Nothing changes until you confirm on the next step.
        </p>
        <ul className="snapshot-list">
          {snapshots.map((s) => (
            <li key={s.name}>
              <span>
                <strong>
                  {format.medium(todayKey(new Date(s.createdAt)))} at {format.time(s.createdAt)}
                </strong>
                <span className="muted">
                  {' '}
                  · {formatBytes(s.bytes)}
                  {s.name.includes('before-migration') ? ' · before an upgrade' : ''}
                </span>
              </span>
              <button type="button" className="btn btn-sm" onClick={() => void chooseSnapshot(s.name)}>
                Choose
              </button>
            </li>
          ))}
        </ul>
      </Dialog>

      <Dialog
        open={locked !== null}
        onClose={cancelUnlock}
        dismissible={busy !== 'unlock'}
        title="This backup has a password"
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={cancelUnlock} disabled={busy === 'unlock'}>
              Cancel
            </button>
            <button type="submit" form="unlock-backup" className="btn btn-primary" disabled={!unlockPassword || busy === 'unlock'}>
              {busy === 'unlock' && <span className="spinner" aria-hidden="true" />} Open backup
            </button>
          </>
        }
      >
        <form
          id="unlock-backup"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
        >
          <p className="muted">{locked?.fileName} is protected. Enter the password it was made with.</p>
          <label className="field">
            <span className="field-label">Backup password</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              autoFocus
              value={unlockPassword}
              onChange={(event) => setUnlockPassword(event.target.value)}
            />
          </label>
          {unlockError && (
            <p className="notice error" role="alert">
              <Icon name="info" size={16} />
              <span>{unlockError}</span>
            </p>
          )}
        </form>
      </Dialog>

      <Dialog
        open={inspection !== null}
        onClose={cancelRestore}
        dismissible={busy !== 'restore'}
        title={isSnapshot ? 'Restore this snapshot?' : 'Restore this backup?'}
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
              <span>
                {isSnapshot ? 'This snapshot passed its checks.' : 'This backup passed its checks: every file is intact and readable.'}
                {inspection.encrypted ? ' It was protected with a password.' : ''}
              </span>
            </p>
            <dl className="restore-compare">
              <div>
                <dt>{isSnapshot ? 'In the snapshot' : 'In the backup'}</dt>
                <dd>
                  <strong>{inspection.counts.entries}</strong> days · <strong>{inspection.counts.photos}</strong> photos ·{' '}
                  <strong>{inspection.counts.monthlyReflections}</strong> monthly reflections
                </dd>
                <dd className="muted">
                  {isSnapshot ? 'Taken' : 'Made'} {format.medium(todayKey(new Date(inspection.createdAt)))}
                  {inspection.appVersion ? ` with mJournal ${inspection.appVersion}` : ''} · {formatBytes(inspection.bytes)} ·{' '}
                  {inspection.fileName}
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
              {isSnapshot ? (
                <>
                  Restoring <strong>replaces</strong> your writing, moods, reflections and settings with this snapshot. Your
                  photos stay as they are. Your current journal’s database won’t be deleted: it is moved to the backups folder
                  first, so you can go back to it.
                </>
              ) : (
                <>
                  Restoring <strong>replaces</strong> your current journal with the backup — the two are not merged. Your
                  current journal won’t be deleted: it is moved to the backups folder first, so you can go back to it.
                </>
              )}
            </p>
            <label className="check">
              <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
              I understand my current journal will be replaced by this {isSnapshot ? 'snapshot' : 'backup'}.
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
        <p>Everything is back in place.</p>
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

/** Automatic complete backups into a folder the person chose. */
function AutomaticBackups({ status, onChanged }: { status: BackupStatus; onChanged: () => void }) {
  const { settings, updateSettings, format } = useApp();
  const [busy, setBusy] = useState<'folder' | 'now' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (name: 'folder' | 'now', call: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    try {
      await call();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const when = (iso: string) => `${format.medium(todayKey(new Date(iso)))} at ${format.time(iso)}`;

  return (
    <div className="auto-backup" id="settings-auto-backup">
      <div className="setting-row">
        <div>
          <h3>Automatic backups</h3>
          <p className="muted">
            mJournal makes a complete backup by itself into a folder you choose — a USB drive, another disk, or a folder
            your own sync app looks after. It backs up while it’s open; if a backup was due while it was closed, it
            catches up a minute after starting. mJournal itself still never goes online.
          </p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.autoBackup}
            onChange={(event) => void updateSettings({ autoBackup: event.target.checked }).then(onChanged)}
          />
          <span className="visually-hidden">Automatic backups</span>
        </label>
      </div>
      <div className="auto-backup-folder">
        <span className="field-label">Folder</span>
        {status.folder ? <code className="path">{status.folder}</code> : <span className="muted">No folder chosen yet.</span>}
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy !== null}
            onClick={() => void run('folder', () => api.data.chooseBackupFolder())}
          >
            <Icon name="folder" size={15} /> {status.folder ? 'Change folder…' : 'Choose folder…'}
          </button>
          {status.folder && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy !== null}
              onClick={() => void run('folder', () => api.data.clearBackupFolder())}
            >
              Forget this folder
            </button>
          )}
        </div>
        {status.folder && !status.folderAvailable && (
          <p className="notice">
            <Icon name="info" size={16} />
            <span>This folder can’t be reached right now. If it’s on a drive, plug it in — mJournal tries again every hour.</span>
          </p>
        )}
      </div>
      <div className="setting-row">
        <div>
          <h3>How often</h3>
        </div>
        <Segmented<'daily' | 'weekly'>
          label="How often"
          value={settings.autoBackupFrequency}
          onChange={(value) => void updateSettings({ autoBackupFrequency: value }).then(onChanged)}
          options={[
            { value: 'daily', label: 'Every day' },
            { value: 'weekly', label: 'Every week' },
          ]}
        />
      </div>
      <div className="setting-row">
        <div>
          <h3>Backups to keep</h3>
          <p className="muted">Older automatic backups in the folder are deleted. Nothing else in it is ever touched.</p>
        </div>
        <Segmented<string>
          label="Backups to keep"
          value={String(settings.autoBackupKeep)}
          onChange={(value) =>
            void updateSettings({ autoBackupKeep: Number(value) as (typeof AUTO_BACKUP_KEEP)[number] }).then(onChanged)
          }
          options={AUTO_BACKUP_KEEP.map((n) => ({ value: String(n), label: String(n) }))}
        />
      </div>
      <div className="update-row">
        <p className="update-status" aria-live="polite">
          {status.running || busy === 'now'
            ? 'Backing up…'
            : status.lastAuto
              ? `Last automatic backup: ${when(status.lastAuto.at)} (${formatBytes(status.lastAuto.bytes)}).`
              : 'No automatic backup yet.'}
          {settings.autoBackup && status.nextDueAt && !status.running && busy !== 'now' && status.lastAuto
            ? ` Next one: ${when(status.nextDueAt)} or soon after.`
            : ''}
        </p>
        <button
          type="button"
          className="btn"
          disabled={!status.folder || busy !== null || status.running}
          onClick={() => void run('now', () => api.data.backUpNow())}
        >
          {busy === 'now' ? <span className="spinner" aria-hidden="true" /> : <Icon name="download" size={16} />} Back up now
        </button>
      </div>
      {status.lastError && !error && (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>
            The automatic backup on {when(status.lastError.at)} didn’t work: {status.lastError.message}
          </span>
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          <Icon name="info" size={16} />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/** Sets or changes the backup password. There's no way to recover it, so it's asked twice. */
function PasswordDialog({ open, change, onClose }: { open: boolean; change: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setPassword('');
    setAgain('');
    setSaved(false);
    setError(null);
    onClose();
  };

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = again.length > 0 && again !== password;
  const ready = password.length >= MIN_PASSWORD && again === password && saved && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await api.data.setBackupPassword(password);
      invalidate('data');
      toast(change ? 'New backups use your new password' : 'New backups are protected with your password');
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!busy}
      title={change ? 'Change the backup password' : 'Protect backups with a password'}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="backup-password" className="btn btn-primary" disabled={!ready}>
            {busy && <span className="spinner" aria-hidden="true" />} {change ? 'Change password' : 'Protect backups'}
          </button>
        </>
      }
    >
      <form
        id="backup-password"
        className="password-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="muted">
          Every new backup — made by hand or automatically — is encrypted with this password. You’ll need it to restore a
          backup on another computer. A few words in a row make a good one.
        </p>
        <p className="notice">
          <Icon name="info" size={16} />
          <span>
            <strong>If you forget this password, protected backups can’t be opened</strong> — not by you, and not by mJournal.
            {change ? ' Backups made earlier still need the password they were made with.' : ''}
          </span>
        </p>
        <label className="field">
          <span className="field-label">Password</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            aria-invalid={tooShort || undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          {tooShort && <span className="field-hint">At least {MIN_PASSWORD} characters.</span>}
        </label>
        <label className="field">
          <span className="field-label">The same password again</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={again}
            aria-invalid={mismatch || undefined}
            onChange={(event) => setAgain(event.target.value)}
          />
          {mismatch && <span className="field-hint">The two passwords aren’t the same yet.</span>}
        </label>
        <label className="check">
          <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
          I’ve saved this password somewhere safe.
        </label>
        {error && (
          <p className="notice error" role="alert">
            <Icon name="info" size={16} />
            <span>{error}</span>
          </p>
        )}
      </form>
    </Dialog>
  );
}
