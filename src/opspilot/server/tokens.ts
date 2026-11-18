/**
 * Single-use action tokens for email verification, password recovery and
 * workspace invitations.
 *
 * Properties that matter:
 *  - 32 random bytes, stored only as a SHA-256 hash (a leaked dump is not a set of
 *    working links).
 *  - Purpose-bound: a reset token cannot be replayed as an invitation.
 *  - Single use: consumption is one atomic UPDATE ... WHERE used_at IS NULL, so two
 *    concurrent clicks cannot both succeed.
 *  - Expiring: verification 24h, reset 30 minutes, invitation 7 days.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { emailTokens } from "@/db/schema";

export type TokenPurpose = "verify" | "reset" | "invite";

export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  verify: 24 * 60 * 60 * 1000,
  reset: 30 * 60 * 1000,
  invite: 7 * 24 * 60 * 60 * 1000,
};

export type IssuedToken = { token: string; expiresAt: Date; id: string };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function isValidTokenFormat(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

export async function issueToken(input: {
  purpose: TokenPurpose;
  email: string;
  userId?: string;
  workspaceId?: string;
  role?: string;
}): Promise<IssuedToken> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[input.purpose]);
  const [row] = await db.insert(emailTokens).values({
    purpose: input.purpose,
    tokenHash: hashToken(token),
    email: input.email.toLowerCase().trim(),
    userId: input.userId,
    workspaceId: input.workspaceId,
    role: input.role,
    expiresAt,
  }).returning({ id: emailTokens.id });
  return { token, expiresAt, id: row.id };
}

/** Burns any outstanding token for this address and purpose (used before issuing a new one). */
export async function invalidateOutstandingTokens(email: string, purpose: TokenPurpose): Promise<void> {
  await db.update(emailTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(emailTokens.email, email.toLowerCase().trim()), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt)));
}

export type ConsumedToken = {
  id: string;
  email: string;
  userId: string | null;
  workspaceId: string | null;
  role: string | null;
};

/**
 * Consumes a token, returning null when it is unknown, expired, already used, or
 * issued for a different purpose. The single UPDATE guarantees one winner.
 */
export async function consumeToken(rawToken: unknown, purpose: TokenPurpose): Promise<ConsumedToken | null> {
  if (!isValidTokenFormat(rawToken)) return null;
  const [row] = await db.update(emailTokens)
    .set({ usedAt: new Date() })
    .where(and(
      eq(emailTokens.tokenHash, hashToken(rawToken)),
      eq(emailTokens.purpose, purpose),
      isNull(emailTokens.usedAt),
      gt(emailTokens.expiresAt, new Date()),
    ))
    .returning({
      id: emailTokens.id,
      email: emailTokens.email,
      userId: emailTokens.userId,
      workspaceId: emailTokens.workspaceId,
      role: emailTokens.role,
    });
  return row ?? null;
}

/** Housekeeping: drop tokens that expired more than a day ago. */
export async function pruneExpiredTokens(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    await db.delete(emailTokens).where(lt(emailTokens.expiresAt, cutoff));
  } catch (error) {
    console.error("[tokens] prune failed:", error instanceof Error ? error.message : "unknown");
  }
}
