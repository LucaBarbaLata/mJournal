/**
 * Password-protected backups, with Node's own crypto (no compiled add-on).
 *
 * A protected backup is the ordinary backup .zip, encrypted as one stream:
 *
 *   "MJBKENC1" | header length (uint32, big-endian) | header (JSON) | AES-256-GCM ciphertext | 16-byte tag
 *
 * The header holds the scrypt parameters, the salt, the nonce and a short
 * check value (an HMAC of a constant under the key), so a wrong password is
 * recognised before anything is decrypted. The whole header is authenticated
 * as additional data, so changing any of it makes the tag fail.
 *
 * The key (never the password) is remembered in backup-key.json next to the
 * journal, so automatic backups can be protected without asking. That file is
 * never part of a backup: anyone who can read it could also read the journal
 * itself, which isn't encrypted on this computer either.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { UserFacingError } from '@core/validation';
import { writeFileAtomic } from './fsutil';

export const ENCRYPTED_BACKUP_EXTENSION = 'mjbackup';
export const MIN_BACKUP_PASSWORD_LENGTH = 8;
export const MAX_BACKUP_PASSWORD_LENGTH = 1024;

const MAGIC = Buffer.from('MJBKENC1', 'ascii');
const PREFIX_BYTES = MAGIC.length + 4;
const MAX_HEADER_BYTES = 4096;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const CHECK_BYTES = 16;
const CHECK_LABEL = 'mjournal-backup-key-check';
/** scrypt needs about 128 × N × r × p bytes; headers asking for more than this are refused. */
const MAX_KDF_MEMORY = 512 * 1024 * 1024;

export interface KdfParams {
  N: number;
  r: number;
  p: number;
}

/** About half a second and 128 MiB on a laptop: slow for anyone guessing passwords, fine once per backup. */
export const DEFAULT_KDF: KdfParams = { N: 2 ** 17, r: 8, p: 1 };

export interface BackupKey {
  kdf: KdfParams;
  salt: Buffer;
  key: Buffer;
  check: Buffer;
}

export interface EncryptedHeader {
  kdf: KdfParams;
  salt: Buffer;
  nonce: Buffer;
  check: Buffer;
  /** The header bytes exactly as stored (authenticated as additional data). */
  raw: Buffer;
  /** Where the ciphertext starts. */
  dataStart: number;
}

const notRestored = 'Nothing was restored and your journal has not been changed.';
const damaged = () =>
  new UserFacingError('damaged', `This password-protected backup is damaged or incomplete. ${notRestored}`);

function kdfAllowed(kdf: KdfParams): boolean {
  const { N, r, p } = kdf;
  return (
    Number.isInteger(N) &&
    N >= 2 ** 14 &&
    N <= 2 ** 20 &&
    (N & (N - 1)) === 0 &&
    Number.isInteger(r) &&
    r >= 1 &&
    r <= 16 &&
    Number.isInteger(p) &&
    p >= 1 &&
    p <= 4 &&
    128 * N * r * p <= MAX_KDF_MEMORY
  );
}

function derive(password: string, salt: Buffer, kdf: KdfParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFC'),
      salt,
      KEY_BYTES,
      { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 2 * 128 * kdf.N * kdf.r * kdf.p },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

function checkValue(key: Buffer): Buffer {
  return createHmac('sha256', key).update(CHECK_LABEL).digest().subarray(0, CHECK_BYTES);
}

/** Makes a key from a password (with a new random salt unless one is given). */
export async function deriveBackupKey(
  password: string,
  kdf: KdfParams = DEFAULT_KDF,
  salt: Buffer = randomBytes(SALT_BYTES),
): Promise<BackupKey> {
  if (!kdfAllowed(kdf)) throw damaged();
  const key = await derive(password, salt, kdf);
  return { kdf, salt, key, check: checkValue(key) };
}

/** Explains what's wrong with a new backup password, or returns null when it's fine. */
export function backupPasswordProblem(password: string): string | null {
  if (password.length < MIN_BACKUP_PASSWORD_LENGTH) {
    return `Please use at least ${MIN_BACKUP_PASSWORD_LENGTH} characters — a few words in a row work well.`;
  }
  if (password.length > MAX_BACKUP_PASSWORD_LENGTH) return 'That password is too long.';
  if (password.trim() !== password) return 'Please don’t start or end the password with a space.';
  return null;
}

function buildHeader(key: BackupKey, nonce: Buffer): Buffer {
  const json = Buffer.from(
    JSON.stringify({
      format: 1,
      cipher: 'aes-256-gcm',
      kdf: 'scrypt',
      N: key.kdf.N,
      r: key.kdf.r,
      p: key.kdf.p,
      salt: key.salt.toString('base64'),
      nonce: nonce.toString('base64'),
      check: key.check.toString('base64'),
    }),
    'utf8',
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length, 0);
  return Buffer.concat([MAGIC, length, json]);
}

/** A stream that turns a backup .zip into a protected backup: header, ciphertext, tag. */
export function encryptingStream(key: BackupKey): Transform {
  const nonce = randomBytes(NONCE_BYTES);
  const header = buildHeader(key, nonce);
  const cipher = createCipheriv('aes-256-gcm', key.key, nonce);
  cipher.setAAD(header);
  let started = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (!started) {
        this.push(header);
        started = true;
      }
      callback(null, cipher.update(chunk));
    },
    flush(callback) {
      if (!started) this.push(header);
      const rest = cipher.final();
      if (rest.length > 0) this.push(rest);
      this.push(cipher.getAuthTag());
      callback();
    },
  });
}

function decodeBase64(value: unknown, bytes: number): Buffer | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const buffer = Buffer.from(value, 'base64');
  return buffer.length === bytes ? buffer : null;
}

/**
 * Reads the header of a protected backup. Returns null when the file isn't one
 * (an ordinary .zip, for example); throws when it is one but its header is damaged.
 */
export async function readEncryptedHeader(file: string): Promise<EncryptedHeader | null> {
  const handle = await open(file, 'r');
  try {
    const prefix = Buffer.alloc(PREFIX_BYTES);
    const { bytesRead } = await handle.read(prefix, 0, PREFIX_BYTES, 0);
    if (bytesRead < MAGIC.length || !prefix.subarray(0, MAGIC.length).equals(MAGIC)) return null;
    if (bytesRead < PREFIX_BYTES) throw damaged();
    const length = prefix.readUInt32BE(MAGIC.length);
    if (length < 2 || length > MAX_HEADER_BYTES) throw damaged();
    const json = Buffer.alloc(length);
    const read = await handle.read(json, 0, length, PREFIX_BYTES);
    if (read.bytesRead !== length) throw damaged();
    let fields: Record<string, unknown>;
    try {
      fields = JSON.parse(json.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw damaged();
    }
    if (typeof fields !== 'object' || fields === null) throw damaged();
    if (fields.format !== 1 || fields.cipher !== 'aes-256-gcm' || fields.kdf !== 'scrypt') {
      if (typeof fields.format === 'number' && fields.format > 1) {
        throw new UserFacingError(
          'newer-version',
          `This backup was made by a newer version of mJournal. Please update mJournal first. ${notRestored}`,
        );
      }
      throw damaged();
    }
    const kdf = { N: fields.N as number, r: fields.r as number, p: fields.p as number };
    const salt = decodeBase64(fields.salt, SALT_BYTES);
    const nonce = decodeBase64(fields.nonce, NONCE_BYTES);
    const check = decodeBase64(fields.check, CHECK_BYTES);
    if (!kdfAllowed(kdf) || !salt || !nonce || !check) throw damaged();
    return { kdf, salt, nonce, check, raw: Buffer.concat([prefix, json]), dataStart: PREFIX_BYTES + length };
  } finally {
    await handle.close();
  }
}

/** Whether a remembered key is the one this backup was protected with (same password and salt). */
export function keyMatches(key: BackupKey, header: EncryptedHeader): boolean {
  return (
    key.kdf.N === header.kdf.N &&
    key.kdf.r === header.kdf.r &&
    key.kdf.p === header.kdf.p &&
    key.salt.equals(header.salt) &&
    timingSafeEqual(key.check, header.check)
  );
}

/** The key for this backup if `password` is right, otherwise null. */
export async function keyFromPassword(password: string, header: EncryptedHeader): Promise<BackupKey | null> {
  const key = await deriveBackupKey(password, header.kdf, header.salt);
  return timingSafeEqual(key.check, header.check) ? key : null;
}

/** Decrypts a protected backup into `target` (a new file). Nothing is left behind if the file is damaged. */
export async function decryptBackup(file: string, header: EncryptedHeader, key: BackupKey, target: string): Promise<void> {
  const { size } = await stat(file);
  const end = size - TAG_BYTES;
  if (end <= header.dataStart) throw damaged();
  const tag = Buffer.alloc(TAG_BYTES);
  const handle = await open(file, 'r');
  try {
    const { bytesRead } = await handle.read(tag, 0, TAG_BYTES, end);
    if (bytesRead !== TAG_BYTES) throw damaged();
  } finally {
    await handle.close();
  }
  const decipher = createDecipheriv('aes-256-gcm', key.key, header.nonce);
  decipher.setAAD(header.raw);
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(file, { start: header.dataStart, end: end - 1 }), decipher, createWriteStream(target, { flags: 'wx' }));
  } catch {
    await rm(target, { force: true });
    throw damaged();
  }
}

// ---------------------------------------------------------------------------
// The remembered key (backup-key.json)

interface KeyFile {
  version: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  key: string;
  check: string;
  createdAt: string;
}

/** The remembered key, or null when backups aren't protected (or the file can't be read). */
export function loadBackupKey(path: string): BackupKey | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<KeyFile>;
    const kdf = { N: raw.N as number, r: raw.r as number, p: raw.p as number };
    const salt = decodeBase64(raw.salt, SALT_BYTES);
    const key = decodeBase64(raw.key, KEY_BYTES);
    const check = decodeBase64(raw.check, CHECK_BYTES);
    if (raw.version !== 1 || raw.kdf !== 'scrypt' || !kdfAllowed(kdf) || !salt || !key || !check) return null;
    // A file whose key doesn't match its own check value is damaged: better unprotected than unreadable backups.
    if (!timingSafeEqual(checkValue(key), check)) return null;
    return { kdf, salt, key, check };
  } catch {
    return null;
  }
}

export async function saveBackupKey(path: string, key: BackupKey, now: Date): Promise<void> {
  const file: KeyFile = {
    version: 1,
    kdf: 'scrypt',
    N: key.kdf.N,
    r: key.kdf.r,
    p: key.kdf.p,
    salt: key.salt.toString('base64'),
    key: key.key.toString('base64'),
    check: key.check.toString('base64'),
    createdAt: now.toISOString(),
  };
  await writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
}

export async function removeBackupKey(path: string): Promise<void> {
  await rm(path, { force: true });
}
