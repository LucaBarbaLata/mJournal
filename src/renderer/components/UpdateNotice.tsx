/**
 * A quiet note in the sidebar when GitHub has a newer mJournal. "Update" downloads and installs it, and mJournal
 * opens again in the new version; nothing is downloaded before that click. Copies that can't install updates
 * themselves (the portable app) show "Get it", which opens the releases page in the browser. Its headline opens
 * "What's new" (WhatsNewDialog), the release notes of what changes. Afterwards a window says whether the update
 * worked (UpdateResultDialog).
 */
import { useEffect, useMemo, useState } from 'react';
import { todayKey } from '@core/dates';
import { parseReleaseNotes } from '@core/releaseNotes';
import type { UpdateChanges, UpdateStatus } from '@core/updates';
import { api, errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { useUpdateStatus } from '../lib/updates';
import { Sparkle } from './Decorations';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { ReleaseNotes } from './ReleaseNotes';
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

type Changes = { kind: 'asking' } | { kind: 'shown'; changes: UpdateChanges } | { kind: 'failed'; message: string };

/**
 * "What's new": the release notes of every version after this one, up to the newer one, newest first. GitHub is asked
 * when it first opens. "Update" (or "Get it") is right there too.
 */
export function WhatsNewDialog({ status, onClose, onUpdate }: { status: UpdateStatus; onClose: () => void; onUpdate: () => void }) {
  const { format } = useApp();
  const version = status.latest;
  const [changes, setChanges] = useState<Changes>({ kind: 'asking' });
  useEffect(() => {
    let alive = true;
    api.updates.changes().then(
      (next) => alive && setChanges({ kind: 'shown', changes: next }),
      (err: unknown) => alive && setChanges({ kind: 'failed', message: errorMessage(err) }),
    );
    return () => {
      alive = false;
    };
  }, [version]);
  const versions = changes.kind === 'shown' ? changes.changes.releases.length : 0;
  // Versions released without notes are left out.
  const releases = useMemo(
    () =>
      changes.kind === 'shown'
        ? changes.changes.releases
            .map((release) => ({ ...release, blocks: parseReleaseNotes(release.notes) }))
            .filter((release) => release.blocks.length > 0)
        : [],
    [changes],
  );

  const canInstall = status.state === 'available' && status.installer !== null;
  const canGet = status.state === 'available' && status.installer === null;
  // Each version's notes get its name, unless they're only the new version's.
  const several = releases.length > 1 || (releases.length === 1 && releases[0].version !== version);
  const published = (at: string | null) => (at ? `Released ${format.medium(todayKey(new Date(at)))}` : null);
  // When the notes couldn't all be shown, GitHub has them ("Get it" goes there anyway).
  const offerGitHub = !canGet && (changes.kind === 'failed' || (changes.kind === 'shown' && !changes.changes.complete));

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={version ? `What’s new in mJournal ${version}` : 'What’s new'}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {canInstall || canGet ? 'Not now' : 'Close'}
          </button>
          {offerGitHub && (
            <button type="button" className="btn" onClick={openReleasePage}>
              See it on GitHub
            </button>
          )}
          {canInstall && (
            <button
              type="button"
              className="btn btn-primary"
              title={`Download and install mJournal ${version}. mJournal closes and opens again by itself.`}
              onClick={() => {
                onClose();
                onUpdate();
              }}
            >
              <Icon name="download" size={16} /> Update
            </button>
          )}
          {canGet && (
            <button
              type="button"
              className="btn btn-primary"
              title={`Get mJournal ${version} from GitHub`}
              onClick={() => {
                openReleasePage();
                onClose();
              }}
            >
              <Icon name="download" size={16} /> Get it
            </button>
          )}
        </>
      }
    >
      {/* The notes scroll by themselves, so the buttons stay in view. */}
      <div className="whats-new-notes" tabIndex={0} role="region" aria-label="Release notes" aria-busy={changes.kind === 'asking'}>
        {changes.kind === 'asking' && <p className="muted">Asking GitHub what’s new…</p>}
        {changes.kind === 'failed' && <p>{changes.message}</p>}
        {changes.kind === 'shown' && releases.length === 0 && (
          <p className="muted">No notes were written for {versions > 1 ? 'these versions' : 'this version'}.</p>
        )}
        {versions > 1 && releases.length > 0 && (
          <p className="muted">What changed since your version, {status.current}, newest first.</p>
        )}
        {releases.map((release) => {
          const date = published(release.publishedAt);
          return (
            <section key={release.version} className="whats-new-release" aria-label={several ? `mJournal ${release.version}` : undefined}>
              {several && <h3>mJournal {release.version}</h3>}
              {date && <p className="whats-new-date muted">{date}</p>}
              <ReleaseNotes blocks={release.blocks} headingLevel={several ? 4 : 3} />
            </section>
          );
        })}
        {changes.kind === 'shown' && !changes.changes.complete && <p className="muted">Older changes are on GitHub.</p>}
      </div>
    </Dialog>
  );
}

export function UpdateNotice() {
  const { settings, updateSettings } = useApp();
  const [status] = useUpdateStatus();
  const [showChanges, setShowChanges] = useState(false);
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
    <>
      <div className="update-notice" role="status" aria-label="New version">
        <button
          type="button"
          className="update-notice-text update-notice-open"
          title={`See what’s new in mJournal ${version}`}
          onClick={() => setShowChanges(true)}
        >
          <Sparkle size={14} className="update-notice-spark" />
          <span className="update-notice-label">
            <strong>mJournal {version}</strong> is out
            <span className="update-notice-more">See what’s new</span>
          </span>
        </button>
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
      {/* Outside the note, which is a live region: the notes aren't read out as they arrive. */}
      {showChanges && <WhatsNewDialog status={status} onClose={() => setShowChanges(false)} onUpdate={update} />}
    </>
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
