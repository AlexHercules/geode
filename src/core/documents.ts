import { EditorState, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { EventBus } from "./events";
import { Vault } from "./vault";

/**
 * Shared document model (R4) — ONE DocumentHandle per open file, no matter how
 * many panes show it. The handle owns the canonical text, the single dirty
 * flag and the single debounced auto-save; attached CodeMirror views stay
 * byte-identical at all times. See ARCHITECTURE.md "Round 4 additions" for the
 * full behavior contract (this skeleton is replaced by the R4 implementation).
 */

export const SAVE_DEBOUNCE_MS = 600;

export class DocumentHandle {
  private refs = 0;

  constructor(
    private manager: DocumentManager,
    private currentPath: string,
    private text: string,
  ) {}

  get path(): string {
    return this.currentPath;
  }

  get dirty(): boolean {
    return false;
  }

  getText(): string {
    return this.text;
  }

  /** Build a per-view EditorState seeded with the shared doc + sync glue. */
  createViewState(extensions: Extension[]): EditorState {
    return EditorState.create({ doc: this.text, extensions });
  }

  /** Attach a view created from createViewState(); returns a disposer. */
  attachView(_view: EditorView): () => void {
    return () => {};
  }

  /** Programmatic full replace (external reload / plugin writes). Does NOT mark dirty. */
  setText(text: string): void {
    this.text = text;
  }

  async flush(): Promise<void> {}

  /** internal — refcounting used by the manager */
  retain(): void {
    this.refs++;
  }

  release(): void {
    this.refs--;
    if (this.refs <= 0) this.manager.drop(this.currentPath);
  }
}

export class DocumentManager {
  private handles = new Map<string, DocumentHandle>();
  private active: { view: EditorView; path: string } | null = null;

  constructor(
    private vault: Vault,
    private events: EventBus,
  ) {
    void this.events; // wired up by the full implementation
  }

  /** Load (or share) the document for a vault path. Refcounted: pair with release(). */
  async acquire(path: string): Promise<DocumentHandle> {
    let handle = this.handles.get(path);
    if (!handle) {
      const text = await this.vault.read(path);
      handle = new DocumentHandle(this, path, text);
      this.handles.set(path, handle);
    }
    handle.retain();
    return handle;
  }

  /** The live handle for a path, if any (sync). */
  get(path: string): DocumentHandle | null {
    return this.handles.get(path) ?? null;
  }

  /** Editor panes report the focused CM view (active markdown tab). */
  setActiveView(view: EditorView | null, path: string | null): void {
    this.active = view && path ? { view, path } : null;
  }

  /** The focused editor view — consumed by the compat Editor shim. */
  getActiveView(): { view: EditorView; path: string } | null {
    return this.active;
  }

  /** Flush every dirty document (main.tsx registers this as a workspace flusher). */
  async flushAll(): Promise<void> {
    await Promise.all([...this.handles.values()].map((h) => h.flush()));
  }

  /** internal — called by handles when their refcount hits zero */
  drop(path: string): void {
    this.handles.delete(path);
  }
}
