/**
 * A quiet note in the sidebar when GitHub has a newer mJournal. "Update" downloads and installs it, and mJournal
 * opens again in the new version; nothing is downloaded before that click. Copies that can't install updates
 * themselves (the portable app) show "Get it", which opens the releases page in the browser.
 */
import type { UpdateStatus } from '@core/updates';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { useUpdateStatus } from '../lib/updates';
import { Sparkle } from './Decorations';
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

  const update = async () => {
    const next = await installUpdate();
    if (next?.installError) toast(next.installError, { label: 'Get it', onClick: openReleasePage }, 10_000);
  };

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
            onClick={() => void update()}
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
