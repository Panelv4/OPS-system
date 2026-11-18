# Changelog

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
