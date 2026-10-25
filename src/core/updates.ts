/**
 * The update check: the one thing mJournal ever asks the internet, and only
 * while "Check for new versions" is on (or when the person clicks "Check now").
 * It reads which version was released last on GitHub and compares version
 * numbers. It never downloads or installs anything.
 */

/** The GitHub repository mJournal is released from. */
export const RELEASES_REPO = 'LucaBarbaLata/mJournal';
/** GitHub's answer for the newest published release (drafts and pre-releases are never "latest"). */
export const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
/** Where a person downloads the new version. */
export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases/latest`;

/** Automatic checks happen at most this often, also across restarts. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type UpdateState = 'off' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'failed';

export interface UpdateStatus {
  state: UpdateState;
  /** The version that is running. */
  current: string;
  /** The released version when it is newer than this one, otherwise null. */
  latest: string | null;
  /** When GitHub last answered (ISO time), or null if it never has. */
  checkedAt: string | null;
}

const VERSION_RE = /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/;

/** "1.2.3" or "v1.2.3" as numbers. Anything else, pre-releases included, is null. */
export function parseVersion(text: string): [number, number, number] | null {
  const match = VERSION_RE.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** The version in GitHub's latest-release answer ("1.2.3"), or null if it isn't a normal release. */
export function releaseVersion(answer: unknown): string | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const { tag_name: tag, draft, prerelease } = answer as Record<string, unknown>;
  if (typeof tag !== 'string' || draft === true || prerelease === true) return null;
  return parseVersion(tag)?.join('.') ?? null;
}
