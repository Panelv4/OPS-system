# Changelog

## 0.5.0 — Background jobs, readiness and structured logs

### Added
- Durable job queue on Postgres (`op_jobs`, `op_job_runs`): `FOR UPDATE SKIP LOCKED` claiming,
  a five-minute lease that reclaims jobs from a crashed worker, exponential backoff (30s doubling
  to 1h), an attempt cap and a terminal `dead` state that keeps its error, plus one run row per
  attempt so retries never overwrite history.
- `POST /api/jobs/tick`, authenticated with `JOBS_TICK_SECRET` and safe to call from several
  schedulers at once; `?limit=` caps work per tick. Unset secret means 503 (disabled), not open.
- Two real handlers: `maintenance.prune` (expired sessions, rate-limit buckets, stale demo
  workspaces, old email tokens/logs, finished jobs) and `records.due_reminders` (one in-app
  notification per workspace per day for overdue or soon-due invoices).
- `GET /api/jobs` run history for owners/administrators.
- `GET /api/health/ready`: database, migration ledger (against `EXPECTED_MIGRATIONS`), queue table
  and app version; 503 with a reason when any check fails.
- Structured JSON logging (`log.ts`) with `LOG_LEVEL`, secret/key redaction, `x-request-id`
  propagation from middleware and one access line per request without the query string.
- `opspilot/docs/JOBS.md` and 28 job tests (backoff, auth, dedupe, races, lease reclaim, retries,
  dead letters, both handlers, endpoints, readiness).

### Changed
- `package.json` now carries a real name and version (`opspilot` 0.5.0) and `/api/health/ready`
  reports it.
- Existing `console.*` error paths in auth, mailer, tokens and billing now emit structured lines.

### Notes
- The restore drill is documented but has not been executed; T-303 stays open until it is.
- Reminder emails, dunning and an approval gate are not implemented (T-403/T-404).

## 0.4.0 — Email, verification, recovery and invitations

### Added
- Mailer with two transports: `console` (default, logs and records) and `resend` (HTTP API, no SDK),
  plus an `op_email_log` delivery table and `MAIL_TRANSPORT` / `MAIL_FROM` / `RESEND_API_KEY` /
  `APP_URL` configuration with fail-closed validation.
- Single-use hashed action tokens (`op_email_tokens`): purpose-bound, 24h / 30min / 7d TTLs, atomic
  consumption, rotation of outstanding tokens.
- Email verification at registration and `POST /api/session/verify`; `users.email_verified_at` and
  `user.emailVerified` in the workspace payload.
- Self-service password reset (`request-reset`, `reset`) that never reveals whether an address has
  an account and revokes every session on success.
- Workspace invitations: `POST /api/members` (owner/admin, role-bound, seat-enforced),
  `POST /api/members/accept`, `GET /api/members`, plus the three link screens on `/login`
  (`mode=verify|reset|invite`) and a working recovery form replacing the old "not enabled" notice.
- `opspilot/docs/EMAIL.md` and 12 email tests covering config, templates, token lifecycle and all
  three flows end to end.

### Notes
- Delivery runs on the console transport: nothing is sent externally until a domain is verified
  with Resend. The Resend adapter itself is unverified against the live API.
- Seats are now enforced, which completes the last billing quota (T-107).

## 0.3.0 — Billing core (test mode)

### Added
- Plan catalogue as configuration (`lib/plans.ts`): Free / Starter $29 / Growth $59 / Scale $119,
  seats, AI quota, storage and automation limits, plus environment price overrides.
- `op_subscriptions` and `op_billing_events` tables (migration `0002`), with
  `unique(provider, event_id)` for idempotent webhook delivery.
- `server/billing.ts`: subscription state machine, entitlement resolution, quota enforcement, and
  Stripe-compatible HMAC webhook verification with a 300-second replay window.
- `GET /api/billing` (plan, usage, limits, catalogue), `POST /api/billing/checkout` (records intent,
  never grants), `POST /api/billing/webhook` (the only path that can grant a paid plan).
- Quota enforcement on AI questions, document storage and active automations; 402 with the plan
  name and limit.
- `opspilot/docs/BILLING.md` and 13 new billing tests (catalogue, signatures, state machine,
  quotas, HTTP round trip).

### Notes
- No payment gateway is connected. `BILLING_PROVIDER=stripe` returns 501 by design; a merchant
  account and live charging require founder approval.
- 21 API tests and 34 unit/migration/hardening tests unchanged and passing; migration test now
  asserts the exact table set instead of a count.

## 0.2.0 — Audit and hardening pass

### Added
- `config.ts` with validated runtime configuration and fail-fast startup via `instrumentation.ts`
  (missing/malformed `DATABASE_URL`, bad flags, `AI_ENABLED` without a key, plain-HTTP AI endpoints).
- `TRUST_PROXY` setting: forwarded headers are only trusted when explicitly enabled.
- `pruneExpiredData()` housekeeping: expired sessions, expired rate-limit buckets, and demo
  workspaces older than 24 hours, backed by new `expires_at` indexes (migration `0001`).
- `Strict-Transport-Security` header; `HEALTHCHECK` in the image; one-shot `migrate` compose service.
- Hardening test suite (10 cases) and audit documentation: `AUDIT.md`, `SECURITY_AUDIT.md`,
  `PRODUCTION_READINESS.md`, `FEATURE_MATRIX.md`, `IMPLEMENTATION_ROADMAP.md`, `TASKS.md`.

### Security
- Fixed a rate-limit bypass: rotating `X-Forwarded-For` produced 45/45 unthrottled login attempts.
- Registration no longer leaks account existence through response timing (7 ms vs 52 ms).
- Demo workspace creation is capped (120/hour globally, 15/hour per address behind a proxy).
- Container startup no longer runs migrations, so replicas cannot race a schema change.

### Fixed
- Docker runtime stage was missing `src/opspilot/server`, which the migration script imports.
- Migration test now asserts against the journal entry count instead of a hard-coded `1`.
- CI actions updated to v7 (Node 20 deprecation).

## 0.1.0 — OpsPilot foundation

### Added
- New branded responsive workspace and product/authentication pages.
- PostgreSQL/Drizzle tenant schema and generated migration.
- Registration, login/logout, membership-derived sessions, role policies, validation, audit events, and rate limits.
- Connected dashboard, CRM pipeline, invoices/payments, expenses, employee/vendor directories, projects/tasks, products/stock, documents, global search, and notifications.
- Local business insights and optional structured-intent provider integration.
- Reviewed draft-to-active notification workflows with execution history.
- Unit, database/API, fresh-migration, and browser regression suites.
- Environment/deployment/backup scaffolding and explicit security/unfinished-feature documentation.

### Corrected during review
- Public user response projection.
- Revenue attribution to payment dates.
- Cross-workspace invoice customer selection.
- Duplicate/retried/concurrent payment handling.
- Financial history overwrite restrictions.
- Document content validation and safe CSV export.
- Permission-aware dashboard visibility.
- Decorative accessible labels and local variable-font loading.

### Release limitations
This is not the complete requested ERP/HRMS/procurement/automation/billing roadmap. See `opspilot/docs/UNFINISHED.md` before evaluating production use.
