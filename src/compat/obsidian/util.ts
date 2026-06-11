/**
 * Module-level obsidian exports: normalizePath, apiVersion/requireApiVersion,
 * frontmatter/tag helpers, debounce, Platform, the real moment (R5), and the
 * remaining T2 warn-stubs (htmlToMarkdown / MarkdownRenderer / requestUrl).
 */
// The with-locales bundle keeps everything on ONE instance — a separate
// "moment/min/locales" entry registers against a second copy under Vite's
// dep optimizer. Defining locales switches the global one; restored below.
import momentImpl from "moment/min/moment-with-locales";
import { reportGap } from "./gaps";
import type { CachedMetadata, FrontMatterCache } from "./metadata";

/* ---------------- versioning ---------------- */

/** The obsidian API version this shim claims compatibility with (R4 decision). */
export const apiVersion = "1.5.0";

/** @internal numeric semver compare: a<b => -1, a==b => 0, a>b => 1. */
export function semverCompare(a: string, b: string): number {
  const pa = a.split(".").map((s) => parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/** True if the running API version is equal or higher than `version`. */
export function requireApiVersion(version: string): boolean {
  return semverCompare(apiVersion, version) >= 0;
}

/* ---------------- normalizePath (rules per API-REFERENCE area 2) ---------------- */

export function normalizePath(path: string): string {
  let p = path
    .replace(/\\/g, "/") // backslashes -> forward slashes
    .replace(/\u00a0/g, " ") // NBSP -> regular space
    .normalize("NFC")
    .replace(/\/+/g, "/") // collapse repeated slashes
    .replace(/^\/+|\/+$/g, ""); // strip leading/trailing slashes
  if (p === "") p = "/";
  return p;
}

/* ---------------- link & frontmatter helpers (area 3) ---------------- */

/** Strip the #subpath from a linktext, returning the bare linkpath. */
export function getLinkpath(linktext: string): string {
  const idx = linktext.indexOf("#");
  return (idx === -1 ? linktext : linktext.slice(0, idx)).trim();
}

/** Case-insensitive / RegExp frontmatter key lookup. */
export function parseFrontMatterEntry(
  frontmatter: FrontMatterCache | null | undefined,
  key: string | RegExp,
): unknown {
  if (!frontmatter) return null;
  for (const k of Object.keys(frontmatter)) {
    const match =
      typeof key === "string" ? k.toLowerCase() === key.toLowerCase() : key.test(k);
    if (match) return frontmatter[k] ?? null;
  }
  return null;
}

export function parseFrontMatterStringArray(
  frontmatter: FrontMatterCache | null | undefined,
  key: string | RegExp,
): string[] | null {
  const value = parseFrontMatterEntry(frontmatter, key);
  if (value == null) return null;
  const items = Array.isArray(value) ? value.map(String) : String(value).split(",");
  const out = items.map((s) => s.trim()).filter(Boolean);
  return out.length > 0 ? out : null;
}

/** Tags from frontmatter 'tags'/'tag', normalized to include the leading '#'. */
export function parseFrontMatterTags(
  frontmatter: FrontMatterCache | null | undefined,
): string[] | null {
  const raw =
    parseFrontMatterStringArray(frontmatter, "tags") ??
    parseFrontMatterStringArray(frontmatter, "tag");
  if (!raw) return null;
  const out = raw
    .flatMap((s) => s.split(/[\s,]+/))
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
  return out.length > 0 ? out : null;
}

export function parseFrontMatterAliases(
  frontmatter: FrontMatterCache | null | undefined,
): string[] | null {
  return (
    parseFrontMatterStringArray(frontmatter, "aliases") ??
    parseFrontMatterStringArray(frontmatter, "alias")
  );
}

/** 'Combines all tags from frontmatter and note content into a single array.' */
export function getAllTags(cache: CachedMetadata | null): string[] | null {
  if (!cache) return null;
  const out = new Set<string>();
  for (const t of cache.tags ?? []) out.add(t.tag);
  for (const t of parseFrontMatterTags(cache.frontmatter) ?? []) out.add(t);
  return out.size > 0 ? [...out] : null;
}

/* ---------------- debounce (derived from the well-known d.ts shape) ---------------- */

export interface Debouncer<T extends unknown[], V> {
  (...args: [...T]): Debouncer<T, V>;
  cancel(): Debouncer<T, V>;
  run(): V | undefined;
}

export function debounce<T extends unknown[], V>(
  cb: (...args: [...T]) => V,
  timeout = 0,
  resetTimer = false,
): Debouncer<T, V> {
  let timer: number | null = null;
  let pendingArgs: T | null = null;

  const invoke = (): V | undefined => {
    timer = null;
    const args = pendingArgs;
    pendingArgs = null;
    return args ? cb(...args) : undefined;
  };

  const debounced = ((...args: T): Debouncer<T, V> => {
    pendingArgs = args;
    if (timer !== null) {
      if (resetTimer) {
        window.clearTimeout(timer);
        timer = window.setTimeout(invoke, timeout);
      }
    } else {
      timer = window.setTimeout(invoke, timeout);
    }
    return debounced;
  }) as Debouncer<T, V>;

  debounced.cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    pendingArgs = null;
    return debounced;
  };

  debounced.run = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      return invoke();
    }
    return undefined;
  };

  return debounced;
}

/* ---------------- Platform (minimal, derived) ---------------- */

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

export const Platform = {
  isDesktop: true,
  isDesktopApp: true,
  isMobile: false,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
  isMacOS: ua.includes("Macintosh"),
  isWin: ua.includes("Windows"),
  isLinux: ua.includes("Linux") && !ua.includes("Android"),
  isSafari: false,
} as const;

/* ---------------- moment (real, R5 T2 decision) ---------------- */

/**
 * The official module exposes `export const moment: typeof Moment` — we hand
 * out the real bundled moment.js. The loader also installs this exact instance
 * as `window.moment` (suite plugins consume it exclusively from there).
 */
// the locale-pack import above leaves the LAST registered locale active —
// restore the default before anything consumes moment
momentImpl.locale("en");
export const moment = momentImpl;

/* ---------------- T2 warn-stubs ---------------- */

/** Warn-stub: best-effort plain-text extraction instead of real conversion. */
export function htmlToMarkdown(html: string | HTMLElement | Document | DocumentFragment): string {
  reportGap("module", "htmlToMarkdown", "returns plain text, not markdown");
  if (typeof html === "string") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent ?? "";
  }
  return html.textContent ?? "";
}

/** Warn-stub: network access is not part of T0/T1 — always rejects. */
export function requestUrl(request: unknown): Promise<never> {
  const url =
    typeof request === "string"
      ? request
      : ((request as { url?: string } | null)?.url ?? "<unknown>");
  reportGap("module", "requestUrl", `request to ${url} rejected`);
  return Promise.reject(new Error("requestUrl is not available in Geode (T2 gap)"));
}

/** Warn-stub renderer: inserts the raw markdown as plain text. */
export class MarkdownRenderer {
  static async render(
    _app: unknown,
    markdown: string,
    el: HTMLElement,
    _sourcePath: string,
    _component: unknown,
  ): Promise<void> {
    reportGap("module", "MarkdownRenderer.render", "renders plain text");
    el.textContent = markdown;
  }

  /** @deprecated old signature, same plain-text behavior */
  static async renderMarkdown(
    markdown: string,
    el: HTMLElement,
    _sourcePath: string,
    _component: unknown,
  ): Promise<void> {
    reportGap("module", "MarkdownRenderer.renderMarkdown", "renders plain text");
    el.textContent = markdown;
  }
}
