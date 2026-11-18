import "dotenv/config";
import { it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { db, pool } from "../../src/db";
after(async () => { await pool.end(); });
it("generated migrations install all tables on a fresh database and can be rerun", async () => {
  const name = `opspilot_migration_${randomUUID().replaceAll("-", "")}`;
  await db.execute(sql`CREATE DATABASE ${sql.identifier(name)}`);
  const url = new URL(process.env.DATABASE_URL!); url.pathname = `/${name}`;
  const targetPool = new Pool({ connectionString: url.toString() }); const target = drizzle(targetPool);
  try {
    await migrate(target, { migrationsFolder: "opspilot/migrations" });
    const result = await target.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'op_%'`);
    const tables = result.rows.map((row) => (row as { table_name: string }).table_name).sort();
    assert.deepEqual(tables, [
      "op_ai_usage", "op_audit_events", "op_billing_events", "op_email_log", "op_email_tokens", "op_files",
      "op_memberships", "op_notifications",
      "op_payments", "op_rate_limits", "op_records", "op_sessions", "op_stock_movements", "op_subscriptions",
      "op_users", "op_workspaces",
    ], "every modelled table must exist after a fresh migration");
    await migrate(target, { migrationsFolder: "opspilot/migrations" });
    const journal = await target.execute(sql`SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations`);
    const expected = (JSON.parse(readFileSync("opspilot/migrations/meta/_journal.json", "utf8")) as { entries: unknown[] }).entries.length;
    assert.equal(journal.rows[0].count, expected, "every generated migration must be recorded exactly once");
  } finally { await targetPool.end(); await db.execute(sql`DROP DATABASE ${sql.identifier(name)}`); }
});
