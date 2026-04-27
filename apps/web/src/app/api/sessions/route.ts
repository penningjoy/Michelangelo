import { requireDemoPrincipal } from "../../../lib/demoAccess";
import { listSessions } from "../../../lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = requireDemoPrincipal(request);
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  try {
    const sessions = await listSessions(access.principal, 50);
    return Response.json({ sessions });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not list sessions." },
      { status: 500 }
    );
  }
}
