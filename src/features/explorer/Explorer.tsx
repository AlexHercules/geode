import { useEffect, useMemo, useRef, useState } from "react";
import type { FolderNode, VaultNode } from "@core/types";
import { isTauri, parentPath, basename, sortTreeNodes, type ExplorerSortKey } from "@core/vault";
import { EXPLORER_MIME, findFolder, moveTargets, resolveDropTarget, wouldCollide } from "@core/explorerMove";
import { MoveToModal } from "./MoveToModal";
import { explorerSort, setExplorerSort } from "@core/appearance";
import { excludedRaw, isExcluded } from "@core/excludedFiles";
import { useStore } from "@core/store";
import { useI18n } from "@core/i18n";
import { renameWithLinkUpdate } from "@core/linkRewrite";
import { findActiveTab } from "@core/workspace";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import "./explorer.css";

const EXPANDED_KEY = "geode.explorer.expanded";

/** must match `.explorer-item { height }` in explorer.css */
const ROW_HEIGHT = 26;
/** virtualize only past this row count — small vaults keep the full DOM */
const VIRTUAL_THRESHOLD = 200;
/** extra rows rendered above/below the viewport */
const OVERSCAN = 10;

interface Row {
  node: VaultNode;
  depth: number;
}

interface MenuState {
  x: number;
  y: number;
  /** R93: null = empty-area right-click → root New note / New folder menu */
  node: VaultNode | null;
}

/* ---------------- pure helpers ---------------- */

function flattenVisible(root: FolderNode, expanded: Set<string>, sortKey: ExplorerSortKey): Row[] {
  const rows: Row[] = [];
  const walk = (folder: FolderNode, depth: number) => {
    // R91: sort each level for display only (vault's stored order is untouched)
    for (const child of sortTreeNodes(folder.children, sortKey)) {
      rows.push({ node: child, depth });
      if (child.kind === "folder" && expanded.has(child.path)) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

function collectFolderPaths(root: FolderNode): string[] {
  const out: string[] = [];
  const walk = (folder: FolderNode) => {
    for (const child of folder.children) {
      if (child.kind === "folder") {
        out.push(child.path);
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

function uniqueFolderPath(root: FolderNode, parent: string, base: string): string {
  const siblings = findFolder(root, parent)?.children ?? [];
  const names = new Set(siblings.map((c) => c.name.toLowerCase()));
  let name = base;
  let n = 1;
  while (names.has(name.toLowerCase())) {
    name = `${base} ${n}`;
    n++;
  }
  return parent ? `${parent}/${name}` : name;
}

/** remap a path set after a rename (folder renames move descendants too) */
function remapPaths(set: Set<string>, oldPath: string, newPath: string): Set<string> {
  const out = new Set<string>();
  for (const p of set) {
    if (p === oldPath) out.add(newPath);
    else if (p.startsWith(oldPath + "/")) out.add(newPath + p.slice(oldPath.length));
    else out.add(p);
  }
  return out;
}

/** Transient warning toast — skipped files during a link update must be
 *  visible to the user (details live in the console). Same pattern as the
 *  export-notice toast; re-triggering replaces the previous one. */
function showLinkUpdateNotice(message: string): void {
  document.querySelector(".link-update-notice")?.remove();
  const el = document.createElement("div");
  el.className = "link-update-notice";
  el.textContent = message;
  el.setAttribute("data-testid", "link-update-notice");
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 4000);
}

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) return new Set(arr.filter((p): p is string => typeof p === "string"));
    }
  } catch {
    /* corrupted — start fresh */
  }
  return new Set();
}

/* ---------------- inline rename input ---------------- */

function RenameInput(props: {
  initial: string;
  validate: (value: string) => boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const valid = props.validate(value);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    props.onCommit(value.trim());
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    props.onCancel();
  };

  return (
    <input
      ref={inputRef}
      className={`explorer-rename${valid ? "" : " is-invalid"}`}
      data-testid="explorer-rename-input"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          if (valid) commit();
        } else if (e.key === "Escape") {
          cancel();
        }
      }}
      onBlur={() => {
        if (valid && value.trim() !== props.initial) commit();
        else cancel();
      }}
    />
  );
}

/* ---------------- Explorer ---------------- */

export function Explorer() {
  const app = useApp();
  const t = useI18n();
  const tree = useStore(app.vault.tree);
  const ws = useStore(app.workspace.state);
  const activeFile = useMemo(() => {
    const tab = findActiveTab(ws);
    return tab?.viewType === "markdown" ? tab.filePath : null;
  }, [ws]);

  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  /* R97: path being moved via the "Move to…" folder picker (null = closed) */
  const [movePath, setMovePath] = useState<string | null>(null);
  /* R28 drag-to-move: source path being dragged; current drop folder
     (null = none/illegal, "" = vault root, "a/b" = that folder) */
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const treeRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const sortKey = useStore(explorerSort);
  // R96: subscribe so the tree re-renders (re-applying the dim via renderRow's
  // isExcluded) whenever the excluded-files patterns change
  useStore(excludedRaw);
  const rows = useMemo(
    () => (tree ? flattenVisible(tree, expanded, sortKey) : []),
    [tree, expanded, sortKey],
  );
  const allFolders = useMemo(() => (tree ? collectFolderPaths(tree) : []), [tree]);
  const anyExpanded = expanded.size > 0;

  /* ---- virtualization (large vaults only) ---- */
  const virtual = rows.length > VIRTUAL_THRESHOLD;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  useEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    setViewportH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* row count shrank (collapse-all / big delete): the remembered scrollTop can exceed
     the new total height — clamp both the state and the container's real scrollTop */
  useEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    const maxTop = Math.max(0, rows.length * ROW_HEIGHT - viewportH);
    if (el.scrollTop > maxTop) el.scrollTop = maxTop;
    setScrollTop((prev) => Math.min(prev, maxTop));
  }, [rows.length, viewportH]);

  /* non-virtual mode doesn't track scroll — re-sync state when virtualization kicks back in */
  useEffect(() => {
    if (virtual && treeRef.current) setScrollTop(treeRef.current.scrollTop);
  }, [virtual]);

  /* persist expanded folders */
  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch {
      /* storage unavailable — fine */
    }
  }, [expanded]);

  /* keep selection visible — only when `selected` itself changes, not on every tree
     refresh (new file / rename / external watcher), which would yank the viewport back */
  const lastScrolledSelected = useRef<string | null>(null);
  useEffect(() => {
    if (!selected || lastScrolledSelected.current === selected) return;
    const el = treeRef.current?.querySelector(`[data-path="${CSS.escape(selected)}"]`);
    if (el) {
      lastScrolledSelected.current = selected;
      el.scrollIntoView({ block: "nearest" });
      return;
    }
    // virtualized: the selected row may not be in the DOM — scroll by index
    if (!virtual || !treeRef.current) return;
    const idx = rows.findIndex((r) => r.node.path === selected);
    if (idx === -1) return; // not in rows yet (tree refresh pending) — retry on next rows change
    lastScrolledSelected.current = selected;
    const container = treeRef.current;
    const top = idx * ROW_HEIGHT;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (top + ROW_HEIGHT > container.scrollTop + container.clientHeight) {
      container.scrollTop = top + ROW_HEIGHT - container.clientHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rows, virtual]);

  /* close context menu on click-elsewhere / Escape */
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

  /* ---------------- actions ---------------- */

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandAncestors = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      let parent = parentPath(path);
      while (parent) {
        next.add(parent);
        parent = parentPath(parent);
      }
      return next;
    });
  };

  /** folder a new item should land in: selected folder, or parent of selected file, or root */
  const targetFolder = (): string => {
    if (!tree || !selected) return "";
    if (findFolder(tree, selected)) return selected;
    return parentPath(selected);
  };

  const newNote = async (folder?: string) => {
    const dest = folder ?? targetFolder();
    const path = app.vault.uniquePath(dest, "Untitled");
    try {
      await app.vault.create(path);
    } catch (err) {
      console.error("[explorer] create note failed", err);
      return;
    }
    if (dest) expandAncestors(path);
    app.workspace.openFile(path);
    setSelected(path);
    setRenaming(path);
  };

  const newFolder = async (folder?: string) => {
    if (!tree) return;
    const dest = folder ?? targetFolder();
    const path = uniqueFolderPath(tree, dest, "New folder");
    try {
      await app.vault.createFolder(path);
    } catch (err) {
      console.error("[explorer] create folder failed", err);
      return;
    }
    if (dest) expandAncestors(path);
    setSelected(path);
    setRenaming(path);
  };

  const startRename = (node: VaultNode) => {
    setSelected(node.path);
    setRenaming(node.path);
  };

  const deleteNode = async (node: VaultNode) => {
    const message =
      node.kind === "folder"
        ? t("explorer.deleteConfirmFolder", { name: node.name })
        : t("explorer.deleteConfirmFile", { name: node.name });
    let ok: boolean;
    if (isTauri()) {
      // window.confirm is unreliable in wry webviews — use the native dialog
      const { ask } = await import("@tauri-apps/plugin-dialog");
      ok = await ask(message, { title: t("explorer.delete"), kind: "warning" });
    } else {
      ok = window.confirm(message);
    }
    if (!ok) return;
    try {
      // R42: flush pending editor saves BEFORE trashing so the recoverable copy
      // in .trash holds the user's latest edits (review: trash-before-flush =
      // truly lossless), then route deletion through the local `.trash/`.
      await app.workspace.flushAll();
      await app.vault.trash(node.path);
    } catch (err) {
      console.error("[explorer] delete failed", err);
      return;
    }
    if (selected === node.path) setSelected(null);
  };

  /* ---------------- R93 context-menu open / copy ---------------- */

  const openInNewTab = (node: VaultNode) => app.workspace.openFile(node.path, { newTab: true });

  /** Open the file in a new split to the right (Obsidian "Open to the right"). Splits
   *  the active pane — the new pane starts as a dup tab — then retargets it at `path`.
   *  splitActivePane → null (no active pane / graph) falls back to a plain new tab. */
  const openToRight = (node: VaultNode) => {
    const paneId = app.workspace.splitActivePane("row");
    app.workspace.openFile(node.path, paneId ? { paneId } : { newTab: true });
  };

  /** Duplicate a file (Obsidian "Make a copy" → "<name> 1.<ext>"). R42: flush pending
   *  editor saves first so the copy captures the latest content, then copy BYTES via
   *  readBinary → createBinary (works for markdown + attachments). The dest is derived
   *  from the source path (parentPath + basename + extension) so it is inherently
   *  in-vault; uniquePath avoids collisions; the source is never written. */
  const makeCopy = async (node: VaultNode) => {
    if (node.kind !== "file") return;
    const dest = app.vault.uniquePath(parentPath(node.path), node.basename, node.extension);
    try {
      await app.workspace.flushAll();
      const data = await app.vault.readBinary(node.path);
      await app.vault.createBinary(dest, data);
    } catch (err) {
      console.error("[explorer] make copy failed", err);
      return;
    }
    expandAncestors(dest);
    setSelected(dest);
    if (node.extension === "md") app.workspace.openFile(dest);
  };

  const validateName = (node: VaultNode, value: string): boolean => {
    const name = value.trim();
    if (!name) return false;
    if (/[\\/]/.test(name)) return false;
    if (!tree) return false;
    const fullName = node.kind === "file" && node.extension ? `${name}.${node.extension}` : name;
    const siblings = findFolder(tree, parentPath(node.path))?.children ?? [];
    return !siblings.some(
      (c) => c.path !== node.path && c.name.toLowerCase() === fullName.toLowerCase(),
    );
  };

  const commitRename = async (node: VaultNode, name: string) => {
    setRenaming(null);
    const fullName = node.kind === "file" && node.extension ? `${name}.${node.extension}` : name;
    const parent = parentPath(node.path);
    const newPath = parent ? `${parent}/${fullName}` : fullName;
    if (newPath === node.path) return;
    try {
      // R16: every rename (file / folder / attachment) goes through the link
      // rewrite engine — it degrades to a bare rename when autoUpdateLinks is off
      const result = await renameWithLinkUpdate(
        { vault: app.vault, metadata: app.metadata, documents: app.documents },
        node.path,
        newPath,
      );
      if (result.linksRewritten > 0) {
        console.info(
          `[explorer] updated ${result.linksRewritten} link(s) in ${result.filesChanged} file(s)`,
        );
      }
      if (result.skipped.length > 0) {
        showLinkUpdateNotice(t("explorer.linkUpdateSkipped", { count: result.skipped.length }));
      }
    } catch (err) {
      console.error("[explorer] rename failed", err);
      return;
    }
    if (node.kind === "folder") setExpanded((prev) => remapPaths(prev, node.path, newPath));
    setSelected(newPath);
  };

  /* ---------------- R28 drag-to-move ---------------- */

  /** Move `fromPath` into the folder implied by `hoveredPath` (folder → itself,
   *  file → its parent, null → root). Reuses the R16/R27 write throat
   *  `renameWithLinkUpdate` — NO new write path; only the four guards
   *  (no-op / self-descendant via resolveDropTarget, collision, stale) decide
   *  whether to call it. Contract: ARCHITECTURE "Round 28 additions". */
  const moveNode = async (fromPath: string, hoveredPath: string | null) => {
    if (!tree) return;
    // stale guard: the dragged node may have been moved/deleted by an external
    // watcher mid-drag — re-verify against the live vault before any write
    if (!app.vault.fileExists(fromPath) && !app.vault.folderExists(fromPath)) return;
    const target = resolveDropTarget(tree, fromPath, hoveredPath);
    if (target === null) return; // no-op / into self / descendant
    if (wouldCollide(tree, fromPath, target)) {
      showLinkUpdateNotice(t("explorer.moveCollision", { name: basename(fromPath) }));
      return;
    }
    const name = basename(fromPath);
    const newPath = target ? `${target}/${name}` : name;
    const isFolder = findFolder(tree, fromPath) !== null;
    try {
      const result = await renameWithLinkUpdate(
        { vault: app.vault, metadata: app.metadata, documents: app.documents },
        fromPath,
        newPath,
      );
      if (result.linksRewritten > 0) {
        console.info(
          `[explorer] moved + updated ${result.linksRewritten} link(s) in ${result.filesChanged} file(s)`,
        );
      }
      if (result.skipped.length > 0) {
        showLinkUpdateNotice(t("explorer.linkUpdateSkipped", { count: result.skipped.length }));
      }
    } catch (err) {
      console.error("[explorer] move failed", err);
      return;
    }
    if (isFolder) setExpanded((prev) => remapPaths(prev, fromPath, newPath));
    expandAncestors(newPath); // open the destination folder so the item is visible
    setSelected(newPath);
  };

  const isExplorerDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(EXPLORER_MIME);

  const hoveredPathFromEvent = (e: React.DragEvent): string | null =>
    (e.target as HTMLElement).closest?.(".explorer-item")?.getAttribute("data-path") ?? null;

  const onTreeDragOver = (e: React.DragEvent) => {
    if (!isExplorerDrag(e)) return;
    e.preventDefault();
    if (!tree || !draggingPath) {
      e.dataTransfer.dropEffect = "none";
      return;
    }
    const target = resolveDropTarget(tree, draggingPath, hoveredPathFromEvent(e));
    e.dataTransfer.dropEffect = target === null ? "none" : "move";
    setDropTarget((prev) => (prev === target ? prev : target));
  };

  const onTreeDrop = (e: React.DragEvent) => {
    if (!isExplorerDrag(e)) return;
    e.preventDefault();
    const fromPath = e.dataTransfer.getData(EXPLORER_MIME);
    const hovered = hoveredPathFromEvent(e);
    setDropTarget(null);
    setDraggingPath(null);
    if (fromPath) void moveNode(fromPath, hovered);
  };

  const onTreeDragLeave = (e: React.DragEvent) => {
    if (!isExplorerDrag(e)) return;
    // child→child transitions fire dragleave on the parent; only clear when the
    // pointer truly left the tree (relatedTarget outside / null = left window)
    const related = e.relatedTarget as Node | null;
    if (related && treeRef.current?.contains(related)) return;
    setDropTarget(null);
  };

  const collapseOrExpandAll = () => {
    setExpanded(anyExpanded ? new Set() : new Set(allFolders));
  };

  const activateNode = (node: VaultNode) => {
    setSelected(node.path);
    if (node.kind === "folder") toggleFolder(node.path);
    else app.workspace.openFile(node.path);
  };

  /* ---------------- keyboard navigation ---------------- */

  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    if (renaming || menu) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length === 0) return;
      const idx = rows.findIndex((r) => r.node.path === selected);
      let next: number;
      if (idx === -1) next = e.key === "ArrowDown" ? 0 : rows.length - 1;
      else next = e.key === "ArrowDown" ? Math.min(idx + 1, rows.length - 1) : Math.max(idx - 1, 0);
      const row = rows[next];
      if (row) setSelected(row.node.path);
    } else if (e.key === "Enter") {
      const row = rows.find((r) => r.node.path === selected);
      if (row) {
        e.preventDefault();
        activateNode(row.node);
      }
    } else if (e.key === "F2") {
      const row = rows.find((r) => r.node.path === selected);
      if (row) {
        e.preventDefault();
        startRename(row.node);
      }
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const row = rows.find((r) => r.node.path === selected);
      if (row?.node.kind === "folder") {
        e.preventDefault();
        const isOpen = expanded.has(row.node.path);
        if (e.key === "ArrowRight" && !isOpen) toggleFolder(row.node.path);
        if (e.key === "ArrowLeft" && isOpen) toggleFolder(row.node.path);
      }
    }
  };

  /* ---------------- render ---------------- */

  const renderRow = ({ node, depth }: Row) => {
    const isFolder = node.kind === "folder";
    const isOpen = isFolder && expanded.has(node.path);
    const isActive = !isFolder && node.path === activeFile;
    const isSelected = node.path === selected;
    const isRenaming = node.path === renaming;
    const isDragging = node.path === draggingPath;
    const isDropTarget = dropTarget !== null && dropTarget !== "" && node.path === dropTarget;
    const isExcludedRow = isExcluded(node.path); // R96: dim excluded files
    const label = isFolder ? node.name : node.basename;

    return (
      <div
        key={node.path}
        className={`explorer-item${isActive ? " is-active" : ""}${isSelected ? " is-selected" : ""}${isDragging ? " is-dragging" : ""}${isDropTarget ? " is-drop-target" : ""}${isExcludedRow ? " is-excluded" : ""}`}
        data-testid="explorer-item"
        data-path={node.path}
        data-hover-path={isFolder ? undefined : node.path}
        style={{ paddingLeft: 4 + depth * 14 }}
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.dataTransfer.setData(EXPLORER_MIME, node.path);
          // "copyMove": tree drop = move (R28), editor drop = copy/link (R67 ㉛)
          e.dataTransfer.effectAllowed = "copyMove";
          // defer state update one tick — a same-frame re-render cancels the
          // drag in Chromium (R3 tab-drag precedent)
          window.setTimeout(() => setDraggingPath(node.path), 0);
        }}
        onDragEnd={() => {
          setDraggingPath(null);
          setDropTarget(null);
        }}
        onClick={() => {
          if (!isRenaming) activateNode(node);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          // R93: don't bubble to the tree-container handler (which opens the
          // empty-area root menu) — a row click owns its own node menu
          e.stopPropagation();
          setSelected(node.path);
          setMenu({ x: e.clientX, y: e.clientY, node });
        }}
        title={node.path}
      >
        <span className="explorer-chevron">
          {isFolder && <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={13} />}
        </span>
        {isFolder ? (
          <span className="explorer-icon">
            <Icon name="folder" size={14} />
          </span>
        ) : node.extension !== "md" ? (
          <span className="explorer-icon">
            <Icon name="file-text" size={14} />
          </span>
        ) : null}
        {isRenaming ? (
          <RenameInput
            initial={label}
            validate={(v) => validateName(node, v)}
            onCommit={(v) => void commitRename(node, v)}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <>
            <span className="explorer-name">{label}</span>
            {!isFolder && node.extension !== "md" && node.extension !== "" && (
              <span className="explorer-ext">{node.extension}</span>
            )}
          </>
        )}
      </div>
    );
  };

  const isEmpty = tree !== null && tree.children.length === 0;

  return (
    <div className="explorer" data-testid="explorer">
      <div className="panel-header">
        <span className="explorer-vault-name" title={app.vault.vaultName}>
          {app.vault.vaultName}
        </span>
        <div className="panel-actions">
          <button
            title={t("explorer.newNote")}
            aria-label={t("explorer.newNote")}
            data-testid="explorer-new-note"
            onClick={() => void newNote()}
          >
            <Icon name="file-plus" size={16} />
          </button>
          <button
            title={t("explorer.newFolder")}
            aria-label={t("explorer.newFolder")}
            data-testid="explorer-new-folder"
            onClick={() => void newFolder()}
          >
            <Icon name="folder-plus" size={16} />
          </button>
          <button
            title={sortKey === "name-asc" ? t("explorer.sortNameAsc") : t("explorer.sortNameDesc")}
            aria-label={t("explorer.sortToggle")}
            data-testid="explorer-sort-toggle"
            onClick={() => setExplorerSort(sortKey === "name-asc" ? "name-desc" : "name-asc")}
          >
            <Icon name="arrow-down-up" size={16} />
          </button>
          <button
            title={anyExpanded ? t("explorer.collapseAll") : t("explorer.expandAll")}
            aria-label={anyExpanded ? t("explorer.collapseAll") : t("explorer.expandAll")}
            data-testid="explorer-collapse-all"
            onClick={collapseOrExpandAll}
          >
            <Icon name={anyExpanded ? "chevron-down" : "chevron-right"} size={16} />
          </button>
        </div>
      </div>

      <div
        ref={treeRef}
        className={`explorer-tree${dropTarget === "" ? " is-drop-root" : ""}`}
        tabIndex={0}
        role="tree"
        onKeyDown={onTreeKeyDown}
        onContextMenu={(e) => {
          // R93: right-click on empty tree area → root New note / New folder menu
          // (rows stopPropagation, so this only fires for genuine empty-area clicks)
          e.preventDefault();
          setSelected(null);
          setMenu({ x: e.clientX, y: e.clientY, node: null });
        }}
        onScroll={virtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
        onDragOver={onTreeDragOver}
        onDrop={onTreeDrop}
        onDragLeave={onTreeDragLeave}
      >
        {tree === null ? (
          <div className="explorer-empty">{t("explorer.noVault")}</div>
        ) : isEmpty ? (
          <div className="explorer-empty" data-testid="explorer-empty">
            <p>{t("explorer.emptyVault")}</p>
            <button className="explorer-empty-btn" onClick={() => void newNote("")}>
              {t("explorer.createFirstNote")}
            </button>
          </div>
        ) : virtual ? (
          (() => {
            // clamp against stale scrollTop (e.g. collapse-all while scrolled deep)
            const maxTop = Math.max(0, rows.length * ROW_HEIGHT - viewportH);
            const top = Math.min(scrollTop, maxTop);
            let start = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
            let end = Math.min(
              rows.length,
              Math.ceil((top + viewportH) / ROW_HEIGHT) + OVERSCAN,
            );
            // pin the renaming row: unmounting RenameInput mid-edit loses the user's input
            if (renaming) {
              const renamingIdx = rows.findIndex((r) => r.node.path === renaming);
              if (renamingIdx !== -1) {
                start = Math.min(start, renamingIdx);
                end = Math.max(end, renamingIdx + 1);
              }
            }
            return (
              <div
                style={{
                  paddingTop: start * ROW_HEIGHT,
                  paddingBottom: (rows.length - end) * ROW_HEIGHT,
                }}
              >
                {rows.slice(start, end).map(renderRow)}
              </div>
            );
          })()
        ) : (
          rows.map(renderRow)
        )}
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="explorer-menu"
          data-testid="explorer-menu"
          style={{
            // R81 two-axis clamp — keep the menu fully on-screen
            left: Math.max(0, Math.min(menu.x, window.innerWidth - 200)),
            top: Math.max(0, Math.min(menu.y, window.innerHeight - 240)),
          }}
        >
          {menu.node === null ? (
            <>
              <button
                data-testid="explorerctx-new-note"
                onClick={() => {
                  setMenu(null);
                  void newNote("");
                }}
              >
                <Icon name="file-plus" size={14} />
                {t("explorer.newNote")}
              </button>
              <button
                data-testid="explorerctx-new-folder"
                onClick={() => {
                  setMenu(null);
                  void newFolder("");
                }}
              >
                <Icon name="folder-plus" size={14} />
                {t("explorer.newFolder")}
              </button>
            </>
          ) : (
            ((node: VaultNode) => (
              <>
                {node.kind === "folder" && (
                  <>
                    <button
                      data-testid="explorerctx-new-note-here"
                      onClick={() => {
                        setMenu(null);
                        void newNote(node.path);
                      }}
                    >
                      <Icon name="file-plus" size={14} />
                      {t("explorer.newNoteHere")}
                    </button>
                    <button
                      data-testid="explorerctx-new-folder-here"
                      onClick={() => {
                        setMenu(null);
                        void newFolder(node.path);
                      }}
                    >
                      <Icon name="folder-plus" size={14} />
                      {t("explorer.newFolderHere")}
                    </button>
                    <div className="explorer-menu-sep" />
                  </>
                )}
                {node.kind === "file" && (
                  <>
                    <button
                      data-testid="explorerctx-open-new-tab"
                      onClick={() => {
                        setMenu(null);
                        openInNewTab(node);
                      }}
                    >
                      <Icon name="external-link" size={14} />
                      {t("explorer.openInNewTab")}
                    </button>
                    <button
                      data-testid="explorerctx-open-right"
                      onClick={() => {
                        setMenu(null);
                        openToRight(node);
                      }}
                    >
                      <Icon name="panel-right" size={14} />
                      {t("explorer.openToRight")}
                    </button>
                    <button
                      data-testid="explorerctx-make-copy"
                      onClick={() => {
                        setMenu(null);
                        void makeCopy(node);
                      }}
                    >
                      <Icon name="copy" size={14} />
                      {t("explorer.makeCopy")}
                    </button>
                    <div className="explorer-menu-sep" />
                  </>
                )}
                <button
                  data-testid="explorerctx-move-to"
                  onClick={() => {
                    setMenu(null);
                    setMovePath(node.path);
                  }}
                >
                  <Icon name="folder-plus" size={14} />
                  {t("explorer.moveTo")}
                </button>
                <button
                  data-testid="explorerctx-rename"
                  onClick={() => {
                    setMenu(null);
                    startRename(node);
                  }}
                >
                  <Icon name="pencil" size={14} />
                  {t("explorer.rename")}
                </button>
                <button
                  className="is-danger"
                  data-testid="explorerctx-delete"
                  onClick={() => {
                    setMenu(null);
                    void deleteNode(node);
                  }}
                >
                  <Icon name="x" size={14} />
                  {t("explorer.delete")}
                </button>
              </>
            ))(menu.node)
          )}
        </div>
      )}

      {/* R97: "Move to…" folder picker (modal overlay; select → vetted moveNode) */}
      {movePath !== null && tree && (
        <MoveToModal
          fromPath={movePath}
          folders={moveTargets(tree, movePath)}
          allowRoot={parentPath(movePath) !== ""}
          onSelect={(target) => {
            const from = movePath;
            setMovePath(null);
            void moveNode(from, target);
          }}
          onClose={() => setMovePath(null)}
        />
      )}
    </div>
  );
}
