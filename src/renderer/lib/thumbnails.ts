/**
 * Thumbnail generation. Photos are decoded by the browser engine (which
 * respects EXIF orientation), scaled down with high-quality resampling and
 * stored as small WebP files by the main process. Thumbnails are only a
 * cache: if one is missing it is simply made again.
 */
import type { PhotoRecord } from '@core/api';
import { api } from './api';
import { invalidate } from './data';

const MAX_EDGE = 560;
const CONCURRENCY = 2;

const queued = new Set<string>();
const failed = new Set<string>();
const waiting: PhotoRecord[] = [];
let running = 0;

async function makeThumbnail(photo: PhotoRecord): Promise<void> {
  const response = await fetch(photo.url);
  if (!response.ok) throw new Error('Photo file unavailable');
  const source = await createImageBitmap(await response.blob());
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const resized = await createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(resized, 0, 0);
    resized.close();
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.84 });
    await api.photos.saveThumbnail(photo.id, new Uint8Array(await blob.arrayBuffer()), source.width, source.height);
  } finally {
    source.close();
  }
}

function pump(): void {
  while (running < CONCURRENCY && waiting.length > 0) {
    const photo = waiting.shift()!;
    running++;
    makeThumbnail(photo)
      .then(() => invalidate('photos'))
      .catch(() => failed.add(photo.id))
      .finally(() => {
        running--;
        queued.delete(photo.id);
        pump();
      });
  }
}

/** Queues thumbnail creation for photos that don't have one yet. */
export function ensureThumbnails(photos: readonly PhotoRecord[]): void {
  for (const photo of photos) {
    if (photo.hasThumbnail || photo.missing || queued.has(photo.id) || failed.has(photo.id)) continue;
    queued.add(photo.id);
    waiting.push(photo);
  }
  pump();
}

/** True when the browser could not decode the photo (damaged or unsupported file). */
export function thumbnailFailed(id: string): boolean {
  return failed.has(id);
}
