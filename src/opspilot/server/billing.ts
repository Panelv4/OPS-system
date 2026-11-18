/**
 * Billing domain logic: subscription state, entitlements, quotas, and webhook
 * verification.
 *
 * Design rules enforced here:
 *  - Entitlements are read from the database, never from a gateway round trip,
 *    so the app keeps working during a provider outage.
 *  - Nothing grants a paid plan except a signature-verified webhook recorded in
 *    `op_billing_events` (see `applyBillingEvent`).
 *  - Every state change is idempotent and audited.
 *  - Lapsed subscriptions degrade to the free plan; they never delete data.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, auditEvents, billingEvents, files, memberships, notifications, records, subscriptions } from "@/db/schema";
import { ApiError } from "./security";
import { config } from "./config";
import { DEFAULT_PLAN, limitsFor, planFor, quotaLabel, type Limits, type Plan, type PlanId, type QuotaKind, isPlanId } from "../lib/plans";

export type Subscription = typeof subscriptions.$inferSelect;

export type Usage = {
  seats: number;
  aiQuestions: number;
  storageBytes: number;
  activeWorkflows: number;
};

export type Entitlements = {
  plan: Plan;
  planId: PlanId;
  status: Subscription["status"];
  /** True when the plan's limits apply; false once a period or grace window ended. */
  active: boolean;
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
  graceUntil: Date | null;
  limits: Limits;
  usage: Usage;
};

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** Events older than this are rejected as replays. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/* ------------------------------------------------------------------ *
 * Subscription lifecycle
 * ------------------------------------------------------------------ */

/**
 * Returns the workspace's subscription, creating a free one on first use so that
 * workspaces created before billing existed keep working.
 */
export async function ensureSubscription(workspaceId: string): Promise<Subscription> {
  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
  if (existing) return existing;
  const provider = config().billingProvider || "manual";
  const [created] = await db
    .insert(subscriptions)
    .values({ workspaceId, plan: DEFAULT_PLAN, status: "active", provider, seats: planFor(DEFAULT_PLAN).seats })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
  if (!row) throw new ApiError(500, "Unable to resolve a subscription for this workspace.");
  return row;
}

/**
 * Decides which plan's limits apply right now. A lapsed paid plan falls back to
 * the free plan rather than locking the customer out of their own data.
 */
export function effectivePlanId(sub: Subscription, now = new Date()): PlanId {
  const paid = isPlanId(sub.plan) ? sub.plan : DEFAULT_PLAN;
  if (sub.status === "active" || sub.status === "trialing") return paid;
  if (sub.status === "past_due" || sub.status === "incomplete") {
    return sub.graceUntil && sub.graceUntil > now ? paid : DEFAULT_PLAN;
  }
  if (sub.status === "canceled") {
    const endsAt = sub.cancelAt ?? sub.currentPeriodEnd;
    return endsAt && endsAt > now ? paid : DEFAULT_PLAN;
  }
  return DEFAULT_PLAN;
}

function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function usageFor(workspaceId: string, now = new Date()): Promise<Usage> {
  const [aiRow, storageRow, workflowRow, seatRow] = await Promise.all([
    db.select({ n: count() }).from(aiUsage).where(and(eq(aiUsage.workspaceId, workspaceId), gte(aiUsage.createdAt, startOfMonthUtc(now)))),
    db.select({ bytes: sql<number>`coalesce(sum(${files.size}), 0)::int` }).from(files).where(eq(files.workspaceId, workspaceId)),
    db.select({ n: count() }).from(records).where(and(eq(records.workspaceId, workspaceId), eq(records.kind, "workflows"), eq(records.status, "Active"))),
    db.select({ n: count() }).from(memberships).where(eq(memberships.workspaceId, workspaceId)),
  ]);
  return {
    seats: Number(seatRow[0]?.n ?? 0),
    aiQuestions: Number(aiRow[0]?.n ?? 0),
    storageBytes: Number(storageRow[0]?.bytes ?? 0),
    activeWorkflows: Number(workflowRow[0]?.n ?? 0),
  };
}

export async function getEntitlements(workspaceId: string, now = new Date()): Promise<Entitlements> {
  const sub = await ensureSubscription(workspaceId);
  const planId = effectivePlanId(sub, now);
  const plan = planFor(planId);
  return {
    plan,
    planId,
    status: sub.status,
    active: planId !== DEFAULT_PLAN || sub.status === "active" || sub.status === "trialing" || sub.plan === DEFAULT_PLAN,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAt: sub.cancelAt,
    graceUntil: sub.graceUntil,
    limits: limitsFor(plan),
    usage: await usageFor(workspaceId, now),
  };
}

const quotaUsage = (usage: Usage, kind: QuotaKind): number =>
  kind === "ai" ? usage.aiQuestions : kind === "storage" ? usage.storageBytes : kind === "workflows" ? usage.activeWorkflows : usage.seats;

/**
 * Throws 402 when an action would exceed the workspace's plan limits.
 * Fails closed with an actionable message — never silently allows the action.
 */
export async function enforceQuota(workspaceId: string, kind: QuotaKind, delta = 1): Promise<void> {
  const entitlements = await getEntitlements(workspaceId);
  const limit = kind === "ai" ? entitlements.limits.aiQuestionsPerMonth
    : kind === "storage" ? entitlements.limits.storageBytes
      : kind === "workflows" ? entitlements.limits.activeWorkflows
        : entitlements.limits.seats;
  const used = quotaUsage(entitlements.usage, kind);
  if (used + delta > limit) {
    throw new ApiError(
      402,
      `Your ${entitlements.plan.name} plan includes ${quotaLabel(kind, limit)} and this workspace has reached it. Upgrade to continue.`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Webhook signature verification (Stripe-compatible scheme)
 * ------------------------------------------------------------------ */

export type SignatureResult = { ok: true } | { ok: false; reason: string };

/**
 * Verifies a `t=<unix>,v1=<hex>` signature header over the raw request body.
 *
 * - The timestamp must be within the tolerance window (replay protection).
 * - Any matching `v1` is accepted (providers rotate secrets).
 * - Comparison is constant-time.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  options: { toleranceSeconds?: number; nowMs?: number } = {},
): SignatureResult {
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  const nowMs = options.nowMs ?? Date.now();
  if (!secret) return { ok: false, reason: "no secret configured" };
  if (!header) return { ok: false, reason: "missing signature header" };

  const parts = header.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) {
    return { ok: false, reason: "malformed signature header" };
  }

  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - Number(timestamp));
  if (ageSeconds > tolerance) return { ok: false, reason: "timestamp outside tolerance" };

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const matched = signatures.some((candidate) => {
    if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;
    const candidateBuffer = Buffer.from(candidate, "hex");
    return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
  });
  return matched ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

/* ------------------------------------------------------------------ *
 * Event application (idempotent state machine)
 * ------------------------------------------------------------------ */

export const SUPPORTED_EVENT_TYPES = [
  "subscription.activated",
  "subscription.renewed",
  "subscription.updated",
  "subscription.canceled",
  "subscription.expired",
  "invoice.paid",
  "invoice.payment_failed",
] as const;
export type BillingEventType = (typeof SUPPORTED_EVENT_TYPES)[number];

export type NormalisedBillingEvent = {
  provider: string;
  eventId: string;
  type: string;
  workspaceId?: string;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  plan?: string;
  seats?: number;
  currentPeriodEnd?: string;
  cancelAt?: string;
};

export type ApplyResult = {
  status: "applied" | "ignored" | "duplicate" | "failed";
  workspaceId?: string;
  reason?: string;
};

function toDate(value: string | undefined, fallback: Date | null = null): Date | null {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

async function resolveWorkspaceId(event: NormalisedBillingEvent): Promise<string | null> {
  if (event.workspaceId) {
    // Prefer the provider's subscription id when we have it, then the workspace id.
    const res = await db.execute(sql`select id from op_workspaces where id = ${event.workspaceId} limit 1`);
    if (res.rows.length) return event.workspaceId;
  }
  if (event.providerSubscriptionId) {
    const [row] = await db.select({ id: subscriptions.workspaceId }).from(subscriptions)
      .where(and(eq(subscriptions.provider, event.provider), eq(subscriptions.providerSubscriptionId, event.providerSubscriptionId))).limit(1);
    if (row) return row.id;
  }
  return null;
}

/**
 * Records then applies a billing event. Duplicate deliveries are a no-op that
 * still returns 200 to the provider.
 */
export async function applyBillingEvent(event: NormalisedBillingEvent, now = new Date()): Promise<ApplyResult> {
  const workspaceId = await resolveWorkspaceId(event);

  const [recorded] = await db
    .insert(billingEvents)
    .values({
      provider: event.provider,
      eventId: event.eventId,
      type: event.type,
      workspaceId,
      payload: event as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning();
  if (!recorded) return { status: "duplicate", workspaceId: workspaceId ?? undefined };

  if (!(SUPPORTED_EVENT_TYPES as readonly string[]).includes(event.type)) {
    await db.update(billingEvents).set({ status: "ignored", processedAt: new Date(), error: `Unsupported event type "${event.type}".` }).where(eq(billingEvents.id, recorded.id));
    return { status: "ignored", workspaceId: workspaceId ?? undefined, reason: "unsupported event type" };
  }
  if (!workspaceId) {
    await db.update(billingEvents).set({ status: "failed", processedAt: new Date(), error: "Unable to resolve a workspace for this event." }).where(eq(billingEvents.id, recorded.id));
    return { status: "failed", reason: "unknown workspace" };
  }

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
      const base = existing ?? (await tx.insert(subscriptions).values({
        workspaceId, plan: DEFAULT_PLAN, status: "active", provider: event.provider, seats: planFor(DEFAULT_PLAN).seats,
      }).returning())[0];

      const plan = event.plan && isPlanId(event.plan) ? event.plan : (isPlanId(base.plan) ? base.plan : DEFAULT_PLAN);
      const periodEnd = toDate(event.currentPeriodEnd, base.currentPeriodEnd);
      const patch: Partial<typeof subscriptions.$inferInsert> = { updatedAt: now };

      switch (event.type) {
        case "subscription.activated":
        case "subscription.renewed":
        case "invoice.paid": {
          patch.plan = plan;
          patch.status = "active";
          patch.seats = event.seats ?? planFor(plan).seats;
          patch.currentPeriodEnd = periodEnd;
          patch.cancelAt = null;
          patch.graceUntil = null;
          break;
        }
        case "subscription.updated": {
          patch.plan = plan;
          patch.seats = event.seats ?? base.seats;
          patch.currentPeriodEnd = periodEnd;
          if (event.cancelAt !== undefined) patch.cancelAt = toDate(event.cancelAt);
          break;
        }
        case "subscription.canceled": {
          // Access continues until the paid period (or the grace window) ends.
          patch.status = "canceled";
          patch.cancelAt = toDate(event.cancelAt, base.currentPeriodEnd ?? now);
          patch.plan = plan;
          break;
        }
        case "subscription.expired": {
          patch.status = "canceled";
          patch.plan = DEFAULT_PLAN;
          patch.seats = planFor(DEFAULT_PLAN).seats;
          patch.cancelAt = null;
          patch.graceUntil = null;
          break;
        }
        case "invoice.payment_failed": {
          patch.status = "past_due";
          patch.graceUntil = base.graceUntil ?? new Date(now.getTime() + GRACE_MS);
          patch.plan = plan;
          break;
        }
      }

      patch.provider = event.provider;
      if (event.providerSubscriptionId) patch.providerSubscriptionId = event.providerSubscriptionId;
      if (event.providerCustomerId) patch.providerCustomerId = event.providerCustomerId;

      await tx.update(subscriptions).set(patch).where(eq(subscriptions.workspaceId, workspaceId));
      await tx.insert(auditEvents).values({
        workspaceId,
        actor: "Billing",
        action: `billing.${event.type}`,
        subject: event.eventId.slice(0, 180),
        metadata: { plan: patch.plan ?? base.plan, status: patch.status ?? base.status, provider: event.provider },
      });
      await tx.insert(notifications).values({
        workspaceId,
        title: patch.plan && patch.plan !== DEFAULT_PLAN ? `Plan updated: ${planFor(patch.plan as PlanId).name}` : "Billing update",
        message: event.type === "invoice.payment_failed"
          ? "A payment failed. Your workspace keeps full access during the 7-day grace period; update your payment method to avoid a downgrade."
          : event.type === "subscription.canceled"
            ? "Your subscription is scheduled to cancel. You keep access until the end of the current period."
            : `Billing event applied: ${event.type}.`,
        module: "overview",
      });
      await tx.update(billingEvents).set({ status: "applied", processedAt: new Date(), workspaceId }).where(eq(billingEvents.id, recorded.id));
    });
    return { status: "applied", workspaceId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await db.update(billingEvents).set({ status: "failed", processedAt: new Date(), error: message.slice(0, 500) }).where(eq(billingEvents.id, recorded.id));
    console.error("[billing] Failed to apply event:", message);
    return { status: "failed", workspaceId, reason: "apply failed" };
  }
}
