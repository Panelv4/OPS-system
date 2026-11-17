import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { records, payments, auditEvents, notifications, stockMovements } from "@/db/schema";
import { allowedKinds, createRecordSchema, invoiceTotal, moneyToCents } from "../lib/domain";
import { kindViews, statuses, type RecordKind } from "../lib/types";
import { ApiError, type Session } from "./security";
import { z } from "zod";

export async function loadWorkspace(session: Session) {
  const permissions = allowedKinds(session.role);
  const where = and(eq(records.workspaceId, session.workspace.id), inArray(records.kind, permissions));
  const [items, paymentRows, events, notices] = await Promise.all([
    db.select().from(records).where(where).orderBy(desc(records.createdAt)),
    permissions.includes("invoices") ? db.select().from(payments).where(eq(payments.workspaceId, session.workspace.id)) : Promise.resolve([]),
    db.select().from(auditEvents).where(eq(auditEvents.workspaceId, session.workspace.id)).orderBy(desc(auditEvents.createdAt)).limit(40),
    db.select().from(notifications).where(eq(notifications.workspaceId, session.workspace.id)).orderBy(desc(notifications.createdAt)).limit(60),
  ]);
  const views = new Set(permissions.map(k => kindViews[k]));
  return { workspace: { id: session.workspace.id, name: session.workspace.name, isDemo: session.workspace.isDemo, settings: session.workspace.settings },
    user: { id: session.user.id, name: session.user.name, email: session.user.email, role: session.role }, permissions,
    records: items.map(({ workspaceId: _workspaceId, ...r }) => {
      if (r.kind !== "invoices") return r;
      const history = paymentRows.filter(p => p.recordId === r.id).map(p => ({ amountCents: p.amountCents, createdAt: p.createdAt }));
      const paidCents = history.reduce((a, p) => a + p.amountCents, 0);
      const status = paidCents >= r.amountCents ? "Paid" : r.dueDate && r.dueDate < new Date().toISOString().slice(0, 10) ? "Overdue" : paidCents > 0 ? "Partial" : "Unpaid";
      return { ...r, status, paidCents, payments: history };
    }),
    activities: events.filter(e => permissions.includes(e.metadata.kind as RecordKind) || (["owner", "administrator"].includes(session.role) && e.action.startsWith("workspace."))),
    notifications: notices.filter(n => n.module === "overview" || views.has(n.module as typeof kindViews[RecordKind])),
  };
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function runWorkflows(tx: Transaction, session: Session, trigger: string, subject: string) {
  const workflows = await tx.select().from(records).where(and(eq(records.workspaceId, session.workspace.id), eq(records.kind, "workflows"), eq(records.status, "Active")));
  for (const workflow of workflows.filter(w => w.details.trigger === trigger)) {
    await tx.insert(notifications).values({ workspaceId: session.workspace.id, title: workflow.name, message: `${subject} triggered this workflow. Review the related record to take the next step.`, module: trigger.startsWith("lead") ? "crm" : trigger.startsWith("stock") ? "inventory" : trigger.startsWith("invoice") ? "sales" : "projects" });
    await tx.update(records).set({ details: sql`jsonb_set(${records.details}, '{runs}', to_jsonb(COALESCE((${records.details}->>'runs')::integer, 0) + 1))` }).where(and(eq(records.id, workflow.id), eq(records.workspaceId, session.workspace.id)));
    await tx.insert(auditEvents).values({ workspaceId: session.workspace.id, actor: "OpsPilot Automations", action: "workflow.executed", subject: workflow.name, metadata: { kind: "workflows", trigger, record: subject, result: "success" } });
  }
}
export async function createRecord(session: Session, body: unknown) {
  const parsed = createRecordSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const input = parsed.data;
  if (!allowedKinds(session.role).includes(input.kind)) throw new ApiError(403, "You do not have permission to create this record.");
  if (input.kind === "documents") throw new ApiError(400, "Use the document upload endpoint.");
  const { amount, details, ...values } = input;
  let amountCents = moneyToCents(amount);
  if (input.kind === "invoices") {
    const [customer] = await db.select({ id: records.id }).from(records).where(and(eq(records.workspaceId, session.workspace.id), eq(records.kind, "customers"), eq(records.name, input.subtitle))).limit(1);
    if (!customer) throw new ApiError(400, "Choose an existing customer from your workspace.");
    try { amountCents = invoiceTotal(details.lines?.length ? details.lines : [{ quantity: 1, unitCents: amountCents }], details.taxBps ?? 0, details.discountCents ?? 0); }
    catch (e) { throw new ApiError(400, e instanceof Error ? e.message : "Invalid invoice"); }
    if (amountCents === 0) throw new ApiError(400, "An invoice must have a positive total.");
  }
  if (input.kind === "expenses" && amountCents === 0) throw new ApiError(400, "An expense must have a positive amount.");
  return db.transaction(async tx => {
    const [record] = await tx.insert(records).values({ ...values, amountCents, details, workspaceId: session.workspace.id,
      status: input.kind === "invoices" ? "Unpaid" : input.kind === "expenses" ? "Recorded" : input.kind === "workflows" ? "Draft" : input.status ?? statuses[input.kind][0],
    }).returning();
    if (input.kind === "products" && input.quantity > 0) await tx.insert(stockMovements).values({ workspaceId: session.workspace.id, recordId: record.id, delta: input.quantity, reason: "Opening stock" });
    await tx.insert(auditEvents).values({ workspaceId: session.workspace.id, actor: session.user.name, action: `${input.kind.replace(/s$/, "")}.created`, subject: record.name, metadata: { kind: input.kind, recordId: record.id, amountCents } });
    const trigger = input.kind === "leads" ? "lead.created" : input.kind === "invoices" ? "invoice.created" : input.kind === "tasks" ? "task.created" : input.kind === "products" && input.quantity <= Number(details.reorderPoint ?? 10) ? "stock.low" : "";
    if (trigger) await runWorkflows(tx, session, trigger, record.name);
    return record;
  });
}
const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), status: z.string().max(40) }).strict(),
  z.object({ action: z.literal("payment"), amount: z.string(), requestId: z.uuid() }).strict(),
  z.object({ action: z.literal("stock"), delta: z.number().int().min(-1000000).max(1000000).refine(n => n !== 0), reason: z.string().trim().min(3).max(500) }).strict(),
]);
export async function updateRecord(session: Session, id: string, body: unknown) {
  if (!z.uuid().safeParse(id).success) throw new ApiError(400, "Invalid record identifier.");
  const parsed = updateSchema.safeParse(body); if (!parsed.success) throw new ApiError(400, "Invalid update. Check the entered values.");
  const input = parsed.data;
  return db.transaction(async tx => {
    const [record] = await tx.select().from(records).where(and(eq(records.workspaceId, session.workspace.id), eq(records.id, id))).for("update").limit(1);
    if (!record) throw new ApiError(404, "Record not found.");
    if (!allowedKinds(session.role).includes(record.kind as RecordKind)) throw new ApiError(403, "You do not have permission to update this record.");
    let event = "updated"; const metadata: Record<string, unknown> = { kind: record.kind, recordId: id };
    if (input.action === "status") {
      if (["invoices", "expenses", "documents"].includes(record.kind)) throw new ApiError(400, "Financial history cannot be overwritten. Record a payment instead.");
      if (!statuses[record.kind as RecordKind].includes(input.status)) throw new ApiError(400, "Invalid status.");
      if (record.kind === "workflows" && input.status === "Active" && (!record.details.trigger || record.details.action !== "notification")) throw new ApiError(400, "This workflow needs a supported trigger and action before activation.");
      await tx.update(records).set({ status: input.status }).where(and(eq(records.workspaceId, session.workspace.id), eq(records.id, id)));
      event = input.status === "Done" ? "completed" : "updated"; metadata.before = record.status; metadata.after = input.status;
    } else if (input.action === "payment") {
      if (record.kind !== "invoices") throw new ApiError(400, "Payments can only be recorded against invoices.");
      let amountCents: number; try { amountCents = moneyToCents(input.amount); } catch { throw new ApiError(400, "Enter a valid payment amount."); }
      const [priorRequest] = await tx.select().from(payments).where(and(eq(payments.workspaceId, session.workspace.id), eq(payments.id, input.requestId))).limit(1);
      if (priorRequest) {
        if (priorRequest.recordId !== id || priorRequest.amountCents !== amountCents) throw new ApiError(409, "This payment reference has already been used for a different payment.");
        return { ok: true, idempotent: true };
      }
      const existing = await tx.select().from(payments).where(and(eq(payments.workspaceId, session.workspace.id), eq(payments.recordId, id)));
      const paid = existing.reduce((sum, p) => sum + p.amountCents, 0);
      if (amountCents <= 0 || paid + amountCents > record.amountCents) throw new ApiError(400, "Payment must be positive and cannot exceed the outstanding balance.");
      await tx.insert(payments).values({ id: input.requestId, workspaceId: session.workspace.id, recordId: id, amountCents });
      await tx.update(records).set({ status: paid + amountCents === record.amountCents ? "Paid" : "Partial" }).where(and(eq(records.workspaceId, session.workspace.id), eq(records.id, id)));
      event = "payment.received"; metadata.amountCents = amountCents;
    } else {
      if (record.kind !== "products") throw new ApiError(400, "Stock adjustments are only available for products.");
      const quantity = record.quantity + input.delta;
      if (quantity < 0 || quantity > 1000000) throw new ApiError(400, "Stock cannot be negative or exceed one million units.");
      await tx.update(records).set({ quantity }).where(and(eq(records.workspaceId, session.workspace.id), eq(records.id, id)));
      await tx.insert(stockMovements).values({ workspaceId: session.workspace.id, recordId: id, delta: input.delta, reason: input.reason });
      event = "stock.adjusted"; metadata.delta = input.delta; metadata.reason = input.reason;
      if (quantity <= Number(record.details.reorderPoint ?? 10)) await runWorkflows(tx, session, "stock.low", record.name);
    }
    await tx.insert(auditEvents).values({ workspaceId: session.workspace.id, actor: session.user.name, action: event.includes(".") ? event : `${record.kind.replace(/s$/, "")}.${event}`, subject: record.name, metadata });
    return { ok: true };
  });
}
