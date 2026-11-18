import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { ApiError, apiError, assertOrigin, rateLimit, readJson, requireSession } from "@/opspilot/server/security";
import { config } from "@/opspilot/server/config";
import { isPlanId, planFor, planPriceCents } from "@/opspilot/lib/plans";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ plan: z.enum(["starter", "growth", "scale"]) }).strict();

/**
 * Starts a subscription change.
 *
 * This endpoint never grants a paid plan. It records an *incomplete*
 * subscription and returns the reference the provider will use; entitlements
 * only move when a signed webhook says the payment succeeded.
 */
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const session = await requireSession();
    if (!["owner", "administrator"].includes(session.role)) {
      throw new ApiError(403, "Only workspace owners or administrators can change the plan.");
    }
    await rateLimit(`billing:${session.user.id}`, 10);

    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success || !isPlanId(parsed.data.plan)) throw new ApiError(400, "Choose a paid plan to continue.");
    const plan = planFor(parsed.data.plan);

    const { billingProvider } = config();
    if (!billingProvider) {
      throw new ApiError(503, "Billing is not enabled on this deployment. No payment was taken and no plan change was made.");
    }

    if (billingProvider === "stripe") {
      // Intentionally unimplemented: wiring a live gateway requires a merchant
      // account and founder sign-off. Refuse rather than fake a checkout URL.
      throw new ApiError(501, "Stripe checkout is not wired up in this build. Use the test provider or configure the Stripe adapter first.");
    }

    const reference = `test_sub_${randomUUID()}`;
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, session.workspace.id)).limit(1);
      if (existing) {
        await tx.update(subscriptions).set({
          plan: plan.id,
          status: "incomplete",
          provider: billingProvider,
          providerSubscriptionId: reference,
          updatedAt: new Date(),
        }).where(eq(subscriptions.workspaceId, session.workspace.id));
      } else {
        await tx.insert(subscriptions).values({
          workspaceId: session.workspace.id,
          plan: plan.id,
          status: "incomplete",
          provider: billingProvider,
          providerSubscriptionId: reference,
          seats: plan.seats,
        });
      }
    });

    return Response.json({
      ok: true,
      provider: billingProvider,
      reference,
      plan: plan.id,
      amountCents: planPriceCents(plan.id),
      // Test mode has no hosted page: the plan only activates on a signed webhook,
      // exactly like production. See opspilot/docs/BILLING.md.
      checkoutUrl: null,
      message: "Checkout recorded. The plan activates only after a signed payment webhook is received.",
    }, { status: 202 });
  } catch (e) { return apiError(e); }
}
