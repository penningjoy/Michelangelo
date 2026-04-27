import { requireDemoPrincipal } from "../../../lib/demoAccess";
import { getGraphSnapshot, isGraphEnabled } from "../../../lib/graph";
import {
  getPoolIfAvailable,
  listConceptsForOwner,
  listOwnedConceptIds,
  listSessionConceptIds
} from "../../../lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = requireDemoPrincipal(request);
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!isGraphEnabled()) {
    return Response.json({ nodes: [], edges: [], enabled: false });
  }

  const pool = getPoolIfAvailable();
  if (!pool) {
    return Response.json({ nodes: [], edges: [], enabled: true });
  }

  const seedIds = await resolveSeedIds(access.principal, sessionId);
  if (seedIds.length === 0) {
    return Response.json({ nodes: [], edges: [], enabled: true });
  }

  const snapshot = await getGraphSnapshot(seedIds);
  const allowedConceptIds = await listOwnedConceptIds(access.principal);
  const nodes = snapshot.nodes.filter((node) => allowedConceptIds.has(node.id));
  const allowedNodeIds = new Set(nodes.map((node) => node.id));
  const edges = snapshot.edges.filter(
    (edge) => allowedNodeIds.has(edge.fromId) && allowedNodeIds.has(edge.toId)
  );
  return Response.json({
    nodes,
    edges,
    seedIds: seedIds.filter((id) => allowedNodeIds.has(id)),
    enabled: true
  });
}

async function resolveSeedIds(owner: string, sessionId: string | null): Promise<string[]> {
  if (sessionId) {
    return listSessionConceptIds(sessionId, owner);
  }
  const concepts = await listConceptsForOwner(owner, 40);
  return concepts.map((concept) => concept.id);
}
