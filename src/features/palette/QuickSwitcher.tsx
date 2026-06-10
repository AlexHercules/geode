import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import type { FileNode } from "@core/types";
import { allTabs } from "@core/workspace";
import { fuzzyMatch, toSegments } from "./fuzzy";
import "./palette.css";

type Row =
  | { kind: "create"; name: string }
  | { kind: "file"; file: FileNode; indices: number[] };

/**
 * Hard cap on rendered rows. Fuzzy-scoring 10k files takes ~3ms, but
 * rendering 10k result rows takes 400–800ms per keystroke — the list is
 * keyboard-driven, so anything beyond the top results is never reached.
 */
const MAX_RESULTS = 100;

/** Stash a perf number on window.__geodePerf (dev/bench inspection only). */
function perfMark(key: string, value: number): void {
  const g = globalThis as unknown as { __geodePerf?: Record<string, number> };
  g.__geodePerf = { ...g.__geodePerf, [key]: Math.round(value * 100) / 100 };
}

function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

export function QuickSwitcher() {
  const app = useApp();
  const tree = useStore(app.vault.tree);
  const ws = useStore(app.workspace.state);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // flattening the vault tree is O(files) — do it once per tree change,
  // not on every keystroke
  const files = useMemo(
    () => app.vault.getMarkdownFiles(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app.vault, tree],
  );

  const rows = useMemo<Row[]>(() => {
    const t0 = performance.now();
    try {
      return computeRows();
    } finally {
      perfMark("switcherFilterMs", performance.now() - t0);
    }

    function computeRows(): Row[] {
    const q = query.trim();

    if (!q) {
      // open tab files first (in tab order), then the rest (capped)
      const openPaths: string[] = [];
      for (const tab of allTabs(ws.root)) {
        if (tab.viewType === "markdown" && tab.filePath && !openPaths.includes(tab.filePath)) {
          openPaths.push(tab.filePath);
        }
      }
      const openSet = new Set(openPaths);
      const open = openPaths
        .map((p) => files.find((f) => f.path === p))
        .filter((f): f is FileNode => f !== undefined);
      const out: Row[] = open.map((file) => ({ kind: "file" as const, file, indices: [] }));
      for (const f of files) {
        if (out.length >= MAX_RESULTS) break;
        if (!openSet.has(f.path)) out.push({ kind: "file", file: f, indices: [] });
      }
      return out;
    }

    const matched: Array<{ file: FileNode; score: number; indices: number[] }> = [];
    let exact = false;
    const qLower = q.toLowerCase();
    for (const file of files) {
      const byName = fuzzyMatch(q, file.basename);
      const byPath = fuzzyMatch(q, file.path);
      if (byName && file.basename.toLowerCase() === qLower) exact = true;
      if (!byName && !byPath) continue;
      // basename matches outrank path-only matches
      const nameScore = byName ? byName.score + 200 : -Infinity;
      const pathScore = byPath ? byPath.score : -Infinity;
      matched.push({
        file,
        score: Math.max(nameScore, pathScore),
        indices: byName ? byName.indices : [],
      });
    }
    matched.sort((a, b) => b.score - a.score);
    if (matched.length > MAX_RESULTS) matched.length = MAX_RESULTS;

    const out: Row[] = matched.map(({ file, indices }) => ({ kind: "file", file, indices }));
    if (!exact) out.unshift({ kind: "create", name: q });
    return out;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, query, ws.root]);

  const sel = rows.length === 0 ? -1 : Math.min(selected, rows.length - 1);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(".is-selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [sel, rows]);

  const activate = (row: Row) => {
    if (row.kind === "file") {
      app.workspace.openFile(row.file.path); // openFile also closes the modal
      return;
    }
    const path = app.vault.uniquePath("", row.name);
    app.workspace.closeModal();
    void app.vault.create(path).then(() => app.workspace.openFile(path));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (rows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (Math.min(s, rows.length - 1) + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (Math.min(s, rows.length - 1) - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (sel >= 0) activate(rows[sel]);
    }
  };

  const onOverlayMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) app.workspace.closeModal();
  };

  return (
    <div className="modal-overlay" onMouseDown={onOverlayMouseDown} data-testid="quick-switcher">
      <div className="modal-panel" role="dialog" aria-label="Quick switcher">
        <div className="palette-input-wrap">
          <input
            className="palette-input"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Find or create a note…"
            spellCheck={false}
            data-testid="switcher-input"
          />
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {rows.length === 0 ? (
            <div className="palette-empty">No notes in vault</div>
          ) : (
            rows.map((row, i) => {
              const isSel = i === sel;
              if (row.kind === "create") {
                return (
                  <div
                    key="__create__"
                    className={`palette-item palette-create${isSel ? " is-selected" : ""}`}
                    role="option"
                    aria-selected={isSel}
                    onMouseMove={() => setSelected(i)}
                    onClick={() => activate(row)}
                    data-testid="switcher-item"
                  >
                    <span className="palette-item-icon">
                      <Icon name="file-plus" size={15} />
                    </span>
                    <span className="palette-create-name">
                      Create note: <b>{row.name}</b>
                    </span>
                    <span className="palette-hotkey">Enter</span>
                  </div>
                );
              }
              const folder = folderOf(row.file.path);
              return (
                <div
                  key={row.file.path}
                  className={`palette-item${isSel ? " is-selected" : ""}`}
                  role="option"
                  aria-selected={isSel}
                  onMouseMove={() => setSelected(i)}
                  onClick={() => activate(row)}
                  data-testid="switcher-item"
                >
                  <span className="palette-item-name">
                    {toSegments(row.file.basename, row.indices).map((seg, j) =>
                      seg.hit ? (
                        <span key={j} className="fz-hit">
                          {seg.text}
                        </span>
                      ) : (
                        <span key={j}>{seg.text}</span>
                      ),
                    )}
                  </span>
                  {folder && (
                    <span className="palette-path" title={folder}>
                      {folder}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
