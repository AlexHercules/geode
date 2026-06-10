import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import type { HeadingRef } from "@core/types";
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

export function OutlinePanel() {
  const app = useApp();
  const ws = useStore(app.workspace.state);
  const rev = useStore(app.metadata.revision);

  const activeTab = ws.tabs.find((t) => t.id === ws.activeTabId) ?? null;
  const activePath = activeTab?.viewType === "markdown" ? activeTab.filePath : null;

  // Collapse state keyed by heading index; reset whenever the file changes.
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    setCollapsed(new Set());
  }, [activePath]);

  const rows = useMemo(() => {
    void rev; // re-derive whenever the metadata index changes
    if (!activePath) return [];
    return buildRows(app.metadata.getMetadata(activePath)?.headings ?? []);
  }, [app, activePath, rev]);

  const shown = useMemo(() => visibleRows(rows, collapsed), [rows, collapsed]);

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
        <span>Outline</span>
        {activePath !== null && (
          <span className="outline-count" data-testid="outline-count">
            {rows.length}
          </span>
        )}
      </div>

      {!activePath ? (
        <div className="outline-empty" data-testid="outline-empty">
          Open a note to see its outline
        </div>
      ) : rows.length === 0 ? (
        <div className="outline-empty" data-testid="outline-empty">
          No headings in this note
        </div>
      ) : (
        <div className="outline-scroll" role="tree" aria-label="Document outline">
          {shown.map((row) => (
            <div
              key={row.index}
              className="outline-item"
              data-testid="outline-item"
              data-from={row.heading.from}
              data-level={row.heading.level}
              role="treeitem"
              aria-expanded={row.hasChildren ? !collapsed.has(row.index) : undefined}
              style={{ "--outline-depth": row.heading.level - 1 } as CSSProperties}
            >
              {row.hasChildren ? (
                <button
                  className="outline-chevron"
                  data-testid="outline-chevron"
                  aria-label={collapsed.has(row.index) ? "Expand section" : "Collapse section"}
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
