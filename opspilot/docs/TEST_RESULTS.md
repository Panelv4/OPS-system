# Executed validation results

These are results from commands actually executed against this implementation in the delivery sandbox. They are not estimates or generated claims about untested modules.

## Latest complete regression run

| Check | Actual result |
| --- | --- |
| Domain, finance, authorization, upload, password unit tests | **23 passed, 0 failed** |
| Generated migration on a new PostgreSQL database, including idempotent rerun | **1 passed, 0 failed** |
| Production API/database regression suite | **21 passed, 0 failed** |
| Chromium end-to-end suite | **10 passed, 0 failed** |
| Total automated test cases | **55 passed, 0 failed, 0 skipped** |
| ESLint | Passed, no errors or warnings |
| `npx next typegen` | Passed |
| `npm exec tsc -- --noEmit --pretty false` | Passed |
| `npm run build` | Passed |
| Managed production bootstrap/start and `/api/health` | Passed |
| Production-only dependency audit | 0 vulnerabilities reported |
| Full dependency audit | 13 moderate, 0 high, 0 critical; tooling findings remain |

Unit/migration execution: approximately 0.91 seconds. API suite: approximately 1.71 seconds. Ten browser tests: approximately 12.6 seconds. These timings reflect the observed sandbox run, not performance guarantees.

## Exercised scenarios

### Unit and migration

Integer money parsing, precision/sign rejection, invoice totals, basis-point rounding, discount limits, overflow rejection, payment-date attribution, partial balances, role boundaries, strict tenant-selector rejection, date/status validation, workflow draft rules, CSV formula neutralization, signature/size/UTF-8 upload validation, unique password salts, correct/incorrect password verification, fresh installation of all 12 tables, and migration-journal rerun behavior.

### API and database

Private demo creation with an explicit public-user response; authentication and HTTP-only cookies; health checks; direct cross-tenant read/write rejection; injected tenant-selector rejection; database composite-FK tenant enforcement; same-origin/missing/opaque-origin protection; tenant-local invoice customers; idempotent partial payments; serialized concurrent payment/overpayment rejection; financial overwrite prevention; stock adjustment history; approved workflow execution and audit events; projects/tasks/employees/vendors; private file upload/download and cross-tenant document denial; spoofed-file rejection; role-limited records/settings/AI; deterministic financial answers; saved widgets/read notifications; database-backed rate limits; login/logout revocation.

### Browser

1. Live dashboard records and runtime rendering.
2. Customer creation, persistence, and search.
3. Invoice line totals, tax/discount calculation, and partial payments.
4. Task completion persisted through reload.
5. Intelligence answers from authorized workspace records.
6. Saved widgets, dark theme persistence, mobile dashboard and inventory width containment, and navigation.
7. Document upload and protected download.
8. Dragging a CRM opportunity between stages with persistence.
9. Registration into an empty workspace, logout, and login.
10. Keyboard search and safe rendering of markup-like record text.

Desktop and mobile layouts were checked for horizontal overflow, and browser font loading was confirmed. Screenshots and failure traces live in the local test artifact directory; raw successful command logs are retained in `validation/` alongside this report.

## Failures found and fixed

- Chromium initially lacked OS libraries; installed the dependencies before browser tests.
- A decorative star changed the assistant navigation accessible name; fixed with aria-hidden and reran the complete suite.
- React lint flagged synchronous effect state, mutable chart render arithmetic, impure form default evaluation, and internal navigation; fixed without disabling the rules. Lint then passed cleanly.
- Final screenshot review found a table accessibility label escaping its narrow-screen scroll container. The positioning boundary was fixed, and the full suite passed with an explicit inventory-width assertion.
- A static heavy font had been downloaded under a variable-family declaration; replaced with the official variable WOFF2 and verified in Chromium.

## Explicitly not verified or not implemented

No live OpenAI/provider credentials were used. External model, email, payment, object-storage, Docker, and hosted CI integrations were not exercised. No penetration/load test, production backup restore, security-compliance audit, payroll, attendance, purchasing, billing checkout, scheduled workflow engine, or broad ERP acceptance test is claimed. These features and deployment blockers remain documented in UNFINISHED.md and SECURITY.md.
