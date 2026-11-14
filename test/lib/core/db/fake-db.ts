import type { Database } from '@/domain/db/client';

/** One call made on a fake query builder. */
export interface Call {
  /** Which statement it belongs to: `select`, `insert`, `update` or `delete`. */
  readonly statement: string;
  /** The builder method called, such as `values` or `where`. */
  readonly method: string;
  readonly args: readonly unknown[];
}

/**
 * A stand-in for Drizzle's chained query builders. Every method returns the
 * builder again and is recorded; awaiting it gives `result`. That is enough to
 * check what a repository asks the database for, and what it does with the
 * answer, without a database.
 */
function builder(statement: string, result: unknown, calls: Call[]): object {
  const self: object = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'then') {
          return (resolve: (value: unknown) => unknown) => resolve(result);
        }
        return (...args: unknown[]) => {
          calls.push({ statement, method: String(property), args });
          return self;
        };
      },
    },
  );
  return self;
}

/** What a fake database answers with. */
export interface FakeResults {
  /** The rows (or result) of the next statements of each kind, in order; the last repeats. */
  readonly select?: readonly unknown[];
  readonly insert?: readonly unknown[];
  readonly update?: readonly unknown[];
  readonly delete?: readonly unknown[];
  /** What the n-th `batch` call answers (one result per statement); the last repeats. Default: an empty result per statement. */
  readonly batch?: readonly (readonly unknown[])[];
  /** What `query.<table>.findFirst` answers. */
  readonly findFirst?: Readonly<Record<string, unknown>>;
  /** What `query.<table>.findMany` answers. */
  readonly findMany?: Readonly<Record<string, unknown>>;
}

/** The answer for the n-th statement of a kind: the n-th result, else the last. */
function nth(results: readonly unknown[] | undefined, n: number): unknown {
  return results?.[Math.min(n, results.length - 1)];
}

type StatementKind = 'select' | 'insert' | 'update' | 'delete';

/** A fake database that records every statement and answers from `results`. */
export function fakeDb(results: FakeResults = {}): {
  readonly db: Database;
  readonly calls: Call[];
  readonly batches: unknown[][];
} {
  const calls: Call[] = [];
  const batches: unknown[][] = [];
  const counts: Record<string, number> = {};
  const start = (kind: StatementKind) => () => {
    const n = counts[kind] ?? 0;
    counts[kind] = n + 1;
    calls.push({ statement: kind, method: kind, args: [] });
    return builder(kind, nth(results[kind], n), calls);
  };
  const db = {
    select: start('select'),
    insert: start('insert'),
    update: start('update'),
    delete: start('delete'),
    batch: async (statements: unknown[]) => {
      const n = batches.length;
      batches.push(statements);
      return (
        (nth(results.batch, n) as unknown[] | undefined) ??
        statements.map(() => [])
      );
    },
    query: new Proxy(
      {},
      {
        get: (_target, table) => ({
          findFirst: async () => results.findFirst?.[String(table)],
          findMany: async () => results.findMany?.[String(table)],
        }),
      },
    ),
  };
  return { db: db as unknown as Database, calls, batches };
}
