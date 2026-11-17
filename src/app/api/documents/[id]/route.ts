import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { files, auditEvents } from "@/db/schema";
import { ApiError, apiError, requireSession } from "@/opspilot/server/security";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession("documents"); const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(400, "Invalid document identifier.");
    const [file] = await db.select().from(files).where(and(eq(files.workspaceId, session.workspace.id), eq(files.recordId, id))).limit(1);
    if (!file) throw new ApiError(404, "Document not found.");
    await db.insert(auditEvents).values({ workspaceId: session.workspace.id, actor: session.user.name, action: "document.downloaded", subject: file.filename, metadata: { kind: "documents", recordId: id } });
    return new Response(Buffer.from(file.content, "base64"), { headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  } catch (e) { return apiError(e); }
}
