/** File-system helpers for durable writes. */
import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Renames with a few short retries. On Windows a just-written file is often
 * held open briefly by antivirus or the search indexer.
 */
export async function renameWithRetry(from: string, to: string, attempts = 6): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt >= attempts || !RETRYABLE.has(code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 60 * attempt));
    }
  }
}

/**
 * Writes a file so that readers only ever see the old or the complete new
 * content: write to a temporary file, flush it to disk, then rename.
 */
export async function writeFileAtomic(target: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${randomBytes(6).toString('hex')}`;
  const handle = await open(temp, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameWithRetry(temp, target);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}

/** A timestamp that is safe in file names, e.g. "2026-10-24-2041". */
export function fileStamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
