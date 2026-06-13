/**
 * Property rewrite engine (R30) — rename a frontmatter property key across
 * EVERY file in the vault that uses it (old→new) and update the
 * .obsidian/types.json registry. See ARCHITECTURE.md "Round 30 additions" for
 * the frozen algorithm. This is a verified-rewrite, data-safety round: it is a
 * byte-for-byte mirror of the R16 link-rewrite discipline — NEVER blind-write,
 * read fresh (open files read their buffer, not the cache), every file goes
 * through buildRenameProperty (never hand-written YAML) + a post-rewrite
 * re-parse assertion, per-file try/catch skip+report, module-level runTail
 * serialization. Unlike R16 it touches each file's OWN frontmatter (no
 * cross-file references), so there is no on-disk rename step and no link
 * resolution — only "splice the key text, confirm it re-parses".
 */
import type { DocumentManager } from "./documents";
import type { MetadataIndex } from "./metadata";
import { buildRenameProperty, parseProperties, propertyTypes, type PropertyType } from "./properties";
import type { Vault } from "./vault";

export interface PropertyRewriteSkip {
  path: string;
  reason: string;
}

export interface PropertyRewriteResult {
  /** files actually written / buffer-edited */
  filesChanged: number;
  /** property occurrences renamed (== filesChanged here; one per file) */
  propertiesRenamed: number;
  /** files skipped because verification failed (never blind-written) */
  skipped: PropertyRewriteSkip[];
}

export interface PropertyRewriteDeps {
  vault: Vault;
  metadata: MetadataIndex;
  documents: DocumentManager;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "text",
  "multitext",
  "number",
  "checkbox",
  "date",
  "datetime",
  "tags",
  "aliases",
]);

/** Serializes engine runs (R16/R24 precedent): two concurrent global renames
 *  sharing a file would interleave read→write and drop each other's edits.
 *  Each run re-captures (flushAll + ensureFresh) from the post-predecessor
 *  state, so queued runs are order-independent. A failed predecessor never
 *  poisons the queue. */
let runTail: Promise<unknown> = Promise.resolve();

/**
 * Rename frontmatter property `oldKey`→`newKey` across every file that uses it,
 * and carry the types.json assignment to the new key. Rewrite-phase errors are
 * reported per-file in the result, never thrown.
 */
export function renamePropertyAcrossVault(
  deps: PropertyRewriteDeps,
  oldKey: string,
  newKey: string,
): Promise<PropertyRewriteResult> {
  const run = runTail.then(
    () => doRename(deps, oldKey, newKey),
    () => doRename(deps, oldKey, newKey), // a failed predecessor never poisons the queue
  );
  runTail = run.catch(() => {});
  return run;
}

/** find a visible (non-opaque, keyed) entry for `key`, case-insensitively */
function hasVisibleKey(content: string, key: string): boolean {
  const parsed = parseProperties(content);
  if (!parsed) return false;
  const lower = key.toLowerCase();
  return parsed.entries.some((e) => !e.opaque && e.key !== "" && e.key.toLowerCase() === lower);
}

async function doRename(
  deps: PropertyRewriteDeps,
  oldKey: string,
  newKey: string,
): Promise<PropertyRewriteResult> {
  const { vault, metadata, documents } = deps;
  const result: PropertyRewriteResult = { filesChanged: 0, propertiesRenamed: 0, skipped: [] };

  /* ---- step 1: entry guards ---- */
  const from = oldKey.trim();
  const to = newKey.trim();
  // exact no-op, or an empty target (buildRenameProperty would reject every
  // file anyway via isInsertableKey) → nothing to do
  if (from === "" || to === "" || from === to) return result;

  /* ---- step 2: capture (converge buffers + index before discovery) ---- */
  await documents.flushAll();
  await metadata.ensureFresh(documents.getOpenPaths(), (p) => documents.get(p)?.getText());

  const lowerFrom = from.toLowerCase();
  const affected: string[] = [];
  for (const meta of metadata.getAll()) {
    const fields = meta.frontmatter?.fields;
    if (!fields) continue;
    if (Object.keys(fields).some((k) => k.toLowerCase() === lowerFrom)) affected.push(meta.path);
  }
  if (affected.length === 0) return result;

  /* ---- step 3: verified rewrite, one file at a time (never concurrent) ---- */
  for (const path of affected) {
    try {
      // source of truth: open buffer || disk — NEVER the metadata/vault cache
      const handle = documents.get(path);
      const content = handle !== null ? handle.getText() : await vault.readFresh(path);

      const edit = buildRenameProperty(content, from, to);
      // null = key absent here / opaque / case-insensitive collision with an
      // existing key in this file — not an error, silently skip (uncounted)
      if (edit === null) continue;

      const rewritten = content.slice(0, edit.from) + edit.insert + content.slice(edit.to);

      // post-rewrite assertion (mirror R16): the rename must re-parse to a
      // visible `to` entry — else NEVER write. The "old key gone" check is
      // case-INSENSITIVE, so it must be skipped for a case-only rename
      // (Author→author): the rewritten file legitimately still contains the
      // lowercased key, which IS the renamed entry. buildRenameProperty's
      // collision guard already guarantees no duplicate, so the `to`-visible
      // check alone proves success for case-only renames.
      if (!hasVisibleKey(rewritten, to)) {
        throw new Error(`post-rewrite: new key "${to}" not a visible entry`);
      }
      if (from.toLowerCase() !== to.toLowerCase() && hasVisibleKey(rewritten, from)) {
        throw new Error(`post-rewrite: old key "${from}" still present`);
      }

      // apply: open file → CM transaction (one undo step, schedules autosave);
      // closed file → vault.modify (FNV self-write fingerprint suppresses echo)
      if (handle !== null) {
        handle.applyExternalEdits([edit]);
      } else {
        await vault.modify(path, rewritten);
      }
      result.filesChanged++;
      result.propertiesRenamed++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.skipped.push({ path, reason });
      console.warn(`[propertyRewrite] skipped ${path}: ${reason}`);
    }
  }

  /* ---- step 4: carry the types.json assignment to the new key ---- */
  // non-fatal: the file rewrites already succeeded. The old key's assignment is
  // left in place (types.json is forward-compatible; no destructive cleanup).
  try {
    const assigned = propertyTypes.get(from);
    if (assigned !== undefined && KNOWN_TYPES.has(assigned)) {
      await propertyTypes.assign(to, assigned as PropertyType);
    }
  } catch (err) {
    console.warn(`[propertyRewrite] types.json carry failed`, err);
  }

  return result;
}
