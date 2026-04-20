# Michelangelo — Graph Phase Plan

_Drafted: 2026-04-19_

## Why this plan

The v1 architecture deferred a graph database with a stated revisit trigger:
"multi-hop traversal becomes a user-facing need." The intended next product
phase — a right-side canvas that shows concepts, typed relations, and
cross-disciplinary links as an explorable (eventually 3D) brain map — is that
trigger. This plan takes the moat work off deferral and commits to it.

## Locked decisions (from discussion)

1. **Relation ontology (5 types):** `analogous-to`, `generalizes`,
   `tension-with`, `enables`, `contrasts`. No user-added new types in v1; the
   ontology widens only through observation, not live editing.
2. **User-drawn edges** are typed (one of the 5) and carry an optional
   free-text note. Agent-proposed edges carry the same shape via `rationale`.
3. **Dual store:** Neo4j for concept graph (nodes + typed edges + multi-hop);
   Postgres for everything else (sessions, messages, artifacts, embeddings,
   concept metadata). Single cascade point: `concept.id`.
4. **Local dev via Docker container** for Neo4j. Cloud migration (AuraDB Free
   → paid) happens when the app moves past the family circle.
5. **Curator LLM:** `gpt-5.2-mini` — cheaper than the research model, tighter
   task. The research turn itself stays on `gpt-5.2`.
6. **Chat column evolves** alongside the canvas (widens, drops chrome,
   conversation-like). The artifact rail dies; its contents relocate.
7. **Phasing:** sequenced so Phase 1 produces data, Phase 2 makes the data
   inspectable, Phase 3 makes it beautiful, Phase 4 makes it alive.

## Architecture after this phase

```
┌───────────────────────────────────────────────────────────┐
│  Next.js App Router (apps/web)                            │
│  ┌──────────────┐    ┌─────────────────────────────────┐  │
│  │ Workspace    │◄───│ /api/research   (streaming)     │  │
│  │  chat column │    │ /api/connections (CRUD)         │  │
│  │  3D canvas   │    │ /api/graph-data (for canvas)    │  │
│  └──────────────┘    └────┬──────────────┬─────────────┘  │
│                           │              │                 │
│                   Postgres│       Neo4j  │                 │
│                   ├ sessions        ├ (:Concept)           │
│                   ├ messages        └ [:RELATES_TO {...}]  │
│                   ├ artifacts                              │
│                   ├ turn_summaries                         │
│                   ├ concepts (pgvector)                    │
│                   └ concept_mentions                       │
└───────────────────────────────────────────────────────────┘
```

Single deploy target. Two stores; each store does one thing well.

## Neo4j schema

```
(:Concept {
  id: string,            // kebab-case, FK to postgres concepts.id
  label: string,         // display label (denormalized)
  firstSeen: datetime,
  mentionCount: int
})

[:RELATES_TO {
  type: string,          // analogous-to | generalizes | tension-with | enables | contrasts
  rationale: string,     // agent's justification OR user note (≤500 chars)
  citedInsights: [string], // artifact-local insight IDs, from either side
  confidence: float,     // 0.0–1.0 for agent edges; 1.0 for user edges
  createdBy: string,     // "agent" | "user"
  status: string,        // "proposed" | "accepted" | "rejected"
  createdAt: datetime,
  reviewedAt: datetime (optional)
}]
```

Edges are undirected at the data layer; `type` carries the semantic direction
where it matters (`generalizes`, `enables`).

## Phased implementation

### Phase 1 — Curator agent + graph schema (~1 week)

**Purpose:** produce typed edges. Inspect in Neo4j Browser; tighten prompt if
signal-to-noise is bad. No UI yet.

**Docker setup**

- `docker-compose.yml` at repo root with a `neo4j:5-community` service, ports
  `7474` (browser) and `7687` (bolt), env `NEO4J_AUTH=neo4j/polymath-dev`,
  persistent volume for local data.
- `apps/web/.env.example` gains: `NEO4J_URI=bolt://localhost:7687`,
  `NEO4J_USER=neo4j`, `NEO4J_PASSWORD=polymath-dev`.
- `apps/web/src/lib/graph.ts` — new. Initializes `neo4j-driver` lazily; fails
  soft: if env is absent, every graph op is a no-op. Exports:
  `getDriver()`, `ensureConstraints()`, `upsertConcept()`,
  `upsertRelation()`, `getProposedEdges()`, `updateEdgeStatus()`,
  `getNeighbors(conceptId, depth)`, `getGraphSnapshot()`.
- Constraint: `CREATE CONSTRAINT concept_id_unique FOR (c:Concept) REQUIRE c.id IS UNIQUE`.

**Curator**

- `apps/web/src/lib/curator.ts` — new. After `persistTurn` succeeds, for each
  new concept in the turn, fetch top-K neighbors by embedding from Postgres
  (reuse `retrieval.ts` logic). For each `(concept, neighbor)` pair, call
  `gpt-5.2-mini` with a tight prompt and expect strict JSON:
  `{ proposal: null | { type, rationale, citedInsightIds, confidence } }`.
  Skip pairs that have an existing accepted or rejected edge.
- Persist accepted proposals as `status: "proposed"` via
  `upsertRelation()`.
- Fires from `/api/research` after the `done` event, fire-and-forget. Logs
  the count of proposals per turn.

**Verification**

- Run a 5-turn mixed-discipline seeded session locally. Inspect Neo4j
  Browser for reasonableness. If >50% of proposals are noise, tighten the
  curator prompt before Phase 2.
- Unit test: `curator.test.ts` with a mock model response, asserting the
  write path calls `upsertRelation` with the expected shape.

**Files**

- New: `docker-compose.yml`, `apps/web/src/lib/graph.ts`,
  `apps/web/src/lib/curator.ts`,
  `apps/web/test/curator.test.ts`.
- Modified: `apps/web/src/app/api/research/route.ts` (fire curator after
  `done`), `apps/web/.env.example`, `apps/web/package.json`
  (`neo4j-driver`).

### Phase 2 — Connections tray (~3–4 days)

**Purpose:** human-in-the-loop edge curation. Accepted edges become durable;
rejected ones are remembered so the curator doesn't re-propose them.

- `apps/web/src/app/api/connections/route.ts` — `GET` returns proposed edges
  with concept labels + citation details (joined across Neo4j + Postgres).
- `apps/web/src/app/api/connections/[id]/route.ts` — `POST` with body
  `{ action: "accept" | "reject", type?, note?: string }`. Retype allows
  changing the relation type when accepting; note replaces rationale.
- `apps/web/src/app/api/connections/manual/route.ts` — `POST` creates a
  user-authored edge. Body: `{ fromConceptId, toConceptId, type, note? }`.
  Written with `createdBy: "user", status: "accepted", confidence: 1.0`.
- UI: new `ConnectionsTray.tsx` component. Collapsible section inside the
  current artifact panel. Each proposal: `concept-a → relation → concept-b`,
  rationale, cited-insight chips linking back to insights. Three buttons:
  accept / reject / edit (opens retype + note form). "Add edge" opens a
  mini form with two concept pickers (autocomplete over existing concepts)
  and a relation selector.

**Verification**

- Accept a proposed edge; confirm it flips to `status: accepted` and no
  longer appears in the tray. Reject one; confirm it persists with
  `status: rejected` and is skipped by the curator on the next turn.
- Create a manual edge; confirm it writes with `createdBy: user`.

**Files**

- New: `apps/web/src/app/api/connections/route.ts`,
  `apps/web/src/app/api/connections/[id]/route.ts`,
  `apps/web/src/app/api/connections/manual/route.ts`,
  `apps/web/src/components/ConnectionsTray.tsx`.
- Modified: `apps/web/src/components/Workspace.tsx` (mount the tray),
  `apps/web/src/app/styles.css` (tray styling).

### Phase 3 — 2D canvas replaces artifact rail (~1.5 weeks)

**Purpose:** the graph becomes the right side. Artifact panel dies.

- `apps/web/src/app/api/graph-data/route.ts` — `GET` returns the full
  graph snapshot scoped to the current session's concepts plus one-hop
  neighbors from other sessions. Format: `{ nodes, edges }`.
- `ConceptCanvas.tsx` — new client component using `react-force-graph-2d`.
  Nodes = concepts, edges = accepted relations. Node size = `mentionCount`.
  Node color = discipline cluster, derived via co-occurrence in sessions
  (simple first pass: color by the session where the concept first
  appeared).
- Current turn's **staked insight concepts** render as a distinguished
  glowing node that pulses briefly on arrival.
- Hover a node → small inline card with latest claim + session title.
  Click a node → filters the chat column to messages touching that concept.
- Edge styling encodes relation type: solid = `generalizes` / `enables`,
  dashed = `analogous-to`, red-tinted = `tension-with` / `contrasts`.
- Relocation of displaced pieces:
  - **Staked insight** → a lead serif sentence above the assistant prose in
    the chat column.
  - **Evidence compass** → a small decoration under the answer.
  - **Caveats** → collapsed footnote block under the answer.
  - **Sources** → inline `[src-N]` superscripts within the prose, hover for
    details. (This is where the earlier "E" scholarly-margin idea lands.)
  - **Small insights** → disappear as cards; woven into the prose.

**Verification**

- Build a 5-turn session; confirm nodes + edges render; hover + click
  interactions work; filter resets on new session.
- Screenshot compare before/after to confirm the old artifact rail is
  truly gone (no regressions in chat surface).

**Files**

- New: `apps/web/src/app/api/graph-data/route.ts`,
  `apps/web/src/components/ConceptCanvas.tsx`.
- Modified: `apps/web/src/components/Workspace.tsx` (replace
  `ArtifactPanel` with `ConceptCanvas`; chat column takes full width up to
  reading measure; relocate staked/compass/caveats),
  `apps/web/src/app/styles.css`, `apps/web/src/lib/provider.ts` (prompt
  update: emit inline `[src-N]` marks and a distinguished lead sentence).
- Removed: `ArtifactPanel`, `StakedInsight`, `SmallInsight`,
  `EvidenceDots`, `SourceBadges`, `EvidenceCompass` (or relocated — see
  above).

### Phase 4 — 3D swap + chat evolution (~1 week)

**Purpose:** the brain map becomes alive; the chat column feels like
conversation, not a form.

- Swap `react-force-graph-2d` → `react-force-graph-3d`. Same data, same
  interactions. Depth encodes time: older concepts recede; current turn's
  concepts float toward the viewer.
- Camera defaults to a gentle auto-rotate that stops on interaction.
- Chat column evolves: widens, drops topbar chrome, more conversation feel.
  Settings move into a subtle gear affordance. Assistant messages carry the
  staked lead sentence as a serif pull-quote.
- Mobile: canvas collapses to a small summary pill; tap to open full-screen
  canvas as a modal.

**Verification**

- FPS at 60 with a 200-node graph on a MacBook. If below, fall back to 2D
  mode via a toggle.

**Files**

- Modified: `apps/web/src/components/ConceptCanvas.tsx` (renderer swap),
  `apps/web/src/components/Workspace.tsx` (chat column evolution),
  `apps/web/src/app/styles.css`.

## Cross-phase infrastructure

- **Startup:** `ensureConstraints()` runs on first Neo4j op per process,
  mirrors the Postgres `ensureSchema()` pattern.
- **Cascade:** when a session is deleted in Postgres, detach its
  `concept_mentions` from Neo4j concepts. If a concept has zero mentions
  remaining, delete the node (with all its edges).
- **Backfill:** one-time script `scripts/backfill-concepts-to-neo4j.ts`
  reads existing Postgres `concepts` rows into Neo4j as `:Concept` nodes.
  Idempotent.
- **No Vercel Cron.** Curator runs inline as fire-and-forget after each
  turn. Revisit if the turn's completion becomes user-visibly slow.
- **Secrets:** Neo4j credentials in Vercel env vars when deployed. Never
  committed.

## Model and cost posture

- Research turn: `gpt-5.2`, unchanged.
- Curator: `gpt-5.2-mini`. Budget per turn: at most K=8 candidate pairs ×
  ~300 input + 150 output tokens ≈ negligible. If cost-per-turn exceeds
  the research turn's cost, cap K to 4.
- Embedding calls (`text-embedding-3-small`): unchanged.

## Out of scope for this phase

- Public launch, auth, multi-user scoping (private MVP — app stays behind
  Vercel Deployment Protection).
- Paid AuraDB tier. Local Docker for dev; will migrate to AuraDB Free when
  the app runs outside the dev machine.
- Graph embedding / community detection beyond simple co-occurrence.
- Cross-session-level aggregation visualizations (e.g. "subjects I've
  explored this month"). Good idea, later.

## Revisit triggers (next phase)

- **Graph DB tier:** move to AuraDB paid when free tier's 200k nodes or
  400k relationships is within 50%, or when multiple concurrent family
  users start hitting rate limits.
- **2D → 3D decision already committed**, but the swap is trivial; don't
  pre-optimize.
- **Curator ontology widening:** if a relation type feels forced in >20%
  of user retypes, widen the ontology by one.
- **Move curator out of request path:** if turn latency or cost gets
  user-visibly worse, move curator to a background queue (Vercel Cron or
  a separate worker).

## Open items before Phase 1 starts

1. Confirm `docker-compose` lives at repo root vs. inside `apps/web/`. My
   lean: repo root — it will grow to include other infra services.
2. Confirm `gpt-5.2-mini` exact model ID at implementation time; fall back
   to `gpt-5.2` if mini isn't available at that level.
