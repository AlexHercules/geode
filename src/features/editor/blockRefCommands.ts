/**
 * R77 block-reference commands (㊴) — "Copy link to block" / "Copy block as
 * embed". Mints a `^id` on the cursor's paragraph (if absent) and copies
 * `[[Note#^id]]` / `![[Note#^id]]` to the clipboard.
 *
 * Layering: features/editor may import core + app/AppContext. The pure minting
 * lives in core/blockId.ts; this module bridges it to a live EditorView. The
 * `^id` write goes through the normal CM transaction → documents dirty → autosave
 * pipeline (NO new vault write path — inherits the B-class write guards), and
 * `getView` resolves the ACTIVE-FILE view only, so it can never mutate a
 * background file (R23 DS-1).
 */
import { EditorView } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { blockRefAt } from "@core/blockId";
import { t } from "@core/i18n";
import { formatLink } from "@core/linkFormat";

function showBlockNotice(message: string): void {
  document.querySelector(".block-ref-notice")?.remove();
  const el = document.createElement("div");
  el.className = "block-ref-notice";
  el.textContent = message;
  el.setAttribute("data-testid", "block-ref-notice");
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 3000);
}

/** Mint (or reuse) the cursor block's id and copy a link/embed to it. */
export async function copyBlockRef(app: GeodeApp, view: EditorView, embed: boolean): Promise<void> {
  const path = app.workspace.getActiveFile();
  if (!path) return;
  const result = blockRefAt(view.state.doc.toString(), view.state.selection.main.head);
  if (!result) {
    showBlockNotice(t("blockRef.noBlock"));
    return;
  }
  if (result.edit) {
    view.dispatch({ changes: result.edit, userEvent: "input.blockid" });
  }
  // R77 review: build the link through formatLink (single source of truth) so it
  // is resolve-back-verified (a duplicate basename degrades to the full path),
  // unsafe-char-guarded (`] # | ^` in the filename → null), and honors the
  // link-format setting — never a hardcoded `[[basename]]` that breaks elsewhere.
  const link = formatLink(app.metadata, path, path, { embed, subpath: "^" + result.id });
  if (link === null) {
    showBlockNotice(t("blockRef.noSafeLink"));
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    /* clipboard unavailable (headless / denied) — the id is still minted */
  }
  showBlockNotice(t("blockRef.copied", { link }));
}

/** Register the two block-reference commands. `getView` returns the active-FILE
 *  editor view or null (App passes `() => getActiveFileEditorView(app)?.view`).
 *  Returns disposers for the registration effect cleanup. */
export function registerBlockRefCommands(
  app: GeodeApp,
  getView: () => EditorView | null,
): Array<() => void> {
  const make = (id: string, nameKey: "cmd.copyBlockLink" | "cmd.copyBlockEmbed", embed: boolean) =>
    app.commands.register({
      id,
      name: () => t(nameKey),
      available: () => getView() !== null,
      callback: () => {
        const view = getView();
        if (!view) return;
        void copyBlockRef(app, view, embed);
        view.focus();
      },
    });
  return [
    make("editor:copy-block-link", "cmd.copyBlockLink", false),
    make("editor:copy-block-embed", "cmd.copyBlockEmbed", true),
  ];
}
