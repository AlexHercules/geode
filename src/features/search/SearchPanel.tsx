import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import { useI18n } from "@core/i18n";
import type { I18nKey } from "@core/i18n";
import { parseSearchQuery, evaluateSearch } from "@core/search";
import type { SearchInput, SearchMatchRange, SearchParseErrorCode } from "@core/search";
import "./search.css";

interface LineHit {
  lineNo: number;
  text: string;
  /** highlight ranges, offsets into `text` */
  marks: SearchMatchRange[];
}

interface FileResult {
  path: string;
  basename: string;
  nameMatch: boolean;
  /** highlight ranges on basename */
  nameMarks: readonly SearchMatchRange[];
  /** ranges.length + (nameMatch ? 1 : 0) — frozen R21 counting */
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

const PARSE_ERROR_KEYS: Record<SearchParseErrorCode, I18nKey> = {
  "bad-regex": "search.errorBadRegex",
  "unclosed-quote": "search.errorUnclosedQuote",
  "unclosed-paren": "search.errorUnclosedParen",
  "empty-query-group": "search.errorEmptyGroup",
};

/** Stash a perf number on window.__geodePerf (dev/bench inspection only). */
function perfMark(key: string, value: number): void {
  const g = globalThis as unknown as { __geodePerf?: Record<string, number> };
  g.__geodePerf = { ...g.__geodePerf, [key]: Math.round(value * 100) / 100 };
}

/**
 * Trim a long line to a window anchored at its first match range, remapping
 * the ranges into offsets of the returned display text.
 */
function sliceLine(
  raw: string,
  ranges: SearchMatchRange[],
): { text: string; marks: SearchMatchRange[] } {
  const leading = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  const local = ranges
    .map((r) => ({
      from: Math.max(0, Math.min(r.from - leading, trimmed.length)),
      to: Math.max(0, Math.min(r.to - leading, trimmed.length)),
    }))
    .filter((r) => r.to > r.from);
  if (trimmed.length <= 110) return { text: trimmed, marks: local };
  const first = local[0];
  if (!first) return { text: trimmed.slice(0, 110) + "…", marks: [] };
  const start = Math.max(0, first.from - CONTEXT_RADIUS);
  const end = Math.min(trimmed.length, first.to + CONTEXT_RADIUS * 2);
  const prefix = start > 0 ? "…" : "";
  const text = prefix + trimmed.slice(start, end) + (end < trimmed.length ? "…" : "");
  const marks: SearchMatchRange[] = [];
  for (const r of local) {
    const from = Math.max(r.from, start);
    const to = Math.min(r.to, end);
    if (to > from) marks.push({ from: from - start + prefix.length, to: to - start + prefix.length });
  }
  return { text, marks };
}

/**
 * Map sorted, merged content-offset ranges onto lines. Every range counts
 * toward `total` upstream; only the first MAX_LINES_PER_FILE matched lines
 * are materialized for display. Multi-line ranges are clipped to their
 * starting line.
 */
function deriveLineHits(content: string, ranges: readonly SearchMatchRange[]): LineHit[] {
  const out: LineHit[] = [];
  if (ranges.length === 0) return out;
  const lines = content.split("\n");
  let ri = 0;
  let lineStart = 0;
  for (let i = 0; i < lines.length && ri < ranges.length; i++) {
    const lineEnd = lineStart + lines[i].length;
    // strict `<`: a range starting exactly on the newline belongs to the NEXT
    // line (its visible text starts there); `from` is clamped because such a
    // range reaches this line from the preceding newline.
    if (ranges[ri].from < lineEnd) {
      const local: SearchMatchRange[] = [];
      while (ri < ranges.length && ranges[ri].from < lineEnd) {
        local.push({
          from: Math.max(0, ranges[ri].from - lineStart),
          to: Math.min(ranges[ri].to, lineEnd) - lineStart,
        });
        ri++;
      }
      const { text, marks } = sliceLine(lines[i], local);
      out.push({ lineNo: i + 1, text, marks });
      if (out.length >= MAX_LINES_PER_FILE) break;
    }
    lineStart = lineEnd + 1;
  }
  return out;
}

/** Wrap each range of `text` in <mark>. Ranges must be sorted + disjoint. */
function highlightRanges(text: string, marks: readonly SearchMatchRange[]): ReactNode {
  if (marks.length === 0) return text;
  const parts: ReactNode[] = [];
  let pos = 0;
  let key = 0;
  for (const m of marks) {
    if (m.from > pos) parts.push(text.slice(pos, m.from));
    parts.push(<mark key={key++}>{text.slice(m.from, m.to)}</mark>);
    pos = m.to;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

export function SearchPanel() {
  const app = useApp();
  const t = useI18n();
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

  const searchReq = useStore(app.workspace.searchRequest);
  useEffect(() => {
    if (searchReq !== null) {
      setQuery(searchReq);
      app.workspace.searchRequest.set(null);
    }
  }, [searchReq, app.workspace]);

  const trimmed = debounced.trim();
  // tag BROWSER only for a whole-query bare `#…` token; anything else (spaces,
  // operators) goes through the query parser, where `#tag` means tag:tag.
  const tagMode = /^#\S*$/.test(trimmed);
  const tagQuery = tagMode ? trimmed.slice(1).toLowerCase() : "";

  const parsed = useMemo(
    () => (!trimmed || tagMode ? null : parseSearchQuery(trimmed)),
    [trimmed, tagMode],
  );

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
    const expr = parsed && !parsed.error ? parsed.expr : null;
    if (!expr) {
      setResults([]);
      setHiddenFiles(0);
      setGrandTotal(0);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);

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
        const input: SearchInput = {
          path: f.path,
          fileName: f.path.split("/").pop() ?? f.path,
          basename: f.basename,
          content,
          // metadata index stores tags without '#' already
          tags: app.metadata.getMetadata(f.path)?.tags.map((tag) => tag.tag) ?? [],
        };
        const outcome = evaluateSearch(expr, input);
        if (!outcome.matched) continue;
        const nameMatch = outcome.nameRanges.length > 0;
        out.push({
          path: f.path,
          basename: f.basename,
          nameMatch,
          nameMarks: outcome.nameRanges,
          total: outcome.ranges.length + (nameMatch ? 1 : 0),
          lines: deriveLineHits(content, outcome.ranges),
        });
      }
      out.sort(
        (a, b) =>
          Number(b.nameMatch) - Number(a.nameMatch) ||
          b.total - a.total ||
          a.basename.localeCompare(b.basename),
      );
      if (!cancelled) {
        perfMark("searchScanMs", performance.now() - t0);
        setGrandTotal(out.reduce((n, r) => n + r.total, 0));
        setHiddenFiles(Math.max(0, out.length - MAX_FILE_RESULTS));
        setResults(out.length > MAX_FILE_RESULTS ? out.slice(0, MAX_FILE_RESULTS) : out);
        setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.vault, app.metadata, parsed, rev]);

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
        {t("search.hintType")}
        <br />
        {t("search.hintTagsBefore")}
        <code>#</code>
        {t("search.hintTagsAfter")}
        <br />
        {t("search.hintOperators")}
      </div>
    );
  } else if (tagMode) {
    body =
      tagEntries.length === 0 ? (
        <div className="search-hint">{t("search.noTags", { query: tagQuery })}</div>
      ) : (
        <>
          <div className="search-meta">
            {t(tagEntries.length === 1 ? "search.tagsOne" : "search.tagsMany", {
              count: tagEntries.length,
            })}
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
  } else if (parsed?.error) {
    body = (
      <div className="search-hint search-error" data-testid="search-error">
        {t(PARSE_ERROR_KEYS[parsed.error.code])}
        {parsed.error.detail && (
          <div className="search-error-detail">{parsed.error.detail}</div>
        )}
      </div>
    );
  } else if (!parsed?.expr) {
    // parser collapsed the query to nothing (whitespace-only after tokenizing)
    body = (
      <div className="search-hint">
        {t("search.hintType")}
        <br />
        {t("search.hintOperators")}
      </div>
    );
  } else if (searching && results.length === 0) {
    body = <div className="search-hint">{t("search.searching")}</div>;
  } else if (results.length === 0) {
    body = <div className="search-hint">{t("search.noResults", { query: trimmed })}</div>;
  } else {
    body = (
      <>
        <div className="search-meta">
          {t("search.meta", {
            results: t(totalMatches === 1 ? "search.resultsOne" : "search.resultsMany", {
              count: totalMatches,
            }),
            notes: t(totalFiles === 1 ? "search.notesOne" : "search.notesMany", {
              count: totalFiles,
            }),
          })}
          {hiddenFiles > 0 && ` · ${t("search.showingTop", { count: results.length })}`}
        </div>
        {results.map((r) => (
          <div className="search-file" key={r.path} data-testid="search-result">
            <div
              className="search-file-header"
              onClick={() => openFile(r.path)}
              title={r.path}
            >
              <span className="search-file-name">{highlightRanges(r.basename, r.nameMarks)}</span>
              {r.total > 0 && <span className="search-tag-count">{r.total}</span>}
            </div>
            {r.lines.map((line) => (
              <div
                key={line.lineNo}
                className="search-line"
                onClick={() => openFile(r.path)}
                title={t("search.lineTooltip", { line: line.lineNo })}
              >
                {highlightRanges(line.text, line.marks)}
              </div>
            ))}
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="search-panel" data-testid="search-panel">
      <div className="panel-header">{t("search.title")}</div>
      <div className="search-input-wrap">
        <input
          ref={inputRef}
          className="search-input"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          spellCheck={false}
          data-testid="search-input"
        />
        {query && (
          <button
            className="search-clear"
            onClick={clear}
            aria-label={t("search.clear")}
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
