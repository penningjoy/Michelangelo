import { getProposedEdges, isGraphEnabled, type ProposedEdge } from "../../../lib/graph";
import { getPoolIfAvailable } from "../../../lib/storage";

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

export async function GET() {
  if (!isGraphEnabled()) {
    return Response.json({ proposals: [] });
  }

  const edges = await getProposedEdges(50);
  const pool = getPoolIfAvailable();
  if (!pool || edges.length === 0) {
    const proposals = edges.map((edge) => ({ ...edge, citations: [] }));
    return Response.json({ proposals });
  }

  const allInsightIds = Array.from(new Set(edges.flatMap((edge) => edge.citedInsights)));
  const citations = allInsightIds.length > 0 ? await lookupCitations(pool, allInsightIds) : new Map();

  const proposals: ConnectionProposal[] = edges.map((edge) => ({
    ...edge,
    citations: edge.citedInsights
      .map((id) => citations.get(id))
      .filter((c): c is ConnectionCitation => Boolean(c))
  }));
  return Response.json({ proposals });
}

async function lookupCitations(
  pool: import("pg").Pool,
  insightIds: string[]
): Promise<Map<string, ConnectionCitation>> {
  const result = new Map<string, ConnectionCitation>();

  const mentions = await pool.query<{
    insight_id: string;
    session_id: string;
    turn_index: number;
  }>(
    `select distinct on (insight_id) insight_id, session_id, turn_index
       from concept_mentions
       where insight_id = any($1::text[])
       order by insight_id, created_at desc`,
    [insightIds]
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
       where session_id = any($1::text[]) and type = 'insights'`,
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
