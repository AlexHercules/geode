import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { TabState, ViewMode } from "@core/types";
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
  const [loadedPath, setLoadedPathState] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** bumped when preview mutates the source (task checkbox toggles) */
  const [previewBump, setPreviewBump] = useState(0);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** latest document text for the loaded file */
  const textRef = useRef("");
  const saveRef = useRef<SaveState>({ path: null, dirty: false, timer: null });
  /** ref mirror of loadedPath so event handlers can compare outside render */
  const loadedPathRef = useRef<string | null>(null);
  /** true while we replace the doc from disk — suppresses the dirty/save cycle */
  const externalReloadRef = useRef(false);

  const setLoadedPath = useCallback((path: string | null) => {
    loadedPathRef.current = path;
    setLoadedPathState(path);
  }, []);

  /* ---------- auto-save ---------- */

  /** Flush any pending edit. Returns the write promise so callers can await IPC. */
  const flushSave = useCallback((): Promise<void> => {
    const s = saveRef.current;
    if (s.timer !== null) {
      window.clearTimeout(s.timer);
      s.timer = null;
    }
    if (s.dirty && s.path) {
      s.dirty = false;
      // never resurrect a file that was deleted while the edit was pending
      if (!app.vault.fileExists(s.path)) return Promise.resolve();
      const path = s.path;
      return app.vault.modify(path, textRef.current).catch((err) => {
        console.error(`[editor] failed to save ${path}`, err);
      });
    }
    return Promise.resolve();
  }, [app]);

  const handleDocChanged = useCallback(
    (text: string) => {
      textRef.current = text;
      if (externalReloadRef.current) return; // disk → editor sync, nothing to save
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

  /* ---------- vault events: keep pending saves pointed at the live file ---------- */

  useEffect(() => {
    const remap = (path: string | null, oldPath: string, newPath: string): string | null => {
      if (path === oldPath) return newPath;
      if (path && path.startsWith(oldPath + "/")) return newPath + path.slice(oldPath.length);
      return path;
    };
    const offRenamed = app.events.on("file:renamed", ({ oldPath, newPath }) => {
      // retarget the pending save to the new path WITHOUT touching textRef/dirty,
      // so in-flight edits land in the renamed file instead of the old path
      const s = saveRef.current;
      const nextSavePath = remap(s.path, oldPath, newPath);
      if (nextSavePath !== s.path) s.path = nextSavePath;
      const nextLoaded = remap(loadedPathRef.current, oldPath, newPath);
      if (nextLoaded !== loadedPathRef.current) setLoadedPath(nextLoaded);
    });
    const offDeleted = app.events.on("file:deleted", ({ path }) => {
      const s = saveRef.current;
      if (s.path && (s.path === path || s.path.startsWith(path + "/"))) {
        if (s.timer !== null) {
          window.clearTimeout(s.timer);
          s.timer = null;
        }
        s.dirty = false;
      }
    });
    return () => {
      offRenamed();
      offDeleted();
    };
  }, [app, setLoadedPath]);

  /* ---------- external changes (file watcher) ---------- */

  useEffect(() => {
    return app.events.on("file:external-modified", ({ path }) => {
      if (path !== loadedPathRef.current) return;
      const s = saveRef.current;
      if (s.dirty || s.timer !== null) {
        // local edits pending — last writer wins, our save will overwrite
        console.warn(`[editor] external change to "${path}" ignored: unsaved local edits`);
        return;
      }
      void app.vault.read(path).then(
        (text) => {
          if (path !== loadedPathRef.current) return;
          if (text === textRef.current) return; // our own write echoed back
          const view = viewRef.current;
          if (view) {
            const head = Math.min(view.state.selection.main.head, text.length);
            externalReloadRef.current = true;
            try {
              view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: text },
                selection: { anchor: head },
              });
            } finally {
              externalReloadRef.current = false;
            }
          } else {
            textRef.current = text;
          }
          setPreviewBump((b) => b + 1); // reading view re-renders from textRef
        },
        (err: unknown) => {
          console.error(`[editor] failed to reload externally modified "${path}"`, err);
        },
      );
    });
  }, [app]);

  /* ---------- load file content (filePath can change in-place) ---------- */

  useEffect(() => {
    const path = tab.filePath;
    // pure rename retarget: the handler above already re-pointed everything at
    // the new path and the content is still current — skip the flush + reload
    if (path !== null && path === saveRef.current.path && loadedPathRef.current === path) {
      return;
    }
    // flush whatever the previous file still had pending
    void flushSave();
    setLoadedPath(null);
    setLoadError(null);
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
  }, [app, flushSave, setLoadedPath, tab.filePath]);

  /* ---------- CodeMirror lifecycle (edit mode) ---------- */

  useEffect(() => {
    if (tab.mode === "preview" || !loadedPath || !hostRef.current) return;
    const state = EditorState.create({
      doc: textRef.current,
      extensions: buildEditorExtensions({
        app,
        path: loadedPath,
        onDocChanged: handleDocChanged,
        mode: tab.mode === "source" ? "source" : "live",
      }),
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
      void flushSave();
      viewRef.current = null;
      view.destroy();
    };
  }, [app, tab.mode, loadedPath, handleDocChanged, flushSave]);

  /* ---------- app-level flush registry (close-time flushing awaits IPC) ---------- */

  useEffect(() => {
    return app.workspace.registerFlusher(() => flushSave());
  }, [app, flushSave]);

  /* ---------- focus restoration after modals close ---------- */

  useEffect(() => {
    return app.events.on("modal:closed", () => {
      requestAnimationFrame(() => {
        if (app.workspace.state.get().modal) return;
        if (app.workspace.getActiveTab()?.id !== tab.id || tab.mode === "preview") return;
        viewRef.current?.focus();
      });
    });
  }, [app, tab.id, tab.mode]);

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

  const setMode = useCallback(
    (mode: ViewMode) => {
      app.workspace.setTabMode(tab.id, mode);
    },
    [app, tab.id],
  );

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
        <div className="editor-error-title">Couldn&apos;t open &quot;{tab.title}&quot;</div>
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
  } else if (tab.mode !== "preview") {
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
        <div className="editor-mode-group" role="group" aria-label="View mode" data-testid="mode-group">
          <button
            className={"editor-mode-btn" + (tab.mode === "live" ? " is-active" : "")}
            data-testid="mode-live"
            title="Live preview (Ctrl+E)"
            aria-label="Live preview"
            aria-pressed={tab.mode === "live"}
            onClick={() => setMode("live")}
          >
            <Icon name="pencil" size={15} />
          </button>
          <button
            className={"editor-mode-btn" + (tab.mode === "source" ? " is-active" : "")}
            data-testid="mode-source"
            title="Source mode (Ctrl+Shift+E)"
            aria-label="Source mode"
            aria-pressed={tab.mode === "source"}
            onClick={() => setMode("source")}
          >
            <svg
              width={15}
              height={15}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M16 18l6-6-6-6" />
              <path d="M8 6l-6 6 6 6" />
            </svg>
          </button>
          <button
            className={"editor-mode-btn" + (tab.mode === "preview" ? " is-active" : "")}
            data-testid="mode-preview"
            title="Reading view (Ctrl+E)"
            aria-label="Reading view"
            aria-pressed={tab.mode === "preview"}
            onClick={() => setMode("preview")}
          >
            <Icon name="book-open" size={15} />
          </button>
        </div>
      </div>
      {body}
    </div>
  );
}
