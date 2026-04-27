import { z } from "zod";
import { requireDemoPrincipal } from "../../../../lib/demoAccess";
import { isGraphEnabled, upsertConcept, upsertRelation } from "../../../../lib/graph";
import { getPoolIfAvailable, listOwnedConceptIds } from "../../../../lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RELATION_TYPES = [
  "analogous-to",
  "generalizes",
  "tension-with",
  "enables",
  "contrasts"
] as const;

const manualSchema = z.object({
  fromConceptId: z.string().min(1),
  toConceptId: z.string().min(1),
  type: z.enum(RELATION_TYPES),
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
  const parsed = manualSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid edge payload." }, { status: 400 });
  }
  const { fromConceptId, toConceptId, type, note } = parsed.data;
  if (fromConceptId === toConceptId) {
    return Response.json({ error: "Cannot relate a concept to itself." }, { status: 400 });
  }

  const pool = getPoolIfAvailable();
  if (!pool) {
    return Response.json({ error: "Graph storage is not configured." }, { status: 503 });
  }
  const ownedConceptIds = await listOwnedConceptIds(access.principal, [fromConceptId, toConceptId]);
  if (!ownedConceptIds.has(fromConceptId) || !ownedConceptIds.has(toConceptId)) {
    return Response.json({ error: "Concept not found." }, { status: 404 });
  }
  const labels = await lookupLabels(pool, [fromConceptId, toConceptId]);

  await upsertConcept({ id: fromConceptId, label: labels.get(fromConceptId) ?? fromConceptId });
  await upsertConcept({ id: toConceptId, label: labels.get(toConceptId) ?? toConceptId });
  await upsertRelation({
    fromId: fromConceptId,
    toId: toConceptId,
    type,
    rationale: note ?? "",
    citedInsights: [],
    confidence: 1.0,
    createdBy: "user",
    status: "accepted"
  });
  return Response.json({ ok: true });
}

async function lookupLabels(
  pool: import("pg").Pool | null,
  ids: string[]
): Promise<Map<string, string>> {
  if (!pool) return new Map();
  const result = await pool.query<{ id: string; label: string }>(
    `select id, label from concepts where id = any($1::text[])`,
    [ids]
  );
  return new Map(result.rows.map((row) => [row.id, row.label]));
}
