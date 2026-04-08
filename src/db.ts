import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import initSqlJs from "sql.js/dist/sql-asm.js";

export interface AccountRecord {
  domain: string;
  username: string;
  hasOtp: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface DiscoveredAccount {
  domain: string;
  username: string;
  hasOtp?: boolean;
}

export interface AccountRepositoryOptions {
  dbPath?: string;
  supportPath?: string;
  now?: () => Date;
}

export interface AccountRepository {
  readonly dbPath: string;
  upsertDiscoveredAccounts(accounts: DiscoveredAccount[]): Promise<void>;
  searchAccounts(query: string): Promise<AccountRecord[]>;
  close(): Promise<void>;
}

const DEFAULT_DB_PATH = join(homedir(), ".applepw-raycast", "accounts.sqlite3");
const ACCOUNT_DB_FILENAME = "accounts.sqlite3";
const require = createRequire(join(process.cwd(), "package.json"));

type SqlValue = string | number | Uint8Array | null;

interface SqlStatement {
  bind(params: SqlValue[]): void;
  run(params?: SqlValue[]): void;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  export(): Uint8Array;
  close(): void;
}

interface SqlJsModule {
  Database: new (data?: Uint8Array) => SqlDatabase;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  domain TEXT NOT NULL,
  username TEXT NOT NULL,
  has_otp INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (domain, username)
);

CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
CREATE INDEX IF NOT EXISTS idx_accounts_last_seen_at ON accounts(last_seen_at DESC);
`;

let sqlJsPromise: Promise<SqlJsModule> | null = null;

async function getSqlJs(): Promise<SqlJsModule> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }

  return sqlJsPromise;
}

async function openDatabase(dbPath: string): Promise<SqlDatabase> {
  const SQL = await getSqlJs();
  try {
    const data = await readFile(dbPath);
    return new SQL.Database(data);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return new SQL.Database();
    }

    throw error;
  }
}

function run(db: SqlDatabase, sql: string, params: SqlValue[] = []): void {
  const statement = db.prepare(sql);
  try {
    statement.run(params);
  } finally {
    statement.free();
  }
}

function all<T>(db: SqlDatabase, sql: string, params: SqlValue[] = []): T[] {
  const statement = db.prepare(sql);
  const rows: T[] = [];

  try {
    statement.bind(params);
    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }
    return rows;
  } finally {
    statement.free();
  }
}

function close(db: SqlDatabase): void {
  db.close();
}

function normalizeHasOtp(hasOtp?: boolean): number {
  return hasOtp ? 1 : 0;
}

function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

function toRecord(row: {
  domain: string;
  username: string;
  has_otp: number;
  first_seen_at: string;
  last_seen_at: string;
}): AccountRecord {
  return {
    domain: row.domain,
    username: row.username,
    hasOtp: row.has_otp === 1,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

async function ensureSchema(db: SqlDatabase): Promise<void> {
  db.exec(SCHEMA);
}

async function persist(dbPath: string, db: SqlDatabase): Promise<void> {
  await writeFile(dbPath, db.export());
}

async function withTransaction(db: SqlDatabase, action: () => Promise<void>): Promise<void> {
  db.exec("BEGIN IMMEDIATE");

  try {
    await action();
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback failures so the original error is preserved.
    }
    throw error;
  }
}

function resolveDbPath(options: AccountRepositoryOptions): string {
  if (options.dbPath?.trim()) {
    return options.dbPath.trim();
  }

  const supportPath = options.supportPath?.trim() || getRaycastSupportPath();
  if (supportPath) {
    return join(supportPath, ACCOUNT_DB_FILENAME);
  }

  return DEFAULT_DB_PATH;
}

function getRaycastSupportPath(): string | undefined {
  try {
    const api = require("@raycast/api") as {
      environment?: {
        supportPath?: string;
      };
    };

    return api.environment?.supportPath?.trim();
  } catch {
    return undefined;
  }
}

export async function createAccountRepository(options: AccountRepositoryOptions = {}): Promise<AccountRepository> {
  const dbPath = resolveDbPath(options);
  const now = options.now ?? (() => new Date());

  await mkdir(dirname(dbPath), { recursive: true });
  const db = await openDatabase(dbPath);
  await ensureSchema(db);
  await persist(dbPath, db);

  return {
    dbPath,

    async upsertDiscoveredAccounts(accounts: DiscoveredAccount[]): Promise<void> {
      if (accounts.length === 0) {
        return;
      }

      await withTransaction(db, async () => {
        for (const account of accounts) {
          const timestamp = now().toISOString();
          await run(
            db,
            `
              INSERT INTO accounts (domain, username, has_otp, first_seen_at, last_seen_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(domain, username) DO UPDATE SET
                has_otp = MAX(has_otp, excluded.has_otp),
                last_seen_at = excluded.last_seen_at
            `,
            [account.domain, account.username, normalizeHasOtp(account.hasOtp), timestamp, timestamp],
          );
        }
      });
      await persist(dbPath, db);
    },

    async searchAccounts(query: string): Promise<AccountRecord[]> {
      const trimmed = query.trim();

      if (!trimmed) {
        const rows = await all<{
          domain: string;
          username: string;
          has_otp: number;
          first_seen_at: string;
          last_seen_at: string;
        }>(
          db,
          `
            SELECT domain, username, has_otp, first_seen_at, last_seen_at
            FROM accounts
            ORDER BY last_seen_at DESC, domain ASC, username ASC
          `,
        );

        return rows.map(toRecord);
      }

      const escaped = escapeLikePattern(trimmed);
      const rows = await all<{
        domain: string;
        username: string;
        has_otp: number;
        first_seen_at: string;
        last_seen_at: string;
      }>(
        db,
        `
          SELECT domain, username, has_otp, first_seen_at, last_seen_at
          FROM accounts
          WHERE domain = ?
             OR domain LIKE ? ESCAPE '\\'
             OR username LIKE ? ESCAPE '\\'
          ORDER BY last_seen_at DESC, domain ASC, username ASC
        `,
        [trimmed, `%${escaped}`, `%${escaped}%`],
      );

      return rows.map(toRecord);
    },

    async close(): Promise<void> {
      await persist(dbPath, db);
      close(db);
    },
  };
}
