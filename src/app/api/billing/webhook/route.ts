import { z } from "zod";
import { apiError, ApiError, rateLimit } from "@/opspilot/server/security";
import { config } from "@/opspilot/server/config";
import { applyBillingEvent, verifyWebhookSignature } from "@/opspilot/server/billing";

export const dynamic = "force-dynamic";

/**
 * Payment-provider callback. The only path that can grant a paid plan.
 *
 * Order matters: signature first (reject unsigned traffic before any parsing
 * work), then idempotent recording, then application.
 */
const eventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(80),
  data: z.object({
    workspaceId: z.uuid().optional(),
    providerSubscriptionId: z.string().min(1).max(120).optional(),
    providerCustomerId: z.string().max(120).optional(),
    plan: z.string().max(20).optional(),
    seats: z.number().int().min(1).max(10_000).optional(),
    currentPeriodEnd: z.string().max(40).optional(),
    cancelAt: z.string().max(40).optional(),
  }).strict().default({}),
}).strict();

export async function POST(request: Request) {
  try {
    const { billingProvider, billingWebhookSecret } = config();
    if (!billingProvider) throw new ApiError(503, "Billing is not enabled on this deployment.");

    const rawBody = await request.text();
    if (rawBody.length > 64_000) throw new ApiError(413, "Payload too large.");

    const signature = verifyWebhookSignature(rawBody, request.headers.get("x-opspilot-signature"), billingWebhookSecret);
    if (!signature.ok) {
      // Rate limit only after a failed signature check so a valid provider is never
      // throttled by unrelated traffic sharing the same bucket.
      await rateLimit(`webhook-reject:${request.headers.get("x-forwarded-for") ?? "direct"}`, 60);
      throw new ApiError(401, "Invalid webhook signature.");
    }

    const parsed = eventSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) throw new ApiError(400, "Unrecognised webhook payload.");

    const { id, type, data } = parsed.data;
    const result = await applyBillingEvent({
      provider: billingProvider,
      eventId: id,
      type,
      workspaceId: data.workspaceId,
      providerSubscriptionId: data.providerSubscriptionId,
      providerCustomerId: data.providerCustomerId,
      plan: data.plan,
      seats: data.seats,
      currentPeriodEnd: data.currentPeriodEnd,
      cancelAt: data.cancelAt,
    });
    // Providers retry on 5xx; a failed application is reported so it can be replayed
    // after the underlying problem is fixed.
    if (result.status === "failed") throw new ApiError(500, "Webhook received but could not be applied.");
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
    return apiError(error);
  }
}
