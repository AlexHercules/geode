/**
 * embeds.ts — image embed hydration for `![[...]]` (R11).
 *
 * Binary vault files are read once, wrapped in a Blob and exposed as object
 * URLs. The cache is module-level (embeds appear in live preview widgets AND
 * the reading view, often for the same path) and is invalidated lazily via
 * vault events the first time it is used: modified/renamed/deleted paths drop
 * their entry and revoke the URL so the next request re-reads from disk.
 */
import type { GeodeApp } from "@app/AppContext";

/** MIME by lowercase extension — mirrors IMAGE_EXTS in core/markdown.ts. */
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
};

/** path → in-flight or settled object-URL promise (shared by all consumers) */
const urlCache = new Map<string, Promise<string>>();
let eventsHooked = false;

function invalidate(path: string): void {
  const entry = urlCache.get(path);
  if (!entry) return;
  urlCache.delete(path);
  // revoke only after the load settles — revoking an in-flight entry's future
  // URL is impossible, so we wait for it; failures have nothing to revoke
  entry.then(
    (url) => URL.revokeObjectURL(url),
    () => {},
  );
}

/** Lazily subscribe (once) so stale blob URLs never outlive their file. */
function ensureInvalidation(app: GeodeApp): void {
  if (eventsHooked) return;
  eventsHooked = true;
  app.events.on("file:modified", ({ path }) => invalidate(path));
  // external edits to NON-md files surface as file:created (vault.ts pipeline
  // only emits file:modified for .md) — without this, an externally updated
  // image would serve a stale blob URL for the rest of the session
  app.events.on("file:created", ({ path }) => invalidate(path));
  app.events.on("file:deleted", ({ path }) => invalidate(path));
  app.events.on("file:renamed", ({ oldPath }) => invalidate(oldPath));
}

/**
 * Resolve a vault path to a blob object URL (cached). Rejects when the file
 * is missing/unreadable; a failed load is evicted so a later call can retry.
 */
export function getEmbedUrl(app: GeodeApp, path: string): Promise<string> {
  ensureInvalidation(app);
  const cached = urlCache.get(path);
  if (cached) return cached;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  const load = app.vault.readBinary(path).then((bytes) => {
    // copy into a fresh ArrayBuffer-backed view: TS types adapter bytes over
    // ArrayBufferLike, which BlobPart rejects (and a view may have an offset)
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return URL.createObjectURL(new Blob([copy], { type: mime }));
  });
  load.catch(() => {
    // identity-guarded: an invalidation may already have replaced the entry
    if (urlCache.get(path) === load) urlCache.delete(path);
  });
  urlCache.set(path, load);
  return load;
}

/**
 * Fill in the `src` of every `img.geode-embed[data-embed-path]` under `root`
 * (the reading-view pipeline emits them without src). Failures mark the img
 * with `.geode-embed-failed` and never throw.
 */
export function hydrateEmbeds(root: HTMLElement, app: GeodeApp): void {
  root.querySelectorAll<HTMLImageElement>("img.geode-embed[data-embed-path]").forEach((img) => {
    const path = img.dataset.embedPath;
    if (!path) return;
    // a revoked-while-loading blob URL surfaces as an error event
    img.addEventListener("error", () => img.classList.add("geode-embed-failed"), { once: true });
    getEmbedUrl(app, path).then(
      (url) => {
        // the container may have been re-rendered while the read was in flight
        if (img.isConnected) img.src = url;
      },
      () => img.classList.add("geode-embed-failed"),
    );
  });
}
