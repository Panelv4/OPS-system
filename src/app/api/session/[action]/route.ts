import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, workspaces, memberships, auditEvents } from "@/db/schema";
import { authSchema } from "@/opspilot/lib/domain";
import { ApiError, apiError, assertOrigin, clientIp, createSession, getSession, hashPassword, logout, pruneExpiredData, rateLimit, readJson, verifyPassword } from "@/opspilot/server/security";
import { config, rateLimitKey } from "@/opspilot/server/config";
import { createDemoWorkspace } from "@/opspilot/server/seed";
import { loadWorkspace } from "@/opspilot/server/repository";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    assertOrigin(request);
    const { action } = await context.params;
    const { trustProxy } = config();
    const ip = clientIp(request);
    // Per-address limiting only means something when a trusted proxy supplies the
    // address; otherwise the per-account limits below are the real protection.
    if (trustProxy) await rateLimit(rateLimitKey("auth", ip, true), 40);
    if (action === "logout") { await logout(); return Response.json({ ok: true }); }
    if (action === "demo") {
      const current = await getSession();
      if (current) return Response.json(await loadWorkspace(current));
      // Demo workspaces are disposable but cost storage, so the cap applies even
      // when the client address cannot be trusted.
      await rateLimit(rateLimitKey("demo", ip, trustProxy), trustProxy ? 15 : 120, 60 * 60 * 1000);
      const session = await createDemoWorkspace();
      await createSession(session.user.id, session.workspace.id);
      await pruneExpiredData();
      return Response.json(await loadWorkspace(session));
    }
    if (action !== "login" && action !== "register") throw new ApiError(404, "Unknown authentication action.");
    const parsed = authSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(400, "Enter a valid email and a password of 10–128 characters.");
    const { email, password, name, workspace } = parsed.data;
    await rateLimit(`login:${email}`, 15);
    if (action === "register") {
      if (!name || !workspace) throw new ApiError(400, "Your name and workspace name are required.");
      // Hashing happens before the lookup so a duplicate-email response takes the
      // same time as a successful registration (no timing oracle for enumeration).
      const passwordHash = await hashPassword(password);
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing) throw new ApiError(409, "Unable to create an account with these details. Try signing in.");
      const result = await db.transaction(async tx => {
        const [user] = await tx.insert(users).values({ email, name, passwordHash }).returning();
        const [ws] = await tx.insert(workspaces).values({ name: workspace, settings: { currency: "USD" } }).returning();
        await tx.insert(memberships).values({ workspaceId: ws.id, userId: user.id, role: "owner" });
        await tx.insert(auditEvents).values({ workspaceId: ws.id, actor: name, action: "workspace.created", subject: workspace });
        return { user, ws };
      });
      await logout(); await createSession(result.user.id, result.ws.id);
      await pruneExpiredData();
      return Response.json({ ok: true }, { status: 201 });
    }
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const dummyHash = "00000000000000000000000000000000:" + "00".repeat(64);
    const valid = await verifyPassword(password, user?.passwordHash ?? dummyHash);
    if (!user || !valid) throw new ApiError(401, "Email or password is incorrect.");
    const [membership] = await db.select().from(memberships).where(and(eq(memberships.userId, user.id))).limit(1);
    if (!membership) throw new ApiError(403, "No active workspace membership.");
    await logout(); await createSession(user.id, membership.workspaceId);
    await db.insert(auditEvents).values({ workspaceId: membership.workspaceId, actor: user.name, action: "workspace.login", subject: "Successful sign-in" });
    await pruneExpiredData();
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
