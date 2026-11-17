# OpsPilot security audit

Companion to `AUDIT.md`. This document covers authentication, authorization, tenant isolation,
session handling, input handling, and the security posture of the AI and file subsystems.

Date: 2026-11-17 · Baseline: `5cbc3af` · Scope: everything reachable in `src/`

**No certification is claimed.** This is a self-assessment of one codebase by its own engineers.
It is not a penetration test by an independent party.

---

## 1. Authentication

| Property | Implementation | Verdict |
| --- | --- | --- |
| Password hashing | scrypt, 16-byte random salt per user, 64-byte derived key, `timingSafeEqual` compare (`security.ts:13-14`) | Sound |
| Password policy | 10–128 characters, no complexity rule, no breach-password check (`domain.ts` `authSchema`) | Acceptable; see R-1 |
| Login | Generic "Email or password is incorrect." for both unknown user and wrong password; a dummy hash is verified for unknown users so timing does not leak (`session/[action]/route.ts`) | Good |
| Registration | Password hashed before the duplicate lookup, so duplicate vs new email take the same time (F-04, fixed) | Good |
| Session token | 32 random bytes, hex; only the SHA-256 hash is stored (`op_sessions.token_hash`) | Good |
| Cookie | `HttpOnly`, `SameSite=Lax`, `Path=/`, 7-day `Expires`, `Secure` when `COOKIE_SECURE` (default true in production) — verified via `Set-Cookie` probe | Good |
| Logout | Deletes the session row for the presented cookie | Good |
| Brute force | Per-email bucket 15/15 min; per-address bucket 40/15 min **only when `TRUST_PROXY=true`**; global demo cap 120/h | Fixed (F-01) |
| Email verification | **Not implemented** | Blocker (T-201) |
| Password reset | **Not implemented**; recovery requires an operator | Blocker (T-202) |
| MFA | Not implemented | Roadmap |
| Session rotation / "sign out everywhere" | Not implemented; old sessions survive a password change | T-205 |

Brute-force arithmetic worth knowing: with a per-email cap of 15 attempts per 15 minutes, one
account absorbs ~1,440 attempts/day. That is fine for a 10-character password and unacceptable if
users pick weak ones, which is why a breach-list check (R-1) is recommended before launch.

## 2. Authorization and tenant isolation

- Every data access resolves the workspace from the **session row**, never from a request
  parameter. `loadWorkspace`, `createRecord`, `updateRecord`, the record read route and the document
  routes all filter on `session.workspace.id`.
- The database enforces the same invariant with composite foreign keys:
  `op_payments(workspace_id, record_id) → op_records(workspace_id, id)` and the same shape for
  `op_stock_movements` and `op_files`. A cross-tenant pair is rejected by Postgres, not just by code.
- `op_records` carries `unique(workspace_id, id)`, which is what makes those composite keys legal.
- Role matrix: seven roles (`owner`, `administrator`, `manager`, `hr_manager`, `accountant`,
  `salesperson`, `employee`) mapped to module lists in `lib/domain.ts`. Reads are filtered by the
  role's module list before the response is built; writes are checked again in `createRecord` /
  `updateRecord`.
- Verified by the API suite: cross-tenant reads and writes, injected tenant selectors, and
  role-restricted endpoints all return 403/404 (21/21 passing).

Gaps (not vulnerabilities, but launch-relevant):

- No endpoint lets an owner invite a member or change a role. `op_memberships.role` is only written
  at seed time, so RBAC is effectively single-user today (T-207).
- `owner` and `administrator` are the only roles distinguished in the UI; the other five exist in
  the matrix and are exercised by seeds.
- There is no salary or HR-sensitive field anywhere in the schema, so "employee salary
  confidentiality" cannot be tested — the data does not exist.

## 3. CSRF, CORS and request validation

- Mutating endpoints require `Origin` to equal the request host or the `Host` header, and require
  `application/json` (or `multipart/form-data` for uploads). `assertOrigin()` throws 403/415.
- Cookies are `SameSite=Lax`, so top-level cross-site POSTs do not carry them.
- No CORS headers are emitted anywhere, so cross-origin JavaScript cannot read responses.
- Request bodies are capped at 64 KB (`readJson`) and parsed through Zod schemas, mostly `.strict()`
  so unknown keys are rejected.
- Uploads: 5 MB cap enforced on both `Content-Length` and the decoded buffer, signature sniffing
  (PDF/PNG/JPEG/UTF-8 text), extension matching, filename sanitisation, `Content-Disposition:
  attachment` plus `X-Content-Type-Options: nosniff` on download. Files are never served as HTML.

## 4. Secrets and configuration

- The application needs exactly one secret: `DATABASE_URL`. There is no encryption key, no session
  signing secret, and **no hardcoded fallback secret anywhere in the repo** (verified by grep).
  The brief's "AES-256-GCM with a fallback secret" does not exist in this codebase; there is no
  field-level encryption to review.
- `.env` is git-ignored; `.env.example` carries placeholders only. `.dockerignore` excludes `.env*`
  except the example. No credentials appear in git history (`git log -p` scan of `.env` paths: none).
- `instrumentation.ts` now validates configuration at boot: missing/malformed `DATABASE_URL`,
  bad boolean flags, `AI_ENABLED` without a key, and plain-HTTP AI endpoints all abort startup.
- Error responses are generic ("Something went wrong. Please try again.") and server logs record
  only `error.message` — no tokens, passwords or document contents.

## 5. AI subsystem

- Business data never leaves the server. The only provider call classifies the user's question into
  one of nine intents with `store: false`, `max_completion_tokens: 100`, and a strict JSON schema;
  the answer itself is produced locally from authorised records.
- Every answer is derived from `loadWorkspace(session)`, so it inherits tenant isolation and role
  filtering. A question that needs a module the role cannot see returns 403 rather than guessing.
- Deterministic figures: no model-generated numbers, no NL-to-SQL, no writes. Workflow drafts are
  returned as `status: "Draft"` and require an explicit activation step.
- Token usage is recorded per workspace (`op_ai_usage`) with the value clamped to 100 000.
- Rate limit: 30 questions/hour/user.
- **Caveat**: the provider path is exercised only against a mock/unreachable endpoint here; no live
  key was used.

## 6. Audit trail

`op_audit_events` is append-only by construction: there is no UPDATE or DELETE path in the code, and
no API exposes it for modification. Events carry `actor`, `action`, `subject` and a bounded
`metadata` bag (kind, record id, amount delta). No passwords, tokens, file contents or free-text
notes are logged.

Not enforced at the database level (no trigger, and the app role is the owner). INFORMATIONAL — see
R-3.

## 7. Transport and headers

Verified against a built server with `curl -sSI`:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; ...
Strict-Transport-Security: max-age=63072000; includeSubDomains     ← added in this pass
```

`script-src 'unsafe-inline'` remains (F-08): Next.js injects inline bootstrap scripts and there is no
nonce plumbing yet. No `dangerouslySetInnerHTML` exists in the codebase (grep: 0), so the practical
XSS surface is React's own escaping.

## 8. Rate limiting: honest description

The limiter is database-backed and shared across instances (unlike an in-memory map), which is the
property that matters behind a load balancer. It is implemented as an upsert with a fixed window.

It is **not** a defence against distributed attack: N hosts × 40 requests each all pass. For launch,
pair it with platform-level protection (Vercel/Cloudflare WAF, or nginx `limit_req`) — that is a
deployment control, not an application one, and is recorded in `PRODUCTION_READINESS.md`.

Correctness note: buckets were previously keyed on an attacker-controlled header (F-01, fixed). With
`TRUST_PROXY=false` there is deliberately **no** per-address limiter, because an address that cannot
be trusted produces false assurance. Per-account limits are the ones that bind.

## 9. Recommendations before public launch

| ID | Recommendation | Severity | Tracked |
| --- | --- | --- | --- |
| R-1 | Check passwords against a breach corpus (k-anonymity HIBP API or a bundled list) and reject the top 100k | MEDIUM | T-208 |
| R-2 | Add email verification before a workspace can invite members or take a payment | HIGH | T-201 |
| R-3 | Revoke the app role's UPDATE/DELETE on `op_audit_events` in production (grant only INSERT/SELECT) | LOW | T-209 |
| R-4 | Nonce-based CSP; drop `unsafe-inline` | MEDIUM | T-206 |
| R-5 | Session management UI + revoke-all on password change | LOW | T-205 |
| R-6 | Independent penetration test before accepting real customer data | MEDIUM | T-210 |
| R-7 | Virus scanning on uploads (ClamAV sidecar or provider scan) once object storage lands | LOW | T-302 |

## 10. What a security reviewer should re-test after the next pass

1. Rate limiting with `TRUST_PROXY=true` behind a real proxy that overwrites `X-Forwarded-For`.
2. Password reset and invitation token lifecycle (single use, expiry, tenant binding).
3. Webhook signature verification and replay protection, once billing exists.
4. Upload → download round trip with a hostile file (polyglot, zip bomb, 0-byte).
5. Cross-tenant probing on every new endpoint added by T-101…T-405.
