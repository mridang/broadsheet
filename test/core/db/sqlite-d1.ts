import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from 'node:sqlite';

/** What a prepared statement answers, shaped like D1's `D1Result`. */
interface Result {
  readonly success: true;
  readonly results: readonly unknown[];
  readonly meta: { readonly changes: number };
}

/** A prepared statement of the shim, with the members of D1's `D1PreparedStatement` that the app uses. */
class Statement {
  constructor(
    private readonly conn: DatabaseSync,
    readonly sql: string,
    private readonly params: readonly SQLInputValue[] = [],
  ) {}

  /** The same statement with values bound to its placeholders. */
  bind(...params: readonly unknown[]): Statement {
    return new Statement(this.conn, this.sql, params as SQLInputValue[]);
  }

  private prepared(arrays: boolean): StatementSync {
    const statement = this.conn.prepare(this.sql);
    statement.setReturnArrays(arrays);
    return statement;
  }

  /** Whether the statement produces rows (a query, or a write with RETURNING). */
  get reads(): boolean {
    return this.conn.prepare(this.sql).columns().length > 0;
  }

  async run(): Promise<Result> {
    if (this.reads) {
      const results = this.prepared(false).all(...this.params);
      return { success: true, results, meta: { changes: results.length } };
    }
    const outcome = this.conn.prepare(this.sql).run(...this.params);
    return {
      success: true,
      results: [],
      meta: { changes: Number(outcome.changes) },
    };
  }

  async all(): Promise<Result> {
    const results = this.prepared(false).all(...this.params);
    return { success: true, results, meta: { changes: 0 } };
  }

  async raw(): Promise<readonly unknown[]> {
    return this.prepared(true).all(...this.params);
  }

  async first(): Promise<unknown> {
    return this.prepared(false).get(...this.params) ?? null;
  }
}

/**
 * A stand-in for a D1 binding backed by an in-memory SQLite database with the
 * named migration files applied, enough for Drizzle's D1 driver and for the
 * rate limiter: `prepare`, `bind`, `run`, `all`, `raw`, `first`, and `batch`
 * (one transaction, rolled back if any statement fails, as D1 does).
 */
export function sqliteD1(...migrations: readonly string[]): {
  readonly d1: D1Database;
  readonly raw: DatabaseSync;
} {
  const raw = new DatabaseSync(':memory:');
  migrations.forEach((file) =>
    raw.exec(
      readFileSync(path.join(process.cwd(), 'migrations', file), 'utf8'),
    ),
  );
  const d1 = {
    prepare: (sql: string) => new Statement(raw, sql),
    batch: async (statements: readonly Statement[]) => {
      raw.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          results.push(
            await (statement.reads ? statement.all() : statement.run()),
          );
        }
        raw.exec('COMMIT');
        return results;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { d1: d1 as unknown as D1Database, raw };
}

/** Work handed to `waitUntil` since the last {@link settleBackground}. */
const background: Promise<unknown>[] = [];

/** Wait for every piece of background work started so far (see `runInBackground`), then forget it. */
export async function settleBackground(): Promise<void> {
  await Promise.allSettled(background.splice(0));
}

/**
 * Make `d1` the database that `getCloudflareContext()` (and so `getDatabase()`)
 * finds, as it would be inside a Worker, and return a function that puts the
 * global back. `env` adds the other bindings and secrets a test needs
 * (`SESSION_SECRET`, `APP_URL`, …). Work handed to `waitUntil` is not awaited
 * by the code that started it; a test that needs it finished calls
 * {@link settleBackground}.
 */
export function installCloudflareContext(
  d1: D1Database,
  env: Readonly<Record<string, unknown>> = {},
): () => void {
  const key = Symbol.for('__cloudflare-context__');
  const holder = globalThis as unknown as Record<symbol, unknown>;
  const previous = holder[key];
  holder[key] = {
    env: { ...env, DB: d1 },
    ctx: {
      waitUntil: (work: Promise<unknown>) => {
        background.push(work);
      },
    },
    cf: {},
  };
  return () => {
    holder[key] = previous;
  };
}
