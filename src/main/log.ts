/**
 * A tiny log for troubleshooting (data folder/logs/mjournal.log).
 * It records technical events and errors only — never journal text, moods,
 * captions or photo contents.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_LOG_BYTES = 512 * 1024;

let logFile: string | null = null;

export function setLogFile(path: string): void {
  logFile = path;
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path) && statSync(path).size > MAX_LOG_BYTES) renameSync(path, `${path}.old`);
  } catch {
    logFile = null;
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}${err.stack ? `\n${err.stack}` : ''}`;
  return String(err);
}

function write(level: 'INFO' | 'WARN' | 'ERROR', message: string, err?: unknown): void {
  const line = `${new Date().toISOString()} ${level} ${message}${err === undefined ? '' : ` — ${describe(err)}`}`;
  if (level === 'ERROR') console.error(line);
  else console.log(line);
  if (!logFile) return;
  try {
    appendFileSync(logFile, `${line}\n`);
  } catch {
    // Logging must never break the app.
  }
}

export const log = {
  info: (message: string) => write('INFO', message),
  warn: (message: string, err?: unknown) => write('WARN', message, err),
  error: (message: string, err?: unknown) => write('ERROR', message, err),
};
