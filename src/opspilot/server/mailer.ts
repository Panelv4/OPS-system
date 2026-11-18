/**
 * Outbound email.
 *
 * One interface, three transports:
 *  - `console` writes the message to the server log and the delivery table. Used
 *    in development, CI and any deployment without a sending domain. Nothing
 *    leaves the machine, and links are still verifiable by a developer.
 *  - `brevo` posts to the Brevo REST API. This is the zero-cost path that works
 *    *today* without buying a domain: Brevo verifies a single sender address with
 *    a confirmation code, so a personal or work inbox can be the From address.
 *    Free plan: 300 emails/day (see docs/EMAIL.md for the limits and caveats).
 *  - `resend` posts to the Resend HTTP API with fetch — the better long-term
 *    option once a domain exists, because only then can DKIM/DMARC be aligned.
 *
 * Every attempt is logged to `op_email_log` so support can answer "did it send?".
 * Failures never throw into the caller's request path: registration must not fail
 * because a provider hiccuped.
 */

import { db } from "@/db";
import { emailLog } from "@/db/schema";
import { config } from "./config";
import { logError } from "./log";

export type MailTemplate = "verify_email" | "password_reset" | "workspace_invite";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  template: MailTemplate;
  workspaceId?: string;
};

export type MailResult = { status: "sent" | "failed" | "suppressed"; providerId?: string; error?: string };

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/** Splits `OpsPilot <no-reply@example.com>` into a provider sender object. */
export function parseSender(from: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(from);
  if (match) return { name: match[1] || undefined, email: match[2].trim() };
  return { email: from.trim() };
}

async function sendWithResend(message: MailMessage, apiKey: string, from: string): Promise<MailResult> {
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      // Deliberately plain text: fewer deliverability surprises than HTML for
      // transactional mail, and no tracking pixels in a privacy-sensitive product.
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { status: "failed", error: `Resend ${response.status}: ${detail.slice(0, 300)}` };
    }
    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { status: "sent", providerId: body.id };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "unknown error" };
  }
}

/**
 * Brevo transport. Chosen because it is the only mainstream provider that lets you
 * send to *any* recipient at zero cost without owning a domain: the From address is
 * verified once with a 6-digit code sent to that inbox.
 *
 * Known limits (docs/EMAIL.md): 300 emails/day on the free plan, a "Sent with Brevo"
 * footer, and no DKIM/DMARC alignment for a free sender domain — so expect weaker
 * inbox placement than a properly authenticated domain.
 */
export async function sendWithBrevo(
  message: MailMessage,
  apiKey: string,
  from: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MailResult> {
  try {
    const response = await fetchImpl(BREVO_ENDPOINT, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: parseSender(from),
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { status: "failed", error: `${brevoHint(response.status)} Brevo ${response.status}: ${detail.slice(0, 300)}` };
    }
    const body = (await response.json().catch(() => ({}))) as { messageId?: string; messageIds?: string[] };
    return { status: "sent", providerId: body.messageId ?? body.messageIds?.[0] };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "unknown error" };
  }
}

/** Turns a provider status code into the action that actually fixes it. */
export function brevoHint(status: number): string {
  if (status === 401) return "Check BREVO_API_KEY.";
  if (status === 400) return "Verify the MAIL_FROM address under Brevo → Senders (no domain required).";
  if (status === 402) return "Daily free-plan quota exhausted (300/day); wait or upgrade.";
  if (status === 429) return "Brevo rate limit; retry later.";
  return "";
}

/** Console transport: logs the message so a developer can follow the link. */
function sendWithConsole(message: MailMessage): MailResult {
  const lines = [
    "──────────────────────── OpsPilot email (console transport) ────────────────────────",
    `to:      ${message.to}`,
    `subject: ${message.subject}`,
    "",
    message.text,
    "────────────────────────────────────────────────────────────────────────────────────",
  ];
  console.log(lines.join("\n"));
  return { status: "sent", providerId: "console" };
}

/**
 * Sends an email and records the attempt. Never throws: the caller's request must
 * succeed even when email delivery fails, and the failure is visible in the log
 * table plus the server log.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const { mailTransport, resendApiKey, brevoApiKey, mailFrom } = config();

  let result: MailResult;
  if (mailTransport === "resend") {
    result = await sendWithResend(message, resendApiKey, mailFrom);
  } else if (mailTransport === "brevo") {
    result = await sendWithBrevo(message, brevoApiKey, mailFrom);
  } else {
    result = sendWithConsole(message);
  }
  if (result.status === "failed") {
    logError("mail.send_failed", result.error ?? "unknown", { template: message.template, transport: mailTransport });
  }

  try {
    await db.insert(emailLog).values({
      workspaceId: message.workspaceId,
      recipient: message.to,
      template: message.template,
      subject: message.subject.slice(0, 200),
      status: result.status,
      providerId: result.providerId?.slice(0, 120),
      error: result.error,
    });
  } catch (error) {
    logError("mail.log_failed", error);
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Templates — deliberately plain text with a single obvious action.
 * ------------------------------------------------------------------ */

const signature = "— The OpsPilot team";

export function verificationEmail(link: string, workspaceName: string): Omit<MailMessage, "to" | "workspaceId"> {
  return {
    template: "verify_email",
    subject: "Confirm your OpsPilot email address",
    text: [
      `Welcome to OpsPilot. Confirm this email address to finish setting up "${workspaceName}".`,
      "",
      `Confirm your email: ${link}`,
      "",
      "This link expires in 24 hours and can be used once.",
      "If you did not create an OpsPilot workspace, you can ignore this message.",
      "",
      signature,
    ].join("\n"),
  };
}

export function passwordResetEmail(link: string, name: string): Omit<MailMessage, "to" | "workspaceId"> {
  return {
    template: "password_reset",
    subject: "Reset your OpsPilot password",
    text: [
      `Hi ${name.split(" ")[0] || "there"},`,
      "",
      "Someone asked to reset the password for your OpsPilot account. If that was you, use the link below.",
      "",
      `Reset your password: ${link}`,
      "",
      "This link expires in 30 minutes and can be used once. Choosing a new password signs you out of every other session.",
      "If you did not request this, no action is needed — your password stays the same.",
      "",
      signature,
    ].join("\n"),
  };
}

export function invitationEmail(link: string, workspaceName: string, inviterName: string, role: string): Omit<MailMessage, "to" | "workspaceId"> {
  return {
    template: "workspace_invite",
    subject: `${inviterName} invited you to ${workspaceName} on OpsPilot`,
    text: [
      `${inviterName} invited you to join "${workspaceName}" on OpsPilot as ${role.replaceAll("_", " ")}.`,
      "",
      `Accept the invitation: ${link}`,
      "",
      "This link expires in 7 days and can be used once.",
      "If you were not expecting this invitation, you can ignore this message.",
      "",
      signature,
    ].join("\n"),
  };
}
