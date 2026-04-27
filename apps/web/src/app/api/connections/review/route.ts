import { z } from "zod";
import { requireDemoPrincipal } from "../../../../lib/demoAccess";
import { getEdgeById, isGraphEnabled, updateEdgeStatus } from "../../../../lib/graph";
import { listOwnedConceptIds } from "../../../../lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RELATION_TYPES = [
  "analogous-to",
  "generalizes",
  "tension-with",
  "enables",
  "contrasts"
] as const;

const reviewSchema = z.object({
  edgeId: z.string().min(1),
  action: z.enum(["accept", "reject"]),
  type: z.enum(RELATION_TYPES).optional(),
  note: z.string().max(500).optional()
});

export async function POST(request: Request) {
  const access = requireDemoPrincipal(request);
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }
  if (!isGraphEnabled()) {
    return Response.json({ error: "Graph is not configured." }, { status: 503 });
  }
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid review payload." }, { status: 400 });
  }

  const { edgeId, action, type, note } = parsed.data;
  const edge = await getEdgeById(edgeId);
  if (!edge) {
    return Response.json({ error: "Connection not found." }, { status: 404 });
  }
  const ownedConceptIds = await listOwnedConceptIds(access.principal, [edge.fromId, edge.toId]);
  if (!ownedConceptIds.has(edge.fromId) || !ownedConceptIds.has(edge.toId)) {
    return Response.json({ error: "Connection not found." }, { status: 404 });
  }
  await updateEdgeStatus({
    edgeId,
    status: action === "accept" ? "accepted" : "rejected",
    type,
    note
  });
  return Response.json({ ok: true });
}
