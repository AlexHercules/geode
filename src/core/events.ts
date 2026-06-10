/** Typed event bus — the backbone for module decoupling and the plugin API. */

export interface EventMap {
  /** vault tree structure changed (create/rename/delete or vault (re)loaded) */
  "vault:changed": { reason: "load" | "create" | "rename" | "delete" | "modify" };
  /** a file's content was modified (after save) */
  "file:modified": { path: string };
  "file:created": { path: string };
  "file:deleted": { path: string };
  "file:renamed": { oldPath: string; newPath: string };
  /** metadata index finished (re)building */
  "metadata:updated": Record<string, never>;
  /** active file in workspace changed */
  "active-file:changed": { path: string | null };
  /** a workspace modal transitioned from open to closed */
  "modal:closed": Record<string, never>;
  /** an open file changed on disk OUTSIDE the app (file watcher) */
  "file:external-modified": { path: string };
  /** the vault changed on disk outside the app (tree already refreshed) */
  "vault:external-changed": { paths: string[] };
  /** theme switched */
  "theme:changed": { theme: "dark" | "light" };
}

export type EventName = keyof EventMap;
type Handler<E extends EventName> = (payload: EventMap[E]) => void;

export class EventBus {
  private handlers = new Map<EventName, Set<Handler<EventName>>>();

  on<E extends EventName>(event: E, handler: Handler<E>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<EventName>);
    return () => set!.delete(handler as Handler<EventName>);
  }

  emit<E extends EventName>(event: E, payload: EventMap[E]) {
    this.handlers.get(event)?.forEach((h) => {
      try {
        (h as Handler<E>)(payload);
      } catch (err) {
        console.error(`[events] handler for ${event} threw`, err);
      }
    });
  }
}
