import { requireDemoPrincipal } from "../../../../lib/demoAccess";
import { listConceptsForOwner } from "../../../../lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ConceptOption = {
  id: string;
  label: string;
  mentionCount: number;
};

export async function GET(request: Request) {
  const access = requireDemoPrincipal(request);
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  const concepts: ConceptOption[] = (await listConceptsForOwner(access.principal, 500)).map(
    (concept) => ({
      id: concept.id,
      label: concept.label,
      mentionCount: concept.mentionCount
    })
  );
  return Response.json({ concepts });
}
