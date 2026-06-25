import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Compartment } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { foldEffect } from "@codemirror/language";
import {
  spellcheckEnabled,
  rightToLeft,
  showViewModeToggle,
  strictLineBreaks,
  showLineNumbers,
  tabIndentSize,
  indentUsingTabs,
  autoPairBrackets,
  autoPairMarkdown,
  showInlineTitle,
  showBacklinksInDocument,
  foldHeading,
  hideReferenceMarks,
} from "@core/appearance";
import type { DocumentHandle } from "@core/documents";
import { editorExtensionsRevision, getEditorExtensions } from "@core/editorExtensions";
import { codeBlockProcessorsRevision } from "@core/markdownPostProcessors";
import { loadFoldInfo, foldRangesFromInfo } from "@core/foldStore";
import { getCssClasses } from "@core/metadata";
import type { PropertyEdit } from "@core/properties";
import type { TabState, ViewMode } from "@core/types";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import { bookmarks } from "@core/bookmarks";
import { renameWithLinkUpdate } from "@core/linkRewrite";
import { findFolder } from "@core/explorerMove";
import { parentPath, basename } from "@core/vault";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import {
  buildEditorExtensions,
  clearRevealFlash,
  closeBracketsExtension,
  markdownWrapExtension,
  editorModeExtensions,
  indentExtensions,
  refreshProperties,
  refreshWikilinks,
  revealFlash,
} from "./cmExtensions";
import { hydrateEmbeds } from "./embeds";
import { hydrateCodeCopy } from "./codeCopy";
import { runMarkdownPostProcessors } from "./markdownPostProcess";
import { renderPreview, toggleTaskOnLine } from "./preview";
import { markdownFoldService } from "./folding";
import { PropertiesPanel } from "./PropertiesPanel";
import { BacklinksInDocument } from "./BacklinksInDocument";
import { openWikilink } from "./wikilinks";
import { handleObsidianUri } from "./obsidianUriHandler";
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
 * R29: reading-view heading fold. Pure runtime DOM class toggle on the rendered
 * preview — a re-render returns to the authored (unfolded) state, so reading-view
 * folds are NOT persisted and do NOT share the editor's per-file FoldInfo (the
 * DOM→source-line mapping needed for that would require markdown.ts to emit
 * data-line, deliberately out of scope this round — see ARCHITECTURE R29 显式偏差).
 * Module-level (not re-created per render); mirrors the callout fold idiom above.
 */
function headingLevel(el: Element): number | null {
  const m = /^H([1-6])$/.exec(el.tagName);
  return m ? Number(m[1]) : null;
}

/**
 * Hide/show one heading's section: its following siblings up to (but not
 * including) the next heading of same-or-higher level (the section boundary).
 * On expand, nested still-collapsed sub-headings keep their own sub-sections
 * hidden (they own their `.is-collapsed` state independently).
 */
function setSectionFolded(heading: HTMLElement, folded: boolean): void {
  const level = headingLevel(heading);
  if (level === null) return;
  let node: Element | null = heading.nextElementSibling;
  while (node) {
    const nl = headingLevel(node);
    if (nl !== null && nl <= level) break; // section boundary
    if (folded) {
      node.classList.add("geode-heading-folded");
    } else {
      node.classList.remove("geode-heading-folded");
      // nested collapsed heading: reveal the heading itself but keep its
      // sub-section hidden, then skip past that sub-section.
      if (nl !== null && node.classList.contains("is-collapsed")) {
        let sub: Element | null = node.nextElementSibling;
        while (sub) {
          const sl = headingLevel(sub);
          if (sl !== null && sl <= nl) break;
          sub.classList.add("geode-heading-folded");
          sub = sub.nextElementSibling;
        }
        node = sub;
        continue;
      }
    }
    node = node.nextElementSibling;
  }
}

function toggleHeadingFold(heading: HTMLElement): void {
  const folded = heading.classList.toggle("is-collapsed");
  setSectionFolded(heading, folded);
}

/** R164: transient toast surfacing skipped-link count on rename (D1 fix — mirrors
 *  Explorer's showLinkUpdateNotice; feature-local, layering forbids cross-import). */
function showLinkUpdateNotice(message: string): void {
  document.querySelector(".link-update-notice")?.remove();
  const el = document.createElement("div");
  el.className = "link-update-notice";
  el.textContent = message;
  el.setAttribute("data-testid", "link-update-notice");
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 4000);
}

/**
 * R164: editable inline title (Obsidian "Show inline title" → click to rename).
 * The `.inline-title` div stays resident in both display/edit modes so the cm-host
 * sibling never remounts (R94). Commit routes through `renameWithLinkUpdate` (R16
 * vetted: flushes dirty body first, then renames; `file:renamed` retargets the tab).
 */
function InlineTitle({ tab }: { tab: TabState }) {
  const app = useApp();
  const t = useI18n();
  const [editing, setEditing] = useState(false);
  const tree = useStore(app.vault.tree);
  const path = tab.filePath ?? "";

  if (!editing) {
    return (
      <div className="inline-title" data-testid="inline-title">
        <span
          className="inline-title-text"
          role="button"
          tabIndex={0}
          title={t("editor.renameTitle")}
          onClick={() => setEditing(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEditing(true);
            }
          }}
        >
          {tab.title}
        </span>
      </div>
    );
  }

  const base = basename(path);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1) : "";
  // mirrors Explorer.validateName: non-empty, no path separators, no case-insensitive
  // sibling collision (excluding self) — the guard against rename-over-existing (vault
  // .rename does NOT protect the target → would overwrite/lose data without this).
  const validate = (value: string): boolean => {
    const name = value.trim();
    if (!name || /[\\/]/.test(name)) return false;
    if (!tree) return false;
    const fullName = ext ? `${name}.${ext}` : name;
    const siblings = findFolder(tree, parentPath(path))?.children ?? [];
    return !siblings.some((c) => c.path !== path && c.name.toLowerCase() === fullName.toLowerCase());
  };
  const commit = (name: string) => {
    setEditing(false);
    const fullName = ext ? `${name}.${ext}` : name;
    const parent = parentPath(path);
    const newPath = parent ? `${parent}/${fullName}` : fullName;
    if (newPath === path) return;
    void (async () => {
      try {
        const result = await renameWithLinkUpdate(
          { vault: app.vault, metadata: app.metadata, documents: app.documents },
          path,
          newPath,
        );
        if (result.skipped.length > 0) {
          showLinkUpdateNotice(t("explorer.linkUpdateSkipped", { count: result.skipped.length }));
        }
      } catch (err) {
        console.error("[editor] inline title rename failed", err);
      }
    })();
  };

  return (
    <div className="inline-title" data-testid="inline-title">
      <InlineTitleInput
        initial={tab.title}
        validate={validate}
        onCommit={commit}
        onCancel={() => setEditing(false)}
      />
    </div>
  );
}

/**
 * R164: controlled single-line title input. Mirrors Explorer's RenameInput — a
 * feature-local component that layering forbids cross-importing, so a minimal copy
 * lives here (`<input>`, not contentEditable → no rich-text/newline contamination).
 */
function InlineTitleInput(props: {
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
      className={`inline-title-input${valid ? "" : " is-invalid"}`}
      data-testid="inline-title-input"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
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
  /* R50: editor spellcheck preference — applied per-view reactively below */
  const spell = useStore(spellcheckEnabled);
  /* R226: right-to-left text direction — applied to the CM contentDOM + the preview div */
  const rtl = useStore(rightToLeft);
  /* R229: show the edit/read view-mode toggle button group in the header (Obsidian default ON) */
  const viewModeToggleVisible = useStore(showViewModeToggle);
  /* R87: strict line breaks (reading view) — re-render preview reactively */
  const strict = useStore(strictLineBreaks);
  /* R88: line-number gutter preference — reconfigure CM compartment reactively */
  const showLineNo = useStore(showLineNumbers);
  /* R153: auto-pair-brackets preference — reconfigure CM compartment reactively */
  const autoPair = useStore(autoPairBrackets);
  /* R225: auto-pair-Markdown-syntax preference — reconfigure CM compartment reactively */
  const autoPairMd = useStore(autoPairMarkdown);
  /* R224: hide-reference-marks preference — reconfigures the mode compartment (live preview) */
  const hideRefMarks = useStore(hideReferenceMarks);
  // R156: Fold heading — reconfigure the fold-service compartment on change
  const foldHeadingOn = useStore(foldHeading);
  /* R92: indentation preferences — reconfigure CM compartment reactively */
  const indentSize = useStore(tabIndentSize);
  const useTabs = useStore(indentUsingTabs);
  /* R94: Obsidian "Show inline title" — filename as an H1 atop the note (display-only) */
  const inlineTitleOn = useStore(showInlineTitle);
  // R154: gate the reading-view linked-mentions section (Obsidian "Backlink in document")
  const backlinksInDoc = useStore(showBacklinksInDocument);
  // R162: subscribe so the header bookmark star reflects bookmark changes live
  useStore(bookmarks.items);
  const bookmarked = tab.filePath !== null && bookmarks.isFileBookmarked(tab.filePath);
  /* R115: plugin-contributed CM6 extensions — reconfigure the compat compartment reactively */
  const compatExtRev = useStore(editorExtensionsRevision);
  const cbProcRev = useStore(codeBlockProcessorsRevision);

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
  /** R88: compartment for the line-number gutter — showLineNumbers reconfigures it */
  const lineNumberCompartmentRef = useRef<Compartment | null>(null);
  /** R92: compartment for indentation (tab width + unit) — settings reconfigure it */
  const indentCompartmentRef = useRef<Compartment | null>(null);
  /** R153: compartment for auto-pair brackets — autoPairBrackets reconfigures it */
  const closeBracketsCompartmentRef = useRef<Compartment | null>(null);
  /** R225: compartment for auto-pair Markdown syntax — autoPairMarkdown reconfigures it */
  const markdownWrapCompartmentRef = useRef<Compartment | null>(null);
  /** R156: compartment for the fold service — the foldHeading toggle reconfigures it */
  const foldServiceCompartmentRef = useRef<Compartment | null>(null);
  /** R115: compartment for plugin-contributed CM6 extensions (registerEditorExtension) */
  const compatExtensionCompartmentRef = useRef<Compartment | null>(null);
  /** the editor mode the current view's compartment is configured with */
  const appliedModeRef = useRef<"live" | "source">("live");
  /** render-time mirror of tab.mode — the CM effect reads it without depending
   *  on it (live↔source must NOT rebuild the view) */
  const latestModeRef = useRef<ViewMode>(tab.mode);
  latestModeRef.current = tab.mode;

  /* ---------- properties panel (R22) ---------- */

  /** in-document properties display preference (visible | hidden | source) */
  const propsDisplay = useStore(app.workspace.propertiesInDocument);
  /** stable host container for the live-mode PropertiesPanel portal — created
   *  lazily ONCE per pane and handed to buildEditorExtensions; the CM
   *  PropertiesHostWidget appends it (eq恒真 → DOM reused, portal survives) */
  const propertiesHostRef = useRef<HTMLDivElement | null>(null);
  if (propertiesHostRef.current === null) {
    const el = document.createElement("div");
    el.className = "properties-host";
    propertiesHostRef.current = el;
  }
  /** handle.revision mirror — drives the panel's revision prop in BOTH live
   *  and preview modes (live edits, other panes, external reloads) */
  const [docRevision, setDocRevision] = useState(0);

  useEffect(() => {
    if (!handle) return;
    // resync on (re)subscribe — the handle may have advanced while no panel
    // was mounted (display hidden / source mode round trips)
    setDocRevision(handle.revision.get());
    return handle.revision.subscribe(() => setDocRevision(handle.revision.get()));
  }, [handle]);

  /** R73: cssclasses/cssclass frontmatter → CSS classes on the note view
   *  container (Obsidian per-note theme/snippet targeting). Read live off the
   *  buffer so editing the property updates the container immediately; docRevision
   *  (handle.revision mirror) is the bump trigger in both live and preview. */
  const cssClasses = useMemo(
    () => (handle ? getCssClasses(handle.getText()) : []),
    [handle, docRevision],
  );
  const cssSuffix = cssClasses.length ? " " + cssClasses.join(" ") : "";

  // display preference changed → the CM frontmatter field must recompute its
  // decoration (panel widget ↔ raw ↔ hidden). The store subscription above
  // (useStore) already re-renders the React side.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshProperties.of(null) });
  }, [propsDisplay]);

  /** one splice into the live CM view — exactly one undo step, selection
   *  untouched (the panel never reveals/moves the cursor, contract口径) */
  const applyLiveEdit = useCallback((edit: PropertyEdit) => {
    viewRef.current?.dispatch({ changes: edit, userEvent: "input" });
  }, []);

  // R210: stable so the properties panel's layout effect re-measures the CM
  // heightmap only on a fold toggle, not on every portaled re-render.
  const onPropertiesLayoutChange = useCallback(() => viewRef.current?.requestMeasure(), []);

  /** preview-mode splice — task-checkbox precedent: apply to the handle's
   *  canonical text, sync every attached view via setText (NOT the undo
   *  history — preview edits don't undo, recorded口径), persist via modify */
  const applyPreviewEdit = useCallback(
    (edit: PropertyEdit) => {
      const h = handleRef.current;
      if (!h) return;
      const cur = h.getText();
      const next = cur.slice(0, edit.from) + edit.insert + cur.slice(edit.to);
      const path = h.path;
      h.setText(next);
      void app.vault.modify(path, next).catch((err) => {
        console.error(`[editor] failed to save property edit in ${path}`, err);
      });
    },
    [app],
  );

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
    const lineNumberCompartment = new Compartment();
    lineNumberCompartmentRef.current = lineNumberCompartment;
    const indentCompartment = new Compartment();
    indentCompartmentRef.current = indentCompartment;
    const closeBracketsCompartment = new Compartment();
    closeBracketsCompartmentRef.current = closeBracketsCompartment;
    const markdownWrapCompartment = new Compartment();
    markdownWrapCompartmentRef.current = markdownWrapCompartment;
    const foldServiceCompartment = new Compartment();
    foldServiceCompartmentRef.current = foldServiceCompartment;
    const compatExtensionCompartment = new Compartment();
    compatExtensionCompartmentRef.current = compatExtensionCompartment;
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
          lineNumberCompartment,
          indentCompartment,
          closeBracketsCompartment,
          markdownWrapCompartment,
          foldServiceCompartment,
          compatExtensionCompartment,
          // R22: portal target for the live-mode PropertiesPanel
          propertiesHost: propertiesHostRef.current ?? undefined,
        }),
      ),
      parent: hostRef.current,
    });
    viewRef.current = view;
    // R50: seed the new view with the current spellcheck preference (the effect
    // below keeps it in sync; this covers the initial build before that runs)
    view.contentDOM.setAttribute("spellcheck", String(spellcheckEnabled.get()));
    // R226: seed text direction (LTR/RTL) — CM6's native bidi takes over from contentDOM.dir
    view.contentDOM.setAttribute("dir", rightToLeft.get() ? "rtl" : "ltr");
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
    // R29: restore persisted folds (per-file, Obsidian-shape FoldInfo in
    // localStorage). foldEffect carries no docChanged → no autosave, no dirty.
    // Survives preview↔editor + tab close/reopen (live↔source already kept in
    // EditorState via base-list markdownFolding).
    const foldInfo = loadFoldInfo(handle.path);
    if (foldInfo?.folds.length) {
      const ranges = foldRangesFromInfo(view.state, foldInfo);
      if (ranges.length) view.dispatch({ effects: ranges.map((r) => foldEffect.of(r)) });
    }
    // report the focused view — the compat Editor shim consumes it
    const onFocusIn = () => app.documents.setActiveView(view, handle.path);
    view.dom.addEventListener("focusin", onFocusIn);
    // with a modal open (R23 insert-template flips preview→live and opens the
    // template picker in the same commit) focusing here would steal focus from
    // the modal input — keystrokes would silently land in the document and
    // autosave (R23 review critical). Mirror the modal:closed restore guard.
    if (!app.workspace.state.get().modal) view.focus();
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
      lineNumberCompartmentRef.current = null;
      indentCompartmentRef.current = null;
      closeBracketsCompartmentRef.current = null;
      markdownWrapCompartmentRef.current = null;
      foldServiceCompartmentRef.current = null;
      compatExtensionCompartmentRef.current = null;
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
      effects: modeCompartment.reconfigure(editorModeExtensions(app, () => handle.path, mode, hideReferenceMarks.get())),
    });
  }, [app, handle, tab.mode]);

  /* ---------- spellcheck preference → live CM contentDOM (R50) ---------- */

  useEffect(() => {
    viewRef.current?.contentDOM.setAttribute("spellcheck", String(spell));
  }, [spell]);

  /* ---------- R226: right-to-left preference → live CM contentDOM ---------- */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.contentDOM.setAttribute("dir", rtl ? "rtl" : "ltr");
    view.requestMeasure(); // let CM re-read the text direction + re-render bidi
  }, [rtl]);

  /* ---------- line-number gutter preference → CM compartment (R88) ---------- */

  useEffect(() => {
    const view = viewRef.current;
    const compartment = lineNumberCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({ effects: compartment.reconfigure(showLineNo ? [lineNumbers()] : []) });
  }, [showLineNo]);

  /* ---------- R153: auto-pair-brackets preference → CM compartment ---------- */
  useEffect(() => {
    const view = viewRef.current;
    const compartment = closeBracketsCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({ effects: compartment.reconfigure(closeBracketsExtension(autoPair)) });
  }, [autoPair]);

  /* ---------- R225: auto-pair-Markdown-syntax preference → CM compartment ---------- */
  useEffect(() => {
    const view = viewRef.current;
    const compartment = markdownWrapCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({ effects: compartment.reconfigure(markdownWrapExtension(autoPairMd)) });
  }, [autoPairMd]);

  /* ---------- R156: fold heading preference → CM compartment ---------- */
  useEffect(() => {
    const view = viewRef.current;
    const compartment = foldServiceCompartmentRef.current;
    if (!view || !compartment) return;
    // reconfiguring the foldService also forces the gutter to re-query → chevrons refresh
    view.dispatch({ effects: compartment.reconfigure(markdownFoldService(foldHeadingOn)) });
  }, [foldHeadingOn]);

  /* ---------- indentation preference → CM compartment (R92) ---------- */

  useEffect(() => {
    const view = viewRef.current;
    const compartment = indentCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({ effects: compartment.reconfigure(indentExtensions(indentSize, useTabs)) });
  }, [indentSize, useTabs]);

  /* ---------- plugin-contributed CM6 extensions → compat compartment (R115) ---------- */

  useEffect(() => {
    const view = viewRef.current;
    const compartment = compatExtensionCompartmentRef.current;
    if (!view || !compartment) return;
    view.dispatch({ effects: compartment.reconfigure(getEditorExtensions()) });
  }, [compatExtRev]);

  /* ---------- plugin code-block registry change → rebuild live-preview slice (R134) ---------- */

  // A code-block lang (un)registered while a live editor is already open → reconfigure the mode slice
  // so its fences render/revert without needing a mode toggle or an edit (mirrors compatExtRev). The
  // liveBlockWidgets StateField also rebuilds on doc/selection change, so this only covers the
  // no-interaction case; in source/preview mode it's a harmless no-op reconfigure.
  useEffect(() => {
    if (tab.mode === "preview" || !handle) return;
    const view = viewRef.current;
    const modeCompartment = modeCompartmentRef.current;
    if (!view || !modeCompartment) return;
    const mode = tab.mode === "source" ? "source" : "live";
    view.dispatch({ effects: modeCompartment.reconfigure(editorModeExtensions(app, () => handle.path, mode, hideReferenceMarks.get())) });
  }, [cbProcRev]);

  /* ---------- R224: hide-reference-marks preference → mode compartment (live preview) ---------- */
  // livePreview's ViewPlugin only rebuilds on doc/selection/viewport change, so a setting flip
  // needs an explicit mode-compartment reconfigure (mirrors the cbProcRev effect above).
  useEffect(() => {
    if (tab.mode === "preview" || !handle) return;
    const view = viewRef.current;
    const modeCompartment = modeCompartmentRef.current;
    if (!view || !modeCompartment) return;
    const mode = tab.mode === "source" ? "source" : "live";
    view.dispatch({ effects: modeCompartment.reconfigure(editorModeExtensions(app, () => handle.path, mode, hideRefMarks)) });
  }, [hideRefMarks]);

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
        resolveMdLink: (href) => app.metadata.resolveMarkdownLink(href, handle.path),
        strictLineBreaks: strict,
        sourcePos: true, // R136: emit data-line on blocks so getSectionInfo can map el→source
      },
    );
    // metaRevision/previewBump are render triggers, not direct inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, tab.mode, handle, metaRevision, previewBump, strict]);

  /* ---------- hydrate image + note embeds after each preview render ---------- */

  useEffect(() => {
    if (tab.mode !== "preview" || !handle) return;
    const el = previewContentRef.current;
    if (!el) return;
    void hydrateEmbeds(el, app, handle.path);
    hydrateCodeCopy(el); // R95: code-fence copy buttons (post-render, byte-neutral)
    // R132 plugin reading-view post-processors; R136 passes the render-time source so getSectionInfo
    // (data-line DOM-walk) can return the note text the data-line numbers index into.
    const owner = runMarkdownPostProcessors(el, app, handle.path, handle.getText());
    // R135: unload any children the processors added when this render is torn down — React replaces the
    // dangerouslySetInnerHTML subtree on previewHtml change, so onunload fires before the next render's
    // children mount (and on unmount / leaving preview). Matches Obsidian's per-render child lifecycle.
    return () => owner?.unload();
    // R132 review: previewHtml-driven only — a registry change must NOT re-run on the un-wiped DOM
    // (would duplicate non-idempotent processors / linger disposed output). Like Obsidian, processors
    // apply to SUBSEQUENT renders, not retroactively to an already-open view.
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
      // Element (not HTMLElement): clicks inside a rendered mermaid SVG land
      // on SVGElements, which used to bail here. closest() lives on Element,
      // and the branch matchers themselves are HTML-anchored, so no type
      // hazard — but dead clicks on OTHER svg targets (e.g. KaTeX \sqrt /
      // stretchy delimiters) now reach the branches too: clicking the svg
      // part of a collapsible callout title now toggles it (intended fix of
      // the dead zone, recorded as an R19 behaviour change).
      const el = e.target instanceof Element ? e.target : null;
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

      // R152 (㊻): a reading-view #tag pill → search that tag (Obsidian behavior). The pill is a
      // <span class="tag-pill" data-tag="…"> from markdown.ts — pure delegation, no pipeline change.
      // Checked EARLY so a #tag inside a heading/callout title searches instead of folding; but
      // `!closest("a")` lets a pill that is link display text (`[#tag](url)`) fall through to
      // navigation, matching the heading/callout branches' own link guard (R152 review F4).
      const tagPill = el.closest<HTMLElement>(".tag-pill");
      if (tagPill && !el.closest("a")) {
        e.preventDefault();
        const tag = tagPill.dataset.tag;
        if (tag) app.workspace.requestSearch(`#${tag}`);
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

      // R29: reading-view heading fold — click a heading to collapse its section
      // (siblings until the next heading of same-or-higher level). Pure DOM class
      // toggle (no doc write); a re-render returns to authored state (reading-view
      // fold not persisted — see ARCHITECTURE R29 显式偏差). Links inside the
      // heading fall through to the link delegations below.
      const heading = el.closest<HTMLElement>("h1, h2, h3, h4, h5, h6");
      if (heading && previewContentRef.current?.contains(heading) && !el.closest("a")) {
        e.preventDefault();
        toggleHeadingFold(heading);
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

      // R19: internal-link nodes inside rendered mermaid diagrams (data-target
      // set by the hydration post-pass). The hit may be an SVGElement, so the
      // attribute is read via getAttribute — dataset would assume HTMLElement.
      // No subpath semantics in diagram node names (contract口径).
      const mermaidLink = el.closest(".geode-mermaid .internal-link[data-target]");
      if (mermaidLink) {
        e.preventDefault();
        const target = mermaidLink.getAttribute("data-target");
        if (target) void openWikilink(app, target, handle.path);
        return;
      }

      // R19 review fix (SEC-1 defense in depth): match bare `a`, not
      // `a[href]` — SVG anchors emitted by mermaid carry only a namespaced
      // xlink:href, which the attribute selector never matches, so a crafted
      // diagram link would dodge the non-http preventDefault below and
      // navigate the whole webview. Hydration already neutralizes those
      // anchors (core/embeds.ts); this guard is the second layer.
      const anchor = el.closest("a");
      if (anchor) {
        const href =
          anchor.getAttribute("href") ??
          anchor.getAttributeNS("http://www.w3.org/1999/xlink", "href") ??
          "";
        // R46: obsidian:// links route in-app — intercept the default navigation
        // and execute the parsed action (open/new/search). Sits before the generic
        // non-http preventDefault so the webview never tries to navigate to it.
        if (/^obsidian:/i.test(href)) {
          e.preventDefault();
          void handleObsidianUri(app, href);
          return;
        }
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

  // R94: Obsidian "Show inline title" — the note's filename (no extension) as an H1
  // at the top of the content. R164: click to rename (→ renameWithLinkUpdate). It
  // renders inside the live/source + reading bodies (below), never on empty/error/loading.
  const inlineTitleEl = inlineTitleOn && tab.filePath ? <InlineTitle tab={tab} /> : null;

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
    body = (
      <>
        {inlineTitleEl}
        <div
          className={"editor-cm-host markdown-source-view mod-cm6" + cssSuffix}
          data-testid="cm-editor"
          ref={hostRef}
        />
        {/* R22: live mode hosts the panel via a portal into the stable
            container the CM PropertiesHostWidget adopts (display "visible"
            only — "hidden"/"source" render no panel; source mode shows raw
            YAML inside CM instead) */}
        {tab.mode === "live" &&
          propsDisplay === "visible" &&
          propertiesHostRef.current &&
          createPortal(
            <PropertiesPanel
              getDoc={() => handle.getText()}
              applyEdit={applyLiveEdit}
              path={handle.path}
              revision={docRevision}
              // R210: folding is a pure-view height change (no doc transaction), so
              // the CM block widget heightmap won't re-measure on its own — nudge it
              onLayoutChange={onPropertiesLayoutChange}
            />,
            propertiesHostRef.current,
          )}
      </>
    );
  } else {
    body = (
      <div
        className="editor-preview markdown-reading-view"
        onClick={onPreviewClick}
        ref={previewScrollRef}
      >
        {/* R94: inline title at the very top of the scroller (scrolls with the note,
            before properties — mirrors Obsidian's reading-view order) */}
        {inlineTitleEl}
        {/* R22: reading view renders the panel before the content, inside the
            same scroller (it scrolls with the note) */}
        {propsDisplay === "visible" && (
          <PropertiesPanel
            getDoc={() => handle.getText()}
            applyEdit={applyPreviewEdit}
            path={handle.path}
            revision={docRevision}
          />
        )}
        <div
          className={"preview-content markdown-preview-view markdown-rendered" + cssSuffix}
          data-testid="preview"
          dir={rtl ? "rtl" : "ltr"} /* R226: RTL reading view (visual only — previewHtml bytes untouched) */
          ref={previewContentRef}
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
        {/* R154: linked mentions at the bottom of the note (Obsidian "Backlink in
            document"). Appended AFTER .preview-content so the render pipeline / §C bytes
            are untouched; read-only (getBacklinks + click→openFile). */}
        {backlinksInDoc && <BacklinksInDocument path={handle.path} />}
      </div>
    );
  }

  return (
    // R20: "workspace-leaf"/"markdown-*" classes mirror Obsidian's DOM for
    // community theme CSS — resident, additive only (contract)
    // data-leaf-path lets the R25 hover controller resolve internal links
    // against the note in THIS pane (not the globally-active file), so hovering
    // a link in a non-focused split previews the correct target.
    <div
      className="editor-pane workspace-leaf"
      data-testid="editor-pane"
      data-leaf-path={tab.filePath ?? undefined}
    >
      <div className="editor-header">
        <div className="editor-title" title={tab.filePath ?? undefined}>
          {tab.title}
        </div>
        <div className="editor-header-spacer" />
        {tab.filePath !== null && (
          <button
            className={"editor-mode-btn" + (bookmarked ? " is-active" : "")}
            data-testid="bookmark-toggle"
            title={t(bookmarked ? "cmd.unbookmarkFile" : "cmd.bookmarkFile")}
            aria-label={t(bookmarked ? "cmd.unbookmarkFile" : "cmd.bookmarkFile")}
            aria-pressed={bookmarked}
            onClick={() => {
              if (tab.filePath) void bookmarks.toggleFile(tab.filePath);
            }}
          >
            <Icon name="bookmark" size={15} {...(bookmarked ? { fill: "currentColor" } : {})} />
          </button>
        )}
        {viewModeToggleVisible && (
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
        )}
      </div>
      {body}
    </div>
  );
}
