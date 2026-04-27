# Michelangelo — Functional Spec

_Last updated: 2026-04-19_

## Purpose

A browser-first concept workspace that behaves like an ongoing conversation
with an interdisciplinary teacher. Each turn produces a concise plain-text
answer **and** a set of inspectable artifacts (core idea, analogies, parallels,
applications, unexplored directions, sources). Across turns and sessions, the workspace builds a concept memory
that surfaces cross-domain connections the user did not name.

Stated moat: **association, correlation, and pattern-finding across subjects
and disciplines.**

## Audience and stage

- Solo use today (the founder).
- Family and friends next.
- Eventual public release under a nonprofit open-source label (Red Lemon).

## Core user flows

### 1. First-time setup

User lands on the key-entry screen. They paste an OpenAI API key (stored in
`localStorage` only) or, if `OPENAI_API_KEY` is set on the server, the key
screen is skipped. `sk-mock` triggers mock mode with no model spend.

### 2. Starting a research session

User types a question in the composer and submits with **Send** or
**Cmd/Ctrl+Enter**. The first turn creates a new session with an auto-titled
record derived from the prompt's first line.

### 3. A research turn

While the model responds, the answer text streams live into the chat column.
When the structured tail finishes, the artifact rail on the right updates
with:

- a **summary** (title + framing),
- a **core** section (essence + plain-language explanation),
- **analogies** (2–5 concrete analogies + why each works),
- **parallels** (3–5 structural echoes in humanities/social sciences),
- **applications** (3–5 practical cross-domain uses),
- **unexplored** (2–4 ideas worth pondering next),
- a **sources** list (title, excerpt, reason, link),
- optional **founder mode** opportunities (product idea, MVP hook, failure mode, experiment).

### 4. Follow-up turns in the same session

The assistant receives:

- compact summaries of all prior turns,
- the full artifact set of the most recent turn,
- the last eight message turns verbatim,
- any cross-domain hits: concepts seen in other sessions that match the
  current question, each paired with one prior claim.

Insights and sources extend across turns rather than being replaced. If the
user references an earlier source ID or claim, the server injects the
matching artifact into context.

### 5. Returning to a prior session

On reload, the browser rehydrates the most-recent session from the server.
If the session has prior turns, a muted italic header reads
"Last time you were circling _{gist}_." — a dignity-of-returning cue
derived from the last turn's compact summary.

Concept underlines appear inline in assistant text where the current turn
touches a concept the user has seen before in a different session. Hovering
shows the earlier claim and its session title.

### 6. Session management

- **New session** — a button in the top bar clears everything and starts
  fresh.
- **Rename** — click the title to edit in place. Saves on blur or Enter.
- **Dismiss errors** — inline banner with a close control above the composer.
- No session list UI yet; the most recent session is auto-rehydrated on load.

### 7. Settings

- Paste / clear OpenAI key.
- No other preferences in v1.

## Content contract (what the assistant must produce)

Each turn returns:

- a plain-text answer (2–6 sentences);
- `artifacts`:
  - `summary` (title, framing),
  - `core` (essence, explanation),
  - 2–5 `analogies` (id, title, description, whyItWorks),
  - 3–5 `parallels` (id, domain, concept, connection, optional caveat),
  - 3–5 `applications` (id, domain, use, example),
  - 2–4 `unexplored` (id, idea, whyItMatters, optional suggestedNextStep),
  - `claims` (0–6 short claims for session memory),
  - `concepts` (2–10 kebab-case labels),
  - 3–5 `sources` (id, title, url, excerpt, reason),
  - optional `founderMode` opportunities;
- `compact` (gist ≤ 280 chars; up to 4 key claims ≤ 140 chars each).

Hard invariants enforced server-side:

- Artifact payload must satisfy schema for the five-act pedagogy model.
- `concepts` must be present for cross-session retrieval and graph linking.

## Brand and tone

- Released under **Red Lemon**, a nonprofit label. No commercial framing.
- Typography: Source Serif 4 for reading, Inter for UI chrome.
- A single earned accent color (warm red), used only where meaning justifies
  it (staked insight, concept underlines, brand mark, evidence bar).
- Motion is restrained: a 120 ms fade on new content; a blinking caret
  during streaming. No message-enter bounce, no typing dots.
- RL brand mark (red circle, lemon letters) sits fixed bottom-left.

## What v1 explicitly does not do

- No multi-user auth (Vercel Deployment Protection gates access).
- No session-history sidebar / picker.
- No paid tiers, donations, or commercial CTAs.
- No graph visualisation panel (the moat surfaces inline, not as a demo).
- No separate graph database; concept memory lives in Postgres + pgvector.
- No seeded moat-verification test yet (planned, behind `SEED_TEST=1`).
- No observability / analytics instrumentation.

## Known gaps to address next

- Visualisation: concept chips per insight; a small inline concept lattice.
- Unit test for staked/grounding invariants and the concept-span builder.
- Session-history picker for power users with many threads.
- Ontology and extraction for richer relations (supports, contradicts,
  analogous-to) — deferred until retrieval quality demands it.
