/**
 * Graph view persisted prefs (R78, ㊵) — type + validation + localStorage, split
 * out of GraphView so the parse/clamp logic is unit-testable (and probe-driven).
 *
 * Backward compatible: an old `{mode,depth,showAll}` blob (or any missing/corrupt
 * field) falls back to the defaults below — forces/display simply default in.
 */
import type { GraphNode, GraphEdge } from "@core/types";

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
  /** R99: show tags as their own (green) nodes, linked to the notes that use them */
  tags: boolean;
  /** R101: show attachments as their own (yellow) nodes, linked to the notes referencing them */
  attachments: boolean;
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
  /** R103: local-mode BFS depth (hops from the anchor), 1–5 (Obsidian range). */
  depth: number;
  /** R103: in local mode, follow outgoing links (anchor → notes it links to). default on. */
  outgoing: boolean;
  /** R103: in local mode, follow incoming links (notes that link to the anchor). default on. */
  incoming: boolean;
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
  // both directions on = the prior undirected local BFS (zero regression)
  outgoing: true,
  incoming: true,
  showAll: false,
  forces: Object.freeze({ center: 0.06, repel: 200, linkForce: 0.5, linkDistance: 70 }),
  display: Object.freeze({ nodeSize: 1, linkThickness: 1, labelThreshold: 0.8, arrows: false, tags: false, attachments: false }),
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
      // R103: depth 1–5 (old blobs stored 1|2; clamp + round any out-of-range value)
      depth: typeof p.depth === "number" && Number.isFinite(p.depth)
        ? Math.min(5, Math.max(1, Math.round(p.depth)))
        : 1,
      // R103: default ON unless explicitly false (old blobs without the keys → both on)
      outgoing: p.outgoing !== false,
      incoming: p.incoming !== false,
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
        tags: d.tags === true,
        attachments: d.attachments === true,
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

/**
 * R99/R101: shared builder for an "aux" half of the graph — one resolved node per
 * map key (id `prefix+key`, label via `labelOf`, degree = # of kept referencing notes)
 * + a note→key edge for every (note, key) pair whose note is in `keptNotes` (so
 * excluded/filtered notes don't drag an aux node in). `resolved: true` so the
 * existing-files-only filter keeps them. Pure. The only thing tags (R99) and
 * attachments (R101) vary is the id prefix + how the key maps to a label.
 */
function buildAuxGraph(
  map: Map<string, Set<string>>,
  keptNotes: Set<string>,
  prefix: string,
  labelOf: (key: string) => string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const [key, paths] of map) {
    let degree = 0;
    for (const path of paths) {
      if (!keptNotes.has(path)) continue;
      edges.push({ source: path, target: prefix + key });
      degree++;
    }
    if (degree > 0) nodes.push({ id: prefix + key, label: labelOf(key), resolved: true, degree });
  }
  return { nodes, edges };
}

/**
 * R103 (㊵ 续续续续续): the set of node ids reachable from `anchor` within `depth` hops,
 * following edges in the enabled directions — `outgoing` walks source→target (notes the
 * anchor links to), `incoming` walks target→source (notes that link to the anchor). Both
 * on = the prior undirected local BFS (zero regression); both off = just the anchor.
 * `anchor` is always included. Pure (exported for the probe + the local-mode rebuild).
 */
export function localSubgraph(
  edges: readonly { source: string; target: string }[],
  anchor: string,
  depth: number,
  dirs: { outgoing: boolean; incoming: boolean },
): Set<string> {
  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const e of edges) {
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e.target);
    (inc.get(e.target) ?? inc.set(e.target, []).get(e.target)!).push(e.source);
  }
  const visited = new Set<string>([anchor]);
  let frontier = [anchor];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      const neighbors: string[] = [];
      if (dirs.outgoing) neighbors.push(...(out.get(id) ?? []));
      if (dirs.incoming) neighbors.push(...(inc.get(id) ?? []));
      for (const nb of neighbors) {
        if (!visited.has(nb)) {
          visited.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return visited;
}

/** R99: tag node ids are prefixed (mirrors the `unresolved:` id-encoding convention)
 *  so consumers (draw, hover) can tell a tag node from a note without a shape change. */
export const TAG_PREFIX = "tag:";

/** R99 (㊵ 续续续): the tag half of the graph — one green node per tag (label `#<name>`),
 *  note→tag edges for kept notes. See buildAuxGraph. */
export function buildTagGraph(
  tagMap: Map<string, Set<string>>,
  keptNotes: Set<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return buildAuxGraph(tagMap, keptNotes, TAG_PREFIX, (tag) => "#" + tag);
}

/** R101: attachment node ids are prefixed (mirrors `tag:`/`unresolved:`) so draw/click
 *  can tell an attachment from a note; the suffix is the real vault path, so openNode
 *  strips the prefix to open the actual file. */
export const ATTACHMENT_PREFIX = "attachment:";

/** R101 (㊵ 续续续续): the attachment half of the graph — one yellow node per referenced
 *  attachment (label = basename), note→attachment edges for kept notes. The map's keys
 *  are real vault paths (metadata.getAttachmentMap). See buildAuxGraph. */
export function buildAttachmentGraph(
  attachmentMap: Map<string, Set<string>>,
  keptNotes: Set<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return buildAuxGraph(attachmentMap, keptNotes, ATTACHMENT_PREFIX, (p) =>
    p.slice(p.lastIndexOf("/") + 1),
  );
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
