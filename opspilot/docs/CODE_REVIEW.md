# Code review — OpsPilot foundation

## Starting point

The available project was a Next.js/PostgreSQL starter with an empty schema and a placeholder page. There was no OpsPilot source to audit. A new namespaced implementation was created rather than importing an ERP template or a Panelv4 repository.

## Issues identified and addressed

| Finding | Resolution | Verification |
| --- | --- | --- |
| No business models, sessions, or tenant boundaries | Added tenant-scoped schema, session membership joins, role policies, and composite tenant/record foreign keys | API/database isolation tests |
| Demo seed object could expose extra user fields | Explicit allowlist for response user id, name, email, role | Demo response regression |
| Invoice customer association could use an unrelated name | Require a same-workspace customer | Cross-workspace invoice test |
| Invoice-date attribution misstates late/partial revenue | Aggregate by recorded payment dates | Financial unit tests |
| Concurrent or retried payments could duplicate amounts | Row locking, outstanding-balance check, stable payment UUID | Concurrent and idempotency API tests; browser payment flow |
| Historical financial values could be rewritten through generic status updates | Reject invoice/expense status rewriting; append payment rows | Immutability tests |
| Stock updates could lose traceability | Transactional adjustments, nonnegative check, immutable movement rows | Stock history/API tests |
| Upload extension/MIME alone is insufficient | Magic-byte/UTF-8 validation, 5 MB limit, authenticated attachments | Upload tests |
| CSV text can trigger spreadsheet formulas | Prefix formula-like values and escape quotes | Export unit test |
| Confidential modules should not appear as zeroed financial widgets to other roles | Permission-aware retrieval and dashboard visibility | Role tests and source review |
| Decorative assistant star polluted accessible name | Marked decorative glyph aria-hidden | Browser regression |
| Static heavy font was incorrectly advertised as variable | Installed official Inter variable WOFF2 with OFL notice | Browser font loading and screenshot review |
| Browser tests could exhaust the real demo creation limit | Disposable per-test DB fixtures and valid sessions, cleaned after each test | Full browser suite rerun |
| A table accessibility label escaped its scroll container on narrow screens | Established the table scroll container as the positioning boundary | Explicit post-navigation mobile inventory overflow assertion |

## Review boundaries

This was a hands-on implementation review and regression exercise, not an independent penetration test or a declaration that a production ERP is complete. The backend uses a generalized record model for foundational modules. Complex accounting, payroll, procurement, identity lifecycle, and automation features remain unfinished. All relevant exclusions are listed in UNFINISHED.md and SECURITY.md.

The complete dependency tree includes moderate tooling advisories. Production-only dependency scanning reported zero findings in this session; this does not imply perpetual security or compliance.

See TEST_RESULTS.md for the actual latest test/build outcomes and retained local logs. Initial failures are documented in the development log rather than concealed.
