/**
 * Gap reporter — warn-stubbed compat APIs warn ONCE per (scope, api) and are
 * collected so the loader can print a consolidated status report. A gap never
 * crashes a plugin; it is recorded honestly instead (docs/OBSIDIAN-COMPAT.md).
 */
export interface GapEntry {
  /** plugin id or shim area, e.g. "Vault" / "geode-compat-fixture" */
  scope: string;
  /** the obsidian API that is missing/degraded, e.g. "Plugin.registerView" */
  api: string;
  detail?: string;
}

const warnedKeys = new Set<string>();
const pending: GapEntry[] = [];

export function reportGap(scope: string, api: string, detail?: string): void {
  const key = `${scope}|${api}`;
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(
    `[obsidian-compat] ${scope}: "${api}" is not implemented in Geode${detail ? ` — ${detail}` : ""}`,
  );
  pending.push({ scope, api, detail });
}

/** Take (and clear) the gaps recorded since the last drain — loader report. */
export function drainGaps(): GapEntry[] {
  return pending.splice(0);
}

/**
 * Reset ALL gap state (warn-once keys + pending entries). Called by the
 * loader at the start of every run so warn-once and the consolidated report
 * are both per-load, and runtime gaps hit between loads are not misattributed
 * to the next load.
 */
export function resetGaps(): void {
  warnedKeys.clear();
  pending.length = 0;
}
