# Implementation roadmap

Sequencing, not wishlist. Task-level detail lives in `TASKS.md`; this document explains *why* the
order is what it is and what "done" means for each milestone.

Starting point: a tested foundation with no revenue path. 2,239 lines of TS/TSX, 34 unit + 21 API
tests, 2 migrations, one deployment target.

---

## Milestone 0 — Audit and hardening ✅ (this pass)

**Goal**: know what exists; close the cheap, real weaknesses; make the repo provable.

Delivered: full audit (`AUDIT.md`), security review (`SECURITY_AUDIT.md`), readiness gate
(`PRODUCTION_READINESS.md`), feature truth table (`FEATURE_MATRIX.md`), this roadmap, backlog
(`TASKS.md`). Six fixes shipped with tests: header-spoofed rate-limit bypass, unpruned expiry rows,
permanent demo workspaces, registration timing oracle, migration-on-boot in the container,
missing HSTS — plus boot-time configuration validation.

**Definition of done**: `npm run lint && tsc --noEmit && build` green; 34 + 21 test cases pass;
CI green; every claim in the docs traceable to a command in `validation/`.

---

## Milestone 1 — Charge money (2–3 weeks of focused work)

**Goal**: one customer can pay $59/month and get exactly the entitlements they paid for.

Order matters inside the milestone:

1. **Plan catalogue as configuration** (T-101) — so pricing experiments never touch component code.
2. **Schema first, gateway second** (T-102) — `subscriptions`, `billing_events`, `plan_limits`.
   Entitlement checks must read the database, never the gateway, or the app degrades when Stripe
   hiccups.
3. **Webhook before checkout UI** (T-105) — the webhook is the only trustworthy source of truth.
   Build and test it with signed fixture payloads before a customer ever sees a pay button.
4. **Checkout + success route** (T-104) — the success page says "confirming…" and polls, never
   "you're subscribed".
5. **State machine** (T-106) — upgrade immediately, downgrade at period end, cancel at period end,
   failed payment → grace → read-only (not deleted).
6. **Enforcement** (T-107) — seats, AI quota, storage, workflows. Fail closed with a clear message
   and an upgrade path.

**Blocked on**: merchant account (Stripe/Razorpay KYC). Engineering can build against test mode
without it; **no live charging without founder approval**.

**Done**: a test-mode subscription created, a signed webhook applied twice (idempotent), entitlement
flipped, cancellation scheduled, and the whole path covered by API tests.

---

## Milestone 2 — Self-serve launch (2–3 weeks)

**Goal**: a stranger signs up at 11 pm, forgets their password at 11:05, recovers it, invites a
colleague — with no human in the loop.

- Mailer abstraction + provider (T-201) → verification (T-202) → reset (T-203) → invitations (T-204)
- Member management UI (T-207) — the RBAC matrix already exists; nobody can exercise it
- Session management (T-205), breach-password check (T-208), audit-table grants (T-209)
- Independent penetration test before real customer data (T-210)

**Done**: end-to-end test proves token single-use and expiry; a new member is invited, accepts, and
sees only their role's modules.

---

## Milestone 3 — Storage, jobs, observability (2–3 weeks, partly parallel)

**Goal**: the boring things that make incidents short and hosting bills predictable.

- Storage adapter + S3 path (T-301), delete/versions (T-306)
- `jobs` table with `SKIP LOCKED` + cron tick (T-401), retries/dead-letter (T-402)
- Structured logs + error tracking (T-304), readiness probe + **executed** restore drill (T-303)
- Load test with 50 concurrent users (T-305)

**Done**: `pg_restore` restores a production-shaped dump into a scratch database with timings
recorded; a killed job resumes; a failed job lands in dead-letter with an alert.

---

## Milestone 4 — Automations agencies pay for (3–4 weeks)

**Goal**: the product does work while the agency sleeps.

Reminders (T-403), recurring invoices (T-506), approval gates (T-404), run history (T-405). Every
automation uses the job runner from M3 — no synchronous notification paths.

**Done**: an invoice 7 days overdue triggers exactly one reminder, visible in run history, with an
opt-out honoured.

---

## Milestone 5 — Activation and retention (ongoing)

Onboarding checklist (T-501), activation funnel (T-502), retention dashboard (T-503), time tracking
and project profitability (T-504), CSV import (T-507), then evaluate a client portal (T-505).

**Done for M5's first slice**: a brand-new workspace can add a customer, a project, an invoice and a
teammate within 10 minutes without documentation, and the funnel records it.

---

## What is deliberately *not* on this roadmap

- **Double-entry accounting, payroll, statutory tax.** These are regulated products. Serving them
  badly is worse than not serving them; partner or integrate instead.
- **NL-to-SQL over customer data.** The current design (deterministic answers + intent
  classification) is safer and cheaper. Revisit only with a strong evaluation harness.
- **Real-time collaboration, mobile apps, Slack/Google integrations.** No evidence yet that the
  first 20 customers need them; they cost engineering weeks and support time.
- **Microservices, Redis, Kubernetes, a worker fleet.** One Next.js deployment and one Postgres is
  correct at this scale. Add infrastructure when a measured limit is hit, not before.

---

## Honest effort estimate

| Milestone | Engineering | Founder-side (non-code) |
| --- | --- | --- |
| M1 Billing | 10–15 days | merchant account, tax registration, refund policy |
| M2 Self-serve | 10–12 days | penetration test booking, support channel |
| M3 Infra | 8–12 days | hosting accounts, restore drill practice |
| M4 Automations | 12–18 days | customer interviews to pick which three jobs matter |
| M5 Activation | 10–15 days | onboarding calls, first 10 design partners |

Two engineers working in parallel with one reviewer can realistically reach "first paying customer"
(M0–M2) in **6–8 weeks**, assuming merchant KYC does not stall. Any plan that promises a global
launch across five markets in one pass is a plan to ship six half-features.
