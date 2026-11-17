import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { resolveConfig, clientIp, rateLimitKey, ConfigError, type EnvBag } from "../../src/opspilot/server/config";

const validEnv = (overrides: EnvBag = {}): EnvBag => ({
  DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/db",
  NODE_ENV: "development",
  ...overrides,
});

const request = (headers: Record<string, string> = {}) =>
  new Request("https://app.example.com/api/session/login", { method: "POST", headers });

describe("runtime configuration validation", () => {
  it("accepts a valid environment and applies secure-by-default cookies in production", () => {
    const dev = resolveConfig(validEnv());
    assert.equal(dev.cookieSecure, false);
    assert.equal(dev.trustProxy, false);
    assert.equal(dev.aiEnabled, false);

    const prod = resolveConfig(validEnv({ NODE_ENV: "production" }));
    assert.equal(prod.cookieSecure, true, "production cookies must default to Secure");
  });

  it("honours explicit cookie, proxy and AI flags", () => {
    const resolved = resolveConfig(
      validEnv({ COOKIE_SECURE: "false", TRUST_PROXY: "true", AI_ENABLED: "true", OPENAI_API_KEY: "sk-test-key" }),
    );
    assert.equal(resolved.cookieSecure, false);
    assert.equal(resolved.trustProxy, true);
    assert.equal(resolved.aiEnabled, true);
  });

  it("rejects a missing or non-postgres database URL", () => {
    assert.throws(() => resolveConfig({}), ConfigError);
    assert.throws(() => resolveConfig(validEnv({ DATABASE_URL: "mysql://host/db" })), ConfigError);
    assert.throws(() => resolveConfig(validEnv({ DATABASE_URL: "   " })), ConfigError);
  });

  it("rejects malformed boolean flags instead of silently defaulting", () => {
    assert.throws(() => resolveConfig(validEnv({ TRUST_PROXY: "maybe" })), ConfigError);
    assert.throws(() => resolveConfig(validEnv({ COOKIE_SECURE: "yes-please" })), ConfigError);
  });

  it("refuses to enable the AI adapter without a key or over plain HTTP", () => {
    assert.throws(() => resolveConfig(validEnv({ AI_ENABLED: "true" })), ConfigError);
    assert.throws(
      () => resolveConfig(validEnv({ AI_ENABLED: "true", OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "http://api.example.com/v1" })),
      ConfigError,
    );
    const local = resolveConfig(
      validEnv({ AI_ENABLED: "true", OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "http://localhost:11434/v1" }),
    );
    assert.equal(local.aiEnabled, true, "localhost providers stay usable for local development");
  });
});

describe("rate-limit bucket selection", () => {
  it("keeps per-client buckets only when a proxy vouches for the address", () => {
    assert.equal(rateLimitKey("auth", "203.0.113.9", true), "auth:203.0.113.9");
    assert.equal(rateLimitKey("demo", "203.0.113.9", true), "demo:203.0.113.9");
    assert.equal(rateLimitKey("auth", "203.0.113.9", false), "auth:global");
    assert.equal(rateLimitKey("demo", "203.0.113.9", false), "demo:global");
  });
});

describe("client address resolution for rate limiting", () => {
  const spoofed = request({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "x-real-ip": "203.0.113.9" });

  it("ignores forwarded headers when no trusted proxy is configured", () => {
    const resolved = resolveConfig(validEnv());
    assert.equal(clientIp(spoofed, resolved), "direct-client");
  });

  it("uses the first forwarded hop when TRUST_PROXY is enabled", () => {
    const resolved = resolveConfig(validEnv({ TRUST_PROXY: "true" }));
    assert.equal(clientIp(spoofed, resolved), "203.0.113.9");
    assert.equal(clientIp(request({ "x-real-ip": "198.51.100.4" }), resolved), "198.51.100.4");
  });

  it("discards oversized or empty header values", () => {
    const resolved = resolveConfig(validEnv({ TRUST_PROXY: "true" }));
    assert.equal(clientIp(request({ "x-forwarded-for": "x".repeat(200) }), resolved), "direct-client");
    assert.equal(clientIp(request({ "x-forwarded-for": "   " }), resolved), "direct-client");
    assert.equal(
      clientIp(request({ "x-forwarded-for": `1.2.3.4, ${"9".repeat(60)}` }), resolved),
      "1.2.3.4",
      "a junk second hop must not poison a valid first hop",
    );
  });
});

describe("expired-row housekeeping", () => {
  it("deletes expired sessions and rate-limit buckets while keeping live rows", async () => {
    const { db, pool } = await import("../../src/db");
    const { sessions, rateLimits, workspaces, users, memberships } = await import("../../src/db/schema");
    const { pruneExpiredData } = await import("../../src/opspilot/server/security");
    const { randomUUID, createHash } = await import("node:crypto");
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");

    const [workspace] = await db.insert(workspaces).values({ name: `Prune ${randomUUID()}` }).returning();
    const [user] = await db.insert(users).values({ name: "Prune Tester", email: `prune-${randomUUID()}@example.com`, passwordHash: "x:y" }).returning();
    await db.insert(memberships).values({ workspaceId: workspace.id, userId: user.id, role: "owner" });

    const expiredSession = hash(`expired-${randomUUID()}`);
    const liveSession = hash(`live-${randomUUID()}`);
    const expiredBucket = hash(`bucket-expired-${randomUUID()}`);
    const liveBucket = hash(`bucket-live-${randomUUID()}`);
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);

    await db.insert(sessions).values([
      { tokenHash: expiredSession, userId: user.id, workspaceId: workspace.id, expiresAt: past },
      { tokenHash: liveSession, userId: user.id, workspaceId: workspace.id, expiresAt: future },
    ]);
    await db.insert(rateLimits).values([
      { key: expiredBucket, count: 99, expiresAt: past },
      { key: liveBucket, count: 1, expiresAt: future },
    ]);

    const staleDemo = await db.insert(workspaces).values({ name: `Stale demo ${randomUUID()}`, isDemo: true, createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000) }).returning();
    const freshDemo = await db.insert(workspaces).values({ name: `Fresh demo ${randomUUID()}`, isDemo: true }).returning();

    try {
      await pruneExpiredData();
      const remainingSessions = await db.select().from(sessions).where(eq(sessions.workspaceId, workspace.id));
      const remainingBuckets = await db.select().from(rateLimits).where(inArray(rateLimits.key, [expiredBucket, liveBucket]));
      assert.deepEqual(remainingSessions.map((row) => row.tokenHash), [liveSession], "expired session must be pruned, live session kept");
      assert.deepEqual(remainingBuckets.map((row) => row.key), [liveBucket], "expired bucket must be pruned, live bucket kept");
      const demoRows = await db.select().from(workspaces).where(inArray(workspaces.id, [staleDemo[0].id, freshDemo[0].id]));
      assert.deepEqual(demoRows.map((row) => row.id), [freshDemo[0].id], "demo workspaces expire after 24 hours, recent ones survive");
    } finally {
      await db.delete(rateLimits).where(inArray(rateLimits.key, [expiredBucket, liveBucket]));
      await db.delete(workspaces).where(inArray(workspaces.id, [workspace.id, freshDemo[0].id]));
      await db.delete(workspaces).where(eq(workspaces.id, staleDemo[0].id));
      await db.delete(users).where(eq(users.id, user.id));
      await pool.end();
    }
  });
});
