"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type RelationType =
  | "analogous-to"
  | "generalizes"
  | "tension-with"
  | "enables"
  | "contrasts";

const RELATION_TYPES: RelationType[] = [
  "analogous-to",
  "generalizes",
  "tension-with",
  "enables",
  "contrasts"
];

function isRelationType(value: string): value is RelationType {
  return (RELATION_TYPES as readonly string[]).includes(value);
}

type Citation = {
  insightId: string;
  claim: string;
  sessionId: string;
  sessionTitle: string;
  turnIndex: number;
};

type Proposal = {
  edgeId: string;
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  type: RelationType;
  rationale: string;
  citations: Citation[];
};

type ConceptOption = {
  id: string;
  label: string;
  mentionCount: number;
};

export function ConnectionsTray({ refreshKey }: { refreshKey: number }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [open, setOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const fetchProposals = useCallback(async () => {
    try {
      const response = await fetch("/api/connections", { cache: "no-store" });
      if (!response.ok) {
        setEnabled(false);
        return;
      }
      const data = (await response.json()) as { proposals: Proposal[] };
      setProposals(data.proposals ?? []);
      setEnabled(true);
    } catch {
      setEnabled(false);
    }
  }, []);

  useEffect(() => {
    void fetchProposals();
  }, [fetchProposals, refreshKey]);

  const review = useCallback(
    async (edgeId: string, body: { action: "accept" | "reject"; type?: RelationType; note?: string }) => {
      const response = await fetch("/api/connections/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edgeId, ...body })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setReviewError(data?.error ?? `Review failed (${response.status}).`);
        return;
      }
      setReviewError(null);
      setEditingId(null);
      await fetchProposals();
    },
    [fetchProposals]
  );

  if (!enabled) return null;

  return (
    <section className="connections-tray">
      <button
        type="button"
        className="connections-header ghost"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="eyebrow">Connections</span>
        <span className="connections-count">{proposals.length} proposed</span>
        <span className="connections-caret" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </button>

      {open ? (
        <div className="connections-body">
          {reviewError ? (
            <p className="manual-edge-error" role="alert">
              {reviewError}
            </p>
          ) : null}
          {proposals.length === 0 ? (
            <p className="muted connections-empty">
              No proposed connections yet. The curator surfaces candidate links as your sessions
              grow.
            </p>
          ) : (
            proposals.map((proposal) => (
              <ProposalRow
                key={proposal.edgeId}
                proposal={proposal}
                isEditing={editingId === proposal.edgeId}
                onEdit={() => setEditingId(proposal.edgeId)}
                onCancelEdit={() => setEditingId(null)}
                onReview={review}
              />
            ))
          )}

          <div className="connections-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => setAddOpen((v) => !v)}
              aria-expanded={addOpen}
            >
              {addOpen ? "Cancel" : "+ Add edge"}
            </button>
          </div>

          {addOpen ? (
            <ManualEdgeForm
              onDone={async () => {
                setAddOpen(false);
                await fetchProposals();
              }}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ProposalRow({
  proposal,
  isEditing,
  onEdit,
  onCancelEdit,
  onReview
}: {
  proposal: Proposal;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onReview: (
    edgeId: string,
    body: { action: "accept" | "reject"; type?: RelationType; note?: string }
  ) => Promise<void>;
}) {
  const [draftType, setDraftType] = useState<RelationType>(proposal.type);
  const [draftNote, setDraftNote] = useState(proposal.rationale);

  return (
    <article className="proposal-row">
      <p className="proposal-claim">
        <span className="proposal-concept">{labelize(proposal.fromLabel)}</span>
        <span className={`proposal-relation proposal-relation--${proposal.type}`}>
          {proposal.type.replace(/-/g, " ")}
        </span>
        <span className="proposal-concept">{labelize(proposal.toLabel)}</span>
      </p>
      <p className="proposal-rationale">{proposal.rationale}</p>

      {proposal.citations.length > 0 ? (
        <div className="proposal-citations">
          {proposal.citations.map((citation, citationIndex) => (
            <span
              key={`${citation.insightId}-${citationIndex}`}
              className="proposal-citation"
              title={`"${citation.claim}" — from ${citation.sessionTitle}, turn ${citation.turnIndex}`}
            >
              {truncate(citation.claim, 60)}
            </span>
          ))}
        </div>
      ) : null}

      {isEditing ? (
        <div className="proposal-edit">
          <label>
            <span className="proposal-edit-label">Relation</span>
            <select
              value={draftType}
              onChange={(event) => {
                const v = event.target.value;
                if (isRelationType(v)) setDraftType(v);
              }}
            >
              {RELATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/-/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="proposal-edit-label">Note (optional)</span>
            <textarea
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
              rows={2}
            />
          </label>
          <div className="proposal-edit-actions">
            <button
              type="button"
              onClick={() =>
                onReview(proposal.edgeId, { action: "accept", type: draftType, note: draftNote })
              }
            >
              Save &amp; accept
            </button>
            <button type="button" className="ghost" onClick={onCancelEdit}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="proposal-actions">
          <button type="button" onClick={() => onReview(proposal.edgeId, { action: "accept" })}>
            Accept
          </button>
          <button type="button" className="ghost" onClick={onEdit}>
            Edit
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => onReview(proposal.edgeId, { action: "reject" })}
          >
            Reject
          </button>
        </div>
      )}
    </article>
  );
}

function ManualEdgeForm({ onDone }: { onDone: () => Promise<void> }) {
  const [concepts, setConcepts] = useState<ConceptOption[]>([]);
  const [fromQuery, setFromQuery] = useState("");
  const [toQuery, setToQuery] = useState("");
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [type, setType] = useState<RelationType>("analogous-to");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const response = await fetch("/api/connections/concepts", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { concepts: ConceptOption[] };
      setConcepts(data.concepts ?? []);
    })();
  }, []);

  const submit = useCallback(async () => {
    if (!fromId || !toId) {
      setError("Pick two concepts.");
      return;
    }
    if (fromId === toId) {
      setError("Concepts must differ.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/connections/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromConceptId: fromId, toConceptId: toId, type, note: note || undefined })
    });
    setSubmitting(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not save edge.");
      return;
    }
    await onDone();
  }, [fromId, toId, type, note, onDone]);

  return (
    <div className="manual-edge">
      <ConceptPicker
        concepts={concepts}
        query={fromQuery}
        onQueryChange={setFromQuery}
        selectedId={fromId}
        onSelect={setFromId}
        placeholder="First concept"
      />
      <label>
        <span className="proposal-edit-label">Relation</span>
        <select
          value={type}
          onChange={(event) => {
            const v = event.target.value;
            if (isRelationType(v)) setType(v);
          }}
        >
          {RELATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/-/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <ConceptPicker
        concepts={concepts}
        query={toQuery}
        onQueryChange={setToQuery}
        selectedId={toId}
        onSelect={setToId}
        placeholder="Second concept"
      />
      <label>
        <span className="proposal-edit-label">Note (optional)</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
      </label>
      {error ? <p className="manual-edge-error">{error}</p> : null}
      <div className="proposal-edit-actions">
        <button type="button" disabled={submitting} onClick={submit}>
          {submitting ? "Saving…" : "Add edge"}
        </button>
      </div>
    </div>
  );
}

function ConceptPicker({
  concepts,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  placeholder
}: {
  concepts: ConceptOption[];
  query: string;
  onQueryChange: (value: string) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  placeholder: string;
}) {
  const [focused, setFocused] = useState(false);
  const timerRef = useRef<number | null>(null);

  const selected = concepts.find((c) => c.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return concepts.slice(0, 25);
    return concepts
      .filter(
        (concept) =>
          concept.label.toLowerCase().includes(q) || concept.id.toLowerCase().includes(q)
      )
      .slice(0, 25);
  }, [concepts, query]);

  const handleBlur = () => {
    timerRef.current = window.setTimeout(() => setFocused(false), 120);
  };
  const handleFocus = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setFocused(true);
  };

  return (
    <div className="concept-picker">
      <input
        type="text"
        value={selected ? labelize(selected.label) : query}
        onChange={(event) => {
          onSelect(null);
          onQueryChange(event.target.value);
        }}
        placeholder={placeholder}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {focused && filtered.length > 0 && !selected ? (
        <ul className="concept-picker-list" role="listbox">
          {filtered.map((concept) => (
            <li key={concept.id}>
              <button
                type="button"
                className="concept-picker-item"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(concept.id);
                  onQueryChange("");
                }}
              >
                {labelize(concept.label)}
                <span className="concept-picker-count">{concept.mentionCount}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function labelize(slug: string): string {
  return slug.replace(/-/g, " ");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
