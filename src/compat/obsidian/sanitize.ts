/**
 * sanitizeHTMLToDom(html) — Obsidian's HTML sanitizer. Returns a sanitized DocumentFragment
 * safe to adopt into the live DOM. SECURITY-SENSITIVE: conservative allowlist (deny by default).
 *
 * - <template>.innerHTML parses INERT (scripts don't run, resources don't load until adopted),
 *   and we return the fragment directly (no serialize→re-parse, avoiding mutation-XSS).
 * - Iterative TreeWalker (no recursion → no deep-nesting stack-overflow DoS); attributes are
 *   scrubbed in-place during the walk, structural removals/unwraps applied AFTER the walk.
 */
const FORBID_DROP = new Set([
  "script", "style", "iframe", "object", "embed", "noscript", "template", "link", "meta", "base",
  "head", "title", "svg", "math", "applet", "frame", "frameset", "form", "input", "button",
  "textarea", "select", "option", "audio", "video", "source", "track",
]);
const ALLOWED_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "blockquote", "br", "caption", "cite", "code", "col", "colgroup",
  "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2", "h3",
  "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "rp", "rt",
  "ruby", "s", "samp", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td",
  "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr",
]);
const ALLOWED_ATTRS = new Set([
  "class", "id", "title", "alt", "dir", "lang", "role", "colspan", "rowspan", "span", "start",
  "reversed", "datetime", "cite", "type", "width", "height", "align", "valign", "scope", "headers",
  "abbr",
]);
const URL_ATTRS = new Set(["href", "src"]);

/** True if a URL attribute value is safe to keep. Strips ALL control chars + whitespace before
 *  scheme detection — browsers ignore tabs/newlines inside a scheme ("java\tscript:" executes),
 *  so they must not hide the scheme. Allows relative/anchor + http/https/mailto/tel; rejects
 *  javascript:/vbscript:/data:/file:/etc. */
function isSafeUrl(value: string): boolean {
  const v = value.replace(/[\x00-\x20 ]+/g, "").toLowerCase();
  if (v === "" || v.startsWith("#")) return true;
  const m = /^([a-z][a-z0-9+.-]*):/.exec(v);
  if (!m) return true; // no scheme = relative path
  const scheme = m[1];
  return scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel";
}

export function sanitizeHTMLToDom(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html ?? "";
  const frag = template.content;
  const forbid: Element[] = [];
  const unwrap: Element[] = [];
  const walker = document.createTreeWalker(
    frag,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT,
  );
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.COMMENT_NODE) {
      (n as ChildNode).remove();
      continue;
    }
    const el = n as Element;
    const tag = el.tagName.toLowerCase();
    if (FORBID_DROP.has(tag)) {
      forbid.push(el);
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      unwrap.push(el);
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
      } else if (name.startsWith("data-") || name.startsWith("aria-")) {
        // allowed prefixes
      } else if (URL_ATTRS.has(name)) {
        if (!isSafeUrl(attr.value)) el.removeAttribute(attr.name);
      } else if (!ALLOWED_ATTRS.has(name)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  for (const el of forbid) el.remove();
  for (const el of unwrap) {
    if (el.parentNode) el.replaceWith(...el.childNodes);
  }
  return frag;
}
