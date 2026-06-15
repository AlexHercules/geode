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
import { fileEmbedKind, renderMarkdownToHtml } from "./markdown";
import { loadKatex } from "./math";
import { loadMermaid } from "./mermaid";
import { renderQueryResult, runQueryBlock } from "./queryEmbed";
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
  /** R19 mermaid diagram theme: defaults at hydration time to the current
   *  app theme (document.documentElement.dataset.theme === "dark" ? "dark"
   *  : "default"); export passes "default" explicitly (light, self-contained
   *  output). Propagated recursively into nested note transclusions. */
  mermaidTheme?: "default" | "dark";
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

/** Module-level counter handing every mermaid render a unique DOM id
 *  (mermaid requires one per render call; footnoteRenderSeq precedent). */
let mermaidRenderSeq = 0;

/** R19 review fix (theme race): mermaid.initialize mutates GLOBAL config
 *  synchronously while renders drain through mermaid's global queue, so two
 *  overlapping hydration batches with different themes (export "default" vs.
 *  in-app "dark") would poison each other's queued renders. This chain makes
 *  each batch (initialize + ALL its renders) atomic — batches append and run
 *  strictly one after another. Failures never break the chain (runBatch
 *  swallows per-element errors and the chain link catches defensively). */
let mermaidBatchChain: Promise<void> = Promise.resolve();

const XLINK_NS = "http://www.w3.org/1999/xlink";

/** R19 review fix (SEC-1): strict securityLevel still honours flowchart
 *  `click A "url"` links, emitting `<a xlink:href>` SVG anchors that the
 *  preview's `a[href]` click guard never sees (xlink:href is a namespaced
 *  attribute) — a crafted diagram could navigate the whole webview. Policy:
 *  http(s) links get the same treatment as markdown external links (plain
 *  href + target=_blank + noopener, works in the serialized export too);
 *  everything else (relative, mailto:, ftp:, ...) is stripped inert. */
function neutralizeMermaidAnchors(root: HTMLElement): void {
  for (const a of Array.from(root.querySelectorAll("a"))) {
    const href = a.getAttribute("href") ?? a.getAttributeNS(XLINK_NS, "href") ?? "";
    if (/^https?:/i.test(href)) {
      a.setAttribute("href", href);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    } else {
      a.removeAttribute("href");
      a.removeAttributeNS(XLINK_NS, "href");
    }
  }
}

/** R19: render `.geode-mermaid[data-mermaid]` placeholders. Only called when
 *  the root actually contains diagrams (diagram-free documents never load
 *  mermaid). A single element failing degrades to `.geode-mermaid-error` with
 *  the source fallback kept (render returns a string, so nothing is cleared
 *  until success); a loader failure leaves every fallback in place. */
function hydrateMermaid(els: HTMLElement[], ctx: HydrateContext): Promise<void> {
  const runBatch = async (): Promise<void> => {
    let mermaid: Awaited<ReturnType<typeof loadMermaid>>;
    try {
      mermaid = await loadMermaid();
    } catch (err) {
      console.warn("[embeds] failed to load mermaid", err);
      return; // every element keeps its source fallback
    }
    const theme =
      ctx.mermaidTheme ??
      (document.documentElement.dataset.theme === "dark" ? "dark" : "default");
    // re-initializing per batch is cheap and idempotent (the batch chain makes
    // initialize + renders atomic); strict mode routes diagram text through
    // mermaid's bundled DOMPurify, and suppressing error rendering keeps v11
    // from injecting error SVGs into document.body (our `.geode-mermaid-error`
    // fallback owns degradation instead).
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme,
    });
    // R19 review fix (stale batches): a preview re-render replaces the DOM
    // while an older hydration is still draining — skip elements that got
    // detached so they stop wasting renders. Export hydrates a deliberately
    // detached container, so only batches that STARTED attached track this.
    const trackConnectivity = els.some((el) => el.isConnected);
    for (const el of els) {
      if (trackConnectivity && !el.isConnected) continue;
      try {
        const { svg } = await mermaid.render(
          `geode-mermaid-${mermaidRenderSeq++}`,
          el.getAttribute("data-mermaid") ?? "",
        );
        el.innerHTML = svg;
        neutralizeMermaidAnchors(el);
        // `class A internal-link;` nodes become clickable wikilinks: carry the
        // node text as data-target so the caller's click delegation can resolve
        // it like any other internal link (no links-index entry — official
        // Obsidian behaviour).
        for (const node of Array.from(el.querySelectorAll(".internal-link"))) {
          node.setAttribute("data-target", (node.textContent ?? "").trim());
        }
      } catch (err) {
        console.warn("[embeds] mermaid failed to render", err);
        el.classList.add("geode-mermaid-error");
      }
    }
  };
  const run = mermaidBatchChain.then(runBatch, runBatch);
  // keep the chain unbreakable even if runBatch itself ever rejects
  mermaidBatchChain = run.catch(() => {});
  return run;
}

/** R75: run each ```query placeholder's search and swap in the result list.
 *  Never throws — a failed block keeps its source-code fallback. Stale (detached)
 *  placeholders from a superseded render are skipped before writing. */
async function hydrateQuery(els: HTMLElement[], ctx: HydrateContext): Promise<void> {
  const trackConnectivity = els.some((el) => el.isConnected);
  await Promise.all(
    els.map(async (el) => {
      try {
        const result = await runQueryBlock(el.getAttribute("data-query") ?? "", ctx);
        if (trackConnectivity && !el.isConnected) return; // superseded by a re-render
        renderQueryResult(el, result);
      } catch (err) {
        console.warn("[embeds] query block failed", err);
      }
    }),
  );
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

/**
 * R26: hydrate a media file embed (`span.geode-embed-file`) into a native
 * <audio>/<video>/<iframe> player. The blob/data URL comes from ctx.imageSrc
 * (the feature supplies the correct MIME via core mimeForPath). A PDF page
 * anchor rides on data-embed-subpath ("page=N"). Never throws — a read failure
 * marks the placeholder `.geode-embed-failed`. Zero new dependencies: PDF uses
 * the host's native viewer (WKWebView / Chromium).
 */
async function hydrateFile(span: HTMLElement, ctx: HydrateContext): Promise<void> {
  const path = span.getAttribute("data-embed-path") ?? "";
  const ext = (span.getAttribute("data-embed-ext") ?? "").toLowerCase();
  const subpath = (span.getAttribute("data-embed-subpath") ?? "").trim();
  const kind = fileEmbedKind(ext);
  if (!kind) return; // defensive: emission only ever marks media extensions
  try {
    const src = await ctx.imageSrc(path);
    let el: HTMLMediaElement | HTMLIFrameElement;
    if (kind === "audio") {
      const a = document.createElement("audio");
      a.controls = true;
      a.src = src;
      el = a;
    } else if (kind === "video") {
      const v = document.createElement("video");
      v.controls = true;
      v.src = src;
      el = v;
    } else {
      // pdf → native iframe viewer; page anchor (page=N) rides on the subpath
      const f = document.createElement("iframe");
      f.src = subpath ? `${src}#${subpath}` : src;
      el = f;
    }
    el.classList.add(kind === "pdf" ? "geode-embed-pdf" : "geode-embed-media");
    el.addEventListener("error", () => span.classList.add("geode-embed-failed"), { once: true });
    span.appendChild(el);
  } catch {
    span.classList.add("geode-embed-failed");
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
      resolveMdLink: (href) => ctx.metadata.resolveMarkdownLink(href, path),
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
    // R26: media file embeds (audio/video/pdf)
    const fileSpans = Array.from(
      root.querySelectorAll<HTMLElement>("span.geode-embed-file[data-embed-path]"),
    );
    // R18: math pass — nested transclusions are covered by the recursive
    // hydrateNote → hydrateEmbeds({...ctx}) call, which carries mathOutput
    const mathEls = Array.from(root.querySelectorAll<HTMLElement>(".geode-math[data-math]"));
    // R19: mermaid pass — nested transclusions are covered by the recursive
    // hydrateNote → hydrateEmbeds({...ctx}) call, which carries mermaidTheme
    const mermaidEls = Array.from(
      root.querySelectorAll<HTMLElement>(".geode-mermaid[data-mermaid]"),
    );
    // R75: query pass — ```query placeholders run the search engine and render a
    // result list. Nested transclusions are covered by the recursive hydrateNote
    // → hydrateEmbeds call below, same as math/mermaid.
    const queryEls = Array.from(root.querySelectorAll<HTMLElement>(".geode-query[data-query]"));
    const passes = [
      ...imgs.map((img) => hydrateImage(img, ctx)),
      ...spans.map((span) => hydrateNote(span, ctx, depth, ancestors)),
      ...fileSpans.map((span) => hydrateFile(span, ctx)),
    ];
    if (mathEls.length > 0) passes.push(hydrateMath(mathEls, ctx));
    if (mermaidEls.length > 0) passes.push(hydrateMermaid(mermaidEls, ctx));
    if (queryEls.length > 0) passes.push(hydrateQuery(queryEls, ctx));
    await Promise.all(passes);
  } catch (err) {
    // defensive: per-element handlers already swallow their own failures
    console.warn("[embeds] hydration walk failed", err);
  }
}
