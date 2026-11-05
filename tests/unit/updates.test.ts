import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECK_INTERVAL_MS,
  installerFileName,
  isNewerVersion,
  parseChecksums,
  parseVersion,
  releaseFileUrl,
  releaseVersion,
  type UpdateStatus,
} from '@core/updates';
import { UserFacingError } from '@core/validation';
import { RETRY_AFTER_FAILURE_MS, UpdateChecker, type SavedUpdateCheck, type UpdateInstall } from '../../src/main/services/updates';

describe('version numbers', () => {
  it('reads plain and v-prefixed versions, and nothing else', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('v10.0.12')).toEqual([10, 0, 12]);
    for (const text of ['1.2', '1.2.3-beta.1', 'latest', '', 'v1.2.3.4']) expect(parseVersion(text)).toBeNull();
  });

  it('compares versions number by number', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.10.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('v2.0.0', '1.99.99')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.9.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('nonsense', '1.0.0')).toBe(false);
  });

  it('reads the version from GitHub’s latest-release answer', () => {
    expect(releaseVersion({ tag_name: 'v1.4.0', draft: false, prerelease: false })).toBe('1.4.0');
    expect(releaseVersion({ tag_name: 'v1.4.0', prerelease: true })).toBeNull();
    expect(releaseVersion({ tag_name: 'v1.4.0', draft: true })).toBeNull();
    expect(releaseVersion({ tag_name: 'nightly' })).toBeNull();
    expect(releaseVersion({ message: 'Not Found' })).toBeNull();
    expect(releaseVersion(null)).toBeNull();
  });
});

describe('release files', () => {
  it('names the file each kind of copy installs, as the release workflow publishes it', () => {
    expect(installerFileName('windows', '1.2.3')).toBe('mJournal-Setup-1.2.3.exe');
    expect(installerFileName('appimage', '1.2.3')).toBe('mJournal-1.2.3.AppImage');
    expect(installerFileName('deb', '1.2.3')).toBe('mjournal_1.2.3_amd64.deb');
  });

  it('downloads only from the release’s own page on GitHub', () => {
    expect(releaseFileUrl('1.2.3', 'SHA256SUMS.txt')).toBe(
      'https://github.com/LucaBarbaLata/mJournal/releases/download/v1.2.3/SHA256SUMS.txt',
    );
  });

  it('reads SHA256SUMS.txt as sha256sum writes it', () => {
    const a = 'A'.repeat(64);
    const b = 'b'.repeat(64);
    const sums = parseChecksums(`${a}  mJournal-Setup-1.2.3.exe\r\n${b} *mJournal-1.2.3.AppImage\nnot a checksum line\n\n`);
    expect([...sums]).toEqual([
      ['mJournal-Setup-1.2.3.exe', 'a'.repeat(64)],
      ['mJournal-1.2.3.AppImage', b],
    ]);
  });
});

describe('UpdateChecker', () => {
  const START = new Date('2026-10-25T09:00:00.000Z');
  let saved: SavedUpdateCheck | undefined;
  let enabled: boolean;
  let changes: UpdateStatus[];

  // Fake timers also fake the clock the checker reads (new Date()).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    saved = undefined;
    enabled = true;
    changes = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function checker(fetchLatestRelease: () => Promise<unknown>, currentVersion = '1.0.0') {
    const fetch = vi.fn(fetchLatestRelease);
    const updates = new UpdateChecker({
      currentVersion,
      fetchLatestRelease: fetch,
      enabled: () => enabled,
      load: () => saved,
      save: (check) => {
        saved = check;
      },
      onChange: (status) => changes.push(status),
    });
    return { updates, fetch };
  }

  const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  it('finds a newer release, remembers it and says so', async () => {
    const { updates } = checker(async () => ({ tag_name: 'v1.1.0' }));
    expect(updates.status()).toMatchObject({ state: 'idle', latest: null, checkedAt: null });
    const status = await updates.check();
    expect(status).toEqual({
      state: 'available',
      current: '1.0.0',
      latest: '1.1.0',
      checkedAt: START.toISOString(),
      installer: null,
      progress: null,
      installError: null,
    });
    expect(saved).toEqual({ checkedAt: START.toISOString(), released: '1.1.0' });
    expect(changes.map((c) => c.state)).toEqual(['checking', 'available']);
  });

  it('is up to date when the release is this version or older, or nothing is released yet', async () => {
    expect((await checker(async () => ({ tag_name: 'v1.0.0' })).updates.check()).state).toBe('up-to-date');
    expect((await checker(async () => ({ tag_name: 'v0.9.0' })).updates.check()).state).toBe('up-to-date');
    const { updates } = checker(async () => null);
    expect(await updates.check()).toMatchObject({ state: 'up-to-date', latest: null });
    expect(saved?.released).toBeNull();
  });

  it('reports a failed check without throwing, and keeps what it knew', async () => {
    saved = { checkedAt: '2026-10-20T09:00:00.000Z', released: '1.0.0' };
    const offline = checker(async () => {
      throw new Error('offline');
    });
    expect(await offline.updates.check()).toMatchObject({ state: 'failed', checkedAt: '2026-10-20T09:00:00.000Z' });
    expect(saved).toEqual({ checkedAt: '2026-10-20T09:00:00.000Z', released: '1.0.0' });
    expect((await checker(async () => ({ unexpected: true })).updates.check()).state).toBe('failed');
  });

  it('asks only once when checks overlap', async () => {
    const { updates, fetch } = checker(async () => ({ tag_name: 'v1.0.0' }));
    await Promise.all([updates.check(), updates.check()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores a malformed remembered check', () => {
    saved = { checkedAt: 'yesterday', released: 'soon' } as SavedUpdateCheck;
    expect(checker(async () => null).updates.status()).toMatchObject({ state: 'idle', checkedAt: null });
  });

  it('checks automatically soon after start, then about once a day', async () => {
    const { updates, fetch } = checker(async () => ({ tag_name: 'v1.0.0' }));
    updates.start(10_000);
    await wait(9_000);
    expect(fetch).not.toHaveBeenCalled();
    await wait(1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await wait(CHECK_INTERVAL_MS - 1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await wait(1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    updates.stop();
  });

  it('doesn’t ask again on every start when it asked recently', async () => {
    saved = { checkedAt: new Date(START.getTime() - 2 * 60 * 60 * 1000).toISOString(), released: '1.0.0' };
    const { updates, fetch } = checker(async () => ({ tag_name: 'v1.0.0' }));
    updates.start(10_000);
    await wait(CHECK_INTERVAL_MS - 2 * 60 * 60 * 1000 - 1_000);
    expect(fetch).not.toHaveBeenCalled();
    await wait(1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    updates.stop();
  });

  it('tries again a few hours after a failure', async () => {
    let fail = true;
    const { updates, fetch } = checker(async () => {
      if (fail) throw new Error('offline');
      return { tag_name: 'v1.0.0' };
    });
    updates.start(1_000);
    await wait(1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    fail = false;
    await wait(RETRY_AFTER_FAILURE_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(updates.status().state).toBe('up-to-date');
    updates.stop();
  });

  describe('installing', () => {
    function installing(install: UpdateInstall['install']) {
      const fetch = vi.fn(async () => ({ tag_name: 'v1.1.0' }));
      const installer: UpdateInstall = { kind: 'windows', install: vi.fn(install) };
      const updates = new UpdateChecker({
        currentVersion: '1.0.0',
        fetchLatestRelease: fetch,
        enabled: () => true,
        load: () => saved,
        save: (check) => {
          saved = check;
        },
        onChange: (status) => changes.push(status),
        installer,
      });
      return { updates, installer };
    }

    it('downloads and installs the newer version, reporting whole percents', async () => {
      const { updates, installer } = installing(async (_version, progress) => {
        for (const fraction of [null, 0.001, 0.004, 0.5, 0.503, 1]) progress.downloaded(fraction);
        progress.installing();
      });
      await updates.check();
      expect(updates.status()).toMatchObject({ state: 'available', installer: 'windows', installError: null });
      changes = [];
      const status = await updates.install();
      expect(installer.install).toHaveBeenCalledWith('1.1.0', expect.anything());
      expect(changes.map((c) => [c.state, c.progress])).toEqual([
        ['downloading', null],
        ['downloading', 0],
        ['downloading', 0.5],
        ['downloading', 1],
        ['installing', null],
      ]);
      // mJournal is closing; it stays "installing" until it has.
      expect(status).toMatchObject({ state: 'installing', latest: '1.1.0' });
      expect(await updates.install()).toMatchObject({ state: 'installing' });
      expect(installer.install).toHaveBeenCalledTimes(1);
    });

    it('says why installing failed and lets the person try again', async () => {
      let attempt = 0;
      const { updates } = installing(async () => {
        attempt++;
        if (attempt === 1) throw new UserFacingError('update-download', 'The download stopped.');
        throw new Error('disk on fire');
      });
      await updates.check();
      expect(await updates.install()).toMatchObject({ state: 'available', installError: 'The download stopped.' });
      // Anything that isn't meant for the person gets a general message.
      expect((await updates.install()).installError).toMatch(/couldn’t be installed/);
      expect(attempt).toBe(2);
    });

    it('does nothing without a newer version or a way to install it', async () => {
      const { updates, installer } = installing(async () => undefined);
      expect(await updates.install()).toMatchObject({ state: 'idle' });
      expect(installer.install).not.toHaveBeenCalled();

      const { updates: portable } = checker(async () => ({ tag_name: 'v1.1.0' }));
      await portable.check();
      expect(await portable.install()).toMatchObject({ state: 'available', installer: null });
    });
  });

  it('never asks by itself while automatic checks are off', async () => {
    enabled = false;
    const { updates, fetch } = checker(async () => ({ tag_name: 'v1.0.0' }));
    updates.start(0);
    await wait(3 * CHECK_INTERVAL_MS);
    expect(fetch).not.toHaveBeenCalled();
    expect(updates.status().state).toBe('off');
    // Turning them on starts checking again.
    enabled = true;
    updates.settingsChanged();
    await wait(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    updates.stop();
  });
});
