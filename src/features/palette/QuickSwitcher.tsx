import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import type { FileNode } from "@core/types";
import { fuzzyMatch, toSegments } from "./fuzzy";
import "./palette.css";

type Row =
  | { kind: "create"; name: string }
  | { kind: "file"; file: FileNode; indices: number[] };

function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

export function QuickSwitcher() {
  const app = useApp();
  useStore(app.vault.tree);
  const ws = useStore(app.workspace.state);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo<Row[]>(() => {
    const files = app.vault.getMarkdownFiles();
    const q = query.trim();

    if (!q) {
      // open tab files first (in tab order), then the rest
      const openPaths: string[] = [];
      for (const tab of ws.tabs) {
        if (tab.viewType === "markdown" && tab.filePath && !openPaths.includes(tab.filePath)) {
          openPaths.push(tab.filePath);
        }
      }
      const openSet = new Set(openPaths);
      const open = openPaths
        .map((p) => files.find((f) => f.path === p))
        .filter((f): f is FileNode => f !== undefined);
      const rest = files.filter((f) => !openSet.has(f.path));
      return [...open, ...rest].map((file) => ({ kind: "file" as const, file, indices: [] }));
    }

    const matched: Array<{ file: FileNode; score: number; indices: number[] }> = [];
    for (const file of files) {
      const byName = fuzzyMatch(q, file.basename);
      const byPath = fuzzyMatch(q, file.path);
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

    const out: Row[] = matched.map(({ file, indices }) => ({ kind: "file", file, indices }));
    const exact = files.some((f) => f.basename.toLowerCase() === q.toLowerCase());
    if (!exact) out.unshift({ kind: "create", name: q });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.vault, query, ws.tabs]);

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
