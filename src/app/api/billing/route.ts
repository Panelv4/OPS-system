import { planPriceCents, PLANS, PLAN_IDS } from "@/opspilot/lib/plans";
import { apiError, requireSession } from "@/opspilot/server/security";
import { config } from "@/opspilot/server/config";
import { getEntitlements } from "@/opspilot/server/billing";

export const dynamic = "force-dynamic";

/**
 * Current plan, entitlement usage and the public plan catalogue.
 * Read-only: nothing here can grant an entitlement.
 */
export async function GET() {
  try {
    const session = await requireSession();
    const entitlements = await getEntitlements(session.workspace.id);
    const { billingProvider } = config();
    return Response.json({
      billingEnabled: Boolean(billingProvider),
      provider: billingProvider || null,
      subscription: {
        plan: entitlements.planId,
        planName: entitlements.plan.name,
        status: entitlements.status,
        active: entitlements.active,
        currentPeriodEnd: entitlements.currentPeriodEnd,
        cancelAt: entitlements.cancelAt,
        graceUntil: entitlements.graceUntil,
      },
      limits: entitlements.limits,
      usage: entitlements.usage,
      plans: PLAN_IDS.map((id) => {
        const plan = PLANS[id];
        return {
          id,
          name: plan.name,
          monthlyCents: planPriceCents(id),
          annualCents: plan.annualCents,
          seats: plan.seats,
          aiQuestionsPerMonth: plan.aiQuestionsPerMonth,
          storageBytes: plan.storageBytes,
          activeWorkflows: plan.activeWorkflows,
          summary: plan.summary,
          features: plan.features,
          current: id === entitlements.planId,
        };
      }),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return apiError(e); }
}
