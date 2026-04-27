import { requireDemoPrincipal } from "../../../../lib/demoAccess";
import { listConceptsForOwner } from "../../../../lib/storage";
import { getCache } from "../../../../lib/cache";
import { conceptsListCacheKey } from "../../../../lib/cacheKeys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONCEPTS_TTL_SECONDS = 30;

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

  const cache = getCache();
  const concepts = await cache.getOrSet<ConceptOption[]>(
    conceptsListCacheKey(access.principal),
    CONCEPTS_TTL_SECONDS,
    async () =>
      (await listConceptsForOwner(access.principal, 500)).map((concept) => ({
        id: concept.id,
        label: concept.label,
        mentionCount: concept.mentionCount
      }))
  );
  return Response.json({ concepts });
}
