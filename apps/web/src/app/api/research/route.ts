import { streamResearchResult } from "../../../lib/provider";
import type { ResearchResult } from "../../../lib/schemas";
import { researchArtifactsSchema, researchRequestSchema } from "../../../lib/schemas";
import { requireDemoPrincipal } from "../../../lib/demoAccess";
import { getServerOpenAiKey } from "../../../lib/serverOpenAiKey";
import {
  addMessage,
  createSession,
  getLastResponseId,
  getPoolIfAvailable,
  getSession,
  hasVectorSupport,
  listArtifacts,
  listMessages,
  listTurnSummaries,
  persistTurn,
  setLastResponseId,
  updateMessageConceptSpans
} from "../../../lib/storage";
import {
  backfillConceptEmbeddings,
  computeConceptSpans,
  formatCrossDomainPromptBlock,
  retrieveCrossDomainContext
} from "../../../lib/retrieval";
import { runCurator, type TurnConcept } from "../../../lib/curator";
import { upsertConcepts } from "../../../lib/graph";
import { getCache } from "../../../lib/cache";
import {
  conceptsListCacheKey,
  graphDataCacheKey,
  sessionsListCacheKey
} from "../../../lib/cacheKeys";
import type { ResearchArtifacts, ResearchEvent } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = requireDemoPrincipal(request);
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  const parsed = researchRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "A valid prompt is required." }, { status: 400 });
  }

  const principal = access.principal;
  const { prompt, sessionId, depth, forceFounderMode } = parsed.data;
  const clientKey = parsed.data.apiKey?.trim();
  const effectiveKey = clientKey || getServerOpenAiKey();
  if (!effectiveKey) {
    return Response.json(
      { error: "Add OPENAI_API_KEY to the server environment or paste a key in Settings." },
      { status: 400 }
    );
  }
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ResearchEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const session = sessionId
          ? await getSession(sessionId, principal)
          : await createSession(titleFromPrompt(prompt), principal);

        if (!session) {
          send({ type: "error", message: "Unknown session." });
          controller.close();
          return;
        }

        send({ type: "session", session });

        // Capture strictly prior turns BEFORE persisting the current user prompt,
        // so the provider isn't given the current question twice.
        const previousResponseId = await getLastResponseId(session.id, principal);
        // When threading via previous_response_id, the model already has the
        // transcript and full artifacts in its server-side state, so we skip
        // the read from Postgres entirely. Summaries stay cheap and useful
        // either way (used for the cold-path prompt prefix).
        const [priorMessages, priorArtifacts, priorTurnSummaries] = await Promise.all([
          previousResponseId ? Promise.resolve([]) : listMessages(session.id, principal),
          previousResponseId
            ? Promise.resolve(null)
            : listArtifacts(session.id, principal).then(artifactsFromRows),
          listTurnSummaries(session.id, principal)
        ]);
        const turnIndex = priorTurnSummaries.length + 1;

        send({ type: "status", message: "Saving prompt..." });
        await addMessage(session.id, "user", prompt);

        send({ type: "status", message: "Looking for related concepts from prior sessions..." });
        const crossDomainHits = await retrieveCrossDomainContext({
          apiKey: effectiveKey,
          owner: principal,
          userPrompt: prompt,
          currentSessionId: session.id,
          pool: getPoolIfAvailable() ?? undefined,
          hasVector: hasVectorSupport()
        });
        const crossDomainBlock = formatCrossDomainPromptBlock(crossDomainHits);

        send({ type: "status", message: "Researching and structuring artifacts..." });

        let finalResult: ResearchResult | null = null;
        let nextResponseId: string | null = null;

        for await (const event of streamResearchResult({
          apiKey: effectiveKey,
          prompt,
          priorMessages,
          priorArtifacts,
          priorTurnSummaries,
          crossDomainBlock,
          depth,
          forceFounderMode,
          previousResponseId
        })) {
          if (event.type === "answer-delta") {
            send({ type: "delta", text: event.text });
          } else if (event.type === "complete") {
            finalResult = event.result;
            nextResponseId = event.responseId;
          }
        }

        if (!finalResult) {
          send({ type: "error", message: "The model did not return a complete response." });
          controller.close();
          return;
        }

        const assistantMessage = await addMessage(session.id, "assistant", finalResult.answer);

        const compact = finalResult.compact ?? {
          gist: finalResult.answer.slice(0, 240),
          keyClaims: finalResult.artifacts.claims.slice(0, 4).map((claim) => claim.claim)
        };
        const conceptsByInsight = Object.fromEntries(
          finalResult.artifacts.claims.map((claim) => [claim.id, finalResult.artifacts.concepts])
        );

        await persistTurn(session.id, {
          turnIndex,
          artifacts: finalResult.artifacts,
          compact,
          conceptsByInsight
        });
        // Persist the new response.id only after the turn is fully stored so we
        // never thread an id whose context isn't reflected in our own data.
        if (nextResponseId) {
          await setLastResponseId(session.id, nextResponseId).catch(() => undefined);
        }
        // Invalidate read caches that this turn just made stale. Sidebar
        // ordering changes (touched session goes to top), the concept list
        // gets new mentions, and the graph picks up new nodes.
        const cache = getCache();
        void Promise.all([
          cache.del(sessionsListCacheKey(principal)),
          cache.del(conceptsListCacheKey(principal)),
          cache.del(graphDataCacheKey(principal, null)),
          cache.del(graphDataCacheKey(principal, session.id))
        ]).catch(() => undefined);
        send({ type: "artifacts", artifacts: finalResult.artifacts });

        // Concept spans for inline memory underlines: match labels of concepts
        // that have prior cross-domain mentions against the final answer text.
        const conceptInfo = crossDomainHits.map((hit) => ({
          label: hit.conceptLabel,
          priorClaim: hit.priorClaim,
          priorSessionTitle: hit.priorSessionTitle,
          priorTurnIndex: hit.priorTurnIndex
        }));
        const spans = computeConceptSpans(finalResult.answer, conceptInfo);
        if (spans.length > 0) {
          const hydrated = spans.map((span) => {
            const hit = crossDomainHits.find((h) => h.conceptLabel === span.conceptLabel);
            return {
              start: span.start,
              end: span.end,
              conceptLabel: span.conceptLabel,
              priorClaim: hit?.priorClaim,
              priorSessionTitle: hit?.priorSessionTitle,
              priorTurnIndex: hit?.priorTurnIndex
            };
          });
          send({ type: "concept-spans", spans: hydrated });
          await updateMessageConceptSpans(session.id, assistantMessage.id, hydrated);
        }

        send({ type: "done", sessionId: session.id });

        // Fire-and-forget: make this turn's concepts exist as :Concept nodes
        // in Neo4j so the brain map shows them immediately — regardless of
        // whether the curator (next block) proposes any edges for them.
        const allConceptSlugs = Array.from(
          new Set(finalResult.artifacts.concepts)
        );
        void upsertConcepts(allConceptSlugs);

        // Fire-and-forget: embed any new concept labels for future vector retrieval.
        const pool = getPoolIfAvailable();
        if (pool && hasVectorSupport()) {
          void backfillConceptEmbeddings(pool, effectiveKey, allConceptSlugs);
        }

        // Fire-and-forget: the curator proposes typed edges between this
        // turn's concepts and their nearest neighbors from other sessions.
        if (pool) {
          const turnConcepts: TurnConcept[] = [];
          const seen = new Set<string>();
          for (const claim of finalResult.artifacts.claims) {
            for (const concept of finalResult.artifacts.concepts) {
              if (seen.has(concept)) continue;
              seen.add(concept);
              turnConcepts.push({
                id: concept,
                label: concept,
                currentClaim: claim.claim,
                currentInsightId: claim.id
              });
            }
          }
          void runCurator({
            apiKey: effectiveKey,
            owner: principal,
            sessionId: session.id,
            turnConcepts,
            pool,
            hasVector: hasVectorSupport()
          });
        }
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Research request failed."
        });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform"
    }
  });
}

function artifactsFromRows(
  rows: Awaited<ReturnType<typeof listArtifacts>>
): ResearchArtifacts | null {
  if (rows.length === 0) return null;
  const partial = Object.fromEntries(rows.map((row) => [row.type, row.content]));
  const parsed = researchArtifactsSchema.safeParse(partial);
  return parsed.success ? parsed.data : null;
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split("\n").find(Boolean) ?? "Untitled research";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}
