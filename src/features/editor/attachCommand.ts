/**
 * R209: editor:attach-file (Obsidian "Insert attachment") — pick a file, import
 * it into the vault attachment folder, and insert an `![[linktext]]` embed at the
 * cursor. Reuses R17's vetted ingestion: a `<input type="file">` yields the same
 * `File` object the paste/drop handlers consume, so importAttachment + ingestFiles
 * (with their data-safety guardrails: doc-identity stale check, isConnected,
 * uniquePath serialization) carry the write. We deliberately use `<input>` rather
 * than the Tauri native dialog — the dialog returns a vault-EXTERNAL absolute path
 * that no existing command can read (vault_read_binary is safe_join-restricted),
 * which would need a new Rust command + dep (硬边界#5); `<input>` works in both
 * WKWebView and the browser with a single code path.
 *
 * The picker is LONG-async (the user may take seconds to choose), so the change
 * handler re-fetches the active view + path FRESH — a closure captured at trigger
 * time would target a stale document/offset if the user switched files meanwhile
 * (the same async-reads-fresh-state discipline as one-shot Store consumers).
 */
import type { EditorView } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { t } from "@core/i18n";
import { ingestFiles } from "./attachments";

interface ActiveView {
  view: EditorView;
  path: string;
}

export function registerAttachCommand(app: GeodeApp, getActive: () => ActiveView | null): Array<() => void> {
  return [
    app.commands.register({
      id: "editor:attach-file",
      name: () => t("cmd.attachFile"),
      available: () => getActive() !== null,
      callback: () => {
        if (!getActive()) return;
        const input = document.createElement("input");
        input.type = "file";
        input.style.display = "none";
        input.setAttribute("data-testid", "attach-file-input");
        input.addEventListener("change", () => {
          const files = Array.from(input.files ?? []);
          input.remove();
          if (files.length === 0) return; // cancelled / no file
          // re-fetch the active view + path AFTER the async picker (see header)
          const active = getActive();
          if (!active) return;
          const sel = active.view.state.selection.main;
          const pending = files.map((file) => ({ file, name: file.name }));
          void ingestFiles(app, () => active.path, active.view, pending, sel.from, sel.to);
        });
        // a cancelled picker fires no `change` — remove the orphaned input on
        // `cancel` (best-effort; modern WKWebView/Chromium) so it can't accumulate
        input.addEventListener("cancel", () => input.remove());
        document.body.appendChild(input);
        input.click();
      },
    }),
  ];
}
