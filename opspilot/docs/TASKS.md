# OpsPilot task backlog

Single source of truth for sequenced work. Every task has an ID used by the other audit documents.
Status: `done` · `in progress` · `open` · `blocked` (needs a founder decision) · `needs approval`
(irreversible or externally visible).

Priority: **P0** = blocks taking money · **P1** = blocks self-serve launch · **P2** = needed within
90 days · **P3** = later.

---

## M0 — Audit and hardening (this pass)

| ID | Task | Priority | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-001 | Baseline: build, lint, types, unit, API tests, audit on a real Postgres | P0 | done | `validation/baseline-2026-11-17.txt`: 24/24 + 21/21, 0 vulns |
| T-002 | Stop trusting client-supplied `X-Forwarded-For`; layered limiter | P0 | done | rotation probe blocked; `hardening.test.ts` (10 cases) |
| T-003 | Prune expired sessions, rate-limit buckets, stale demo workspaces + `expires_at` indexes | P1 | done | migration `0001_lonely_reptil.sql`; DB-backed test |
| T-004 | Equalise registration timing (duplicate vs new email) | P2 | done | 8 ms → ~48 ms on the duplicate path |
| T-005 | Startup configuration validation + fail-fast `instrumentation.ts` | P0 | done | 5 unit cases; boot logs verified |
| T-006 | HSTS header (no `preload`); fix build-time-evaluated gating | P1 | done | curl header probe |
| T-007 | Move migrations out of container `CMD`; add `HEALTHCHECK`; fix runtime copy list | P0 | done | runtime layout simulated green |
| T-008 | CI: bump actions to v7, add hardening suite | P2 | done | CI run on this branch |
| T-009 | Write AUDIT / SECURITY_AUDIT / PRODUCTION_READINESS / FEATURE_MATRIX / ROADMAP / TASKS | P0 | done | this document set |

## M1 — Charge money (the only milestone that creates revenue)

| ID | Task | Priority | Status | Notes / acceptance |
| --- | --- | --- | --- | --- |
| T-101 | Plan catalogue in config (Free/Starter $29/Growth $59/Scale $119; seats, AI quota, storage quota) | P0 | **done** | `src/opspilot/lib/plans.ts`; env price overrides; catalogue tests |
| T-102 | `subscriptions`, `billing_events` tables + migration | P0 | **done** | migration `0002_lovely_mach_iv.sql`; lazy free row per workspace |
| T-103 | Gateway adapter interface + Stripe implementation (test mode) | P0 | blocked → **T-103a** | `BILLING_PROVIDER=stripe` refuses with 501 rather than faking a URL. Needs merchant account (founder) |
| T-104 | Checkout session creation | P0 | **partial** | `POST /api/billing/checkout` records intent (202) and never grants; hosted page needs the provider |
| T-105 | Webhook signature verification, replay window, idempotent event log | P0 | **done** | HMAC-SHA256 `t=.v1=`, 300s tolerance, `unique(provider,event_id)`; 5 signature cases + HTTP replay test |
| T-106 | Upgrade / downgrade / cancel / failed-payment / expiry state machine | P0 | **done** (no proration) | `applyBillingEvent` + `effectivePlanId`; grace 7d; every branch unit-tested |
| T-107 | Entitlement enforcement (AI, storage, workflows) | P0 | **done** for 3 of 4 | seats blocked on T-204; all fail closed with 402 + plan name |
| T-108 | Billing history page + receipts | P1 | open | `op_billing_events` is the source; `GET /api/billing` exists |
| T-109 | Wire `Settings.tsx` plan tab to `GET /api/billing` (remove stale ₹101/₹499/₹1,499 copy) | P1 | open | UI currently shows "proposed plans" text |
| T-110 | Trial creation + proration on mid-period upgrade | P2 | open | `trialing` status recognised but never set |

**M1 progress:** billing core shipped in this pass (`BILLING.md`), test-mode only, no gateway and
no live charging. Remaining M1 work: hosted checkout page (§7 of `BILLING.md`), billing history UI
(T-108), plan-tab wiring (T-109), trials/proration (T-110).

## M2 — Self-serve launch (a stranger can sign up, recover, invite, and trust it)

| ID | Task | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| T-201 | Mailer interface + provider (Postmark/Resend/SES) + dev console transport | P0 | open | No SMTP dependency enters tests; delivery log table |
| T-202 | Email verification on registration | P1 | open | Gate invitations/billing until verified |
| T-203 | Password reset (single-use token, 30 min, revoke sessions on use) | P1 | open | Closes F-10 |
| T-204 | Workspace invitations + acceptance | P1 | open | Uses `op_memberships`; adds member management UI |
| T-205 | Session list + revoke-all + revoke-on-password-change | P2 | open | Needs `sessions.created_at`, user agent, last-seen |
| T-206 | Nonce-based CSP, drop `unsafe-inline` | P2 | open | Verify in a real browser |
| T-207 | Member management endpoints + UI (invite, role change, remove, audit) | P0 | open | RBAC exists but cannot be exercised |
| T-208 | Breach-password check (HIBP k-anonymity) | P2 | open | Fail open on network error, log it |
| T-209 | Revoke UPDATE/DELETE on `op_audit_events` for the app role | P2 | open | Deployment SQL, documented in runbook |
| T-210 | Independent penetration test | P0 | needs approval | External cost/NDA; founder decision |

## M3 — Storage, jobs, observability

| ID | Task | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| T-301 | Storage abstraction: `PostgresFiles` (current) + `S3Files`; presigned download | P1 | open | Keep DB adapter for self-host; migrate lazily |
| T-302 | Upload virus scanning hook | P3 | open | After object storage |
| T-303 | `/api/health/ready` (migration state, version) + documented restore drill | P0 | open | Drill must be executed, not described |
| T-304 | Structured JSON logs with request id + error tracking | P1 | open | One `log()` helper, no new console calls |
| T-305 | Load test (50 concurrent) + connection-pool sizing | P2 | open | Record p95 and DB connection ceiling |
| T-306 | Document delete + versions + per-document ACL | P2 | open | Needed before agencies upload client contracts |

## M4 — Automations that agencies actually pay for

| ID | Task | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| T-401 | `jobs` table + `SKIP LOCKED` claim + `/api/jobs/tick` (cron) | P1 | open | No worker host required |
| T-402 | Retry with exponential backoff, attempt cap, dead-letter status | P1 | open | Visible in an admin view |
| T-403 | Scheduled/delayed actions (invoice reminders, task due notices) | P1 | open | First real automation customers ask for |
| T-404 | Approval gates for consequential actions | P2 | open | Human-in-the-loop before emails/finance changes |
| T-405 | Execution log + run history UI | P2 | open | Replaces the "runs" counter with real history |

## M5 — Activation and retention

| ID | Task | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| T-501 | Onboarding checklist (customer, project, invoice, invite) + sample-data option | P1 | open | Hypothesis: activation = all four done |
| T-502 | Activation events table + funnel view | P1 | open | Instrument **before** launch traffic |
| T-503 | Retention dashboard (WAU workspaces, module adoption, churn, MRR) | P2 | open | Internal page, admin-gated |
| T-504 | Time tracking + project budgets/profitability | P2 | open | Largest real gap vs Productive/Scoro |
| T-505 | Client portal (read-only invoice/approval view) | P3 | open | Evaluate after 5 paying customers |
| T-506 | Recurring invoices | P2 | open | Depends on T-401 |
| T-507 | CSV import for customers/projects (migration from spreadsheets) | P2 | open | Top onboarding request in agency sales |

## M6 — Market and legal (founder-owned, engineering assists)

| ID | Task | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| T-601 | Competitor and pricing research with citations (Zoho, Odoo, ERPNext, Productive, Scoro) | P1 | open | No fabricated claims; cite sources |
| T-602 | Choose primary + secondary market with evidence | P1 | open | Recommendation, not all five |
| T-603 | Privacy policy, terms, DPA, subprocessor list | P0 | open | Lawyer review required |
| T-604 | Account data export + deletion endpoints (GDPR) | P1 | open | Prerequisite for EU customers |
| T-605 | Zero-budget GTM: outreach playbook, content calendar, Product Hunt plan | P2 | open | No automated sending without approval |
| T-606 | Referral programme design (no payouts until reviewed) | P3 | open | Legal/payment implications |

---

## Ordering rationale

M1 exists because a product you cannot charge for has no MRR, and every M2–M6 decision is cheaper
once real customers are talking. M2 follows because a launch without password reset loses customers
permanently at the first forgotten password. M3 before M4 because reminders and dunning are only
trustworthy when jobs survive a deploy and storage does not bankrupt the database. M4 before M5
because agencies buy *automation of client work*, not dashboards. M6 runs in parallel from day one;
it needs no code and is the cheapest source of truth about what to build next.
