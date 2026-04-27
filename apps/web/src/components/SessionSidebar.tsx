"use client";

import { useEffect, useState } from "react";
import type { SessionListItem } from "../lib/types";

type Props = {
  activeSessionId: string | null;
  refreshKey: number;
  isOpen: boolean;
  onToggle: () => void;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
};

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return RELATIVE.format(diffSec, "second");
  if (abs < 3600) return RELATIVE.format(Math.round(diffSec / 60), "minute");
  if (abs < 86_400) return RELATIVE.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86_400 * 7) return RELATIVE.format(Math.round(diffSec / 86_400), "day");
  return RELATIVE.format(Math.round(diffSec / 86_400 / 7), "week");
}

export function SessionSidebar({
  activeSessionId,
  refreshKey,
  isOpen,
  onToggle,
  onSelectSession,
  onNewSession
}: Props) {
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const response = await fetch("/api/sessions", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) setError("Could not load sessions.");
          return;
        }
        const data = (await response.json()) as { sessions: SessionListItem[] };
        if (!cancelled) setSessions(data.sessions);
      } catch {
        if (!cancelled) setError("Could not load sessions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <aside className={isOpen ? "session-sidebar session-sidebar--open" : "session-sidebar"}>
      <header className="session-sidebar-header">
        <p className="eyebrow">Sessions</p>
        <button
          type="button"
          className="toolbar-btn toolbar-btn--ghost session-sidebar-toggle"
          onClick={onToggle}
          aria-label={isOpen ? "Collapse sessions" : "Expand sessions"}
        >
          {isOpen ? "Hide" : "Show"}
        </button>
      </header>

      {isOpen ? (
        <>
          <button type="button" className="session-new-btn" onClick={onNewSession}>
            + New session
          </button>

          <div className="session-list" role="list">
            {loading && !sessions ? (
              <p className="session-list-empty">Loading…</p>
            ) : error ? (
              <p className="session-list-empty">{error}</p>
            ) : sessions && sessions.length > 0 ? (
              sessions.map((session) => {
                const active = session.id === activeSessionId;
                return (
                  <button
                    key={session.id}
                    type="button"
                    role="listitem"
                    className={
                      active ? "session-row session-row--active" : "session-row"
                    }
                    onClick={() => onSelectSession(session.id)}
                  >
                    <p className="session-row-title">{session.title}</p>
                    <p className="session-row-meta">{relativeTime(session.updatedAt)}</p>
                    {session.lastTurnGist ? (
                      <p className="session-row-gist">{session.lastTurnGist}</p>
                    ) : null}
                  </button>
                );
              })
            ) : (
              <p className="session-list-empty">No sessions yet. Start one below.</p>
            )}
          </div>
        </>
      ) : null}
    </aside>
  );
}
