/**
 * Obsidian Events / EventRef (API-REFERENCE area 2).
 * Vault, Workspace and MetadataCache shims all extend this class.
 */

/** Opaque token returned by Events.on — consumed by offref/registerEvent. */
export interface EventRef {}

/** Internal shape behind the opaque EventRef. */
interface EventRegistration {
  owner: Events;
  name: string;
  callback: (...data: unknown[]) => unknown;
  ctx?: unknown;
}

function isRegistration(ref: EventRef): ref is EventRegistration {
  const r = ref as Partial<EventRegistration>;
  return r != null && r.owner instanceof Events && typeof r.callback === "function";
}

export class Events {
  private _handlers = new Map<string, EventRegistration[]>();

  on(name: string, callback: (...data: never[]) => unknown, ctx?: unknown): EventRef {
    const reg: EventRegistration = {
      owner: this,
      name,
      callback: callback as (...data: unknown[]) => unknown,
      ctx,
    };
    let list = this._handlers.get(name);
    if (!list) this._handlers.set(name, (list = []));
    list.push(reg);
    return reg;
  }

  off(name: string, callback: (...data: never[]) => unknown): void {
    const list = this._handlers.get(name);
    if (!list) return;
    this._handlers.set(
      name,
      list.filter((r) => r.callback !== (callback as unknown)),
    );
  }

  offref(ref: EventRef): void {
    if (!isRegistration(ref)) return;
    const list = this._handlers.get(ref.name);
    if (!list) return;
    const idx = list.indexOf(ref);
    if (idx >= 0) list.splice(idx, 1);
  }

  trigger(name: string, ...data: unknown[]): void {
    const list = this._handlers.get(name);
    if (!list || list.length === 0) return;
    // iterate over a copy — callbacks may unregister themselves during dispatch
    for (const reg of [...list]) this.tryTrigger(reg, data);
  }

  tryTrigger(evt: EventRef, args: unknown[]): void {
    if (!isRegistration(evt)) return;
    try {
      evt.callback.apply(evt.ctx, args);
    } catch (err) {
      console.error(`[obsidian-compat] event handler for "${evt.name}" threw`, err);
    }
  }
}

/** Detach an EventRef from whichever Events instance issued it. */
export function detachEventRef(ref: EventRef): void {
  if (isRegistration(ref)) ref.owner.offref(ref);
}
