import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { TabState } from "@core/types";
import { useStore } from "@core/store";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { buildEditorExtensions, refreshWikilinks } from "./cmExtensions";
import { renderPreview, toggleTaskOnLine } from "./preview";
import { openWikilink } from "./wikilinks";
import "./editor.css";

const SAVE_DEBOUNCE_MS = 600;

interface SaveState {
  path: string | null;
  dirty: boolean;
  timer: number | null;
}

/**
 * EditorPane — markdown editing (CodeMirror 6) + reading view for one tab.
 * The same component instance can be re-pointed at another file (tab id is
 * reused), so pending saves are flushed before every file switch and unmount.
 */
export function EditorPane({ tab }: { tab: TabState }) {
  const app = useApp();
  const metaRevision = useStore(app.metadata.revision);

  /** path whose content is currently loaded into textRef */
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** bumped when preview mutates the source (task checkbox toggles) */
  const [previewBump, setPreviewBump] = useState(0);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** latest document text for the loaded file */
  const textRef = useRef("");
  const saveRef = useRef<SaveState>({ path: null, dirty: false, timer: null });

  /* ---------- auto-save ---------- */

  const flushSave = useCallback(() => {
    const s = saveRef.current;
    if (s.timer !== null) {
      window.clearTimeout(s.timer);
      s.timer = null;
    }
    if (s.dirty && s.path) {
      s.dirty = false;
      void app.vault.modify(s.path, textRef.current).catch((err) => {
        console.error(`[editor] failed to save ${s.path}`, err);
      });
    }
  }, [app]);

  const handleDocChanged = useCallback(
    (text: string) => {
      textRef.current = text;
      const s = saveRef.current;
      s.dirty = true;
      if (s.timer !== null) window.clearTimeout(s.timer);
      s.timer = window.setTimeout(() => {
        s.timer = null;
        flushSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  /* ---------- load file content (filePath can change in-place) ---------- */

  useEffect(() => {
    // flush whatever the previous file still had pending
    flushSave();
    setLoadedPath(null);
    setLoadError(null);
    const path = tab.filePath;
    saveRef.current = { path, dirty: false, timer: null };
    if (!path) return;
    let cancelled = false;
    void app.vault.read(path).then(
      (text) => {
        if (cancelled) return;
        textRef.current = text;
        setLoadedPath(path);
      },
      (err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [app, flushSave, tab.filePath]);

  /* ---------- CodeMirror lifecycle (edit mode) ---------- */

  useEffect(() => {
    if (tab.mode !== "edit" || !loadedPath || !hostRef.current) return;
    const state = EditorState.create({
      doc: textRef.current,
      extensions: buildEditorExtensions({ app, path: loadedPath, onDocChanged: handleDocChanged }),
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    view.focus();
    // re-evaluate wikilink resolution whenever the metadata index changes
    const unsubscribe = app.metadata.revision.subscribe(() => {
      view.dispatch({ effects: refreshWikilinks.of(null) });
    });
    return () => {
      unsubscribe();
      flushSave();
      viewRef.current = null;
      view.destroy();
    };
  }, [app, tab.mode, loadedPath, handleDocChanged, flushSave]);

  /* ---------- preview rendering + interactions ---------- */

  const previewHtml = useMemo(() => {
    if (tab.mode !== "preview" || !loadedPath) return "";
    return renderPreview(textRef.current, (target) => app.metadata.resolveLink(target, loadedPath));
    // metaRevision/previewBump are render triggers, not direct inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, tab.mode, loadedPath, metaRevision, previewBump]);

  const onPreviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (!el || !loadedPath) return;

      const checkbox = el.closest<HTMLInputElement>("input.task-checkbox");
      if (checkbox) {
        e.preventDefault();
        const line = Number(checkbox.dataset.line);
        const next = toggleTaskOnLine(textRef.current, line);
        if (next !== null) {
          textRef.current = next;
          saveRef.current.dirty = false;
          void app.vault.modify(loadedPath, next).catch((err) => {
            console.error(`[editor] failed to save task toggle in ${loadedPath}`, err);
          });
          setPreviewBump((b) => b + 1);
        }
        return;
      }

      const internal = el.closest<HTMLAnchorElement>("a.internal-link");
      if (internal) {
        e.preventDefault();
        const target = internal.dataset.target;
        if (target) void openWikilink(app, target, loadedPath);
        return;
      }

      const anchor = el.closest<HTMLAnchorElement>("a[href]");
      if (anchor) {
        const href = anchor.getAttribute("href") ?? "";
        if (!/^https?:/i.test(href)) e.preventDefault();
      }
    },
    [app, loadedPath],
  );

  /* ---------- chrome ---------- */

  const toggleMode = useCallback(() => {
    app.workspace.setTabMode(tab.id, tab.mode === "edit" ? "preview" : "edit");
  }, [app, tab.id, tab.mode]);

  let body: React.ReactNode;
  if (!tab.filePath) {
    body = (
      <div className="editor-empty" data-testid="editor-empty">
        <div>No file is open</div>
      </div>
    );
  } else if (loadError) {
    body = (
      <div className="editor-error" data-testid="editor-error">
        <Icon name="file-text" size={28} />
        <div className="editor-error-title">Couldn&apos;t open “{tab.title}”</div>
        <div className="editor-error-detail">{loadError}</div>
      </div>
    );
  } else if (!loadedPath) {
    body = (
      <div className="editor-loading" aria-hidden="true">
        <div className="editor-skeleton-line is-title" />
        <div className="editor-skeleton-line" />
        <div className="editor-skeleton-line is-short" />
      </div>
    );
  } else if (tab.mode === "edit") {
    body = <div className="editor-cm-host" data-testid="cm-editor" ref={hostRef} />;
  } else {
    body = (
      <div className="editor-preview" onClick={onPreviewClick}>
        <div
          className="preview-content"
          data-testid="preview"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>
    );
  }

  return (
    <div className="editor-pane" data-testid="editor-pane">
      <div className="editor-header">
        <div className="editor-title" title={tab.filePath ?? undefined}>
          {tab.title}
        </div>
        <div className="editor-header-spacer" />
        <button
          className="editor-mode-btn"
          data-testid="mode-toggle"
          title="Toggle edit/reading view (Ctrl+E)"
          aria-label="Toggle edit/reading view"
          onClick={toggleMode}
        >
          <Icon name={tab.mode === "edit" ? "book-open" : "pencil"} size={16} />
        </button>
      </div>
      {body}
    </div>
  );
}
