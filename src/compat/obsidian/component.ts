/**
 * Obsidian Component (API-REFERENCE area 1) — base lifecycle container.
 * Everything registered via register*()/addChild() is torn down on unload().
 */
import { detachEventRef, type EventRef } from "./events";

export class Component {
  private _loaded = false;
  private _children: Component[] = [];
  private _cleanups: Array<() => unknown> = [];
  /** @internal resolves/rejects when onload (possibly async) settles — loader awaits it */
  _loadPromise: Promise<void> | null = null;

  /** 'Load this component and its children'. Framework-called; triggers onload(). */
  load(): void {
    if (this._loaded) return;
    this._loaded = true;
    const p = (async () => {
      await this.onload();
    })();
    // observed via loadComponentAsync when the caller cares; never unhandled
    p.catch(() => undefined);
    this._loadPromise = p;
    for (const child of [...this._children]) child.load();
  }

  /** @virtual — 'Override this to load your component'. Plugin widens to async. */
  onload(): void {}

  /** 'Unload this component and its children' + run every registered cleanup. */
  unload(): void {
    if (!this._loaded) return;
    this._loaded = false;
    try {
      const r = this.onunload() as unknown;
      if (r instanceof Promise) r.catch((err) => console.error("[obsidian-compat] async onunload failed", err));
    } catch (err) {
      console.error("[obsidian-compat] onunload threw", err);
    }
    for (const child of [...this._children]) child.unload();
    for (const cleanup of this._cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (err) {
        console.error("[obsidian-compat] component cleanup threw", err);
      }
    }
    this._loadPromise = null;
  }

  /** @virtual — 'Override this to unload your component'. */
  onunload(): void {}

  /** 'Adds a child component, loading it if this component is loaded'. */
  addChild<T extends Component>(component: T): T {
    this._children.push(component);
    if (this._loaded) component.load();
    return component;
  }

  /** 'Removes a child component, unloading it'. */
  removeChild<T extends Component>(component: T): T {
    const idx = this._children.indexOf(component);
    if (idx >= 0) this._children.splice(idx, 1);
    component.unload();
    return component;
  }

  /** 'Registers a callback to be called when unloading'. */
  register(cb: () => unknown): void {
    this._cleanups.push(cb);
  }

  /** 'Registers an event to be detached when unloading'. */
  registerEvent(eventRef: EventRef): void {
    this.register(() => detachEventRef(eventRef));
  }

  /** 'Registers a DOM event to be detached when unloading'. */
  registerDomEvent<K extends keyof WindowEventMap>(
    el: Window,
    type: K,
    callback: (this: HTMLElement, ev: WindowEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  registerDomEvent<K extends keyof DocumentEventMap>(
    el: Document,
    type: K,
    callback: (this: HTMLElement, ev: DocumentEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  registerDomEvent<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    callback: (this: HTMLElement, ev: HTMLElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  registerDomEvent(
    el: EventTarget,
    type: string,
    callback: (...args: never[]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void {
    el.addEventListener(type, callback as EventListener, options);
    this.register(() => el.removeEventListener(type, callback as EventListener, options));
  }

  /** 'Registers an interval (from setInterval) to be cancelled when unloading'. */
  registerInterval(id: number): number {
    this.register(() => window.clearInterval(id));
    return id;
  }
}

/** Load a component and await its (possibly async) onload; rethrows failures. */
export async function loadComponentAsync(component: Component): Promise<void> {
  component.load();
  if (component._loadPromise) await component._loadPromise;
}
