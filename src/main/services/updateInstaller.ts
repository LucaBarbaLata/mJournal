/**
 * Installs a newer mJournal when the person clicks "Update", never by itself:
 * - Windows (the installed app): downloads the installer, closes mJournal, and the installer replaces it without
 *   showing its windows, in the same folder, then opens it again.
 * - Linux AppImage: downloads the new AppImage beside the old one, puts it in the old one's place (same name, so
 *   shortcuts keep working) and starts it.
 * - Linux .deb: downloads the package and installs it with apt-get once the system has asked for the person's
 *   password (pkexec), then starts the new version.
 * Every file comes from its fixed address on the release's GitHub page, built from the version number, and is
 * checked against the release's SHA256SUMS.txt before it is used. Nothing about the person or their journal is sent.
 */
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { CHECKSUMS_FILE, installerFileName, parseChecksums, releaseFileUrl, type InstallKind } from '@core/updates';
import { UserFacingError } from '@core/validation';
import type { InstallProgress, UpdateInstall } from './updates';

export type InstallTarget =
  /** `workDir`: a folder of mJournal's own for the downloaded installer (emptied before each download). */
  | { kind: 'windows'; workDir: string }
  /** `appImage`: the AppImage file mJournal runs from. */
  | { kind: 'appimage'; appImage: string }
  /** `tempRoot`: where a private folder for the downloaded package is made (removed afterwards). */
  | { kind: 'deb'; tempRoot: string };

export interface InstallerOptions {
  target: InstallTarget;
  /** A GET request that follows redirects (GitHub sends release files from another address). */
  fetch: (url: string, signal: AbortSignal) => Promise<Response>;
  /** Closes mJournal the usual way (saving what is being typed); once the journal is closed, runs `then`. */
  quit: (then?: () => void) => void;
  /** Makes mJournal start again after it has quit. */
  relaunch: () => void;
  /** Runs a program until it ends and resolves with its exit code; rejects when it can't be started. */
  run: (command: string, args: string[]) => Promise<number>;
  /** Starts a program that keeps running after mJournal has quit. */
  startDetached: (command: string, args: string[]) => void;
  /** This process's id (the AppImage's restart waits for it to end). */
  pid?: number;
  /** Where a release file is downloaded from; tests serve their own. */
  fileUrl?: (version: string, file: string) => string;
}

const MAX_CHECKSUMS_BYTES = 64 * 1024;
/** Far above the real size (about 100 MB): only a guard against an endless download. */
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;
/** A download that receives nothing for this long has stalled. */
export const STALL_TIMEOUT_MS = 60_000;

const DOWNLOAD_FAILED = 'mJournal couldn’t download the update. Check your internet connection and try again.';
const STALLED = 'The download stopped. Check your internet connection and try again.';

function downloadError(message: string): UserFacingError {
  return new UserFacingError('update-download', message);
}

function installError(message: string): UserFacingError {
  return new UserFacingError('update-install', message);
}

const WRITE_DENIED = new Set(['EACCES', 'EPERM', 'EROFS']);

/** Where the new AppImage is downloaded: beside the old one, so putting it in place is a rename on the same drive. */
function appImagePart(appImage: string): string {
  return join(dirname(appImage), `.${basename(appImage)}.update`);
}

export class UpdateInstaller implements UpdateInstall {
  readonly kind: InstallKind;
  private busy = false;

  constructor(private readonly options: InstallerOptions) {
    this.kind = options.target.kind;
  }

  async install(version: string, progress: InstallProgress): Promise<void> {
    if (this.busy) throw installError('An update is already being installed.');
    this.busy = true;
    try {
      const file = installerFileName(this.kind, version);
      const sha256 = await this.expectedChecksum(version, file);
      const { target } = this.options;
      switch (target.kind) {
        case 'windows':
          return await this.installForWindows(target.workDir, version, file, sha256, progress);
        case 'appimage':
          return await this.replaceAppImage(target.appImage, version, file, sha256, progress);
        case 'deb':
          return await this.installPackage(target.tempRoot, version, file, sha256, progress);
      }
    } finally {
      this.busy = false;
    }
  }

  /**
   * Removes what an earlier update left behind: the Windows installer (it can't be removed while it runs) or a
   * download that was cut short when mJournal closed. Never rejects.
   */
  async cleanUp(): Promise<void> {
    const { target } = this.options;
    if (this.busy) return;
    const leftover = target.kind === 'windows' ? target.workDir : target.kind === 'appimage' ? appImagePart(target.appImage) : null;
    if (leftover) await rm(leftover, { recursive: true, force: true }).catch(() => undefined);
  }

  private async installForWindows(
    workDir: string,
    version: string,
    file: string,
    sha256: string,
    progress: InstallProgress,
  ): Promise<void> {
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });
    const installer = join(workDir, file);
    try {
      await this.download(version, file, installer, sha256, progress);
    } catch (err) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
    progress.installing();
    // The installer can only replace mJournal's files once mJournal has closed, so it starts afterwards.
    // --updated: an update (it closes a still-running mJournal without asking); /S: no windows, same folder as
    // before; --force-run: open mJournal again when done.
    this.options.quit(() => this.options.startDetached(installer, ['--updated', '/S', '--force-run']));
  }

  private async replaceAppImage(
    appImage: string,
    version: string,
    file: string,
    sha256: string,
    progress: InstallProgress,
  ): Promise<void> {
    const part = appImagePart(appImage);
    try {
      await rm(part, { force: true });
      await this.download(version, file, part, sha256, progress);
      await chmod(part, 0o755);
    } catch (err) {
      await rm(part, { force: true }).catch(() => undefined);
      if (WRITE_DENIED.has((err as NodeJS.ErrnoException).code ?? '')) {
        throw installError(
          `mJournal can’t save files in the folder its AppImage is in (${dirname(appImage)}), so it can’t replace ` +
            'itself. Get the new AppImage from GitHub instead.',
        );
      }
      throw err;
    }
    progress.installing();
    try {
      // The running mJournal keeps its old copy open; the file name now leads to the new one.
      await rename(part, appImage);
    } catch (err) {
      await rm(part, { force: true }).catch(() => undefined);
      throw err;
    }
    // Start the new AppImage once this mJournal has ended (it would otherwise just hand over to the old window).
    // The old AppImage's files disappear when it ends, so the waiting is done by the system's shell, not by
    // mJournal; it gives up waiting after 15 seconds.
    const pid = String(this.options.pid ?? process.pid);
    const waitThenStart = 'i=0; while kill -0 "$1" 2>/dev/null && [ $i -lt 75 ]; do sleep 0.2; i=$((i+1)); done; exec "$0"';
    this.options.quit(() => this.options.startDetached('/bin/sh', ['-c', waitThenStart, appImage, pid]));
  }

  private async installPackage(
    tempRoot: string,
    version: string,
    file: string,
    sha256: string,
    progress: InstallProgress,
  ): Promise<void> {
    // A private folder (only this user can open it) in the shared temporary folder.
    const dir = await mkdtemp(join(tempRoot, 'mjournal-update-'));
    try {
      const pkg = join(dir, file);
      await this.download(version, file, pkg, sha256, progress);
      progress.installing();
      let code: number;
      try {
        // pkexec asks for the password in a window of the system's own. The lock timeout waits for another
        // installation (the system's own updates, say) to finish instead of failing straight away.
        code = await this.options.run('pkexec', ['/usr/bin/apt-get', 'install', '-y', '-o', 'DPkg::Lock::Timeout=120', pkg]);
      } catch {
        throw installError(
          'This system has no way for mJournal to ask for the password the installation needs (pkexec is missing). ' +
            'Get the new .deb from GitHub instead.',
        );
      }
      // 126: the password window was closed; 127: the password wasn't accepted.
      if (code === 126 || code === 127) throw installError('The update wasn’t installed: installing it needs your password.');
      if (code !== 0) {
        throw installError(`The update couldn’t be installed (apt-get stopped with code ${code}). Try again, or get it from GitHub.`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    this.options.relaunch();
    this.options.quit();
  }

  private url(version: string, file: string): string {
    return (this.options.fileUrl ?? releaseFileUrl)(version, file);
  }

  private async expectedChecksum(version: string, file: string): Promise<string> {
    const chunks: Uint8Array[] = [];
    await this.fetchBody(version, CHECKSUMS_FILE, MAX_CHECKSUMS_BYTES, (chunk) => void chunks.push(chunk));
    const sha256 = parseChecksums(Buffer.concat(chunks).toString('utf8')).get(file);
    if (!sha256) {
      throw downloadError(`The mJournal ${version} release has no checksum for ${file}, so mJournal won’t install it. Get it from GitHub instead.`);
    }
    return sha256;
  }

  /** Downloads a release file to `destination` (a new file) and checks it against `sha256`. */
  private async download(version: string, file: string, destination: string, sha256: string, progress: InstallProgress): Promise<void> {
    const hash = createHash('sha256');
    const handle = await open(destination, 'wx', 0o600);
    try {
      await this.fetchBody(version, file, MAX_INSTALLER_BYTES, async (chunk, received, total) => {
        hash.update(chunk);
        for (let offset = 0; offset < chunk.byteLength; ) {
          offset += (await handle.write(chunk, offset)).bytesWritten;
        }
        progress.downloaded(total ? received / total : null);
      });
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (hash.digest('hex') !== sha256) {
      throw downloadError('The downloaded update doesn’t match its checksum, so mJournal didn’t install it. Try again later.');
    }
  }

  /** Streams a release file to `onChunk`. Gives up when it is too big or stalls for STALL_TIMEOUT_MS. */
  private async fetchBody(
    version: string,
    file: string,
    maxBytes: number,
    onChunk: (chunk: Uint8Array, received: number, total: number | null) => Promise<void> | void,
  ): Promise<void> {
    const controller = new AbortController();
    let stalled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        controller.abort();
      }, STALL_TIMEOUT_MS);
    };
    watch();
    try {
      let response: Response;
      try {
        response = await this.options.fetch(this.url(version, file), controller.signal);
      } catch {
        throw downloadError(stalled ? STALLED : DOWNLOAD_FAILED);
      }
      if (response.status === 404) throw downloadError(`GitHub doesn’t have ${file} for mJournal ${version}. Get it from the releases page instead.`);
      if (!response.ok || !response.body) throw downloadError(`GitHub answered ${response.status}. Try again later.`);
      const length = Number(response.headers.get('content-length'));
      const total = Number.isSafeInteger(length) && length > 0 ? length : null;
      if (total !== null && total > maxBytes) throw downloadError(`${file} is much bigger than expected, so mJournal didn’t download it.`);
      const reader = response.body.getReader();
      let received = 0;
      try {
        for (;;) {
          const next = await reader.read().catch(() => {
            throw downloadError(stalled ? STALLED : DOWNLOAD_FAILED);
          });
          if (next.done) break;
          watch();
          received += next.value.byteLength;
          if (received > maxBytes) throw downloadError(`${file} is much bigger than expected, so mJournal didn’t download it.`);
          await onChunk(next.value, received, total);
        }
      } finally {
        reader.releaseLock();
      }
      // A download that ended early fails its checksum.
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
