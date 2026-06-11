/**
 * Markdown → HTML pipeline (moved verbatim from features/editor/preview.ts in R6
 * so the compat layer's MarkdownRenderer can reuse it — core never imports features):
 * markdown-it (html disabled, linkify on) plus
 *  - wikilink pre-pass on the source ([[target|alias]] → placeholder → <a class="internal-link">)
 *  - #tag pills
 *  - interactive GFM task-list checkboxes carrying their source line number
 *  - trailing `^block-id` markers stripped outside fences (R13, all callers)
 */
import MarkdownIt from "markdown-it";

/** Extract the link target from the inside of a [[...]] span (drops alias + heading). */
export function wikilinkTarget(inner: string): string {
  return inner.split("|")[0].split("#")[0].trim();
}

interface WikiLinkInfo {
  target: string;
  display: string;
  /** set ⇒ render an image embed placeholder instead of an internal-link anchor */
  embedPath?: string;
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
}

const WIKILINK_RE = /(!?)\[\[([^\[\]]+?)\]\]/g;
const PLACEHOLDER_RE = /@@GEODELINK(\d+)@@/g;
const PLACEHOLDER_TEST = /@@GEODELINK\d+@@/;
const TAG_RE = /(^|[\s(])#([A-Za-z0-9_\/\-一-鿿]+)/g;
const TASK_RE = /^\[( |x|X)\]\s+/;
/** Trailing `^block-id` marker at a line end (R13, frozen contract regex). */
const BLOCK_MARKER_RE = /\s\^([A-Za-z0-9-]+)\s*$/;

/** per-render data passed through markdown-it's env (md is a module singleton) */
interface PreviewEnv {
  geodeLinks?: WikiLinkInfo[];
  geodeResolve?: (target: string) => string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Replace wikilinks with placeholders, skipping fenced blocks and inline code.
 * Replacements are inline-only so source line numbers stay stable (the task
 * checkbox toggle relies on that).
 */
function replaceWikilinks(
  source: string,
  links: WikiLinkInfo[],
  resolve: (target: string) => string | null,
  opts?: RenderMarkdownOptions,
): string {
  const resolveEmbed = opts?.resolveEmbed;
  const lines = source.split("\n");
  let inFence = false;
  let fenceChar = "";
  const out = lines.map((line) => {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (fence[1][0] === fenceChar) {
        inFence = false;
      }
      return line;
    }
    if (inFence) return line;
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
              // the whole `![[...]]` becomes the embed placeholder
              links.push({ target, display, embedPath: resolved });
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
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
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
          // image embed: src is hydrated asynchronously by the caller
          const img = new state.Token("html_inline", "", 0);
          img.content = `<img class="geode-embed" data-embed-path="${escapeHtml(info.embedPath)}" alt="${escapeHtml(info.display)}">`;
          img.level = child.level;
          next.push(img);
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
  const env: PreviewEnv = { geodeLinks: links, geodeResolve: resolve };
  return md.render(pre, env);
}
