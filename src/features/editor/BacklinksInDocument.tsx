import { useMemo, type KeyboardEvent } from "react";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import { basename, stripExtension } from "@core/vault";

/** R154 (㊷): Obsidian's "Backlink in document" — the note's linked mentions rendered at
 *  the bottom of the reading view. Read-only: `getBacklinks` (already-indexed data) + click
 *  → `openFile`. EditorPane renders this AFTER `.preview-content`, so it never touches the
 *  markdown render pipeline (§C byte invariant untouched). Gated by `showBacklinksInDocument`
 *  + reading mode upstream. Empty → renders nothing (v1: no empty section, see ARCHITECTURE
 *  "Round 154 additions"). Uses only @core/@app — no cross-feature import of features/backlinks. */
export function BacklinksInDocument({ path }: { path: string }) {
  const app = useApp();
  const t = useI18n();
  // re-render + recompute when the metadata index changes (a backlink added/removed elsewhere)
  const rev = useStore(app.metadata.revision);
  const groups = useMemo(
    () => app.metadata.getBacklinks(path),
    [app.metadata, path, rev],
  );
  if (groups.length === 0) return null;

  const total = groups.reduce((n, g) => n + g.contexts.length, 0);
  const navProps = (target: string) => ({
    role: "button" as const,
    tabIndex: 0,
    onClick: () => app.workspace.openFile(target),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        app.workspace.openFile(target);
      }
    },
  });

  return (
    <div className="embedded-backlinks" data-testid="embedded-backlinks">
      <div className="embedded-backlinks-title">
        {t("backlinks.linkedMentions")}
        <span className="embedded-backlinks-count">{total}</span>
      </div>
      <div className="embedded-backlinks-list">
        {groups.map((g) => (
          <div
            className="ebl-source"
            key={g.sourcePath}
            data-testid={"ebl-source-" + g.sourcePath}
          >
            <div className="ebl-source-title" {...navProps(g.sourcePath)}>
              {stripExtension(basename(g.sourcePath))}
            </div>
            {g.contexts.map((c, i) =>
              c.snippet ? (
                <div className="ebl-snippet" key={i} {...navProps(g.sourcePath)}>
                  {c.snippet}
                </div>
              ) : null,
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
