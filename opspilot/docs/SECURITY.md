# Security review and deployment boundaries

This is not a security certification or a claim that the entire production roadmap is complete.

## Implemented and exercised

- Salted scrypt password hashing and constant-time hash comparison.
- Cryptographically random opaque sessions; only SHA-256 token hashes are stored.
- HTTP-only, SameSite=Lax cookies, seven-day server expiry, and logout revocation.
- Secure cookies by default in production; local HTTP can explicitly opt out with COOKIE_SECURE=false.
- Same-origin enforcement and JSON-only mutation endpoints, except validated multipart uploads.
- Tenant resolution from the session and verified membership, never client tenant selectors.
- Server-side role policies for module retrieval, writes, settings, documents, and assistant retrieval.
- Composite tenant/record foreign keys, tested against cross-tenant inserts.
- Zod validation, parameterized Drizzle statements, bounded financial inputs, and positive-stock checks.
- Serialized, auditable financial/stock mutations; idempotent payment request references.
- React text escaping; no HTML rendering of record or assistant content.
- CSV formula-prefix neutralization.
- Upload size/type/signature rules, private attachment downloads, and nosniff headers.
- Database-backed rate-limit counters for authentication, creation, AI, and uploads.
- CSP, frame blocking, referrer policy, and restricted browser capabilities.
- Server-only optional provider keys; external AI disabled by default.

## Review fixes made during implementation

1. **Response overexposure:** explicitly project public user fields rather than spreading a full demo user row. The demo response is covered by a regression test.
2. **Tenant associations:** reject invoices whose selected customer does not belong to the authenticated workspace; payment/file/stock composite FKs add database-level association checks.
3. **Revenue attribution:** use payment timestamps instead of invoice creation dates.
4. **Payment concurrency/retries:** lock invoice rows, reject overpayment, and use stable UUID retry references.
5. **Financial history:** reject status-based rewriting of invoices and expense records.
6. **File spoofing/exports:** inspect signatures and neutralize spreadsheet formulas.
7. **Permission presentation:** hide finance widgets for roles lacking finance access and default task-only roles to their accessible view.
8. **Accessible navigation:** hide decorative symbols from the assistant button's accessible name.

## Outstanding production blockers

- Email verification, invitations, account recovery, MFA, session inventory/revocation UI, and account lifecycle controls.
- Per-user ownership/assignment policies and fine-grained document confidentiality; currently permissions are role/module based.
- RLS with a least-privilege database role; the application database account must not be treated as a tenant sandbox.
- Strict proxy configuration: rate-limit IP attribution currently trusts the incoming forwarded-for header. A trusted ingress must strip/replace untrusted forwarding headers. Add trusted-proxy enforcement, account protections, CAPTCHA/abuse handling, and distributed ingress controls before public registration.
- Anonymous demo retention/storage quotas and cleanup policy; document/file quotas beyond the per-file cap.
- A streaming/multipart request-size guard at the ingress; route validation alone cannot prevent every memory-exhaustion pattern.
- Malware scanning, content-disarm policies, object-storage encryption/access controls, and document versioning.
- Tight nonce/hash-based CSP; current script/style policies include unsafe-inline for framework/runtime compatibility.
- Password work-factor tuning under production load, reset-token security, account verification, and administrative recovery procedures.
- Independent penetration testing, load testing, privacy/retention review, incident response, production monitoring, and immutable off-site audit retention.
- Backup scheduling/encryption and a tested production restore procedure. A pg_dump helper is provided, not a managed backup service.

## Dependency audit

During this delivery session, `npm audit --omit=dev` reported **0 production findings**. The complete dependency tree reported **13 moderate findings, 0 high, and 0 critical**, concentrated in Drizzle/ESLint tooling dependencies. Suggested automated fixes included framework/tooling downgrades; those were not applied blindly. Recheck the audit before deployment and resolve/transitively patch the tooling dependencies. Audit results are point-in-time, not a guarantee of safety.

## Reporting

Do not put credentials, access tokens, private documents, or customer records in public issues. Send a minimal reproduction to the maintainer of your self-hosted instance. There is no external OpsPilot support service or certified compliance program configured by this application.
