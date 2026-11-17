import { apiError, assertOrigin, requireSession, readJson, rateLimit } from "@/opspilot/server/security";
import { createRecord } from "@/opspilot/server/repository";
export async function POST(request: Request) {
  try { assertOrigin(request); const session = await requireSession(); await rateLimit(`write:${session.user.id}`, 120); const record = await createRecord(session, await readJson(request)); return Response.json(record, { status: 201 }); }
  catch (e) { return apiError(e); }
}
