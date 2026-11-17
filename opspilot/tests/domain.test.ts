import "dotenv/config";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { allowedKinds, canAccess, createRecordSchema, csvEscape, invoiceTotal, moneyToCents, summarize } from "../../src/opspilot/lib/domain";
import { kinds, type BusinessRecord } from "../../src/opspilot/lib/types";
import { MAX_UPLOAD_BYTES, validateUpload } from "../../src/opspilot/lib/uploads";
import { hashPassword, verifyPassword } from "../../src/opspilot/server/security";
import { pool } from "../../src/db";
after(async () => { await pool.end(); });
const record = (input: Partial<BusinessRecord>): BusinessRecord => ({ id: "00000000-0000-4000-8000-000000000001", kind: "invoices", name: "Test", subtitle: "", status: "Unpaid", category: "", email: "", owner: "", amountCents: 10000, quantity: 0, dueDate: null, details: {}, createdAt: "2026-01-01T12:00:00Z", ...input });
describe("deterministic financial calculations", () => {
  it("parses whole amounts and decimal cents exactly", () => { assert.equal(moneyToCents("123.45"), 12345); assert.equal(moneyToCents("0.10"), 10); assert.equal(moneyToCents("11.1"), 1110); });
  it("rejects precision loss, signs, scientific notation, and oversized amounts", () => { for (const s of ["-1", "+1", "1e3", "1.005", "NaN", "1,000", "10000000"]) assert.throws(() => moneyToCents(s)); });
  it("calculates line totals with discounts and basis-point taxes", () => { assert.equal(invoiceTotal([{ quantity: 2, unitCents: 125000 }], 1000, 5000), 269500); });
  it("rounds tax to the nearest cent deterministically", () => { assert.equal(invoiceTotal([{ quantity: 1, unitCents: 5 }], 1000), 6); });
  it("rejects invalid quantities, tax rates, discounts, and financial overflow", () => { assert.throws(() => invoiceTotal([{ quantity: 1.5, unitCents: 100 }])); assert.throws(() => invoiceTotal([{ quantity: 1, unitCents: 100 }], 0, 101)); assert.throws(() => invoiceTotal([{ quantity: 1, unitCents: 100 }], -1)); assert.throws(() => invoiceTotal([{ quantity: 100000, unitCents: 1000000000 }])); });
  it("attributes revenue to payment dates, not invoice creation dates", () => { const s = summarize([record({ paidCents: 10000, payments: [{ amountCents: 10000, createdAt: "2026-06-15T12:00:00Z" }] })], 5, 2026); assert.equal(s.revenue, 10000); assert.equal(summarize([record({ paidCents: 10000, payments: [{ amountCents: 10000, createdAt: "2026-06-15T12:00:00Z" }] })], 0, 2026).revenue, 0); });
  it("calculates partial outstanding balances and period expenses", () => { const s = summarize([record({ paidCents: 3000, payments: [] }), record({ kind: "expenses", amountCents: 2500, createdAt: "2026-06-11T12:00:00Z" })], 5, 2026); assert.equal(s.outstanding, 7000); assert.equal(s.expenses, 2500); assert.equal(s.profit, -2500); });
});
describe("role-based permission boundaries", () => {
  it("gives owners access to all supported modules", () => assert.deepEqual(allowedKinds("owner"), [...kinds]));
  it("denies financial, document, and employee records to employees", () => { for (const kind of ["expenses", "invoices", "employees", "documents"] as const) assert.equal(canAccess("employee", kind), false); });
  it("separates HR and accounting permissions", () => { assert.equal(canAccess("hr_manager", "employees"), true); assert.equal(canAccess("hr_manager", "expenses"), false); assert.equal(canAccess("accountant", "employees"), false); assert.equal(canAccess("accountant", "expenses"), true); });
  it("supports employee task collaboration", () => { assert.equal(canAccess("employee", "tasks"), true); assert.equal(canAccess("employee", "projects"), true); });
});
describe("record input validation", () => {
  it("rejects client-supplied tenant identifiers", () => { assert.equal(createRecordSchema.safeParse({ kind: "customers", name: "A valid customer", workspaceId: "another-tenant" }).success, false); });
  it("rejects nonexistent dates", () => { assert.equal(createRecordSchema.safeParse({ kind: "tasks", name: "Task", dueDate: "2026-02-30" }).success, false); });
  it("rejects statuses from unrelated modules", () => { assert.equal(createRecordSchema.safeParse({ kind: "customers", name: "Customer", status: "Paid" }).success, false); });
  it("requires workflows to be saved as drafts before activation", () => { assert.equal(createRecordSchema.safeParse({ kind: "workflows", name: "Workflow", status: "Active" }).success, false); });
  it("rejects unknown record kinds and excessive names", () => { assert.equal(createRecordSchema.safeParse({ kind: "users", name: "Admin" }).success, false); assert.equal(createRecordSchema.safeParse({ kind: "customers", name: "x".repeat(181) }).success, false); });
  it("accepts a valid task and applies defaults", () => { const parsed = createRecordSchema.parse({ kind: "tasks", name: "Ship the release", dueDate: "2026-06-30" }); assert.equal(parsed.amount, "0"); assert.deepEqual(parsed.details, {}); });
});
describe("safe exports and document validation", () => {
  it("neutralizes spreadsheet formula injection and quotes CSV values", () => { assert.equal(csvEscape("=SUM(A1:A2)"), '"\'=SUM(A1:A2)"'); assert.equal(csvEscape('A "quote"'), '"A ""quote"""'); });
  it("validates PNG and PDF magic bytes", () => { assert.equal(validateUpload(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "test.png"), "image/png"); assert.equal(validateUpload(new TextEncoder().encode("%PDF-1.7\n"), "test.pdf"), "application/pdf"); });
  it("rejects spoofed file extensions", () => { assert.throws(() => validateUpload(new TextEncoder().encode("<script>alert(1)</script>"), "fake.pdf")); assert.throws(() => validateUpload(new TextEncoder().encode("hello"), "fake.html")); });
  it("enforces nonempty files, size limits, and valid UTF-8 text", () => { assert.throws(() => validateUpload(new Uint8Array(), "test.txt")); assert.throws(() => validateUpload(new Uint8Array(MAX_UPLOAD_BYTES + 1), "test.txt")); assert.throws(() => validateUpload(new Uint8Array([255, 254, 0]), "test.txt")); assert.equal(validateUpload(new TextEncoder().encode("Hello workspace"), "test.txt"), "text/plain"); });
});
describe("password hashing", () => {
  it("uses distinct salts and never stores plaintext", async () => { const a = await hashPassword("a-secure-test-password"); const b = await hashPassword("a-secure-test-password"); assert.notEqual(a, b); assert.equal(a.includes("a-secure-test-password"), false); });
  it("accepts only the correct password and handles malformed hashes", async () => { const hash = await hashPassword("a-secure-test-password"); assert.equal(await verifyPassword("a-secure-test-password", hash), true); assert.equal(await verifyPassword("wrong-password", hash), false); assert.equal(await verifyPassword("anything", "malformed"), false); });
});
