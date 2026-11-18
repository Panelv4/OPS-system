import "dotenv/config";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { memberships, records, users, workspaces } from "../../src/db/schema";
import { issueToken } from "../../src/opspilot/server/tokens";

/**
 * GDPR surface: export everything we hold, and actually erase an account.
 *
 * The deletion tests exist because "we delete your data" is the kind of claim that
 * is easy to write and easy to get wrong — a session that survives, a workspace that
 * lingers, or an owner erasing a teammate's records all look like passing code.
 */

const base = process.env.TEST_BASE_URL?.replace(/\/$/, "");
const password = "A-good-test-password-2026!";

type Client = { cookie: string; email: string; workspaceId?: string; userId?: string };

const newClient = (tag: string): Client => ({ cookie: "", email: `${tag}-${randomUUID()}@example.com` });

async function request(client: Client | null, path: string, method = "GET", body?: unknown) {
  const headers: Record<string, string> = { Origin: new URL(base!).origin };
  if (client?.cookie) headers.Cookie = client.cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (client) {
    for (const cookie of response.headers.getSetCookie()) {
      if (cookie.startsWith("opspilot_session=")) client.cookie = cookie.split(";")[0];
    }
  }
  return response;
}

async function register(client: Client) {
  const response = await request(client, "/api/session/register", "POST", {
    email: client.email,
    password,
    name: "GDPR Test",
    workspace: `GDPR workspace ${randomUUID()}`,
  });
  assert.equal(response.status, 201, await response.clone().text());
  const data = (await (await request(client, "/api/workspace")).json()) as { workspace: { id: string }; user: { id: string } };
  client.workspaceId = data.workspace.id;
  client.userId = data.user.id;
}

const created: Client[] = [];
const cleanupWorkspaces: string[] = [];

before(async () => {
  assert.ok(base, "TEST_BASE_URL must point at a running server");
});

after(async () => {
  const ids = [...cleanupWorkspaces].filter(Boolean);
  if (ids.length) {
    await db.delete(workspaces).where(inArray(workspaces.id, ids));
    await db.delete(users).where(inArray(users.email, created.map((client) => client.email)));
  }
  await pool.end();
});

describe("data export", () => {
  it("refuses anonymous requests", async () => {
    const response = await fetch(`${base}/api/account/export`);
    assert.equal(response.status, 401);
  });

  it("returns a downloadable JSON file with the account, workspace and its records", async () => {
    const client = newClient("export");
    created.push(client);
    await register(client);
    cleanupWorkspaces.push(client.workspaceId!);

    const customer = await request(client, "/api/records", "POST", { kind: "customers", name: "Export Customer", email: "export@example.com" });
    assert.equal(customer.status, 201, await customer.clone().text());
    const invoice = await request(client, "/api/records", "POST", {
      kind: "invoices",
      name: "EXPORT-ME-1234",
      subtitle: "Export Customer",
      amount: "250.00",
      dueDate: "2026-12-01",
    });
    assert.equal(invoice.status, 201, await invoice.clone().text());

    const response = await request(client, "/api/account/export");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition") ?? "", /attachment; filename="opspilot-export-\d{4}-\d{2}-\d{2}\.json"/);

    const payload = await response.json();
    assert.equal(payload.account.email, client.email);
    assert.equal(payload.workspace.id, client.workspaceId);
    assert.equal(payload.workspace.members.length, 1);
    assert.equal(payload.workspace.members[0].role, "owner");
    assert.ok(payload.records.some((record: { name: string }) => record.name === "EXPORT-ME-1234"), "workspace records must be included");
    assert.ok(Array.isArray(payload.auditEvents));
    assert.ok(Array.isArray(payload.documents), "documents are listed as metadata");
    assert.match(payload.notice, /metadata/);
    assert.equal(payload.schemaVersion, 1);
  });
});

describe("account deletion", () => {
  it("requires the confirmation string and the current password", async () => {
    const client = newClient("delete-guard");
    created.push(client);
    await register(client);
    cleanupWorkspaces.push(client.workspaceId!);

    const withoutConfirm = await request(client, "/api/account", "DELETE", { password });
    assert.equal(withoutConfirm.status, 400);
    assert.match(await withoutConfirm.text(), /confirm/i);

    const wrongPassword = await request(client, "/api/account", "DELETE", { password: "not-my-password", confirm: "DELETE" });
    assert.equal(wrongPassword.status, 403);

    // Still alive and signed in after both rejections.
    assert.equal((await request(client, "/api/workspace")).status, 200);
  });

  it("erases the account, its sessions and its sole-member workspace", async () => {
    const client = newClient("delete-solo");
    created.push(client);
    await register(client);
    const workspaceId = client.workspaceId!;
    await request(client, "/api/records", "POST", { kind: "customers", name: "Delete me", email: "gone@example.com" });

    const response = await request(client, "/api/account", "DELETE", { password, confirm: "DELETE" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, deletedWorkspace: true });

    // The session no longer works and the cookie was not silently renewed.
    assert.equal((await request(client, "/api/workspace")).status, 401);
    assert.equal((await request(client, "/api/session/logout", "POST", {})).status, 200);

    assert.equal((await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))).length, 0);
    assert.equal((await db.select().from(records).where(eq(records.workspaceId, workspaceId))).length, 0, "records cascade with the workspace");
    assert.equal((await db.select().from(users).where(eq(users.id, client.userId!))).length, 0);
    assert.equal((await db.select().from(memberships).where(eq(memberships.userId, client.userId!))).length, 0);
  });

  it("refuses to let a sole owner erase a workspace that still has teammates", async () => {
    const owner = newClient("delete-owner");
    const mate = newClient("delete-mate");
    created.push(owner, mate);
    await register(owner);
    cleanupWorkspaces.push(owner.workspaceId!);

    const invitation = await request(owner, "/api/members", "POST", { email: mate.email, role: "accountant" });
    assert.equal(invitation.status, 201, await invitation.clone().text());

    // The API never returns the invitation token (it is emailed), so mint one the
    // same way the mailer does. Issuing retires the emailed token, which is fine here.
    const { token } = await issueToken({
      purpose: "invite",
      email: mate.email,
      workspaceId: owner.workspaceId!,
      role: "accountant",
    });

    const accepted = await request(mate, "/api/members/accept", "POST", { token, name: "Mate", password });
    assert.equal(accepted.status, 201);

    const attempt = await request(owner, "/api/account", "DELETE", { password, confirm: "DELETE" });
    assert.equal(attempt.status, 409);
    assert.match(await attempt.text(), /other members/i);

    // Both accounts and the workspace survive.
    assert.equal((await request(owner, "/api/workspace")).status, 200);
    assert.equal((await db.select().from(users).where(eq(users.id, owner.userId!))).length, 1);

    // A non-owner can still leave (delete their own account) without touching the workspace.
    const leaving = await request(mate, "/api/account", "DELETE", { password, confirm: "DELETE" });
    assert.equal(leaving.status, 200);
    assert.deepEqual(await leaving.json(), { ok: true, deletedWorkspace: false });
    assert.equal((await db.select().from(workspaces).where(eq(workspaces.id, owner.workspaceId!))).length, 1);
    assert.equal((await db.select().from(memberships).where(eq(memberships.workspaceId, owner.workspaceId!))).length, 1);
  });
});
