import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import { useI18n } from "@core/i18n";
import type { LinkRef } from "@core/types";
import { findActiveTab } from "@core/workspace";
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

  const activeTab = findActiveTab(ws);
  const activePath = activeTab?.viewType === "markdown" ? activeTab.filePath : null;

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

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

  const createAndOpen = useCallback(
    (name: string) => {
      const path = app.vault.uniquePath("", name);
      void app.vault.create(path).then(
        () => app.workspace.openFile(path),
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
          <Section
            title={t("outgoinglinks.links")}
            count={resolved.length}
            collapsed={!!collapsed.links}
            onToggle={() => toggle("links")}
            testid="ol-section-links"
          >
            {resolved.length === 0 ? (
              <div className="ol-empty-sub">{t("outgoinglinks.noLinks")}</div>
            ) : (
              <div className="ol-list">{resolved.map(renderRow)}</div>
            )}
          </Section>

          <Section
            title={t("outgoinglinks.unresolved")}
            count={unresolved.length}
            collapsed={!!collapsed.unresolved}
            onToggle={() => toggle("unresolved")}
            testid="ol-section-unresolved"
          >
            {unresolved.length === 0 ? (
              <div className="ol-empty-sub">{t("outgoinglinks.noUnresolved")}</div>
            ) : (
              <div className="ol-list">{unresolved.map(renderRow)}</div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
