# OpsPilot technical audit

Audit date: 2026-11-17
Repository: `Panelv4/OPS-system`
Baseline commit: `5cbc3af` (PR #1 merged), branch `arena/62ef5af3-ops-system`
Auditor: engineering agent (Arena.ai), working from a real checkout with a live PostgreSQL 18 instance

This is an evidence-based audit of the code that exists. Every finding below was reproduced
with a command, a test, or a code path that can be pointed at. Findings that are design gaps
(missing features) are labelled as such and are not dressed up as vulnerabilities.

---

## 1. What the product actually is

A single-tenant-per-user business workspace application. One user belongs to one workspace;
all business objects for that workspace are rows in one polymorphic table.

| Layer | Reality |
| --- | --- |
| Framework | Next.js 16.4.6 (App Router), React 19.2.6, TypeScript 5.9.3 |
| Styling | Tailwind CSS 4.1.17 + hand-written CSS (`src/app/globals.css`, 88 KB), no component library |
| Charts | Hand-rolled SVG in `src/opspilot/components/Charts.tsx`. **Recharts is not installed** |
| Icons | `lucide-react` |
| Validation | Zod 4 |
| Database | PostgreSQL via `pg` 8.20 + Drizzle ORM 0.45 |
| Auth | Opaque session tokens (32 random bytes, SHA-256 hashed at rest), scrypt password hashing |
| AI | A single intent-classification call to an OpenAI-compatible endpoint, **off by default** |
| Runtime deps | 10 production packages, 22 total |
| Code size | 38 files under `src/`, 1,453 lines (945 TS, 474 TSX, 33 CSS lines but 88 KB of CSS); 2,239 TS/TSX lines in the whole repo |
| Tests | 3 suites: unit+migrations (34 cases), API+DB (21 cases), Playwright browser (10 cases, CI only) |

### Routes

Pages: `/` (app shell), `/login`, `/welcome` (marketing), `/icon.svg`.

API route files (9): `session/[action]`, `workspace`, `records`, `records/[id]`,
`documents`, `documents/[id]`, `notifications`, `intelligence`, `health`.

### Data model (12 tables)

`op_workspaces`, `op_users`, `op_memberships`, `op_sessions`, `op_records`, `op_payments`,
`op_stock_movements`, `op_audit_events`, `op_notifications`, `op_files`, `op_rate_limits`,
`op_ai_usage`.

The important architectural fact: **every business entity is a row in `op_records`**
(`kind` = customers | leads | invoices | expenses | employees | vendors | projects | tasks |
products | documents | workflows) with shared columns (`name`, `subtitle`, `status`, `amount_cents`,
`quantity`, `due_date`) and a free-form `details` JSONB bag. There are no per-domain tables, no
line-item table, no ledger table, no subscription table, and no time-entry table.

Consequences that matter commercially:

- Reporting is only as rich as these shared columns; there is no double-entry ledger, so the
  product cannot produce statutory financial statements.
- `op_files.content` stores documents as **base64 text in the database** (5 MB limit → ~6.7 MB
  per row after encoding). This is why object storage is a scaling blocker, not a nice-to-have.
- One payment row per partial payment (`op_payments`), with a client-supplied UUID
  (`requestId`) as the idempotency key.

---

## 2. Verified baseline (before any change)

Executed on 2026-11-17 against a local PostgreSQL 18.6 instance provisioned for this audit.
Raw logs: `opspilot/docs/validation/baseline-2026-11-17.txt`.

| Check | Command | Result |
| --- | --- | --- |
| Dependency install | `npm ci` | pass, 396 packages |
| Migrations (fresh DB) | `npx tsx opspilot/scripts/migrate.ts` | pass |
| Lint | `npm run lint` | pass, no findings |
| Route typegen | `npx next typegen` | pass |
| Type check | `npx tsc --noEmit` | pass |
| Production build | `npm run build` | pass, 14 routes |
| Unit + migration tests | `npx tsx --test opspilot/tests/{domain,migrations}.test.ts` | **24/24 pass** |
| API + Postgres suite | `npx tsx --test opspilot/tests/api.test.ts` | **21/21 pass** |
| Prod dependency audit | `npm audit --omit=dev --audit-level=moderate` | **0 vulnerabilities** |
| Browser suite (Playwright) | CI only (no Chromium in this sandbox) | 10/10 pass in CI (run 44120484594) |

No failing tests were observed. Two earlier CI failures were caused by a `next@16.4.2` advisory
and were fixed in `6943160` (now `next@16.4.6`).

---

## 3. Findings

Severity scale: CRITICAL (launch-blocking, exploitable now) · HIGH (real exposure or data loss
risk) · MEDIUM (meaningful weakness or operational risk) · LOW (hardening) · INFORMATIONAL.

### F-01 — Rate limiting trusted a client-controlled header · HIGH · **fixed**

- **Files**: `src/app/api/session/[action]/route.ts` (previously line 13), `src/opspilot/server/config.ts` (new)
- **Evidence**: 45 login attempts with a rotating `X-Forwarded-For` header produced **45×401 and
  zero 429s**. With a fixed header the same volume tripped 429 at request 41. An unauthenticated
  attacker could therefore create unlimited accounts and spray passwords across unlimited emails.
- **Impact**: unbounded account creation (storage/abuse cost), password spraying, demo-seeding abuse.
- **Fix**: forwarded headers are only honoured when `TRUST_PROXY=true`
  (`clientIp()`); per-address buckets only exist when the address is trustworthy
  (`rateLimitKey()`), otherwise the limiter falls back to a global bucket for demo creation and
  relies on per-account limits that do not depend on headers.
- **Evidence after fix**: rotating-header probe now trips the global demo cap and the per-email
  limit still blocks at attempt 16. Tests: `opspilot/tests/hardening.test.ts` (10 cases).

### F-02 — Expired sessions and rate-limit buckets were never deleted · MEDIUM · **fixed**

- **Files**: `src/opspilot/server/security.ts`, `src/db/schema.ts`, `opspilot/migrations/0001_lonely_reptil.sql`
- **Evidence**: a few minutes of probing left **187 rows in `op_rate_limits`** and one session per
  login with no removal path; neither table had an index on `expires_at`, so any cleanup would
  have been a sequential scan.
- **Impact**: unbounded table growth from anonymous traffic (cheap DoS), slower auth queries,
  session table bloat forever.
- **Fix**: `pruneExpiredData()` deletes expired sessions and buckets during authentication
  traffic; B-tree indexes on both `expires_at` columns (migration 0001).
- **Tests**: `hardening.test.ts` inserts expired+live rows and asserts only the live ones survive.

### F-03 — Disposable demo workspaces accumulated forever · MEDIUM · **fixed**

- **Files**: `src/opspilot/server/security.ts`, session route
- **Evidence**: 6 `POST /api/session/demo` calls with rotating `X-Forwarded-For` created 6
  workspaces; each seeds ~70 records. 12 demo workspaces existed after this audit's probes alone.
- **Impact**: storage growth and a cheap way to inflate database size.
- **Fix**: demo workspaces older than 24 h are deleted by the same housekeeping task (cascades to
  records, files, events); demo creation is capped globally (120/h) when no trusted proxy is set,
  or 15/h per address when one is.
- **Tests**: `hardening.test.ts` asserts a 30-hour-old demo workspace is pruned and a fresh one kept.

### F-04 — Registration leaked account existence through response timing · MEDIUM · **fixed**

- **Files**: `src/app/api/session/[action]/route.ts`
- **Evidence**: duplicate email responded in **7–10 ms**, a new email in **50–55 ms** (scrypt work
  was skipped on the duplicate path). Login already used a dummy hash to equalise, registration
  did not.
- **Impact**: email enumeration at scale, useful for targeted phishing and credential stuffing.
- **Fix**: the password hash is computed before the duplicate lookup, so both paths cost the same.
- **Evidence after fix**: duplicate 41–53 ms vs new 50–55 ms. The `409` status still distinguishes
  the cases by design (needed for usable UX); uniform responses require email verification, which
  is tracked as T-204.

### F-05 — Docker image migrated the schema on every container start · HIGH (operational) · **fixed**

- **Files**: `Dockerfile`, `docker-compose.yml`
- **Evidence**: runtime `CMD` was
  `sh -c "npx tsx opspilot/scripts/migrate.ts && npm run start"`. With two replicas both run
  migrations concurrently; a failed migration also takes the web process down with it.
- **Fix**: the image now only serves; migrations run as a one-shot `migrate` service that `app`
  waits on (`condition: service_completed_successfully`). `HEALTHCHECK` added to the image.
- **Status**: the change is reviewed but **cannot be executed here — no Docker daemon in this
  sandbox**. It is listed as unverified in `PRODUCTION_READINESS.md`.

### F-06 — No HSTS header · LOW · **fixed**

- **Files**: `next.config.ts`
- **Evidence**: response headers included CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy` but no `Strict-Transport-Security`.
- **Fix**: `Strict-Transport-Security: max-age=63072000; includeSubDomains` on all routes.
  `preload` deliberately omitted (joining the preload list is not reversible without review).
  Header presence verified on a built server.
- **Note**: an earlier attempt gated HSTS on `COOKIE_SECURE`. That does not work — Next
  evaluates `headers()` at build time, so the flag was baked from the build environment. Verified
  empirically (header absent with `COOKIE_SECURE=true` at runtime) before switching to an
  unconditional header.

### F-07 — Configuration was never validated at startup · MEDIUM · **fixed**

- **Files**: `src/opspilot/server/config.ts` (new), `src/instrumentation.ts` (new), `src/db/index.ts`
- **Evidence**: the only guard was `throw new Error("DATABASE_URL is required")` inside
  `src/db/index.ts`. A typo in `TRUST_PROXY`, `AI_ENABLED=true` with no key, or a non-postgres
  `DATABASE_URL` would surface as a runtime 500 on first use, or silently disable protections.
- **Fix**: `resolveConfig()` validates `DATABASE_URL`, `COOKIE_SECURE`, `TRUST_PROXY`,
  `AI_ENABLED`/`OPENAI_API_KEY`, and the AI base URL (https required except localhost).
  `instrumentation.ts` aborts boot with an actionable message; warnings flag insecure production
  cookies and a disabled proxy.
- **Tests**: 5 cases in `hardening.test.ts`; boot behaviour verified on a live server.

### F-08 — CSP allows inline script · MEDIUM (hardening) · open

- **Files**: `next.config.ts`
- **Evidence**: `script-src 'self' 'unsafe-inline'`. There is no nonce or hash plumbing.
- **Impact**: if an HTML-injection bug ever appears, CSP will not stop script execution. Currently
  mitigated by React escaping and by `dangerouslySetInnerHTML` being absent from the codebase
  (grep: no occurrences).
- **Recommended fix**: nonce-based CSP via middleware. Not applied in this pass because it touches
  every route's rendering and needs browser verification (no Chromium here). Tracked as T-206.

### F-09 — Sessions are not rotated on privilege change, and multiple sessions persist · LOW · open

- **Files**: `src/opspilot/server/security.ts` (`createSession`, `logout`)
- **Evidence**: login calls `logout()` (deletes the current cookie's row) then creates a new
  session; other sessions for the same user stay valid, and there is no "sign out everywhere".
  Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production, 7-day expiry — all verified.
- **Impact**: a stolen session survives a password change; no user-visible session management.
- **Recommended fix**: add `sessions.created_at`, an account-sessions list, and revoke-all-on-
  password-change. Tracked as T-205.

### F-10 — No email verification, password reset, or invitations · HIGH (product gap) · open

- **Files**: absent — no SMTP client, no token tables, no routes
- **Evidence**: registration creates a session immediately and marks nothing verified; there is no
  `password_reset` route, no mail dependency in `package.json`.
- **Impact**: typos lock users out permanently; account recovery is impossible without an operator;
  team invitations (`memberships`) can only be created by direct SQL. This blocks self-serve launch.
- **Recommended fix**: `email_tokens` table, SMTP provider behind a small `mailer` interface,
  `/api/session/request-reset` + `/api/session/reset`, invitation flow, and a dev console transport
  so tests stay hermetic. Tracked as T-201…T-204.

### F-11 — Billing, subscriptions and entitlements do not exist · CRITICAL (commercial) · open

- **Evidence**: no payment SDK in `package.json` (10 production dependencies, none of them a
  gateway). The only matches for `stripe|razorpay|subscription|checkout` in `src/` are UI copy
  (`Settings.tsx` plan cards) and the word "subscriptions" inside an expense seed name.
  `Settings.tsx` states "Billing is not enabled in this self-hosted preview. No subscription is
  created and no charges are made." There is no plan table, no gateway adapter, no webhook route.
- **Impact**: the business model ($59 ARPU target) cannot be executed at all. There is nothing to
  "finish" — the module must be built.
- **Recommended fix**: plan catalogue in configuration, `subscriptions`/`billing_events` tables,
  provider adapter (Stripe for USD/global, Razorpay for INR), webhook verification + idempotency,
  entitlement checks in `requireSession`/limits. Tracked as T-101…T-108.

### F-12 — Documents live in the database · MEDIUM (scale/cost) · open

- **Files**: `src/db/schema.ts` (`op_files.content`), `src/app/api/documents/route.ts`
- **Evidence**: upload base64-encodes up to 5 MB into a `text` column; the download route reads the
  whole row and decodes it. No deletion endpoint, no versioning (`details.version` is hard-coded 1).
- **Impact**: every backup and query pays for binary payloads; the DB becomes the storage bill.
- **Recommended fix**: storage abstraction with a Postgres-backed adapter (current behaviour) and
  an S3-compatible adapter, plus document deletion and soft-delete/version columns. Tracked as T-301.

### F-13 — Automation is transactional notifications, not a job engine · HIGH (product gap) · open

- **Files**: `src/opspilot/server/repository.ts` (`runWorkflows`)
- **Evidence**: workflows fire synchronously inside the creating transaction and only insert an
  in-app notification when `details.trigger` matches and `details.action === "notification"`.
  There is no scheduler, no retry, no delay, no dead-letter.
- **Impact**: nothing can be automated that must happen later (reminders, dunning, digests) —
  which is exactly what agencies ask for first.
- **Recommended fix**: `jobs` table + `SKIP LOCKED` worker loop, idempotency keys, attempt/backoff
  columns, and a `/api/jobs/tick` route callable by a platform cron (no new infrastructure).
  Tracked as T-401…T-405.

### F-14 — RBAC is a static matrix with no per-user adjustment · MEDIUM (design) · open

- **Files**: `src/opspilot/lib/domain.ts` (`access`), `src/opspilot/server/security.ts`
- **Evidence**: seven roles map to fixed `RecordKind` lists. `employee` has no access to
  customers/invoices; `hr_manager` sees `employees` but salaries do not exist as data, so the
  prompt's "salary confidentiality" test is not applicable — there is no salary field at all.
  There is no UI to invite members or change a role (only `owner`/`administrator` are distinguished
  in code, and role assignment happens at seed time).
- **Impact**: customers cannot add teammates without operator intervention; no custom policies.
- **Recommended fix**: member management endpoints + UI, role change with audit, then evaluate
  per-module overrides. Tracked as T-207.

### F-15 — Health endpoint exposes only liveness, not readiness · LOW · open

- **Files**: `src/app/api/health/route.ts`
- **Evidence**: `select 1` and a 500 on failure — reasonable, but it does not distinguish
  "database unreachable" from "migrations pending", which is what a deploy gate needs.
- **Recommended fix**: keep `/api/health` as liveness; add `/api/health/ready` reporting migration
  state and version. Tracked as T-303.

### F-16 — No structured logging, metrics or audit export · MEDIUM (operations) · open

- **Files**: everywhere (`console.error` in `apiError`, `console.warn` in config)
- **Evidence**: errors are logged as a single string with no request id, user, route or latency.
- **Impact**: an incident on launch week is undebuggable beyond "something went wrong".
- **Recommended fix**: request id + structured JSON logs behind a tiny `log()` helper; error
  monitoring hook (Sentry-compatible DSN, optional). Tracked as T-304.

### F-17 — Financial reporting is a documented approximation · LOW (correctly disclosed) · accepted

- **Files**: `src/opspilot/lib/domain.ts` (`summarize`), `Intelligence` route
- **Evidence**: revenue = payments received in the month; expenses = expense records created in the
  month. Mixed cash/accrual basis. `invoiceTotal` uses basis points with `Math.floor(x + 0.5)`
  rounding — verified by unit tests (integer cents, discount cap, overflow).
- **Impact**: figures are labelled "operational summary, not a complete accounting statement" in the
  UI text and in `UNFINISHED.md`. Acceptable *if* the label survives marketing. Do not claim
  statutory accounting.
- **Recommendation**: keep the disclosure; add a period-basis toggle only with real ledger work.

### F-18 — CI was pinned to deprecated action runtimes · LOW · **fixed**

- **Files**: `.github/workflows/ci.yml`
- **Evidence**: CI annotation: "Node.js 20 is deprecated. actions/checkout@v4, setup-node@v4,
  upload-artifact@v4 are being forced to run on Node.js 24."
- **Fix**: bumped to `@v7` (checkout/setup-node/upload-artifact), added the new hardening suite to
  the unit step. Verified by the CI run on this branch.

---

## 4. Deliberate non-findings

Recorded so that later readers do not re-litigate them:

- **SQL injection**: all queries go through Drizzle builders or `sql` templates with bound
  parameters. No string concatenation into SQL was found.
- **Tenant isolation**: every query is scoped by `session.workspace.id`, and the schema enforces it
  with composite foreign keys (`op_payments`, `op_stock_movements`, `op_files` reference
  `(workspace_id, record_id)`), so a mismatched tenant pair fails at the database level. The API
  suite exercises cross-tenant reads/writes and injected tenant selectors (21/21 pass).
- **CSRF**: JSON endpoints require `Origin` to match the request host and an
  `application/json`/`multipart` content type; cookies are `SameSite=Lax`. No token is needed for
  this design, and GETs are side-effect free.
- **Unsafe object access**: no object-storage keys, no filesystem paths from user input.
- **XSS**: React escaping only; no `dangerouslySetInnerHTML` in the codebase. CSV export escapes
  formula injection (`csvEscape`).
- **Upload security**: signature sniffing, extension allowlist, 5 MB cap, `attachment` disposition +
  `nosniff` on download. No execution path. No virus scanning (documented gap).
- **Password storage**: scrypt with 16-byte random salt, 64-byte derived key, constant-time compare.
  Not Argon2id, but sound; see `SECURITY_AUDIT.md` for the recommendation.

---

## 5. Bottom line

The foundation is genuinely tested and unusually careful for its size: tenant isolation is
database-enforced, financial maths is integer-cents with tests, the AI layer sends no business data
to a provider, and the audit trail is append-only by design.

What it is *not* is a business you can charge for yet. There is no payment path, no email, no
background jobs, no member management, and documents are stored in Postgres. The four "launch
blockers" are F-10 (email/verification/recovery), F-11 (billing), T-207 (member management) and
F-12/F-13 (storage + jobs at the scale a paid customer expects). Everything else in this audit is
either already fixed or hardening.

Remaining work is sequenced in `TASKS.md`; the release gate is defined in `PRODUCTION_READINESS.md`.
