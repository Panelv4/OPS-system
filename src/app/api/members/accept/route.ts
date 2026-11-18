import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, memberships, notifications, users, workspaces } from "@/db/schema";
import { ApiError, apiError, assertOrigin, createSession, getSession, hashPassword, logout, rateLimit, readJson, verifyPassword } from "@/opspilot/server/security";
import { consumeToken } from "@/opspilot/server/tokens";
import { loadWorkspace } from "@/opspilot/server/repository";

export const dynamic = "force-dynamic";

/**
 * Accepts a workspace invitation. Public endpoint (the invitee is not signed in).
 *
 * If the address already has an account, the existing password must be supplied so
 * a stolen invitation link cannot take over an account. New addresses create an
 * account and are signed in immediately.
 */
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    await rateLimit("invite-accept", 30, 15 * 60 * 1000);

    const parsed = z.object({
      token: z.string().max(200),
      name: z.string().trim().min(2).max(120),
      password: z.string().min(10).max(128),
    }).strict().safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(400, "Enter your name and a password of 10–128 characters.");

    const consumed = await consumeToken(parsed.data.token, "invite");
    if (!consumed?.workspaceId || !consumed.role) throw new ApiError(400, "This invitation is invalid, used, or expired.");
    const invitedRole: string = consumed.role;

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, consumed.workspaceId)).limit(1);
    if (!workspace) throw new ApiError(400, "That workspace no longer exists.");

    const email = consumed.email;
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    let userId: string;
    if (existing) {
      const valid = await verifyPassword(parsed.data.password, existing.passwordHash);
      if (!valid) throw new ApiError(401, "That email already has an account. Enter its current password to join.");
      const [alreadyMember] = await db.select({ userId: memberships.userId }).from(memberships)
        .where(and(eq(memberships.workspaceId, workspace.id), eq(memberships.userId, existing.id))).limit(1);
      if (alreadyMember) throw new ApiError(409, "You are already a member of this workspace.");
      await db.insert(memberships).values({ workspaceId: workspace.id, userId: existing.id, role: invitedRole });
      userId = existing.id;
    } else {
      const passwordHash = await hashPassword(parsed.data.password);
      const [created] = await db.insert(users).values({ name: parsed.data.name, email, passwordHash }).returning();
      await db.insert(memberships).values({ workspaceId: workspace.id, userId: created.id, role: invitedRole });
      userId = created.id;
    }

    await db.transaction(async (tx) => {
      await tx.insert(auditEvents).values({
        workspaceId: workspace.id,
        actor: parsed.data.name,
        action: "member.joined",
        subject: email,
        metadata: { kind: "members", role: invitedRole },
      });
      await tx.insert(notifications).values({
        workspaceId: workspace.id,
        title: "New team member",
        message: `${parsed.data.name} accepted the invitation and joined as ${invitedRole.replaceAll("_", " ")}.`,
        module: "overview",
      });
    });

    await logout();
    await createSession(userId, workspace.id);
    const session = await getSession();
    if (!session) throw new ApiError(500, "Unable to start a session for this invitation.");
    return Response.json(await loadWorkspace(session), { status: 201 });
  } catch (error) { return apiError(error); }
}
