# OpsPilot

**Your Entire Business. One Operating System.**

A new, working business-workspace foundation built with Next.js App Router, React, TypeScript, PostgreSQL, and Drizzle ORM. Open `/` for the application, `/welcome` for the product home, or `/login` to create a fresh business workspace.

> **Delivery status: functional foundation, not a complete production ERP or commercially hardened SaaS.** There is no billing, email delivery, member invitation, or background-job engine yet. Read [PRODUCTION_READINESS.md](opspilot/docs/PRODUCTION_READINESS.md) before promising a launch date, and [TASKS.md](opspilot/docs/TASKS.md) for what is next. The large product roadmap is not fully implemented. See [unfinished features](opspilot/docs/UNFINISHED.md), [security notes](opspilot/docs/SECURITY.md), the [code review](opspilot/docs/CODE_REVIEW.md), the [audit](opspilot/docs/AUDIT.md), [security audit](opspilot/docs/SECURITY_AUDIT.md), [feature matrix](opspilot/docs/FEATURE_MATRIX.md), and [roadmap](opspilot/docs/IMPLEMENTATION_ROADMAP.md). No compliance certification is claimed.

## What works

- Private, persisted demo workspaces; new accounts start with an empty workspace.
- Registration, login, logout, salted scrypt password hashing, server-side sessions, seven role-based permission policies, and tenant-scoped API queries.
- A responsive dashboard with real database-derived financial totals, period comparisons, revenue/expense charts, sales pipeline, tasks, activity, quick creation, and saved widget preferences.
- Customer/lead records, search, filters, CSV export, and a draggable sales pipeline.
- Invoices with deterministic line-item calculations, tax and discounts, partial payments, concurrent overpayment protection, idempotent retries, and browser print/Save PDF.
- Append-only expense amounts and payment history; operational financial summaries.
- Employee directory, vendor records, project cards, task lists/boards, and persisted status changes.
- Product catalog, stock adjustments, reorder alerts, and auditable stock movements.
- Private document upload/download with a 5 MB limit and file-signature validation.
- Global search, notifications, activity log, light/dark themes, and mobile navigation.
- Permission-aware business questions with deterministic answers. An optional OpenAI-compatible intent-classification adapter is disabled by default.
- Draft/review/activate event workflows that create in-app notifications and audit execution.

The demo numbers are deliberately seeded sample records in a private PostgreSQL workspace. They are not hardcoded production dashboard metrics. The demo is identified in the workspace switcher and settings. Real accounts receive no sample business records.

## Local installation

Requirements: Node.js 22+, npm, PostgreSQL 16+, and a **fresh** database.

1. Install dependencies: `npm ci`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to your database.
3. For local HTTP only, set `COOKIE_SECURE=false`. Use `true` behind HTTPS.
   Set `TRUST_PROXY=true` only when a proxy you control (Vercel, Cloudflare, nginx) overwrites
   `X-Forwarded-For`; otherwise forwarded headers are ignored and per-client rate limiting is off.
4. Apply migrations: `npx tsx opspilot/scripts/migrate.ts`.
5. Start development: `npm run dev`.
6. Visit `http://localhost:3000` or register at `/login?mode=register`.

For a production build, run `npx next typegen`, `npm exec tsc -- --noEmit --pretty false`, and `npm run build`, then use your process manager to run `npm run start`. Review all production blockers before exposing the service.

The managed sandbox uses `drizzle-kit push` for schema provisioning. The migration runner is for a fresh database or one already tracked by Drizzle migrations; do not run the initial CREATE migration on an existing push-provisioned database without a deliberate baseline procedure.

## Docker

Set `POSTGRES_PASSWORD` to a strong URL-safe value in `.env`, then run `docker compose up --build`. The app binds to loopback port 3000 by default. A one-shot `migrate` service applies migrations and the app waits for it to finish, so scaling to several replicas cannot race a schema change. PostgreSQL data is stored in a named volume. Use a TLS reverse proxy and secure cookies for a non-local installation.

Docker and hosted GitHub Actions configuration are included; GitHub Actions runs on every push, while `docker build` and `docker compose up` were only verified by simulating the image's file layout in the delivery sandbox. The production Next.js runtime, database, migrations, API, and Chromium browser tests are validated separately. See [deployment](opspilot/docs/DEPLOYMENT.md).

## Tests

Use a disposable test instance/database. API tests register isolated workspaces and clean up their own records. Browser tests create private fixtures directly in the test database, inject genuine hashed sessions, and remove those fixtures afterward; this avoids weakening the public demo rate limit.

- Unit tests: `npx tsx --test opspilot/tests/domain.test.ts`
- Fresh migration test: `npx tsx --test opspilot/tests/migrations.test.ts` (test database user needs CREATEDB)
- Running-server API tests: `npx tsx --test opspilot/tests/api.test.ts`
- Install browser: `npx playwright install --with-deps chromium`
- Running-server browser tests: `npx playwright test --config=opspilot/tests/playwright.config.ts`
- Production dependency audit: `npm audit --omit=dev`

`TEST_BASE_URL` defaults to `http://localhost:3000`. The tests' `DATABASE_URL` must point to the same database as the server. [Actual validation results](opspilot/docs/TEST_RESULTS.md) are recorded after execution, not assumed.

## Operations

Background work runs through a Postgres-backed queue, so no worker host is needed:
call `POST /api/jobs/tick` from any cron every minute with
`Authorization: Bearer $JOBS_TICK_SECRET`. `/api/health/ready` reports database,
migration state, queue and version (503 when not ready). Every log line is JSON with a
request id; `LOG_LEVEL` filters them. See [JOBS.md](opspilot/docs/JOBS.md).

```bash
curl -fsS -X POST http://localhost:3000/api/jobs/tick -H "Authorization: Bearer $JOBS_TICK_SECRET"
```

## Email

Verification, password recovery and invitations are implemented with single-use, hashed,
purpose-bound tokens. Delivery defaults to the `console` transport (the message is logged and
recorded in `op_email_log`); set `MAIL_TRANSPORT=resend` with a verified sending domain to deliver
real mail. Open links land on `/login?mode=verify|reset|invite`. See [EMAIL.md](opspilot/docs/EMAIL.md).

## Billing

Billing is opt-in and disabled by default: without `BILLING_PROVIDER`, every workspace resolves to
the free plan and checkout returns 503. With `BILLING_PROVIDER=test` the full plan lifecycle can be
exercised locally — a paid plan is granted **only** by a signature-verified webhook, never by
checkout or a client redirect. No payment gateway is connected; `stripe` refuses with 501 until an
adapter and merchant account exist. See [BILLING.md](opspilot/docs/BILLING.md).

## Optional AI

Core features work without external credentials. To explicitly enable paid-provider requests, set `AI_ENABLED=true`, supply `OPENAI_API_KEY`, and optionally set `OPENAI_BASE_URL` and `OPENAI_MODEL`. Never put these values in `NEXT_PUBLIC_*` variables.

Only the user's question is sent to the provider for a constrained intent classification. Authorized financial figures are calculated locally; the model cannot produce arbitrary amounts or execute writes. Provider outages fall back to local supported-intent rules. Requests and provider token usage are recorded. External-provider behavior has not been tested with live credentials.

## Project layout

- `src/opspilot/components/`: new application UI, forms, charts, and product/auth screens.
- `src/opspilot/lib/`: shared domain types, validation, money calculations, and upload rules.
- `src/opspilot/server/`: authentication, permission-aware repository, sample-data initialization.
- `src/app/api/`: authenticated fullstack HTTP endpoints.
- `src/db/`: PostgreSQL client and tenant-scoped Drizzle schema.
- `opspilot/migrations/`: generated SQL migration and Drizzle metadata.
- `opspilot/tests/`: unit, migration, API/database, and Playwright suites.
- `opspilot/scripts/`: migration and backup utilities.
- `opspilot/docs/`: architecture, API, security, review, deployment, scope, results, and development log.

The provided Next.js runtime was retained as the deployment adapter. All OpsPilot business source was created anew; no Panelv4/ops source, ERP template, or external repository was copied. The recommended Flask/Vite split was replaced with the required Next.js/Drizzle host stack.

## License

Application source: MIT; see `LICENSE`. Inter is distributed under the SIL Open Font License, included at `public/fonts/INTER-LICENSE.txt`. Third-party packages retain their own licenses.
