/**
 * R46: obsidian:// URI parser (PURE). Maps obsidian://<action>?<params> to a
 * structured action. The impure executor (open/create/search) lives in
 * features/editor/obsidianUriHandler.ts; this stays pure so it is the reusable
 * core for both in-app routing and a future OS deep-link handler.
 */
import { Store } from "./store";

const URI_LINKS_KEY = "geode.uriLinksEnabled";

function readUriLinksEnabled(): boolean {
  try {
    const raw = localStorage.getItem(URI_LINKS_KEY);
    // Default ON preserves Geode's pre-R275 behavior (Obsidian's own default is OFF).
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

/**
 * R275: "Files & Links → Enable URI links" setting. When false, obsidian:// links
 * in the reading view are treated as non-actionable non-HTTP anchors (preventDefault
 * with no navigation). The parser and the __geodeUri probe are intentionally NOT
 * gated — this only affects user-facing click routing.
 */
export const uriLinksEnabled = new Store<boolean>(readUriLinksEnabled());

export function setUriLinksEnabled(value: boolean): void {
  uriLinksEnabled.set(value);
  try {
    localStorage.setItem(URI_LINKS_KEY, String(value));
  } catch {
    /* storage unavailable */
  }
}
export type ObsidianAction =
  | { kind: "open"; vault?: string; file?: string; path?: string; heading?: string; block?: string }
  | { kind: "new"; vault?: string; file?: string; name?: string; content?: string }
  | { kind: "search"; vault?: string; query?: string }
  | { kind: "unknown"; action: string; params: Record<string, string> };

/**
 * R179 (G4): build the `obsidian://open` URI for a vault-relative file path —
 * the companion builder to the parser below, used by "Copy Obsidian URL".
 * Mirrors Obsidian: the `.md` extension is stripped from the `file` param
 * (non-markdown extensions are kept), so the URL round-trips back through
 * parseObsidianUri + metadata.resolveLink.
 */
export function buildOpenUri(vaultName: string, path: string): string {
  const file = path.replace(/\.md$/i, "");
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file)}`;
}

export function parseObsidianUri(uri: string): ObsidianAction | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "obsidian:") return null;
  const action = (url.hostname || url.pathname.replace(/^\/+/, "")).toLowerCase();
  const get = (k: string): string | undefined => {
    const v = url.searchParams.get(k);
    return v === null ? undefined : v;
  };
  switch (action) {
    case "open":
      return { kind: "open", vault: get("vault"), file: get("file"), path: get("path"), heading: get("heading"), block: get("block") };
    case "new":
      return { kind: "new", vault: get("vault"), file: get("file"), name: get("name"), content: get("content") };
    case "search":
      return { kind: "search", vault: get("vault"), query: get("query") };
    default: {
      const params: Record<string, string> = {};
      url.searchParams.forEach((v, k) => {
        params[k] = v;
      });
      return { kind: "unknown", action, params };
    }
  }
}
