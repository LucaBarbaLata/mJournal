import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_BYTES, sniffImage } from '../../src/main/services/photoFiles';
import { JPEG_1PX, PNG_1PX, WEBP_1PX, openJournal, reopen, tempDir } from './helpers';

const ftyp = (brand: string, ...compatible: string[]) => {
  const brands = [brand, '\0\0\0\0', ...compatible].join('');
  const size = 8 + brands.length;
  const box = Buffer.alloc(size + 16);
  box.writeUInt32BE(size, 0);
  box.write('ftyp', 4, 'ascii');
  box.write(brands, 8, 'binary');
  return Uint8Array.from(box);
};

function storedFiles(root: string): string[] {
  const dir = join(root, 'photos');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((sub) => readdirSync(join(dir, sub)).map((f) => `${sub}/${f}`));
}

describe('image detection', () => {
  it('identifies images by content, not by name', () => {
    expect(sniffImage(PNG_1PX)).toMatchObject({ kind: 'image', ext: 'png' });
    expect(sniffImage(JPEG_1PX)).toMatchObject({ kind: 'image', ext: 'jpg' });
    expect(sniffImage(WEBP_1PX)).toMatchObject({ kind: 'image', ext: 'webp' });
    expect(sniffImage(Uint8Array.from(Buffer.from('GIF89a......')))).toMatchObject({ kind: 'image', ext: 'gif' });
    expect(sniffImage(ftyp('avif', 'mif1', 'miaf'))).toMatchObject({ kind: 'image', ext: 'avif' });
    expect(sniffImage(ftyp('heic', 'mif1', 'heic'))).toEqual({ kind: 'heic' });
    expect(sniffImage(ftyp('isom', 'mp42'))).toEqual({ kind: 'unknown' });
    expect(sniffImage(Uint8Array.from(Buffer.from('%PDF-1.7')))).toEqual({ kind: 'unknown' });
    expect(sniffImage(new Uint8Array())).toEqual({ kind: 'unknown' });
  });
});

describe('photo import', () => {
  it('copies a picked file into the library and keeps the original', async () => {
    const journal = openJournal();
    const source = join(tempDir(), 'beach.png');
    writeFileSync(source, PNG_1PX);
    const result = await journal.photos.importSources('2026-10-24', [{ name: 'beach.png', path: source }]);
    expect(result.rejected).toEqual([]);
    expect(result.imported).toHaveLength(1);
    const photo = result.imported[0];
    expect(photo).toMatchObject({ date: '2026-10-24', originalName: 'beach.png', mime: 'image/png', missing: false });
    expect(photo.url).toBe(`mj-media://photo/${photo.id}`);
    expect(existsSync(source)).toBe(true);
    expect(storedFiles(journal.paths.root)).toHaveLength(1);
    expect(journal.entries.contentDays()).toEqual(['2026-10-24']);
  });

  it('never mixes up two different photos with the same file name', async () => {
    const journal = openJournal();
    const a = join(tempDir(), 'IMG_0001.jpg');
    const b = join(tempDir(), 'IMG_0001.jpg');
    writeFileSync(a, JPEG_1PX);
    writeFileSync(b, Buffer.concat([Buffer.from(JPEG_1PX), Buffer.from([0x00])]));
    const result = await journal.photos.importSources('2026-10-24', [
      { name: 'IMG_0001.jpg', path: a },
      { name: 'IMG_0001.jpg', path: b },
    ]);
    expect(result.imported).toHaveLength(2);
    expect(new Set(storedFiles(journal.paths.root)).size).toBe(2);
    expect(result.imported.map((p) => p.originalName)).toEqual(['IMG_0001.jpg', 'IMG_0001.jpg']);
  });

  it('stores identical images only once', async () => {
    const journal = openJournal();
    await journal.photos.importSources('2026-10-23', [{ name: 'a.png', data: PNG_1PX }]);
    await journal.photos.importSources('2026-10-24', [{ name: 'copy-of-a.png', data: PNG_1PX }]);
    expect(storedFiles(journal.paths.root)).toHaveLength(1);
    expect(journal.photos.forDay('2026-10-23')).toHaveLength(1);
    expect(journal.photos.forDay('2026-10-24')).toHaveLength(1);
  });

  it('rejects files that are not supported images, explaining why', async () => {
    const journal = openJournal();
    const dir = tempDir();
    const big = join(dir, 'huge.jpg');
    writeFileSync(big, Buffer.alloc(MAX_PHOTO_BYTES + 1));
    const result = await journal.photos.importSources('2026-10-24', [
      { name: 'notes.txt', data: Uint8Array.from(Buffer.from('hello')) },
      { name: 'IMG_1.HEIC', data: ftyp('heic', 'mif1', 'heic') },
      { name: 'empty.png', data: new Uint8Array() },
      { name: 'huge.jpg', path: big },
      { name: 'gone.jpg', path: join(dir, 'does-not-exist.jpg') },
      { name: 'folder', path: dir },
    ]);
    expect(result.imported).toEqual([]);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      expect.stringMatching(/supported image/),
      expect.stringMatching(/HEIC/),
      expect.stringMatching(/empty/),
      expect.stringMatching(/25 MB/),
      expect.stringMatching(/couldn.t be found/),
      expect.stringMatching(/isn.t a file/),
    ]);
    expect(storedFiles(journal.paths.root)).toEqual([]);
    expect(journal.entries.contentDays()).toEqual([]);
  });

  it('keeps photos and captions when the entry is edited later', async () => {
    let journal = openJournal();
    const { imported } = await journal.photos.importSources('2026-10-24', [{ name: 'a.png', data: PNG_1PX }]);
    journal.photos.update(imported[0].id, { caption: 'Picnic by the lake', favorite: true });
    journal.entries.update('2026-10-24', { body: 'Edited text' });
    journal = reopen(journal);
    expect(journal.photos.forDay('2026-10-24')).toMatchObject([{ caption: 'Picnic by the lake', favorite: true }]);
    expect(journal.search.search({ text: 'lake' }).results.map((r) => r.date)).toEqual(['2026-10-24']);
  });

  it('allows adding photos to an entry after it was saved', async () => {
    const journal = openJournal();
    journal.entries.update('2026-10-20', { body: 'Saved earlier' });
    await journal.photos.importSources('2026-10-20', [{ name: 'later.webp', data: WEBP_1PX }]);
    expect(journal.photos.forDay('2026-10-20')).toHaveLength(1);
    expect(journal.entries.get('2026-10-20')?.body).toBe('Saved earlier');
  });

  it('shows a missing file gracefully instead of failing', async () => {
    let journal = openJournal();
    const { imported } = await journal.photos.importSources('2026-10-24', [{ name: 'a.png', data: PNG_1PX }]);
    const path = journal.photos.mediaPath('photo', imported[0].id)!;
    rmSync(path);
    journal = reopen(journal);
    const [photo] = journal.photos.forDay('2026-10-24');
    expect(photo.missing).toBe(true);
    expect(journal.photos.stats().missing).toBe(1);
    expect(journal.photos.gallery({})[0].missing).toBe(true);
  });

  it('removes to "Recently removed" and restores without touching files', async () => {
    const journal = openJournal();
    const { imported } = await journal.photos.importSources('2026-10-24', [{ name: 'a.png', data: PNG_1PX }]);
    const id = imported[0].id;
    journal.photos.remove(id);
    expect(journal.photos.forDay('2026-10-24')).toEqual([]);
    expect(journal.photos.listRemoved().map((p) => p.id)).toEqual([id]);
    expect(storedFiles(journal.paths.root)).toHaveLength(1);
    expect(journal.entries.contentDays()).toEqual([]);
    journal.photos.restore(id);
    expect(journal.photos.forDay('2026-10-24').map((p) => p.id)).toEqual([id]);
    expect(journal.entries.contentDays()).toEqual(['2026-10-24']);
  });

  it('deletes a file permanently only when nothing else uses it', async () => {
    const journal = openJournal();
    const first = (await journal.photos.importSources('2026-10-23', [{ name: 'a.png', data: PNG_1PX }])).imported[0];
    const second = (await journal.photos.importSources('2026-10-24', [{ name: 'b.png', data: PNG_1PX }])).imported[0];
    await expect(journal.photos.deleteForever(first.id)).rejects.toThrow(/Remove the photo/);

    journal.photos.remove(first.id);
    await journal.photos.deleteForever(first.id);
    expect(storedFiles(journal.paths.root)).toHaveLength(1); // still used by the second photo

    journal.photos.remove(second.id);
    await journal.photos.deleteForever(second.id);
    expect(storedFiles(journal.paths.root)).toHaveLength(0);
  });

  it('stores thumbnails as a shared cache and validates them', async () => {
    const journal = openJournal();
    const a = (await journal.photos.importSources('2026-10-23', [{ name: 'a.png', data: PNG_1PX }])).imported[0];
    const b = (await journal.photos.importSources('2026-10-24', [{ name: 'b.png', data: PNG_1PX }])).imported[0];
    await expect(journal.photos.saveThumbnail(a.id, PNG_1PX, 1, 1)).rejects.toThrow();
    await journal.photos.saveThumbnail(a.id, WEBP_1PX, 4000, 3000);
    expect(journal.photos.forDay('2026-10-24')[0]).toMatchObject({ id: b.id, hasThumbnail: true, width: 4000, height: 3000 });
    expect(statSync(journal.photos.mediaPath('thumb', a.id)!).size).toBe(WEBP_1PX.length);
  });

  it('reorders photos within a day', async () => {
    const journal = openJournal();
    const { imported } = await journal.photos.importSources('2026-10-24', [
      { name: 'a.png', data: PNG_1PX },
      { name: 'b.jpg', data: JPEG_1PX },
    ]);
    const ids = imported.map((p) => p.id).reverse();
    journal.photos.reorder('2026-10-24', ids);
    expect(journal.photos.forDay('2026-10-24').map((p) => p.id)).toEqual(ids);
    expect(() => journal.photos.reorder('2026-10-24', [ids[0]])).toThrow();
  });

  it('lists the gallery by date with months', async () => {
    const journal = openJournal();
    journal.entries.update('2026-09-30', { mood: 'happy', body: 'September day' });
    await journal.photos.importSources('2026-09-30', [{ name: 'a.png', data: PNG_1PX }]);
    await journal.photos.importSources('2026-10-24', [{ name: 'b.jpg', data: JPEG_1PX }]);
    expect(journal.photos.gallery({}).map((p) => p.date)).toEqual(['2026-10-24', '2026-09-30']);
    expect(journal.photos.gallery({ from: '2026-09-01', to: '2026-09-30' })).toMatchObject([
      { date: '2026-09-30', mood: 'happy', excerpt: 'September day' },
    ]);
    expect(journal.photos.galleryMonths()).toEqual([
      { month: '2026-10', count: 1 },
      { month: '2026-09', count: 1 },
    ]);
  });

  it('does not treat a stray folder entry as a photo', () => {
    const journal = openJournal();
    mkdirSync(join(journal.paths.photos, 'zz'), { recursive: true });
    expect(() => journal.photos.files.absolute('../../evil.png')).toThrow();
    expect(() => journal.photos.files.thumbnailPath('../x')).toThrow();
  });
});
