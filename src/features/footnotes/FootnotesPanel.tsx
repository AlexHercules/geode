import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@app/AppContext";
import { useStore } from "@core/store";
import { useI18n } from "@core/i18n";
import { findActiveTab } from "@core/workspace";
import { parseFootnoteDefinitions } from "@core/metadata";
import type { DocumentHandle } from "@core/documents";
import "./footnotes.css";

/**
 * Footnotes pane (R65, ㉘) — Obsidian 1.9's "Footnotes view" core plugin: a
 * dedicated right-sidebar tab listing the active note's `[^id]: content`
 * definitions. R223: matches native "Click a footnote to edit its text" — the
 * `^id` marker navigates (scrolls the editor to the definition), the content is
 * click-to-edit inline. Edits go through the shared `DocumentHandle` (R86 second-
 * writer: acquire/release + applyExternalEdits) so a live CM view stays in sync and
 * undo/dirty/save route correctly. Footnotes are parsed from the handle's LIVE text
 * (not the lagging metadata index) so edit offsets are never stale.
 */
export function FootnotesPanel() {
  const app = useApp();
  const t = useI18n();
  const ws = useStore(app.workspace.state);

  // R213: non-markdown active tab (graph or a main-area aux view) → follow the last active
  // markdown file so the panel stays populated, aligned with backlinks/outgoing/outline.
  const lastActive = useStore(app.workspace.lastActiveFile);
  const activeTab = findActiveTab(ws);
  const activePath = activeTab?.viewType === "markdown" ? activeTab.filePath : lastActive;

  // R223: acquire the shared handle for the active file (refcounted; release on change),
  // mirroring FilePropertiesPanel — we are now an editable second writer.
  const [handle, setHandle] = useState<DocumentHandle | null>(null);
  const [docRevision, setDocRevision] = useState(0);
  // which footnote (document-order index) is being edited inline + its draft text
  const [editing, setEditing] = useState<{ index: number; id: string; draft: string } | null>(null);

  useEffect(() => {
    if (!handle) return;
    setDocRevision(handle.revision.get());
    return handle.revision.subscribe(() => setDocRevision(handle.revision.get()));
  }, [handle]);

  useEffect(() => {
    setEditing(null); // a file switch must abandon any in-progress edit
    if (!activePath) {
      setHandle(null);
      return;
    }
    let cancelled = false;
    let acquired: DocumentHandle | null = null;
    void app.documents.acquire(activePath).then(
      (h) => {
        if (cancelled) { h.release(); return; }
        acquired = h;
        setHandle(h);
      },
      () => { if (!cancelled) setHandle(null); },
    );
    return () => {
      cancelled = true;
      acquired?.release();
    };
  }, [app, activePath]);

  const ready = handle !== null && handle.path === activePath;
  const footnotes = useMemo(() => {
    void docRevision; // re-parse whenever the live document changes
    return ready ? parseFootnoteDefinitions(handle.getText()) : [];
  }, [ready, handle, docRevision]);

  const jumpTo = (from: number) => {
    if (!activePath) return;
    app.workspace.openFile(activePath);
    // rAF: if openFile just (re)mounted the editor, let it mount before jumping
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("geode:scroll-to-heading", { detail: { path: activePath, from } }),
      );
    });
  };

  const commitEdit = () => {
    const ed = editing;
    setEditing(null);
    if (!ed || !handle) return;
    // re-parse the LIVE text: positions may have shifted since edit start (the note may
    // also be open in the editor). Identify the target by document-order index AND id —
    // if the list reshuffled out from under us, abort rather than write the wrong def.
    const fresh = parseFootnoteDefinitions(handle.getText());
    const target = fresh[ed.index];
    if (!target || target.id !== ed.id) return; // stale → fail-safe, no write
    const draft = ed.draft.trim();
    if (draft === target.content) return; // no-op
    handle.applyExternalEdits([
      { from: target.from, to: target.to, insert: `[^${target.id}]: ${draft}`.trimEnd() },
    ]);
  };

  return (
    <div className="footnotes-panel" data-testid="footnotes-panel">
      <div className="panel-header">
        <span>{t("footnotes.title")}</span>
        {activePath !== null && (
          <span className="fn-count" data-testid="fn-count">
            {footnotes.length}
          </span>
        )}
      </div>

      {!activePath ? (
        <div className="fn-empty" data-testid="fn-empty">
          {t("footnotes.empty")}
        </div>
      ) : !ready ? (
        <div className="fn-empty" data-testid="fn-loading">
          {t("footnotes.loading")}
        </div>
      ) : footnotes.length === 0 ? (
        <div className="fn-empty" data-testid="fn-empty">
          {t("footnotes.noFootnotes")}
        </div>
      ) : (
        <div className="fn-scroll">
          {footnotes.map((fn, i) => (
            <div
              // id is not unique (duplicate defs keep both) — pair with index
              key={`${i}:${fn.id}`}
              className="fn-item"
              data-testid="fn-item"
              data-from={fn.from}
            >
              <button
                className="fn-marker"
                data-testid="fn-marker"
                aria-label={t("footnotes.jumpAria", { id: fn.id })}
                title={t("footnotes.jumpAria", { id: fn.id })}
                onClick={() => jumpTo(fn.from)}
              >
                ^{fn.id}
              </button>
              {editing?.index === i ? (
                <FootnoteEdit
                  value={editing.draft}
                  ariaLabel={t("footnotes.editAria", { id: fn.id })}
                  onChange={(draft) => setEditing({ index: i, id: fn.id, draft })}
                  onCommit={commitEdit}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <button
                  className="fn-content"
                  data-testid="fn-content"
                  title={t("footnotes.editAria", { id: fn.id })}
                  onClick={() => setEditing({ index: i, id: fn.id, draft: fn.content })}
                >
                  {fn.content || t("footnotes.editPlaceholder")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Inline single-line editor for one footnote's text. Enter/blur commit, Escape cancels.
 *  Single-line by construction — Enter commits, so a newline can never split the def. */
function FootnoteEdit({
  value,
  ariaLabel,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  ariaLabel: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="fn-content fn-edit"
      data-testid="fn-edit-input"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    />
  );
}
