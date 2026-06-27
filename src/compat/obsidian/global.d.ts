/**
 * Ambient types for the Obsidian global DOM prototype augmentation
 * (installed at runtime by src/compat/obsidian/dom.ts).
 *
 * Shapes match .calibration/API-REFERENCE.md area 5 verbatim. The types are
 * necessarily global, but per ARCHITECTURE.md only compat code (and loaded
 * Obsidian plugins) may USE these helpers.
 */

/** The all-locales bundle has no own typings — it IS moment (same instance). */
declare module "moment/min/moment-with-locales" {
  import moment from "moment";
  export = moment;
}

/** R261: js-yaml ships no own typings — minimal ambient decl for the only two functions
 *  the obsidian parseYaml/stringifyYaml wrappers use (keeps the authorization to the single
 *  RUNTIME package js-yaml; no @types/js-yaml needed). */
declare module "js-yaml" {
  export function load(input: string, options?: unknown): unknown;
  export function dump(input: unknown, options?: unknown): string;
}

interface DomElementInfo {
  /** The class to be assigned. Can be a space-separated string or an array of strings. */
  cls?: string | string[];
  /** The textContent to be assigned. */
  text?: string | DocumentFragment;
  /** HTML attributes to be added. */
  attr?: { [key: string]: string | number | boolean | null };
  /** HTML title (for hover tooltip). */
  title?: string;
  /** The parent element to be assigned to. */
  parent?: Node;
  value?: string;
  type?: string;
  prepend?: boolean;
  placeholder?: string;
  href?: string;
}

interface SvgElementInfo {
  cls?: string | string[];
  attr?: { [key: string]: string | number | boolean | null };
  parent?: Node;
  prepend?: boolean;
}

interface Node {
  detach(): void;
  empty(): void;
  insertAfter<T extends Node>(node: T, child: Node | null): T;
  indexOf(other: Node): number;
  setChildrenInPlace(children: Node[]): void;
  appendText(val: string): void;
  instanceOf(type: new (...args: never[]) => unknown): boolean;
  readonly doc: Document;
  readonly win: Window;
  /** Create an element and append it to this node (o.parent overrides the target). */
  createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    o?: DomElementInfo | string,
    callback?: (el: HTMLElementTagNameMap[K]) => void,
  ): HTMLElementTagNameMap[K];
  createDiv(o?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void): HTMLDivElement;
  createSpan(
    o?: DomElementInfo | string,
    callback?: (el: HTMLSpanElement) => void,
  ): HTMLSpanElement;
  createSvg(
    tag: string,
    o?: SvgElementInfo | string,
    callback?: (el: SVGElement) => void,
  ): SVGElement;
}

interface Element {
  getText(): string;
  setText(val: string | DocumentFragment): void;
  addClass(...classes: string[]): void;
  addClasses(classes: string[]): void;
  removeClass(...classes: string[]): void;
  removeClasses(classes: string[]): void;
  /** value is REQUIRED (unlike classList.toggle). */
  toggleClass(classes: string | string[], value: boolean): void;
  hasClass(cls: string): boolean;
  /** null removes the attribute; number/boolean are coerced to string. */
  setAttr(qualifiedName: string, value: string | number | boolean | null): void;
  setAttrs(obj: { [key: string]: string | number | boolean | null }): void;
  getAttr(qualifiedName: string): string | null;
  matchParent(selector: string, lastParent?: Element): Element | null;
  getCssPropertyValue(property: string, pseudoElement?: string): string;
  isActiveElement(): boolean;
  find(selector: string): Element | null;
  findAll(selector: string): HTMLElement[];
  findAllSelf(selector: string): HTMLElement[];
}

interface HTMLElement {
  show(): void;
  hide(): void;
  toggle(show: boolean): void;
  toggleVisibility(visible: boolean): void;
  isShown(): boolean;
  setCssStyles(styles: Partial<CSSStyleDeclaration>): void;
  setCssProps(props: Record<string, string>): void;
  readonly innerWidth: number;
  readonly innerHeight: number;
  /** delegated listener (target must match `selector` inside this element) */
  on(
    this: HTMLElement,
    type: string,
    selector: string,
    listener: (this: HTMLElement, ev: Event, delegateTarget: HTMLElement) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  off(
    this: HTMLElement,
    type: string,
    selector: string,
    listener: (this: HTMLElement, ev: Event, delegateTarget: HTMLElement) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  onClickEvent(
    this: HTMLElement,
    listener: (this: HTMLElement, ev: MouseEvent) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  /** warn-stub: records a gap and returns a no-op destroyer */
  onNodeInserted(this: HTMLElement, listener: () => unknown, once?: boolean): () => void;
  /** warn-stub: records a gap and returns a no-op destroyer */
  onWindowMigrated(this: HTMLElement, listener: (win: Window) => unknown): () => void;
  trigger(eventType: string): void;
  find(selector: string): HTMLElement;
  findAll(selector: string): HTMLElement[];
  findAllSelf(selector: string): HTMLElement[];
}

interface Document {
  /** delegated listener (target must match `selector` inside this document) */
  on(
    this: Document,
    type: string,
    selector: string,
    listener: (this: Document, ev: Event, delegateTarget: HTMLElement) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  off(
    this: Document,
    type: string,
    selector: string,
    listener: (this: Document, ev: Event, delegateTarget: HTMLElement) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

interface SVGElement {
  setCssStyles(styles: Partial<CSSStyleDeclaration>): void;
  setCssProps(props: Record<string, string>): void;
}

interface DocumentFragment {
  find(selector: string): Element | null;
  findAll(selector: string): HTMLElement[];
}

/** Global form: creates a DETACHED element unless o.parent is given. */
declare function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  o?: DomElementInfo | string,
  callback?: (el: HTMLElementTagNameMap[K]) => void,
): HTMLElementTagNameMap[K];
declare function createDiv(
  o?: DomElementInfo | string,
  callback?: (el: HTMLDivElement) => void,
): HTMLDivElement;
declare function createSpan(
  o?: DomElementInfo | string,
  callback?: (el: HTMLSpanElement) => void,
): HTMLSpanElement;
declare function createFragment(
  callback?: (el: DocumentFragment) => void,
): DocumentFragment;
declare function createSvg(
  tag: string,
  o?: SvgElementInfo | string,
  callback?: (el: SVGElement) => void,
): SVGElement;
declare function fish(selector: string): HTMLElement | null;
declare function fishAll(selector: string): HTMLElement[];
declare function sleep(ms: number): Promise<void>;
declare function nextFrame(): Promise<void>;

/** Alias of `document` (Geode is single-window; popout windows do not exist). */
declare var activeDocument: Document;
/** Alias of `window` (Geode is single-window; popout windows do not exist). */
declare var activeWindow: Window;

interface Window {
  /** The compat App shim — reassigned by the loader on every plugin reload. */
  app?: unknown;
  /** The real moment.js — installed by the compat loader before any plugin runs. */
  moment?: typeof import("moment");
  /** calendar caches its locale week spec here (plain global; unused by Geode). */
  _bundledLocaleWeekSpec?: unknown;
}
