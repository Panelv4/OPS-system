import "dotenv/config";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { auditEvents, memberships, users, workspaces } from "../../src/db/schema";
import { issueToken } from "../../src/opspilot/server/tokens";

/**
 * Role change and removal. The interesting cases are the refusals: the last owner
 * cannot be demoted or removed, an administrator cannot appoint another administrator,
 * and removing someone must actually revoke their access instead of merely hiding them
 * from the roster.
 */

const base = process.env.TEST_BASE_URL?.replace(/\/$/, "");
const password = "A-good-test-password-2026!";

type Client = { cookie: string; email: string; userId?: string; workspaceId?: string };

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

const created: Client[] = [];
const workspaceIds: string[] = [];

async function register(client: Client) {
  const response = await request(client, "/api/session/register", "POST", {
    email: client.email,
    password,
    name: "Members Test",
    workspace: `Members ${randomUUID()}`,
  });
  assert.equal(response.status, 201, await response.clone().text());
  const data = (await (await request(client, "/api/workspace")).json()) as { workspace: { id: string }; user: { id: string } };
  client.workspaceId = data.workspace.id;
  client.userId = data.user.id;
}

async function join(owner: Client, role: string) {
  const mate = newClient("mate");
  const invited = await request(owner, "/api/members", "POST", { email: mate.email, role });
  assert.equal(invited.status, 201, await invited.clone().text());
  const { token } = await issueToken({ purpose: "invite", email: mate.email, workspaceId: owner.workspaceId!, role });
  const accepted = await request(mate, "/api/members/accept", "POST", { token, name: "Mate Person", password });
  assert.equal(accepted.status, 201, await accepted.clone().text());
  const data = (await (await request(mate, "/api/workspace")).json()) as { user: { id: string } };
  mate.userId = data.user.id;
  created.push(mate);
  return mate;
}

before(() => { assert.ok(base, "TEST_BASE_URL must point at a running server"); });

after(async () => {
  if (workspaceIds.length) {
    await db.delete(auditEvents).where(inArray(auditEvents.workspaceId, workspaceIds));
    await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    await db.delete(users).where(inArray(users.email, created.map((client) => client.email)));
  }
  await pool.end();
});

describe("member roles and removal", () => {
  it("promotes, demotes and records an audit event", async () => {
    const owner = newClient("roles-owner");
    created.push(owner);
    await register(owner);
    workspaceIds.push(owner.workspaceId!);
    const mate = await join(owner, "employee");

    const promoted = await request(owner, `/api/members/${mate.userId}`, "PATCH", { role: "accountant" });
    assert.equal(promoted.status, 200, await promoted.clone().text());

    const roster = await (await request(owner, "/api/members")).json();
    assert.equal(roster.members.find((member: { id: string }) => member.id === mate.userId).role, "accountant");

    const events = await db.select().from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, owner.workspaceId!), eq(auditEvents.action, "member.role_changed")));
    assert.equal(events.length, 1);
    assert.equal(events[0].subject, mate.email);
    assert.deepEqual(events[0].metadata, { from: "employee", to: "accountant" });

    // The old session is revoked so the new role is applied on the next request.
    assert.equal((await request(mate, "/api/workspace")).status, 401);
  });

  it("refuses to change or remove the owner, and refuses invalid roles", async () => {
    const owner = newClient("owner-guard");
    created.push(owner);
    await register(owner);
    workspaceIds.push(owner.workspaceId!);

    assert.equal((await request(owner, `/api/members/${owner.userId}`, "PATCH", { role: "manager" })).status, 409);
    assert.equal((await request(owner, `/api/members/${owner.userId}`, "DELETE")).status, 409);
    assert.equal((await request(owner, `/api/members/${owner.userId}`, "PATCH", { role: "owner" })).status, 400);
    assert.equal((await request(owner, `/api/members/${owner.userId}`, "PATCH", { role: "emperor" })).status, 400);
    assert.equal((await request(owner, `/api/members/${randomUUID()}`, "PATCH", { role: "manager" })).status, 404);
  });

  it("keeps role management away from non-administrators", async () => {
    const owner = newClient("perm-owner");
    created.push(owner);
    await register(owner);
    workspaceIds.push(owner.workspaceId!);
    const mate = await join(owner, "accountant");

    // The accountant's session was revoked by the promotion in the previous test only
    // for that workspace; here the invitee is signed in fresh.
    const reLogin = await request(mate, "/api/session/login", "POST", { email: mate.email, password });
    assert.equal(reLogin.status, 200);

    assert.equal((await request(mate, `/api/members/${owner.userId}`, "PATCH", { role: "employee" })).status, 403);
    assert.equal((await request(mate, `/api/members/${owner.userId}`, "DELETE")).status, 403);
    assert.equal((await request(null, `/api/members/${owner.userId}`, "DELETE")).status, 401);
  });

  it("removes a member, revokes their access and keeps the workspace intact", async () => {
    const owner = newClient("remove-owner");
    created.push(owner);
    await register(owner);
    workspaceIds.push(owner.workspaceId!);
    const mate = await join(owner, "employee");
    assert.equal((await request(mate, "/api/workspace")).status, 200);

    const removed = await request(owner, `/api/members/${mate.userId}`, "DELETE");
    assert.equal(removed.status, 200, await removed.clone().text());

    assert.equal((await request(mate, "/api/workspace")).status, 401, "removal must revoke the session");
    const roster = await (await request(owner, "/api/members")).json();
    assert.equal(roster.members.length, 1);
    assert.equal(roster.members[0].role, "owner");

    const rows = await db.select().from(memberships)
      .where(and(eq(memberships.workspaceId, owner.workspaceId!), eq(memberships.userId, mate.userId!)));
    assert.equal(rows.length, 0);
    const events = await db.select().from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, owner.workspaceId!), eq(auditEvents.action, "member.removed")));
    assert.equal(events.length, 1);
  });
});
