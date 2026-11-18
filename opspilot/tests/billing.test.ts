import "dotenv/config";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { aiUsage, billingEvents, memberships, subscriptions, users, workspaces } from "../../src/db/schema";
import {
  applyBillingEvent,
  effectivePlanId,
  enforceQuota,
  getEntitlements,
  usageFor,
  verifyWebhookSignature,
} from "../../src/opspilot/server/billing";
import { PLANS, PLAN_IDS, formatPlanPrice, planPriceCents, limitsFor } from "../../src/opspilot/lib/plans";
import type { Subscription } from "../../src/opspilot/server/billing";

const base = process.env.TEST_BASE_URL?.replace(/\/$/, "");
const secret = process.env.BILLING_WEBHOOK_SECRET ?? "";

const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

function subscriptionFixture(overrides: Partial<Subscription> = {}): Subscription {
  return {
    workspaceId: randomUUID(),
    plan: "growth",
    status: "active",
    provider: "test",
    providerCustomerId: null,
    providerSubscriptionId: null,
    seats: 15,
    currentPeriodEnd: daysFromNow(30),
    cancelAt: null,
    graceUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function createWorkspace() {
  const [workspace] = await db.insert(workspaces).values({ name: `Billing ${randomUUID()}` }).returning();
  const [user] = await db.insert(users).values({ name: "Billing Tester", email: `billing-${randomUUID()}@example.com`, passwordHash: "x:y" }).returning();
  await db.insert(memberships).values({ workspaceId: workspace.id, userId: user.id, role: "owner" });
  return { workspace, user };
}

async function cleanup(workspaceId: string, userId: string) {
  await db.delete(billingEvents).where(eq(billingEvents.workspaceId, workspaceId));
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, userId));
}

/* ------------------------------------------------------------------ */

describe("plan catalogue", () => {
  it("defines four plans with coherent, integer pricing and rising limits", () => {
    assert.deepEqual([...PLAN_IDS], ["free", "starter", "growth", "scale"]);
    const prices = PLAN_IDS.map((id) => PLANS[id].monthlyCents);
    assert.deepEqual(prices, [0, 2900, 5900, 11900]);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b), "prices must rise with plan tier");
    for (const id of PLAN_IDS) {
      const plan = PLANS[id];
      assert.ok(Number.isInteger(plan.monthlyCents) && plan.monthlyCents >= 0);
      assert.ok(Number.isInteger(plan.annualCents));
      assert.ok(plan.seats > 0 && Number.isInteger(plan.seats));
      assert.ok(plan.aiQuestionsPerMonth > 0);
      assert.ok(plan.storageBytes > 0);
    }
    const limits = PLAN_IDS.map((id) => limitsFor(PLANS[id]).seats);
    assert.deepEqual(limits, [...limits].sort((a, b) => a - b), "seats must rise with plan tier");
    assert.equal(PLANS.free.monthlyCents, 0, "the free plan must actually be free");
  });

  it("allows price experiments through environment overrides without accepting junk", () => {
    assert.equal(planPriceCents("growth", {}), 5900);
    assert.equal(planPriceCents("growth", { PLAN_PRICE_GROWTH_CENTS: "4900" }), 4900);
    assert.equal(planPriceCents("growth", { PLAN_PRICE_GROWTH_CENTS: "-100" }), 5900, "negative overrides are ignored");
    assert.equal(planPriceCents("growth", { PLAN_PRICE_GROWTH_CENTS: "abc" }), 5900, "non-numeric overrides are ignored");
  });

  it("formats display prices for USD and INR", () => {
    assert.equal(formatPlanPrice(5900, "USD"), "$59");
    assert.equal(formatPlanPrice(0, "USD"), "$0");
    assert.match(formatPlanPrice(2900, "INR"), /2,523/);
  });
});

describe("webhook signature verification", () => {
  const body = JSON.stringify({ id: "evt_1", type: "subscription.activated" });
  const now = 1_700_000_000_000;
  const timestamp = Math.floor(now / 1000);
  const goodSignature = createHmac("sha256", "super-secret-value-123").update(`${timestamp}.${body}`).digest("hex");
  const verify = (header: string | null, secretValue = "super-secret-value-123") =>
    verifyWebhookSignature(body, header, secretValue, { nowMs: now });

  it("accepts a correctly signed payload", () => {
    assert.deepEqual(verify(`t=${timestamp},v1=${goodSignature}`), { ok: true });
  });

  it("accepts any matching signature when the secret was rotated", () => {
    const other = createHmac("sha256", "super-secret-value-123").update(`${timestamp}.${body}`).digest("hex");
    assert.deepEqual(verify(`t=${timestamp},v1=${"0".repeat(64)},v1=${other}`), { ok: true });
  });

  it("rejects a wrong secret, a tampered body, and a missing header", () => {
    assert.equal(verify(`t=${timestamp},v1=${goodSignature}`, "different-secret-value").ok, false);
    const tampered = verifyWebhookSignature(`${body} `, `t=${timestamp},v1=${goodSignature}`, "super-secret-value-123", { nowMs: now });
    assert.equal(tampered.ok, false, "a modified body must not verify");
    assert.equal(verify(null).ok, false);
    assert.equal(verify("").ok, false);
    assert.equal(verifyWebhookSignature(body, `t=${timestamp},v1=${goodSignature}`, "", { nowMs: now }).ok, false);
  });

  it("rejects replays outside the tolerance window and malformed headers", () => {
    const stale = `t=${timestamp - 301},v1=${createHmac("sha256", "super-secret-value-123").update(`${timestamp - 301}.${body}`).digest("hex")}`;
    assert.equal(verify(stale).ok, false, "a 301-second-old event must be rejected");
    assert.equal(verify("t=abc,v1=deadbeef").ok, false);
    assert.equal(verify(`v1=${goodSignature}`).ok, false, "a signature without a timestamp must be rejected");
    assert.equal(verify(`t=${timestamp},v1=nothex`).ok, false);
  });
});

describe("plan downgrade logic (pure)", () => {
  it("keeps the paid plan while the period, grace window, or cancellation date is live", () => {
    assert.equal(effectivePlanId(subscriptionFixture()), "growth");
    assert.equal(effectivePlanId(subscriptionFixture({ status: "trialing" })), "growth");
    assert.equal(effectivePlanId(subscriptionFixture({ status: "past_due", graceUntil: daysFromNow(3) })), "growth");
    assert.equal(effectivePlanId(subscriptionFixture({ status: "past_due", graceUntil: daysFromNow(-1) })), "free");
    assert.equal(effectivePlanId(subscriptionFixture({ status: "canceled", cancelAt: daysFromNow(10) })), "growth");
    assert.equal(effectivePlanId(subscriptionFixture({ status: "canceled", cancelAt: daysFromNow(-10) })), "free");
    assert.equal(effectivePlanId(subscriptionFixture({ status: "incomplete" })), "free");
  });
});

/* ------------------------------------------------------------------ */

describe("billing state machine (database)", () => {
  it("activates a paid plan, applies each transition once, and audits every change", async () => {
    const { workspace, user } = await createWorkspace();
    const providerSubscriptionId = `test_sub_${randomUUID()}`;
    const periodEnd = daysFromNow(30).toISOString();
    try {
      const activated = await applyBillingEvent({
        provider: "test", eventId: `evt_${randomUUID()}`, type: "subscription.activated",
        workspaceId: workspace.id, providerSubscriptionId, plan: "growth", currentPeriodEnd: periodEnd,
      });
      assert.equal(activated.status, "applied");
      let entitlements = await getEntitlements(workspace.id);
      assert.equal(entitlements.planId, "growth");
      assert.equal(entitlements.status, "active");
      assert.equal(entitlements.limits.seats, PLANS.growth.seats);

      // Duplicate delivery must be a no-op that still reports success upstream.
      const replay = await applyBillingEvent({
        provider: "test", eventId: "evt_replay", type: "subscription.activated",
        workspaceId: workspace.id, providerSubscriptionId, plan: "growth", currentPeriodEnd: periodEnd,
      });
      assert.equal(replay.status, "applied");
      const duplicate = await applyBillingEvent({
        provider: "test", eventId: "evt_replay", type: "subscription.activated",
        workspaceId: workspace.id, providerSubscriptionId, plan: "scale", currentPeriodEnd: periodEnd,
      });
      assert.equal(duplicate.status, "duplicate");
      entitlements = await getEntitlements(workspace.id);
      assert.equal(entitlements.planId, "growth", "a replayed event must not change the plan again");

      // Failed payment: keep the paid plan during grace.
      await applyBillingEvent({
        provider: "test", eventId: `evt_${randomUUID()}`, type: "invoice.payment_failed", workspaceId: workspace.id,
      });
      entitlements = await getEntitlements(workspace.id);
      assert.equal(entitlements.status, "past_due");
      assert.equal(entitlements.planId, "growth", "grace period must preserve entitlements");
      assert.ok(entitlements.graceUntil && entitlements.graceUntil > new Date());

      // Cancellation: access continues until the period end.
      await applyBillingEvent({
        provider: "test", eventId: `evt_${randomUUID()}`, type: "subscription.canceled", workspaceId: workspace.id, cancelAt: daysFromNow(5).toISOString(),
      });
      entitlements = await getEntitlements(workspace.id);
      assert.equal(entitlements.status, "canceled");
      assert.equal(entitlements.planId, "growth");

      // Expiry: drop to free without touching customer data.
      await applyBillingEvent({
        provider: "test", eventId: `evt_${randomUUID()}`, type: "subscription.expired", workspaceId: workspace.id,
      });
      entitlements = await getEntitlements(workspace.id);
      assert.equal(entitlements.planId, "free");
      assert.equal(entitlements.limits.seats, PLANS.free.seats);

      const events = await db.select().from(billingEvents).where(eq(billingEvents.workspaceId, workspace.id));
      assert.equal(events.filter((event) => event.status === "applied").length, 5, "activated, replay, payment_failed, canceled, expired");
    } finally {
      await cleanup(workspace.id, user.id);
    }
  });

  it("ignores unsupported event types and events with no resolvable workspace", async () => {
    const ignored = await applyBillingEvent({ provider: "test", eventId: `evt_${randomUUID()}`, type: "customer.created" });
    assert.equal(ignored.status, "ignored");

    const orphan = await applyBillingEvent({ provider: "test", eventId: `evt_${randomUUID()}`, type: "subscription.activated", workspaceId: randomUUID() });
    assert.equal(orphan.status, "failed");
  });

  it("enforces quotas and refuses to exceed the plan limit", async () => {
    const { workspace, user } = await createWorkspace();
    try {
      await getEntitlements(workspace.id); // creates the free subscription
      const free = PLANS.free;
      await enforceQuota(workspace.id, "ai");
      await enforceQuota(workspace.id, "storage", free.storageBytes);

      const rows = Array.from({ length: free.aiQuestionsPerMonth }, () => ({ workspaceId: workspace.id, provider: "local", tokens: 10 }));
      await db.insert(aiUsage).values(rows);
      assert.equal((await usageFor(workspace.id)).aiQuestions, free.aiQuestionsPerMonth);
      await assert.rejects(() => enforceQuota(workspace.id, "ai"), /plan includes/);
      await assert.rejects(() => enforceQuota(workspace.id, "storage", free.storageBytes + 1), /plan includes/);

      // Upgrading via a verified event restores headroom.
      await applyBillingEvent({
        provider: "test", eventId: `evt_${randomUUID()}`, type: "subscription.activated", workspaceId: workspace.id, plan: "starter",
      });
      await enforceQuota(workspace.id, "ai");
      await enforceQuota(workspace.id, "storage", free.storageBytes + 1);
    } finally {
      await db.delete(aiUsage).where(eq(aiUsage.workspaceId, workspace.id));
      await cleanup(workspace.id, user.id);
    }
  });
});

/* ------------------------------------------------------------------ */

describe("billing HTTP surface", { skip: !base ? "TEST_BASE_URL is not set" : false }, () => {
  const post = (path: string, body: string, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base!, ...headers }, body });
  const sign = (payload: string, timestamp = Math.floor(Date.now() / 1000)) => {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    return `t=${timestamp},v1=${signature}`;
  };

  it("rejects unsigned, wrongly signed, and stale webhooks", { skip: !secret ? "BILLING_WEBHOOK_SECRET is not set" : false }, async () => {
    const payload = JSON.stringify({ id: `evt_${randomUUID()}`, type: "subscription.activated", data: {} });
    assert.equal((await post("/api/billing/webhook", payload)).status, 401);
    assert.equal((await post("/api/billing/webhook", payload, { "x-opspilot-signature": "t=1,v1=" + "0".repeat(64) })).status, 401);
    const staleTimestamp = Math.floor(Date.now() / 1000) - 400;
    assert.equal((await post("/api/billing/webhook", payload, { "x-opspilot-signature": sign(payload, staleTimestamp) })).status, 401);
  });

  it("registers a workspace, refuses to grant a plan from checkout, then activates only on a signed webhook", { skip: !secret ? "BILLING_WEBHOOK_SECRET is not set" : false }, async () => {
    const email = `billing-http-${randomUUID()}@example.com`;
    const register = await post("/api/session/register", JSON.stringify({
      email, password: "A-good-test-password-2026!", name: "Billing HTTP", workspace: `Billing HTTP ${randomUUID()}`,
    }));
    assert.equal(register.status, 201);
    const cookie = (register.headers.getSetCookie() ?? []).find((value) => value.startsWith("opspilot_session="))?.split(";")[0];
    assert.ok(cookie, "registration must set a session cookie");

    const before = await (await fetch(`${base}/api/billing`, { headers: { Cookie: cookie! } })).json();
    assert.equal(before.subscription.plan, "free");
    const workspaceId = (await (await fetch(`${base}/api/workspace`, { headers: { Cookie: cookie! } })).json()).workspace.id;

    // Checkout records intent; it must not move the plan.
    const checkout = await fetch(`${base}/api/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base!, Cookie: cookie! },
      body: JSON.stringify({ plan: "growth" }),
    });
    assert.ok([202, 503].includes(checkout.status), `unexpected checkout status ${checkout.status}`);
    if (checkout.status === 202) {
      const afterCheckout = await (await fetch(`${base}/api/billing`, { headers: { Cookie: cookie! } })).json();
      assert.equal(afterCheckout.subscription.plan, "free", "checkout must never grant entitlements");
      assert.equal(afterCheckout.subscription.status, "incomplete");
    }

    // A signed webhook is the only thing that can activate the plan.
    const event = { id: `evt_${randomUUID()}`, type: "subscription.activated", data: { workspaceId, plan: "growth", currentPeriodEnd: daysFromNow(30).toISOString() } };
    const payload = JSON.stringify(event);
    const delivered = await post("/api/billing/webhook", payload, { "x-opspilot-signature": sign(payload) });
    assert.equal(delivered.status, 200);
    assert.equal((await delivered.json()).status, "applied");

    const replayed = await post("/api/billing/webhook", payload, { "x-opspilot-signature": sign(payload) });
    assert.equal(replayed.status, 200);
    assert.equal((await replayed.json()).status, "duplicate");

    const after = await (await fetch(`${base}/api/billing`, { headers: { Cookie: cookie! } })).json();
    assert.equal(after.subscription.plan, "growth");
    assert.equal(after.subscription.status, "active");
    assert.equal(after.limits.seats, PLANS.growth.seats);
  });
});

after(async () => {
  // HTTP tests register real workspaces/users; remove them by their known prefixes.
  const httpWorkspaces = await db.select({ id: workspaces.id }).from(workspaces).where(sql`${workspaces.name} like 'Billing HTTP %'`);
  if (httpWorkspaces.length) await db.delete(workspaces).where(inArray(workspaces.id, httpWorkspaces.map((row) => row.id)));
  await db.delete(users).where(sql`${users.email} like 'billing-%@example.com'`);
  const strays = await db.select({ id: subscriptions.workspaceId }).from(subscriptions).where(and(eq(subscriptions.provider, "test")));
  if (strays.length) await db.delete(subscriptions).where(inArray(subscriptions.workspaceId, strays.map((row) => row.id)));
  await db.delete(billingEvents).where(eq(billingEvents.provider, "test"));
  await pool.end();
});
