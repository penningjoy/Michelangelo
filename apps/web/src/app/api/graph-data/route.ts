import { getGraphSnapshot, isGraphEnabled } from "../../../lib/graph";
import { getPoolIfAvailable } from "../../../lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!isGraphEnabled()) {
    return Response.json({ nodes: [], edges: [], enabled: false });
  }

  const pool = getPoolIfAvailable();
  if (!pool) {
    return Response.json({ nodes: [], edges: [], enabled: true });
  }

  const seedIds = await resolveSeedIds(pool, sessionId);
  if (seedIds.length === 0) {
    return Response.json({ nodes: [], edges: [], enabled: true });
  }

  const snapshot = await getGraphSnapshot(seedIds);
  return Response.json({ ...snapshot, seedIds, enabled: true });
}

async function resolveSeedIds(
  pool: import("pg").Pool,
  sessionId: string | null
): Promise<string[]> {
  if (sessionId) {
    const result = await pool.query<{ concept_id: string }>(
      `select distinct concept_id from concept_mentions where session_id = $1`,
      [sessionId]
    );
    return result.rows.map((row) => row.concept_id);
  }
  const result = await pool.query<{ id: string }>(
    `select id from concepts order by mention_count desc limit 40`
  );
  return result.rows.map((row) => row.id);
}
