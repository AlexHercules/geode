import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import { useI18n } from "@core/i18n";
import type { FileNode, HeadingRef, BlockRef } from "@core/types";
import { allTabs } from "@core/workspace";
import { fuzzyMatch, toSegments } from "@core/fuzzy";
import { searchHeadings, searchBlocks, switcherMode, stripSigil } from "@core/switcherSearch";
import { mergeTargetMode, mergeNotes } from "@core/noteMerge";
import "./palette.css";

type Row =
  | { kind: "create"; name: string }
  | { kind: "file"; file: FileNode; indices: number[] }
  | { kind: "heading"; path: string; heading: HeadingRef; indices: number[] }
  | { kind: "block"; path: string; block: BlockRef; indices: number[] };

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

/** Transient DOM toast for merge outcomes (skipped links / failure). Mirrors
 *  Explorer's showLinkUpdateNotice (same `.link-update-notice` style) so a merge
 *  never fails or drops links silently (R47 review). */
function showMergeNotice(message: string): void {
  document.querySelector(".link-update-notice")?.remove();
  const el = document.createElement("div");
  el.className = "link-update-notice";
  el.textContent = message;
  el.setAttribute("data-testid", "merge-notice");
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 4000);
}

export function QuickSwitcher() {
  const app = useApp();
  const t = useI18n();
  const tree = useStore(app.vault.tree);
  const ws = useStore(app.workspace.state);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // R47 merge mode: the "merge current file with…" command sets mergeTargetMode
  // (the source path) and opens this switcher. Snapshot the source on MOUNT and
  // clear the store in an effect (NOT in the useState initializer — StrictMode
  // double-invokes it in dev, where the 2nd read would see null and lose the
  // merge intent). Clearing on mount = consume-once: a cancelled pick (Escape)
  // never leaks into the next plain switcher open (revealTarget precedent).
  const [mergeSource] = useState<string | null>(() => mergeTargetMode.get());
  useEffect(() => {
    mergeTargetMode.set(null);
  }, []);

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
    const mode = switcherMode(query);
    if (mode === "heading") {
      return searchHeadings(app.metadata.getAll(), stripSigil(query), app.workspace.getActiveFile()).map(
        (h) => ({ kind: "heading" as const, path: h.path, heading: h.heading, indices: h.indices }),
      );
    }
    if (mode === "block") {
      return searchBlocks(app.metadata.getAll(), stripSigil(query), app.workspace.getActiveFile()).map(
        (b) => ({ kind: "block" as const, path: b.path, block: b.block, indices: b.indices }),
      );
    }
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
    // R47 merge mode: a file pick (other than the source itself) merges the
    // source INTO the picked file, then opens the survivor. Self-pick falls
    // through to the plain openFile branch (no-op merge).
    if (mergeSource !== null && row.kind === "file" && row.file.path !== mergeSource) {
      const target = row.file.path;
      app.workspace.closeModal();
      void mergeNotes(
        { vault: app.vault, metadata: app.metadata, documents: app.documents },
        mergeSource,
        target,
      )
        .then((result) => {
          app.workspace.openFile(target);
          // a skipped referrer keeps its [[source]] link, now dangling (source
          // trashed) — surface it like Explorer's rename path does (R47 review).
          if (result && result.skipped.length > 0) {
            showMergeNotice(t("switcher.mergeLinksSkipped", { count: result.skipped.length }));
          }
        })
        .catch((err) => {
          // modify/read/trash failed — never silently swallow on a merge (R47 review).
          console.error("[merge] failed", err);
          showMergeNotice(t("switcher.mergeFailed"));
        });
      return;
    }
    if (row.kind === "file") {
      app.workspace.openFile(row.file.path); // openFile also closes the modal
      return;
    }
    if (row.kind === "heading") {
      app.workspace.openFile(row.path); // closes modal (modal:null), then reveal
      // reveal anchors on `from` (the flash + scroll ignore `to`); the exact
      // heading-line length isn't reconstructable from HeadingRef, so anchor at
      // the heading start rather than fabricate an imprecise span (R38 review).
      app.workspace.requestReveal(row.path, row.heading.from, row.heading.from);
      return;
    }
    if (row.kind === "block") {
      app.workspace.openFile(row.path);
      app.workspace.requestReveal(row.path, row.block.from, row.block.to);
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

  const mode = switcherMode(query);
  const placeholder =
    mergeSource !== null ? t("switcher.placeholderMerge")
    : mode === "heading" ? t("switcher.placeholderHeading")
    : mode === "block" ? t("switcher.placeholderBlock")
    : t("switcher.placeholder");
  const emptyText =
    mode === "heading" ? t("switcher.emptyHeading")
    : mode === "block" ? t("switcher.emptyBlock")
    : t("switcher.empty");

  return (
    <div className="modal-overlay" onMouseDown={onOverlayMouseDown} data-testid="quick-switcher">
      <div className="modal-panel" role="dialog" aria-label={t("switcher.aria")}>
        <div className="palette-input-wrap">
          <input
            className="palette-input"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            spellCheck={false}
            data-testid="switcher-input"
          />
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {rows.length === 0 ? (
            <div className="palette-empty">{emptyText}</div>
          ) : (
            rows.map((row, i) => {
              const isSel = i === sel;
              if (row.kind === "create") {
                // dict shape is "Create note: {name}" — keep the literal
                // placeholder and split on it so the name keeps its <b>
                const [before, after] = t("switcher.create", { name: "{name}" }).split("{name}");
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
                      {before}
                      <b>{row.name}</b>
                      {after}
                    </span>
                    <span className="palette-hotkey">Enter</span>
                  </div>
                );
              }
              if (row.kind === "heading") {
                const base = (row.path.replace(/\.md$/, "").split("/").pop()) ?? row.path;
                return (
                  <div
                    key={`h:${row.path}:${row.heading.from}`}
                    className={`palette-item${isSel ? " is-selected" : ""}`}
                    role="option"
                    aria-selected={isSel}
                    onMouseMove={() => setSelected(i)}
                    onClick={() => activate(row)}
                    data-testid="switcher-item"
                  >
                    <span className="palette-item-icon"><Icon name="hash" size={14} /></span>
                    <span className="palette-item-name">
                      {toSegments(row.heading.text, row.indices).map((seg, j) =>
                        seg.hit ? <span key={j} className="fz-hit">{seg.text}</span> : <span key={j}>{seg.text}</span>,
                      )}
                    </span>
                    <span className="palette-path" title={base}>{base}</span>
                  </div>
                );
              }
              if (row.kind === "block") {
                const base = (row.path.replace(/\.md$/, "").split("/").pop()) ?? row.path;
                return (
                  <div
                    key={`b:${row.path}:${row.block.id}`}
                    className={`palette-item${isSel ? " is-selected" : ""}`}
                    role="option"
                    aria-selected={isSel}
                    onMouseMove={() => setSelected(i)}
                    onClick={() => activate(row)}
                    data-testid="switcher-item"
                  >
                    <span className="palette-item-icon"><Icon name="link" size={14} /></span>
                    <span className="palette-item-name">
                      <span className="palette-block-id">^</span>
                      {toSegments(row.block.id, row.indices).map((seg, j) =>
                        seg.hit ? <span key={j} className="fz-hit">{seg.text}</span> : <span key={j}>{seg.text}</span>,
                      )}
                    </span>
                    <span className="palette-path" title={base}>{base}</span>
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
