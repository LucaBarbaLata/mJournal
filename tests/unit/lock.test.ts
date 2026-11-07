import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_METHODS } from '@core/api';
import { AUTO_LOCK_MINUTES, FREE_TRIES, isValidPin, wrongPinPause } from '@core/lock';
import type { UpdateStatus } from '@core/updates';
import { createApi, OPEN_WHILE_LOCKED, type Platform } from '../../src/main/api';
import { AppLock } from '../../src/main/lock';
import { dataPaths } from '../../src/main/paths';
import { writeBackup } from '../../src/main/services/backup';
import { fakeClock, openHost, tempDir } from './helpers';

function lockIn(dir = tempDir(), clock = fakeClock()) {
  const file = join(dir, 'lock.json');
  const load = () => AppLock.load(file, { now: () => clock().getTime() });
  return { file, clock, load, lock: load() };
}

/** A lock with PIN 2468, loaded again as after a restart (so it starts locked). */
async function lockedWithPin() {
  const setup = lockIn();
  await setup.lock.setPin(null, '2468');
  return { ...setup, lock: setup.load() };
}

describe('PIN rules', () => {
  it('accept 4 to 8 digits only', () => {
    for (const pin of ['1234', '00000000', '9081726']) expect(isValidPin(pin)).toBe(true);
    for (const pin of ['123', '123456789', '12a4', ' 1234', '12 34', '١٢٣٤', '', 1234, null]) expect(isValidPin(pin)).toBe(false);
  });

  it('pause longer and longer after a few wrong PINs', () => {
    for (let n = 0; n < FREE_TRIES; n++) expect(wrongPinPause(n)).toBe(0);
    expect(wrongPinPause(FREE_TRIES)).toBe(30_000);
    expect(wrongPinPause(FREE_TRIES + 1)).toBe(60_000);
    expect(wrongPinPause(FREE_TRIES + 2)).toBe(300_000);
    expect(wrongPinPause(FREE_TRIES + 3)).toBe(900_000);
    expect(wrongPinPause(500)).toBe(900_000);
  });
});

describe('The PIN lock', () => {
  it('is off until a PIN is set, and locking then does nothing', () => {
    const { lock, file } = lockIn();
    expect(lock.status()).toMatchObject({ enabled: false, locked: false });
    expect(lock.lock().locked).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it('keeps only a salted hash of the PIN, never the PIN itself', async () => {
    const { lock, file } = lockIn();
    const status = await lock.setPin(null, '2468');
    expect(status).toMatchObject({ enabled: true, locked: false, autoLockMinutes: 5 });
    const saved = readFileSync(file, 'utf8');
    expect(saved).not.toContain('2468');
    expect(JSON.parse(saved).pin).toMatchObject({ algorithm: 'scrypt', N: 32768, r: 8, p: 1 });
    // The same PIN set again gets a different salt and hash.
    const first = JSON.parse(saved).pin.hash;
    await lock.setPin('2468', '2468');
    expect(JSON.parse(readFileSync(file, 'utf8')).pin.hash).not.toBe(first);
    // The interface only ever sees the status.
    expect(JSON.stringify(lock.status())).not.toMatch(/hash|salt|2468/);
  });

  it('starts locked and opens with the right PIN only', async () => {
    const { lock } = await lockedWithPin();
    expect(lock.status()).toMatchObject({ enabled: true, locked: true, triesBeforePause: FREE_TRIES });
    expect((await lock.unlock('1357')).locked).toBe(true);
    expect((await lock.unlock('not a pin')).locked).toBe(true);
    expect(lock.status().triesBeforePause).toBe(FREE_TRIES - 2);
    expect((await lock.unlock('2468')).locked).toBe(false);
    // A success forgets the wrong tries.
    expect(lock.status().triesBeforePause).toBe(FREE_TRIES);
    expect(lock.lock().locked).toBe(true);
  });

  it('pauses after too many wrong PINs, even for the right one, and the pause survives a restart', async () => {
    const { lock, load, clock } = await lockedWithPin();
    for (let n = 0; n < FREE_TRIES; n++) await lock.unlock('0000');
    const paused = lock.status();
    expect(paused.retryAt).toBe(new Date(clock().getTime() + 30_000).toISOString());
    expect(paused.triesBeforePause).toBe(0);
    expect((await lock.unlock('2468')).locked).toBe(true);

    const restarted = load();
    expect(restarted.status().retryAt).toBe(paused.retryAt);
    expect((await restarted.unlock('2468')).locked).toBe(true);

    clock.advance(30_000);
    expect(restarted.status().retryAt).toBeNull();
    // The next wrong PIN pauses for longer.
    await restarted.unlock('0000');
    expect(restarted.status().retryAt).toBe(new Date(clock().getTime() + 60_000).toISOString());
    clock.advance(60_000);
    expect((await restarted.unlock('2468')).locked).toBe(false);
  });

  it('checks tries one at a time, so many sent at once still pause', async () => {
    const { lock, file } = await lockedWithPin();
    await Promise.all(Array.from({ length: 12 }, () => lock.unlock('1111')));
    // Only the tries before the pause were checked; the rest waited and were refused unchecked.
    expect(JSON.parse(readFileSync(file, 'utf8')).failures).toBe(FREE_TRIES);
    expect(lock.status().retryAt).not.toBeNull();
    expect(lock.isLocked()).toBe(true);
  });

  it('needs the current PIN to change or turn it off', async () => {
    const { lock, file, load } = lockIn();
    await lock.setPin(null, '2468');
    await expect(lock.setPin(null, '1111')).rejects.toMatchObject({ code: 'wrong-pin' });
    await expect(lock.setPin('9999', '1111')).rejects.toMatchObject({ code: 'wrong-pin' });
    await expect(lock.setPin('2468', '12')).rejects.toThrow(/4 to 8 digits/);
    await lock.setPin('2468', '13579');

    const restarted = load();
    expect((await restarted.unlock('2468')).locked).toBe(true);
    expect((await restarted.unlock('13579')).locked).toBe(false);

    await expect(restarted.removePin('2468')).rejects.toMatchObject({ code: 'wrong-pin' });
    expect(await restarted.removePin('13579')).toMatchObject({ enabled: false, locked: false });
    expect(existsSync(file)).toBe(false);
  });

  it('pauses wrong current PINs in Settings too', async () => {
    const { lock } = lockIn();
    await lock.setPin(null, '2468');
    for (let n = 0; n < FREE_TRIES; n++) await expect(lock.removePin('0000')).rejects.toMatchObject({ code: 'wrong-pin' });
    await expect(lock.removePin('2468')).rejects.toMatchObject({ code: 'pin-pause', message: /30 seconds/ });
  });

  it('refuses changes while locked', async () => {
    const { lock } = await lockedWithPin();
    await expect(lock.setPin('2468', '1111')).rejects.toMatchObject({ code: 'locked' });
    await expect(lock.removePin('2468')).rejects.toMatchObject({ code: 'locked' });
    await expect(lock.setAutoLock(15)).rejects.toMatchObject({ code: 'locked' });
  });

  it('remembers when to lock automatically', async () => {
    const { lock, load } = lockIn();
    await expect(lock.setAutoLock(15)).rejects.toMatchObject({ code: 'no-pin' });
    await lock.setPin(null, '2468');
    await expect(lock.setAutoLock(7)).rejects.toThrow(/Invalid/);
    for (const minutes of AUTO_LOCK_MINUTES) expect((await lock.setAutoLock(minutes)).autoLockMinutes).toBe(minutes);
    await lock.setAutoLock(30);
    expect(load().status().autoLockMinutes).toBe(30);
  });

  it('tells listeners about every change', async () => {
    const { lock } = lockIn();
    const seen: boolean[] = [];
    lock.subscribe((status) => seen.push(status.locked));
    await lock.setPin(null, '2468');
    lock.lock();
    await lock.unlock('2468');
    expect(seen).toEqual([false, true, false]);
  });

  it('opens without a PIN when lock.json is damaged or edited to be unusable', () => {
    const dir = tempDir();
    const file = join(dir, 'lock.json');
    writeFileSync(file, '{ not json');
    expect(AppLock.load(file).status().enabled).toBe(false);
    const huge = { version: 1, pin: { algorithm: 'scrypt', N: 2 ** 30, r: 8, p: 1, salt: 'AAAA', hash: Buffer.alloc(32).toString('base64') } };
    writeFileSync(file, JSON.stringify(huge));
    expect(AppLock.load(file).status().enabled).toBe(false);
  });

  it('is not part of backups, so restoring one keeps the current PIN', async () => {
    const source = openHost();
    source.journal.entries.update('2026-10-20', { body: 'From the backup' });
    const sourceLock = AppLock.load(dataPaths(source.root).lock);
    await sourceLock.setPin(null, '1111');
    const archive = join(tempDir(), 'backup.zip');
    const { manifest } = await writeBackup(source.journal, archive, '1.0.0');
    expect(JSON.stringify(manifest)).not.toContain('lock.json');

    const target = openHost();
    const lockFile = dataPaths(target.root).lock;
    await AppLock.load(lockFile).setPin(null, '2222');
    const before = readFileSync(lockFile, 'utf8');
    await target.restore((await target.inspectBackup(archive)).token);
    expect(target.journal.entries.get('2026-10-20')?.body).toBe('From the backup');
    expect(readFileSync(lockFile, 'utf8')).toBe(before);
    expect((await AppLock.load(lockFile).unlock('2222')).locked).toBe(false);
  });
});

describe('While locked, the API', () => {
  const OFF: UpdateStatus = {
    state: 'off',
    current: '1.0.0',
    latest: null,
    checkedAt: null,
    installer: null,
    progress: null,
    installError: null,
    result: null,
  };
  const platform: Platform = {
    appVersion: '1.0.0-test',
    platformName: 'test',
    notificationsSupported: false,
    chooseImages: async () => [],
    chooseBackupFile: async () => null,
    chooseFolder: async () => null,
    desktopStatus: () => ({ canOpenAtLogin: false, canKeepInTray: true, trayShown: false, shortcut: null }),
    portableApp: false,
    journalBesideApp: false,
    chooseSaveLocation: async () => null,
    showItemInFolder: () => undefined,
    openFolder: async () => undefined,
    settingsChanged: () => undefined,
    updates: {
      status: () => OFF,
      check: async () => OFF,
      install: async () => OFF,
      dismissResult: () => OFF,
    },
    openReleasePage: async () => undefined,
  };

  it('only lets the interface ask about the lock and unlock it', async () => {
    const host = openHost();
    host.journal.entries.update('2026-10-20', { body: 'Private words' });
    const appLock = AppLock.load(dataPaths(host.root).lock);
    await appLock.setPin(null, '2468');
    appLock.lock();
    const api = createApi(host, platform, appLock);

    // Every method outside the short list is refused, whatever its arguments.
    for (const [namespace, methods] of Object.entries(API_METHODS)) {
      for (const method of methods) {
        if (OPEN_WHILE_LOCKED.has(`${namespace}.${method}`)) continue;
        const call = (api as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>)[namespace][method];
        await expect(call(), `${namespace}.${method}`).rejects.toMatchObject({ code: 'locked' });
      }
    }
    expect((await api.lock.status()).locked).toBe(true);
    expect((await api.lock.unlock('0000')).locked).toBe(true);
    expect((await api.lock.unlock('2468')).locked).toBe(false);
    expect((await api.entries.getDay('2026-10-20')).entry?.body).toBe('Private words');
    expect((await api.lock.lock()).locked).toBe(true);
    await expect(api.entries.getDay('2026-10-20')).rejects.toMatchObject({ code: 'locked' });
  });

  it('lists only real methods as open', () => {
    for (const name of OPEN_WHILE_LOCKED) {
      const [namespace, method] = name.split('.');
      expect((API_METHODS as Record<string, readonly string[]>)[namespace]).toContain(method);
    }
    expect([...OPEN_WHILE_LOCKED].sort()).toEqual(['lock.lock', 'lock.status', 'lock.unlock']);
  });
});
