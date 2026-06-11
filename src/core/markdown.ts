/**
 * Markdown → HTML pipeline (moved verbatim from features/editor/preview.ts in R6
 * so the compat layer's MarkdownRenderer can reuse it — core never imports features):
 * markdown-it (html disabled, linkify on) plus
 *  - wikilink pre-pass on the source ([[target|alias]] → placeholder → <a class="internal-link">)
 *  - #tag pills
 *  - interactive GFM task-list checkboxes carrying their source line number
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
}

const WIKILINK_RE = /(!?)\[\[([^\[\]]+?)\]\]/g;
const PLACEHOLDER_RE = /@@GEODELINK(\d+)@@/g;
const PLACEHOLDER_TEST = /@@GEODELINK\d+@@/;
const TAG_RE = /(^|[\s(])#([A-Za-z0-9_\/\-一-鿿]+)/g;
const TASK_RE = /^\[( |x|X)\]\s+/;

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
  resolveEmbed?: (target: string) => string | null,
): string {
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
    // odd segments are inline code spans — leave them untouched
    return line
      .split(/(`+[^`]*`+)/g)
      .map((seg, i) => {
        if (i % 2 === 1) return seg;
        return seg.replace(WIKILINK_RE, (raw, bang: string, inner: string) => {
          const target = wikilinkTarget(inner);
          if (!target) return raw;
          const pipe = inner.indexOf("|");
          const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : "";
          const display = alias || inner.split("|")[0].trim();
          if (bang && resolveEmbed) {
            const resolved = resolveEmbed(target);
            const ext = resolved?.split(".").pop()?.toLowerCase() ?? "";
            if (resolved !== null && IMAGE_EXTS.has(ext)) {
              // the whole `![[...]]` becomes the embed placeholder
              links.push({ target, display, embedPath: resolved });
              return `@@GEODELINK${links.length - 1}@@`;
            }
          }
          // legacy path: a leading "!" stays as literal text before the link
          links.push({ target, display });
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
        } else {
          const resolved = resolve(info.target) !== null;
          const cls = resolved ? "internal-link" : "internal-link is-unresolved";
          const anchor = new state.Token("html_inline", "", 0);
          anchor.content = `<a class="${cls}" data-target="${escapeHtml(info.target)}" href="#">${escapeHtml(info.display)}</a>`;
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
  const pre = replaceWikilinks(source, links, opts?.resolveEmbed);
  const env: PreviewEnv = { geodeLinks: links, geodeResolve: resolve };
  return md.render(pre, env);
}
