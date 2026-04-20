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
  "analogous-to": "#8a3a1d",
  generalizes: "#8a3a1d",
  enables: "#8a3a1d",
  "tension-with": "#b5653f",
  contrasts: "#b5653f"
};

const RELATION_DASH_2D: Record<RelationType, number[] | null> = {
  "analogous-to": [4, 3],
  generalizes: null,
  enables: null,
  "tension-with": null,
  contrasts: [4, 3]
};

const VIEW_STORAGE = "polymath.canvasView";

/** Shared materials and geometry cache to avoid allocating GPU resources on every node callback. */
const seedSphereMaterial = new THREE.MeshBasicMaterial({
  color: 0x8a3a1d,
  transparent: true,
  opacity: 1.0
});
const neighborSphereMaterial = new THREE.MeshBasicMaterial({
  color: 0xc9c2b2,
  transparent: true,
  opacity: 0.65
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
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 360, height: 480 });
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
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
        const { width, height } = entry.contentRect;
        setSize({ width: Math.max(240, width), height: Math.max(360, height) });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
          if (!cancelled) setFetchError("Could not load brain map.");
          return;
        }
        const data = (await response.json()) as Snapshot;
        if (!cancelled) {
          setSnapshot(data);
          // Briefly pulse when the graph has changed shape (new nodes or edges).
          const sig = `${data.nodes.length}:${data.edges.length}`;
          if (prevSigRef.current && prevSigRef.current !== sig) {
            setPulse(true);
            window.setTimeout(() => setPulse(false), 1400);
          }
          prevSigRef.current = sig;
        }
      } catch {
        if (!cancelled) setFetchError("Could not load brain map.");
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
        // Depth encodes recency: seeds float toward the camera; older concepts recede.
        z: isSeed ? 80 : -40
      };
    });
    const nodeIds = new Set(nodes.map((n) => n.id));
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
      const radius = 3 + Math.sqrt(Math.max(1, node.mentionCount)) * 1.6;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = node.isSeed ? "#8a3a1d" : "#c9c2b2";
      ctx.fill();
      ctx.strokeStyle = node.isSeed ? "#5a2612" : "#8a8273";
      ctx.lineWidth = 0.6 / globalScale;
      ctx.stroke();

      const fontSize = 10 / globalScale;
      ctx.font = `${fontSize}px Inter, -apple-system, sans-serif`;
      ctx.fillStyle = node.isSeed ? "#1a1a1a" : "#7a7673";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(node.label.replace(/-/g, " "), x, y + radius + 2 / globalScale);
    },
    []
  );

  const linkColor = useCallback(
    (link: object) => RELATION_COLOR[(link as CanvasLink).type] ?? "#c9c2b2",
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
    const isSeed = node.isSeed;
    const radius = 2.2 + Math.sqrt(Math.max(1, node.mentionCount)) * 1.1;
    return createNodeMesh(node.label, radius, isSeed);
  }, []);

  if (snapshot && !snapshot.enabled) {
    return (
      <aside className="concept-canvas concept-canvas--disabled">
        <p className="eyebrow">Brain map</p>
        <p className="muted">
          The graph is off. Start the Neo4j container and refresh to see concept relationships
          here.
        </p>
      </aside>
    );
  }

  return (
    <aside className="concept-canvas" ref={wrapperRef}>
      <header className="concept-canvas-header">
        <div>
          <p className="eyebrow">
            Brain map
            {(isFetching || curatorWorking) && !fetchError ? (
              <span className="pulse-dot" aria-hidden title="Refreshing" />
            ) : null}
          </p>
          <p className="muted">
            {fetchError ? (
              <span className="canvas-error">{fetchError}</span>
            ) : curatorWorking ? (
              "Curator is weaving new links…"
            ) : (
              <>
                {graphData.nodes.length} concept{graphData.nodes.length === 1 ? "" : "s"}
                {graphData.links.length > 0
                  ? ` · ${graphData.links.length} accepted link${graphData.links.length === 1 ? "" : "s"}`
                  : ""}
              </>
            )}
          </p>
        </div>
        <div className="view-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            className={viewMode === "3d" ? "view-toggle-btn active" : "view-toggle-btn"}
            onClick={() => setViewMode("3d")}
          >
            3D
          </button>
          <button
            type="button"
            className={viewMode === "2d" ? "view-toggle-btn active" : "view-toggle-btn"}
            onClick={() => setViewMode("2d")}
          >
            2D
          </button>
        </div>
      </header>

      {graphData.nodes.length === 0 ? (
        <p className="muted concept-canvas-empty">
          Run turns and accept proposed connections — the map fills in here.
        </p>
      ) : (
        <div className={`concept-canvas-stage${pulse ? " concept-canvas-stage--pulse" : ""}`}>
          {viewMode === "3d" ? (
            <ForceGraph3D
              graphData={graphData}
              width={size.width}
              height={size.height}
              backgroundColor="rgba(0,0,0,0)"
              showNavInfo={false}
              nodeThreeObject={nodeThreeObject}
              linkColor={linkColor}
              linkOpacity={0.55}
              linkWidth={0.5}
              linkCurvature={0.08}
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
                const radius = 3 + Math.sqrt(Math.max(1, node.mentionCount)) * 1.6;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x ?? 0, node.y ?? 0, radius + 4, 0, 2 * Math.PI);
                ctx.fill();
              }}
              linkColor={linkColor}
              linkLineDash={linkDash2D}
              linkWidth={0.8}
              onNodeClick={handleNodeClick}
              cooldownTicks={80}
              warmupTicks={24}
              d3AlphaDecay={0.035}
              d3VelocityDecay={0.35}
            />
          )}
        </div>
      )}
    </aside>
  );
}

/**
 * Build a three.js group for a concept node: a sphere with a text sprite label.
 * Seeds (current-session concepts) are larger, warmer, and fully lit; neighbors
 * recede in color and size.
 */
function createNodeMesh(label: string, radius: number, isSeed: boolean): THREE.Object3D {
  const group = new THREE.Group();

  const sphereGeometry = getSharedSphereGeometry(radius);
  const sphereMaterial = isSeed ? seedSphereMaterial : neighborSphereMaterial;
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
  group.add(sphere);

  const sprite = makeTextSprite(label.replace(/-/g, " "), isSeed);
  sprite.position.set(0, radius + 2.4, 0);
  group.add(sprite);

  return group;
}

function makeTextSprite(text: string, isSeed: boolean): THREE.Object3D {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new THREE.Object3D();
  }
  const fontSize = 36;
  ctx.font = `500 ${fontSize}px Inter, -apple-system, sans-serif`;
  const metrics = ctx.measureText(text);
  const padding = 12;
  canvas.width = Math.ceil(metrics.width + padding * 2);
  canvas.height = fontSize + padding * 2;

  ctx.font = `500 ${fontSize}px Inter, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = isSeed ? "#1a1a1a" : "#7a7673";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  const aspect = canvas.width / canvas.height;
  const scale = 6;
  sprite.scale.set(scale * aspect, scale, 1);
  return sprite;
}
