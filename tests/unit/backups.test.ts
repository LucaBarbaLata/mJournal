import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BackupInspection, LockedBackup } from '../../src/core/api';
import { writeBackup } from '../../src/main/services/backup';
import {
  deriveBackupKey,
  loadBackupKey,
  readEncryptedHeader,
  saveBackupKey,
  type KdfParams,
} from '../../src/main/services/backupCrypto';
import { AUTO_BACKUP_PREFIX, Backups } from '../../src/main/services/backups';
import { listSnapshots, takeSnapshot } from '../../src/main/services/snapshots';
import { PNG_1PX, fakeClock, openHost, tempDir } from './helpers';

/** Cheaper than the real setting, so the tests stay quick; the format is the same. */
const FAST_KDF: KdfParams = { N: 2 ** 14, r: 8, p: 1 };

async function journalWithData(clock = fakeClock('2026-10-24T18:00:00Z')) {
  const host = openHost(tempDir(), clock);
  const j = host.journal;
  j.entries.update('2026-10-22', { body: 'Secret garden', mood: 'happy' });
  await j.photos.importSources('2026-10-22', [{ name: 'a.png', data: PNG_1PX }]);
  return host;
}

const isLocked = (r: BackupInspection | LockedBackup): r is LockedBackup => 'needsPassword' in r;

describe('password-protected backups', () => {
  it('can only be read with the password, and restore completely', async () => {
    const source = await journalWithData();
    const key = await deriveBackupKey('correct horse battery', FAST_KDF);
    const file = join(tempDir(), 'backup.mjbackup');
    const { encrypted } = await writeBackup(source.journal, file, '1.2.0', { key });
    expect(encrypted).toBe(true);
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 8).toString('ascii')).toBe('MJBKENC1');
    // Nothing of the journal is readable in the file.
    expect(bytes.includes(Buffer.from('Secret garden'))).toBe(false);
    expect(bytes.includes(Buffer.from('mjournal-backup.json'))).toBe(false);

    const target = openHost();
    const locked = await target.inspectBackup(file);
    expect(isLocked(locked)).toBe(true);
    const token = (locked as LockedBackup).token;
    await expect(target.unlockBackup(token, 'wrong password')).rejects.toThrow(/doesn.t open this backup/);
    // A wrong password can be followed by the right one.
    const inspection = await target.unlockBackup(token, 'correct horse battery');
    expect(inspection).toMatchObject({ kind: 'backup', encrypted: true, fileName: 'backup.mjbackup', counts: { entries: 1, photos: 1 } });
    await target.restore(inspection.token);
    expect(target.journal.entries.get('2026-10-22')?.body).toBe('Secret garden');
    expect(target.journal.photos.forDay('2026-10-22')).toHaveLength(1);
    // The decrypted copy doesn't stay behind.
    expect(readdirSync(join(target.root, '.tmp'))).toEqual([]);
  });

  it('open without asking when the remembered key made them', async () => {
    const source = await journalWithData();
    const key = await deriveBackupKey('a long phrase to remember', FAST_KDF);
    const file = join(tempDir(), 'backup.mjbackup');
    await writeBackup(source.journal, file, '1.2.0', { key });
    const result = await openHost().inspectBackup(file, key);
    expect(isLocked(result)).toBe(false);
    expect((result as BackupInspection).encrypted).toBe(true);
    // Another key (another password) still has to ask.
    const other = await deriveBackupKey('a long phrase to remember', FAST_KDF);
    expect(isLocked(await openHost().inspectBackup(file, other))).toBe(true);
  });

  it('refuse a changed or incomplete file, explaining that it is damaged', async () => {
    const source = await journalWithData();
    const key = await deriveBackupKey('correct horse battery', FAST_KDF);
    const good = join(tempDir(), 'good.mjbackup');
    await writeBackup(source.journal, good, '1.2.0', { key });
    const original = readFileSync(good);
    const header = (await readEncryptedHeader(good))!;
    const variants: [string, Buffer][] = [
      ['body', Buffer.from(original).fill(0x41, header.dataStart + 20, header.dataStart + 21)],
      ['tag', Buffer.concat([original.subarray(0, -1), Buffer.from([original[original.length - 1] ^ 0xff])])],
      ['truncated', original.subarray(0, Math.floor(original.length / 2))],
    ];
    for (const [name, data] of variants) {
      const file = join(tempDir(), `${name}.mjbackup`);
      writeFileSync(file, data);
      const host = openHost();
      const locked = (await host.inspectBackup(file)) as LockedBackup;
      await expect(host.unlockBackup(locked.token, 'correct horse battery'), name).rejects.toThrow(/damaged or incomplete/);
      expect(readdirSync(join(host.root, '.tmp')), name).toEqual([]);
    }
    // A changed header is noticed too: its salt no longer matches, or the whole header no longer parses.
    const changedHeader = Buffer.from(original);
    changedHeader[12 + 5] ^= 0x01;
    const headerFile = join(tempDir(), 'header.mjbackup');
    writeFileSync(headerFile, changedHeader);
    await expect(
      (async () => {
        const host = openHost();
        const locked = (await host.inspectBackup(headerFile)) as LockedBackup;
        await host.unlockBackup(locked.token, 'correct horse battery');
      })(),
    ).rejects.toThrow(/damaged|doesn.t open/);
    // An absurd header length is refused before anything else happens.
    const huge = Buffer.from(original);
    huge.writeUInt32BE(10_000_000, 8);
    const hugeFile = join(tempDir(), 'huge.mjbackup');
    writeFileSync(hugeFile, huge);
    await expect(openHost().inspectBackup(hugeFile)).rejects.toThrow(/damaged/);
  });

  it('leave ordinary .zip backups working as before', async () => {
    const source = await journalWithData();
    const file = join(tempDir(), 'plain.zip');
    await writeBackup(source.journal, file, '1.2.0');
    const key = await deriveBackupKey('correct horse battery', FAST_KDF);
    const result = await openHost().inspectBackup(file, key);
    expect(result).toMatchObject({ kind: 'backup', encrypted: false, counts: { entries: 1 } });
  });

  it('remember the key, never the password, outside the database', async () => {
    const host = openHost();
    const backups = new Backups(() => host.journal, '1.2.0');
    await expect(backups.setPassword('short')).rejects.toThrow(/at least 8 characters/);
    await backups.setPassword('a perfectly good passphrase');
    expect(backups.status().encrypted).toBe(true);
    const stored = readFileSync(host.journal.paths.backupKey, 'utf8');
    expect(stored).not.toContain('perfectly');
    expect(loadBackupKey(host.journal.paths.backupKey)?.key).toHaveLength(32);
    // A damaged key file counts as no password rather than breaking backups.
    writeFileSync(host.journal.paths.backupKey, '{"version":1}');
    expect(backups.status().encrypted).toBe(false);
    await backups.setPassword(null);
    expect(existsSync(host.journal.paths.backupKey)).toBe(false);
  });
});

describe('automatic backups', () => {
  function setup() {
    const clock = fakeClock('2026-10-24T18:00:00Z');
    const host = openHost(tempDir(), clock);
    const folder = tempDir();
    const backups = new Backups(() => host.journal, '1.2.0');
    host.journal.entries.update('2026-10-24', { body: 'Worth keeping' });
    return { clock, host, folder, backups };
  }

  it('run only when switched on, with a folder, and when one is due', async () => {
    const { clock, host, folder, backups } = setup();
    expect(backups.isDue()).toBe(false);
    host.journal.settings.update({ autoBackup: true, autoBackupFrequency: 'daily' });
    expect(backups.isDue()).toBe(false); // no folder yet
    backups.setFolder(folder);
    expect(backups.isDue()).toBe(true);
    await backups.runIfDue();
    const files = readdirSync(folder);
    expect(files).toEqual([`${AUTO_BACKUP_PREFIX}2026-10-24-${files[0].slice(-8, -4)}.zip`]);
    expect(backups.status()).toMatchObject({ lastError: null, lastAuto: { file: files[0] } });
    expect(backups.status().lastBackupAt).not.toBeNull();
    clock.advance(10 * 3600 * 1000);
    expect(backups.isDue()).toBe(false);
    clock.advance(11 * 3600 * 1000);
    expect(backups.isDue()).toBe(true);
    host.journal.settings.update({ autoBackupFrequency: 'weekly' });
    expect(backups.isDue()).toBe(false);
  });

  it('keep only the newest few and never touch other files', async () => {
    const { clock, host, folder, backups } = setup();
    writeFileSync(join(folder, 'holiday-photos.zip'), 'not ours');
    writeFileSync(join(folder, 'mJournal-backup-2026-01-01-1200.zip'), 'made by hand');
    host.journal.settings.update({ autoBackup: true, autoBackupKeep: 5 });
    backups.setFolder(folder);
    for (let i = 0; i < 7; i++) {
      await backups.run();
      clock.advance(7 * 24 * 3600 * 1000);
    }
    const ours = readdirSync(folder).filter((n) => n.startsWith(AUTO_BACKUP_PREFIX)).sort();
    expect(ours).toHaveLength(5);
    expect(ours[0]).toContain('2026-11-07'); // the two oldest (24 and 31 October) were removed
    expect(existsSync(join(folder, 'holiday-photos.zip'))).toBe(true);
    expect(existsSync(join(folder, 'mJournal-backup-2026-01-01-1200.zip'))).toBe(true);
  });

  it('are password-protected when a password is set', async () => {
    const { host, folder, backups } = setup();
    await saveBackupKey(host.journal.paths.backupKey, await deriveBackupKey('correct horse battery', FAST_KDF), new Date());
    backups.setFolder(folder);
    await backups.run();
    const [file] = readdirSync(folder);
    expect(file).toMatch(/\.mjbackup$/);
    expect(readFileSync(join(folder, file)).subarray(0, 8).toString('ascii')).toBe('MJBKENC1');
  });

  it('say clearly when the folder is missing, and try again later', async () => {
    const { host, folder, backups } = setup();
    host.journal.settings.update({ autoBackup: true });
    backups.setFolder(join(folder, 'usb-stick-not-plugged-in'));
    expect(backups.status().folderAvailable).toBe(false);
    await expect(backups.run()).rejects.toThrow(/isn.t available right now/);
    await backups.runIfDue(); // the scheduled check never throws
    expect(backups.status().lastError?.message).toMatch(/is the drive connected/);
    mkdirSync(join(folder, 'usb-stick-not-plugged-in'));
    await backups.runIfDue();
    expect(backups.status()).toMatchObject({ lastError: null, folderAvailable: true });
  });

  it('suggest a backup on Today only when it has been a while', async () => {
    const { clock, host, backups } = setup();
    for (let i = 1; i <= 6; i++) host.journal.entries.update(`2026-10-${String(i).padStart(2, '0')}`, { mood: 'calm' });
    expect(backups.status().remind).toBe(true); // 7 days, never backed up
    backups.snoozeReminder();
    expect(backups.status().remind).toBe(false);
    clock.advance(15 * 24 * 3600 * 1000);
    expect(backups.status().remind).toBe(true);
    backups.noteManualBackup();
    expect(backups.status().remind).toBe(false);
    clock.advance(31 * 24 * 3600 * 1000);
    expect(backups.status().remind).toBe(true);
  });
});

describe('restoring a daily snapshot', () => {
  it('puts the database back as it was and keeps photos and the current one', async () => {
    const host = await journalWithData();
    const j = host.journal;
    const snapshot = takeSnapshot(j);
    const name = snapshot.split(/[\\/]/).pop()!;
    j.entries.update('2026-10-22', { body: 'Accidentally deleted everything' });
    j.entries.update('2026-10-23', { mood: 'tired' });

    const inspection = await host.inspectSnapshot(name);
    expect(inspection).toMatchObject({ kind: 'snapshot', fileName: name, counts: { entries: 1, photos: 1 }, current: { entries: 2 }, warnings: [] });
    const { previousDataPath } = await host.restore(inspection.token);
    expect(host.journal.entries.get('2026-10-22')?.body).toBe('Secret garden');
    expect(host.journal.entries.get('2026-10-23')).toBeNull();
    expect(host.journal.photos.forDay('2026-10-22')[0].missing).toBe(false);
    expect(readdirSync(previousDataPath)).toEqual(['mjournal.db']);
    // The snapshot itself is still there for another time.
    expect(listSnapshots(host.journal.paths.snapshots).map((s) => s.name)).toContain(name);
  });

  it('warns about photos that are gone since, and refuses unknown names', async () => {
    const host = await journalWithData();
    const name = takeSnapshot(host.journal).split(/[\\/]/).pop()!;
    for (const sub of readdirSync(host.journal.paths.photos)) rmSync(join(host.journal.paths.photos, sub), { recursive: true });
    const inspection = await host.inspectSnapshot(name);
    expect(inspection.warnings[0]).toMatch(/1 photo this snapshot mentions is no longer/);
    await host.cancelRestore(inspection.token);
    expect(readdirSync(join(host.root, '.tmp'))).toEqual([]);
    await expect(host.inspectSnapshot('mJournal-snapshot-1999-01-01-0000.db')).rejects.toThrow(/could not be found/);
    await expect(host.inspectSnapshot('../mjournal.db')).rejects.toThrow(/could not be found/);
  });
});
