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
import { renamePropertyAcrossVault, type PropertyRewriteResult } from "@core/propertyRewrite";
import {
  deriveMentionTerms,
  findUnlinkedMentions,
  linkAllMentionsInFile,
  linkOneMention,
  type MentionLinkResult,
  type MentionSpan,
} from "@core/unlinkedMentions";
import { MetadataIndex } from "@core/metadata";
import { PluginManager } from "@core/plugins";
import { propertyTypes } from "@core/properties";
import { bookmarks, type BookmarkItem } from "@core/bookmarks";
import { renderMarkdownToHtml } from "@core/markdown";
import { markdownWrapInput, type WrapEdit } from "@core/bracketWrap";
import { searchHeadings, searchBlocks, switcherMode, stripSigil } from "@core/switcherSearch";
import { applyFormatOp, type FormatEdit, type FormatOp } from "@core/format";
import { basename, isTauri, MemoryVaultAdapter, TauriVaultAdapter, Vault } from "@core/vault";
import { resolveDropTarget, wouldCollide } from "@core/explorerMove";
import { loadFoldInfo, saveFoldInfo, type FoldInfo } from "@core/foldStore";
import { slashCandidates, slashTrigger } from "@features/editor/slashCommands";
import { tagCandidates, tagTrigger } from "@features/editor/tagCompletion";
import { installSearchProbe } from "@features/editor/searchCommands";
import { Workspace } from "@core/workspace";
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
    __geodeRenderMarkdown?: (source: string, sourcePath?: string) => string;
  };
  renderHost.__geodeRenderMarkdown = (source, sourcePath = "") =>
    renderMarkdownToHtml(
      source,
      (tg) => metadata.resolveLink(tg, sourcePath),
      {
        noteEmbeds: true,
        resolveEmbed: (tg) => metadata.resolveAttachment(tg, sourcePath),
      },
    );

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
