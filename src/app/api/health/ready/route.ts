import { sql } from "drizzle-orm";
import { db } from "@/db";
import { APP_VERSION, EXPECTED_MIGRATIONS } from "@/opspilot/server/version";

export const dynamic = "force-dynamic";

/**
 * Readiness: is this instance allowed to take traffic?
 *
 * Distinct from `/api/health` (liveness). A load balancer should use this one:
 * a container that is up but has not run its migrations must not receive
 * requests, because every authenticated route would fail in a confusing way.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  let ok = true;

  try {
    await db.execute(sql`select 1`);
    checks.database = { ok: true };
  } catch {
    checks.database = { ok: false, detail: "Database unreachable." };
    ok = false;
  }

  if (checks.database.ok) {
    try {
      const result = await db.execute<{ count: number }>(sql`select count(*)::int as count from drizzle.__drizzle_migrations`);
      const applied = Number((result.rows?.[0] as { count?: number } | undefined)?.count ?? 0);
      const migrated = applied >= EXPECTED_MIGRATIONS;
      checks.migrations = migrated
        ? { ok: true, detail: `${applied} migrations applied` }
        : { ok: false, detail: `${applied} of ${EXPECTED_MIGRATIONS} migrations applied — run the migration job.` };
      ok &&= migrated;
    } catch {
      checks.migrations = { ok: false, detail: "Migration ledger missing — the database was never migrated." };
      ok = false;
    }

    try {
      // The queue is a hard dependency of reminders and dunning; surface it early.
      await db.execute(sql`select 1 from op_jobs limit 1`);
      checks.jobs = { ok: true };
    } catch {
      checks.jobs = { ok: false, detail: "op_jobs missing — migration incomplete." };
      ok = false;
    }
  }

  return Response.json(
    { ok, version: APP_VERSION, checks },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
