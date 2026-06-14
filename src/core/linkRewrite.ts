/**
 * Link rewrite engine (R16) — rename a file/folder AND update every wikilink /
 * embed across the vault that pointed at it. See ARCHITECTURE.md "Round 16
 * additions" for the frozen algorithm (capture → rename → ensureFresh →
 * verified rewrite → report). Data-safety round: NEVER blind-write — any
 * verification mismatch skips the file and reports it.
 */
import type { DocumentManager } from "./documents";
import { parseNote, type MetadataIndex } from "./metadata";
import { Store } from "./store";
import type { Vault } from "./vault";

const STORAGE_KEY = "geode.autoUpdateLinks";

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Whether renames rewrite referencing links (default ON, persisted). */
export const autoUpdateLinks = new Store<boolean>(readInitial());

export function setAutoUpdateLinks(on: boolean): void {
  autoUpdateLinks.set(on);
  try {
    localStorage.setItem(STORAGE_KEY, String(on));
  } catch {
    /* storage unavailable — session-only */
  }
}

export interface LinkRewriteSkip {
  path: string;
  reason: string;
}

export interface LinkRewriteResult {
  /** referrer files actually written / buffer-edited */
  filesChanged: number;
  /** individual link occurrences rewritten */
  linksRewritten: number;
  /** referrers skipped because verification failed (never blind-written) */
  skipped: LinkRewriteSkip[];
}

export interface LinkRewriteDeps {
  vault: Vault;
  metadata: MetadataIndex;
  documents: DocumentManager;
}

/** What a captured target resolved to BEFORE the rename, and where it moved. */
interface CaptureEntry {
  oldFile: string;
  newFile: string;
  /** resolved through the markdown name map (vs the attachment map) */
  isMd: boolean;
  /** R70: `[[wikilink]]` vs `[text](md.md)` — drives the per-kind rewrite branch */
  kind: "wikilink" | "markdown";
}

/** A verified splice plus the file the rewritten link must resolve to. */
interface PlannedEdit {
  from: number;
  to: number;
  insert: string;
  expect: string;
  /** R70: which resolver verifies `expect` in the post-rewrite re-parse */
  kind: "wikilink" | "markdown";
}

/** Serializes engine runs (R16 review fix): three entry points (Explorer,
 *  compat fileManager.renameFile, the __geodeRename probe) may overlap, and
 *  two concurrent runs sharing a referrer would interleave read→write and
 *  drop each other's rewrites. Each run starts with flushAll+ensureFresh, so
 *  queued runs re-capture from the post-predecessor state — order-independent. */
let runTail: Promise<unknown> = Promise.resolve();

/**
 * Rename oldPath→newPath (file or folder) and rewrite every link/embed in the
 * vault that resolved to it (or to a file under it, for folders). When
 * `autoUpdateLinks` is off this degrades to a bare vault.rename. Rewrite-phase
 * errors are reported in the result, never thrown; rename errors propagate.
 */
export function renameWithLinkUpdate(
  deps: LinkRewriteDeps,
  oldPath: string,
  newPath: string,
): Promise<LinkRewriteResult> {
  const run = runTail.then(
    () => doLinkUpdate(deps, oldPath, newPath, true),
    () => doLinkUpdate(deps, oldPath, newPath, true), // a failed predecessor never poisons the queue
  );
  runTail = run.catch(() => {});
  return run;
}

/**
 * Rewrite every link/embed that resolved to `fromPath` so it points at `toPath`,
 * WITHOUT moving any file (R47 note-composer merge: `toPath` already exists). Same
 * verified capture→splice→post-rewrite-reassert engine as rename — the merge
 * caller appends `fromPath`'s body into `toPath` and trashes `fromPath` AFTER this
 * runs (so the capture still resolves `fromPath`). Serialized on the same queue as
 * renames. Always rewrites (ignores the autoUpdateLinks toggle): a merge that left
 * `[[fromPath]]` links dangling after the source is trashed would be data loss.
 */
export function rewriteLinksForMerge(
  deps: LinkRewriteDeps,
  fromPath: string,
  toPath: string,
): Promise<LinkRewriteResult> {
  const run = runTail.then(
    () => doLinkUpdate(deps, fromPath, toPath, false),
    () => doLinkUpdate(deps, fromPath, toPath, false),
  );
  runTail = run.catch(() => {});
  return run;
}

async function doLinkUpdate(
  deps: LinkRewriteDeps,
  oldPath: string,
  newPath: string,
  move: boolean,
): Promise<LinkRewriteResult> {
  const { vault, metadata, documents } = deps;
  // move=false (merge) ALWAYS rewrites — see rewriteLinksForMerge. Only a real
  // rename degrades to a bare move when the user disabled auto-update.
  if (move && !autoUpdateLinks.get()) {
    await vault.rename(oldPath, newPath);
    return { filesChanged: 0, linksRewritten: 0, skipped: [] };
  }

  /* ---- step 1: capture (pre-rename) ---- */

  // folder-ness must be judged while oldPath still exists
  const isFolder = vault.folderExists(oldPath);
  // converge buffers and index: a link typed inside the save-debounce window
  // must still take part in referrer discovery. The buffer-text provider
  // (R16 review fix) keeps discovery converged even when a flush FAILED
  // (locked/read-only file) — persistence may lag, the index must not.
  await documents.flushAll();
  await metadata.ensureFresh(documents.getOpenPaths(), (p) => documents.get(p)?.getText());

  // affected files (old path → new path), markdown and attachments separately
  const affectedMd = new Map<string, string>();
  const affectedAtt = new Map<string, string>();
  if (isFolder) {
    const prefix = oldPath + "/";
    for (const f of vault.getFiles()) {
      if (!f.path.startsWith(prefix)) continue;
      const dest = newPath + f.path.slice(oldPath.length);
      if (f.extension === "md") affectedMd.set(f.path, dest);
      else affectedAtt.set(f.path, dest);
    }
  } else if (oldPath.toLowerCase().endsWith(".md")) {
    affectedMd.set(oldPath, newPath);
  } else if (vault.fileExists(oldPath)) {
    affectedAtt.set(oldPath, newPath);
  }

  // Referrer discovery over the whole index — INCLUDING the renamed file
  // itself (a self link `[[A]]` inside A.md must update too; getBacklinks
  // excludes self, so it is not used here). Unified resolution rule: a
  // resolveLink hit wins (and shadows attachments — mirrors how the link is
  // navigated at runtime); only when it misses entirely may resolveAttachment
  // claim the target. Capture keyed per referrer by lowercased target — the
  // resolution depends on fromPath, so maps are NOT shared across referrers.
  const captures = new Map<string, Map<string, CaptureEntry>>();
  if (affectedMd.size > 0 || affectedAtt.size > 0) {
    for (const meta of metadata.getAll()) {
      let map: Map<string, CaptureEntry> | undefined;
      for (const link of meta.links) {
        // key includes kind: a wikilink and a markdown link in one file may
        // share a lowercased target string but resolve / rewrite differently.
        const key = link.kind + " " + link.target.toLowerCase();
        if (map?.has(key)) continue;
        if (link.kind === "markdown") {
          // markdown hrefs resolve via the dedicated decoder/normalizer; a md
          // link may point at an md note OR an attachment (`[x](pic.png)`)
          const resolved = metadata.resolveMarkdownLink(link.target, meta.path);
          if (resolved === null) continue;
          const destMd = affectedMd.get(resolved);
          if (destMd !== undefined) {
            (map ??= new Map()).set(key, { oldFile: resolved, newFile: destMd, isMd: true, kind: "markdown" });
            continue;
          }
          const destAtt = affectedAtt.get(resolved);
          if (destAtt !== undefined) {
            (map ??= new Map()).set(key, { oldFile: resolved, newFile: destAtt, isMd: false, kind: "markdown" });
          }
          continue;
        }
        const md = metadata.resolveLink(link.target, meta.path);
        if (md !== null) {
          const dest = affectedMd.get(md);
          if (dest !== undefined) {
            (map ??= new Map()).set(key, { oldFile: md, newFile: dest, isMd: true, kind: "wikilink" });
          }
          continue;
        }
        const att = metadata.resolveAttachment(link.target, meta.path);
        if (att !== null) {
          const dest = affectedAtt.get(att);
          if (dest !== undefined) {
            (map ??= new Map()).set(key, { oldFile: att, newFile: dest, isMd: false, kind: "wikilink" });
          }
        }
      }
      if (map !== undefined) captures.set(meta.path, map);
    }
  }

  /* ---- step 2: rename (its errors propagate — the caller catches) ---- */
  /*       merge (move=false) skips this: toPath already exists, the file is not moved */

  if (move) await vault.rename(oldPath, newPath);

  const result: LinkRewriteResult = { filesChanged: 0, linksRewritten: 0, skipped: [] };

  /* ---- step 3: fresh index — disambiguation below needs the NEW names ---- */

  try {
    await metadata.ensureFresh([...affectedMd.values()]);
  } catch (err) {
    // ensureFresh swallows per-file errors itself; this is pure belt-and-braces
    console.warn("[linkRewrite] ensureFresh after rename failed", err);
  }
  if (captures.size === 0) return result;

  // a referrer that itself lived under the renamed folder is read/written at
  // its NEW path (the renamed md file's own self links remap the same way).
  // merge (move=false) moves no file, so every referrer keeps its own path —
  // including `oldPath` itself (the source's body, already appended into toPath,
  // is rewritten in BOTH places while the source still exists; it is trashed after).
  const remap = (p: string): string =>
    !move
      ? p
      : p === oldPath
        ? newPath
        : p.startsWith(oldPath + "/")
          ? newPath + p.slice(oldPath.length)
          : p;
  // same precedence as capture: markdown resolution shadows attachments
  const resolveUnified = (target: string, fromPath: string): string | null =>
    metadata.resolveLink(target, fromPath) ?? metadata.resolveAttachment(target, fromPath);
  // Only-fix-broken must judge the ORIGINAL text strictly by its form: a
  // path-form target is only "still alive" on an exact path match. The lenient
  // resolveLink basename fallback would mask a stale folder prefix (the link
  // happens to navigate, but the bytes are wrong and break the vault when
  // opened in Obsidian, which never falls back for path-form linkpaths).
  // Browser-E2E finding, contract amendment recorded in ARCHITECTURE R16.
  const stillResolves = (target: string, fromPath: string, cap: CaptureEntry): boolean => {
    const t = target.trim();
    if (t.includes("/")) {
      const exact = cap.isMd ? t.replace(/\.md$/i, "") + ".md" : t;
      return exact.toLowerCase() === cap.newFile.toLowerCase();
    }
    return resolveUnified(t, fromPath) === cap.newFile;
  };
  // markdown variant: judge the normalized (decoded, anchor-stripped, relative-
  // resolved) path. Same only-fix-broken discipline — a path-form href is alive
  // only on an exact path match (a stale folder prefix that still navigates via
  // basename is NOT alive: the bytes are wrong, see stillResolves rationale).
  const stillResolvesMd = (href: string, fromPath: string, cap: CaptureEntry): boolean => {
    const p = metadata.normalizeMdHref(href, fromPath);
    if (p === null) return false;
    if (p.includes("/")) {
      const exact = cap.isMd ? p.replace(/\.md$/i, "") + ".md" : p;
      return exact.toLowerCase() === cap.newFile.toLowerCase();
    }
    return metadata.resolveMarkdownLink(href, fromPath) === cap.newFile;
  };
  // Re-encode a vault path as a markdown href. Percent-encode EVERY character
  // that is syntactically significant inside `(...)` — not just spaces: a literal
  // `(` / `)` would truncate the href on re-parse (MARKDOWN_LINK_RE stops at `)`),
  // and a literal `#` / `?` would be misread as an anchor / query, both leaving a
  // dangling link after the file was already renamed (review R70 major). `%` is
  // encoded first so the encodings we introduce are not double-encoded;
  // normalizeMdHref's decodeURIComponent is the exact inverse. `/` is preserved
  // as the path separator.
  const encodeMdHref = (path: string): string =>
    path
      .replace(/%/g, "%25")
      .replace(/ /g, "%20")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/#/g, "%23")
      .replace(/\?/g, "%3F");

  /* ---- step 4: verified rewrite, one referrer at a time ---- */

  for (const [capturedPath, map] of captures) {
    const rPath = remap(capturedPath);
    try {
      // an open buffer is the source of truth; otherwise read DISK, never the
      // content cache (R16 review fix) — an external change landing inside
      // the watcher's debounce window is invisible to the cache, and deriving
      // edits from that stale snapshot would silently overwrite it (the
      // engine's own echo fingerprint would then even suppress the signal)
      const handle = documents.get(rPath);
      const content = handle !== null ? handle.getText() : await vault.readFresh(rPath);

      // fresh parse: offsets are correct for the CURRENT content by
      // construction (fences / inline code / frontmatter excluded by parseNote)
      const parsed = parseNote(rPath, content);
      const edits: PlannedEdit[] = [];
      for (const link of parsed.links) {
        const cap = map.get(link.kind + " " + link.target.toLowerCase());
        if (cap === undefined) continue;

        // ---- R70: markdown link `[text](href)` branch ----
        if (link.kind === "markdown") {
          if (stillResolvesMd(link.target, rPath, cap)) continue;
          const raw = content.slice(link.from, link.to);
          // splice verification — NEVER blind-write: the span must still be a
          // markdown link whose href matches the captured target byte-for-byte
          const mm = /^\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+("[^"]*"))?\s*\)$/.exec(raw);
          if (mm === null) {
            throw new Error(`span ${link.from}-${link.to} is not a markdown link: "${raw}"`);
          }
          const text = mm[1];
          const url = mm[2];
          const titlePart = mm[3] ? ` ${mm[3]}` : "";
          if (url !== link.target) {
            throw new Error(`md href mismatch at ${link.from}: "${url}" != "${link.target}"`);
          }
          // preserve the whole tail from the first `#` OR `?` verbatim (anchor
          // and/or query) — only the path part is replaced (review R70 minor:
          // a `?query` after the path was being dropped).
          const tailAt = url.search(/[#?]/);
          const tail = tailAt === -1 ? "" : url.slice(tailAt);
          // new href = the new file's vault-relative path (unambiguous absolute
          // form; basename disambiguation / author style is ㉞-c). md keeps the
          // extension; syntax-sensitive chars re-encoded (see encodeMdHref).
          const insert = `[${text}](${encodeMdHref(cap.newFile)}${tail}${titlePart})`;
          edits.push({ from: link.from, to: link.to, insert, expect: cap.newFile, kind: "markdown" });
          continue;
        }

        // only-fix-broken (minimal diff): a basename link survives a folder
        // move, an alias link travels with the frontmatter — leave them alone.
        // Path-form targets are judged by exact path (see stillResolves).
        if (stillResolves(link.target, rPath, cap)) continue;

        // new target text: keep the author's style (full path vs basename),
        // then verify it disambiguates; fall back to the full path
        // (MetadataCache.fileToLinktext rule). md drops the .md suffix —
        // also for originals written as `[[A.md]]`; attachments keep theirs.
        const fullForm = cap.isMd ? cap.newFile.replace(/\.md$/i, "") : cap.newFile;
        const baseForm = fullForm.split("/").pop() ?? fullForm;
        let next = link.target.includes("/") ? fullForm : baseForm;
        if (resolveUnified(next, rPath) !== cap.newFile) {
          next = fullForm;
          if (resolveUnified(next, rPath) !== cap.newFile) {
            throw new Error(
              `no unambiguous link text for "${link.target}" (tried "${next}" -> ${cap.newFile})`,
            );
          }
        }

        // splice verification — NEVER blind-write: the captured span must
        // still be a wikilink whose target matches the capture byte-for-byte
        const raw = content.slice(link.from, link.to);
        if (raw.length < 4 || !raw.startsWith("[[") || !raw.endsWith("]]")) {
          throw new Error(`span ${link.from}-${link.to} is not a wikilink: "${raw}"`);
        }
        const inner = raw.slice(2, -2);
        const pipeAt = inner.indexOf("|");
        const head = pipeAt === -1 ? inner : inner.slice(0, pipeAt);
        const aliasPart = pipeAt === -1 ? "" : inner.slice(pipeAt); // verbatim, incl. "|"
        const hashAt = head.indexOf("#");
        const targetPart = hashAt === -1 ? head : head.slice(0, hashAt);
        const subPart = hashAt === -1 ? "" : head.slice(hashAt); // verbatim, incl. "#"
        if (targetPart.trim() !== link.target) {
          throw new Error(
            `target mismatch at ${link.from}: "${targetPart.trim()}" != "${link.target}"`,
          );
        }
        edits.push({
          from: link.from,
          to: link.to,
          insert: `[[${next}${subPart}${aliasPart}]]`,
          expect: cap.newFile,
          kind: "wikilink",
        });
      }
      if (edits.length === 0) continue;
      // parsed.links lists all wikilinks THEN all markdown links (two scans), so
      // the collected edits are not globally ordered — sort by offset before the
      // splice construction + apply (both require ascending, non-overlapping).
      edits.sort((a, b) => a.from - b.from);

      // post-rewrite assertion (probe-grade): apply to a copy and confirm
      // every rewritten link resolves to its new file BEFORE anything is written
      let rewritten = "";
      let pos = 0;
      for (const e of edits) {
        rewritten += content.slice(pos, e.from) + e.insert;
        pos = e.to;
      }
      rewritten += content.slice(pos);
      const reparsed = parseNote(rPath, rewritten);
      let delta = 0;
      for (const e of edits) {
        const at = e.from + delta;
        delta += e.insert.length - (e.to - e.from);
        const now = reparsed.links.find((l) => l.from === at);
        // markdown hrefs resolve through the decoder (resolveUnified can't decode
        // %20 / relative forms); wikilinks through the unified md/attachment rule.
        const got =
          now === undefined
            ? null
            : e.kind === "markdown"
              ? metadata.resolveMarkdownLink(now.target, rPath)
              : resolveUnified(now.target, rPath);
        if (got !== e.expect) {
          throw new Error(`post-rewrite verification failed at offset ${at} (expected ${e.expect})`);
        }
      }

      // apply — open buffer edits go through the document (single CM
      // transaction, dirty + debounced save, undo in shared history); closed
      // files go through Vault.modify (echo-fingerprint suppression included)
      if (handle !== null) {
        handle.applyExternalEdits(edits.map(({ from, to, insert }) => ({ from, to, insert })));
      } else {
        await vault.modify(rPath, rewritten);
      }
      result.filesChanged++;
      result.linksRewritten += edits.length;
    } catch (err) {
      // per-file granularity: one bad referrer never stops the rest
      const reason = err instanceof Error ? err.message : String(err);
      result.skipped.push({ path: rPath, reason });
      console.warn(`[linkRewrite] skipped ${rPath}: ${reason}`);
    }
  }

  /* ---- step 5: report ---- */

  return result;
}
