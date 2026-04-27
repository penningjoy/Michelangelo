"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type RelationType =
  | "co-occurs"
  | "analogous-to"
  | "generalizes"
  | "tension-with"
  | "enables"
  | "contrasts";

type GraphNode = {
  id: string;
  label: string;
  mentionCount: number;
};

type GraphEdge = {
  edgeId: string;
  fromId: string;
  toId: string;
  type: RelationType;
  source: "co-occurrence" | "accepted-graph";
  strength: number;
};

type Snapshot = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  seedIds?: string[];
  enabled: boolean;
  source?: "postgres" | "postgres+neo4j" | "unavailable";
  reason?: string;
};

type PositionedNode = GraphNode & {
  x: number;
  y: number;
  radius: number;
  isSeed: boolean;
};

const RELATION_STROKE: Record<RelationType, string> = {
  "co-occurs": "rgba(108, 98, 88, 0.48)",
  "analogous-to": "#9b5838",
  generalizes: "#7b492b",
  enables: "#6a513b",
  "tension-with": "#b67d5d",
  contrasts: "#c08a67"
};

const RELATION_DASH: Partial<Record<RelationType, string>> = {
  "co-occurs": "5 5",
  "analogous-to": "5 4",
  contrasts: "4 4"
};

const RELATION_LABEL: Record<RelationType, string> = {
  "co-occurs": "Shared sessions",
  "analogous-to": "Analogy",
  generalizes: "Generalizes",
  enables: "Enables",
  "tension-with": "Tension",
  contrasts: "Contrast"
};

const SOURCE_LABEL: Record<NonNullable<Snapshot["source"]>, string> = {
  postgres: "Session memory",
  "postgres+neo4j": "Session memory + accepted links",
  unavailable: "Unavailable"
};

export function ConceptCanvas({
  sessionId,
  refreshKey,
  curatorWorking,
  onNodeClick
}: {
  sessionId: string | null;
  refreshKey: number;
  curatorWorking?: boolean;
  onNodeClick?: (conceptId: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 360, height: 270 });
  const [modalSize, setModalSize] = useState<{ width: number; height: number }>({ width: 1180, height: 640 });
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const modalStageRef = useRef<HTMLDivElement | null>(null);
  const prevSigRef = useRef<string>("");

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setSize({ width: Math.max(260, width), height: 270 });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isExpanded) return;
    const element = modalStageRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setModalSize({
          width: Math.max(640, Math.round(width)),
          height: Math.max(420, Math.round(height))
        });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [isExpanded]);

  useEffect(() => {
    let cancelled = false;
    setIsFetching(true);
    setFetchError(null);
    (async () => {
      try {
        const url = sessionId
          ? `/api/graph-data?sessionId=${encodeURIComponent(sessionId)}`
          : "/api/graph-data";
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) setFetchError("Could not load the content map.");
          return;
        }
        const data = (await response.json()) as Snapshot;
        if (!cancelled) {
          setSnapshot(data);
          const sig = `${data.nodes.length}:${data.edges.length}:${data.source ?? "na"}`;
          if (prevSigRef.current && prevSigRef.current !== sig) {
            setPulse(true);
            window.setTimeout(() => setPulse(false), 1600);
          }
          prevSigRef.current = sig;
        }
      } catch {
        if (!cancelled) setFetchError("Could not load the content map.");
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  const graphData = useMemo(() => {
    if (!snapshot) return { nodes: [] as PositionedNode[], edges: [] as GraphEdge[] };
    const seedSet = new Set(snapshot.seedIds ?? []);
    const nodes = layoutNodes(snapshot.nodes, seedSet, size.width, size.height, false);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = snapshot.edges.filter(
      (edge) => nodeIds.has(edge.fromId) && nodeIds.has(edge.toId)
    );
    return { nodes, edges };
  }, [snapshot, size.height, size.width]);

  const modalGraphData = useMemo(() => {
    if (!snapshot || !isExpanded) return { nodes: [] as PositionedNode[], edges: [] as GraphEdge[] };
    const seedSet = new Set(snapshot.seedIds ?? []);
    const nodes = layoutNodes(snapshot.nodes, seedSet, modalSize.width, modalSize.height, true);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = snapshot.edges.filter(
      (edge) => nodeIds.has(edge.fromId) && nodeIds.has(edge.toId)
    );
    return { nodes, edges };
  }, [snapshot, isExpanded, modalSize.height, modalSize.width]);

  const modalNodeById = useMemo(
    () => new Map(modalGraphData.nodes.map((node) => [node.id, node])),
    [modalGraphData.nodes]
  );

  const nodeById = useMemo(
    () => new Map(graphData.nodes.map((node) => [node.id, node])),
    [graphData.nodes]
  );
  const edgePills = useMemo(() => {
    const counts = new Map<RelationType, number>();
    for (const edge of graphData.edges) {
      counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort(([, countA], [, countB]) => countB - countA)
      .slice(0, 4)
      .map(([type, count]) => ({
        type,
        label: RELATION_LABEL[type],
        count
      }));
  }, [graphData.edges]);

  const hoveredNode = hoveredNodeId ? nodeById.get(hoveredNodeId) ?? null : null;
  const sourceLabel = snapshot?.source ? SOURCE_LABEL[snapshot.source] : SOURCE_LABEL.postgres;
  const headerMeta = fetchError
    ? fetchError
    : snapshot && !snapshot.enabled
      ? snapshot.reason ?? "Persistence is unavailable."
      : curatorWorking
        ? "Refreshing the latest structure."
        : `${graphData.nodes.length} concept${graphData.nodes.length === 1 ? "" : "s"}${
            graphData.edges.length > 0
              ? ` · ${graphData.edges.length} link${graphData.edges.length === 1 ? "" : "s"}`
              : ""
          } · ${sourceLabel}`;

  if (snapshot && !snapshot.enabled) {
    return (
      <section className="shell-panel reference-panel concept-canvas concept-canvas--disabled">
        <header className="panel-header">
          <div>
            <p className="eyebrow">Content map</p>
            <h2 className="panel-title">Persistence unavailable</h2>
          </div>
        </header>
        <p className="panel-note">{snapshot.reason ?? "Postgres must be available to build the map."}</p>
      </section>
    );
  }

  return (
    <section className="shell-panel reference-panel concept-canvas" ref={wrapperRef}>
      <header className="panel-header concept-canvas-header">
        <div>
          <p className="eyebrow">
            Content map
            {(isFetching || curatorWorking) && !fetchError ? (
              <span className="pulse-dot" aria-hidden title="Refreshing" />
            ) : null}
          </p>
          <h2 className="panel-title">Structure at a glance</h2>
          <p className="panel-note">{headerMeta}</p>
        </div>

        <div className="concept-canvas-controls">
          {!isCollapsed ? (
            <button
              className="toolbar-btn toolbar-btn--ghost concept-canvas-icon-btn"
              type="button"
              onClick={() => setIsExpanded((value) => !value)}
              aria-label={isExpanded ? "Compact map" : "Expand map"}
              title={isExpanded ? "Compact map" : "Expand map"}
            >
              {isExpanded ? (
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path
                    d="M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M8 8L3 3M16 8l5-5M8 16l-5 5M16 16l5 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path
                    d="M8 3H3v5M21 8V3h-5M16 21h5v-5M3 16v5h5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M3 3l5 5M21 3l-5 5M21 21l-5-5M3 21l5-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ) : null}
          <button
            className="toolbar-btn toolbar-btn--ghost concept-canvas-icon-btn"
            type="button"
            onClick={() =>
              setIsCollapsed((value) => {
                if (!value) setIsExpanded(false);
                return !value;
              })
            }
            aria-label={isCollapsed ? "Open map" : "Collapse map"}
            title={isCollapsed ? "Open map" : "Collapse map"}
          >
            {isCollapsed ? (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path
                  d="M4 7h16M4 12h16M4 17h10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M15 15l4-3-4-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path
                  d="M4 7h10M4 12h16M4 17h16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M19 15l-4-3 4-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </div>
      </header>

      {isCollapsed ? (
        <div className="concept-canvas-collapsed">
          <div className="concept-canvas-preview">
            <p>Keep the map tucked away until you need the bigger picture.</p>
            <div className="concept-canvas-stats" aria-hidden>
              <span>{graphData.nodes.length} concepts</span>
              <span>{graphData.edges.length} links</span>
            </div>
          </div>
        </div>
      ) : graphData.nodes.length === 0 ? (
        <div className="concept-canvas-empty">
          <svg className="concept-canvas-silhouette" viewBox="0 0 200 110" aria-hidden>
            <line x1="40" y1="55" x2="100" y2="32" />
            <line x1="100" y1="32" x2="160" y2="58" />
            <line x1="40" y1="55" x2="100" y2="86" />
            <line x1="100" y1="86" x2="160" y2="58" />
            <line x1="100" y1="32" x2="100" y2="86" />
            <circle cx="40" cy="55" r="8" />
            <circle cx="100" cy="32" r="9" />
            <circle cx="160" cy="58" r="8" />
            <circle cx="100" cy="86" r="7" />
          </svg>
          <p>Run a few turns and the map will begin to connect repeated ideas.</p>
        </div>
      ) : (
        <div
          className={[
            "concept-canvas-stage",
            pulse ? "concept-canvas-stage--pulse" : ""
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <svg
            viewBox={`0 0 ${size.width} ${size.height}`}
            className="concept-canvas-svg"
            role="img"
            aria-label="2D concept map"
          >
            {graphData.edges.map((edge) => {
              const from = nodeById.get(edge.fromId);
              const to = nodeById.get(edge.toId);
              if (!from || !to) return null;
              return (
                <line
                  key={edge.edgeId}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={RELATION_STROKE[edge.type]}
                  strokeOpacity={edge.source === "accepted-graph" ? 0.9 : 0.62}
                  strokeWidth={edge.source === "accepted-graph" ? 2.1 : 1.25 + edge.strength * 0.12}
                  strokeDasharray={RELATION_DASH[edge.type]}
                />
              );
            })}

            {graphData.nodes.map((node) => (
              <g
                key={node.id}
                className="concept-canvas-node"
                transform={`translate(${node.x} ${node.y})`}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
                onFocus={() => setHoveredNodeId(node.id)}
                onBlur={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
                onClick={() => onNodeClick?.(node.id)}
                role={onNodeClick ? "button" : undefined}
                tabIndex={0}
              >
                <circle
                  r={node.radius + (node.isSeed ? 4 : 0)}
                  fill={node.isSeed ? "rgba(138, 77, 47, 0.13)" : "transparent"}
                />
                <circle
                  r={node.radius}
                  fill={node.isSeed ? "#8f5533" : "#f7ecde"}
                  stroke={node.isSeed ? "#6d4026" : "#a89785"}
                  strokeWidth={node.isSeed ? 2.2 : 1.4}
                />
                <text
                  y={node.radius + 16}
                  textAnchor="middle"
                  className={node.isSeed ? "concept-canvas-label concept-canvas-label--seed" : "concept-canvas-label"}
                >
                  {node.label.replace(/-/g, " ")}
                </text>
              </g>
            ))}
          </svg>

          <div className="concept-canvas-legend" aria-hidden>
            <span className="concept-canvas-legend-chip concept-canvas-legend-chip--seed">
              Current thread
            </span>
            <span className="concept-canvas-legend-chip">Session memory</span>
          </div>

          {hoveredNode ? (
            <div
              className="content-card concept-canvas-tooltip"
              style={{
                left: `${Math.min(size.width - 190, Math.max(12, hoveredNode.x - 80))}px`,
                top: `${Math.min(size.height - 96, Math.max(12, hoveredNode.y + hoveredNode.radius + 14))}px`
              }}
            >
              <p className="eyebrow">{hoveredNode.isSeed ? "Current thread" : "Related memory"}</p>
              <h3>{hoveredNode.label.replace(/-/g, " ")}</h3>
              <p>
                Mentioned {hoveredNode.mentionCount} time{hoveredNode.mentionCount === 1 ? "" : "s"}.
              </p>
            </div>
          ) : null}

          <div className="concept-canvas-edge-list">
            {edgePills.map((edge) => (
              <span key={`edge-pill-${edge.type}`} className="concept-canvas-edge-pill">
                {edge.label}
                {edge.count > 1 ? ` ×${edge.count}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {isExpanded ? (
        <div
          className="modal-backdrop concept-canvas-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsExpanded(false);
          }}
        >
          <section
            className="modal concept-canvas-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="concept-canvas-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Content map</p>
                <h2 id="concept-canvas-modal-title">Structure at a glance</h2>
              </div>
              <button
                className="toolbar-btn toolbar-btn--ghost"
                onClick={() => setIsExpanded(false)}
                type="button"
              >
                Close
              </button>
            </div>

            {modalGraphData.nodes.length === 0 ? (
              <div className="concept-canvas-empty concept-canvas-empty--modal">
                <p>Run a few turns and the map will begin to connect repeated ideas.</p>
              </div>
            ) : (
              <div
                ref={modalStageRef}
                className="concept-canvas-stage concept-canvas-stage--expanded-modal"
              >
                <svg
                  viewBox={`0 0 ${modalSize.width} ${modalSize.height}`}
                  preserveAspectRatio="xMidYMid meet"
                  className="concept-canvas-svg"
                  role="img"
                  aria-label="Expanded 2D concept map"
                >
                  {modalGraphData.edges.map((edge) => {
                    const from = modalNodeById.get(edge.fromId);
                    const to = modalNodeById.get(edge.toId);
                    if (!from || !to) return null;
                    return (
                      <line
                        key={`modal-${edge.edgeId}`}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={RELATION_STROKE[edge.type]}
                        strokeOpacity={edge.source === "accepted-graph" ? 0.9 : 0.6}
                        strokeWidth={edge.source === "accepted-graph" ? 2.4 : 1.4 + edge.strength * 0.16}
                        strokeDasharray={RELATION_DASH[edge.type]}
                      />
                    );
                  })}

                  {modalGraphData.nodes.map((node) => {
                    const labelAbove = node.y < modalSize.height / 2;
                    const labelOffset = node.radius + 18;
                    return (
                      <g
                        key={`modal-node-${node.id}`}
                        className="concept-canvas-node"
                        transform={`translate(${node.x} ${node.y})`}
                      >
                        <circle
                          r={node.radius + (node.isSeed ? 5 : 0)}
                          fill={node.isSeed ? "rgba(138, 77, 47, 0.13)" : "transparent"}
                        />
                        <circle
                          r={node.radius}
                          fill={node.isSeed ? "#8f5533" : "#f7ecde"}
                          stroke={node.isSeed ? "#6d4026" : "#a89785"}
                          strokeWidth={node.isSeed ? 2.4 : 1.5}
                        />
                        <text
                          y={labelAbove ? -labelOffset + 4 : labelOffset}
                          textAnchor="middle"
                          dominantBaseline={labelAbove ? "auto" : "hanging"}
                          className={
                            node.isSeed
                              ? "concept-canvas-label concept-canvas-label--modal concept-canvas-label--seed"
                              : "concept-canvas-label concept-canvas-label--modal"
                          }
                        >
                          {node.label.replace(/-/g, " ")}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                <div className="concept-canvas-legend" aria-hidden>
                  <span className="concept-canvas-legend-chip concept-canvas-legend-chip--seed">
                    Current thread
                  </span>
                  <span className="concept-canvas-legend-chip">Session memory</span>
                </div>

                {edgePills.length > 0 ? (
                  <div className="concept-canvas-edge-list">
                    {edgePills.map((edge) => (
                      <span key={`modal-edge-pill-${edge.type}`} className="concept-canvas-edge-pill">
                        {edge.label}
                        {edge.count > 1 ? ` ×${edge.count}` : ""}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function layoutNodes(
  nodes: GraphNode[],
  seedSet: Set<string>,
  width: number,
  height: number,
  roomy: boolean
): PositionedNode[] {
  const seeds = nodes
    .filter((node) => seedSet.has(node.id))
    .sort((a, b) => b.mentionCount - a.mentionCount || a.label.localeCompare(b.label));
  const others = nodes
    .filter((node) => !seedSet.has(node.id))
    .sort((a, b) => b.mentionCount - a.mentionCount || a.label.localeCompare(b.label));

  const placed: PositionedNode[] = [];
  const centerX = width / 2;
  const centerY = height / 2;
  const padX = roomy ? Math.max(80, width * 0.07) : 28;
  const padY = roomy ? Math.max(70, height * 0.12) : 32;
  const maxRadiusX = Math.max(40, width / 2 - padX);
  const maxRadiusY = Math.max(40, height / 2 - padY);

  if (seeds.length === 1) {
    placed.push(positionNode(seeds[0], centerX, centerY, true, roomy));
  } else if (seeds.length > 1) {
    const seedRx = roomy ? Math.min(maxRadiusX * 0.22, 160) : Math.min(width * 0.18, 88);
    const seedRy = roomy ? Math.min(maxRadiusY * 0.22, 110) : Math.min(height * 0.15, 58);
    placed.push(...placeRing(seeds, centerX, centerY, seedRx, seedRy, true, roomy));
  }

  const chunkSize = roomy ? 14 : isDense(others.length) ? 10 : 8;
  const chunks = chunkArray(others, chunkSize);
  const ringCount = Math.max(1, chunks.length);
  chunks.forEach((chunk, index) => {
    if (roomy) {
      const ratio = ringCount === 1 ? 0.85 : 0.5 + (index / (ringCount - 1)) * 0.5;
      const xRadius = maxRadiusX * ratio;
      const yRadius = maxRadiusY * ratio;
      const offset = index % 2 === 0 ? 0 : Math.PI / chunk.length;
      placed.push(...placeRing(chunk, centerX, centerY, xRadius, yRadius, false, roomy, offset));
    } else {
      const xRadius = Math.min(width * (0.28 + index * 0.08), 110 + index * 46);
      const yRadius = Math.min(height * (0.22 + index * 0.08), 80 + index * 34);
      placed.push(...placeRing(chunk, centerX, centerY + 8, xRadius, yRadius, false, roomy));
    }
  });

  return placed;
}

function placeRing(
  nodes: GraphNode[],
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  isSeed: boolean,
  roomy: boolean,
  angleOffset = 0
): PositionedNode[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    return [positionNode(nodes[0], centerX, centerY, isSeed, roomy)];
  }

  return nodes.map((node, index) => {
    const angle = -Math.PI / 2 + angleOffset + (index / nodes.length) * Math.PI * 2;
    return positionNode(
      node,
      centerX + Math.cos(angle) * radiusX,
      centerY + Math.sin(angle) * radiusY,
      isSeed,
      roomy
    );
  });
}

function positionNode(
  node: GraphNode,
  x: number,
  y: number,
  isSeed: boolean,
  roomy: boolean
): PositionedNode {
  const base = roomy ? 12 : 8;
  const scale = roomy ? 2.8 : 2.1;
  const cap = roomy ? 30 : 22;
  const min = roomy ? (isSeed ? 16 : 13) : isSeed ? 12 : 10;
  const radius = Math.max(min, Math.min(cap, base + Math.sqrt(Math.max(1, node.mentionCount)) * scale));
  return { ...node, x, y, radius, isSeed };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isDense(count: number): boolean {
  return count > 10;
}
