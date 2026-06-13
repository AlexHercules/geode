/**
 * Fold capture extension (R29 — 折叠持久化 / Fold persistence).
 *
 * CAPTURE-ONLY ViewPlugin: snapshots the editor's folded ranges to localStorage
 * (via core/foldStore) so fold state survives preview↔editor round-trips and
 * tab close/reopen. Restore happens in EditorPane (mount effect, after view
 * attach) — this extension never restores.
 *
 * Save is debounced (400ms) on fold/unfold effects and FLUSHED synchronously on
 * destroy() — destroy is the critical flush for the two loss points (preview↔
 * editor reconfigure rebuild + tab close). foldEffect/unfoldEffect transactions
 * carry no docChanged, so this never triggers autosave / marks the doc dirty.
 *
 * See ARCHITECTURE.md "Round 29 additions" (frozen contract).
 */
import { foldEffect, unfoldEffect } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { foldInfoFromState, saveFoldInfo } from "@core/foldStore";

const DEBOUNCE_MS = 400;

export function foldPersistence(getPath: () => string): Extension {
  return ViewPlugin.fromClass(
    class {
      private timer: number | null = null;

      constructor(private readonly view: EditorView) {}

      update(u: ViewUpdate) {
        const foldChanged = u.transactions.some((tr) =>
          tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)),
        );
        if (!foldChanged) return;
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          this.timer = null;
          saveFoldInfo(getPath(), foldInfoFromState(this.view.state));
        }, DEBOUNCE_MS);
      }

      destroy() {
        if (this.timer !== null) window.clearTimeout(this.timer);
        // critical synchronous flush: covers preview↔editor / tab-close loss points
        saveFoldInfo(getPath(), foldInfoFromState(this.view.state));
      }
    },
  );
}
