import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { records, stockMovements, payments, auditEvents } from "@/db/schema";
import { apiError, ApiError, assertOrigin, requireSession, readJson, rateLimit } from "@/opspilot/server/security";
import { canAccess } from "@/opspilot/lib/domain";
import type { RecordKind } from "@/opspilot/lib/types";
import { updateRecord } from "@/opspilot/server/repository";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertOrigin(request); const session = await requireSession(); await rateLimit(`write:${session.user.id}`, 120); return Response.json(await updateRecord(session, (await context.params).id, await readJson(request))); }
  catch (e) { return apiError(e); }
}
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(); const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(400, "Invalid identifier.");
    const [record] = await db.select().from(records).where(and(eq(records.workspaceId, session.workspace.id), eq(records.id, id))).limit(1);
    if (!record) throw new ApiError(404, "Record not found.");
    if (!canAccess(session.role, record.kind as RecordKind)) throw new ApiError(403, "You do not have access to this record.");
    const [movements, paymentHistory, activity] = await Promise.all([
      record.kind === "products" ? db.select().from(stockMovements).where(and(eq(stockMovements.workspaceId, session.workspace.id), eq(stockMovements.recordId, id))).orderBy(desc(stockMovements.createdAt)) : Promise.resolve([]),
      record.kind === "invoices" ? db.select().from(payments).where(and(eq(payments.workspaceId, session.workspace.id), eq(payments.recordId, id))).orderBy(desc(payments.createdAt)) : Promise.resolve([]),
      db.select().from(auditEvents).where(eq(auditEvents.workspaceId, session.workspace.id)).orderBy(desc(auditEvents.createdAt)).limit(200),
    ]);
    return Response.json({ record, movements, payments: paymentHistory, activity: activity.filter(e => e.metadata.recordId === id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return apiError(e); }
}
