import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import { useI18n } from "@core/i18n";
import type { LinkRef } from "@core/types";
import { findActiveTab } from "@core/workspace";
import { sortAndFilterLinks, type LinkSortKey } from "@core/linkPanel";
import { createNewNote } from "@core/newNote";
import "./outgoinglinks.css";

type OutEntry = { link: LinkRef; resolvedPath: string | null };

/* Collapsible section header — mirrors the BacklinksPanel Section (each feature
   owns its own copy; features must not import one another). */
function Section({
  title,
  count,
  collapsed,
  onToggle,
  testid,
  children,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  testid: string;
  children: ReactNode;
}) {
  return (
    <section className="ol-section">
      <button
        className="ol-section-title"
        onClick={onToggle}
        aria-expanded={!collapsed}
        data-testid={testid}
      >
        <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={14} className="ol-chevron" />
        <span className="ol-section-label">{title}</span>
        <span className="ol-count">{count}</span>
      </button>
      {!collapsed && <div className="ol-section-body">{children}</div>}
    </section>
  );
}

/**
 * Dedicated Outgoing Links pane (Obsidian's "Outgoing Links" core plugin), a
 * separate right-sidebar tab. Reuses the existing metadata index
 * (getOutgoingLinks) and splits it into resolved "Links" and "Unresolved links"
 * sections, matching Obsidian's two-section layout. Pure read/view — the only
 * write is create-on-click of an unresolved link (same as BacklinksPanel).
 */
export function OutgoingLinksPanel() {
  const app = useApp();
  const t = useI18n();
  const ws = useStore(app.workspace.state);
  const rev = useStore(app.metadata.revision);
  // R212: non-markdown active tab (graph or the main-area outgoing-links/backlinks/
  // outline tab) → follow the last active markdown file so the panel stays populated.
  const lastActive = useStore(app.workspace.lastActiveFile);

  const activeTab = findActiveTab(ws);
  const activePath = activeTab?.viewType === "markdown" ? activeTab.filePath : lastActive;

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  // R82 (㊷) toolbar: sort + name filter. "default" preserves document order.
  const [sortKey, setSortKey] = useState<LinkSortKey>("default");
  const [filter, setFilter] = useState("");
  // Reset on file switch so a stale filter doesn't make another note's real
  // outgoing links look empty (mirrors Obsidian's per-file panel state).
  useEffect(() => {
    setSortKey("default");
    setFilter("");
  }, [activePath]);
  // label = alias || target (the displayed name), so sort/filter match what the user sees.
  const outName = (e: OutEntry) => e.link.alias || e.link.target;

  const { resolved, unresolved } = useMemo(() => {
    void rev; // re-derive whenever the metadata index changes
    const resolved: OutEntry[] = [];
    const unresolved: OutEntry[] = [];
    if (!activePath) return { resolved, unresolved };
    // dedupe by destination (resolved path, or lowercased target for unresolved)
    const seen = new Set<string>();
    for (const entry of app.metadata.getOutgoingLinks(activePath)) {
      const key = entry.resolvedPath ?? `unresolved:${entry.link.target.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (entry.resolvedPath ? resolved : unresolved).push(entry);
    }
    return { resolved, unresolved };
  }, [app, activePath, rev]);

  const shownResolved = useMemo(
    () => sortAndFilterLinks(resolved, outName, sortKey, filter),
    [resolved, sortKey, filter],
  );
  const shownUnresolved = useMemo(
    () => sortAndFilterLinks(unresolved, outName, sortKey, filter),
    [unresolved, sortKey, filter],
  );

  const createAndOpen = useCallback(
    (name: string) => {
      void createNewNote(app.vault, name, app.workspace.getActiveFile()).then(
        (path) => app.workspace.openFile(path),
        (err) => console.error("[outgoinglinks] failed to create note", err),
      );
    },
    [app],
  );

  const renderRow = (entry: OutEntry) => (
    <button
      key={entry.resolvedPath ?? `unresolved:${entry.link.target.toLowerCase()}`}
      className={"ol-link" + (entry.resolvedPath ? "" : " is-unresolved")}
      title={entry.resolvedPath ?? t("outgoinglinks.createTitle", { name: entry.link.target })}
      data-testid="ol-link"
      data-hover-path={entry.resolvedPath ?? undefined}
      onClick={() =>
        entry.resolvedPath ? app.workspace.openFile(entry.resolvedPath) : createAndOpen(entry.link.target)
      }
    >
      <Icon name="link" size={13} />
      {/* display = alias || target, matching Geode's reading-view / live-preview
          convention (markdown.ts, livePreview.ts) so the label is consistent
          across surfaces. Dedup key + click still target the destination. */}
      <span className="ol-ellipsis">{entry.link.alias || entry.link.target}</span>
      {!entry.resolvedPath && <span className="ol-new">{t("outgoinglinks.newBadge")}</span>}
    </button>
  );

  return (
    <div className="outgoinglinks-panel" data-testid="outgoinglinks-panel">
      <div className="panel-header">{t("outgoinglinks.title")}</div>
      {!activePath ? (
        <div className="ol-empty" data-testid="ol-empty">
          {t("outgoinglinks.empty")}
        </div>
      ) : (
        <div className="ol-scroll">
          <div className="ol-toolbar" data-testid="ol-toolbar">
            <select
              className="ol-sort"
              data-testid="ol-sort"
              value={sortKey}
              aria-label={t("outgoinglinks.sortBy")}
              onChange={(e) => setSortKey(e.target.value as LinkSortKey)}
            >
              <option value="default">{t("outgoinglinks.sortDefault")}</option>
              <option value="name-asc">{t("outgoinglinks.sortNameAsc")}</option>
              <option value="name-desc">{t("outgoinglinks.sortNameDesc")}</option>
            </select>
            <input
              className="ol-filter"
              data-testid="ol-filter"
              value={filter}
              placeholder={t("outgoinglinks.filterPlaceholder")}
              aria-label={t("outgoinglinks.filterPlaceholder")}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <Section
            title={t("outgoinglinks.links")}
            count={shownResolved.length}
            collapsed={!!collapsed.links}
            onToggle={() => toggle("links")}
            testid="ol-section-links"
          >
            {resolved.length === 0 ? (
              <div className="ol-empty-sub">{t("outgoinglinks.noLinks")}</div>
            ) : shownResolved.length === 0 ? (
              <div className="ol-empty-sub">{t("outgoinglinks.noMatch")}</div>
            ) : (
              <div className="ol-list">{shownResolved.map(renderRow)}</div>
            )}
          </Section>

          <Section
            title={t("outgoinglinks.unresolved")}
            count={shownUnresolved.length}
            collapsed={!!collapsed.unresolved}
            onToggle={() => toggle("unresolved")}
            testid="ol-section-unresolved"
          >
            {unresolved.length === 0 ? (
              <div className="ol-empty-sub">{t("outgoinglinks.noUnresolved")}</div>
            ) : shownUnresolved.length === 0 ? (
              <div className="ol-empty-sub">{t("outgoinglinks.noMatch")}</div>
            ) : (
              <div className="ol-list">{shownUnresolved.map(renderRow)}</div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
