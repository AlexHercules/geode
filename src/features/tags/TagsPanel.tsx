// Tags right-sidebar panel (R41): every vault tag + file count; click to search.
// R69: right-click a tag → vault-wide rename via @core/tagRewrite.
// R150 (㊻): nested tags (#a/b) render as a collapsible hierarchy tree, like Obsidian's tag pane.
// Contract: docs/ARCHITECTURE.md "Round 41/69/150 additions".
// Layering: features/ may import only @core/*, @app/AppContext, @app/icons.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import { renameTagAcrossVault, isValidTagName } from "@core/tagRewrite";
import "./tags.css";

interface MenuState {
  x: number;
  y: number;
  tag: string;
}

/** A node in the tag hierarchy. `segment` is the last path part (shown), `fullPath`
 *  the whole tag (searched/renamed). `count` is the exact note count for a real tag,
 *  or the subtree's distinct-note aggregate for a phantom parent (a path segment that
 *  is never a tag on its own). */
interface TagTreeNode {
  segment: string;
  fullPath: string;
  count: number;
  children: TagTreeNode[];
}

/** R151: sort order for the tag tree (Obsidian: Frequency / Tag name, each asc/desc). */
export type TagSortKey = "freq-desc" | "freq-asc" | "name-asc" | "name-desc";

const TAG_CMP: Record<TagSortKey, (a: TagTreeNode, b: TagTreeNode) => number> = {
  "freq-desc": (a, b) => b.count - a.count || a.segment.localeCompare(b.segment),
  "freq-asc": (a, b) => a.count - b.count || a.segment.localeCompare(b.segment),
  "name-asc": (a, b) => a.segment.localeCompare(b.segment),
  "name-desc": (a, b) => b.segment.localeCompare(a.segment),
};

/** Build the `/`-nested tag tree from the tag→notes map, sorted at every level. Pure. */
export function buildTagTree(
  map: Map<string, ReadonlySet<string>>,
  sortKey: TagSortKey = "freq-desc",
): TagTreeNode[] {
  interface Build {
    segment: string;
    fullPath: string;
    own: ReadonlySet<string> | null; // exact note set when this path is itself a tag
    children: Map<string, Build>;
  }
  const roots = new Map<string, Build>();
  for (const [tag, notes] of map) {
    // skip empty segments so a malformed tag (leading/trailing/double "/") never makes
    // an empty-named row or drops a leading-slash into a sibling's path (R150 review)
    const segs = tag.split("/").filter((s) => s !== "");
    if (segs.length === 0) continue;
    let level = roots;
    let path = "";
    let node: Build | null = null;
    for (const seg of segs) {
      path = path ? `${path}/${seg}` : seg;
      node = level.get(seg) ?? null;
      if (!node) {
        node = { segment: seg, fullPath: path, own: null, children: new Map() };
        level.set(seg, node);
      }
      level = node.children;
    }
    if (node) node.own = notes; // the whole tag is a real tag
  }
  const subtreeNotes = (n: Build): Set<string> => {
    const acc = new Set<string>(n.own ?? []);
    for (const c of n.children.values()) for (const p of subtreeNotes(c)) acc.add(p);
    return acc;
  };
  const cmp = TAG_CMP[sortKey];
  const finalize = (n: Build): TagTreeNode => ({
    segment: n.segment,
    fullPath: n.fullPath,
    count: n.own !== null ? n.own.size : subtreeNotes(n).size,
    children: [...n.children.values()].map(finalize).sort(cmp),
  });
  return [...roots.values()].map(finalize).sort(cmp);
}

const SORT_KEY_PREF = "geode.tagsSort";
const isTagSortKey = (v: string): v is TagSortKey =>
  v === "freq-desc" || v === "freq-asc" || v === "name-asc" || v === "name-desc";
/** R151: persisted sort pref (raw localStorage — a feature can't import SearchPanel's helper;
 *  precedent: R141 commandMru). Best-effort: any failure falls back to the default. */
function readTagSort(): TagSortKey {
  try {
    const v = localStorage.getItem(SORT_KEY_PREF);
    return v !== null && isTagSortKey(v) ? v : "freq-desc";
  } catch {
    return "freq-desc";
  }
}

export function TagsPanel() {
  const app = useApp();
  const t = useI18n();
  const rev = useStore(app.metadata.revision); // re-render on index change
  const [sortKey, setSortKey] = useState<TagSortKey>(readTagSort);
  const tree = useMemo(
    () => buildTagTree(app.metadata.getTagMap(), sortKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app.metadata, rev, sortKey],
  );

  const changeSort = (key: TagSortKey): void => {
    setSortKey(key);
    try {
      localStorage.setItem(SORT_KEY_PREF, key);
    } catch {
      /* storage unavailable — session-only */
    }
  };

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [result, setResult] = useState<string | null>(null);
  // R150: per-session collapse state (fullPaths that are collapsed); default expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleFold = (fullPath: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });

  /* close context menu on click-elsewhere / Escape (mirrors AllProperties) */
  useEffect(() => {
    if (!menu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenu(null);
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menu]);

  const doRename = (tag: string): void => {
    setResult(null);
    const input = window.prompt(t("tags.renamePrompt", { tag }), tag);
    if (input === null) return; // cancelled
    const newTag = input.replace(/^#+/, "").trim();
    if (newTag === "" || newTag === tag) return;
    // front-end guard: illegal chars / renaming into own subtree → show
    // renameInvalid, never call the engine.
    if (!isValidTagName(newTag) || newTag.startsWith(tag + "/")) {
      setResult(t("tags.renameInvalid"));
      return;
    }
    void renameTagAcrossVault(
      { vault: app.vault, metadata: app.metadata, documents: app.documents },
      tag,
      newTag,
    ).then((res) => {
      // always surface skips — even when nothing changed, the user must see
      // that N files were refused (R47 "consume the skipped report" lesson)
      const skipNote = res.skipped.length > 0 ? t("tags.renameSkipped", { skip: res.skipped.length }) : "";
      if (res.filesChanged === 0) {
        setResult(t("tags.renameNoop") + skipNote);
        return;
      }
      setResult(t("tags.renameDone", { old: tag, new: newTag, changed: res.filesChanged }) + skipNote);
    });
  };

  /* depth-first render of one node + (if expanded) its children */
  const renderNode = (node: TagTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.fullPath);
    return (
      <div key={node.fullPath} className="tag-node">
        <div
          className="tag-row-wrap"
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={hasChildren ? !isCollapsed : undefined}
          style={{ paddingLeft: depth * 14 }}
        >
          {hasChildren ? (
            <button
              className="tag-chevron"
              data-testid={`tag-chevron-${node.fullPath}`}
              aria-label={t(isCollapsed ? "tags.expand" : "tags.collapse")}
              onClick={() => toggleFold(node.fullPath)}
            >
              <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} size={12} />
            </button>
          ) : (
            <span className="tag-chevron-spacer" />
          )}
          <button
            className="tag-row"
            data-testid={`tag-row-${node.fullPath}`}
            title={t("tags.count", { count: node.count })}
            onClick={() => app.workspace.requestSearch(`#${node.fullPath}`)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, tag: node.fullPath });
            }}
          >
            <span className="tag-row-icon"><Icon name="hash" size={13} /></span>
            <span className="tag-row-name">{node.segment}</span>
            <span className="tag-row-count">{node.count}</span>
          </button>
        </div>
        {hasChildren && !isCollapsed && (
          <div role="group">{node.children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="tags-panel" data-testid="tags-panel">
      <div className="tags-panel-header">
        <span className="tags-panel-title">{t("tags.title")}</span>
        <select
          className="tags-sort"
          data-testid="tags-sort"
          value={sortKey}
          aria-label={t("tags.sortBy")}
          onChange={(e) => changeSort(e.target.value as TagSortKey)}
        >
          <option value="freq-desc">{t("tags.sortFreqDesc")}</option>
          <option value="freq-asc">{t("tags.sortFreqAsc")}</option>
          <option value="name-asc">{t("tags.sortNameAsc")}</option>
          <option value="name-desc">{t("tags.sortNameDesc")}</option>
        </select>
      </div>
      {result !== null && (
        <div className="tags-result" data-testid="tags-result" role="status">
          {result}
        </div>
      )}
      {tree.length === 0 ? (
        <div className="tags-empty">{t("tags.empty")}</div>
      ) : (
        <div className="tags-list" role="tree">
          {tree.map((node) => renderNode(node, 0))}
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          className="tag-menu"
          data-testid="tag-menu"
          role="menu"
          aria-label={t("tags.menu")}
          style={{
            left: Math.min(menu.x, window.innerWidth - 200),
            top: Math.min(menu.y, window.innerHeight - 80),
          }}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="tag-rename"
            onClick={() => {
              const tag = menu.tag;
              setMenu(null);
              doRename(tag);
            }}
          >
            <Icon name="pencil" size={14} />
            {t("tags.rename")}
          </button>
        </div>
      )}
    </div>
  );
}
