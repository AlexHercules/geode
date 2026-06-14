import { useMemo } from "react";
import { useApp } from "@app/AppContext";
import { useStore } from "@core/store";
import { useI18n } from "@core/i18n";
import { findActiveTab } from "@core/workspace";
import "./footnotes.css";

/**
 * Footnotes pane (R65, ㉘) — Obsidian 1.9's "Footnotes view" core plugin: a
 * dedicated right-sidebar tab listing the active note's `[^id]: content`
 * definitions. Clicking a row scrolls the editor to that definition (reusing the
 * geode:scroll-to-heading offset event, same as OutlinePanel). Pure read/view —
 * reads the metadata footnote index, never writes.
 */
export function FootnotesPanel() {
  const app = useApp();
  const t = useI18n();
  const ws = useStore(app.workspace.state);
  const rev = useStore(app.metadata.revision);

  const activeTab = findActiveTab(ws);
  const activePath = activeTab?.viewType === "markdown" ? activeTab.filePath : null;

  const footnotes = useMemo(() => {
    void rev; // re-derive whenever the metadata index changes
    return activePath ? app.metadata.getFootnotes(activePath) : [];
  }, [app, activePath, rev]);

  const jumpTo = (from: number) => {
    if (!activePath) return;
    app.workspace.openFile(activePath);
    // rAF: if openFile just (re)mounted the editor, let it mount before jumping
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("geode:scroll-to-heading", { detail: { path: activePath, from } }),
      );
    });
  };

  return (
    <div className="footnotes-panel" data-testid="footnotes-panel">
      <div className="panel-header">
        <span>{t("footnotes.title")}</span>
        {activePath !== null && (
          <span className="fn-count" data-testid="fn-count">
            {footnotes.length}
          </span>
        )}
      </div>

      {!activePath ? (
        <div className="fn-empty" data-testid="fn-empty">
          {t("footnotes.empty")}
        </div>
      ) : footnotes.length === 0 ? (
        <div className="fn-empty" data-testid="fn-empty">
          {t("footnotes.noFootnotes")}
        </div>
      ) : (
        <div className="fn-scroll">
          {footnotes.map((fn, i) => (
            <button
              // id is not unique (duplicate defs keep both) — pair with index
              key={`${i}:${fn.id}`}
              className="fn-item"
              data-testid="fn-item"
              data-from={fn.from}
              title={`[^${fn.id}]: ${fn.content}`}
              onClick={() => jumpTo(fn.from)}
            >
              <span className="fn-marker">^{fn.id}</span>
              <span className="fn-content">{fn.content}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
