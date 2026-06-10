import { useCallback, useEffect, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import type { GraphNode } from "@core/types";
import "./graph.css";

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
}

const FALLBACK_PALETTE: Palette = {
  accent: "#8b7cf6",
  accentHover: "#9d90f8",
  borderStrong: "#444444",
  text: "#dadada",
  textMuted: "#9e9e9e",
  bgPanel: "#262626",
  unresolved: "#8b7cf680",
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
  drag: DragState;
  palette: Palette;
  width: number;
  height: number;
  dpr: number;
  initialized: boolean;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 6;
const LABEL_ZOOM = 0.8;
const CLICK_SLOP = 4;

function nodeRadius(n: SimNode): number {
  return Math.min(14, 4 + Math.sqrt(n.degree) * 2);
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
    const r = nodeRadius(n) + 3 / s.transform.k;
    const dx = (n.x ?? 0) - gx;
    const dy = (n.y ?? 0) - gy;
    if (dx * dx + dy * dy <= r * r) return n;
  }
  return null;
}

/* ---------------- component ---------------- */

export function GraphView() {
  const app = useApp();
  const rev = useStore(app.metadata.revision);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [counts, setCounts] = useState({ nodes: 0, edges: 0 });
  const firstBuild = useRef(true);

  const stateRef = useRef<GraphState>({
    nodes: [],
    links: [],
    adjacency: new Map(),
    sim: null,
    transform: { x: 0, y: 0, k: 1 },
    hovered: null,
    drag: null,
    palette: FALLBACK_PALETTE,
    width: 0,
    height: 0,
    dpr: 1,
    initialized: false,
  });

  /* ---------- rendering ---------- */

  const draw = useCallback(() => {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { transform: t, palette: p } = s;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.width, s.height);
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    const hovered = s.hovered;
    const neighbors = hovered ? s.adjacency.get(hovered.id) : undefined;
    const isDim = (id: string) =>
      hovered !== null && id !== hovered.id && !(neighbors?.has(id) ?? false);

    // edges
    ctx.lineWidth = 1 / t.k;
    for (const link of s.links) {
      const a = link.source;
      const b = link.target;
      if (typeof a !== "object" || typeof b !== "object") continue;
      const lit = hovered !== null && (a.id === hovered.id || b.id === hovered.id);
      ctx.strokeStyle = lit ? p.accent : p.borderStrong;
      ctx.globalAlpha = hovered !== null && !lit ? 0.1 : 0.8;
      ctx.lineWidth = (lit ? 1.6 : 1) / t.k;
      ctx.beginPath();
      ctx.moveTo(a.x ?? 0, a.y ?? 0);
      ctx.lineTo(b.x ?? 0, b.y ?? 0);
      ctx.stroke();
    }

    // nodes
    for (const n of s.nodes) {
      const r = nodeRadius(n);
      ctx.globalAlpha = isDim(n.id) ? 0.16 : 1;
      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, Math.PI * 2);
      if (n.resolved) {
        ctx.fillStyle = hovered?.id === n.id ? p.accentHover : p.accent;
        ctx.fill();
      } else {
        // unresolved: hollow + dimmed ring
        ctx.fillStyle = p.bgPanel;
        ctx.fill();
        ctx.lineWidth = 1.5 / t.k;
        ctx.strokeStyle = p.unresolved;
        ctx.stroke();
      }
    }

    // labels (constant on-screen size)
    const showAll = t.k > LABEL_ZOOM;
    if (showAll || hovered !== null) {
      const fontPx = 11 / t.k;
      const fadeIn = Math.max(0, Math.min(1, (t.k - LABEL_ZOOM) / 0.3));
      ctx.font = `${fontPx}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const n of s.nodes) {
        const hl =
          hovered !== null && (n.id === hovered.id || (neighbors?.has(n.id) ?? false));
        if (!showAll && !hl) continue;
        if (isDim(n.id)) continue;
        ctx.globalAlpha = hl ? 1 : fadeIn * 0.9;
        ctx.fillStyle = hl ? p.text : p.textMuted;
        ctx.fillText(n.label, n.x ?? 0, (n.y ?? 0) + nodeRadius(n) + 4 / t.k);
      }
    }
    ctx.globalAlpha = 1;
  }, []);

  /* ---------- sizing (ResizeObserver + dpr) ---------- */

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const s = stateRef.current;
    s.palette = readPalette(container);

    const fit = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const dpr = window.devicePixelRatio || 1;
      if (!s.initialized) {
        s.transform = { x: w / 2, y: h / 2, k: 1 };
        s.initialized = true;
      } else {
        // keep the graph centred when the pane resizes
        s.transform.x += (w - s.width) / 2;
        s.transform.y += (h - s.height) / 2;
      }
      s.width = w;
      s.height = h;
      s.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      draw();
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  /* ---------- theme changes re-read CSS vars ---------- */

  useEffect(
    () =>
      app.events.on("theme:changed", () => {
        const container = containerRef.current;
        if (container) stateRef.current.palette = readPalette(container);
        draw();
      }),
    [app, draw],
  );

  /* ---------- (re)build simulation when index changes ---------- */

  const rebuild = useCallback(() => {
    const s = stateRef.current;
    const data = app.metadata.getGraph();

    // keep positions of surviving nodes across rebuilds
    const prev = new Map(s.nodes.map((n) => [n.id, n]));
    const nodes: SimNode[] = data.nodes.map((n) => {
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
    const links: SimLink[] = data.edges.map((e) => ({ source: e.source, target: e.target }));

    const adjacency = new Map<string, Set<string>>();
    const addAdj = (a: string, b: string) => {
      let set = adjacency.get(a);
      if (!set) adjacency.set(a, (set = new Set()));
      set.add(b);
    };
    for (const e of data.edges) {
      addAdj(e.source, e.target);
      addAdj(e.target, e.source);
    }

    s.sim?.stop();
    const sim = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(70)
          .strength(0.5),
      )
      .force("charge", forceManyBody<SimNode>().strength(-200).distanceMax(420))
      .force("center", forceCenter(0, 0).strength(0.06))
      .force("collide", forceCollide<SimNode>((d) => nodeRadius(d) + 5))
      .alpha(prev.size > 0 ? 0.45 : 1)
      .alphaDecay(0.03);
    sim.on("tick", draw);

    s.nodes = nodes;
    s.links = links;
    s.adjacency = adjacency;
    s.sim = sim;
    if (s.hovered && !nodes.includes(s.hovered)) s.hovered = null;
    setCounts({ nodes: nodes.length, edges: links.length });
    draw();
  }, [app, draw]);

  useEffect(() => {
    const delay = firstBuild.current ? 0 : 250; // debounce bursts of edits
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
      if (node.resolved) {
        app.workspace.openFile(node.id);
        return;
      }
      const path = app.vault.uniquePath("", node.label);
      void app.vault.create(path).then(
        () => app.workspace.openFile(path),
        (err) => console.error("[graph] failed to create note", err),
      );
    },
    [app],
  );

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
          s.transform.x = d.origin.x + dx;
          s.transform.y = d.origin.y + dy;
        }
        draw();
        return;
      }
      // hover
      const [sx, sy] = localPoint(e);
      const [gx, gy] = toGraph(s.transform, sx, sy);
      const node = pickNode(s, gx, gy);
      canvas.style.cursor = node ? "pointer" : "grab";
      if (node !== s.hovered) {
        s.hovered = node;
        draw();
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
      draw();
    };

    const onPointerLeave = () => {
      const s = stateRef.current;
      if (s.drag) return; // pointer captured, keep dragging
      if (s.hovered) {
        s.hovered = null;
        draw();
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
      // zoom toward the cursor
      t.x = mx - ((mx - t.x) / t.k) * k2;
      t.y = my - ((my - t.y) / t.k) * k2;
      t.k = k2;
      draw();
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
  }, [draw, openNode]);

  /* ---------- render ---------- */

  return (
    <div className="graph-view" data-testid="graph-view" ref={containerRef}>
      <canvas ref={canvasRef} className="graph-canvas" data-testid="graph-canvas" />
      {counts.nodes > 0 && (
        <div className="graph-legend" data-testid="graph-legend">
          <span>
            {counts.nodes} {counts.nodes === 1 ? "node" : "nodes"}
          </span>
          <span className="graph-legend-sep">·</span>
          <span>
            {counts.edges} {counts.edges === 1 ? "link" : "links"}
          </span>
        </div>
      )}
      {counts.nodes === 0 && (
        <div className="graph-empty" data-testid="graph-empty">
          <div className="graph-empty-card">
            <Icon name="graph" size={30} />
            <div className="graph-empty-title">No notes to graph yet</div>
            <div className="graph-empty-hint">
              Create a note and add [[wiki links]] to see connections.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
