"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  CaveatArtifact,
  ChatMessage,
  ConceptSpanForClient,
  EvidenceLevel,
  InsightArtifact,
  ResearchArtifacts,
  ResearchEvent,
  SessionRecord,
  SourceArtifact
} from "../lib/types";
import { buildRecallDrill, type RecallPrompt } from "../lib/learning";
import { parseResearchEventLine } from "../lib/ndjson";
import { ConnectionsTray } from "./ConnectionsTray";
import { ConceptCanvas } from "./ConceptCanvas";

const KEY_STORAGE = "polymath.openaiKey";
const SESSION_STORAGE = "polymath.sessionId";

type WorkspaceProps = {
  hasServerOpenAiKey: boolean;
};

type ConceptSpansByMessage = Record<string, ConceptSpanForClient[]>;
type LearningByMessage = Record<string, LearningCheckpoint>;

type LearningCheckpoint = {
  preConfidence: number;
  postConfidence: number | null;
  prompts: RecallPrompt[];
};

export function Workspace({ hasServerOpenAiKey }: WorkspaceProps) {
  const [apiKey, setApiKey] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [artifacts, setArtifacts] = useState<ResearchArtifacts | null>(null);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastTurnGist, setLastTurnGist] = useState<string | null>(null);
  const [conceptSpans, setConceptSpans] = useState<ConceptSpansByMessage>({});
  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [graphRefresh, setGraphRefresh] = useState(0);
  const [isHydrating, setIsHydrating] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [isLate, setIsLate] = useState(false);
  const [curatorWorking, setCuratorWorking] = useState(false);
  const [preConfidence, setPreConfidence] = useState(60);
  const [learningByMessage, setLearningByMessage] = useState<LearningByMessage>({});

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const hydratedRef = useRef(false);
  const currentAssistantIdRef = useRef<string | null>(null);
  const preConfidenceByAssistantRef = useRef<Record<string, number>>({});

  // "Taking longer than usual" hint: if a send has been in flight for ≥25s,
  // flip isLate so the composer status can reassure the user.
  useEffect(() => {
    if (!sentAt) {
      setIsLate(false);
      return;
    }
    const timeout = window.setTimeout(() => setIsLate(true), 25_000);
    return () => window.clearTimeout(timeout);
  }, [sentAt]);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const savedKey = localStorage.getItem(KEY_STORAGE) ?? "";
    setApiKey(savedKey);
    setDraftKey(savedKey);

    const savedSessionId = localStorage.getItem(SESSION_STORAGE);
    if (!savedSessionId) return;
    setIsHydrating(true);
    (async () => {
      try {
        const response = await fetch(`/api/session/${encodeURIComponent(savedSessionId)}`);
        if (!response.ok) {
          localStorage.removeItem(SESSION_STORAGE);
          setErrorMessage("Could not restore your last session.");
          return;
        }
        const data = (await response.json()) as {
          session: SessionRecord;
          messages: ChatMessage[];
          artifacts: ResearchArtifacts | null;
          lastTurnGist: string | null;
        };
        setSession(data.session);
        setMessages(data.messages);
        setArtifacts(data.artifacts);
        setLastTurnGist(data.lastTurnGist);
        const spanMap: ConceptSpansByMessage = {};
        for (const m of data.messages) {
          if (m.role === "assistant" && m.conceptSpans?.length) {
            spanMap[m.id] = m.conceptSpans;
          }
        }
        setConceptSpans(spanMap);
        setGraphRefresh((n) => n + 1);
      } catch {
        localStorage.removeItem(SESSION_STORAGE);
        setErrorMessage("Could not restore your last session.");
      } finally {
        setIsHydrating(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (session?.id) {
      localStorage.setItem(SESSION_STORAGE, session.id);
    }
  }, [session?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  const hasUsableKey = apiKey.trim().length > 0 || hasServerOpenAiKey;
  const canStart = draftKey.trim().length > 0 || hasServerOpenAiKey;
  const canSaveDraftKey = draftKey.trim().length > 0;
  const canSend = hasUsableKey && prompt.trim().length > 1 && !isSending;

  const saveKey = useCallback(
    (event?: { preventDefault(): void; stopPropagation(): void }) => {
      event?.preventDefault();
      event?.stopPropagation();
      const trimmed = draftKey.trim();
      if (!trimmed) return;
      localStorage.setItem(KEY_STORAGE, trimmed);
      setApiKey(trimmed);
      setSettingsOpen(false);
    },
    [draftKey]
  );

  const clearKey = useCallback(() => {
    localStorage.removeItem(KEY_STORAGE);
    setApiKey("");
    setDraftKey("");
  }, []);

  const startNewSession = useCallback(() => {
    localStorage.removeItem(SESSION_STORAGE);
    setSession(null);
    setMessages([]);
    setArtifacts(null);
    setLastTurnGist(null);
    setConceptSpans({});
    setLearningByMessage({});
    setPrompt("");
    setStatus("");
    setErrorMessage(null);
    composerRef.current?.focus();
  }, []);

  const saveTitle = useCallback(async () => {
    setEditingTitle(false);
    if (!session) return;
    const next = titleDraft.trim();
    if (!next || next === session.title) return;
    try {
      const response = await fetch(`/api/session/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next })
      });
      if (!response.ok) {
        setErrorMessage("Could not save the new title.");
        return;
      }
      const data = (await response.json()) as { session: SessionRecord };
      setSession(data.session);
    } catch {
      setErrorMessage("Could not save the new title.");
    }
  }, [session, titleDraft]);

  const submit = useCallback(async () => {
    if (!canSend) return;
    const text = prompt.trim();
    setErrorMessage(null);
    const optimisticUser: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString()
    };
    const assistantId = crypto.randomUUID();
    preConfidenceByAssistantRef.current[assistantId] = preConfidence;
    currentAssistantIdRef.current = assistantId;
    const optimisticAssistant: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString()
    };

    setMessages((current) => [...current, optimisticUser, optimisticAssistant]);
    setPrompt("");
    setStatus("Starting research...");
    setIsSending(true);
    setSentAt(Date.now());

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(apiKey.trim() ? { apiKey } : {}),
          prompt: text,
          sessionId: session?.id
        })
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Research request failed.");
      }

      await readResearchStream(response.body, (event) => {
        if (event.type === "session") {
          setSession(event.session);
        } else if (event.type === "status") {
          setStatus(event.message);
        } else if (event.type === "delta") {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + event.text }
                : message
            )
          );
        } else if (event.type === "artifacts") {
          setArtifacts(event.artifacts);
          const id = currentAssistantIdRef.current;
          if (id) {
            const captured = preConfidenceByAssistantRef.current[id] ?? preConfidence;
            setLearningByMessage((current) => ({
              ...current,
              [id]: {
                preConfidence: captured,
                postConfidence: null,
                prompts: buildRecallDrill(event.artifacts)
              }
            }));
          }
        } else if (event.type === "concept-spans") {
          const id = currentAssistantIdRef.current;
          if (id) {
            setConceptSpans((current) => ({ ...current, [id]: event.spans }));
          }
        } else if (event.type === "error") {
          throw new Error(event.message);
        } else if (event.type === "done") {
          setStatus("Artifacts updated.");
          // Curator runs fire-and-forget on the server. Show a visible "working"
          // state in the right rail until the refresh lands, so the user knows
          // new connections/nodes may still be arriving.
          setCuratorWorking(true);
          window.setTimeout(() => {
            setGraphRefresh((n) => n + 1);
            // Leave a short tail so the "curator working" state is perceptible
            // even on fast runs; ConnectionsTray will clear it when it refetches.
            window.setTimeout(() => setCuratorWorking(false), 1200);
          }, 3500);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setErrorMessage(message);
      setStatus("");
      setMessages((current) =>
        current.map((m) =>
          m.id === assistantId && !m.content
            ? { ...m, content: "I could not complete that research pass." }
            : m
        )
      );
    } finally {
      setIsSending(false);
      setSentAt(null);
    }
  }, [apiKey, canSend, preConfidence, prompt, session?.id]);

  const onComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void submit();
      }
    },
    [submit]
  );

  const onFormSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      void submit();
    },
    [submit]
  );

  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  }, [messages]);

  if (!hasUsableKey) {
    return (
      <main className="key-screen">
        <section className="key-panel">
          <p className="eyebrow">Michelangelo</p>
          <h1>Start with your OpenAI key</h1>
          <p>
            The MVP uses your key for each request unless <code>OPENAI_API_KEY</code> is set on the
            server. Browser keys are stored locally for convenience and are not saved to the app
            database.
          </p>
          <form onSubmit={saveKey} className="key-form">
            <label htmlFor="openai-key">OpenAI API key</label>
            <input
              id="openai-key"
              value={draftKey}
              onChange={(event) => setDraftKey(event.target.value)}
              placeholder="sk-..."
              type="password"
              autoComplete="off"
            />
            <button disabled={!canStart}>Open workspace</button>
          </form>
          <p className="fine-print">
            For local CI and smoke tests, use <code>sk-mock</code> to run without model calls.
          </p>
        </section>
      </main>
    );
  }

  const returningHeaderVisible = !isSending && messages.length === 0 && lastTurnGist;

  return (
    <main className="workspace">
      <section className="chat">
        <header className="topbar">
          <div className="topbar-title">
            {editingTitle ? (
              <input
                className="title-input"
                autoFocus
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={saveTitle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveTitle();
                  } else if (event.key === "Escape") {
                    setEditingTitle(false);
                  }
                }}
              />
            ) : (
              <h1
                className={session ? "title-display title-display--editable" : "title-display"}
                onClick={() => {
                  if (!session) return;
                  setTitleDraft(session.title);
                  setEditingTitle(true);
                }}
                aria-label={session ? "Session title (click to rename)" : undefined}
              >
                {session?.title ?? "New research pass"}
                {session ? <span className="title-edit-hint" aria-hidden>rename</span> : null}
              </h1>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className="icon-btn"
              onClick={startNewSession}
              type="button"
              title="Start a new session"
              aria-label="Start a new session"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M8 3v10M3 8h10"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              className="icon-btn"
              onClick={() => setSettingsOpen(true)}
              type="button"
              title="Settings"
              aria-label="Settings"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 0 1 .804.98v1.361a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.294 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.294A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.38 3.03l1.25.834a6.957 6.957 0 0 1 1.416-.587l.294-1.473zM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"
                />
              </svg>
            </button>
          </div>
        </header>

        {isHydrating ? (
          <p className="hydration-header">
            <span className="pulse-dot" aria-hidden />
            Restoring your last session…
          </p>
        ) : null}

        {returningHeaderVisible ? (
          <p className="returning-header">Last time you were circling {lastTurnGist}.</p>
        ) : null}

        {errorMessage ? (
          <div className="error-banner" role="alert">
            <span>{errorMessage}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setErrorMessage(null)}
            >
              ×
            </button>
          </div>
        ) : null}

        <div className="messages" aria-live="polite">
          {messages.length === 0 ? (
            <div className="empty">
              Ask anything. Michelangelo reasons carefully, cites its sources, and surfaces
              connections you didn&apos;t think to ask for.
            </div>
          ) : (
            messages.map((message, index) => {
              const isLast = index === messages.length - 1;
              const isLastAssistant = message.id === lastAssistantId;
              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  spans={conceptSpans[message.id] ?? []}
                  artifacts={isLastAssistant ? artifacts : null}
                  learning={learningByMessage[message.id] ?? null}
                  onPostConfidenceChange={(value) =>
                    setLearningByMessage((current) => {
                      const existing = current[message.id];
                      if (!existing) return current;
                      return {
                        ...current,
                        [message.id]: { ...existing, postConfidence: value }
                      };
                    })
                  }
                  isThinking={
                    isSending && message.role === "assistant" && message.content.trim().length === 0
                  }
                  isStreaming={
                    isSending &&
                    message.role === "assistant" &&
                    isLast &&
                    message.content.trim().length > 0
                  }
                />
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="composer" onSubmit={onFormSubmit}>
          <textarea
            ref={composerRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder="Pose a question. Cmd/Ctrl+Enter to send."
            rows={4}
          />
          <div className={`composer-row${isSending ? " composer-row--busy" : ""}`}>
            <div className="composer-meta">
              <label className="confidence-inline">
                <span>Current confidence</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={preConfidence}
                  onChange={(event) => setPreConfidence(Number(event.target.value))}
                />
                <strong>{preConfidence}%</strong>
              </label>
              <span className="composer-status">
                {isSending ? <span className="pulse-dot" aria-hidden /> : null}
                {status || "Idle — Cmd/Ctrl+Enter to send."}
                {isSending && isLate ? (
                  <span className="composer-late">
                    &nbsp;— taking a moment; the model hasn't given up.
                  </span>
                ) : null}
              </span>
            </div>
            <button
              className={isSending ? "send-btn send-btn--working" : "send-btn"}
              disabled={!canSend}
            >
              {isSending ? "Researching..." : "Send"}
            </button>
          </div>
        </form>
      </section>

      <aside className="sidebar">
        <ConceptCanvas
          sessionId={session?.id ?? null}
          refreshKey={graphRefresh}
          curatorWorking={curatorWorking}
        />
        <ConnectionsTray refreshKey={graphRefresh} curatorWorking={curatorWorking} />
      </aside>

      {settingsOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Settings</h2>
              <button className="ghost" onClick={() => setSettingsOpen(false)} type="button">
                Close
              </button>
            </div>
            <label htmlFor="settings-key">OpenAI API key</label>
            <input
              id="settings-key"
              value={draftKey}
              onChange={(event) => setDraftKey(event.target.value)}
              type="password"
              autoComplete="off"
            />
            <div className="modal-actions">
              <button type="button" disabled={!canSaveDraftKey} onClick={saveKey}>
                Save key
              </button>
              <button className="ghost" type="button" onClick={clearKey}>
                Clear key
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function MessageBubble({
  message,
  spans,
  artifacts,
  learning,
  onPostConfidenceChange,
  isThinking,
  isStreaming
}: {
  message: ChatMessage;
  spans: ConceptSpanForClient[];
  artifacts: ResearchArtifacts | null;
  learning: LearningCheckpoint | null;
  onPostConfidenceChange(value: number): void;
  isThinking?: boolean;
  isStreaming?: boolean;
}) {
  const isAssistant = message.role === "assistant";
  const stakedClaim = useMemo(() => {
    if (!artifacts) return null;
    return artifacts.insights.find((insight) => insight.staked)?.claim ?? null;
  }, [artifacts]);

  const sourceOrder = useMemo(() => {
    if (!artifacts) return new Map<string, number>();
    return new Map(artifacts.sources.map((source, index) => [source.id, index + 1]));
  }, [artifacts]);

  return (
    <article className={["message", message.role].join(" ")}>
      <span className="message-role">{isAssistant ? "Assistant" : "You"}</span>

      {isAssistant && stakedClaim ? (
        <p className="staked-lead">{stakedClaim}</p>
      ) : null}

      {isThinking ? (
        <p className="message-body muted">Thinking…</p>
      ) : (
        <p className="message-body">
          {isAssistant ? (
            <AssistantProse
              text={message.content}
              spans={spans}
              sources={artifacts?.sources ?? []}
              sourceOrder={sourceOrder}
            />
          ) : (
            message.content
          )}
          {isStreaming ? <span className="stream-cursor" aria-hidden /> : null}
        </p>
      )}

      {isAssistant && artifacts ? (
        <>
          {learning ? (
            <LearningCheckpointCard
              checkpoint={learning}
              onPostConfidenceChange={onPostConfidenceChange}
            />
          ) : null}
          <EvidenceCompass insights={artifacts.insights} />
          {artifacts.sources.length > 0 ? (
            <Endnotes sources={artifacts.sources} sourceOrder={sourceOrder} />
          ) : null}
          {artifacts.caveats.length > 0 ? <Footnotes caveats={artifacts.caveats} /> : null}
        </>
      ) : null}
    </article>
  );
}

type Insertion =
  | { kind: "citation"; start: number; end: number; srcId: string }
  | { kind: "concept"; start: number; end: number; span: ConceptSpanForClient };

function AssistantProse({
  text,
  spans,
  sources,
  sourceOrder
}: {
  text: string;
  spans: ConceptSpanForClient[];
  sources: SourceArtifact[];
  sourceOrder: Map<string, number>;
}) {
  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);

  const insertions: Insertion[] = useMemo(() => {
    const list: Insertion[] = [];
    const citationRegex = /\[src-(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = citationRegex.exec(text)) !== null) {
      list.push({
        kind: "citation",
        start: match.index,
        end: match.index + match[0].length,
        srcId: `src-${match[1]}`
      });
    }
    for (const span of spans) {
      list.push({ kind: "concept", start: span.start, end: span.end, span });
    }
    list.sort((a, b) => a.start - b.start);
    const pruned: Insertion[] = [];
    let cursor = 0;
    for (const ins of list) {
      if (ins.start < cursor) continue;
      pruned.push(ins);
      cursor = ins.end;
    }
    return pruned;
  }, [text, spans]);

  if (insertions.length === 0) return <>{text}</>;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  insertions.forEach((insertion, index) => {
    if (insertion.start > cursor) {
      nodes.push(<span key={`t-${index}`}>{text.slice(cursor, insertion.start)}</span>);
    }
    if (insertion.kind === "concept") {
      const span = insertion.span;
      const tooltip = span.priorSessionTitle
        ? `From "${span.priorSessionTitle}" (turn ${span.priorTurnIndex}): ${span.priorClaim ?? ""}`
        : span.conceptLabel;
      nodes.push(
        <span key={`c-${index}`} className="concept-underline" title={tooltip}>
          {text.slice(span.start, span.end)}
        </span>
      );
    } else {
      const source = sourceById.get(insertion.srcId);
      const num = sourceOrder.get(insertion.srcId);
      if (!source || !num) {
        // Citation marker without a known source — show a small muted mark so the prose flows.
        nodes.push(
          <sup key={`u-${index}`} className="citation citation--unknown" title={insertion.srcId}>
            ?
          </sup>
        );
      } else {
        nodes.push(
          <sup key={`s-${index}`} className="citation">
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              title={`${source.title}${source.excerpt ? ` — ${source.excerpt}` : ""}`}
            >
              {num}
            </a>
          </sup>
        );
      }
    }
    cursor = insertion.end;
  });
  if (cursor < text.length) {
    nodes.push(<span key="tail">{text.slice(cursor)}</span>);
  }
  return <>{nodes}</>;
}

function LearningCheckpointCard({
  checkpoint,
  onPostConfidenceChange
}: {
  checkpoint: LearningCheckpoint;
  onPostConfidenceChange(value: number): void;
}) {
  const delta =
    checkpoint.postConfidence == null ? null : checkpoint.postConfidence - checkpoint.preConfidence;

  return (
    <section className="learning-card">
      <p className="eyebrow">Learning checkpoint</p>
      <p className="learning-card-copy">
        Quick recall and transfer prompts. Try to answer first, then expand to compare.
      </p>
      <ol className="learning-prompts">
        {checkpoint.prompts.map((prompt) => (
          <li key={prompt.id}>
            <p>
              <strong>{prompt.kind === "transfer" ? "Transfer" : "Recall"}:</strong>{" "}
              {prompt.question}
            </p>
            <details>
              <summary>Show sample answer</summary>
              <p>{prompt.sampleAnswer}</p>
            </details>
          </li>
        ))}
      </ol>
      <label className="learning-confidence">
        <span>Confidence after review</span>
        <input
          type="range"
          min={0}
          max={100}
          value={checkpoint.postConfidence ?? checkpoint.preConfidence}
          onChange={(event) => onPostConfidenceChange(Number(event.target.value))}
        />
        <strong>{checkpoint.postConfidence ?? checkpoint.preConfidence}%</strong>
      </label>
      {delta != null ? (
        <p className="learning-delta">
          Confidence shift: {delta > 0 ? "+" : ""}
          {delta}% (before {checkpoint.preConfidence}%)
        </p>
      ) : null}
    </section>
  );
}

function Endnotes({
  sources,
  sourceOrder
}: {
  sources: SourceArtifact[];
  sourceOrder: Map<string, number>;
}) {
  return (
    <ol className="endnotes">
      {sources.map((source) => {
        const num = sourceOrder.get(source.id) ?? 0;
        const domain = domainFromUrl(source.url);
        return (
          <li key={source.id} value={num}>
            <a className="endnote-link" href={source.url} target="_blank" rel="noreferrer">
              <img
                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                alt=""
                width={12}
                height={12}
                loading="lazy"
              />
              <span className="endnote-title">{source.title}</span>
              <span className="endnote-domain">{domain}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

function Footnotes({ caveats }: { caveats: CaveatArtifact[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="footnotes"
      open={open}
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="eyebrow">Caveats · {caveats.length}</span>
      </summary>
      <ul>
        {caveats.map((caveat) => (
          <li key={caveat.id}>
            <span className={`caveat-severity caveat-severity--${caveat.severity}`}>
              {caveat.severity}
            </span>
            <span>{caveat.text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

const EVIDENCE_ORDER: EvidenceLevel[] = ["direct", "strong", "tentative", "speculative"];
const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  direct: "direct",
  strong: "strong",
  tentative: "tentative",
  speculative: "speculative"
};

function EvidenceCompass({ insights }: { insights: InsightArtifact[] }) {
  const counts = EVIDENCE_ORDER.reduce<Record<EvidenceLevel, number>>(
    (acc, level) => {
      acc[level] = insights.filter((insight) => insight.evidenceLevel === level).length;
      return acc;
    },
    { direct: 0, strong: 0, tentative: 0, speculative: 0 }
  );
  const total = insights.length || 1;

  return (
    <div className="evidence-compass" aria-label="Distribution of insights by evidence level">
      <div className="evidence-compass-bar">
        {EVIDENCE_ORDER.map((level) => {
          const pct = (counts[level] / total) * 100;
          if (pct === 0) return null;
          return (
            <span
              key={level}
              className={`evidence-compass-seg evidence-compass-seg--${level}`}
              style={{ width: `${pct}%` }}
              title={`${counts[level]} ${EVIDENCE_LABEL[level]}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function readResearchStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ResearchEvent) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseResearchEventLine(line);
      if (event) onEvent(event);
    }
  }

  const tail = parseResearchEventLine(buffer);
  if (tail) onEvent(tail);
}
