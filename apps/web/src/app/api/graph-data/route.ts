import { getGraphSnapshot, isGraphEnabled } from "../../../lib/graph";
import { requireDemoPrincipal } from "../../../lib/demoAccess";
import { getPoolIfAvailable, listConceptsForOwner, listOwnedConceptIds, listSessionConceptIds } from "../../../lib/storage";
import { getCache } from "../../../lib/cache";
import { graphDataCacheKey } from "../../../lib/cacheKeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRAPH_TTL_SECONDS = 60;

type ContentMapNode = {
  id: string;
  label: string;
  mentionCount: number;
};

type ContentMapEdge = {
  edgeId: string;
  fromId: string;
  toId: string;
  type: "co-occurs" | "analogous-to" | "generalizes" | "tension-with" | "enables" | "contrasts";
  source: "co-occurrence" | "accepted-graph";
  strength: number;
};

const HOME_CONCEPT_LIMIT = 24;
const SESSION_CONCEPT_LIMIT = 16;
const EDGE_LIMIT = 72;

export async function GET(request: Request) {
  const access = requireDemoPrincipal(request);
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const pool = getPoolIfAvailable();

  if (!pool) {
    return Response.json({
      nodes: [],
      edges: [],
      seedIds: [],
      enabled: false,
      source: "unavailable",
      reason: "Postgres is unavailable."
    });
  }

  const cache = getCache();
  const cached = await cache.get<unknown>(graphDataCacheKey(access.principal, sessionId));
  if (cached) {
    return Response.json(cached);
  }

  const seedIds = await resolveSeedIds(access.principal, sessionId);
  const ownerConcepts = await listConceptsForOwner(
    access.principal,
    sessionId ? SESSION_CONCEPT_LIMIT : HOME_CONCEPT_LIMIT
  );
  const candidateIds = Array.from(new Set([...seedIds, ...ownerConcepts.map((concept) => concept.id)]));

  if (candidateIds.length === 0) {
    return Response.json({
      nodes: [],
      edges: [],
      seedIds: [],
      enabled: true,
      source: "postgres"
    });
  }

  const [nodes, coOccurrenceEdges] = await Promise.all([
    loadNodes(pool, access.principal, candidateIds),
    loadCoOccurrenceEdges(pool, access.principal, candidateIds)
  ]);

  const mergedNodes = new Map(nodes.map((node) => [node.id, node]));
  const mergedEdges = new Map<string, ContentMapEdge>();

  for (const edge of coOccurrenceEdges) {
    mergedEdges.set(makeEdgeKey(edge.fromId, edge.toId), edge);
  }

  let source: "postgres" | "postgres+neo4j" = "postgres";
  if (isGraphEnabled()) {
    const graphSeedIds = seedIds.length > 0 ? seedIds : candidateIds.slice(0, 10);
    const graphSnapshot = await getGraphSnapshot(graphSeedIds);
    if (graphSnapshot.nodes.length > 0 || graphSnapshot.edges.length > 0) {
      const ownedIds = await listOwnedConceptIds(access.principal);
      for (const node of graphSnapshot.nodes) {
        if (!ownedIds.has(node.id)) continue;
        const existing = mergedNodes.get(node.id);
        mergedNodes.set(node.id, existing ?? node);
      }
      for (const edge of graphSnapshot.edges) {
        if (!ownedIds.has(edge.fromId) || !ownedIds.has(edge.toId)) continue;
        mergedEdges.set(makeEdgeKey(edge.fromId, edge.toId), {
          edgeId: edge.edgeId,
          fromId: edge.fromId,
          toId: edge.toId,
          type: edge.type,
          source: "accepted-graph",
          strength: 1
        });
      }
      source = "postgres+neo4j";
    }
  }

  const orderedNodes = Array.from(mergedNodes.values()).sort(
    (a, b) => b.mentionCount - a.mentionCount || a.label.localeCompare(b.label)
  );
  const visibleNodeIds = new Set(orderedNodes.map((node) => node.id));
  const orderedEdges = Array.from(mergedEdges.values())
    .filter((edge) => visibleNodeIds.has(edge.fromId) && visibleNodeIds.has(edge.toId))
    .sort(
      (a, b) =>
        Number(b.source === "accepted-graph") - Number(a.source === "accepted-graph") ||
        b.strength - a.strength ||
        a.fromId.localeCompare(b.fromId) ||
        a.toId.localeCompare(b.toId)
    )
    .slice(0, EDGE_LIMIT);

  const payload = {
    nodes: orderedNodes,
    edges: orderedEdges,
    seedIds: seedIds.filter((id) => visibleNodeIds.has(id)),
    enabled: true,
    source
  };
  void cache.set(graphDataCacheKey(access.principal, sessionId), payload, GRAPH_TTL_SECONDS).catch(
    () => undefined
  );
  return Response.json(payload);
}

async function resolveSeedIds(owner: string, sessionId: string | null): Promise<string[]> {
  if (sessionId) {
    return listSessionConceptIds(sessionId, owner);
  }
  const concepts = await listConceptsForOwner(owner, HOME_CONCEPT_LIMIT);
  return concepts.slice(0, 8).map((concept) => concept.id);
}

async function loadNodes(
  pool: import("pg").Pool,
  owner: string,
  conceptIds: string[]
): Promise<ContentMapNode[]> {
  const result = await pool.query<{ id: string; label: string; mention_count: number }>(
    `select c.id, c.label, count(*)::int as mention_count
       from concepts c
       join concept_mentions cm on cm.concept_id = c.id
       join sessions s on s.id = cm.session_id
      where s.owner = $1 and c.id = any($2::text[])
      group by c.id, c.label
      order by mention_count desc, c.label asc`,
    [owner, conceptIds]
  );

  return result.rows.map((row) => ({
    id: row.id,
    label: row.label,
    mentionCount: Number(row.mention_count)
  }));
}

async function loadCoOccurrenceEdges(
  pool: import("pg").Pool,
  owner: string,
  conceptIds: string[]
): Promise<ContentMapEdge[]> {
  const result = await pool.query<{
    from_id: string;
    to_id: string;
    shared_sessions: number;
  }>(
    `with scoped as (
       select distinct cm.session_id, cm.concept_id
         from concept_mentions cm
         join sessions s on s.id = cm.session_id
        where s.owner = $1 and cm.concept_id = any($2::text[])
     )
     select a.concept_id as from_id,
            b.concept_id as to_id,
            count(*)::int as shared_sessions
       from scoped a
       join scoped b
         on a.session_id = b.session_id
        and a.concept_id < b.concept_id
      group by a.concept_id, b.concept_id
      order by shared_sessions desc, from_id asc, to_id asc
      limit $3`,
    [owner, conceptIds, EDGE_LIMIT]
  );

  return result.rows.map((row) => ({
    edgeId: `co:${row.from_id}:${row.to_id}`,
    fromId: row.from_id,
    toId: row.to_id,
    type: "co-occurs",
    source: "co-occurrence",
    strength: Number(row.shared_sessions)
  }));
}

function makeEdgeKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}
