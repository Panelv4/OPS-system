import { z } from "zod";
import { db } from "@/db";
import { auditEvents, workspaces } from "@/db/schema";
import { eq } from "drizzle-orm";
import { apiError, ApiError, assertOrigin, requireSession, readJson } from "@/opspilot/server/security";
import { loadWorkspace } from "@/opspilot/server/repository";
export const dynamic = "force-dynamic";
export async function GET() { try { return Response.json(await loadWorkspace(await requireSession()), { headers: { "Cache-Control": "private, no-store" } }); } catch (e) { return apiError(e); } }
const preferences = z.object({ name: z.string().trim().min(2).max(120).optional(), widgets: z.array(z.enum(["insights", "metrics", "charts", "quickActions", "tasks", "activity"])).max(6).optional() }).strict();
export async function PATCH(request: Request) {
  try {
    assertOrigin(request); const session = await requireSession();
    if (!["owner", "administrator"].includes(session.role)) throw new ApiError(403, "Only workspace administrators can change these settings.");
    const parsed = preferences.safeParse(await readJson(request)); if (!parsed.success) throw new ApiError(400, "Invalid workspace settings.");
    await db.transaction(async tx => {
      await tx.update(workspaces).set({ ...(parsed.data.name ? { name: parsed.data.name } : {}), settings: { ...session.workspace.settings, ...(parsed.data.widgets ? { widgets: parsed.data.widgets } : {}) } }).where(eq(workspaces.id, session.workspace.id));
      await tx.insert(auditEvents).values({ workspaceId: session.workspace.id, actor: session.user.name, action: "workspace.updated", subject: "Workspace settings", metadata: parsed.data });
    });
    return Response.json({ ok: true });
  } catch (e) { return apiError(e); }
}
