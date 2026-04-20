# Michelangelo — Architectural Spec

_Last updated: 2026-04-19_

## Shape

Single Next.js App Router application, one Postgres database, the OpenAI
Responses API. No graph database, no background worker, no queue.

```
Browser (React 19)
  ├── Workspace UI (client component, NDJSON stream parser)
  └── localStorage (API key, last-session-id)
           │
           ▼
Next.js API routes (Node runtime, serverless-friendly)
  ├── POST /api/research         — streaming research turn
  ├── GET  /api/session/[id]     — session rehydration payload
  ├── PATCH /api/session/[id]    — rename session
  ├── GET  /api/health           — liveness
  └── GET  /api/db-check         — storage mode check
           │
           ├──► OpenAI Responses API (streaming text + web_search tool)
           ├──► OpenAI Embeddings API (text-embedding-3-small)
           │
           ▼
Postgres  (or in-memory fallback for local dev)
  ├── sessions, messages, artifacts
  ├── turn_summaries              — compact per-turn recall
  ├── concepts (+ optional vector(1536))
  └── concept_mentions            — concept ↔ insight links
```

## Process boundaries

- Everything runs as Next.js functions on the Vercel runtime. No
  microservices.
- Long-running work (the research turn) happens inside a single streaming
  response handler; the stream is NDJSON so any client can consume it.
- Embedding backfill is fire-and-forget after the turn persists; failures
  log silently and do not block the user-visible response.

## Data layer

### Core tables (`sessions`, `messages`, `artifacts`)

- `sessions` — `id`, `title`, timestamps. One row per research thread.
- `messages` — flat append-only chat log, ordered by `created_at`.
- `artifacts` — one row per artifact _type_ per session. Full artifact sets
  are replaced atomically each turn via `DELETE + INSERT` inside a single
  transaction.

### Turn-level recall (`turn_summaries`)

A compact record per turn containing `gist`, `keyClaims`, source IDs, and
insight IDs. Used to build prompts for future turns without replaying the
full artifact history. Keeps per-turn context size roughly flat.

### Concept memory (`concepts`, `concept_mentions`)

- `concepts.id` is a kebab-case label; `mention_count` grows on each
  mention; `embedding vector(1536)` is added when the `vector` extension is
  available.
- `concept_mentions` link a concept to an insight within a session with the
  turn index.
- Both are populated inside the same transaction as the artifact write.

### Fallbacks

If no `POSTGRES_URL` / `DATABASE_URL` is set, storage falls back to
in-memory maps for fast local development. If `vector` extension is absent,
retrieval degrades to a case-insensitive label substring match.

## Request flow (a research turn)

1. Client POSTs `{ prompt, sessionId?, apiKey? }` to `/api/research`.
2. Server resolves the effective API key (client → server env).
3. Server creates the session if new; sends a `session` event.
4. Server captures `listMessages`, `listArtifacts`, `listTurnSummaries`
   **before** persisting the current user prompt, so the provider sees
   strictly prior turns.
5. Server computes cross-domain hits via `retrieval.ts` (pgvector if
   available; label match otherwise) and formats them into a prompt block.
6. Server streams from OpenAI with `client.responses.stream`. The model is
   instructed to emit plain-text answer first, then the marker
   `<<<ARTIFACTS>>>`, then strict JSON.
7. Server forwards answer tokens to the client as `delta` events in real
   time; buffers the JSON tail.
8. On stream close, the JSON tail is parsed, Zod-validated, and run through
   `enforceStakedAndGrounding` (invariants: exactly one staked insight;
   direct-evidence insights must quote their source).
9. Server calls `persistTurn` — atomic write of artifacts + turn summary +
   concept upserts + mentions.
10. Server computes concept underline spans against the final answer and
    emits a `concept-spans` event, followed by `artifacts` and `done`.
11. Background: `backfillConceptEmbeddings` embeds newly-seen concepts.

## Client architecture

- Single client component `Workspace.tsx` holds session, messages,
  artifacts, concept spans, status, and error state.
- NDJSON stream reader unpacks the server event types:
  `session | status | delta | artifacts | concept-spans | done | error`.
- Rehydration on mount: if `polymath.sessionId` exists in localStorage,
  `GET /api/session/[id]` restores session, messages, artifacts, and the
  last-turn gist.
- Sub-components: `MessageBubble`, `AssistantText` (concept-underlined
  prose), `ArtifactPanel`, `EvidenceCompass`, `EvidenceDots`,
  `SourceBadges`, `StakedInsight`, `SmallInsight`.

## External dependencies

- `next` (App Router, standalone output for Vercel).
- `react` 19, `react-dom` 19.
- `openai` — streaming Responses API and embeddings.
- `pg` — node-postgres pool; `pgvector` extension enabled opportunistically.
- `zod` — schema validation at the provider boundary and API boundaries.
- `next/font/google` — Source Serif 4 and Inter.
- Favicon service: `www.google.com/s2/favicons` (read-only, privacy-free
  hotlink).

## Environment

- `OPENAI_API_KEY` (optional; if set, users skip the key screen).
- `OPENAI_MODEL` (default `gpt-5.2`).
- `POSTGRES_URL` or `DATABASE_URL` (optional; triggers Postgres mode).
- `MOCK_MODEL` (`true` to short-circuit to built-in mock data).

## Non-functional choices

- **Single language, single deploy target.** One TS stack on Vercel. No
  separate Python / graph-DB service.
- **Graceful degradation.** No Postgres → in-memory. No pgvector → label
  match. No OpenAI embeddings → no cross-domain retrieval, app still works.
- **Blast-radius containment.** If the graph/concept layer disappeared
  tomorrow, sessions/messages/artifacts still function end-to-end.
- **Nonprofit, open source.** MIT license, no commercial hooks, no
  analytics, no telemetry by default.

## Deliberate non-choices (with revisit triggers)

- **No graph database.** Revisit if concept retrieval in Postgres hits a
  wall at ≥ 1k concepts, or multi-hop traversal becomes a user-facing need.
- **No LLM-emitted relation edges** (supports/contradicts/analogous-to).
  Revisit when the concept chip flow is live and label-only association
  stops carrying the moat.
- **No session picker / sidebar.** Defer until >10 sessions makes absence
  painful.
- **No observability instrumentation.** Add when there are enough users
  that a silent failure would hurt.
