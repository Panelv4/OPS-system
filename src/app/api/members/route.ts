import { and, count, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, emailTokens, memberships, users, workspaces } from "@/db/schema";
import { ApiError, apiError, assertOrigin, rateLimit, readJson, requireSession } from "@/opspilot/server/security";
import { sendInvitationEmail } from "@/opspilot/server/emails";

export const dynamic = "force-dynamic";

const INVITABLE_ROLES = ["administrator", "manager", "hr_manager", "accountant", "salesperson", "employee"] as const;

/** Roles and pending invitations for the current workspace. */
export async function GET() {
  try {
    const session = await requireSession();
    const [members, invites] = await Promise.all([
      db.select({ id: users.id, name: users.name, email: users.email, role: memberships.role, emailVerifiedAt: users.emailVerifiedAt })
        .from(memberships).innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.workspaceId, session.workspace.id)),
      db.select({ email: emailTokens.email, role: emailTokens.role, expiresAt: emailTokens.expiresAt })
        .from(emailTokens)
        .where(and(eq(emailTokens.workspaceId, session.workspace.id), eq(emailTokens.purpose, "invite"), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, new Date()))),
    ]);
    return Response.json({
      members: members.map((member) => ({ ...member, emailVerified: Boolean(member.emailVerifiedAt), emailVerifiedAt: undefined })),
      invitations: invites,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}

/** Invites someone to the workspace. Sends a single-use link; seats are enforced. */
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const session = await requireSession();
    if (!["owner", "administrator"].includes(session.role)) {
      throw new ApiError(403, "Only workspace owners or administrators can invite members.");
    }
    await rateLimit(`invite:${session.workspace.id}`, 20);

    const parsed = z.object({
      email: z.email().max(254),
      role: z.enum(INVITABLE_ROLES).default("employee"),
    }).strict().safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(400, "Enter a valid email address and a role.");
    const email = parsed.data.email.toLowerCase().trim();
    const role = parsed.data.role;

    // Already a member?
    const [existingMember] = await db.select({ id: memberships.userId }).from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.workspaceId, session.workspace.id), eq(users.email, email))).limit(1);
    if (existingMember) throw new ApiError(409, "That person is already a member of this workspace.");

    // Seat check counts members plus outstanding invitations, so inviting a team
    // cannot silently overshoot a paid plan.
    const { getEntitlements } = await import("@/opspilot/server/billing");
    const entitlements = await getEntitlements(session.workspace.id);
    const [pending] = await db.select({ n: count() }).from(emailTokens)
      .where(and(eq(emailTokens.workspaceId, session.workspace.id), eq(emailTokens.purpose, "invite"), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, new Date())));
    const seatsUsed = entitlements.usage.seats + Number(pending?.n ?? 0);
    if (seatsUsed + 1 > entitlements.limits.seats) {
      throw new ApiError(402, `Your ${entitlements.plan.name} plan includes ${entitlements.limits.seats} team members and this workspace has reached it. Upgrade to invite more.`);
    }

    const [workspace] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, session.workspace.id)).limit(1);
    const delivery = await sendInvitationEmail({
      email,
      workspaceId: session.workspace.id,
      workspaceName: workspace?.name ?? "your workspace",
      inviterName: session.user.name,
      role,
    });

    await db.insert(auditEvents).values({
      workspaceId: session.workspace.id,
      actor: session.user.name,
      action: "member.invited",
      subject: email,
      metadata: { kind: "members", role, delivery: delivery.status },
    });

    return Response.json({ ok: true, email, role, delivery: delivery.status }, { status: 201 });
  } catch (error) { return apiError(error); }
}
