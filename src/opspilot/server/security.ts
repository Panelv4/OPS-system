import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions, memberships, users, workspaces, rateLimits } from "@/db/schema";
import { canAccess } from "../lib/domain";
import { clientIp, config } from "./config";
import { logError } from "./log";
import type { RecordKind, Role } from "../lib/types";
const scrypt = promisify(scryptCallback);
const COOKIE = "opspilot_session";
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export async function hashPassword(password: string) { const salt = randomBytes(16).toString("hex"); const derived = await scrypt(password, salt, 64) as Buffer; return `${salt}:${derived.toString("hex")}`; }
export async function verifyPassword(password: string, stored: string) { const [salt, key] = stored.split(":"); if (!salt || !key) return false; const derived = await scrypt(password, salt, 64) as Buffer; const expected = Buffer.from(key, "hex"); return expected.length === derived.length && timingSafeEqual(expected, derived); }
export async function createSession(userId: string, workspaceId: string) {
  const token = randomBytes(32).toString("hex"); const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, workspaceId, expiresAt });
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, secure: config().cookieSecure, sameSite: "lax", path: "/", expires: expiresAt });
}
export async function getSession() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [row] = await db.select({ user: { id: users.id, name: users.name, email: users.email, emailVerifiedAt: users.emailVerifiedAt }, workspace: workspaces, role: memberships.role })
    .from(sessions).innerJoin(users, eq(sessions.userId, users.id)).innerJoin(workspaces, eq(sessions.workspaceId, workspaces.id))
    .innerJoin(memberships, and(eq(memberships.userId, sessions.userId), eq(memberships.workspaceId, sessions.workspaceId)))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  return row ? { ...row, role: row.role as Role } : null;
}
export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;
export async function requireSession(kind?: RecordKind) {
  const session = await getSession(); if (!session) throw new ApiError(401, "Please sign in to continue.");
  if (kind && !canAccess(session.role, kind)) throw new ApiError(403, "Your role does not have access to this module.");
  return session;
}
export async function logout() { const jar = await cookies(); const token = jar.get(COOKIE)?.value; if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))); jar.delete(COOKIE); }
/**
 * Removes expired sessions and rate-limit buckets. Table growth from expired
 * rows is the cheapest denial-of-service an anonymous visitor can cause, so
 * this runs opportunistically during authentication traffic.
 */
export const DEMO_WORKSPACE_TTL_MS = 24 * 60 * 60 * 1000;

export async function pruneExpiredData() {
  const now = new Date();
  const demoCutoff = new Date(now.getTime() - DEMO_WORKSPACE_TTL_MS);
  try {
    await Promise.all([
      db.delete(sessions).where(lt(sessions.expiresAt, now)),
      db.delete(rateLimits).where(lt(rateLimits.expiresAt, now)),
      // Disposable demo workspaces cascade to their records, files and events.
      db.delete(workspaces).where(and(eq(workspaces.isDemo, true), lt(workspaces.createdAt, demoCutoff))),
    ]);
  } catch (error) {
    logError("housekeeping.failed", error);
  }
}

export { clientIp };

export function assertOrigin(request: Request, multipart = false) {
  const origin = request.headers.get("origin"); const host = request.headers.get("host");
  let source: URL;
  try { source = new URL(origin ?? ""); } catch { throw new ApiError(403, "Cross-origin request rejected."); }
  if (!["http:", "https:"].includes(source.protocol) || (source.host !== new URL(request.url).host && source.host !== host)) throw new ApiError(403, "Cross-origin request rejected.");
  const contentType = request.headers.get("content-type") ?? "";
  if (multipart ? !contentType.includes("multipart/form-data") : !contentType.includes("application/json")) throw new ApiError(415, multipart ? "Send a multipart file upload." : "Send application/json.");
}
export async function rateLimit(key: string, max = 30, windowMs = 15 * 60 * 1000) {
  const now = new Date(); const expiresAt = new Date(now.getTime() + windowMs);
  const [bucket] = await db.insert(rateLimits).values({ key: hashToken(key), count: 1, expiresAt }).onConflictDoUpdate({ target: rateLimits.key,
    set: { count: sql`CASE WHEN ${rateLimits.expiresAt} < ${now} THEN 1 ELSE ${rateLimits.count} + 1 END`, expiresAt: sql`CASE WHEN ${rateLimits.expiresAt} < ${now} THEN ${expiresAt} ELSE ${rateLimits.expiresAt} END` },
  }).returning();
  if (bucket.count > max) throw new ApiError(429, "Too many requests. Please try again later.");
}
export function apiError(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof SyntaxError) return Response.json({ error: "Invalid request body." }, { status: 400 });
  logError("api.unhandled", error);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
export async function readJson(request: Request) { const text = await request.text(); if (text.length > 64_000) throw new ApiError(413, "Request is too large."); return JSON.parse(text); }
