import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./AppContext";
import { useStore } from "@core/store";
import {
  showRibbon, showStatusBar, showTabTitleBar, setShowRibbon,
  showLineNumbers, setShowLineNumbers,
  readableLineLength, setReadableLineLength,
  spellcheckEnabled, setSpellcheckEnabled,
} from "@core/appearance";
import { MIN_PANE_FRACTION, findTabLeaf } from "@core/workspace";
import type { PaneLeaf, PaneNode, PaneSplit } from "@core/types";
import type { SidebarPanelContribution } from "@core/plugins";
import { Icon } from "./icons";
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
import { SettingsModal, requestUpdateAutoCheck } from "@features/settings/SettingsModal";
import { WorkspacesModal } from "@features/workspaces";
import { RecoveryModal } from "@features/recovery";
import { SlidesOverlay } from "@features/slides";
import { HoverPreview } from "@features/hover/HoverPreview";
import { exportActiveNoteHtml, printActiveNote } from "@features/export/export";
import { foldAllInView, toggleFoldAtCursor, unfoldAllInView } from "@features/editor/folding";
import { registerFormatCommands } from "@features/editor/formatCommands";
import { registerBlockRefCommands } from "@features/editor/blockRefCommands";
import { registerComposerCommands } from "@features/editor/noteComposerCommands";
import { registerEditorMotionCommands } from "@features/editor/editorMotionCommands";
import { registerEditorEditCommands } from "@features/editor/editorEditCommands";
import { registerSearchCommands } from "@features/editor/searchCommands";
import { isTauri, basename } from "@core/vault";
import { buildOpenUri } from "@core/obsidianUri";
import { confirmDelete } from "@core/confirm";
import { expandTemplate, templatePickerMode } from "@core/templates";
import { updateSupported } from "@core/update";
import { mergeTargetMode } from "@core/noteMerge";
import { bookmarks } from "@core/bookmarks";
import { t, useI18n } from "@core/i18n";
import { loadObsidianPlugins } from "@compat/obsidian/loader";

const LAST_VAULT_KEY = "geode.lastVaultPath";

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
    : ws.leftPanel === "search"
      ? "search"
      : ws.leftPanel === "bookmarks"
        ? "bookmarks"
        : "explorer";
  const effectiveRight = activeRightPanel
    ? activeRightPanel.id
    : ws.rightPanel === "outline"
      ? "outline"
      : ws.rightPanel === "outgoinglinks"
        ? "outgoinglinks"
        : ws.rightPanel === "footnotes"
          ? "footnotes"
        : ws.rightPanel === "allproperties"
          ? "allproperties"
          : ws.rightPanel === "fileproperties"
            ? "fileproperties"
          : ws.rightPanel === "tags"
            ? "tags"
            : ws.rightPanel === "calendar"
              ? "calendar"
              : "backlinks";

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
        id: "app:command-palette",
        name: () => t("cmd.commandPalette"),
        hotkey: "Mod+P",
        callback: () => workspace.openModal("palette"),
      }),
      commands.register({
        id: "app:quick-switcher",
        name: () => t("cmd.quickSwitcher"),
        hotkey: "Mod+O",
        callback: () => workspace.openModal("switcher"),
      }),
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
      commands.register({
        id: "app:open-graph",
        name: () => t("cmd.openGraph"),
        hotkey: "Mod+G",
        callback: () => workspace.openGraph(),
      }),
      commands.register({
        id: "app:toggle-theme",
        name: () => t("cmd.toggleTheme"),
        callback: () => workspace.toggleTheme(),
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
      commands.register({
        id: "app:show-outgoing-links",
        name: () => t("cmd.showOutgoingLinks"),
        callback: () => workspace.setRightPanel("outgoinglinks"),
      }),
      commands.register({
        id: "app:show-footnotes",
        name: () => t("cmd.showFootnotes"),
        callback: () => workspace.setRightPanel("footnotes"),
      }),
      // R181 (G3): per-view "Show X" commands — open/focus an existing sidebar
      // panel (setLeft/RightPanel also opens the sidebar). Real handlers, no empty
      // rows; mirrors Obsidian's "Backlinks: Show backlinks" / "Outline: Show outline" etc.
      commands.register({
        id: "app:show-file-explorer",
        name: () => t("cmd.showFileExplorer"),
        callback: () => workspace.setLeftPanel("explorer"),
      }),
      commands.register({
        id: "app:show-search",
        name: () => t("cmd.showSearch"),
        hotkey: "Mod+Shift+F", // R185: Obsidian global-search default key (calibration)
        callback: () => workspace.setLeftPanel("search"),
      }),
      commands.register({
        id: "app:show-backlinks",
        name: () => t("cmd.showBacklinks"),
        callback: () => workspace.setRightPanel("backlinks"),
      }),
      commands.register({
        id: "app:show-outline",
        name: () => t("cmd.showOutline"),
        callback: () => workspace.setRightPanel("outline"),
      }),
      commands.register({
        id: "app:show-tags",
        name: () => t("cmd.showTags"),
        callback: () => workspace.setRightPanel("tags"),
      }),
      commands.register({
        id: "app:show-all-properties",
        name: () => t("cmd.showAllProperties"),
        callback: () => workspace.setRightPanel("allproperties"),
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
            if (!(await confirmDelete(t("explorer.deleteConfirmFile", { name: basename(path) }), t("explorer.delete"))))
              return;
            try {
              await workspace.flushAll();
              await vault.trash(path);
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
        id: "editor:add-property",
        name: () => t("cmd.addProperty"),
        hotkey: "Mod+;",
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
        id: "editor:insert-template",
        name: () => t("cmd.insertTemplate"),
        available: () => workspace.getActiveTab()?.filePath != null,
        callback: () => {
          const tab = workspace.getActiveTab();
          if (!tab || !tab.filePath) return;
          // reading view has no cursor — flip to an editable mode first
          // (add-property precedent, contract)
          if (tab.mode === "preview") workspace.setTabMode(tab.id, "live");
          // one-shot mode handoff: set BEFORE opening, the modal reads on mount
          templatePickerMode.set("insert");
          workspace.openModal("templates");
        },
      }),
      commands.register({
        id: "app:new-note-from-template",
        name: () => t("cmd.newNoteFromTemplate"),
        callback: () => {
          templatePickerMode.set("create");
          workspace.openModal("templates");
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
        available: () => workspace.getActiveFile() !== null,
        callback: () => {
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
        id: "bookmarks:show",
        name: () => t("cmd.showBookmarks"),
        callback: () => workspace.setLeftPanel("bookmarks"),
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
            workspace.openFile(path, { newTab: true });
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
    // R45 workspaces manager (save / load / delete named layout snapshots).
    // No default key — Obsidian's core "Workspaces" plugin assigns none.
    disposers.push(
      commands.register({
        id: "workspace:manage",
        name: () => t("cmd.manageWorkspaces"),
        callback: () => workspace.openModal("workspaces"),
      }),
    );
    // R49 file recovery — browse / restore version snapshots of the active note.
    // No default key (Obsidian's core "File recovery" plugin assigns none);
    // unavailable when there is no active file (no snapshots to browse).
    disposers.push(
      commands.register({
        id: "editor:file-recovery",
        name: () => t("cmd.fileRecovery"),
        available: () => workspace.getActiveFile() !== null,
        callback: () => workspace.openModal("recovery"),
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

  /* ---- no vault yet (desktop only) ---- */
  if (!tree) {
    return (
      <div className="app" data-testid="app-root">
        <VaultPicker />
      </div>
    );
  }

  return (
    <div className="app" data-testid="app-root">
      {/* R20: appended "workspace*" classes mirror Obsidian's DOM so community
          theme CSS can target them — resident, additive only (contract) */}
      <div className="app-body workspace">
        {/* ribbon (R94: hidden when showRibbon is off) */}
        {ribbonVisible && (
        <nav className="ribbon workspace-ribbon side-dock-ribbon mod-left" aria-label={t("app.ribbonAria")}>
          <RibbonButton
            icon="files"
            title={t("app.ribbonExplorer")}
            active={ws.leftSidebarOpen && effectiveLeft === "explorer"}
            onClick={() =>
              effectiveLeft === "explorer" && ws.leftSidebarOpen
                ? app.workspace.toggleLeftSidebar()
                : app.workspace.setLeftPanel("explorer")
            }
          />
          <RibbonButton
            icon="search"
            title={t("app.ribbonSearch")}
            active={ws.leftSidebarOpen && effectiveLeft === "search"}
            onClick={() =>
              effectiveLeft === "search" && ws.leftSidebarOpen
                ? app.workspace.toggleLeftSidebar()
                : app.workspace.setLeftPanel("search")
            }
          />
          <RibbonButton
            icon="bookmark"
            title={t("app.ribbonBookmarks")}
            active={ws.leftSidebarOpen && effectiveLeft === "bookmarks"}
            onClick={() =>
              effectiveLeft === "bookmarks" && ws.leftSidebarOpen
                ? app.workspace.toggleLeftSidebar()
                : app.workspace.setLeftPanel("bookmarks")
            }
          />
          <RibbonButton icon="graph" title={t("app.ribbonGraph")} onClick={() => app.workspace.openGraph()} />
          <RibbonButton
            icon="command"
            title={t("app.ribbonPalette")}
            onClick={() => app.workspace.openModal("palette")}
          />
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
          <RibbonButton
            icon={ws.theme === "dark" ? "sun" : "moon"}
            title={t("app.ribbonTheme")}
            onClick={() => app.workspace.toggleTheme()}
          />
          <RibbonButton icon="settings" title={t("app.ribbonSettings")} onClick={() => app.workspace.openModal("settings")} />
        </nav>
        )}

        {/* left sidebar */}
        {ws.leftSidebarOpen && (
          <aside
            className="sidebar sidebar-left workspace-split mod-horizontal mod-left-split"
            style={{ width: ws.leftWidth }}
            data-testid="left-sidebar"
          >
            {activeLeftPanel ? (
              <SidebarPanelHost key={activeLeftPanel.id} panel={activeLeftPanel} />
            ) : ws.leftPanel === "search" ? (
              <SearchPanel />
            ) : ws.leftPanel === "bookmarks" ? (
              <BookmarksPanel />
            ) : (
              <Explorer />
            )}
            <SidebarResizer side="left" />
          </aside>
        )}

        {/* main area: recursive pane tree */}
        <main className="main workspace-split mod-vertical mod-root">
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
            <div className="right-tabs" role="tablist" aria-label={t("app.rightPanelAria")}>
              <button
                role="tab"
                aria-selected={effectiveRight === "backlinks"}
                className={`right-tab${effectiveRight === "backlinks" ? " is-active" : ""}`}
                title={t("app.tabBacklinks")}
                data-testid="right-tab-backlinks"
                onClick={() => app.workspace.setRightPanel("backlinks")}
              >
                <Icon name="link" size={15} />
              </button>
              <button
                role="tab"
                aria-selected={effectiveRight === "outgoinglinks"}
                className={`right-tab${effectiveRight === "outgoinglinks" ? " is-active" : ""}`}
                title={t("app.tabOutgoingLinks")}
                data-testid="right-tab-outgoinglinks"
                onClick={() => app.workspace.setRightPanel("outgoinglinks")}
              >
                <Icon name="external-link" size={15} />
              </button>
              <button
                role="tab"
                aria-selected={effectiveRight === "footnotes"}
                className={`right-tab${effectiveRight === "footnotes" ? " is-active" : ""}`}
                title={t("app.tabFootnotes")}
                data-testid="right-tab-footnotes"
                onClick={() => app.workspace.setRightPanel("footnotes")}
              >
                <Icon name="footnote" size={15} />
              </button>
              <button
                role="tab"
                aria-selected={effectiveRight === "outline"}
                className={`right-tab${effectiveRight === "outline" ? " is-active" : ""}`}
                title={t("app.tabOutline")}
                data-testid="right-tab-outline"
                onClick={() => app.workspace.setRightPanel("outline")}
              >
                <Icon name="list" size={15} />
              </button>
              <button
                role="tab"
                aria-selected={effectiveRight === "allproperties"}
                className={`right-tab${effectiveRight === "allproperties" ? " is-active" : ""}`}
                title={t("app.tabAllProperties")}
                data-testid="right-tab-allproperties"
                onClick={() => app.workspace.setRightPanel("allproperties")}
              >
                <Icon name="book-open" size={15} />
              </button>
              <button
                role="tab"
                aria-selected={effectiveRight === "fileproperties"}
                className={`right-tab${effectiveRight === "fileproperties" ? " is-active" : ""}`}
                title={t("app.tabFileProperties")}
                data-testid="right-tab-fileproperties"
                onClick={() => app.workspace.setRightPanel("fileproperties")}
              >
                <Icon name="file-text" size={15} />
              </button>
              <button
                role="tab"
                aria-selected={effectiveRight === "tags"}
                className={`right-tab${effectiveRight === "tags" ? " is-active" : ""}`}
                title={t("app.tabTags")}
                data-testid="right-tab-tags"
                onClick={() => app.workspace.setRightPanel("tags")}
              >
                <Icon name="hash" size={15} />
              </button>
              <button
                role="tab"
                aria-selected={effectiveRight === "calendar"}
                className={`right-tab${effectiveRight === "calendar" ? " is-active" : ""}`}
                title={t("app.tabCalendar")}
                data-testid="right-tab-calendar"
                onClick={() => app.workspace.setRightPanel("calendar")}
              >
                <Icon name="calendar" size={15} />
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
            </div>
            <div className="right-panel-body">
              {activeRightPanel ? (
                <SidebarPanelHost key={activeRightPanel.id} panel={activeRightPanel} />
              ) : ws.rightPanel === "outline" ? (
                <OutlinePanel />
              ) : ws.rightPanel === "outgoinglinks" ? (
                <OutgoingLinksPanel />
              ) : ws.rightPanel === "footnotes" ? (
                <FootnotesPanel />
              ) : ws.rightPanel === "allproperties" ? (
                <AllPropertiesPanel />
              ) : ws.rightPanel === "fileproperties" ? (
                <FilePropertiesPanel />
              ) : ws.rightPanel === "tags" ? (
                <TagsPanel />
              ) : ws.rightPanel === "calendar" ? (
                <CalendarPanel />
              ) : (
                <BacklinksPanel />
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
        <span className="status-item status-vault">{app.vault.vaultName}</span>
        <span className="status-spacer" />
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

      {/* hover preview card (R25) — mounts the document-level hover controller */}
      <HoverPreview />
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

/**
 * True when the markup parses to exactly one root element and that element is
 * an <svg> (no siblings). Anything else falls back to the letter icon instead
 * of being injected via dangerouslySetInnerHTML.
 */
function isSingleSvgMarkup(markup: string): boolean {
  try {
    const body = new DOMParser().parseFromString(markup, "text/html").body;
    const nodes = Array.from(body.childNodes).filter(
      (n) => !(n.nodeType === Node.TEXT_NODE && !(n.textContent ?? "").trim()),
    );
    const root = nodes[0];
    return nodes.length === 1 && root instanceof Element && root.tagName.toLowerCase() === "svg";
  } catch {
    return false;
  }
}

/** Selector icon for a plugin sidebar panel: raw svg markup, or the title's first letter. */
function SidebarPanelIcon({ panel }: { panel: SidebarPanelContribution }) {
  if (panel.iconSvg && isSingleSvgMarkup(panel.iconSvg)) {
    return (
      <span
        className="sidebar-panel-icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: panel.iconSvg }}
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
      <Icon name={props.icon} size={20} />
    </button>
  );
}

/**
 * C5: dedicated collapse/expand affordance for a sidebar. Always rendered (an
 * overlay anchored to `.app-body`); `offset` is the live pixel distance of the
 * sidebar↔main border from the matching edge, so it tracks resize + collapse.
 * Chevron points inward to collapse when open, outward to expand when closed.
 */
function SidebarToggle(props: {
  side: "left" | "right";
  open: boolean;
  offset: number;
  label: string;
  onToggle: () => void;
}) {
  const inward = props.side === "left" ? "chevron-left" : "chevron-right";
  const outward = props.side === "left" ? "chevron-right" : "chevron-left";
  return (
    <button
      className={`sidebar-toggle sidebar-toggle-${props.side}`}
      style={props.side === "left" ? { left: props.offset } : { right: props.offset }}
      aria-label={props.label}
      title={props.label}
      data-testid={`sidebar-toggle-${props.side}`}
      onClick={props.onToggle}
    >
      <Icon name={props.open ? inward : outward} size={14} />
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
  const { draggingTabId, setDraggingTabId } = useContext(TabDragContext);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const isActive = ws.activePaneId === leaf.id;
  const activeTab = leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? null;

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
      <div className="main-content">
        {activeTab ? (
          activeTab.viewType === "graph" ? (
            <GraphView />
          ) : activeTab.viewType === "attachment" ? (
            <AttachmentView key={activeTab.id} tab={activeTab} />
          ) : (
            <EditorPane key={activeTab.id} tab={activeTab} />
          )
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
  // R81: tab right-click context menu (TagsPanel inline pattern)
  const [menu, setMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
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
  const menuTab = menu ? leaf.tabs.find((tb) => tb.id === menu.tabId) ?? null : null;
  const runMenu = (fn: () => void) => {
    fn();
    setMenu(null);
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
      <div className="tab-nav">
        <button
          className="tab-nav-btn"
          aria-label={t("app.navigateBack")}
          disabled={!leaf.activeTabId || !app.workspace.canTabNavigateBack(leaf.activeTabId)}
          onClick={() => app.workspace.navigateBack()}
        >
          <Icon name="arrow-left" size={16} />
        </button>
        <button
          className="tab-nav-btn"
          aria-label={t("app.navigateForward")}
          disabled={!leaf.activeTabId || !app.workspace.canTabNavigateForward(leaf.activeTabId)}
          onClick={() => app.workspace.navigateForward()}
        >
          <Icon name="arrow-right" size={16} />
        </button>
      </div>
      {leaf.tabs.map((tab, i) => {
        /* the graph tab's stored title is persisted in workspace state —
           ignore it at render time so the label follows the UI locale;
           file tabs keep the basename verbatim */
        const title = tab.viewType === "graph" ? t("app.graphTab") : tab.title;
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
            setMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
          }}
          title={tab.filePath ?? title}
        >
          {tab.viewType === "graph" && <Icon name="graph" size={14} />}
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
            <Icon name="x" size={13} />
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
        <Icon name="plus" size={16} />
      </button>
      {menu && menuTab && (
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
            disabled={menuTab.viewType === "graph"}
            onClick={() => runMenu(() => { app.workspace.setActiveTab(menu.tabId); app.workspace.splitActivePane("row"); })}
          >
            {t("app.tabSplitRight")}
          </button>
          <button
            role="menuitem"
            data-testid="tabctx-split-down"
            disabled={menuTab.viewType === "graph"}
            onClick={() => runMenu(() => { app.workspace.setActiveTab(menu.tabId); app.workspace.splitActivePane("column"); })}
          >
            {t("app.tabSplitDown")}
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  const app = useApp();
  const t = useI18n();
  return (
    <div className="empty-state" data-testid="empty-state">
      <div className="empty-state-card">
        <h2>{t("app.emptyTitle")}</h2>
        <div className="empty-actions">
          <button onClick={() => app.commands.execute("app:new-note")}>{t("app.emptyNewNote")}</button>
          <button onClick={() => app.workspace.openModal("switcher")}>{t("app.emptySwitcher")}</button>
          <button onClick={() => app.workspace.openGraph()}>{t("app.emptyGraph")}</button>
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

async function openVaultFlow(app: ReturnType<typeof useApp>) {
  const picked = await app.vault.adapter.pickVaultFolder();
  if (!picked) return;
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
