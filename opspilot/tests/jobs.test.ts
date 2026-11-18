import "dotenv/config";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import {
  jobs,
  jobRuns,
  notifications,
  rateLimits,
  records,
  sessions,
  memberships,
  users,
  workspaces,
} from "../../src/db/schema";
import { resolveConfig, ConfigError, type EnvBag } from "../../src/opspilot/server/config";
import {
  BACKOFF_BASE_MS,
  JOB_LEASE_MS,
  MAX_BACKOFF_MS,
  backoffDelayMs,
  checkTickAuth,
  claimJobs,
  enqueueJob,
  ensureRecurringJobs,
  handlers,
  jobOverview,
  runDueJobs,
  runJob,
  type JobKind,
} from "../../src/opspilot/server/jobs";
import { redactText, log } from "../../src/opspilot/server/log";

const base = process.env.TEST_BASE_URL?.replace(/\/$/, "");
const TICK_SECRET = process.env.JOBS_TICK_SECRET ?? "";

const truncateQueue = async () => {
  await db.execute(sql`TRUNCATE TABLE op_job_runs, op_jobs RESTART IDENTITY CASCADE`);
};

/** Registers a throwaway handler so the queue can be tested without real side effects. */
function stubHandler(kind: string, fn: (job: { id: string; payload: Record<string, unknown> }) => Promise<void>) {
  (handlers as Record<string, unknown>)[kind] = fn;
}

before(async () => { await truncateQueue(); });
after(async () => {
  await truncateQueue();
  await pool.end();
});

/* ------------------------------------------------------------------ *
 * Pure: backoff, auth, logging
 * ------------------------------------------------------------------ */

describe("job backoff and tick authorisation", () => {
  it("backs off exponentially and stops at one hour", () => {
    assert.equal(backoffDelayMs(1), BACKOFF_BASE_MS);
    assert.equal(backoffDelayMs(2), BACKOFF_BASE_MS * 2);
    assert.equal(backoffDelayMs(3), BACKOFF_BASE_MS * 4);
    assert.equal(backoffDelayMs(4), BACKOFF_BASE_MS * 8);
    assert.equal(backoffDelayMs(20), MAX_BACKOFF_MS);
    assert.equal(backoffDelayMs(1), 30_000);
  });

  it("keeps the runner closed when no secret is configured", () => {
    const result = checkTickAuth(null, "");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 503);
    assert.match(result.ok === false ? result.notice ?? "" : "", /JOBS_TICK_SECRET/);
  });

  it("rejects a wrong, absent or non-bearer credential", () => {
    for (const header of [null, "", "Bearer nope", "Basic abc", `Bearer ${"x".repeat(15)}`]) {
      const result = checkTickAuth(header, "job-secret-0123456789");
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.status, 401);
    }
  });

  it("accepts the exact secret", () => {
    assert.deepEqual(checkTickAuth("Bearer job-secret-0123456789", "job-secret-0123456789"), { ok: true });
  });

  it("refuses a weak JOBS_TICK_SECRET at boot", () => {
    const env = (overrides: EnvBag = {}): EnvBag => ({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db", ...overrides });
    assert.throws(() => resolveConfig(env({ JOBS_TICK_SECRET: "short" })), ConfigError);
    assert.equal(resolveConfig(env({ JOBS_TICK_SECRET: "job-secret-0123456789" })).jobsSecret, "job-secret-0123456789");
    assert.equal(resolveConfig(env()).jobsSecret, "", "unset means disabled, not empty-string secret");
  });
});

describe("structured logging", () => {
  it("masks credentials in keys and in free text", () => {
    assert.equal(redactText("Authorization: Bearer abcdefghijklmnop"), "Authorization: Bearer [redacted]");
    assert.equal(redactText(`token ${"a".repeat(64)}`), "token [redacted]");
  });

  it("never throws, whatever it is given", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    assert.doesNotThrow(() => log("info", "test.line", { secret: "hunter2", circular, error: new Error("boom") }));
    assert.doesNotThrow(() => log("error", "test.line", { thrown: "not an error object" }));
  });
});

/* ------------------------------------------------------------------ *
 * Queue mechanics against a real database
 * ------------------------------------------------------------------ */

describe("queue: claiming, execution, retries", () => {
  it("runs an enqueued job exactly once and records the attempt", async () => {
    await truncateQueue();
    let calls = 0;
    stubHandler("noop", async () => { calls += 1; });
    const id = await enqueueJob({ kind: "noop" as JobKind });
    assert.ok(id);

    const summary = await runDueJobs({ ensureRecurring: false });
    assert.equal(calls, 1);
    assert.equal(summary.succeeded, 1);

    const [job] = await db.select().from(jobs).where(eq(jobs.id, id!));
    assert.equal(job.status, "done");
    assert.equal(job.attempts, 1);
    assert.equal(job.lockedAt, null);

    const runs = await db.select().from(jobRuns).where(eq(jobRuns.jobId, id!));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "succeeded");

    // A second tick must not execute a done job again.
    await runDueJobs({ ensureRecurring: false });
    assert.equal(calls, 1);
  });

  it("does not schedule the same logical job twice (dedupe key)", async () => {
    await truncateQueue();
    const first = await enqueueJob({ kind: "noop" as JobKind, dedupeKey: "unique:once" });
    const second = await enqueueJob({ kind: "noop" as JobKind, dedupeKey: "unique:once" });
    assert.ok(first);
    assert.equal(second, null);
    const rows = await db.select().from(jobs);
    assert.equal(rows.length, 1);
  });

  it("leaves a future job alone until its run time", async () => {
    await truncateQueue();
    await enqueueJob({ kind: "noop" as JobKind, runAt: new Date(Date.now() + 60_000) });
    const claimed = await claimJobs(5, "test-worker");
    assert.equal(claimed.length, 0);
    assert.equal((await db.select().from(jobs))[0].status, "pending");
  });

  it("retries a failing job with backoff, then dead-letters it", async () => {
    await truncateQueue();
    let attempts = 0;
    stubHandler("noop", async () => { attempts += 1; throw new Error("upstream 503"); });
    const id = await enqueueJob({ kind: "noop" as JobKind, maxAttempts: 2 });

    await runDueJobs({ ensureRecurring: false });
    let [job] = await db.select().from(jobs).where(eq(jobs.id, id!));
    assert.equal(job.status, "pending", "a failure with attempts left must be rescheduled");
    assert.equal(job.attempts, 1);
    assert.match(job.lastError ?? "", /upstream 503/);
    assert.ok(job.runAt.getTime() > Date.now() + BACKOFF_BASE_MS - 5_000, "run_at must move into the future");

    // Not due yet: another tick must not run it early.
    const early = await runDueJobs({ ensureRecurring: false });
    assert.equal(early.claimed, 0);

    await db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, id!));
    await runDueJobs({ ensureRecurring: false });
    [job] = await db.select().from(jobs).where(eq(jobs.id, id!));
    assert.equal(job.status, "dead");
    assert.equal(job.attempts, 2);
    assert.equal(attempts, 2);

    const runs = await db.select().from(jobRuns).where(eq(jobRuns.jobId, id!)).orderBy(jobRuns.attempt);
    assert.deepEqual(runs.map((run) => run.status), ["failed", "dead"]);

    // Dead is terminal: no further claims even once its run time passes.
    await db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, id!));
    const after = await runDueJobs({ ensureRecurring: false });
    assert.equal(after.claimed, 0);
  });

  it("dead-letters an unknown job kind instead of crashing the tick", async () => {
    await truncateQueue();
    await db.insert(jobs).values({ kind: "does.not.exist", maxAttempts: 1 });
    const summary = await runDueJobs({ ensureRecurring: false });
    assert.equal(summary.dead, 1);
    const [job] = await db.select().from(jobs);
    assert.equal(job.status, "dead");
    assert.match(job.lastError ?? "", /No handler registered/);
  });

  it("runs each job with a successful outcome recorded by the real handler", async () => {
    await truncateQueue();
    const summary = await runDueJobs({ ensureRecurring: true });
    // The two recurring kinds are due immediately on the first tick of the day.
    assert.ok(summary.claimed >= 2, "recurring maintenance must be scheduled by a tick");
    const kinds = await db.select({ kind: jobs.kind, status: jobs.status }).from(jobs);
    assert.ok(kinds.some((row) => row.kind === "maintenance.prune"));
    assert.ok(kinds.every((row) => row.status !== "dead"), "real handlers must not dead-letter on an empty database");
  });

  it("schedules recurring work only once per day", async () => {
    await truncateQueue();
    await ensureRecurringJobs();
    await ensureRecurringJobs();
    const rows = await db.select().from(jobs);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.kind).sort(), ["maintenance.prune", "records.due_reminders"]);
  });

  it("never lets two workers claim the same job", async () => {
    await truncateQueue();
    for (let index = 0; index < 4; index += 1) await enqueueJob({ kind: "noop" as JobKind, dedupeKey: `race:${index}` });
    const [a, b] = await Promise.all([claimJobs(4, "worker-a"), claimJobs(4, "worker-b")]);
    const ids = [...a, ...b].map((job) => job.id);
    assert.equal(ids.length, 4);
    assert.equal(new Set(ids).size, 4, "SKIP LOCKED must hand each job to exactly one worker");
    assert.equal(a.length + b.length, 4);
  });

  it("reclaims a job whose worker died mid-run", async () => {
    await truncateQueue();
    let calls = 0;
    stubHandler("noop", async () => { calls += 1; });
    const id = await enqueueJob({ kind: "noop" as JobKind });
    await db.update(jobs)
      .set({ status: "running", lockedBy: "dead-worker", lockedAt: new Date(Date.now() - JOB_LEASE_MS - 60_000) })
      .where(eq(jobs.id, id!));

    const summary = await runDueJobs({ ensureRecurring: false });
    assert.equal(summary.succeeded, 1);
    assert.equal(calls, 1);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id!));
    assert.equal(job.status, "done");
  });

  it("skips a running job whose lease is still valid", async () => {
    await truncateQueue();
    const id = await enqueueJob({ kind: "noop" as JobKind });
    await db.update(jobs).set({ status: "running", lockedBy: "busy", lockedAt: new Date() }).where(eq(jobs.id, id!));
    const claimed = await claimJobs(5, "other");
    assert.equal(claimed.length, 0);
  });

  it("caps attempts per tick so one tick cannot run the whole backlog", async () => {
    await truncateQueue();
    for (let index = 0; index < 4; index += 1) await enqueueJob({ kind: "noop" as JobKind, dedupeKey: `cap:${index}` });
    const summary = await runDueJobs({ ensureRecurring: false, limit: 2 });
    assert.equal(summary.claimed, 2);
    const pending = await db.select().from(jobs).where(eq(jobs.status, "pending"));
    assert.equal(pending.length, 2);
  });

  it("runJob reports an outcome even for a job it cannot handle", async () => {
    await truncateQueue();
    const [row] = await db.insert(jobs).values({ kind: "nope", maxAttempts: 1, attempts: 1 }).returning();
    assert.equal(await runJob(row), "dead");
  });

  it("summarises queue state for the admin view", async () => {
    await truncateQueue();
    await enqueueJob({ kind: "noop" as JobKind, dedupeKey: "overview:1" });
    const overview = await jobOverview();
    assert.equal(overview.counts.pending, 1);
    assert.equal(overview.jobs.length, 1);
    assert.equal(overview.jobs[0].kind, "noop");
  });
});

/* ------------------------------------------------------------------ *
 * Real handlers: housekeeping and invoice reminders
 * ------------------------------------------------------------------ */

describe("maintenance.prune", () => {
  it("deletes expired sessions, rate-limit buckets and stale demo workspaces only", async () => {
    const staleUser = randomUUID();
    await db.insert(users).values({ id: staleUser, name: "Stale Demo", email: `stale-${staleUser}@example.com`, passwordHash: "x:y" });
    const demoOld = randomUUID();
    await db.insert(workspaces).values({ id: demoOld, name: `Old demo ${demoOld.slice(0, 8)}`, isDemo: true, createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) });
    await db.insert(memberships).values({ workspaceId: demoOld, userId: staleUser, role: "owner" });

    const freshUser = randomUUID();
    await db.insert(users).values({ id: freshUser, name: "Fresh Demo", email: `fresh-${freshUser}@example.com`, passwordHash: "x:y" });
    const demoNew = randomUUID();
    await db.insert(workspaces).values({ id: demoNew, name: `New demo ${demoNew.slice(0, 8)}`, isDemo: true, createdAt: new Date() });
    await db.insert(memberships).values({ workspaceId: demoNew, userId: freshUser, role: "owner" });

    const expiredSession = `${randomUUID().replaceAll("-", "")}`.padEnd(64, "0").slice(0, 64);
    const liveSession = `${randomUUID().replaceAll("-", "")}`.padEnd(64, "1").slice(0, 64);
    await db.insert(sessions).values([
      { tokenHash: expiredSession, userId: staleUser, workspaceId: demoOld, expiresAt: new Date(Date.now() - 1000) },
      { tokenHash: liveSession, userId: freshUser, workspaceId: demoNew, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const bucket = `prune-${randomUUID()}`.slice(0, 64);
    await db.insert(rateLimits).values({ key: bucket, count: 1, expiresAt: new Date(Date.now() - 1000) });

    await handlers["maintenance.prune"]({
      id: "manual", kind: "maintenance.prune", payload: {}, runAt: new Date(), attempts: 1, maxAttempts: 6,
      dedupeKey: null, workspaceId: null, lockedAt: null, lockedBy: null, lastError: null,
      createdAt: new Date(), updatedAt: new Date(), status: "running",
    });

    const oldLeft = await db.select().from(workspaces).where(eq(workspaces.id, demoOld));
    assert.equal(oldLeft.length, 0, "demo workspace past its TTL must be deleted");
    const newLeft = await db.select().from(workspaces).where(eq(workspaces.id, demoNew));
    assert.equal(newLeft.length, 1, "a fresh demo workspace must survive");

    const expiredLeft = await db.select().from(sessions).where(eq(sessions.tokenHash, expiredSession));
    assert.equal(expiredLeft.length, 0, "expired sessions are removed");
    const liveLeft = await db.select().from(sessions).where(eq(sessions.tokenHash, liveSession));
    assert.equal(liveLeft.length, 1, "a live session must survive");

    const bucketLeft = await db.select().from(rateLimits).where(eq(rateLimits.key, bucket));
    assert.equal(bucketLeft.length, 0, "expired rate-limit buckets are removed");

    await db.delete(workspaces).where(eq(workspaces.id, demoNew));
  });
});

describe("records.due_reminders", () => {
  it("creates one notification per workspace and is idempotent within a day", async () => {
    const workspaceId = randomUUID();
    await db.insert(workspaces).values({ id: workspaceId, name: `Reminder ${workspaceId.slice(0, 8)}` });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db.insert(records).values([
      { workspaceId, kind: "invoice", name: "Overdue invoice", status: "Sent", amountCents: 50000, dueDate: yesterday },
      { workspaceId, kind: "invoice", name: "Invoice due soon", status: "Draft", amountCents: 20000, dueDate: tomorrow },
      { workspaceId, kind: "invoice", name: "Paid invoice", status: "Paid", amountCents: 90000, dueDate: yesterday },
    ]);

    await handlers["records.due_reminders"]({ id: "manual", kind: "records.due_reminders", payload: {}, runAt: new Date(), attempts: 1, maxAttempts: 6, dedupeKey: null, workspaceId: null, lockedAt: null, lockedBy: null, lastError: null, createdAt: new Date(), updatedAt: new Date(), status: "running" });

    const created = await db.select().from(notifications).where(eq(notifications.workspaceId, workspaceId));
    assert.equal(created.length, 1);
    assert.match(created[0].message, /1 invoice is overdue/);
    assert.doesNotMatch(created[0].message, /3 invoices/, "drafts and paid invoices must not be chased");
    assert.equal(created[0].module, "invoices");

    await handlers["records.due_reminders"]({ id: "manual-2", kind: "records.due_reminders", payload: {}, runAt: new Date(), attempts: 1, maxAttempts: 6, dedupeKey: null, workspaceId: null, lockedAt: null, lockedBy: null, lastError: null, createdAt: new Date(), updatedAt: new Date(), status: "running" });
    const again = await db.select().from(notifications).where(eq(notifications.workspaceId, workspaceId));
    assert.equal(again.length, 1, "a second run the same day must not duplicate the reminder");
  });
});

/* ------------------------------------------------------------------ *
 * HTTP surface
 * ------------------------------------------------------------------ */

describe("tick and job history endpoints", () => {
  const post = (path: string, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: "POST", headers });

  it("requires a session to read job history", async () => {
    const response = await fetch(`${base}/api/jobs`);
    assert.equal(response.status, 401);
  });

  it("rejects a tick without the secret", async () => {
    const response = await post("/api/jobs/tick");
    assert.equal(response.status, 401);
  });

  it("rejects a tick with the wrong secret", async () => {
    const response = await post("/api/jobs/tick", { Authorization: `Bearer ${"z".repeat(TICK_SECRET.length || 24)}` });
    assert.equal(response.status, 401);
  });

  it("runs the queue when the secret is correct", async () => {
    assert.ok(TICK_SECRET, "JOBS_TICK_SECRET must be set for the test server");
    const response = await post("/api/jobs/tick?limit=5", { Authorization: `Bearer ${TICK_SECRET}` });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.jobs));
    assert.equal(typeof body.durationMs, "number");
  });

  it("refuses GET on the tick endpoint", async () => {
    const response = await fetch(`${base}/api/jobs/tick`, { headers: { Authorization: `Bearer ${TICK_SECRET}` } });
    assert.equal(response.status, 405);
  });

  it("reports readiness with migration state", async () => {
    const response = await fetch(`${base}/api/health/ready`);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.checks.database.ok, true);
    assert.equal(body.checks.migrations.ok, true);
    assert.match(body.checks.migrations.detail, /migrations applied/);
    assert.match(body.version, /^\d+\.\d+\.\d+/);
  });
});
