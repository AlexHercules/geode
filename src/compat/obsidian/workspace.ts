/**
 * Obsidian Workspace shim (API-REFERENCE area 4) over the Geode pane tree.
 * Minimal leaf surface: enough for T1 plugins (file-centric, command-driven).
 */
import type { AppHandle } from "@core/plugins";
import { findActiveTab } from "@core/workspace";
import { Editor } from "./editor";
import { Events, type EventRef } from "./events";
import type { FileRegistry, TFile } from "./files";
import { reportGap } from "./gaps";

type Handle = Omit<AppHandle, "ui">;
export type PaneType = "tab" | "split" | "window";
export type SplitDirection = "vertical" | "horizontal";

/** Minimal facade for editorCallback ctx / getActiveViewOfType(MarkdownView). */
export class MarkdownView {
  file: TFile | null;
  editor: Editor;

  constructor(editor: Editor, file: TFile | null) {
    this.editor = editor;
    this.file = file;
  }

  getViewType(): string {
    return "markdown";
  }

  getDisplayText(): string {
    return this.file?.basename ?? "";
  }
}

/** Build a MarkdownView over the focused editor view, or null. */
export function makeActiveMarkdownView(handle: Handle, registry: FileRegistry): MarkdownView | null {
  const active = handle.documents.getActiveView();
  if (!active) return null;
  return new MarkdownView(new Editor(active.view), registry.getFile(active.path));
}

function wantsNewTab(newLeaf?: PaneType | boolean): boolean {
  return newLeaf === true || newLeaf === "tab" || newLeaf === "split" || newLeaf === "window";
}

/** Minimal WorkspaceLeaf facade over the ACTIVE Geode pane. */
export class WorkspaceLeaf {
  constructor(
    private handle: Handle,
    private registry: FileRegistry,
    private newTab: boolean,
  ) {}

  get view(): MarkdownView | null {
    return makeActiveMarkdownView(this.handle, this.registry);
  }

  async openFile(file: TFile, _openState?: unknown): Promise<void> {
    this.handle.workspace.openFile(file.path, { newTab: this.newTab });
  }

  getViewState(): { type: string } {
    const tab = findActiveTab(this.handle.workspace.state.get());
    return { type: tab ? tab.viewType : "empty" };
  }

  getDisplayText(): string {
    return findActiveTab(this.handle.workspace.state.get())?.title ?? "";
  }

  detach(): void {
    const tab = findActiveTab(this.handle.workspace.state.get());
    if (tab) this.handle.workspace.closeTab(tab.id);
  }
}

export class Workspace extends Events {
  /** loader runs post-load, so the layout is always ready already */
  layoutReady = true;
  activeLeaf: WorkspaceLeaf | null;
  /** @internal MRU fallback for getActiveFile (graph tab focused etc.) */
  _lastFilePath: string | null = null;

  constructor(
    private handle: Handle,
    private registry: FileRegistry,
  ) {
    super();
    this.activeLeaf = new WorkspaceLeaf(handle, registry, false);
  }

  /** Active file, falling back to the most recently active file. */
  getActiveFile(): TFile | null {
    const path = this.handle.workspace.getActiveFile() ?? this._lastFilePath;
    return path ? this.registry.getFile(path) : null;
  }

  /** 'Runs the callback right away if layout is already ready' — always is. */
  onLayoutReady(callback: () => unknown): void {
    try {
      callback();
    } catch (err) {
      console.error("[obsidian-compat] onLayoutReady callback threw", err);
    }
  }

  getLeaf(newLeaf?: "split", direction?: SplitDirection): WorkspaceLeaf;
  getLeaf(newLeaf?: PaneType | boolean): WorkspaceLeaf;
  getLeaf(newLeaf?: PaneType | boolean, _direction?: SplitDirection): WorkspaceLeaf {
    return new WorkspaceLeaf(this.handle, this.registry, wantsNewTab(newLeaf));
  }

  /** Custom view types are T2 (registerView is a warn-stub) — always empty. */
  getLeavesOfType(_viewType: string): WorkspaceLeaf[] {
    return [];
  }

  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => unknown): void {
    if (this.activeLeaf) callback(this.activeLeaf);
  }

  getActiveViewOfType<T>(type: new (...args: never[]) => T): T | null {
    const view = makeActiveMarkdownView(this.handle, this.registry);
    if (view && view instanceof (type as unknown as new (...args: never[]) => object)) {
      return view as unknown as T;
    }
    return null;
  }

  /**
   * Resolve + open a wikilink linktext. Unresolved links create the note
   * (vault root) like real Obsidian, then open it.
   */
  async openLinkText(
    linktext: string,
    sourcePath: string,
    newLeaf?: PaneType | boolean,
    _openViewState?: unknown,
  ): Promise<void> {
    const linkpath = linktext.split("|")[0].split("#")[0].trim();
    if (!linkpath) return;
    let path = this.handle.metadata.resolveLink(linkpath, sourcePath);
    if (!path) {
      const candidates = [`${linkpath}.md`];
      if (linkpath.includes("/")) candidates.push(`${linkpath.split("/").pop()}.md`);
      for (const candidate of candidates) {
        try {
          await this.handle.vault.create(candidate, "");
          path = candidate;
          break;
        } catch {
          /* folder missing / already exists — try the next candidate */
        }
      }
      if (!path) {
        console.error(`[obsidian-compat] openLinkText could not create "${linkpath}.md"`);
        return;
      }
    }
    this.handle.workspace.openFile(path, { newTab: wantsNewTab(newLeaf) });
  }

  detachLeavesOfType(_viewType: string): void {
    reportGap("Workspace", "detachLeavesOfType");
  }

  /* ----- typed event overloads ----- */

  on(name: "file-open", callback: (file: TFile | null) => unknown, ctx?: unknown): EventRef;
  on(
    name: "active-leaf-change",
    callback: (leaf: WorkspaceLeaf | null) => unknown,
    ctx?: unknown,
  ): EventRef;
  on(name: "layout-change", callback: () => unknown, ctx?: unknown): EventRef;
  on(
    name: "editor-change",
    callback: (editor: Editor, info: MarkdownView) => unknown,
    ctx?: unknown,
  ): EventRef;
  on(name: string, callback: (...data: never[]) => unknown, ctx?: unknown): EventRef;
  on(name: string, callback: (...data: never[]) => unknown, ctx?: unknown): EventRef {
    if (name === "editor-change") {
      reportGap(
        "Workspace",
        "on('editor-change')",
        "DEVIATION: fires on saved modification (file:modified), not per editor transaction",
      );
    }
    return super.on(name, callback, ctx);
  }
}
