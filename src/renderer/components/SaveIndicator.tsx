/** Shows whether everything on screen is saved. Uses words and icons, not color alone. */
import { useApp } from '../lib/app';
import { saveQueue, useSaveStatus } from '../lib/saveQueue';
import { Icon } from './Icon';

export function SaveIndicator() {
  const { status, lastSavedAt, error } = useSaveStatus();
  const { format } = useApp();

  if (status === 'error') {
    return (
      <div className="save-indicator error" role="alert">
        <Icon name="info" size={16} />
        <span title={error ?? undefined}>Not saved yet</span>
        <button type="button" className="link-btn" onClick={() => saveQueue.retry()}>
          Try again
        </button>
      </div>
    );
  }
  const text =
    status === 'saving'
      ? 'Saving…'
      : status === 'pending'
        ? 'Unsaved changes'
        : lastSavedAt
          ? `Saved ${format.time(new Date(lastSavedAt).toISOString())}`
          : 'All saved';
  return (
    <div className={`save-indicator ${status}`} aria-live="polite" data-testid="save-status" data-status={status}>
      {status === 'saving' ? (
        <span className="spinner" aria-hidden="true" />
      ) : status === 'pending' ? (
        <span className="pending-dot" aria-hidden="true" />
      ) : (
        <Icon key={lastSavedAt ?? 'start'} name="check" size={15} strokeWidth={2.2} className="draw-check" />
      )}
      <span>{text}</span>
    </div>
  );
}
