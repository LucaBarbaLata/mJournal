/**
 * A quiet note in the sidebar when GitHub has a newer mJournal. Nothing is
 * downloaded: "Get it" opens the releases page in the browser.
 */
import { api, errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { useUpdateStatus } from '../lib/updates';
import { Sparkle } from './Decorations';
import { Icon } from './Icon';
import { toast } from './Toasts';

export function openReleasePage(): void {
  api.updates.openReleasePage().catch((err: unknown) => toast(errorMessage(err)));
}

export function UpdateNotice() {
  const { settings, updateSettings } = useApp();
  const [status] = useUpdateStatus();
  const version = status?.state === 'available' ? status.latest : null;
  if (!version || !settings.checkForUpdates || settings.dismissedUpdate === version) return null;

  return (
    <div className="update-notice" role="status" aria-label="New version">
      <p className="update-notice-text">
        <Sparkle size={14} className="update-notice-spark" />
        <span className="update-notice-label">
          <strong>mJournal {version}</strong> is out
        </span>
      </p>
      <div className="update-notice-actions">
        <button type="button" className="btn btn-sm btn-primary" title={`Get mJournal ${version} from GitHub`} onClick={openReleasePage}>
          <Icon name="download" size={14} />
          <span className="update-notice-label">Get it</span>
        </button>
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
