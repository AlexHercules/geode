/**
 * R203 (G C1): the recently-opened vaults list, backing the vault switcher. A GLOBAL list of
 * absolute vault paths (NOT per-vault — it spans vaults), most-recent first, in raw localStorage.
 *
 * Lives in core (not app) so the App shell and a future settings section can both consume it without
 * one feature importing another. Best-effort: any localStorage failure degrades to an empty list /
 * a no-op write. Holds NO filesystem access — removing an entry only forgets the path, it never
 * touches the vault's data.
 */
const KEY = "geode.recentVaults";
const MAX_RECENT = 10;

/**
 * Read the list defensively: [] on missing / corrupt / no localStorage. Guards every invariant the
 * switcher relies on — valid JSON, an array, string elements, and uniqueness (a corrupt value like
 * ["x","x"] would otherwise render a row twice → duplicate React keys).
 */
export function loadRecentVaults(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? [...new Set(arr.filter((x): x is string => typeof x === "string"))] : [];
  } catch {
    return [];
  }
}

/** Record `path` as the most-recently-opened vault (dedupe → unshift → cap). No-op on failure. */
export function pushRecentVault(path: string): void {
  if (!path) return;
  try {
    const next = [path, ...loadRecentVaults().filter((p) => p !== path)].slice(0, MAX_RECENT);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* localStorage quota/corrupt/unavailable — the recents list is best-effort, not load-bearing */
  }
}

/** Forget `path` (only the list entry — never the vault's data). No-op on failure. */
export function removeRecentVault(path: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadRecentVaults().filter((p) => p !== path)));
  } catch {
    /* best-effort */
  }
}
