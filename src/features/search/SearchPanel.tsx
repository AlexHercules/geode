import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import { useI18n } from "@core/i18n";
import type { I18nKey } from "@core/i18n";
import { parseSearchQuery, evaluateSearch } from "@core/search";
import { excludedRaw, isExcluded } from "@core/excludedFiles";
import type { SearchInput, SearchMatchRange, SearchParseErrorCode } from "@core/search";
import "./search.css";

interface LineHit {
  lineNo: number;
  text: string;
  /** highlight ranges, offsets into `text` */
  marks: SearchMatchRange[];
  /** R80: the full (untrimmed-window) line + its marks, for "more context" */
  fullText: string;
  fullMarks: SearchMatchRange[];
}

/** R80: result sort orders. "relevance" is the prior default (name match → count
 *  → name), preserved for zero regression. */
type SortKey = "relevance" | "name-asc" | "name-desc" | "count-desc" | "count-asc";

/** R222: toggle a tag within a freeform search query (Obsidian's Cmd/Ctrl-click on a
 *  tag-pane row — accumulate `tag:` filters instead of replacing). Splits on whitespace
 *  and removes the tag if already present as `tag:TAG` or `#TAG`, else appends `tag:TAG`
 *  (the operator form ANDs multiple tags). Pure — exported for the e2e/probe. */
export function toggleTagInQuery(query: string, tag: string): string {
  const tokens = query.split(/\s+/).filter(Boolean);
  const idx = tokens.findIndex((tk) => tk === `tag:${tag}` || tk === `#${tag}`);
  if (idx >= 0) tokens.splice(idx, 1);
  else tokens.push(`tag:${tag}`);
  return tokens.join(" ");
}

/** Sort matched files by the chosen order. Pure — exported for the probe. */
export function sortResults<T extends { basename: string; nameMatch: boolean; total: number }>(
  results: readonly T[],
  key: SortKey,
): T[] {
  const out = [...results];
  switch (key) {
    case "name-asc":
      return out.sort((a, b) => a.basename.localeCompare(b.basename));
    case "name-desc":
      return out.sort((a, b) => b.basename.localeCompare(a.basename));
    case "count-desc":
      return out.sort((a, b) => b.total - a.total || a.basename.localeCompare(b.basename));
    case "count-asc":
      return out.sort((a, b) => a.total - b.total || a.basename.localeCompare(b.basename));
    default: // "relevance"
      return out.sort(
        (a, b) =>
          Number(b.nameMatch) - Number(a.nameMatch) ||
          b.total - a.total ||
          a.basename.localeCompare(b.basename),
      );
  }
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

/** R80: read/persist a small search toolbar pref (localStorage, single key). */
function readSearchPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function persistSearchPref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — session-only */
  }
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
): { text: string; marks: SearchMatchRange[]; fullText: string; fullMarks: SearchMatchRange[] } {
  const leading = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  const local = ranges
    .map((r) => ({
      from: Math.max(0, Math.min(r.from - leading, trimmed.length)),
      to: Math.max(0, Math.min(r.to - leading, trimmed.length)),
    }))
    .filter((r) => r.to > r.from);
  // R80: full form = the whole trimmed line; the windowed `text` is the default
  // compact view, `fullText` is shown when "more context" is on.
  if (trimmed.length <= 110) return { text: trimmed, marks: local, fullText: trimmed, fullMarks: local };
  const first = local[0];
  if (!first) return { text: trimmed.slice(0, 110) + "…", marks: [], fullText: trimmed, fullMarks: local };
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
  return { text, marks, fullText: trimmed, fullMarks: local };
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
      const { text, marks, fullText, fullMarks } = sliceLine(lines[i], local);
      out.push({ lineNo: i + 1, text, marks, fullText, fullMarks });
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
  const excluded = useStore(excludedRaw); // R96: re-scan when the exclude list changes
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  /** every matched file (unsorted, untruncated) — `results` is derived from it */
  const [allResults, setAllResults] = useState<FileResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // R80: toolbar prefs — sort + more-context persisted; collapse is per-session
  const [sortKey, setSortKey] = useState<SortKey>(() => readSearchPref("geode.searchSort", "relevance") as SortKey);
  const [moreContext, setMoreContext] = useState(() => readSearchPref("geode.searchContext", "") === "1");
  // R143: global "Match case" toggle (Obsidian's Aa) — flips default-mode terms;
  // explicit match-case:/ignore-case: operators still win. Persisted like the rest.
  const [matchCase, setMatchCase] = useState(() => readSearchPref("geode.searchCase", "") === "1");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false); // transient "copied" feedback on the copy button

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

  // R222: Cmd/Ctrl-click on a tag-pane row toggles the tag within the live query.
  // Toggle is self-inverse, so a StrictMode double-fire would on→off-cancel — read
  // the value fresh via .get() and clear it FIRST so the second invoke early-returns
  // (memory: geode-oneshot-store-strictmode). setQuery's functional form reads live query.
  const tagToggle = useStore(app.workspace.searchTagToggle);
  useEffect(() => {
    const tag = app.workspace.searchTagToggle.get();
    if (tag === null) return;
    app.workspace.searchTagToggle.set(null);
    setQuery((q) => toggleTagInQuery(q, tag));
  }, [tagToggle, app.workspace]);

  // R239: mirror the live query so the bookmarks:bookmark-search command can read it.
  useEffect(() => {
    app.workspace.currentSearchQuery.set(query);
  }, [query, app.workspace]);

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
      setAllResults([]);
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
        if (isExcluded(f.path)) continue; // R96: excluded files don't appear in search
        let content: string;
        try {
          content = await app.vault.read(f.path);
        } catch {
          continue;
        }
        if (cancelled) return;
        const meta = app.metadata.getMetadata(f.path);
        const input: SearchInput = {
          path: f.path,
          fileName: f.path.split("/").pop() ?? f.path,
          basename: f.basename,
          content,
          // metadata index stores tags without '#' already
          tags: meta?.tags.map((tag) => tag.tag) ?? [],
          // R68: frontmatter fields drive the `[property]` operator
          frontmatter: meta?.frontmatter?.fields,
        };
        const outcome = evaluateSearch(expr, input, matchCase);
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
      if (!cancelled) {
        perfMark("searchScanMs", performance.now() - t0);
        // R80: store the full matched set; sort + truncate happen in the memo
        // below so changing the sort order never re-scans the vault.
        setAllResults(out);
        setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app.vault, app.metadata, parsed, rev, excluded, matchCase]);

  // R80: sort + truncate derived from allResults (re-sort never re-scans).
  const results = useMemo(
    () => sortResults(allResults, sortKey).slice(0, MAX_FILE_RESULTS),
    [allResults, sortKey],
  );
  const totalMatches = useMemo(() => allResults.reduce((n, r) => n + r.total, 0), [allResults]);
  const totalFiles = allResults.length;
  const hiddenFiles = Math.max(0, allResults.length - results.length);

  const clear = () => {
    setQuery("");
    setDebounced("");
    inputRef.current?.focus();
  };

  const openFile = (path: string) => app.workspace.openFile(path);

  /* ---------- R80: toolbar handlers ---------- */
  const changeSort = (key: SortKey) => {
    setSortKey(key);
    persistSearchPref("geode.searchSort", key);
  };
  const toggleMoreContext = () => {
    setMoreContext((v) => {
      persistSearchPref("geode.searchContext", v ? "0" : "1");
      return !v;
    });
  };
  const toggleMatchCase = () => {
    setMatchCase((v) => {
      persistSearchPref("geode.searchCase", v ? "0" : "1");
      return !v;
    });
  };
  const toggleFileCollapsed = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  /** collapse all when any file is expanded, otherwise expand all */
  const toggleCollapseAll = () =>
    setCollapsed((prev) =>
      results.some((r) => !prev.has(r.path)) ? new Set(results.map((r) => r.path)) : new Set(),
    );
  const copyResults = () => {
    // full path (sans .md) keeps the link portable when pasted elsewhere — a bare
    // basename resolves to the wrong file when two notes share it (R77 lesson).
    const text = results.map((r) => `- [[${r.path.replace(/\.md$/, "")}]]`).join("\n");
    try {
      void navigator.clipboard.writeText(text).catch(() => {});
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context) — no feedback */
    }
  };
  const allCollapsed = results.length > 0 && results.every((r) => collapsed.has(r.path));

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
        {results.map((r) => {
          const isCollapsed = collapsed.has(r.path);
          return (
            <div className="search-file" key={r.path} data-testid="search-result">
              <div className="search-file-header" title={r.path}>
                <button
                  className="search-file-chevron"
                  data-testid="search-file-chevron"
                  onClick={() => toggleFileCollapsed(r.path)}
                  aria-expanded={!isCollapsed}
                  aria-label={t(isCollapsed ? "search.expandAll" : "search.collapseAll")}
                >
                  <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} size={13} />
                </button>
                <span className="search-file-name" onClick={() => openFile(r.path)}>
                  {highlightRanges(r.basename, r.nameMarks)}
                </span>
                {r.total > 0 && <span className="search-tag-count">{r.total}</span>}
              </div>
              {!isCollapsed &&
                r.lines.map((line) => (
                  <div
                    key={line.lineNo}
                    className="search-line"
                    onClick={() => openFile(r.path)}
                    title={t("search.lineTooltip", { line: line.lineNo })}
                  >
                    {highlightRanges(
                      moreContext ? line.fullText : line.text,
                      moreContext ? line.fullMarks : line.marks,
                    )}
                  </div>
                ))}
            </div>
          );
        })}
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
        <button
          className={"search-case-toggle" + (matchCase ? " is-active" : "")}
          onClick={toggleMatchCase}
          aria-pressed={matchCase}
          aria-label={t("search.matchCase")}
          title={t("search.matchCase")}
          data-testid="search-case-toggle"
        >
          Aa
        </button>
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
      {allResults.length > 0 && (
        <div className="search-toolbar" data-testid="search-toolbar">
          <select
            className="search-sort"
            data-testid="search-sort"
            value={sortKey}
            aria-label={t("search.sortBy")}
            onChange={(e) => changeSort(e.target.value as SortKey)}
          >
            <option value="relevance">{t("search.sortRelevance")}</option>
            <option value="name-asc">{t("search.sortNameAsc")}</option>
            <option value="name-desc">{t("search.sortNameDesc")}</option>
            <option value="count-desc">{t("search.sortCountDesc")}</option>
            <option value="count-asc">{t("search.sortCountAsc")}</option>
          </select>
          <button
            className={"search-tool-btn" + (allCollapsed ? " is-active" : "")}
            data-testid="search-collapse-toggle"
            onClick={toggleCollapseAll}
            aria-label={t(allCollapsed ? "search.expandAll" : "search.collapseAll")}
            title={t(allCollapsed ? "search.expandAll" : "search.collapseAll")}
          >
            <Icon name={allCollapsed ? "chevron-right" : "chevron-down"} size={14} />
          </button>
          <button
            className={"search-tool-btn" + (moreContext ? " is-active" : "")}
            data-testid="search-context-toggle"
            onClick={toggleMoreContext}
            aria-pressed={moreContext}
            aria-label={t("search.moreContext")}
            title={t("search.moreContext")}
          >
            <Icon name="list" size={14} />
          </button>
          <button
            className={"search-tool-btn" + (copied ? " is-active" : "")}
            data-testid="search-copy"
            onClick={copyResults}
            aria-label={t("search.copyResults")}
            title={copied ? t("search.copied") : t("search.copyResults")}
          >
            <Icon name={copied ? "check" : "copy"} size={14} />
          </button>
        </div>
      )}
      <div className="search-results">{body}</div>
    </div>
  );
}
