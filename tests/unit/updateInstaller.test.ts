import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@core/validation';
import { STALL_TIMEOUT_MS, UpdateInstaller, type InstallTarget } from '../../src/main/services/updateInstaller';
import type { InstallProgress } from '../../src/main/services/updates';
import { tempDir } from './helpers';

const VERSION = '1.2.0';
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

/** A stand-in for GitHub's release files, sent in a few pieces like a real download. */
function release(files: Record<string, Uint8Array | string>, options: { status?: number; sums?: string } = {}) {
  const sums =
    options.sums ??
    Object.entries(files)
      .map(([name, data]) => `${sha256(data)}  ${name}`)
      .join('\n');
  const all: Record<string, Uint8Array | string> = { ...files, 'SHA256SUMS.txt': sums };
  const requested: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    requested.push(url);
    const name = url.slice(url.lastIndexOf('/') + 1);
    const data = all[name];
    if (options.status || data === undefined) return new Response('Not Found', { status: options.status ?? 404 });
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const pieces = [bytes.subarray(0, bytes.length >> 1), bytes.subarray(bytes.length >> 1)];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = pieces.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
    });
    return new Response(body, { headers: { 'content-length': String(bytes.length) } });
  });
  return { fetch, requested };
}

function setup(target: InstallTarget, fetch: (url: string, signal: AbortSignal) => Promise<Response>, exitCode = 0) {
  const events: string[] = [];
  const quit = vi.fn((then?: () => void) => {
    events.push('quit');
    then?.();
  });
  const relaunch = vi.fn(() => void events.push('relaunch'));
  const run = vi.fn(async (command: string, args: string[]) => {
    events.push(`run ${command} ${args.slice(0, -1).join(' ')}`);
    // The package must still be there while it's being installed.
    expect(existsSync(args[args.length - 1])).toBe(true);
    return exitCode;
  });
  const startDetached = vi.fn((command: string, args: string[]) => void events.push(`start ${command}`));
  const installer = new UpdateInstaller({
    target,
    fetch,
    quit,
    relaunch,
    run,
    startDetached,
    pid: 4242,
    fileUrl: (version, file) => `https://example.test/v${version}/${file}`,
  });
  const fractions: (number | null)[] = [];
  const progress: InstallProgress = {
    downloaded: (fraction) => void fractions.push(fraction),
    installing: () => void events.push('installing'),
  };
  return { installer, progress, events, fractions, quit, relaunch, run, startDetached };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('UpdateInstaller on Windows', () => {
  it('downloads the installer, checks it, closes mJournal and then starts it silently', async () => {
    const workDir = join(tempDir(), 'mJournal-update');
    const exe = 'MZ pretend installer';
    const { fetch, requested } = release({ 'mJournal-Setup-1.2.0.exe': exe });
    const { installer, progress, events, fractions, startDetached } = setup({ kind: 'windows', workDir }, fetch);

    await installer.install(VERSION, progress);

    expect(requested).toEqual([
      'https://example.test/v1.2.0/SHA256SUMS.txt',
      'https://example.test/v1.2.0/mJournal-Setup-1.2.0.exe',
    ]);
    expect(fractions.at(-1)).toBe(1);
    expect(events).toEqual(['installing', 'quit', `start ${join(workDir, 'mJournal-Setup-1.2.0.exe')}`]);
    expect(startDetached.mock.calls[0][1]).toEqual(['--updated', '/S', '--force-run']);
    expect(readFileSync(join(workDir, 'mJournal-Setup-1.2.0.exe'), 'utf8')).toBe(exe);

    // The next start removes it.
    await installer.cleanUp();
    expect(existsSync(workDir)).toBe(false);
  });

  it('refuses a download that doesn’t match its checksum, and keeps mJournal open', async () => {
    const workDir = join(tempDir(), 'mJournal-update');
    const { fetch } = release({ 'mJournal-Setup-1.2.0.exe': 'tampered' }, { sums: `${sha256('original')}  mJournal-Setup-1.2.0.exe` });
    const { installer, progress, quit } = setup({ kind: 'windows', workDir }, fetch);

    const error = await installer.install(VERSION, progress).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toMatch(/doesn’t match its checksum/);
    expect(existsSync(workDir)).toBe(false);
    expect(quit).not.toHaveBeenCalled();
  });

  it('refuses a release without a checksum for the file', async () => {
    const workDir = join(tempDir(), 'mJournal-update');
    const { fetch, requested } = release({ 'mJournal-Setup-1.2.0.exe': 'x' }, { sums: `${sha256('x')}  something-else.exe` });
    const { installer, progress, quit } = setup({ kind: 'windows', workDir }, fetch);
    await expect(installer.install(VERSION, progress)).rejects.toThrow(/has no checksum for mJournal-Setup-1.2.0.exe/);
    expect(requested).toHaveLength(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it('explains what GitHub answered', async () => {
    const workDir = join(tempDir(), 'mJournal-update');
    const missing = setup({ kind: 'windows', workDir }, release({}, { status: 404 }).fetch);
    await expect(missing.installer.install(VERSION, missing.progress)).rejects.toThrow(
      /GitHub doesn’t have SHA256SUMS.txt for mJournal 1.2.0/,
    );
    const busy = release({ 'mJournal-Setup-1.2.0.exe': 'x' }, { status: 503 });
    const { installer, progress } = setup({ kind: 'windows', workDir }, busy.fetch);
    await expect(installer.install(VERSION, progress)).rejects.toThrow(/GitHub answered 503/);
    const offline = setup({ kind: 'windows', workDir }, async () => {
      throw new TypeError('fetch failed');
    });
    await expect(offline.installer.install(VERSION, offline.progress)).rejects.toThrow(/Check your internet connection/);
  });

  it('gives up on a download that stalls', async () => {
    vi.useFakeTimers();
    const workDir = join(tempDir(), 'mJournal-update');
    const sums = `${sha256('x')}  mJournal-Setup-1.2.0.exe`;
    let call = 0;
    let downloading!: () => void;
    const started = new Promise<void>((resolve) => (downloading = resolve));
    const fetch = async (_url: string, signal: AbortSignal) => {
      call++;
      if (call === 1) return new Response(sums);
      // Sends nothing until it is aborted.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      downloading();
      return new Response(body);
    };
    const { installer, progress, quit } = setup({ kind: 'windows', workDir }, fetch);
    const result = installer.install(VERSION, progress).catch((err: unknown) => err);
    await started;
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS - 1);
    expect(quit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(((await result) as Error).message).toMatch(/The download stopped/);
    expect(quit).not.toHaveBeenCalled();
  });
});

describe('UpdateInstaller for the AppImage', () => {
  it('puts the new AppImage in the old one’s place and starts it once mJournal has ended', async () => {
    const dir = tempDir();
    const appImage = join(dir, 'mJournal-1.1.1.AppImage');
    writeFileSync(appImage, 'old version');
    const { fetch } = release({ 'mJournal-1.2.0.AppImage': 'new version' });
    const { installer, progress, events, startDetached } = setup({ kind: 'appimage', appImage }, fetch);

    await installer.install(VERSION, progress);

    expect(readFileSync(appImage, 'utf8')).toBe('new version');
    expect(readdirSync(dir)).toEqual(['mJournal-1.1.1.AppImage']);
    if (process.platform !== 'win32') expect(statSync(appImage).mode & 0o777).toBe(0o755);
    expect(events).toEqual(['installing', 'quit', 'start /bin/sh']);
    const [, args] = startDetached.mock.calls[0];
    expect(args.slice(2)).toEqual([appImage, '4242']);
  });

  it('leaves the old AppImage alone when the download is wrong', async () => {
    const dir = tempDir();
    const appImage = join(dir, 'mJournal.AppImage');
    writeFileSync(appImage, 'old version');
    const { fetch } = release({ 'mJournal-1.2.0.AppImage': 'tampered' }, { sums: `${sha256('new')}  mJournal-1.2.0.AppImage` });
    const { installer, progress, quit } = setup({ kind: 'appimage', appImage }, fetch);
    await expect(installer.install(VERSION, progress)).rejects.toThrow(/checksum/);
    expect(readFileSync(appImage, 'utf8')).toBe('old version');
    expect(readdirSync(dir)).toEqual(['mJournal.AppImage']);
    expect(quit).not.toHaveBeenCalled();
  });

  it('removes a download that was cut short when mJournal closed', async () => {
    const dir = tempDir();
    const appImage = join(dir, 'mJournal.AppImage');
    writeFileSync(appImage, 'old version');
    writeFileSync(join(dir, '.mJournal.AppImage.update'), 'half a download');
    await setup({ kind: 'appimage', appImage }, release({}).fetch).installer.cleanUp();
    expect(readdirSync(dir)).toEqual(['mJournal.AppImage']);
  });
});

describe('UpdateInstaller for the .deb', () => {
  it('installs the package with apt-get after asking for the password, then starts the new version', async () => {
    const tempRoot = tempDir();
    const { fetch } = release({ 'mjournal_1.2.0_amd64.deb': 'package' });
    const { installer, progress, events, run } = setup({ kind: 'deb', tempRoot }, fetch);

    await installer.install(VERSION, progress);

    expect(events).toEqual([
      'installing',
      'run pkexec /usr/bin/apt-get install -y -o DPkg::Lock::Timeout=120',
      'relaunch',
      'quit',
    ]);
    expect(run.mock.calls[0][1].at(-1)).toMatch(/mjournal_1\.2\.0_amd64\.deb$/);
    // The downloaded package is gone afterwards.
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it('keeps mJournal open when the password window is closed', async () => {
    const tempRoot = tempDir();
    const { fetch } = release({ 'mjournal_1.2.0_amd64.deb': 'package' });
    const { installer, progress, quit, relaunch } = setup({ kind: 'deb', tempRoot }, fetch, 126);
    await expect(installer.install(VERSION, progress)).rejects.toThrow(/needs your password/);
    expect(quit).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
    expect(readdirSync(tempRoot)).toEqual([]);
  });

  it('reports a failed installation', async () => {
    const tempRoot = tempDir();
    const { fetch } = release({ 'mjournal_1.2.0_amd64.deb': 'package' });
    const { installer, progress, quit } = setup({ kind: 'deb', tempRoot }, fetch, 100);
    await expect(installer.install(VERSION, progress)).rejects.toThrow(/apt-get stopped with code 100/);
    expect(quit).not.toHaveBeenCalled();
  });
});
