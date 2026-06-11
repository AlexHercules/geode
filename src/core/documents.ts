import { history, historyField, historyKeymap, redo, undo } from "@codemirror/commands";
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
  /** non-null while a vault.modify is in flight — reloads treat it as dirty,
   *  and flush() JOINS it so "flushed" really means "on disk" (R16 fix) */
  private savePromise: Promise<void> | null = null;

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
    if (!update.docChanged) {
      // Pure cursor motion (R9): selection moved with no doc change. Sync-
      // annotated transactions (setText / external reload / forwarded changes)
      // never emit — only user-driven motion does. One emit per update.
      if (
        update.selectionSet &&
        !update.transactions.some((tr) => tr.annotation(syncAnnotation))
      ) {
        this.events.emit("document:selection-changed", { path: this.currentPath });
      }
      return;
    }
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
    // Canonical text is materialized ONCE per user edit, from the ORIGIN
    // view's post-transaction state. Receivers only ever see sync-annotated
    // transactions (local stays false) and must not re-toString: with N panes
    // on a large note that would cost N full O(doc) rope→string flattenings
    // per keystroke. Non-local replaces (setText/reload) set this.text in
    // applyReplace directly.
    if (local) {
      this.text = update.state.doc.toString();
      this.scheduleSave();
      this.revision.update((r) => r + 1);
      // Per-transaction editor signal (R5): ONE emit per update with local doc
      // changes, after forwarding to the other views. Sync-annotated replaces
      // (setText / external reload) keep `local` false and never emit.
      this.events.emit("document:changed", { path: this.currentPath });
    }
  });

  constructor(
    private manager: DocumentManager,
    private vault: Vault,
    private events: EventBus,
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
    return this.dirtyFlag || this.savePromise !== null;
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
        if (next) {
          // Transplant the undo history to the new host: this disposer runs
          // BEFORE view.destroy() (EditorPane cleanup order), so the detaching
          // host's state is still readable. Without this, promoting would
          // create a fresh empty history and silently wipe every undo step.
          this.promoteHistoryHost(next, view.state.field(historyField, false));
        }
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

  /**
   * Apply programmatic edits AS A LOCAL EDIT (R16 link rewrite): single CM
   * transaction on an attached view — NOT sync-annotated, so the sync glue
   * treats it exactly like typing (forwards to the other views, materializes
   * the canonical text, marks dirty, schedules the debounced save, lands the
   * undo step in the shared history and emits document:changed). Zero
   * attached views (preview-only / background tab) → splice text directly +
   * mark dirty + schedule save + bump revision. `edits` are sorted ascending
   * by `from` and non-overlapping (caller guarantee).
   */
  applyExternalEdits(edits: Array<{ from: number; to: number; insert: string }>): void {
    if (edits.length === 0) return;
    const view = this.views.values().next().value as EditorView | undefined;
    if (view) {
      // Offset-basis guard (R16 review, critical): edit offsets were computed
      // against getText() — they are only valid for the view if the canonical
      // text and the CM doc are byte-identical. Vault.read normalizes CRLF→LF
      // so they always should be; if they ever diverge (unknown future path),
      // throwing here turns a silent mis-splice into a skip+report upstream.
      if (view.state.doc.toString() !== this.text) {
        throw new Error(
          `canonical text / editor buffer mismatch for "${this.currentPath}" — refusing to splice`,
        );
      }
      // one transaction: CM resolves every change position against the
      // PRE-transaction doc, so ascending offsets need no manual shifting
      view.dispatch({ changes: edits });
      return;
    }
    // no views to dispatch on — splice in reverse so earlier offsets never drift
    let text = this.text;
    for (let i = edits.length - 1; i >= 0; i--) {
      const e = edits[i];
      text = text.slice(0, e.from) + e.insert + text.slice(e.to);
    }
    this.text = text;
    this.scheduleSave();
    this.revision.update((r) => r + 1);
  }

  /** Flush any pending edit. Awaitable so close-time flushing covers IPC.
   *  R16 review fix: JOINS an in-flight save before deciding there is nothing
   *  to do — without that, flushAll()'s "buffers are on disk now" guarantee
   *  was void for a document whose debounce timer had just fired (flush saw
   *  dirtyFlag already false and returned while the write was mid-IPC). */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    // join the in-flight save (loop: a newer save may start while we await)
    while (this.savePromise !== null) {
      try {
        await this.savePromise;
      } catch {
        /* the saver logs its own failure */
      }
    }
    if (!this.dirtyFlag) return;
    this.dirtyFlag = false;
    // never resurrect a file that was deleted while the edit was pending
    if (!this.vault.fileExists(this.currentPath)) return;
    // read the path at flush time (NOT at timer-set time): the file:renamed
    // handler retargets it, so late flushes hit the live path
    const path = this.currentPath;
    const written = this.text;
    // definite-assignment assertion: the finally only runs after the first
    // await inside the IIFE, by which time `save` is assigned
    let save!: Promise<void>;
    save = (async () => {
      try {
        await this.vault.modify(path, written);
      } catch (err) {
        console.error(`[documents] failed to save ${path}`, err);
        // write failed and the user hasn't typed since (no newer pending
        // content) — restore dirty so the next flush/auto-save retries
        if (this.text === written) this.dirtyFlag = true;
      } finally {
        // identity-guarded: never clear a NEWER save's promise
        if (this.savePromise === save) this.savePromise = null;
      }
    })();
    this.savePromise = save;
    await save;
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
      // R16 review fix (type-then-close race): the handle must stay
      // DISCOVERABLE until its final flush settles. Dropping first opened a
      // window where the rewrite engine saw documents.get() === null, read a
      // stale cache snapshot and raced the close-flush last-writer-wins.
      void this.flush().finally(() => {
        if (this.refs <= 0) this.manager.drop(this.currentPath, this);
      });
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
   * vault:changed reason "load" — the vault ROOT switched (or reloaded).
   * Handles are keyed by vault-RELATIVE path, which collides across vaults,
   * so cached text must never survive the switch (mirrors Vault.load()
   * clearing its contentCache). openVaultFlow flushes every document BEFORE
   * re-pointing the adapter, so anything still dirty here raced the switch
   * and belongs to the OLD vault — writing it would corrupt the new vault's
   * file, so it is dropped, never saved.
   *
   * Returns true when the handle is unreferenced and the manager should
   * remove it (so the next acquire() always fresh-reads). Retained handles
   * (surviving tabs/panes) are reloaded with the NEW vault's content when the
   * path exists there; when it does not, the stale text stays visible but can
   * never be written back — flush()'s fileExists no-resurrect guard blocks
   * every save for a path missing from the new tree.
   */
  handleVaultLoad(): boolean {
    this.handleDeleted(); // cancel timer + dirty — old-vault edits never cross the switch
    if (this.refs <= 0) return true;
    if (this.vault.fileExists(this.currentPath)) this.reloadFromDisk("modified");
    return false;
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
    if (this.dirtyFlag || this.timer !== null || this.savePromise !== null) {
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
        if (this.dirtyFlag || this.timer !== null || this.savePromise !== null) {
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

  /**
   * `savedHistory` (the previous host's historyField value, captured in the
   * detach disposer) seeds the newly-added field via historyField.init():
   * history() and init() reference the SAME StateField instance, so the
   * extensions dedupe and the init facet only overrides the create function —
   * undo/redo entries survive the host handoff. All views are byte-identical,
   * so the transplanted entries apply cleanly to the new host's doc.
   */
  private promoteHistoryHost(view: EditorView, savedHistory?: unknown): void {
    this.historyHost = view;
    const compartment = view.state.facet(historyCompartmentFacet)[0];
    if (!compartment) {
      console.warn(
        `[documents] view for "${this.currentPath}" was not created via createViewState — undo history unavailable`,
      );
      return;
    }
    view.dispatch({
      effects: compartment.reconfigure([
        savedHistory !== undefined ? historyField.init(() => savedHistory) : [],
        hostHistoryExtensions,
      ]),
    });
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
  /** bumped on every vault (re)load — in-flight reads from the OLD vault
   *  detect the switch and re-read instead of seeding stale content */
  private generation = 0;
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
    // Vault root switched/reloaded: relative paths collide across vaults, so
    // every cached handle is invalidated (see DocumentHandle.handleVaultLoad).
    this.events.on("vault:changed", ({ reason }) => {
      if (reason !== "load") return;
      this.generation++;
      this.pending.clear(); // old-vault loads must not be shared; they re-read via the generation guard
      for (const [path, handle] of [...this.handles]) {
        if (handle.handleVaultLoad()) this.handles.delete(path);
      }
    });
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
      const startGen = this.generation;
      load = this.vault
        .read(path)
        .then(async (text) => {
          // vault switched while the read was in flight — re-read so the
          // handle is seeded with the CURRENT vault's content, never stale
          let gen = startGen;
          while (gen !== this.generation) {
            gen = this.generation;
            text = await this.vault.read(path);
          }
          let handle = this.handles.get(path);
          if (!handle) {
            handle = new DocumentHandle(this, this.vault, this.events, path, text);
            this.handles.set(path, handle);
          }
          return handle;
        })
        .finally(() => {
          // identity-guarded: a vault switch cleared pending and a NEW load
          // may already occupy this key — never delete someone else's entry
          if (this.pending.get(path) === load) this.pending.delete(path);
        });
      this.pending.set(path, load);
    }
    const handle = await load;
    // a vault switch may have dropped the handle from the map between the
    // load resolving and this continuation running — acquire afresh
    if (this.handles.get(path) !== handle) return this.acquire(path);
    handle.retain();
    return handle;
  }

  /** The live handle for a path, if any (sync). */
  get(path: string): DocumentHandle | null {
    return this.handles.get(path) ?? null;
  }

  /** Snapshot of every path that currently has a live handle. */
  getOpenPaths(): string[] {
    return [...this.handles.keys()];
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
