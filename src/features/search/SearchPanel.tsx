import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import "./search.css";

interface LineHit {
  lineNo: number;
  text: string;
}

interface FileResult {
  path: string;
  basename: string;
  nameMatch: boolean;
  /** total content match count in this file */
  total: number;
  lines: LineHit[];
}

const MAX_LINES_PER_FILE = 5;
const CONTEXT_RADIUS = 36;
/**
 * Cap on rendered file blocks. Scanning 10k notes takes ~50ms; rendering
 * ~10k result blocks took 2.3s. We still scan and rank everything, then
 * render only the top files and report the full totals.
 */
const MAX_FILE_RESULTS = 200;

/** Stash a perf number on window.__geodePerf (dev/bench inspection only). */
function perfMark(key: string, value: number): void {
  const g = globalThis as unknown as { __geodePerf?: Record<string, number> };
  g.__geodePerf = { ...g.__geodePerf, [key]: Math.round(value * 100) / 100 };
}

/** Trim a long line to a window around the first occurrence of `lowerQuery`. */
function contextSlice(line: string, lowerQuery: string): string {
  const trimmed = line.trim();
  if (trimmed.length <= 110) return trimmed;
  const at = trimmed.toLowerCase().indexOf(lowerQuery);
  if (at === -1) return trimmed.slice(0, 110) + "…";
  const start = Math.max(0, at - CONTEXT_RADIUS);
  const end = Math.min(trimmed.length, at + lowerQuery.length + CONTEXT_RADIUS * 2);
  return (start > 0 ? "…" : "") + trimmed.slice(start, end) + (end < trimmed.length ? "…" : "");
}

/** Wrap each case-insensitive occurrence of `query` in <mark>. */
function highlight(text: string, query: string): ReactNode {
  const q = query.toLowerCase();
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let pos = 0;
  let key = 0;
  for (;;) {
    const at = lower.indexOf(q, pos);
    if (at === -1) break;
    if (at > pos) parts.push(text.slice(pos, at));
    parts.push(<mark key={key++}>{text.slice(at, at + q.length)}</mark>);
    pos = at + q.length;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts.length > 0 ? parts : text;
}

export function SearchPanel() {
  const app = useApp();
  const rev = useStore(app.metadata.revision);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<FileResult[]>([]);
  /** files matched beyond MAX_FILE_RESULTS (scanned + counted, not rendered) */
  const [hiddenFiles, setHiddenFiles] = useState(0);
  /** total match count across ALL files (rendered + hidden) */
  const [grandTotal, setGrandTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const trimmed = debounced.trim();
  const tagMode = trimmed.startsWith("#");
  const tagQuery = tagMode ? trimmed.slice(1).trim().toLowerCase() : "";

  /* ---------- tag mode ---------- */

  const tagEntries = useMemo(() => {
    if (!tagMode) return [];
    const map = app.metadata.getTagMap();
    return [...map.entries()]
      .filter(([tag]) => tag.toLowerCase().includes(tagQuery))
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.metadata, tagMode, tagQuery, rev]);

  /* ---------- full-text mode ---------- */

  useEffect(() => {
    if (!trimmed || tagMode) {
      setResults([]);
      setHiddenFiles(0);
      setGrandTotal(0);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const lower = trimmed.toLowerCase();

    void (async () => {
      const t0 = performance.now();
      const files = app.vault.getMarkdownFiles();
      const out: FileResult[] = [];
      for (const f of files) {
        let content: string;
        try {
          content = await app.vault.read(f.path);
        } catch {
          continue;
        }
        if (cancelled) return;
        const nameMatch = f.basename.toLowerCase().includes(lower);
        const lines = content.split("\n");
        const hits: LineHit[] = [];
        let total = 0;
        for (let i = 0; i < lines.length; i++) {
          const ll = lines[i].toLowerCase();
          let at = ll.indexOf(lower);
          if (at === -1) continue;
          while (at !== -1) {
            total++;
            at = ll.indexOf(lower, at + lower.length);
          }
          if (hits.length < MAX_LINES_PER_FILE) {
            hits.push({ lineNo: i + 1, text: contextSlice(lines[i], lower) });
          }
        }
        if (nameMatch || total > 0) {
          out.push({ path: f.path, basename: f.basename, nameMatch, total, lines: hits });
        }
      }
      out.sort(
        (a, b) =>
          Number(b.nameMatch) - Number(a.nameMatch) ||
          b.total - a.total ||
          a.basename.localeCompare(b.basename),
      );
      if (!cancelled) {
        perfMark("searchScanMs", performance.now() - t0);
        const total = out.reduce((n, r) => n + Math.max(r.total, r.nameMatch ? 1 : 0), 0);
        setGrandTotal(total);
        setHiddenFiles(Math.max(0, out.length - MAX_FILE_RESULTS));
        setResults(out.length > MAX_FILE_RESULTS ? out.slice(0, MAX_FILE_RESULTS) : out);
        setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.vault, trimmed, tagMode, rev]);

  const totalMatches = grandTotal;
  const totalFiles = results.length + hiddenFiles;

  const clear = () => {
    setQuery("");
    setDebounced("");
    inputRef.current?.focus();
  };

  const openFile = (path: string) => app.workspace.openFile(path);

  /* ---------- render ---------- */

  let body: ReactNode;
  if (!trimmed) {
    body = (
      <div className="search-hint">
        Type to search all notes.
        <br />
        Start with <code>#</code> to search tags.
      </div>
    );
  } else if (tagMode) {
    body =
      tagEntries.length === 0 ? (
        <div className="search-hint">No tags matching “#{tagQuery}”</div>
      ) : (
        <>
          <div className="search-meta">
            {tagEntries.length} {tagEntries.length === 1 ? "tag" : "tags"}
          </div>
          {tagEntries.map(([tag, paths]) => {
            const expanded = tag.toLowerCase() === tagQuery;
            return (
              <div className="search-file" key={tag}>
                <div
                  className="search-tag-row"
                  onClick={() => setQuery(`#${tag}`)}
                  data-testid="search-result"
                  title={`#${tag}`}
                >
                  <span className="search-tag-name">#{tag}</span>
                  <span className="search-tag-count">{paths.size}</span>
                </div>
                {expanded &&
                  [...paths].sort().map((path) => {
                    const base = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
                    return (
                      <div
                        key={path}
                        className="search-line"
                        onClick={() => openFile(path)}
                        title={path}
                      >
                        {base}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </>
      );
  } else if (searching && results.length === 0) {
    body = <div className="search-hint">Searching…</div>;
  } else if (results.length === 0) {
    body = <div className="search-hint">No results for “{trimmed}”</div>;
  } else {
    body = (
      <>
        <div className="search-meta">
          {totalMatches} {totalMatches === 1 ? "result" : "results"} in {totalFiles}{" "}
          {totalFiles === 1 ? "note" : "notes"}
          {hiddenFiles > 0 && ` · showing top ${results.length}`}
        </div>
        {results.map((r) => (
          <div className="search-file" key={r.path} data-testid="search-result">
            <div
              className="search-file-header"
              onClick={() => openFile(r.path)}
              title={r.path}
            >
              <span className="search-file-name">{highlight(r.basename, trimmed)}</span>
              {r.total > 0 && <span className="search-tag-count">{r.total}</span>}
            </div>
            {r.lines.map((line) => (
              <div
                key={line.lineNo}
                className="search-line"
                onClick={() => openFile(r.path)}
                title={`Line ${line.lineNo}`}
              >
                {highlight(line.text, trimmed)}
              </div>
            ))}
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="search-panel" data-testid="search-panel">
      <div className="panel-header">Search</div>
      <div className="search-input-wrap">
        <input
          ref={inputRef}
          className="search-input"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes…"
          spellCheck={false}
          data-testid="search-input"
        />
        {query && (
          <button
            className="search-clear"
            onClick={clear}
            aria-label="Clear search"
            data-testid="search-clear"
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
      <div className="search-results">{body}</div>
    </div>
  );
}
