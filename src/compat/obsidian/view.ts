/**
 * View / ItemView / FileView (API-REFERENCE area 4). Views registered via
 * Plugin.registerView mount for real (R5): SidebarViewLeaf.setViewState runs
 * the creator, load(), hosts containerEl in a sidebar panel and awaits
 * onOpen(); detach runs onClose()/unload().
 */
import { Component } from "./component";
import type { TFile } from "./files";
import { setIcon, type IconName } from "./icons";
import type { App } from "./plugin";
import type { Scope } from "./ui";
import type { WorkspaceLeaf } from "./workspace";

export interface ViewStateResult {
  /** Set true to record a navigation-history entry. */
  history: boolean;
}

export abstract class View extends Component {
  app!: App;
  icon: IconName = "";
  navigation = false;
  leaf: WorkspaceLeaf;
  containerEl: HTMLElement;
  scope: Scope | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
    // calendar's ItemView subclass touches this.app inside its own
    // constructor — app must be set from the leaf before subclass code runs
    if (leaf._app) this.app = leaf._app;
    this.containerEl = document.createElement("div");
    this.containerEl.className = "view-container geode-compat-view";
  }

  protected async onOpen(): Promise<void> {}
  protected async onClose(): Promise<void> {}

  /** Default "" — subclasses override (abstract in the official d.ts). */
  getViewType(): string {
    return "";
  }

  /** Default "" — subclasses override (abstract in the official d.ts). */
  getDisplayText(): string {
    return "";
  }

  getState(): Record<string, unknown> {
    return {};
  }

  async setState(_state: unknown, _result: ViewStateResult): Promise<void> {}

  getEphemeralState(): Record<string, unknown> {
    return {};
  }

  setEphemeralState(_state: unknown): void {}

  getIcon(): IconName {
    return this.icon;
  }

  onResize(): void {}

  onPaneMenu(_menu: unknown, _source: string): void {}
}

export abstract class ItemView extends View {
  contentEl: HTMLElement;
  /** @internal header area — containerEl.children[0] per the calibrated DOM shape */
  private headerEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    // calibrated DOM shape: children[0] = header, children[1] = contentEl
    // (plugins index containerEl.children[1] directly)
    this.headerEl = document.createElement("div");
    this.headerEl.className = "view-header";
    this.contentEl = document.createElement("div");
    this.contentEl.className = "view-content";
    this.containerEl.append(this.headerEl, this.contentEl);
  }

  /** Adds a clickable icon button to the view header; returns the element. */
  addAction(icon: IconName, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement {
    const el = document.createElement("div");
    el.className = "clickable-icon view-action";
    el.setAttribute("aria-label", title);
    setIcon(el, icon);
    el.addEventListener("click", (evt) => void callback(evt));
    this.headerEl.appendChild(el);
    return el;
  }
}

export abstract class FileView extends ItemView {
  allowNoFile = false;
  file: TFile | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    // 'File views can be navigated by default.'
    this.navigation = true;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "";
  }

  async onLoadFile(_file: TFile): Promise<void> {}
  async onUnloadFile(_file: TFile): Promise<void> {}
  async onRename(_file: TFile): Promise<void> {}

  canAcceptExtension(_extension: string): boolean {
    return true;
  }
}
