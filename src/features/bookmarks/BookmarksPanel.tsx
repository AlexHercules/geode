// Bookmarks left-sidebar panel (R27).
// Contract: docs/ARCHITECTURE.md "Round 27 additions".
// Layering: features/ may import only @core/*, @app/AppContext, @app/icons.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import { bookmarks } from "@core/bookmarks";
import type { BookmarkItem } from "@core/bookmarks";
import "./bookmarks.css";

/** Private DnD MIME — foreign drags (files, text, tabs) are ignored. */
const BM_MIME = "application/geode-bookmark";

interface MenuState {
  x: number;
  y: number;
  path: number[];
}

/** Where an in-flight drag would land: a leaf reorder shows an insertion bar. */
interface DropTarget {
  /** stringified index path of the row being hovered */
  key: string;
  /** true = drop INTO a group (highlight whole row), false = insert before leaf */
  intoGroup: boolean;
}

/** basename of a vault path ("a/b/c.md" -> "c.md", "a/b" -> "b"). */
function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/** strip the markdown filename extension for display ("c.md" -> "c"). */
function fileLabel(path: string): string {
  const base = basename(path);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

const keyOf = (indexPath: ReadonlyArray<number>): string => JSON.stringify(indexPath);

export function BookmarksPanel() {
  const app = useApp();
  const t = useI18n();
  const items = useStore(bookmarks.items);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // collapsed group keys (default: every group expanded → absence = expanded)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const menuRef = useRef<HTMLDivElement>(null);

  /* close context menu on click-elsewhere / Escape (mirrors Explorer) */
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

  /** display label for an item (custom title wins, else derive from type). */
  const labelFor = (item: BookmarkItem): string => {
    if (item.title) return item.title;
    switch (item.type) {
      case "file":
        return fileLabel(item.path);
      case "folder":
        return basename(item.path) || item.path;
      case "heading": {
        // strip exactly the one subpath-prefix "#" (a heading whose text itself
        // starts with "#", stored as "##tag", must still display the "#tag")
        const head = item.subpath.replace(/^#/, "");
        return `${fileLabel(item.path)} > ${head}`;
      }
      case "block": {
        const block = item.subpath.replace(/^#/, "");
        return `${fileLabel(item.path)} > ${block}`;
      }
      case "search":
        return t("bookmarks.untitledSearch", { query: item.query });
      case "graph":
        return t("bookmarks.graph");
      case "group":
        return item.title ?? "";
    }
  };

  const iconFor = (item: BookmarkItem): string => {
    switch (item.type) {
      case "file":
        return "file-text";
      case "folder":
      case "group":
        return "folder";
      case "heading":
      case "block":
        return "hash";
      case "search":
        return "search";
      case "graph":
        return "graph";
    }
  };

  /** open / navigate to a leaf item. */
  const activate = (item: BookmarkItem): void => {
    switch (item.type) {
      case "file":
        app.workspace.openFile(item.path);
        break;
      case "heading":
      case "block": {
        app.workspace.openFile(item.path);
        // subpath is stored Obsidian-shape with a leading "#" ("#Heading",
        // "#^blockId"); resolveSubpath wants it WITHOUT the "#" (it keys "^id"
        // on the bare caret) — strip exactly one leading "#".
        const sub = item.subpath.replace(/^#/, "");
        const s = app.metadata.resolveSubpath(item.path, sub);
        if (s) app.workspace.requestReveal(item.path, s.from, s.to);
        break;
      }
      case "folder":
        app.workspace.setLeftPanel("explorer");
        break;
      case "graph":
        app.workspace.openGraph();
        break;
      case "search":
        // no programmatic query injection available — just switch panel (known gap)
        app.workspace.setLeftPanel("search");
        break;
    }
  };

  const toggleCollapse = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renameAt = (indexPath: number[], current: string): void => {
    const result = window.prompt(t("bookmarks.renamePrompt"), current);
    if (result === null) return; // cancelled
    void bookmarks.setTitleAt(indexPath, result);
  };

  /* ---------------- drag & drop ---------------- */

  const isBmDrag = (e: React.DragEvent): boolean =>
    e.dataTransfer.types.includes(BM_MIME);

  const onDragStart = (e: React.DragEvent, indexPath: number[]): void => {
    e.dataTransfer.setData(BM_MIME, JSON.stringify(indexPath));
    e.dataTransfer.effectAllowed = "move";
    e.stopPropagation();
  };

  const parentOf = (indexPath: number[]): number[] => indexPath.slice(0, -1);

  /** would moving `from` into `intoGroup` create a cycle (group into itself/descendant)? */
  const isInvalidDrop = (from: number[], intoGroup: number[]): boolean => {
    // dropping a node into a path that starts with itself = into own subtree
    if (intoGroup.length < from.length) return false;
    for (let i = 0; i < from.length; i++) {
      if (intoGroup[i] !== from[i]) return false;
    }
    return true;
  };

  const handleDrop = (
    e: React.DragEvent,
    targetPath: number[],
    targetItem: BookmarkItem,
  ): void => {
    if (!isBmDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const raw = e.dataTransfer.getData(BM_MIME);
    if (!raw) return;
    let from: number[];
    try {
      from = JSON.parse(raw) as number[];
    } catch {
      return;
    }
    if (keyOf(from) === keyOf(targetPath)) return;

    if (targetItem.type === "group") {
      // drop INTO the group, at its end
      if (isInvalidDrop(from, targetPath)) return;
      const end = targetItem.items.length;
      void bookmarks.move(from, targetPath, end);
    } else {
      // reorder within the target's parent, inserting before the target row
      const toGroup = parentOf(targetPath);
      const toIndex = targetPath[targetPath.length - 1] ?? 0;
      if (isInvalidDrop(from, toGroup)) return;
      void bookmarks.move(from, toGroup, toIndex);
    }
  };

  /* ---------------- recursive render ---------------- */

  const renderRow = (item: BookmarkItem, indexPath: number[]): JSX.Element => {
    const key = keyOf(indexPath);
    const isGroup = item.type === "group";
    const isCollapsed = isGroup && collapsed.has(key);
    const depth = indexPath.length - 1;
    const label = labelFor(item);
    const dt = dropTarget?.key === key ? dropTarget : null;

    return (
      <div key={key} className="bookmark-row-wrap">
        {dt && !dt.intoGroup && <div className="bookmark-drop-line" />}
        <div
          className={`bookmark-row${isGroup ? " is-group" : ""}${
            dt?.intoGroup ? " is-drop-into" : ""
          }`}
          data-testid={isGroup ? "bookmark-group" : "bookmark-item"}
          data-bm-path={key}
          style={{ paddingLeft: 6 + depth * 16 }}
          draggable
          title={label}
          onClick={() => {
            if (isGroup) toggleCollapse(key);
            else activate(item);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, path: indexPath });
          }}
          onDragStart={(e) => onDragStart(e, indexPath)}
          onDragOver={(e) => {
            if (!isBmDrag(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const next: DropTarget = { key, intoGroup: isGroup };
            setDropTarget((prev) =>
              prev && prev.key === next.key && prev.intoGroup === next.intoGroup
                ? prev
                : next,
            );
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDropTarget((prev) => (prev?.key === key ? null : prev));
          }}
          onDrop={(e) => handleDrop(e, indexPath, item)}
        >
          <span className="bookmark-chevron">
            {isGroup && (
              <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} size={13} />
            )}
          </span>
          <span className="bookmark-icon">
            <Icon name={iconFor(item)} size={14} />
          </span>
          <span className="bookmark-name">{label}</span>
        </div>
        {isGroup && !isCollapsed && (
          <div className="bookmark-children">
            {(item.items ?? []).map((child, i) =>
              renderRow(child, [...indexPath, i]),
            )}
          </div>
        )}
      </div>
    );
  };

  const menuItem = useMemo(() => {
    if (!menu) return null;
    // resolve the item at the menu's index path for rename default + group check
    let node: BookmarkItem | undefined;
    let level: ReadonlyArray<BookmarkItem> = items;
    for (let i = 0; i < menu.path.length; i++) {
      node = level[menu.path[i]!];
      if (node && node.type === "group") level = node.items;
      else level = [];
    }
    return node ?? null;
  }, [menu, items]);

  return (
    <div className="bookmarks-panel" data-testid="bookmarks-panel">
      <div className="panel-header">
        <span className="bookmarks-title">{t("bookmarks.title")}</span>
        <div className="panel-actions">
          <button
            title={t("bookmarks.newGroup")}
            aria-label={t("bookmarks.newGroup")}
            data-testid="bookmarks-new-group"
            onClick={() => void bookmarks.addGroup(t("bookmarks.newGroupName"))}
          >
            <Icon name="folder-plus" size={16} />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="bookmarks-empty" data-testid="bookmarks-empty">
          <p>{t("bookmarks.empty")}</p>
          <p className="bookmarks-empty-hint">{t("bookmarks.emptyHint")}</p>
        </div>
      ) : (
        <div className="bookmarks-tree">
          {items.map((item, i) => renderRow(item, [i]))}
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          className="bookmarks-menu"
          data-testid="bookmarks-menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 190),
            top: Math.min(menu.y, window.innerHeight - 140),
          }}
        >
          {menuItem?.type === "group" && (
            <>
              <button
                onClick={() => {
                  const path = menu.path;
                  setMenu(null);
                  void bookmarks.addGroup(t("bookmarks.newGroupName"), path);
                }}
              >
                <Icon name="folder-plus" size={14} />
                {t("bookmarks.newGroup")}
              </button>
              <div className="bookmarks-menu-sep" />
            </>
          )}
          <button
            onClick={() => {
              const path = menu.path;
              const current = menuItem?.title ?? "";
              setMenu(null);
              renameAt(path, current);
            }}
          >
            <Icon name="pencil" size={14} />
            {t("bookmarks.rename")}
          </button>
          <button
            className="is-danger"
            onClick={() => {
              const path = menu.path;
              setMenu(null);
              void bookmarks.removeAt(path);
            }}
          >
            <Icon name="x" size={14} />
            {t("bookmarks.remove")}
          </button>
        </div>
      )}
    </div>
  );
}
