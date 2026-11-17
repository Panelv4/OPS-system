import { db } from "@/db";
import { files, records, auditEvents } from "@/db/schema";
import { ApiError, apiError, assertOrigin, requireSession, rateLimit } from "@/opspilot/server/security";
import { MAX_UPLOAD_BYTES, validateUpload } from "@/opspilot/lib/uploads";
export async function POST(request: Request) {
  try {
    assertOrigin(request, true); const session = await requireSession("documents"); await rateLimit(`upload:${session.user.id}`, 20);
    const contentLength = Number(request.headers.get("content-length") ?? 0); if (contentLength > MAX_UPLOAD_BYTES + 16384) throw new ApiError(413, "Maximum file size is 5 MB.");
    const body = await request.formData(); const file = body.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "Choose a document to upload.");
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "Maximum file size is 5 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer()); let contentType: string;
    try { contentType = validateUpload(bytes, file.name); } catch (e) { throw new ApiError(400, e instanceof Error ? e.message : "Unsupported file."); }
    const filename = file.name.replace(/[^a-zA-Z0-9._ ()-]/g, "_").slice(0, 180) || "document.txt";
    const category = String(body.get("category") ?? "General").slice(0, 80);
    const record = await db.transaction(async tx => {
      const [r] = await tx.insert(records).values({ workspaceId: session.workspace.id, kind: "documents", name: filename, subtitle: `${(bytes.length / 1024).toFixed(1)} KB`, status: "Available", category, owner: session.user.name, details: { size: bytes.length, contentType, version: 1 } }).returning();
      await tx.insert(files).values({ workspaceId: session.workspace.id, recordId: r.id, filename, contentType, size: bytes.length, content: Buffer.from(bytes).toString("base64") });
      await tx.insert(auditEvents).values({ workspaceId: session.workspace.id, actor: session.user.name, action: "document.uploaded", subject: filename, metadata: { kind: "documents", recordId: r.id, size: bytes.length } });
      return r;
    });
    return Response.json(record, { status: 201 });
  } catch (e) { return apiError(e); }
}
