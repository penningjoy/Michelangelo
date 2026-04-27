"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => null
});
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
  loading: () => null
});

type RelationType =
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
  status: string;
};

type Snapshot = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  seedIds?: string[];
  enabled: boolean;
};

type CanvasNode = GraphNode & {
  x?: number;
  y?: number;
  z?: number;
  isSeed: boolean;
};

type CanvasLink = {
  source: string;
  target: string;
  type: RelationType;
  edgeId: string;
};

type ViewMode = "3d" | "2d";

const RELATION_COLOR: Record<RelationType, string> = {
  "analogous-to": "#9b5838",
  generalizes: "#7b492b",
  enables: "#6a513b",
  "tension-with": "#b67d5d",
  contrasts: "#c08a67"
};

const RELATION_DASH_2D: Record<RelationType, number[] | null> = {
  "analogous-to": [5, 4],
  generalizes: null,
  enables: null,
  "tension-with": null,
  contrasts: [4, 4]
};

const VIEW_STORAGE = "polymath.canvasView";

const seedSphereMaterial = new THREE.MeshBasicMaterial({
  color: 0x8f5533,
  transparent: true,
  opacity: 0.92
});
const neighborSphereMaterial = new THREE.MeshBasicMaterial({
  color: 0xb8ab98,
  transparent: true,
  opacity: 0.72
});
const sphereGeometryCache = new Map<number, THREE.SphereGeometry>();

function getSharedSphereGeometry(radius: number): THREE.SphereGeometry {
  const key = Math.round(radius * 1000);
  let geometry = sphereGeometryCache.get(key);
  if (!geometry) {
    geometry = new THREE.SphereGeometry(radius, 18, 14);
    sphereGeometryCache.set(key, geometry);
  }
  return geometry;
}

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
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 360, height: 280 });
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const prevSigRef = useRef<string>("");

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_STORAGE) as ViewMode | null;
    if (saved === "2d" || saved === "3d") setViewMode(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE, viewMode);
  }, [viewMode]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setSize({
          width: Math.max(240, width),
          height: isExpanded ? 360 : 260
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
          if (!cancelled) setFetchError("Could not load the concept map.");
          return;
        }
        const data = (await response.json()) as Snapshot;
        if (!cancelled) {
          setSnapshot(data);
          const sig = `${data.nodes.length}:${data.edges.length}`;
          if (prevSigRef.current && prevSigRef.current !== sig) {
            setPulse(true);
            window.setTimeout(() => setPulse(false), 1600);
          }
          prevSigRef.current = sig;
        }
      } catch {
        if (!cancelled) setFetchError("Could not load the concept map.");
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  const graphData = useMemo(() => {
    if (!snapshot) return { nodes: [] as CanvasNode[], links: [] as CanvasLink[] };
    const seedSet = new Set(snapshot.seedIds ?? []);
    const nodes: CanvasNode[] = snapshot.nodes.map((node) => {
      const isSeed = seedSet.has(node.id);
      return {
        ...node,
        isSeed,
        z: isSeed ? 60 : -24
      };
    });
    const nodeIds = new Set(nodes.map((node) => node.id));
    const links: CanvasLink[] = snapshot.edges
      .filter((edge) => nodeIds.has(edge.fromId) && nodeIds.has(edge.toId))
      .map((edge) => ({
        source: edge.fromId,
        target: edge.toId,
        type: edge.type,
        edgeId: edge.edgeId
      }));
    return { nodes, links };
  }, [snapshot]);

  const nodeCanvasObject2D = useCallback(
    (raw: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const node = raw as CanvasNode;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const radius = 3 + Math.sqrt(Math.max(1, node.mentionCount)) * 1.35;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = node.isSeed ? "#8f5533" : "#c4b8a8";
      ctx.fill();
      ctx.strokeStyle = node.isSeed ? "#6d4026" : "#958878";
      ctx.lineWidth = 0.8 / globalScale;
      ctx.stroke();

      const fontSize = 10 / globalScale;
      ctx.font = `500 ${fontSize}px Manrope, -apple-system, sans-serif`;
      ctx.fillStyle = node.isSeed ? "#31251d" : "#6f6457";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(node.label.replace(/-/g, " "), x, y + radius + 2 / globalScale);
    },
    []
  );

  const linkColor = useCallback(
    (link: object) => RELATION_COLOR[(link as CanvasLink).type] ?? "#b8ab98",
    []
  );

  const linkDash2D = useCallback(
    (link: object) => RELATION_DASH_2D[(link as CanvasLink).type],
    []
  );

  const handleNodeClick = useCallback(
    (raw: object) => {
      const node = raw as CanvasNode;
      if (onNodeClick) onNodeClick(node.id);
    },
    [onNodeClick]
  );

  const nodeThreeObject = useCallback((raw: object) => {
    const node = raw as CanvasNode;
    const radius = 1.8 + Math.sqrt(Math.max(1, node.mentionCount)) * 0.95;
    return createNodeMesh(node.label, radius, node.isSeed);
  }, []);

  const headerMeta = fetchError
    ? fetchError
    : curatorWorking
      ? "Refreshing the latest structure."
      : `${graphData.nodes.length} concept${graphData.nodes.length === 1 ? "" : "s"}${
          graphData.links.length > 0
            ? ` · ${graphData.links.length} link${graphData.links.length === 1 ? "" : "s"}`
            : ""
        }`;

  if (snapshot && !snapshot.enabled) {
    return (
      <section className="shell-panel reference-panel concept-canvas concept-canvas--disabled">
        <header className="panel-header">
          <div>
            <p className="eyebrow">Concept map</p>
            <h2 className="panel-title">Graph offline</h2>
          </div>
        </header>
        <p className="panel-note">
          Neo4j is unavailable. Start the graph service and refresh when you want the supporting
          map back.
        </p>
      </section>
    );
  }

  return (
    <section className="shell-panel reference-panel concept-canvas" ref={wrapperRef}>
        <header className="panel-header concept-canvas-header">
        <div>
          <p className="eyebrow">
            Concept map
            {(isFetching || curatorWorking) && !fetchError ? (
              <span className="pulse-dot" aria-hidden title="Refreshing" />
            ) : null}
          </p>
          <h2 className="panel-title">Structure at a glance</h2>
          <p className="panel-note">{headerMeta}</p>
        </div>

        <div className="concept-canvas-controls">
          {!isCollapsed ? (
            <>
              <div className="view-toggle" role="group" aria-label="View mode">
                <button
                  type="button"
                  className={viewMode === "2d" ? "view-toggle-btn active" : "view-toggle-btn"}
                  onClick={() => setViewMode("2d")}
                >
                  2D
                </button>
                <button
                  type="button"
                  className={viewMode === "3d" ? "view-toggle-btn active" : "view-toggle-btn"}
                  onClick={() => setViewMode("3d")}
                >
                  3D
                </button>
              </div>
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
            </>
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
            <p>Keep the map tucked away until you need a structural view.</p>
            <div className="concept-canvas-stats" aria-hidden>
              <span>{graphData.nodes.length} concepts</span>
              <span>{graphData.links.length} links</span>
            </div>
          </div>
        </div>
      ) : graphData.nodes.length === 0 ? (
        <div className="concept-canvas-empty">
          <svg
            className="concept-canvas-silhouette"
            viewBox="0 0 200 110"
            aria-hidden
          >
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
          <p>Run a few turns and accept connections. The map will settle here.</p>
        </div>
      ) : (
        <div
          className={[
            "concept-canvas-stage",
            pulse ? "concept-canvas-stage--pulse" : "",
            isExpanded ? "concept-canvas-stage--expanded" : ""
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {viewMode === "3d" ? (
            <ForceGraph3D
              graphData={graphData}
              width={size.width}
              height={size.height}
              backgroundColor="rgba(0,0,0,0)"
              showNavInfo={false}
              nodeThreeObject={nodeThreeObject}
              linkColor={linkColor}
              linkOpacity={0.45}
              linkWidth={0.45}
              linkCurvature={0.06}
              onNodeClick={handleNodeClick}
              cooldownTicks={80}
              warmupTicks={18}
              d3AlphaDecay={0.04}
              d3VelocityDecay={0.38}
            />
          ) : (
            <ForceGraph2D
              graphData={graphData}
              width={size.width}
              height={size.height}
              backgroundColor="rgba(0,0,0,0)"
              nodeCanvasObject={nodeCanvasObject2D}
              nodePointerAreaPaint={(raw: object, color: string, ctx: CanvasRenderingContext2D) => {
                const node = raw as CanvasNode;
                const radius = 3 + Math.sqrt(Math.max(1, node.mentionCount)) * 1.35;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x ?? 0, node.y ?? 0, radius + 5, 0, 2 * Math.PI);
                ctx.fill();
              }}
              linkColor={linkColor}
              linkLineDash={linkDash2D}
              linkWidth={0.9}
              onNodeClick={handleNodeClick}
              cooldownTicks={80}
              warmupTicks={24}
              d3AlphaDecay={0.035}
              d3VelocityDecay={0.35}
            />
          )}
        </div>
      )}
    </section>
  );
}

function createNodeMesh(label: string, radius: number, isSeed: boolean): THREE.Object3D {
  const group = new THREE.Group();

  const sphereGeometry = getSharedSphereGeometry(radius);
  const sphereMaterial = isSeed ? seedSphereMaterial : neighborSphereMaterial;
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
  group.add(sphere);

  const sprite = makeTextSprite(label.replace(/-/g, " "), isSeed);
  sprite.position.set(0, radius + 2.1, 0);
  group.add(sprite);

  return group;
}

function makeTextSprite(text: string, isSeed: boolean): THREE.Object3D {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.Object3D();
  }
  const fontSize = 34;
  ctx.font = `500 ${fontSize}px Manrope, -apple-system, sans-serif`;
  const metrics = ctx.measureText(text);
  const padding = 12;
  canvas.width = Math.ceil(metrics.width + padding * 2);
  canvas.height = fontSize + padding * 2;

  ctx.font = `500 ${fontSize}px Manrope, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = isSeed ? "#2f251e" : "#6f6457";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  const aspect = canvas.width / canvas.height;
  const scale = 5.4;
  sprite.scale.set(scale * aspect, scale, 1);
  return sprite;
}
