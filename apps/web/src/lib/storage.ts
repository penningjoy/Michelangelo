import { Pool } from "pg";
import type {
  ChatMessage,
  ConceptMention,
  ConceptRecord,
  ConceptSpanForClient,
  ResearchArtifacts,
  SessionListItem,
  SessionRecord,
  StoredArtifact,
  TurnSummary
} from "./types";
import type { CompactSummary } from "./schemas";
import { getServerEnv } from "./serverEnv";

type DbSession = {
  id: string;
  title: string;
  owner: string;
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
  sessions: new Map<string, SessionRecord & { owner: string; lastResponseId?: string | null }>(),
  messages: new Map<string, ChatMessage[]>(),
  artifacts: new Map<string, StoredArtifact[]>(),
  turnSummaries: new Map<string, TurnSummary[]>(),
  concepts: new Map<string, ConceptRecord>(),
  conceptMentions: [] as ConceptMention[]
};

let pool: Pool | null = null;
let schemaReady = false;
let vectorAvailable = false;
let storageFallbackReason: string | null = null;

export type DatabaseStatus =
  | { ok: true; mode: "postgres"; reason: null }
  | { ok: true; mode: "memory"; reason: string };

export function hasDatabasePublic(): boolean {
  return hasConfiguredDatabase();
}

export function getPoolIfAvailable(): Pool | null {
  return canUseConfiguredDatabase() ? getPool() : null;
}

export function hasVectorSupport(): boolean {
  return canUseConfiguredDatabase() && vectorAvailable;
}

export async function requireDatabaseStorage(): Promise<void> {
  if (!hasConfiguredDatabase()) {
    throw new Error("Postgres is not configured. Set DATABASE_URL or POSTGRES_URL to enable history.");
  }
  const ready = await ensureDatabaseAvailable(true);
  if (!ready) {
    throw new Error(storageFallbackReason ?? "Postgres is unavailable.");
  }
}

export async function createSession(title: string, owner: string): Promise<SessionRecord> {
  if (!(await canUseDatabase())) {
    const session = {
      id: crypto.randomUUID(),
      title,
      owner,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    memory.sessions.set(session.id, session);
    memory.messages.set(session.id, []);
    memory.artifacts.set(session.id, []);
    return mapMemorySession(session);
  }

  await ensureSchema();
  const id = crypto.randomUUID();
  const result = await getPool().query<DbSession>(
    "insert into sessions (id, title, owner) values ($1, $2, $3) returning id, title, owner, created_at, updated_at",
    [id, title, owner]
  );
  return mapSession(result.rows[0]);
}

export async function renameSession(
  id: string,
  title: string,
  owner: string
): Promise<SessionRecord | null> {
  if (!(await canUseDatabase())) {
    const current = memory.sessions.get(id);
    if (!current || current.owner !== owner) return null;
    const updated = { ...current, title, updatedAt: new Date().toISOString() };
    memory.sessions.set(id, updated);
    return mapMemorySession(updated);
  }

  await ensureSchema();
  const result = await getPool().query<DbSession>(
    "update sessions set title = $2, updated_at = now() where id = $1 and owner = $3 returning id, title, owner, created_at, updated_at",
    [id, title, owner]
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function listSessions(owner: string, limit = 50): Promise<SessionListItem[]> {
  if (!(await canUseDatabase())) {
    const sessions = Array.from(memory.sessions.values())
      .filter((session) => session.owner === owner)
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
    return sessions.map((session) => {
      const summaries = memory.turnSummaries.get(session.id) ?? [];
      const last = summaries.length ? summaries[summaries.length - 1] : null;
      return { ...mapMemorySession(session), lastTurnGist: last?.gist ?? null };
    });
  }

  await ensureSchema();
  const result = await getPool().query<
    DbSession & { last_gist: string | null }
  >(
    `select s.id, s.title, s.owner, s.created_at, s.updated_at,
            (select gist from turn_summaries
              where session_id = s.id
              order by turn_index desc limit 1) as last_gist
       from sessions s
      where s.owner = $1
      order by s.updated_at desc
      limit $2`,
    [owner, limit]
  );
  return result.rows.map((row) => ({
    ...mapSession(row),
    lastTurnGist: row.last_gist ?? null
  }));
}

export async function getSession(id: string, owner: string): Promise<SessionRecord | null> {
  if (!(await canUseDatabase())) {
    const session = memory.sessions.get(id);
    return session?.owner === owner ? mapMemorySession(session) : null;
  }

  await ensureSchema();
  const result = await getPool().query<DbSession>(
    "select id, title, owner, created_at, updated_at from sessions where id = $1 and owner = $2",
    [id, owner]
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string
): Promise<ChatMessage> {
  if (!(await canUseDatabase())) {
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
  if (!(await canUseDatabase())) {
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

export async function listMessages(sessionId: string, owner: string): Promise<ChatMessage[]> {
  if (!(await canUseDatabase())) {
    const session = memory.sessions.get(sessionId);
    return session?.owner === owner ? memory.messages.get(sessionId) ?? [] : [];
  }

  await ensureSchema();
  const result = await getPool().query<DbMessage>(
    `select m.id, m.role, m.content, m.created_at, m.concept_spans
       from messages m
       join sessions s on s.id = m.session_id
      where m.session_id = $1 and s.owner = $2
      order by m.created_at asc`,
    [sessionId, owner]
  );
  return result.rows.map(mapMessage);
}

export async function replaceArtifacts(
  sessionId: string,
  artifacts: ResearchArtifacts
): Promise<StoredArtifact[]> {
  const rows = buildArtifactRows(sessionId, artifacts);

  if (!(await canUseDatabase())) {
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

  const artifactRows = buildArtifactRows(sessionId, artifacts);

  const summary: TurnSummary = {
    id: crypto.randomUUID(),
    sessionId,
    turnIndex,
    gist: compact.gist,
    keyClaims: compact.keyClaims,
    sourceIds: artifacts.sources.map((source) => source.id),
    insightIds: artifacts.claims.map((claim) => claim.id),
    createdAt: new Date().toISOString()
  };

  const uniqueLabels = new Set<string>();
  for (const labels of Object.values(conceptsByInsight)) {
    for (const label of labels) uniqueLabels.add(label);
  }

  if (!(await canUseDatabase())) {
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

export async function listTurnSummaries(sessionId: string, owner: string): Promise<TurnSummary[]> {
  if (!(await canUseDatabase())) {
    const session = memory.sessions.get(sessionId);
    if (session?.owner !== owner) return [];
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
    `select ts.id, ts.session_id, ts.turn_index, ts.gist, ts.key_claims, ts.source_ids, ts.insight_ids, ts.created_at
       from turn_summaries ts
       join sessions s on s.id = ts.session_id
      where ts.session_id = $1 and s.owner = $2
      order by turn_index asc`,
    [sessionId, owner]
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

export async function getLastTurnSummary(sessionId: string, owner: string): Promise<TurnSummary | null> {
  const all = await listTurnSummaries(sessionId, owner);
  return all.length ? all[all.length - 1] : null;
}

export async function listArtifacts(sessionId: string, owner: string): Promise<StoredArtifact[]> {
  if (!(await canUseDatabase())) {
    const session = memory.sessions.get(sessionId);
    return session?.owner === owner ? memory.artifacts.get(sessionId) ?? [] : [];
  }

  await ensureSchema();
  const result = await getPool().query<DbArtifact>(
    `select a.id, a.session_id, a.type, a.content_json, a.created_at, a.updated_at
       from artifacts a
       join sessions s on s.id = a.session_id
      where a.session_id = $1 and s.owner = $2
      order by a.created_at asc`,
    [sessionId, owner]
  );
  return result.rows.map(mapArtifact);
}

export async function listSessionConceptIds(sessionId: string, owner: string): Promise<string[]> {
  if (!(await canUseDatabase())) {
    const session = memory.sessions.get(sessionId);
    if (session?.owner !== owner) return [];
    return Array.from(
      new Set(
        memory.conceptMentions
          .filter((mention) => mention.sessionId === sessionId)
          .map((mention) => mention.conceptId)
      )
    );
  }

  await ensureSchema();
  const result = await getPool().query<{ concept_id: string }>(
    `select distinct cm.concept_id
       from concept_mentions cm
       join sessions s on s.id = cm.session_id
      where cm.session_id = $1 and s.owner = $2`,
    [sessionId, owner]
  );
  return result.rows.map((row) => row.concept_id);
}

export async function listConceptsForOwner(
  owner: string,
  limit = 500
): Promise<Array<{ id: string; label: string; mentionCount: number }>> {
  if (!(await canUseDatabase())) {
    const mentionCounts = new Map<string, number>();
    for (const mention of memory.conceptMentions) {
      const session = memory.sessions.get(mention.sessionId);
      if (session?.owner !== owner) continue;
      mentionCounts.set(mention.conceptId, (mentionCounts.get(mention.conceptId) ?? 0) + 1);
    }
    return Array.from(mentionCounts.entries())
      .map(([id, mentionCount]) => {
        const concept = memory.concepts.get(id);
        return {
          id,
          label: concept?.label ?? id,
          mentionCount
        };
      })
      .sort((a, b) => b.mentionCount - a.mentionCount || a.label.localeCompare(b.label))
      .slice(0, limit);
  }

  await ensureSchema();
  const result = await getPool().query<{ id: string; label: string; mention_count: number }>(
    `select c.id, c.label, count(*)::int as mention_count
       from concepts c
       join concept_mentions cm on cm.concept_id = c.id
       join sessions s on s.id = cm.session_id
      where s.owner = $1
      group by c.id, c.label
      order by mention_count desc, c.label asc
      limit $2`,
    [owner, limit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    label: row.label,
    mentionCount: Number(row.mention_count)
  }));
}

export async function listOwnedConceptIds(
  owner: string,
  candidateIds?: string[]
): Promise<Set<string>> {
  if (!(await canUseDatabase())) {
    const concepts = new Set<string>();
    const allow = candidateIds ? new Set(candidateIds) : null;
    for (const mention of memory.conceptMentions) {
      const session = memory.sessions.get(mention.sessionId);
      if (session?.owner !== owner) continue;
      if (allow && !allow.has(mention.conceptId)) continue;
      concepts.add(mention.conceptId);
    }
    return concepts;
  }

  await ensureSchema();
  const result = candidateIds?.length
    ? await getPool().query<{ concept_id: string }>(
        `select distinct cm.concept_id
           from concept_mentions cm
           join sessions s on s.id = cm.session_id
          where s.owner = $1 and cm.concept_id = any($2::text[])`,
        [owner, candidateIds]
      )
    : await getPool().query<{ concept_id: string }>(
        `select distinct cm.concept_id
           from concept_mentions cm
           join sessions s on s.id = cm.session_id
          where s.owner = $1`,
        [owner]
      );
  return new Set(result.rows.map((row) => row.concept_id));
}

/**
 * Read the OpenAI response.id captured at the end of the previous turn for
 * this session, if any. Used by the provider to thread `previous_response_id`
 * so the model keeps server-side conversation state and we can stop re-sending
 * the transcript on every turn.
 */
export async function getLastResponseId(
  sessionId: string,
  owner: string
): Promise<string | null> {
  if (!(await canUseDatabase())) {
    const session = memory.sessions.get(sessionId);
    if (!session || session.owner !== owner) return null;
    return session.lastResponseId ?? null;
  }
  await ensureSchema();
  const result = await getPool().query<{ last_response_id: string | null }>(
    "select last_response_id from sessions where id = $1 and owner = $2",
    [sessionId, owner]
  );
  return result.rows[0]?.last_response_id ?? null;
}

/**
 * Persist the OpenAI response.id from the most recent turn. Called after the
 * turn is fully persisted so we never thread an id whose context isn't
 * reflected in our own storage.
 */
export async function setLastResponseId(
  sessionId: string,
  responseId: string | null
): Promise<void> {
  if (!(await canUseDatabase())) {
    const session = memory.sessions.get(sessionId);
    if (!session) return;
    memory.sessions.set(sessionId, { ...session, lastResponseId: responseId });
    return;
  }
  await ensureSchema();
  await getPool().query("update sessions set last_response_id = $1 where id = $2", [
    responseId,
    sessionId
  ]);
}

export async function checkDatabase(): Promise<DatabaseStatus> {
  if (!hasConfiguredDatabase()) {
    const reason =
      "Postgres is not configured. Using in-memory storage until DATABASE_URL or POSTGRES_URL is set.";
    storageFallbackReason = reason;
    return { ok: true, mode: "memory", reason };
  }

  const ready = await ensureDatabaseAvailable(true);
  if (ready) {
    return { ok: true, mode: "postgres", reason: null };
  }

  return {
    ok: true,
    mode: "memory",
    reason: storageFallbackReason ?? "Postgres is unavailable. Using in-memory storage."
  };
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
      owner text,
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

    create table if not exists cache_kv (
      key text primary key,
      value jsonb not null,
      expires_at timestamptz not null
    );
  `);
  await getPool().query("alter table sessions add column if not exists owner text");
  await getPool().query("update sessions set owner = coalesce(owner, 'legacy-demo')");
  await getPool().query("alter table sessions alter column owner set not null");
  await getPool().query("alter table sessions add column if not exists last_response_id text");
  await getPool().query(
    "create index if not exists cache_kv_expires_idx on cache_kv (expires_at)"
  );
  await getPool().query(
    "create index if not exists sessions_owner_updated_idx on sessions (owner, updated_at desc)"
  );
  await getPool().query(
    "create index if not exists concept_mentions_session_idx on concept_mentions (session_id, created_at desc)"
  );
  await getPool().query(
    "create index if not exists concept_mentions_concept_idx on concept_mentions (concept_id, created_at desc)"
  );
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

async function canUseDatabase(): Promise<boolean> {
  if (!hasConfiguredDatabase()) return false;
  return ensureDatabaseAvailable();
}

async function ensureDatabaseAvailable(forceRetry = false): Promise<boolean> {
  if (!hasConfiguredDatabase()) return false;
  if (!forceRetry && canUseConfiguredDatabase() && schemaReady) return true;

  try {
    await ensureSchema();
    await getPool().query("select 1");
    storageFallbackReason = null;
    return true;
  } catch (error) {
    disableDatabase(asFallbackReason(error));
    return false;
  }
}

function hasConfiguredDatabase(): boolean {
  return Boolean(getServerEnv("POSTGRES_URL") || getServerEnv("DATABASE_URL"));
}

function canUseConfiguredDatabase(): boolean {
  return hasConfiguredDatabase() && !storageFallbackReason;
}

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = getServerEnv("POSTGRES_URL") || getServerEnv("DATABASE_URL");
  if (!connectionString) {
    throw new Error("POSTGRES_URL or DATABASE_URL is required for Postgres mode.");
  }
  const isLocal = /localhost|127\.0\.0\.1|db:5432/.test(connectionString);
  const allowInsecureTls = getServerEnv("POSTGRES_SSL_NO_VERIFY") === "true";
  pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: !allowInsecureTls },
    max: 3
  });
  return pool;
}

function disableDatabase(reason: string) {
  storageFallbackReason = reason;
  schemaReady = false;
  vectorAvailable = false;
  if (!pool) return;
  const current = pool;
  pool = null;
  void current.end().catch(() => undefined);
}

function asFallbackReason(error: unknown): string {
  return error instanceof Error
    ? `Postgres is unavailable. Using in-memory storage instead: ${error.message}`
    : "Postgres is unavailable. Using in-memory storage instead.";
}

function mapSession(row: DbSession): SessionRecord {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapMemorySession(row: SessionRecord & { owner: string }): SessionRecord {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
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

function buildArtifactRows(sessionId: string, artifacts: ResearchArtifacts): StoredArtifact[] {
  const timestamp = new Date().toISOString();
  return Object.entries(artifacts)
    .filter(([, content]) => content !== undefined)
    .map(([type, content]) => ({
      id: crypto.randomUUID(),
      sessionId,
      type: type as keyof ResearchArtifacts,
      content,
      createdAt: timestamp,
      updatedAt: timestamp
    }));
}

export function resetStorageForTests(): void {
  memory.sessions.clear();
  memory.messages.clear();
  memory.artifacts.clear();
  memory.turnSummaries.clear();
  memory.concepts.clear();
  memory.conceptMentions.length = 0;
  schemaReady = false;
  vectorAvailable = false;
  storageFallbackReason = null;
  pool = null;
}
