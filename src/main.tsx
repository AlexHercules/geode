import React from "react";
import ReactDOM from "react-dom/client";
import { App, LAST_VAULT_KEY } from "@app/App";
import { AppContext, GeodeApp } from "@app/AppContext";
import { loadObsidianPlugins, obsidianLoadReport } from "@compat/obsidian/loader";
import {
  initObsidianCss,
  obsidianCssState,
  setObsidianCssEnabled,
  setObsidianSnippet,
  setObsidianTheme,
} from "@compat/obsidian/themes";
import {
  CommandRegistry,
  formatHotkey,
  isMacPlatform,
  matchParsedHotkey,
  normalizeHotkey,
  parseHotkey,
  type KeyEventLike,
} from "@core/commands";
import { t } from "@core/i18n";
import { DocumentManager } from "@core/documents";
import { EventBus } from "@core/events";
import { renameWithLinkUpdate, type LinkRewriteResult } from "@core/linkRewrite";
import { renameTagAcrossVault, type TagRewriteResult } from "@core/tagRewrite";
import {
  formatLink,
  setLinkPathFormat,
  setLinkUseMarkdown,
  type LinkPathFormat,
} from "@core/linkFormat";
import { editorExtensionsRevision, getEditorExtensions, registerEditorExtension } from "@core/editorExtensions";
import {
  hasCodeBlockProcessor,
  registerCodeBlockProcessor as registerCoreCodeBlockProcessor,
  type MarkdownPostProcessor,
  registerMarkdownPostProcessor as registerCoreMdPostProcessor,
  RenderChildOwner,
} from "@core/markdownPostProcessors";
import { MarkdownRenderChild } from "@compat/obsidian/component";
import { Menu } from "@compat/obsidian/ui";
import { renamePropertyAcrossVault, type PropertyRewriteResult } from "@core/propertyRewrite";
import {
  deriveMentionTerms,
  findUnlinkedMentions,
  linkAllMentionsInFile,
  linkOneMention,
  type MentionLinkResult,
  type MentionSpan,
} from "@core/unlinkedMentions";
import { MetadataIndex, getCssClasses } from "@core/metadata";
import { runQueryBlock } from "@core/queryEmbed";
import { parseSearchQuery, evaluateSearch, type SearchInput } from "@core/search";
import { PluginManager } from "@core/plugins";
import { propertyTypes, buildRemoveProperty } from "@core/properties";
import { bookmarks, type BookmarkItem } from "@core/bookmarks";
import {
  initWorkspaces,
  saveWorkspaceLayout,
  deleteWorkspaceLayout,
  getWorkspaceLayout,
  listWorkspaceNames,
} from "@core/workspaces";
import { initSnapshots, recordSnapshot, listSnapshots, restoreSnapshot } from "@core/snapshots";
import { applyAppearanceSettings, setReadableLineLength, setSpellcheckEnabled, setAccentColor, sanitizeFontFamily, setInterfaceFont, setTextFont, setMonospaceFont, setDefaultNewTabMode, setTabIndentSize, setIndentUsingTabs, tabIndentSize, indentUsingTabs, setShowInlineTitle, setShowRibbon, showInlineTitle, showRibbon, setShowTabTitleBar, setShowStatusBar, showTabTitleBar, showStatusBar } from "@core/appearance";
import { EditorSelection, EditorState } from "@codemirror/state";
import { copyLineDown, copyLineUp, indentLess, indentMore, insertBlankLine, moveLineDown, moveLineUp, selectLine, toggleComment } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { renderMarkdownToHtml } from "@core/markdown";
import { markdownWrapInput, type WrapEdit } from "@core/bracketWrap";
import { searchHeadings, searchBlocks, switcherMode, stripSigil } from "@core/switcherSearch";
import { applyFormatOp, type FormatEdit, type FormatOp } from "@core/format";
import { basename, isTauri, MemoryVaultAdapter, TauriVaultAdapter, Vault, sortTreeNodes } from "@core/vault";
import { dailyStamp, dailyNotePath, parseDailyStamp, monthGrid, setDailyNoteFormat, setDailyNoteFolder } from "@core/dailyNote";
import { uniqueNoteName, uniqueNotePathPreview, setUniqueNoteFormat, setUniqueNoteFolder } from "@core/uniqueNote";
import { deriveNoteName, extractedContent, extractReplacement } from "@core/noteComposer";
import { mergeNotes } from "@core/noteMerge";
import { resolveDropTarget, wouldCollide } from "@core/explorerMove";
import { loadFoldInfo, saveFoldInfo, type FoldInfo } from "@core/foldStore";
import { parseObsidianUri } from "@core/obsidianUri";
import { slashCandidates, slashTrigger } from "@features/editor/slashCommands";
import { tagCandidates, tagTrigger } from "@features/editor/tagCompletion";
import { installSearchProbe } from "@features/editor/searchCommands";
import { handleObsidianUri } from "@features/editor/obsidianUriHandler";
import { markdownFoldRange } from "@features/editor/folding";
import { findTableRanges } from "@features/editor/liveTables";
import { findMermaidRanges } from "@features/editor/liveMermaid";
import { findMathBlockRanges } from "@features/editor/liveMath";
import { splitSlides } from "@features/slides";
import { indentUnitString, wikilinkHeadingTargets, wikilinkAttachmentCandidates, wikilinkBlockTargets } from "@features/editor/cmExtensions";
import { hydrateCodeCopy } from "@features/editor/codeCopy";
import { setExcludedFiles, isExcluded } from "@core/excludedFiles";
import { moveTargets } from "@core/explorerMove";
import { buildParagraph } from "@features/backlinks/BacklinksPanel";
import { buildTagGraph, buildAttachmentGraph } from "@features/graph/graphPrefs";
import { isAttachmentPath, isImagePath, mediaKind, mediaMime } from "@core/attachments";
import { blockRefAt } from "@core/blockId";
import { sortResults } from "@features/search/SearchPanel";
import { applyGraphFilters, nodeGroupColor, parseGraphPrefs, localSubgraph, localEdges, loadPrefs as loadGraphPrefs, type GraphPrefs } from "@features/graph/graphPrefs";
import { Workspace, resolveTheme, tabIdsToClose } from "@core/workspace";
import { sortAndFilterLinks } from "@core/linkPanel";
import { setNewNoteLocation, setNewNoteFolder, resolveNewNoteFolder, createNewNote } from "@core/newNote";
import type { ThemeKind } from "@core/types";
import { BUILTIN_PLUGINS } from "./plugins";
import "./styles/app.css";

/* ---------------- top-level error boundary ---------------- */

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[geode] render crashed", error, info);
  }

  private clearAndReload = () => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("geode.")) keys.push(key);
      }
      for (const key of keys) localStorage.removeItem(key);
    } catch {
      /* storage unavailable — still reload */
    }
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          data-testid="app-error"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            height: "100vh",
            padding: "24px",
            textAlign: "center",
            background: "var(--bg-app, #1e1e1e)",
            color: "var(--text-normal, #ddd)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "20px" }}>{t("app.errorTitle")}</h1>
          <p style={{ margin: 0, color: "var(--text-muted, #999)", maxWidth: "48ch" }}>
            {t("app.errorBody")}
          </p>
          <pre
            style={{
              margin: 0,
              padding: "8px 12px",
              maxWidth: "80ch",
              overflow: "auto",
              fontSize: "12px",
              color: "var(--text-muted, #999)",
              border: "1px solid var(--border, #444)",
              borderRadius: "6px",
            }}
          >
            {this.state.error.message}
          </pre>
          <button onClick={this.clearAndReload}>{t("app.errorClear")}</button>
        </div>
      );
    }
    return this.props.children;
  }
}

async function bootstrap() {
  const events = new EventBus();
  const adapter = isTauri() ? new TauriVaultAdapter() : new MemoryVaultAdapter();
  const vault = new Vault(adapter, events);
  const metadata = new MetadataIndex(vault, events);
  const workspace = new Workspace(events);
  const commands = new CommandRegistry();
  const documents = new DocumentManager(vault, events);
  const plugins = new PluginManager({ vault, metadata, workspace, commands, events, documents });

  const app: GeodeApp = {
    vault,
    metadata,
    workspace,
    commands,
    events,
    plugins,
    documents,
    // app layer hands the compat load report to feature modules (no direct
    // @compat imports below the app layer)
    obsidianLoadReport,
    // Obsidian theme/snippet CSS layer handle (R20, same hand-over pattern)
    obsidianCss: {
      state: obsidianCssState,
      setEnabled: setObsidianCssEnabled,
      setTheme: setObsidianTheme,
      setSnippet: setObsidianSnippet,
    },
  };

  workspace.applyDocumentEffects();
  workspace.watchSystemTheme(); // R79: re-resolve "system" theme on OS scheme flip
  // close-time flushing covers every open document (single source of dirty state)
  workspace.registerFlusher(() => documents.flushAll());

  // expose the plugin API for external extension (the "extensibility story")
  (window as unknown as Record<string, unknown>).geode = {
    app,
    registerPlugin: (p: Parameters<PluginManager["register"]>[0]) => plugins.register(p),
  };

  // always-on rename probe: lets browser/desktop E2E drive the R16 link
  // rewrite engine directly (same pattern as __geodeFireWatch / __geodeWatchEcho)
  const probeHost = globalThis as unknown as {
    __geodeRename?: (oldPath: string, newPath: string) => Promise<LinkRewriteResult>;
  };
  probeHost.__geodeRename = (oldPath, newPath) =>
    renameWithLinkUpdate({ vault, metadata, documents }, oldPath, newPath);

  // always-on link-format probe (R72, ㉞-c): set the link-format settings then
  // build a link, so browser/desktop E2E can assert every wiki/markdown ×
  // shortest/relative/absolute × embed combination deterministically.
  const linkFmtHost = globalThis as unknown as {
    __geodeFormatLink?: (
      targetPath: string,
      fromPath: string,
      opts?: { useMarkdown?: boolean; pathFormat?: LinkPathFormat; embed?: boolean; alias?: string },
    ) => string | null;
  };
  linkFmtHost.__geodeFormatLink = (targetPath, fromPath, opts) => {
    if (opts?.useMarkdown !== undefined) setLinkUseMarkdown(opts.useMarkdown);
    if (opts?.pathFormat !== undefined) setLinkPathFormat(opts.pathFormat);
    return formatLink(metadata, targetPath, fromPath, { embed: opts?.embed, alias: opts?.alias });
  };

  // always-on editor-extension probe (R115): register a marker CM6 extension via the SAME core
  // path Plugin.registerEditorExtension uses (editorAttributes adds an attr to every .cm-editor),
  // so browser/desktop E2E can assert it reaches open + new editor views and the disposer removes it.
  const editorExtHost = globalThis as unknown as {
    __geodeRegisterEditorExtension?: (attr: string, value: string) => () => void;
    __geodeEditorExtState?: () => { count: number; rev: number };
  };
  editorExtHost.__geodeRegisterEditorExtension = (attr, value) =>
    registerEditorExtension(EditorView.editorAttributes.of({ [attr]: value }));
  // sync registry observer for the desktop probe (view integration is browser-E2E only, §D)
  editorExtHost.__geodeEditorExtState = () => ({ count: getEditorExtensions().length, rev: editorExtensionsRevision.get() });

  // R132: always-on hook for the reading-view markdown-post-processor registry (the path
  // Plugin.registerMarkdownPostProcessor routes through), so E2E can register a processor + assert
  // it runs on the freshly-rendered .preview-content and the disposer removes it.
  const mdPpHost = globalThis as unknown as {
    __geodeRegisterMarkdownPostProcessor?: (fn: MarkdownPostProcessor, sortOrder?: number) => () => void;
    __geodeRegisterMarkdownCodeBlockProcessor?: (
      lang: string,
      handler: (source: string, el: HTMLElement, ctx: unknown) => void | Promise<void>,
      sortOrder?: number,
    ) => () => void;
    __geodeHasCodeBlockProcessor?: (lang: string) => boolean;
  };
  mdPpHost.__geodeRegisterMarkdownPostProcessor = registerCoreMdPostProcessor;
  // R133/R134: same core dual-registration Plugin.registerMarkdownCodeBlockProcessor routes through —
  // populates BOTH the reading-view post-processor AND the live-preview lang→handler map, so E2E
  // exercises both. Returns the disposer (removes both).
  mdPpHost.__geodeRegisterMarkdownCodeBlockProcessor = (lang, handler, sortOrder) =>
    registerCoreCodeBlockProcessor(lang, handler, sortOrder).dispose;
  // R134: the live-preview lang→handler registry lookup — a §D-safe (synchronous, App-Nap-immune)
  // desktop probe of whether the registration actually populated the live map on the real binary.
  mdPpHost.__geodeHasCodeBlockProcessor = hasCodeBlockProcessor;

  // R135: §D-safe synchronous probe of the addChild lifecycle — the real ctx path needs a render
  // (App-Nap-throttled headless), but RenderChildOwner + MarkdownRenderChild load/unload run
  // synchronously, so the desktop probe can verify the new lifecycle works on the shipped binary.
  const rcHost = globalThis as unknown as {
    __geodeProbeRenderChild?: () => { afterAdd: string[]; afterUnload: string[] };
  };
  rcHost.__geodeProbeRenderChild = () => {
    const log: string[] = [];
    const owner = new RenderChildOwner();
    const child = new MarkdownRenderChild(document.createElement("div"));
    child.onload = () => log.push("load");
    child.onunload = () => log.push("unload");
    owner.addChild(child); // loads immediately → "load"
    const afterAdd = [...log];
    owner.unload(); // → "unload"
    return { afterAdd, afterUnload: [...log] };
  };

  // R144: §D-safe synchronous probe of the new compat Menu methods (static forEvent +
  // setParentElement). Exercises the modern context-menu idiom end-to-end on the shipped
  // binary: Menu.forEvent(evt) → addItem/onClick → show → click the item → callback fires.
  const menuHost = globalThis as unknown as {
    __geodeMenuProbe?: () => { isMenu: boolean; chainable: boolean; shown: boolean; fired: boolean };
  };
  menuHost.__geodeMenuProbe = () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const evt = new MouseEvent("contextmenu", { clientX: 12, clientY: 12 });
    Object.defineProperty(evt, "target", { value: host, configurable: true });
    let fired = false;
    let isMenu = false;
    let chainable = false;
    let shown = false;
    try {
      const menu = Menu.forEvent(evt); // parents to host (an HTMLElement)
      isMenu = menu instanceof Menu;
      chainable = menu.setParentElement(host) === menu;
      menu.addItem((item) => item.setTitle("R144 Probe").onClick(() => { fired = true; }));
      menu.showAtMouseEvent(evt);
      const item = menu.dom.querySelector<HTMLElement>("[data-testid='compat-menu-item']");
      shown = item !== null && document.body.contains(menu.dom);
      item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      menu.hide();
    } finally {
      host.remove();
    }
    return { isMenu, chainable, shown, fired };
  };

  // always-on tag-rename probe (R69, ㉝): drive the real-fs vault-wide tag
  // rewrite engine directly from browser/desktop E2E (WKWebView has no CDP).
  // Distinct key from __geodeRename (file rename) and __geodeTag (R-?? tag
  // completion) — R68 naming-collision lesson.
  const tagRenameHost = globalThis as unknown as {
    __geodeRenameTag?: (oldTag: string, newTag: string) => Promise<TagRewriteResult>;
  };
  tagRenameHost.__geodeRenameTag = (oldTag, newTag) =>
    renameTagAcrossVault({ vault, metadata, documents }, oldTag, newTag);

  // always-on unlinked-mentions probe (R24): drive the matcher + link engine
  // directly from browser/desktop E2E (WKWebView has no CDP — desktop verifies
  // the real-fs write path through this hook; same pattern as __geodeRename)
  const unlinkedHost = globalThis as unknown as {
    __geodeUnlinked?: {
      find: (sourcePath: string, activePath: string) => Promise<MentionSpan[]>;
      linkAll: (activePath: string, sourcePath: string) => Promise<MentionLinkResult>;
      linkOne: (
        activePath: string,
        sourcePath: string,
        target: MentionSpan,
      ) => Promise<MentionLinkResult>;
    };
  };
  unlinkedHost.__geodeUnlinked = {
    find: async (sourcePath, activePath) => {
      const am = metadata.getMetadata(activePath);
      const sm = metadata.getMetadata(sourcePath);
      if (!am || !sm) return [];
      const content = await vault.read(sourcePath);
      return findUnlinkedMentions(content, sm, deriveMentionTerms(am));
    },
    linkAll: (activePath, sourcePath) =>
      linkAllMentionsInFile({ vault, metadata, documents }, activePath, sourcePath),
    linkOne: (activePath, sourcePath, target) =>
      linkOneMention({ vault, metadata, documents }, activePath, sourcePath, target),
  };

  // always-on hover-preview probe (R25): drive the real-fs page-preview render
  // path from browser/desktop E2E (WKWebView has no CDP — desktop verifies the
  // render through this hook; same pattern as __geodeRename / __geodeUnlinked).
  // Resolves the raw target relative to sourcePath, reads the resolved note and
  // returns the rendered HTML; unresolved → null (no "uncreated" card).
  const hoverHost = globalThis as unknown as {
    __geodeHover?: (rawTarget: string, sourcePath: string) => Promise<string | null>;
  };
  hoverHost.__geodeHover = async (rawTarget, sourcePath) => {
    const path = metadata.resolveLink(rawTarget, sourcePath);
    if (!path) return null;
    const content = await vault.read(path);
    return renderMarkdownToHtml(content, (tg) => metadata.resolveLink(tg, path), {
      noteEmbeds: true,
    });
  };

  // always-on byte-level render probe: renders an ARBITRARY markdown source
  // string through the exact reading-view pipeline (resolve link + resolve
  // attachment + noteEmbeds), returning the raw HTML string. This is the
  // byte-level regression surface for core/markdown.ts changes (the rebuilt
  // r18-diff equivalent — see .calibration/r26-bytes.mjs): snapshot a corpus,
  // change the pipeline, diff. sourcePath defaults to "" (vault root context).
  const renderHost = globalThis as unknown as {
    __geodeRenderMarkdown?: (source: string, sourcePath?: string, strictLineBreaks?: boolean, sourcePos?: boolean) => string;
  };
  renderHost.__geodeRenderMarkdown = (source, sourcePath = "", strict = false, sourcePos = false) =>
    renderMarkdownToHtml(
      source,
      (tg) => metadata.resolveLink(tg, sourcePath),
      {
        noteEmbeds: true,
        resolveEmbed: (tg) => metadata.resolveAttachment(tg, sourcePath),
        resolveMdLink: (href) => metadata.resolveMarkdownLink(href, sourcePath),
        strictLineBreaks: strict,
        sourcePos, // R136: opt-in data-line emission (off by default → r26-bytes corpus unaffected)
      },
    );

  // always-on cssclasses probe (R73, ㊼): reads a real-fs note and returns the
  // CSS class tokens its frontmatter (cssclasses / legacy cssclass) contributes
  // to the note view container. DOM application is browser-E2E only — App-Nap
  // makes WKWebView DOM reads unreliable (§D); this proves the real-fs
  // frontmatter → tokens path. Same pattern as __geodeRenderMarkdown.
  const cssClassHost = globalThis as unknown as {
    __geodeCssClasses?: (path: string) => Promise<string[]>;
  };
  cssClassHost.__geodeCssClasses = async (path) => getCssClasses(await vault.read(path));

  // always-on slides probe (R74, ㊱): reads a real-fs note and returns the slide
  // sources splitSlides produces (frontmatter stripped, fences respected). The
  // overlay DOM (mount/nav/counter) is browser-E2E only — App-Nap makes WKWebView
  // DOM reads unreliable (§D); this proves the real-fs split path. Same pattern
  // as __geodeCssClasses.
  const slidesHost = globalThis as unknown as {
    __geodeSplitSlides?: (path: string) => Promise<string[]>;
  };
  slidesHost.__geodeSplitSlides = async (path) => splitSlides(await vault.read(path));

  // always-on block-ref probe (R77, ㊴): runs blockRefAt over a note's real-fs
  // text at a cursor offset and returns the minted/reused id + edit. The command
  // (clipboard + CM dispatch) is browser-E2E only (§D); this proves the real-fs
  // mint path. Same pattern as __geodeSplitSlides.
  const blockRefHost = globalThis as unknown as {
    __geodeBlockRef?: (path: string, offset: number) => Promise<ReturnType<typeof blockRefAt>>;
  };
  blockRefHost.__geodeBlockRef = async (path, offset) => blockRefAt(await vault.read(path), offset);

  // always-on graph-prefs probe (R78, ㊵): parse/clamp/backward-compat validation
  // of a raw localStorage blob (or the live one). The settings-panel DOM + canvas
  // are browser-E2E only (§D); this proves the prefs validation in the real build.
  const graphPrefsHost = globalThis as unknown as {
    __geodeGraphPrefs?: (raw?: string) => GraphPrefs;
  };
  graphPrefsHost.__geodeGraphPrefs = (raw) =>
    raw !== undefined ? parseGraphPrefs(raw) : loadGraphPrefs();

  // always-on graph-filter probe (R84, ㊵): runs the pure applyGraphFilters over
  // minimal {id,resolved} nodes + {source,target} edges, returns the kept node ids.
  const graphFilterHost = globalThis as unknown as {
    __geodeGraphFilter?: (
      nodes: { id: string; resolved: boolean }[],
      edges: { source: string; target: string }[],
      filters: { orphans: boolean; existingOnly: boolean },
    ) => string[];
  };
  graphFilterHost.__geodeGraphFilter = (nodes, edges, filters) =>
    applyGraphFilters(nodes, edges, filters).nodes.map((n) => n.id);

  // always-on graph-group-color probe (R90, ㊵): runs the pure nodeGroupColor over
  // a {id,label} node + groups, returning the colour the node would be filled with.
  const graphGroupHost = globalThis as unknown as {
    __geodeGraphGroupColor?: (
      node: { id: string; label: string },
      groups: { query: string; color: string }[],
      defaultColor: string,
    ) => string;
  };
  graphGroupHost.__geodeGraphGroupColor = (node, groups, defaultColor) =>
    nodeGroupColor(node, groups, defaultColor);

  // always-on font-sanitize probe (R85, ㊺): runs the pure CSS-injection guard
  // over a raw font name. The settings inputs + DOM are browser-E2E only (§D).
  const fontHost = globalThis as unknown as { __geodeFontSanitize?: (raw: string) => string };
  fontHost.__geodeFontSanitize = (raw) => sanitizeFontFamily(raw);

  // always-on explorer-sort probe (R91, ㊽): runs the pure sortTreeNodes over a
  // mixed {kind,name} list and returns the ordered names. The tree DOM is browser-E2E only.
  const sortTreeHost = globalThis as unknown as {
    __geodeSortTree?: (
      nodes: { kind: "file" | "folder"; name: string }[],
      sortKey: "name-asc" | "name-desc",
    ) => string[];
  };
  sortTreeHost.__geodeSortTree = (nodes, sortKey) =>
    sortTreeNodes(nodes, sortKey).map((n) => n.name);

  // always-on new-note-folder probe (R89, ㊽): runs the pure resolveNewNoteFolder
  // for each location setting (root / current / specified) against an active path.
  const newNoteHost = globalThis as unknown as {
    __geodeNewNoteFolder?: (loc: "root" | "current" | "folder", folder: string, activePath: string | null) => string;
  };
  newNoteHost.__geodeNewNoteFolder = (loc, folder, activePath) => {
    setNewNoteLocation(loc);
    setNewNoteFolder(folder);
    return resolveNewNoteFolder(activePath);
  };
  // end-to-end create probe: exercises createNewNote (folder-ensure + uniquePath +
  // create) and returns the path it landed at.
  const createNoteHost = globalThis as unknown as {
    __geodeCreateNewNote?: (name: string) => Promise<string>;
  };
  createNoteHost.__geodeCreateNewNote = (name) =>
    createNewNote(app.vault, name, app.workspace.getActiveFile());

  // always-on new-tab-mode probe (R88, ㊶ 续): proves workspace.openFile honours
  // the defaultNewTabMode setting on the real build (a new tab opens in that mode).
  const newTabModeHost = globalThis as unknown as {
    __geodeNewTabMode?: (mode: "live" | "source" | "preview", path: string) => string | undefined;
  };
  newTabModeHost.__geodeNewTabMode = (mode, path) => {
    setDefaultNewTabMode(mode);
    app.workspace.openFile(path, { newTab: true });
    return app.workspace.getActiveTab()?.mode;
  };

  // always-on file-properties-remove probe (R86, ㊼): exercises the EXACT write
  // the right-side FilePropertiesPanel does (acquire shared handle + buildRemoveProperty
  // → applyExternalEdits), proving the second-writer delete path on the real fs build.
  const filePropsHost = globalThis as unknown as {
    __geodeFilePropsRemove?: (path: string, key: string) => Promise<{ before: string; after: string }>;
  };
  filePropsHost.__geodeFilePropsRemove = async (path, key) => {
    const handle = await app.documents.acquire(path);
    try {
      const before = handle.getText();
      const edit = buildRemoveProperty(before, key);
      if (edit) handle.applyExternalEdits([edit]);
      return { before, after: handle.getText() };
    } finally {
      handle.release();
    }
  };

  // always-on search-sort probe (R80, ㊸): runs the pure sortResults over minimal
  // result items and returns the sorted basenames. The toolbar DOM is browser-E2E
  // only (§D); this proves the sort logic in the real build.
  const searchSortHost = globalThis as unknown as {
    __geodeSearchSort?: (
      items: { basename: string; nameMatch: boolean; total: number }[],
      key: "relevance" | "name-asc" | "name-desc" | "count-desc" | "count-asc",
    ) => string[];
  };
  searchSortHost.__geodeSearchSort = (items, key) => sortResults(items, key).map((r) => r.basename);

  // always-on indent-config probe (R92, ㊶ 续续): applies the indentation settings
  // through the real setters (clamp + persist) and returns the resolved unit string
  // Tab inserts. The live-CM reconfigure (view.state.facet(indentUnit)) is browser-E2E
  // only (§D timing: the reconfigure rides a React effect); this proves the setter +
  // clamp + pure unit derivation on the real WKWebView build.
  const indentHost = globalThis as unknown as {
    __geodeIndentConfig?: (size: number, useTabs: boolean) => {
      size: number;
      useTabs: boolean;
      unit: string;
    };
  };
  indentHost.__geodeIndentConfig = (size, useTabs) => {
    setTabIndentSize(size);
    setIndentUsingTabs(useTabs);
    return {
      size: tabIndentSize.get(),
      useTabs: indentUsingTabs.get(),
      unit: indentUnitString(tabIndentSize.get(), indentUsingTabs.get()),
    };
  };

  // always-on explorer-copy probe (R93, ㊽ 续续): mirrors the Explorer "Make a copy"
  // vault throat (uniquePath → readBinary → createBinary) on the REAL fs and asserts
  // the copy is byte-identical to the source. The context-menu DOM is browser-E2E only
  // (§D); this proves the duplicate write path lands a faithful copy on disk.
  const copyHost = globalThis as unknown as {
    __geodeExplorerCopy?: (path: string) => Promise<{ dest: string; sameBytes: boolean; len: number }>;
  };
  copyHost.__geodeExplorerCopy = async (path) => {
    const slash = path.lastIndexOf("/");
    const dot = path.lastIndexOf(".");
    const folder = slash >= 0 ? path.slice(0, slash) : "";
    const base = (slash >= 0 ? path.slice(slash + 1) : path).replace(/\.[^.]+$/, "");
    const ext = dot > slash ? path.slice(dot + 1) : "";
    const dest = vault.uniquePath(folder, base, ext);
    const data = await vault.readBinary(path);
    await vault.createBinary(dest, data);
    const copy = await vault.readBinary(dest);
    const sameBytes = data.length === copy.length && data.every((b, i) => b === copy[i]);
    return { dest, sameBytes, len: data.length };
  };

  // always-on code-copy probe (R95, ㊶ 续续): runs the hydrateCodeCopy pass over an
  // HTML fragment and returns how many copy buttons it adds — proving the pre>code
  // matching logic (code fences get buttons; mermaid/query/non-code pre do not) on the
  // real WKWebView build. The actual click→clipboard is browser-E2E only (§D).
  const codeCopyHost = globalThis as unknown as { __geodeCodeCopy?: (html: string) => number };
  codeCopyHost.__geodeCodeCopy = (html) => {
    const div = document.createElement("div");
    div.innerHTML = html;
    hydrateCodeCopy(div);
    return div.querySelectorAll(".code-copy-button").length;
  };

  // always-on excluded-files probe (R96, ㊽ 续续续): sets the patterns + returns whether
  // a path is excluded — proving the glob/regex matching on the real WKWebView build.
  const excludedHost = globalThis as unknown as { __geodeExcluded?: (raw: string, path: string) => boolean };
  excludedHost.__geodeExcluded = (raw, path) => {
    setExcludedFiles(raw);
    return isExcluded(path);
  };

  // always-on move-targets probe (R97, ㊽ 续续续续): the valid folder targets the
  // "Move to…" picker offers for a path (excludes self/descendants + current parent),
  // proving the candidate enumeration on the real tree. The picker DOM + the actual move
  // (vetted moveNode/renameWithLinkUpdate, R28-probed) are browser-E2E only (§D).
  const moveHost = globalThis as unknown as { __geodeMoveFolders?: (fromPath: string) => string[] };
  moveHost.__geodeMoveFolders = (fromPath) => {
    const tree = vault.tree.get();
    return tree ? moveTargets(tree, fromPath) : [];
  };

  // always-on backlink-paragraph probe (R98, ㊷ 续): the "Show more context" paragraph
  // boundary logic (blank-line-delimited block around an offset). The panel DOM + the
  // toggle are browser-E2E only (§D); this proves the pure boundary math on the real build.
  const paraHost = globalThis as unknown as { __geodeBacklinkParagraph?: (content: string, from: number) => string };
  paraHost.__geodeBacklinkParagraph = (content, from) => buildParagraph(content, from).text;

  // always-on tags-as-graph-nodes probe (R99, ㊵ 续续续): runs the pure buildTagGraph over
  // the REAL tag index + all note paths, returning the tag node ids + edge count — proving
  // the tag-graph construction on the real build. The draw colour + toggle are browser-E2E
  // only (§D). Tag node ids are `tag:<name>` (id-encoding convention, like `unresolved:`).
  const tagGraphHost = globalThis as unknown as {
    __geodeGraphTags?: () => { nodes: { id: string; degree: number }[]; edges: number };
  };
  tagGraphHost.__geodeGraphTags = () => {
    const kept = new Set(vault.getMarkdownFiles().map((f) => f.path));
    const { nodes, edges } = buildTagGraph(app.metadata.getTagMap(), kept);
    return { nodes: nodes.map((n) => ({ id: n.id, degree: n.degree })), edges: edges.length };
  };

  // always-on attachments-as-graph-nodes probe (R101, ㊵ 续续续续): runs the pure
  // buildAttachmentGraph over the REAL attachment index (note→attachment refs from
  // meta.links) + all note paths, returning the attachment node ids + edge count. The
  // draw colour + toggle + click→openFile are browser-E2E only (§D). Node ids are
  // `attachment:<vault-path>` (id-encoding convention, like `tag:` / `unresolved:`).
  const attachmentGraphHost = globalThis as unknown as {
    __geodeGraphAttachments?: () => { nodes: { id: string; degree: number }[]; edges: number };
  };
  attachmentGraphHost.__geodeGraphAttachments = () => {
    const kept = new Set(vault.getMarkdownFiles().map((f) => f.path));
    const { nodes, edges } = buildAttachmentGraph(app.metadata.getAttachmentMap(), kept);
    return { nodes: nodes.map((n) => ({ id: n.id, degree: n.degree })), edges: edges.length };
  };

  // always-on local-subgraph probe (R103, ㊵ 续续续续续): runs the pure localSubgraph over
  // {source,target} edges from an anchor, honoring depth + incoming/outgoing direction
  // toggles, returning the reachable node-id set. The depth select + toggles are
  // browser-E2E only (§D); this proves the direction-aware BFS on the real build.
  const graphLocalHost = globalThis as unknown as {
    __geodeGraphLocal?: (
      edges: { source: string; target: string }[],
      anchor: string,
      depth: number,
      dirs: { outgoing: boolean; incoming: boolean },
    ) => string[];
  };
  graphLocalHost.__geodeGraphLocal = (edges, anchor, depth, dirs) =>
    [...localSubgraph(edges, anchor, depth, dirs)];

  // always-on neighbor-links edge-filter probe (R110, ㊵ 续): runs the pure localEdges over
  // {source,target} edges + a kept-id set, returning the rendered edges — proves the
  // neighbor-links OFF filter (drop edges between two non-anchor nodes) on the real build.
  const localEdgesHost = globalThis as unknown as {
    __geodeLocalEdges?: (
      edges: { source: string; target: string }[],
      keptIds: string[],
      anchor: string | null,
      neighborLinks: boolean,
    ) => { source: string; target: string }[];
  };
  localEdgesHost.__geodeLocalEdges = (edges, keptIds, anchor, neighborLinks) =>
    localEdges(edges, new Set(keptIds), anchor, neighborLinks);

  // always-on attachment-routing probe (R102, ㊽ 续续续续续): runs the pure isAttachmentPath/
  // isImagePath classification on the real build, returning per-path {isAttachment,isImage}.
  // The viewer DOM + open→viewType are browser-E2E only (§D); this proves the routing
  // predicate (the data-safety boundary deciding md-editor vs read-only viewer) on the bin.
  const attachmentRouteHost = globalThis as unknown as {
    __geodeAttachmentRouting?: (paths: string[]) => { path: string; isAttachment: boolean; isImage: boolean }[];
  };
  attachmentRouteHost.__geodeAttachmentRouting = (paths) =>
    paths.map((p) => ({ path: p, isAttachment: isAttachmentPath(p), isImage: isImagePath(p) }));

  // always-on wikilink block-completion probe (R109, ㊹ 续): runs the async
  // wikilinkBlockTargets — given a typed `[[<note>#^<query>` body + a from-path, returns each
  // block's {id, text preview}. The CM autocomplete DOM is browser-E2E only (§D); this proves
  // the resolve + note-read + preview on the real build + fs.
  const blockCompleteHost = globalThis as unknown as {
    __geodeBlockComplete?: (typed: string, fromPath: string | null) => Promise<{ id: string; text: string }[] | null>;
  };
  blockCompleteHost.__geodeBlockComplete = (typed, fromPath) => wikilinkBlockTargets(app, typed, fromPath);

  // always-on wikilink heading-completion probe (R107, ㊹ 续): runs the pure
  // wikilinkHeadingTargets — given a typed `[[<note>#<query>` body + a from-path, returns the
  // heading labels offered (resolved note's headings, unsafe-char filtered). The CM
  // autocomplete DOM is browser-E2E only (§D); this proves the resolve+lookup on the bin.
  const headingCompleteHost = globalThis as unknown as {
    __geodeHeadingComplete?: (typed: string, fromPath: string | null) => string[] | null;
  };
  headingCompleteHost.__geodeHeadingComplete = (typed, fromPath) =>
    wikilinkHeadingTargets(app, typed, fromPath)?.map((h) => h.text) ?? null;

  // always-on wikilink attachment-candidate probe (R108, ㊹ 续续): runs the pure
  // wikilinkAttachmentCandidates over the REAL file list — proves which non-md attachments
  // the `[[` completion offers + their insert text (name vs full path by ambiguity). The CM
  // autocomplete DOM is browser-E2E only (§D).
  const wikiAttachHost = globalThis as unknown as {
    __geodeWikilinkAttachments?: (absolute: boolean) => { name: string; linkText: string }[];
  };
  wikiAttachHost.__geodeWikilinkAttachments = (absolute) =>
    wikilinkAttachmentCandidates(vault.getFiles(), absolute).map((c) => ({ name: c.file.name, linkText: c.linkText }));

  // always-on alias-map probe (R106, ㉟ 续): returns the REAL frontmatter-alias index
  // (path → aliases) — proves aliases are parsed + enumerated on the real build, which is
  // what the `[[` autocomplete + QuickSwitcher surface. The completion/switcher DOM is
  // browser-E2E only (§D).
  const aliasMapHost = globalThis as unknown as {
    __geodeAliasMap?: () => Record<string, string[]>;
  };
  aliasMapHost.__geodeAliasMap = () => Object.fromEntries(app.metadata.getAliasMap());

  // always-on media-kind probe (R104, ㊽ 续续续续续续): runs the pure mediaKind/mediaMime
  // classification on the real build, returning per-path {kind, mime} — proves which inline
  // preview (image/audio/video/pdf/other) the attachment view renders. The <audio>/<video>/
  // <embed> DOM is browser-E2E only (§D).
  const mediaKindHost = globalThis as unknown as {
    __geodeMediaKind?: (paths: string[]) => { path: string; kind: string; mime: string }[];
  };
  mediaKindHost.__geodeMediaKind = (paths) =>
    paths.map((p) => ({ path: p, kind: mediaKind(p), mime: mediaMime(p) }));

  // always-on tab-close probe (R81, ㊿): runs the pure tabIdsToClose (which tabs a
  // close-others/right/all action removes, skipping pinned). The menu DOM is
  // browser-E2E only (§D); this proves the close-set logic in the real build.
  const tabCloseHost = globalThis as unknown as {
    __geodeTabsToClose?: (
      tabs: { id: string; pinned?: boolean }[],
      targetId: string,
      mode: "others" | "right" | "all",
    ) => string[];
  };
  tabCloseHost.__geodeTabsToClose = (tabs, targetId, mode) => tabIdsToClose(tabs, targetId, mode);

  // always-on link-panel probe (R82, ㊷): runs the pure sortAndFilterLinks over
  // minimal {name} rows and returns the kept names in order. The backlinks /
  // outgoing toolbars are browser-E2E only (§D); this proves the logic in the build.
  const linkPanelHost = globalThis as unknown as {
    __geodeLinkSortFilter?: (
      items: { name: string }[],
      sortKey: "default" | "name-asc" | "name-desc",
      filter: string,
    ) => string[];
  };
  linkPanelHost.__geodeLinkSortFilter = (items, sortKey, filter) =>
    sortAndFilterLinks(items, (x) => x.name, sortKey, filter).map((x) => x.name);

  // always-on query-embed probe (R75, ㊲): runs a ```query block body against the
  // real-fs vault and returns the structured result (total + matched paths). The
  // result-list DOM render is browser-E2E only — App-Nap makes WKWebView DOM reads
  // unreliable (§D); this proves the real-fs search path. Same pattern as above.
  const queryHost = globalThis as unknown as {
    __geodeQueryBlock?: (raw: string) => Promise<{ error?: string; total: number; paths: string[] }>;
  };
  queryHost.__geodeQueryBlock = async (raw) => {
    const r = await runQueryBlock(raw, { vault, metadata });
    return { error: r.error, total: r.total, paths: r.files.map((f) => f.path) };
  };

  // always-on bookmarks probe (R27): drives the real-fs read/write path from
  // browser/desktop E2E (WKWebView has no CDP — same pattern as __geodeRename /
  // __geodeHover). reload() forces a fresh read from disk. Assigned BEFORE
  // loadExternal so an external plugin's onload can capture it synchronously.
  const bookmarksHost = globalThis as unknown as {
    __geodeBookmarks?: {
      list: () => ReadonlyArray<BookmarkItem>;
      toggleFile: (path: string) => Promise<void>;
      add: (item: BookmarkItem, groupPath?: ReadonlyArray<number>) => Promise<void>;
      move: (
        from: ReadonlyArray<number>,
        toGroup: ReadonlyArray<number>,
        toIndex: number,
      ) => Promise<void>;
      reload: () => Promise<void>;
    };
  };
  bookmarksHost.__geodeBookmarks = {
    list: () => bookmarks.items.get(),
    toggleFile: (path) => bookmarks.toggleFile(path),
    add: (item, groupPath) => bookmarks.add(item, groupPath),
    move: (from, toGroup, toIndex) => bookmarks.move(from, toGroup, toIndex),
    reload: () => bookmarks.init(vault),
  };

  // always-on named-workspace probe (R45): drives the real-fs
  // .obsidian/workspaces.json save/load round-trip + the workspace
  // capture/apply path from browser/desktop E2E (WKWebView has no CDP — same
  // pattern as __geodeBookmarks). Assigned BEFORE loadExternal so an external
  // plugin's onload can capture it synchronously.
  const wsHost = globalThis as typeof globalThis & {
    __geodeWorkspaces?: {
      save: (n: string) => void;
      load: (n: string) => void;
      list: () => string[];
      del: (n: string) => void;
    };
  };
  wsHost.__geodeWorkspaces = {
    save: (n) => {
      void saveWorkspaceLayout(app.vault, n, app.workspace.captureLayout());
    },
    load: (n) => {
      const l = getWorkspaceLayout(n);
      if (l != null) app.workspace.applyLayout(l, (p) => app.vault.fileExists(p));
    },
    list: () => listWorkspaceNames(),
    del: (n) => {
      void deleteWorkspaceLayout(app.vault, n);
    },
  };

  // always-on explorer drag-to-move probe (R28): drives the real-fs move
  // through the SAME decision core the Explorer drop handler uses
  // (resolveDropTarget + wouldCollide, single source of truth) + the R16 write
  // throat. WKWebView has no CDP, so desktop verifies the four guards + move
  // through this hook (same pattern as __geodeRename). Assigned BEFORE
  // loadExternal so an external plugin's onload can capture it synchronously.
  const explorerMoveHost = globalThis as unknown as {
    __geodeExplorerMove?: (
      fromPath: string,
      hoveredPath: string | null,
    ) => Promise<{
      moved: boolean;
      reason?: string;
      target?: string;
      linksRewritten?: number;
      filesChanged?: number;
      skipped?: number;
    }>;
  };
  explorerMoveHost.__geodeExplorerMove = async (fromPath, hoveredPath) => {
    const tree = vault.tree.get();
    if (!tree) return { moved: false, reason: "no-tree" };
    if (!vault.fileExists(fromPath) && !vault.folderExists(fromPath)) {
      return { moved: false, reason: "stale" };
    }
    const target = resolveDropTarget(tree, fromPath, hoveredPath);
    if (target === null) return { moved: false, reason: "invalid" };
    if (wouldCollide(tree, fromPath, target)) return { moved: false, reason: "collision" };
    const newPath = target ? `${target}/${basename(fromPath)}` : basename(fromPath);
    const result = await renameWithLinkUpdate({ vault, metadata, documents }, fromPath, newPath);
    return {
      moved: true,
      target: newPath,
      linksRewritten: result.linksRewritten,
      filesChanged: result.filesChanged,
      skipped: result.skipped.length,
    };
  };

  // always-on fold-persistence probe (R29): drives the localStorage save/load
  // round-trip from browser/desktop E2E (WKWebView has no CDP — same pattern as
  // __geodeBookmarks / __geodeExplorerMove). foldInfoFromState/foldRangesFromInfo
  // need a live EditorState so are exercised in-editor, not exposed raw here;
  // save/load round-trip is enough for the desktop probe. Assigned BEFORE
  // loadExternal so an external plugin's onload can capture it synchronously.
  const foldHost = globalThis as typeof globalThis & {
    __geodeFold?: {
      save: (path: string, info: FoldInfo) => void;
      load: (path: string) => FoldInfo | null;
    };
  };
  foldHost.__geodeFold = {
    save: (path, info) => saveFoldInfo(path, info),
    load: (path) => loadFoldInfo(path),
  };

  // always-on properties probe (R30): drives the real-fs global property rename
  // + the vault-wide aggregation queries from browser/desktop E2E (WKWebView has
  // no CDP — desktop verifies the multi-file frontmatter rewrite through this
  // hook; same pattern as __geodeRename / __geodeUnlinked). Assigned BEFORE
  // loadExternal so an external plugin's onload can capture it synchronously.
  const propertiesHost = globalThis as typeof globalThis & {
    __geodeProperties?: {
      rename: (oldKey: string, newKey: string) => Promise<PropertyRewriteResult>;
      values: (key: string) => string[];
      keyCounts: () => Array<[string, number]>;
    };
  };
  propertiesHost.__geodeProperties = {
    rename: (oldKey, newKey) =>
      renamePropertyAcrossVault({ vault, metadata, documents }, oldKey, newKey),
    values: (key) => metadata.getPropertyValues(key),
    keyCounts: () => [...metadata.getPropertyKeyCounts().entries()],
  };

  // always-on quick-switcher sub-mode probe (R38): exposes the PURE heading/block
  // search (core/switcherSearch) so browser/desktop E2E drive #/^ modes
  // deterministically (the live modal — typing # in a real QuickSwitcher — is
  // exercised by the browser E2E). Same pure-gate approach as __geodeFormat;
  // assigned BEFORE loadExternal.
  const switcherHost = globalThis as typeof globalThis & {
    __geodeSwitcher?: {
      mode: (q: string) => "file" | "heading" | "block";
      headings: (q: string) => Array<{ path: string; text: string; from: number }>;
      blocks: (q: string) => Array<{ path: string; id: string }>;
    };
  };
  switcherHost.__geodeSwitcher = {
    mode: (q) => switcherMode(q),
    headings: (q) =>
      searchHeadings(metadata.getAll(), stripSigil(q), workspace.getActiveFile()).map((h) => ({
        path: h.path, text: h.heading.text, from: h.heading.from,
      })),
    blocks: (q) =>
      searchBlocks(metadata.getAll(), stripSigil(q), workspace.getActiveFile()).map((b) => ({
        path: b.path, id: b.block.id,
      })),
  };

  // always-on slash-command probe (R31): drives the trigger gate + candidate
  // ranking from browser/desktop E2E (WKWebView has no CDP — same pattern as
  // __geodeRename). The full apply flow (type `/` → run command → delete query)
  // is exercised by the browser E2E in a real CM editor. Assigned BEFORE
  // loadExternal so an external plugin's onload can capture it synchronously.
  const slashHost = globalThis as typeof globalThis & {
    __geodeSlash?: {
      trigger: (before: string) => { query: string } | null;
      candidates: (query: string) => string[];
    };
  };
  slashHost.__geodeSlash = {
    trigger: (before) => slashTrigger(before),
    candidates: (query) => slashCandidates(app, query).map((c) => c.id),
  };

  // always-on tag-completion probe (R41): pure trigger + candidate ranking for the
  // editor `#` tag completion. Assigned BEFORE loadExternal (same as __geodeSlash).
  const tagHost = globalThis as typeof globalThis & {
    __geodeTag?: {
      trigger: (before: string) => { query: string } | null;
      candidates: (query: string) => string[];
    };
  };
  tagHost.__geodeTag = {
    trigger: (before) => tagTrigger(before),
    candidates: (query) => tagCandidates([...metadata.getTagMap().keys()], query),
  };

  // always-on hotkey-grammar probe (R32): `match` and `format` take an explicit
  // `isMac` so the desktop/browser probe can assert BOTH platform branches from a
  // single binary on a mac host (mirrors __geodeSlash's pure-gate approach). The
  // live command layer (handleKeydown) uses the detected isMacPlatform.
  const hotkeyHost = globalThis as typeof globalThis & {
    __geodeHotkey?: {
      isMac: boolean;
      normalize: (hotkey: string) => string;
      format: (hotkey: string, isMac: boolean) => string;
      match: (hotkey: string, e: KeyEventLike, isMac: boolean) => boolean;
    };
  };
  hotkeyHost.__geodeHotkey = {
    isMac: isMacPlatform,
    normalize: (hotkey) => normalizeHotkey(hotkey),
    format: (hotkey, isMac) => formatHotkey(hotkey, isMac),
    match: (hotkey, e, isMac) => matchParsedHotkey(parseHotkey(hotkey), e, isMac),
  };

  // always-on markdown-formatting probe (R33): exposes the pure core/format
  // transforms so browser/desktop E2E can assert every wrap/toggle behavior
  // deterministically (the live command path — Cmd+B in a real CM editor — is
  // exercised by the browser E2E). Same pure-gate approach as __geodeSlash /
  // __geodeHotkey; assigned BEFORE loadExternal.
  const formatHost = globalThis as typeof globalThis & {
    __geodeFormat?: {
      apply: (op: FormatOp, text: string, from: number, to: number) => FormatEdit | null;
    };
  };
  formatHost.__geodeFormat = {
    apply: (op, text, from, to) => applyFormatOp(op, text, from, to),
  };

  // always-on line-motion probe (R51): runs the CM move/copy-line StateCommands on
  // a throwaway EditorState so the transform is asserted deterministically (the live
  // command — editor:move-line-up on a real CM view — is exercised by the browser E2E).
  const runMotion = (
    cmd: (target: { state: EditorState; dispatch: (tr: { state: EditorState }) => void }) => boolean,
    doc: string,
    anchor: number,
  ): string => {
    const state = EditorState.create({ doc, selection: { anchor } });
    let out = doc;
    cmd({ state, dispatch: (tr) => { out = tr.state.doc.toString(); } });
    return out;
  };
  const motionHost = globalThis as typeof globalThis & {
    __geodeMotion?: {
      moveUp: (doc: string, anchor: number) => string;
      moveDown: (doc: string, anchor: number) => string;
      copyUp: (doc: string, anchor: number) => string;
      copyDown: (doc: string, anchor: number) => string;
    };
  };
  motionHost.__geodeMotion = {
    moveUp: (doc, anchor) => runMotion(moveLineUp, doc, anchor),
    moveDown: (doc, anchor) => runMotion(moveLineDown, doc, anchor),
    copyUp: (doc, anchor) => runMotion(copyLineUp, doc, anchor),
    copyDown: (doc, anchor) => runMotion(copyLineDown, doc, anchor),
  };

  // always-on editing-command probe (R52): runs the CM editing StateCommands
  // (toggle-comment / indent / unindent / insert-blank-line / select-line) on a
  // throwaway EditorState built WITH the markdown language + `%%` commentTokens, so
  // toggleComment resolves the same block-comment as the live editor. Returns the
  // resulting doc AND selection (selectLine changes only the selection, not the doc).
  const runEdit = (
    cmd: (target: { state: EditorState; dispatch: (tr: { state: EditorState }) => void }) => boolean,
    doc: string,
    anchor: number,
    head: number,
  ): { doc: string; from: number; to: number } => {
    const state = EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [
        markdown(),
        markdownLanguage.data.of({ commentTokens: { block: { open: "%%", close: "%%" } } }),
      ],
    });
    let result = { doc, from: anchor, to: head };
    cmd({
      state,
      dispatch: (tr) => {
        const s = (tr as { state: EditorState }).state;
        result = { doc: s.doc.toString(), from: s.selection.main.from, to: s.selection.main.to };
      },
    });
    return result;
  };
  const editHost = globalThis as typeof globalThis & {
    __geodeEdit?: {
      toggleComment: (doc: string, from: number, to: number) => { doc: string; from: number; to: number };
      indent: (doc: string, anchor: number) => { doc: string; from: number; to: number };
      unindent: (doc: string, anchor: number) => { doc: string; from: number; to: number };
      insertBlankLine: (doc: string, anchor: number) => { doc: string; from: number; to: number };
      selectLine: (doc: string, anchor: number) => { doc: string; from: number; to: number };
    };
  };
  editHost.__geodeEdit = {
    toggleComment: (doc, from, to) => runEdit(toggleComment, doc, from, to),
    indent: (doc, anchor) => runEdit(indentMore, doc, anchor, anchor),
    unindent: (doc, anchor) => runEdit(indentLess, doc, anchor, anchor),
    insertBlankLine: (doc, anchor) => runEdit(insertBlankLine, doc, anchor, anchor),
    selectLine: (doc, anchor) => runEdit(selectLine, doc, anchor, anchor),
  };

  // always-on bracket/quote auto-pair probe (R35): exposes the pure markdown
  // selection-wrap decision (core/bracketWrap). The bracket/quote auto-close +
  // type-over come from CM's closeBrackets() (a live-view behavior the desktop
  // probe can't drive — R34 conclusion — so the browser E2E exercises those);
  // this probe lets desktop/browser assert the wrap decision deterministically.
  // Same pure-gate approach as __geodeFormat; assigned BEFORE loadExternal.
  const bracketHost = globalThis as typeof globalThis & {
    __geodeBrackets?: {
      wrap: (doc: string, from: number, to: number, ch: string) => WrapEdit | null;
    };
  };
  bracketHost.__geodeBrackets = {
    wrap: (doc, from, to, ch) => markdownWrapInput(doc, from, to, ch),
  };

  // always-on daily-note probe (R43; R48 + configurable format/folder for E2E/probe).
  const dailyHost = globalThis as typeof globalThis & {
    __geodeDaily?: {
      stamp: (y: number, m0: number, d: number) => string;
      path: (y: number, m0: number, d: number) => string;
      parse: (s: string) => string | null;
      gridDims: (year: number, month0: number) => { weeks: number; cols: number; first: string; last: string };
      setFormat: (f: string) => void;
      setFolder: (f: string) => void;
    };
  };
  dailyHost.__geodeDaily = {
    stamp: (y, m0, d) => dailyStamp(new Date(y, m0, d)),
    path: (y, m0, d) => dailyNotePath(new Date(y, m0, d)),
    parse: (s) => { const dt = parseDailyStamp(s); return dt ? dailyStamp(dt) : null; },
    gridDims: (year, month0) => { const g = monthGrid(year, month0); return { weeks: g.length, cols: g[0].length, first: dailyStamp(g[0][0]), last: dailyStamp(g[g.length - 1][6]) }; },
    setFormat: (f) => setDailyNoteFormat(f),
    setFolder: (f) => setDailyNoteFolder(f),
  };

  // always-on unique-note probe (R53): pure name / path-preview generation + config
  // reactivity. The create flow (unique-note:create → vault.create) is a live async
  // write exercised by the browser E2E; the desktop probe drives only these pure
  // functions (App-Nap-safe — no async/effects). Assigned BEFORE loadExternal.
  const uniqueHost = globalThis as typeof globalThis & {
    __geodeUnique?: {
      name: (y: number, m0: number, d: number, h: number, mi: number, s: number) => string;
      path: (y: number, m0: number, d: number, h: number, mi: number, s: number) => string;
      setFormat: (f: string) => void;
      setFolder: (f: string) => void;
    };
  };
  uniqueHost.__geodeUnique = {
    name: (y, m0, d, h, mi, s) => uniqueNoteName(new Date(y, m0, d, h, mi, s)),
    path: (y, m0, d, h, mi, s) => uniqueNotePathPreview(new Date(y, m0, d, h, mi, s)),
    setFormat: (f) => setUniqueNoteFormat(f),
    setFolder: (f) => setUniqueNoteFolder(f),
  };

  // always-on heading-fold probe (R54): the pure markdownFoldRange geometry for ATX +
  // Setext headings on a throwaway EditorState. The live fold gutter / fold commands are
  // a view behavior the backgrounded desktop webview can't drive (App Nap) — exercised by
  // the browser E2E; this asserts the section-end math deterministically. Pre-loadExternal.
  const foldRangeHost = globalThis as typeof globalThis & {
    __geodeFoldRange?: { range: (doc: string, line1: number) => { from: number; to: number } | null };
  };
  foldRangeHost.__geodeFoldRange = {
    range: (doc: string, line1: number) => {
      const state = EditorState.create({ doc, extensions: [markdown()] });
      ensureSyntaxTree(state, doc.length, 2000);
      if (line1 < 1 || line1 > state.doc.lines) return null;
      const line = state.doc.line(line1);
      return markdownFoldRange(state, line.from, line.to);
    },
  };

  // always-on live-table probe (R55): the pure GFM Table detection (findTableRanges)
  // + the reused reading-view render (renderMarkdownToHtml → <table>). The live block
  // widget + cursor-reveal is a view behavior the backgrounded webview can't drive (App
  // Nap) — exercised by the browser E2E; this asserts detection + render geometry.
  const tableHost = globalThis as typeof globalThis & {
    __geodeTable?: {
      ranges: (doc: string) => Array<{ from: number; to: number }>;
      renders: (tableSrc: string) => boolean;
    };
  };
  tableHost.__geodeTable = {
    ranges: (doc: string) => {
      // markdownLanguage base = the GFM extensions (tables) the real editor uses
      const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
      ensureSyntaxTree(state, doc.length, 2000);
      return findTableRanges(state);
    },
    renders: (tableSrc: string) => renderMarkdownToHtml(tableSrc, () => null).includes("<table"),
  };

  // always-on live-mermaid probe (R56): the pure ```mermaid fence detection
  // (findMermaidRanges) + the reused fence renderer (renderMarkdownToHtml →
  // .geode-mermaid placeholder). The live block widget + async SVG hydration is a view
  // behavior exercised by the browser E2E; this asserts detection + placeholder.
  const mermaidHost = globalThis as typeof globalThis & {
    __geodeMermaid?: {
      ranges: (doc: string) => Array<{ from: number; to: number }>;
      placeholder: (fenceSrc: string) => boolean;
    };
  };
  mermaidHost.__geodeMermaid = {
    ranges: (doc: string) => {
      const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
      ensureSyntaxTree(state, doc.length, 2000);
      return findMermaidRanges(state);
    },
    placeholder: (fenceSrc: string) => renderMarkdownToHtml(fenceSrc, () => null).includes('class="geode-mermaid"'),
  };

  // always-on live-math probe (R57): the scan-based `$$…$$` block detection
  // (findMathBlockRanges, renderer-confirmed) + the reused math placeholder
  // (renderMarkdownToHtml → .geode-math-block). The live block widget + async KaTeX
  // hydration is a view behavior exercised by the browser E2E.
  const mathHost = globalThis as typeof globalThis & {
    __geodeMath?: {
      ranges: (doc: string) => Array<{ from: number; to: number }>;
      placeholder: (mathSrc: string) => boolean;
    };
  };
  mathHost.__geodeMath = {
    ranges: (doc: string) => {
      const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
      ensureSyntaxTree(state, doc.length, 2000);
      return findMathBlockRanges(state);
    },
    placeholder: (mathSrc: string) => renderMarkdownToHtml(mathSrc, () => null).includes("geode-math-block"),
  };

  // always-on search-operator probe (R68, ㉜): runs the pure parser + evaluator
  // (parseSearchQuery → evaluateSearch) on a synthetic SearchInput so task:/
  // [property] semantics are testable deterministically on browser + desktop
  // (no UI / debounce). Returns whether the query matches the given input.
  // (window.__geodeSearch is taken by the R34 in-editor find/replace probe; this
  // query-parser probe uses a distinct name.)
  const searchHost = globalThis as typeof globalThis & {
    __geodeSearchQuery?: (
      query: string,
      input: Partial<Pick<SearchInput, "content" | "basename" | "path" | "frontmatter">> & {
        tags?: string[];
      },
      defaultCaseSensitive?: boolean,
    ) => boolean;
  };
  searchHost.__geodeSearchQuery = (query, input, defaultCaseSensitive = false) => {
    const parsed = parseSearchQuery(query);
    if (!parsed.expr) return false;
    const path = input.path ?? "Note.md";
    return evaluateSearch(
      parsed.expr,
      {
        path,
        fileName: path.split("/").pop() ?? path,
        basename: input.basename ?? "Note",
        content: input.content ?? "",
        tags: input.tags ?? [],
        frontmatter: input.frontmatter,
      },
      defaultCaseSensitive,
    ).matched;
  };

  // always-on multi-cursor probe (R63, ㉕): verifies the STATE foundation on the
  // real binary — with EditorState.allowMultipleSelections a 2-range selection is
  // held (count=2); without it CM collapses to the main range (count=1). The view
  // rendering (drawSelection drawing every caret) is a DOM behavior exercised by the
  // browser E2E on the identical CM editor. `held(true/false)` is the control pair.
  const multiSelHost = globalThis as typeof globalThis & {
    __geodeMultiSel?: { held: (allow: boolean) => number };
  };
  multiSelHost.__geodeMultiSel = {
    held: (allow: boolean) => {
      const sel = EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(2)]);
      const state = EditorState.create({
        doc: "abc",
        selection: sel,
        extensions: allow ? [EditorState.allowMultipleSelections.of(true)] : [],
      });
      return state.selection.ranges.length;
    },
  };

  // always-on note-composer probe (R44): pure extract helpers (name/content/link).
  // The live command path (editor:extract-selection on a real CM view) is exercised
  // by the browser E2E; App effects don't run in a backgrounded webview, so the
  // desktop probe drives only these pure functions. Same pure-gate approach as
  // __geodeFormat/__geodeDaily; assigned BEFORE loadExternal.
  const composerHost = globalThis as typeof globalThis & {
    __geodeComposer?: {
      derive: (selected: string) => string;
      content: (selected: string) => string;
      replacement: (name: string, mode: "link" | "embed") => string;
    };
  };
  composerHost.__geodeComposer = {
    derive: (selected) => deriveNoteName(selected),
    content: (selected) => extractedContent(selected),
    replacement: (name, mode) => extractReplacement(name, mode),
  };

  // always-on obsidian:// URI probe (R46): `parse` is the PURE parser
  // (core/obsidianUri) so browser/desktop E2E can assert the action mapping
  // deterministically; `handle` drives the impure executor (open/create/search)
  // through the app layer. Same pure-gate approach as __geodeFormat; assigned
  // BEFORE loadExternal so an external plugin's onload can capture it.
  const uriHost = globalThis as typeof globalThis & {
    __geodeUri?: { parse: (uri: string) => unknown; handle: (uri: string) => void };
  };
  uriHost.__geodeUri = {
    parse: (uri) => parseObsidianUri(uri),
    handle: (uri) => {
      void handleObsidianUri(app, uri);
    },
  };

  // always-on note-merge probe (R47): drives the real-fs merge (append source
  // into target + rewrite inbound links + delete source) through the SAME
  // LinkRewriteDeps the rename engine uses (single write throat). WKWebView has
  // no CDP, so desktop verifies the merge through this hook (same pattern as
  // __geodeRename / __geodeExplorerMove). Assigned BEFORE loadExternal so an
  // external plugin's onload can capture it synchronously.
  const mergeHost = globalThis as typeof globalThis & {
    __geodeMerge?: { merge: (s: string, t: string) => void };
  };
  mergeHost.__geodeMerge = {
    merge: (s, t) => {
      void mergeNotes({ vault, metadata, documents }, s, t);
    },
  };

  // always-on file-recovery snapshot probe (R49): drives the core (store/vault
  // level → drivable in a backgrounded WKWebView; deterministic ts for assertions).
  const snapHost = globalThis as typeof globalThis & {
    __geodeSnapshots?: {
      record: (path: string, content: string, ts: number) => void;
      list: (path: string) => Promise<{ ts: number; content: string }[]>;
      restore: (path: string, ts: number, now: number) => Promise<boolean>;
    };
  };
  snapHost.__geodeSnapshots = {
    record: (path, content, ts) => { void recordSnapshot(vault, path, content, ts, true); },
    list: (path) => listSnapshots(vault, path),
    restore: (path, ts, now) => restoreSnapshot(vault, documents, path, ts, now),
  };

  // R50: apply DOM appearance settings (readable line length) on boot + probe.
  applyAppearanceSettings();
  const apprHost = globalThis as typeof globalThis & {
    __geodeAppearance?: {
      setReadable: (on: boolean) => void;
      setSpellcheck: (on: boolean) => void;
      readableVar: () => string;
      // R79
      setAccent: (color: string) => void;
      accentVar: () => string;
      resolveTheme: (kind: ThemeKind, systemPrefersDark: boolean) => "dark" | "light";
      // R85
      setFont: (which: "interface" | "text" | "monospace", raw: string) => void;
      fontVar: (prop: string) => string;
      // R94: inline title + ribbon toggles (DOM is browser-E2E only, §D; this proves
      // the Store + localStorage round-trip on the real WKWebView build)
      setToggles: (inlineTitle: boolean, ribbon: boolean) => { inlineTitle: boolean; ribbon: boolean };
      // R100: tab title bar + status bar toggles (same DOM-is-browser-E2E rationale)
      setChrome: (tabTitleBar: boolean, statusBar: boolean) => { tabTitleBar: boolean; statusBar: boolean };
    };
  };
  apprHost.__geodeAppearance = {
    setReadable: (on) => setReadableLineLength(on),
    setSpellcheck: (on) => setSpellcheckEnabled(on),
    readableVar: () => document.documentElement.style.getPropertyValue("--readable-line-width") || "(default)",
    setAccent: (color) => setAccentColor(color),
    accentVar: () => document.documentElement.style.getPropertyValue("--accent") || "(default)",
    resolveTheme: (kind, systemPrefersDark) => resolveTheme(kind, systemPrefersDark),
    setFont: (which, raw) =>
      which === "interface" ? setInterfaceFont(raw) : which === "text" ? setTextFont(raw) : setMonospaceFont(raw),
    fontVar: (prop) => document.documentElement.style.getPropertyValue(prop) || "(default)",
    setToggles: (inlineTitle, ribbon) => {
      setShowInlineTitle(inlineTitle);
      setShowRibbon(ribbon);
      return { inlineTitle: showInlineTitle.get(), ribbon: showRibbon.get() };
    },
    setChrome: (tabTitleBar, statusBar) => {
      setShowTabTitleBar(tabTitleBar);
      setShowStatusBar(statusBar);
      return { tabTitleBar: showTabTitleBar.get(), statusBar: showStatusBar.get() };
    },
  };

  // always-on find/replace probe (R34): drives the CM search panel + replaceAll
  // on the active view from browser/desktop E2E (WKWebView has no CDP). Assigned
  // BEFORE loadExternal, same as __geodeFormat/__geodeHotkey/__geodeSlash.
  installSearchProbe(app);

  // load vault: memory adapter is always ready; desktop restores the last vault
  if (adapter.kind === "memory") {
    await vault.load();
  } else {
    // CLI takes precedence: `geode.exe <folder>` opens that folder as the vault
    let initial: string | null = null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      initial = (await invoke<string | null>("initial_vault")) ?? null;
    } catch {
      /* command unavailable — fall through to last-vault restore */
    }
    const last = initial ?? localStorage.getItem(LAST_VAULT_KEY);
    if (last) {
      adapter.setVaultPath(last);
      try {
        await vault.load();
      } catch (err) {
        console.warn("[boot] failed to reopen last vault", err);
        localStorage.removeItem(LAST_VAULT_KEY);
      }
    }
  }

  // persisted tabs may point at files deleted (or from another vault) while the
  // app was closed — clean them up right after the initial load, before plugins
  if (vault.isOpen) {
    workspace.closeMissingFileTabs((p) => vault.fileExists(p));
  }

  for (const plugin of BUILTIN_PLUGINS) {
    try {
      await plugins.register(plugin);
    } catch (err) {
      console.error(`[boot] failed to register plugin "${plugin.id}"`, err);
    }
  }

  // external plugins from <vault>/.geode/plugins/*.js (desktop, vault open)
  if (vault.isOpen) {
    try {
      await plugins.loadExternal(vault);
    } catch (err) {
      console.error("[boot] external plugin load failed", err);
    }
    // Obsidian community plugins from <vault>/.obsidian/plugins/ (compat layer)
    try {
      await loadObsidianPlugins(app, vault);
    } catch (err) {
      console.error("[boot] obsidian plugin load failed", err);
    }
  }

  // Obsidian theme/snippet CSS layer (R20) — non-blocking; handles closed
  // vaults itself and re-discovers on vault:changed
  void initObsidianCss({ vault, events, workspace }).catch((err) =>
    console.error("[boot] obsidian css init failed", err),
  );

  // R22: property type registry (.obsidian/types.json) — non-blocking;
  // re-read when the vault ROOT switches (reason "load", initObsidianCss
  // precedent: per-file events never touch .obsidian config files)
  void propertyTypes.init(vault);
  events.on("vault:changed", ({ reason }) => {
    if (reason === "load") void propertyTypes.init(vault);
  });

  // R27: bookmarks (.obsidian/bookmarks.json) — same lifecycle as property
  // types (load on boot, re-read when the vault ROOT switches). NOTE: the
  // __geodeBookmarks probe host is assigned EARLIER (before loadExternal) so an
  // external plugin's onload can see it — same ordering as the other probes.
  void bookmarks.init(vault);
  events.on("vault:changed", ({ reason }) => {
    if (reason === "load") void bookmarks.init(vault);
  });

  // R45: named workspace layouts (.obsidian/workspaces.json) — same lifecycle
  // as bookmarks/property types (load on boot, re-read when the vault ROOT
  // switches). Probe host is assigned EARLIER (before loadExternal).
  void initWorkspaces(vault);
  events.on("vault:changed", ({ reason }) => {
    if (reason === "load") void initWorkspaces(vault);
  });

  // R49: file-recovery snapshots — subscribe to file:modified once; the vault
  // object is re-pointed in place on a vault switch (same as bookmarks), so the
  // single subscription stays valid.
  initSnapshots(vault, events);

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AppContext.Provider value={app}>
          <App />
        </AppContext.Provider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

bootstrap().catch((err: unknown) => {
  console.error("[boot] bootstrap failed", err);
  const root = document.getElementById("root");
  if (!root) return;
  root.textContent = "";
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.style.padding = "24px";
  box.style.fontFamily = "system-ui, sans-serif";
  const title = document.createElement("h1");
  title.style.fontSize = "18px";
  title.textContent = t("app.bootFailed");
  const detail = document.createElement("pre");
  detail.style.whiteSpace = "pre-wrap";
  detail.textContent = err instanceof Error ? err.message : String(err);
  box.append(title, detail);
  root.appendChild(box);
});
