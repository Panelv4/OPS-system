# Background jobs, readiness and logs

Three operational pieces that had to exist before anything can be scheduled or
debugged in production: a durable job queue, a readiness probe that knows whether
migrations ran, and structured logs with request ids.

Everything here is deliberately boring infrastructure: Postgres as the queue, one
authenticated HTTP endpoint as the runner, one JSON line per event, and no new
managed service. Nothing needs a long-lived worker host, so the app stays
serverless-deployable (Vercel, Fly, a single VPS, Kubernetes).

---

## 1. The queue

Tables: `op_jobs` (one row per job) and `op_job_runs` (one row per attempt).

| Column | Meaning |
| --- | --- |
| `kind` | handler name, e.g. `maintenance.prune` |
| `payload` | JSON arguments for the handler |
| `status` | `pending` → `running` → `done` ǀ `failed`(retry pending) → `dead` |
| `run_at` | earliest execution time (also the retry time after a failure) |
| `attempts` / `max_attempts` | attempt counter and the cap (default 6) |
| `dedupe_key` | unique; makes "schedule this once" idempotent |
| `locked_at` / `locked_by` | lease owner and its start time |
| `last_error` | most recent failure, truncated to 2 000 characters |

### Why Postgres instead of Redis/BullMQ

`SELECT … FOR UPDATE SKIP LOCKED` gives exactly the guarantee a queue needs — two
workers can never claim the same row — without a second stateful service to pay
for, secure and back up. At agency-SaaS volume (thousands of jobs a day at most)
the database is not the bottleneck; if it ever is, the same interface can be
pointed at a real queue without touching a handler.

### Claiming

`claimJobs(limit, workerId)` runs inside one transaction:

```sql
SELECT * FROM op_jobs
WHERE (status = 'pending' AND run_at <= now())
   OR (status = 'running' AND locked_at < now() - interval '5 minutes')
ORDER BY run_at
LIMIT $1
FOR UPDATE SKIP LOCKED;
```

then flips the rows to `running` with a fresh lease and `attempts + 1`. The second
clause is what makes a crashed worker recoverable: its lease expires after
`JOB_LEASE_MS` (5 minutes) and the job is retried instead of being stuck forever.

Verified by test: four jobs, two workers claiming concurrently → each job claimed
exactly once (`jobs.test.ts`, "never lets two workers claim the same job").

### Retries and dead letters

Backoff is exponential from 30 s, doubled per attempt, capped at one hour:
30 s → 1 min → 2 min → 4 min → 8 min …

A failure with attempts left returns the job to `pending` with `run_at` moved
forward. At the cap it becomes `dead`, keeps `last_error`, and is never claimed
again. Every attempt is appended to `op_job_runs`, so a retry never overwrites the
history of the attempt before it.

An unknown `kind` is not a crash: it dead-letters with
`No handler registered for job kind "…"`, which is how a renamed handler shows up
in the run history instead of silently vanishing.

### Handlers

| Kind | What it does | Safety property |
| --- | --- | --- |
| `maintenance.prune` | deletes expired sessions, expired rate-limit buckets, demo workspaces older than 24 h, expired email tokens older than 30 days, email log older than 90 days, finished jobs and runs older than their retention | every delete is bounded by an age or expiry column, so no table can grow without limit |
| `records.due_reminders` | one in-app notification per workspace per day when invoices are overdue or due within 3 days | never sends email, never changes money, idempotent by a per-day existence check |
| `noop` | test handler | — |

`maintenance.prune` and `records.due_reminders` are **recurring**: each tick
enqueues today's copy with `dedupe_key = recurring:<kind>:<YYYY-MM-DD>`, so
`ON CONFLICT DO NOTHING` makes a hundred ticks a day still run it once.

Adding a handler: write an idempotent `async (job) => void`, register it in
`handlers` in `src/opspilot/server/jobs.ts`. Handlers may be re-run after a crash
mid-execution, so they must tolerate being called twice.

---

## 2. Running it

Jobs run only when something calls the tick endpoint:

```bash
curl -fsS -X POST https://app.example.com/api/jobs/tick \
  -H "Authorization: Bearer $JOBS_TICK_SECRET"
```

Response:

```json
{"ok":true,"claimed":2,"succeeded":2,"retried":0,"dead":0,"durationMs":19,
 "jobs":[{"id":"c210a060-…","kind":"maintenance.prune","outcome":"succeeded"}]}
```

`?limit=N` caps how many jobs one tick takes (default and maximum 25), so one
tick cannot run an unbounded backlog.

Pick one scheduler:

```bash
# crontab -e — every minute
* * * * * curl -fsS -X POST https://app.example.com/api/jobs/tick -H "Authorization: Bearer $JOBS_TICK_SECRET" >/dev/null

# systemd timer (OnUnitActiveSec=60s) calling the same curl in a oneshot unit
```

On Vercel, a `vercel.json` cron with the same path and an `Authorization` header
from an environment variable works the same way. Any scheduler that can send an
authenticated POST is enough; the app holds no timer state.

### Security

- `JOBS_TICK_SECRET` (16+ characters) is required; unset means the endpoint
  returns **503 "Background jobs are disabled."** — closed, not open.
- The bearer token is compared with `timingSafeEqual` after a length check.
- Wrong or missing credentials → `401` plus a `jobs.tick_unauthorised` log line.
- The endpoint is `POST` only.
- `GET /api/jobs` (run history) needs a session and the `owner`/`administrator`
  role; it is not a public status page.

Generate a secret with `openssl rand -hex 24` and never reuse it across
environments.

### Triaging a dead job

```sql
-- what is failing, and how often
select kind, count(*) from op_jobs where status = 'dead' group by kind;

-- the detail, newest first
select j.kind, j.attempts, j.last_error, r.started_at, r.duration_ms
from op_jobs j join op_job_runs r on r.job_id = j.id
where j.status = 'dead' order by r.started_at desc limit 20;

-- requeue after a fix (reset the counter so it gets a full budget)
update op_jobs set status = 'pending', attempts = 0, run_at = now(), locked_at = null, locked_by = null
where id = '…';
```

---

## 3. Readiness probe

`GET /api/health/ready` — for load balancers and deploys.

```json
{"ok":true,"version":"0.5.0","checks":{
  "database":{"ok":true},
  "migrations":{"ok":true,"detail":"5 migrations applied"},
  "jobs":{"ok":true}}}
```

Returns **503** with `ok:false` if the database is unreachable, if the migration
ledger is missing, if fewer than `EXPECTED_MIGRATIONS` migrations are applied, or
if `op_jobs` does not exist. A container that is up but unmigrated must not
receive traffic — every authenticated route would fail in a confusing way.

`GET /api/health` stays as the cheap liveness probe (`select 1`).

`EXPECTED_MIGRATIONS` lives in `src/opspilot/server/version.ts` and is asserted
against the migration journal by `migrations.test.ts`, so adding a migration
without bumping it fails CI rather than surfacing as a false-ready deploy.

### Restore drill (documented, not yet executed in this environment)

The drill must actually be run against a staging database before launch; a
documented drill nobody ran is not a backup.

```bash
# 1. take a dump from the primary
pg_dump --format=custom --file=/tmp/opspilot-$(date -u +%F).dump "$DATABASE_URL"

# 2. restore into an empty database
createdb opspilot_restore
pg_restore --dbname=opspilot_restore --clean --if-exists /tmp/opspilot-$(date -u +%F).dump

# 3. prove it is the real thing
psql opspilot_restore -c "select count(*) from op_workspaces;"
psql opspilot_restore -c "select count(*) from op_users;"
psql opspilot_restore -c "select count(*) from drizzle.__drizzle_migrations;"

# 4. point the app at it and check readiness
DATABASE_URL=postgresql://…/opspilot_restore npm start &
curl -fsS localhost:3000/api/health/ready
```

Record the timestamp, dataset size and wall-clock restore time in
`validation/`; that number is the real RTO.

**Status:** not executed here — this sandbox's embedded Postgres ships only
`initdb`/`pg_ctl`/`postgres`, with no `pg_dump`/`pg_restore`. Task T-303 stays
open on that point.

---

## 4. Structured logs

Every line is one JSON object on stdout/stderr:

```json
{"ts":"2026-11-18T03:14:42.088Z","level":"info","service":"opspilot",
 "event":"jobs.tick","workerId":"tick-mwljslxx","claimed":2,"succeeded":2,
 "retried":0,"dead":0,"durationMs":19}
```

- `src/opspilot/server/log.ts` — `log`, `logInfo`, `logWarn`, `logError`.
- `LOG_LEVEL` (`debug|info|warn|error`, default `info`) filters.
- **Redaction:** keys matching `pass|secret|token|api_key|authorization|cookie|
  credential|signature` become `[redacted]`; bearer tokens and 64-character hex
  tokens are masked even inside free text. Logging can never throw.
- `src/middleware.ts` assigns `x-request-id` (UUID, or an inbound one that
  matches `[A-Za-z0-9._-]{8,80}`), returns it on the response, and emits one
  `http.request` line with method and path.
- The **query string is never logged**: reset and invitation tokens live there.

Correlating: the access line and any `api.unhandled`/`job.*` lines from the same
request share a timestamp window; a real log aggregator (Loki, Datadog, Better
Stack) can index `requestId` directly once the header is propagated.

### What is still missing

- No error tracker (Sentry or equivalent): errors are structured logs, not
  grouped issues with stack traces and alerting. T-304 is done for logs, not for
  error aggregation.
- Nothing alerts on `jobs.tick` returning `dead > 0`; today that requires a
  dashboard or an alert on the log pattern.
- `JOB_LEASE_MS` is a constant; a handler that legitimately runs longer than five
  minutes would be reclaimed and run twice mid-flight.
