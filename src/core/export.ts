/**
 * Text-file export (R7) — backs the export feature's "save as…" flow.
 * Desktop: native save dialog (@tauri-apps/plugin-dialog) + Rust `export_write`.
 * Browser: Blob + anchor download (no dialog — always resolves "saved").
 *
 * Mirrors core/net.ts's dual-end pattern: Tauri modules are loaded via dynamic
 * import so the browser build never pulls them in.
 */
import { isTauri } from "./vault";

export interface SaveTextFileOptions {
  /** e.g. "Welcome.html" */
  suggestedName: string;
  /** dialog filter label, e.g. "HTML" */
  filterName: string;
  /** dialog filter extensions, e.g. ["html"] */
  extensions: string[];
}

/** How long the browser download anchor stays in the DOM — Playwright's
 *  download event needs to observe it before it is removed. */
const DOWNLOAD_ANCHOR_TTL_MS = 10_000;

/**
 * Save `content` as a UTF-8 text file.
 * Desktop: returns "cancelled" when the user dismisses the save dialog.
 * Browser: triggers a download via a temporary anchor and resolves "saved".
 */
export async function saveTextFile(
  content: string,
  opts: SaveTextFileOptions,
): Promise<"saved" | "cancelled"> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: opts.suggestedName,
      filters: [{ name: opts.filterName, extensions: opts.extensions }],
    });
    if (path === null) return "cancelled";
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("export_write", { path, content });
    return "saved";
  }

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = opts.suggestedName;
  anchor.setAttribute("data-testid", "export-download");
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, DOWNLOAD_ANCHOR_TTL_MS);
  return "saved";
}
