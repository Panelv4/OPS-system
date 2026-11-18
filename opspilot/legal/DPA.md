# Data Processing Agreement — DRAFT, NOT REVIEWED BY A LAWYER

_Version: draft 1 · Last updated: 2026-11-18_

> Template for business customers who are controllers (GDPR Art. 28). Not legal advice.

**Processor:** `[LEGAL ENTITY NAME]`, `[ADDRESS]`
**Controller:** the customer named in the order form or account
**Subject matter:** provision of the OpsPilot service
**Duration:** the term of the subscription

## 1. Processing

- **Nature and purpose:** hosting, storing, displaying, searching, exporting, emailing
  about, and (where enabled) producing AI summaries of the controller's business records.
- **Categories of data subjects:** the controller's staff and the controller's customers,
  vendors and contacts.
- **Categories of personal data:** names, business contact details, employment records the
  controller chooses to store, and financial records relating to them.
- **Special categories:** not intended to be processed. The controller must not upload
  them.

## 2. Controller instructions

The processor acts only on documented instructions from the controller: the configuration
of the workspace and the actions taken in it. The processor will inform the controller if
an instruction appears to breach data-protection law.

## 3. Confidentiality and security

Personnel are bound by confidentiality. Technical measures as implemented today:

- passwords hashed (scrypt), session and action tokens stored only as SHA-256 hashes;
- every database query scoped to the authenticated workspace;
- rate limiting on authentication and other sensitive endpoints;
- HTTP-only session cookies; HTTPS-only deployment with HSTS;
- audit events per workspace; automatic pruning of expired sessions and action tokens;
- role-based permissions enforced server-side.

The processor does **not** hold a security certification and does not warrant one.

## 4. Subprocessors

Listed in `SUBPROCESSORS.md`. The controller authorises them. The processor will give
`[NOTICE PERIOD]` notice of a new subprocessor and the controller may object on
data-protection grounds; if no agreement is reached, the controller may terminate.

## 5. Assistance

The processor assists with data-subject requests through the in-product export and deletion
features, and with breach notification by informing the controller without undue delay and
within `[HOURS]` of becoming aware. **Breach notification has not been exercised yet** —
there is no on-call rotation or paging in this build, which the controller should know.

## 6. International transfers

Transfers rely on `[SCCs / adequacy]`, with the hosting and subprocessor regions recorded in
`SUBPROCESSORS.md`.

## 7. Return and deletion

On termination the controller exports data in-product; the processor deletes it within
`[DAYS]`, except where law requires retention. Backups age out on the schedule in the
Privacy Policy.

## 8. Audit

The processor answers security questionnaires and provides the audit artefacts it has
(`SECURITY_AUDIT.md`, `PRODUCTION_READINESS.md`). On-site audits are available
`[FREQUENCY]` with `[NOTICE]`, at the controller's cost, subject to confidentiality.

---

### Engineer's checklist

- [ ] Breach-notification window agreed **and** an actual on-call path created
- [ ] Subprocessor list verified against the production environment
- [ ] Counsel review; sign-off recorded
