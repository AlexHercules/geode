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
const RECORDS_KEY = "geode.recentVaultRecords.v1";
const MAX_RECENT = 10;

export interface RecentVaultRecord {
  /** Stable manager identity. It survives display-name and location edits. */
  id: string;
  path: string;
  /** Optional manager-only label; never renames or writes the vault folder. */
  name?: string;
  lastOpened?: number;
}

function defaultRecordId(path: string): string {
  // FNV-1a: deterministic for legacy string-only entries, compact enough to copy.
  let hash = 0x811c9dc5;
  for (let index = 0; index < path.length; index++) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `geode-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function loadRecordMetadata(): RecentVaultRecord[] {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry): RecentVaultRecord[] => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Partial<RecentVaultRecord>;
      if (typeof record.path !== "string" || !record.path) return [];
      return [{
        id: typeof record.id === "string" && record.id ? record.id : defaultRecordId(record.path),
        path: record.path,
        ...(typeof record.name === "string" && record.name.trim() ? { name: record.name.trim() } : {}),
        ...(typeof record.lastOpened === "number" ? { lastOpened: record.lastOpened } : {}),
      }];
    });
  } catch {
    return [];
  }
}

function saveRecordMetadata(records: RecentVaultRecord[]): void {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    /* metadata is best-effort; the legacy path list stays load-bearing */
  }
}

function saveRecentPaths(paths: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(paths));
  } catch {
    /* best-effort */
  }
}

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

/** Ordered manager records, transparently upgrading the legacy string path list. */
export function loadRecentVaultRecords(): RecentVaultRecord[] {
  const metadata = new Map(loadRecordMetadata().map((record) => [record.path, record]));
  return loadRecentVaults().map((path) => metadata.get(path) ?? {
    id: defaultRecordId(path),
    path,
  });
}

/** Record `path` as the most-recently-opened vault (dedupe → unshift → cap). No-op on failure. */
export function pushRecentVault(path: string): void {
  if (!path) return;
  try {
    const next = [path, ...loadRecentVaults().filter((p) => p !== path)].slice(0, MAX_RECENT);
    saveRecentPaths(next);
    const records = loadRecentVaultRecords();
    const existing = records.find((record) => record.path === path);
    const byPath = new Map(records.map((record) => [record.path, record]));
    byPath.set(path, {
      ...(existing ?? { id: defaultRecordId(path), path }),
      path,
      lastOpened: Date.now(),
    });
    saveRecordMetadata(next.map((recentPath) => byPath.get(recentPath) ?? {
      id: defaultRecordId(recentPath),
      path: recentPath,
    }));
  } catch {
    /* localStorage quota/corrupt/unavailable — the recents list is best-effort, not load-bearing */
  }
}

/** Forget `path` (only the list entry — never the vault's data). No-op on failure. */
export function removeRecentVault(path: string): void {
  try {
    saveRecentPaths(loadRecentVaults().filter((p) => p !== path));
    saveRecordMetadata(loadRecordMetadata().filter((record) => record.path !== path));
  } catch {
    /* best-effort */
  }
}

/** Rename only the manager record. Vault folders and note data are untouched. */
export function renameRecentVaultRecord(path: string, name: string): void {
  const trimmed = name.trim();
  const records = loadRecentVaultRecords();
  saveRecordMetadata(records.map((record) => record.path === path
    ? { ...record, ...(trimmed ? { name: trimmed } : { name: undefined }) }
    : record));
}

/**
 * Update a record after the user moved a vault externally. This never moves,
 * copies, deletes, or rewrites files; the stable record id and alias survive.
 */
export function relocateRecentVaultRecord(oldPath: string, newPath: string): void {
  const trimmed = newPath.trim();
  if (!trimmed || oldPath === trimmed) return;
  const paths = loadRecentVaults();
  const nextPaths = [...new Set(paths.map((path) => path === oldPath ? trimmed : path))].slice(0, MAX_RECENT);
  const records = loadRecentVaultRecords();
  const source = records.find((record) => record.path === oldPath) ?? {
    id: defaultRecordId(oldPath),
    path: oldPath,
  };
  const remaining = records.filter((record) => record.path !== oldPath && record.path !== trimmed);
  const moved = { ...source, path: trimmed };
  const byPath = new Map([...remaining, moved].map((record) => [record.path, record]));
  saveRecentPaths(nextPaths);
  saveRecordMetadata(nextPaths.map((path) => byPath.get(path) ?? {
    id: defaultRecordId(path),
    path,
  }));
}
