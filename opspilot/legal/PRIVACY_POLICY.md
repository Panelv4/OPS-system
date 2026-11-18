# Privacy Policy — DRAFT, NOT REVIEWED BY A LAWYER

_Version: draft 1 · Last updated: 2026-11-18_

> **This is a template written by an engineer.** It describes what the software actually
> does today. It is not legal advice, it has not been reviewed, and it must not be
> published until counsel has approved it and the placeholders are filled.

**Controller:** `[LEGAL ENTITY NAME]`, `[REGISTERED ADDRESS]`, `[CONTACT EMAIL]`.
**Data protection contact:** `[DPO OR PRIVACY CONTACT, IF REQUIRED]`.

## 1. What we collect

| Category | Examples | Why | Legal basis (GDPR) |
| --- | --- | --- | --- |
| Account data | name, email address, hashed password, email-verification status | to create and secure your account | contract |
| Workspace data | business name, settings, and the records you create (customers, invoices, expenses, vendors, products, stock movements, tasks, HR records, documents) | to provide the service you signed up for | contract |
| Session data | a hashed session token, its expiry, the workspace and user it belongs to | to keep you signed in | contract / legitimate interest in security |
| Delivery data | recipient address, email template name, subject, delivery status of transactional email | to prove a verification, reset or invitation email was sent | legitimate interest (account security) |
| Audit events | who created or changed a record, when | to let a workspace see its own history | legitimate interest |
| Operational logs | request path, method, request id, error messages | reliability and security | legitimate interest |

We do **not** collect: payment card numbers (no gateway is integrated yet), advertising
identifiers, cross-site tracking, or behavioural analytics. There is no analytics or
error-tracking SDK in this build.

## 2. Where it is stored

- Application and database: `[HOSTING PROVIDER, REGION]`.
- Transactional email: the provider configured for the deployment (see the subprocessor
  list). Email content includes single-use links.
- AI features, when enabled: the question text and the workspace figures needed to answer
  it are sent to `[AI PROVIDER]`. When the feature is disabled, nothing is sent.

A current list of subprocessors with purposes and regions is maintained in
`SUBPROCESSORS.md`.

## 3. How long we keep it

| Data | Retention |
| --- | --- |
| Account and workspace data | until the account or workspace is deleted |
| Sessions | 7 days from sign-in, or until sign-out |
| Email action links (verification / reset / invitation) | 24 hours / 30 minutes / 7 days respectively, then unusable |
| Email delivery log | 90 days |
| Audit events | life of the workspace (deleted with it) |
| Demo workspaces | 24 hours, then deleted automatically |
| Expired sessions, rate-limit buckets | pruned continuously by a scheduled maintenance job |
| Operational logs | `[RETENTION OF YOUR LOG PLATFORM]` |

Account deletion removes the account immediately, together with its memberships,
sessions and any workspace where the person was the only member (including that
workspace's records, documents, notifications and audit history). Backups are retained for
`[BACKUP RETENTION]` and restored only in a disaster.

## 4. Who we share it with

Only the subprocessors listed in `SUBPROCESSORS.md`, plus disclosure where the law
requires it. We do not sell personal data and we do not share it for advertising.

## 5. Your rights

You can, from inside the product:

- **Export** your account and the workspace you are signed in to: Settings → Account &
  security → *Download my data* (`GET /api/account/export`).
- **Delete** your account: Settings → Account & security → *Delete my account*
  (`DELETE /api/account`), which requires your password.

You can also request access, correction, restriction, portability or objection by writing
to `[CONTACT EMAIL]`. We answer within one month, as required by GDPR Art. 12(3).

## 6. Legal bases and international transfers

Where GDPR applies, processing rests on the bases in §1. Transfers outside the EEA rely
on `[STANDARD CONTRACTUAL CLAUSES / ADEQUACY DECISION]`.

## 7. Children

The service is not intended for anyone under 18 and we do not knowingly process their data.

## 8. Security

Passwords are hashed with scrypt; session and action tokens are stored only as SHA-256
hashes; all records are scoped to a workspace on every query; transport is HTTPS-only with
HSTS when deployed with TLS. **We do not claim any security certification.**

## 9. Changes

Material changes will be announced by email to the workspace owner and by a dated notice
in the product, `[NOTICE PERIOD]` before they take effect.

---

### Engineer's checklist before this can be published

- [ ] Legal entity, address, contact and DPO filled in
- [ ] Hosting region(s) and log retention filled in
- [ ] Backup retention stated and actually configured
- [ ] `SUBPROCESSORS.md` matches the production environment
- [ ] Reviewed by counsel in the operating jurisdiction
