/**
 * Obsidian UI primitives (API-REFERENCE area 5): Notice, Modal (+ Suggest
 * modals), Menu, Setting and its component classes. Chainable per the
 * reference; setValue NEVER fires onChange (only user interaction does).
 * Styling lives in compat.css and reuses the host's
 * .modal-overlay/.modal-panel classes + CSS variables.
 */
import { Component } from "./component";
import { reportGap } from "./gaps";
import { setIcon, type IconName } from "./icons";
import type { App, Modifier } from "./plugin";
import { moment, Platform } from "./util";
import type { PaneType } from "./workspace";

/* ---------------- Scope (real since R6 — EditorSuggest popup dispatch) ---------------- */

export interface KeymapInfo {
  /** canonical comma-joined modifier string, or null = any modifier state */
  modifiers: string | null;
  key: string | null;
}

export interface KeymapContext extends KeymapInfo {
  /** interpreted virtual key */
  vkey: string;
}

/** 'Return false to automatically preventDefault' (official d.ts). */
export type KeymapEventListener = (evt: KeyboardEvent, ctx: KeymapContext) => false | unknown;

export interface KeymapEventHandler extends KeymapInfo {
  scope: Scope;
}

/** @internal stored handler — KeymapEventHandler plus the callback. */
export interface ScopeKeymapHandler extends KeymapEventHandler {
  func: KeymapEventListener;
}

/** Fixed canonical ordering so handler/event strings compare by equality. */
const MODIFIER_ORDER = ["Alt", "Ctrl", "Meta", "Shift"] as const;

/** Canonical modifier string; Mod maps to Ctrl on the host (non-macOS rule). */
function normalizeModifiers(modifiers: Modifier[]): string {
  const set = new Set(modifiers.map((m) => (m === "Mod" ? "Ctrl" : m)));
  return MODIFIER_ORDER.filter((m) => set.has(m)).join(",");
}

/** @internal modifier string of a live KeyboardEvent (same canonical grammar). */
export function _modifiersFromEvent(evt: KeyboardEvent): string {
  const parts: string[] = [];
  if (evt.altKey) parts.push("Alt");
  if (evt.ctrlKey) parts.push("Ctrl");
  if (evt.metaKey) parts.push("Meta");
  if (evt.shiftKey) parts.push("Shift");
  return parts.join(",");
}

/**
 * 'A scope receives keyboard events and binds callbacks to given hotkeys.'
 * The host never routes global keys through scopes — consumers (the
 * EditorSuggest popup) dispatch against `_handlers` themselves.
 */
export class Scope {
  private readonly handlers: ScopeKeymapHandler[] = [];
  private readonly parent: Scope | null;

  constructor(parent?: Scope) {
    this.parent = parent ?? null;
  }

  /** @internal own handlers first, then the inherited parent chain. */
  get _handlers(): readonly ScopeKeymapHandler[] {
    return this.parent ? [...this.handlers, ...this.parent._handlers] : this.handlers;
  }

  /**
   * 'Pass null to capture all events matching the key, regardless of
   * modifiers.' A null key matches any key.
   */
  register(
    modifiers: Modifier[] | null,
    key: string | null,
    func: KeymapEventListener,
  ): KeymapEventHandler {
    const handler: ScopeKeymapHandler = {
      modifiers: modifiers === null ? null : normalizeModifiers(modifiers),
      key,
      func,
      scope: this,
    };
    this.handlers.push(handler);
    return handler;
  }

  /** Remove by identity (the exact object register returned). */
  unregister(handler: KeymapEventHandler): void {
    const idx = this.handlers.indexOf(handler as ScopeKeymapHandler);
    if (idx >= 0) this.handlers.splice(idx, 1);
  }
}

/* ---------------- Keymap ---------------- */

/** Events Keymap can read modifier state from (per the official d.ts). */
export type UserEvent = MouseEvent | KeyboardEvent | TouchEvent | PointerEvent;

export class Keymap {
  /** R149: 'Translates an event into the type of pane that should open'. "tab" if
   *  Cmd/Ctrl held OR middle-click; "split" if Cmd/Ctrl+Alt; "window" if
   *  Cmd/Ctrl+Alt+Shift (most-specific first). @since 0.16.0 */
  static isModEvent(evt?: UserEvent | null): PaneType | boolean {
    if (!evt) return false;
    // the platform mod key (Cmd on macOS, Ctrl elsewhere) — reuse isModifier so the
    // two Keymap helpers stay consistent (R149 review: not the cross-platform either-mod).
    const mod = Keymap.isModifier(evt, "Mod");
    if (mod && evt.altKey && evt.shiftKey) return "window";
    if (mod && evt.altKey) return "split";
    if (mod) return "tab";
    if (evt instanceof MouseEvent && evt.button === 1) return "tab"; // middle-click
    return false;
  }

  /** R148: Obsidian `Keymap.isModifier(evt, modifier)` — whether `modifier` is held
   *  during `evt`. "Mod" = Cmd on macOS, Ctrl elsewhere (platform-aware, unlike the
   *  scope-matching normalizeModifiers which collapses Mod→Ctrl). @since 0.12.17 */
  static isModifier(evt: MouseEvent | TouchEvent | KeyboardEvent, modifier: Modifier): boolean {
    switch (modifier) {
      case "Mod":
        return Platform.isMacOS ? evt.metaKey : evt.ctrlKey;
      case "Ctrl":
        return evt.ctrlKey;
      case "Meta":
        return evt.metaKey;
      case "Shift":
        return evt.shiftKey;
      case "Alt":
        return evt.altKey;
      default:
        return false; // untyped plugins may pass a non-Modifier string — stay boolean
    }
  }
}

/* ---------------- Notice ---------------- */

const NOTICE_DEFAULT_MS = 5000;
let noticeHost: HTMLElement | null = null;

function getNoticeHost(): HTMLElement {
  if (!noticeHost || !noticeHost.isConnected) {
    noticeHost = document.createElement("div");
    noticeHost.className = "geode-notice-container";
    noticeHost.setAttribute("data-testid", "compat-notices");
    document.body.appendChild(noticeHost);
  }
  return noticeHost;
}

export class Notice {
  containerEl: HTMLElement;
  messageEl: HTMLElement;
  /** @deprecated Use `messageEl` instead (kept for old plugins). */
  noticeEl: HTMLElement;
  private timer: number | null = null;

  constructor(message: string | DocumentFragment, duration?: number) {
    this.containerEl = document.createElement("div");
    this.containerEl.className = "notice geode-notice";
    this.containerEl.setAttribute("data-testid", "compat-notice");
    this.messageEl = document.createElement("div");
    this.messageEl.className = "notice-message";
    this.containerEl.appendChild(this.messageEl);
    this.noticeEl = this.containerEl;
    this.setMessage(message);
    this.containerEl.addEventListener("click", () => this.hide());
    getNoticeHost().appendChild(this.containerEl);
    const ms = duration === undefined ? NOTICE_DEFAULT_MS : duration;
    // duration 0 = sticky until manually dismissed
    if (ms > 0) this.timer = window.setTimeout(() => this.hide(), ms);
  }

  setMessage(message: string | DocumentFragment): this {
    if (typeof message === "string") {
      this.messageEl.textContent = message;
    } else {
      this.messageEl.textContent = "";
      this.messageEl.appendChild(message);
    }
    return this;
  }

  hide(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.containerEl.remove();
  }
}

/* ---------------- Modal ---------------- */

/** Stack of currently open modals — Escape closes ONLY the topmost one. */
const modalStack: Modal[] = [];

export class Modal {
  app: App;
  scope: Scope = new Scope();
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  shouldRestoreSelection = false;
  private closeCallback: (() => unknown) | null = null;
  private isOpen = false;
  private keydownHandler = (e: KeyboardEvent): void => {
    // every open modal has a document-level listener; only the stack top acts
    if (e.key === "Escape" && modalStack[modalStack.length - 1] === this) {
      e.stopPropagation();
      this.close();
    }
  };

  constructor(app: App) {
    this.app = app;
    // hierarchy per reference: containerEl (overlay) > modalEl > titleEl + contentEl
    this.containerEl = document.createElement("div");
    this.containerEl.className = "modal-overlay geode-compat-modal-overlay";
    this.modalEl = document.createElement("div");
    this.modalEl.className = "modal-panel modal geode-compat-modal";
    this.modalEl.setAttribute("data-testid", "compat-modal");
    this.titleEl = document.createElement("div");
    this.titleEl.className = "modal-title";
    this.contentEl = document.createElement("div");
    this.contentEl.className = "modal-content";
    this.modalEl.append(this.titleEl, this.contentEl);
    this.containerEl.appendChild(this.modalEl);
    this.containerEl.addEventListener("click", (e) => {
      if (e.target === this.containerEl) this.close();
    });
  }

  /** 'Show the modal on the active window.' */
  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    modalStack.push(this);
    document.body.appendChild(this.containerEl);
    document.addEventListener("keydown", this.keydownHandler, true);
    try {
      const r = this.onOpen();
      if (r instanceof Promise) {
        r.catch((err) => console.error("[obsidian-compat] Modal.onOpen failed", err));
      }
    } catch (err) {
      console.error("[obsidian-compat] Modal.onOpen threw", err);
    }
  }

  /** 'Hide the modal.' */
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    const stackIdx = modalStack.indexOf(this);
    if (stackIdx >= 0) modalStack.splice(stackIdx, 1);
    document.removeEventListener("keydown", this.keydownHandler, true);
    this.containerEl.remove();
    try {
      this.onClose();
    } catch (err) {
      console.error("[obsidian-compat] Modal.onClose threw", err);
    }
    try {
      this.closeCallback?.();
    } catch (err) {
      console.error("[obsidian-compat] Modal close callback threw", err);
    }
  }

  onOpen(): Promise<void> | void {}
  onClose(): void {}

  setTitle(title: string): this {
    this.titleEl.textContent = title;
    return this;
  }

  setContent(content: string | DocumentFragment): this {
    if (typeof content === "string") {
      this.contentEl.textContent = content;
    } else {
      this.contentEl.textContent = "";
      this.contentEl.appendChild(content);
    }
    return this;
  }

  setCloseCallback(callback: () => unknown): this {
    this.closeCallback = callback;
    return this;
  }
}

/* ---------------- instructions bar (setInstructions, real since R9) ---------------- */

/** Official shape (obsidian.d.ts:3556): both fields REQUIRED. Rendering still
 *  tolerates missing values (`?? ""`) — plugins are untyped at runtime. */
export interface Instruction {
  command: string;
  purpose: string;
}

/**
 * @internal Build the official `.prompt-instructions` bar (shared by the
 * EditorSuggest popup and SuggestModal). Returns null for an empty list —
 * callers render nothing in that case.
 */
export function _createInstructionsEl(instructions: Instruction[]): HTMLElement | null {
  if (instructions.length === 0) return null;
  const bar = document.createElement("div");
  bar.className = "prompt-instructions";
  for (const instruction of instructions) {
    const item = document.createElement("div");
    item.className = "prompt-instruction";
    const command = document.createElement("span");
    command.className = "prompt-instruction-command";
    command.textContent = instruction.command ?? "";
    const purpose = document.createElement("span");
    purpose.textContent = instruction.purpose ?? "";
    item.append(command, purpose);
    bar.appendChild(item);
  }
  return bar;
}

/* ---------------- SuggestModal / FuzzySuggestModal (suite-driven R4) ---------------- */

export abstract class SuggestModal<T> extends Modal {
  limit = 100;
  emptyStateText = "No results found.";
  inputEl: HTMLInputElement;
  resultContainerEl: HTMLElement;
  private _items: T[] = [];
  private _selected = 0;
  private _itemEls: HTMLElement[] = [];
  private _queryToken = 0;
  /** @internal stored Instruction[] — replaced wholesale by setInstructions */
  _instructions: Instruction[] = [];
  private _instructionsEl: HTMLElement | null = null;

  constructor(app: App) {
    super(app);
    this.modalEl.classList.add("prompt", "geode-compat-prompt");
    this.inputEl = document.createElement("input");
    this.inputEl.type = "text";
    this.inputEl.className = "prompt-input";
    this.inputEl.setAttribute("data-testid", "compat-suggest-input");
    this.resultContainerEl = document.createElement("div");
    this.resultContainerEl.className = "prompt-results";
    this.contentEl.append(this.inputEl, this.resultContainerEl);
    this.inputEl.addEventListener("input", () => void this._updateSuggestions());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this._moveSelection(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.selectActiveSuggestion(e);
      }
    });
  }

  override open(): void {
    super.open();
    this.inputEl.focus();
    void this._updateSuggestions();
  }

  setPlaceholder(placeholder: string): void {
    this.inputEl.placeholder = placeholder;
  }

  /**
   * Real since R9: stores the list (each call replaces it wholesale) and
   * renders the bar at the bottom of the modal. The bar lives on modalEl, so
   * calling before OR after open() both work — the modal DOM persists across
   * open/close. An empty array removes the bar.
   */
  setInstructions(instructions: Instruction[]): void {
    this._instructions = instructions;
    this._instructionsEl?.remove();
    this._instructionsEl = _createInstructionsEl(instructions);
    if (this._instructionsEl) this.modalEl.appendChild(this._instructionsEl);
  }

  onNoSuggestion(): void {}

  /** Default behavior: close the modal, then hand the value to the subclass. */
  selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
    this.close();
    this.onChooseSuggestion(value, evt);
  }

  selectActiveSuggestion(evt: MouseEvent | KeyboardEvent): void {
    const item = this._items[this._selected];
    if (item !== undefined) this.selectSuggestion(item, evt);
  }

  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;

  private async _updateSuggestions(): Promise<void> {
    const token = ++this._queryToken;
    let items: T[];
    try {
      items = await this.getSuggestions(this.inputEl.value);
    } catch (err) {
      console.error("[obsidian-compat] SuggestModal.getSuggestions threw", err);
      items = [];
    }
    if (token !== this._queryToken) return; // stale async result
    this._items = items.slice(0, this.limit);
    this._selected = 0;
    this._render();
  }

  private _render(): void {
    this.resultContainerEl.textContent = "";
    this._itemEls = [];
    if (this._items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "suggestion-empty";
      empty.textContent = this.emptyStateText;
      this.resultContainerEl.appendChild(empty);
      this.onNoSuggestion();
      return;
    }
    this._items.forEach((item, i) => {
      const el = document.createElement("div");
      el.className = "suggestion-item";
      el.setAttribute("data-testid", "compat-suggestion-item");
      if (i === this._selected) el.classList.add("is-selected");
      try {
        this.renderSuggestion(item, el);
      } catch (err) {
        console.error("[obsidian-compat] renderSuggestion threw", err);
      }
      el.addEventListener("click", (evt) => this.selectSuggestion(item, evt));
      el.addEventListener("mousemove", () => this._setSelected(i));
      this.resultContainerEl.appendChild(el);
      this._itemEls.push(el);
    });
  }

  private _setSelected(i: number): void {
    if (i === this._selected) return;
    this._itemEls[this._selected]?.classList.remove("is-selected");
    this._selected = i;
    this._itemEls[i]?.classList.add("is-selected");
  }

  private _moveSelection(delta: number): void {
    if (this._items.length === 0) return;
    const next = (this._selected + delta + this._items.length) % this._items.length;
    this._setSelected(next);
    this._itemEls[next]?.scrollIntoView({ block: "nearest" });
  }
}

export interface SearchResult {
  score: number;
  matches: Array<[number, number]>;
}

export interface FuzzyMatch<T> {
  item: T;
  match: SearchResult;
}

/** Substring match scores best; otherwise in-order character fuzzy match. */
function fuzzyMatch(text: string, query: string): SearchResult | null {
  if (!query) return { score: 0, matches: [] };
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx >= 0) {
    return {
      score: 1000 - idx - (lower.length - q.length) * 0.01,
      matches: [[idx, idx + q.length]],
    };
  }
  const matches: Array<[number, number]> = [];
  let cursor = 0;
  let score = 0;
  for (const ch of q) {
    if (/\s/.test(ch)) continue;
    const at = lower.indexOf(ch, cursor);
    if (at === -1) return null;
    const last = matches[matches.length - 1];
    if (last && last[1] === at) last[1] = at + 1;
    else matches.push([at, at + 1]);
    score -= at - cursor; // distance between hits costs score
    cursor = at + 1;
  }
  return { score: score - matches.length * 10, matches };
}

export abstract class FuzzySuggestModal<T> extends SuggestModal<FuzzyMatch<T>> {
  getSuggestions(query: string): Array<FuzzyMatch<T>> {
    const out: Array<FuzzyMatch<T>> = [];
    for (const item of this.getItems()) {
      const match = fuzzyMatch(this.getItemText(item), query.trim());
      if (match) out.push({ item, match });
    }
    out.sort((a, b) => b.match.score - a.match.score);
    return out;
  }

  renderSuggestion(value: FuzzyMatch<T>, el: HTMLElement): void {
    el.textContent = this.getItemText(value.item);
  }

  onChooseSuggestion(item: FuzzyMatch<T>, evt: MouseEvent | KeyboardEvent): void {
    this.onChooseItem(item.item, evt);
  }

  abstract getItems(): T[];
  abstract getItemText(item: T): string;
  abstract onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void;
}

/* ---------------- Menu (suite-driven R4 — minimal real popup) ---------------- */

export class MenuItem {
  /** @internal */
  readonly dom: HTMLElement;
  private iconEl: HTMLElement;
  private titleEl: HTMLElement;
  private disabled = false;
  private clickCallback: ((evt: MouseEvent | KeyboardEvent) => unknown) | null = null;

  /** @internal Use Menu.addItem — real Obsidian's constructor is private. */
  constructor(menu: Menu) {
    this.dom = document.createElement("div");
    this.dom.className = "menu-item";
    this.dom.setAttribute("data-testid", "compat-menu-item");
    this.iconEl = document.createElement("div");
    this.iconEl.className = "menu-item-icon";
    this.titleEl = document.createElement("div");
    this.titleEl.className = "menu-item-title";
    this.dom.append(this.iconEl, this.titleEl);
    this.dom.addEventListener("click", (evt) => {
      if (this.disabled) return;
      menu.hide();
      try {
        void this.clickCallback?.(evt);
      } catch (err) {
        console.error("[obsidian-compat] MenuItem onClick threw", err);
      }
    });
  }

  setTitle(title: string | DocumentFragment): this {
    if (typeof title === "string") {
      this.titleEl.textContent = title;
    } else {
      this.titleEl.textContent = "";
      this.titleEl.appendChild(title);
    }
    return this;
  }

  setIcon(icon: IconName | null): this {
    this.iconEl.textContent = "";
    if (icon) setIcon(this.iconEl, icon);
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.dom.classList.toggle("is-disabled", disabled);
    return this;
  }

  setChecked(checked: boolean | null): this {
    this.dom.classList.toggle("is-checked", checked === true);
    return this;
  }

  setWarning(isWarning: boolean): this {
    this.dom.classList.toggle("is-warning", isWarning);
    return this;
  }

  setIsLabel(isLabel: boolean): this {
    this.dom.classList.toggle("is-label", isLabel);
    return this;
  }

  setSection(section: string): this {
    this.dom.setAttribute("data-section", section);
    return this;
  }

  onClick(callback: (evt: MouseEvent | KeyboardEvent) => unknown): this {
    this.clickCallback = callback;
    return this;
  }
}

export class Menu extends Component {
  /** @internal */
  readonly dom: HTMLElement;
  private hideCallback: (() => unknown) | null = null;
  private visible = false;
  private detachListeners: (() => void) | null = null;
  /** R144: the element this menu is parented to (Obsidian setParentElement). In
   *  single-window Geode its only effect is the append target's ownerDocument,
   *  which is always `document` — so it is stored and honored but behaviorally a
   *  no-op here (the showAtPosition clamp still uses the main window's viewport). */
  private parentEl: HTMLElement | null = null;

  constructor() {
    super();
    this.dom = document.createElement("div");
    this.dom.className = "menu geode-compat-menu";
    this.dom.setAttribute("data-testid", "compat-menu");
  }

  /** R144: create a menu associated with an event — the modern Obsidian idiom
   *  (`Menu.forEvent(evt).addItem(…).showAtMouseEvent(evt)`). Parents to the
   *  event target so it opens in that target's document/window. @since 1.6.0 */
  static forEvent(evt: PointerEvent | MouseEvent): Menu {
    const menu = new Menu();
    if (evt.target instanceof HTMLElement) menu.setParentElement(evt.target);
    return menu;
  }

  /** R144: set the element this menu belongs to. @since 0.16.0 */
  setParentElement(el: HTMLElement): this {
    this.parentEl = el;
    return this;
  }

  setNoIcon(): this {
    this.dom.classList.add("no-icon");
    return this;
  }

  /** Native menus do not exist in Geode — DOM menu is always used. */
  setUseNativeMenu(_useNativeMenu: boolean): this {
    return this;
  }

  addItem(cb: (item: MenuItem) => unknown): this {
    const item = new MenuItem(this);
    this.dom.appendChild(item.dom);
    cb(item);
    return this;
  }

  addSeparator(): this {
    const sep = document.createElement("div");
    sep.className = "menu-separator";
    this.dom.appendChild(sep);
    return this;
  }

  showAtMouseEvent(evt: MouseEvent): this {
    return this.showAtPosition({ x: evt.clientX, y: evt.clientY });
  }

  showAtPosition(position: { x: number; y: number }, _doc?: Document): this {
    if (this.visible) this.hide();
    this.visible = true;
    // R144: honor setParentElement's ownerDocument (= document in single-window Geode)
    (this.parentEl?.ownerDocument ?? document).body.appendChild(this.dom);
    // clamp into the viewport once the size is known
    const rect = this.dom.getBoundingClientRect();
    const x = Math.min(position.x, window.innerWidth - rect.width - 4);
    const y = Math.min(position.y, window.innerHeight - rect.height - 4);
    this.dom.style.left = `${Math.max(0, x)}px`;
    this.dom.style.top = `${Math.max(0, y)}px`;
    const onDown = (e: MouseEvent): void => {
      if (e.target instanceof Node && this.dom.contains(e.target)) return;
      this.hide();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    this.detachListeners = () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
    this.load();
    return this;
  }

  hide(): this {
    if (!this.visible) return this;
    this.visible = false;
    this.detachListeners?.();
    this.detachListeners = null;
    this.dom.remove();
    try {
      void this.hideCallback?.();
    } catch (err) {
      console.error("[obsidian-compat] Menu onHide callback threw", err);
    }
    this.unload();
    return this;
  }

  close(): void {
    this.hide();
  }

  onHide(callback: () => unknown): void {
    this.hideCallback = callback;
  }
}

/* ---------------- setting components ---------------- */

export abstract class BaseComponent {
  disabled = false;

  /** 'Facilitates chaining'. */
  then(cb: (component: this) => unknown): this {
    cb(this);
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }
}

export abstract class ValueComponent<T> extends BaseComponent {
  registerOptionListener(_listeners: Record<string, (value?: T) => T>, _key: string): this {
    reportGap("Setting", "ValueComponent.registerOptionListener");
    return this;
  }
  abstract getValue(): T;
  /** setValue updates the UI but does NOT fire onChange. */
  abstract setValue(value: T): this;
}

export class AbstractTextComponent<
  T extends HTMLInputElement | HTMLTextAreaElement,
> extends ValueComponent<string> {
  inputEl: T;
  private changeCallback: ((value: string) => unknown) | null = null;

  constructor(inputEl: T) {
    super();
    this.inputEl = inputEl;
    this.inputEl.addEventListener("input", () => this.onChanged());
  }

  override setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.inputEl.disabled = disabled;
    return this;
  }

  getValue(): string {
    return this.inputEl.value;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  setPlaceholder(placeholder: string): this {
    this.inputEl.placeholder = placeholder;
    return this;
  }

  /** Manually trigger change handling (used after programmatic edits). */
  onChanged(): void {
    this.changeCallback?.(this.inputEl.value);
  }

  onChange(callback: (value: string) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export class TextComponent extends AbstractTextComponent<HTMLInputElement> {
  constructor(containerEl: HTMLElement) {
    const input = document.createElement("input");
    input.type = "text";
    containerEl.appendChild(input);
    super(input);
  }
}

export class TextAreaComponent extends AbstractTextComponent<HTMLTextAreaElement> {
  constructor(containerEl: HTMLElement) {
    const textarea = document.createElement("textarea");
    containerEl.appendChild(textarea);
    super(textarea);
  }
}

export class SearchComponent extends AbstractTextComponent<HTMLInputElement> {
  clearButtonEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    const wrapper = document.createElement("div");
    wrapper.className = "search-input-container";
    const input = document.createElement("input");
    input.type = "search";
    wrapper.appendChild(input);
    containerEl.appendChild(wrapper);
    super(input);
    this.clearButtonEl = document.createElement("div");
    this.clearButtonEl.className = "search-input-clear-button";
    this.clearButtonEl.addEventListener("click", () => {
      this.setValue("");
      this.onChanged();
    });
    wrapper.appendChild(this.clearButtonEl);
  }
}

export class MomentFormatComponent extends TextComponent {
  sampleEl: HTMLElement = document.createElement("span");
  private defaultFormat = "";

  /** 'Sets the default format when input is cleared. Also used for placeholder.' */
  setDefaultFormat(defaultFormat: string): this {
    this.defaultFormat = defaultFormat;
    this.inputEl.placeholder = defaultFormat;
    this.updateSample();
    return this;
  }

  setSampleEl(sampleEl: HTMLElement): this {
    this.sampleEl = sampleEl;
    this.updateSample();
    return this;
  }

  override setValue(value: string): this {
    super.setValue(value);
    this.updateSample();
    return this;
  }

  override onChanged(): void {
    super.onChanged();
    this.updateSample();
  }

  /** Live sample of the current format rendered with the real moment (R5). */
  updateSample(): void {
    this.sampleEl.textContent = moment().format(this.getValue() || this.defaultFormat);
  }
}

export class ToggleComponent extends ValueComponent<boolean> {
  toggleEl: HTMLElement;
  private value = false;
  private changeCallback: ((value: boolean) => unknown) | null = null;

  constructor(containerEl: HTMLElement) {
    super();
    this.toggleEl = document.createElement("div");
    this.toggleEl.className = "checkbox-container";
    this.toggleEl.setAttribute("role", "checkbox");
    this.toggleEl.setAttribute("aria-checked", "false");
    this.toggleEl.tabIndex = 0;
    containerEl.appendChild(this.toggleEl);
    this.toggleEl.addEventListener("click", () => {
      if (!this.disabled) this.onClick();
    });
  }

  override setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.toggleEl.classList.toggle("is-disabled", disabled);
    return this;
  }

  getValue(): boolean {
    return this.value;
  }

  setValue(on: boolean): this {
    this.value = on;
    this.toggleEl.classList.toggle("is-enabled", on);
    this.toggleEl.setAttribute("aria-checked", String(on));
    return this;
  }

  setTooltip(tooltip: string, _options?: unknown): this {
    this.toggleEl.setAttribute("aria-label", tooltip);
    return this;
  }

  /** Public click action: flips the value AND fires onChange (per reference). */
  onClick(): void {
    this.setValue(!this.value);
    this.changeCallback?.(this.value);
  }

  onChange(callback: (value: boolean) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export class ButtonComponent extends BaseComponent {
  buttonEl: HTMLButtonElement;
  private clickCallback: ((evt: MouseEvent) => unknown) | null = null;

  constructor(containerEl: HTMLElement) {
    super();
    this.buttonEl = document.createElement("button");
    containerEl.appendChild(this.buttonEl);
    this.buttonEl.addEventListener("click", (evt) => void this.clickCallback?.(evt));
  }

  override setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.buttonEl.disabled = disabled;
    return this;
  }

  setCta(): this {
    this.buttonEl.classList.add("mod-cta");
    return this;
  }

  removeCta(): this {
    this.buttonEl.classList.remove("mod-cta");
    return this;
  }

  /** @deprecated Use setDestructive */
  setWarning(): this {
    return this.setDestructive();
  }

  setDestructive(): this {
    this.buttonEl.classList.add("mod-destructive");
    return this;
  }

  removeDestructive(): this {
    this.buttonEl.classList.remove("mod-destructive");
    return this;
  }

  setTooltip(tooltip: string, _options?: unknown): this {
    this.buttonEl.setAttribute("aria-label", tooltip);
    return this;
  }

  setButtonText(name: string): this {
    this.buttonEl.textContent = name;
    return this;
  }

  setIcon(icon: IconName): this {
    setIcon(this.buttonEl, icon);
    return this;
  }

  setClass(cls: string): this {
    this.buttonEl.classList.add(...cls.split(/\s+/).filter(Boolean));
    return this;
  }

  /** Registers the click callback and returns this (chainable). */
  onClick(callback: (evt: MouseEvent) => unknown): this {
    this.clickCallback = callback;
    return this;
  }
}

export class ExtraButtonComponent extends BaseComponent {
  /** NOTE: named extraSettingsEl, not buttonEl (per reference). */
  extraSettingsEl: HTMLElement;
  private clickCallback: (() => unknown) | null = null;

  constructor(containerEl: HTMLElement) {
    super();
    this.extraSettingsEl = document.createElement("div");
    this.extraSettingsEl.className = "clickable-icon extra-setting-button";
    containerEl.appendChild(this.extraSettingsEl);
    this.extraSettingsEl.addEventListener("click", () => {
      if (!this.disabled) void this.clickCallback?.();
    });
  }

  override setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.extraSettingsEl.classList.toggle("is-disabled", disabled);
    return this;
  }

  setTooltip(tooltip: string, _options?: unknown): this {
    this.extraSettingsEl.setAttribute("aria-label", tooltip);
    return this;
  }

  setIcon(icon: IconName): this {
    setIcon(this.extraSettingsEl, icon);
    return this;
  }

  onClick(callback: () => unknown): this {
    this.clickCallback = callback;
    return this;
  }
}

export class DropdownComponent extends ValueComponent<string> {
  selectEl: HTMLSelectElement;
  private changeCallback: ((value: string) => unknown) | null = null;

  constructor(containerEl: HTMLElement) {
    super();
    this.selectEl = document.createElement("select");
    this.selectEl.className = "dropdown";
    containerEl.appendChild(this.selectEl);
    this.selectEl.addEventListener("change", () => this.changeCallback?.(this.selectEl.value));
  }

  override setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.selectEl.disabled = disabled;
    return this;
  }

  addOption(value: string, display: string): this {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = display;
    this.selectEl.appendChild(option);
    return this;
  }

  addOptions(options: Record<string, string>): this {
    for (const [value, display] of Object.entries(options)) this.addOption(value, display);
    return this;
  }

  getValue(): string {
    return this.selectEl.value;
  }

  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }

  onChange(callback: (value: string) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export class SliderComponent extends ValueComponent<number> {
  sliderEl: HTMLInputElement;
  private changeCallback: ((value: number) => unknown) | null = null;
  private displayFormat: ((value: number) => string) | null = null;
  private instant = false;

  constructor(containerEl: HTMLElement) {
    super();
    this.sliderEl = document.createElement("input");
    this.sliderEl.type = "range";
    this.sliderEl.className = "slider";
    containerEl.appendChild(this.sliderEl);
    this.sliderEl.addEventListener("change", () => this.fire());
    this.sliderEl.addEventListener("input", () => {
      this.sliderEl.title = this.getValuePretty();
      if (this.instant) this.fire();
    });
  }

  private fire(): void {
    this.changeCallback?.(this.getValue());
  }

  override setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.sliderEl.disabled = disabled;
    return this;
  }

  /** onChange fires while dragging instead of only on release. */
  setInstant(instant: boolean): this {
    this.instant = instant;
    return this;
  }

  setLimits(min: number | null, max: number | null, step: number | "any"): this {
    if (min === null) this.sliderEl.removeAttribute("min");
    else this.sliderEl.min = String(min);
    if (max === null) this.sliderEl.removeAttribute("max");
    else this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  }

  getValue(): number {
    return parseFloat(this.sliderEl.value);
  }

  setValue(value: number): this {
    this.sliderEl.value = String(value);
    return this;
  }

  getValuePretty(): string {
    const value = this.getValue();
    return this.displayFormat ? this.displayFormat(value) : String(value);
  }

  setDisplayFormat(format: (value: number) => string): this {
    this.displayFormat = format;
    return this;
  }

  /** @deprecated The value is now always shown inline — kept chainable. */
  setDynamicTooltip(): this {
    this.sliderEl.title = this.getValuePretty();
    return this;
  }

  onChange(callback: (value: number) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

/* ---------------- Setting ---------------- */

export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  components: BaseComponent[] = [];
  errorEl: HTMLElement | null = null;

  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement("div");
    this.settingEl.className = "setting-item";
    this.settingEl.setAttribute("data-testid", "compat-setting-item");
    this.infoEl = document.createElement("div");
    this.infoEl.className = "setting-item-info";
    this.nameEl = document.createElement("div");
    this.nameEl.className = "setting-item-name";
    this.descEl = document.createElement("div");
    this.descEl.className = "setting-item-description";
    this.infoEl.append(this.nameEl, this.descEl);
    this.controlEl = document.createElement("div");
    this.controlEl.className = "setting-item-control";
    this.settingEl.append(this.infoEl, this.controlEl);
    containerEl.appendChild(this.settingEl);
  }

  private static fill(el: HTMLElement, content: string | DocumentFragment): void {
    if (typeof content === "string") {
      el.textContent = content;
    } else {
      el.textContent = "";
      el.appendChild(content);
    }
  }

  setName(name: string | DocumentFragment): this {
    Setting.fill(this.nameEl, name);
    return this;
  }

  setDesc(desc: string | DocumentFragment): this {
    Setting.fill(this.descEl, desc);
    return this;
  }

  setClass(cls: string): this {
    this.settingEl.classList.add(...cls.split(/\s+/).filter(Boolean));
    return this;
  }

  setTooltip(tooltip: string, _options?: unknown): this {
    this.settingEl.setAttribute("aria-label", tooltip);
    return this;
  }

  setHeading(): this {
    this.settingEl.classList.add("setting-item-heading");
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.settingEl.classList.toggle("is-disabled", disabled);
    for (const component of this.components) component.setDisabled(disabled);
    return this;
  }

  setErrorMessage(message: string | null): this {
    if (!message) {
      this.errorEl?.remove();
      this.errorEl = null;
      this.settingEl.classList.remove("is-invalid");
      return this;
    }
    if (!this.errorEl) {
      this.errorEl = document.createElement("div");
      this.errorEl.className = "setting-item-error";
      this.settingEl.appendChild(this.errorEl);
    }
    this.errorEl.textContent = message;
    this.settingEl.classList.add("is-invalid");
    return this;
  }

  private addControl<T extends BaseComponent>(component: T, cb: (component: T) => unknown): this {
    this.components.push(component);
    cb(component);
    return this;
  }

  addButton(cb: (component: ButtonComponent) => unknown): this {
    return this.addControl(new ButtonComponent(this.controlEl), cb);
  }

  addExtraButton(cb: (component: ExtraButtonComponent) => unknown): this {
    return this.addControl(new ExtraButtonComponent(this.controlEl), cb);
  }

  addToggle(cb: (component: ToggleComponent) => unknown): this {
    return this.addControl(new ToggleComponent(this.controlEl), cb);
  }

  addText(cb: (component: TextComponent) => unknown): this {
    return this.addControl(new TextComponent(this.controlEl), cb);
  }

  addSearch(cb: (component: SearchComponent) => unknown): this {
    return this.addControl(new SearchComponent(this.controlEl), cb);
  }

  addTextArea(cb: (component: TextAreaComponent) => unknown): this {
    return this.addControl(new TextAreaComponent(this.controlEl), cb);
  }

  addDropdown(cb: (component: DropdownComponent) => unknown): this {
    return this.addControl(new DropdownComponent(this.controlEl), cb);
  }

  addSlider(cb: (component: SliderComponent) => unknown): this {
    return this.addControl(new SliderComponent(this.controlEl), cb);
  }

  addMomentFormat(cb: (component: MomentFormatComponent) => unknown): this {
    return this.addControl(new MomentFormatComponent(this.controlEl), cb);
  }

  addComponent<T extends BaseComponent>(cb: (el: HTMLElement) => T): this {
    this.components.push(cb(this.controlEl));
    return this;
  }

  addColorPicker(_cb: (component: never) => unknown): this {
    reportGap("Setting", "addColorPicker", "control omitted");
    return this;
  }

  addProgressBar(_cb: (component: never) => unknown): this {
    reportGap("Setting", "addProgressBar", "control omitted");
    return this;
  }

  addDisplayValue(_cb: (component: never) => unknown): this {
    reportGap("Setting", "addDisplayValue", "control omitted");
    return this;
  }

  then(cb: (setting: this) => unknown): this {
    cb(this);
    return this;
  }

  clear(): this {
    this.components = [];
    this.controlEl.textContent = "";
    return this;
  }
}
