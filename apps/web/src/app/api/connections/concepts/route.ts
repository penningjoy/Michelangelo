import { getPoolIfAvailable } from "../../../../lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ConceptOption = {
  id: string;
  label: string;
  mentionCount: number;
};

export async function GET() {
  const pool = getPoolIfAvailable();
  if (!pool) return Response.json({ concepts: [] });
  const result = await pool.query<{ id: string; label: string; mention_count: number }>(
    `select id, label, mention_count from concepts order by mention_count desc, label asc limit 500`
  );
  const concepts: ConceptOption[] = result.rows.map((row) => ({
    id: row.id,
    label: row.label,
    mentionCount: Number(row.mention_count)
  }));
  return Response.json({ concepts });
}
