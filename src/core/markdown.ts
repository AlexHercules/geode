/**
 * Markdown → HTML pipeline (moved verbatim from features/editor/preview.ts in R6
 * so the compat layer's MarkdownRenderer can reuse it — core never imports features):
 * markdown-it (html disabled, linkify on) plus
 *  - wikilink pre-pass on the source ([[target|alias]] → placeholder → <a class="internal-link">)
 *  - #tag pills
 *  - interactive GFM task-list checkboxes carrying their source line number
 *  - trailing `^block-id` markers stripped outside fences (R13, all callers)
 *  - R18 dialect long tail: frontmatter exclusion + %%comment%% stripping in
 *    the pre-pass, plus hand-written markdown-it rules for ==highlight==,
 *    footnotes, callouts and $math$ (no markdown-it-* plugins).
 *  - R19: ```mermaid fences render a hydration placeholder (fence renderer
 *    override; every other fence keeps the default byte-identical output).
 */
import MarkdownIt from "markdown-it";
import { unescapeAll } from "markdown-it/lib/common/utils.mjs";

/** Extract the link target from the inside of a [[...]] span (drops alias + heading). */
export function wikilinkTarget(inner: string): string {
  return inner.split("|")[0].split("#")[0].trim();
}

interface WikiLinkInfo {
  target: string;
  display: string;
  /** set ⇒ render an image embed placeholder instead of an internal-link anchor */
  embedPath?: string;
  /** R61: image-embed dimensions parsed from a numeric alias (`![[img|200]]`
   *  → width 200; `![[img|200x100]]` → width 200, height 100). Rendered as
   *  `width`/`height` attributes on the `<img>`; absent for non-numeric aliases
   *  (which stay alt text, byte-identical to pre-R61). */
  embedWidth?: number;
  embedHeight?: number;
  /** R26: set ⇒ render a media file-embed placeholder (audio/video/pdf). The
   *  extension drives the element kind at hydration; `subpath` carries a PDF
   *  page anchor ("page=N"). */
  fileEmbedPath?: string;
  fileEmbedExt?: string;
  /** set ⇒ render a note-embed placeholder span (R12, noteEmbeds option) */
  notePath?: string;
  /** raw text between '#' and '|' in the original inner ("" when absent) */
  noteSubpath?: string;
  /** R14: raw text between '#' and '|' for a plain internal link (same rule
   *  as noteSubpath); undefined when absent/empty — rendered as data-subpath
   *  on the anchor, so subpath-less links stay byte-identical */
  subpath?: string;
  /** R16: set ⇒ `[[#h]]` / `[[#^id]]` — empty target linking to the current
   *  note. The anchor renders with data-target="" and is always styled
   *  resolved; resolve() must never be called with the empty target. */
  selfLink?: boolean;
}

/** Image extensions (lowercase) that `![[...]]` embeds may render as <img>. */
export const IMAGE_EXTS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
]);

/** R61: parse an image-embed alias as Obsidian dimensions (the part after `|`).
 *  `"200"` → `{width:200}` (height auto, proportional); `"200x100"` →
 *  `{width:200, height:100}` (lowercase `x` separator, per Obsidian). Any
 *  non-dimension alias (`"caption"`, `"200x"`, `"-5"`, capital `X`) → `null`:
 *  the alias is alt text, not a size, so the embed stays byte-identical to
 *  pre-R61. Used by BOTH the reading-view placeholder and the live-preview
 *  widget so the two render paths never diverge.
 *
 *  Each dimension is capped at 5 digits (≤99999px — past any real display).
 *  This is a correctness bound, not cosmetics: an unbounded `Number(...)` makes
 *  the three render paths diverge — reading/export emit the JS string form
 *  (`"1e+21"` / `"Infinity"`, invalid HTML → intrinsic size) while live preview
 *  does `img.width = N` whose `unsigned long` IDL setter applies ToUint32 (mod
 *  2³²) → a clamped pixel width. Capping the digit count keeps every accepted
 *  value a plain integer < 2³², so all paths stay byte/pixel-identical. */
export function parseEmbedSize(alias: string): { width: number; height?: number } | null {
  const m = /^(\d{1,5})(?:x(\d{1,5}))?$/.exec(alias.trim());
  if (!m) return null;
  return { width: Number(m[1]), height: m[2] !== undefined ? Number(m[2]) : undefined };
}

/** R26: audio extensions an `![[...]]` embed renders as a native <audio>. */
export const AUDIO_EXTS: ReadonlySet<string> = new Set([
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "oga",
  "opus",
  "3gp",
  "flac",
  "aac",
]);

/** R26: video extensions an `![[...]]` embed renders as a native <video>.
 *  (webm is treated as video — the common case — not audio.) */
export const VIDEO_EXTS: ReadonlySet<string> = new Set([
  "mp4",
  "webm",
  "ogv",
  "mov",
  "mkv",
]);

/** R26: classify a (lowercase) extension as a hydratable file embed. Video is
 *  checked before audio so webm resolves to video. Returns null for everything
 *  that is NOT a media embed (images go through the dedicated IMAGE_EXTS branch;
 *  other attachments — zip/docx/… — keep degrading to a link). */
export function fileEmbedKind(ext: string): "audio" | "video" | "pdf" | null {
  if (ext === "pdf") return "pdf";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return null;
}

/** R26: MIME by lowercase extension — single source shared by the editor blob
 *  cache and the export data-URI path (was duplicated, image-only, in each).
 *  Covers image + audio + video + pdf; unknown → application/octet-stream. */
const MIME_BY_EXT: Record<string, string> = {
  // image
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  // audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  "3gp": "audio/3gpp",
  flac: "audio/flac",
  aac: "audio/aac",
  // video
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  // document
  pdf: "application/pdf",
};

/** R26: resolve a vault path to its MIME type (unknown → octet-stream). */
export function mimeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export interface RenderMarkdownOptions {
  /**
   * present ⇒ `![[target]]` whose resolved path has an image extension renders
   * as `<img class="geode-embed" data-embed-path="<resolved>" alt="<inner>">`
   * (no src — the caller hydrates it asynchronously). absent / unresolved /
   * non-image ⇒ output is byte-identical to the legacy pipeline ("!" stays
   * literal text and [[inner]] takes the internal-link placeholder path).
   */
  resolveEmbed?: (target: string) => string | null;
  /**
   * R12: present ⇒ a `![[inner]]` that resolveEmbed did NOT turn into an
   * image embed, but whose target (the part before `#`, already stripped by
   * wikilinkTarget) `resolve()`s to a note, renders as
   * `<span class="geode-embed-note" data-embed-note="<resolved>"
   * data-embed-subpath="<raw text between # and |, may be empty>"
   * data-embed-display="<alias|inner>"></span>` — an empty container the
   * caller hydrates asynchronously (span + CSS display:block, because a div
   * inside a host paragraph would be broken apart by the HTML parser).
   * absent ⇒ R11 behaviour; every other fallback path is unchanged
   * (unresolved target keeps the literal "!" + internal-link placeholder).
   */
  noteEmbeds?: boolean;
  /**
   * R71: present ⇒ a standard markdown link `[text](href)` whose href resolves
   * (via this fn) to a `.md` NOTE renders as `<a class="internal-link"
   * data-target="<resolved path>" [data-subpath]="<anchor>" href="#">` — reusing
   * the wikilink anchor + click machinery (openWikilink re-resolves the full
   * path → navigates, never the create-note branch). External / attachment /
   * unresolved md links keep the legacy `<a href>` rendering (byte-identical).
   * Bound by each call site to `metadata.resolveMarkdownLink(href, sourcePath)`.
   */
  resolveMdLink?: (href: string) => string | null;
}

const WIKILINK_RE = /(!?)\[\[([^\[\]]+?)\]\]/g;
const PLACEHOLDER_RE = /@@GEODELINK(\d+)@@/g;
const PLACEHOLDER_TEST = /@@GEODELINK\d+@@/;
const TAG_RE = /(^|[\s(])#([A-Za-z0-9_\/\-一-鿿]+)/g;
const TASK_RE = /^\[( |x|X)\]\s+/;
/** Trailing `^block-id` marker at a line end (R13, frozen contract regex). */
const BLOCK_MARKER_RE = /\s\^([A-Za-z0-9-]+)\s*$/;

/** R18 per-render footnote state (lives in the env — md is a singleton). */
interface FootnoteState {
  /** id → definition body source (first definition of an id wins) */
  defs: Map<string, string>;
  /** id → assigned number (numbers follow first-reference order, 1-based) */
  order: Map<string, number>;
  /** list[n-1] = definition source for footnote n (inline `^[..]` included) */
  list: string[];
  /** R18 fix: render-unique prefix for fn/fnref DOM ids — a host note and a
   *  transcluded note are rendered by separate renderMarkdownToHtml calls,
   *  each with its own env/state; without this prefix their `fn-1`/`fnref-1`
   *  ids collide and a host backref jumps into the embed's footnote. */
  seq: number;
}

/** Module-level counter handing every footnote-bearing render a unique id
 *  prefix (see FootnoteState.seq). */
let footnoteRenderSeq = 0;

/** per-render data passed through markdown-it's env (md is a module singleton) */
interface PreviewEnv {
  geodeLinks?: WikiLinkInfo[];
  geodeResolve?: (target: string) => string | null;
  geodeFootnotes?: FootnoteState;
  /** R71: resolve a standard markdown-link href to a vault path (decode/anchor/
   *  relative), so `[text](note.md)` that points at a note renders as an
   *  internal-link anchor instead of a plain external `<a href>`. */
  geodeResolveMdLink?: (href: string) => string | null;
}

function footnoteState(env: PreviewEnv): FootnoteState {
  if (!env.geodeFootnotes) {
    env.geodeFootnotes = {
      defs: new Map(),
      order: new Map(),
      list: [],
      seq: footnoteRenderSeq++,
    };
  }
  return env.geodeFootnotes;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * R18: number of leading frontmatter lines (opening `---` through the closing
 * `---` line, inclusive), or 0 when absent/unclosed. Mirrors the
 * core/metadata.ts parseFrontmatter span (first line must be exactly `---`;
 * any later line starting with `---` closes it; unclosed ⇒ not frontmatter),
 * which is also the R17 foldService basis.
 */
function frontmatterLineCount(lines: string[]): number {
  const first = lines[0];
  if (first === undefined || !first.startsWith("---") || first.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith("---")) return i + 1;
  }
  return 0;
}

/**
 * R18: offsets of `%%` delimiters in the non-code (even) segments of a line —
 * `%%` inside an inline code span never strips and never opens a block
 * comment (same backtick parity rule the wikilink pass uses).
 */
function commentDelimOffsets(line: string): number[] {
  const offsets: number[] = [];
  let base = 0;
  const segs = line.split(/(`+[^`]*`+)/g);
  for (let i = 0; i < segs.length; i++) {
    if (i % 2 === 0) {
      let at = segs[i].indexOf("%%");
      while (at >= 0) {
        offsets.push(base + at);
        at = segs[i].indexOf("%%", at + 2);
      }
    }
    base += segs[i].length;
  }
  return offsets;
}

/**
 * R18: strip `%%comment%%` spans from a single line. Delimiters are paired
 * left-to-right (non-greedy, pair by pair); a trailing unpaired `%%` strips to
 * the end of the line and opens a multi-line block comment.
 * Returns the stripped line plus whether a block comment is now open.
 */
function stripLineComments(line: string): { text: string; opensBlock: boolean } {
  const offsets = commentDelimOffsets(line);
  if (offsets.length === 0) return { text: line, opensBlock: false };
  let out = "";
  let last = 0;
  let i = 0;
  for (; i + 1 < offsets.length; i += 2) {
    out += line.slice(last, offsets[i]);
    last = offsets[i + 1] + 2;
  }
  if (i < offsets.length) {
    // unpaired opener: strip from `%%` to the end of the line, block begins
    return { text: out + line.slice(last, offsets[i]), opensBlock: true };
  }
  return { text: out + line.slice(last), opensBlock: false };
}

/** Mutable fence cursor for the pre-pass (R18 fix 3c: tracks the opener's
 *  marker char AND length so a shorter run cannot close a longer one). */
interface FenceCursor {
  open: boolean;
  char: string;
  len: number;
}

/**
 * R18 fix 3c: detect a code-fence opener line, markdown-it aligned — indent
 * <= 3 spaces, a run of >= 3 backticks or tildes; for backtick fences the info
 * string must not contain a backtick. Returns the marker char + run length, or
 * null when the line is not a fence opener.
 */
function fenceOpenInfo(line: string): { char: string; len: number } | null {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  const char = m[1][0];
  if (char === "`" && m[2].indexOf("`") >= 0) return null;
  return { char, len: m[1].length };
}

/**
 * R18 fix 3c: is `line` a valid closer for the open fence? markdown-it aligned —
 * indent <= 3, same marker char, run length >= the opener's, and only
 * whitespace after the marker run (no info string on a closer).
 */
function isFenceClose(line: string, char: string, len: number): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  if (!m) return false;
  return m[1][0] === char && m[1].length >= len;
}

/**
 * Advance the fence cursor for one line. Returns true when the line is itself a
 * fence marker (opener or closer) — such lines are emitted verbatim and never
 * get wikilink/comment processing. Shared by every entry point in the pre-pass
 * (R18 fix 3: frontmatter lines, comment-strip remainders) so the
 * preprocessor's fence view stays exactly in sync with markdown-it.
 */
function stepFence(line: string, fc: FenceCursor): boolean {
  if (!fc.open) {
    const open = fenceOpenInfo(line);
    if (open) {
      fc.open = true;
      fc.char = open.char;
      fc.len = open.len;
      return true;
    }
    return false;
  }
  if (isFenceClose(line, fc.char, fc.len)) {
    fc.open = false;
    fc.char = "";
    fc.len = 0;
    return true;
  }
  return false;
}

/**
 * Replace wikilinks with placeholders, skipping fenced blocks and inline code.
 * Replacements are inline-only so source line numbers stay stable (the task
 * checkbox toggle relies on that).
 *
 * R18 pre-pass order (frozen contract): fence tracking → frontmatter
 * exclusion → %%comment%% stripping → trailing block-marker stripping →
 * wikilink placeholders.
 */
function replaceWikilinks(
  source: string,
  links: WikiLinkInfo[],
  resolve: (target: string) => string | null,
  opts?: RenderMarkdownOptions,
): string {
  const resolveEmbed = opts?.resolveEmbed;
  const lines = source.split("\n");
  const fmLines = frontmatterLineCount(lines);
  const fc: FenceCursor = { open: false, char: "", len: 0 };
  let inComment = false;
  const out = lines.map((rawLine, lineIdx) => {
    let line = rawLine;
    // R18 fix 3b: leading frontmatter is excluded from wikilink/comment/marker
    // processing, but it STILL participates in fence parity tracking — a fence
    // opener inside the YAML block leaves markdown-it (which has no frontmatter
    // support) inside a fence for the body, and the pre-pass must agree or a
    // body wikilink leaks into the fence. (inComment is always false here:
    // frontmatter is the document head.)
    if (lineIdx < fmLines) {
      stepFence(line, fc);
      return line;
    }
    if (inComment) {
      // inside a multi-line %%block%%: the comment swallows everything (fence
      // markers included — the comment opened first). Whole lines are cleared
      // to "" so source line numbers stay stable.
      const close = line.indexOf("%%");
      if (close < 0) return "";
      inComment = false;
      // text after the closing %% stays and participates in rendering below
      line = line.slice(close + 2);
      // R18 fix 3a: the remainder after a block comment closes may itself be a
      // fence marker — re-run fence detection so it is not treated as prose.
      if (stepFence(line, fc)) return line;
      if (fc.open) return line;
    } else {
      // fence takes priority (frozen contract); fix 3c: char + length aware
      if (stepFence(line, fc)) return line;
      if (fc.open) return line;
    }
    // R18: %%comment%% stripping (fences take priority above; frontmatter is
    // excluded; inline-code `%%` neither strips nor opens a block)
    if (line.includes("%%")) {
      const stripped = stripLineComments(line);
      line = stripped.text;
      if (stripped.opensBlock) {
        inComment = true;
      } else {
        // R18 fix 3a: a paired-comment strip can expose a fence marker
        // (e.g. "%%c%% ```js" → " ```js") — re-run fence detection on the
        // remainder so the now-revealed fence is honoured.
        if (stepFence(line, fc)) return line;
        if (fc.open) return line;
      }
    }
    // R13 (intentional all-callers change): drop a trailing `^block-id`
    // marker before inline processing — Obsidian's reading view never renders
    // block markers. Inline-only, so source line numbers stay stable. A
    // marker inside a trailing inline-code span cannot match (such a line
    // ends with a backtick, which the regex rejects).
    const stripped = line.replace(BLOCK_MARKER_RE, "");
    // odd segments are inline code spans — leave them untouched
    return stripped
      .split(/(`+[^`]*`+)/g)
      .map((seg, i) => {
        if (i % 2 === 1) return seg;
        return seg.replace(WIKILINK_RE, (raw, bang: string, inner: string) => {
          const target = wikilinkTarget(inner);
          const pipe = inner.indexOf("|");
          const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : "";
          const display = alias || inner.split("|")[0].trim();
          // raw text between '#' and '|' ("" when absent) — R12 noteSubpath
          // rule, reused for plain-link data-subpath in R14
          const pre = pipe >= 0 ? inner.slice(0, pipe) : inner;
          const hash = pre.indexOf("#");
          const subpath = hash >= 0 ? pre.slice(hash + 1) : "";
          if (!target) {
            // R16: [[#h]] / [[#^id]] — empty target + subpath links to the
            // current note. Display keeps the inner text incl. "#" (same as
            // [[note#h]] showing "note#h"). Subpath existence is checked on
            // click, not at render time (Obsidian behaviour). The embed form
            // ![[#h]] (out of scope this round) and pathological subpath-less
            // [[...]] keep the raw text, byte-identical to before.
            if (bang || !subpath) return raw;
            links.push({ target: "", display, subpath, selfLink: true });
            return `@@GEODELINK${links.length - 1}@@`;
          }
          if (bang && resolveEmbed) {
            const resolved = resolveEmbed(target);
            const ext = resolved?.split(".").pop()?.toLowerCase() ?? "";
            if (resolved !== null && IMAGE_EXTS.has(ext)) {
              // the whole `![[...]]` becomes the embed placeholder. R61: a
              // numeric alias is a size, not a caption → strip it from alt
              // (which falls back to the filename, as Obsidian does).
              const size = parseEmbedSize(alias);
              links.push({
                target,
                display: size ? inner.split("|")[0].trim() : display,
                embedPath: resolved,
                embedWidth: size?.width,
                embedHeight: size?.height,
              });
              return `@@GEODELINK${links.length - 1}@@`;
            }
            // R26: audio/video/pdf attachment → file-embed placeholder (the
            // extension drives the element kind at hydration; PDF carries its
            // page anchor in subpath). Non-media attachments (zip/…) fall
            // through to the legacy link path, byte-identical to before.
            if (resolved !== null && fileEmbedKind(ext) !== null) {
              links.push({
                target,
                display,
                fileEmbedPath: resolved,
                fileEmbedExt: ext,
                subpath: subpath || undefined,
              });
              return `@@GEODELINK${links.length - 1}@@`;
            }
          }
          if (bang && opts?.noteEmbeds) {
            // R12: not an image embed — try a note transclusion placeholder
            const notePath = resolve(target);
            if (notePath !== null) {
              links.push({
                target,
                // alias-else-pre-pipe (same rule as the image branch and the
                // live-preview widget — keeps both render paths isomorphic)
                display: alias || pre.trim(),
                notePath,
                noteSubpath: subpath,
              });
              return `@@GEODELINK${links.length - 1}@@`;
            }
          }
          // legacy path: a leading "!" stays as literal text before the link.
          // R14: the raw subpath rides along (undefined when empty) so the
          // anchor can carry data-subpath; subpath-less output is unchanged.
          links.push({ target, display, subpath: subpath || undefined });
          return `${bang}@@GEODELINK${links.length - 1}@@`;
        });
      })
      .join("");
  });
  return out.join("\n");
}

/* ---------------- markdown-it instance + custom rules ---------------- */

const md = new MarkdownIt({ html: false, linkify: true });

// open external links in a new context; degrade placeholder destinations
// (e.g. [text]([[x]])) to "#" so no placeholder ever survives into an attribute
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  let href = token.attrGet("href") ?? "";
  if (PLACEHOLDER_TEST.test(href)) {
    href = "#";
    token.attrSet("href", href);
  }
  if (/^https?:/i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener");
    token.attrJoin("class", "external-link");
  } else if (href !== "#") {
    // R71: a non-external href resolving to a NOTE → internal-link anchor that
    // reuses the wikilink data-target + click path (openWikilink re-resolves the
    // full vault path → opens it, never the create-note branch). Only `.md`
    // notes: attachment md links would hit openWikilink's note-only resolver and
    // wrongly create a note, so they keep the legacy `<a href>` (byte-identical).
    const resolveMd = (env as PreviewEnv).geodeResolveMdLink;
    const resolved = resolveMd ? resolveMd(href) : null;
    if (resolved !== null && /\.md$/i.test(resolved)) {
      token.attrSet("href", "#");
      token.attrSet("class", "internal-link");
      token.attrSet("data-target", resolved);
      const hashAt = href.indexOf("#");
      if (hashAt !== -1) {
        let anchor = href.slice(hashAt + 1);
        try {
          anchor = decodeURIComponent(anchor);
        } catch {
          /* malformed %xx — keep raw */
        }
        if (anchor) token.attrSet("data-subpath", anchor);
      }
    }
  }
  return self.renderToken(tokens, idx, options);
};

const defaultImageRule = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = token.attrGet("src") ?? "";
  if (PLACEHOLDER_TEST.test(src)) token.attrSet("src", "#");
  if (defaultImageRule) return defaultImageRule(tokens, idx, options, env, self);
  return self.renderToken(tokens, idx, options);
};

/* ---------------- R19: ```mermaid fence → hydration placeholder ---------------- */

// The first word of the info string (unescapeAll + trim, exactly how the
// default fence renderer derives the language) must equal "mermaid"
// case-sensitively; everything else falls through to the default renderer so
// ordinary fences stay byte-identical. The placeholder keeps the escaped
// source visible (math fallback-readability precedent) until core/embeds.ts
// swaps it for the rendered SVG; data-mermaid carries the same source for
// that hydration.
const defaultFenceRule = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const lang = unescapeAll(token.info).trim().split(/\s+/g)[0];
  if (lang === "mermaid") {
    const src = escapeHtml(token.content.trimEnd());
    return `<div class="geode-mermaid" data-mermaid="${src}"><pre class="geode-mermaid-source"><code>${src}</code></pre></div>\n`;
  }
  if (defaultFenceRule) return defaultFenceRule(tokens, idx, options, env, self);
  return self.renderToken(tokens, idx, options);
};

/* ---------------- R18: ==highlight== (inline rule, delimiter method) ---------------- */

// `==text==` → <mark>, mirroring markdown-it's built-in strikethrough
// mechanics (scanDelims flanking: the delimiters must hug non-whitespace);
// lone/unpaired `==` stays literal via the unpaired-delimiter fallback.
md.inline.ruler.before("emphasis", "geode-highlight", (state, silent) => {
  const start = state.pos;
  const marker = state.src.charCodeAt(start);
  if (silent) return false;
  if (marker !== 0x3d /* = */) return false;
  const scanned = state.scanDelims(state.pos, true);
  let len = scanned.length;
  if (len < 2) return false;
  if (len % 2) {
    const token = state.push("text", "", 0);
    token.content = "=";
    len--;
  }
  for (let i = 0; i < len; i += 2) {
    const token = state.push("text", "", 0);
    token.content = "==";
    state.delimiters.push({
      marker,
      length: 0, // disable "rule of 3" length checks meant for emphasis
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.can_open,
      close: scanned.can_close,
    });
  }
  state.pos += scanned.length;
  return true;
});

interface HighlightDelimiter {
  marker: number;
  end: number;
  token: number;
}

function highlightPostProcess(
  state: { tokens: { type: string; tag: string; nesting: number; markup: string; content: string }[] },
  delimiters: HighlightDelimiter[],
): void {
  const loneMarkers: number[] = [];
  for (let i = 0; i < delimiters.length; i++) {
    const startDelim = delimiters[i];
    if (startDelim.marker !== 0x3d /* = */ || startDelim.end === -1) continue;
    const endDelim = delimiters[startDelim.end];
    let token = state.tokens[startDelim.token];
    token.type = "mark_open";
    token.tag = "mark";
    token.nesting = 1;
    token.markup = "==";
    token.content = "";
    token = state.tokens[endDelim.token];
    token.type = "mark_close";
    token.tag = "mark";
    token.nesting = -1;
    token.markup = "==";
    token.content = "";
    if (
      state.tokens[endDelim.token - 1].type === "text" &&
      state.tokens[endDelim.token - 1].content === "="
    ) {
      loneMarkers.push(endDelim.token - 1);
    }
  }
  // odd-length runs leave a lone "=" before the closer — move it after the
  // mark_close tags (same fixup the built-in strikethrough performs)
  while (loneMarkers.length) {
    const i = loneMarkers.pop()!;
    let j = i + 1;
    while (j < state.tokens.length && state.tokens[j].type === "mark_close") j++;
    j--;
    if (i !== j) {
      const token = state.tokens[j];
      state.tokens[j] = state.tokens[i];
      state.tokens[i] = token;
    }
  }
}

md.inline.ruler2.before("emphasis", "geode-highlight", (state) => {
  highlightPostProcess(state, state.delimiters);
  for (const meta of state.tokens_meta) {
    if (meta && meta.delimiters) highlightPostProcess(state, meta.delimiters);
  }
  return true;
});

/* ---------------- R18: footnotes ---------------- */

/** Footnote definition line: `[^id]:` + content (id charset frozen by the
 *  contract: `[^\s\[\]]+`, case-sensitive). */
const FOOTNOTE_DEF_RE = /^\[\^([^\s[\]]+)\]:[ \t]*(.*)$/;
const FOOTNOTE_ID_RE = /^[^\s[\]]+$/;

function footnoteRefHtml(seq: number, n: number): string {
  return `<sup class="footnote-ref"><a id="fnref-${seq}-${n}" href="#fn-${seq}-${n}" class="footnote-link" data-footnote="${n}">[${n}]</a></sup>`;
}

// definition block rule: collects `[^id]: content` (+ continuation lines
// indented by >= 2 spaces, merged into the same paragraph) into the env and
// emits no tokens — definitions never render in place.
md.block.ruler.before(
  "reference",
  "geode-footnote-def",
  (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (start + 4 > max) return false;
    if (state.src.charCodeAt(start) !== 0x5b /* [ */) return false;
    if (state.src.charCodeAt(start + 1) !== 0x5e /* ^ */) return false;
    const m = FOOTNOTE_DEF_RE.exec(state.src.slice(start, max));
    if (!m) return false;
    if (silent) return true;
    const body = [m[2]];
    let next = startLine + 1;
    while (next < endLine) {
      if (state.isEmpty(next) || state.sCount[next] - state.blkIndent < 2) break;
      const cStart = state.bMarks[next] + state.tShift[next];
      body.push(state.src.slice(cStart, state.eMarks[next]));
      next++;
    }
    const fn = footnoteState(state.env as PreviewEnv);
    if (!fn.defs.has(m[1])) fn.defs.set(m[1], body.join("\n").trim());
    state.line = next;
    return true;
  },
  { alt: ["paragraph", "reference"] },
);

// inline footnote `^[text]` — collects an anonymous definition on the spot
// (numbered by its own first-reference position)
md.inline.ruler.after("image", "geode-footnote-inline", (state, silent) => {
  const start = state.pos;
  const max = state.posMax;
  if (start + 2 >= max) return false;
  if (state.src.charCodeAt(start) !== 0x5e /* ^ */) return false;
  if (state.src.charCodeAt(start + 1) !== 0x5b /* [ */) return false;
  const labelEnd = state.md.helpers.parseLinkLabel(state, start + 1);
  if (labelEnd < 0) return false;
  if (silent) return false;
  const fn = footnoteState(state.env as PreviewEnv);
  fn.list.push(state.src.slice(start + 2, labelEnd));
  const token = state.push("html_inline", "", 0);
  token.content = footnoteRefHtml(fn.seq, fn.list.length);
  state.pos = labelEnd + 1;
  return true;
});

// footnote reference `[^id]` — only ids with a collected definition render
// (undefined references stay literal, `[^` included); the number is the
// first-reference order, repeat references share it.
md.inline.ruler.after("geode-footnote-inline", "geode-footnote-ref", (state, silent) => {
  const start = state.pos;
  const max = state.posMax;
  if (start + 3 >= max) return false;
  if (state.src.charCodeAt(start) !== 0x5b /* [ */) return false;
  if (state.src.charCodeAt(start + 1) !== 0x5e /* ^ */) return false;
  const close = state.src.indexOf("]", start + 2);
  if (close < 0 || close >= max) return false;
  const id = state.src.slice(start + 2, close);
  if (!FOOTNOTE_ID_RE.test(id)) return false;
  const fn = (state.env as PreviewEnv).geodeFootnotes;
  if (!fn || !fn.defs.has(id)) return false;
  if (silent) return false;
  let n = fn.order.get(id);
  if (n === undefined) {
    fn.list.push(fn.defs.get(id)!);
    n = fn.list.length;
    fn.order.set(id, n);
  }
  const token = state.push("html_inline", "", 0);
  token.content = footnoteRefHtml(fn.seq, n);
  state.pos = close + 1;
  return true;
});

/* ---------------- R18: math ($...$ inline, $$...$$ block) ---------------- */

/** true when src[pos] is preceded by an odd number of backslashes */
function isEscapedAt(src: string, pos: number): boolean {
  let backslashes = 0;
  for (let i = pos - 1; i >= 0 && src.charCodeAt(i) === 0x5c /* \ */; i--) backslashes++;
  return backslashes % 2 === 1;
}

function isWsCode(ch: number): boolean {
  return ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d;
}

function mathHtml(tex: string, block: boolean): string {
  const esc = escapeHtml(tex);
  const cls = block ? "geode-math geode-math-block" : "geode-math geode-math-inline";
  const tag = block ? "div" : "span";
  // data-math carries the source for hydration; the text content is the same
  // escaped source so an unhydrated document stays readable
  return `<${tag} class="${cls}" data-math="${esc}">${esc}</${tag}>`;
}

// block math: a line starting (indent <= 3) with `$$`, through the closing
// `$$` line — the single-line `$$x$$` form included. Unterminated `$$` is NOT
// a math block (the text stays literal).
md.block.ruler.before(
  "fence",
  "geode-math-block",
  (state, startLine, endLine, silent) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (start + 2 > max) return false;
    if (state.src.charCodeAt(start) !== 0x24 /* $ */) return false;
    if (state.src.charCodeAt(start + 1) !== 0x24) return false;
    const firstRest = state.src.slice(start + 2, max);
    let tex: string;
    let nextLine: number;
    const firstTrimmed = firstRest.trimEnd();
    // R18 fix 2: a `$$` on the opener line that is NOT the trailing closer means
    // this is not a block opener (e.g. `$$x$$ foo`). Aligning with the live
    // opener and the "`$$x$$ foo` stays literal as one paragraph" frozen ruling,
    // bail out so the line is handled by inline/paragraph rendering — never let
    // the cross-line scan swallow following paragraphs / a later valid block.
    const innerClose = firstTrimmed.indexOf("$$");
    if (innerClose >= 0 && innerClose !== firstTrimmed.length - 2) return false;
    if (firstTrimmed.endsWith("$$")) {
      // single-line `$$x$$`
      tex = firstTrimmed.slice(0, -2);
      nextLine = startLine + 1;
    } else {
      let found = -1;
      for (let ln = startLine + 1; ln < endLine; ln++) {
        const text = state.src.slice(state.bMarks[ln] + state.tShift[ln], state.eMarks[ln]);
        // R18 fix 4: stop at a code-fence opener (indent <= 3, ``` or ~~~) —
        // an unclosed `$$` must not reach across a fence and false-close on a
        // line like `echo $$`, stealing the fence opener. Abort = treat the
        // `$$` as unterminated, so it stays literal.
        if (state.sCount[ln] - state.blkIndent < 4 && /^(`{3,}|~{3,})/.test(text)) return false;
        if (text.trimEnd().endsWith("$$")) {
          found = ln;
          break;
        }
      }
      if (found < 0) return false;
      const chunks: string[] = [];
      if (firstRest.trim()) chunks.push(firstRest);
      for (let ln = startLine + 1; ln < found; ln++) {
        chunks.push(state.src.slice(state.bMarks[ln] + state.tShift[ln], state.eMarks[ln]));
      }
      const closing = state.src
        .slice(state.bMarks[found] + state.tShift[found], state.eMarks[found])
        .trimEnd()
        .slice(0, -2);
      if (closing.trim()) chunks.push(closing);
      tex = chunks.join("\n");
      nextLine = found + 1;
    }
    if (silent) return true;
    const token = state.push("html_block", "", 0);
    token.block = true;
    token.map = [startLine, nextLine];
    token.content = mathHtml(tex.trim(), true);
    state.line = nextLine;
    return true;
  },
  { alt: ["paragraph", "reference", "blockquote", "list"] },
);

// inline math: a SINGLE `$` pair — `$$` never participates in inline pairing;
// the opening `$` must hug non-whitespace after it, the closing `$` must hug
// non-whitespace before it and must not be followed by a digit (currency
// guard: "$5 and $10" stays literal); no newlines inside. `\$` is exempt via
// markdown-it's escape rule (opening) / an explicit escape check (closing);
// fenced/inline code never reach this rule.
md.inline.ruler.after("escape", "geode-math-inline", (state, silent) => {
  const src = state.src;
  const start = state.pos;
  const max = state.posMax;
  if (src.charCodeAt(start) !== 0x24 /* $ */) return false;
  if (start + 1 >= max) return false;
  if (src.charCodeAt(start + 1) === 0x24) return false; // `$$` is inert here
  if (start > 0 && src.charCodeAt(start - 1) === 0x24 && !isEscapedAt(src, start - 1)) {
    return false; // second half of a `$$` run never opens
  }
  if (isWsCode(src.charCodeAt(start + 1))) return false; // opening must hug content
  let pos = start + 1;
  let close = -1;
  while (pos < max) {
    const ch = src.charCodeAt(pos);
    if (ch === 0x0a /* \n */) return false; // no newlines inside
    if (ch !== 0x24 || isEscapedAt(src, pos)) {
      pos++;
      continue;
    }
    let runEnd = pos + 1;
    while (runEnd < max && src.charCodeAt(runEnd) === 0x24) runEnd++;
    if (runEnd - pos > 1) {
      pos = runEnd; // a `$$` run never closes
      continue;
    }
    const prev = src.charCodeAt(pos - 1);
    if (isWsCode(prev) || (prev === 0x24 && !isEscapedAt(src, pos - 1))) {
      pos++;
      continue;
    }
    const next = runEnd < max ? src.charCodeAt(runEnd) : -1;
    if (next >= 0x30 && next <= 0x39) {
      pos++; // closing `$` followed by a digit — currency guard
      continue;
    }
    close = pos;
    break;
  }
  if (close < 0) return false;
  if (!silent) {
    const token = state.push("html_inline", "", 0);
    token.content = mathHtml(src.slice(start + 1, close), false);
  }
  state.pos = close + 1;
  return true;
});

/* ---------------- R18: callouts (core rule, blockquote token rewrite) ---------------- */

/** Callout marker line (frozen contract regex). */
const CALLOUT_RE = /^\[!([A-Za-z0-9_-]+)\]([+-]?)(?:[ \t]+(.*))?$/;

// Registered BEFORE the built-in "inline" core rule (R18 fix): at this point a
// blockquote's first inline child token already exists with its raw `.content`
// string (detection only needs that string) but `.children` is still null, so
// no inline tokenisation has happened yet. We rewrite the blockquote tokens and
// leave the callout title/body as un-parsed inline tokens (content set,
// children = []); the built-in inline rule then tokenises every segment exactly
// once. The previous after("inline") placement re-ran md.inline.parse on the
// title and body, double-collecting inline footnotes (`^[..]`) into env and
// producing ghost footnote items. linkify/text_join and the
// geode-task-lists/tags/wikilinks rules all run after inline, so callout title/
// body wikilinks, tags, tasks, external links and footnotes still work.
// Handles every nesting level: an inner callout's blockquote tokens survive the
// outer rewrite untouched and are visited later in the same forward scan.
md.core.ruler.before("inline", "geode-callouts", (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "blockquote_open") continue;
    // the marker must be the first line of a first-child paragraph
    const pOpen = tokens[i + 1];
    const inline = tokens[i + 2];
    const pClose = tokens[i + 3];
    if (
      !pOpen ||
      pOpen.type !== "paragraph_open" ||
      !inline ||
      inline.type !== "inline" ||
      !pClose ||
      pClose.type !== "paragraph_close"
    ) {
      continue;
    }
    const nl = inline.content.indexOf("\n");
    const firstLine = nl < 0 ? inline.content : inline.content.slice(0, nl);
    const m = CALLOUT_RE.exec(firstLine);
    if (!m) continue; // plain blockquote: byte-identical output
    let closeIdx = -1;
    for (let j = i, depth = 0; j < tokens.length; j++) {
      if (tokens[j].type === "blockquote_open") depth++;
      else if (tokens[j].type === "blockquote_close" && --depth === 0) {
        closeIdx = j;
        break;
      }
    }
    if (closeIdx < 0) continue;
    const typeRaw = m[1];
    const fold = m[2];
    const title = (m[3] ?? "").trim();
    let cls = "callout";
    if (fold) cls += " is-collapsible";
    if (fold === "-") cls += " is-collapsed";
    const openHtml =
      `<div class="${cls}" data-callout="${escapeHtml(typeRaw.toLowerCase())}"` +
      (fold ? ` data-callout-fold="${fold}"` : "") +
      `><div class="callout-title"><div class="callout-icon"></div><div class="callout-title-inner">`;
    const titleCloseHtml = `</div></div><div class="callout-content">`;

    // blockquote_close → close .callout-content + .callout
    const closeTok = tokens[closeIdx];
    closeTok.type = "html_block";
    closeTok.tag = "";
    closeTok.nesting = 0;
    closeTok.markup = "";
    closeTok.block = true;
    closeTok.content = "</div></div>";

    // blockquote_open → callout opener + title row
    const openTok = tokens[i];
    openTok.type = "html_block";
    openTok.tag = "";
    openTok.nesting = 0;
    openTok.markup = "";
    openTok.block = true;
    const insert: typeof tokens = [];
    if (title) {
      openTok.content = openHtml;
      const tInline = new state.Token("inline", "", 0);
      tInline.content = title;
      // children stay empty — the built-in inline rule (registered after this
      // one) tokenises the title exactly once. No manual md.inline.parse here.
      tInline.children = [];
      insert.push(tInline);
      const tClose = new state.Token("html_block", "", 0);
      tClose.block = true;
      tClose.content = titleCloseHtml;
      insert.push(tClose);
    } else {
      // no custom title: the typed word, first letter capitalized, as written
      // (aliases are not normalized — `[!tldr]` shows "Tldr")
      const fallback = typeRaw.charAt(0).toUpperCase() + typeRaw.slice(1);
      openTok.content = openHtml + escapeHtml(fallback) + titleCloseHtml;
    }
    if (insert.length) tokens.splice(i + 1, 0, ...insert);

    // first paragraph: drop the marker line; remaining lines stay in place
    // (inside .callout-content), an emptied paragraph is removed entirely
    const p = i + 1 + insert.length;
    const rest = nl < 0 ? "" : inline.content.slice(nl + 1);
    if (rest === "") {
      tokens.splice(p, 3);
    } else {
      // strip the marker line; the built-in inline rule (next) tokenises the
      // remaining first-paragraph content exactly once (children left empty).
      inline.content = rest;
      inline.children = [];
    }
  }
});

/* ---------------- R18: footnote section (core rule, document tail) ---------------- */

// Runs after the built-in inline rule (so every reference — including those in
// callout titles/bodies, which geode-callouts rewrote before inline — has been
// collected) and before linkify + the geode-tags/geode-wikilinks rules so
// definition bodies get the full inline treatment. Only referenced definitions
// render; the section is omitted entirely when nothing was referenced.
md.core.ruler.after("inline", "geode-footnotes-tail", (state) => {
  const fn = (state.env as PreviewEnv).geodeFootnotes;
  if (!fn || fn.list.length === 0) return;
  const tokens = state.tokens;
  const open = new state.Token("html_block", "", 0);
  open.block = true;
  open.content = `<hr class="footnotes-sep"><section class="footnotes"><ol class="footnotes-list">`;
  tokens.push(open);
  // fn.list can grow while iterating (a definition body may itself reference
  // further footnotes — first-reference numbering keeps this finite)
  for (let i = 0; i < fn.list.length; i++) {
    const n = i + 1;
    const liOpen = new state.Token("html_block", "", 0);
    liOpen.block = true;
    liOpen.content = `<li id="fn-${fn.seq}-${n}" class="footnote-item">`;
    tokens.push(liOpen);
    const inline = new state.Token("inline", "", 0);
    inline.content = fn.list[i];
    inline.children = [];
    state.md.inline.parse(inline.content, state.md, state.env, inline.children);
    tokens.push(inline);
    const liClose = new state.Token("html_block", "", 0);
    liClose.block = true;
    liClose.content = ` <a href="#fnref-${fn.seq}-${n}" class="footnote-backref">↩</a></li>`;
    tokens.push(liClose);
  }
  const close = new state.Token("html_block", "", 0);
  close.block = true;
  close.content = `</ol></section>`;
  tokens.push(close);
});

// "- [ ] task" → interactive checkbox carrying the source line number
md.core.ruler.push("geode-task-lists", (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (
      inline.type !== "inline" ||
      tokens[i - 1].type !== "paragraph_open" ||
      tokens[i - 2].type !== "list_item_open"
    ) {
      continue;
    }
    const first = inline.children?.[0];
    if (!first || first.type !== "text") continue;
    const m = first.content.match(TASK_RE);
    if (!m) continue;
    const checked = m[1] !== " ";
    const line = tokens[i - 2].map ? tokens[i - 2].map![0] : -1;
    first.content = first.content.slice(m[0].length);
    const checkbox = new state.Token("html_inline", "", 0);
    checkbox.content = `<input type="checkbox" class="task-checkbox" data-line="${line}"${
      checked ? " checked" : ""
    }>`;
    checkbox.level = first.level;
    inline.children!.unshift(checkbox);
    tokens[i - 2].attrJoin("class", "task-list-item");
    if (checked) tokens[i - 2].attrJoin("class", "is-checked");
  }
});

// #tags → pills
md.core.ruler.push("geode-tags", (state) => {
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const next: NonNullable<typeof block.children> = [];
    for (const child of block.children) {
      if (child.type !== "text") {
        next.push(child);
        continue;
      }
      const text = child.content;
      TAG_RE.lastIndex = 0;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = TAG_RE.exec(text))) {
        const start = m.index + m[1].length;
        const end = start + 1 + m[2].length;
        if (start > last) {
          const before = new state.Token("text", "", 0);
          before.content = text.slice(last, start);
          before.level = child.level;
          next.push(before);
        }
        const pill = new state.Token("html_inline", "", 0);
        pill.content = `<span class="tag-pill" data-tag="${escapeHtml(m[2])}">#${escapeHtml(m[2])}</span>`;
        pill.level = child.level;
        next.push(pill);
        last = end;
      }
      if (last === 0) {
        next.push(child);
        continue;
      }
      if (last < text.length) {
        const rest = new state.Token("text", "", 0);
        rest.content = text.slice(last);
        rest.level = child.level;
        next.push(rest);
      }
    }
    block.children = next;
  }
});

// wikilink placeholders → <a class="internal-link"> anchors, substituted in the
// token stream (TEXT tokens only) so attribute contexts and code stay untouched
md.core.ruler.push("geode-wikilinks", (state) => {
  const env = state.env as PreviewEnv;
  const links = env.geodeLinks;
  const resolve = env.geodeResolve;
  if (!links || !resolve) return;
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const next: NonNullable<typeof block.children> = [];
    for (const child of block.children) {
      if (child.type !== "text" || !PLACEHOLDER_TEST.test(child.content)) {
        next.push(child);
        continue;
      }
      const text = child.content;
      PLACEHOLDER_RE.lastIndex = 0;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = PLACEHOLDER_RE.exec(text))) {
        if (m.index > last) {
          const before = new state.Token("text", "", 0);
          before.content = text.slice(last, m.index);
          before.level = child.level;
          next.push(before);
        }
        const info = links[Number(m[1])];
        if (!info) {
          const raw = new state.Token("text", "", 0);
          raw.content = m[0];
          raw.level = child.level;
          next.push(raw);
        } else if (info.embedPath !== undefined) {
          // image embed: src is hydrated asynchronously by the caller. R61:
          // a numeric alias adds width/height attrs (values are validated
          // integers from parseEmbedSize → no escaping needed).
          const w = info.embedWidth !== undefined ? ` width="${info.embedWidth}"` : "";
          const h = info.embedHeight !== undefined ? ` height="${info.embedHeight}"` : "";
          const img = new state.Token("html_inline", "", 0);
          img.content = `<img class="geode-embed" data-embed-path="${escapeHtml(info.embedPath)}" alt="${escapeHtml(info.display)}"${w}${h}>`;
          img.level = child.level;
          next.push(img);
        } else if (info.fileEmbedPath !== undefined) {
          // R26: media file embed (audio/video/pdf) — an empty container the
          // caller hydrates via the shared engine (core/embeds.ts hydrateFile)
          const sub = info.subpath ? ` data-embed-subpath="${escapeHtml(info.subpath)}"` : "";
          const span = new state.Token("html_inline", "", 0);
          span.content = `<span class="geode-embed-file" data-embed-path="${escapeHtml(info.fileEmbedPath)}" data-embed-ext="${escapeHtml(info.fileEmbedExt ?? "")}"${sub} data-embed-display="${escapeHtml(info.display)}"></span>`;
          span.level = child.level;
          next.push(span);
        } else if (info.notePath !== undefined) {
          // note transclusion: an empty container, expanded asynchronously by
          // the caller via the shared hydration engine (core/embeds.ts)
          const span = new state.Token("html_inline", "", 0);
          span.content = `<span class="geode-embed-note" data-embed-note="${escapeHtml(info.notePath)}" data-embed-subpath="${escapeHtml(info.noteSubpath ?? "")}" data-embed-display="${escapeHtml(info.display)}"></span>`;
          span.level = child.level;
          next.push(span);
        } else {
          // R16: a self-link ([[#h]], empty target) always renders resolved —
          // it points at the rendering note itself; never call resolve("")
          const resolved = info.selfLink === true || resolve(info.target) !== null;
          const cls = resolved ? "internal-link" : "internal-link is-unresolved";
          // R14: subpath links carry the raw text after '#' (escaped);
          // links without a subpath stay byte-identical
          const sub = info.subpath ? ` data-subpath="${escapeHtml(info.subpath)}"` : "";
          const anchor = new state.Token("html_inline", "", 0);
          anchor.content = `<a class="${cls}" data-target="${escapeHtml(info.target)}"${sub} href="#">${escapeHtml(info.display)}</a>`;
          anchor.level = child.level;
          next.push(anchor);
        }
        last = m.index + m[0].length;
      }
      if (last < text.length) {
        const rest = new state.Token("text", "", 0);
        rest.content = text.slice(last);
        rest.level = child.level;
        next.push(rest);
      }
    }
    block.children = next;
  }
});

/* ---------------- public API ---------------- */

export function renderMarkdownToHtml(
  source: string,
  resolve: (target: string) => string | null,
  opts?: RenderMarkdownOptions,
): string {
  const links: WikiLinkInfo[] = [];
  const pre = replaceWikilinks(source, links, resolve, opts);
  const env: PreviewEnv = {
    geodeLinks: links,
    geodeResolve: resolve,
    geodeResolveMdLink: opts?.resolveMdLink,
  };
  return md.render(pre, env);
}
