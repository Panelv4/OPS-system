import { config } from "@/opspilot/server/config";
import { checkTickAuth, runDueJobs, MAX_JOBS_PER_TICK } from "@/opspilot/server/jobs";
import { apiError } from "@/opspilot/server/security";
import { logError, logWarn } from "@/opspilot/server/log";

export const dynamic = "force-dynamic";

/**
 * Runs due background jobs. Call this from a cron (every minute) with
 * `Authorization: Bearer $JOBS_TICK_SECRET`.
 *
 * Safe to call from several schedulers at once: jobs are claimed with
 * `FOR UPDATE SKIP LOCKED`, so a tick never runs a job another tick owns.
 */
export async function POST(request: Request) {
  try {
    const { jobsSecret } = config();
    const auth = checkTickAuth(request.headers.get("authorization"), jobsSecret);
    if (!auth.ok) {
      if (auth.status === 401) logWarn("jobs.tick_unauthorised", { ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() });
      return Response.json({ error: auth.error, notice: auth.notice }, { status: auth.status });
    }

    const requested = Number(new URL(request.url).searchParams.get("limit") ?? MAX_JOBS_PER_TICK);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(1, Math.trunc(requested)), MAX_JOBS_PER_TICK) : MAX_JOBS_PER_TICK;
    const summary = await runDueJobs({ limit });
    return Response.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logError("jobs.tick_failed", error);
    return apiError(error);
  }
}
