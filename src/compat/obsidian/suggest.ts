/**
 * PopoverSuggest / EditorSuggest — REAL triggering since R6 (suite unlock:
 * nldates' DateSuggest). One EditorSuggestManager per compat context owns the
 * trigger loop and the popup; context.ts drives it from the core
 * `document:changed` AND `document:selection-changed` events (active view
 * only — R9 closed the "pure cursor movement does not re-trigger" gap, so
 * onTrigger now re-evaluates per keypress like the official runtime) and
 * Plugin.registerEditorSuggest registers instances in order. nldates anchors
 * on `this.context?.start` across keystrokes, which we preserve by never
 * clearing `context` before a re-trigger.
 */
import type { Editor, EditorPosition } from "./editor";
import type { TFile } from "./files";
import type { App } from "./plugin";
import {
  Scope,
  _createInstructionsEl,
  _modifiersFromEvent,
  type Instruction,
  type ScopeKeymapHandler,
} from "./ui";

export interface EditorSuggestTriggerInfo {
  /** The start position of the triggering text. */
  start: EditorPosition;
  /** The end position of the triggering text. */
  end: EditorPosition;
  /** The query string (usually the text between start and end). */
  query: string;
}

export interface EditorSuggestContext extends EditorSuggestTriggerInfo {
  editor: Editor;
  file: TFile;
}

export abstract class PopoverSuggest<T> {
  app: App;
  scope: Scope;
  /** @internal stored Instruction[] — read by the popup at every render */
  _instructions: Instruction[] = [];

  constructor(app: App, scope?: Scope) {
    this.app = app;
    this.scope = scope ?? new Scope();
  }

  /**
   * Real since R9: stores the list (each call replaces it wholesale); the
   * popup renders the bar from the stored list on every open/render, so
   * calling before OR after the popup opened both work.
   */
  setInstructions(instructions: Instruction[]): void {
    this._instructions = instructions;
  }

  /** Overridden by EditorSuggest — the manager drives the real popup. */
  open(): void {}
  close(): void {}

  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;
}

export abstract class EditorSuggest<T> extends PopoverSuggest<T> {
  /** Result of onTrigger; null whenever the suggest is not supposed to run. */
  context: EditorSuggestContext | null = null;
  limit = 100;
  /** @internal manager backref while registered (registerEditorSuggest). */
  _manager: EditorSuggestManager | null = null;
  /**
   * NON-PUBLIC surface nldates hits from its Shift+Enter scope handler:
   * `this.suggestions.useSelectedItem(evt)` selects the highlighted item.
   */
  suggestions: { useSelectedItem(evt: MouseEvent | KeyboardEvent): void };

  constructor(app: App) {
    super(app);
    this.suggestions = {
      useSelectedItem: (evt) => this._manager?.useSelectedItem(this, evt),
    };
  }

  /** Stores via the base class, then live-updates an already-open popup. */
  override setInstructions(instructions: Instruction[]): void {
    super.setInstructions(instructions);
    this._manager?._refreshInstructions(this as EditorSuggest<unknown>);
  }

  /** Show the popup for the current context (manager-rendered). */
  override open(): void {
    this._manager?._showPopup(this as EditorSuggest<unknown>);
  }

  /** Hide the popup if owned by this suggest and clear context. Idempotent. */
  override close(): void {
    this._manager?._closePopup(this as EditorSuggest<unknown>);
    this.context = null;
  }

  abstract onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    file: TFile | null,
  ): EditorSuggestTriggerInfo | null;

  abstract getSuggestions(context: EditorSuggestContext): T[] | Promise<T[]>;
}

/* ---------------- runtime (one manager per compat context) ---------------- */

type AnySuggest = EditorSuggest<unknown>;

/** Plain Escape / plain nav keys only — modified chords belong to the scope. */
function noModifiers(evt: KeyboardEvent): boolean {
  return !evt.ctrlKey && !evt.altKey && !evt.metaKey && !evt.shiftKey;
}

/** Scope handler match: null modifiers = any state; null key = any key. */
function handlerMatches(h: ScopeKeymapHandler, evt: KeyboardEvent): boolean {
  if (h.key !== null && h.key.toLowerCase() !== evt.key.toLowerCase()) return false;
  return h.modifiers === null || h.modifiers === _modifiersFromEvent(evt);
}

/**
 * Registration-ordered EditorSuggest registry + trigger loop + popup.
 * context.ts constructs one per compat context, wires `document:changed`
 * into runTrigger and `active-file:changed` into closeActive, and disposes
 * it with the context.
 */
export class EditorSuggestManager {
  /** registerEditorSuggest order — first non-null onTrigger wins. */
  private readonly suggests: AnySuggest[] = [];
  private active: AnySuggest | null = null;
  /** items handed from the trigger loop to the next _showPopup call */
  private pendingItems: unknown[] = [];
  private items: unknown[] = [];
  private itemEls: HTMLElement[] = [];
  private selected = 0;
  private popupEl: HTMLElement | null = null;
  private detachDom: (() => void) | null = null;
  /**
   * rAF id of the pending coalesced reposition; 0 = none scheduled. Doubles
   * as the dirty flag (at most one position() per frame). MUST be reset to 0
   * after cancel/run — R7 StrictMode lesson: a stale non-zero id makes every
   * later schedule attempt early-return forever.
   */
  private repositionRaf = 0;
  /** stale-token guard for async getSuggestions (bumped on close too) */
  private token = 0;

  /** Register a suggest (plugin.ts). Returns the per-plugin disposer. */
  register(suggest: AnySuggest): () => void {
    this.suggests.push(suggest);
    suggest._manager = this;
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      suggest.close(); // plugin unload while the popup is open
      const idx = this.suggests.indexOf(suggest);
      if (idx >= 0) this.suggests.splice(idx, 1);
      suggest._manager = null;
    };
  }

  /**
   * Trigger loop — context.ts calls this per local document transaction AND
   * per pure cursor movement (document:selection-changed, R9) on the active
   * view. NOTE: an already-open suggest keeps its `context` while onTrigger
   * runs (nldates reuses context.start as the anchor). Re-entrancy: an edit
   * made inside the loop fires document:changed synchronously and re-enters
   * runTrigger — the token bump makes the outer in-flight getSuggestions
   * result stale, so only the innermost run ever opens the popup.
   */
  async runTrigger(editor: Editor, file: TFile | null): Promise<void> {
    const cursor = editor.getCursor();
    for (const suggest of this.suggests) {
      let info: EditorSuggestTriggerInfo | null = null;
      try {
        info = suggest.onTrigger(cursor, editor, file);
      } catch (err) {
        console.error("[obsidian-compat] EditorSuggest.onTrigger threw", err);
      }
      if (!info) continue;

      // first non-null wins — any other suggest with a context (open popup OR
      // in-flight getSuggestions that never opened) closes first; close() is
      // idempotent and only the owner tears the popup down
      for (const other of this.suggests) {
        if (other !== suggest && other.context) other.close();
      }
      // official EditorSuggestContext declares a non-null file; an unsaved /
      // unregistered path is host-impossible on the active markdown view
      suggest.context = { ...info, editor, file: file as TFile };
      const token = ++this.token;
      let items: unknown[];
      try {
        items = await suggest.getSuggestions(suggest.context);
      } catch (err) {
        console.error("[obsidian-compat] EditorSuggest.getSuggestions threw", err);
        items = [];
      }
      if (token !== this.token) return; // stale async result / closed mid-flight
      if (!suggest.context) return;
      if (items.length === 0) {
        suggest.close();
        return;
      }
      this.pendingItems = items;
      suggest.open();
      return;
    }
    // no suggest triggered -> close (trigger-null timing)
    this.closeActive();
  }

  /**
   * Close the popup AND every lingering context (active-file switch, Escape,
   * outside click, trigger-null, dispose). The official contract requires
   * `context` to be null whenever the suggest is not supposed to run — a
   * suggest whose async getSuggestions is still pending has a context but no
   * popup yet (active is null), so closing only the active one would let the
   * stale popup open later. The token bump cancels such in-flight requests.
   */
  closeActive(): void {
    this.token++;
    for (const suggest of this.suggests) {
      if (suggest.context) suggest.close();
    }
    this.active?.close();
  }

  dispose(): void {
    this.closeActive();
    for (const suggest of this.suggests.splice(0)) suggest._manager = null;
  }

  /** Non-public `suggest.suggestions.useSelectedItem(evt)` (nldates). */
  useSelectedItem(suggest: AnySuggest, evt: MouseEvent | KeyboardEvent): void {
    if (this.active !== suggest) return;
    this.selectItem(this.selected, evt);
  }

  /* ----- popup (driven through suggest.open/close) ----- */

  /** @internal EditorSuggest.open: render pending (or current) items. */
  _showPopup(suggest: AnySuggest): void {
    if (!suggest.context) return;
    if (this.active && this.active !== suggest) this.active.close();
    this.active = suggest;
    const source = this.pendingItems.length > 0 ? this.pendingItems : this.items;
    this.pendingItems = [];
    if (source.length === 0) return; // nothing to show — open() without items
    this.items = source.slice(0, suggest.limit);
    this.selected = 0;
    this.render(suggest);
    this.position(suggest);
  }

  /** @internal EditorSuggest.close: tear down if this suggest owns the popup. */
  _closePopup(suggest: AnySuggest): void {
    if (this.active !== suggest) return; // idempotent / not the owner
    this.active = null;
    this.token++; // cancel any in-flight getSuggestions
    this.items = [];
    this.itemEls = [];
    this.pendingItems = [];
    this.detachDom?.();
    this.detachDom = null;
    this.popupEl?.remove();
    this.popupEl = null;
  }

  private ensurePopupEl(): HTMLElement {
    if (this.popupEl) return this.popupEl;
    const el = document.createElement("div");
    el.className = "geode-suggest-popup suggestion-container";
    el.setAttribute("data-testid", "editor-suggest-popup");
    // keep the editor focused while clicking suggestions
    el.addEventListener("mousedown", (evt) => evt.preventDefault());
    document.body.appendChild(el);
    this.popupEl = el;
    this.attachDomListeners();
    return el;
  }

  private render(suggest: AnySuggest): void {
    const popup = this.ensurePopupEl();
    popup.textContent = "";
    this.itemEls = [];
    this.items.forEach((item, i) => {
      const el = document.createElement("div");
      el.className = "suggestion-item";
      el.setAttribute("data-testid", "editor-suggest-item");
      if (i === this.selected) el.classList.add("is-selected");
      try {
        // el supports el.setText etc. via the global DOM augmentation (dom.ts)
        suggest.renderSuggestion(item, el);
      } catch (err) {
        console.error("[obsidian-compat] EditorSuggest.renderSuggestion threw", err);
      }
      el.addEventListener("mousemove", () => this.setSelected(i));
      el.addEventListener("click", (evt) => this.selectItem(i, evt));
      popup.appendChild(el);
      this.itemEls.push(el);
    });
    this.renderInstructions(popup, suggest);
  }

  /**
   * (Re-)render the `.prompt-instructions` bar below the item list from the
   * suggest's stored list. Reading at render time (not setInstructions time)
   * keeps instructions set in plugin constructors — nldates — working, and
   * the bar stays at the list bottom even when the popup flips above the line.
   */
  private renderInstructions(popup: HTMLElement, suggest: AnySuggest): void {
    popup.querySelector(":scope > .prompt-instructions")?.remove();
    const bar = _createInstructionsEl(suggest._instructions);
    if (!bar) return;
    bar.setAttribute("data-testid", "editor-suggest-instructions");
    popup.appendChild(bar);
  }

  /** @internal setInstructions while this suggest's popup is already open. */
  _refreshInstructions(suggest: AnySuggest): void {
    if (this.active !== suggest || !this.popupEl) return;
    this.renderInstructions(this.popupEl, suggest);
  }

  /** Fixed-position below the trigger start; flips above near the bottom. */
  private position(suggest: AnySuggest): void {
    const popup = this.popupEl;
    const ctx = suggest.context;
    if (!popup || !ctx) return;
    const cm = ctx.editor.cm;
    // anchor at the trigger start so the popup stays put while typing
    const coords =
      cm.coordsAtPos(ctx.editor.posToOffset(ctx.start), 1) ??
      // start scrolled out of the viewport — fall back to the editor box
      ((): { left: number; top: number; bottom: number } => {
        const r = cm.dom.getBoundingClientRect();
        return { left: r.left, top: r.top, bottom: r.top };
      })();
    const rect = popup.getBoundingClientRect();
    const left = Math.max(4, Math.min(coords.left, window.innerWidth - rect.width - 8));
    let top = coords.bottom + 4;
    if (top + rect.height > window.innerHeight - 4) {
      top = coords.top - rect.height - 4; // flip above the line
    }
    popup.style.left = `${left}px`;
    popup.style.top = `${Math.max(4, top)}px`;
  }

  private setSelected(i: number): void {
    if (i === this.selected || i < 0 || i >= this.itemEls.length) return;
    this.itemEls[this.selected]?.classList.remove("is-selected");
    this.selected = i;
    this.itemEls[i]?.classList.add("is-selected");
  }

  private moveSelection(delta: number): void {
    if (this.items.length === 0) return;
    const next = (this.selected + delta + this.items.length) % this.items.length;
    this.setSelected(next);
    this.itemEls[next]?.scrollIntoView({ block: "nearest" });
  }

  private selectItem(i: number, evt: MouseEvent | KeyboardEvent): void {
    const suggest = this.active;
    const item = this.items[i];
    if (!suggest || item === undefined) return;
    try {
      // selectSuggestion reads suggest.context (nldates) — close AFTER it ran
      suggest.selectSuggestion(item, evt);
    } catch (err) {
      console.error("[obsidian-compat] EditorSuggest.selectSuggestion threw", err);
    }
    suggest.close();
  }

  /* ----- document-level listeners while the popup is open ----- */

  private attachDomListeners(): void {
    const onKeydown = (evt: KeyboardEvent): void => this.handleKeydown(evt);
    const onMousedown = (evt: MouseEvent): void => {
      const target = evt.target;
      if (!(target instanceof Node)) return;
      if (this.popupEl?.contains(target)) return;
      // clicks inside the editor move the cursor — the resulting
      // document:selection-changed event re-runs the trigger loop, which
      // keeps or closes the popup per onTrigger; anything else outside
      // closes it immediately
      if (this.active?.context?.editor.cm.dom.contains(target)) return;
      this.closeActive();
    };
    // Follow the anchor on viewport changes while the popup is open. "scroll"
    // does not bubble, so only a capture-phase document listener sees the CM6
    // scroller (or any other scrolling ancestor). Callbacks are coalesced
    // through rAF — repositionRaf !== 0 means a frame is already pending, so
    // position() runs at most once per frame. The popup's own list scroll is
    // also captured here, but reposition is idempotent (anchor-derived), and
    // writing style.left/top never fires scroll — no feedback loop.
    const onViewportChange = (): void => {
      if (this.repositionRaf !== 0) return; // already scheduled this frame
      this.repositionRaf = requestAnimationFrame(() => {
        this.repositionRaf = 0; // reset BEFORE repositioning (R7 lesson)
        if (this.active) this.position(this.active);
      });
    };
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("mousedown", onMousedown, true);
    window.addEventListener("resize", onViewportChange);
    document.addEventListener("scroll", onViewportChange, true);
    this.detachDom = () => {
      document.removeEventListener("keydown", onKeydown, true);
      document.removeEventListener("mousedown", onMousedown, true);
      window.removeEventListener("resize", onViewportChange);
      document.removeEventListener("scroll", onViewportChange, true);
      if (this.repositionRaf !== 0) {
        cancelAnimationFrame(this.repositionRaf);
        this.repositionRaf = 0; // R7 lesson: never leave a cancelled id behind
      }
    };
  }

  /**
   * Capture-phase keydown: the suggest's own scope handlers run FIRST
   * (nldates' Shift+Enter path; returning false => preventDefault +
   * stopPropagation), then the built-in navigation keys. Plain typing falls
   * through to the editor.
   */
  private handleKeydown(evt: KeyboardEvent): void {
    const suggest = this.active;
    if (!suggest) return;
    // keystrokes outside the editor + popup (command palette input, modals…)
    // must never be consumed here — losing keyboard focus closes the popup
    // instead (same judgement as the outside-mousedown path)
    const target = evt.target instanceof Node ? evt.target : null;
    if (
      target &&
      !this.popupEl?.contains(target) &&
      !suggest.context?.editor.cm.dom.contains(target)
    ) {
      this.closeActive();
      return;
    }
    for (const handler of suggest.scope._handlers) {
      if (!handlerMatches(handler, evt)) continue;
      let result: unknown;
      try {
        result = handler.func(evt, {
          modifiers: _modifiersFromEvent(evt),
          key: handler.key,
          vkey: evt.key,
        });
      } catch (err) {
        console.error("[obsidian-compat] Scope handler threw", err);
      }
      if (result === false) {
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }
    }
    if (evt.key === "ArrowDown" && noModifiers(evt)) {
      evt.preventDefault();
      evt.stopPropagation();
      this.moveSelection(1);
    } else if (evt.key === "ArrowUp" && noModifiers(evt)) {
      evt.preventDefault();
      evt.stopPropagation();
      this.moveSelection(-1);
    } else if (evt.key === "Enter" && noModifiers(evt)) {
      evt.preventDefault();
      evt.stopPropagation();
      this.selectItem(this.selected, evt);
    } else if (evt.key === "Escape" && noModifiers(evt)) {
      evt.preventDefault();
      evt.stopPropagation();
      this.closeActive();
    }
  }
}
