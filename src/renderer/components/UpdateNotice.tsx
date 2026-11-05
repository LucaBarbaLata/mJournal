/**
 * A quiet note in the sidebar when GitHub has a newer mJournal. "Update" downloads and installs it, and mJournal
 * opens again in the new version; nothing is downloaded before that click. Copies that can't install updates
 * themselves (the portable app) show "Get it", which opens the releases page in the browser. Afterwards a window
 * says whether the update worked (UpdateResultDialog).
 */
import type { UpdateStatus } from '@core/updates';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { useUpdateStatus } from '../lib/updates';
import { Sparkle } from './Decorations';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { toast } from './Toasts';

export function openReleasePage(): void {
  api.updates.openReleasePage().catch((err: unknown) => toast(errorMessage(err)));
}

/** Starts downloading and installing; the status follows through the update events. */
export async function installUpdate(): Promise<UpdateStatus | null> {
  try {
    return await api.updates.install();
  } catch (err) {
    toast(errorMessage(err));
    return null;
  }
}

/** How far the download is, as a whole percent, or null while its size isn't known. */
export function downloadPercent(status: UpdateStatus): number | null {
  return status.progress === null ? null : Math.round(status.progress * 100);
}

export function UpdateProgress({ status }: { status: UpdateStatus }) {
  const percent = status.state === 'downloading' ? downloadPercent(status) : null;
  return (
    <div
      className={`update-progress${percent === null ? ' indeterminate' : ''}`}
      role="progressbar"
      aria-label={status.state === 'installing' ? 'Installing' : 'Downloading'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
    >
      <span style={percent === null ? undefined : { width: `${percent}%` }} />
    </div>
  );
}

export function UpdateNotice() {
  const { settings, updateSettings } = useApp();
  const [status] = useUpdateStatus();
  const version = status?.latest ?? null;
  if (!status || !version) return null;

  // While an update is on its way, the note shows how far it is, wherever it was started.
  if (status.state === 'downloading' || status.state === 'installing') {
    const percent = downloadPercent(status);
    return (
      <div className="update-notice" role="status" aria-label="New version">
        <p className="update-notice-text">
          <Sparkle size={14} className="update-notice-spark" />
          <span className="update-notice-label">
            {status.state === 'downloading' ? (
              <>
                Downloading <strong>mJournal {version}</strong>
                {percent === null ? '…' : ` · ${percent}%`}
              </>
            ) : (
              <>
                Installing <strong>mJournal {version}</strong>…
              </>
            )}
          </span>
        </p>
        <UpdateProgress status={status} />
      </div>
    );
  }

  if (status.state !== 'available' || !settings.checkForUpdates || settings.dismissedUpdate === version) return null;

  // When it fails, UpdateResultDialog says why.
  const update = () => void installUpdate();

  return (
    <div className="update-notice" role="status" aria-label="New version">
      <p className="update-notice-text">
        <Sparkle size={14} className="update-notice-spark" />
        <span className="update-notice-label">
          <strong>mJournal {version}</strong> is out
        </span>
      </p>
      <div className="update-notice-actions">
        {status.installer ? (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            title={`Download and install mJournal ${version}. mJournal closes and opens again by itself.`}
            onClick={update}
          >
            <Icon name="download" size={14} />
            <span className="update-notice-label">Update</span>
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-primary" title={`Get mJournal ${version} from GitHub`} onClick={openReleasePage}>
            <Icon name="download" size={14} />
            <span className="update-notice-label">Get it</span>
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          title="Hide this note"
          onClick={() => void updateSettings({ dismissedUpdate: version }).catch((err: unknown) => toast(errorMessage(err)))}
        >
          <Icon name="close" size={14} />
          <span className="update-notice-label">Not now</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Says whether the last update worked, once: after mJournal has opened again in the new version, or right away when
 * installing failed while it was still open. Closing the window (or "Try again") means it isn't shown again.
 */
export function UpdateResultDialog() {
  const [status, setStatus] = useUpdateStatus();
  const result = status?.result ?? null;
  if (!status || !result) return null;

  const dismiss = () => {
    api.updates.dismissResult().then(setStatus, (err: unknown) => toast(errorMessage(err)));
  };
  const retry = async () => {
    const next = await installUpdate();
    if (next) setStatus(next);
  };

  if (result.outcome === 'installed') {
    return (
      <Dialog
        open
        onClose={dismiss}
        title="The update worked"
        actions={
          <button type="button" className="btn btn-primary" onClick={dismiss} autoFocus>
            OK
          </button>
        }
      >
        <p>
          mJournal was updated from {result.previous} to <strong>{status.current}</strong>.
        </p>
        <p className="muted">Your journal is just as you left it.</p>
      </Dialog>
    );
  }

  // "Try again" installs the newest version GitHub knows of, once the check after start has found it.
  const canRetry = status.state === 'available' && status.installer !== null;
  return (
    <Dialog
      open
      onClose={dismiss}
      title="The update didn’t work"
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={dismiss}>
            Not now
          </button>
          <button
            type="button"
            className={canRetry ? 'btn' : 'btn btn-primary'}
            onClick={() => {
              openReleasePage();
              dismiss();
            }}
          >
            <Icon name="download" size={16} /> Get it from GitHub
          </button>
          {canRetry && (
            <button type="button" className="btn btn-primary" onClick={() => void retry()} autoFocus>
              Try again
            </button>
          )}
        </>
      }
    >
      <p>{result.error ?? `mJournal ${result.version} wasn’t installed.`}</p>
      <p className="muted">You still have mJournal {status.current}, and your journal is just as you left it.</p>
    </Dialog>
  );
}
