import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { JournalHost } from '../../src/main/host';
import { Journal } from '../../src/main/journal';

const created: string[] = [];
const opened: Journal[] = [];
const hosts: JournalHost[] = [];

afterEach(async () => {
  // Close databases before deleting their folders (Windows can't delete open files).
  for (const host of hosts.splice(0)) {
    try {
      await host.close();
    } catch {
      // already closed by the test
    }
  }
  for (const journal of opened.splice(0)) {
    try {
      journal.close();
    } catch {
      // already closed by the test
    }
  }
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh, empty folder that is deleted after the test. */
export function tempDir(prefix = 'mjournal-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** A clock that can be moved forward during a test. */
export function fakeClock(start = '2026-10-24T18:30:00.000Z') {
  let current = new Date(start);
  const clock = () => new Date(current);
  clock.set = (iso: string) => {
    current = new Date(iso);
  };
  clock.advance = (ms: number) => {
    current = new Date(current.getTime() + ms);
  };
  return clock;
}

export function openJournal(dir = tempDir(), clock = fakeClock()): Journal {
  const journal = Journal.open(dir, { clock, regionCode: 'GB' });
  opened.push(journal);
  return journal;
}

export function openHost(dir = tempDir(), clock = fakeClock(), regionCode = 'GB'): JournalHost {
  const host = JournalHost.open(dir, { clock, regionCode });
  hosts.push(host);
  return host;
}

/** Re-opens the journal in `dir` as the app would after a restart. */
export function reopen(journal: Journal): Journal {
  journal.close();
  return openJournal(journal.paths.root, journal.clock as ReturnType<typeof fakeClock>);
}

/** Minimal valid image files for tests (1×1 pixels). */
export const PNG_1PX = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);
export const JPEG_1PX = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64',
  ),
);
export const WEBP_1PX = Uint8Array.from(
  Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64'),
);
