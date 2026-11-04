/**
 * The optional PIN lock. Electron-free, so it is unit-tested.
 *
 * - The PIN is kept only as a scrypt hash with a random salt, in lock.json in
 *   the data folder. It lives outside the database on purpose: backups don't
 *   contain it, and restoring a backup never brings back an old PIN.
 * - While locked, the API refuses everything except checking the lock and
 *   unlocking (see api.ts), and photos aren't served (index.ts).
 * - Wrong PINs are counted in lock.json, so quitting doesn't reset the pause.
 * - Checks run one at a time, so many tries sent at once can't skip a pause.
 *
 * This keeps mJournal's window closed; it doesn't encrypt the journal. Deleting
 * lock.json while mJournal is closed removes a forgotten PIN.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import {
  AUTO_LOCK_MINUTES,
  DEFAULT_AUTO_LOCK_MINUTES,
  FREE_TRIES,
  isValidPin,
  wrongPinPause,
  type AutoLockMinutes,
  type LockStatus,
} from '@core/lock';
import { UserFacingError, ValidationError } from '@core/validation';
import { log } from './log';
import { writeFileAtomic } from './services/fsutil';

interface PinHash {
  algorithm: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  hash: string;
}

interface LockFile {
  version: 1;
  pin: PinHash;
  autoLockMinutes: AutoLockMinutes;
  /** Wrong PINs in a row. */
  failures: number;
  /** When the next try is allowed after too many wrong PINs (ISO time). */
  retryAt: string | null;
}

// About 50–100 ms per check on a laptop: slow enough that the hash in lock.json is costly to try
// PINs against (people reuse PINs), quick enough not to be noticed.
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const MAX_FAILURES = 10_000;

function derive(pin: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem: scrypt needs 128 × N × r bytes (32 MB here), just above Node's default limit.
    scrypt(pin, salt, KEY_BYTES, { ...params, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPin(pin: string): Promise<PinHash> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(pin, salt, SCRYPT_PARAMS);
  return { algorithm: 'scrypt', ...SCRYPT_PARAMS, salt: salt.toString('base64'), hash: key.toString('base64') };
}

async function pinMatches(pin: string, stored: PinHash): Promise<boolean> {
  const expected = Buffer.from(stored.hash, 'base64');
  const key = await derive(pin, Buffer.from(stored.salt, 'base64'), { N: stored.N, r: stored.r, p: stored.p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Reads lock.json. A missing file means no PIN; so does an unreadable one (logged), as deleting it would. */
function readLockFile(file: string): LockFile | null {
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const pin = raw.pin as Record<string, unknown> | undefined;
    const isInt = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
    const valid =
      raw.version === 1 &&
      pin?.algorithm === 'scrypt' &&
      // Bounded, so an edited file can't make every check take minutes.
      isInt(pin.N, 2 ** 14, 2 ** 17) &&
      ((pin.N as number) & ((pin.N as number) - 1)) === 0 &&
      isInt(pin.r, 1, 16) &&
      isInt(pin.p, 1, 4) &&
      typeof pin.salt === 'string' &&
      BASE64_RE.test(pin.salt) &&
      typeof pin.hash === 'string' &&
      BASE64_RE.test(pin.hash) &&
      Buffer.from(pin.hash, 'base64').length === KEY_BYTES;
    if (!valid) throw new Error('unexpected contents');
    const retryAt = typeof raw.retryAt === 'string' && Number.isFinite(Date.parse(raw.retryAt)) ? raw.retryAt : null;
    return {
      version: 1,
      pin: pin as unknown as PinHash,
      autoLockMinutes: (AUTO_LOCK_MINUTES as readonly unknown[]).includes(raw.autoLockMinutes)
        ? (raw.autoLockMinutes as AutoLockMinutes)
        : DEFAULT_AUTO_LOCK_MINUTES,
      failures: isInt(raw.failures, 0, MAX_FAILURES) ? (raw.failures as number) : 0,
      retryAt,
    };
  } catch (err) {
    log.warn('The PIN file (lock.json) could not be read, so mJournal opens without a PIN', err);
    return null;
  }
}

type Check = 'ok' | 'wrong' | 'wait';

export class AppLock {
  private locked: boolean;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(status: LockStatus) => void>();

  private constructor(
    private readonly file: string,
    private config: LockFile | null,
    private readonly now: () => number,
  ) {
    // With a PIN, mJournal always starts locked.
    this.locked = config !== null;
  }

  static load(file: string, options: { now?: () => number } = {}): AppLock {
    return new AppLock(file, readLockFile(file), options.now ?? Date.now);
  }

  /** Called after every change of the lock (to tell the window). */
  subscribe(listener: (status: LockStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isLocked(): boolean {
    return this.locked;
  }

  status(): LockStatus {
    const config = this.config;
    return {
      enabled: config !== null,
      locked: this.locked,
      autoLockMinutes: config?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES,
      retryAt: config ? this.pendingRetry(config) : null,
      triesBeforePause: config ? Math.max(0, FREE_TRIES - config.failures) : FREE_TRIES,
    };
  }

  /** Locks right away (if a PIN is set). Pending edits should be saved first; see index.ts. */
  lock(): LockStatus {
    if (this.config && !this.locked) {
      this.locked = true;
      this.emit();
    }
    return this.status();
  }

  /** Unlocks with the right PIN. A wrong one is counted; the result says whether it worked and when to try again. */
  unlock(pin: unknown): Promise<LockStatus> {
    return this.serial(async () => {
      if (!this.config || !this.locked) return this.status();
      if ((await this.check(this.config, pin)) === 'ok') {
        this.locked = false;
        this.emit();
      }
      return this.status();
    });
  }

  /** Turns the PIN on, or changes it (then the current PIN is needed). */
  setPin(currentPin: unknown, newPin: unknown): Promise<LockStatus> {
    return this.serial(async () => {
      this.requireUnlocked();
      if (!isValidPin(newPin)) throw new ValidationError('A PIN is 4 to 8 digits.');
      if (this.config) await this.requireCurrent(this.config, currentPin);
      const next: LockFile = {
        version: 1,
        pin: await hashPin(newPin),
        autoLockMinutes: this.config?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES,
        failures: 0,
        retryAt: null,
      };
      await this.save(next);
      this.config = next;
      this.emit();
      return this.status();
    });
  }

  /** Turns the PIN off; needs the current PIN. */
  removePin(currentPin: unknown): Promise<LockStatus> {
    return this.serial(async () => {
      this.requireUnlocked();
      if (!this.config) return this.status();
      await this.requireCurrent(this.config, currentPin);
      await rm(this.file, { force: true });
      this.config = null;
      this.locked = false;
      this.emit();
      return this.status();
    });
  }

  setAutoLock(minutes: unknown): Promise<LockStatus> {
    return this.serial(async () => {
      this.requireUnlocked();
      if (!this.config) throw new UserFacingError('no-pin', 'Set a PIN first.');
      if (!(AUTO_LOCK_MINUTES as readonly unknown[]).includes(minutes)) throw new ValidationError('Invalid time.');
      const next = { ...this.config, autoLockMinutes: minutes as AutoLockMinutes };
      await this.save(next);
      this.config = next;
      this.emit();
      return this.status();
    });
  }

  private pendingRetry(config: LockFile): string | null {
    return config.retryAt && Date.parse(config.retryAt) > this.now() ? config.retryAt : null;
  }

  private async check(config: LockFile, pin: unknown): Promise<Check> {
    // During a pause tries aren't checked at all (and don't count).
    if (this.pendingRetry(config)) return 'wait';
    const ok = isValidPin(pin) && (await pinMatches(pin, config.pin));
    if (ok) {
      if (config.failures > 0 || config.retryAt) {
        config.failures = 0;
        config.retryAt = null;
        await this.save(config).catch((err: unknown) => log.warn('Could not save the PIN file', err));
      }
      return 'ok';
    }
    config.failures = Math.min(config.failures + 1, MAX_FAILURES);
    const pause = wrongPinPause(config.failures);
    config.retryAt = pause > 0 ? new Date(this.now() + pause).toISOString() : null;
    // Kept in memory even if the file can't be written, so the pause still applies until mJournal closes.
    await this.save(config).catch((err: unknown) => log.warn('Could not save the PIN file', err));
    return 'wrong';
  }

  private async requireCurrent(config: LockFile, pin: unknown): Promise<void> {
    const result = await this.check(config, pin);
    if (result === 'wait') throw new UserFacingError('pin-pause', pauseMessage(this.pendingRetry(config), this.now()));
    if (result === 'wrong') throw new UserFacingError('wrong-pin', 'That’s not your current PIN.');
  }

  private requireUnlocked(): void {
    if (this.locked) throw new UserFacingError('locked', 'mJournal is locked.');
  }

  private save(config: LockFile): Promise<void> {
    return writeFileAtomic(this.file, `${JSON.stringify(config, null, 2)}\n`);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private emit(): void {
    const status = this.status();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (err) {
        log.warn('A lock listener failed', err);
      }
    }
  }
}

function pauseMessage(retryAt: string | null, now: number): string {
  const seconds = retryAt ? Math.max(1, Math.ceil((Date.parse(retryAt) - now) / 1000)) : 30;
  const wait = seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
  return `Too many wrong PINs. Please try again in ${wait}.`;
}
