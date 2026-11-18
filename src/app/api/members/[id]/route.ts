import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, memberships, sessions, users } from "@/db/schema";
import { ApiError, apiError, assertOrigin, rateLimit, readJson, requireSession } from "@/opspilot/server/security";

export const dynamic = "force-dynamic";

const assignable = z.enum(["administrator", "manager", "hr_manager", "accountant", "salesperson", "employee"]);

/**
 * Role change and member removal.
 *
 * Two invariants the software must hold even if an owner clicks carelessly:
 *  - a workspace always keeps at least one owner;
 *  - removing someone revokes their sessions in this workspace immediately, so an
 *    offboarded contractor cannot keep working from an open tab.
 */
async function guard(request: Request, requireJson = true) {
  assertOrigin(request, false, requireJson);
  const session = await requireSession();
  if (!["owner", "administrator"].includes(session.role)) {
    throw new ApiError(403, "Only workspace owners or administrators can manage members.");
  }
  await rateLimit(`members-manage:${session.workspace.id}`, 60);
  return session;
}

async function owners(workspaceId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.role, "owner")));
  return Number(row?.total ?? 0);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await guard(request);
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(400, "Invalid member identifier.");

    const parsed = z.object({ role: assignable }).strict().safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(400, "Choose one of the assignable roles.");

    const [target] = await db
      .select({ userId: memberships.userId, role: memberships.role, email: users.email, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.workspaceId, session.workspace.id), eq(memberships.userId, id)))
      .limit(1);
    if (!target) throw new ApiError(404, "That person is not a member of this workspace.");
    if (target.role === "owner") throw new ApiError(409, "The owner role cannot be changed here.");
    if (session.role === "administrator" && parsed.data.role === "administrator") {
      throw new ApiError(403, "Only an owner can appoint another administrator.");
    }

    await db.transaction(async (tx) => {
      await tx.update(memberships).set({ role: parsed.data.role })
        .where(and(eq(memberships.workspaceId, session.workspace.id), eq(memberships.userId, id)));
      // Permissions are read per request, but the session row carries the role pairing;
      // dropping it forces the next page load to re-read the new role.
      await tx.delete(sessions).where(and(eq(sessions.workspaceId, session.workspace.id), eq(sessions.userId, id)));
      await tx.insert(auditEvents).values({
        workspaceId: session.workspace.id,
        actor: session.user.name,
        action: "member.role_changed",
        subject: target.email,
        metadata: { from: target.role, to: parsed.data.role },
      });
    });

    return Response.json({ ok: true, userId: id, role: parsed.data.role });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await guard(request, false);
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(400, "Invalid member identifier.");
    if (id === session.user.id) {
      throw new ApiError(409, "Use account deletion in Settings to remove your own access.");
    }

    const [target] = await db
      .select({ role: memberships.role, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.workspaceId, session.workspace.id), eq(memberships.userId, id)))
      .limit(1);
    if (!target) throw new ApiError(404, "That person is not a member of this workspace.");
    if (target.role === "owner") throw new ApiError(409, "The workspace owner cannot be removed.");
    if ((await owners(session.workspace.id)) < 1) throw new ApiError(409, "A workspace must keep an owner.");

    await db.transaction(async (tx) => {
      await tx.delete(memberships)
        .where(and(eq(memberships.workspaceId, session.workspace.id), eq(memberships.userId, id)));
      await tx.delete(sessions).where(and(eq(sessions.workspaceId, session.workspace.id), eq(sessions.userId, id)));
      await tx.insert(auditEvents).values({
        workspaceId: session.workspace.id,
        actor: session.user.name,
        action: "member.removed",
        subject: target.email,
        metadata: { role: target.role },
      });
    });

    return Response.json({ ok: true, removed: id });
  } catch (error) {
    return apiError(error);
  }
}
