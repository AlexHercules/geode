/**
 * Graph view persisted prefs (R78, ㊵) — type + validation + localStorage, split
 * out of GraphView so the parse/clamp logic is unit-testable (and probe-driven).
 *
 * Backward compatible: an old `{mode,depth,showAll}` blob (or any missing/corrupt
 * field) falls back to the defaults below — forces/display simply default in.
 */

export interface GraphForces {
  /** pull toward the origin (forceCenter strength) */
  center: number;
  /** node repulsion magnitude (applied as a NEGATIVE forceManyBody strength) */
  repel: number;
  /** link strength (forceLink strength) */
  linkForce: number;
  /** ideal edge length (forceLink distance) */
  linkDistance: number;
}
export interface GraphDisplay {
  /** node-radius multiplier */
  nodeSize: number;
  /** base edge stroke width (css px, before zoom division) */
  linkThickness: number;
  /** zoom level above which all labels show (and fade-in anchor) */
  labelThreshold: number;
  /** draw directional arrowheads on edges */
  arrows: boolean;
}
export interface GraphFilters {
  /** show notes with no connections (degree 0). Obsidian default: ON */
  orphans: boolean;
  /** show ONLY existing files — hide linked-but-missing (unresolved) notes.
   *  Obsidian default: OFF (non-existent linked notes are shown) */
  existingOnly: boolean;
}
/** R90 (㊵): a colour group — nodes matching `query` are filled with `color`.
 *  `query` supports `path:<folder>` (folder prefix on the node path) or bare text
 *  (case-insensitive substring on the node label). `color` is `#rrggbb`. */
export interface GraphGroup {
  query: string;
  color: string;
}
export interface GraphPrefs {
  mode: "global" | "local";
  depth: 1 | 2;
  showAll: boolean;
  forces: GraphForces;
  display: GraphDisplay;
  filters: GraphFilters;
  groups: GraphGroup[];
}

/** Slider ranges (also the clamp bounds for parseGraphPrefs). */
export const GRAPH_RANGES = {
  center: { min: 0, max: 0.3, step: 0.01 },
  repel: { min: 20, max: 600, step: 10 },
  linkForce: { min: 0, max: 1, step: 0.05 },
  linkDistance: { min: 20, max: 200, step: 5 },
  nodeSize: { min: 0.5, max: 3, step: 0.1 },
  linkThickness: { min: 0.5, max: 4, step: 0.5 },
  labelThreshold: { min: 0.3, max: 2, step: 0.1 },
} as const;

// frozen (incl. nested) so the parse/reset paths that hand back DEFAULT_PREFS by
// reference can never be mutated into corrupting the defaults (review nit).
export const DEFAULT_PREFS: GraphPrefs = Object.freeze({
  mode: "global",
  depth: 1,
  showAll: false,
  forces: Object.freeze({ center: 0.06, repel: 200, linkForce: 0.5, linkDistance: 70 }),
  display: Object.freeze({ nodeSize: 1, linkThickness: 1, labelThreshold: 0.8, arrows: false }),
  // defaults = "show everything" (zero regression vs the pre-R84 unfiltered graph)
  filters: Object.freeze({ orphans: true, existingOnly: false }),
  // no colour groups by default → every resolved node keeps the accent (zero regression)
  groups: Object.freeze([]) as unknown as GraphGroup[],
}) as GraphPrefs;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const PREFS_KEY = "geode.graphPrefs";

function num(v: unknown, fallback: number, range: { min: number; max: number }): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.min(range.max, Math.max(range.min, v))
    : fallback;
}

/** Validate + clamp a raw localStorage string (or null) into a GraphPrefs.
 *  Any missing/out-of-range field falls back to its default. */
export function parseGraphPrefs(raw: string | null): GraphPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const f = (p.forces ?? {}) as Record<string, unknown>;
    const d = (p.display ?? {}) as Record<string, unknown>;
    const fl = (p.filters ?? {}) as Record<string, unknown>;
    const D = DEFAULT_PREFS;
    return {
      mode: p.mode === "local" ? "local" : "global",
      depth: p.depth === 2 ? 2 : 1,
      showAll: p.showAll === true,
      forces: {
        center: num(f.center, D.forces.center, GRAPH_RANGES.center),
        repel: num(f.repel, D.forces.repel, GRAPH_RANGES.repel),
        linkForce: num(f.linkForce, D.forces.linkForce, GRAPH_RANGES.linkForce),
        linkDistance: num(f.linkDistance, D.forces.linkDistance, GRAPH_RANGES.linkDistance),
      },
      display: {
        nodeSize: num(d.nodeSize, D.display.nodeSize, GRAPH_RANGES.nodeSize),
        linkThickness: num(d.linkThickness, D.display.linkThickness, GRAPH_RANGES.linkThickness),
        labelThreshold: num(d.labelThreshold, D.display.labelThreshold, GRAPH_RANGES.labelThreshold),
        arrows: d.arrows === true,
      },
      filters: {
        // default ON unless explicitly false; old blobs (no `filters`) keep "show all"
        orphans: fl.orphans !== false,
        existingOnly: fl.existingOnly === true,
      },
      // R90: keep only well-formed groups (string query + #rrggbb color); cap the
      // count so a corrupt blob can't blow up the settings list / draw batching.
      groups: Array.isArray(p.groups)
        ? (p.groups as unknown[])
            .filter(
              (g): g is GraphGroup =>
                !!g &&
                typeof (g as GraphGroup).query === "string" &&
                HEX_RE.test((g as GraphGroup).color),
            )
            .map((g) => ({ query: g.query, color: g.color }))
            .slice(0, 24)
        : [],
    };
  } catch {
    return DEFAULT_PREFS; // corrupt → defaults
  }
}

/**
 * R90 (㊵): the colour a resolved node should be filled with — the first group
 * whose query matches, else `defaultColor`. Pure (exported for the probe).
 * `path:<folder>` matches the node path's folder prefix; bare text is a
 * case-insensitive substring match on the node label (basename).
 */
export function nodeGroupColor(
  node: { id: string; label: string },
  groups: readonly GraphGroup[],
  defaultColor: string,
): string {
  for (const g of groups) {
    const q = g.query.trim();
    if (!q) continue;
    if (q.startsWith("path:")) {
      const folder = q.slice(5).trim().replace(/^\/+|\/+$/g, "");
      if (folder && node.id.startsWith(folder + "/")) return g.color;
    } else if (node.label.toLowerCase().includes(q.toLowerCase())) {
      return g.color;
    }
  }
  return defaultColor;
}

/**
 * R84 (㊵): pure client-side graph filtering — drop unresolved (linked-but-missing)
 * nodes when `existingOnly`, then drop orphans (degree 0 in the remaining edge set)
 * when `!orphans`. Orphan-ness is computed AFTER existingOnly so a note linked only
 * to missing notes becomes an orphan (matches Obsidian). Pure; does not mutate input.
 * Exported for the probe + unit testability.
 */
export function applyGraphFilters<
  N extends { id: string; resolved: boolean },
  E extends { source: string; target: string },
>(nodes: readonly N[], edges: readonly E[], filters: GraphFilters): { nodes: N[]; edges: E[] } {
  let n: readonly N[] = nodes;
  let e: readonly E[] = edges;
  if (filters.existingOnly) {
    n = n.filter((x) => x.resolved);
    const keep = new Set(n.map((x) => x.id));
    e = e.filter((x) => keep.has(x.source) && keep.has(x.target));
  }
  if (!filters.orphans) {
    const deg = new Map<string, number>();
    for (const x of e) {
      deg.set(x.source, (deg.get(x.source) ?? 0) + 1);
      deg.set(x.target, (deg.get(x.target) ?? 0) + 1);
    }
    n = n.filter((x) => (deg.get(x.id) ?? 0) > 0); // orphans have no edges → edges stay valid
  }
  return { nodes: [...n], edges: [...e] };
}

export function loadPrefs(): GraphPrefs {
  try {
    return parseGraphPrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: GraphPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — fine */
  }
}
