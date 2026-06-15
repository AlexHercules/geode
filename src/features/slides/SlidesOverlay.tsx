/**
 * Slides presentation overlay (R74) — a full-screen, read-only deck rendered
 * from the active note. Reuses the CORE render + embed-hydration pipeline (not
 * the editor feature's — layering forbids feature→feature imports), binding its
 * own metadata resolvers and a short-lived blob-URL provider (revoked on close).
 *
 * Mounts only while `workspace.modal === "slides"`. Esc is handled by the App's
 * global modal handler; this component owns ←/→/Space/PageUp/PageDown.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hydrateEmbeds } from "@core/embeds";
import { useI18n } from "@core/i18n";
import { mimeForPath, renderMarkdownToHtml } from "@core/markdown";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { splitSlides } from "./slides";
import "./slides.css";

export function SlidesOverlay(): JSX.Element | null {
  const app = useApp();
  const t = useI18n();
  // snapshot the presented note at mount — the overlay covers the workspace, so
  // the active file cannot change underneath it
  const [path] = useState(() => app.workspace.getActiveFile());
  const text = useMemo(() => (path ? (app.documents.get(path)?.getText() ?? "") : ""), [app, path]);
  const slides = useMemo(() => splitSlides(text), [text]);
  const [page, setPage] = useState(0);
  const clampedPage = Math.min(page, slides.length - 1);

  const overlayRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const urlCache = useRef(new Map<string, Promise<string>>());

  // CRITICAL (data-safety): steal focus off the underlying CodeMirror editor on
  // mount, so keystrokes during the presentation can never reach — and silently
  // mutate — the note behind the opaque overlay. Tab is trapped below.
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    overlayRef.current?.focus();
  }, []);

  const imageSrc = useCallback(
    (p: string): Promise<string> => {
      const hit = urlCache.current.get(p);
      if (hit) return hit;
      const load = app.vault.readBinary(p).then((bytes) => {
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        return URL.createObjectURL(new Blob([copy], { type: mimeForPath(p) }));
      });
      urlCache.current.set(p, load);
      return load;
    },
    [app],
  );

  // revoke every blob URL when the presentation closes (distinct lifecycle from
  // the editor's resident cache — the deck is short-lived)
  useEffect(() => {
    const cache = urlCache.current;
    return () => {
      for (const load of cache.values()) load.then(URL.revokeObjectURL).catch(() => {});
      cache.clear();
    };
  }, []);

  const html = useMemo(() => {
    if (!path) return "";
    return renderMarkdownToHtml(slides[clampedPage] ?? "", (target) => app.metadata.resolveLink(target, path), {
      resolveEmbed: (target) => app.metadata.resolveAttachment(target, path),
      noteEmbeds: true,
      resolveMdLink: (href) => app.metadata.resolveMarkdownLink(href, path),
    });
  }, [app, path, slides, clampedPage]);

  // hydrate image/note/math/mermaid embeds after each page renders
  useEffect(() => {
    const el = pageRef.current;
    if (!el || !path) return;
    void hydrateEmbeds(el, {
      vault: app.vault,
      metadata: app.metadata,
      imageSrc,
      ancestors: new Set([path]),
    });
  }, [html, app, path, imageSrc]);

  // keyboard navigation (window-level so it works without clicking first)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        // trap focus inside the overlay — never let Tab walk back to the still-
        // mounted editor underneath (data-safety: keep keystrokes off the note)
        e.preventDefault();
        overlayRef.current?.focus();
      } else if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        setPage((p) => Math.min(p + 1, slides.length - 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setPage((p) => Math.max(p - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length]);

  if (!path) return null;
  const close = () => app.workspace.closeModal();

  return (
    <div
      className="slides-overlay"
      data-testid="slides-overlay"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      ref={overlayRef}
    >
      <button className="slides-close" data-testid="slides-close" aria-label={t("slides.close")} onClick={close}>
        <Icon name="x" size={20} />
      </button>
      <div
        className="slides-page preview-content markdown-preview-view markdown-rendered"
        data-testid="slides-page"
        ref={pageRef}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="slides-controls">
        <button
          className="slides-nav"
          data-testid="slides-prev"
          aria-label={t("slides.prev")}
          disabled={clampedPage === 0}
          onClick={() => setPage((p) => Math.max(p - 1, 0))}
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <span className="slides-counter" data-testid="slides-counter">
          {t("slides.counter", { current: clampedPage + 1, total: slides.length })}
        </span>
        <button
          className="slides-nav"
          data-testid="slides-next"
          aria-label={t("slides.next")}
          disabled={clampedPage === slides.length - 1}
          onClick={() => setPage((p) => Math.min(p + 1, slides.length - 1))}
        >
          <Icon name="chevron-right" size={18} />
        </button>
      </div>
    </div>
  );
}
