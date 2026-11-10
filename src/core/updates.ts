/**
 * The update check: the one thing mJournal asks the internet by itself, and only
 * while "Check for new versions" is on (or when the person clicks "Check now"):
 * once each time mJournal starts, then about once a day while it stays open.
 * It reads which version was released last on GitHub and compares version
 * numbers. A new version is downloaded and installed only when the person
 * clicks "Update" (main/services/updateInstaller.ts); afterwards a window says
 * whether that worked. What changed is asked for only when the person opens
 * "What's new" (changesBetween).
 */

/** The GitHub repository mJournal is released from. */
export const RELEASES_REPO = 'LucaBarbaLata/mJournal';
/** GitHub's answer for the newest published release (drafts and pre-releases are never "latest"). */
export const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
/** "What's new" reads the notes of this many of the newest releases, which GitHub lists in one answer. */
export const RELEASES_PER_PAGE = 30;
/** GitHub's list of the newest releases with their notes, newest first. */
export const RELEASES_API = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=${RELEASES_PER_PAGE}`;
/** Where a person downloads the new version. */
export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases/latest`;

/** While mJournal stays open, it checks again this long after the last answer (every start checks once too). */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type UpdateState =
  | 'off'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'failed';

/**
 * How a copy of mJournal installs a new version of itself: the installed app on Windows, the AppImage and
 * the .deb on Linux. The portable app and development builds can't.
 */
export type InstallKind = 'windows' | 'appimage' | 'deb';

/**
 * How the last update went, shown once in a window: after mJournal has opened again in the new version, or right
 * away when installing failed while mJournal was still open.
 */
export interface UpdateResult {
  /** 'installed': mJournal now runs `version` (or something newer). 'failed': it doesn't. */
  outcome: 'installed' | 'failed';
  /** The version that was being installed. */
  version: string;
  /** The version that ran when the update started. */
  previous: string;
  /** Why it failed, when mJournal knows; otherwise null. */
  error: string | null;
}

export interface UpdateStatus {
  state: UpdateState;
  /** The version that is running. */
  current: string;
  /** The released version when it is newer than this one, otherwise null. */
  latest: string | null;
  /** When GitHub last answered (ISO time), or null if it never has. */
  checkedAt: string | null;
  /** How this copy installs `latest` itself, or null when it can't (then "Get it" opens the releases page). */
  installer: InstallKind | null;
  /** While downloading: how much has arrived, from 0 to 1, or null while the size isn't known. */
  progress: number | null;
  /** Why the last try to install failed, or null. */
  installError: string | null;
  /** How the last update went, until the person has closed the window that says so; otherwise null. */
  result: UpdateResult | null;
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

/** One release's notes, as written on GitHub (from CHANGELOG.md, by .github/workflows/release.yml). */
export interface ReleaseNotes {
  /** "1.2.3" */
  version: string;
  /** When it was published (ISO time), or null when GitHub didn't say. */
  publishedAt: string | null;
  /** The notes in GitHub's Markdown; empty when none were written. */
  notes: string;
}

/** What changes with an update: the notes of every release after this version, up to the newer one. */
export interface UpdateChanges {
  /** Newest first. */
  releases: ReleaseNotes[];
  /** False when GitHub's list ends before this version, so older changes are only on GitHub. */
  complete: boolean;
}

/** Notes longer than this are cut short (GitHub allows 125,000 characters). */
export const MAX_NOTES_LENGTH = 20_000;

function compareVersions(a: string, b: string): number {
  if (isNewerVersion(a, b)) return -1;
  return isNewerVersion(b, a) ? 1 : 0;
}

/**
 * The releases in GitHub's release list (`answer`) that come after `current`, up to and including `latest`, newest
 * first. Pre-releases in between count too: what they changed is in the newer release as well. Null when the answer
 * isn't a list of releases.
 */
export function changesBetween(answer: unknown, current: string, latest: string): UpdateChanges | null {
  if (!Array.isArray(answer)) return null;
  const releases: ReleaseNotes[] = [];
  // A full page may stop before this version; a shorter one is every release there is.
  let complete = answer.length < RELEASES_PER_PAGE;
  for (const item of answer) {
    if (typeof item !== 'object' || item === null) continue;
    const { tag_name: tag, draft, body, published_at: publishedAt } = item as Record<string, unknown>;
    if (typeof tag !== 'string' || draft === true) continue;
    const version = parseVersion(tag)?.join('.');
    if (!version) continue;
    if (!isNewerVersion(version, current)) {
      complete = true;
      continue;
    }
    if (isNewerVersion(version, latest) || releases.some((release) => release.version === version)) continue;
    releases.push({
      version,
      publishedAt: typeof publishedAt === 'string' && !Number.isNaN(Date.parse(publishedAt)) ? publishedAt : null,
      notes: typeof body === 'string' ? body.slice(0, MAX_NOTES_LENGTH) : '',
    });
  }
  releases.sort((a, b) => compareVersions(a.version, b.version));
  return { releases, complete };
}

/** The release file each kind installs: the names .github/workflows/release.yml publishes. */
export function installerFileName(kind: InstallKind, version: string): string {
  switch (kind) {
    case 'windows':
      return `mJournal-Setup-${version}.exe`;
    case 'appimage':
      return `mJournal-${version}.AppImage`;
    case 'deb':
      return `mjournal_${version}_amd64.deb`;
  }
}

/** Every release lists the SHA-256 of each of its files in this file. */
export const CHECKSUMS_FILE = 'SHA256SUMS.txt';

/** A file of the release of `version` ("1.2.3"), at its fixed address on GitHub: never an address from the network. */
export function releaseFileUrl(version: string, file: string): string {
  return `https://github.com/${RELEASES_REPO}/releases/download/v${version}/${encodeURIComponent(file)}`;
}

/** The checksums in a SHA256SUMS.txt (what `sha256sum` writes): file name → SHA-256 in lowercase hex. */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  // trim() also drops the "\r" of Windows line endings.
  for (const line of text.split('\n')) {
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
    if (match) sums.set(match[2], match[1].toLowerCase());
  }
  return sums;
}
