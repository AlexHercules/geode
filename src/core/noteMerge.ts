/**
 * R47 Note composer — MERGE current file into another (the #⑬ "merge" half;
 * R44 did "extract"). Appends the source body to the target, rewrites every link
 * that pointed at the source to point at the target, then trashes the source.
 *
 * Data safety (critical round): flush dirty editors first (the source is typically
 * the active dirty editor); APPEND BEFORE TRASH so a failure mid-way can only
 * duplicate content, never lose it; the link rewrite reuses the R16 verified engine
 * via rewriteLinksForMerge (post-rewrite reassert — never blind-writes); the source
 * is removed via vault.trash (recoverable, R42), AFTER the rewrite captured it.
 */
import { Store } from "./store";
import { rewriteLinksForMerge, type LinkRewriteDeps, type LinkRewriteResult } from "./linkRewrite";

/** Consume-once: the source path for a pending "merge current file with…" pick.
 *  The merge command sets it + opens the switcher; QuickSwitcher snapshots it on
 *  mount and clears the store (so a cancelled pick never leaks into the next
 *  switcher open), then on a file selection runs mergeNotes(source → picked).
 *  null = the switcher behaves normally. */
export const mergeTargetMode = new Store<string | null>(null);

const SEPARATOR = "\n\n";

/**
 * Merge `sourcePath` INTO `targetPath`. Returns the link-rewrite result, or null
 * if the merge was a no-op (same file / a side missing).
 */
export async function mergeNotes(
  deps: LinkRewriteDeps,
  sourcePath: string,
  targetPath: string,
): Promise<LinkRewriteResult | null> {
  const { vault, metadata, documents } = deps;
  if (sourcePath === targetPath) return null; // can't merge a file into itself
  if (!vault.fileExists(sourcePath) || !vault.fileExists(targetPath)) return null;

  // converge dirty buffers first (best-effort). Even if flushAll THROWS (the source
  // is a locked/read-only active editor), read the LIVE buffer below — a stale disk
  // read here would merge yesterday's bytes and then trash the source, losing the
  // unsaved edits (R47 review; data-safety A: flush-before-move + buffer-is-truth).
  try {
    await documents.flushAll();
  } catch (err) {
    console.warn("[merge] flushAll failed — reading from live buffers", err);
  }
  const liveOrDisk = async (p: string): Promise<string> =>
    documents.get(p)?.getText() ?? (await vault.readFresh(p));
  const source = await liveOrDisk(sourcePath);
  const target = await liveOrDisk(targetPath);

  // append — the target's own body is preserved in full, the source body follows.
  const merged = target.replace(/\s+$/, "") + SEPARATOR + source.replace(/^\s+/, "") + "\n";
  await vault.modify(targetPath, merged);
  // index the appended links before the rewrite so the source's now-in-target self
  // links (e.g. an appended `[[source]]`) are captured and rewritten too.
  await metadata.ensureFresh([targetPath]);

  // rewrite [[source]] → [[target]] everywhere (verified, R16 engine), while the
  // source still exists so capture/resolution can see it.
  const result = await rewriteLinksForMerge(deps, sourcePath, targetPath);

  // recoverable delete — never permanent (R42); after the rewrite has captured it.
  await vault.trash(sourcePath);
  return result;
}
