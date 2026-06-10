/**
 * Ambient types for the Obsidian global DOM prototype augmentation
 * (installed at runtime by src/compat/obsidian/dom.ts).
 *
 * Shapes match .calibration/API-REFERENCE.md area 5 verbatim. The types are
 * necessarily global, but per ARCHITECTURE.md only compat code (and loaded
 * Obsidian plugins) may USE these helpers.
 */

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

interface Node {
  detach(): void;
  empty(): void;
  appendText(val: string): void;
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
  find(selector: string): Element | null;
  findAll(selector: string): HTMLElement[];
}

interface HTMLElement {
  show(): void;
  hide(): void;
  toggle(show: boolean): void;
  onClickEvent(
    this: HTMLElement,
    listener: (this: HTMLElement, ev: MouseEvent) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  find(selector: string): HTMLElement;
  findAll(selector: string): HTMLElement[];
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
