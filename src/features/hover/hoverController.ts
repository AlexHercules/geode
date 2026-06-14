/**
 * hoverController.ts — document-level delegated hover controller (R25 page
 * preview). See ARCHITECTURE.md "Round 25 additions — 悬停预览" (frozen
 * contract). PURE READ-ONLY: this controller only RESOLVES links and writes
 * the shared `hoverStore`; it never writes any vault file and never mutates
 * workspace/tab state.
 *
 * Listens (capture phase, document level) for mouseover / mouseout / mousemove
 * / keydown / scroll and decides whether a hovered internal-link anchor (or a
 * `[data-hover-path]` source row) should raise a preview card after
 * HOVER_SHOW_DELAY. Leaving the anchor (without entering the card) hides it
 * after HOVER_HIDE_DELAY; Escape / scroll outside the card hide immediately.
 */
import {
  HOVER_HIDE_DELAY,
  HOVER_SHOW_DELAY,
  hoverStore,
  pagePreviewEnabled,
  pagePreviewRequireModifier,
} from "@core/hover";
import type { GeodeApp } from "@app/AppContext";

/** A resolved hover request awaiting its SHOW_DELAY timer. */
interface PendingHover {
  anchor: HTMLElement;
  path: string;
  subpath: string;
}

/** Trigger info extracted from a hovered element (before resolution). */
interface Trigger {
  rawTarget: string;
  subpath: string;
  /** true when the anchor lives inside a `.cm-content` (live/source editor) */
  inEditor: boolean;
}

/** macOS uses Cmd (metaKey); every other platform uses Ctrl. */
function isApplePlatform(): boolean {
  try {
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  } catch {
    return false;
  }
}

function hasModifier(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return isApplePlatform() ? e.metaKey : e.ctrlKey;
}

/** Build a trigger from a matched node's target/subpath attributes. An EMPTY
 *  target with a subpath is a self-link ([[#heading]]) → the note the anchor
 *  lives in (its pane's source path). Returns null when there is no target. */
function triggerFrom(
  node: HTMLElement,
  targetAttr: string,
  subpathAttr: string,
  inEditor: boolean,
  sourcePath: string | null,
): { trigger: Trigger; anchor: HTMLElement } | null {
  const target = node.getAttribute(targetAttr) ?? "";
  const subpath = node.getAttribute(subpathAttr) ?? "";
  let rawTarget = target;
  if (target === "" && subpath) {
    if (!sourcePath) return null;
    rawTarget = sourcePath;
  }
  if (rawTarget === "") return null;
  return { trigger: { rawTarget, subpath, inEditor }, anchor: node };
}

/**
 * Extract a hover trigger from an event target (first match wins):
 *  ① `a.internal-link` (reading view / sidebar / embeds / mermaid) →
 *     data-target (+ data-subpath).
 *  ② `.cm-live-wikilink` (live-preview collapsed wikilink, CodeMirror) →
 *     data-link-target (+ data-link-subpath); always in the editor.
 *  ③ `[data-hover-path]` (explorer rows / backlinks sources) →
 *     data-hover-path (+ optional data-hover-subpath).
 * Returns null when nothing hoverable is under the cursor.
 */
function extractTrigger(el: Element, sourcePath: string | null): { trigger: Trigger; anchor: HTMLElement } | null {
  const link = el.closest<HTMLElement>("a.internal-link");
  if (link) {
    return triggerFrom(link, "data-target", "data-subpath", link.closest(".cm-content") !== null, sourcePath);
  }
  const live = el.closest<HTMLElement>(".cm-live-wikilink");
  if (live) {
    return triggerFrom(live, "data-link-target", "data-link-subpath", true, sourcePath);
  }
  // R71: internal md links in live mode (resolved to a note) carry the same
  // data-link-target — preview them like wikilinks. Gated on the attribute so
  // external / attachment / unresolved md links (no target) raise no card.
  const liveMd = el.closest<HTMLElement>(".cm-live-mdlink[data-link-target]");
  if (liveMd) {
    return triggerFrom(liveMd, "data-link-target", "data-link-subpath", true, sourcePath);
  }
  const source = el.closest<HTMLElement>("[data-hover-path]");
  if (source) {
    return triggerFrom(source, "data-hover-path", "data-hover-subpath", source.closest(".cm-content") !== null, sourcePath);
  }
  return null;
}

/**
 * Wire a document-level hover controller against `app`. Returns a disposer that
 * removes every listener and clears any pending timers / store state.
 */
export function createHoverController(app: GeodeApp): () => void {
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  // the anchor we are currently tracking (hovering / shown), for re-trigger on
  // keydown (Ctrl pressed AFTER hover in editor) and modifier re-evaluation
  let pending: PendingHover | null = null;
  let lastEvent: MouseEvent | null = null;

  const clearShow = (): void => {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  };
  const clearHide = (): void => {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const hideNow = (): void => {
    clearShow();
    clearHide();
    pending = null;
    if (hoverStore.get() !== null) hoverStore.set(null);
  };

  /** Whether a trigger from this source requires Ctrl/Cmd, per contract. */
  const requiresModifier = (trigger: Trigger): boolean => {
    if (pagePreviewRequireModifier.get()) return true; // all sources need modifier
    // official default: editor (.cm-content) needs Ctrl/Cmd; everything else none
    return trigger.inEditor;
  };

  /** Schedule the show after SHOW_DELAY for a resolved target. */
  const scheduleShow = (anchor: HTMLElement, path: string, subpath: string): void => {
    // already pending/shown for this exact anchor+target — leave the timer alone
    if (
      pending &&
      pending.anchor === anchor &&
      pending.path === path &&
      pending.subpath === subpath
    ) {
      return;
    }
    clearShow();
    clearHide();
    pending = { anchor, path, subpath };
    showTimer = setTimeout(() => {
      showTimer = null;
      if (!pending || pending.anchor !== anchor) return;
      const r = anchor.getBoundingClientRect();
      hoverStore.set({
        path,
        subpath,
        rect: { top: r.top, left: r.left, bottom: r.bottom, right: r.right },
      });
    }, HOVER_SHOW_DELAY);
  };

  /**
   * Evaluate a hovered element and (if eligible) schedule a preview. `modifier`
   * reflects whether Ctrl/Cmd is currently down (from the triggering event).
   */
  const evaluate = (el: Element, modifier: boolean): void => {
    if (!pagePreviewEnabled.get()) return;
    // SOURCE note = the pane the anchor lives in (data-leaf-path on the editor
    // leaf — same口径 as openWikilink's handle.path), so hovering a link in a
    // non-focused split resolves against THAT pane's note, not the globally-
    // active file. Sidebar sources (explorer/backlinks) have no leaf and carry a
    // full vault path in data-hover-path, so the active file's folder context is
    // a harmless fallback there.
    const paneEl = el.closest<HTMLElement>("[data-leaf-path]");
    const sourcePath = paneEl?.getAttribute("data-leaf-path") || app.workspace.getActiveFile() || "";
    const hit = extractTrigger(el, sourcePath || null);
    if (!hit) return;
    if (requiresModifier(hit.trigger) && !modifier) return;
    const resolved = app.metadata.resolveLink(hit.trigger.rawTarget, sourcePath);
    if (!resolved) return; // unresolved → do NOT raise an "uncreated" card
    scheduleShow(hit.anchor, resolved, hit.trigger.subpath);
  };

  const onMouseOver = (e: MouseEvent): void => {
    lastEvent = e;
    const el = e.target;
    if (!(el instanceof Element)) return;
    // entering the card cancels any pending hide (user may scroll / click inside)
    if (el.closest('[data-testid="hover-preview"]')) {
      clearHide();
      return;
    }
    evaluate(el, hasModifier(e));
  };

  const onMouseMove = (e: MouseEvent): void => {
    lastEvent = e;
    const el = e.target;
    if (!(el instanceof Element)) return;
    if (el.closest('[data-testid="hover-preview"]')) {
      clearHide();
      return;
    }
    // re-evaluate while moving over the SAME anchor so a modifier pressed after
    // entry (editor case) can still trigger without leaving + re-entering
    if (!pending) evaluate(el, hasModifier(e));
  };

  const onMouseOut = (e: MouseEvent): void => {
    const from = e.target;
    const to = e.relatedTarget;
    if (!(from instanceof Element)) return;
    const toEl = to instanceof Element ? to : null;
    // moving INTO the card (or staying within the same anchor subtree) keeps it
    if (toEl && toEl.closest('[data-testid="hover-preview"]')) {
      clearHide();
      return;
    }
    // still inside the tracked anchor → not a real leave
    if (pending && toEl && pending.anchor.contains(toEl)) return;
    // left the anchor: cancel a not-yet-shown preview, or schedule hide
    if (hoverStore.get() === null) {
      clearShow();
      pending = null;
      return;
    }
    clearHide();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hideNow();
    }, HOVER_HIDE_DELAY);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      if (hoverStore.get() !== null || pending) hideNow();
      return;
    }
    // the platform modifier (Cmd on macOS, Ctrl elsewhere) pressed while already
    // hovering an editor anchor → re-trigger; gated to the active-platform key so
    // the OTHER modifier (e.g. Control on macOS) does NOT bypass hasModifier()
    const modKey = isApplePlatform() ? "Meta" : "Control";
    if (e.key === modKey && lastEvent) {
      const el = lastEvent.target;
      if (el instanceof Element && !el.closest('[data-testid="hover-preview"]')) {
        evaluate(el, true);
      }
    }
  };

  const onScroll = (e: Event): void => {
    // scrolling inside the card is fine; any other scroll dismisses immediately
    const t = e.target;
    if (t instanceof Element && t.closest('[data-testid="hover-preview"]')) return;
    if (hoverStore.get() !== null || pending) hideNow();
  };

  const opts: AddEventListenerOptions = { capture: true };
  document.addEventListener("mouseover", onMouseOver, opts);
  document.addEventListener("mousemove", onMouseMove, opts);
  document.addEventListener("mouseout", onMouseOut, opts);
  document.addEventListener("keydown", onKeyDown, opts);
  document.addEventListener("scroll", onScroll, opts);

  return () => {
    document.removeEventListener("mouseover", onMouseOver, opts);
    document.removeEventListener("mousemove", onMouseMove, opts);
    document.removeEventListener("mouseout", onMouseOut, opts);
    document.removeEventListener("keydown", onKeyDown, opts);
    document.removeEventListener("scroll", onScroll, opts);
    hideNow();
  };
}
