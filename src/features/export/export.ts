/**
 * Note export (R7): active note → standalone HTML file, or the print dialog
 * (desktop WebView2 includes "Microsoft Print to PDF" — that IS the PDF path,
 * no extra dependency).
 *
 * The exported document is fully self-contained: inline <style> from
 * export.css (light, print-friendly, theme-independent), no scripts —
 * wikilinks become non-navigating styled text (href="#").
 */
import type { GeodeApp } from "@app/AppContext";
import { saveTextFile } from "@core/export";
import { renderMarkdownToHtml } from "@core/markdown";
import exportCss from "./export.css?raw";
import "./notice.css";

/** How long the print root may outlive a print dialog whose `afterprint`
 *  never fires (stubbed print in browser E2E, odd WebView behavior). */
const PRINT_CLEANUP_TIMEOUT_MS = 120_000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The export is a read-only document — render every task checkbox disabled.
 *  Matches the exact markup core/markdown.ts emits for task list items. */
function disableTaskCheckboxes(bodyHtml: string): string {
  return bodyHtml.replaceAll('class="task-checkbox"', 'class="task-checkbox" disabled');
}

/** "folder/Note.md" → "Note" — display title / suggested file basename. */
function noteTitle(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}

export interface StandaloneHtmlOptions {
  title: string;
  bodyHtml: string;
}

/**
 * Wrap rendered note HTML in a complete standalone document: title, charset,
 * inline <style> (export.css via Vite `?raw`), disabled task checkboxes.
 */
export function buildStandaloneHtml({ title, bodyHtml }: StandaloneHtmlOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${exportCss}
</style>
</head>
<body class="geode-export">
<article class="geode-export-body">
${disableTaskCheckboxes(bodyHtml)}
</article>
</body>
</html>
`;
}

/** Render the active note for export. Returns null when no file is active
 *  (commands are `available`-guarded, but a race is still possible). */
async function renderActiveNote(
  app: GeodeApp,
): Promise<{ title: string; bodyHtml: string } | null> {
  const path = app.workspace.getActiveFile();
  if (path === null) return null;
  // the live document buffer first: vault.read returns the last SAVED content,
  // and the 600ms save debounce means an export right after typing would
  // silently miss the latest edits
  const content = app.documents.get(path)?.getText() ?? (await app.vault.read(path));
  const bodyHtml = renderMarkdownToHtml(content, (target) =>
    app.metadata.resolveLink(target, path),
  );
  return { title: noteTitle(path), bodyHtml };
}

/** Transient feedback toast — export results must be visible to the user
 *  (a failed disk write would otherwise die as an unhandled rejection). */
function showExportNotice(message: string, isError = false): void {
  document.querySelector(".export-notice")?.remove();
  const el = document.createElement("div");
  el.className = isError ? "export-notice is-error" : "export-notice";
  el.textContent = message;
  el.setAttribute("data-testid", "export-notice");
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), isError ? 8000 : 4000);
}

/** Export the active note as a standalone HTML file via the save dialog
 *  (desktop) or a download (browser). Never rejects — failures surface as a
 *  visible notice (callers fire-and-forget from command callbacks). */
export async function exportActiveNoteHtml(app: GeodeApp): Promise<void> {
  try {
    const note = await renderActiveNote(app);
    if (!note) return;
    const html = buildStandaloneHtml(note);
    const result = await saveTextFile(html, {
      suggestedName: `${note.title}.html`,
      filterName: "HTML",
      extensions: ["html"],
    });
    if (result === "saved") showExportNotice(`Exported "${note.title}.html"`);
  } catch (err) {
    console.error("[export] HTML export failed", err);
    showExportNotice(`Export failed: ${String(err)}`, true);
  }
}

/**
 * Print the active note (PDF export path): the rendered note goes into a
 * `#geode-print-root` appended to <body>; `@media print` hides `#root` and
 * shows only the print root; cleanup on `afterprint` plus a safety timeout.
 * `window.__geodeLastPrintHtml` is a dev/E2E probe set before `window.print()`
 * (browser E2E may stub `print`, so `afterprint` is not guaranteed).
 */
/** The pending print's cleanup — a second print must settle the first one
 *  (listener, timer, title restore), not just remove its DOM. */
let pendingPrintCleanup: (() => void) | null = null;

export async function printActiveNote(app: GeodeApp): Promise<void> {
  let note: { title: string; bodyHtml: string } | null;
  try {
    note = await renderActiveNote(app);
  } catch (err) {
    console.error("[export] print render failed", err);
    showExportNotice(`Print failed: ${String(err)}`, true);
    return;
  }
  if (!note) return;

  // settle a previous print that never cleaned up (afterprint not guaranteed):
  // restores document.title and unhooks its listener/timer, then DOM fallback
  pendingPrintCleanup?.();
  document.getElementById("geode-print-root")?.remove();
  document.getElementById("geode-print-style")?.remove();

  const style = document.createElement("style");
  style.id = "geode-print-style";
  style.textContent = `${exportCss}
@media screen {
  #geode-print-root { display: none; }
}
@media print {
  #root { display: none !important; }
  #geode-print-root { display: block; }
}
`;
  const printRoot = document.createElement("div");
  printRoot.id = "geode-print-root";
  printRoot.className = "geode-export";
  const body = document.createElement("article");
  body.className = "geode-export-body";
  body.innerHTML = disableTaskCheckboxes(note.bodyHtml);
  printRoot.appendChild(body);

  document.head.appendChild(style);
  document.body.appendChild(printRoot);

  // the printed document's header/footer + suggested PDF name use the title
  const previousTitle = document.title;
  document.title = note.title;

  let timer = 0;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (pendingPrintCleanup === cleanup) pendingPrintCleanup = null;
    window.removeEventListener("afterprint", cleanup);
    window.clearTimeout(timer);
    printRoot.remove();
    style.remove();
    document.title = previousTitle;
  };
  pendingPrintCleanup = cleanup;
  window.addEventListener("afterprint", cleanup);
  timer = window.setTimeout(cleanup, PRINT_CLEANUP_TIMEOUT_MS);

  (window as unknown as { __geodeLastPrintHtml?: string }).__geodeLastPrintHtml =
    buildStandaloneHtml(note);
  window.print();
}
