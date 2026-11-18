/**
 * High-level email actions: issue a token, build the link, send the message.
 *
 * Kept separate from `mailer.ts` (transport) and `tokens.ts` (storage) so each can
 * be tested alone and swapped independently.
 */

import { config } from "./config";
import { issueToken, invalidateOutstandingTokens } from "./tokens";
import { invitationEmail, passwordResetEmail, sendMail, verificationEmail, type MailResult } from "./mailer";

export function linkFor(purpose: "verify" | "reset" | "invite", token: string): string {
  // The login page is the single place that consumes these links (see Auth.tsx).
  const mode = purpose === "invite" ? "invite" : purpose === "reset" ? "reset" : "verify";
  return `${config().appUrl}/login?mode=${mode}&token=${encodeURIComponent(token)}`;
}

export async function sendVerificationEmail(input: {
  userId: string;
  email: string;
  workspaceId?: string;
  workspaceName: string;
}): Promise<MailResult> {
  await invalidateOutstandingTokens(input.email, "verify");
  const { token } = await issueToken({ purpose: "verify", email: input.email, userId: input.userId, workspaceId: input.workspaceId });
  return sendMail({
    to: input.email,
    workspaceId: input.workspaceId,
    ...verificationEmail(linkFor("verify", token), input.workspaceName),
  });
}

export async function sendPasswordResetEmail(input: {
  userId: string;
  email: string;
  name: string;
  workspaceId?: string;
}): Promise<MailResult> {
  await invalidateOutstandingTokens(input.email, "reset");
  const { token } = await issueToken({ purpose: "reset", email: input.email, userId: input.userId, workspaceId: input.workspaceId });
  return sendMail({
    to: input.email,
    workspaceId: input.workspaceId,
    ...passwordResetEmail(linkFor("reset", token), input.name),
  });
}

export async function sendInvitationEmail(input: {
  email: string;
  workspaceId: string;
  workspaceName: string;
  inviterName: string;
  role: string;
}): Promise<MailResult> {
  await invalidateOutstandingTokens(input.email, "invite");
  const { token } = await issueToken({
    purpose: "invite",
    email: input.email,
    workspaceId: input.workspaceId,
    role: input.role,
  });
  return sendMail({
    to: input.email,
    workspaceId: input.workspaceId,
    ...invitationEmail(linkFor("invite", token), input.workspaceName, input.inviterName, input.role),
  });
}
