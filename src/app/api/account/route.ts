import { and, eq, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { emailTokens, memberships, sessions, users, workspaces } from "@/db/schema";
import {
  ApiError,
  apiError,
  assertOrigin,
  rateLimit,
  readJson,
  requireSession,
  verifyPassword,
} from "@/opspilot/server/security";
import { logInfo } from "@/opspilot/server/log";

export const dynamic = "force-dynamic";

const deletion = z.object({
  password: z.string().min(1).max(200),
  confirm: z.literal("DELETE"),
});

/**
 * Account deletion (GDPR Art. 17).
 *
 * Deliberately conservative:
 *  - the password is required again, so a hijacked session cannot erase an account;
 *  - the literal confirmation string prevents a stray request;
 *  - deleting a workspace cascades to its records, files, notifications, audit trail
 *    and subscription, and is only allowed when the person is the only member —
 *    otherwise a teammate's data would vanish without their consent.
 */
export async function DELETE(request: Request) {
  try {
    assertOrigin(request);
    const session = await requireSession();
    await rateLimit(`account-delete:${session.user.id}`, 5, 60 * 60 * 1000);

    const parsed = deletion.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new ApiError(400, 'Confirm deletion by sending {"password": "…", "confirm": "DELETE"}.');
    }

    const [account] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, session.user.id)).limit(1);
    if (!account) throw new ApiError(401, "Please sign in to continue.");
    if (!(await verifyPassword(parsed.data.password, account.passwordHash))) {
      throw new ApiError(403, "That password is not correct.");
    }

    const [ownerMembership] = await db
      .select({ workspaceId: memberships.workspaceId })
      .from(memberships)
      .where(and(eq(memberships.userId, session.user.id), eq(memberships.role, "owner")))
      .limit(1);

    let deletedWorkspaceId: string | null = null;
    if (ownerMembership) {
      const others = await db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, ownerMembership.workspaceId), ne(memberships.userId, session.user.id)))
        .limit(1);
      if (others.length > 0) {
        throw new ApiError(
          409,
          "You are the owner of a workspace with other members. Remove them or transfer ownership before deleting your account.",
        );
      }
      deletedWorkspaceId = ownerMembership.workspaceId;
    }

    await db.transaction(async (tx) => {
      if (deletedWorkspaceId) {
        // No audit row here: the audit trail is workspace-scoped and would cascade
        // away with the workspace it describes. The structured log line below is the
        // durable record of the erasure.
        await tx.delete(workspaces).where(eq(workspaces.id, deletedWorkspaceId));
      }
      await tx.delete(sessions).where(eq(sessions.userId, session.user.id));
      await tx.delete(emailTokens).where(or(eq(emailTokens.userId, session.user.id), eq(emailTokens.email, session.user.email)));
      await tx.delete(memberships).where(eq(memberships.userId, session.user.id));
      await tx.delete(users).where(eq(users.id, session.user.id));
    });

    logInfo("account.deleted", { userId: session.user.id, workspaceDeleted: Boolean(deletedWorkspaceId) });
    return Response.json({ ok: true, deletedWorkspace: Boolean(deletedWorkspaceId) });
  } catch (error) {
    return apiError(error);
  }
}
