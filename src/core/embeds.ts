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
import { loadKatex } from "./math";
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
  /** R18 math hydration output: "html" needs the injected KaTeX CSS (in-app
   *  views, default); "mathml" is self-contained (export/print). Propagated
   *  recursively into nested note transclusions. */
  mathOutput?: "html" | "mathml";
}

/** Nesting guard (self-defined; Obsidian documents no limit). */
const MAX_EMBED_DEPTH = 5;

/** Trailing `^block-id` marker at a line end (R13, frozen contract regex). */
const BLOCK_MARKER_RE = /\s\^([A-Za-z0-9-]+)\s*$/;
// stripHeadingText moved to core/metadata.ts in R14 — heading/block matching
// now lives entirely in MetadataIndex.resolveSubpath.

/** "folder/Note.md" → "Note" */
function noteName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

/** Degraded rendering: a plain internal link inside the container (depth
 *  limit). Clicks ride the caller's existing `a.internal-link` delegation —
 *  data-target resolves via resolveLink. */
function renderLinkSign(span: HTMLElement, path: string, display: string, subpath: string): void {
  span.textContent = "";
  const a = document.createElement("a");
  a.className = "internal-link";
  a.dataset.target = path;
  // R14: carry the raw subpath so click handlers can scroll-to-subpath
  if (subpath) a.dataset.subpath = subpath;
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

/** R18: render `.geode-math[data-math]` placeholders with KaTeX. Only called
 *  when the root actually contains math (math-free documents never load
 *  katex). A single element failing degrades to `.geode-math-error` with the
 *  source restored; a loader failure leaves the readable fallback text. */
async function hydrateMath(els: HTMLElement[], ctx: HydrateContext): Promise<void> {
  let katex: Awaited<ReturnType<typeof loadKatex>>;
  try {
    katex = await loadKatex();
  } catch (err) {
    console.warn("[embeds] failed to load katex", err);
    return; // every element keeps its escaped-source fallback text
  }
  const output = ctx.mathOutput ?? "html";
  for (const el of els) {
    const tex = el.getAttribute("data-math") ?? "";
    try {
      el.textContent = ""; // clear the fallback before rendering
      katex.render(tex, el, {
        displayMode: el.classList.contains("geode-math-block"),
        throwOnError: false,
        output,
        // R18 fix 6: cap rendered element size so a `\rule{1000000em}{...}`
        // bomb cannot paint a ~16M-px element and freeze the render thread
        // (maxExpand defaults to 1000, which already bounds macro expansion).
        maxSize: 100,
      });
    } catch (err) {
      console.warn("[embeds] katex failed to render", err);
      el.classList.add("geode-math-error");
      el.textContent = tex; // restore the source — never throw
    }
  }
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
      renderLinkSign(span, path, display, subpath);
      return;
    }
    const content = await ctx.vault.read(path);
    let slice = content;
    if (subpath) {
      // R14: heading/block matching is unified in resolveSubpath (exact +
      // stripHeading second pass for headings; case-insensitive id for
      // `^block` refs). The miss callouts stay here, per kind.
      const target = ctx.metadata.resolveSubpath(path, subpath);
      if (!target) {
        renderCallout(
          span,
          "geode-embed-missing",
          subpath.startsWith("^")
            ? t("editor.embedMissingBlock", { block: subpath.slice(1), name: noteName(path) })
            : t("editor.embedMissingHeading", { heading: subpath, name: noteName(path) }),
        );
        return;
      }
      slice = content.slice(target.from, target.to);
      // R13: drop the trailing ` ^id` marker so it never renders (the render
      // pipeline strips line-end markers too, but the contract calls for an
      // explicit tail strip here)
      if (target.kind === "block") slice = slice.replace(BLOCK_MARKER_RE, "");
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
    // R14: carry the raw subpath so click handlers can scroll-to-subpath
    if (subpath) link.dataset.subpath = subpath;
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
    // R18: math pass — nested transclusions are covered by the recursive
    // hydrateNote → hydrateEmbeds({...ctx}) call, which carries mathOutput
    const mathEls = Array.from(root.querySelectorAll<HTMLElement>(".geode-math[data-math]"));
    const passes = [
      ...imgs.map((img) => hydrateImage(img, ctx)),
      ...spans.map((span) => hydrateNote(span, ctx, depth, ancestors)),
    ];
    if (mathEls.length > 0) passes.push(hydrateMath(mathEls, ctx));
    await Promise.all(passes);
  } catch (err) {
    // defensive: per-element handlers already swallow their own failures
    console.warn("[embeds] hydration walk failed", err);
  }
}
