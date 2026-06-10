import { history, historyKeymap, redo, undo } from "@codemirror/commands";
import {
  Annotation,
  Compartment,
  EditorState,
  Facet,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { EventBus } from "./events";
import { Store } from "./store";
import { Vault } from "./vault";

/**
 * Shared document model (R4) — ONE DocumentHandle per open file, no matter how
 * many panes show it. The handle owns the canonical text, the single dirty
 * flag and the single debounced auto-save; attached CodeMirror views stay
 * byte-identical at all times. See ARCHITECTURE.md "Round 4 additions" for the
 * full behavior contract.
 *
 * Multi-view sync follows the official CodeMirror split-view example
 * (https://codemirror.net/examples/split/): per-view EditorState, a sync
 * annotation marking forwarded transactions, doc changes forwarded between
 * views (carrying the userEvent annotation along). Like the example, exactly
 * ONE view holds the undo history; the other views bind Mod-z / Mod-y to
 * undo/redo on that "history host" so undo from any view never desyncs the
 * shared document.
 */

export const SAVE_DEBOUNCE_MS = 600;

/** Marks transactions produced by the sync glue (forwarded changes, external
 *  reloads, setText). They are never re-forwarded and never mark dirty. */
const syncAnnotation = Annotation.define<boolean>();

/** Lets attachView() find the per-view history compartment created by
 *  createViewState() so the history host can be (re)assigned dynamically. */
const historyCompartmentFacet = Facet.define<Compartment>();

/** What the history-host view runs (the one undo history per document). */
const hostHistoryExtensions: Extension = [history(), keymap.of(historyKeymap)];

export class DocumentHandle {
  private refs = 0;
  private currentPath: string;
  private text: string;

  /** all CM views currently showing this document */
  private views = new Set<EditorView>();
  /** the single view holding the undo history (split-view example pattern) */
  private historyHost: EditorView | null = null;

  /* one dirty flag + one debounced save per FILE, regardless of pane count */
  private dirtyFlag = false;
  private timer: number | null = null;
  /** true while a vault.modify is in flight — reloads must treat this as dirty */
  private saving = false;

  /** Bumped on every text change (local edit, sync, external reload). Preview
   *  panes (no CM view) subscribe to re-render from getText(). */
  readonly revision = new Store<number>(0);

  /** Non-host views delegate undo/redo to the history host so there is one
   *  undo history per document (mirrors the official split example, which
   *  binds Mod-z/Mod-y in the secondary view to undo/redo on the main view). */
  private readonly delegateHistoryKeymap: Extension = keymap.of([
    { key: "Mod-z", run: () => this.runOnHistoryHost(undo), preventDefault: true },
    {
      key: "Mod-y",
      mac: "Mod-Shift-z",
      run: () => this.runOnHistoryHost(redo),
      preventDefault: true,
    },
    { key: "Mod-Shift-z", run: () => this.runOnHistoryHost(redo), preventDefault: true },
  ]);

  /**
   * Sync glue, included in every state built by createViewState(): forwards
   * doc changes from the origin view to every other attached view (annotated
   * so receivers do not re-forward), keeps the canonical text current and
   * schedules the single debounced auto-save for local (non-sync) changes.
   */
  private readonly syncExtension: Extension = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    let local = false;
    for (const tr of update.transactions) {
      if (tr.changes.empty || tr.annotation(syncAnnotation)) continue;
      local = true;
      for (const other of this.views) {
        if (other === update.view) continue;
        const userEvent = tr.annotation(Transaction.userEvent);
        other.dispatch({
          changes: tr.changes,
          annotations:
            userEvent !== undefined
              ? [syncAnnotation.of(true), Transaction.userEvent.of(userEvent)]
              : [syncAnnotation.of(true)],
        });
      }
    }
    // receivers run this too (nested, synchronously) — same content, harmless
    this.text = update.state.doc.toString();
    if (local) {
      this.scheduleSave();
      this.revision.update((r) => r + 1);
    }
  });

  constructor(
    private manager: DocumentManager,
    private vault: Vault,
    path: string,
    text: string,
  ) {
    this.currentPath = path;
    this.text = text;
  }

  /** live — retargeted in place on rename */
  get path(): string {
    return this.currentPath;
  }

  /** true while unsaved changes exist OR a save is in flight */
  get dirty(): boolean {
    return this.dirtyFlag || this.saving;
  }

  getText(): string {
    return this.text;
  }

  /** Build a per-view EditorState seeded with the shared doc + sync glue. */
  createViewState(extensions: Extension[]): EditorState {
    const compartment = new Compartment();
    return EditorState.create({
      doc: this.text,
      extensions: [
        historyCompartmentFacet.of(compartment),
        // starts as a delegate; attachView() promotes one view to history host
        compartment.of(this.delegateHistoryKeymap),
        this.syncExtension,
        extensions,
      ],
    });
  }

  /** Attach a view created from createViewState(); returns a disposer. */
  attachView(view: EditorView): () => void {
    if (this.views.has(view)) return () => {};
    this.views.add(view);
    if (!this.historyHost) this.promoteHistoryHost(view);
    return () => {
      if (!this.views.delete(view)) return;
      if (this.historyHost === view) {
        this.historyHost = null;
        const next = this.views.values().next().value as EditorView | undefined;
        if (next) this.promoteHistoryHost(next);
      }
    };
  }

  /**
   * Programmatic full replace (external reload / plugin writes). Does NOT
   * mark dirty: every attached view is replaced with a sync-annotated
   * transaction (cursor clamped, scroll preserved by CM).
   */
  setText(text: string): void {
    if (text === this.text) return;
    this.applyReplace(text);
  }

  /** Flush any pending edit. Awaitable so close-time flushing covers IPC. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirtyFlag) return;
    this.dirtyFlag = false;
    // never resurrect a file that was deleted while the edit was pending
    if (!this.vault.fileExists(this.currentPath)) return;
    // read the path at flush time (NOT at timer-set time): the file:renamed
    // handler retargets it, so late flushes hit the live path
    const path = this.currentPath;
    const written = this.text;
    this.saving = true;
    try {
      await this.vault.modify(path, written);
    } catch (err) {
      console.error(`[documents] failed to save ${path}`, err);
      // write failed and the user hasn't typed since (no newer pending
      // content) — restore dirty so the next flush/auto-save retries
      if (this.text === written) this.dirtyFlag = true;
    } finally {
      this.saving = false;
    }
  }

  /** internal — refcounting used by the manager */
  retain(): void {
    this.refs++;
  }

  release(): void {
    this.refs--;
    if (this.refs > 0) return;
    // Deferred drop: a synchronous re-acquire (rename retarget re-running the
    // pane effect, StrictMode double-invoked effects) keeps the handle — and
    // its attached views, undo history, cursor and scroll — alive.
    queueMicrotask(() => {
      if (this.refs > 0) return;
      this.manager.drop(this.currentPath, this);
      void this.flush(); // last holder gone — persist any pending edit now
    });
  }

  /* ---------- internal: manager-routed vault events ---------- */

  /** file:renamed — retarget in place; attached views are NOT rebuilt. */
  retarget(newPath: string): void {
    this.currentPath = newPath;
  }

  /** file:deleted — cancel pending saves; a deleted file is never resurrected. */
  handleDeleted(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.dirtyFlag = false;
  }

  /**
   * file:external-modified / file:modified — re-read from disk and replace,
   * but ONLY while clean (an in-flight save counts as dirty). Our own save
   * echoes back as file:modified with identical content → equality no-op,
   * so there is no reload loop. `source` controls warning noise: own-save
   * echoes routinely race fresh keystrokes, so only genuinely external skips
   * are worth logging.
   */
  reloadFromDisk(source: "external" | "modified"): void {
    if (this.dirtyFlag || this.timer !== null || this.saving) {
      // local edits pending — last writer wins, our save will overwrite
      if (source === "external") {
        console.warn(
          `[documents] external change to "${this.currentPath}" ignored: unsaved local edits`,
        );
      }
      return;
    }
    const path = this.currentPath;
    void this.vault.read(path).then(
      (text) => {
        if (path !== this.currentPath) return; // renamed during the read — stale
        // re-check with FRESH state: keystrokes may have arrived during the
        // async read — never revert them with stale disk content
        if (this.dirtyFlag || this.timer !== null || this.saving) {
          if (source === "external") {
            console.warn(
              `[documents] external reload of "${path}" skipped: local edits arrived during read`,
            );
          }
          return;
        }
        if (text === this.text) return; // already in sync (e.g. our own write echoed back)
        this.applyReplace(text);
      },
      (err: unknown) => {
        console.error(`[documents] failed to reload "${path}" from disk`, err);
      },
    );
  }

  /* ---------- private ---------- */

  private runOnHistoryHost(cmd: (target: EditorView) => boolean): boolean {
    return this.historyHost ? cmd(this.historyHost) : false;
  }

  private promoteHistoryHost(view: EditorView): void {
    this.historyHost = view;
    const compartment = view.state.facet(historyCompartmentFacet)[0];
    if (!compartment) {
      console.warn(
        `[documents] view for "${this.currentPath}" was not created via createViewState — undo history unavailable`,
      );
      return;
    }
    view.dispatch({ effects: compartment.reconfigure(hostHistoryExtensions) });
  }

  private scheduleSave(): void {
    this.dirtyFlag = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Replace the document everywhere with a sync-annotated transaction. */
  private applyReplace(text: string): void {
    for (const view of this.views) {
      // keep the cursor near its old spot (clamped to the new length)
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: head },
        annotations: [syncAnnotation.of(true)],
      });
    }
    this.text = text; // also covers the zero-views case
    this.revision.update((r) => r + 1);
  }
}

export class DocumentManager {
  private handles = new Map<string, DocumentHandle>();
  /** in-flight loads, deduped so concurrent acquires share one handle */
  private pending = new Map<string, Promise<DocumentHandle>>();
  private active: { view: EditorView; path: string } | null = null;

  constructor(
    private vault: Vault,
    private events: EventBus,
  ) {
    this.events.on("file:renamed", ({ oldPath, newPath }) => this.handleRenamed(oldPath, newPath));
    this.events.on("file:deleted", ({ path }) => {
      for (const [key, handle] of this.handles) {
        if (key === path || key.startsWith(path + "/")) handle.handleDeleted();
      }
    });
    this.events.on("file:external-modified", ({ path }) =>
      this.handles.get(path)?.reloadFromDisk("external"),
    );
    // NOTE: external changes emit BOTH events (vault re-uses the reindex
    // pipeline); the second reload no-ops via the content equality check.
    this.events.on("file:modified", ({ path }) =>
      this.handles.get(path)?.reloadFromDisk("modified"),
    );
  }

  /** Load (or share) the document for a vault path. Refcounted: pair with release(). */
  async acquire(path: string): Promise<DocumentHandle> {
    const existing = this.handles.get(path);
    if (existing) {
      // synchronous retain — cancels any drop scheduled by a release() that
      // happened earlier in the same task (rename retarget, StrictMode)
      existing.retain();
      return existing;
    }
    let load = this.pending.get(path);
    if (!load) {
      load = this.vault
        .read(path)
        .then((text) => {
          let handle = this.handles.get(path);
          if (!handle) {
            handle = new DocumentHandle(this, this.vault, path, text);
            this.handles.set(path, handle);
          }
          return handle;
        })
        .finally(() => {
          this.pending.delete(path);
        });
      this.pending.set(path, load);
    }
    const handle = await load;
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

  /** internal — called by handles when their refcount stays at zero */
  drop(path: string, handle?: DocumentHandle): void {
    if (handle && this.handles.get(path) !== handle) return; // re-keyed/replaced
    this.handles.delete(path);
  }

  /** file:renamed — re-key the handle map and retarget handles in place. */
  private handleRenamed(oldPath: string, newPath: string): void {
    const remap = (p: string): string | null =>
      p === oldPath
        ? newPath
        : p.startsWith(oldPath + "/")
          ? newPath + p.slice(oldPath.length)
          : null;
    for (const [key, handle] of [...this.handles]) {
      const next = remap(key);
      if (next === null) continue;
      this.handles.delete(key);
      this.handles.set(next, handle);
      handle.retarget(next);
    }
    if (this.active) {
      const next = remap(this.active.path);
      if (next !== null) this.active = { view: this.active.view, path: next };
    }
  }
}
