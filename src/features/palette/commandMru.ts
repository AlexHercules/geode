/**
 * R141 — per-vault MRU (most-recently-used) list of command ids, backing the command palette's
 * "recently used commands appear at the top" (Obsidian 1.8.3+). Pure UI state in raw localStorage
 * (the feature layer can't import compat's R129 loadLocalStorage); per-vault namespaced by vaultName
 * (Obsidian stores recents per-vault). Best-effort: any localStorage failure degrades to no-recency.
 */
const MAX_RECENT = 50;
const keyFor = (vaultName: string) => `geode.cmdRecent:${vaultName}`;

/** The recent command ids, most-recent first ([] on missing / corrupt / no localStorage). */
export function loadRecentCommands(vaultName: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(vaultName));
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    // dedupe too (R141 review): recordRecentCommand never writes dups, but a corrupt/external value
    // like ["x","x"] would otherwise render the command twice → duplicate React keys in the palette.
    return Array.isArray(arr) ? [...new Set(arr.filter((x): x is string => typeof x === "string"))] : [];
  } catch {
    return [];
  }
}

/** Record `id` as the most-recently-used command (dedupe → unshift → cap). No-op on failure. */
export function recordRecentCommand(vaultName: string, id: string): void {
  try {
    const next = [id, ...loadRecentCommands(vaultName).filter((x) => x !== id)].slice(0, MAX_RECENT);
    localStorage.setItem(keyFor(vaultName), JSON.stringify(next));
  } catch {
    /* localStorage quota/corrupt/unavailable — recency is best-effort, not load-bearing */
  }
}
