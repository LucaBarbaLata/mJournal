/**
 * Thumbnail generation. Photos are decoded by the browser engine (which
 * respects EXIF orientation), scaled down with high-quality resampling and
 * stored as small WebP files by the main process. Thumbnails are only a
 * cache: if one is missing it is simply made again.
 *
 * Each finished thumbnail is announced to the photos showing it (see
 * useThumbnailVersion), so a gallery of a thousand photos doesn't reload a
 * thousand times; the data is refreshed once, when the queue is empty.
 */
import { useSyncExternalStore } from 'react';
import type { PhotoRecord } from '@core/api';
import { api } from './api';
import { invalidate } from './data';

const MAX_EDGE = 560;
const CONCURRENCY = 2;
const DRAIN_DELAY_MS = 300;

const queued = new Set<string>();
const failed = new Set<string>();
/** Photos whose stored thumbnail didn't load and were queued again (once per session). */
const rebuilt = new Set<string>();
const waiting: PhotoRecord[] = [];
let running = 0;
let drainTimer: number | undefined;

/** How many times each photo's thumbnail was made this session (0 = not yet). */
const versions = new Map<string, number>();
const listeners = new Set<() => void>();

function announce(id: string): void {
  versions.set(id, (versions.get(id) ?? 0) + 1);
  for (const listener of [...listeners]) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Changes when a new thumbnail for this photo was made this session; 0 until then. */
export function useThumbnailVersion(id: string): number {
  return useSyncExternalStore(subscribe, () => versions.get(id) ?? 0);
}

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

/** Once nothing is left to do, the views reload once so their data knows about the new thumbnails. */
function refreshWhenDrained(): void {
  if (running > 0 || waiting.length > 0) return;
  window.clearTimeout(drainTimer);
  drainTimer = window.setTimeout(() => invalidate('photos'), DRAIN_DELAY_MS);
}

function pump(): void {
  while (running < CONCURRENCY && waiting.length > 0) {
    const photo = waiting.shift()!;
    running++;
    makeThumbnail(photo)
      .then(() => announce(photo.id))
      .catch(() => failed.add(photo.id))
      .finally(() => {
        running--;
        queued.delete(photo.id);
        pump();
        refreshWhenDrained();
      });
  }
}

function enqueue(photo: PhotoRecord): void {
  queued.add(photo.id);
  waiting.push(photo);
}

/** Queues thumbnail creation for photos that don't have one yet. */
export function ensureThumbnails(photos: readonly PhotoRecord[]): void {
  for (const photo of photos) {
    if (photo.hasThumbnail || photo.missing || queued.has(photo.id) || failed.has(photo.id)) continue;
    enqueue(photo);
  }
  pump();
}

/**
 * Makes a thumbnail again when the stored one didn't load, for example after
 * the thumbnails folder was deleted. Tried once per photo per session.
 */
export function requestThumbnail(photo: PhotoRecord): void {
  if (photo.missing || rebuilt.has(photo.id) || queued.has(photo.id) || failed.has(photo.id)) return;
  rebuilt.add(photo.id);
  enqueue(photo);
  pump();
}

/** True when the browser could not decode the photo (damaged or unsupported file). */
export function thumbnailFailed(id: string): boolean {
  return failed.has(id);
}
