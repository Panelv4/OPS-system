import { jobOverview } from "@/opspilot/server/jobs";
import { requireSession, apiError } from "@/opspilot/server/security";
import { ApiError } from "@/opspilot/server/security";

export const dynamic = "force-dynamic";

/** Run history for the current workspace's operators (T-405). */
export async function GET() {
  try {
    const session = await requireSession();
    if (!["owner", "administrator"].includes(session.role)) {
      throw new ApiError(403, "Only workspace owners or administrators can view job history.");
    }
    const overview = await jobOverview();
    return Response.json(overview, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
