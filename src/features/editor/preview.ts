/**
 * Reading-view renderer: markdown-it (html disabled, linkify on) plus
 *  - wikilink pre-pass on the source ([[target|alias]] → placeholder → <a class="internal-link">)
 *  - #tag pills
 *  - interactive GFM task-list checkboxes carrying their source line number
 */
import MarkdownIt from "markdown-it";
import { wikilinkTarget } from "./wikilinks";

interface WikiLinkInfo {
  target: string;
  display: string;
}

const WIKILINK_RE = /\[\[([^\[\]]+?)\]\]/g;
const PLACEHOLDER_RE = /@@GEODELINK(\d+)@@/g;
const TAG_RE = /(^|[\s(])#([A-Za-z0-9_\/\-一-鿿]+)/g;
const TASK_RE = /^\[( |x|X)\]\s+/;

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
function replaceWikilinks(source: string, links: WikiLinkInfo[]): string {
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
        return seg.replace(WIKILINK_RE, (raw, inner: string) => {
          const target = wikilinkTarget(inner);
          if (!target) return raw;
          const pipe = inner.indexOf("|");
          const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : "";
          links.push({ target, display: alias || inner.split("|")[0].trim() });
          return `@@GEODELINK${links.length - 1}@@`;
        });
      })
      .join("");
  });
  return out.join("\n");
}

/* ---------------- markdown-it instance + custom rules ---------------- */

const md = new MarkdownIt({ html: false, linkify: true });

// open external links in a new context
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx];
  const href = token.attrGet("href") ?? "";
  if (/^https?:/i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener");
    token.attrJoin("class", "external-link");
  }
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

/* ---------------- public API ---------------- */

export function renderPreview(
  source: string,
  resolve: (target: string) => string | null,
): string {
  const links: WikiLinkInfo[] = [];
  const pre = replaceWikilinks(source, links);
  const html = md.render(pre);
  return html.replace(PLACEHOLDER_RE, (raw, idx: string) => {
    const info = links[Number(idx)];
    if (!info) return raw;
    const resolved = resolve(info.target) !== null;
    const cls = resolved ? "internal-link" : "internal-link is-unresolved";
    return `<a class="${cls}" data-target="${escapeHtml(info.target)}" href="#">${escapeHtml(info.display)}</a>`;
  });
}

/** Toggle the "[ ]"/"[x]" marker on a given 0-based line. Returns null if not a task line. */
export function toggleTaskOnLine(source: string, line: number): string | null {
  const lines = source.split("\n");
  if (line < 0 || line >= lines.length) return null;
  const replaced = lines[line].replace(
    /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/,
    (_m, pre: string, mark: string, post: string) => pre + (mark === " " ? "x" : " ") + post,
  );
  if (replaced === lines[line]) return null;
  lines[line] = replaced;
  return lines.join("\n");
}
