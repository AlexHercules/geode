/**
 * Module-level obsidian exports: normalizePath, apiVersion/requireApiVersion,
 * frontmatter/tag helpers, debounce, Platform, the real moment (R5), the real
 * requestUrl/request + MarkdownRenderer (R6), and the htmlToMarkdown warn-stub.
 */
// The with-locales bundle keeps everything on ONE instance — a separate
// "moment/min/locales" entry registers against a second copy under Vite's
// dep optimizer. Defining locales switches the global one; restored below.
import momentImpl from "moment/min/moment-with-locales";
import { hydrateEmbeds } from "@core/embeds";
import { locale } from "@core/i18n";
import { renderMarkdownToHtml } from "@core/markdown";
import { strictLineBreaks } from "@core/appearance";
import type { MetadataIndex } from "@core/metadata";
import { base64ToBytes, bytesToBase64, httpRequest } from "@core/net";
import type { Vault as GeodeVault } from "@core/vault";
import type { Component } from "./component";
import { reportGap } from "./gaps";
import type { CachedMetadata, FrontMatterCache } from "./metadata";
import type { App } from "./plugin";

/* ---------------- host handle plumbing (R6 contract) ---------------- */

/**
 * Slice of the Geode AppHandle that module-level APIs (MarkdownRenderer.render)
 * need. context.ts sets it on create and clears it in dispose; the real
 * AppHandle satisfies this shape structurally. R13 widens vault/metadata to
 * the real core types — the embed hydration engine (core/embeds) takes them
 * nominally.
 */
export interface CompatHostHandle {
  vault: GeodeVault;
  metadata: MetadataIndex;
  workspace: { openFile(path: string, opts?: { newTab?: boolean }): void };
}

let hostHandle: CompatHostHandle | null = null;

/** @internal wired by context.ts (create → handle, dispose → null). */
export function _setCompatHostHandle(handle: CompatHostHandle | null): void {
  hostHandle = handle;
}

/** @internal */
export function _getCompatHostHandle(): CompatHostHandle | null {
  return hostHandle;
}

/* ---------------- versioning ---------------- */

/** The obsidian API version this shim claims compatibility with. Bumped to
 *  1.8.0: matches the full 1.7.x surface plus early 1.8.x face already shipped
 *  (removeCommand / getAllFolders / footnoteRefs / clipboard copy). Kept below
 *  1.12.3 because appendBinary remains a stub. */
export const apiVersion = "1.8.0";

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

/** Split a linktext into { path, subpath }. subpath KEEPS its leading "#"/"^"
 *  (faithful to Obsidian's parseLinktext: substr(idx)). NOT the same as
 *  getLinkpath, which trims — keep them separate. */
export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const idx = linktext.indexOf("#");
  if (idx < 0) return { path: linktext, subpath: "" };
  return { path: linktext.slice(0, idx), subpath: linktext.slice(idx) };
}

/** ArrayBuffer → base64 string (bridges core/net bytesToBase64). */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

/** base64 string → ArrayBuffer (bridges core/net base64ToBytes). */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  return base64ToBytes(base64).buffer;
}

/** Blob → ArrayBuffer (standard API). */
export function getBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
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
  // Honest placeholder: Geode serves no `app://` resource prefix yet (real
  // resource-path resolution is deferred to D5). Empty string is a valid
  // `string` subtype, so plugins reading Platform.resourcePathPrefix compile.
  resourcePathPrefix: "",
} as const;

/* ---------------- getLanguage (D16-1) ---------------- */

/**
 * The official `getLanguage(): string` returns the active UI locale code.
 * Geode tracks it in the core i18n `locale` Store ("en" | "zh"); both are
 * `string` subtypes, satisfying the declared return type.
 */
export function getLanguage(): string {
  return locale.get();
}

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

/* ---------------- requestUrl / request (real, R6) ---------------- */

export interface RequestUrlParam {
  url: string;
  method?: string;
  contentType?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
  /** Whether to throw an error when the status code is 400+. Defaults to true. */
  throw?: boolean;
}

/** Official shape: arrayBuffer/json/text are PROPERTIES, not methods. */
export interface RequestUrlResponse {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  text: string;
}

export interface RequestUrlResponsePromise extends Promise<RequestUrlResponse> {
  arrayBuffer: Promise<ArrayBuffer>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: Promise<any>;
  text: Promise<string>;
}

/** Body bytes are decoded/parsed lazily and cached (text = utf-8, json = JSON.parse(text)). */
function buildResponse(
  status: number,
  headers: Record<string, string>,
  getBytes: () => Uint8Array<ArrayBuffer>,
): RequestUrlResponse {
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  let text: string | null = null;
  let json: unknown;
  let jsonParsed = false;
  return {
    status,
    headers,
    get arrayBuffer(): ArrayBuffer {
      bytes ??= getBytes();
      return bytes.buffer;
    },
    get text(): string {
      bytes ??= getBytes();
      text ??= new TextDecoder().decode(bytes);
      return text;
    },
    get json(): unknown {
      if (!jsonParsed) {
        json = JSON.parse(this.text);
        jsonParsed = true;
      }
      return json;
    },
  };
}

/** `data:[<mediatype>][;base64],<payload>` — both base64 and URL-encoded payloads. */
const DATA_URL_RE = /^data:([^,]*),([\s\S]*)$/;

/** Resolve a data: URL entirely in-layer (no network — the deterministic fixture path). */
function dataUrlResponse(url: string): RequestUrlResponse {
  const m = DATA_URL_RE.exec(url);
  if (!m) throw new Error(`requestUrl: malformed data: URL "${url}"`);
  const [, meta, payload] = m;
  const isBase64 = /;base64$/i.test(meta);
  const contentType = (isBase64 ? meta.slice(0, -";base64".length) : meta) || "text/plain";
  const getBytes = (): Uint8Array<ArrayBuffer> =>
    isBase64
      ? base64ToBytes(payload)
      : new TextEncoder().encode(decodeURIComponent(payload)) as Uint8Array<ArrayBuffer>;
  return buildResponse(200, { "content-type": contentType }, getBytes);
}

async function performRequest(params: RequestUrlParam): Promise<RequestUrlResponse> {
  let response: RequestUrlResponse;
  if (/^data:/i.test(params.url)) {
    response = dataUrlResponse(params.url);
  } else {
    // body string|ArrayBuffer → bodyText/bodyBase64; contentType becomes the
    // Content-Type header inside core/net (explicit headers["Content-Type"] wins)
    const res = await httpRequest({
      url: params.url,
      method: params.method,
      headers: params.headers,
      contentType: params.contentType,
      bodyText: typeof params.body === "string" ? params.body : undefined,
      bodyBase64:
        params.body instanceof ArrayBuffer
          ? bytesToBase64(new Uint8Array(params.body))
          : undefined,
    });
    response = buildResponse(res.status, res.headers, () => base64ToBytes(res.bodyBase64));
  }
  // `throw` defaults true: HTTP errors reject; transport errors reject above
  if (params.throw !== false && response.status >= 400) {
    throw new Error(`Request failed, status ${response.status} (${params.url})`);
  }
  return response;
}

/**
 * Official requestUrl: CORS-free HTTP(S) via core/net (Tauri command on desktop,
 * fetch in the browser). Returns a Promise that ALSO carries arrayBuffer/json/text
 * promise properties (RequestUrlResponsePromise).
 */
export function requestUrl(request: RequestUrlParam | string): RequestUrlResponsePromise {
  const params = typeof request === "string" ? { url: request } : request;
  const promise = performRequest(params);
  // lazy getters: only the consumed property derives a promise, so an unused
  // `.json` never parses (or surfaces an unhandled rejection for) non-JSON bodies
  return Object.defineProperties(promise, {
    arrayBuffer: { get: () => promise.then((r) => r.arrayBuffer) },
    json: { get: () => promise.then((r) => r.json) },
    text: { get: () => promise.then((r) => r.text) },
  }) as RequestUrlResponsePromise;
}

/** Official request: same params as requestUrl, resolves to the response text. */
export function request(request: RequestUrlParam | string): Promise<string> {
  return requestUrl(request).text;
}

/* ---------------- MarkdownRenderer (real, R6) ---------------- */

/** MIME by lowercase extension — mirrors IMAGE_EXTS in core/markdown.ts. */
const EMBED_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
};

/**
 * path → settled/in-flight blob-URL promise for embed images (R13).
 * Deliberately NOT invalidated on vault events: compat MarkdownRenderer output
 * is a one-shot fragment that is never re-rendered on file changes, so a
 * snapshot-at-render-time URL is the documented behaviour.
 */
const embedUrlCache = new Map<string, Promise<string>>();

/** Cached vault.readBinary → blob object URL (failed loads evict for retry). */
function compatEmbedSrc(vault: GeodeVault, path: string): Promise<string> {
  const cached = embedUrlCache.get(path);
  if (cached) return cached;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const mime = EMBED_MIME_BY_EXT[ext] ?? "application/octet-stream";
  const load = vault.readBinary(path).then((bytes) => {
    // copy into a fresh ArrayBuffer-backed view: TS types adapter bytes over
    // ArrayBufferLike, which BlobPart rejects (and a view may have an offset)
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return URL.createObjectURL(new Blob([copy], { type: mime }));
  });
  load.catch(() => {
    // identity-guarded: the entry may have been replaced meanwhile
    if (embedUrlCache.get(path) === load) embedUrlCache.delete(path);
  });
  embedUrlCache.set(path, load);
  return load;
}

/**
 * Renders through the same markdown-it pipeline as the preview (core/markdown).
 * Links resolve via the current loader context's host handle; without one
 * (render called outside a compat context AND `app` is not our App shim) the
 * markdown still renders, with every wikilink unresolved. R13: `![[...]]`
 * image and note embeds hydrate through the shared core engine before the
 * returned promise resolves (the official signature is Promise<void>).
 */
export class MarkdownRenderer {
  static async render(
    app: App,
    markdown: string,
    el: HTMLElement,
    sourcePath: string,
    component: Component,
  ): Promise<void> {
    // module handle first (set by context.ts), else the App shim's internal bridge
    const handle =
      _getCompatHostHandle() ??
      (app as unknown as { _geode?: { handle?: CompatHostHandle } } | null)?._geode?.handle ??
      null;
    const html = renderMarkdownToHtml(
      markdown,
      (target) => (handle ? handle.metadata.resolveLink(target, sourcePath) : null),
      {
        ...(handle
          ? {
              resolveEmbed: (target: string) => handle.metadata.resolveAttachment(target, sourcePath),
              resolveMdLink: (href: string) => handle.metadata.resolveMarkdownLink(href, sourcePath),
            }
          : {}),
        noteEmbeds: true,
        strictLineBreaks: strictLineBreaks.get(),
      },
    );
    // markdown-it runs html:false — no raw-HTML injection from plugin input
    el.innerHTML = html;
    el.classList.add("markdown-rendered");
    // R13: fill image srcs + expand note transclusions before resolving;
    // without a handle there is nothing to hydrate (no embed placeholders)
    if (handle) {
      await hydrateEmbeds(el, {
        vault: handle.vault,
        metadata: handle.metadata,
        imageSrc: (path) => compatEmbedSrc(handle.vault, path),
        ancestors: new Set([sourcePath]),
      });
    }
    // no source mapping for plugin-rendered fragments → checkboxes are inert
    // (runs AFTER hydration so checkboxes inside embedded notes are covered)
    el.querySelectorAll<HTMLInputElement>("input.task-checkbox").forEach((cb) => {
      cb.disabled = true;
    });
    // one delegated listener wires .internal-link clicks → workspace.openFile
    const onClick = (evt: MouseEvent): void => {
      const anchor = (evt.target as HTMLElement | null)?.closest?.(".internal-link");
      if (!anchor) return;
      evt.preventDefault();
      const target = anchor.getAttribute("data-target");
      const h = _getCompatHostHandle() ?? handle;
      if (!target || !h) return;
      const resolved = h.metadata.resolveLink(target, sourcePath);
      if (resolved !== null) h.workspace.openFile(resolved);
    };
    el.addEventListener("click", onClick);
    const comp = component as unknown as { register?: (cb: () => unknown) => void } | null;
    if (typeof comp?.register === "function") {
      comp.register(() => el.removeEventListener("click", onClick));
    }
  }

  /** @deprecated old 4-arg signature — delegates to {@link MarkdownRenderer.render}. */
  static renderMarkdown(
    markdown: string,
    el: HTMLElement,
    sourcePath: string,
    component: Component,
  ): Promise<void> {
    return MarkdownRenderer.render(null as unknown as App, markdown, el, sourcePath, component);
  }
}
