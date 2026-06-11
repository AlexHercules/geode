/**
 * core/embeds.ts — shared embed hydration engine (R12).
 *
 * Walks a rendered preview/export DOM and fills the placeholders that
 * core/markdown.ts emits:
 *  - `img.geode-embed[data-embed-path]` gets its src from ctx.imageSrc
 *    (editor passes blob URLs, export passes data: URIs); a failure only
 *    marks the img `.geode-embed-failed`.
 *  - `span.geode-embed-note` is expanded into a note transclusion: header
 *    link + rendered note content (optionally sliced to a heading section or
 *    a `^block-id` block, R13), then hydrated recursively.
 *
 * Guard rails (self-defined — Obsidian documents no nesting/cycle limits):
 * depth >= 5 renders a plain link sign; a cycle (embedded path already in
 * ctx.ancestors) renders a `.geode-embed-cycle` callout. The engine never
 * throws — any single failure degrades to a `.geode-embed-missing` callout.
 *
 * Shared by features/editor and features/export (feature modules never
 * import each other); core never imports React or features.
 */
import { t } from "./i18n";
import { renderMarkdownToHtml } from "./markdown";
import type { MetadataIndex } from "./metadata";
import type { Vault } from "./vault";

export interface HydrateContext {
  vault: Vault;
  metadata: MetadataIndex;
  /** image src provider — editor passes blob URLs, export passes data: URIs */
  imageSrc(path: string): Promise<string>;
  /** recursion depth of this root (default 0) */
  depth?: number;
  /** ancestor note paths, including the current root note (cycle detection) */
  ancestors?: ReadonlySet<string>;
}

/** Nesting guard (self-defined; Obsidian documents no limit). */
const MAX_EMBED_DEPTH = 5;

/** Trailing `^block-id` marker at a line end (R13, frozen contract regex). */
const BLOCK_MARKER_RE = /\s\^([A-Za-z0-9-]+)\s*$/;

/** Markdown-stripped, space-collapsed, lowercased heading text — mirrors
 *  Obsidian's stripHeading link-matching semantics (loose second pass only;
 *  the exact raw-text match always wins first). */
function stripHeadingText(text: string): string {
  return text
    .replace(/[*_`~]|\[\[|\]\]|[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** "folder/Note.md" → "Note" */
function noteName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

/** Degraded rendering: a plain internal link inside the container (depth
 *  limit). Clicks ride the caller's existing `a.internal-link` delegation —
 *  data-target resolves via resolveLink. */
function renderLinkSign(span: HTMLElement, path: string, display: string): void {
  span.textContent = "";
  const a = document.createElement("a");
  a.className = "internal-link";
  a.dataset.target = path;
  a.setAttribute("href", "#");
  a.textContent = display;
  span.appendChild(a);
}

/** Warning callout: swaps the placeholder class so only the callout styles
 *  apply (`.geode-embed-cycle` / `.geode-embed-missing`). */
function renderCallout(span: HTMLElement, cls: string, text: string): void {
  span.className = cls;
  span.textContent = text;
}

async function hydrateImage(img: HTMLImageElement, ctx: HydrateContext): Promise<void> {
  try {
    const path = img.getAttribute("data-embed-path") ?? "";
    const src = await ctx.imageSrc(path);
    img.addEventListener("error", () => img.classList.add("geode-embed-failed"), {
      once: true,
    });
    img.src = src;
  } catch {
    img.classList.add("geode-embed-failed");
  }
}

async function hydrateNote(
  span: HTMLElement,
  ctx: HydrateContext,
  depth: number,
  ancestors: ReadonlySet<string>,
): Promise<void> {
  const path = span.getAttribute("data-embed-note") ?? "";
  const subpath = (span.getAttribute("data-embed-subpath") ?? "").trim();
  const display = span.getAttribute("data-embed-display") || noteName(path);
  try {
    if (ancestors.has(path)) {
      renderCallout(span, "geode-embed-cycle", t("editor.embedCircular", { name: noteName(path) }));
      return;
    }
    if (depth >= MAX_EMBED_DEPTH) {
      renderLinkSign(span, path, display);
      return;
    }
    const content = await ctx.vault.read(path);
    let slice = content;
    if (subpath.startsWith("^")) {
      // R13: `#^block-id` — case-insensitive id match against the block
      // index; slice [from, to) and drop the trailing ` ^id` marker so it
      // never renders (the render pipeline strips line-end markers too, but
      // the contract calls for an explicit tail strip here)
      const id = subpath.slice(1);
      const lower = id.toLowerCase();
      const blocks = ctx.metadata.getMetadata(path)?.blocks ?? [];
      const hit = blocks.find((b) => b.id.toLowerCase() === lower);
      if (!hit) {
        renderCallout(
          span,
          "geode-embed-missing",
          t("editor.embedMissingBlock", { block: id, name: noteName(path) }),
        );
        return;
      }
      slice = content.slice(hit.from, hit.to).replace(BLOCK_MARKER_RE, "");
    } else if (subpath) {
      const headings = ctx.metadata.getMetadata(path)?.headings ?? [];
      const lower = subpath.toLowerCase();
      let idx = headings.findIndex((h) => h.text.toLowerCase() === lower);
      if (idx === -1) {
        // second pass: markdown-stripped comparison (Obsidian's stripHeading
        // semantics — "# **Bold**" is referenced as "![[note#Bold]]")
        const stripped = stripHeadingText(subpath);
        idx = headings.findIndex((h) => stripHeadingText(h.text) === stripped);
      }
      if (idx === -1) {
        renderCallout(
          span,
          "geode-embed-missing",
          t("editor.embedMissingHeading", { heading: subpath, name: noteName(path) }),
        );
        return;
      }
      // section = from the matched heading line up to (exclusive) the next
      // heading of the same or higher level — Obsidian behaviour
      const hit = headings[idx];
      let end = content.length;
      for (let i = idx + 1; i < headings.length; i++) {
        if (headings[i].level <= hit.level) {
          end = headings[i].from;
          break;
        }
      }
      slice = content.slice(hit.from, end);
    }

    // render with the EMBEDDED note as fromPath so its own relative links and
    // embeds resolve against it, not against the host note
    const html = renderMarkdownToHtml(slice, (target) => ctx.metadata.resolveLink(target, path), {
      resolveEmbed: (target) => ctx.metadata.resolveAttachment(target, path),
      noteEmbeds: true,
    });

    span.textContent = "";
    const header = document.createElement("span");
    header.className = "geode-embed-note-header";
    const link = document.createElement("a");
    link.className = "internal-link";
    link.dataset.target = path;
    link.setAttribute("href", "#");
    link.textContent = subpath ? `${noteName(path)} > ${subpath}` : noteName(path);
    header.appendChild(link);
    const body = document.createElement("span");
    body.className = "geode-embed-note-content";
    body.innerHTML = html;
    span.appendChild(header);
    span.appendChild(body);

    const childAncestors = new Set(ancestors);
    childAncestors.add(path);
    await hydrateEmbeds(body, { ...ctx, depth: depth + 1, ancestors: childAncestors });
  } catch (err) {
    console.warn(`[embeds] failed to hydrate note embed "${path}"`, err);
    renderCallout(span, "geode-embed-missing", display);
  }
}

/**
 * Hydrate every embed placeholder under `root` (see module header). Resolves
 * when all images are filled and all note transclusions (including nested
 * ones) are expanded. Never rejects — failures degrade per element.
 */
export async function hydrateEmbeds(root: HTMLElement, ctx: HydrateContext): Promise<void> {
  try {
    const depth = ctx.depth ?? 0;
    const ancestors = ctx.ancestors ?? new Set<string>();
    const imgs = Array.from(
      root.querySelectorAll<HTMLImageElement>("img.geode-embed[data-embed-path]"),
    );
    const spans = Array.from(root.querySelectorAll<HTMLElement>("span.geode-embed-note"));
    await Promise.all([
      ...imgs.map((img) => hydrateImage(img, ctx)),
      ...spans.map((span) => hydrateNote(span, ctx, depth, ancestors)),
    ]);
  } catch (err) {
    // defensive: per-element handlers already swallow their own failures
    console.warn("[embeds] hydration walk failed", err);
  }
}
