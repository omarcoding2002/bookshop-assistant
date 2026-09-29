import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile, mkdir } from "node:fs/promises";
export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Queryable {
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function createDatabase(
  url?: string,
  path?: string,
): Promise<Database> {
  let db: Database;
  if (url) {
    const pool = new pg.Pool({
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 10_000,
    });
    db = {
      query: async <T>(sql: string, params?: unknown[]) => ({
        rows: (await pool.query(sql, params)).rows as T[],
      }),
      transaction: async (work) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await work({
            query: async <T>(sql: string, params?: unknown[]) => ({
              rows: (await client.query(sql, params)).rows as T[],
            }),
          });
          await client.query("COMMIT");
          return result;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    if (path) await mkdir(path, { recursive: true });
    const local = new PGlite(path);
    db = {
      query: (sql, params) => local.query(sql, params),
      transaction: (work) => local.transaction((tx) => work(tx)),
      close: () => local.close(),
    };
  }
  // Execute statements separately for both PostgreSQL drivers; migration is idempotent.
  const sql = await readFile(
    new URL("../../migrations/001_initial.sql", import.meta.url),
    "utf8",
  );
  for (const statement of sql.split(";").filter((s) => s.trim()))
    await db.query(statement);
  return db;
}
