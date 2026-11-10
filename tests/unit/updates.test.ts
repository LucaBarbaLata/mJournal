import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  changesBetween,
  CHECK_INTERVAL_MS,
  installerFileName,
  MAX_NOTES_LENGTH,
  RELEASES_PER_PAGE,
  isNewerVersion,
  parseChecksums,
  parseVersion,
  releaseFileUrl,
  releaseVersion,
  type UpdateStatus,
} from '@core/updates';
import { UserFacingError } from '@core/validation';
import {
  RETRY_AFTER_FAILURE_MS,
  UpdateChecker,
  type PendingUpdate,
  type SavedUpdateCheck,
  type UpdateInstall,
} from '../../src/main/services/updates';

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

describe('what’s new', () => {
  const release = (tag: string, notes: string, extra: Record<string, unknown> = {}) => ({
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: '2026-11-08T16:44:11Z',
    body: notes,
    ...extra,
  });

  it('takes the releases after this version up to the newer one, newest first', () => {
    const answer = [
      release('v1.4.0', 'Too new: not the version on offer'),
      release('v1.3.0', 'Trackers'),
      release('v1.2.1', 'A release candidate counts too', { prerelease: true }),
      release('v1.2.5', 'Unfinished', { draft: true }),
      release('v1.2.0', 'This version'),
      release('v1.1.0', 'Older'),
      release('nightly', 'Not a version'),
      'nonsense',
      release('v1.2.2', 'Listed out of order', { published_at: 'soon', body: 42 }),
    ];
    expect(changesBetween(answer, '1.2.0', '1.3.0')).toEqual({
      releases: [
        { version: '1.3.0', publishedAt: '2026-11-08T16:44:11Z', notes: 'Trackers' },
        { version: '1.2.2', publishedAt: null, notes: '' },
        { version: '1.2.1', publishedAt: '2026-11-08T16:44:11Z', notes: 'A release candidate counts too' },
      ],
      complete: true,
    });
  });

  it('says when GitHub’s list may stop before this version', () => {
    const page = Array.from({ length: RELEASES_PER_PAGE }, (_, i) => release(`v2.${RELEASES_PER_PAGE - i}.0`, ''));
    expect(changesBetween(page, '1.0.0', `2.${RELEASES_PER_PAGE}.0`)?.complete).toBe(false);
    expect(changesBetween(page.slice(1), '1.0.0', `2.${RELEASES_PER_PAGE}.0`)?.complete).toBe(true);
    expect(changesBetween([...page.slice(1), release('v1.0.0', '')], '1.0.0', '9.0.0')?.complete).toBe(true);
  });

  it('cuts very long notes short and ignores an answer that isn’t a list', () => {
    const [long] = changesBetween([release('v1.1.0', 'x'.repeat(MAX_NOTES_LENGTH + 10))], '1.0.0', '1.1.0')!.releases;
    expect(long.notes).toHaveLength(MAX_NOTES_LENGTH);
    expect(changesBetween({ message: 'Not Found' }, '1.0.0', '1.1.0')).toBeNull();
    expect(changesBetween(null, '1.0.0', '1.1.0')).toBeNull();
  });

  it('asks GitHub when it’s opened, once while the newer version stays the same, and again after a failure', async () => {
    let online = false;
    const fetchReleases = vi.fn(async () => {
      if (!online) throw new Error('offline');
      return [release('v1.1.0', 'New things'), release('v1.0.0', 'Old things')];
    });
    const updates = new UpdateChecker({
      currentVersion: '1.0.0',
      fetchLatestRelease: async () => ({ tag_name: 'v1.1.0' }),
      fetchReleases,
      enabled: () => true,
      load: () => undefined,
      save: () => undefined,
      onChange: () => undefined,
    });
    // Nothing newer known yet: nothing to ask.
    expect(await updates.changes()).toEqual({ releases: [], complete: true });
    expect(fetchReleases).not.toHaveBeenCalled();

    await updates.check();
    await expect(updates.changes()).rejects.toMatchObject({ name: 'UserFacingError', message: expect.stringMatching(/online/) });
    online = true;
    const [first, second] = await Promise.all([updates.changes(), updates.changes()]);
    expect(first).toEqual({ releases: [{ version: '1.1.0', publishedAt: '2026-11-08T16:44:11Z', notes: 'New things' }], complete: true });
    expect(second).toEqual(first);
    expect(await updates.changes()).toEqual(first);
    expect(fetchReleases).toHaveBeenCalledTimes(2);
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
      result: null,
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

  it('asks on every start, even when it asked a moment ago, then a day after that', async () => {
    saved = { checkedAt: new Date(START.getTime() - 5 * 60 * 1000).toISOString(), released: '1.0.0' };
    const { updates, fetch } = checker(async () => ({ tag_name: 'v1.1.0' }));
    updates.start(3_000);
    await wait(2_999);
    expect(fetch).not.toHaveBeenCalled();
    await wait(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(updates.status()).toMatchObject({ state: 'available', latest: '1.1.0' });
    await wait(CHECK_INTERVAL_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    updates.stop();
  });

  it('checks soon after automatic checks are turned on, even when it asked recently before this start', async () => {
    enabled = false;
    saved = { checkedAt: new Date(START.getTime() - 5 * 60 * 1000).toISOString(), released: '1.0.0' };
    const { updates, fetch } = checker(async () => ({ tag_name: 'v1.0.0' }));
    updates.start(3_000);
    await wait(60_000);
    expect(fetch).not.toHaveBeenCalled();
    enabled = true;
    updates.settingsChanged();
    await wait(3_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    // Off and on again after that: this start has asked already, so the next check is a day after the answer.
    enabled = false;
    updates.settingsChanged();
    enabled = true;
    updates.settingsChanged();
    await wait(CHECK_INTERVAL_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(fetch).toHaveBeenCalledTimes(2);
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
    let pending: PendingUpdate | null | undefined;
    beforeEach(() => {
      pending = undefined;
    });

    function installing(install: UpdateInstall['install'], currentVersion = '1.0.0') {
      const fetch = vi.fn(async () => ({ tag_name: 'v1.1.0' }));
      const installer: UpdateInstall = { kind: 'windows', install: vi.fn(install) };
      const updates = new UpdateChecker({
        currentVersion,
        fetchLatestRelease: fetch,
        enabled: () => true,
        load: () => saved,
        save: (check) => {
          saved = check;
        },
        loadPending: () => pending,
        savePending: (next) => {
          pending = next;
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
      // mJournal is closing; it stays "installing" until it has. The next start says how it went.
      expect(status).toMatchObject({ state: 'installing', latest: '1.1.0', result: null });
      expect(pending).toEqual({ version: '1.1.0', previous: '1.0.0' });
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
      expect(await updates.install()).toMatchObject({
        state: 'available',
        installError: 'The download stopped.',
        result: { outcome: 'failed', version: '1.1.0', previous: '1.0.0', error: 'The download stopped.' },
      });
      // Anything that isn't meant for the person gets a general message.
      expect((await updates.install()).installError).toMatch(/couldn’t be installed/);
      expect(updates.status().result?.error).toMatch(/couldn’t be installed/);
      expect(attempt).toBe(2);
      // mJournal stayed open and said so, so the next start has nothing to report.
      expect(pending).toBeNull();
    });

    it('forgets the update it started when installing fails after the download', async () => {
      const { updates } = installing(async (_version, progress) => {
        progress.installing();
        expect(pending).toEqual({ version: '1.1.0', previous: '1.0.0' });
        throw new UserFacingError('update-install', 'The update wasn’t installed: installing it needs your password.');
      });
      await updates.check();
      expect((await updates.install()).result).toMatchObject({ outcome: 'failed', error: expect.stringMatching(/password/) });
      expect(pending).toBeNull();
    });

    it('says after the next start that the update worked, until the person has seen it', () => {
      pending = { version: '1.1.0', previous: '1.0.0' };
      const { updates } = installing(async () => undefined, '1.1.0');
      expect(updates.status().result).toEqual({ outcome: 'installed', version: '1.1.0', previous: '1.0.0', error: null });
      changes = [];
      expect(updates.dismissResult().result).toBeNull();
      expect(changes).toHaveLength(1);
      expect(pending).toBeNull();
      expect(installing(async () => undefined, '1.1.0').updates.status().result).toBeNull();
    });

    it('counts a version newer than the one it installed as worked', () => {
      pending = { version: '1.1.0', previous: '1.0.0' };
      expect(installing(async () => undefined, '1.2.0').updates.status().result?.outcome).toBe('installed');
    });

    it('says after the next start that the update didn’t work when this is still the old version', async () => {
      pending = { version: '1.1.0', previous: '1.0.0' };
      const { updates, installer } = installing(async () => undefined);
      expect(updates.status().result).toEqual({ outcome: 'failed', version: '1.1.0', previous: '1.0.0', error: null });
      // Trying again replaces it.
      await updates.check();
      await updates.install();
      expect(installer.install).toHaveBeenCalledTimes(1);
      expect(updates.status().result).toBeNull();
      expect(pending).toBeNull();
    });

    it('ignores a malformed remembered update', () => {
      pending = { version: 'soon', previous: '1.0.0' } as PendingUpdate;
      expect(installing(async () => undefined).updates.status().result).toBeNull();
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
