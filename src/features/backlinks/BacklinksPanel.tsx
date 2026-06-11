import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useStore } from "@core/store";
import { useI18n } from "@core/i18n";
import type { BacklinkEntry, LinkRef } from "@core/types";
import { findActiveTab } from "@core/workspace";
import "./backlinks.css";

type OutgoingEntry = { link: LinkRef; resolvedPath: string | null };

interface PanelData {
  backlinks: BacklinkEntry[];
  outgoing: OutgoingEntry[];
  tags: string[];
  mentionCount: number;
}

const EMPTY_DATA: PanelData = { backlinks: [], outgoing: [], tags: [], mentionCount: 0 };

function fileTitle(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

/* ---------------- collapsible section ---------------- */

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
    <section className="bl-section">
      <button
        className="bl-section-title"
        onClick={onToggle}
        aria-expanded={!collapsed}
        data-testid={testid}
      >
        <Icon
          name={collapsed ? "chevron-right" : "chevron-down"}
          size={14}
          className="bl-chevron"
        />
        <span className="bl-section-label">{title}</span>
        <span className="bl-count">{count}</span>
      </button>
      {!collapsed && <div className="bl-section-body">{children}</div>}
    </section>
  );
}

/* ---------------- panel ---------------- */

export function BacklinksPanel() {
  const app = useApp();
  const t = useI18n();
  const ws = useStore(app.workspace.state);
  const rev = useStore(app.metadata.revision);

  const activeTab = findActiveTab(ws);
  const activePath = activeTab?.viewType === "markdown" ? activeTab.filePath : null;

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  const data = useMemo<PanelData>(() => {
    void rev; // re-derive whenever the metadata index changes
    if (!activePath) return EMPTY_DATA;
    const backlinks = app.metadata.getBacklinks(activePath);
    // dedupe outgoing links by destination
    const seen = new Set<string>();
    const outgoing = app.metadata.getOutgoingLinks(activePath).filter(({ link, resolvedPath }) => {
      const key = resolvedPath ?? `unresolved:${link.target.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const tags = [...new Set((app.metadata.getMetadata(activePath)?.tags ?? []).map((t) => t.tag))];
    const mentionCount = backlinks.reduce((n, b) => n + b.contexts.length, 0);
    return { backlinks, outgoing, tags, mentionCount };
  }, [app, activePath, rev]);

  const createAndOpen = useCallback(
    (name: string) => {
      const path = app.vault.uniquePath("", name);
      void app.vault.create(path).then(
        () => app.workspace.openFile(path),
        (err) => console.error("[backlinks] failed to create note", err),
      );
    },
    [app],
  );

  return (
    <div className="backlinks-panel" data-testid="backlinks-panel">
      <div className="panel-header">{t("backlinks.title")}</div>
      {!activePath ? (
        <div className="bl-empty" data-testid="bl-empty">
          {t("backlinks.empty")}
        </div>
      ) : (
        <div className="bl-scroll">
          <Section
            title={t("backlinks.linkedMentions")}
            count={data.mentionCount}
            collapsed={!!collapsed.mentions}
            onToggle={() => toggle("mentions")}
            testid="bl-section-mentions"
          >
            {data.backlinks.length === 0 ? (
              <div className="bl-empty-sub">{t("backlinks.noBacklinks")}</div>
            ) : (
              data.backlinks.map((b) => (
                <div className="bl-source" key={b.sourcePath}>
                  <button
                    className="bl-source-name"
                    title={b.sourcePath}
                    data-testid="bl-source"
                    onClick={() => app.workspace.openFile(b.sourcePath)}
                  >
                    <Icon name="file-text" size={13} />
                    <span className="bl-ellipsis">{fileTitle(b.sourcePath)}</span>
                    <span className="bl-count">{b.contexts.length}</span>
                  </button>
                  <div className="bl-contexts">
                    {b.contexts.map((c, i) => (
                      <button
                        key={`${c.from}-${i}`}
                        className="bl-snippet"
                        data-testid="bl-snippet"
                        onClick={() => app.workspace.openFile(b.sourcePath)}
                      >
                        {c.snippet}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </Section>

          <Section
            title={t("backlinks.outgoingLinks")}
            count={data.outgoing.length}
            collapsed={!!collapsed.outgoing}
            onToggle={() => toggle("outgoing")}
            testid="bl-section-outgoing"
          >
            {data.outgoing.length === 0 ? (
              <div className="bl-empty-sub">{t("backlinks.noOutgoing")}</div>
            ) : (
              <div className="bl-out-list">
                {data.outgoing.map(({ link, resolvedPath }) => (
                  <button
                    key={resolvedPath ?? `unresolved:${link.target.toLowerCase()}`}
                    className={"bl-out" + (resolvedPath ? "" : " is-unresolved")}
                    title={resolvedPath ?? t("backlinks.createTitle", { name: link.target })}
                    data-testid="bl-outgoing"
                    onClick={() =>
                      resolvedPath
                        ? app.workspace.openFile(resolvedPath)
                        : createAndOpen(link.target)
                    }
                  >
                    <Icon name="link" size={13} />
                    <span className="bl-ellipsis">{link.target}</span>
                    {!resolvedPath && <span className="bl-new">{t("backlinks.newBadge")}</span>}
                  </button>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={t("backlinks.tags")}
            count={data.tags.length}
            collapsed={!!collapsed.tags}
            onToggle={() => toggle("tags")}
            testid="bl-section-tags"
          >
            {data.tags.length === 0 ? (
              <div className="bl-empty-sub">{t("backlinks.noTags")}</div>
            ) : (
              <div className="bl-tags">
                {data.tags.map((t) => (
                  <span key={t} className="bl-tag" data-testid="bl-tag">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
