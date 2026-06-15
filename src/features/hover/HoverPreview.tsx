/**
 * HoverPreview.tsx — the page-preview card (R25 悬停预览). See ARCHITECTURE.md
 * "Round 25 additions — 悬停预览" (frozen contract). Mounted once in App.tsx.
 *
 * Subscribes the shared `hoverStore`; when a target appears it renders the
 * target note through the SAME pipeline as the reading view
 * (`renderMarkdownToHtml` + core `hydrateEmbeds`) into a ref'd container,
 * positions itself relative to the trigger anchor (below preferred, flipped
 * above on overflow, clamped horizontally), and — for subpath links — scrolls
 * its own scroll container to the matching heading.
 *
 * PURE READ-ONLY: rendering never writes any vault file; the only state change
 * is navigating when the user CLICKS an internal link inside the card.
 *
 * Layering: this feature must NOT import features/editor. It mounts the
 * controller, owns a private module-local blob-URL cache (mirroring the idiom
 * in features/editor/embeds.ts) for `![[image]]` embeds, and navigates card
 * clicks directly via app.workspace (replicating openWikilink's resolved
 * branch without importing it).
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { useApp, type GeodeApp } from "@app/AppContext";
import { hoverStore, type HoverTarget } from "@core/hover";
import { hydrateEmbeds } from "@core/embeds";
import { renderMarkdownToHtml } from "@core/markdown";
import { strictLineBreaks } from "@core/appearance";
import { useStore } from "@core/store";
import { createHoverController } from "./hoverController";
import "./hover.css";

/* ============ private blob-URL cache (mirrors features/editor/embeds.ts) ====
 * The hover feature must not import the editor's blob cache (layering), so it
 * keeps its own module-local one: path → in-flight/settled object-URL promise,
 * invalidated lazily on vault file events so stale URLs never outlive a file. */

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
};

const urlCache = new Map<string, Promise<string>>();
let eventsHooked = false;

function invalidate(path: string): void {
  const entry = urlCache.get(path);
  if (!entry) return;
  urlCache.delete(path);
  entry.then(
    (url) => URL.revokeObjectURL(url),
    () => {},
  );
}

function ensureInvalidation(app: GeodeApp): void {
  if (eventsHooked) return;
  eventsHooked = true;
  app.events.on("file:modified", ({ path }) => invalidate(path));
  app.events.on("file:created", ({ path }) => invalidate(path));
  app.events.on("file:deleted", ({ path }) => invalidate(path));
  app.events.on("file:renamed", ({ oldPath }) => invalidate(oldPath));
}

function getEmbedUrl(app: GeodeApp, path: string): Promise<string> {
  ensureInvalidation(app);
  const cached = urlCache.get(path);
  if (cached) return cached;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  const load = app.vault.readBinary(path).then((bytes) => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return URL.createObjectURL(new Blob([copy], { type: mime }));
  });
  load.catch(() => {
    if (urlCache.get(path) === load) urlCache.delete(path);
  });
  urlCache.set(path, load);
  return load;
}

/* ============ positioning ============ */

const CARD_W = 480;
const CARD_MAX_H = 420;
const GAP = 8;
const MARGIN = 8;

/** Place the card relative to the anchor rect: below preferred, flipped above
 *  on vertical overflow; clamped to the viewport horizontally. */
function placeCard(card: HTMLElement, rect: HoverTarget["rect"]): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_W, vw - 2 * MARGIN);

  let left = rect.left;
  if (left + width + MARGIN > vw) left = vw - width - MARGIN;
  if (left < MARGIN) left = MARGIN;

  const below = vh - rect.bottom - GAP;
  const above = rect.top - GAP;
  let top: number;
  let maxH: number;
  if (below >= Math.min(CARD_MAX_H, above) || below >= 180) {
    // place below
    top = rect.bottom + GAP;
    maxH = Math.min(CARD_MAX_H, vh - top - MARGIN);
  } else {
    // flip above
    maxH = Math.min(CARD_MAX_H, above - MARGIN);
    top = rect.top - GAP - maxH;
    if (top < MARGIN) {
      top = MARGIN;
      maxH = rect.top - GAP - MARGIN;
    }
  }

  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
  card.style.width = `${Math.round(width)}px`;
  card.style.maxHeight = `${Math.max(120, Math.round(maxH))}px`;
}

/** Scroll the card's container to the subpath target. Mirrors the R15 reading-
 *  view reveal (EditorPane): resolve the subpath span via the metadata index,
 *  map its `from` to a document-order heading ordinal, then index into the
 *  rendered <h1>..<h6> — EXCLUDING embed-nested headings (.geode-embed-note) so
 *  late embed hydration cannot shift the ordinals. Text matching is deliberately
 *  avoided (duplicate titles / embed copies / substring over-match). Block refs
 *  (`#^id`) emit no DOM marker, so — exactly like the reading view — the ordinal
 *  lookup misses and the card stays at top. */
function scrollToSubpath(
  app: GeodeApp,
  scroller: HTMLElement,
  path: string,
  subpath: string,
): void {
  const span = app.metadata.resolveSubpath(path, subpath);
  if (!span) return;
  const headings = app.metadata.getMetadata(path)?.headings ?? [];
  const ordinal = headings.findIndex((h) => h.from === span.from);
  if (ordinal < 0) return; // block ref or no heading match → stay at top (R15 parity)
  const els = Array.from(
    scroller.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"),
  ).filter((el) => !el.closest(".geode-embed-note"));
  const hit = els[ordinal];
  if (hit) {
    // scroll the CARD container, not the page
    scroller.scrollTop = Math.max(0, hit.offsetTop - 8);
  }
}

export function HoverPreview(): React.ReactElement | null {
  const app = useApp();
  const target = useStore(hoverStore);
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // mount the document-level controller once
  useEffect(() => {
    const dispose = createHoverController(app);
    return dispose;
  }, [app]);

  // render the target note into the card body (stale-render guarded)
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const current = target;
    const body = bodyRef.current;
    if (!body) return;

    void (async () => {
      let content: string;
      try {
        content = await app.vault.read(current.path);
      } catch {
        if (cancelled || hoverStore.get() !== current) return;
        body.textContent = "";
        return;
      }
      if (cancelled || hoverStore.get() !== current) return;
      const html = renderMarkdownToHtml(
        content,
        (tg) => app.metadata.resolveLink(tg, current.path),
        {
          noteEmbeds: true,
          resolveMdLink: (href) => app.metadata.resolveMarkdownLink(href, current.path),
          strictLineBreaks: strictLineBreaks.get(),
        },
      );
      if (cancelled || hoverStore.get() !== current) return;
      body.innerHTML = html;
      await hydrateEmbeds(body, {
        vault: app.vault,
        metadata: app.metadata,
        imageSrc: (p: string) => getEmbedUrl(app, p),
        ancestors: new Set([current.path]),
      });
      if (cancelled || hoverStore.get() !== current) return;
      if (current.subpath) {
        // Defer to a frame so the scroll runs AFTER placeCard's rAF has applied
        // the card's max-height — otherwise the card is still unconstrained (its
        // height equals the full content), nothing overflows, and scrollTop
        // would clamp to 0. (placeCard's rAF was scheduled at mount, so it fires
        // no later than this one.)
        requestAnimationFrame(() => {
          if (cancelled || hoverStore.get() !== current) return;
          const scroller = cardRef.current;
          if (scroller) scrollToSubpath(app, scroller, current.path, current.subpath);
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [app, target]);

  // position the card whenever the target (anchor rect) changes — rAF-coalesced
  useLayoutEffect(() => {
    if (!target) return;
    const card = cardRef.current;
    if (!card) return;
    const rect = target.rect;
    const run = (): void => {
      rafRef.current = null;
      if (cardRef.current) placeCard(cardRef.current, rect);
    };
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(run);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target]);

  if (!target) return null;

  /** Card-internal internal-link click → navigate directly (no editor import).
   *  Replicates openWikilink's resolved branch: the card's path is already
   *  resolved, so links resolve relative to it. */
  const onClick = (e: React.MouseEvent): void => {
    const el = e.target;
    if (!(el instanceof Element)) return;
    const anchor = el.closest<HTMLAnchorElement>("a.internal-link");
    if (!anchor) {
      // non-internal anchors: prevent webview navigation for non-http links
      const a = el.closest("a");
      if (a) {
        const href = a.getAttribute("href") ?? "";
        if (!/^https?:/i.test(href)) e.preventDefault();
      }
      return;
    }
    e.preventDefault();
    const t = anchor.getAttribute("data-target") ?? "";
    const sp = anchor.getAttribute("data-subpath") ?? "";
    if (t === "" && !sp) return;
    const resolved = t ? app.metadata.resolveLink(t, target.path) : target.path;
    if (resolved) {
      app.workspace.openFile(resolved);
      if (sp) {
        const s = app.metadata.resolveSubpath(resolved, sp);
        if (s) app.workspace.requestReveal(resolved, s.from, s.to);
      }
    }
    hoverStore.set(null);
  };

  return (
    <div
      ref={cardRef}
      className="hover-preview"
      data-testid="hover-preview"
      onClick={onClick}
    >
      <div
        ref={bodyRef}
        className="hover-preview-content preview-content markdown-preview-view markdown-rendered"
      />
    </div>
  );
}
