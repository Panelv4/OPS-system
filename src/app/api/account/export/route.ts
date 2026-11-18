import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  emailLog,
  files,
  memberships,
  notifications,
  payments,
  records,
  stockMovements,
  subscriptions,
  users,
  workspaces,
} from "@/db/schema";
import { apiError, requireSession } from "@/opspilot/server/security";
import { logInfo } from "@/opspilot/server/log";

export const dynamic = "force-dynamic";

/**
 * Everything OpsPilot holds about the signed-in account, as one JSON file
 * (GDPR Art. 15/20). Workspace-scoped data is included for the workspace the
 * session is in, because that is what the person can already see in the app.
 *
 * Document *contents* are exported as metadata only: a file body is a payload,
 * not a record, and dumping binary into JSON helps nobody — it is downloadable
 * from the document module.
 */
export async function GET() {
  try {
    const session = await requireSession();
    const workspaceId = session.workspace.id;

    const [workspaceRecords, workspacePayments, workspaceMovements, workspaceFiles, workspaceNotes, workspaceAudit, members, subscription, deliveries] =
      await Promise.all([
        db.select().from(records).where(eq(records.workspaceId, workspaceId)),
        db.select().from(payments).where(eq(payments.workspaceId, workspaceId)),
        db.select().from(stockMovements).where(eq(stockMovements.workspaceId, workspaceId)),
        db.select({
          id: files.id,
          recordId: files.recordId,
          filename: files.filename,
          contentType: files.contentType,
          size: files.size,
        }).from(files).where(eq(files.workspaceId, workspaceId)),
        db.select().from(notifications).where(eq(notifications.workspaceId, workspaceId)),
        db.select().from(auditEvents).where(eq(auditEvents.workspaceId, workspaceId)),
        db.select({ userId: memberships.userId, role: memberships.role, name: users.name, email: users.email })
          .from(memberships).innerJoin(users, eq(users.id, memberships.userId))
          .where(eq(memberships.workspaceId, workspaceId)),
        db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)),
        db.select({ template: emailLog.template, subject: emailLog.subject, status: emailLog.status, createdAt: emailLog.createdAt })
          .from(emailLog).where(eq(emailLog.recipient, session.user.email)),
      ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      notice:
        "This export contains the data OpsPilot stores about you and the workspace you are signed in to. " +
        "Document contents are listed as metadata; download the files themselves from the Documents module.",
      account: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        emailVerified: Boolean(session.user.emailVerifiedAt),
        role: session.role,
      },
      workspace: {
        id: session.workspace.id,
        name: session.workspace.name,
        isDemo: session.workspace.isDemo,
        settings: session.workspace.settings,
        createdAt: session.workspace.createdAt,
        members,
      },
      records: workspaceRecords,
      payments: workspacePayments,
      stockMovements: workspaceMovements,
      documents: workspaceFiles,
      notifications: workspaceNotes,
      auditEvents: workspaceAudit,
      subscription,
      emailDeliveries: deliveries,
    };

    logInfo("account.exported", { userId: session.user.id, workspaceId, records: workspaceRecords.length });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="opspilot-export-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
