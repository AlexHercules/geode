/**
 * embeds.ts — image embed hydration for `![[...]]` (R11).
 *
 * Binary vault files are read once, wrapped in a Blob and exposed as object
 * URLs. The cache is module-level (embeds appear in live preview widgets AND
 * the reading view, often for the same path) and is invalidated lazily via
 * vault events the first time it is used: modified/renamed/deleted paths drop
 * their entry and revoke the URL so the next request re-reads from disk.
 */
import { hydrateEmbeds as coreHydrateEmbeds } from "@core/embeds";
import { mimeForPath } from "@core/markdown";
import type { GeodeApp } from "@app/AppContext";

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
  // shared core source of truth (image + audio + video + pdf) so media files
  // get the correct MIME and native <audio>/<video>/<iframe> players render
  const mime = mimeForPath(path);
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
 * Hydrate every embed under `root` (R12: thin wrapper over the shared core
 * engine — fills `img.geode-embed` srcs via the blob-URL cache above AND
 * expands `span.geode-embed-note` note transclusions). `currentPath` seeds
 * the ancestor set for cycle detection. Never throws.
 */
export function hydrateEmbeds(root: HTMLElement, app: GeodeApp, currentPath: string): Promise<void> {
  return coreHydrateEmbeds(root, {
    vault: app.vault,
    metadata: app.metadata,
    imageSrc: (p: string) => getEmbedUrl(app, p),
    ancestors: new Set([currentPath]),
  });
}
