import OpenAI from "openai";
import type { Pool } from "pg";
import { z } from "zod";
import { getCache } from "./cache";
import { embedText } from "./retrieval";
import { getServerEnv } from "./serverEnv";
import {
  findEdge,
  isGraphEnabled,
  upsertConcept,
  upsertRelation,
  type RelationType
} from "./graph";

const NEIGHBOR_TTL_SECONDS = 60 * 10; // 10 min

/**
 * The curator agent. Runs after each persisted turn. For every concept the
 * turn emitted, finds up to TOP_K nearest neighbors by embedding (from OTHER
 * concepts in the store) and asks a small model whether there is a real
 * cross-disciplinary relation. Proposals land in Neo4j as `status: proposed`,
 * awaiting human review.
 *
 * Fire-and-forget: never throws, never blocks the research response.
 */

const CURATOR_MODEL = getServerEnv("OPENAI_MODEL_CURATOR") || "gpt-5.2-mini";
const TOP_K_NEIGHBORS = 3;
const MAX_PAIRS_PER_TURN = 12;

const RELATION_TYPES = [
  "analogous-to",
  "generalizes",
  "tension-with",
  "enables",
  "contrasts"
] as const;

const proposalSchema = z.object({
  proposal: z.union([
    z.null(),
    z.object({
      type: z.enum(RELATION_TYPES),
      rationale: z.string().min(1).max(500),
      confidence: z.number().min(0).max(1)
    })
  ])
});

export type TurnConcept = {
  id: string;
  label: string;
  currentClaim: string;
  currentInsightId: string;
};

export type CuratorInput = {
  apiKey: string;
  owner: string;
  sessionId: string;
  turnConcepts: TurnConcept[];
  pool: Pool;
  hasVector: boolean;
};

export async function runCurator(input: CuratorInput): Promise<{ proposed: number }> {
  try {
    if (!isGraphEnabled()) return { proposed: 0 };
    if (input.turnConcepts.length === 0) return { proposed: 0 };
    if (isMockMode(input.apiKey)) return runMockCurator(input);

    const pairs = await buildCandidatePairs(input);
    if (pairs.length === 0) return { proposed: 0 };

    const client = new OpenAI({ apiKey: input.apiKey });
    let proposed = 0;

    for (const pair of pairs.slice(0, MAX_PAIRS_PER_TURN)) {
      const result = await proposeRelation(client, pair).catch(() => null);
      if (!result || !result.proposal) continue;

      await upsertConcept({ id: pair.a.id, label: pair.a.label });
      await upsertConcept({ id: pair.b.id, label: pair.b.label });
      await upsertRelation({
        fromId: pair.a.id,
        toId: pair.b.id,
        type: result.proposal.type,
        rationale: result.proposal.rationale,
        citedInsights: [pair.a.insightId, pair.b.insightId].filter(Boolean),
        confidence: result.proposal.confidence,
        createdBy: "agent",
        status: "proposed"
      });
      proposed += 1;
    }

    return { proposed };
  } catch {
    return { proposed: 0 };
  }
}

type CandidatePair = {
  a: { id: string; label: string; claim: string; insightId: string };
  b: { id: string; label: string; claim: string; insightId: string };
};

async function buildCandidatePairs(input: CuratorInput): Promise<CandidatePair[]> {
  const { pool, hasVector, owner, sessionId, turnConcepts, apiKey } = input;
  const pairs: CandidatePair[] = [];
  const seen = new Set<string>();

  for (const concept of turnConcepts) {
    const neighbors = hasVector
      ? await vectorNeighbors(pool, apiKey, concept, owner, sessionId)
      : await labelNeighbors(pool, concept, owner, sessionId);

    for (const neighbor of neighbors) {
      const [lo, hi] = [concept.id, neighbor.id].sort();
      const key = `${lo}|${hi}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Skip pairs that already have any edge (proposed / accepted / rejected),
      // regardless of type. This keeps the curator from spinning on the same
      // pair every turn.
      const existing = await anyEdgeBetween(concept.id, neighbor.id);
      if (existing) continue;

      pairs.push({
        a: {
          id: concept.id,
          label: concept.label,
          claim: concept.currentClaim,
          insightId: concept.currentInsightId
        },
        b: {
          id: neighbor.id,
          label: neighbor.label,
          claim: neighbor.priorClaim,
          insightId: neighbor.priorInsightId
        }
      });
    }
  }

  return pairs;
}

async function vectorNeighbors(
  pool: Pool,
  apiKey: string,
  concept: TurnConcept,
  owner: string,
  currentSessionId: string
): Promise<NeighborClaim[]> {
  // Cache the neighbor IDs (not the hydrated claims) for 10 minutes. Within a
  // single turn the curator may revisit the same concept's neighbors when
  // multiple turn-concepts overlap. Across turns, neighbor sets shift slowly.
  const cache = getCache();
  const cacheKey = `nbr:${owner}:${concept.id}`;

  let neighborRows = await cache.get<Array<{ id: string; label: string }>>(cacheKey);

  if (!neighborRows) {
    // Reuses the embedText cache from retrieval.ts so the same concept label
    // doesn't get re-embedded across turns.
    const needle = concept.label.replace(/-/g, " ");
    const embedding = await embedText(apiKey, needle).catch(() => null);
    if (!embedding) return labelNeighbors(pool, concept, owner, currentSessionId);

    const vectorLiteral = `[${embedding.join(",")}]`;
    const rows = await pool.query<{ id: string; label: string }>(
      `select c.id, c.label
         from concepts c
        where c.embedding is not null
          and c.id <> $1
          and exists (
            select 1
              from concept_mentions cm
              join sessions s on s.id = cm.session_id
             where cm.concept_id = c.id and s.owner = $2
          )
         order by c.embedding <=> $3::vector
         limit $4`,
      [concept.id, owner, vectorLiteral, TOP_K_NEIGHBORS]
    );
    neighborRows = rows.rows;
    void cache.set(cacheKey, neighborRows, NEIGHBOR_TTL_SECONDS).catch(() => undefined);
  }

  return hydrateNeighbors(pool, neighborRows, owner, currentSessionId);
}

async function labelNeighbors(
  pool: Pool,
  concept: TurnConcept,
  owner: string,
  currentSessionId: string
): Promise<NeighborClaim[]> {
  const rows = await pool.query<{ id: string; label: string }>(
    `select c.id, c.label
       from concepts c
       join concept_mentions cm on cm.concept_id = c.id
       join sessions s on s.id = cm.session_id
      where c.id <> $1 and s.owner = $2
      group by c.id, c.label
      order by count(*) desc
      limit $3`,
    [concept.id, owner, TOP_K_NEIGHBORS]
  );
  return hydrateNeighbors(pool, rows.rows, owner, currentSessionId);
}

type NeighborClaim = {
  id: string;
  label: string;
  priorClaim: string;
  priorInsightId: string;
};

async function hydrateNeighbors(
  pool: Pool,
  rows: Array<{ id: string; label: string }>,
  owner: string,
  currentSessionId: string
): Promise<NeighborClaim[]> {
  const out: NeighborClaim[] = [];
  for (const row of rows) {
    const mention = await pool.query<{
      session_id: string;
      insight_id: string;
    }>(
      `select session_id, insight_id from concept_mentions
        where concept_id = $1 and session_id <> $2
          and session_id in (select id from sessions where owner = $3)
        order by created_at desc
        limit 1`,
      [row.id, currentSessionId, owner]
    );
    const first = mention.rows[0];
    if (!first) continue;
    const claim = await lookupClaim(pool, first.session_id, first.insight_id);
    if (!claim) continue;
    out.push({
      id: row.id,
      label: row.label,
      priorClaim: claim,
      priorInsightId: first.insight_id
    });
  }
  return out;
}

async function lookupClaim(pool: Pool, sessionId: string, insightId: string): Promise<string | null> {
  const result = await pool.query<{ content_json: { id: string; claim: string }[] }>(
    `select content_json from artifacts where session_id = $1 and type = 'claims' limit 1`,
    [sessionId]
  );
  const claims = result.rows[0]?.content_json ?? [];
  return claims.find((insight) => insight.id === insightId)?.claim ?? null;
}

async function anyEdgeBetween(aId: string, bId: string): Promise<boolean> {
  for (const type of RELATION_TYPES) {
    const existing = await findEdge(aId, bId, type as RelationType);
    if (existing) return true;
  }
  return false;
}

const CURATOR_INSTRUCTIONS = [
  "You curate cross-disciplinary links for a long-running research workspace.",
  "Given two concepts and one representative claim about each, decide whether there is a meaningful relation WORTH surfacing to the user.",
  "If the concepts share only surface/topical overlap or the link would feel forced, answer with proposal: null. Err on the side of null.",
  "If a relation is genuinely illuminating, pick EXACTLY ONE type from: analogous-to, generalizes, tension-with, enables, contrasts.",
  "Return strict JSON only. No markdown, no prose outside JSON.",
  "",
  "JSON shape:",
  "{",
  '  "proposal": null',
  "}",
  "or",
  "{",
  '  "proposal": {',
  '    "type": "analogous-to | generalizes | tension-with | enables | contrasts",',
  '    "rationale": "one sentence (≤300 chars) naming the precise bridge",',
  '    "confidence": 0.0 to 1.0',
  "  }",
  "}"
].join("\n");

async function proposeRelation(
  client: OpenAI,
  pair: CandidatePair
): Promise<z.infer<typeof proposalSchema> | null> {
  const payload = [
    "Concept A:",
    `  id: ${pair.a.id}`,
    `  label: ${pair.a.label}`,
    `  representative claim: "${pair.a.claim}"`,
    "",
    "Concept B:",
    `  id: ${pair.b.id}`,
    `  label: ${pair.b.label}`,
    `  representative claim: "${pair.b.claim}"`
  ].join("\n");

  // Structured output guarantees the model returns valid JSON matching our
  // schema, so we never fall through to the regex extraction path. The
  // instructions prefix is unchanged across calls within a turn, so OpenAI's
  // automatic prefix cache also kicks in here for the 12 sequential calls.
  const response = await client.responses.create({
    model: CURATOR_MODEL,
    instructions: CURATOR_INSTRUCTIONS,
    input: payload,
    text: {
      format: {
        type: "json_schema",
        name: "relation_proposal",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["proposal"],
          properties: {
            proposal: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "rationale", "confidence"],
                  properties: {
                    type: {
                      type: "string",
                      enum: [...RELATION_TYPES]
                    },
                    rationale: { type: "string", maxLength: 500 },
                    confidence: { type: "number", minimum: 0, maximum: 1 }
                  }
                }
              ]
            }
          }
        },
        strict: true
      }
    }
  });

  const text = extractOutputText(response);
  if (!text) return null;

  const json = parseJsonObject(text);
  const parsed = proposalSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function extractOutputText(response: unknown): string | null {
  const any = response as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  if (typeof any.output_text === "string" && any.output_text.length > 0) return any.output_text;
  const segments = any.output ?? [];
  for (const segment of segments) {
    for (const content of segment.content ?? []) {
      if (typeof content.text === "string" && content.text.length > 0) return content.text;
    }
  }
  return null;
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    return null;
  }
}

function isMockMode(apiKey: string): boolean {
  return getServerEnv("MOCK_MODEL") === "true" || apiKey === "sk-mock";
}

/**
 * Deterministic curator for mock mode. Generates up to 3 proposed edges between
 * adjacent turn concepts so the UI can be exercised end-to-end without burning
 * tokens. Idempotent: skips pairs that already have any edge.
 */
async function runMockCurator(input: CuratorInput): Promise<{ proposed: number }> {
  const concepts = input.turnConcepts;
  if (concepts.length < 2) return { proposed: 0 };

  const rotation: RelationType[] = ["analogous-to", "generalizes", "enables"];
  let proposed = 0;

  for (let i = 0; i < Math.min(3, concepts.length - 1); i++) {
    const a = concepts[i];
    const b = concepts[i + 1];
    if (await anyEdgeBetween(a.id, b.id)) continue;

    const type = rotation[i % rotation.length];
    await upsertConcept({ id: a.id, label: a.label });
    await upsertConcept({ id: b.id, label: b.label });
    await upsertRelation({
      fromId: a.id,
      toId: b.id,
      type,
      rationale: `[mock] ${a.label.replace(/-/g, " ")} and ${b.label.replace(/-/g, " ")} share a plausible bridge worth inspecting.`,
      citedInsights: [a.currentInsightId, b.currentInsightId].filter(Boolean),
      confidence: 0.6,
      createdBy: "agent",
      status: "proposed"
    });
    proposed += 1;
  }

  return { proposed };
}
