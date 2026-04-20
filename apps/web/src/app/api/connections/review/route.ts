import { z } from "zod";
import { isGraphEnabled, updateEdgeStatus } from "../../../../lib/graph";

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
  if (!isGraphEnabled()) {
    return Response.json({ error: "Graph is not configured." }, { status: 503 });
  }
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid review payload." }, { status: 400 });
  }

  const { edgeId, action, type, note } = parsed.data;
  await updateEdgeStatus({
    edgeId,
    status: action === "accept" ? "accepted" : "rejected",
    type,
    note
  });
  return Response.json({ ok: true });
}
