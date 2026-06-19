/**
 * R96 (㊽ 续续续): Obsidian "Excluded files" (Settings → Files & Links). A list of
 * path patterns; matching files are hidden from search results + the graph and dimmed
 * in the file explorer (they remain fully openable — a soft exclude, not a delete).
 *
 * Pattern forms (matched against the vault-relative PATH, per Obsidian):
 *   - `{regex}<re>`  → `<re>` as a JavaScript regex (invalid regex → that line is ignored)
 *   - otherwise      → a glob where `*` is a wildcard, matched ANYWHERE in the path
 *                      (e.g. `*.png` excludes attachments, `Archive/` excludes a folder)
 *
 * Pure-front-end, read-only: never writes or deletes a file.
 */
import { Store } from "./store";

const EXCLUDED_KEY = "geode.excludedFiles";

function readRaw(): string {
  try {
    return localStorage.getItem(EXCLUDED_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Verbatim multi-line patterns text (one pattern per line). "" = nothing excluded. */
export const excludedRaw = new Store<string>(readRaw());

export function setExcludedFiles(raw: string): void {
  excludedRaw.set(raw);
  try {
    if (raw.trim()) localStorage.setItem(EXCLUDED_KEY, raw);
    else localStorage.removeItem(EXCLUDED_KEY);
  } catch {
    /* storage unavailable — session-only */
  }
}

/** Compile one pattern line to a RegExp, or null if blank / invalid. */
function compile(line: string): RegExp | null {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith("{regex}")) {
    try {
      return new RegExp(t.slice(7));
    } catch {
      return null; // malformed regex → ignore this line (never throw)
    }
  }
  // glob: escape regex metacharacters (incl. `?`, which Obsidian treats as a literal —
  // only `*` is a wildcard), then turn `*` into `.*` (substring-anywhere match)
  const escaped = t.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try {
    return new RegExp(escaped);
  } catch {
    return null;
  }
}

// recompile only when the raw text changes (cheap reuse across a search/graph scan)
let cachedRaw: string | null = null;
let cachedRes: RegExp[] = [];

/** True when `path` matches any excluded-files pattern. */
export function isExcluded(path: string): boolean {
  const raw = excludedRaw.get();
  if (!raw.trim()) return false;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedRes = raw.split("\n").map(compile).filter((re): re is RegExp => re !== null);
  }
  return cachedRes.some((re) => re.test(path));
}
