# Billing

How subscriptions, entitlements and payment webhooks work — and the exact line where the money
stops today.

**Status: architecture and enforcement are implemented and tested; no payment gateway is
connected, and no live charge can occur.** Checkout is refused unless `BILLING_PROVIDER` is set,
and a paid plan can only be granted by a signature-verified webhook.

---

## 1. Security invariants (do not weaken these)

1. **No client-trusted success.** `POST /api/billing/checkout` records intent and returns `202`.
   It never changes the plan. The success page, if one is ever added, may only *poll*.
2. **Webhooks are the only source of truth.** `POST /api/billing/webhook` verifies
   `x-opspilot-signature` (`t=<unix>,v1=<hex>`, HMAC-SHA256 over `"<t>.<raw body>"`) with a
   300-second tolerance before parsing. Missing secret, bad signature, or stale timestamp → 401.
3. **Idempotency is database-enforced.** `unique(provider, event_id)` on `op_billing_events`;
   a replayed delivery returns `200 {status:"duplicate"}` and changes nothing.
4. **Entitlements are local.** Limits are read from `op_subscriptions` + the plan catalogue, never
   from a provider API call, so a gateway outage cannot lock customers out of their data.
5. **Lapse degrades, never deletes.** A lapsed plan falls back to free limits; records stay.
6. **Fail closed.** Missing `BILLING_WEBHOOK_SECRET` aborts boot when a provider is configured.
7. **Every change is audited** (`billing.<event type>`) and surfaced as an in-app notification.

## 2. Files

| Path | Responsibility |
| --- | --- |
| `src/opspilot/lib/plans.ts` | Plan catalogue, quotas, price overrides, display formatting |
| `src/opspilot/server/billing.ts` | Subscription state machine, entitlements, quotas, signature verification |
| `src/app/api/billing/route.ts` | `GET` current plan, usage, limits, catalogue |
| `src/app/api/billing/checkout/route.ts` | `POST` start a plan change (never grants) |
| `src/app/api/billing/webhook/route.ts` | `POST` provider callback (only grant path) |
| `opspilot/migrations/0002_*.sql` | `op_subscriptions`, `op_billing_events` |
| `opspilot/tests/billing.test.ts` | 13 cases: catalogue, signatures, state machine, quotas, HTTP |

## 3. Plans

Defined in `plans.ts` — prices and quotas are configuration, not UI constants.

| Plan | Monthly | Annual | Seats | AI questions/mo | Documents | Automations |
| --- | --- | --- | --- | --- | --- | --- |
| Free | $0 | $0 | 2 | 50 | 250 MB | 5 |
| Starter | $29 | $289 | 5 | 300 | 2 GB | 15 |
| Growth | $59 | $589 | 15 | 1,000 | 10 GB | 40 |
| Scale | $119 | $1,189 | 40 | 4,000 | 50 GB | 150 |

Override a price for an experiment without touching code:

```
PLAN_PRICE_GROWTH_CENTS=4900
```

Invalid overrides are ignored with a warning. INR display uses the ₹87/USD planning rate
(`formatPlanPrice`) and is **display only** — settlement currency is the provider's decision.

These numbers are hypotheses. `PRICING_RESEARCH` (T-601) and real conversations decide them.

## 4. State machine

`op_subscriptions` holds one row per workspace (`plan`, `status`, `seats`, `current_period_end`,
`cancel_at`, `grace_until`).

| Event | Effect on subscription | Entitlement effect |
| --- | --- | --- |
| `subscription.activated` | plan set, `active`, period end | Full paid limits |
| `subscription.renewed` / `invoice.paid` | `active`, period extended, grace + cancel cleared | Full paid limits |
| `subscription.updated` | plan/seats/period updated | New limits immediately |
| `invoice.payment_failed` | `past_due`, `grace_until = now + 7d` | Paid limits during grace, then free |
| `subscription.canceled` | `canceled`, `cancel_at = period end` | Paid until `cancel_at`, then free |
| `subscription.expired` | `canceled`, plan reset to free | Free immediately |
| Unknown type | Recorded as `ignored` | None |

`effectivePlanId()` implements the entitlement decision; it is covered by unit tests for every
branch (active, trialing, past-due inside/outside grace, canceled before/after `cancel_at`,
incomplete).

**Not yet modelled:** proration on mid-period upgrades, tax on subscriptions, dunning email
sequences, refunds (a refund event is recorded as `ignored` until a policy exists). These are
deliberately absent rather than faked — see `TASKS.md`.

## 5. Quotas enforced today

| Quota | Where enforced | Failure |
| --- | --- | --- |
| AI questions / month | `POST /api/intelligence` | 402 with plan name and limit |
| Document storage | `POST /api/documents` | 402 before the bytes are stored |
| Active automations | activating a workflow (`PATCH /api/records/[id]`) | 402 |
| Seats | **not enforced yet** — no invitation flow exists (T-204) | — |

`enforceQuota()` reads limits and usage in one pass; usage comes from `op_ai_usage` (this month),
`sum(op_files.size)`, active `op_workflows` records and `op_memberships`.

## 6. Operating it

Enable test mode locally:

```
DATABASE_URL=postgresql://… \
BILLING_PROVIDER=test \
BILLING_WEBHOOK_SECRET=dev-webhook-secret-0123456789 \
npm run start
```

Start a plan change (owner/administrator session cookie required):

```bash
curl -X POST http://localhost:3000/api/billing/checkout \
  -H "Content-Type: application/json" -H "Origin: http://localhost:3000" \
  -b cookie.txt -d '{"plan":"growth"}'
# 202 {"reference":"test_sub_…","checkoutUrl":null, …}  ← plan unchanged
```

Deliver the signed "payment succeeded" webhook:

```bash
BODY='{"id":"evt_1","type":"subscription.activated","data":{"workspaceId":"<uuid>","plan":"growth","currentPeriodEnd":"2027-01-01T00:00:00Z"}}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$BILLING_WEBHOOK_SECRET" -hex | awk '{print $2}')
curl -X POST http://localhost:3000/api/billing/webhook \
  -H "Content-Type: application/json" -H "x-opspilot-signature: t=$TS,v1=$SIG" -d "$BODY"
# 200 {"ok":true,"status":"applied"}   ← replay the same body: {"status":"duplicate"}
```

`GET /api/billing` then reports the new plan, limits and usage.

**Incident knob:** to stop all paid changes instantly, unset `BILLING_PROVIDER` and redeploy —
checkout and the webhook both return 503 and every workspace resolves to its stored plan.

## 7. Connecting a real gateway (blocked on founder action)

`BILLING_PROVIDER=stripe` currently returns **501** from checkout on purpose: a fake checkout URL
would be worse than an honest refusal. To finish it:

1. Create a merchant account (Stripe for USD; Razorpay for INR-licensing reasons) — **founder only**.
2. Add the adapter: map `checkout.session.completed`, `customer.subscription.updated/deleted`,
   `invoice.paid`, `invoice.payment_failed` onto the seven internal event types above.
3. Store `provider_customer_id`, `provider_subscription_id`, and the provider's `event_id`
   verbatim so idempotency keeps working.
4. Point the dashboard webhook at `POST /api/billing/webhook` with the signing secret in
   `BILLING_WEBHOOK_SECRET`; Stripe's header is `stripe-signature` — accept both names in the
   adapter, keep one verification implementation.
5. Rehearse in test mode: upgrade, downgrade, cancel, failed payment → grace → downgrade, replay
   every event twice.
6. Only then flip to live keys, with a founder watching the first payment end to end.

**Never** enable live charging, create tax registrations, or accept terms with a provider without
explicit founder approval. No merchant account was created or contacted in this work.

## 8. Known gaps (tracked)

- Billing UI: `Settings.tsx` still shows the old "proposed plans" copy; wiring it to
  `GET /api/billing` is T-109.
- Seat enforcement needs invitations (T-204/T-207).
- Dunning emails need the mailer (T-201) and the job runner (T-401).
- Trial support: `trialing` is a recognised status but nothing creates trials yet (T-110).
