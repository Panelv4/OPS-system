# Feature matrix

What exists, what half-exists, and what does not exist at all. Written after reading the code, not
from the product brief. Legend: **Done** = implemented and covered by a test that runs in CI ·
**Works, untested** = implemented, exercised manually or by a neighbouring test but no direct
assertion · **Partial** = a subset works · **Absent** = no code.

"13 domains" from the launch brief does not survive contact with the codebase: the product has
11 record kinds in one table, and three of the brief's domains (payroll/HRMS, procurement, billing)
have no implementation at all.

| # | Brief domain | Reality | Status | Evidence / gap |
| --- | --- | --- | --- | --- |
| 1 | Executive dashboard & analytics | KPI cards, revenue/expense charts, period comparison, widget preferences, saved per workspace | **Done** | `summarize()` unit tests; API test "persists dashboard configuration"; `Dashboard.tsx`, `Charts.tsx` (custom SVG) |
| 2 | CRM & sales pipeline | Customers + leads records, status board (drag), search, CSV export, follow-up due dates | **Done** | API tests create/patch records; browser test "drags a CRM opportunity" |
| 3 | Sales & invoicing | Invoices with line items, tax bps, discount, partial payments, overpayment + concurrency protection, idempotent retries, browser print | **Done** | `invoiceTotal` unit tests; API tests for partial payment, concurrent overpayment, idempotency |
| 4 | Finance & immutable ledger | Recorded-expense records, payment history, operational summaries (cash receipts vs expenses) | **Partial** | No double-entry ledger, no P&L, no reconciliation, no vendor payables. `UNFINISHED.md` says so |
| 5 | HRMS & payroll | Employee directory (name/status), department category | **Partial** | No salary, attendance, leave, payslips, or payroll. **No payroll code exists** |
| 6 | Inventory | Products, stock adjustments with reason + movement history, reorder point, low-stock flag | **Done** | API test "stock adjustment history"; `stockMovements` table |
| 7 | Procurement | Vendor records only | **Partial** | No purchase orders, receipts, approvals |
| 8 | Projects & tasks | Project cards, task list/board, assignment, due dates, status changes, workflow triggers | **Done** | API + browser tests |
| 9 | Documents | Upload (PDF/PNG/JPEG/TXT, 5 MB, signature-checked) stored as base64 in Postgres; download with audit event | **Partial** | No delete, no versions, no ACLs, no OCR, no object storage (F-12) |
| 10 | AI intelligence | Deterministic local answers over authorised records for 9 intents; optional provider intent classification (off by default); draft workflow generation | **Done** (local) / **Works, untested** (provider) | API test "deterministic financial answers"; no live provider key used |
| 11 | Workflow automation | Event-triggered in-app notifications inside the creating transaction; run counter; draft→review→activate | **Partial** | No scheduler, delays, retries, emails, approvals (F-13) |
| 12 | Search & notifications | Client-side global search over loaded records; in-app notifications with read state; activity feed filtered by role | **Done** | API test "notification read status" |
| 13 | Multi-tenancy, RBAC & **billing** | Tenancy and RBAC done (DB-enforced). Billing core shipped in test mode: plans, subscriptions, entitlements, quotas, signed webhooks | **Partial** | No gateway adapter, hosted checkout, proration, dunning email, or seat enforcement. `BILLING.md` §8 |

## Cross-cutting capabilities

| Capability | Status | Notes |
| --- | --- | --- |
| Registration / login / logout | Done | scrypt, opaque tokens, generic errors |
| Email verification | Done | Registered on signup, single-use 24h link, `/login?mode=verify` (T-202) |
| Password reset | Done | 30-min single-use link, revokes all sessions, non-enumerating (T-203) |
| Member invitations & role management | Done (API) | Invite + accept + seat enforcement; roster via `GET /api/members`. No UI yet (T-211) |
| Email delivery | Done (console) | Resend adapter written, no domain → nothing leaves the machine. T-201 |
| Session management UI | Absent | T-205 |
| Rate limiting | Done (fixed) | DB-backed; per-address only with `TRUST_PROXY=true` |
| Audit trail | Done | Append-only by construction; DB-level immutability not enforced (T-209) |
| Config validation at boot | Done | Added in this pass |
| Security headers | Done | HSTS added; CSP still allows inline script (T-206) |
| Health endpoint | Done | Liveness only; readiness endpoint absent (T-303) |
| Background jobs | **Absent** | T-401 |
| Email delivery (any) | **Absent** | No mail dependency at all |
| Object storage | Absent | DB-backed today |
| Observability | Absent | No structured logs, metrics, error tracking (T-304) |
| Docker build / compose | Present, **unverified here** | No Docker daemon in the audit sandbox |
| CI | Done | lint, typegen, tsc, build, unit, api, audit, Playwright; green |
| Onboarding checklist / activation tracking | Absent | T-501 |
| Pricing page | Marketing copy only | `Settings.tsx` shows ₹101/₹499/₹1,499 "proposed" cards — inconsistent with the $29/$59/$119 hypothesis; nothing is chargeable |
| Client portal | Absent | T-505 (evaluate) |
| Time tracking | **Absent** | No time entry table. Brief's priority list assumes it exists |
| Project budgets / profitability | Absent | Projects have one `amount` field only |
| Recurring invoices | Absent | T-506 |
| Integrations (Slack/Google/accounting/calendar) | Absent | No integration code |

## Honest summary for a sales conversation

Usable today by a 2–30 person agency: **customers, leads, pipeline, invoices with partial payments,
expenses, projects, tasks, inventory, documents, dashboards, in-app notifications, and
permission-aware Q&A over their own records.**

Not usable today: **charging a customer, inviting a colleague, recovering a forgotten password,
sending any email, scheduling anything, or tracking time.** Those four words — pay, invite, recover,
schedule — are what separate a demo from a business, and they are the roadmap's first three
milestones.
