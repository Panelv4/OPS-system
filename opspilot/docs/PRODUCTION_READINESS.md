# Production readiness

Verdict as of 2026-11-17: **not launch-ready for paid customers.** The application is
deployable as a private, single-tenant-per-user tool; it is not yet a SaaS you can charge for.
This document states exactly what is proven, what is assumed, and what must be true before the
first invoice is issued.

Gate legend: **GREEN** = verified in this repository · **AMBER** = implemented but not verified in
this environment · **RED** = missing or unsafe for launch.

---

## 1. Gate summary

| Area | State | Evidence / blocker |
| --- | --- | --- |
| Build from a clean checkout | GREEN | `npm ci` + `npm run build` in CI and locally |
| Lint / types / tests | GREEN | 34 unit + 21 API cases; Playwright 10/10 in CI |
| Dependency audit (prod) | GREEN | 0 vulnerabilities (`npm audit --omit=dev`) |
| Migrations on a fresh database | GREEN | `migrate.ts` applied twice (idempotent); journal counted |
| Migrations on an existing database | AMBER | Only tested on fresh DBs here; no baseline/rollback procedure documented for prod |
| Docker image build | **AMBER** | No Docker daemon in the audit sandbox. Runtime *layout* simulated and green (migrations + `next start` + `/api/health`) |
| Compose stack | AMBER | YAML reviewed; adds one-shot `migrate` service; not executed |
| Secret handling | GREEN | Single required secret (`DATABASE_URL`); no fallback secret; boot validation |
| Security headers / TLS | GREEN (headers) / RED (TLS) | HSTS, CSP, nosniff verified; TLS termination is a deployment control, not yet configured |
| Rate limiting | GREEN | DB-backed, distributed-safe; per-address mode requires `TRUST_PROXY=true` |
| Backups | AMBER | `opspilot/scripts/backup.sh` (pg_dump custom format) exists; **no restore was ever executed** |
| Restore drill | **RED** | Never performed. Do not go live without one |
| Observability | **RED** | No structured logs, no error tracking, no metrics, no alerting |
| Email (verify/reset/invite) | AMBER | Flows implemented and tested; delivery runs on the console transport until a domain is verified (T-201) |
| Billing / payments | **RED** | No gateway, no plans, no entitlements |
| Member management | AMBER | Invite + accept + seats work via API and links; no management UI yet (T-211) |
| Background jobs | **RED** | No scheduler/queue |
| Object storage | RED | Documents are base64 in Postgres |
| Data export / deletion (GDPR) | RED | No account export/deletion |
| Legal pages (privacy/terms/DPA) | RED | Not drafted in this repository |

---

## 2. Recommended production architecture (economical, no new ops burden)

Two co-founders, $0 marketing budget, target 20 paying workspaces. Optimise for *fewer moving
parts*, not scale.

```
Browser ── TLS ──> Vercel (Next.js 16, Node runtime)
                     ├── Managed Postgres (Neon / Supabase / RDS) — pooled connection string
                     ├── Object storage (Cloudflare R2 or S3) via presigned URLs   [T-301]
                     ├── Transactional email (Postmark / Resend / SES)             [T-201]
                     ├── Platform cron → /api/jobs/tick (Vercel Cron)              [T-401]
                     └── Error tracking (Sentry-compatible DSN)                    [T-304]
```

Why this shape:

- **Vercel** removes container, TLS, and CDN work. The existing `headers()` config, `next start`
  behaviour and Node runtime all match.
- **No Redis.** Rate limiting is already database-backed and idempotent per bucket, which is the
  property Redis would have bought. Add Redis only if a queue with high fan-out appears.
- **No worker host.** A `jobs` table drained by a cron-invoked route keeps one deployment target.
  Move to a dedicated worker only when job volume justifies it.
- **Storage off the database.** The single largest cost/scaling risk today is `op_files.content`.

Environment variables required in production: `DATABASE_URL`, `COOKIE_SECURE=true`,
`TRUST_PROXY=true` (Vercel sets `X-Forwarded-For` and overwrites it at the edge), `AI_ENABLED=false`
until a provider key and a data-processing decision exist.

Cost estimate at launch scale (20 workspaces, ~1–2 GB documents):

| Item | Monthly |
| --- | --- |
| Vercel Pro (1 seat) | $20 |
| Managed Postgres (small, with backups) | $0–25 (free tier viable at this size) |
| Object storage + egress (10 GB) | $0–2 |
| Transactional email (10k/mo) | $0–15 |
| Error tracking | $0 (free tier) |
| Domain + TLS | ~$1 |
| **Total** | **≈ $25–65/month**, before any AI usage |

Break-even against the ₹100,000 MRR objective is trivial; the risk is not infrastructure cost.
The AI add-on must be metered (`op_ai_usage` already records tokens) or it will be the only line
item that can scale faster than revenue.

---

## 3. Pre-launch checklist (must all be GREEN)

### Engineering
- [ ] T-201…T-204 verified with a real provider and a verified domain (code is done, delivery is not)
- [ ] T-101…T-108 billing with webhook idempotency and entitlement enforcement
- [ ] T-207 member invite/role change UI
- [ ] T-401…T-405 job runner + reminder/dunning jobs
- [ ] T-301 object storage adapter with a migration path for existing rows
- [ ] T-304 structured logs + error tracking hitting a real dashboard
- [ ] Backup **restore** drill, documented with timings (T-303)
- [ ] `docker build` + `docker compose up` executed by a human or CI on a Docker-capable runner
- [ ] Load test: 50 concurrent users on the API suite endpoints; watch DB connections (T-305)

### Security
- [ ] Independent penetration test (T-210) — at minimum a second pair of eyes on auth + tenancy
- [ ] `TRUST_PROXY` set correctly for the chosen host, verified with real client IPs
- [ ] CSP without `unsafe-inline` (T-206)
- [ ] Breach-password check on registration (T-208)
- [ ] Audit-table UPDATE/DELETE revoked for the app role (T-209)

### Legal / commercial (founder actions, not engineering)
- [ ] Privacy policy, terms of service, DPA template, subprocessor list
- [ ] Refund and cancellation policy that matches what the billing code actually does
- [ ] Data residency decision (EU customers → EU database region)
- [ ] Merchant account (Stripe for USD, Razorpay for INR) — KYC, tax registration
- [ ] Trademark and product name clearance
- [ ] Support channel and response-time expectation published

### Product truth
- [ ] Remove or label every roadmap item visible in the UI (the plan cards in `Settings.tsx` are
      explicitly labelled "proposed"; keep that until a checkout exists)
- [ ] Onboarding checklist shipped (T-501) so a new workspace reaches value without a call
- [ ] Activation metric instrumented (T-502) before launch traffic, or the first month is blind

---

## 4. Operational runbook seeds

**Deploy**: CI green → merge to `main` → Vercel builds → `migrate` job runs before traffic (Vercel
build step or a manual `npm run migrate` against prod) → `/api/health` 200 → smoke: register,
create customer, create invoice, record payment, logout.

**Rollback**: Vercel instant rollback to the previous deployment; migrations are additive-only in
this codebase so far (0000, 0001 add objects), which makes code rollback safe. Any future
destructive migration needs a documented forward-fix.

**Incident**: error tracker alert → check `/api/health` → check DB connections → check recent
deploys → if data integrity is at risk, freeze writes (disable mutating routes at the edge) before
debugging.

**Backup/restore**: `opspilot/scripts/backup.sh` produces a custom-format dump. Restore procedure
(`pg_restore --clean --if-exists`) is untested — treat it as a launch blocker until a drill passes.
