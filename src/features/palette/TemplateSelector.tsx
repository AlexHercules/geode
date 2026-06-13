import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useApp } from "@app/AppContext";
import { useStore } from "@core/store";
import { useI18n } from "@core/i18n";
import {
  expandTemplate,
  listTemplates,
  templatePickerMode,
  type TemplateInfo,
} from "@core/templates";
import { fuzzyMatch, toSegments } from "@core/fuzzy";
import "./palette.css";

/**
 * Template selector modal (R23) — QuickSwitcher-shaped picker for the
 * Templates feature. Two modes (read once on mount, one-shot semantics):
 *   "insert" — expand the chosen template at the active editor's selection
 *   "create" — create a new note at the vault root from the template
 */

interface Row {
  template: TemplateInfo;
  /** matched character indices in the template NAME (for highlighting) */
  indices: number[];
}

function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

/** basename of a vault path without its extension ("a/Meeting 1.md" → "Meeting 1") */
function titleFromPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export function TemplateSelector() {
  const app = useApp();
  const t = useI18n();
  const tree = useStore(app.vault.tree); // re-enumerate templates on vault change
  /* one-shot semantics (contract): the command sets the mode right BEFORE
     opening the modal — read it once on mount */
  const [mode] = useState<"insert" | "create">(() => templatePickerMode.get());
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** re-entry guard: a pick is in flight (vault.read is a real IPC round-trip
   *  on desktop) — double Enter / double-click must not insert twice or create
   *  a duplicate note (R23 review DS-2). The modal closes in finally, so the
   *  flag never needs resetting. */
  const busyRef = useRef(false);

  /* null = template folder not configured / invalid; [] = no templates */
  const templates = useMemo(
    () => listTemplates(app.vault),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app.vault, tree],
  );

  const rows = useMemo<Row[]>(() => {
    if (templates === null) return [];
    const q = query.trim();
    if (!q) return templates.map((template) => ({ template, indices: [] }));
    const matched: Array<Row & { score: number }> = [];
    for (const template of templates) {
      const byName = fuzzyMatch(q, template.name);
      const byPath = fuzzyMatch(q, template.path);
      if (!byName && !byPath) continue;
      // name matches outrank path-only matches (QuickSwitcher scoring)
      const nameScore = byName ? byName.score + 200 : -Infinity;
      const pathScore = byPath ? byPath.score : -Infinity;
      matched.push({
        template,
        score: Math.max(nameScore, pathScore),
        indices: byName ? byName.indices : [],
      });
    }
    matched.sort((a, b) => b.score - a.score);
    return matched;
  }, [templates, query]);

  const sel = rows.length === 0 ? -1 : Math.min(selected, rows.length - 1);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(".is-selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [sel, rows]);

  const activate = (template: TemplateInfo) => {
    if (busyRef.current) return;
    busyRef.current = true;
    if (mode === "insert") {
      const active = app.documents.getActiveView();
      if (active === null) {
        // extreme race: the editor view vanished while the modal was open —
        // close with zero writes (contract)
        console.warn("[templates] no active editor view — nothing inserted");
        app.workspace.closeModal();
        return;
      }
      const { view, path } = active;
      const title = titleFromPath(path);
      void (async () => {
        try {
          const content = await app.vault.read(template.path);
          // the editor may have been torn down during the read (Ctrl+W passes
          // through the modal) — dispatching into a destroyed view is a silent
          // no-op, so degrade loudly instead (R23 review LIFE-3)
          if (app.documents.getActiveView()?.view !== view) {
            console.warn("[templates] editor view changed during template read — nothing inserted");
            return;
          }
          const insert = expandTemplate(content, { title, now: new Date() });
          const main = view.state.selection.main;
          // non-empty selection = replace it (superset of "insert at cursor");
          // single transaction → one undo step, dirty+debounced-save as usual
          view.dispatch({
            changes: { from: main.from, to: main.to, insert },
            selection: { anchor: main.from + insert.length },
          });
        } catch (err) {
          console.error("[templates] insert template failed", err);
        } finally {
          app.workspace.closeModal();
        }
      })();
      return;
    }
    // create mode: new note at the vault root, named after the template;
    // uniquePath never overwrites an existing file
    let path = app.vault.uniquePath("", template.name);
    // case-insensitive collision layer on top (R17 attachments precedent):
    // macOS/Windows filesystems are case-insensitive — "readme.md" colliding
    // with an existing "README.md" passes uniquePath but is rejected on disk
    // (R23 review DS-3)
    const lower = new Set(app.vault.getFiles().map((f) => f.path.toLowerCase()));
    if (lower.has(path.toLowerCase())) {
      let n = 1;
      while (lower.has(`${template.name} ${n}.md`.toLowerCase())) n++;
      path = `${template.name} ${n}.md`;
    }
    // title reflects the ACTUAL unique path ("Meeting 1", not "Meeting")
    const title = titleFromPath(path);
    void (async () => {
      try {
        const content = await app.vault.read(template.path);
        const expanded = expandTemplate(content, { title, now: new Date() });
        await app.vault.create(path, expanded);
        app.workspace.openFile(path);
      } catch (err) {
        console.error("[templates] new note from template failed", err);
      } finally {
        app.workspace.closeModal();
      }
    })();
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
      if (sel >= 0) activate(rows[sel].template);
    }
  };

  const onOverlayMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) app.workspace.closeModal();
  };

  const hint =
    templates === null
      ? t("templates.notConfigured")
      : templates.length === 0
        ? t("templates.empty")
        : rows.length === 0
          ? t("templates.noMatch")
          : null;

  return (
    <div className="modal-overlay" onMouseDown={onOverlayMouseDown} data-testid="template-selector">
      <div className="modal-panel" role="dialog" aria-label={t("templates.aria")}>
        <div className="palette-input-wrap">
          <input
            className="palette-input"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("templates.placeholder")}
            spellCheck={false}
            data-testid="template-selector-input"
          />
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {hint !== null ? (
            <div className="palette-empty" data-testid="template-selector-hint">
              {hint}
            </div>
          ) : (
            rows.map((row, i) => {
              const isSel = i === sel;
              const folder = folderOf(row.template.path);
              return (
                <div
                  key={row.template.path}
                  className={`palette-item${isSel ? " is-selected" : ""}`}
                  role="option"
                  aria-selected={isSel}
                  onMouseMove={() => setSelected(i)}
                  onClick={() => activate(row.template)}
                  data-testid="template-option"
                  data-path={row.template.path}
                >
                  <span className="palette-item-name">
                    {toSegments(row.template.name, row.indices).map((seg, j) =>
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
