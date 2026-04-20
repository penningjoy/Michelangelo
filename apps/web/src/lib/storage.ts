import { Pool } from "pg";
import type {
  ChatMessage,
  ConceptMention,
  ConceptRecord,
  ConceptSpanForClient,
  ResearchArtifacts,
  SessionRecord,
  StoredArtifact,
  TurnSummary
} from "./types";
import type { CompactSummary } from "./schemas";

type DbSession = {
  id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
};

type DbMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: Date;
  concept_spans: unknown | null;
};

type DbArtifact = {
  id: string;
  session_id: string;
  type: keyof ResearchArtifacts;
  content_json: unknown;
  created_at: Date;
  updated_at: Date;
};

const memory = {
  sessions: new Map<string, SessionRecord>(),
  messages: new Map<string, ChatMessage[]>(),
  artifacts: new Map<string, StoredArtifact[]>(),
  turnSummaries: new Map<string, TurnSummary[]>(),
  concepts: new Map<string, ConceptRecord>(),
  conceptMentions: [] as ConceptMention[]
};

let pool: Pool | null = null;
let schemaReady = false;
let vectorAvailable = false;

export function hasDatabasePublic(): boolean {
  return hasDatabase();
}

export function getPoolIfAvailable(): Pool | null {
  return hasDatabase() ? getPool() : null;
}

export function hasVectorSupport(): boolean {
  return vectorAvailable;
}

export async function createSession(title: string): Promise<SessionRecord> {
  if (!hasDatabase()) {
    const session = {
      id: crypto.randomUUID(),
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    memory.sessions.set(session.id, session);
    memory.messages.set(session.id, []);
    memory.artifacts.set(session.id, []);
    return session;
  }

  await ensureSchema();
  const id = crypto.randomUUID();
  const result = await getPool().query<DbSession>(
    "insert into sessions (id, title) values ($1, $2) returning id, title, created_at, updated_at",
    [id, title]
  );
  return mapSession(result.rows[0]);
}

export async function renameSession(
  id: string,
  title: string
): Promise<SessionRecord | null> {
  if (!hasDatabase()) {
    const current = memory.sessions.get(id);
    if (!current) return null;
    const updated = { ...current, title, updatedAt: new Date().toISOString() };
    memory.sessions.set(id, updated);
    return updated;
  }

  await ensureSchema();
  const result = await getPool().query<DbSession>(
    "update sessions set title = $2, updated_at = now() where id = $1 returning id, title, created_at, updated_at",
    [id, title]
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function getSession(id: string): Promise<SessionRecord | null> {
  if (!hasDatabase()) return memory.sessions.get(id) ?? null;

  await ensureSchema();
  const result = await getPool().query<DbSession>(
    "select id, title, created_at, updated_at from sessions where id = $1",
    [id]
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string
): Promise<ChatMessage> {
  if (!hasDatabase()) {
    const message = {
      id: crypto.randomUUID(),
      role,
      content,
      createdAt: new Date().toISOString()
    };
    memory.messages.set(sessionId, [...(memory.messages.get(sessionId) ?? []), message]);
    touchMemorySession(sessionId);
    return message;
  }

  await ensureSchema();
  const id = crypto.randomUUID();
  const result = await getPool().query<DbMessage>(
    "insert into messages (id, session_id, role, content) values ($1, $2, $3, $4) returning id, role, content, created_at, concept_spans",
    [id, sessionId, role, content]
  );
  await touchSession(sessionId);
  return mapMessage(result.rows[0]);
}

export async function updateMessageConceptSpans(
  sessionId: string,
  messageId: string,
  spans: ConceptSpanForClient[]
): Promise<void> {
  if (!hasDatabase()) {
    const msgs = memory.messages.get(sessionId);
    if (!msgs) return;
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const next = [...msgs];
    const prev = next[idx];
    next[idx] =
      spans.length > 0
        ? { ...prev, conceptSpans: spans }
        : { ...prev, conceptSpans: undefined };
    memory.messages.set(sessionId, next);
    touchMemorySession(sessionId);
    return;
  }

  await ensureSchema();
  await getPool().query(
    "update messages set concept_spans = $1::jsonb where id = $2 and session_id = $3",
    [spans.length > 0 ? JSON.stringify(spans) : null, messageId, sessionId]
  );
}

export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  if (!hasDatabase()) return memory.messages.get(sessionId) ?? [];

  await ensureSchema();
  const result = await getPool().query<DbMessage>(
    "select id, role, content, created_at, concept_spans from messages where session_id = $1 order by created_at asc",
    [sessionId]
  );
  return result.rows.map(mapMessage);
}

export async function replaceArtifacts(
  sessionId: string,
  artifacts: ResearchArtifacts
): Promise<StoredArtifact[]> {
  const rows = Object.entries(artifacts).map(([type, content]) => ({
    id: crypto.randomUUID(),
    sessionId,
    type: type as keyof ResearchArtifacts,
    content,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));

  if (!hasDatabase()) {
    memory.artifacts.set(sessionId, rows);
    touchMemorySession(sessionId);
    return rows;
  }

  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("delete from artifacts where session_id = $1", [sessionId]);
    for (const row of rows) {
      await client.query(
        "insert into artifacts (id, session_id, type, content_json) values ($1, $2, $3, $4)",
        [row.id, sessionId, row.type, JSON.stringify(row.content)]
      );
    }
    await client.query("update sessions set updated_at = now() where id = $1", [sessionId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return rows;
}

/**
 * Atomically persist a turn: artifacts, compact turn summary, concept upserts,
 * and concept→insight mention links. One transaction in Postgres mode.
 */
export async function persistTurn(
  sessionId: string,
  params: {
    turnIndex: number;
    artifacts: ResearchArtifacts;
    compact: CompactSummary;
    conceptsByInsight: Record<string, string[]>; // insightId → kebab-case concept labels
  }
): Promise<void> {
  const { turnIndex, artifacts, compact, conceptsByInsight } = params;

  const artifactRows = Object.entries(artifacts).map(([type, content]) => ({
    id: crypto.randomUUID(),
    sessionId,
    type: type as keyof ResearchArtifacts,
    content,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));

  const summary: TurnSummary = {
    id: crypto.randomUUID(),
    sessionId,
    turnIndex,
    gist: compact.gist,
    keyClaims: compact.keyClaims,
    sourceIds: artifacts.sources.map((source) => source.id),
    insightIds: artifacts.insights.map((insight) => insight.id),
    createdAt: new Date().toISOString()
  };

  const uniqueLabels = new Set<string>();
  for (const labels of Object.values(conceptsByInsight)) {
    for (const label of labels) uniqueLabels.add(label);
  }

  if (!hasDatabase()) {
    memory.artifacts.set(sessionId, artifactRows);
    const existing = memory.turnSummaries.get(sessionId) ?? [];
    memory.turnSummaries.set(sessionId, [...existing.filter((s) => s.turnIndex !== turnIndex), summary]);
    for (const label of uniqueLabels) {
      const current = memory.concepts.get(label);
      if (current) {
        memory.concepts.set(label, { ...current, mentionCount: current.mentionCount + 1 });
      } else {
        memory.concepts.set(label, {
          id: label,
          label,
          firstSeen: new Date().toISOString(),
          mentionCount: 1
        });
      }
    }
    for (const [insightId, labels] of Object.entries(conceptsByInsight)) {
      for (const label of labels) {
        memory.conceptMentions.push({
          conceptId: label,
          sessionId,
          insightId,
          turnIndex,
          createdAt: new Date().toISOString()
        });
      }
    }
    touchMemorySession(sessionId);
    return;
  }

  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("delete from artifacts where session_id = $1", [sessionId]);
    for (const row of artifactRows) {
      await client.query(
        "insert into artifacts (id, session_id, type, content_json) values ($1, $2, $3, $4)",
        [row.id, sessionId, row.type, JSON.stringify(row.content)]
      );
    }
    await client.query(
      `insert into turn_summaries
         (id, session_id, turn_index, gist, key_claims, source_ids, insight_ids)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (session_id, turn_index) do update set
         gist = excluded.gist,
         key_claims = excluded.key_claims,
         source_ids = excluded.source_ids,
         insight_ids = excluded.insight_ids`,
      [
        summary.id,
        sessionId,
        turnIndex,
        summary.gist,
        JSON.stringify(summary.keyClaims),
        JSON.stringify(summary.sourceIds),
        JSON.stringify(summary.insightIds)
      ]
    );
    for (const label of uniqueLabels) {
      await client.query(
        `insert into concepts (id, label, mention_count) values ($1, $2, 1)
         on conflict (id) do update set mention_count = concepts.mention_count + 1`,
        [label, label]
      );
    }
    for (const [insightId, labels] of Object.entries(conceptsByInsight)) {
      for (const label of labels) {
        await client.query(
          `insert into concept_mentions (concept_id, session_id, insight_id, turn_index)
           values ($1, $2, $3, $4)
           on conflict (concept_id, session_id, insight_id) do nothing`,
          [label, sessionId, insightId, turnIndex]
        );
      }
    }
    await client.query("update sessions set updated_at = now() where id = $1", [sessionId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listTurnSummaries(sessionId: string): Promise<TurnSummary[]> {
  if (!hasDatabase()) {
    return (memory.turnSummaries.get(sessionId) ?? [])
      .slice()
      .sort((a, b) => a.turnIndex - b.turnIndex);
  }
  await ensureSchema();
  const result = await getPool().query<{
    id: string;
    session_id: string;
    turn_index: number;
    gist: string;
    key_claims: string[];
    source_ids: string[];
    insight_ids: string[];
    created_at: Date;
  }>(
    `select id, session_id, turn_index, gist, key_claims, source_ids, insight_ids, created_at
       from turn_summaries
      where session_id = $1
      order by turn_index asc`,
    [sessionId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    turnIndex: row.turn_index,
    gist: row.gist,
    keyClaims: Array.isArray(row.key_claims) ? row.key_claims : [],
    sourceIds: Array.isArray(row.source_ids) ? row.source_ids : [],
    insightIds: Array.isArray(row.insight_ids) ? row.insight_ids : [],
    createdAt: row.created_at.toISOString()
  }));
}

export async function getLastTurnSummary(sessionId: string): Promise<TurnSummary | null> {
  const all = await listTurnSummaries(sessionId);
  return all.length ? all[all.length - 1] : null;
}

export async function listArtifacts(sessionId: string): Promise<StoredArtifact[]> {
  if (!hasDatabase()) return memory.artifacts.get(sessionId) ?? [];

  await ensureSchema();
  const result = await getPool().query<DbArtifact>(
    "select id, session_id, type, content_json, created_at, updated_at from artifacts where session_id = $1 order by created_at asc",
    [sessionId]
  );
  return result.rows.map(mapArtifact);
}

export async function checkDatabase(): Promise<{ ok: boolean; mode: "postgres" | "memory" }> {
  if (!hasDatabase()) return { ok: true, mode: "memory" };
  await ensureSchema();
  await getPool().query("select 1");
  return { ok: true, mode: "postgres" };
}

async function touchSession(sessionId: string) {
  await getPool().query("update sessions set updated_at = now() where id = $1", [sessionId]);
}

function touchMemorySession(sessionId: string) {
  const session = memory.sessions.get(sessionId);
  if (session) {
    memory.sessions.set(sessionId, { ...session, updatedAt: new Date().toISOString() });
  }
}

async function ensureSchema() {
  if (schemaReady) return;
  try {
    await getPool().query("create extension if not exists vector");
    vectorAvailable = true;
  } catch {
    vectorAvailable = false;
  }
  await getPool().query(`
    create table if not exists sessions (
      id text primary key,
      title text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists messages (
      id text primary key,
      session_id text not null references sessions(id) on delete cascade,
      role text not null check (role in ('user', 'assistant')),
      content text not null,
      created_at timestamptz not null default now()
    );

    create table if not exists artifacts (
      id text primary key,
      session_id text not null references sessions(id) on delete cascade,
      type text not null,
      content_json jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists turn_summaries (
      id text primary key,
      session_id text not null references sessions(id) on delete cascade,
      turn_index int not null,
      gist text not null,
      key_claims jsonb not null default '[]'::jsonb,
      source_ids jsonb not null default '[]'::jsonb,
      insight_ids jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now(),
      unique(session_id, turn_index)
    );

    create table if not exists concepts (
      id text primary key,
      label text not null,
      first_seen timestamptz not null default now(),
      mention_count int not null default 0
    );

    create table if not exists concept_mentions (
      concept_id text not null references concepts(id) on delete cascade,
      session_id text not null references sessions(id) on delete cascade,
      insight_id text not null,
      turn_index int not null,
      created_at timestamptz not null default now(),
      primary key(concept_id, session_id, insight_id)
    );
  `);
  await getPool().query("alter table messages add column if not exists concept_spans jsonb");
  if (vectorAvailable) {
    try {
      await getPool().query(
        "alter table concepts add column if not exists embedding vector(1536)"
      );
    } catch {
      vectorAvailable = false;
    }
  }
  schemaReady = true;
}

function hasDatabase(): boolean {
  return Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);
}

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("POSTGRES_URL or DATABASE_URL is required for Postgres mode.");
  }
  const isLocal = /localhost|127\.0\.0\.1|db:5432/.test(connectionString);
  pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 3
  });
  return pool;
}

function mapSession(row: DbSession): SessionRecord {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapMessage(row: DbMessage): ChatMessage {
  const raw = row.concept_spans;
  const conceptSpans =
    Array.isArray(raw) && raw.length > 0 ? (raw as ConceptSpanForClient[]) : undefined;
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at.toISOString(),
    ...(conceptSpans ? { conceptSpans } : {})
  };
}

function mapArtifact(row: DbArtifact): StoredArtifact {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    content: row.content_json,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
