import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const migrationsFolder = path.join(process.cwd(), "drizzle");

let dbPromise: Promise<DB> | undefined;

// PostgreSQL when DATABASE_URL is set (including Supabase's transaction pooler), otherwise an
// embedded PGlite database for zero-setup local development (persisted to .pglite/, or in memory
// when PGLITE_DIR=memory).
export function getDb(): Promise<DB> {
  dbPromise ??= open();
  return dbPromise;
}

async function open(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = new Pool({
      connectionString: url,
      // Serverless instances should keep their application-side pool deliberately small. Supabase's
      // transaction pooler handles concurrency across instances.
      max: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
    return drizzleNodePostgres(pool, { schema }) as unknown as DB;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR ?? ".pglite";
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as DB;
}

export function resetDbForTests() {
  dbPromise = undefined;
}
