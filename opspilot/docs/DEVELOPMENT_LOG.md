# Development log

## Foundation and first review

- Inspected the available starter after the final request to review code; no OpsPilot implementation existed.
- Created new OpsPilot business source, shared design primitives, tenant schema, auth/session security, domain validation, and permission policies.
- Bootstrapped PostgreSQL through the managed runtime, generated the initial SQL migration, and applied the sandbox schema with Drizzle.

## Connected business operations

- Added persisted private demo fixtures and empty-account registration.
- Implemented tenant-scoped records, payment/stock transactions, immutable history, notifications, documents, and basic event workflows.
- Corrected payment-period attribution and restricted invoice customer selection to the authenticated workspace.
- Added local factual insights and a disabled-by-default provider intent adapter. No external provider requests or paid integrations were used.

## Interface

- Built responsive dashboard, charts, sidebar, module tables/cards/boards, forms, document upload/download, settings, search, notifications, and account/product screens.
- Added light/dark themes, keyboard interactions, focus management, and reduced-motion support.
- Replaced a mistakenly downloaded static font with the official variable font after screenshot review.

## Test-driven fixes

- First type generation, TypeScript check, production build, and managed preview health check passed.
- Initial browser launch was blocked by missing Chromium OS libraries; installed the required libraries and reran successfully.
- First unit suite: 23/23 passed.
- First API suite: 20/20 passed.
- First browser suite: 7/8 passed; the assistant navigation locator exposed an accessible-name defect caused by a decorative star.
- Corrected the decorative label, added isolated browser fixtures, and added a demo-response regression and fresh-database migration test.
- Added payment request idempotency and tested overpayment serialization.
- Final screenshot review found narrow-screen table overflow that the dashboard-only assertion missed; contained the absolute accessibility label and added a post-navigation inventory width check.
- Fixed React lifecycle/purity and internal-navigation lint findings without suppressing the rules.

## Delivery preparation

- Added migration runner, Docker/Compose definitions, backup helper, environment example, and GitHub Actions validation workflow.
- Documented implemented scope, known limitations, security blockers, API contracts, setup, and deployment.
- Hosted CI, Docker runtime, paid AI, email, payments, and object-storage integrations are explicitly not claimed as verified.
- Latest actual checks are recorded in TEST_RESULTS.md after execution.

## Final executed verification

- Final rerun: 23 unit + 1 fresh migration + 21 API/database + 10 Chromium browser cases = 55 passed, zero failed or skipped.
- Lint: no errors or warnings. Route generation, TypeScript, production build, and managed runtime health check passed.
- Product home and registration pages were additionally rendered in Chromium with no runtime errors or horizontal overflow; mobile registration also fit its viewport.
- Raw final validation logs are preserved in docs/validation.

## 2026-11-18 — Preview embedding without weakening the default

The app answers with `X-Frame-Options: DENY` and `frame-ancestors 'none'` so no page can
frame it. A sandbox preview *is* a cross-origin frame, so it was blocked.

Rather than special-casing middleware or trusting a runtime flag, `next.config.ts` now
builds the headers from `PREVIEW_EMBED`, evaluated at build time (Next evaluates
`headers()` at build time — this is documented behaviour, see AUDIT F-06):

- default build → `X-Frame-Options: DENY`, `frame-ancestors 'none'` (unchanged, verified by
  CI, which builds without the flag);
- `PREVIEW_EMBED=true npx next build` → the header is omitted and the CSP allows framing.
  Only those two directives change; HSTS, nosniff, Referrer-Policy, Permissions-Policy and
  the rest of the CSP are untouched.

Because it is a build-time flag, no runtime environment variable can relax framing on a
production artifact.
