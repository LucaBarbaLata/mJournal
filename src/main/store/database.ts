/**
 * Thin wrapper around Node's built-in SQLite driver (node:sqlite).
 *
 * - WAL journaling with synchronous=FULL: a committed change survives a crash
 *   or power cut, and an interrupted write can never corrupt the file.
 * - Statements are prepared once and cached.
 * - transaction() nests through savepoints and rolls back on any error.
 */
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

export type Params = Record<string, SQLInputValue> | readonly SQLInputValue[];
export type Row = Record<string, unknown>;

export class Db {
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;

  private constructor(
    private readonly raw: DatabaseSync,
    readonly path: string,
  ) {}

  static open(path: string, { readOnly = false } = {}): Db {
    const raw = new DatabaseSync(path, { readOnly, enableForeignKeyConstraints: true });
    const db = new Db(raw, path);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      if (!readOnly) {
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA synchronous = FULL');
      }
    } catch (err) {
      raw.close();
      throw err;
    }
    return db;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  private statement(sql: string): StatementSync {
    let stmt = this.statements.get(sql);
    if (!stmt) {
      stmt = this.raw.prepare(sql);
      this.statements.set(sql, stmt);
    }
    return stmt;
  }

  all<T = Row>(sql: string, params: Params = []): T[] {
    const stmt = this.statement(sql);
    return (Array.isArray(params) ? stmt.all(...params) : stmt.all(params as Record<string, SQLInputValue>)) as T[];
  }

  get<T = Row>(sql: string, params: Params = []): T | undefined {
    const stmt = this.statement(sql);
    return (Array.isArray(params) ? stmt.get(...params) : stmt.get(params as Record<string, SQLInputValue>)) as
      | T
      | undefined;
  }

  run(sql: string, params: Params = []): { changes: number; lastInsertRowid: number } {
    const stmt = this.statement(sql);
    const result = Array.isArray(params) ? stmt.run(...params) : stmt.run(params as Record<string, SQLInputValue>);
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  /** Runs `fn` atomically. Must be synchronous; nested calls use savepoints. */
  transaction<T>(fn: () => T): T {
    const savepoint = `sp_${this.depth}`;
    this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    this.depth++;
    try {
      const result = fn();
      if (result instanceof Promise) throw new Error('Database transactions must be synchronous.');
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
      return result;
    } catch (err) {
      this.depth--;
      if (this.depth === 0) {
        this.raw.exec('ROLLBACK');
      } else {
        this.raw.exec(`ROLLBACK TO ${savepoint}`);
        this.raw.exec(`RELEASE ${savepoint}`);
      }
      throw err;
    }
  }

  get userVersion(): number {
    return Number(this.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0);
  }

  /** Writes a consistent, compacted copy of the database to `target` (which must not exist). */
  snapshotTo(target: string): void {
    this.raw.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  }

  /** Returns "ok" when SQLite finds no corruption, otherwise the first problem it reports. */
  integrityCheck(): string {
    const rows = this.all<{ integrity_check: string }>('PRAGMA integrity_check');
    return rows.map((r) => r.integrity_check).join('; ') || 'unknown';
  }

  close(): void {
    if (!this.raw.isOpen) return;
    this.statements.clear();
    try {
      this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // Read-only connections or busy checkpoints are fine to skip.
    }
    this.raw.close();
  }

  get isOpen(): boolean {
    return this.raw.isOpen;
  }
}
