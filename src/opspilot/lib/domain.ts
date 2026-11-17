import { z } from "zod";
import { kinds, statuses, type RecordKind, type Role, type BusinessRecord } from "./types";

const access: Record<Role, RecordKind[]> = {
  owner: [...kinds], administrator: [...kinds], manager: ["customers", "leads", "projects", "tasks", "products", "vendors", "documents", "workflows"],
  hr_manager: ["employees", "tasks", "documents"], accountant: ["customers", "invoices", "expenses", "vendors", "documents"],
  salesperson: ["customers", "leads", "invoices", "tasks", "documents"], employee: ["projects", "tasks"],
};
export function allowedKinds(role: Role): RecordKind[] { return access[role] ?? []; }
export function canAccess(role: Role, kind: RecordKind): boolean { return allowedKinds(role).includes(kind); }
export function moneyToCents(input: string): number {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(input.trim())) throw new Error("Enter a positive amount with no more than two decimal places.");
  const [whole, fraction = ""] = input.trim().split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (result > 1_000_000_000) throw new Error("Amount exceeds the supported limit.");
  return result;
}
export function invoiceTotal(lines: { quantity: number; unitCents: number }[], taxBps = 0, discountCents = 0) {
  if (!lines.length || lines.some(l => !Number.isSafeInteger(l.quantity) || l.quantity < 1 || !Number.isSafeInteger(l.unitCents) || l.unitCents < 0)) throw new Error("Invalid invoice lines.");
  if (!Number.isInteger(taxBps) || taxBps < 0 || taxBps > 10000 || !Number.isSafeInteger(discountCents) || discountCents < 0) throw new Error("Invalid tax or discount.");
  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitCents, 0);
  if (discountCents > subtotal) throw new Error("Discount cannot exceed subtotal.");
  const taxable = subtotal - discountCents;
  const total = taxable + Math.floor((taxable * taxBps + 5000) / 10000);
  if (!Number.isSafeInteger(total) || total > 1_000_000_000) throw new Error("Invoice exceeds the supported limit.");
  return total;
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const d = new Date(s); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }, "Invalid date").nullable().optional();
export const createRecordSchema = z.object({
  kind: z.enum(kinds), name: z.string().trim().min(2).max(180), subtitle: z.string().trim().max(250).default(""),
  status: z.string().max(40).optional(), category: z.string().trim().max(80).default(""),
  email: z.union([z.email(), z.literal("")]).default(""), owner: z.string().trim().max(120).default(""),
  amount: z.string().default("0").refine(v => { try { moneyToCents(v); return true; } catch { return false; } }, "Invalid amount"),
  quantity: z.coerce.number().int().min(0).max(1000000).default(0), dueDate: date,
  details: z.object({ notes: z.string().max(3000).optional(), priority: z.enum(["Low", "Medium", "High"]).optional(),
    reorderPoint: z.coerce.number().int().min(0).max(100000).optional(), trigger: z.enum(["lead.created", "invoice.created", "stock.low", "task.created"]).optional(),
    action: z.literal("notification").optional(), description: z.string().max(1000).optional(),
    lines: z.array(z.object({ description: z.string().min(1).max(180), quantity: z.number().int().min(1).max(100000), unitCents: z.number().int().min(0).max(1000000000) })).max(100).optional(),
    taxBps: z.number().int().min(0).max(10000).optional(), discountCents: z.number().int().min(0).max(1000000000).optional(),
  }).default({}),
}).strict().superRefine((v, ctx) => {
  if (v.status && !statuses[v.kind].includes(v.status)) ctx.addIssue({ code: "custom", path: ["status"], message: "Invalid status for this module." });
  if (v.kind === "workflows" && v.status === "Active") ctx.addIssue({ code: "custom", path: ["status"], message: "New workflows must be reviewed before activation." });
});
export const authSchema = z.object({ email: z.email().max(254).transform(v => v.toLowerCase().trim()), password: z.string().min(10).max(128), name: z.string().trim().min(2).max(120).optional(), workspace: z.string().trim().min(2).max(120).optional() });
export function csvEscape(value: unknown): string { let v = String(value ?? ""); if (/^[\s]*[=+\-@\t\r]/.test(v)) v = "'" + v; return `"${v.replaceAll('"', '""')}"`; }
export function summarize(records: BusinessRecord[], month = new Date().getMonth(), year = new Date().getFullYear()) {
  const inMonth = (r: BusinessRecord, m: number, y: number) => { const d = new Date(r.createdAt); return d.getMonth() === m && d.getFullYear() === y; };
  const calculate = (m: number, y: number) => {
    const list = records.filter(r => inMonth(r, m, y));
    const revenue = records.filter(r => r.kind === "invoices").reduce((sum, r) => sum + (r.payments ?? []).filter(p => { const d = new Date(p.createdAt); return d.getMonth() === m && d.getFullYear() === y; }).reduce((a, p) => a + p.amountCents, 0), 0);
    const expenses = list.filter(r => r.kind === "expenses").reduce((a, r) => a + r.amountCents, 0);
    return { revenue, expenses, profit: revenue - expenses };
  };
  const current = calculate(month, year); const previousDate = new Date(year, month - 1, 1); const previous = calculate(previousDate.getMonth(), previousDate.getFullYear());
  const trend = (a: number, b: number) => b ? ((a - b) / b) * 100 : null;
  const unpaid = records.filter(r => r.kind === "invoices" && (r.paidCents ?? 0) < r.amountCents);
  return { ...current, outstanding: unpaid.reduce((a, r) => a + r.amountCents - (r.paidCents ?? 0), 0), unpaidCount: unpaid.length,
    revenueTrend: trend(current.revenue, previous.revenue), expenseTrend: trend(current.expenses, previous.expenses), profitTrend: trend(current.profit, previous.profit),
    customers: records.filter(r => r.kind === "customers" && r.status === "Active").length,
    pendingTasks: records.filter(r => r.kind === "tasks" && r.status !== "Done").length,
    lowStock: records.filter(r => r.kind === "products" && r.quantity <= Number(r.details.reorderPoint ?? 10)).length,
    projects: records.filter(r => r.kind === "projects" && r.status === "In progress").length,
    employees: records.filter(r => r.kind === "employees" && r.status === "Active").length,
  };
}
