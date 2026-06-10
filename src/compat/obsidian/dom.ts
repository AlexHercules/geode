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
 */

const MARKER = "__geodeObsidianDomInstalled";

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

export function installDomAugmentation(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[MARKER]) return;
  g[MARKER] = true;

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

  /* ----- Element ----- */
  const findImpl = function (this: Element | DocumentFragment, selector: string): Element | null {
    return this.querySelector(selector);
  };
  const findAllImpl = function (this: Element | DocumentFragment, selector: string): Element[] {
    return Array.from(this.querySelectorAll(selector));
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
    find: findImpl,
    findAll: findAllImpl,
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
}
