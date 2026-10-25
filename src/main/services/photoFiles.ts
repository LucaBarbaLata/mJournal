/**
 * Photo files on disk.
 *
 * Imported photos are copied (never moved) into the data folder under a name
 * derived from their SHA-256 hash: photos/ab/ab12…ef.jpg. Identical files are
 * stored once, and two different photos can never collide even if they had
 * the same original name. Thumbnails are a cache in thumbnails/<hash>.webp
 * and can always be regenerated.
 */
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from './fsutil';

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
export const PHOTO_EXTENSIONS = ['jpg', 'png', 'webp', 'gif', 'avif'] as const;
export const PHOTO_FILE_RE = /^[0-9a-f]{2}\/[0-9a-f]{64}\.(jpg|png|webp|gif|avif)$/;
const SHA_RE = /^[0-9a-f]{64}$/;

export type SniffResult =
  | { kind: 'image'; mime: string; ext: (typeof PHOTO_EXTENSIONS)[number] }
  | { kind: 'heic' }
  | { kind: 'unknown' };

const ascii = (data: Uint8Array, start: number, end: number) => String.fromCharCode(...data.subarray(start, end));

/** Identifies an image by its first bytes rather than trusting the file extension. */
export function sniffImage(data: Uint8Array): SniffResult {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  }
  if (data.length >= 8 && ascii(data, 0, 8) === '\x89PNG\r\n\x1a\n') {
    return { kind: 'image', mime: 'image/png', ext: 'png' };
  }
  if (data.length >= 6 && (ascii(data, 0, 6) === 'GIF87a' || ascii(data, 0, 6) === 'GIF89a')) {
    return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  }
  if (data.length >= 12 && ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 12) === 'WEBP') {
    return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  }
  if (data.length >= 16 && ascii(data, 4, 8) === 'ftyp') {
    const boxSize = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
    const end = Math.min(Math.max(boxSize, 16), data.length, 256);
    const brands = [ascii(data, 8, 12)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(data, i, i + 4));
    if (brands.includes('avif') || brands.includes('avis')) return { kind: 'image', mime: 'image/avif', ext: 'avif' };
    if (brands.some((b) => ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(b))) {
      return { kind: 'heic' };
    }
  }
  return { kind: 'unknown' };
}

export class PhotoRejection extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'PhotoRejection';
  }
}

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface StoredPhoto {
  file: string;
  sha256: string;
  mime: string;
  bytes: number;
}

export class PhotoFiles {
  constructor(
    readonly photosDir: string,
    readonly thumbsDir: string,
  ) {}

  /** Absolute path of a stored photo. Only accepts the names this class creates. */
  absolute(file: string): string {
    if (!PHOTO_FILE_RE.test(file)) throw new Error('Unexpected photo file name.');
    return join(this.photosDir, ...file.split('/'));
  }

  thumbnailPath(hash: string): string {
    if (!SHA_RE.test(hash)) throw new Error('Unexpected photo hash.');
    return join(this.thumbsDir, `${hash}.webp`);
  }

  exists(file: string): boolean {
    try {
      return existsSync(this.absolute(file));
    } catch {
      return false;
    }
  }

  sizeOf(file: string): number {
    try {
      return statSync(this.absolute(file)).size;
    } catch {
      return 0;
    }
  }

  /** Reads a file the user picked, enforcing the size limit before loading it. */
  async readSource(path: string): Promise<Uint8Array> {
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new PhotoRejection("This file couldn't be found or opened.");
    }
    if (!info.isFile()) throw new PhotoRejection("This isn't a file.");
    if (info.size > MAX_PHOTO_BYTES) throw new PhotoRejection('This photo is larger than 25 MB.');
    try {
      return await readFile(path);
    } catch {
      throw new PhotoRejection("This file couldn't be read.");
    }
  }

  /** Validates image bytes and copies them into the library (once per unique image). */
  async store(data: Uint8Array): Promise<StoredPhoto> {
    if (data.length === 0) throw new PhotoRejection('This file is empty.');
    if (data.length > MAX_PHOTO_BYTES) throw new PhotoRejection('This photo is larger than 25 MB.');
    const type = sniffImage(data);
    if (type.kind === 'heic') {
      throw new PhotoRejection("HEIC photos aren't supported yet. Please save a JPEG copy first.");
    }
    if (type.kind !== 'image') {
      throw new PhotoRejection("This file isn't a supported image (JPEG, PNG, WebP, GIF or AVIF).");
    }
    const hash = sha256(data);
    const file = `${hash.slice(0, 2)}/${hash}.${type.ext}`;
    const target = this.absolute(file);
    // Identical bytes are already stored: reuse them instead of duplicating.
    if (!existsSync(target) || statSync(target).size !== data.length) {
      await writeFileAtomic(target, data);
    }
    return { file, sha256: hash, mime: type.mime, bytes: data.length };
  }

  async writeThumbnail(hash: string, data: Uint8Array): Promise<void> {
    const type = sniffImage(data);
    if (type.kind !== 'image' || type.mime !== 'image/webp' || data.length > MAX_THUMBNAIL_BYTES) {
      throw new PhotoRejection('Invalid thumbnail.');
    }
    await writeFileAtomic(this.thumbnailPath(hash), data);
  }

  /** Deletes a stored photo and its thumbnail. Callers must check nothing references it. */
  async deleteStored(file: string, hash: string): Promise<void> {
    await rm(this.absolute(file), { force: true });
    await rm(this.thumbnailPath(hash), { force: true });
  }
}
