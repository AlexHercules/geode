import { useCallback, useEffect, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type ForceCenter,
  type ForceLink,
  type ForceManyBody,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import { excludedRaw, isExcluded } from "@core/excludedFiles";
import type { GraphEdge, GraphNode } from "@core/types";
import {
  applyGraphFilters,
  ATTACHMENT_PREFIX,
  buildAttachmentGraph,
  buildTagGraph,
  DEFAULT_PREFS,
  GRAPH_RANGES,
  loadPrefs,
  localEdges,
  localSubgraph,
  nodeGroupColor,
  savePrefs,
  TAG_PREFIX,
  type GraphForces,
  type GraphGroup,
  type GraphPrefs,
} from "./graphPrefs";
import { createNewNote } from "@core/newNote";
import "./graph.css";

/** Apply the current force prefs to a (possibly running) simulation in place. */
function applyForces(sim: Simulation<SimNode, SimLink>, f: GraphForces): void {
  (sim.force("link") as ForceLink<SimNode, SimLink> | undefined)
    ?.distance(f.linkDistance)
    .strength(f.linkForce);
  (sim.force("charge") as ForceManyBody<SimNode> | undefined)?.strength(-f.repel);
  (sim.force("center") as ForceCenter<SimNode> | undefined)?.strength(f.center);
}

/* ---------------- types & helpers ---------------- */

interface SimNode extends SimulationNodeDatum, GraphNode {}
type SimLink = SimulationLinkDatum<SimNode>;

interface Transform {
  x: number;
  y: number;
  k: number;
}

interface Palette {
  accent: string;
  accentHover: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  bgPanel: string;
  unresolved: string;
  tag: string;
  attachment: string;
}

const FALLBACK_PALETTE: Palette = {
  accent: "#8b7cf6",
  accentHover: "#9d90f8",
  borderStrong: "#444444",
  text: "#dadada",
  textMuted: "#9e9e9e",
  bgPanel: "#262626",
  unresolved: "#8b7cf680",
  tag: "#3aa655",
  attachment: "#e0b341",
};

type DragState =
  | { kind: "node"; node: SimNode; moved: boolean; startX: number; startY: number }
  | { kind: "pan"; moved: boolean; startX: number; startY: number; origin: Transform }
  | null;

interface GraphState {
  nodes: SimNode[];
  links: SimLink[];
  adjacency: Map<string, Set<string>>;
  sim: Simulation<SimNode, SimLink> | null;
  transform: Transform;
  hovered: SimNode | null;
  /** local-mode anchor node — accent ring + always-on label */
  anchorNode: SimNode | null;
  drag: DragState;
  palette: Palette;
  /** mirror of the React prefs so the (stable, empty-dep) draw/rebuild closures
   *  read the latest display/force values without re-binding */
  prefs: GraphPrefs;
  width: number;
  height: number;
  dpr: number;
  initialized: boolean;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 6;
const MAX_FIT_ZOOM = 1.5;
const FIT_PADDING = 40;
const CLICK_SLOP = 4;
/** culling margin (css px) around the viewport for nodes/labels */
const CULL_MARGIN = 80;
/** above this many nodes (and not "show all"), render the top-degree sample only */
const RENDER_CAP = 3000;

const fmt = (n: number) => n.toLocaleString("en-US");

function nodeRadius(n: SimNode, scale = 1): number {
  return (Math.min(14, 4 + Math.sqrt(n.degree) * 2)) * scale;
}

/** Stash a perf number on window.__geodePerf (dev/bench inspection only). */
function perfMark(key: string, value: number): void {
  const g = globalThis as unknown as { __geodePerf?: Record<string, number> };
  g.__geodePerf = { ...g.__geodePerf, [key]: Math.round(value * 100) / 100 };
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    accent: v("--accent", FALLBACK_PALETTE.accent),
    accentHover: v("--accent-hover", FALLBACK_PALETTE.accentHover),
    borderStrong: v("--border-strong", FALLBACK_PALETTE.borderStrong),
    text: v("--text-normal", FALLBACK_PALETTE.text),
    textMuted: v("--text-muted", FALLBACK_PALETTE.textMuted),
    bgPanel: v("--bg-panel", FALLBACK_PALETTE.bgPanel),
    unresolved: v("--link-unresolved", FALLBACK_PALETTE.unresolved),
    tag: v("--graph-tag", FALLBACK_PALETTE.tag),
    attachment: v("--graph-attachment", FALLBACK_PALETTE.attachment),
  };
}

/** screen (canvas-local css px) -> graph coordinates */
function toGraph(t: Transform, sx: number, sy: number): [number, number] {
  return [(sx - t.x) / t.k, (sy - t.y) / t.k];
}

/** topmost node under graph point, with a small touch slop */
function pickNode(s: GraphState, gx: number, gy: number): SimNode | null {
  for (let i = s.nodes.length - 1; i >= 0; i--) {
    const n = s.nodes[i];
    const r = nodeRadius(n, s.prefs.display.nodeSize) + 3 / s.transform.k;
    const dx = (n.x ?? 0) - gx;
    const dy = (n.y ?? 0) - gy;
    if (dx * dx + dy * dy <= r * r) return n;
  }
  return null;
}

/** Top-`cap` nodes by degree, stable tie-break by id; `mustKeep` is always retained. */
function sampleByDegree(nodes: GraphNode[], cap: number, mustKeep: string | null): GraphNode[] {
  const sorted = [...nodes].sort(
    (a, b) => b.degree - a.degree || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const kept = sorted.slice(0, cap);
  if (mustKeep && !kept.some((n) => n.id === mustKeep)) {
    const anchor = nodes.find((n) => n.id === mustKeep);
    if (anchor) kept[kept.length - 1] = anchor;
  }
  return kept;
}

/** R103: undirected adjacency for the hover-neighbor highlight (the local-mode BFS uses
 *  the direction-aware localSubgraph instead). */
function buildAdjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const addAdj = (a: string, b: string) => {
    let set = adjacency.get(a);
    if (!set) adjacency.set(a, (set = new Set()));
    set.add(b);
  };
  for (const e of edges) {
    addAdj(e.source, e.target);
    addAdj(e.target, e.source);
  }
  return adjacency;
}

/* ---------------- component ---------------- */

export function GraphView() {
  const app = useApp();
  const t = useI18n();
  const rev = useStore(app.metadata.revision);
  const lastActiveFile = useStore(app.workspace.lastActiveFile);
  const excluded = useStore(excludedRaw); // R96: rebuild when the exclude list changes
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [prefs, setPrefs] = useState<GraphPrefs>(loadPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [info, setInfo] = useState({
    nodes: 0,
    edges: 0,
    totalNodes: 0,
    capped: false,
    localEmpty: false,
  });
  const firstBuild = useRef(true);
  /** user panned/zoomed since mount — suppresses the first-settle auto-fit */
  const interactedRef = useRef(false);
  /** first sim "end" already consumed (auto-fit happens at most once for it) */
  const firstSettleDoneRef = useRef(false);
  /** the next sim "end" should auto-fit (local re-anchor) */
  const fitOnSettleRef = useRef(false);
  /** anchor used by the previous LOCAL rebuild (null while in global mode) */
  const lastAnchorRef = useRef<string | null>(null);
  const rafRef = useRef(0);

  // anchor only matters (and only triggers rebuilds) in local mode
  const anchor = prefs.mode === "local" ? lastActiveFile : null;

  useEffect(() => savePrefs(prefs), [prefs]);

  const stateRef = useRef<GraphState>({
    nodes: [],
    links: [],
    adjacency: new Map(),
    sim: null,
    transform: { x: 0, y: 0, k: 1 },
    hovered: null,
    anchorNode: null,
    drag: null,
    palette: FALLBACK_PALETTE,
    prefs: DEFAULT_PREFS,
    width: 0,
    height: 0,
    dpr: 1,
    initialized: false,
  });
  // keep the mirror current so the stable draw/rebuild closures read live prefs
  stateRef.current.prefs = prefs;

  /* ---------- rendering (batched, viewport-culled) ---------- */

  const draw = useCallback(() => {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const t0 = performance.now();

    const { transform: t, palette: p } = s;
    const disp = s.prefs.display; // R78: live display prefs (node size / link width / arrows / label threshold)
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.width, s.height);
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    const hovered = s.hovered;
    const anchorNode = s.anchorNode;
    const neighbors = hovered ? s.adjacency.get(hovered.id) : undefined;
    const isDim = (id: string) =>
      hovered !== null && id !== hovered.id && !(neighbors?.has(id) ?? false);

    // viewport bounds in graph coords (+margin) for node/label culling
    const vx0 = (-CULL_MARGIN - t.x) / t.k;
    const vy0 = (-CULL_MARGIN - t.y) / t.k;
    const vx1 = (s.width + CULL_MARGIN - t.x) / t.k;
    const vy1 = (s.height + CULL_MARGIN - t.y) / t.k;
    const inView = (x: number, y: number) => x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;

    // edges — per-edge strokes, endpoint-culled. Measured (bench=10000,
    // 6.5k edges): ONE mega-Path2D stroke rasterizes in ~197ms — Chromium
    // flattens/composites the whole path as a unit — while 6.5k individual
    // strokes raster in ~9ms (internal per-stroke culling). Batching edges
    // into a Path2D is a 20x DE-optimization; don't reintroduce it.
    const dimAlpha = hovered !== null ? 0.1 : 0.8;
    for (const link of s.links) {
      const a = link.source;
      const b = link.target;
      if (typeof a !== "object" || typeof b !== "object") continue;
      const ax = a.x ?? 0;
      const ay = a.y ?? 0;
      const bx = b.x ?? 0;
      const by = b.y ?? 0;
      // skip edges fully outside the viewport (a crossing edge with both
      // endpoints out is rare and clipped for a frame at most)
      if (!inView(ax, ay) && !inView(bx, by)) continue;
      const lit = hovered !== null && (a.id === hovered.id || b.id === hovered.id);
      ctx.strokeStyle = lit ? p.accent : p.borderStrong;
      ctx.globalAlpha = lit ? 0.8 : dimAlpha;
      ctx.lineWidth = (lit ? disp.linkThickness * 1.6 : disp.linkThickness) / t.k;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      // R78: optional directional arrowhead, placed just outside the target node
      if (disp.arrows) {
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          const ux = dx / len;
          const uy = dy / len;
          const tip = nodeRadius(b, disp.nodeSize) + 1.5 / t.k;
          const hx = bx - ux * tip;
          const hy = by - uy * tip;
          const size = 5 / t.k;
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(hx - ux * size - uy * size * 0.5, hy - uy * size + ux * size * 0.5);
          ctx.lineTo(hx - ux * size + uy * size * 0.5, hy - uy * size - ux * size * 0.5);
          ctx.closePath();
          ctx.fillStyle = lit ? p.accent : p.borderStrong;
          ctx.fill();
        }
      }
    }

    // nodes — resolved bucketed by FILL COLOUR (R90 colour groups) × dim; unresolved
    // hollow. groups empty ⇒ every resolved node = accent ⇒ one batch (zero regression).
    const groups = s.prefs.groups;
    const colorBatches = new Map<string, { normal: Path2D; dim: Path2D }>();
    const hollowNormal = new Path2D();
    const hollowDim = new Path2D();
    for (const n of s.nodes) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      if (!inView(x, y)) continue;
      if (hovered !== null && n.id === hovered.id) continue; // drawn individually below
      const r = nodeRadius(n, disp.nodeSize);
      const dim = isDim(n.id);
      let path: Path2D;
      if (n.resolved) {
        // R99/R101: tag nodes draw green, attachment nodes yellow (both resolved=true,
        // id-prefixed); notes keep accent/group
        const color = n.id.startsWith(TAG_PREFIX)
          ? p.tag
          : n.id.startsWith(ATTACHMENT_PREFIX)
            ? p.attachment
            : groups.length
              ? nodeGroupColor(n, groups, p.accent)
              : p.accent;
        let b = colorBatches.get(color);
        if (!b) {
          b = { normal: new Path2D(), dim: new Path2D() };
          colorBatches.set(color, b);
        }
        path = dim ? b.dim : b.normal;
      } else {
        path = dim ? hollowDim : hollowNormal;
      }
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, Math.PI * 2);
    }
    // resolved fills — one fill() per distinct group colour
    for (const [color, b] of colorBatches) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 1;
      ctx.fill(b.normal);
      ctx.globalAlpha = 0.16;
      ctx.fill(b.dim);
    }
    // unresolved: hollow + dimmed ring
    ctx.lineWidth = 1.5 / t.k;
    ctx.strokeStyle = p.unresolved;
    ctx.fillStyle = p.bgPanel;
    ctx.globalAlpha = 1;
    ctx.fill(hollowNormal);
    ctx.stroke(hollowNormal);
    ctx.globalAlpha = 0.16;
    ctx.fill(hollowDim);
    ctx.stroke(hollowDim);

    // hovered node on top
    if (hovered) {
      const r = nodeRadius(hovered, disp.nodeSize);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(hovered.x ?? 0, hovered.y ?? 0, r, 0, Math.PI * 2);
      if (hovered.resolved) {
        ctx.fillStyle = p.accentHover;
        ctx.fill();
      } else {
        ctx.fillStyle = p.bgPanel;
        ctx.fill();
        ctx.lineWidth = 1.5 / t.k;
        ctx.strokeStyle = p.unresolved;
        ctx.stroke();
      }
    }

    // local-mode anchor: accent ring
    if (anchorNode) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(anchorNode.x ?? 0, anchorNode.y ?? 0, nodeRadius(anchorNode, disp.nodeSize) + 3.5 / t.k, 0, Math.PI * 2);
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 2 / t.k;
      ctx.stroke();
    }

    // labels (constant on-screen size); anchor label is always visible.
    // While the simulation is still hot, batch labels are suppressed — at 3k
    // nodes the fillText pass throttles ticks ~10x (43s settle vs ~5s), and
    // labels on a moving layout carry no information anyway.
    const settling = s.sim !== null && s.sim.alpha() > 0.05;
    const showAllLabels = t.k > disp.labelThreshold && !settling;
    if (showAllLabels || hovered !== null || anchorNode !== null) {
      const fontPx = 11 / t.k;
      const fadeIn = Math.max(0, Math.min(1, (t.k - disp.labelThreshold) / 0.3));
      ctx.font = `${fontPx}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const n of s.nodes) {
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        const isAnchor = anchorNode !== null && n.id === anchorNode.id;
        const hl =
          hovered !== null && (n.id === hovered.id || (neighbors?.has(n.id) ?? false));
        if (!showAllLabels && !hl && !isAnchor) continue;
        if (!isAnchor && isDim(n.id)) continue;
        if (!inView(x, y)) continue;
        ctx.globalAlpha = hl || isAnchor ? 1 : fadeIn * 0.9;
        ctx.fillStyle = hl || isAnchor ? p.text : p.textMuted;
        ctx.fillText(n.label, x, y + nodeRadius(n, disp.nodeSize) + 4 / t.k);
      }
    }
    ctx.globalAlpha = 1;
    perfMark("graphDrawMs", performance.now() - t0);
  }, []);

  /** rAF-coalesced draw: dirty flag + at most one canvas draw per frame */
  const requestDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }, [draw]);

  // cancel any pending frame on unmount — and RESET the ref: StrictMode's
  // dev double-mount reuses it, and a stale cancelled id would make every
  // future requestDraw early-return (blank canvas forever)
  useEffect(
    () => () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    },
    [],
  );

  /* ---------- fit to view ---------- */

  const fitToView = useCallback(() => {
    const s = stateRef.current;
    if (s.nodes.length === 0 || s.width < 2 || s.height < 2) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of s.nodes) {
      const r = nodeRadius(n, s.prefs.display.nodeSize);
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      if (x - r < minX) minX = x - r;
      if (y - r < minY) minY = y - r;
      if (x + r > maxX) maxX = x + r;
      if (y + r > maxY) maxY = y + r;
    }
    const bw = maxX - minX + FIT_PADDING * 2;
    const bh = maxY - minY + FIT_PADDING * 2;
    const k = Math.max(MIN_ZOOM, Math.min(MAX_FIT_ZOOM, Math.min(s.width / bw, s.height / bh)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    s.transform = { x: s.width / 2 - cx * k, y: s.height / 2 - cy * k, k };
    requestDraw();
  }, [requestDraw]);

  /* ---------- sizing (ResizeObserver + dpr) ----------
   * R3 debt root cause: the mount-time measurement could see a not-yet-final
   * rect (graph tab just created / window mid-maximize), and the initial
   * transform centers the graph ORIGIN — while forceCenter only steers the
   * centroid, so the settled bbox center never coincides with the origin.
   * Fix: only initialize from a real laid-out rect (re-measure on the next
   * frame), keep the Δ/2 resize compensation, and bbox-fit on first settle. */

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const s = stateRef.current;
    s.palette = readPalette(container);

    const measure = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const dpr = window.devicePixelRatio || 1;
      if (!s.initialized) {
        // ignore degenerate pre-layout rects — RO / the rAF below re-measure
        if (rect.width < 2 || rect.height < 2) return;
        s.transform = { x: w / 2, y: h / 2, k: 1 };
        s.initialized = true;
      } else if (w !== s.width || h !== s.height) {
        // keep the graph centred when the pane resizes (maximize/restore)
        s.transform.x += (w - s.width) / 2;
        s.transform.y += (h - s.height) / 2;
      }
      s.width = w;
      s.height = h;
      s.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      requestDraw();
    };

    measure();
    // re-measure after the first laid-out frame (mount during layout transitions)
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    // RO misses dpr-only changes (window moved across monitors)
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [requestDraw]);

  /* ---------- theme changes re-read CSS vars ---------- */

  useEffect(
    () =>
      app.events.on("theme:changed", () => {
        const container = containerRef.current;
        if (container) stateRef.current.palette = readPalette(container);
        requestDraw();
      }),
    [app, requestDraw],
  );

  /* ---------- (re)build simulation on index/prefs/anchor change ---------- */

  const rebuild = useCallback(() => {
    const s = stateRef.current;
    // R84 (㊵): client-side filters (orphans / existing-files-only) applied to the
    // full graph BEFORE local-BFS + degree sampling, so both see the filtered set.
    const raw = app.metadata.getGraph();
    // R96: drop excluded-files nodes + any edge touching them, before the R84 filters
    const exKept = new Set(raw.nodes.filter((n) => !isExcluded(n.id)).map((n) => n.id));
    let exNodes = raw.nodes.filter((n) => exKept.has(n.id));
    let exEdges = raw.edges.filter((e) => exKept.has(e.source) && exKept.has(e.target));
    // R99 (㊵ 续续续): merge tag nodes + note→tag edges (client-side, only when on) so
    // the existing exclude/filter/sample pipeline treats them like any other node
    if (prefs.display.tags) {
      const { nodes: tagNodes, edges: tagEdges } = buildTagGraph(app.metadata.getTagMap(), exKept);
      exNodes = exNodes.concat(tagNodes);
      exEdges = exEdges.concat(tagEdges);
    }
    // R101 (㊵ 续续续续): merge attachment nodes + note→attachment edges (same client-side
    // pattern as tags) so the exclude/filter/sample pipeline treats them like any node
    if (prefs.display.attachments) {
      const { nodes: attNodes, edges: attEdges } = buildAttachmentGraph(
        app.metadata.getAttachmentMap(),
        exKept,
      );
      exNodes = exNodes.concat(attNodes);
      exEdges = exEdges.concat(attEdges);
    }
    const data = applyGraphFilters(exNodes, exEdges, prefs.filters);
    const buildStart = performance.now();

    // pick the rendered node set: local BFS subgraph, then degree sampling
    let picked: GraphNode[] = data.nodes;
    let anchorId: string | null = null;
    let localEmpty = false;
    if (prefs.mode === "local") {
      anchorId =
        anchor !== null && data.nodes.some((n) => n.id === anchor) ? anchor : null;
      if (anchorId === null) {
        picked = [];
        localEmpty = true;
      } else {
        // R103: walk ALL edges (not the rendered subset) from the anchor, honoring the
        // depth + incoming/outgoing direction toggles. Both directions on = prior behaviour.
        const visited = localSubgraph(data.edges, anchorId, prefs.depth, {
          outgoing: prefs.outgoing,
          incoming: prefs.incoming,
        });
        picked = data.nodes.filter((n) => visited.has(n.id));
      }
    }
    const totalNodes = picked.length;
    let capped = false;
    if (picked.length > RENDER_CAP && !prefs.showAll) {
      picked = sampleByDegree(picked, RENDER_CAP, anchorId);
      capped = true;
    }
    const keptIds = new Set(picked.map((n) => n.id));
    // R110 (㊵ 续): neighbor-links OFF (local mode) drops edges between two non-anchor nodes.
    const renderedEdges = localEdges(data.edges, keptIds, anchorId, prefs.neighborLinks);

    // local re-anchor (incl. entering local mode) → auto-fit
    const reAnchor = anchorId !== null && anchorId !== lastAnchorRef.current;
    lastAnchorRef.current = anchorId;

    // keep positions of surviving nodes across rebuilds
    const prev = new Map(s.nodes.map((n) => [n.id, n]));
    const nodes: SimNode[] = picked.map((n) => {
      const old = prev.get(n.id);
      if (old) {
        old.label = n.label;
        old.resolved = n.resolved;
        old.degree = n.degree;
        return old;
      }
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 180;
      return { ...n, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
    });
    const links: SimLink[] = renderedEdges.map((e) => ({ source: e.source, target: e.target }));

    s.sim?.stop();
    let sim: Simulation<SimNode, SimLink> | null = null;
    if (nodes.length > 0) {
      // R78: forces read the live prefs (so a fresh build uses the latest slider
      // values); applyForces() pokes the same three forces in place on change.
      const f = s.prefs.forces;
      // simulation runs over the RENDERED subset only
      sim = forceSimulation<SimNode>(nodes)
        .force(
          "link",
          forceLink<SimNode, SimLink>(links)
            .id((d) => d.id)
            .distance(f.linkDistance)
            .strength(f.linkForce),
        )
        .force("charge", forceManyBody<SimNode>().strength(-f.repel).distanceMax(420))
        .force("center", forceCenter(0, 0).strength(f.center))
        .force("collide", forceCollide<SimNode>((d) => nodeRadius(d, s.prefs.display.nodeSize) + 5))
        .alpha(prev.size > 0 ? 0.45 : 1)
        .alphaDecay(0.03);
      sim.on("tick", requestDraw);
      let settled = false;
      sim.on("end", () => {
        if (settled) return; // drag reheats fire "end" again — settle is per rebuild
        settled = true;
        perfMark("graphSettleMs", performance.now() - buildStart);
        const wantFit =
          fitOnSettleRef.current || (!firstSettleDoneRef.current && !interactedRef.current);
        firstSettleDoneRef.current = true;
        fitOnSettleRef.current = false;
        // a draw either way: the settle-phase label suppression needs one
        // cool frame to bring the labels back
        if (wantFit) fitToView();
        else requestDraw();
      });
    }

    s.nodes = nodes;
    s.links = links;
    s.adjacency = buildAdjacency(renderedEdges);
    s.sim = sim;
    s.anchorNode = anchorId !== null ? nodes.find((n) => n.id === anchorId) ?? null : null;
    if (s.hovered && !nodes.includes(s.hovered)) s.hovered = null;
    setInfo({ nodes: nodes.length, edges: links.length, totalNodes, capped, localEmpty });
    if (reAnchor) {
      // show the new neighborhood immediately, then re-fit once it settles
      fitOnSettleRef.current = true;
      fitToView();
    }
    requestDraw();
  }, [
    app,
    requestDraw,
    fitToView,
    prefs.mode,
    prefs.depth,
    prefs.outgoing,
    prefs.incoming,
    prefs.neighborLinks,
    prefs.showAll,
    prefs.filters.orphans,
    prefs.filters.existingOnly,
    prefs.display.tags,
    prefs.display.attachments,
    excluded,
    anchor,
  ]);

  useEffect(() => {
    const delay = firstBuild.current ? 0 : 250; // debounce bursts of edits / anchor hops
    firstBuild.current = false;
    const timer = window.setTimeout(rebuild, delay);
    return () => window.clearTimeout(timer);
  }, [rev, rebuild]);

  // stop the simulation on unmount
  useEffect(() => {
    const s = stateRef.current;
    return () => {
      s.sim?.stop();
    };
  }, []);

  /* ---------- node click → open / create ---------- */

  const openNode = useCallback(
    (node: SimNode) => {
      // R99: a tag node is NOT a file — clicking it searches the tag (mirrors the Tags
      // pane / Obsidian), never openFile("tag:…") which would spawn a broken phantom tab
      if (node.id.startsWith(TAG_PREFIX)) {
        app.workspace.requestSearch(node.label);
        return;
      }
      // R101: an attachment node IS a real file — strip the `attachment:` prefix and open
      // the actual vault path (NOT openFile("attachment:…"), which would phantom-tab). The
      // id suffix is the resolveAttachment-verified path, so the file always exists.
      if (node.id.startsWith(ATTACHMENT_PREFIX)) {
        app.workspace.openFile(node.id.slice(ATTACHMENT_PREFIX.length));
        return;
      }
      if (node.resolved) {
        app.workspace.openFile(node.id);
        return;
      }
      void createNewNote(app.vault, node.label, app.workspace.getActiveFile()).then(
        (path) => app.workspace.openFile(path),
        (err) => console.error("[graph] failed to create note", err),
      );
    },
    [app],
  );

  // R99 probe: route a click to a node by id (canvas has no DOM nodes to click in E2E),
  // so the tag-node click path (search, never openFile) is testable. Browser-E2E only.
  useEffect(() => {
    const g = globalThis as unknown as { __geodeGraphClickNode?: (id: string) => boolean };
    g.__geodeGraphClickNode = (id) => {
      const n = stateRef.current.nodes.find((x) => x.id === id);
      if (!n) return false;
      openNode(n);
      return true;
    };
    return () => {
      delete g.__geodeGraphClickNode;
    };
  }, [openNode]);

  /* ---------- pointer + wheel interactions ---------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const localPoint = (e: PointerEvent | WheelEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const s = stateRef.current;
      const [sx, sy] = localPoint(e);
      const [gx, gy] = toGraph(s.transform, sx, sy);
      const node = pickNode(s, gx, gy);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      if (node) {
        // pin while dragging + reheat
        node.fx = node.x;
        node.fy = node.y;
        s.drag = { kind: "node", node, moved: false, startX: e.clientX, startY: e.clientY };
        s.sim?.alphaTarget(0.3).restart();
        canvas.style.cursor = "grabbing";
      } else {
        s.drag = {
          kind: "pan",
          moved: false,
          startX: e.clientX,
          startY: e.clientY,
          origin: { ...s.transform },
        };
        canvas.style.cursor = "grabbing";
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const s = stateRef.current;
      const d = s.drag;
      if (d) {
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) d.moved = true;
        if (d.kind === "node") {
          const [sx, sy] = localPoint(e);
          const [gx, gy] = toGraph(s.transform, sx, sy);
          d.node.fx = gx;
          d.node.fy = gy;
        } else {
          if (d.moved) {
            interactedRef.current = true; // user pan suppresses auto-fit
            fitOnSettleRef.current = false; // incl. a pending re-anchor fit
          }
          s.transform.x = d.origin.x + dx;
          s.transform.y = d.origin.y + dy;
        }
        requestDraw();
        return;
      }
      // hover
      const [sx, sy] = localPoint(e);
      const [gx, gy] = toGraph(s.transform, sx, sy);
      const node = pickNode(s, gx, gy);
      canvas.style.cursor = node ? "pointer" : "grab";
      if (node !== s.hovered) {
        s.hovered = node;
        requestDraw();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const s = stateRef.current;
      const d = s.drag;
      s.drag = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* fine */
      }
      canvas.style.cursor = "grab";
      if (!d) return;
      if (d.kind === "node") {
        s.sim?.alphaTarget(0);
        d.node.fx = null;
        d.node.fy = null;
        if (!d.moved) openNode(d.node);
      }
      requestDraw();
    };

    const onPointerLeave = () => {
      const s = stateRef.current;
      if (s.drag) return; // pointer captured, keep dragging
      if (s.hovered) {
        s.hovered = null;
        requestDraw();
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = stateRef.current;
      const t = s.transform;
      const [mx, my] = localPoint(e);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const k2 = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, t.k * factor));
      if (k2 === t.k) return;
      interactedRef.current = true; // user zoom suppresses auto-fit
      fitOnSettleRef.current = false; // incl. a pending re-anchor fit
      // zoom toward the cursor
      t.x = mx - ((mx - t.x) / t.k) * k2;
      t.y = my - ((my - t.y) / t.k) * k2;
      t.k = k2;
      requestDraw();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [requestDraw, openNode]);

  /* ---------- render ---------- */

  const setMode = (mode: "global" | "local") =>
    setPrefs((p) => (p.mode === mode ? p : { ...p, mode }));

  /* ---------- R78: graph settings (forces + display) ---------- */
  // force change: poke the running sim in place + a gentle reheat (no rebuild →
  // layout stays continuous, Obsidian feel)
  const setForce = (key: keyof GraphForces, v: number) => {
    setPrefs((p) => ({ ...p, forces: { ...p.forces, [key]: v } }));
    const s = stateRef.current;
    s.prefs = { ...s.prefs, forces: { ...s.prefs.forces, [key]: v } };
    if (s.sim) {
      applyForces(s.sim, s.prefs.forces);
      s.sim.alpha(0.3).restart();
    }
  };
  // display change: no physics — just redraw with the new prefs
  const setDisplay = (key: keyof GraphPrefs["display"], v: number | boolean) => {
    setPrefs((p) => ({ ...p, display: { ...p.display, [key]: v } }));
    const s = stateRef.current;
    s.prefs = { ...s.prefs, display: { ...s.prefs.display, [key]: v } };
    requestDraw();
  };
  // R84 (㊵): filter change — alters the rendered node/edge SET, so it must
  // rebuild (prefs.filters.* is in rebuild's deps → the rebuild effect re-fires).
  const setFilter = (key: keyof GraphPrefs["filters"], v: boolean) => {
    setPrefs((p) => ({ ...p, filters: { ...p.filters, [key]: v } }));
  };
  // R90 (㊵): colour groups — only change node fill COLOUR (draw), not the node
  // set, so mirror + redraw (like display) rather than rebuild.
  const setGroups = (groups: GraphGroup[]) => {
    setPrefs((p) => ({ ...p, groups }));
    const s = stateRef.current;
    s.prefs = { ...s.prefs, groups };
    requestDraw();
  };
  const resetSettings = () => {
    setPrefs((p) => ({ ...p, forces: DEFAULT_PREFS.forces, display: DEFAULT_PREFS.display }));
    const s = stateRef.current;
    s.prefs = { ...s.prefs, forces: DEFAULT_PREFS.forces, display: DEFAULT_PREFS.display };
    if (s.sim) {
      applyForces(s.sim, s.prefs.forces);
      s.sim.alpha(0.3).restart();
    }
    requestDraw();
  };

  const slider = (
    testid: string,
    labelKey: Parameters<typeof t>[0],
    range: { min: number; max: number; step: number },
    value: number,
    onChange: (v: number) => void,
  ) => (
    <label className="graph-slider">
      <span className="graph-slider-label">{t(labelKey)}</span>
      <input
        type="range"
        data-testid={testid}
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );

  return (
    <div className="graph-view" data-testid="graph-view" ref={containerRef}>
      <canvas ref={canvasRef} className="graph-canvas" data-testid="graph-canvas" />
      <div className="graph-toolbar" data-testid="graph-toolbar">
        <div className="graph-mode-toggle">
          <button
            type="button"
            className={prefs.mode === "global" ? "is-active" : ""}
            data-testid="graph-mode-global"
            onClick={() => setMode("global")}
          >
            {t("graph.global")}
          </button>
          <button
            type="button"
            className={prefs.mode === "local" ? "is-active" : ""}
            data-testid="graph-mode-local"
            onClick={() => setMode("local")}
          >
            {t("graph.local")}
          </button>
        </div>
        {prefs.mode === "local" && (
          <select
            className="graph-depth-select"
            data-testid="graph-depth"
            value={prefs.depth}
            onChange={(e) => setPrefs((p) => ({ ...p, depth: Number(e.target.value) }))}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {t("graph.depthLevel", { n: String(n) })}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="graph-fit-btn"
          data-testid="graph-fit"
          onClick={fitToView}
          title={t("graph.fitTitle")}
        >
          {t("graph.fit")}
        </button>
        <button
          type="button"
          className={"graph-settings-btn" + (settingsOpen ? " is-active" : "")}
          data-testid="graph-settings-toggle"
          onClick={() => setSettingsOpen((o) => !o)}
          title={t("graph.settings")}
          aria-pressed={settingsOpen}
        >
          <Icon name="settings" size={15} />
        </button>
      </div>
      {settingsOpen && (
        <div className="graph-settings-panel" data-testid="graph-settings">
          <div className="graph-settings-group">{t("graph.forces")}</div>
          {slider("graph-force-center", "graph.forceCenter", GRAPH_RANGES.center, prefs.forces.center, (v) => setForce("center", v))}
          {slider("graph-force-repel", "graph.forceRepel", GRAPH_RANGES.repel, prefs.forces.repel, (v) => setForce("repel", v))}
          {slider("graph-force-link", "graph.forceLink", GRAPH_RANGES.linkForce, prefs.forces.linkForce, (v) => setForce("linkForce", v))}
          {slider("graph-link-distance", "graph.linkDistance", GRAPH_RANGES.linkDistance, prefs.forces.linkDistance, (v) => setForce("linkDistance", v))}
          <div className="graph-settings-group">{t("graph.display")}</div>
          {slider("graph-node-size", "graph.nodeSize", GRAPH_RANGES.nodeSize, prefs.display.nodeSize, (v) => setDisplay("nodeSize", v))}
          {slider("graph-link-thickness", "graph.linkThickness", GRAPH_RANGES.linkThickness, prefs.display.linkThickness, (v) => setDisplay("linkThickness", v))}
          {slider("graph-text-fade", "graph.textFade", GRAPH_RANGES.labelThreshold, prefs.display.labelThreshold, (v) => setDisplay("labelThreshold", v))}
          <label className="graph-toggle">
            <input
              type="checkbox"
              data-testid="graph-arrows"
              checked={prefs.display.arrows}
              onChange={(e) => setDisplay("arrows", e.target.checked)}
            />
            <span>{t("graph.arrows")}</span>
          </label>
          <label className="graph-toggle">
            <input
              type="checkbox"
              data-testid="graph-tags"
              checked={prefs.display.tags}
              onChange={(e) => setDisplay("tags", e.target.checked)}
            />
            <span>{t("graph.showTags")}</span>
          </label>
          <label className="graph-toggle">
            <input
              type="checkbox"
              data-testid="graph-attachments"
              checked={prefs.display.attachments}
              onChange={(e) => setDisplay("attachments", e.target.checked)}
            />
            <span>{t("graph.showAttachments")}</span>
          </label>
          {prefs.mode === "local" && (
            <>
              <div className="graph-settings-group">{t("graph.localLinks")}</div>
              <label className="graph-toggle">
                <input
                  type="checkbox"
                  data-testid="graph-local-outgoing"
                  checked={prefs.outgoing}
                  onChange={(e) => setPrefs((p) => ({ ...p, outgoing: e.target.checked }))}
                />
                <span>{t("graph.localOutgoing")}</span>
              </label>
              <label className="graph-toggle">
                <input
                  type="checkbox"
                  data-testid="graph-local-incoming"
                  checked={prefs.incoming}
                  onChange={(e) => setPrefs((p) => ({ ...p, incoming: e.target.checked }))}
                />
                <span>{t("graph.localIncoming")}</span>
              </label>
              <label className="graph-toggle">
                <input
                  type="checkbox"
                  data-testid="graph-local-neighbor"
                  checked={prefs.neighborLinks}
                  onChange={(e) => setPrefs((p) => ({ ...p, neighborLinks: e.target.checked }))}
                />
                <span>{t("graph.localNeighbor")}</span>
              </label>
            </>
          )}
          <div className="graph-settings-group">{t("graph.filters")}</div>
          <label className="graph-toggle">
            <input
              type="checkbox"
              data-testid="graph-filter-existing"
              checked={prefs.filters.existingOnly}
              onChange={(e) => setFilter("existingOnly", e.target.checked)}
            />
            <span>{t("graph.filterExisting")}</span>
          </label>
          <label className="graph-toggle">
            <input
              type="checkbox"
              data-testid="graph-filter-orphans"
              checked={prefs.filters.orphans}
              onChange={(e) => setFilter("orphans", e.target.checked)}
            />
            <span>{t("graph.filterOrphans")}</span>
          </label>

          {/* R90: colour groups — each = a query + a colour; matching nodes are filled */}
          <div className="graph-settings-group">{t("graph.groups")}</div>
          {prefs.groups.map((g, i) => (
            <div className="graph-group-row" key={i} data-testid={`graph-group-${i}`}>
              <input
                type="color"
                className="graph-group-color"
                data-testid={`graph-group-color-${i}`}
                value={g.color}
                aria-label={t("graph.groupColor")}
                onChange={(e) => setGroups(prefs.groups.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}
              />
              <input
                type="text"
                className="graph-group-query"
                data-testid={`graph-group-query-${i}`}
                value={g.query}
                placeholder={t("graph.groupQueryPlaceholder")}
                aria-label={t("graph.groupQuery")}
                spellCheck={false}
                onChange={(e) => setGroups(prefs.groups.map((x, j) => (j === i ? { ...x, query: e.target.value } : x)))}
              />
              <button
                type="button"
                className="graph-group-remove"
                data-testid={`graph-group-remove-${i}`}
                aria-label={t("graph.groupRemove")}
                title={t("graph.groupRemove")}
                onClick={() => setGroups(prefs.groups.filter((_, j) => j !== i))}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="graph-group-add"
            data-testid="graph-group-add"
            onClick={() => setGroups([...prefs.groups, { query: "", color: "#e5534b" }])}
          >
            {t("graph.groupAdd")}
          </button>

          <button type="button" className="graph-settings-reset" data-testid="graph-settings-reset" onClick={resetSettings}>
            {t("graph.resetSettings")}
          </button>
        </div>
      )}
      {info.nodes > 0 && (
        <div className="graph-legend" data-testid="graph-legend">
          {info.capped ? (
            <span>
              {t("graph.legendTop", { shown: fmt(info.nodes), total: fmt(info.totalNodes) })}
            </span>
          ) : (
            <span>
              {t(info.nodes === 1 ? "graph.nodesOne" : "graph.nodesMany", {
                count: fmt(info.nodes),
              })}
            </span>
          )}
          <span className="graph-legend-sep">·</span>
          <span>
            {t(info.edges === 1 ? "graph.linksOne" : "graph.linksMany", {
              count: fmt(info.edges),
            })}
          </span>
          {info.totalNodes > RENDER_CAP && (
            <button
              type="button"
              className="graph-legend-btn"
              data-testid="graph-show-all"
              onClick={() => setPrefs((p) => ({ ...p, showAll: !p.showAll }))}
            >
              {prefs.showAll ? t("graph.showTop", { cap: fmt(RENDER_CAP) }) : t("graph.showAll")}
            </button>
          )}
        </div>
      )}
      {prefs.mode === "local" && info.localEmpty && (
        <div className="graph-empty" data-testid="graph-local-empty">
          <div className="graph-empty-card">
            <Icon name="graph" size={30} />
            <div className="graph-empty-title">{t("graph.localEmpty")}</div>
          </div>
        </div>
      )}
      {prefs.mode === "global" && info.nodes === 0 && (
        <div className="graph-empty" data-testid="graph-empty">
          <div className="graph-empty-card">
            <Icon name="graph" size={30} />
            <div className="graph-empty-title">{t("graph.emptyTitle")}</div>
            <div className="graph-empty-hint">{t("graph.emptyHint")}</div>
          </div>
        </div>
      )}
    </div>
  );
}
