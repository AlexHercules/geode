import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { DocumentHandle } from "@core/documents";
import type { TabState, ViewMode } from "@core/types";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import {
  buildEditorExtensions,
  clearRevealFlash,
  editorModeExtensions,
  refreshWikilinks,
  revealFlash,
} from "./cmExtensions";
import { hydrateEmbeds } from "./embeds";
import { renderPreview, toggleTaskOnLine } from "./preview";
import { openWikilink } from "./wikilinks";
import "./editor.css";

/**
 * Best-effort selection/scroll restoration across live|source ↔ preview (R11).
 * The CM view is destroyed when entering reading view (no CM there) — its
 * selection + scrollTop are stashed here (keyed by tab id) and re-applied,
 * clamped to the document length, when the editor view is rebuilt. The
 * preview container's scrollTop gets its own slot for the reverse trip.
 * Session-scoped by design: never persisted, never pruned (bounded by the
 * number of tabs opened this session).
 */
interface PaneSession {
  anchor: number;
  head: number;
  scrollTop: number;
  previewScrollTop: number;
}

const paneSessions = new Map<string, PaneSession>();

function saveSession(tabId: string, patch: Partial<PaneSession>): void {
  const prev = paneSessions.get(tabId);
  paneSessions.set(tabId, {
    anchor: prev?.anchor ?? 0,
    head: prev?.head ?? 0,
    scrollTop: prev?.scrollTop ?? 0,
    previewScrollTop: prev?.previewScrollTop ?? 0,
    ...patch,
  });
}

/**
 * EditorPane — markdown editing (CodeMirror 6) + reading view for one tab.
 *
 * R4: text / dirty / auto-save state lives in the shared DocumentHandle
 * (core/documents.ts) — ONE per open file no matter how many panes show it.
 * The pane acquires the handle on mount / path change and releases it on
 * unmount; per-tab view mode, selection and scroll stay local to this pane's
 * own CM view. The same component instance can be re-pointed at another file
 * (tab id is reused), and on rename the workspace re-points tab.filePath at
 * the new path: the manager has already re-keyed the handle, so acquire()
 * returns the SAME object and the CM view survives with its undo history,
 * cursor and scroll intact (R3 defect fix).
 */
export function EditorPane({ tab }: { tab: TabState }) {
  const app = useApp();
  const t = useI18n();
  const metaRevision = useStore(app.metadata.revision);

  /** the shared document handle for tab.filePath (null while loading) */
  const [handle, setHandleState] = useState<DocumentHandle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** bumped when the handle's text changes while we are in reading view */
  const [previewBump, setPreviewBump] = useState(0);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** ref mirror of `handle` so event handlers can compare outside render */
  const handleRef = useRef<DocumentHandle | null>(null);
  /** preview scroll container + content (embed hydration / scroll restore) */
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const previewContentRef = useRef<HTMLDivElement | null>(null);
  /** compartment owned by the CURRENT view — live↔source reconfigures it */
  const modeCompartmentRef = useRef<Compartment | null>(null);
  /** the editor mode the current view's compartment is configured with */
  const appliedModeRef = useRef<"live" | "source">("live");
  /** render-time mirror of tab.mode — the CM effect reads it without depending
   *  on it (live↔source must NOT rebuild the view) */
  const latestModeRef = useRef<ViewMode>(tab.mode);
  latestModeRef.current = tab.mode;

  const setHandle = useCallback((h: DocumentHandle | null) => {
    handleRef.current = h;
    setHandleState(h);
  }, []);

  /* ---------- acquire/release the shared document handle ---------- */

  useEffect(() => {
    const path = tab.filePath;
    if (!path) {
      setHandle(null);
      setLoadError(null);
      return;
    }
    // Pure rename retarget: the manager re-keyed the map in place, so the
    // handle we already hold IS the live handle for the new path. Keep it
    // mounted (do NOT null it out — that would tear down the CM view and
    // lose undo history / cursor / scroll). We still acquire() below to keep
    // the refcount paired with the cleanup's release().
    const live = app.documents.get(path);
    if (!live || live !== handleRef.current) {
      setHandle(null);
      setLoadError(null);
    }
    let cancelled = false;
    let acquired: DocumentHandle | null = null;
    void app.documents.acquire(path).then(
      (h) => {
        if (cancelled) {
          h.release();
          return;
        }
        acquired = h;
        setLoadError(null);
        setHandle(h); // same object on rename → no downstream effect re-runs
      },
      (err: unknown) => {
        if (cancelled) return;
        setHandle(null);
        setLoadError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
      // release AFTER the next effect's synchronous re-acquire can run — the
      // manager defers the actual drop by a microtask, so a rename retarget
      // (or StrictMode re-mount) never destroys the handle in between
      acquired?.release();
    };
  }, [app, setHandle, tab.filePath]);

  /* ---------- CodeMirror lifecycle (live / source modes) ---------- */

  // R11: live↔source must NOT rebuild the view (a Compartment reconfigures the
  // mode slice in place, below), so tab.mode is NOT a dependency — only the
  // preview ↔ editor transition (this derived boolean) tears down / remounts.
  const isPreview = tab.mode === "preview";

  useEffect(() => {
    if (isPreview || !handle || !hostRef.current) return;
    const mode = latestModeRef.current === "source" ? "source" : "live";
    const modeCompartment = new Compartment();
    modeCompartmentRef.current = modeCompartment;
    appliedModeRef.current = mode;
    const view = new EditorView({
      // per-view state seeded with the shared doc + the handle's sync glue;
      // undo history is managed by the handle (one history per FILE)
      state: handle.createViewState(
        buildEditorExtensions({
          app,
          // live accessor: rename retargets the handle without a rebuild
          getPath: () => handle.path,
          mode,
          modeCompartment,
        }),
      ),
      parent: hostRef.current,
    });
    viewRef.current = view;
    const detach = handle.attachView(view);
    // best-effort restore after a preview round-trip (clamped — the document
    // may have changed length while the editor view was gone)
    const saved = paneSessions.get(tab.id);
    if (saved) {
      const len = view.state.doc.length;
      view.dispatch({
        selection: {
          anchor: Math.min(Math.max(0, saved.anchor), len),
          head: Math.min(Math.max(0, saved.head), len),
        },
      });
      view.scrollDOM.scrollTop = saved.scrollTop;
    }
    // report the focused view — the compat Editor shim consumes it
    const onFocusIn = () => app.documents.setActiveView(view, handle.path);
    view.dom.addEventListener("focusin", onFocusIn);
    view.focus();
    if (app.workspace.getActiveTab()?.id === tab.id) {
      app.documents.setActiveView(view, handle.path);
    }
    // re-evaluate wikilink resolution whenever the metadata index changes
    const unsubscribe = app.metadata.revision.subscribe(() => {
      view.dispatch({ effects: refreshWikilinks.of(null) });
    });
    return () => {
      unsubscribe();
      view.dom.removeEventListener("focusin", onFocusIn);
      // clear the active-view report if it still points at this view
      if (app.documents.getActiveView()?.view === view) {
        app.documents.setActiveView(null, null);
      }
      // stash selection + scroll for the preview → editor return trip
      const sel = view.state.selection.main;
      saveSession(tab.id, {
        anchor: sel.anchor,
        head: sel.head,
        scrollTop: view.scrollDOM.scrollTop,
      });
      detach();
      viewRef.current = null;
      modeCompartmentRef.current = null;
      view.destroy();
      // no flush here: pending saves belong to the handle, which outlives the
      // view (other panes / the manager's deferred-drop flush / flushAll)
    };
  }, [app, tab.id, handle, isPreview]);

  /* ---------- live ↔ source: reconfigure in place (no rebuild) ---------- */

  useEffect(() => {
    if (tab.mode === "preview" || !handle) return;
    const view = viewRef.current;
    const modeCompartment = modeCompartmentRef.current;
    if (!view || !modeCompartment) return;
    const mode = tab.mode === "source" ? "source" : "live";
    if (appliedModeRef.current === mode) return; // fresh build already matches
    appliedModeRef.current = mode;
    // swaps ONLY the mode slice — selection, scroll and the handle-owned
    // history compartment (promoteHistoryHost) are untouched by design
    view.dispatch({
      effects: modeCompartment.reconfigure(editorModeExtensions(app, () => handle.path, mode)),
    });
  }, [app, handle, tab.mode]);

  /* ---------- one-shot reveal consumption (R14: scroll + flash) ---------- */

  const reveal = useStore(app.workspace.revealTarget);
  /** pending flash-clear timer id — zeroed on fire, cleared on unmount */
  const flashTimerRef = useRef<number | null>(null);
  /** preview heading currently flashing (R15) — class removed when the timer fires */
  const previewFlashElRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
      previewFlashElRef.current = null;
    };
  }, []);

  // NOTE: the consuming effect lives below the previewHtml memo — the preview
  // branch (R15) must observe previewHtml so it re-runs only after the
  // rendered HTML has been committed to the DOM.

  /* ---------- report the active view when this tab becomes active ---------- */

  useEffect(() => {
    if (!handle) return;
    const report = () => {
      const view = viewRef.current;
      if (!view) return;
      if (app.workspace.getActiveTab()?.id === tab.id) {
        app.documents.setActiveView(view, handle.path);
      }
    };
    report();
    return app.workspace.state.subscribe(report);
  }, [app, tab.id, handle]);

  /* ---------- reading view follows the shared document ---------- */

  useEffect(() => {
    if (!handle || tab.mode !== "preview") return;
    // covers external reloads AND live edits from another pane showing the
    // same file — the reading view re-renders from handle.getText()
    return handle.revision.subscribe(() => setPreviewBump((b) => b + 1));
  }, [handle, tab.mode]);

  /* ---------- preview scroll round-trip (R11, best effort) ---------- */

  useEffect(() => {
    if (tab.mode !== "preview" || !handle) return;
    const el = previewScrollRef.current;
    if (!el) return;
    const saved = paneSessions.get(tab.id);
    if (saved) el.scrollTop = saved.previewScrollTop;
    return () => {
      saveSession(tab.id, { previewScrollTop: el.scrollTop });
    };
  }, [tab.id, tab.mode, handle]);

  /* ---------- outline navigation (geode:scroll-to-heading) ---------- */

  useEffect(() => {
    const onJump = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string; from: number }>).detail;
      if (!detail || detail.path !== handleRef.current?.path) return;
      // split panes can host the same file in several instances — only the
      // active pane's ACTIVE tab may jump (and steal focus/flip view mode)
      if (app.workspace.getActiveTab()?.id !== tab.id) return;
      if (tab.mode === "preview") {
        app.workspace.setTabMode(tab.id, "live"); // editor mounts, user re-clicks
        return;
      }
      const view = viewRef.current;
      if (!view) return;
      // clamp: metadata offsets may lag local edits
      const pos = Math.min(Math.max(0, detail.from ?? 0), view.state.doc.length);
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "start" }),
      });
      view.focus();
    };
    window.addEventListener("geode:scroll-to-heading", onJump);
    return () => window.removeEventListener("geode:scroll-to-heading", onJump);
  }, [app, tab.id, tab.mode]);

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
    if (tab.mode !== "preview" || !handle) return "";
    return renderPreview(
      handle.getText(),
      (target) => app.metadata.resolveLink(target, handle.path),
      // image embeds render as src-less <img class="geode-embed"> placeholders
      // and note embeds as empty span.geode-embed-note containers — both are
      // hydrated asynchronously after the innerHTML lands (effect below)
      {
        resolveEmbed: (target) => app.metadata.resolveAttachment(target, handle.path),
        noteEmbeds: true,
      },
    );
    // metaRevision/previewBump are render triggers, not direct inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, tab.mode, handle, metaRevision, previewBump]);

  /* ---------- hydrate image + note embeds after each preview render ---------- */

  useEffect(() => {
    if (tab.mode !== "preview" || !handle) return;
    const el = previewContentRef.current;
    if (el) void hydrateEmbeds(el, app, handle.path);
  }, [app, tab.mode, handle, previewHtml]);

  /* ---------- one-shot reveal consumption (R14 editor / R15 preview) ---------- */

  useEffect(() => {
    // Consume only when this pane targets the requested path AND the matching
    // surface is mounted: a CM view (live/source) or the rendered reading-view
    // DOM (R15). A path mismatch leaves the request pending — openFile
    // switches tabs first, so this pane may mount (handle ready, view built /
    // preview HTML committed) AFTER the requestReveal; depending on `handle`,
    // `reveal` AND `previewHtml` re-runs the check on whichever side arrives
    // last (effects run post-commit, so previewContentRef holds the DOM
    // rendered from the CURRENT previewHtml when this fires).
    if (!reveal || !handle || reveal.path !== handle.path) return;
    if (isPreview) {
      const content = previewContentRef.current;
      const scroller = previewScrollRef.current;
      if (!content || !scroller) return; // not committed yet — stay pending
      // Heading reveal: exact `from` match against the metadata index, then
      // locate by document-order ordinal — the preview pipeline renders
      // headings 1:1, so the ordinal is stabler than text matching. Headings
      // inside hydrated note embeds (.geode-embed-note) are excluded so late
      // embed hydration cannot shift the ordinals.
      const headings = app.metadata.getMetadata(handle.path)?.headings ?? [];
      const ordinal = headings.findIndex((h) => h.from === reveal.from);
      let target: HTMLElement | null = null;
      if (ordinal >= 0) {
        const els = Array.from(
          content.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"),
        ).filter((el) => !el.closest(".geode-embed-note"));
        target = els[ordinal] ?? null;
      }
      if (target) {
        target.scrollIntoView({ block: "center" });
        // restart cleanly if a previous flash is still running
        const prev = previewFlashElRef.current;
        if (prev) prev.classList.remove("preview-reveal-flash");
        void target.offsetWidth; // reflow so re-adding the class replays the animation
        target.classList.add("preview-reveal-flash");
        previewFlashElRef.current = target;
        if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = null;
          previewFlashElRef.current?.classList.remove("preview-reveal-flash");
          previewFlashElRef.current = null;
        }, 1200);
      } else {
        // Block / unlocatable target: proportional approximation against the
        // raw source length (reveal.from shares that coordinate space). No
        // flash — approximate by design (recorded口径).
        const len = app.metadata.getMetadata(handle.path)?.contentLength || handle.getText().length || 1;
        scroller.scrollTop =
          (reveal.from / len) * scroller.scrollHeight - scroller.clientHeight / 2;
      }
      app.workspace.revealTarget.set(null);
      return;
    }
    const view = viewRef.current;
    if (!view) return;
    // clamp: subpath offsets come from the metadata index, which may lag
    // unsaved local edits
    const from = Math.min(Math.max(0, reveal.from), view.state.doc.length);
    view.dispatch({
      selection: { anchor: from },
      effects: [EditorView.scrollIntoView(from, { y: "center" }), revealFlash.of({ from })],
    });
    app.workspace.revealTarget.set(null);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null;
      // the view may have been rebuilt meanwhile — a fresh field starts
      // empty, so dispatching the clear there is a harmless no-op
      viewRef.current?.dispatch({ effects: clearRevealFlash.of(null) });
    }, 1200);
  }, [app, handle, isPreview, reveal, previewHtml]);

  const onPreviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (!el || !handle) return;

      // R18: footnote ref/backref hop — scroll the counterpart into view
      // inside the preview container. Checked FIRST (it is an anchor, so the
      // generic a[href] branch below must never see it). preventDefault stops
      // the webview from hijacking the #fragment navigation.
      const fnLink = el.closest<HTMLAnchorElement>("a.footnote-link, a.footnote-backref");
      if (fnLink) {
        e.preventDefault();
        const href = fnLink.getAttribute("href") ?? "";
        const id = href.startsWith("#") ? href.slice(1) : "";
        const target = id
          ? previewContentRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
          : null;
        target?.scrollIntoView({ block: "center" });
        return;
      }

      // R18: collapsible callout title toggles .is-collapsed (pure class
      // flip — a re-render returns to the authored initial state, recorded
      // 口径). Links inside the title fall through to the link delegations
      // below instead of toggling (no mis-swallowing).
      const calloutTitle = el.closest<HTMLElement>(".callout.is-collapsible > .callout-title");
      if (calloutTitle && !el.closest("a")) {
        e.preventDefault();
        calloutTitle.closest(".callout")?.classList.toggle("is-collapsed");
        return;
      }

      const checkbox = el.closest<HTMLInputElement>("input.task-checkbox");
      if (checkbox) {
        e.preventDefault();
        const line = Number(checkbox.dataset.line);
        const next = toggleTaskOnLine(handle.getText(), line);
        if (next !== null) {
          const path = handle.path;
          // setText syncs every attached view (other panes) without marking
          // dirty; the explicit modify below persists it — our own
          // file:modified echo then no-ops via the content equality check
          handle.setText(next);
          void app.vault.modify(path, next).catch((err) => {
            console.error(`[editor] failed to save task toggle in ${path}`, err);
          });
        }
        return;
      }

      const internal = el.closest<HTMLAnchorElement>("a.internal-link");
      if (internal) {
        e.preventDefault();
        const target = internal.dataset.target;
        const subpath = internal.dataset.subpath;
        // data-subpath rides on subpath-bearing anchors (core pipeline) so
        // [[note#Heading]] / [[note#^id]] clicks reveal the target span (R14);
        // R16: an empty data-target + data-subpath is a [[#h]] self-link —
        // opens this note and reveals the span
        if (target !== undefined && (target !== "" || subpath)) {
          void openWikilink(app, target, handle.path, subpath);
        }
        return;
      }

      const anchor = el.closest<HTMLAnchorElement>("a[href]");
      if (anchor) {
        const href = anchor.getAttribute("href") ?? "";
        if (!/^https?:/i.test(href)) e.preventDefault();
      }
    },
    [app, handle],
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
        <div>{t("editor.noFile")}</div>
      </div>
    );
  } else if (loadError) {
    body = (
      <div className="editor-error" data-testid="editor-error">
        <Icon name="file-text" size={28} />
        <div className="editor-error-title">{t("editor.openFailed", { name: tab.title })}</div>
        <div className="editor-error-detail">{loadError}</div>
      </div>
    );
  } else if (!handle) {
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
      <div className="editor-preview" onClick={onPreviewClick} ref={previewScrollRef}>
        <div
          className="preview-content"
          data-testid="preview"
          ref={previewContentRef}
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
        <div
          className="editor-mode-group"
          role="group"
          aria-label={t("editor.viewModeAria")}
          data-testid="mode-group"
        >
          <button
            className={"editor-mode-btn" + (tab.mode === "live" ? " is-active" : "")}
            data-testid="mode-live"
            title={`${t("editor.livePreview")} (Ctrl+E)`}
            aria-label={t("editor.livePreview")}
            aria-pressed={tab.mode === "live"}
            onClick={() => setMode("live")}
          >
            <Icon name="pencil" size={15} />
          </button>
          <button
            className={"editor-mode-btn" + (tab.mode === "source" ? " is-active" : "")}
            data-testid="mode-source"
            title={`${t("editor.sourceMode")} (Ctrl+Shift+E)`}
            aria-label={t("editor.sourceMode")}
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
            title={`${t("editor.readingView")} (Ctrl+E)`}
            aria-label={t("editor.readingView")}
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
