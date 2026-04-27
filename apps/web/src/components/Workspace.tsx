"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { ConceptCanvas } from "./ConceptCanvas";
import { CitationHoverCard } from "./CitationHoverCard";
import { MarkdownAnswer } from "./MarkdownAnswer";
import { SessionSidebar } from "./SessionSidebar";
import type {
  ApplicationArtifact,
  FounderOpportunity,
  ChatMessage,
  ConceptSpanForClient,
  ParallelArtifact,
  ResearchArtifacts,
  ResearchDepth,
  ResearchEvent,
  SessionRecord,
  SourceArtifact
} from "../lib/types";
import { parseResearchEventLine } from "../lib/ndjson";

const KEY_STORAGE = "polymath.openaiKey";
const SESSION_STORAGE = "polymath.sessionId";
const DEPTH_STORAGE = "polymath.depth";
const SIDEBAR_STORAGE = "polymath.sidebarOpen";

type WorkspaceProps = {
  hasServerOpenAiKey: boolean;
  hasServerMockMode: boolean;
};

type ConceptSpansByMessage = Record<string, ConceptSpanForClient[]>;
type DatabaseState = {
  status: "checking" | "ready" | "degraded";
  reason: string | null;
};

const STARTER_CONCEPTS = [
  "Entropy",
  "Recursion",
  "Game Theory",
  "Bayes' Theorem",
  "Compression",
  "Emergence",
  "Turing Completeness",
  "Signal vs Noise"
];
const STARTER_PREVIEW_COUNT = 4;
const RAIL_PREVIEW_COUNT = 3;
const SOURCE_PREVIEW_COUNT = 4;

const DEPTH_LABEL: Record<ResearchDepth, string> = {
  quick: "Quick",
  standard: "Standard",
  deep: "Deep"
};

const DEPTHS: ResearchDepth[] = ["quick", "standard", "deep"];

export function Workspace({ hasServerOpenAiKey, hasServerMockMode }: WorkspaceProps) {
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
  const [isHydrating, setIsHydrating] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [isLate, setIsLate] = useState(false);
  const [showAllStarters, setShowAllStarters] = useState(false);
  const [depth, setDepth] = useState<ResearchDepth>("standard");
  const [founderMode, setFounderMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [databaseState, setDatabaseState] = useState<DatabaseState>({
    status: "checking",
    reason: null
  });
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const sourceArchiveRef = useRef<HTMLDivElement | null>(null);
  const settingsInputRef = useRef<HTMLInputElement | null>(null);
  const composerMenuRef = useRef<HTMLDivElement | null>(null);
  const hydratedRef = useRef(false);
  const currentAssistantIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sentAt) {
      setIsLate(false);
      return;
    }
    const timeout = window.setTimeout(() => setIsLate(true), 25_000);
    return () => window.clearTimeout(timeout);
  }, [sentAt]);

  const applySessionPayload = useCallback(
    (data: {
      session: SessionRecord;
      messages: ChatMessage[];
      artifacts: ResearchArtifacts | null;
      lastTurnGist: string | null;
    }) => {
      setSession(data.session);
      setMessages(data.messages);
      setArtifacts(data.artifacts);
      setLastTurnGist(data.lastTurnGist);
      const spanMap: ConceptSpansByMessage = {};
      for (const message of data.messages) {
        if (message.role === "assistant" && message.conceptSpans?.length) {
          spanMap[message.id] = message.conceptSpans;
        }
      }
      setConceptSpans(spanMap);
    },
    []
  );

  const loadSession = useCallback(
    async (id: string) => {
      setIsHydrating(true);
      setErrorMessage(null);
      try {
        const response = await fetch(`/api/session/${encodeURIComponent(id)}`);
        if (!response.ok) {
          if (response.status === 404) {
            localStorage.removeItem(SESSION_STORAGE);
          }
          setErrorMessage("Could not load that session.");
          return;
        }
        const data = (await response.json()) as {
          session: SessionRecord;
          messages: ChatMessage[];
          artifacts: ResearchArtifacts | null;
          lastTurnGist: string | null;
        };
        applySessionPayload(data);
        localStorage.setItem(SESSION_STORAGE, data.session.id);
      } catch {
        setErrorMessage("Could not load that session.");
      } finally {
        setIsHydrating(false);
      }
    },
    [applySessionPayload]
  );

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const savedKey = localStorage.getItem(KEY_STORAGE) ?? "";
    setApiKey(savedKey);
    setDraftKey(savedKey);

    const savedDepth = localStorage.getItem(DEPTH_STORAGE);
    if (savedDepth === "quick" || savedDepth === "standard" || savedDepth === "deep") {
      setDepth(savedDepth);
    }
    const savedSidebar = localStorage.getItem(SIDEBAR_STORAGE);
    if (savedSidebar === "false") setSidebarOpen(false);

    const savedSessionId = localStorage.getItem(SESSION_STORAGE);
    if (savedSessionId) void loadSession(savedSessionId);
  }, [loadSession]);

  useEffect(() => {
    if (session?.id) {
      localStorage.setItem(SESSION_STORAGE, session.id);
    }
  }, [session?.id]);

  useEffect(() => {
    localStorage.setItem(DEPTH_STORAGE, depth);
  }, [depth]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE, String(sidebarOpen));
  }, [sidebarOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSidebarOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    settingsInputRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  const refreshDatabaseState = useCallback(async () => {
    setDatabaseState((current) =>
      current.status === "ready" ? { status: "checking", reason: null } : current
    );
    try {
      const response = await fetch("/api/db-check", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; mode?: "postgres" | "memory"; reason?: string; error?: string }
        | null;
      if (!response.ok || !payload?.ok || !payload.mode) {
        setDatabaseState({
          status: "degraded",
          reason:
            payload?.reason ??
            payload?.error ??
            "Could not verify Postgres availability. Using in-memory storage."
        });
        return true;
      }
      setDatabaseState(
        payload.mode === "postgres"
          ? { status: "ready", reason: null }
          : {
              status: "degraded",
              reason: payload.reason ?? "Using in-memory storage until Postgres is available."
            }
      );
      return true;
    } catch {
      setDatabaseState({
        status: "degraded",
        reason: "Could not verify Postgres availability. Using in-memory storage."
      });
      return true;
    }
  }, []);

  useEffect(() => {
    void refreshDatabaseState();
  }, [refreshDatabaseState]);

  useEffect(() => {
    if (!composerMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (composerMenuRef.current?.contains(event.target as Node)) return;
      setComposerMenuOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setComposerMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [composerMenuOpen]);

  const resizeComposer = useCallback(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    const nextHeight = Math.min(textarea.scrollHeight, 240);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 240 ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    resizeComposer();
  }, [prompt, resizeComposer]);

  const hasServerAccess = hasServerOpenAiKey || hasServerMockMode;
  const hasUsableKey = apiKey.trim().length > 0 || hasServerAccess;
  const canStart = draftKey.trim().length > 0 || hasServerAccess;
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

  const openSettings = useCallback(() => {
    // Keep the draft synced before opening so edits always start from the saved key.
    setDraftKey(apiKey);
    setSettingsOpen(true);
  }, [apiKey]);

  const startNewSession = useCallback(() => {
    localStorage.removeItem(SESSION_STORAGE);
    setSession(null);
    setMessages([]);
    setArtifacts(null);
    setLastTurnGist(null);
    setConceptSpans({});
    setPrompt("");
    setStatus("");
    setErrorMessage(null);
    setComposerMenuOpen(false);
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
      setSidebarRefreshKey((current) => current + 1);
    } catch {
      setErrorMessage("Could not save the new title.");
    }
  }, [session, titleDraft]);

  const submit = useCallback(async () => {
    if (!hasUsableKey || prompt.trim().length <= 1 || isSending) return;
    const persistenceReady = await refreshDatabaseState();
    if (!persistenceReady) return;
    const text = prompt.trim();
    setErrorMessage(null);
    setComposerMenuOpen(false);
    const optimisticUser: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString()
    };
    const assistantId = crypto.randomUUID();
    currentAssistantIdRef.current = assistantId;
    const optimisticAssistant: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString()
    };

    setMessages((current) => [...current, optimisticUser, optimisticAssistant]);
    setPrompt("");
    setStatus("Opening a new research pass...");
    setIsSending(true);
    setSentAt(Date.now());

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(apiKey.trim() ? { apiKey } : {}),
          prompt: text,
          sessionId: session?.id,
          depth,
          forceFounderMode: founderMode
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
        } else if (event.type === "concept-spans") {
          const id = currentAssistantIdRef.current;
          if (id) {
            setConceptSpans((current) => ({ ...current, [id]: event.spans }));
          }
        } else if (event.type === "error") {
          throw new Error(event.message);
        } else if (event.type === "done") {
          setStatus("Reference cabinet updated.");
          setSidebarRefreshKey((current) => current + 1);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setErrorMessage(message);
      setStatus("");
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId && !message.content
            ? { ...message, content: "I could not complete that research pass." }
            : message
        )
      );
    } finally {
      setIsSending(false);
      setSentAt(null);
    }
  }, [apiKey, depth, founderMode, hasUsableKey, isSending, prompt, refreshDatabaseState, session?.id]);

  const onComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
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

  const sourceOrder = useMemo(
    () => new Map((artifacts?.sources ?? []).map((source, index) => [source.id, index + 1])),
    [artifacts]
  );
  const graphRefreshKey = useMemo(
    () => messages.length + (artifacts?.concepts.length ?? 0) + (session?.id ? 1 : 0),
    [artifacts?.concepts.length, messages.length, session?.id]
  );
  const starterConcepts = useMemo(
    () =>
      showAllStarters ? STARTER_CONCEPTS : STARTER_CONCEPTS.slice(0, STARTER_PREVIEW_COUNT),
    [showAllStarters]
  );

  const citedSourceIds = useMemo(() => {
    const ids = new Set<string>();
    const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    if (!lastAssistant) return ids;
    const regex = /\[(src-[\w-]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(lastAssistant.content)) !== null) {
      ids.add(match[1]);
    }
    return ids;
  }, [messages]);

  const scrollToSource = useCallback((srcId: string) => {
    const root = sourceArchiveRef.current;
    if (!root) return;
    const card = root.querySelector<HTMLElement>(`[data-source-id="${srcId}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("archive-card--pulse");
    void card.offsetWidth;
    card.classList.add("archive-card--pulse");
    window.setTimeout(() => card.classList.remove("archive-card--pulse"), 1700);
  }, []);

  if (!hasUsableKey) {
    return (
      <main className="key-screen">
        <section className="key-panel">
          <p className="eyebrow">Michelangelo</p>
          <h1>Open the atelier</h1>
          <p>
            Bring your OpenAI key to start a session. Browser keys stay local unless{" "}
            <code>OPENAI_API_KEY</code> is already set on the server or <code>MOCK_MODEL=true</code>{" "}
            is enabled.
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
            <button disabled={!canStart}>Enter workspace</button>
          </form>
          <p className="fine-print">
            For local smoke tests, use <code>sk-mock</code> or enable <code>MOCK_MODEL=true</code>.
          </p>
        </section>
      </main>
    );
  }

  const returningHeaderVisible = !isSending && messages.length === 0 && lastTurnGist;
  const showSilhouettes = !artifacts;

  return (
    <main className="workspace-page">
      <div
        className={
          sidebarOpen ? "workspace workspace--with-sidebar" : "workspace workspace--no-sidebar"
        }
      >
        <SessionSidebar
          activeSessionId={session?.id ?? null}
          refreshKey={sidebarRefreshKey}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((current) => !current)}
          onSelectSession={(id) => {
            if (id !== session?.id) void loadSession(id);
          }}
          onNewSession={startNewSession}
        />

        <section className="shell-panel chat-shell">
          <header className="topbar">
            <div className="topbar-title">
              <p className="eyebrow">Michelangelo</p>
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
                  {session?.title ?? "New research session"}
                </h1>
              )}
              {messages.length === 0 ? (
                <p className="topbar-caption">
                  Ask and read on the left. Answer, sources, and related threads stay in the
                  rail.
                </p>
              ) : null}
            </div>

            <div className="topbar-actions">
              <button className="toolbar-btn" onClick={startNewSession} type="button">
                New session
              </button>
              <button
                className="toolbar-btn toolbar-btn--ghost"
                onClick={openSettings}
                aria-haspopup="dialog"
                aria-expanded={settingsOpen}
                aria-controls="workspace-settings-dialog"
                type="button"
              >
                Settings
              </button>
            </div>
          </header>

          <div className="reading-well">
            <div className="reading-well-header">
              {isHydrating ? (
                <p className="hydration-header">
                  <span className="pulse-dot" aria-hidden />
                  Restoring your last session…
                </p>
              ) : null}

              {returningHeaderVisible ? (
                <p className="returning-header">
                  Last time you were circling <strong>{lastTurnGist}</strong>.
                </p>
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

              {databaseState.status === "degraded" && databaseState.reason ? (
                <div className="error-banner" role="alert">
                  <span>{databaseState.reason}</span>
                  <button type="button" onClick={() => void refreshDatabaseState()}>
                    Retry
                  </button>
                </div>
              ) : null}
            </div>

            <div className="messages" aria-live="polite">
              {messages.length === 0 ? (
                <div className="messages-empty-state">
                  <p>Your reading thread will appear here.</p>
                </div>
              ) : (
                messages.map((message, index) => {
                  const isLast = index === messages.length - 1;
                  return (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      spans={conceptSpans[message.id] ?? []}
                      sources={artifacts?.sources ?? []}
                      sourceOrder={sourceOrder}
                      onCitationClick={scrollToSource}
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
              {messages.length === 0 ? (
                <p className="composer-hint">Try a concept, mechanism, question, or contrast.</p>
              ) : null}
              <div className="composer-input-wrap">
                <div className="composer-menu-wrap" ref={composerMenuRef}>
                  <button
                    type="button"
                    className="composer-plus"
                    aria-label="Open prompt settings"
                    aria-expanded={composerMenuOpen}
                    aria-haspopup="menu"
                    onClick={() => setComposerMenuOpen((current) => !current)}
                  >
                    +
                  </button>
                  {composerMenuOpen ? (
                    <div className="composer-menu content-card" role="menu" aria-label="Prompt settings">
                      <section className="composer-menu-section">
                        <p className="composer-menu-label">Research depth</p>
                        <div className="depth-toggle" role="group" aria-label="Research depth">
                          {DEPTHS.map((option) => (
                            <button
                              key={option}
                              type="button"
                              className={depth === option ? "depth-btn depth-btn--active" : "depth-btn"}
                              onClick={() => setDepth(option)}
                              aria-pressed={depth === option}
                            >
                              {DEPTH_LABEL[option]}
                            </button>
                          ))}
                        </div>
                      </section>
                      <section className="composer-menu-section">
                        <label className="founder-toggle">
                          <input
                            type="checkbox"
                            checked={founderMode}
                            onChange={(event) => setFounderMode(event.target.checked)}
                          />
                          <span>Founder mode</span>
                        </label>
                      </section>
                      <section className="composer-menu-section">
                        <div className="composer-menu-row">
                          <p className="composer-menu-label">Starter prompts</p>
                          {STARTER_CONCEPTS.length > STARTER_PREVIEW_COUNT ? (
                            <button
                              type="button"
                              className="toolbar-btn toolbar-btn--ghost inline-toggle-btn"
                              onClick={() => setShowAllStarters((current) => !current)}
                            >
                              {showAllStarters ? "Fewer" : "More"}
                            </button>
                          ) : null}
                        </div>
                        <div className="starter-chips" role="list" aria-label="Starter concept prompts">
                          {starterConcepts.map((concept) => (
                            <button
                              key={concept}
                              type="button"
                              className="starter-chip"
                              role="listitem"
                              onClick={() => {
                                setPrompt(`Help me deeply understand ${concept}.`);
                                composerRef.current?.focus();
                              }}
                            >
                              {concept}
                            </button>
                          ))}
                        </div>
                      </section>
                    </div>
                  ) : null}
                </div>
                <textarea
                  id="research-prompt"
                  ref={composerRef}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={onComposerKeyDown}
                  aria-label="Research prompt"
                  placeholder="Ask for an explanation, model, contrast, or transfer."
                  rows={1}
                />
                <button
                  type="submit"
                  className={isSending ? "send-icon-btn send-icon-btn--working" : "send-icon-btn"}
                  disabled={!canSend}
                  aria-label={isSending ? "Researching" : "Send prompt"}
                  title={isSending ? "Researching..." : "Send"}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M2.2 13.2 14 8 2.2 2.8l1.5 4.1L10 8l-6.3 1.1-1.5 4.1Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              </div>

              <div className="composer-row">
                <span className="composer-status">
                  {isSending ? <span className="pulse-dot" aria-hidden /> : null}
                  {status ||
                    (databaseState.status === "checking"
                      ? "Checking persistent storage. Send will verify before it runs."
                      : databaseState.status === "degraded"
                        ? "Using in-memory storage until Postgres is available."
                        : "Idle. Press Enter to send. Shift+Enter adds a line. ⌘K toggles sessions.")}
                  {isSending && isLate ? (
                    <span className="composer-late">
                      &nbsp;Taking longer than usual, but the pass is still running.
                    </span>
                  ) : null}
                </span>
              </div>
            </form>
          </div>
        </section>

        <ArtifactRail
          artifacts={artifacts}
          sessionTitle={session?.title ?? null}
          sessionId={session?.id ?? null}
          isWorking={isSending}
          sourceOrder={sourceOrder}
          citedSourceIds={citedSourceIds}
          graphRefreshKey={graphRefreshKey}
          showSilhouettes={showSilhouettes}
          sourceArchiveRef={sourceArchiveRef}
        />
      </div>

      {settingsOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            id="workspace-settings-dialog"
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Settings</p>
                <h2 id="workspace-settings-title">Workspace key</h2>
              </div>
              <button className="toolbar-btn toolbar-btn--ghost" onClick={() => setSettingsOpen(false)} type="button">
                Close
              </button>
            </div>
            <label htmlFor="settings-key">OpenAI API key</label>
            <input
              id="settings-key"
              ref={settingsInputRef}
              value={draftKey}
              onChange={(event) => setDraftKey(event.target.value)}
              type="password"
              autoComplete="off"
            />
            <div className="modal-actions">
              <button type="button" disabled={!canSaveDraftKey} onClick={saveKey}>
                Save key
              </button>
              <button className="toolbar-btn toolbar-btn--ghost" type="button" onClick={clearKey}>
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
  sources,
  sourceOrder,
  isThinking,
  isStreaming,
  onCitationClick
}: {
  message: ChatMessage;
  spans: ConceptSpanForClient[];
  sources: SourceArtifact[];
  sourceOrder: Map<string, number>;
  isThinking?: boolean;
  isStreaming?: boolean;
  onCitationClick?: (srcId: string) => void;
}) {
  const isAssistant = message.role === "assistant";

  return (
    <article className={["message", message.role].join(" ")}>
      <span className="message-role">{isAssistant ? "Michelangelo" : "You"}</span>

      {isThinking ? (
        <div className="message-body muted">Thinking through the next pass…</div>
      ) : (
        <div className="message-body">
          {isAssistant ? (
            <MarkdownAnswer
              text={message.content}
              spans={spans}
              sources={sources}
              sourceOrder={sourceOrder}
              onCitationClick={onCitationClick}
            />
          ) : (
            message.content
          )}
          {isStreaming ? <span className="stream-cursor" aria-hidden /> : null}
        </div>
      )}
    </article>
  );
}

function ArtifactRail({
  artifacts,
  sessionTitle,
  sessionId,
  isWorking,
  sourceOrder,
  citedSourceIds,
  graphRefreshKey,
  showSilhouettes,
  sourceArchiveRef
}: {
  artifacts: ResearchArtifacts | null;
  sessionTitle: string | null;
  sessionId: string | null;
  isWorking: boolean;
  sourceOrder: Map<string, number>;
  citedSourceIds: Set<string>;
  graphRefreshKey: number;
  showSilhouettes: boolean;
  sourceArchiveRef: React.RefObject<HTMLDivElement | null>;
}) {
  const hasRelatedContent = Boolean(
    artifacts &&
      (artifacts.applications.length ||
        artifacts.analogies.length ||
        artifacts.parallels.length ||
        artifacts.unexplored.length ||
        artifacts.claims.length ||
        artifacts.concepts.length)
  );

  const citedSources = useMemo(() => {
    if (!artifacts) return [];
    return artifacts.sources.filter((source) => citedSourceIds.has(source.id));
  }, [artifacts, citedSourceIds]);

  return (
    <aside className="reference-column">
      <section className="shell-panel reference-panel core-shell">
        <header className="panel-header">
          <div>
            <p className="eyebrow">Answer</p>
            <h2 className="panel-title">
              {artifacts?.summary.title ?? sessionTitle ?? "Workspace waiting for a subject"}
            </h2>
          </div>
        </header>

        {artifacts ? (
          <div className="panel-stack">
            <article className="core-card">
              <p className="artifact-essence">{artifacts.core.essence}</p>
              <p className="artifact-copy">{artifacts.core.explanation}</p>
            </article>
            <details className="content-card rail-details">
              <summary>
                <span className="artifact-drawer-title">Session frame</span>
                <span className="artifact-drawer-meta">Context</span>
              </summary>
              <div className="artifact-drawer-body">
                <p className="panel-lede">{artifacts.summary.framing}</p>
              </div>
            </details>
          </div>
        ) : (
          <CoreSilhouette />
        )}
      </section>

      <section className="shell-panel reference-panel">
        <header className="panel-header">
          <div>
            <p className="eyebrow">Sources</p>
            <h2 className="panel-title">Source trail</h2>
          </div>
        </header>

        {artifacts?.sources.length ? (
          <div ref={sourceArchiveRef}>
            {citedSources.length > 0 ? (
              <div className="source-section">
                <p className="source-section-label">Cited in this turn</p>
                <SourceArchive
                  sources={citedSources}
                  sourceOrder={sourceOrder}
                  citedSourceIds={citedSourceIds}
                  previewCount={citedSources.length}
                  showToggle={false}
                />
              </div>
            ) : null}
            <div className="source-section">
              {citedSources.length > 0 ? (
                <p className="source-section-label">Full trail</p>
              ) : null}
              <SourceArchive
                sources={artifacts.sources}
                sourceOrder={sourceOrder}
                citedSourceIds={citedSourceIds}
                previewCount={SOURCE_PREVIEW_COUNT}
              />
            </div>
          </div>
        ) : showSilhouettes ? (
          <SourcesSilhouette />
        ) : (
          <div className="empty-panel empty-panel--compact">
            <p>Sources appear here with excerpts and why they matter.</p>
          </div>
        )}
      </section>

      <section className="shell-panel reference-panel">
        <header className="panel-header">
          <div>
            <p className="eyebrow">Related threads</p>
            <h2 className="panel-title">Supporting ideas</h2>
          </div>
        </header>

        {hasRelatedContent && artifacts ? (
          <div className="threads-grid">
            {artifacts.applications.length > 0 ? (
              <ArtifactDrawer title="Applications" count={artifacts.applications.length}>
                <PreviewList
                  items={artifacts.applications}
                  previewCount={RAIL_PREVIEW_COUNT}
                  renderItem={(application: ApplicationArtifact) => (
                    <li key={application.id} className="artifact-list-item">
                      <h4>
                        {application.domain}
                        <span>{application.use}</span>
                      </h4>
                      <p>{application.example}</p>
                    </li>
                  )}
                />
              </ArtifactDrawer>
            ) : null}

            {artifacts.analogies.length > 0 ? (
              <ArtifactDrawer title="Analogies" count={artifacts.analogies.length}>
                <PreviewList
                  items={artifacts.analogies}
                  previewCount={RAIL_PREVIEW_COUNT}
                  renderItem={(analogy) => (
                    <li key={analogy.id} className="artifact-list-item">
                      <h4>{analogy.title}</h4>
                      <p>{analogy.description}</p>
                      <p className="artifact-note">Why it works: {analogy.whyItWorks}</p>
                    </li>
                  )}
                />
              </ArtifactDrawer>
            ) : null}

            {artifacts.parallels.length > 0 ? (
              <ArtifactDrawer title="Parallels" count={artifacts.parallels.length}>
                <PreviewList
                  items={artifacts.parallels}
                  previewCount={RAIL_PREVIEW_COUNT}
                  renderItem={(parallel: ParallelArtifact) => (
                    <li key={parallel.id} className="artifact-list-item">
                      <h4>
                        {parallel.domain}
                        <span>{parallel.concept}</span>
                      </h4>
                      <p>{parallel.connection}</p>
                      {parallel.caveat ? (
                        <p className="artifact-note">Caveat: {parallel.caveat}</p>
                      ) : null}
                    </li>
                  )}
                />
              </ArtifactDrawer>
            ) : null}

            {artifacts.unexplored.length > 0 ? (
              <ArtifactDrawer title="Next threads" count={artifacts.unexplored.length}>
                <PreviewList
                  items={artifacts.unexplored}
                  previewCount={RAIL_PREVIEW_COUNT}
                  renderItem={(item) => (
                    <li key={item.id} className="artifact-list-item">
                      <h4>{item.idea}</h4>
                      <p>{item.whyItMatters}</p>
                      {item.suggestedNextStep ? (
                        <p className="artifact-note">Next step: {item.suggestedNextStep}</p>
                      ) : null}
                    </li>
                  )}
                />
              </ArtifactDrawer>
            ) : null}

            {artifacts.claims.length > 0 ? (
              <ArtifactDrawer title="Claims" count={artifacts.claims.length}>
                <PreviewList
                  items={artifacts.claims}
                  previewCount={RAIL_PREVIEW_COUNT}
                  listClassName="artifact-list artifact-list--compact"
                  renderItem={(claim) => (
                    <li key={claim.id} className="artifact-list-item">
                      <p>{claim.claim}</p>
                    </li>
                  )}
                />
              </ArtifactDrawer>
            ) : null}

            {artifacts.concepts.length > 0 ? (
              <ArtifactDrawer title="Concepts" count={artifacts.concepts.length}>
                <PreviewChips items={artifacts.concepts} previewCount={8}>
                  {(concept) => (
                    <span key={concept} className="concept-chip concept-chip--static">
                      {concept}
                    </span>
                  )}
                </PreviewChips>
              </ArtifactDrawer>
            ) : null}
          </div>
        ) : showSilhouettes ? (
          <ThreadsSilhouette />
        ) : (
          <div className="empty-panel empty-panel--compact">
            <p>Related threads stay tucked here until the session branches out.</p>
          </div>
        )}
      </section>

      {artifacts?.founderMode?.opportunities.length ? (
        <section className="shell-panel reference-panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">Founder mode</p>
              <h2 className="panel-title">From idea to experiment</h2>
            </div>
          </header>
          <FounderOpportunitiesList opportunities={artifacts.founderMode.opportunities} />
        </section>
      ) : null}

      <ConceptCanvas
        sessionId={sessionId}
        refreshKey={graphRefreshKey}
        curatorWorking={isWorking}
      />
    </aside>
  );
}

function CoreSilhouette() {
  return (
    <div className="silhouette silhouette--core" aria-hidden>
      <div className="silhouette-line" style={{ width: "70%" }} />
      <div className="silhouette-block">
        <div className="silhouette-line" style={{ width: "92%" }} />
        <div className="silhouette-line" style={{ width: "86%" }} />
        <div className="silhouette-line" style={{ width: "62%" }} />
      </div>
    </div>
  );
}

function SourcesSilhouette() {
  return (
    <div className="silhouette silhouette--sources" aria-hidden>
      {[0, 1].map((index) => (
        <div className="silhouette-card" key={index}>
          <div className="silhouette-circle" />
          <div className="silhouette-block">
            <div className="silhouette-line" style={{ width: "55%" }} />
            <div className="silhouette-line" style={{ width: "82%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ThreadsSilhouette() {
  return (
    <div className="silhouette silhouette--threads" aria-hidden>
      {[0, 1, 2].map((index) => (
        <div className="silhouette-row" key={index}>
          <div className="silhouette-line" style={{ width: "40%" }} />
          <div className="silhouette-pill" />
        </div>
      ))}
    </div>
  );
}

function ArtifactDrawer({
  title,
  count,
  children,
  defaultOpen = false
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="content-card artifact-drawer" open={defaultOpen}>
      <summary>
        <span className="artifact-drawer-title">{title}</span>
        <span className="artifact-drawer-meta">
          {typeof count === "number" ? `${count} ${count === 1 ? "item" : "items"}` : "Open"}
        </span>
      </summary>
      <div className="artifact-drawer-body">{children}</div>
    </details>
  );
}

function PreviewList<T>({
  items,
  renderItem,
  previewCount,
  listClassName = "artifact-list"
}: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  previewCount: number;
  listClassName?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleItems = showAll ? items : items.slice(0, previewCount);

  useEffect(() => {
    setShowAll(false);
  }, [items.length]);

  return (
    <>
      <ul className={listClassName}>{visibleItems.map(renderItem)}</ul>
      {items.length > previewCount ? (
        <button
          type="button"
          className="toolbar-btn toolbar-btn--ghost preview-toggle-btn"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Show less" : `Show all ${items.length}`}
        </button>
      ) : null}
    </>
  );
}

function PreviewChips<T>({
  items,
  children,
  previewCount
}: {
  items: T[];
  children: (item: T) => React.ReactNode;
  previewCount: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleItems = showAll ? items : items.slice(0, previewCount);

  useEffect(() => {
    setShowAll(false);
  }, [items.length]);

  return (
    <>
      <div className="concept-chips">{visibleItems.map(children)}</div>
      {items.length > previewCount ? (
        <button
          type="button"
          className="toolbar-btn toolbar-btn--ghost preview-toggle-btn"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Show less" : `Show all ${items.length}`}
        </button>
      ) : null}
    </>
  );
}

function SourceArchive({
  sources,
  sourceOrder,
  citedSourceIds,
  previewCount,
  showToggle = true
}: {
  sources: SourceArtifact[];
  sourceOrder: Map<string, number>;
  citedSourceIds: Set<string>;
  previewCount: number;
  showToggle?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleSources = showAll || !showToggle ? sources : sources.slice(0, previewCount);

  useEffect(() => {
    setShowAll(false);
  }, [sources.length]);

  return (
    <div className="source-archive">
      {visibleSources.map((source) => {
        const number = sourceOrder.get(source.id) ?? 0;
        const domain = domainFromUrl(source.url);
        const isCited = citedSourceIds.has(source.id);
        return (
          <article
            key={source.id}
            data-source-id={source.id}
            className={
              isCited
                ? "content-card archive-card archive-card--cited"
                : "content-card archive-card"
            }
          >
            <div className="archive-card-header">
              <span className="archive-index">{number}</span>
              <div>
                <p className="archive-domain">{domain}</p>
                <h3>{source.title}</h3>
              </div>
            </div>
            {source.excerpt ? <p className="archive-excerpt">{source.excerpt}</p> : null}
            <p className="archive-reason">{source.reason}</p>
            <a className="archive-link" href={source.url} target="_blank" rel="noreferrer">
              Open source
            </a>
          </article>
        );
      })}
      {showToggle && sources.length > previewCount ? (
        <button
          type="button"
          className="toolbar-btn toolbar-btn--ghost preview-toggle-btn"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Show fewer sources" : `Show all ${sources.length}`}
        </button>
      ) : null}
    </div>
  );
}

function FounderOpportunitiesList({ opportunities }: { opportunities: FounderOpportunity[] }) {
  return (
    <PreviewList
      items={opportunities}
      previewCount={2}
      renderItem={(opportunity) => (
        <li key={opportunity.id} className="artifact-list-item">
          <h4>{opportunity.productIdea}</h4>
          <p>
            <strong>Target user:</strong> {opportunity.targetUser}
          </p>
          <p>
            <strong>Pain point:</strong> {opportunity.painPoint}
          </p>
          <p>
            <strong>1-week MVP:</strong> {opportunity.oneWeekMvp}
          </p>
          <p>
            <strong>Success signal:</strong> {opportunity.successSignal}
          </p>
          <p>
            <strong>Failure mode:</strong> {opportunity.failureMode}
          </p>
          <p className="artifact-note">
            <strong>Next experiment:</strong> {opportunity.nextExperiment}
          </p>
        </li>
      )}
    />
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
