import { requireDemoPrincipal } from "../../../lib/demoAccess";
import { listSessions } from "../../../lib/storage";
import { getCache } from "../../../lib/cache";
import { sessionsListCacheKey } from "../../../lib/cacheKeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSIONS_TTL_SECONDS = 30;

export async function GET(request: Request) {
  const access = requireDemoPrincipal(request);
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  try {
    const cache = getCache();
    const sessions = await cache.getOrSet(
      sessionsListCacheKey(access.principal),
      SESSIONS_TTL_SECONDS,
      () => listSessions(access.principal, 50)
    );
    return Response.json({ sessions });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not list sessions." },
      { status: 500 }
    );
  }
}
