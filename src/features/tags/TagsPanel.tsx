// Tags right-sidebar panel (R41): every vault tag + file count; click to search.
// R69: right-click a tag → vault-wide rename via @core/tagRewrite.
// Contract: docs/ARCHITECTURE.md "Round 41 additions" / "Round 69 additions".
// Layering: features/ may import only @core/*, @app/AppContext, @app/icons.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import { renameTagAcrossVault, isValidTagName } from "@core/tagRewrite";
import "./tags.css";

interface MenuState {
  x: number;
  y: number;
  tag: string;
}

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

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /* close context menu on click-elsewhere / Escape (mirrors AllProperties) */
  useEffect(() => {
    if (!menu) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenu(null);
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menu]);

  const doRename = (tag: string): void => {
    setResult(null);
    const input = window.prompt(t("tags.renamePrompt", { tag }), tag);
    if (input === null) return; // cancelled
    const newTag = input.replace(/^#+/, "").trim();
    if (newTag === "" || newTag === tag) return;
    // front-end guard: illegal chars / renaming into own subtree → show
    // renameInvalid, never call the engine.
    if (!isValidTagName(newTag) || newTag.startsWith(tag + "/")) {
      setResult(t("tags.renameInvalid"));
      return;
    }
    void renameTagAcrossVault(
      { vault: app.vault, metadata: app.metadata, documents: app.documents },
      tag,
      newTag,
    ).then((res) => {
      // always surface skips — even when nothing changed, the user must see
      // that N files were refused (R47 "consume the skipped report" lesson)
      const skipNote = res.skipped.length > 0 ? t("tags.renameSkipped", { skip: res.skipped.length }) : "";
      if (res.filesChanged === 0) {
        setResult(t("tags.renameNoop") + skipNote);
        return;
      }
      setResult(t("tags.renameDone", { old: tag, new: newTag, changed: res.filesChanged }) + skipNote);
    });
  };

  return (
    <div className="tags-panel" data-testid="tags-panel">
      <div className="tags-panel-header">{t("tags.title")}</div>
      {result !== null && (
        <div className="tags-result" data-testid="tags-result" role="status">
          {result}
        </div>
      )}
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
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, tag });
              }}
            >
              <span className="tag-row-icon"><Icon name="hash" size={13} /></span>
              <span className="tag-row-name">{tag}</span>
              <span className="tag-row-count">{count}</span>
            </button>
          ))}
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          className="tag-menu"
          data-testid="tag-menu"
          role="menu"
          aria-label={t("tags.menu")}
          style={{
            left: Math.min(menu.x, window.innerWidth - 200),
            top: Math.min(menu.y, window.innerHeight - 80),
          }}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="tag-rename"
            onClick={() => {
              const tag = menu.tag;
              setMenu(null);
              doRename(tag);
            }}
          >
            <Icon name="pencil" size={14} />
            {t("tags.rename")}
          </button>
        </div>
      )}
    </div>
  );
}
