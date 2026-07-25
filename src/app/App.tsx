import { Fragment, createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useApp } from "./AppContext";
import { useStore } from "@core/store";
import {
  showRibbon, showStatusBar, showTabTitleBar, setShowRibbon,
  showLineNumbers, setShowLineNumbers,
  readableLineLength, setReadableLineLength,
  spellcheckEnabled, setSpellcheckEnabled,
  defaultNewTabMode, setDefaultNewTabMode,
  showBacklinksInDocument, setShowBacklinksInDocument,
  quickFontZoom,
  deleteConfirm,
  attachmentDeleteMode,
} from "@core/appearance";
import type { NewTabMode } from "@core/appearance";
import { resolveAttachmentDeletion } from "@core/attachmentDeletion";
import { isMarkdownPath } from "@core/attachments";
import { MIN_PANE_FRACTION, allTabs, findTabLeaf, isFilelessSingletonView } from "@core/workspace";
import { getCommandName } from "@core/commands";
import type { PaneLeaf, PaneNode, PaneSplit, TabState } from "@core/types";
import type { SidebarPanelContribution } from "@core/plugins";
import { Icon, IconMarkup, isSingleSvgMarkup } from "./icons";
import { Explorer } from "@features/explorer/Explorer";
import { SearchPanel } from "@features/search/SearchPanel";
import { EditorPane } from "@features/editor/EditorPane";
import { GraphView } from "@features/graph/GraphView";
import { AttachmentView } from "@features/attachment/AttachmentView";
import { AllPropertiesPanel } from "@features/allproperties/AllPropertiesPanel";
import { BacklinksPanel } from "@features/backlinks/BacklinksPanel";
import { BookmarksPanel } from "@features/bookmarks/BookmarksPanel";
import { OutlinePanel } from "@features/outline/OutlinePanel";
import { OutgoingLinksPanel } from "@features/outgoinglinks";
import { FootnotesPanel } from "@features/footnotes";
import { FilePropertiesPanel } from "@features/editor/FilePropertiesPanel";
import { TagsPanel } from "@features/tags";
import { CalendarPanel } from "@features/calendar";
import { CommandPalette } from "@features/palette/CommandPalette";
import { QuickSwitcher } from "@features/palette/QuickSwitcher";
import { TemplateSelector } from "@features/palette/TemplateSelector";
import { SettingsModal, requestUpdateAutoCheck, APP_VERSION } from "@features/settings/SettingsModal";
import { buildDebugInfo } from "@core/debugInfo";
import { WorkspacesModal } from "@features/workspaces";
import { RecoveryModal } from "@features/recovery";
import { SlidesOverlay } from "@features/slides";
import { HoverPreview } from "@features/hover/HoverPreview";
import { exportActiveNoteHtml, printActiveNote } from "@features/export/export";
import { foldAllInView, foldAtCursor, toggleFoldAtCursor, unfoldAllInView, unfoldAtCursor } from "@features/editor/folding";
import { registerFormatCommands } from "@features/editor/formatCommands";
import { registerLinkCommands } from "@features/editor/linkCommands";
import { registerTableCommands } from "@features/editor/tableCommands";
import { registerAttachCommand } from "@features/editor/attachCommand";
import { togglePropertiesFold } from "@features/editor/foldProperties";
import { registerBlockRefCommands } from "@features/editor/blockRefCommands";
import { registerComposerCommands } from "@features/editor/noteComposerCommands";
import { registerEditorMotionCommands } from "@features/editor/editorMotionCommands";
import { registerEditorEditCommands } from "@features/editor/editorEditCommands";
import { registerSearchCommands } from "@features/editor/searchCommands";
import { isTauri, basename, parentPath, toAbsolutePath } from "@core/vault";
import { revealInSystem, openInDefaultApp } from "@core/reveal";
import {
  loadRecentVaultRecords,
  pushRecentVault,
  relocateRecentVaultRecord,
  removeRecentVault,
  renameRecentVaultRecord,
  type RecentVaultRecord,
} from "@core/recentVaults";
import { buildClearProperties, parseProperties } from "@core/properties";
import { buildOpenUri } from "@core/obsidianUri";
import { confirmAction } from "@core/confirm";
import { expandTemplate } from "@core/templates";
import { updateSupported } from "@core/update";
import { mergeTargetMode } from "@core/noteMerge";
import { bookmarks } from "@core/bookmarks";
import { t, useI18n, locale, setLocale } from "@core/i18n";
import { loadObsidianPlugins } from "@compat/obsidian/loader";

const LAST_VAULT_KEY = "geode.lastVaultPath";
const GEODE_LOGO_URL = new URL("../../src-tauri/icons/128x128@2x.png", import.meta.url).href;

/** R183 (G3): brief bottom toast for app-level command feedback (e.g. "copied").
 *  Mirrors the per-module local-notice convention (Explorer's showLinkUpdateNotice,
 *  blockRef's showBlockNotice) and reuses the shared `.link-update-notice` styling. */
function showCommandNotice(message: string): void {
  document.querySelector("[data-testid='command-notice']")?.remove();
  const el = document.createElement("div");
  // distinct class from Explorer's `.link-update-notice` (which it removes by
  // class) so the two toasts never clobber each other; shares styling via co-selector.
  el.className = "command-notice";
  el.textContent = message;
  el.setAttribute("data-testid", "command-notice");
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 3000);
}

/* ---------------- tab drag & drop plumbing ---------------- */

/** MIME type used to mark tab drags so foreign drags (files, text) are ignored. */
const TAB_MIME = "application/geode-tab";

type DropZone = "left" | "right" | "top" | "bottom" | "center";

interface TabDragState {
  draggingTabId: string | null;
  setDraggingTabId: (id: string | null) => void;
}

const TabDragContext = createContext<TabDragState>({
  draggingTabId: null,
  setDraggingTabId: () => {},
});

function isTabDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(TAB_MIME);
}

/** Map a pointer position inside an element to one of the 5 drop zones (25% edge bands). */
function zoneFromEvent(e: React.DragEvent<HTMLElement>): DropZone {
  const r = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - r.left) / Math.max(r.width, 1);
  const y = (e.clientY - r.top) / Math.max(r.height, 1);
  if (x < 0.25) return "left";
  if (x > 0.75) return "right";
  if (y < 0.25) return "top";
  if (y > 0.75) return "bottom";
  return "center";
}

export function App() {
  const app = useApp();
  const t = useI18n();
  const ws = useStore(app.workspace.state);
  const tree = useStore(app.vault.tree);
  const statusItems = useStore(app.plugins.statusBarItems);
  const statusBarElements = useStore(app.plugins.statusBarElements);
  const ribbonItems = useStore(app.plugins.ribbonItems);
  const sidebarPanels = useStore(app.plugins.sidebarPanels);
  /* R294: core-plugin enable/disable bumps plugins.revision; subscribe so the
     tags panel tab + render recompute when the Tags core plugin is toggled. */
  useStore(app.plugins.revision);
  const tagsEnabled = app.plugins.isEnabled("tags");
  /* R295: wave-1 sidebar knowledge views - same isEnabled gate as Tags (R294). */
  const outlineEnabled = app.plugins.isEnabled("outline");
  const outgoingLinksEnabled = app.plugins.isEnabled("outgoing-links");
  const backlinksEnabled = app.plugins.isEnabled("backlinks");
  const graphEnabled = app.plugins.isEnabled("graph");
  /* R296: wave-2 workspace + discovery entries. Lock-out safe: app:open-settings
     (Mod+,) + the ribbon gear are NOT gated by any of these, so Settings stays
     reachable even with command-palette / quick-switcher disabled. */
  const fileExplorerEnabled = app.plugins.isEnabled("file-explorer");
  const searchEnabled = app.plugins.isEnabled("search");
  const commandPaletteEnabled = app.plugins.isEnabled("command-palette");
  /* R297: wave-3 sidebar panels (bookmarks left; properties-view + footnotes-view right).
     templates/file-recovery/note-composer/page-preview have no App-level panel (modals /
     hover / actions) - gated at their command/controller/site, not here. */
  const bookmarksEnabled = app.plugins.isEnabled("bookmarks");
  const propertiesViewEnabled = app.plugins.isEnabled("properties-view");
  const footnotesViewEnabled = app.plugins.isEnabled("footnotes-view");
  /* R94: Obsidian "Show ribbon" — hide the left primary nav (settings stay reachable
     via Ctrl+, / the command palette) */
  const ribbonVisible = useStore(showRibbon);
  /* R100: Obsidian "Show status bar" — hide the bottom status bar */
  const statusBarVisible = useStore(showStatusBar);

  /* plugin-contributed sidebar panels (compat registerView custom views) */
  const leftPanels = sidebarPanels.filter((p) => p.side === "left");
  const rightPanels = sidebarPanels.filter((p) => p.side === "right");
  /* an unknown persisted id (e.g. the panel unregistered) falls back to the
     default panel WITHOUT mutating workspace state, so a panel that registers
     later wins again */
  const activeLeftPanel = leftPanels.find((p) => p.id === ws.leftPanel) ?? null;
  const activeRightPanel = rightPanels.find((p) => p.id === ws.rightPanel) ?? null;
  /* effective panel ids AFTER fallback — selection highlights must agree with
     what is actually rendered, even when the persisted id is stale */
  const effectiveLeft = activeLeftPanel
    ? activeLeftPanel.id
    : ws.leftPanel === "search" && searchEnabled
      ? "search"
      : ws.leftPanel === "bookmarks" && bookmarksEnabled
        ? "bookmarks"
        : fileExplorerEnabled
          ? "explorer"
          : searchEnabled
            ? "search"
            : bookmarksEnabled
              ? "bookmarks"
              : "";
  const effectiveRight = activeRightPanel
    ? activeRightPanel.id
    : ws.rightPanel === "outline" && outlineEnabled
      ? "outline"
      : ws.rightPanel === "outgoinglinks" && outgoingLinksEnabled
        ? "outgoinglinks"
        : ws.rightPanel === "footnotes" && footnotesViewEnabled
          ? "footnotes"
        : ws.rightPanel === "allproperties" && propertiesViewEnabled
          ? "allproperties"
          : ws.rightPanel === "fileproperties"
            ? "fileproperties"
          : ws.rightPanel === "tags" && tagsEnabled
            ? "tags"
            : ws.rightPanel === "calendar"
              ? "calendar"
              : backlinksEnabled ? "backlinks" : "calendar";

  /* tab drag state shared by every TabBar / pane drop overlay */
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const tabDrag = useMemo<TabDragState>(() => ({ draggingTabId, setDraggingTabId }), [draggingTabId]);

  /* if the dragged tab vanishes mid-drag (e.g. its file was deleted), dragend never
     fires on the removed element — clear the state so the drop overlay unmounts */
  useEffect(() => {
    if (draggingTabId !== null && findTabLeaf(ws.root, draggingTabId) === null) {
      setDraggingTabId(null);
    }
  }, [draggingTabId, ws.root]);

  /* ---- register core commands once ---- */
  useEffect(() => {
    const { workspace, vault, commands } = app;
    const disposers = [
      commands.register({
        id: "app:new-note",
        name: () => t("cmd.newNote"),
        hotkey: "Mod+N",
        callback: () => {
          void (async () => {
            const path = vault.uniquePath("", "Untitled");
            await vault.create(path, "");
            workspace.openFile(path);
          })();
        },
      }),
      // R215 (G3 §4): Obsidian "Create new note in new pane" (⌘⇧N). Reuses app:new-note's
      // create path + R202's split-right pattern; splitActivePane returns null for a
      // fileless-singleton active tab (can't be split) → fall back to a new tab.
      commands.register({
        id: "file-explorer:new-file-in-new-pane",
        name: () => t("cmd.newNoteInNewPane"),
        hotkey: "Mod+Shift+N",
        callback: () => {
          void (async () => {
            const path = vault.uniquePath("", "Untitled");
            await vault.create(path, "");
            const paneId = workspace.splitActivePane("row");
            workspace.openFile(path, paneId ? { paneId } : { newTab: true });
          })();
        },
      }),
      commands.register({
        id: "app:toggle-mode",
        name: () => t("cmd.toggleMode"),
        hotkey: "Mod+E",
        callback: () => workspace.toggleActiveTabMode(),
      }),
      commands.register({
        id: "app:toggle-source",
        name: () => t("cmd.toggleSource"),
        hotkey: "Mod+Shift+E",
        callback: () => workspace.toggleActiveSourceMode(),
      }),
      commands.register({
        // R254: Obsidian "Toggle stacked tabs" — stack/unstack the active tab group
        id: "workspace:toggle-stacked-tabs",
        name: () => t("cmd.toggleStackedTabs"),
        callback: () => workspace.toggleStacked(workspace.getActivePane().id),
      }),
      commands.register({
        id: "slides:start",
        name: () => t("cmd.startPresentation"),
        available: () => workspace.getActiveFile() !== null,
        callback: () => workspace.openModal("slides"),
      }),
      commands.register({
        // R180 (G4-b): Obsidian "Reveal active file in navigation"
        id: "file-explorer:reveal-active-file",
        name: () => t("cmd.revealActiveFile"),
        available: () => workspace.getActiveFile() !== null,
        callback: () => {
          const path = workspace.getActiveFile();
          if (path) workspace.requestRevealInExplorer(path);
        },
      }),
      commands.register({
        id: "app:reload-plugins",
        name: () => t("cmd.reloadPlugins"),
        callback: () =>
          void (async () => {
            // sequential: external first, then the Obsidian compat layer
            await app.plugins.loadExternal(vault);
            await loadObsidianPlugins(app, vault);
          })(),
      }),
      // R291: open Geode help / release notes in the system browser.
      commands.register({
        id: "app:open-help",
        name: () => t("cmd.openHelp"),
        callback: () => window.open("https://github.com/AlexHercules/geode#readme", "_blank", "noopener"),
      }),
      commands.register({
        id: "app:open-release-notes",
        name: () => t("cmd.openReleaseNotes"),
        callback: () => window.open("https://github.com/AlexHercules/geode/releases", "_blank", "noopener"),
      }),
      commands.register({
        id: "app:toggle-theme",
        name: () => t("cmd.toggleTheme"),
        callback: () => workspace.toggleTheme(),
      }),
      // R210 (G3 §10 missing→done): fold/unfold the current note's properties panel.
      // Pure view state (per-path), never touches the document; the panel itself
      // re-measures the CM heightmap via its onLayoutChange.
      commands.register({
        id: "editor:toggle-fold-properties",
        name: () => t("cmd.toggleFoldProperties"),
        // only when the active note actually has a properties block — otherwise the
        // toggle would store fold state for a path with no panel, hiding a later-added
        // property (review fix). parseProperties matches the panel's own render gate.
        available: () => {
          const a = getActiveFileEditorView(app);
          return a !== null && parseProperties(a.view.state.doc.toString()) !== null;
        },
        callback: () => {
          const active = getActiveFileEditorView(app);
          if (active && parseProperties(active.view.state.doc.toString()) !== null) {
            togglePropertiesFold(active.path);
          }
        },
      }),
      // R185 (G3 partial→done): view/appearance toggle commands — flip an existing
      // appearance setting via its setter (pure display: line-number gutter / line
      // width / spellcheck attr / ribbon — no document/vault write). Mirrors Obsidian's
      // "Toggle line numbers" etc. which previously had a settings switch but no command.
      commands.register({
        id: "editor:toggle-line-numbers",
        name: () => t("cmd.toggleLineNumbers"),
        callback: () => setShowLineNumbers(!showLineNumbers.get()),
      }),
      commands.register({
        id: "editor:toggle-readable-line-length",
        name: () => t("cmd.toggleReadableLineLength"),
        callback: () => setReadableLineLength(!readableLineLength.get()),
      }),
      commands.register({
        id: "editor:toggle-spellcheck",
        name: () => t("cmd.toggleSpellcheck"),
        callback: () => setSpellcheckEnabled(!spellcheckEnabled.get()),
      }),
      commands.register({
        id: "app:toggle-ribbon",
        name: () => t("cmd.toggleRibbon"),
        callback: () => setShowRibbon(!showRibbon.get()),
      }),
      commands.register({
        // R219: Obsidian backlink:toggle-backlinks-in-document — flips R154's
        // "Backlink in document" appearance setting (linked mentions at the note
        // bottom). Reuses the vetted store+setter; pure appearance toggle.
        id: "backlink:toggle-backlinks-in-document",
        name: () => t("cmd.toggleBacklinksInDocument"),
        callback: () => setShowBacklinksInDocument(!showBacklinksInDocument.get()),
      }),
      commands.register({
        // R195: Obsidian app:toggle-default-new-tab-view. Geode merges Obsidian's
        // view + editing-mode settings into one NewTabMode tri-state, so the single
        // command cycles all three (live → source → preview). Pure appearance setting.
        id: "app:toggle-default-new-tab-view",
        name: () => t("cmd.toggleDefaultNewTabView"),
        callback: () => {
          const order: NewTabMode[] = ["live", "source", "preview"];
          setDefaultNewTabMode(order[(order.indexOf(defaultNewTabMode.get()) + 1) % order.length]);
        },
      }),
      // R50 zoom — adjust the editor/preview font size (workspace.setFontSize
      // clamps + drives --editor-font-size). Mod+= / Mod+- / Mod+0 mirror the
      // Obsidian-canonical zoom keys; reset returns to the 16px default.
      commands.register({
        id: "app:zoom-in",
        name: () => t("cmd.zoomIn"),
        hotkey: "Mod+=",
        callback: () => workspace.setFontSize(workspace.state.get().fontSize + 1),
      }),
      commands.register({
        id: "app:zoom-out",
        name: () => t("cmd.zoomOut"),
        hotkey: "Mod+-",
        callback: () => workspace.setFontSize(workspace.state.get().fontSize - 1),
      }),
      commands.register({
        id: "app:zoom-reset",
        name: () => t("cmd.zoomReset"),
        hotkey: "Mod+0",
        callback: () => workspace.setFontSize(16),
      }),
      // R228: Obsidian "Rebuild vault cache" (Files & Links → Advanced). Re-walks the
      // vault and rebuilds the in-memory metadata parse cache via the vetted rebuildAll
      // (read-only — no .md writes; same engine the vault-load path runs).
      commands.register({
        id: "app:rebuild-cache",
        name: () => t("cmd.rebuildCache"),
        callback: () => void app.metadata.rebuildAll().then(() => showCommandNotice(t("cmd.rebuildCacheDone"))),
      }),
      commands.register({
        id: "app:open-settings",
        name: () => t("cmd.openSettings"),
        hotkey: "Mod+,",
        callback: () => workspace.openModal("settings"),
      }),
      commands.register({
        id: "app:toggle-left-sidebar",
        name: () => t("cmd.toggleLeftSidebar"),
        callback: () => workspace.toggleLeftSidebar(),
      }),
      commands.register({
        id: "app:toggle-right-sidebar",
        name: () => t("cmd.toggleRightSidebar"),
        callback: () => workspace.toggleRightSidebar(),
      }),
      // R214 (G3 §10): reveal the R86 FilePropertiesPanel (current note's properties) —
      // Obsidian's "Show file properties" core command, the twin of "Show all properties".
      commands.register({
        id: "app:show-file-properties",
        name: () => t("cmd.showFileProperties"),
        callback: () => workspace.setRightPanel("fileproperties"),
      }),
      // R217 (G3 §0): Obsidian "Show debug info" — copy version/platform/locale/plugins to
      // the clipboard for bug reports. buildDebugInfo is pure; the gathered values are live.
      commands.register({
        id: "app:show-debug-info",
        name: () => t("cmd.showDebugInfo"),
        callback: () => {
          const plugins = app.plugins.list().map((e) => ({
            name: typeof e.plugin.name === "function" ? e.plugin.name() : e.plugin.name,
            id: e.plugin.id,
            enabled: e.enabled,
          }));
          const text = buildDebugInfo({
            version: APP_VERSION,
            platform: navigator.platform || navigator.userAgent || "unknown",
            locale: locale.get(),
            plugins,
          });
          void navigator.clipboard.writeText(text).catch(() => {});
          showCommandNotice(t("debugInfo.copied"));
        },
      }),
      // R183 (G3 ui-only→done): promote R179's right-click "copy path / copy
      // Obsidian URL" to commands operating on the active file (reuse buildOpenUri;
      // pure read + clipboard, no vault write). Obsidian command ids per the matrix.
      commands.register({
        id: "file-explorer:copy-path",
        name: () => t("explorer.copyPath"),
        available: () => workspace.getActiveFile() !== null,
        callback: () => {
          const path = workspace.getActiveFile();
          if (!path) return;
          void navigator.clipboard.writeText(path).catch(() => {});
          showCommandNotice(t("explorer.copiedPath"));
        },
      }),
      commands.register({
        // R241: Obsidian "Copy file path" — the file's absolute OS path. Desktop-only
        // (the Memory adapter has no vault path), gated like reveal-in-system (R218).
        id: "file-explorer:copy-absolute-path",
        name: () => t("explorer.copyAbsolutePath"),
        available: () => workspace.getActiveFile() !== null && vault.getVaultPath() !== null,
        callback: () => {
          const path = workspace.getActiveFile();
          const vp = vault.getVaultPath();
          if (!path || vp === null) return;
          void navigator.clipboard.writeText(toAbsolutePath(vp, path)).catch(() => {});
          showCommandNotice(t("explorer.copiedAbsolutePath"));
        },
      }),
      commands.register({
        id: "workspace:copy-url",
        name: () => t("explorer.copyObsidianUrl"),
        available: () => workspace.getActiveFile() !== null,
        callback: () => {
          const path = workspace.getActiveFile();
          if (!path) return;
          void navigator.clipboard.writeText(buildOpenUri(vault.vaultName, path)).catch(() => {});
          showCommandNotice(t("explorer.copiedUrl"));
        },
      }),
      // R274: editor/file context actions — open the active file as another tab or
      // in a right split. These mirror Explorer's vetted right-click handlers and
      // carry no path parameter; the active markdown file is read at click time.
      commands.register({
        id: "file-explorer:open-in-new-tab",
        name: () => t("explorer.openInNewTab"),
        available: () => workspace.getActiveFile() !== null,
        callback: () => {
          const path = workspace.getActiveFile();
          if (path) workspace.openFile(path, { newTab: true });
        },
      }),
      commands.register({
        id: "file-explorer:open-to-right",
        name: () => t("explorer.openToRight"),
        available: () => workspace.getActiveFile() !== null,
        callback: () => {
          const path = workspace.getActiveFile();
          if (!path) return;
          const paneId = workspace.splitActivePane("row");
          workspace.openFile(path, paneId ? { paneId } : { newTab: true });
        },
      }),
      // R218 (G3 §6): reveal / open the active file via the OS shell. Desktop-only
      // (isTauri gate hides them in browser mode — host capability, like Obsidian
      // mobile hiding desktop commands). The webview passes the vault-relative path;
      // the Rust command safe_join's it (no absolute paths in the frontend). The OS
      // window IS the feedback, so no toast — fire-and-forget, swallow host errors.
      commands.register({
        id: "file-explorer:reveal-in-system",
        name: () => t("cmd.revealInSystem"),
        available: () => isTauri() && workspace.getActiveFile() !== null,
        callback: () => {
          const path = workspace.getActiveFile();
          const root = vault.adapter.getVaultPath();
          if (!path || !root) return;
          void revealInSystem(root, path).catch(() => {});
        },
      }),
      commands.register({
        id: "file-explorer:open-in-default-app",
        name: () => t("cmd.openInDefaultApp"),
        available: () => isTauri() && workspace.getActiveFile() !== null,
        callback: () => {
          const path = workspace.getActiveFile();
          const root = vault.adapter.getVaultPath();
          if (!path || !root) return;
          void openInDefaultApp(root, path).catch(() => {});
        },
      }),
      // R184 (G3 ui-only→done): file-op commands route the active file to the
      // Explorer's existing vetted handlers via a one-shot store (no new write path).
      commands.register({
        id: "file-explorer:duplicate-file",
        name: () => t("explorer.makeCopy"),
        available: () => workspace.getActiveFile() !== null,
        callback: () => {
          const path = workspace.getActiveFile();
          if (path) workspace.requestExplorerFileAction("duplicate", path);
        },
      }),
      commands.register({
        id: "workspace:edit-file-title",
        name: () => t("explorer.rename"),
        available: () => workspace.getActiveFile() !== null,
        callback: () => {
          const path = workspace.getActiveFile();
          if (path) workspace.requestExplorerFileAction("rename", path);
        },
      }),
      commands.register({
        id: "file-explorer:move-file",
        name: () => t("explorer.moveTo"),
        available: () => workspace.getActiveFile() !== null,
        callback: () => {
          const path = workspace.getActiveFile();
          if (path) workspace.requestExplorerFileAction("move", path);
        },
      }),
      commands.register({
        id: "file-explorer:new-folder",
        name: () => t("explorer.newFolder"),
        callback: () => workspace.requestExplorerFileAction("new-folder", null),
      }),
      commands.register({
        id: "app:close-tab",
        name: () => t("cmd.closeTab"),
        hotkey: "Mod+W",
        callback: () => {
          const tab = workspace.getActiveTab();
          if (tab) workspace.closeTab(tab.id);
        },
      }),
      commands.register({
        // R190: Obsidian workspace:close-others — close every other tab in the active
        // group. Reuses the vetted closeTab path (flush + recently-closed + skip pinned).
        id: "app:close-others",
        name: () => t("cmd.closeOthers"),
        callback: () => {
          const tab = workspace.getActiveTab();
          if (tab) workspace.closeOtherTabs(tab.id);
        },
      }),
      commands.register({
        // R190: Obsidian workspace:close-tab-group — close all tabs in the active group.
        id: "app:close-tab-group",
        name: () => t("cmd.closeTabGroup"),
        callback: () => {
          const tab = workspace.getActiveTab();
          if (tab) workspace.closeAllTabs(tab.id);
        },
      }),
      commands.register({
        // R161: Obsidian's real id is "app:delete-file"; no default hotkey
        // (matches Obsidian — users bind it in Hotkeys). Reuses the Explorer's
        // vetted flush-before-trash path → recoverable .trash, reactive cleanup.
        id: "app:delete-file",
        name: () => t("cmd.deleteFile"),
        available: () => workspace.getActiveFile() !== null,
        callback: () => {
          void (async () => {
            const path = workspace.getActiveFile();
            if (!path) return;
            // R242: confirm only when "Confirm file deletion" is on (delete still → recoverable .trash).
            if (deleteConfirm.get() && !(await confirmAction(t("explorer.deleteConfirmFile", { name: basename(path) }), t("explorer.delete"))))
              return;
            try {
              // R244: resolve orphaned attachments (body + frontmatter refs) BEFORE flush/trash —
              // the live index still holds this note's references; the "ask" prompt runs pre-flush.
              const orphans = await resolveAttachmentDeletion(
                app.metadata,
                path.endsWith(".md") ? new Set([path]) : new Set(),
                [path],
                attachmentDeleteMode.get(),
              );
              await workspace.flushAll();
              await vault.trash(path);
              // R244: trash orphans AFTER the note, via the same vetted recoverable .trash path.
              // Per-attachment try/catch (mirrors bulkDelete) — one failing orphan must not abort
              // the rest, and the note is already safely trashed.
              for (const att of orphans) {
                try {
                  await vault.trash(att);
                } catch (e) {
                  console.error("[app] delete-file: orphan attachment trash failed", att, e);
                }
              }
            } catch (err) {
              console.error("[app] delete-file failed", err);
            }
          })();
        },
      }),
      commands.register({
        id: "app:split-right",
        name: () => t("cmd.splitRight"),
        hotkey: "Mod+\\",
        callback: () => void workspace.splitActivePane("row"),
      }),
      commands.register({
        id: "app:split-down",
        name: () => t("cmd.splitDown"),
        hotkey: "Mod+Shift+\\",
        callback: () => void workspace.splitActivePane("column"),
      }),
      commands.register({
        id: "app:focus-next-pane",
        name: () => t("cmd.focusNextPane"),
        callback: () => workspace.focusAdjacentPane(1),
      }),
      commands.register({
        id: "app:focus-previous-pane",
        name: () => t("cmd.focusPreviousPane"),
        callback: () => workspace.focusAdjacentPane(-1),
      }),
      commands.register({
        id: "app:focus-left-pane",
        name: () => t("cmd.focusLeftPane"),
        callback: () => workspace.focusDirectionalPane("left"),
      }),
      commands.register({
        id: "app:focus-right-pane",
        name: () => t("cmd.focusRightPane"),
        callback: () => workspace.focusDirectionalPane("right"),
      }),
      commands.register({
        id: "app:focus-top-pane",
        name: () => t("cmd.focusTopPane"),
        callback: () => workspace.focusDirectionalPane("top"),
      }),
      commands.register({
        id: "app:focus-bottom-pane",
        name: () => t("cmd.focusBottomPane"),
        callback: () => workspace.focusDirectionalPane("bottom"),
      }),
      commands.register({
        id: "editor:toggle-fold",
        name: () => t("cmd.toggleFold"),
        callback: () => {
          const active = app.documents.getActiveView();
          if (active) toggleFoldAtCursor(active.view);
        },
      }),
      commands.register({
        id: "editor:fold-all",
        name: () => t("cmd.foldAll"),
        callback: () => {
          const active = app.documents.getActiveView();
          if (active) foldAllInView(active.view);
        },
      }),
      commands.register({
        id: "editor:unfold-all",
        name: () => t("cmd.unfoldAll"),
        callback: () => {
          const active = app.documents.getActiveView();
          if (active) unfoldAllInView(active.view);
        },
      }),
      commands.register({
        id: "editor:fold",
        name: () => t("cmd.fold"),
        callback: () => {
          const active = app.documents.getActiveView();
          if (active) foldAtCursor(active.view);
        },
      }),
      commands.register({
        id: "editor:unfold",
        name: () => t("cmd.unfold"),
        callback: () => {
          const active = app.documents.getActiveView();
          if (active) unfoldAtCursor(active.view);
        },
      }),
      // R238: move keyboard focus to the active editor (Obsidian "Focus on the editor").
      commands.register({
        id: "editor:focus",
        name: () => t("cmd.focusEditor"),
        callback: () => {
          const active = app.documents.getActiveView();
          if (active) active.view.focus();
        },
      }),
      commands.register({
        id: "editor:add-property",
        name: () => t("cmd.addProperty"),
        hotkey: "Mod+;",
        available: () => isMarkdownPath(workspace.getActiveTab()?.filePath ?? ""),
        callback: () => {
          // no file in the active tab → no-op (contract)
          const tab = workspace.getActiveTab();
          if (!tab || !tab.filePath) return;
          // source mode has no panel — flip to live first (contract); a
          // hidden/source DISPLAY setting also has no panel — the command is
          // an explicit edit intent, so flip the setting to visible too
          // (R22 review fix INT-2: otherwise the request hangs unconsumed)
          if (tab.mode === "source") workspace.setTabMode(tab.id, "live");
          if (workspace.propertiesInDocument.get() !== "visible") {
            workspace.setPropertiesInDocument("visible");
          }
          // one-shot request (revealTarget shape): the matching panel may not
          // be MOUNTED yet when the mode just flipped — it consumes the
          // request after mount, creates an empty frontmatter block when
          // missing and focuses the add-name input
          workspace.requestAddProperty(tab.id, tab.filePath);
        },
      }),
      commands.register({
        // R196: Obsidian editor:add-alias — add (or focus) an "aliases" property and focus
        // its value. Mirrors add-property's flip-to-editable flow, passing the property key.
        id: "editor:add-alias",
        name: () => t("cmd.addAlias"),
        available: () => isMarkdownPath(workspace.getActiveTab()?.filePath ?? ""),
        callback: () => {
          const tab = workspace.getActiveTab();
          if (!tab || !tab.filePath) return;
          if (tab.mode === "source") workspace.setTabMode(tab.id, "live");
          if (workspace.propertiesInDocument.get() !== "visible") workspace.setPropertiesInDocument("visible");
          workspace.requestAddProperty(tab.id, tab.filePath, "aliases");
        },
      }),
      commands.register({
        // R196: Obsidian editor:add-tag — add (or focus) a "tags" property and focus its value.
        id: "editor:add-tag",
        name: () => t("cmd.addTag"),
        available: () => isMarkdownPath(workspace.getActiveTab()?.filePath ?? ""),
        callback: () => {
          const tab = workspace.getActiveTab();
          if (!tab || !tab.filePath) return;
          if (tab.mode === "source") workspace.setTabMode(tab.id, "live");
          if (workspace.propertiesInDocument.get() !== "visible") workspace.setPropertiesInDocument("visible");
          workspace.requestAddProperty(tab.id, tab.filePath, "tags");
        },
      }),
      commands.register({
        // R194: Obsidian editor:clear-metadata-properties — remove the whole frontmatter
        // block. Reuses the R22-vetted properties bounds; the change is a normal CM
        // transaction (undoable, dirty → autosave). No-op when there are no properties.
        id: "editor:clear-metadata-properties",
        name: () => t("cmd.clearProperties"),
        available: () => getActiveFileEditorView(app) !== null,
        callback: () => {
          const view = getActiveFileEditorView(app)?.view;
          if (!view) return;
          const edit = buildClearProperties(view.state.doc.toString());
          if (!edit) return;
          view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, userEvent: "input" });
          view.focus();
        },
      }),
      commands.register({
        id: "editor:insert-date",
        name: () => t("cmd.insertDate"),
        available: () => getActiveFileEditorView(app) !== null,
        callback: () => insertNowAtSelection(app, "{{date}}"),
      }),
      commands.register({
        id: "editor:insert-time",
        name: () => t("cmd.insertTime"),
        available: () => getActiveFileEditorView(app) !== null,
        callback: () => insertNowAtSelection(app, "{{time}}"),
      }),
      commands.register({
        id: "app:export-html",
        name: () => t("cmd.exportHtml"),
        callback: () => void exportActiveNoteHtml(app),
        available: () => workspace.getActiveFile() !== null,
      }),
      commands.register({
        id: "app:export-pdf",
        name: () => t("cmd.exportPdf"),
        callback: () => void printActiveNote(app),
        available: () => workspace.getActiveFile() !== null,
      }),
      commands.register({
        // R47: merge the active file INTO a picked target. The switcher reads
        // mergeTargetMode on mount and turns a file pick into a merge (#⑬).
        id: "editor:merge-file",
        name: () => t("cmd.mergeFile"),
        available: () => workspace.getActiveFile() !== null && app.plugins.isEnabled("quick-switcher") && app.plugins.isEnabled("note-composer"),
        callback: () => {
          // The switcher belongs to Quick switcher and the action belongs to Note
          // composer; direct command execution must honor both plugin gates because
          // CommandRegistry.execute() deliberately does not consult available().
          if (
            !app.plugins.isEnabled("quick-switcher") ||
            !app.plugins.isEnabled("note-composer")
          ) return;
          const src = workspace.getActiveFile();
          if (!src) return;
          // if the switcher is already open, openModal("switcher") won't remount it
          // (so it wouldn't snapshot merge mode) AND mergeTargetMode would leak into
          // the NEXT plain switcher open → a surprise merge. No-op instead (R47 review).
          if (workspace.state.get().modal === "switcher") return;
          mergeTargetMode.set(src);
          workspace.openModal("switcher");
        },
      }),
      commands.register({
        id: "bookmarks:bookmark-file",
        // label flips so the palette/hotkey shows the right verb for the state
        name: () => {
          const p = workspace.getActiveFile();
          return p && bookmarks.isFileBookmarked(p)
            ? t("cmd.unbookmarkFile")
            : t("cmd.bookmarkFile");
        },
        available: () => workspace.getActiveFile() !== null,
        callback: () => {
          const p = workspace.getActiveFile();
          if (p) void bookmarks.toggleFile(p);
        },
      }),
      commands.register({
        id: "bookmarks:bookmark-heading",
        name: () => t("cmd.bookmarkHeading"),
        available: () => headingUnderCursor(app) !== null,
        callback: () => {
          const h = headingUnderCursor(app);
          // subpath stored Obsidian-shape (leading "#"); navigation strips it
          if (h) void bookmarks.add({ type: "heading", path: h.path, subpath: h.subpath, ctime: Date.now() });
        },
      }),
      commands.register({
        id: "bookmarks:bookmark-block",
        name: () => t("cmd.bookmarkBlock"),
        available: () => blockUnderCursor(app) !== null,
        callback: () => {
          const b = blockUnderCursor(app);
          if (b) void bookmarks.add({ type: "block", path: b.path, subpath: b.subpath, ctime: Date.now() });
        },
      }),
      commands.register({
        // R193: Obsidian bookmarks:unbookmark — a dedicated REMOVE (≠ the toggle above),
        // only available when the active file is bookmarked. Reuses toggleFile (which
        // removes when present), so it never accidentally adds.
        id: "bookmarks:unbookmark",
        name: () => t("cmd.unbookmarkFile"),
        available: () => {
          const p = workspace.getActiveFile();
          return p !== null && bookmarks.isFileBookmarked(p);
        },
        callback: () => {
          const p = workspace.getActiveFile();
          if (p && bookmarks.isFileBookmarked(p)) void bookmarks.toggleFile(p);
        },
      }),
      commands.register({
        // R193: Obsidian bookmarks:bookmark-all-tabs — bookmark every open file-backed tab.
        // bookmarks.add is idempotent (already-present files no-op), so re-running is safe.
        id: "bookmarks:bookmark-all-tabs",
        name: () => t("cmd.bookmarkAllTabs"),
        callback: () => {
          const paths = [
            ...new Set(
              allTabs(workspace.state.get().root)
                .map((tb) => tb.filePath)
                .filter((p): p is string => p !== null),
            ),
          ];
          void (async () => {
            for (const p of paths) await bookmarks.add({ type: "file", path: p, ctime: Date.now() });
          })();
        },
      }),
      commands.register({
        // R239: Obsidian bookmarks:bookmark-search — bookmark the current search query.
        // SearchPanel mirrors its live query into workspace.currentSearchQuery.
        id: "bookmarks:bookmark-search",
        name: () => t("cmd.bookmarkSearch"),
        callback: () => {
          const query = workspace.currentSearchQuery.get().trim();
          if (!query) {
            showCommandNotice(t("bookmarks.noSearchToBookmark"));
            return;
          }
          void bookmarks.add({ type: "search", query, ctime: Date.now() });
          showCommandNotice(t("bookmarks.searchBookmarked"));
        },
      }),
      commands.register({
        id: "app:check-updates",
        name: () => t("cmd.checkUpdates"),
        available: () => updateSupported(),
        callback: () => {
          // flag first: the settings modal reads it on mount to land on the
          // About section and run one update check automatically
          requestUpdateAutoCheck();
          workspace.openModal("settings");
        },
      }),
    ];
    // R33 markdown formatting commands (bold/italic/link + toggle heading/quote/
    // code/callout/list). getView resolves the ACTIVE-FILE view only (R23 DS-1):
    // a format command never mutates a background/non-active file.
    disposers.push(
      ...registerFormatCommands(app, () => getActiveFileEditorView(app)?.view ?? null),
      ...registerBlockRefCommands(app, () => getActiveFileEditorView(app)?.view ?? null),
      ...registerComposerCommands(app, () => getActiveFileEditorView(app)?.view ?? null),
      ...registerEditorMotionCommands(app, () => getActiveFileEditorView(app)?.view ?? null),
      ...registerEditorEditCommands(app, () => getActiveFileEditorView(app)?.view ?? null),
      // R201: follow-link (⌥Enter) / open-link-in-new-leaf (⌘Enter) — need the path too
      ...registerLinkCommands(app, () => getActiveFileEditorView(app)),
      // R206: GFM table structural edits (insert/delete row & column)
      ...registerTableCommands(app, () => getActiveFileEditorView(app)?.view ?? null),
      // R209: attach file — pick a file, import to vault, insert `![[]]` (needs the path)
      ...registerAttachCommand(app, () => getActiveFileEditorView(app)),
    );
    // R34 in-editor find/replace commands (Mod+F search; replace = no default key,
    // macOS reserves Cmd+H). Same active-file gating as format commands.
    disposers.push(
      ...registerSearchCommands(app, () => getActiveFileEditorView(app)?.view ?? null),
    );
    // R36 tab keyboard shortcuts. next/prev use LITERAL Ctrl on every platform
    // (Cmd+Tab is the macOS app switcher); go-to-N / new / reopen use Mod (Cmd on
    // mac, Ctrl elsewhere). All operate on the ACTIVE pane (Obsidian cycles within
    // the current tab group). Ctrl+Tab in the editor is intercepted by the R33
    // Prec.highest keydown handler before CM treats Tab as indentation.
    disposers.push(
      commands.register({
        id: "app:next-tab",
        name: () => t("cmd.nextTab"),
        hotkey: "Ctrl+Tab",
        callback: () => workspace.cycleActiveTab(1),
      }),
      commands.register({
        id: "app:previous-tab",
        name: () => t("cmd.previousTab"),
        hotkey: "Ctrl+Shift+Tab",
        callback: () => workspace.cycleActiveTab(-1),
      }),
      ...Array.from({ length: 8 }, (_, i) => {
        const n = i + 1;
        return commands.register({
          id: `app:go-to-tab-${n}`,
          name: () => t("cmd.goToTab", { n }),
          hotkey: `Mod+${n}`,
          callback: () => workspace.activateTabAt(n - 1),
        });
      }),
      commands.register({
        id: "app:go-to-last-tab",
        name: () => t("cmd.goToLastTab"),
        hotkey: "Mod+9",
        callback: () => workspace.activateLastTab(),
      }),
      commands.register({
        id: "app:new-tab",
        name: () => t("cmd.newTab"),
        hotkey: "Mod+T",
        callback: () => {
          void (async () => {
            const path = vault.uniquePath("", "Untitled");
            await vault.create(path, "");
            // R233: an explicit new working tab always focuses (Always focus new tabs setting
            // governs file-opens from links/panels, not the Cmd+T new-tab command).
            workspace.openFile(path, { newTab: true, focus: true });
          })();
        },
      }),
      commands.register({
        id: "app:reopen-closed-tab",
        name: () => t("cmd.reopenClosedTab"),
        hotkey: "Mod+Shift+T",
        callback: () => workspace.reopenClosedTab(),
      }),
    );
    // R37 back/forward navigation history (per-tab). Mod+Alt+Arrow are the
    // Obsidian-canonical keys (focus-pane lost them above).
    disposers.push(
      commands.register({
        id: "app:navigate-back",
        name: () => t("cmd.navigateBack"),
        hotkey: "Mod+Alt+ArrowLeft",
        callback: () => workspace.navigateBack(),
      }),
      commands.register({
        id: "app:navigate-forward",
        name: () => t("cmd.navigateForward"),
        hotkey: "Mod+Alt+ArrowRight",
        callback: () => workspace.navigateForward(),
      }),
    );
    // R39 pin active tab (no default key — Obsidian has none; also via tab double-click)
    disposers.push(
      commands.register({
        id: "app:toggle-pin",
        name: () => t("cmd.togglePin"),
        available: () => workspace.getActiveTab() != null,
        callback: () => {
          const tab = workspace.getActiveTab();
          if (tab) workspace.toggleTabPin(tab.id);
        },
      }),
    );
    disposers.push(
      // R203: vault switcher — NOT isTauri-gated (the recents list + modal are pure frontend;
      // reopening a recent path needs no native dialog). "Open another vault" inside it still
      // routes to openVaultFlow's native picker (desktop).
      commands.register({
        id: "app:switch-vault",
        name: () => t("cmd.switchVault"),
        callback: () => workspace.openModal("vaultmanager"),
      }),
    );
    if (isTauri()) {
      disposers.push(
        commands.register({
          id: "app:open-vault",
          name: () => t("cmd.openVault"),
          callback: () => void openVaultFlow(app),
        }),
      );
      disposers.push(
        commands.register({
          id: "app:create-new-vault",
          name: () => t("cmd.createNewVault"),
          available: () => app.vault.adapter.kind !== "memory",
          callback: () => void (async () => {
            const picked = await app.vault.adapter.pickVaultFolder();
            if (!picked) return;
            await switchToVault(app, picked);
          })(),
        }),
      );
    }
    return () => disposers.forEach((d) => d());
  }, [app]);

  /* ---- flush pending editor saves on close ---- */
  useEffect(() => {
    const flush = () => void app.workspace.flushAll();
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);

    let disposed = false;
    let unlistenClose: (() => void) | null = null;
    if (isTauri()) {
      // dynamic import so the browser build never loads the Tauri module
      void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
        const unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
          event.preventDefault();
          await app.workspace.flushAll();
          void getCurrentWindow().destroy();
        });
        if (disposed) unlisten();
        else unlistenClose = unlisten;
      });
    }

    return () => {
      disposed = true;
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      unlistenClose?.();
    };
  }, [app]);

  /* ---- global hotkeys ---- */
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && app.workspace.state.get().modal) {
        app.workspace.closeModal();
        return;
      }
      app.commands.handleKeydown(e);
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [app]);

  /* ---- R227: Ctrl/Cmd + wheel adjusts the font size (Obsidian "Quick font size adjustment").
     Gated on the toggle so the default (OFF) path keeps the browser's passive-scroll fast path —
     the non-passive listener only exists while the feature is on. ---- */
  const quickZoom = useStore(quickFontZoom);
  useEffect(() => {
    if (!quickZoom) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return;
      e.preventDefault(); // intercept the webview's pinch/page zoom and change the font size instead
      app.workspace.setFontSize(app.workspace.state.get().fontSize + (e.deltaY < 0 ? 1 : -1));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [app, quickZoom]);

  /* ---- no vault yet (desktop only) ---- */
  if (!tree) {
    return (
      <div className={`app${isTauri() ? " is-native-window" : ""}`} data-testid="app-root">
        <VaultPicker />
      </div>
    );
  }

  return (
    <div className={`app${isTauri() ? " is-native-window" : ""}`} data-testid="app-root">
      {/* R20: appended "workspace*" classes mirror Obsidian's DOM so community
          theme CSS can target them — resident, additive only (contract) */}
      <div className="app-body workspace">
        {/* ribbon (R94: hidden when showRibbon is off) */}
        {ribbonVisible && (
        <nav className="ribbon workspace-ribbon side-dock-ribbon mod-left" aria-label={t("app.ribbonAria")}>
          <div className="ribbon-top-spacer" aria-hidden="true" data-tauri-drag-region />
          {graphEnabled && <RibbonButton icon="graph" title={t("app.ribbonGraph")} onClick={() => app.workspace.openGraph()} />}
          {commandPaletteEnabled && (
            <RibbonButton
              icon="command"
              title={t("app.ribbonPalette")}
              onClick={() => app.workspace.openModal("palette")}
            />
          )}
          {/* plugin-contributed sidebar panels (compat registerView): one selector button each */}
          {leftPanels.map((p) => (
            <button
              key={p.id}
              className={`ribbon-btn${ws.leftSidebarOpen && effectiveLeft === p.id ? " is-active" : ""}`}
              title={p.title}
              aria-label={p.title}
              data-testid={`sidebar-panel-btn-${p.id}`}
              onClick={() =>
                effectiveLeft === p.id && ws.leftSidebarOpen
                  ? app.workspace.toggleLeftSidebar()
                  : app.workspace.setLeftPanel(p.id)
              }
            >
              <SidebarPanelIcon panel={p} />
            </button>
          ))}
          {/* plugin-contributed ribbon icons (compat addRibbonIcon); els own their handlers */}
          <PluginElementHost
            items={ribbonItems}
            elClassName="ribbon-btn"
            testid="plugin-ribbon-items"
          />
          <div className="ribbon-spacer" />
        </nav>
        )}

        {/* left sidebar */}
        {ws.leftSidebarOpen && (
          <aside
            className="sidebar sidebar-left workspace-split mod-horizontal mod-left-split"
            style={{ width: ws.leftWidth }}
            data-testid="left-sidebar"
          >
            <div className="sidebar-primary-tabs" role="tablist" aria-label={t("app.leftPanelAria")} data-tauri-drag-region>
              {fileExplorerEnabled && (
                <button
                  role="tab"
                  aria-selected={effectiveLeft === "explorer"}
                  className={`sidebar-primary-tab${effectiveLeft === "explorer" ? " is-active" : ""}`}
                  title={t("app.ribbonExplorer")}
                  aria-label={t("app.ribbonExplorer")}
                  data-testid="left-tab-explorer"
                  onClick={() => app.workspace.setLeftPanel("explorer")}
                >
                  <Icon name="folder" size={18} />
                </button>
              )}
              {searchEnabled && (
                <button
                  role="tab"
                  aria-selected={effectiveLeft === "search"}
                  className={`sidebar-primary-tab${effectiveLeft === "search" ? " is-active" : ""}`}
                  title={t("app.ribbonSearch")}
                  aria-label={t("app.ribbonSearch")}
                  data-testid="left-tab-search"
                  onClick={() => app.workspace.setLeftPanel("search")}
                >
                  <Icon name="search" size={18} />
                </button>
              )}
              {bookmarksEnabled && (
                <button
                  role="tab"
                  aria-selected={effectiveLeft === "bookmarks"}
                  className={`sidebar-primary-tab${effectiveLeft === "bookmarks" ? " is-active" : ""}`}
                  title={t("app.ribbonBookmarks")}
                  aria-label={t("app.ribbonBookmarks")}
                  data-testid="left-tab-bookmarks"
                  onClick={() => app.workspace.setLeftPanel("bookmarks")}
                >
                  <Icon name="bookmark" size={18} />
                </button>
              )}
              <span className="sidebar-primary-spacer" />
              <button
                className="sidebar-primary-tab sidebar-collapse-tab"
                title={t("cmd.toggleLeftSidebar")}
                aria-label={t("cmd.toggleLeftSidebar")}
                data-testid="sidebar-toggle-left"
                onClick={() => app.workspace.toggleLeftSidebar()}
              >
                <Icon name="panel-left" size={18} />
              </button>
            </div>
            {activeLeftPanel ? (
              <SidebarPanelHost key={activeLeftPanel.id} panel={activeLeftPanel} />
            ) : ws.leftPanel === "search" && searchEnabled ? (
              <SearchPanel />
            ) : ws.leftPanel === "bookmarks" && bookmarksEnabled ? (
              <BookmarksPanel />
            ) : fileExplorerEnabled ? (
              <Explorer />
            ) : searchEnabled ? (
              <SearchPanel />
            ) : bookmarksEnabled ? (
              <BookmarksPanel />
            ) : null}
            <div className="sidebar-vault-footer" data-testid="sidebar-vault-footer">
              <VaultSwitcherControl />
              <button
                type="button"
                className="sidebar-footer-settings"
                data-testid="sidebar-footer-settings"
                title={t("app.ribbonSettings")}
                aria-label={t("app.ribbonSettings")}
                onClick={() => app.workspace.openModal("settings")}
              >
                <Icon name="settings" size={20} />
              </button>
            </div>
            <SidebarResizer side="left" />
          </aside>
        )}

        {/* main area: recursive pane tree */}
        <main className={`main workspace-split mod-vertical mod-root${
          ws.leftSidebarOpen ? "" : " is-left-sidebar-collapsed"
        }${ws.rightSidebarOpen ? "" : " is-right-sidebar-collapsed"}`}>
          <TabDragContext.Provider value={tabDrag}>
            <PaneTree node={ws.root} />
          </TabDragContext.Provider>
        </main>

        {/* right sidebar */}
        {ws.rightSidebarOpen && (
          <aside
            className="sidebar sidebar-right workspace-split mod-horizontal mod-right-split"
            style={{ width: ws.rightWidth }}
            data-testid="right-sidebar"
          >
            <SidebarResizer side="right" />
            <div className="right-tabs" role="tablist" aria-label={t("app.rightPanelAria")} data-tauri-drag-region>
              {backlinksEnabled && (
                <button
                  role="tab"
                  aria-selected={effectiveRight === "backlinks"}
                  className={`right-tab${effectiveRight === "backlinks" ? " is-active" : ""}`}
                  title={t("app.tabBacklinks")}
                  data-testid="right-tab-backlinks"
                  onClick={() => app.workspace.setRightPanel("backlinks")}
                >
                  <Icon name="link" size={18} />
                </button>
              )}
              {outgoingLinksEnabled && (
                <button
                  role="tab"
                  aria-selected={effectiveRight === "outgoinglinks"}
                  className={`right-tab${effectiveRight === "outgoinglinks" ? " is-active" : ""}`}
                  title={t("app.tabOutgoingLinks")}
                  data-testid="right-tab-outgoinglinks"
                  onClick={() => app.workspace.setRightPanel("outgoinglinks")}
                >
                  <Icon name="external-link" size={18} />
                </button>
              )}
              {footnotesViewEnabled && (
                <button
                  role="tab"
                  aria-selected={effectiveRight === "footnotes"}
                  className={`right-tab${effectiveRight === "footnotes" ? " is-active" : ""}`}
                  title={t("app.tabFootnotes")}
                  data-testid="right-tab-footnotes"
                  onClick={() => app.workspace.setRightPanel("footnotes")}
                >
                  <Icon name="footnote" size={18} />
                </button>
              )}
              {outlineEnabled && (
                <button
                  role="tab"
                  aria-selected={effectiveRight === "outline"}
                  className={`right-tab${effectiveRight === "outline" ? " is-active" : ""}`}
                  title={t("app.tabOutline")}
                  data-testid="right-tab-outline"
                  onClick={() => app.workspace.setRightPanel("outline")}
                >
                  <Icon name="list" size={18} />
                </button>
              )}
              {propertiesViewEnabled && (
                <button
                  role="tab"
                  aria-selected={effectiveRight === "allproperties"}
                  className={`right-tab${effectiveRight === "allproperties" ? " is-active" : ""}`}
                  title={t("app.tabAllProperties")}
                  data-testid="right-tab-allproperties"
                  onClick={() => app.workspace.setRightPanel("allproperties")}
                >
                  <Icon name="book-open" size={18} />
                </button>
              )}
              <button
                role="tab"
                aria-selected={effectiveRight === "fileproperties"}
                className={`right-tab${effectiveRight === "fileproperties" ? " is-active" : ""}`}
                title={t("app.tabFileProperties")}
                data-testid="right-tab-fileproperties"
                onClick={() => app.workspace.setRightPanel("fileproperties")}
              >
                <Icon name="file-text" size={18} />
              </button>
              {tagsEnabled && (
                <button
                  role="tab"
                  aria-selected={effectiveRight === "tags"}
                  className={`right-tab${effectiveRight === "tags" ? " is-active" : ""}`}
                  title={t("app.tabTags")}
                  data-testid="right-tab-tags"
                  onClick={() => app.workspace.setRightPanel("tags")}
                >
                  <Icon name="hash" size={18} />
                </button>
              )}
              <button
                role="tab"
                aria-selected={effectiveRight === "calendar"}
                className={`right-tab${effectiveRight === "calendar" ? " is-active" : ""}`}
                title={t("app.tabCalendar")}
                data-testid="right-tab-calendar"
                onClick={() => app.workspace.setRightPanel("calendar")}
              >
                <Icon name="calendar" size={18} />
              </button>
              {/* plugin-contributed sidebar panels (compat registerView): one tab each */}
              {rightPanels.map((p) => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={effectiveRight === p.id}
                  className={`right-tab${effectiveRight === p.id ? " is-active" : ""}`}
                  title={p.title}
                  data-testid={`sidebar-panel-tab-${p.id}`}
                  onClick={() => app.workspace.setRightPanel(p.id)}
                >
                  <SidebarPanelIcon panel={p} />
                </button>
              ))}
              <span className="right-tabs-spacer" />
              <button
                className="right-tab sidebar-collapse-tab"
                title={t("cmd.toggleRightSidebar")}
                aria-label={t("cmd.toggleRightSidebar")}
                data-testid="sidebar-toggle-right"
                onClick={() => app.workspace.toggleRightSidebar()}
              >
                <Icon name="panel-right" size={18} />
              </button>
            </div>
            <div className="right-panel-body">
              {activeRightPanel ? (
                <SidebarPanelHost key={activeRightPanel.id} panel={activeRightPanel} />
              ) : ws.rightPanel === "outline" && outlineEnabled ? (
                <OutlinePanel />
              ) : ws.rightPanel === "outgoinglinks" && outgoingLinksEnabled ? (
                <OutgoingLinksPanel />
              ) : ws.rightPanel === "footnotes" && footnotesViewEnabled ? (
                <FootnotesPanel />
              ) : ws.rightPanel === "allproperties" && propertiesViewEnabled ? (
                <AllPropertiesPanel />
              ) : ws.rightPanel === "fileproperties" ? (
                <FilePropertiesPanel />
              ) : ws.rightPanel === "tags" && tagsEnabled ? (
                <TagsPanel />
              ) : ws.rightPanel === "calendar" ? (
                <CalendarPanel />
              ) : backlinksEnabled ? (
                <BacklinksPanel />
              ) : (
                <CalendarPanel />
              )}
            </div>
          </aside>
        )}

        {/* C5: visible sidebar collapse/expand toggles (commands stay unbound,
            matching Obsidian's default — users bind keys in Hotkeys settings) */}
        <SidebarToggle
          side="left"
          open={ws.leftSidebarOpen}
          offset={(ribbonVisible ? 44 : 0) + (ws.leftSidebarOpen ? ws.leftWidth : 0)}
          label={t("cmd.toggleLeftSidebar")}
          onToggle={() => app.workspace.toggleLeftSidebar()}
        />
        <SidebarToggle
          side="right"
          open={ws.rightSidebarOpen}
          offset={ws.rightSidebarOpen ? ws.rightWidth : 0}
          label={t("cmd.toggleRightSidebar")}
          onToggle={() => app.workspace.toggleRightSidebar()}
        />
      </div>

      {/* status bar (R100: hidden when showStatusBar is off) */}
      {statusBarVisible && (
      <footer className="status-bar" data-testid="status-bar">
        {[...statusItems.entries()].map(([id, text]) => (
          <span key={id} className="status-item">
            {text}
          </span>
        ))}
        {/* element-based status bar items (compat addStatusBarItem) */}
        <PluginElementHost
          items={statusBarElements}
          elClassName="status-item"
          testid="plugin-status-bar-items"
        />
      </footer>
      )}

      {/* modals */}
      {ws.modal === "palette" && <CommandPalette />}
      {ws.modal === "switcher" && <QuickSwitcher />}
      {ws.modal === "templates" && <TemplateSelector />}
      {ws.modal === "settings" && <SettingsModal />}
      {ws.modal === "workspaces" && <WorkspacesModal />}
      {ws.modal === "recovery" && <RecoveryModal />}
      {ws.modal === "slides" && <SlidesOverlay />}
      {ws.modal === "vaultmanager" && <VaultManagerModal />}

      {/* hover preview card (R25) — mounts the document-level hover controller */}
      <HoverPreview />
    </div>
  );
}

/**
 * The Obsidian-style vault control that lives in the left dock footer. Its
 * first layer is deliberately a small menu (current + recent vaults), while
 * the existing full manager remains available from the final menu item.
 */
function VaultSwitcherControl() {
  const app = useApp();
  const t = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [vaults, setVaults] = useState<RecentVaultRecord[]>([]);
  const currentPath = app.vault.getVaultPath();
  const recentVaults = vaults.filter((record) => record.path !== currentPath);

  useEffect(() => {
    if (!open && !contextOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setContextOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setContextOpen(false);
      }
    };
    // Capture phase so the menu closes even when an inner component stops
    // propagation (e.g. Explorer row context menus).
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, contextOpen]);

  /* Position the vault context menu inside the viewport and focus the first
     enabled item when it opens. */
  useLayoutEffect(() => {
    const element = contextMenuRef.current;
    if (!contextOpen || !element) return;
    const placeInsideViewport = () => {
      const gutter = 8;
      const rect = element.getBoundingClientRect();
      const parent = element.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const absLeft = rect.left - parent.left;
      const absTop = rect.top - parent.top;
      const maxLeft = Math.max(gutter, window.innerWidth - rect.width - gutter - parent.left);
      const maxTop = Math.max(gutter, window.innerHeight - rect.height - gutter - parent.top);
      element.style.left = `${Math.max(gutter - parent.left, Math.min(absLeft, maxLeft))}px`;
      element.style.top = `${Math.max(gutter - parent.top, Math.min(absTop, maxTop))}px`;
      element.style.bottom = "auto";
    };
    placeInsideViewport();
    const firstButton = element.querySelector<HTMLButtonElement>("button:not(:disabled)");
    firstButton?.focus();
    window.addEventListener("resize", placeInsideViewport);
    return () => window.removeEventListener("resize", placeInsideViewport);
  }, [contextOpen]);

  const focusContextItem = (delta: number) => {
    const menu = contextMenuRef.current;
    if (!menu) return;
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    if (!items.length) return;
    const index = items.findIndex((item) => item === document.activeElement);
    const nextIndex = index < 0 ? 0 : Math.max(0, Math.min(items.length - 1, index + delta));
    items[nextIndex]?.focus();
  };

  const toggle = () => {
    setVaults(loadRecentVaultRecords());
    setContextOpen(false);
    setOpen((value) => !value);
  };
  const selectVault = (path: string | null) => {
    setOpen(false);
    if (!path || path === currentPath) return;
    void switchToVault(app, path).catch((err) => {
      console.error("[vault] switch failed; forgetting", path, err);
      removeRecentVault(path);
    });
  };
  const manageVaults = () => {
    setOpen(false);
    app.workspace.openModal("vaultmanager");
  };
  const revealVault = () => {
    setContextOpen(false);
    if (!currentPath) return;
    void revealInSystem(currentPath, "").catch((err) =>
      console.error("[vault] reveal root failed", err),
    );
  };
  const copyVaultPath = () => {
    setContextOpen(false);
    if (!currentPath) return;
    void navigator.clipboard.writeText(currentPath)
      .then(() => showCommandNotice(t("vaultContext.pathCopied")))
      .catch((err) => console.error("[vault] copy path failed", err));
  };

  return (
    <div className="vault-switcher-control" ref={rootRef}>
      <button
        type="button"
        className={`status-vault${open ? " is-open" : ""}`}
        data-testid="status-vault"
        title={t("cmd.switchVault")}
        aria-label={t("cmd.switchVault")}
        aria-haspopup="menu"
        aria-expanded={open || contextOpen}
        onClick={toggle}
        onContextMenu={(event) => {
          event.preventDefault();
          setOpen(false);
          setContextOpen(true);
        }}
      >
        <Icon name="chevrons-up-down" size={16} />
        <span>{app.vault.vaultName}</span>
      </button>
      {open && (
        <div className="vault-switcher-menu" role="menu" data-testid="vault-switcher-menu">
          <button
            type="button"
            className="vault-switcher-menu-item is-current"
            role="menuitemradio"
            aria-checked="true"
            onClick={() => selectVault(currentPath)}
          >
            <span className="vault-switcher-menu-check"><Icon name="check" size={16} /></span>
            <span className="vault-switcher-menu-label">{app.vault.vaultName}</span>
          </button>
          {recentVaults.map((record) => (
            <button
              key={record.id}
              type="button"
              className="vault-switcher-menu-item"
              role="menuitemradio"
              aria-checked="false"
              title={record.path}
              onClick={() => selectVault(record.path)}
            >
              <span className="vault-switcher-menu-check" />
              <span className="vault-switcher-menu-label">{record.name ?? vaultPathName(record.path)}</span>
            </button>
          ))}
          <div className="vault-switcher-menu-separator" role="separator" />
          <button
            type="button"
            className="vault-switcher-menu-item"
            role="menuitem"
            data-testid="vault-switcher-manage"
            onClick={manageVaults}
          >
            <span className="vault-switcher-menu-check" />
            <span className="vault-switcher-menu-label">{t("vaultManager.manage")}</span>
          </button>
        </div>
      )}
      {contextOpen && (
        <div
          ref={contextMenuRef}
          className="vault-context-menu"
          role="menu"
          data-testid="vault-context-menu"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowRight") {
              event.preventDefault();
              focusContextItem(1);
            } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
              event.preventDefault();
              focusContextItem(-1);
            } else if (event.key === "Home") {
              event.preventDefault();
              focusContextItem(Number.NEGATIVE_INFINITY);
            } else if (event.key === "End") {
              event.preventDefault();
              focusContextItem(Number.POSITIVE_INFINITY);
            } else if (event.key === "Tab") {
              event.preventDefault();
              focusContextItem(event.shiftKey ? -1 : 1);
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="vault-context-reveal"
            disabled={!currentPath}
            onClick={revealVault}
          >
            {t("vaultContext.reveal")}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="vault-context-copy-path"
            disabled={!currentPath}
            onClick={copyVaultPath}
          >
            {t("vaultContext.copyPath")}
          </button>
        </div>
      )}
    </div>
  );
}

/** The reported active editor view, but only when it belongs to the
 *  workspace-active tab's file. The raw report is a latched field that can go
 *  stale (a background pane's live editor while a preview/graph tab is
 *  active) — writing through it would edit a NON-active file (R23 review
 *  major DS-1). Pre-R23 consumers (fold commands) are non-destructive. */
function getActiveFileEditorView(app: ReturnType<typeof useApp>) {
  const active = app.documents.getActiveView();
  if (!active || active.path !== app.workspace.getActiveFile()) return null;
  return active;
}

/**
 * Insert the formatted current date/time at the active editor's selection
 * (R23 insert-date / insert-time commands). Routing through expandTemplate
 * keeps the format consumption (trim, empty = default) in core/templates —
 * the replaced value is never re-scanned (single pass).
 */
function insertNowAtSelection(
  app: ReturnType<typeof useApp>,
  variable: "{{date}}" | "{{time}}",
): void {
  const active = getActiveFileEditorView(app);
  if (!active) return;
  const insert = expandTemplate(variable, { title: "", now: new Date() });
  const main = active.view.state.selection.main;
  // single transaction: replaces a non-empty selection, cursor lands at the
  // end of the inserted text
  active.view.dispatch({
    changes: { from: main.from, to: main.to, insert },
    selection: { anchor: main.from + insert.length },
  });
}

/** The active-file editor's path + parsed metadata + cursor offset, or null
 *  when there is no active editor file / no metadata (R27 shared preamble for
 *  the bookmark-heading / bookmark-block commands). */
function cursorContext(app: ReturnType<typeof useApp>) {
  const active = getActiveFileEditorView(app);
  if (!active) return null;
  const meta = app.metadata.getMetadata(active.path);
  if (!meta) return null;
  return { path: active.path, meta, cursor: active.view.state.selection.main.head };
}

/** The heading the editor cursor is currently under (R27 bookmark-heading):
 *  the last heading whose start offset is <= the cursor. Returns the path +
 *  Obsidian-shape subpath ("#" + heading text); null when no active editor
 *  file, no metadata, or the cursor sits above the first heading. */
function headingUnderCursor(
  app: ReturnType<typeof useApp>,
): { path: string; subpath: string } | null {
  const ctx = cursorContext(app);
  if (!ctx || ctx.meta.headings.length === 0) return null;
  let hit: { text: string } | null = null;
  for (const h of ctx.meta.headings) {
    if (h.from <= ctx.cursor) hit = h;
    else break;
  }
  if (!hit) return null;
  return { path: ctx.path, subpath: `#${hit.text}` };
}

/** The block the editor cursor sits inside (R27 bookmark-block): a block whose
 *  span [from, to) contains the cursor. We do NOT mint new block ids this round
 *  — only blocks that already carry a `^id` (indexed in metadata) qualify, so
 *  the command is unavailable when the cursor is not on an id'd block. */
function blockUnderCursor(
  app: ReturnType<typeof useApp>,
): { path: string; subpath: string } | null {
  const ctx = cursorContext(app);
  if (!ctx || ctx.meta.blocks.length === 0) return null;
  const hit = ctx.meta.blocks.find((b) => b.from <= ctx.cursor && ctx.cursor <= b.to);
  if (!hit) return null;
  return { path: ctx.path, subpath: `#^${hit.id}` };
}

/* ---------------- pieces ---------------- */

/** Drag handle on the inner edge of a sidebar. */
function SidebarResizer({ side }: { side: "left" | "right" }) {
  const app = useApp();
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "left" ? app.workspace.state.get().leftWidth : app.workspace.state.get().rightWidth;
    const onMove = (ev: MouseEvent) => {
      if (ev.buttons === 0) {
        // mouseup happened outside the window — treat as drag end
        cleanup();
        return;
      }
      const dx = ev.clientX - startX;
      app.workspace.setSidebarWidth(side, side === "left" ? startW + dx : startW - dx);
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", cleanup);
      window.removeEventListener("blur", cleanup);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", cleanup);
    window.addEventListener("blur", cleanup);
  };
  return (
    <div
      className={`sidebar-resizer sidebar-resizer-${side}`}
      data-testid={`resizer-${side}`}
      onMouseDown={onMouseDown}
    />
  );
}

/**
 * Hosts plugin-owned DOM elements (compat ribbon icons / status bar items).
 * `display: contents` makes each el a direct flex item of the surrounding
 * ribbon/status-bar container, so they pick up the native layout. The els
 * carry their own event handlers — we only append/remove them.
 */
function PluginElementHost({
  items,
  elClassName,
  testid,
}: {
  items: ReadonlyArray<{ id: string; el: HTMLElement }>;
  elClassName: string;
  testid: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    for (const { el } of items) {
      el.classList.add(elClassName);
      host.appendChild(el);
    }
    return () => {
      for (const { el } of items) {
        if (el.parentNode === host) host.removeChild(el);
      }
    };
  }, [items, elClassName]);
  return <div ref={hostRef} style={{ display: "contents" }} data-testid={testid} />;
}

/**
 * Hosts a plugin-owned sidebar panel body (compat registerView custom views).
 * Same append/remove pattern as PluginElementHost; keyed by panel id so a
 * panel switch unmounts the old element before the new one is appended.
 */
function SidebarPanelHost({ panel }: { panel: SidebarPanelContribution }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.appendChild(panel.el);
    return () => {
      if (panel.el.parentNode === host) host.removeChild(panel.el);
    };
  }, [panel]);
  return (
    <div ref={hostRef} className="sidebar-panel-host" data-testid={`sidebar-panel-${panel.id}`} />
  );
}

/** Selector icon for a plugin sidebar panel: raw svg markup, or the title's first letter. */
function SidebarPanelIcon({ panel }: { panel: SidebarPanelContribution }) {
  if (panel.iconSvg && isSingleSvgMarkup(panel.iconSvg)) {
    return (
      <IconMarkup
        markup={panel.iconSvg}
        size={18}
        className="sidebar-panel-icon"
      />
    );
  }
  return (
    <span className="sidebar-panel-icon sidebar-panel-icon-fallback" aria-hidden="true">
      {panel.title.charAt(0).toUpperCase()}
    </span>
  );
}

function RibbonButton(props: { icon: string; title: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      className={`ribbon-btn${props.active ? " is-active" : ""}`}
      title={props.title}
      aria-label={props.title}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={18} />
    </button>
  );
}

/**
 * Reopen affordance for a collapsed sidebar, anchored to `.app-body`.
 * `offset` is the live pixel distance of the sidebar↔main border so it tracks
 * resize. Hidden when the sidebar is open — the open-state control lives in the
 * matching sidebar top bar. Uses Obsidian-style panel-left/panel-right icons.
 */
function SidebarToggle(props: {
  side: "left" | "right";
  open: boolean;
  offset: number;
  label: string;
  onToggle: () => void;
}) {
  // The open-state control lives in the matching sidebar top bar. Keep this
  // edge affordance only for reopening a collapsed sidebar.
  if (props.open) return null;
  return (
    <button
      className={`sidebar-toggle sidebar-toggle-${props.side}`}
      style={props.side === "left" ? { left: props.offset } : { right: props.offset }}
      aria-label={props.label}
      title={props.label}
      data-testid={`sidebar-toggle-${props.side}`}
      onClick={props.onToggle}
    >
      <Icon name={props.side === "left" ? "panel-left" : "panel-right"} size={18} />
    </button>
  );
}

/** Recursive renderer for the workspace pane tree. */
function PaneTree({ node }: { node: PaneNode }) {
  if (node.kind === "leaf") return <PaneLeafView leaf={node} />;
  return <PaneSplitView split={node} />;
}

function PaneSplitView({ split }: { split: PaneSplit }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={containerRef}
      className={`pane-split pane-split-${split.direction}`}
      data-testid={`pane-split-${split.id}`}
    >
      {split.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <PaneResizer split={split} index={i - 1} containerRef={containerRef} />}
          <div
            className="pane-split-child"
            style={{ flexGrow: split.sizes[i] ?? 1, flexBasis: 0 }}
          >
            <PaneTree node={child} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/** Drag handle between two adjacent children of a split. `index` is the gap index (0..n-2). */
function PaneResizer({
  split,
  index,
  containerRef,
}: {
  split: PaneSplit;
  index: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const app = useApp();
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const total = split.direction === "row" ? rect.width : rect.height;
    if (total <= 0) return;
    const start = split.direction === "row" ? e.clientX : e.clientY;
    const startSizes = [...split.sizes];
    const sizeAt = (i: number) => startSizes[i] ?? 1;
    const onMove = (ev: MouseEvent) => {
      if (ev.buttons === 0) {
        // mouseup happened outside the window — treat as drag end
        cleanup();
        return;
      }
      const cur = split.direction === "row" ? ev.clientX : ev.clientY;
      const raw = (cur - start) / total;
      // clamp so both adjacent children stay >= MIN_PANE_FRACTION and their sum is
      // unchanged — untouched siblings are never squeezed
      const min = MIN_PANE_FRACTION - sizeAt(index);
      const max = sizeAt(index + 1) - MIN_PANE_FRACTION;
      const delta = Math.min(Math.max(raw, min), max);
      const sizes = [...startSizes];
      sizes[index] = sizeAt(index) + delta;
      sizes[index + 1] = sizeAt(index + 1) - delta;
      app.workspace.setSplitSizes(split.id, sizes);
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", cleanup);
      window.removeEventListener("blur", cleanup);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = split.direction === "row" ? "col-resize" : "row-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", cleanup);
    window.addEventListener("blur", cleanup);
  };
  return (
    <div
      className={`pane-resizer pane-resizer-${split.direction}`}
      data-testid={`pane-resizer-${split.id}-${index}`}
      onMouseDown={onMouseDown}
    />
  );
}

function PaneLeafView({ leaf }: { leaf: PaneLeaf }) {
  const app = useApp();
  const ws = useStore(app.workspace.state);
  /* R295: re-render on core-plugin toggle so a disabled singleton view's tab
     switches to the inert placeholder (renderTab gates on these). */
  useStore(app.plugins.revision);
  const graphEnabled = app.plugins.isEnabled("graph");
  const backlinksEnabled = app.plugins.isEnabled("backlinks");
  const outgoingLinksEnabled = app.plugins.isEnabled("outgoing-links");
  const outlineEnabled = app.plugins.isEnabled("outline");
  const { draggingTabId, setDraggingTabId } = useContext(TabDragContext);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const isActive = ws.activePaneId === leaf.id;
  const activeTab = leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? null;
  const stacked = leaf.stacked === true && leaf.tabs.length > 0;

  // R254: render one tab's content via the viewType dispatch. `autoFocus` gates
  // EditorPane's mount focus() so a stacked group (all tabs mounted at once)
  // doesn't fight over focus — only the leaf's active tab grabs it.
  // R295: a fileless singleton view whose core plugin is disabled renders an inert
  // placeholder (the open command is auto-disposed so no new tabs appear; the user
  // may close this one). See ARCHITECTURE.md "Round 295 additions".
  const disabledView = <div className="main-view-disabled" />;
  const renderTab = (tab: TabState, autoFocus: boolean) =>
    tab.viewType === "graph" ? (
      graphEnabled ? <GraphView /> : disabledView
    ) : tab.viewType === "backlinks" ? (
      backlinksEnabled ? (
        <div className="main-backlinks-view markdown-reading-view"><BacklinksPanel /></div>
      ) : disabledView
    ) : tab.viewType === "outgoinglinks" ? (
      outgoingLinksEnabled ? (
        <div className="main-outgoinglinks-view markdown-reading-view"><OutgoingLinksPanel /></div>
      ) : disabledView
    ) : tab.viewType === "outline" ? (
      outlineEnabled ? (
        <div className="main-outline-view markdown-reading-view"><OutlinePanel /></div>
      ) : disabledView
    ) : tab.viewType === "attachment" ? (
      <AttachmentView key={tab.id} tab={tab} />
    ) : (
      <EditorPane key={tab.id} tab={tab} autoFocus={autoFocus} />
    );

  return (
    <section
      className={`pane${isActive ? " is-active" : ""}`}
      data-testid={`pane-${leaf.id}`}
      data-active={isActive || undefined}
      onMouseDownCapture={() => {
        if (!isActive) app.workspace.setActivePane(leaf.id);
      }}
    >
      <TabBar leaf={leaf} />
      <div className={`main-content${stacked ? " is-stacked" : ""}`}>
        {stacked ? (
          // R254 Stacked tabs: render EVERY tab as a horizontal-cascade column,
          // all mounted (autosave stays per-file). Clicking a column activates it
          // (setActiveTab re-keys leaf.activeTabId; EditorPane focuses on activation).
          leaf.tabs.map((tab) => (
            <div
              key={tab.id}
              className={`stacked-column${tab.id === leaf.activeTabId ? " is-active" : ""}`}
              data-testid={`stacked-column-${tab.id}`}
              onMouseDownCapture={() => {
                if (tab.id !== leaf.activeTabId) app.workspace.setActiveTab(tab.id);
              }}
            >
              <button
                type="button"
                className="stacked-column-header"
                data-testid={`stacked-column-header-${tab.id}`}
                title={tab.title}
                // don't let the button grab focus on mousedown — the column's
                // onMouseDownCapture already activates the tab, and EditorPane's
                // activation effect then focuses the editor; without this the button
                // would steal that focus back on mouseup (R255 review).
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => app.workspace.setActiveTab(tab.id)}
              >
                <span className="stacked-column-title">{tab.title}</span>
              </button>
              <div className="stacked-column-body">{renderTab(tab, tab.id === leaf.activeTabId)}</div>
            </div>
          ))
        ) : activeTab ? (
          renderTab(activeTab, true)
        ) : (
          <EmptyState />
        )}
        {/* five-zone drop overlay, mounted only while a tab drag is in flight so it
            sits above the editor and owns the dragover/drop events */}
        {draggingTabId !== null && (
          <div
            className="pane-drop-overlay"
            data-testid="pane-drop-overlay"
            onDragOver={(e) => {
              if (!isTabDrag(e)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const zone = zoneFromEvent(e);
              setDropZone((prev) => (prev === zone ? prev : zone));
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setDropZone(null);
            }}
            onDrop={(e) => {
              if (!isTabDrag(e)) return;
              e.preventDefault();
              e.stopPropagation();
              const tabId = e.dataTransfer.getData(TAB_MIME);
              const zone = zoneFromEvent(e);
              setDropZone(null);
              setDraggingTabId(null);
              if (!tabId) return;
              if (zone === "center") {
                // dropping a tab onto its own pane's center is a no-op (would
                // otherwise silently reorder it to the end)
                if (findTabLeaf(ws.root, tabId)?.id === leaf.id) return;
                app.workspace.moveTab(tabId, leaf.id);
              } else {
                app.workspace.moveTabToEdge(tabId, leaf.id, zone);
              }
            }}
          >
            {dropZone && <div className={`pane-drop-zone pane-drop-zone-${dropZone}`} />}
          </div>
        )}
      </div>
    </section>
  );
}

function TabBar({ leaf }: { leaf: PaneLeaf }) {
  const app = useApp();
  const t = useI18n();
  const tabBarVisible = useStore(showTabTitleBar); // R100: hide each pane's tab strip when off
  const { setDraggingTabId } = useContext(TabDragContext);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // R81: tab right-click context menu (TagsPanel inline pattern). R256: `kind`
  // discriminates the tab right-click menu ("tab") from the view-header "…"
  // more-options menu ("viewopts"), which share the dismiss/runMenu machinery.
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
    kind: "tab" | "viewopts" | "tablist";
  } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.(".tab-list-toggle, .tab-more-options")) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  const activeTab = leaf.tabs.find((tab) => tab.id === leaf.activeTabId) ?? null;
  const menuTab = menu ? leaf.tabs.find((tb) => tb.id === menu.tabId) ?? null : null;
  const runMenu = (fn: () => void) => {
    fn();
    setMenu(null);
  };
  // R256: render a view-options menu item that delegates to an existing vetted
  // command (mirrors R252 editorMenu's addFileActionItems, but as React JSX — the
  // shell can't import compat). Hidden when the command is missing or its
  // available() gate is false (desktop-only reveal/open hide in the browser).
  const cmdMenuItem = (id: string, testid: string, danger = false) => {
    const cmd = app.commands.list().find((c) => c.id === id);
    if (!cmd || cmd.available?.() === false) return null;
    return (
      <button
        key={id}
        role="menuitem"
        data-testid={testid}
        className={danger ? "is-danger" : undefined}
        onClick={() => runMenu(() => void app.commands.execute(id))}
      >
        {getCommandName(cmd)}
      </button>
    );
  };

  /** Insert index from the pointer x relative to each tab's midpoint. */
  const indexFromEvent = (e: React.DragEvent<HTMLElement>): number => {
    const tabEls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(":scope > .tab"));
    for (let i = 0; i < tabEls.length; i++) {
      const r = tabEls[i]!.getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) return i;
    }
    return tabEls.length;
  };

  // R100: tabs stay reachable via Ctrl+Tab / the command palette when hidden
  if (!tabBarVisible) return null;

  return (
    <div
      className="tab-bar"
      role="tablist"
      data-testid={`tab-bar-${leaf.id}`}
      data-tauri-drag-region
      onDragOver={(e) => {
        if (!isTabDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const idx = indexFromEvent(e);
        setDropIndex((prev) => (prev === idx ? prev : idx));
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropIndex(null);
      }}
      onDrop={(e) => {
        if (!isTabDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const tabId = e.dataTransfer.getData(TAB_MIME);
        const idx = indexFromEvent(e);
        setDropIndex(null);
        setDraggingTabId(null);
        if (tabId) app.workspace.moveTab(tabId, leaf.id, idx);
      }}
    >
      {leaf.tabs.map((tab, i) => {
        /* the graph tab's stored title is persisted in workspace state —
           ignore it at render time so the label follows the UI locale;
           file tabs keep the basename verbatim */
        const title =
          tab.viewType === "graph" ? t("app.graphTab")
          : tab.viewType === "backlinks" ? t("app.backlinksTab")
          : tab.viewType === "outgoinglinks" ? t("app.outgoingLinksTab")
          : tab.viewType === "outline" ? t("app.outlineTab")
          : tab.title;
        return (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === leaf.activeTabId}
          className={`tab${tab.id === leaf.activeTabId ? " is-active" : ""}${
            tab.pinned ? " is-pinned" : ""
          }${dropIndex === i ? " tab-drop-before" : ""}${
            dropIndex === leaf.tabs.length && i === leaf.tabs.length - 1 ? " tab-drop-after" : ""
          }`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(TAB_MIME, tab.id);
            e.dataTransfer.effectAllowed = "move";
            // defer so the DOM is not mutated inside dragstart (Chromium cancels the drag)
            window.setTimeout(() => setDraggingTabId(tab.id), 0);
          }}
          onDragEnd={() => setDraggingTabId(null)}
          onClick={() => app.workspace.setActiveTab(tab.id)}
          onDoubleClick={() => app.workspace.toggleTabPin(tab.id)}
          onAuxClick={(e) => e.button === 1 && app.workspace.closeTab(tab.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, tabId: tab.id, kind: "tab" });
          }}
          title={tab.filePath ?? title}
        >
          {tab.viewType === "graph" && <Icon name="graph" size={14} />}
          {tab.viewType === "backlinks" && <Icon name="link" size={14} />}
          {tab.viewType === "outgoinglinks" && <Icon name="external-link" size={14} />}
          {tab.viewType === "outline" && <Icon name="list" size={14} />}
          {tab.viewType === "attachment" && <Icon name="file-text" size={14} />}
          {tab.pinned && (
            <span className="tab-pin" aria-label={t("app.pinnedTab")} title={t("app.pinnedTab")}>
              <Icon name="pin" size={12} />
            </span>
          )}
          <span className="tab-title">{title}</span>
          <button
            className="tab-close"
            aria-label={t("app.closeTab", { title })}
            onClick={(e) => {
              e.stopPropagation();
              app.workspace.closeTab(tab.id);
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        );
      })}
      <button
        className="tab-new"
        title={t("app.newNoteTitle")}
        aria-label={t("app.newNote")}
        onClick={() => app.commands.execute("app:new-note")}
      >
        <Icon name="plus" size={18} />
      </button>
      <button
        className="tab-list-toggle"
        data-testid={`tab-list-toggle-${leaf.id}`}
        title={t("app.openTabs")}
        aria-label={t("app.openTabs")}
        disabled={!leaf.activeTabId}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (leaf.activeTabId) {
            setMenu((current) => current?.kind === "tablist"
              ? null
              : { x: rect.right, y: rect.bottom, tabId: leaf.activeTabId!, kind: "tablist" });
          }
        }}
      >
        <Icon name="chevron-down" size={18} />
      </button>
      {/* R256: view-header "…" more-options menu (Obsidian native·tab/view 顶部「更多选项」)
          — opens an aggregate menu of view-mode + file actions + tab/pane ops for the
          active tab. The "…" button activates its own pane via the pane's mousedown
          capture, so the wired commands target this leaf's active file. */}
      {activeTab?.viewType !== "markdown" && <button
        className="tab-more-options"
        data-testid={`view-header-more-${leaf.id}`}
        title={t("app.moreOptions")}
        aria-label={t("app.moreOptions")}
        disabled={!leaf.activeTabId}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (leaf.activeTabId) {
            setMenu((current) => current?.kind === "viewopts"
              ? null
              : { x: r.left, y: r.bottom, tabId: leaf.activeTabId!, kind: "viewopts" });
          }
        }}
      >
        <Icon name="more-vertical" size={16} />
      </button>}
      {menu && menuTab && menu.kind === "tab" && (
        <div
          ref={menuRef}
          className="tab-context-menu"
          data-testid="tab-context-menu"
          role="menu"
          style={{
            left: Math.max(0, Math.min(menu.x, window.innerWidth - 200)),
            top: Math.max(0, Math.min(menu.y, window.innerHeight - 280)),
          }}
        >
          <button role="menuitem" data-testid="tabctx-close" onClick={() => runMenu(() => app.workspace.closeTab(menu.tabId))}>
            {t("app.tabClose")}
          </button>
          <button role="menuitem" data-testid="tabctx-close-others" onClick={() => runMenu(() => app.workspace.closeOtherTabs(menu.tabId))}>
            {t("app.tabCloseOthers")}
          </button>
          <button role="menuitem" data-testid="tabctx-close-right" onClick={() => runMenu(() => app.workspace.closeTabsToRight(menu.tabId))}>
            {t("app.tabCloseRight")}
          </button>
          <button role="menuitem" data-testid="tabctx-close-all" onClick={() => runMenu(() => app.workspace.closeAllTabs(menu.tabId))}>
            {t("app.tabCloseAll")}
          </button>
          <div className="tab-context-sep" />
          <button role="menuitem" data-testid="tabctx-pin" onClick={() => runMenu(() => app.workspace.toggleTabPin(menu.tabId))}>
            {t(menuTab.pinned ? "app.tabUnpin" : "app.tabPin")}
          </button>
          <button
            role="menuitem"
            data-testid="tabctx-split-right"
            disabled={isFilelessSingletonView(menuTab.viewType)}
            onClick={() => runMenu(() => { app.workspace.setActiveTab(menu.tabId); app.workspace.splitActivePane("row"); })}
          >
            {t("app.tabSplitRight")}
          </button>
          <button
            role="menuitem"
            data-testid="tabctx-split-down"
            disabled={isFilelessSingletonView(menuTab.viewType)}
            onClick={() => runMenu(() => { app.workspace.setActiveTab(menu.tabId); app.workspace.splitActivePane("column"); })}
          >
            {t("app.tabSplitDown")}
          </button>
          <div className="tab-context-sep" />
          {/* R254: Stack/Unstack the whole tab group (Obsidian "Stack tabs") */}
          <button role="menuitem" data-testid="tabctx-toggle-stacked" onClick={() => runMenu(() => app.workspace.toggleStacked(leaf.id))}>
            {t(leaf.stacked ? "app.tabUnstack" : "app.tabStack")}
          </button>
        </div>
      )}
      {menu && menuTab && menu.kind === "tablist" && (
        <div
          ref={menuRef}
          className="tab-context-menu tab-list-menu"
          data-testid="tab-list-menu"
          role="menu"
          style={{
            right: Math.max(8, window.innerWidth - menu.x),
            top: Math.max(0, Math.min(menu.y, window.innerHeight - 280)),
          }}
        >
          {leaf.tabs.map((tab) => (
            <button
              key={tab.id}
              role="menuitem"
              className={tab.id === leaf.activeTabId ? "is-selected" : undefined}
              data-testid={`tab-list-item-${tab.id}`}
              onClick={() => runMenu(() => app.workspace.setActiveTab(tab.id))}
            >
              <span className="tab-list-check" aria-hidden="true">
                {tab.id === leaf.activeTabId && <Icon name="check" size={14} />}
              </span>
              <span>{tab.title}</span>
            </button>
          ))}
        </div>
      )}
      {menu && menuTab && menu.kind === "viewopts" && (
        <div
          ref={menuRef}
          className="tab-context-menu"
          data-testid="view-options-menu"
          role="menu"
          style={{
            left: Math.max(0, Math.min(menu.x, window.innerWidth - 220)),
            top: Math.max(0, Math.min(menu.y, window.innerHeight - 380)),
          }}
        >
          {/* view mode (markdown only) */}
          {menuTab.viewType === "markdown" && cmdMenuItem("app:toggle-mode", "viewopt-toggle-mode")}
          {menuTab.viewType === "markdown" && <div className="tab-context-sep" />}
          {/* file actions (file-bearing tabs; markdown-only ones gated separately) */}
          {menuTab.filePath !== null && cmdMenuItem("bookmarks:bookmark-file", "viewopt-bookmark")}
          {menuTab.viewType === "markdown" && cmdMenuItem("editor:add-property", "viewopt-add-property")}
          {menuTab.viewType === "markdown" && cmdMenuItem("app:export-pdf", "viewopt-export-pdf")}
          {menuTab.filePath !== null && cmdMenuItem("file-explorer:copy-path", "viewopt-copy-path")}
          {menuTab.filePath !== null && cmdMenuItem("workspace:copy-url", "viewopt-copy-url")}
          {/* R256 review: in-app "Reveal file in navigation" — cross-platform, so the only
              reveal option in the browser (both desktop reveals below hide via available()) */}
          {menuTab.filePath !== null && cmdMenuItem("file-explorer:reveal-active-file", "viewopt-reveal-nav")}
          {menuTab.filePath !== null && cmdMenuItem("file-explorer:reveal-in-system", "viewopt-reveal")}
          {menuTab.filePath !== null && cmdMenuItem("file-explorer:open-in-default-app", "viewopt-open-default")}
          {menuTab.filePath !== null && cmdMenuItem("workspace:edit-file-title", "viewopt-rename")}
          {menuTab.filePath !== null && cmdMenuItem("app:delete-file", "viewopt-delete", true)}
          {(menuTab.viewType === "markdown" || menuTab.filePath !== null) && <div className="tab-context-sep" />}
          {/* tab / pane ops (always available) */}
          <button role="menuitem" data-testid="viewopt-pin" onClick={() => runMenu(() => app.workspace.toggleTabPin(menu.tabId))}>
            {t(menuTab.pinned ? "app.tabUnpin" : "app.tabPin")}
          </button>
          <button
            role="menuitem"
            data-testid="viewopt-split-right"
            disabled={isFilelessSingletonView(menuTab.viewType)}
            onClick={() => runMenu(() => { app.workspace.setActiveTab(menu.tabId); app.workspace.splitActivePane("row"); })}
          >
            {t("app.tabSplitRight")}
          </button>
          <button
            role="menuitem"
            data-testid="viewopt-split-down"
            disabled={isFilelessSingletonView(menuTab.viewType)}
            onClick={() => runMenu(() => { app.workspace.setActiveTab(menu.tabId); app.workspace.splitActivePane("column"); })}
          >
            {t("app.tabSplitDown")}
          </button>
          <button role="menuitem" data-testid="viewopt-close" onClick={() => runMenu(() => app.workspace.closeTab(menu.tabId))}>
            {t("app.tabClose")}
          </button>
          <button role="menuitem" data-testid="viewopt-close-others" onClick={() => runMenu(() => app.workspace.closeOtherTabs(menu.tabId))}>
            {t("app.tabCloseOthers")}
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  const app = useApp();
  const t = useI18n();
  useStore(app.plugins.revision); // R295/R296: hide graph/switcher buttons when their core plugin is disabled
  const graphEnabled = app.plugins.isEnabled("graph");
  const quickSwitcherEnabled = app.plugins.isEnabled("quick-switcher");
  return (
    <div className="empty-state" data-testid="empty-state">
      <div className="empty-state-card">
        <h2>{t("app.emptyTitle")}</h2>
        <div className="empty-actions">
          <button onClick={() => app.commands.execute("app:new-note")}>{t("app.emptyNewNote")}</button>
          {quickSwitcherEnabled && <button onClick={() => app.workspace.openModal("switcher")}>{t("app.emptySwitcher")}</button>}
          {graphEnabled && <button onClick={() => app.workspace.openGraph()}>{t("app.emptyGraph")}</button>}
        </div>
      </div>
    </div>
  );
}

function VaultPicker() {
  const app = useApp();
  const t = useI18n();
  return (
    <div className="vault-picker" data-testid="vault-picker">
      <div className="vault-picker-card">
        <h1>💎 Geode</h1>
        <p>{t("app.vaultTagline")}</p>
        <button className="btn-accent" onClick={() => void openVaultFlow(app)}>
          {t("app.openVaultButton")}
        </button>
      </div>
    </div>
  );
}

function vaultPathName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

function vaultParentPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return parentPath(normalized) || normalized;
}

type VaultRecordEdit = {
  kind: "rename" | "relocate";
  path: string;
  value: string;
};

/** Obsidian-style full vault manager: recent records on the left, actions on the right. */
function VaultManagerModal() {
  const app = useApp();
  const t = useI18n();
  const activeLocale = useStore(locale);
  const currentPath = app.vault.getVaultPath();
  const [vaults, setVaults] = useState<RecentVaultRecord[]>(() => {
    // Opening the manager counts as a management touch for the active desktop vault.
    if (currentPath) pushRecentVault(currentPath);
    return loadRecentVaultRecords();
  });
  const [selectedPath, setSelectedPath] = useState<string | null>(
    currentPath ?? vaults[0]?.path ?? null,
  );
  const [recordMenu, setRecordMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [edit, setEdit] = useState<VaultRecordEdit | null>(null);
  const recordMenuRef = useRef<HTMLDivElement | null>(null);
  const close = () => app.workspace.closeModal();
  const onOverlayMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) close();
  };
  const refresh = () => setVaults(loadRecentVaultRecords());
  const open = (path: string) => {
    close();
    void switchToVault(app, path).catch((err) => {
      console.error("[vault] switch failed; forgetting", path, err);
      removeRecentVault(path);
    });
  };
  const forget = (path: string) => {
    removeRecentVault(path);
    refresh();
    setRecordMenu(null);
    setSelectedPath((selected) => selected === path ? null : selected);
  };
  const isDesktop = app.vault.adapter.kind !== "memory";

  useEffect(() => {
    if (!recordMenu) return;
    const dismiss = (event: MouseEvent) => {
      if (!recordMenuRef.current?.contains(event.target as Node)) setRecordMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRecordMenu(null);
    };
    window.addEventListener("mousedown", dismiss, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", dismiss, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [recordMenu]);

  const menuRecord = recordMenu
    ? vaults.find((record) => record.path === recordMenu.path) ?? null
    : null;
  const runRecordMenu = (callback: () => void) => {
    setRecordMenu(null);
    callback();
  };
  const beginEdit = (kind: VaultRecordEdit["kind"], record: RecentVaultRecord) => {
    setRecordMenu(null);
    setEdit({
      kind,
      path: record.path,
      value: kind === "rename" ? (record.name ?? vaultPathName(record.path)) : record.path,
    });
  };
  const saveEdit = () => {
    if (!edit?.value.trim()) return;
    if (edit.kind === "rename") {
      renameRecentVaultRecord(edit.path, edit.value);
    } else {
      relocateRecentVaultRecord(edit.path, edit.value);
      setSelectedPath(edit.value.trim());
    }
    setEdit(null);
    refresh();
  };

  return (
    <div className="modal-overlay vaultmanager-overlay" onMouseDown={onOverlayMouseDown} data-testid="vaultmanager-modal-overlay">
      <div className="modal-panel vaultmanager-shell" role="dialog" aria-label={t("vaultManager.title")} data-testid="vaultmanager-modal">
        <aside className="vaultmanager-sidebar">
          <div className="vaultmanager-window-dots" aria-hidden="true"><span /><span /><span /></div>
          <div className="vaultswitcher-header" data-testid="vaultmanager-title">{t("vaultManager.title")}</div>
          {vaults.length === 0 ? (
            <p className="vaultswitcher-empty" data-testid="vaultmanager-empty">{t("vaultManager.empty")}</p>
          ) : (
            <ul className="vaultswitcher-list">
              {vaults.map((record) => (
                <li
                  key={record.id}
                  className={`vaultswitcher-item${selectedPath === record.path ? " is-selected" : ""}`}
                  data-testid="vaultmanager-item"
                  data-vault-id={record.id}
                >
                  <button className="vaultswitcher-open" onClick={() => open(record.path)} title={record.path}>
                    <span className="vaultswitcher-name">{record.name ?? vaultPathName(record.path)}</span>
                    <span className="vaultswitcher-path">{vaultParentPath(record.path)}</span>
                  </button>
                  <button
                    className="vaultmanager-record-more"
                    data-testid="vaultmanager-record-more"
                    aria-label={t("app.moreOptions")}
                    aria-expanded={recordMenu?.path === record.path}
                    onClick={(event) => {
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setSelectedPath(record.path);
                      setRecordMenu({ path: record.path, x: rect.right, y: rect.bottom });
                    }}
                  >
                    <Icon name="more-horizontal" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="vaultmanager-main">
          <button className="vaultmanager-close" aria-label={t("app.close")} onClick={close}>
            <Icon name="x" size={20} />
          </button>
          <div className="vaultmanager-brand">
            <img src={GEODE_LOGO_URL} alt="" />
            <h1>Geode</h1>
            <p>{t("vaultManager.version", { version: APP_VERSION })}</p>
          </div>
          <div className="vaultmanager-actions-card">
            {isDesktop && (
              <div className="vaultmanager-action-row">
                <div><strong>{t("vaultManager.createTitle")}</strong><span>{t("vaultManager.createDescription")}</span></div>
                <button className="btn-accent vaultmanager-create-new" data-testid="vaultmanager-create-new" onClick={() => { close(); void app.commands.execute("app:create-new-vault"); }}>
                  {t("vaultManager.create")}
                </button>
              </div>
            )}
            <div className="vaultmanager-action-row">
              <div><strong>{t("vaultManager.openTitle")}</strong><span>{t("vaultManager.openDescription")}</span></div>
              <button className="vaultmanager-open-other" data-testid="vaultmanager-open-other" onClick={() => { close(); void openVaultFlow(app); }}>
                {t("vaultManager.open")}
              </button>
            </div>
            <div className="vaultmanager-action-row vaultmanager-language-row">
              <div><strong>{t("vaultManager.language")}</strong><span>{t("vaultManager.languageDescription")}</span></div>
              <select value={activeLocale} onChange={(event) => setLocale(event.target.value === "zh" ? "zh" : "en")}>
                <option value="zh">简体中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </section>
      </div>

      {menuRecord && recordMenu && (
        <div
          ref={recordMenuRef}
          className="vault-record-menu"
          role="menu"
          data-testid="vaultmanager-record-menu"
          style={{ left: Math.min(recordMenu.x - 16, window.innerWidth - 290), top: Math.min(recordMenu.y - 4, window.innerHeight - 290) }}
        >
          <button role="menuitem" data-testid="vaultmanager-copy-id" onClick={() => runRecordMenu(() => {
            void navigator.clipboard.writeText(menuRecord.id).catch(() => {});
            showCommandNotice(t("vaultManager.idCopied"));
          })}><Icon name="copy" size={18} />{t("vaultManager.copyId")}</button>
          <div className="vault-record-menu-separator" />
          <button role="menuitem" data-testid="vaultmanager-rename" onClick={() => beginEdit("rename", menuRecord)}><Icon name="pencil" size={18} />{t("vaultManager.rename")}</button>
          <button role="menuitem" data-testid="vaultmanager-relocate" onClick={() => beginEdit("relocate", menuRecord)}><Icon name="arrow-right" size={18} />{t("vaultManager.relocate")}</button>
          <div className="vault-record-menu-separator" />
          <button role="menuitem" data-testid="vaultmanager-reveal" onClick={() => runRecordMenu(() => {
            if (isDesktop) void revealInSystem(menuRecord.path, "").catch((error) => console.error("[vault] reveal failed", error));
          })}><Icon name="folder" size={18} />{t("vaultManager.reveal")}</button>
          <div className="vault-record-menu-separator" />
          <button role="menuitem" className="is-danger" data-testid="vaultmanager-remove" onClick={() => forget(menuRecord.path)}><Icon name="x" size={18} />{t("vaultManager.remove")}</button>
        </div>
      )}

      {edit && (
        <div className="vault-record-dialog-backdrop" data-testid="vaultmanager-record-dialog">
          <form className="vault-record-dialog" onSubmit={(event) => { event.preventDefault(); saveEdit(); }}>
            <h2>{t(edit.kind === "rename" ? "vaultManager.rename" : "vaultManager.relocate")}</h2>
            <p>{t(edit.kind === "rename" ? "vaultManager.renameHint" : "vaultManager.relocateHint")}</p>
            <input autoFocus value={edit.value} onChange={(event) => setEdit({ ...edit, value: event.target.value })} />
            <div className="vault-record-dialog-actions">
              <button type="button" onClick={() => setEdit(null)}>{t("app.cancel")}</button>
              <button type="submit" className="btn-accent">{t("app.save")}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

async function openVaultFlow(app: ReturnType<typeof useApp>) {
  const picked = await app.vault.adapter.pickVaultFolder();
  if (!picked) return;
  await switchToVault(app, picked);
}

/**
 * R203: switch the active vault to an already-known absolute path (no folder dialog) — the body of
 * openVaultFlow, reused by the vault switcher to reopen a recent vault. The exact sequence is
 * load-bearing for data safety; do NOT reorder or drop a step.
 */
async function switchToVault(app: ReturnType<typeof useApp>, picked: string) {
  // Flush pending edits into the OLD vault BEFORE re-pointing the adapter:
  // afterwards relative paths resolve into the new root, and a late save
  // would silently overwrite the new vault's file with old-vault content.
  // (DocumentManager additionally invalidates all handles on vault:changed
  // reason "load" — see DocumentHandle.handleVaultLoad.)
  await app.workspace.flushAll();
  // relative paths from the OLD vault must never anchor the local graph in the
  // new one (same-named files would silently collide)
  app.workspace.lastActiveFile.set(null);
  app.vault.adapter.setVaultPath(picked);
  try {
    localStorage.setItem(LAST_VAULT_KEY, picked);
  } catch {
    /* ignore */
  }
  await app.vault.load();
  pushRecentVault(picked); // only after a successful load (a bad path throws above)
  // tabs persisted from the previous vault point at files the new vault does
  // not have — close them before plugins reload against the new vault
  app.workspace.closeMissingFileTabs((p) => app.vault.fileExists(p));
  try {
    await app.plugins.loadExternal(app.vault);
  } catch (err) {
    console.error("[vault] external plugin load failed", err);
  }
  try {
    await loadObsidianPlugins(app, app.vault);
  } catch (err) {
    console.error("[vault] obsidian plugin load failed", err);
  }
}

export { LAST_VAULT_KEY };
