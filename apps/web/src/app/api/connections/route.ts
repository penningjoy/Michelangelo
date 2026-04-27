import { requireDemoPrincipal } from "../../../lib/demoAccess";
import { getProposedEdges, isGraphEnabled, type ProposedEdge } from "../../../lib/graph";
import { getPoolIfAvailable, listOwnedConceptIds } from "../../../lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ConnectionCitation = {
  insightId: string;
  claim: string;
  sessionId: string;
  sessionTitle: string;
  turnIndex: number;
};

export type ConnectionProposal = ProposedEdge & {
  citations: ConnectionCitation[];
};

export async function GET(request: Request) {
  const access = requireDemoPrincipal(request);
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  if (!isGraphEnabled()) {
    return Response.json({ proposals: [] });
  }

  const edges = await getProposedEdges(50);
  const pool = getPoolIfAvailable();
  if (!pool || edges.length === 0) {
    return Response.json({ proposals: [] });
  }

  const candidateConceptIds = Array.from(
    new Set(edges.flatMap((edge) => [edge.fromId, edge.toId]))
  );
  const ownedConceptIds = await listOwnedConceptIds(access.principal, candidateConceptIds);
  const visibleEdges = edges.filter(
    (edge) => ownedConceptIds.has(edge.fromId) && ownedConceptIds.has(edge.toId)
  );
  if (visibleEdges.length === 0) {
    return Response.json({ proposals: [] });
  }

  const allInsightIds = Array.from(new Set(visibleEdges.flatMap((edge) => edge.citedInsights)));
  const citations =
    allInsightIds.length > 0
      ? await lookupCitations(pool, access.principal, allInsightIds)
      : new Map();

  const proposals: ConnectionProposal[] = visibleEdges.map((edge) => ({
    ...edge,
    citations: edge.citedInsights
      .map((id) => citations.get(id))
      .filter((c): c is ConnectionCitation => Boolean(c))
  }));
  return Response.json({ proposals });
}

async function lookupCitations(
  pool: import("pg").Pool,
  owner: string,
  insightIds: string[]
): Promise<Map<string, ConnectionCitation>> {
  const result = new Map<string, ConnectionCitation>();

  const mentions = await pool.query<{
    insight_id: string;
    session_id: string;
    turn_index: number;
  }>(
    `select distinct on (cm.insight_id) cm.insight_id, cm.session_id, cm.turn_index
       from concept_mentions cm
       join sessions s on s.id = cm.session_id
       where cm.insight_id = any($1::text[]) and s.owner = $2
       order by cm.insight_id, cm.created_at desc`,
    [insightIds, owner]
  );

  const sessionIds = Array.from(new Set(mentions.rows.map((row) => row.session_id)));
  const titles = await pool.query<{ id: string; title: string }>(
    `select id, title from sessions where id = any($1::text[])`,
    [sessionIds]
  );
  const titleById = new Map(titles.rows.map((row) => [row.id, row.title]));

  const artifacts = await pool.query<{
    session_id: string;
    content_json: Array<{ id: string; claim: string }>;
  }>(
    `select session_id, content_json from artifacts
       where session_id = any($1::text[]) and type = 'claims'`,
    [sessionIds]
  );
  const claimsBySession = new Map<string, Map<string, string>>();
  for (const row of artifacts.rows) {
    const inner = new Map<string, string>();
    for (const insight of row.content_json) inner.set(insight.id, insight.claim);
    claimsBySession.set(row.session_id, inner);
  }

  for (const mention of mentions.rows) {
    const claim = claimsBySession.get(mention.session_id)?.get(mention.insight_id);
    const sessionTitle = titleById.get(mention.session_id);
    if (!claim || !sessionTitle) continue;
    result.set(mention.insight_id, {
      insightId: mention.insight_id,
      claim,
      sessionId: mention.session_id,
      sessionTitle,
      turnIndex: mention.turn_index
    });
  }

  return result;
}
