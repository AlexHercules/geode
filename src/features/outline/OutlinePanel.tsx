import { useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import { useI18n } from "@core/i18n";
import type { HeadingRef } from "@core/types";
import { findActiveTab } from "@core/workspace";
import "./outline.css";

interface OutlineRow {
  /** index into the original headings array — used as collapse key */
  index: number;
  heading: HeadingRef;
  /** true when deeper-level headings immediately follow */
  hasChildren: boolean;
}

/** Build rows and child info from the flat heading list. */
function buildRows(headings: HeadingRef[]): OutlineRow[] {
  return headings.map((heading, index) => {
    const next = headings[index + 1];
    return {
      index,
      heading,
      hasChildren: next !== undefined && next.level > heading.level,
    };
  });
}

/**
 * Filter out rows hidden under a collapsed ancestor.
 * A row is hidden while its level is deeper than the shallowest collapsed
 * heading that precedes it.
 */
function visibleRows(rows: OutlineRow[], collapsed: ReadonlySet<number>): OutlineRow[] {
  const out: OutlineRow[] = [];
  let hideDeeperThan = Infinity; // hide rows with level > this
  for (const row of rows) {
    if (row.heading.level > hideDeeperThan) continue;
    out.push(row);
    hideDeeperThan =
      row.hasChildren && collapsed.has(row.index) ? row.heading.level : Infinity;
  }
  return out;
}

/**
 * ㉗ filter: keep rows whose heading text matches `query` (case-insensitive
 * substring) PLUS their ancestor headings, so a deep match still shows its path.
 * Descendants of a match are NOT included (matches Obsidian's outline filter).
 * Returns the rows to show and the set of indices that actually matched
 * (ancestors render dimmed). Empty/whitespace query → all rows, no matches.
 */
function filterRows(
  rows: OutlineRow[],
  query: string,
): { rows: OutlineRow[]; matched: ReadonlySet<number> } {
  const q = query.trim().toLowerCase();
  if (!q) return { rows, matched: new Set() };
  const matched = new Set<number>();
  for (const row of rows) {
    if (row.heading.text.toLowerCase().includes(q)) matched.add(row.index);
  }
  const show = new Set<number>(matched);
  for (const i of matched) {
    let level = rows[i].heading.level;
    for (let j = i - 1; j >= 0; j--) {
      if (rows[j].heading.level < level) {
        show.add(j);
        level = rows[j].heading.level;
        if (level === 1) break;
      }
    }
  }
  return { rows: rows.filter((r) => show.has(r.index)), matched };
}

export function OutlinePanel() {
  const app = useApp();
  const t = useI18n();
  const ws = useStore(app.workspace.state);
  const rev = useStore(app.metadata.revision);

  const activeTab = findActiveTab(ws);
  const activePath = activeTab?.viewType === "markdown" ? activeTab.filePath : null;

  // Collapse state keyed by heading index; reset whenever the file changes.
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  // ㉗ filter query; reset (with collapse) on file change.
  const [query, setQuery] = useState("");
  // useLayoutEffect (not useEffect): runs after DOM mutation but BEFORE paint, so
  // a newly-opened note never shows a frame filtered by the previous note's query
  // (which could flash "no matches"); a passive effect would reset after paint.
  useLayoutEffect(() => {
    setCollapsed(new Set());
    setQuery("");
  }, [activePath]);

  const rows = useMemo(() => {
    void rev; // re-derive whenever the metadata index changes
    if (!activePath) return [];
    return buildRows(app.metadata.getMetadata(activePath)?.headings ?? []);
  }, [app, activePath, rev]);

  const shown = useMemo(() => visibleRows(rows, collapsed), [rows, collapsed]);
  const filtering = query.trim() !== "";
  const filtered = useMemo(() => filterRows(rows, query), [rows, query]);
  // when filtering, show matches+ancestors (collapse ignored); else the
  // collapse-aware view.
  const display = filtering ? filtered.rows : shown;

  const toggleCollapse = (index: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const jumpTo = (from: number) => {
    if (!activePath) return;
    // Make sure the note is open & focused, then ask the editor (if listening)
    // to scroll to the heading offset. The editor feature subscribes to this
    // CustomEvent; no cross-feature import needed.
    app.workspace.openFile(activePath);
    // rAF: if openFile just (re)mounted the editor, let it mount before jumping
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("geode:scroll-to-heading", {
          detail: { path: activePath, from },
        }),
      );
    });
  };

  return (
    <div className="outline-panel" data-testid="outline-panel">
      <div className="panel-header">
        <span>{t("outline.title")}</span>
        {activePath !== null && (
          <span className="outline-count" data-testid="outline-count">
            {rows.length}
          </span>
        )}
      </div>

      {activePath !== null && rows.length > 0 && (
        <input
          className="outline-filter"
          data-testid="outline-filter"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("outline.filterPlaceholder")}
          aria-label={t("outline.filterPlaceholder")}
        />
      )}

      {!activePath ? (
        <div className="outline-empty" data-testid="outline-empty">
          {t("outline.empty")}
        </div>
      ) : rows.length === 0 ? (
        <div className="outline-empty" data-testid="outline-empty">
          {t("outline.noHeadings")}
        </div>
      ) : display.length === 0 ? (
        <div className="outline-empty" data-testid="outline-empty">
          {t("outline.noMatch")}
        </div>
      ) : (
        <div className="outline-scroll" role="tree" aria-label={t("outline.ariaTree")}>
          {display.map((row) => (
            <div
              key={row.index}
              className={
                "outline-item" +
                (filtering && !filtered.matched.has(row.index) ? " is-ancestor" : "")
              }
              data-testid="outline-item"
              data-from={row.heading.from}
              data-level={row.heading.level}
              role="treeitem"
              aria-expanded={!filtering && row.hasChildren ? !collapsed.has(row.index) : undefined}
              style={{ "--outline-depth": row.heading.level - 1 } as CSSProperties}
            >
              {!filtering && row.hasChildren ? (
                <button
                  className="outline-chevron"
                  data-testid="outline-chevron"
                  aria-label={
                    collapsed.has(row.index)
                      ? t("outline.expandSection")
                      : t("outline.collapseSection")
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapse(row.index);
                  }}
                >
                  <Icon
                    name={collapsed.has(row.index) ? "chevron-right" : "chevron-down"}
                    size={13}
                  />
                </button>
              ) : (
                <span className="outline-chevron-spacer" />
              )}
              <button
                className="outline-label"
                title={row.heading.text}
                onClick={() => jumpTo(row.heading.from)}
              >
                {row.heading.text}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
