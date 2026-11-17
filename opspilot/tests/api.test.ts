import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { workspaces, users, memberships, records, payments, stockMovements, files } from "../../src/db/schema";
import { rateLimit, ApiError } from "../../src/opspilot/server/security";
import type { BusinessRecord, WorkspaceData } from "../../src/opspilot/lib/types";
const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const password = "A-good-test-password-2026!";
type Client = { cookie: string; email: string; workspaceId?: string; userId?: string };
const a: Client = { cookie: "", email: `review-a-${randomUUID()}@example.com` }; const b: Client = { cookie: "", email: `review-b-${randomUUID()}@example.com` };
async function request(client: Client | null, path: string, method = "GET", body?: unknown, origin: string | null = new URL(base).origin) {
  const headers: Record<string, string> = {}; if (client?.cookie) headers.Cookie = client.cookie; if (origin) headers.Origin = origin;
  const form = body instanceof FormData; if (!form) headers["Content-Type"] = "application/json";
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  if (client) for (const cookie of response.headers.getSetCookie()) if (cookie.startsWith("opspilot_session=")) client.cookie = cookie.split(";")[0];
  return response;
}
async function load(client: Client) { const res = await request(client, "/api/workspace"); assert.equal(res.status, 200); return await res.json() as WorkspaceData; }
async function create(client: Client, kind: string, name: string, extra: Record<string, unknown> = {}) { const res = await request(client, "/api/records", "POST", { kind, name, ...extra }); assert.equal(res.status, 201, await res.clone().text()); return await res.json() as BusinessRecord; }
const demoClient: Client = { cookie: "", email: "" };
let customer: BusinessRecord; let invoice: BusinessRecord; let product: BusinessRecord;
describe("production API and PostgreSQL regression suite", () => {
  before(async () => {
    for (const client of [a, b]) {
      const res = await request(client, "/api/session/register", "POST", { email: client.email, password, name: "Review Test", workspace: `Review tests ${randomUUID()}` });
      assert.equal(res.status, 201, await res.clone().text()); assert.ok(res.headers.get("set-cookie")?.toLowerCase().includes("httponly"));
      const data = await load(client); client.workspaceId = data.workspace.id; client.userId = data.user.id;
    }
    customer = await create(a, "customers", "Private customer A", { email: "private@example.com" });
    invoice = await create(a, "invoices", "REVIEW-INVOICE", { subtitle: customer.name, amount: "100.00", dueDate: "2026-01-01" });
    product = await create(a, "products", "Review product", { amount: "19.99", quantity: 3, details: { reorderPoint: 5 } });
  });
  after(async () => {
    const ids = [a.workspaceId, b.workspaceId, demoClient.workspaceId].filter(Boolean) as string[];
    if (ids.length) await db.transaction(async tx => {
      await tx.delete(files).where(inArray(files.workspaceId, ids)); await tx.delete(payments).where(inArray(payments.workspaceId, ids)); await tx.delete(stockMovements).where(inArray(stockMovements.workspaceId, ids)); await tx.delete(workspaces).where(inArray(workspaces.id, ids));
      await tx.delete(users).where(inArray(users.email, [a.email, b.email, demoClient.email]));
    });
    await pool.end();
  });
  it("creates an isolated demo without exposing password hashes", async () => {
    const res = await request(demoClient, "/api/session/demo", "POST", {}); assert.equal(res.status, 200);
    const data = await res.json() as WorkspaceData; demoClient.workspaceId = data.workspace.id; demoClient.userId = data.user.id; demoClient.email = data.user.email;
    assert.equal(data.workspace.isDemo, true); assert.equal("passwordHash" in data.user, false); assert.notEqual(data.workspace.id, a.workspaceId); assert.ok(data.records.length > 50);
  });
  it("health check verifies the database", async () => { const res = await request(null, "/api/health"); assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true }); });
  it("requires authentication and never returns password hashes", async () => { assert.equal((await request(null, "/api/workspace")).status, 401); const data = await load(a); assert.equal("passwordHash" in data.user, false); assert.equal(data.workspace.isDemo, false); });
  it("isolates workspace lists and rejects direct cross-tenant reads and writes", async () => { const other = await load(b); assert.equal(other.records.some(r => r.id === customer.id), false); assert.equal((await request(b, `/api/records/${customer.id}`)).status, 404); assert.equal((await request(b, `/api/records/${customer.id}`, "PATCH", { action: "status", status: "Inactive" })).status, 404); });
  it("rejects injected tenant selectors and unknown fields", async () => { assert.equal((await request(a, "/api/records", "POST", { kind: "customers", name: "Injected", workspaceId: b.workspaceId })).status, 400); });
  it("enforces tenant integrity in database foreign keys", async () => { await assert.rejects(db.insert(payments).values({ workspaceId: b.workspaceId!, recordId: invoice.id, amountCents: 100 })); });
  it("rejects cross-origin and missing-origin writes", async () => { const body = { kind: "customers", name: "Cross origin" }; assert.equal((await request(a, "/api/records", "POST", body, "https://evil.example")).status, 403); assert.equal((await request(a, "/api/records", "POST", body, null)).status, 403); assert.equal((await request(a, "/api/records", "POST", body, "null")).status, 403); });
  it("requires an invoice customer from the same workspace", async () => { assert.equal((await request(b, "/api/records", "POST", { kind: "invoices", name: "Cross-tenant invoice", subtitle: customer.name, amount: "100.00" })).status, 400); });
  it("records partial payments once when a request is retried", async () => { const payload = { action: "payment", amount: "30.00", requestId: randomUUID() }; assert.equal((await request(a, `/api/records/${invoice.id}`, "PATCH", payload)).status, 200); assert.equal((await request(a, `/api/records/${invoice.id}`, "PATCH", payload)).status, 200); const data = await load(a); assert.equal(data.records.find(r => r.id === invoice.id)?.paidCents, 3000); });
  it("serializes concurrent payments and prevents overpayment", async () => { const responses = await Promise.all([1, 2].map(() => request(a, `/api/records/${invoice.id}`, "PATCH", { action: "payment", amount: "70.00", requestId: randomUUID() }))); assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]); const data = await load(a); assert.equal(data.records.find(r => r.id === invoice.id)?.paidCents, 10000); assert.equal(data.records.find(r => r.id === invoice.id)?.status, "Paid"); });
  it("does not allow financial history to be overwritten", async () => { assert.equal((await request(a, `/api/records/${invoice.id}`, "PATCH", { action: "status", status: "Unpaid" })).status, 400); const expense = await create(a, "expenses", "Review expense", { amount: "10.00", category: "Software" }); assert.equal((await request(a, `/api/records/${expense.id}`, "PATCH", { action: "status", status: "Recorded" })).status, 400); });
  it("rejects negative stock and preserves traced adjustments", async () => { assert.equal((await request(a, `/api/records/${product.id}`, "PATCH", { action: "stock", delta: -4, reason: "Would go negative" })).status, 400); assert.equal((await request(a, `/api/records/${product.id}`, "PATCH", { action: "stock", delta: 7, reason: "Supplier delivery" })).status, 200); const res = await request(a, `/api/records/${product.id}`); const detail = await res.json(); assert.equal(detail.record.quantity, 10); assert.equal(detail.movements.length, 2); assert.equal(detail.movements.reduce((s: number, m: { delta: number }) => s + m.delta, 0), 10); });
  it("executes approved workflows and logs successful runs", async () => { const workflow = await create(a, "workflows", "Notify on test lead", { details: { trigger: "lead.created", action: "notification" } }); assert.equal(workflow.status, "Draft"); assert.equal((await request(a, `/api/records/${workflow.id}`, "PATCH", { action: "status", status: "Active" })).status, 200); await create(a, "leads", "Automation test lead", { amount: "1500.00" }); const data = await load(a); assert.equal(data.records.find(r => r.id === workflow.id)?.details.runs, 1); assert.ok(data.notifications.some(n => n.title === workflow.name)); assert.ok(data.activities.some(e => e.action === "workflow.executed")); });
  it("supports projects, tasks, employee and vendor records", async () => { const project = await create(a, "projects", "Review project", { amount: "5000.00" }); const task = await create(a, "tasks", "Review task", { subtitle: project.name }); assert.equal((await request(a, `/api/records/${task.id}`, "PATCH", { action: "status", status: "Done" })).status, 200); await create(a, "employees", "Review employee", { category: "Design" }); await create(a, "vendors", "Review vendor", { category: "Services" }); const data = await load(a); assert.equal(data.records.find(r => r.id === task.id)?.status, "Done"); });
  it("uploads and downloads private documents without cross-tenant access", async () => { const form = new FormData(); form.append("file", new File(["Private review document"], "review.txt", { type: "text/plain" })); form.append("category", "Contracts"); const upload = await request(a, "/api/documents", "POST", form); assert.equal(upload.status, 201, await upload.clone().text()); const doc = await upload.json(); assert.equal((await request(b, `/api/documents/${doc.id}`)).status, 404); const download = await request(a, `/api/documents/${doc.id}`); assert.equal(download.status, 200); assert.match(download.headers.get("content-disposition") ?? "", /attachment/); assert.equal(await download.text(), "Private review document"); });
  it("rejects file content that does not match its extension", async () => { const form = new FormData(); form.append("file", new File(["<script>alert(1)</script>"], "malicious.pdf", { type: "application/pdf" })); assert.equal((await request(a, "/api/documents", "POST", form)).status, 400); });
  it("enforces role boundaries on records, settings, and AI retrieval", async () => {
    await db.update(memberships).set({ role: "employee" }).where(and(eq(memberships.workspaceId, b.workspaceId!), eq(memberships.userId, b.userId!)));
    try { const data = await load(b); assert.deepEqual(data.permissions, ["projects", "tasks"]); assert.equal((await request(b, "/api/records", "POST", { kind: "expenses", name: "Forbidden expense", amount: "1.00" })).status, 403); assert.equal((await request(b, "/api/workspace", "PATCH", { name: "Forbidden rename" })).status, 403); assert.equal((await request(b, "/api/intelligence", "POST", { question: "What is our revenue this month?" })).status, 403); }
    finally { await db.update(memberships).set({ role: "owner" }).where(and(eq(memberships.workspaceId, b.workspaceId!), eq(memberships.userId, b.userId!))); }
  });
  it("returns deterministic financial answers without changing data", async () => { const res = await request(a, "/api/intelligence", "POST", { question: "What is our revenue this month?" }); assert.equal(res.status, 200); const answer = await res.json(); assert.match(answer.answer, /Revenue received: \$100/); assert.match(answer.answer, /Recorded expenses: \$10/); assert.match(answer.provider, /insights/i); });
  it("persists dashboard configuration and notification read status", async () => { assert.equal((await request(a, "/api/workspace", "PATCH", { widgets: ["metrics", "charts"], name: "Review settings saved" })).status, 200); assert.equal((await request(a, "/api/notifications", "PATCH", { all: true })).status, 200); const data = await load(a); assert.deepEqual(data.workspace.settings.widgets, ["metrics", "charts"]); assert.ok(data.notifications.every(n => n.read)); });
  it("enforces a shared database-backed rate limit", async () => { const key = `test-limit:${randomUUID()}`; await rateLimit(key, 2); await rateLimit(key, 2); await assert.rejects(rateLimit(key, 2), (e: unknown) => e instanceof ApiError && e.status === 429); });
  it("authenticates valid credentials, rejects invalid ones, and revokes logout sessions", async () => { assert.equal((await request(b, "/api/session/logout", "POST", {})).status, 200); assert.equal((await request(b, "/api/workspace")).status, 401); assert.equal((await request(b, "/api/session/login", "POST", { email: b.email, password: "wrong-password-123" })).status, 401); assert.equal((await request(b, "/api/session/login", "POST", { email: b.email, password })).status, 200); assert.equal((await load(b)).workspace.id, b.workspaceId); });
});
