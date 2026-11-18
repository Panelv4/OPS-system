import "dotenv/config";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { emailLog, emailTokens, memberships, users, workspaces } from "../../src/db/schema";
import { resolveConfig, ConfigError, type EnvBag } from "../../src/opspilot/server/config";
import { consumeToken, issueToken, isValidTokenFormat, TOKEN_TTL_MS } from "../../src/opspilot/server/tokens";
import {
  brevoHint,
  invitationEmail,
  parseSender,
  passwordResetEmail,
  sendWithBrevo,
  verificationEmail,
} from "../../src/opspilot/server/mailer";

const base = process.env.TEST_BASE_URL?.replace(/\/$/, "");
const password = "A-good-test-password-2026!";
const freshEmail = (tag: string) => `${tag}-${randomUUID()}@example.com`;

const request = (path: string, body: unknown, cookie?: string) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base!, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
const get = (path: string, cookie?: string) => fetch(`${base}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
const cookieFrom = (response: Response) => (response.headers.getSetCookie() ?? []).find((value) => value.startsWith("opspilot_session="))?.split(";")[0];

/* ------------------------------------------------------------------ *
 * Pure: configuration and templates
 * ------------------------------------------------------------------ */

describe("mail configuration and templates", () => {
  const env = (overrides: EnvBag = {}): EnvBag => ({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db", ...overrides });

  it("defaults to the console transport and a local app URL", () => {
    const config = resolveConfig(env());
    assert.equal(config.mailTransport, "console");
    assert.equal(config.appUrl, "http://localhost:3000");
  });

  it("refuses a half-configured mailer instead of silently dropping mail", () => {
    assert.throws(() => resolveConfig(env({ MAIL_TRANSPORT: "resend" })), ConfigError);
    assert.throws(() => resolveConfig(env({ MAIL_TRANSPORT: "sendgrid" })), ConfigError);
    assert.throws(() => resolveConfig(env({ MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_x", MAIL_FROM: "not-an-address" })), ConfigError);
    const ok = resolveConfig(env({ MAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_x", MAIL_FROM: "OpsPilot <no-reply@example.com>" }));
    assert.equal(ok.mailTransport, "resend");
  });

  it("rejects a relative APP_URL, because email links must be absolute", () => {
    assert.throws(() => resolveConfig(env({ APP_URL: "/login" })), ConfigError);
    assert.throws(() => resolveConfig(env({ APP_URL: "javascript:alert(1)" })), ConfigError);
  });

  it("builds single-action plain-text emails", () => {
    const verify = verificationEmail("https://app.example.com/login?mode=verify&token=abc", "Acme Studio");
    assert.match(verify.subject, /Confirm/);
    assert.match(verify.text, /Acme Studio/);
    assert.match(verify.text, /https:\/\/app\.example\.com\/login\?mode=verify&token=abc/);
    assert.match(verify.text, /expires in 24 hours/i);

    const reset = passwordResetEmail("https://x/login?mode=reset&token=abc", "Alex Morgan");
    assert.match(reset.text, /Hi Alex,/);
    assert.match(reset.text, /30 minutes/);

    const invite = invitationEmail("https://x/login?mode=invite&token=abc", "Acme Studio", "Priya", "accountant");
    assert.match(invite.subject, /Priya invited you to Acme Studio/);
    assert.match(invite.text, /accountant/);
  });
});

/* ------------------------------------------------------------------ *
 * Brevo: the zero-cost, no-domain transport
 * ------------------------------------------------------------------ */

describe("Brevo transport", () => {
  const env = (overrides: EnvBag = {}): EnvBag => ({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db", ...overrides });
  const message = {
    to: "customer@example.com",
    subject: "Confirm your email",
    text: "Confirm: https://app.example.com/login?mode=verify&token=abc",
    template: "verify_email" as const,
  };

  it("needs a key and a real From address, and refuses to start half-configured", () => {
    assert.throws(() => resolveConfig(env({ MAIL_TRANSPORT: "brevo" })), ConfigError);
    assert.throws(() => resolveConfig(env({ MAIL_TRANSPORT: "brevo", BREVO_API_KEY: "xkeysib-1", MAIL_FROM: "someone" })), ConfigError);
    const ok = resolveConfig(env({ MAIL_TRANSPORT: "brevo", BREVO_API_KEY: "xkeysib-1", MAIL_FROM: "Alex <alex@gmail.com>" }));
    assert.equal(ok.mailTransport, "brevo");
    assert.equal(ok.brevoApiKey, "xkeysib-1");
  });

  it("parses both sender formats into a provider sender object", () => {
    assert.deepEqual(parseSender("OpsPilot <no-reply@example.com>"), { name: "OpsPilot", email: "no-reply@example.com" });
    assert.deepEqual(parseSender("alex@gmail.com"), { email: "alex@gmail.com" });
  });

  it("posts a plain-text message and records the provider message id", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ messageId: "brevo-123" }), { status: 201 });
    }) as unknown as typeof fetch;

    const result = await sendWithBrevo(message, "xkeysib-1", "OpsPilot <alex@gmail.com>", fake);
    assert.deepEqual(result, { status: "sent", providerId: "brevo-123" });
    assert.equal(seen?.url, "https://api.brevo.com/v3/smtp/email");
    const body = JSON.parse(String(seen?.init.body));
    assert.deepEqual(body.sender, { name: "OpsPilot", email: "alex@gmail.com" });
    assert.deepEqual(body.to, [{ email: "customer@example.com" }]);
    assert.equal(body.textContent, message.text);
    assert.equal(body.subject, "Confirm your email");
    assert.equal((seen?.init.headers as Record<string, string>)["api-key"], "xkeysib-1");
  });

  it("turns provider rejections into the action that fixes them", async () => {
    const reject = (status: number, body = "{\"message\":\"nope\"}") =>
      (async () => new Response(body, { status })) as unknown as typeof fetch;

    const unauthorised = await sendWithBrevo(message, "bad", "alex@gmail.com", reject(401));
    assert.equal(unauthorised.status, "failed");
    assert.match(unauthorised.error ?? "", /Check BREVO_API_KEY/);

    const unverifiedSender = await sendWithBrevo(message, "key", "alex@gmail.com", reject(400, "{\"message\":\"Sender not allowed\"}"));
    assert.equal(unverifiedSender.status, "failed");
    assert.match(unverifiedSender.error ?? "", /Verify the MAIL_FROM address/);

    assert.match(brevoHint(402), /300\/day/);
    assert.match(brevoHint(429), /rate limit/i);
    assert.equal(brevoHint(418), "");
  });

  it("never throws when the network fails — a provider outage must not break signup", async () => {
    const boom = (async () => { throw new Error("connect ECONNREFUSED"); }) as unknown as typeof fetch;
    const result = await sendWithBrevo(message, "key", "alex@gmail.com", boom);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /ECONNREFUSED/);

    const garbage = (async () => new Response("not json", { status: 201 })) as unknown as typeof fetch;
    const sentWithoutId = await sendWithBrevo(message, "key", "alex@gmail.com", garbage);
    assert.equal(sentWithoutId.status, "sent", "a 2xx without a parseable body is still a delivery");
  });
});

/* ------------------------------------------------------------------ *
 * Database: token lifecycle
 * ------------------------------------------------------------------ */

describe("single-use tokens", () => {
  it("burns a token exactly once and only for its purpose", async () => {
    const [user] = await db.insert(users).values({ name: "Token Tester", email: freshEmail("token"), passwordHash: "x:y" }).returning();
    try {
      const { token } = await issueToken({ purpose: "reset", email: user.email, userId: user.id });
      assert.ok(isValidTokenFormat(token));

      const first = await consumeToken(token, "reset");
      assert.equal(first?.userId, user.id);
      const second = await consumeToken(token, "reset");
      assert.equal(second, null, "a consumed token must never work twice");

      const { token: verifyToken } = await issueToken({ purpose: "verify", email: user.email, userId: user.id });
      assert.equal(await consumeToken(verifyToken, "reset"), null, "a verify token must not be usable as a reset token");

      assert.equal(await consumeToken("not-a-token", "verify"), null);
      assert.equal(await consumeToken(undefined, "verify"), null);
      assert.equal(await consumeToken("a".repeat(64), "verify"), null, "unknown but well-formed tokens are rejected");
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("rejects expired tokens and issues short-lived reset tokens", async () => {
    const [user] = await db.insert(users).values({ name: "Expiry Tester", email: freshEmail("expiry"), passwordHash: "x:y" }).returning();
    try {
      assert.ok(TOKEN_TTL_MS.reset <= 30 * 60 * 1000, "reset links must be short-lived");
      const { token } = await issueToken({ purpose: "verify", email: user.email, userId: user.id });
      await db.update(emailTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(emailTokens.userId, user.id));
      assert.equal(await consumeToken(token, "verify"), null, "an expired token must be rejected");
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("invalidates an outstanding token when a new one is issued", async () => {
    const [user] = await db.insert(users).values({ name: "Rotate Tester", email: freshEmail("rotate"), passwordHash: "x:y" }).returning();
    try {
      const { sendPasswordResetEmail } = await import("../../src/opspilot/server/emails");
      const firstToken = await issueToken({ purpose: "reset", email: user.email, userId: user.id });
      await sendPasswordResetEmail({ userId: user.id, email: user.email, name: user.name }); // invalidates the first
      assert.equal(await consumeToken(firstToken.token, "reset"), null, "requesting a new link must retire the old one");
      const rows = await db.select().from(emailLog).where(eq(emailLog.recipient, user.email));
      assert.ok(rows.some((row) => row.template === "password_reset" && row.status === "sent"), "delivery must be logged");
    } finally {
      await db.delete(emailLog).where(eq(emailLog.recipient, user.email));
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});

/* ------------------------------------------------------------------ *
 * HTTP: verification, recovery, invitations
 * ------------------------------------------------------------------ */

describe("email flows over HTTP", { skip: !base ? "TEST_BASE_URL is not set" : false }, () => {
  it("sends a verification email on registration and confirms the address with the token", async () => {
    const email = freshEmail("verify-flow");
    const registered = await request("/api/session/register", { email, password, name: "Verify Flow", workspace: `Verify ${randomUUID()}` });
    assert.equal(registered.status, 201);

    const logged = await db.select().from(emailLog).where(eq(emailLog.recipient, email));
    assert.equal(logged.length, 1, "registration must send exactly one email");
    assert.equal(logged[0].template, "verify_email");
    assert.equal(logged[0].status, "sent");

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    assert.equal(user.emailVerifiedAt, null, "a new account starts unverified");

    const { token } = await issueToken({ purpose: "verify", email, userId: user.id });
    const confirmed = await request("/api/session/verify", { token });
    assert.equal(confirmed.status, 200);
    assert.equal((await request("/api/session/verify", { token })).status, 400, "the link is single-use");

    const [after] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    assert.ok(after.emailVerifiedAt instanceof Date);
  });

  it("never reveals whether an address has an account", async () => {
    const known = freshEmail("known");
    await request("/api/session/register", { email: known, password, name: "Known User", workspace: `Known ${randomUUID()}` });
    const knownResponse = await request("/api/session/request-reset", { email: known });
    const unknownResponse = await request("/api/session/request-reset", { email: freshEmail("unknown") });
    assert.equal(knownResponse.status, 200);
    assert.equal(unknownResponse.status, 200);
    const knownBody = await knownResponse.json();
    const unknownBody = await unknownResponse.json();
    assert.deepEqual(knownBody, unknownBody, "responses must be identical in shape and wording");
    assert.match(knownBody.notice, /If that address has an account/);
  });

  it("resets the password, revokes other sessions, and accepts the new password", async () => {
    const email = freshEmail("reset-flow");
    const registered = await request("/api/session/register", { email, password, name: "Reset Flow", workspace: `Reset ${randomUUID()}` });
    const oldCookie = cookieFrom(registered)!;
    assert.equal((await get("/api/workspace", oldCookie)).status, 200);

    await request("/api/session/request-reset", { email });
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const { token } = await issueToken({ purpose: "reset", email, userId: user.id });

    // A weak password is refused.
    assert.equal((await request("/api/session/reset", { token, password: "short" })).status, 400);

    const newPassword = "A-different-password-2026!";
    const reset = await request("/api/session/reset", { token, password: newPassword });
    assert.equal(reset.status, 200);

    assert.equal((await get("/api/workspace", oldCookie)).status, 401, "a password change must evict existing sessions");

    const oldLogin = await request("/api/session/login", { email, password });
    assert.equal(oldLogin.status, 401, "the old password must stop working");
    const newLogin = await request("/api/session/login", { email, password: newPassword });
    assert.equal(newLogin.status, 200);
    assert.ok(cookieFrom(newLogin));
  });

  it("invites a teammate, enforces seats, and lets the invitation be accepted once", async () => {
    const ownerEmail = freshEmail("owner");
    const registered = await request("/api/session/register", { email: ownerEmail, password, name: "Owner Person", workspace: `Invite ${randomUUID()}` });
    assert.equal(registered.status, 201);
    const ownerCookie = cookieFrom(registered)!;
    const workspaceId = (await (await get("/api/workspace", ownerCookie)).json()).workspace.id;

    const inviteeEmail = freshEmail("invitee");
    const invited = await request("/api/members", { email: inviteeEmail, role: "accountant" }, ownerCookie);
    assert.equal(invited.status, 201, await invited.clone().text());
    assert.equal((await invited.json()).delivery, "sent");

    const inviteLog = await db.select().from(emailLog).where(eq(emailLog.recipient, inviteeEmail));
    assert.equal(inviteLog[0].template, "workspace_invite");

    // The free plan seats 2: owner + one invitation fills it.
    assert.equal((await request("/api/members", { email: freshEmail("third"), role: "employee" }, ownerCookie)).status, 402);

    // A non-owner cannot invite.
    assert.equal((await request("/api/members", { email: freshEmail("other"), role: "employee" }, undefined)).status, 401);

    const { token } = await issueToken({ purpose: "invite", email: inviteeEmail, workspaceId, role: "accountant" });
    const accepted = await request("/api/members/accept", { token, name: "Invited Person", password });
    assert.equal(accepted.status, 201);
    const inviteeCookie = cookieFrom(accepted)!;
    assert.ok(inviteeCookie, "accepting must sign the new member in");

    const inviteeWorkspace = await (await get("/api/workspace", inviteeCookie)).json();
    assert.equal(inviteeWorkspace.user.role, "accountant");
    assert.deepEqual(inviteeWorkspace.permissions, ["customers", "invoices", "expenses", "vendors", "documents"]);

    assert.equal((await request("/api/members/accept", { token, name: "Invited Person", password })).status, 400, "an invitation is single-use");

    const roster = await (await get("/api/members", ownerCookie)).json();
    assert.equal(roster.members.length, 2);
    assert.ok(roster.members.some((member: { email: string }) => member.email === inviteeEmail));
  });

  it("refuses an invitation link whose workspace was deleted", async () => {
    const [workspace] = await db.insert(workspaces).values({ name: `Ghost ${randomUUID()}` }).returning();
    const { token } = await issueToken({ purpose: "invite", email: freshEmail(" ghost"), workspaceId: workspace.id, role: "employee" });
    await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
    const response = await request("/api/members/accept", { token, name: "Ghost Person", password });
    assert.equal(response.status, 400);
  });
});

after(async () => {
  const createdWorkspaces = await db.select({ id: workspaces.id }).from(workspaces).where(sql`${workspaces.name} like 'Verify %' or ${workspaces.name} like 'Known %' or ${workspaces.name} like 'Reset %' or ${workspaces.name} like 'Invite %' or ${workspaces.name} like 'Ghost %'`);
  if (createdWorkspaces.length) await db.delete(workspaces).where(inArray(workspaces.id, createdWorkspaces.map((row) => row.id)));
  const createdUsers = await db.select({ id: users.id, email: users.email }).from(users)
    .where(sql`${users.email} like '%-%@example.com' and (${users.email} like 'token-%' or ${users.email} like 'expiry-%' or ${users.email} like 'rotate-%' or ${users.email} like 'verify-flow-%' or ${users.email} like 'known-%' or ${users.email} like 'reset-flow-%' or ${users.email} like 'owner-%' or ${users.email} like 'invitee-%')`);
  if (createdUsers.length) {
    await db.delete(emailLog).where(inArray(emailLog.recipient, createdUsers.map((row) => row.email)));
    await db.delete(users).where(inArray(users.id, createdUsers.map((row) => row.id)));
  }
  await db.delete(emailTokens).where(and(sql`${emailTokens.expiresAt} < now() - interval '1 day'`));
  await pool.end();
});
