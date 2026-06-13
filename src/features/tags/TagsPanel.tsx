// Tags right-sidebar panel (R41): every vault tag + file count; click to search.
// Contract: docs/ARCHITECTURE.md "Round 41 additions".
// Layering: features/ may import only @core/*, @app/AppContext, @app/icons.
import { useMemo } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import "./tags.css";

export function TagsPanel() {
  const app = useApp();
  const t = useI18n();
  const rev = useStore(app.metadata.revision); // re-render on index change
  const tags = useMemo(() => {
    const map = app.metadata.getTagMap();
    return [...map.entries()]
      .map(([tag, files]) => ({ tag, count: files.size }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.metadata, rev]);

  return (
    <div className="tags-panel" data-testid="tags-panel">
      <div className="tags-panel-header">{t("tags.title")}</div>
      {tags.length === 0 ? (
        <div className="tags-empty">{t("tags.empty")}</div>
      ) : (
        <div className="tags-list" role="list">
          {tags.map(({ tag, count }) => (
            <button
              key={tag}
              className="tag-row"
              role="listitem"
              data-testid={`tag-row-${tag}`}
              title={t("tags.count", { count })}
              onClick={() => app.workspace.requestSearch(`#${tag}`)}
            >
              <span className="tag-row-icon"><Icon name="hash" size={13} /></span>
              <span className="tag-row-name">{tag}</span>
              <span className="tag-row-count">{count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
