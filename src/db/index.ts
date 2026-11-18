import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "@/opspilot/server/config";

const databaseUrl = config().databaseUrl;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    // Pool sizing (T-305). The pg default of 10 serialises bursts. On a single-core
    // sandbox at 50 concurrent sessions, max=25 moved p50 from 201 ms to 141 ms while
    // p95 varied 404–1035 ms between runs — a tuning knob, not a capacity claim.
    // Keep instances × PGPOOL_MAX below the database's max_connections (often 100).
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
