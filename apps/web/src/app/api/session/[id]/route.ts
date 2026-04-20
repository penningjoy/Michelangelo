import { z } from "zod";
import {
  getLastTurnSummary,
  getSession,
  listArtifacts,
  listMessages,
  renameSession
} from "../../../../lib/storage";
import type { ResearchArtifacts } from "../../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().min(1).max(200)
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Title must be 1–200 characters." }, { status: 400 });
  }

  const updated = await renameSession(id, parsed.data.title.trim());
  if (!updated) {
    return Response.json({ error: "Session not found." }, { status: 404 });
  }
  return Response.json({ session: updated });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return Response.json({ error: "Session not found." }, { status: 404 });

  const [messages, artifactRows, summary] = await Promise.all([
    listMessages(id),
    listArtifacts(id),
    getLastTurnSummary(id)
  ]);

  const partial = Object.fromEntries(artifactRows.map((row) => [row.type, row.content])) as Partial<
    Record<keyof ResearchArtifacts, unknown>
  >;
  const artifacts =
    partial.summary && partial.sources && partial.insights && partial.caveats
      ? (partial as ResearchArtifacts)
      : null;

  return Response.json({
    session,
    messages,
    artifacts,
    lastTurnGist: summary?.gist ?? null
  });
}
