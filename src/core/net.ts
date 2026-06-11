/**
 * HTTP transport (R6) — backs the compat layer's `requestUrl`.
 * Desktop: Rust `http_request` command (CORS-free, like Obsidian's requestUrl).
 * Browser: fetch (CORS-bound — good enough for the Memory-adapter demo / E2E).
 *
 * Pure transport: HTTP error statuses (4xx/5xx) resolve normally; only network /
 * protocol failures reject. `throw` semantics live in the compat layer.
 */
import { isTauri } from "./vault";

export interface HttpRequestParams {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  contentType?: string;
  /** Exactly one of bodyText / bodyBase64 may be set. */
  bodyText?: string;
  bodyBase64?: string;
}

export interface HttpResponseData {
  status: number;
  headers: Record<string, string>;
  bodyBase64: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function httpRequest(params: HttpRequestParams): Promise<HttpResponseData> {
  if (!/^https?:/i.test(params.url)) {
    throw new Error(`httpRequest: unsupported URL scheme in "${params.url}" (http/https only)`);
  }
  const headers: Record<string, string> = { ...(params.headers ?? {}) };
  if (params.contentType && !hasHeader(headers, "content-type")) {
    headers["Content-Type"] = params.contentType;
  }

  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<HttpResponseData>("http_request", {
      req: {
        url: params.url,
        method: params.method ?? "GET",
        headers,
        bodyBase64: params.bodyBase64 ?? (params.bodyText !== undefined
          ? bytesToBase64(new TextEncoder().encode(params.bodyText))
          : null),
      },
    });
  }

  const body: BodyInit | undefined =
    params.bodyBase64 !== undefined
      ? base64ToBytes(params.bodyBase64)
      : params.bodyText;
  const res = await fetch(params.url, {
    method: params.method ?? "GET",
    headers,
    body,
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  const resHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    resHeaders[key] = resHeaders[key] !== undefined ? `${resHeaders[key]}, ${value}` : value;
  });
  return { status: res.status, headers: resHeaders, bodyBase64: bytesToBase64(buf) };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === name);
}
