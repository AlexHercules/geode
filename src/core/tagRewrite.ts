/**
 * Tag rewrite engine (R69, ㉝) — rename a tag across EVERY file in the vault:
 * inline `#old`→`#new` (incl. nested `#old/sub`→`#new/sub`) AND the frontmatter
 * `tags:` field. See ARCHITECTURE.md "Round 69 additions" for the frozen
 * algorithm. This is a verified-rewrite, data-safety round mirroring the R30
 * propertyRewrite discipline (NOT R16's offset-based linkRewrite — TagRef has
 * only `from`, no `to`, and inline/frontmatter tags are indistinguishable in the
 * index, so edits must be RE-CONSTRUCTED per file): NEVER blind-write, read
 * fresh (open files read their buffer, not the cache), frontmatter goes through
 * properties.buildSetProperty (never hand-written YAML), inline goes through the
 * indexer's own TAG_RE on masked text, a post-rewrite re-parse assertion gates
 * every write, per-file try/catch skip+report, module-level runTail
 * serialization. Tags are not files (no on-disk rename) and not typed keys (no
 * types.json carry).
 */
import type { DocumentManager } from "./documents";
import { asList, maskCodeRegions, parseFrontmatter, parseNote, TAG_RE } from "./metadata";
import type { MetadataIndex } from "./metadata";
import { buildSetProperty } from "./properties";
import type { Vault } from "./vault";

export interface TagRewriteSkip {
  path: string;
  reason: string;
}

export interface TagRewriteResult {
  /** files actually written / buffer-edited */
  filesChanged: number;
  /** tag occurrences rewritten across all files (inline + frontmatter) */
  tagsRewritten: number;
  /** files skipped because verification failed (never blind-written) */
  skipped: TagRewriteSkip[];
}

export interface TagRewriteDeps {
  vault: Vault;
  metadata: MetadataIndex;
  documents: DocumentManager;
}

/** One byte-span replacement inside a single file. */
interface Edit {
  from: number;
  to: number;
  insert: string;
}

/** A single tag-name segment: the TAG_RE body charset minus `/`. */
const TAG_SEGMENT_RE = /^[A-Za-z0-9_\-一-鿿]+$/;

/** A syntactically valid tag (after stripping a leading `#`): one or more
 *  non-empty segments joined by single slashes, each from the tag charset.
 *  Rejects empty / leading-/trailing-/double-slash / whitespace / metachars. */
export function isValidTagName(t: string): boolean {
  const norm = t.replace(/^#+/, "").trim();
  if (norm === "") return false;
  return norm.split("/").every((seg) => TAG_SEGMENT_RE.test(seg));
}

/** Serializes engine runs (R16/R24/R30 precedent): two concurrent global renames
 *  sharing a file would interleave read→write and drop each other's edits. Each
 *  run re-captures (flushAll + ensureFresh) from the post-predecessor state, so
 *  queued runs are order-independent. A failed predecessor never poisons the
 *  queue. */
let runTail: Promise<unknown> = Promise.resolve();

/**
 * Rename tag `oldTag`→`newTag` across every file that uses it (and its nested
 * descendants `old/sub`→`new/sub`). Rewrite-phase errors are reported per-file
 * in the result, never thrown.
 */
export function renameTagAcrossVault(
  deps: TagRewriteDeps,
  oldTag: string,
  newTag: string,
): Promise<TagRewriteResult> {
  const run = runTail.then(
    () => doRename(deps, oldTag, newTag),
    () => doRename(deps, oldTag, newTag), // a failed predecessor never poisons the queue
  );
  runTail = run.catch(() => {});
  return run;
}

/** Apply non-overlapping edits to `content` (descending `from` keeps offsets valid). */
function applyEdits(content: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.from - b.from);
  let out = content;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  }
  return out;
}

async function doRename(
  deps: TagRewriteDeps,
  oldTag: string,
  newTag: string,
): Promise<TagRewriteResult> {
  const { vault, metadata, documents } = deps;
  const result: TagRewriteResult = { filesChanged: 0, tagsRewritten: 0, skipped: [] };

  /* ---- step 1: entry guards ---- */
  const oldNorm = oldTag.replace(/^#+/, "").trim();
  const newNorm = newTag.replace(/^#+/, "").trim();
  // no-op / invalid target / renaming a tag into its own subtree (`a`→`a/b`):
  // the last would make renamed tags still match the old prefix, breaking the
  // "old gone" assertion — disallowed in v1 (see As-built known deviations).
  if (oldNorm === "" || !isValidTagName(newNorm) || oldNorm === newNorm) return result;
  if (newNorm.startsWith(oldNorm + "/")) return result;

  // `t` is `old` itself or a nested descendant `old/...`
  const matches = (t: string): boolean => t === oldNorm || t.startsWith(oldNorm + "/");
  const newMatches = (t: string): boolean => t === newNorm || t.startsWith(newNorm + "/");
  // transform a matching tag: swap the `old` prefix for `new`, keep the `/sub` tail
  const xform = (t: string): string => newNorm + t.slice(oldNorm.length);

  /* ---- step 2: capture (converge buffers + index before discovery) ---- */
  await documents.flushAll();
  await metadata.ensureFresh(documents.getOpenPaths(), (p) => documents.get(p)?.getText());

  const affected: string[] = [];
  for (const meta of metadata.getAll()) {
    if (meta.tags.some((tg) => matches(tg.tag))) affected.push(meta.path);
  }
  if (affected.length === 0) return result;

  /* ---- step 3: verified rewrite, one file at a time (never concurrent) ---- */
  for (const path of affected) {
    try {
      // source of truth: open buffer || disk — NEVER the metadata/vault cache
      const handle = documents.get(path);
      const content = handle !== null ? handle.getText() : await vault.readFresh(path);

      // authoritative count of occurrences to rename in THIS fresh content
      const before = parseNote(path, content);
      const intended = before.tags.filter((tg) => matches(tg.tag)).length;
      if (intended === 0) continue; // tag gone since capture (buffer edited) — skip, uncounted

      const edits: Edit[] = [];

      // --- inline `#tag` edits: re-scan masked text with the indexer's TAG_RE ---
      const fm = parseFrontmatter(content);
      const withoutFm = fm ? " ".repeat(fm.to) + content.slice(fm.to) : content;
      const masked = maskCodeRegions(withoutFm);
      for (const m of masked.matchAll(TAG_RE)) {
        const token = m[2];
        if (!matches(token)) continue;
        const hashPos = m.index! + m[1].length; // position of `#` (same in original — masking is same-length)
        edits.push({ from: hashPos, to: hashPos + 1 + token.length, insert: "#" + xform(token) });
      }

      // --- frontmatter `tags:` edit: rewrite the array value via the builder ---
      if (fm) {
        let fmKey: string | null = null;
        for (const cand of ["tags", "tag"]) {
          const k = Object.keys(fm.fields).find((kk) => kk.toLowerCase() === cand);
          if (k !== undefined) {
            fmKey = k;
            break;
          }
        }
        if (fmKey !== null) {
          const raw = fm.fields[fmKey];
          const list = asList(raw);
          let fmChanged = false;
          const newList = list.map((item) => {
            // mirror parseNote's frontmatter-tag index predicate EXACTLY
            // (metadata.ts: `replace(/^#/)` + drop empty/whitespace) so the
            // rewrite set ⊆ the index set — never silently touch a token the
            // user cannot see as a tag (R68 "align the N definitions" lesson).
            const norm = item.replace(/^#/, "").trim();
            if (norm !== "" && !/\s/.test(norm) && matches(norm)) {
              fmChanged = true;
              return xform(norm); // canonical, no leading `#`
            }
            return item;
          });
          if (fmChanged) {
            // preserve scalar-vs-list arity where unambiguous (one value)
            const value = Array.isArray(raw) || newList.length !== 1 ? newList : newList[0];
            const fmEdit = buildSetProperty(content, fmKey, value);
            if (fmEdit === null) {
              throw new Error(`frontmatter "${fmKey}" rewrite failed to serialize`);
            }
            edits.push(fmEdit);
          }
        }
      }

      if (edits.length === 0) continue; // defensive: nothing to write

      const rewritten = applyEdits(content, edits);

      // post-rewrite assertion (mirror R16/R30): re-parse the result and prove a
      // pure rename — NEVER write otherwise.
      const after = parseNote(path, rewritten);
      if (after.tags.length !== before.tags.length) {
        throw new Error("post-rewrite: tag count changed (corruption)");
      }
      if (after.tags.some((tg) => matches(tg.tag))) {
        throw new Error(`post-rewrite: old tag "${oldNorm}" still present`);
      }
      if (after.tags.filter((tg) => newMatches(tg.tag)).length < intended) {
        throw new Error(`post-rewrite: new tag "${newNorm}" not fully applied`);
      }

      // apply: open file → CM transaction (one undo step, schedules autosave);
      // closed file → vault.modify (FNV self-write fingerprint suppresses echo)
      if (handle !== null) {
        handle.applyExternalEdits(edits.slice().sort((a, b) => a.from - b.from));
      } else {
        await vault.modify(path, rewritten);
      }
      result.filesChanged++;
      result.tagsRewritten += intended;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.skipped.push({ path, reason });
      console.warn(`[tagRewrite] skipped ${path}: ${reason}`);
    }
  }

  return result;
}
