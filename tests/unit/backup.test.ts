import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { describe, expect, it } from 'vitest';
import { dataPaths } from '../../src/main/paths';
import { MANIFEST_NAME, writeBackup, type BackupManifest } from '../../src/main/services/backup';
import { swapInStagedBackup } from '../../src/main/services/restore';
import { maybeTakeDailySnapshot, takeSnapshot, listSnapshots } from '../../src/main/services/snapshots';
import { JPEG_1PX, PNG_1PX, fakeClock, openHost as openTestHost, tempDir } from './helpers';
import { makeZip } from './zipUtil';

const openHost = (dir = tempDir()) => openTestHost(dir, fakeClock('2026-10-24T18:00:00Z'));

async function readZip(file: string): Promise<Map<string, Buffer>> {
  const zip = await yauzl.openPromise(file, { lazyEntries: true, autoClose: false });
  const files = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      zip.openReadStream(entry, (err, stream) => {
        if (err) return reject(err);
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => {
          files.set(entry.fileName, Buffer.concat(chunks));
          zip.readEntry();
        });
      });
    });
    zip.on('end', () => resolve());
    zip.on('error', reject);
    zip.readEntry();
  });
  zip.close();
  return files;
}

/** A journal with a bit of everything in it. */
async function fullJournal() {
  const host = openHost();
  const j = host.journal;
  j.entries.update('2026-10-22', { body: 'Picnic day', mood: 'happy', energy: 5, favorite: true });
  j.entries.saveAnswer('2026-10-22', { promptId: 'joy-02', promptText: 'Who or what made me smile?', answer: 'Mia' });
  const photos = await j.photos.importSources('2026-10-22', [
    { name: 'a.png', data: PNG_1PX },
    { name: 'b.jpg', data: JPEG_1PX },
  ]);
  j.photos.update(photos.imported[0].id, { caption: 'Blanket and berries' });
  j.photos.remove(photos.imported[1].id); // in "Recently removed": still part of the backup
  j.entries.update('2026-10-23', { mood: 'tired' });
  j.reflections.save('2026-10', 'letter', 'Dear me, well done.');
  j.moods.create({ label: 'Cozy', icon: 'heart', color: 'peach' });
  j.prompts.createCustom('What did I cook?');
  j.settings.update({ theme: 'dark', displayName: 'Mia' });
  return host;
}

describe('complete backups', () => {
  it('contain a manifest, the database and every photo', async () => {
    const host = await fullJournal();
    const target = join(tempDir(), 'mJournal-backup.zip');
    const { manifest } = await writeBackup(host.journal, target, '1.0.0');
    expect(existsSync(target)).toBe(true);
    expect(existsSync(`${target}.partial`)).toBe(false);
    expect(manifest).toMatchObject({
      app: 'mJournal',
      kind: 'mjournal-backup',
      formatVersion: 1,
      schemaVersion: 1,
      counts: { entries: 2, photos: 1, monthlyReflections: 1 },
      missingPhotos: [],
    });
    expect(manifest.photos).toHaveLength(2);
    const files = await readZip(target);
    expect([...files.keys()].sort()).toEqual([MANIFEST_NAME, 'mjournal.db', ...manifest.photos.map((p) => p.path)].sort());
    expect(JSON.parse(files.get(MANIFEST_NAME)!.toString('utf8'))).toEqual(manifest);
  });

  it('restore into another journal, replacing it and keeping the old one', async () => {
    const source = await fullJournal();
    const archive = join(tempDir(), 'backup.zip');
    await writeBackup(source.journal, archive, '1.0.0');

    const target = openHost();
    target.journal.entries.update('2026-01-01', { body: 'This journal will be replaced' });
    const inspection = await target.inspectBackup(archive);
    expect(inspection).toMatchObject({
      fileName: 'backup.zip',
      counts: { entries: 2, photos: 1, monthlyReflections: 1 },
      current: { entries: 1, photos: 0 },
      warnings: [],
    });
    // Nothing has changed until the user confirms.
    expect(target.journal.entries.get('2026-01-01')?.body).toBe('This journal will be replaced');

    const { previousDataPath } = await target.restore(inspection.token);
    const j = target.journal;
    expect(j.entries.get('2026-01-01')).toBeNull();
    expect(j.entries.get('2026-10-22')).toMatchObject({ body: 'Picnic day', mood: 'happy', energy: 5, favorite: true });
    expect(j.entries.answers('2026-10-22').map((a) => a.answer)).toEqual(['Mia']);
    expect(j.photos.forDay('2026-10-22')).toMatchObject([{ caption: 'Blanket and berries', missing: false }]);
    expect(j.photos.listRemoved()).toHaveLength(1);
    expect(j.photos.listRemoved()[0].missing).toBe(false);
    expect(j.reflections.reflection('2026-10').answers.letter).toBe('Dear me, well done.');
    expect(j.moods.list().some((m) => m.label === 'Cozy')).toBe(true);
    expect(j.prompts.library().some((p) => p.text === 'What did I cook?')).toBe(true);
    expect(j.settings.get()).toMatchObject({ theme: 'dark', displayName: 'Mia' });
    expect(j.search.search({ text: 'berries' }).results).toHaveLength(1);

    // The replaced journal is kept, complete, in the backups folder.
    expect(previousDataPath).toMatch(/previous-journal-/);
    expect(readdirSync(previousDataPath)).toContain('mjournal.db');
    expect(readdirSync(join(target.root, '.tmp'))).toEqual([]);
  });

  it('can be cancelled after checking, leaving everything as it was', async () => {
    const source = await fullJournal();
    const archive = join(tempDir(), 'backup.zip');
    await writeBackup(source.journal, archive, '1.0.0');
    const target = openHost();
    target.journal.entries.update('2026-01-01', { body: 'Keep me' });
    const inspection = await target.inspectBackup(archive);
    await target.cancelRestore(inspection.token);
    expect(target.journal.entries.get('2026-01-01')?.body).toBe('Keep me');
    expect(readdirSync(join(target.root, '.tmp'))).toEqual([]);
    await expect(target.restore(inspection.token)).rejects.toThrow(/expired/);
  });

  it('notes photos that were already missing when the backup was made', async () => {
    const source = await fullJournal();
    const photo = source.journal.photos.forDay('2026-10-22')[0];
    const { rmSync } = await import('node:fs');
    rmSync(source.journal.photos.mediaPath('photo', photo.id)!);
    const archive = join(tempDir(), 'backup.zip');
    const { manifest } = await writeBackup(source.journal, archive, '1.0.0');
    expect(manifest.missingPhotos).toHaveLength(1);
    const inspection = await openHost().inspectBackup(archive);
    expect(inspection.warnings[0]).toMatch(/1 photo was already missing/);
  });
});

describe('invalid or unsafe backups are rejected without touching the journal', () => {
  async function expectRejected(archiveBytes: Buffer, pattern: RegExp) {
    const host = openHost();
    host.journal.entries.update('2026-10-24', { body: 'Untouched' });
    const file = join(tempDir(), 'suspicious.zip');
    writeFileSync(file, archiveBytes);
    await expect(host.inspectBackup(file)).rejects.toThrow(pattern);
    expect(host.journal.entries.get('2026-10-24')?.body).toBe('Untouched');
    // No half-extracted files are left behind.
    const staging = join(host.root, '.tmp');
    expect(existsSync(staging) ? readdirSync(staging) : []).toEqual([]);
  }

  async function goodBackupFiles() {
    const host = await fullJournal();
    const archive = join(tempDir(), 'good.zip');
    const { manifest } = await writeBackup(host.journal, archive, '1.0.0');
    return { files: await readZip(archive), manifest, archive };
  }

  it('random bytes and empty files', async () => {
    await expectRejected(Buffer.from('not a zip at all'), /isn.t an mJournal backup/);
    await expectRejected(Buffer.alloc(0), /isn.t an mJournal backup/);
  });

  it('a truncated archive', async () => {
    const { archive } = await goodBackupFiles();
    const bytes = readFileSync(archive);
    await expectRejected(bytes.subarray(0, Math.floor(bytes.length / 2)), /isn.t an mJournal backup|damaged/);
  });

  it('paths that escape the folder, absolute paths and links', async () => {
    const manifest = Buffer.from('{}');
    await expectRejected(makeZip([{ name: MANIFEST_NAME, data: manifest }, { name: '../evil.txt', data: Buffer.from('x') }]), /unsafe/);
    await expectRejected(makeZip([{ name: '/etc/passwd', data: Buffer.from('x') }]), /unsafe/);
    await expectRejected(makeZip([{ name: 'C:/Windows/evil.dll', data: Buffer.from('x') }]), /unsafe/);
    await expectRejected(makeZip([{ name: 'photos\\..\\evil.txt', data: Buffer.from('x') }]), /unsafe/);
    await expectRejected(makeZip([{ name: 'photos/ab/link', data: Buffer.from('/etc'), mode: 0o120777 }]), /link to another location/);
  });

  it('unexpected files and missing pieces', async () => {
    const { files } = await goodBackupFiles();
    const entries = [...files].map(([name, data]) => ({ name, data }));
    await expectRejected(makeZip([...entries, { name: 'run-me.exe', data: Buffer.from('MZ') }]), /unexpected file/);
    await expectRejected(makeZip(entries.filter((e) => e.name !== MANIFEST_NAME)), /complete mJournal backup/);
    await expectRejected(makeZip(entries.filter((e) => e.name !== 'mjournal.db')), /complete mJournal backup/);
    await expectRejected(makeZip(entries.filter((e) => !e.name.startsWith('photos/'))), /don.t match its manifest/);
  });

  it('a manifest that lies or is from the future', async () => {
    const { files, manifest } = await goodBackupFiles();
    const withManifest = (m: unknown) =>
      makeZip([...files].map(([name, data]) => ({ name, data: name === MANIFEST_NAME ? Buffer.from(JSON.stringify(m)) : data })));
    await expectRejected(withManifest({ ...manifest, kind: 'something-else' }), /isn.t an mJournal backup/);
    await expectRejected(withManifest({ ...manifest, schemaVersion: 99 }), /newer version/);
    await expectRejected(withManifest({ ...manifest, formatVersion: 2 }), /newer version/);
    await expectRejected(withManifest({ ...manifest, database: { ...manifest.database, sha256: 'f'.repeat(64) } }), /integrity check/);
    const photo = manifest.photos[0];
    const swapped: BackupManifest = { ...manifest, photos: [{ ...photo, sha256: manifest.photos[1].sha256 }, manifest.photos[1]] };
    await expectRejected(withManifest(swapped), /malformed/);
    await expectRejected(makeZip([...files].map(([name, data]) => ({ name, data: name === MANIFEST_NAME ? Buffer.from('{oops') : data }))), /not readable/);
  });

  it('a tampered database or photo', async () => {
    const { files } = await goodBackupFiles();
    const tampered = (target: (name: string) => boolean) =>
      makeZip(
        [...files].map(([name, data]) => {
          if (!target(name)) return { name, data };
          const copy = Buffer.from(data);
          copy[copy.length - 1] ^= 0xff;
          return { name, data: copy };
        }),
      );
    await expectRejected(tampered((n) => n === 'mjournal.db'), /integrity check/);
    await expectRejected(tampered((n) => n.startsWith('photos/')), /integrity check/);
  });
});

describe('restore swap', () => {
  it('puts the original journal back if the swap fails', async () => {
    const host = openHost();
    host.journal.entries.update('2026-10-24', { body: 'Original' });
    const paths = dataPaths(host.root);
    host.journal.close();
    const emptyStaging = tempDir(); // has no mjournal.db, so the swap must fail
    await expect(swapInStagedBackup(paths, emptyStaging, new Date())).rejects.toThrow();
    expect(existsSync(paths.database)).toBe(true);
    expect(existsSync(paths.photos)).toBe(true);
    const reopened = openHost(host.root);
    expect(reopened.journal.entries.get('2026-10-24')?.body).toBe('Original');
  });
});

describe('daily safety snapshots', () => {
  it('are taken at most once a day and keep the newest ten', () => {
    const clock = fakeClock('2026-10-01T09:00:00Z');
    const j = openTestHost(tempDir(), clock).journal;
    expect(maybeTakeDailySnapshot(j)).toBeNull(); // nothing to protect yet
    j.entries.update('2026-10-01', { body: 'hello' });
    expect(maybeTakeDailySnapshot(j)).not.toBeNull();
    expect(maybeTakeDailySnapshot(j)).toBeNull(); // same day
    for (let i = 0; i < 12; i++) {
      clock.advance(24 * 3600 * 1000);
      takeSnapshot(j);
    }
    const snapshots = listSnapshots(j.paths.snapshots).filter((s) => s.name.startsWith('mJournal-snapshot-'));
    expect(snapshots).toHaveLength(10);
    j.settings.update({ autoSnapshots: false });
    clock.advance(48 * 3600 * 1000);
    expect(maybeTakeDailySnapshot(j)).toBeNull();
  });
});
