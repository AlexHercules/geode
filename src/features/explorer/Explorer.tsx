import { useEffect, useMemo, useRef, useState } from "react";
import type { FolderNode, VaultNode } from "@core/types";
import { isTauri, parentPath } from "@core/vault";
import { useStore } from "@core/store";
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
  node: VaultNode;
}

/* ---------------- pure helpers ---------------- */

function flattenVisible(root: FolderNode, expanded: Set<string>): Row[] {
  const rows: Row[] = [];
  const walk = (folder: FolderNode, depth: number) => {
    for (const child of folder.children) {
      rows.push({ node: child, depth });
      if (child.kind === "folder" && expanded.has(child.path)) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

function findFolder(root: FolderNode, path: string): FolderNode | null {
  if (path === "") return root;
  const walk = (folder: FolderNode): FolderNode | null => {
    for (const child of folder.children) {
      if (child.kind !== "folder") continue;
      if (child.path === path) return child;
      if (path.startsWith(child.path + "/")) return walk(child);
    }
    return null;
  };
  return walk(root);
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

  const treeRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => (tree ? flattenVisible(tree, expanded) : []), [tree, expanded]);
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
    const what =
      node.kind === "folder" ? `folder "${node.name}" and all its contents` : `"${node.name}"`;
    const message = `Delete ${what}?`;
    let ok: boolean;
    if (isTauri()) {
      // window.confirm is unreliable in wry webviews — use the native dialog
      const { ask } = await import("@tauri-apps/plugin-dialog");
      ok = await ask(message, { title: "Delete", kind: "warning" });
    } else {
      ok = window.confirm(message);
    }
    if (!ok) return;
    try {
      await app.vault.remove(node.path);
    } catch (err) {
      console.error("[explorer] delete failed", err);
      return;
    }
    if (selected === node.path) setSelected(null);
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
      await app.vault.rename(node.path, newPath);
    } catch (err) {
      console.error("[explorer] rename failed", err);
      return;
    }
    if (node.kind === "folder") setExpanded((prev) => remapPaths(prev, node.path, newPath));
    setSelected(newPath);
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
    const label = isFolder ? node.name : node.basename;

    return (
      <div
        key={node.path}
        className={`explorer-item${isActive ? " is-active" : ""}${isSelected ? " is-selected" : ""}`}
        data-testid="explorer-item"
        data-path={node.path}
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={() => {
          if (!isRenaming) activateNode(node);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
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
            title="New note"
            aria-label="New note"
            data-testid="explorer-new-note"
            onClick={() => void newNote()}
          >
            <Icon name="file-plus" size={16} />
          </button>
          <button
            title="New folder"
            aria-label="New folder"
            data-testid="explorer-new-folder"
            onClick={() => void newFolder()}
          >
            <Icon name="folder-plus" size={16} />
          </button>
          <button
            title={anyExpanded ? "Collapse all" : "Expand all"}
            aria-label={anyExpanded ? "Collapse all" : "Expand all"}
            data-testid="explorer-collapse-all"
            onClick={collapseOrExpandAll}
          >
            <Icon name={anyExpanded ? "chevron-down" : "chevron-right"} size={16} />
          </button>
        </div>
      </div>

      <div
        ref={treeRef}
        className="explorer-tree"
        tabIndex={0}
        role="tree"
        onKeyDown={onTreeKeyDown}
        onScroll={virtual ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
      >
        {tree === null ? (
          <div className="explorer-empty">No vault open</div>
        ) : isEmpty ? (
          <div className="explorer-empty" data-testid="explorer-empty">
            <p>This vault is empty.</p>
            <button className="explorer-empty-btn" onClick={() => void newNote("")}>
              Create your first note
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
            left: Math.min(menu.x, window.innerWidth - 190),
            top: Math.min(menu.y, window.innerHeight - 170),
          }}
        >
          {menu.node.kind === "folder" && (
            <>
              <button
                onClick={() => {
                  setMenu(null);
                  void newNote(menu.node.path);
                }}
              >
                <Icon name="file-plus" size={14} />
                New note here
              </button>
              <button
                onClick={() => {
                  setMenu(null);
                  void newFolder(menu.node.path);
                }}
              >
                <Icon name="folder-plus" size={14} />
                New folder here
              </button>
              <div className="explorer-menu-sep" />
            </>
          )}
          <button
            onClick={() => {
              setMenu(null);
              startRename(menu.node);
            }}
          >
            <Icon name="pencil" size={14} />
            Rename
          </button>
          <button
            className="is-danger"
            onClick={() => {
              setMenu(null);
              void deleteNode(menu.node);
            }}
          >
            <Icon name="x" size={14} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
