# Email, verification, recovery and invitations

The three flows that separate a demo from a product: proving an address, letting
someone back in when they forget a password, and adding a teammate.

**Status: implemented and tested end to end. Delivery runs on the `console` transport
until a sending domain exists.** Nothing is sent to the internet in this build; the
moment a domain is verified at Resend, it is three environment variables and one
restart (see §6).

---

## 1. Architecture

```
route ──► emails.ts ──┬─► tokens.ts   (issue / consume, hashed, single-use)
                      └─► mailer.ts   (console | resend) ──► op_email_log
```

| File | Responsibility |
| --- | --- |
| `src/opspilot/server/mailer.ts` | Transport interface, templates, delivery logging. Never throws into the request path |
| `src/opspilot/server/tokens.ts` | 32-byte tokens, SHA-256 at rest, purpose-bound, atomic single use, TTL |
| `src/opspilot/server/emails.ts` | Issue token → build link → render template → send |
| `src/app/api/session/[action]` | `verify`, `request-reset`, `reset` actions |
| `src/app/api/members` | `GET` roster + invitations, `POST` invite (seat-enforced) |
| `src/app/api/members/accept` | Accept an invitation (creates the account if needed) |
| `src/app/login/page.tsx` + `components/Auth.tsx` | Consumes the three links; recovery modal now really sends mail |
| `opspilot/tests/email.test.ts` | 12 cases: config, templates, token lifecycle, all three flows |

## 2. Security properties

- **Hashed at rest.** Only `sha256(token)` is stored. A database dump contains no working links.
- **Purpose-bound.** A `verify` token cannot be used as `reset`, and vice versa.
- **Single use, atomically.** Consumption is `UPDATE … WHERE used_at IS NULL AND expires_at > now()`
  and returns the row only to the winner, so two simultaneous clicks cannot both succeed.
- **Short-lived.** Verification 24 h, password reset **30 minutes**, invitation 7 days.
- **Rotation.** Issuing a new token burns the outstanding one for that address and purpose.
- **No enumeration.** `request-reset` returns the same body and status for known and unknown
  addresses, and does the same expensive hashing work on the unknown path. Rate limited to
  3 requests per address per hour.
- **Reset evicts everyone.** A completed reset deletes every session for that user; the old
  password stops working immediately (both asserted in tests).
- **Invitations cannot take over an existing account.** If the invited address already has an
  account, the current password must be supplied to join; otherwise only a new account is created.
- **Verification is proven by receipt.** Completing a reset also marks the address verified —
  receiving the mail is proof of control.
- **No tracking pixels, no HTML.** Plain-text transactional mail, which also reduces
  deliverability surprises and unnecessary data collection.

## 3. Seats and invitations

`POST /api/members` requires `owner` or `administrator`, validates the role against the seven-role
matrix (owner is not invitable), refuses existing members, and counts **members + outstanding
invitations** against the plan's seat limit before sending:

```
402 "Your Free plan includes 2 team members and this workspace has reached it. Upgrade to invite more."
```

The invited person lands on `/login?mode=invite&token=…`, sets a name and password, and is signed
in with the role's permissions. The owner sees them in `GET /api/members`.

## 4. What the recipient experiences

- **Registration** → "Confirm your OpsPilot email address" → click → `/login?mode=verify&token=…`
  → confirms, then "Go to your workspace".
- **Forgot password** → "Need help signing in?" on the login page → email → `/login?mode=reset&token=…`
  → choose a new password → every other session is signed out → sign in.
- **Invitation** → "Priya invited you to Acme Studio" → `/login?mode=invite&token=…` → join.

## 5. Operating it

```
MAIL_TRANSPORT=console     # default: email is written to the server log + op_email_log
MAIL_FROM="OpsPilot <no-reply@yourdomain.com>"
APP_URL=https://yourdomain.com   # absolute; used in every link
```

Support question "did the reset email go out?":

```sql
select recipient, template, status, provider_id, error, created_at
from op_email_log order by created_at desc limit 20;
```

`status` is `sent`, `failed` or `suppressed`; failures never fail the user's request, and the
reason is stored on the row.

## 6. Turning on real delivery (needs a domain)

1. Register a domain (~$10/yr). A dedicated subdomain such as `mail.yourdomain.com` for sending is
   fine.
2. Add it at Resend, publish the **SPF**, **DKIM** and **DMARC** records it generates.
   Start DMARC at `p=none` so you receive reports without rejecting legitimate mail.
3. Wait for "Verified", then send one test to your own inbox and confirm it is not in spam.
4. Set `MAIL_TRANSPORT=resend`, `RESEND_API_KEY=…`, `MAIL_FROM="OpsPilot <no-reply@yourdomain.com>"`,
   `APP_URL=https://yourdomain.com`, restart.

Free tier: 3,000 emails/month with a 100/day cap — comfortably enough for the first ~20 workspaces,
and the daily cap is a useful circuit breaker against an email loop.

**Why a domain is not optional:** mail from a shared or free domain is routinely spam-foldered.
A password reset that silently lands in spam is indistinguishable from churn.

## 7. Known gaps (tracked)

- **Resend adapter is untested against the live API** — no key and no domain exist yet. The code
  path is exercised only for configuration validation. First live send must be watched (§6 step 3).
- **No verification gate yet.** Unverified accounts can use the workspace; `user.emailVerified` is
  exposed so the UI can nudge, and gating invitations/billing on verification is T-212.
- **No bounce/complaint webhook.** Resend events (bounced, complained) are not consumed, so a
  hard-bounced address keeps receiving attempts. T-213.
- **No reminder email** for unverified addresses, and no "your plan is about to lapse" mail —
  both need the job runner (T-401).
- **No bulk invites, no resend-invite button in the UI** (API supports a new invite per address).
- Templates are plain text only; a branded HTML layer is a later, separate decision.
