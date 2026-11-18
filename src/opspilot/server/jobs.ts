/**
 * Durable background jobs on Postgres.
 *
 * Why not Redis/BullMQ: an agency SaaS at this size cannot justify another managed
 * service and another bill, and the database is already the only stateful thing that
 * must survive a deploy. `FOR UPDATE SKIP LOCKED` gives exactly the guarantee a queue
 * needs — two workers cannot claim the same row — and a lease timestamp lets a
 * crashed worker's job be reclaimed instead of stuck forever.
 *
 * Guarantees:
 *  - at-least-once execution (handlers must be idempotent; `dedupe_key` prevents
 *    double *scheduling* of the same logical job)
 *  - exponential backoff with a cap, then a terminal `dead` state that stays visible
 *  - one `op_job_runs` row per attempt, so history is not overwritten by retries
 *  - a stale lease (worker died mid-run) is reclaimed after `JOB_LEASE_MS`
 *
 * Deliberately absent: any in-process timer. Everything runs when `/api/jobs/tick`
 * is called by an external scheduler, which keeps the app stateless and serverless-safe.
 */

import { timingSafeEqual } from "node:crypto";
import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  emailLog,
  emailTokens,
  jobs,
  jobRuns,
  notifications,
  rateLimits,
  records,
  sessions,
  workspaces,
} from "@/db/schema";
import { logError, logInfo, logWarn } from "./log";

export type JobRow = typeof jobs.$inferSelect;
export type JobKind = "maintenance.prune" | "records.due_reminders" | "noop";

export const JOB_LEASE_MS = 5 * 60 * 1000;
export const BACKOFF_BASE_MS = 30_000;
export const MAX_BACKOFF_MS = 60 * 60 * 1000;
export const MAX_JOBS_PER_TICK = 25;

/** 30s, 1m, 2m, 4m … capped at one hour. */
export function backoffDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(MAX_BACKOFF_MS, BACKOFF_BASE_MS * 2 ** exponent);
}

const DEMO_TTL_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ handlers */

export type JobHandler = (job: JobRow) => Promise<void>;

/**
 * Housekeeping. Every delete here is bounded by an age or an expiry column, so a
 * runaway table can never grow without limit even if no one looks at the database.
 */
async function prune(): Promise<void> {
  const now = new Date();
  const demoCutoff = new Date(now.getTime() - DEMO_TTL_MS);
  const tokenCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const logCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const runCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.delete(rateLimits).where(lt(rateLimits.expiresAt, now));
  await db.delete(workspaces).where(and(eq(workspaces.isDemo, true), lt(workspaces.createdAt, demoCutoff)));
  await db.delete(emailTokens).where(and(lt(emailTokens.expiresAt, now), lt(emailTokens.createdAt, tokenCutoff)));
  await db.delete(emailLog).where(lt(emailLog.createdAt, logCutoff));
  await db.delete(jobRuns).where(lt(jobRuns.startedAt, runCutoff));
  await db.delete(jobs).where(and(inArray(jobs.status, ["done", "dead"]), lt(jobs.updatedAt, logCutoff)));
}

/**
 * Turns unpaid invoices that are due soon (or already late) into one in-app
 * notification per workspace per day. This is the first automation customers
 * actually ask for, and it is deliberately conservative: it never sends email,
 * it only surfaces what already exists in the database.
 */
async function dueReminders(): Promise<void> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const due = await db
    .select({ workspaceId: records.workspaceId, name: records.name, amountCents: records.amountCents, dueDate: records.dueDate })
    .from(records)
    .where(and(
      eq(records.kind, "invoice"),
      sql`${records.status} NOT IN ('Paid', 'Draft', 'Void')`,
      lte(records.dueDate, soon),
    ));
  if (due.length === 0) return;

  const byWorkspace = new Map<string, { overdue: number; soon: number; oldest: string }>();
  for (const row of due) {
    const entry = byWorkspace.get(row.workspaceId) ?? { overdue: 0, soon: 0, oldest: row.dueDate ?? today };
    if (row.dueDate && row.dueDate < today) entry.overdue += 1;
    else entry.soon += 1;
    if (row.dueDate && row.dueDate < entry.oldest) entry.oldest = row.dueDate;
    byWorkspace.set(row.workspaceId, entry);
  }

  for (const [workspaceId, counts] of byWorkspace) {
    const title = "Invoices need attention";
    // Idempotent by construction: one notification of this title per workspace per day.
    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.title, title),
        sql`${notifications.createdAt}::date = current_date`,
      ))
      .limit(1);
    if (existing) continue;

    const parts: string[] = [];
    if (counts.overdue > 0) parts.push(`${counts.overdue} invoice${counts.overdue === 1 ? " is" : "s are"} overdue (oldest due ${counts.oldest})`);
    if (counts.soon > 0) parts.push(`${counts.soon} invoice${counts.soon === 1 ? " is" : "s are"} due in the next 3 days`);
    await db.insert(notifications).values({
      workspaceId,
      title,
      module: "invoices",
      message: `${parts.join("; ")}. Follow up or record the payment.`,
    });
  }
}

export const handlers: Record<JobKind, JobHandler> = {
  "maintenance.prune": () => prune(),
  "records.due_reminders": () => dueReminders(),
  noop: async () => {},
};

/** Kinds scheduled once per UTC day by the tick endpoint. */
export const RECURRING_KINDS: JobKind[] = ["maintenance.prune", "records.due_reminders"];

/* --------------------------------------------------------------- scheduling */

export type EnqueueInput = {
  kind: JobKind;
  payload?: Record<string, unknown>;
  runAt?: Date;
  dedupeKey?: string;
  workspaceId?: string;
  maxAttempts?: number;
};

/** Inserts a job. A repeated `dedupeKey` is a no-op, not an error (safe to call twice). */
export async function enqueueJob(input: EnqueueInput): Promise<string | null> {
  const [row] = await db
    .insert(jobs)
    .values({
      kind: input.kind,
      payload: input.payload ?? {},
      runAt: input.runAt ?? new Date(),
      dedupeKey: input.dedupeKey,
      workspaceId: input.workspaceId,
      maxAttempts: input.maxAttempts ?? 6,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  return row?.id ?? null;
}

/** Queues today's recurring maintenance if it has not been queued already. */
export async function ensureRecurringJobs(now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  for (const kind of RECURRING_KINDS) {
    await enqueueJob({ kind, dedupeKey: `recurring:${kind}:${day}`, runAt: now });
  }
}

/* ------------------------------------------------------------------ claiming */

/**
 * Claims up to `limit` due jobs for this worker inside one transaction, so the
 * selection and the status change are atomic. `skipLocked` means a second worker
 * moves on to the next row instead of waiting behind the first.
 */
export async function claimJobs(limit: number, workerId: string, now = new Date()): Promise<JobRow[]> {
  const batch = Math.max(1, Math.min(limit, MAX_JOBS_PER_TICK));
  const leaseCutoff = new Date(now.getTime() - JOB_LEASE_MS);

  return db.transaction(async (tx) => {
    const claimable = or(
      and(eq(jobs.status, "pending"), lte(jobs.runAt, now)),
      and(eq(jobs.status, "running"), lt(jobs.lockedAt, leaseCutoff)),
    );
    const candidates = await tx
      .select()
      .from(jobs)
      .where(claimable)
      .orderBy(jobs.runAt)
      .limit(batch)
      .for("update", { skipLocked: true });
    if (candidates.length === 0) return [];

    const ids = candidates.map((row) => row.id);
    const claimed = await tx
      .update(jobs)
      .set({
        status: "running",
        lockedAt: now,
        lockedBy: workerId.slice(0, 80),
        attempts: sql`${jobs.attempts} + 1`,
        updatedAt: now,
      })
      .where(inArray(jobs.id, ids))
      .returning();
    return claimed;
  });
}

/* ---------------------------------------------------------------- tick auth */

export type TickAuth = { ok: true } | { ok: false; status: number; error: string; notice?: string };

/**
 * Fail-closed check for the tick endpoint. No secret configured means the runner is
 * off, not "open": an unauthenticated queue drain would let anyone burn quota,
 * retry dead jobs or spam notifications.
 */
export function checkTickAuth(authorization: string | null, secret: string): TickAuth {
  if (!secret) {
    return { ok: false, status: 503, error: "Background jobs are disabled.", notice: "Set JOBS_TICK_SECRET to enable the job runner." };
  }
  if (!authorization?.startsWith("Bearer ")) return { ok: false, status: 401, error: "Unauthorised." };
  const provided = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  const match = provided.length === expected.length && timingSafeEqual(provided, expected);
  return match ? { ok: true } : { ok: false, status: 401, error: "Unauthorised." };
}

/* ----------------------------------------------------------------- execution */

export type JobOutcome = "succeeded" | "retry" | "dead";

/** Runs one claimed job and records the attempt. Never throws. */
export async function runJob(job: JobRow): Promise<JobOutcome> {
  const startedAt = new Date();
  const handler = handlers[job.kind as JobKind];

  try {
    if (!handler) throw new Error(`No handler registered for job kind "${job.kind}".`);
    await handler({ ...job, attempts: Math.max(1, job.attempts) });
    const finishedAt = new Date();
    await db
      .update(jobs)
      .set({ status: "done", lockedAt: null, lockedBy: null, lastError: null, updatedAt: finishedAt })
      .where(eq(jobs.id, job.id));
    await db.insert(jobRuns).values({
      jobId: job.id,
      attempt: Math.max(1, job.attempts),
      status: "succeeded",
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      startedAt,
      finishedAt,
    });
    logInfo("job.succeeded", { jobId: job.id, kind: job.kind, attempt: job.attempts });
    return "succeeded";
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const dead = job.attempts >= job.maxAttempts;
    const finishedAt = new Date();
    const retryAt = new Date(finishedAt.getTime() + backoffDelayMs(job.attempts));

    await db
      .update(jobs)
      .set({
        status: dead ? "dead" : "pending",
        lastError: message.slice(0, 2000),
        lockedAt: null,
        lockedBy: null,
        runAt: dead ? job.runAt : retryAt,
        updatedAt: finishedAt,
      })
      .where(eq(jobs.id, job.id));
    await db.insert(jobRuns).values({
      jobId: job.id,
      attempt: Math.max(1, job.attempts),
      status: dead ? "dead" : "failed",
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      error: message.slice(0, 2000),
      startedAt,
      finishedAt,
    });

    if (dead) logError("job.dead", error, { jobId: job.id, kind: job.kind, attempt: job.attempts });
    else logWarn("job.retry", { jobId: job.id, kind: job.kind, attempt: job.attempts, retryAt: retryAt.toISOString(), error: message });
    return dead ? "dead" : "retry";
  }
}

export type TickSummary = {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
  durationMs: number;
  jobs: { id: string; kind: string; outcome: JobOutcome }[];
};

/**
 * Claims and executes due jobs. This is what `/api/jobs/tick` calls and what the
 * tests exercise directly, so the HTTP layer has no logic worth a separate test.
 */
export async function runDueJobs(options: { limit?: number; workerId?: string; ensureRecurring?: boolean } = {}): Promise<TickSummary> {
  const startedAt = Date.now();
  const limit = Math.max(1, Math.min(options.limit ?? MAX_JOBS_PER_TICK, MAX_JOBS_PER_TICK));
  const workerId = options.workerId ?? `tick-${startedAt.toString(36)}`;
  const summary: TickSummary = { claimed: 0, succeeded: 0, retried: 0, dead: 0, durationMs: 0, jobs: [] };

  if (options.ensureRecurring !== false) {
    try {
      await ensureRecurringJobs();
    } catch (error) {
      logError("jobs.schedule_failed", error);
    }
  }

  const claimed = await claimJobs(limit, workerId);
  summary.claimed = claimed.length;
  for (const job of claimed) {
    const outcome = await runJob(job);
    summary.jobs.push({ id: job.id, kind: job.kind, outcome });
    if (outcome === "succeeded") summary.succeeded += 1;
    else if (outcome === "retry") summary.retried += 1;
    else summary.dead += 1;
  }
  summary.durationMs = Date.now() - startedAt;
  logInfo("jobs.tick", {
    workerId,
    claimed: summary.claimed,
    succeeded: summary.succeeded,
    retried: summary.retried,
    dead: summary.dead,
    durationMs: summary.durationMs,
  });
  return summary;
}

/** Recent jobs plus per-status counts, for the admin view. */
export async function jobOverview(limit = 25) {
  const [recent, counts] = await Promise.all([
    db.select({
      id: jobs.id,
      kind: jobs.kind,
      status: jobs.status,
      attempts: jobs.attempts,
      runAt: jobs.runAt,
      lastError: jobs.lastError,
      updatedAt: jobs.updatedAt,
    }).from(jobs).orderBy(sql`${jobs.updatedAt} desc`).limit(Math.min(limit, 100)),
    db.select({ status: jobs.status, total: sql<number>`count(*)::int` }).from(jobs).groupBy(jobs.status),
  ]);
  const byStatus: Record<string, number> = {};
  for (const row of counts) byStatus[row.status] = row.total;
  return { jobs: recent, counts: byStatus };
}
