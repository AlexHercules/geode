/**
 * Obsidian global DOM prototype augmentation (API-REFERENCE area 5).
 *
 * Installed as REAL prototype methods because plugin bundles call them on
 * arbitrary elements. Application is idempotent (guarded by a global marker)
 * and must run before any plugin code is evaluated — the loader and the
 * module entry both call installDomAugmentation().
 *
 * Method-form `el.createEl(...)` AUTO-APPENDS to the receiver; the global
 * free function creates a DETACHED element unless `o.parent` is given.
 *
 * Deliberately deferred members (onNodeInserted / onWindowMigrated) are
 * installed as warn-stubs that record a gap instead of being left undefined.
 */
import { reportGap } from "./gaps";

const MARKER = "__geodeObsidianDomInstalled";

const SVG_NS = "http://www.w3.org/2000/svg";

/* ---------------- shared element factory ---------------- */

function splitClasses(cls: string | string[]): string[] {
  const arr = Array.isArray(cls) ? cls : [cls];
  return arr.flatMap((c) => c.split(/\s+/)).filter(Boolean);
}

function setAttrImpl(el: Element, name: string, value: string | number | boolean | null): void {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, String(value));
}

function buildEl(
  tag: string,
  o: DomElementInfo | string | undefined,
  callback: ((el: HTMLElement) => void) | undefined,
  receiver: Node | null,
): HTMLElement {
  const el = document.createElement(tag);
  const info: DomElementInfo = typeof o === "string" ? { cls: o } : o ?? {};
  if (info.cls !== undefined) el.classList.add(...splitClasses(info.cls));
  if (info.text !== undefined) {
    if (typeof info.text === "string") el.textContent = info.text;
    else el.appendChild(info.text);
  }
  if (info.attr) {
    for (const [k, v] of Object.entries(info.attr)) setAttrImpl(el, k, v);
  }
  if (info.title !== undefined) el.title = info.title;
  if (info.value !== undefined && "value" in el) (el as HTMLInputElement).value = info.value;
  if (info.type !== undefined && "type" in el) (el as HTMLInputElement).type = info.type;
  if (info.placeholder !== undefined && "placeholder" in el) {
    (el as HTMLInputElement).placeholder = info.placeholder;
  }
  if (info.href !== undefined && "href" in el) (el as HTMLAnchorElement).href = info.href;
  const target = info.parent ?? receiver;
  if (target) {
    if (info.prepend) target.insertBefore(el, target.firstChild);
    else target.appendChild(el);
  }
  callback?.(el);
  return el;
}

function buildSvg(
  tag: string,
  o: SvgElementInfo | string | undefined,
  callback: ((el: SVGElement) => void) | undefined,
  receiver: Node | null,
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  const info: SvgElementInfo = typeof o === "string" ? { cls: o } : o ?? {};
  if (info.cls !== undefined) el.classList.add(...splitClasses(info.cls));
  if (info.attr) {
    for (const [k, v] of Object.entries(info.attr)) setAttrImpl(el, k, v);
  }
  const target = info.parent ?? receiver;
  if (target) {
    if (info.prepend) target.insertBefore(el, target.firstChild);
    else target.appendChild(el);
  }
  callback?.(el);
  return el;
}

/* ---------------- installation ---------------- */

type AnyFn = (...args: never[]) => unknown;

function define(proto: object, methods: Record<string, AnyFn>): void {
  for (const [name, fn] of Object.entries(methods)) {
    Object.defineProperty(proto, name, {
      value: fn,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}

function defineGetters(proto: object, getters: Record<string, () => unknown>): void {
  for (const [name, get] of Object.entries(getters)) {
    Object.defineProperty(proto, name, { get, configurable: true, enumerable: false });
  }
}

/** bookkeeping for delegated HTMLElement.on/off listeners (_EVENTS) */
interface DelegatedListenerInfo {
  selector: string;
  listener: (this: HTMLElement, ev: Event, delegateTarget: HTMLElement) => unknown;
  options?: boolean | AddEventListenerOptions;
  wrapped: EventListener;
}

type DelegatedHost = HTMLElement & { _EVENTS?: Record<string, DelegatedListenerInfo[]> };

export function installDomAugmentation(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[MARKER]) return;
  g[MARKER] = true;

  /* ----- Array / Object / Math / String / Number statics & prototypes
   * (the official d.ts `declare global` block, lines 10-48 — suite plugins
   * call these on arbitrary values, e.g. recent-files'
   * `getEnabledFeatures().contains("explorer")`) ----- */
  define(Array.prototype, {
    first<T>(this: T[]): T | undefined {
      return this.length > 0 ? this[0] : undefined;
    },
    last<T>(this: T[]): T | undefined {
      return this.length > 0 ? this[this.length - 1] : undefined;
    },
    contains<T>(this: T[], target: T): boolean {
      return this.includes(target);
    },
    remove<T>(this: T[], target: T): void {
      for (let i = this.indexOf(target); i >= 0; i = this.indexOf(target)) this.splice(i, 1);
    },
    shuffle<T>(this: T[]): T[] {
      for (let i = this.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this[i], this[j]] = [this[j], this[i]];
      }
      return this;
    },
    unique<T>(this: T[]): T[] {
      return [...new Set(this)];
    },
  });
  define(Array as unknown as object, {
    combine<T>(arrays: T[][]): T[] {
      return ([] as T[]).concat(...arrays);
    },
  });
  define(Object, {
    isEmpty(object: Record<string, unknown>): boolean {
      for (const key in object) {
        if (Object.prototype.hasOwnProperty.call(object, key)) return false;
      }
      return true;
    },
    each<T>(
      object: Record<string, T>,
      callback: (value: T, key?: string) => boolean | void,
      context?: unknown,
    ): boolean {
      for (const [key, value] of Object.entries(object)) {
        if (callback.call(context, value, key) === false) return false;
      }
      return true;
    },
  });
  define(Math, {
    clamp(value: number, min: number, max: number): number {
      return Math.min(Math.max(value, min), max);
    },
    square(value: number): number {
      return value * value;
    },
  });
  define(String as unknown as object, {
    isString(obj: unknown): boolean {
      return typeof obj === "string";
    },
  });
  define(String.prototype, {
    contains(this: string, target: string): boolean {
      return this.includes(target);
    },
    format(this: string, ...args: string[]): string {
      return this.replace(/\{(\d+)\}/g, (m, i: string) => args[Number(i)] ?? m);
    },
  });
  define(Number as unknown as object, {
    isNumber(obj: unknown): boolean {
      return typeof obj === "number" && !Number.isNaN(obj);
    },
  });

  /* ----- Node ----- */
  define(Node.prototype, {
    detach(this: Node): void {
      this.parentNode?.removeChild(this);
    },
    empty(this: Node): void {
      while (this.firstChild) this.removeChild(this.firstChild);
    },
    appendText(this: Node, val: string): void {
      this.appendChild(document.createTextNode(val));
    },
    insertAfter<T extends Node>(this: Node, node: T, child: Node | null): T {
      return this.insertBefore(node, child ? child.nextSibling : this.firstChild);
    },
    indexOf(this: Node, other: Node): number {
      return Array.prototype.indexOf.call(this.childNodes, other);
    },
    setChildrenInPlace(this: Node, children: Node[]): void {
      while (this.firstChild) this.removeChild(this.firstChild);
      for (const child of children) this.appendChild(child);
    },
    instanceOf(this: Node, type: new (...args: never[]) => unknown): boolean {
      return this instanceof type;
    },
    createSvg(
      this: Node,
      tag: string,
      o?: SvgElementInfo | string,
      callback?: (el: SVGElement) => void,
    ): SVGElement {
      return buildSvg(tag, o, callback, this);
    },
    createEl(
      this: Node,
      tag: string,
      o?: DomElementInfo | string,
      callback?: (el: HTMLElement) => void,
    ): HTMLElement {
      return buildEl(tag, o, callback, this);
    },
    createDiv(
      this: Node,
      o?: DomElementInfo | string,
      callback?: (el: HTMLElement) => void,
    ): HTMLElement {
      return buildEl("div", o, callback, this);
    },
    createSpan(
      this: Node,
      o?: DomElementInfo | string,
      callback?: (el: HTMLElement) => void,
    ): HTMLElement {
      return buildEl("span", o, callback, this);
    },
  });

  defineGetters(Node.prototype, {
    doc(this: Node): Document {
      return this.ownerDocument ?? document;
    },
    win(this: Node): Window {
      return (this.ownerDocument ?? document).defaultView ?? window;
    },
  });

  /* ----- Element ----- */
  const findImpl = function (this: Element | DocumentFragment, selector: string): Element | null {
    return this.querySelector(selector);
  };
  const findAllImpl = function (this: Element | DocumentFragment, selector: string): Element[] {
    return Array.from(this.querySelectorAll(selector));
  };
  const findAllSelfImpl = function (this: Element, selector: string): Element[] {
    const out: Element[] = this.matches(selector) ? [this] : [];
    for (const el of Array.from(this.querySelectorAll(selector))) out.push(el);
    return out;
  };
  define(Element.prototype, {
    getText(this: Element): string {
      return this.textContent ?? "";
    },
    setText(this: Element, val: string | DocumentFragment): void {
      if (typeof val === "string") {
        this.textContent = val;
      } else {
        while (this.firstChild) this.removeChild(this.firstChild);
        this.appendChild(val);
      }
    },
    addClass(this: Element, ...classes: string[]): void {
      this.classList.add(...splitClasses(classes));
    },
    addClasses(this: Element, classes: string[]): void {
      this.classList.add(...splitClasses(classes));
    },
    removeClass(this: Element, ...classes: string[]): void {
      this.classList.remove(...splitClasses(classes));
    },
    removeClasses(this: Element, classes: string[]): void {
      this.classList.remove(...splitClasses(classes));
    },
    toggleClass(this: Element, classes: string | string[], value: boolean): void {
      for (const cls of splitClasses(classes)) this.classList.toggle(cls, value);
    },
    hasClass(this: Element, cls: string): boolean {
      return this.classList.contains(cls);
    },
    setAttr(this: Element, name: string, value: string | number | boolean | null): void {
      setAttrImpl(this, name, value);
    },
    setAttrs(this: Element, obj: Record<string, string | number | boolean | null>): void {
      for (const [k, v] of Object.entries(obj)) setAttrImpl(this, k, v);
    },
    getAttr(this: Element, name: string): string | null {
      return this.getAttribute(name);
    },
    matchParent(this: Element, selector: string, lastParent?: Element): Element | null {
      let el: Element | null = this;
      while (el) {
        if (el.matches(selector)) return el;
        if (el === lastParent) return null;
        el = el.parentElement;
      }
      return null;
    },
    getCssPropertyValue(this: Element, property: string, pseudoElement?: string): string {
      return getComputedStyle(this, pseudoElement).getPropertyValue(property);
    },
    isActiveElement(this: Element): boolean {
      return (this.ownerDocument ?? document).activeElement === this;
    },
    find: findImpl,
    findAll: findAllImpl,
    findAllSelf: findAllSelfImpl,
  });
  define(DocumentFragment.prototype, { find: findImpl, findAll: findAllImpl });

  /* ----- HTMLElement ----- */
  define(HTMLElement.prototype, {
    show(this: HTMLElement): void {
      this.style.display = "";
    },
    hide(this: HTMLElement): void {
      this.style.display = "none";
    },
    toggle(this: HTMLElement, show: boolean): void {
      this.style.display = show ? "" : "none";
    },
    onClickEvent(
      this: HTMLElement,
      listener: (this: HTMLElement, ev: MouseEvent) => unknown,
      options?: boolean | AddEventListenerOptions,
    ): void {
      this.addEventListener("click", listener as EventListener, options);
    },
    toggleVisibility(this: HTMLElement, visible: boolean): void {
      this.style.visibility = visible ? "" : "hidden";
    },
    isShown(this: HTMLElement): boolean {
      // display:none on self or an ancestor leaves offsetParent null
      // (calibrated limitation: also null for body/html and position:fixed)
      return this.isConnected && this.offsetParent !== null;
    },
    setCssStyles(this: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
      Object.assign(this.style, styles);
    },
    setCssProps(this: HTMLElement, props: Record<string, string>): void {
      for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
    },
    findAllSelf: findAllSelfImpl,
    trigger(this: HTMLElement, eventType: string): void {
      this.dispatchEvent(new Event(eventType, { bubbles: true }));
    },
    /** delegated listener: fires when the event target matches `selector` inside this element */
    on(
      this: HTMLElement,
      type: string,
      selector: string,
      listener: (this: HTMLElement, ev: Event, delegateTarget: HTMLElement) => unknown,
      options?: boolean | AddEventListenerOptions,
    ): void {
      const host = this as DelegatedHost;
      const wrapped: EventListener = (ev) => {
        const target = ev.target;
        if (!(target instanceof Element)) return;
        const match = target.closest(selector);
        if (match instanceof HTMLElement && host.contains(match)) {
          listener.call(host, ev, match);
        }
      };
      const events = (host._EVENTS ??= {});
      (events[type] ??= []).push({ selector, listener, options, wrapped });
      host.addEventListener(type, wrapped, options);
    },
    off(
      this: HTMLElement,
      type: string,
      selector: string,
      listener: (this: HTMLElement, ev: Event, delegateTarget: HTMLElement) => unknown,
      _options?: boolean | AddEventListenerOptions,
    ): void {
      const host = this as DelegatedHost;
      const list = host._EVENTS?.[type];
      if (!list) return;
      const idx = list.findIndex((i) => i.selector === selector && i.listener === listener);
      if (idx < 0) return;
      const [info] = list.splice(idx, 1);
      host.removeEventListener(type, info.wrapped, info.options);
    },
    /* deferred members — warn-stubs so the gap report stays truthful */
    onNodeInserted(this: HTMLElement, _listener: () => unknown, _once?: boolean): () => void {
      reportGap("dom", "HTMLElement.onNodeInserted", "no-op (returns a no-op destroyer)");
      return () => undefined;
    },
    onWindowMigrated(this: HTMLElement, _listener: (win: Window) => unknown): () => void {
      reportGap("dom", "HTMLElement.onWindowMigrated", "no-op (single-window host)");
      return () => undefined;
    },
  });

  defineGetters(HTMLElement.prototype, {
    innerWidth(this: HTMLElement): number {
      const s = getComputedStyle(this);
      return this.clientWidth - (parseFloat(s.paddingLeft) || 0) - (parseFloat(s.paddingRight) || 0);
    },
    innerHeight(this: HTMLElement): number {
      const s = getComputedStyle(this);
      return this.clientHeight - (parseFloat(s.paddingTop) || 0) - (parseFloat(s.paddingBottom) || 0);
    },
  });

  /* ----- SVGElement ----- */
  define(SVGElement.prototype, {
    setCssStyles(this: SVGElement, styles: Partial<CSSStyleDeclaration>): void {
      Object.assign(this.style, styles);
    },
    setCssProps(this: SVGElement, props: Record<string, string>): void {
      for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
    },
  });

  /* ----- global free functions (detached creation) ----- */
  g.createEl = (
    tag: string,
    o?: DomElementInfo | string,
    callback?: (el: HTMLElement) => void,
  ): HTMLElement => buildEl(tag, o, callback, null);
  g.createDiv = (o?: DomElementInfo | string, callback?: (el: HTMLElement) => void): HTMLElement =>
    buildEl("div", o, callback, null);
  g.createSpan = (o?: DomElementInfo | string, callback?: (el: HTMLElement) => void): HTMLElement =>
    buildEl("span", o, callback, null);
  g.createFragment = (callback?: (el: DocumentFragment) => void): DocumentFragment => {
    const frag = document.createDocumentFragment();
    callback?.(frag);
    return frag;
  };
  g.createSvg = (
    tag: string,
    o?: SvgElementInfo | string,
    callback?: (el: SVGElement) => void,
  ): SVGElement => buildSvg(tag, o, callback, null);
  g.fish = (selector: string): HTMLElement | null => document.querySelector(selector);
  g.fishAll = (selector: string): HTMLElement[] =>
    Array.from(document.querySelectorAll(selector));

  /* ----- global window/document aliases (single-window host, no popouts) ----- */
  defineGetters(g, {
    activeDocument: () => document,
    activeWindow: () => window,
  });
}
