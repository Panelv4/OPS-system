import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { apiError, ApiError, assertOrigin, requireSession, readJson } from "@/opspilot/server/security";
export async function PATCH(request: Request) {
  try { assertOrigin(request); const session = await requireSession(); const parsed = z.object({ id: z.uuid().optional(), all: z.boolean().optional() }).strict().safeParse(await readJson(request));
    if (!parsed.success || (!parsed.data.id && !parsed.data.all)) throw new ApiError(400, "Select a notification.");
    await db.update(notifications).set({ read: true }).where(parsed.data.all ? eq(notifications.workspaceId, session.workspace.id) : and(eq(notifications.workspaceId, session.workspace.id), eq(notifications.id, parsed.data.id!)));
    return Response.json({ ok: true });
  } catch (e) { return apiError(e); }
}
