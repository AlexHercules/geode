/**
 * R46: obsidian:// URI parser (PURE). Maps obsidian://<action>?<params> to a
 * structured action. The impure executor (open/create/search) lives in
 * features/editor/obsidianUriHandler.ts; this stays pure so it is the reusable
 * core for both in-app routing and a future OS deep-link handler.
 */
export type ObsidianAction =
  | { kind: "open"; vault?: string; file?: string; path?: string; heading?: string; block?: string }
  | { kind: "new"; vault?: string; file?: string; name?: string; content?: string }
  | { kind: "search"; vault?: string; query?: string }
  | { kind: "unknown"; action: string; params: Record<string, string> };

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
