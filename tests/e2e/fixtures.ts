/**
 * Helpers for end-to-end tests: launch the built app (npm run build first)
 * with a throwaway data folder, stub native dialogs, and make test images.
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

export const ROOT = resolve(__dirname, '..', '..');

export interface Launched {
  app: ElectronApplication;
  page: Page;
  dataDir: string;
  errors: string[];
}

export function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'mjournal-e2e-'));
}

export interface LaunchOptions {
  /** 'skip' clicks "Skip guide" on a fresh journal, like a returning user would; 'keep' leaves it open. */
  guide?: 'skip' | 'keep';
  /** Most tests run with reduced motion so timing never depends on animations. */
  motion?: 'reduce' | 'no-preference';
  /** Extra environment variables, e.g. MJOURNAL_UPDATE_URL. */
  env?: Record<string, string>;
  /** The journal has a PIN: wait for the lock screen instead of the app (and leave the guide alone). */
  locked?: boolean;
}

export async function launch(dataDir = makeDataDir(), options: LaunchOptions = {}): Promise<Launched> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...options.env,
    MJOURNAL_DATA_DIR: dataDir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], cwd: ROOT, env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  // Let the app's own theme setting drive prefers-color-scheme.
  await page.emulateMedia({ colorScheme: null, reducedMotion: options.motion ?? 'reduce' });
  if (options.locked) {
    await page.waitForSelector('.lock-screen');
    return { app, page, dataDir, errors };
  }
  await page.waitForSelector('.app');
  if ((options.guide ?? 'skip') === 'skip') {
    const settings = await callApi<{ onboardingDone: boolean }>(page, 'settings', 'get');
    if (!settings.onboardingDone) {
      await page.getByRole('button', { name: 'Skip guide' }).click();
      await page.locator('dialog.guide').waitFor({ state: 'detached' });
    }
  }
  return { app, page, dataDir, errors };
}

/** Closes the window the way a user would, so pending edits are flushed first. */
export async function closeLikeUser(app: ElectronApplication): Promise<void> {
  const closed = new Promise<void>((done) => app.process().once('exit', () => done()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await closed;
}

export function removeDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // A locked temp folder is not a test failure.
  }
}

export async function stubOpenDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog;
  }, filePaths);
}

export async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, filePath);
}

/** Calls the app API directly (for quickly preparing data). */
export async function callApi<T>(page: Page, namespace: string, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ({ namespace, method, args }) => {
      const result = (await window.mjournalIpc![namespace][method](...args)) as { ok: boolean; value?: unknown; message?: string };
      if (!result.ok) throw new Error(result.message);
      return result.value;
    },
    { namespace, method, args },
  ) as Promise<T>;
}

export function localDateKey(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A real, decodable PNG of a solid colour. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function writeImage(dir: string, name: string, rgb: [number, number, number]): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, solidPng(64, 48, rgb));
  return path;
}

declare global {
  interface Window {
    mjournalIpc?: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;
  }
}
