/**
 * Per-vault command-palette state in raw localStorage, backing two faithful Obsidian behaviours:
 *  - R141 "recently used commands appear at the top" (Obsidian 1.8.3+) — an MRU id list.
 *  - R142 "pinned commands" (Settings → Command palette) — an ordered id list shown above recents.
 *
 * Lives in core (not features/palette) because two features consume it: the palette display
 * (sorting) and the settings section (pin/unpin UI), and the layering rule forbids one feature
 * importing another. Core holds no `app`, so callers pass `app.vault.vaultName` (Obsidian stores
 * both lists per-vault). Best-effort: any localStorage failure degrades to no-recency / no-pins.
 */
const MAX_RECENT = 50;
const recentKey = (vaultName: string) => `geode.cmdRecent:${vaultName}`;
const pinnedKey = (vaultName: string) => `geode.cmdPinned:${vaultName}`;

/**
 * Read a stored id list defensively: [] on missing / corrupt / no localStorage. Guards every
 * invariant the palette relies on — valid JSON, an array, string elements, and (R141 review)
 * uniqueness, since a corrupt/external value like ["x","x"] would otherwise render a command
 * twice → duplicate React keys. Shared by both the recent and pinned loaders.
 */
function loadIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? [...new Set(arr.filter((x): x is string => typeof x === "string"))] : [];
  } catch {
    return [];
  }
}

/** The recent command ids, most-recent first ([] on missing / corrupt / no localStorage). */
export function loadRecentCommands(vaultName: string): string[] {
  return loadIds(recentKey(vaultName));
}

/** Record `id` as the most-recently-used command (dedupe → unshift → cap). No-op on failure. */
export function recordRecentCommand(vaultName: string, id: string): void {
  try {
    const next = [id, ...loadRecentCommands(vaultName).filter((x) => x !== id)].slice(0, MAX_RECENT);
    localStorage.setItem(recentKey(vaultName), JSON.stringify(next));
  } catch {
    /* localStorage quota/corrupt/unavailable — recency is best-effort, not load-bearing */
  }
}

/** The pinned command ids, in pin order ([] on missing / corrupt / no localStorage). */
export function loadPinnedCommands(vaultName: string): string[] {
  return loadIds(pinnedKey(vaultName));
}

/** Persist the pinned command ids (dedupe, order preserved). No-op on failure. */
export function setPinnedCommands(vaultName: string, ids: string[]): void {
  try {
    localStorage.setItem(pinnedKey(vaultName), JSON.stringify([...new Set(ids)]));
  } catch {
    /* localStorage quota/corrupt/unavailable — pins are best-effort, not load-bearing */
  }
}
