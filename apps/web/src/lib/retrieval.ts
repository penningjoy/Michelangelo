import OpenAI from "openai";
import { Pool } from "pg";

/**
 * A single cross-domain retrieval hit: a concept the user has seen before in
 * ANOTHER session, with one prior claim that referenced it.
 */
export type CrossDomainHit = {
  conceptLabel: string;
  priorSessionId: string;
  priorSessionTitle: string;
  priorTurnIndex: number;
  priorInsightId: string;
  priorClaim: string;
};

export type ConceptSpan = {
  start: number;
  end: number;
  conceptLabel: string;
};

type RetrievalInput = {
  apiKey: string;
  owner: string;
  userPrompt: string;
  currentSessionId: string;
  pool?: Pool;
  hasVector?: boolean;
};

const TOP_K = 8;
const PER_CONCEPT_INSIGHTS = 1;

/**
 * Retrieve up to TOP_K cross-domain hits for the current prompt. Uses
 * pgvector cosine similarity when available; otherwise falls back to
 * substring/keyword matching against concept labels. Never throws —
 * returns an empty array on any error so the main request still succeeds.
 */
export async function retrieveCrossDomainContext(
  input: RetrievalInput
): Promise<CrossDomainHit[]> {
  try {
    const { apiKey, owner, userPrompt, currentSessionId, pool, hasVector } = input;
    if (!pool) return [];

    let conceptIds: string[] = [];

    if (hasVector) {
      const embedding = await embedText(apiKey, userPrompt).catch(() => null);
      if (embedding) {
        const vectorLiteral = `[${embedding.join(",")}]`;
        const result = await pool.query<{ id: string }>(
          `select c.id
             from concepts c
            where c.embedding is not null
              and exists (
                select 1
                  from concept_mentions cm
                  join sessions s on s.id = cm.session_id
                 where cm.concept_id = c.id and s.owner = $2
              )
             order by c.embedding <=> $1::vector
             limit $3`,
          [vectorLiteral, owner, TOP_K]
        );
        conceptIds = result.rows.map((row) => row.id);
      }
    }

    if (conceptIds.length === 0) {
      const result = await pool.query<{ id: string; label: string }>(
        `select c.id, c.label
           from concepts c
          where position(lower(c.label) in lower($2)) > 0
            and exists (
              select 1
                from concept_mentions cm
                join sessions s on s.id = cm.session_id
               where cm.concept_id = c.id and s.owner = $1
            )
          order by c.mention_count desc
          limit $3`,
        [owner, userPrompt, TOP_K]
      );
      conceptIds = result.rows.map((row) => row.id);
    }

    if (conceptIds.length === 0) return [];

    // For each concept, pull the most recent prior insight from a DIFFERENT session.
    const hits: CrossDomainHit[] = [];
    for (const conceptId of conceptIds) {
      const mentionRows = await pool.query<{
        session_id: string;
        insight_id: string;
        turn_index: number;
      }>(
        `select cm.session_id, cm.insight_id, cm.turn_index
           from concept_mentions cm
           join sessions s on s.id = cm.session_id
          where cm.concept_id = $1 and cm.session_id <> $2 and s.owner = $3
          order by cm.created_at desc
          limit $4`,
        [conceptId, currentSessionId, owner, PER_CONCEPT_INSIGHTS]
      );

      for (const mention of mentionRows.rows) {
        const claim = await lookupClaim(pool, mention.session_id, mention.insight_id);
        const title = await lookupSessionTitle(pool, mention.session_id);
        if (!claim || !title) continue;
        hits.push({
          conceptLabel: conceptId,
          priorSessionId: mention.session_id,
          priorSessionTitle: title,
          priorTurnIndex: mention.turn_index,
          priorInsightId: mention.insight_id,
          priorClaim: claim
        });
      }
      if (hits.length >= TOP_K) break;
    }
    return hits.slice(0, TOP_K);
  } catch {
    return [];
  }
}

/**
 * Compute concept underline spans for a rendered assistant message. Matches
 * known concept labels as case-insensitive whole-word substrings. Only returns
 * spans for concepts that have prior mentions (i.e. concept-memory worth
 * surfacing to the reader).
 */
export function computeConceptSpans(
  text: string,
  concepts: { label: string; priorClaim?: string; priorSessionTitle?: string }[]
): ConceptSpan[] {
  const spans: ConceptSpan[] = [];
  const lower = text.toLowerCase();
  for (const concept of concepts) {
    const needle = concept.label.replace(/-/g, " ").toLowerCase();
    if (needle.length < 3) continue;
    let searchFrom = 0;
    while (searchFrom < lower.length) {
      const idx = lower.indexOf(needle, searchFrom);
      if (idx === -1) break;
      const before = idx === 0 ? " " : lower[idx - 1];
      const after = idx + needle.length >= lower.length ? " " : lower[idx + needle.length];
      const isBoundary = /[^a-z0-9]/.test(before) && /[^a-z0-9]/.test(after);
      if (isBoundary) {
        spans.push({
          start: idx,
          end: idx + needle.length,
          conceptLabel: concept.label
        });
      }
      searchFrom = idx + needle.length;
    }
  }
  spans.sort((a, b) => a.start - b.start);
  const merged: ConceptSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) continue;
    merged.push(span);
  }
  return merged;
}

export function formatCrossDomainPromptBlock(hits: CrossDomainHit[]): string {
  if (hits.length === 0) return "";
  const lines = hits
    .slice(0, TOP_K)
    .map(
      (hit) =>
        `  - ${hit.conceptLabel} — "${truncate(hit.priorClaim, 140)}" (from "${hit.priorSessionTitle}", turn ${hit.priorTurnIndex})`
    )
    .join("\n");
  return [
    "Concepts you've explored before that may be relevant:",
    lines,
    "Use these only if genuinely relevant. Do not force connections."
  ].join("\n");
}

async function embedText(apiKey: string, text: string): Promise<number[] | null> {
  const client = new OpenAI({ apiKey });
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8000)
  });
  return response.data[0]?.embedding ?? null;
}

/**
 * Best-effort backfill: embed any concepts that don't yet have an embedding.
 * Runs after the turn is persisted, never blocks the response, never throws.
 */
export async function backfillConceptEmbeddings(
  pool: Pool,
  apiKey: string,
  labels: string[]
): Promise<void> {
  try {
    if (labels.length === 0) return;
    const rows = await pool.query<{ id: string }>(
      `select id from concepts where id = any($1::text[]) and embedding is null`,
      [labels]
    );
    for (const row of rows.rows) {
      const embedding = await embedText(apiKey, row.id.replace(/-/g, " ")).catch(() => null);
      if (!embedding) continue;
      const literal = `[${embedding.join(",")}]`;
      await pool.query(`update concepts set embedding = $1::vector where id = $2`, [
        literal,
        row.id
      ]);
    }
  } catch {
    // swallow — retrieval will fall back to label matching
  }
}

async function lookupClaim(pool: Pool, sessionId: string, insightId: string): Promise<string | null> {
  const result = await pool.query<{ content_json: { id: string; claim: string }[] }>(
    `select content_json from artifacts where session_id = $1 and type = 'claims' limit 1`,
    [sessionId]
  );
  const insights = result.rows[0]?.content_json ?? [];
  const found = insights.find((insight) => insight.id === insightId);
  return found ? found.claim : null;
}

async function lookupSessionTitle(pool: Pool, sessionId: string): Promise<string | null> {
  const result = await pool.query<{ title: string }>(
    `select title from sessions where id = $1`,
    [sessionId]
  );
  return result.rows[0]?.title ?? null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
