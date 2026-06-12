/**
 * Attachment ingestion via paste/drop (R17): images pasted from the clipboard
 * or dropped onto the editor are imported into the vault attachment folder
 * (core/attachments importAttachment) and an `![[linktext]]` embed is inserted
 * at the paste selection / drop point. Non-image payloads are never consumed,
 * so plain-text paste and CM's default text drag-and-drop stay untouched.
 * See ARCHITECTURE.md "Round 17 additions" for the frozen contract.
 */
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { importAttachment } from "@core/attachments";
import { IMAGE_EXTS } from "@core/markdown";

/** MIME → extension map (frozen). */
const MIME_TO_EXT: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/bmp": "bmp",
};

/** Extension for an image MIME type; outside the frozen map the subtype
 *  string is the fallback, with any "+xxx" suffix stripped. */
function extForMime(mime: string): string {
  const mapped = MIME_TO_EXT[mime];
  if (mapped) return mapped;
  return mime.slice("image/".length).replace(/\+.*$/, "");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYYMMDDHHMMSS` in local time (zero-padded). */
function pasteStamp(now: Date): string {
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

interface PendingFile {
  file: File;
  /** base file name handed to importAttachment (sanitized + uniquePath there) */
  name: string;
}

/**
 * Import every pending file, then insert the `![[...]]` embeds (joined with
 * "\n") replacing [from, to]. The imports are async: before dispatching we
 * check the view is still attached and clamp positions to the current doc
 * length (the user may have kept editing meanwhile — conservative clamp).
 * A single failed file is logged and skipped; it never blocks the rest.
 */
async function ingestFiles(
  app: GeodeApp,
  getPath: () => string,
  view: EditorView,
  files: PendingFile[],
  from: number,
  to: number,
): Promise<void> {
  // captured BEFORE the async imports: if the document changed meanwhile
  // (user kept typing, external reload), the [from, to] offsets are stale —
  // replacing that range would delete CURRENT bytes (review fix). Text is
  // immutable, so identity comparison detects any change.
  const docAtStart = view.state.doc;
  const links: string[] = [];
  for (const { file, name } of files) {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const { linktext } = await importAttachment(
        { vault: app.vault, metadata: app.metadata },
        getPath(),
        name,
        data,
      );
      links.push(`![[${linktext}]]`);
    } catch (err) {
      console.error(`[attachments] import failed: ${name}`, err);
    }
  }
  if (links.length === 0 || !view.dom.isConnected) return;
  const text = links.join("\n");
  let insertFrom = from;
  let insertTo = to;
  if (view.state.doc !== docAtStart) {
    // stale offsets — degrade to a pure insert at the current cursor
    insertFrom = insertTo = view.state.selection.main.head;
  }
  view.dispatch({
    changes: { from: insertFrom, to: insertTo, insert: text },
    selection: { anchor: insertFrom + text.length },
  });
}

/** CM extension: paste/drop image ingestion handlers. */
export function attachmentIngest(app: GeodeApp, getPath: () => string): Extension {
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      const items = event.clipboardData?.items;
      if (!items) return false;
      const stamp = pasteStamp(new Date());
      const pending: PendingFile[] = [];
      let sawImage = false;
      for (const item of Array.from(items)) {
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
        // at least one image item: the whole paste is consumed (Obsidian
        // behaviour — in mixed rich-text + image payloads the image wins)
        sawImage = true;
        const file = item.getAsFile();
        if (file) {
          // same-second pastes collide on the stamp — vault.uniquePath
          // (inside importAttachment) appends " 1"/" 2"
          pending.push({ file, name: `Pasted image ${stamp}.${extForMime(item.type)}` });
        }
      }
      if (!sawImage) return false;
      // a true return does NOT make CM call preventDefault — do it ourselves
      event.preventDefault();
      const sel = view.state.selection.main;
      void ingestFiles(app, getPath, view, pending, sel.from, sel.to);
      return true;
    },
    drop: (event, view) => {
      const files = event.dataTransfer?.files;
      if (!files) return false;
      const pending: PendingFile[] = [];
      for (const file of Array.from(files)) {
        const dot = file.name.lastIndexOf(".");
        const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
        if (IMAGE_EXTS.has(ext) || file.type.startsWith("image/")) {
          // dropped files keep their original name (sanitize + uniquePath
          // happen inside importAttachment)
          pending.push({ file, name: file.name });
        }
      }
      // zero image files: leave the event alone so CM's default text
      // drag-and-drop keeps working
      if (pending.length === 0) return false;
      event.preventDefault();
      const pos =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
        view.state.selection.main.head;
      // drop inserts at the drop point — it never replaces the selection
      void ingestFiles(app, getPath, view, pending, pos, pos);
      return true;
    },
  });
}
