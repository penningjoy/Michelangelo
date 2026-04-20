import neo4j, { type Driver, type Session, type Integer } from "neo4j-driver";

/**
 * Neo4j driver module. Lazy-init; no-ops when NEO4J_URI is unset so local dev
 * without a graph container still runs. Mirrors the fail-soft posture of
 * storage.ts when POSTGRES_URL is absent.
 */

let driver: Driver | null = null;
let constraintsEnsured = false;

export function isGraphEnabled(): boolean {
  return Boolean(process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD);
}

export function getDriver(): Driver | null {
  if (!isGraphEnabled()) return null;
  if (driver) return driver;
  driver = neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
    { disableLosslessIntegers: true }
  );
  return driver;
}

async function withSession<T>(fn: (session: Session) => Promise<T>): Promise<T | null> {
  const d = getDriver();
  if (!d) return null;
  const session = d.session();
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

export async function ensureConstraints(): Promise<void> {
  if (constraintsEnsured) return;
  if (!isGraphEnabled()) return;
  await withSession(async (session) => {
    await session.run(
      "CREATE CONSTRAINT concept_id_unique IF NOT EXISTS FOR (c:Concept) REQUIRE c.id IS UNIQUE"
    );
  });
  constraintsEnsured = true;
}

export type ConceptInput = {
  id: string;
  label: string;
  mentionCount?: number;
};

export async function upsertConcept(concept: ConceptInput): Promise<void> {
  await ensureConstraints();
  await withSession(async (session) => {
    await session.run(
      `MERGE (c:Concept { id: $id })
       ON CREATE SET c.label = $label, c.firstSeen = datetime(), c.mentionCount = $mentionCount
       ON MATCH  SET c.label = $label, c.mentionCount = $mentionCount`,
      {
        id: concept.id,
        label: concept.label,
        mentionCount: concept.mentionCount ?? 1
      }
    );
  });
}

/**
 * Ensure all concept slugs exist as :Concept nodes. Used after persistTurn so
 * the canvas shows nodes immediately, before (or independent of) the curator
 * proposing edges. Never throws; swallows errors so the request is not blocked.
 */
export async function upsertConcepts(slugs: string[]): Promise<void> {
  try {
    if (!isGraphEnabled()) return;
    const unique = Array.from(new Set(slugs));
    for (const slug of unique) {
      await upsertConcept({ id: slug, label: slug });
    }
  } catch {
    // swallow
  }
}

export type RelationType = "analogous-to" | "generalizes" | "tension-with" | "enables" | "contrasts";
export type RelationStatus = "proposed" | "accepted" | "rejected";
export type RelationCreatedBy = "agent" | "user";

export type RelationInput = {
  fromId: string;
  toId: string;
  type: RelationType;
  rationale: string;
  citedInsights?: string[];
  confidence: number;
  createdBy: RelationCreatedBy;
  status: RelationStatus;
};

/**
 * Upsert a relation keyed by (fromId, toId, type). If an edge of that type
 * already exists, we preserve its status/createdBy (human decisions must not
 * be clobbered by a later proposal).
 */
export async function upsertRelation(rel: RelationInput): Promise<void> {
  await ensureConstraints();
  await withSession(async (session) => {
    await session.run(
      `MATCH (a:Concept { id: $fromId }), (b:Concept { id: $toId })
       MERGE (a)-[r:RELATES_TO { type: $type }]-(b)
       ON CREATE SET
         r.rationale = $rationale,
         r.citedInsights = $citedInsights,
         r.confidence = $confidence,
         r.createdBy = $createdBy,
         r.status = $status,
         r.createdAt = datetime()
       ON MATCH SET
         r.rationale = CASE WHEN r.status = 'proposed' THEN $rationale ELSE r.rationale END,
         r.citedInsights = CASE WHEN r.status = 'proposed' THEN $citedInsights ELSE r.citedInsights END,
         r.confidence = CASE WHEN r.status = 'proposed' THEN $confidence ELSE r.confidence END`,
      {
        fromId: rel.fromId,
        toId: rel.toId,
        type: rel.type,
        rationale: rel.rationale,
        citedInsights: rel.citedInsights ?? [],
        confidence: rel.confidence,
        createdBy: rel.createdBy,
        status: rel.status
      }
    );
  });
}

export type ExistingEdgeCheck = { type: RelationType; status: RelationStatus } | null;

export async function findEdge(fromId: string, toId: string, type: RelationType): Promise<ExistingEdgeCheck> {
  const result = await withSession(async (session) => {
    const res = await session.run(
      `MATCH (a:Concept { id: $fromId })-[r:RELATES_TO { type: $type }]-(b:Concept { id: $toId })
       RETURN r.type AS type, r.status AS status LIMIT 1`,
      { fromId, toId, type }
    );
    if (res.records.length === 0) return null;
    const record = res.records[0];
    return {
      type: record.get("type") as RelationType,
      status: record.get("status") as RelationStatus
    };
  });
  return result;
}

export type ProposedEdge = {
  edgeId: string;
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  type: RelationType;
  rationale: string;
  citedInsights: string[];
  confidence: number;
  createdBy: RelationCreatedBy;
  status: RelationStatus;
};

export async function getProposedEdges(limit = 50): Promise<ProposedEdge[]> {
  const result = await withSession(async (session) => {
    const res = await session.run(
      `MATCH (a:Concept)-[r:RELATES_TO { status: 'proposed' }]-(b:Concept)
       WHERE id(a) < id(b)
       RETURN elementId(r) AS edgeId,
              a.id AS fromId, a.label AS fromLabel,
              b.id AS toId,   b.label AS toLabel,
              r.type AS type, r.rationale AS rationale,
              r.citedInsights AS citedInsights,
              r.confidence AS confidence,
              r.createdBy AS createdBy,
              r.status AS status
       ORDER BY r.createdAt DESC
       LIMIT $limit`,
      { limit: neo4j.int(limit) }
    );
    return res.records.map((record) => ({
      edgeId: record.get("edgeId") as string,
      fromId: record.get("fromId") as string,
      fromLabel: record.get("fromLabel") as string,
      toId: record.get("toId") as string,
      toLabel: record.get("toLabel") as string,
      type: record.get("type") as RelationType,
      rationale: record.get("rationale") as string,
      citedInsights: (record.get("citedInsights") as string[]) ?? [],
      confidence: toNumber(record.get("confidence")),
      createdBy: record.get("createdBy") as RelationCreatedBy,
      status: record.get("status") as RelationStatus
    }));
  });
  return result ?? [];
}

export async function updateEdgeStatus(params: {
  edgeId: string;
  status: RelationStatus;
  type?: RelationType;
  note?: string;
}): Promise<void> {
  await withSession(async (session) => {
    await session.run(
      `MATCH ()-[r:RELATES_TO]-()
       WHERE elementId(r) = $edgeId
       SET r.status = $status,
           r.reviewedAt = datetime(),
           r.type = coalesce($type, r.type),
           r.rationale = coalesce($note, r.rationale)`,
      {
        edgeId: params.edgeId,
        status: params.status,
        type: params.type ?? null,
        note: params.note ?? null
      }
    );
  });
}

export type GraphNode = {
  id: string;
  label: string;
  mentionCount: number;
};

export type GraphEdge = {
  edgeId: string;
  fromId: string;
  toId: string;
  type: RelationType;
  status: RelationStatus;
};

export async function getGraphSnapshot(seedConceptIds: string[]): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
}> {
  if (seedConceptIds.length === 0) return { nodes: [], edges: [] };
  const result = await withSession(async (session) => {
    const res = await session.run(
      `MATCH (seed:Concept) WHERE seed.id IN $seedIds
       OPTIONAL MATCH (seed)-[r:RELATES_TO { status: 'accepted' }]-(neighbor:Concept)
       WITH collect(DISTINCT seed) + collect(DISTINCT neighbor) AS nodes,
            collect(DISTINCT r) AS rels
       UNWIND nodes AS n
       WITH collect(DISTINCT n) AS allNodes, rels
       RETURN
         [node IN allNodes WHERE node IS NOT NULL |
           { id: node.id, label: node.label, mentionCount: coalesce(node.mentionCount, 1) }] AS nodes,
         [r IN rels WHERE r IS NOT NULL |
           { edgeId: elementId(r),
             fromId: startNode(r).id,
             toId: endNode(r).id,
             type: r.type,
             status: r.status }] AS edges`,
      { seedIds: seedConceptIds }
    );
    if (res.records.length === 0) return { nodes: [], edges: [] };
    const record = res.records[0];
    const nodes = (record.get("nodes") as Array<Record<string, unknown>>).map((n) => ({
      id: n.id as string,
      label: n.label as string,
      mentionCount: toNumber(n.mentionCount)
    }));
    const edges = (record.get("edges") as Array<Record<string, unknown>>).map((e) => ({
      edgeId: e.edgeId as string,
      fromId: e.fromId as string,
      toId: e.toId as string,
      type: e.type as RelationType,
      status: e.status as RelationStatus
    }));
    return { nodes, edges };
  });
  return result ?? { nodes: [], edges: [] };
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
    constraintsEnsured = false;
  }
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as Integer).toNumber();
  }
  return Number(value);
}
