// All Properties right-sidebar panel (R30).
// Contract: docs/ARCHITECTURE.md "Round 30 additions".
// Layering: features/ may import only @core/*, @app/AppContext, @app/icons.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import { basename, stripExtension } from "@core/vault";
import {
  effectivePropertyType,
  propertyTypes,
  type PropertyType,
  type PropertyValue,
} from "@core/properties";
import { renamePropertyAcrossVault } from "@core/propertyRewrite";
import "./allproperties.css";

/** Type-icon SVG paths — kept in sync with PropertiesPanel's TypeIcon (a
 *  feature must not import another feature, so the small map is duplicated). */
const TYPE_ICON_PATHS: Record<PropertyType, string[]> = {
  text: ["M17 6.1H3", "M21 12.1H3", "M15.1 18H3"],
  multitext: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  number: ["M4 9h16", "M4 15h16", "M10 3L8 21", "M16 3l-2 18"],
  checkbox: ["M9 11l3 3L22 4", "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"],
  date: [
    "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    "M16 2v4",
    "M8 2v4",
    "M3 10h18",
  ],
  datetime: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  tags: [
    "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z",
    "M7 7h.01",
  ],
  aliases: ["M9 14L4 9l5-5", "M20 20v-7a4 4 0 0 0-4-4H4"],
};

function TypeIcon({ type }: { type: PropertyType }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TYPE_ICON_PATHS[type].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

interface KeyInfo {
  /** authored casing (first occurrence wins) */
  key: string;
  /** number of files using this key */
  count: number;
  /** a sample value for type inference (first non-empty seen, else null) */
  sample: PropertyValue;
  /** paths using this key, basename-sorted */
  files: string[];
}

interface MenuState {
  x: number;
  y: number;
  key: string;
}

function fileLabel(path: string): string {
  return stripExtension(basename(path));
}

export function AllPropertiesPanel() {
  const app = useApp();
  const t = useI18n();
  // re-aggregate on any metadata-index change and on vault-wide type assignments
  const metaRev = useStore(app.metadata.revision);
  useStore(propertyTypes.revision);

  const [filter, setFilter] = useState("");
  // expanded key set — default collapsed (absence = collapsed; R24 lesson:
  // explicit Set.has, never `?? true`)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /* close context menu on click-elsewhere / Escape (mirrors Bookmarks) */
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

  /* single-pass vault-wide aggregation: authored casing + count + sample value
     + file list per key, all keyed on the metadata revision (superset of
     metadata.getPropertyKeyCounts(), which stays the cached probe-facing API) */
  const keys = useMemo<KeyInfo[]>(() => {
    void metaRev; // dependency marker — re-runs when the index bumps
    const byLower = new Map<string, KeyInfo>();
    for (const meta of app.metadata.getAll()) {
      const fields = meta.frontmatter?.fields;
      if (!fields) continue;
      const seenInFile = new Set<string>();
      for (const k of Object.keys(fields)) {
        const lower = k.toLowerCase();
        if (seenInFile.has(lower)) continue;
        seenInFile.add(lower);
        let info = byLower.get(lower);
        if (!info) {
          info = { key: k, count: 0, sample: null, files: [] };
          byLower.set(lower, info);
        }
        info.count++;
        info.files.push(meta.path);
        if (info.sample === null) {
          const v = fields[k];
          if (Array.isArray(v)) {
            if (v.length > 0 && v[0] !== "") info.sample = v;
          } else if (v !== "") {
            info.sample = v;
          }
        }
      }
    }
    const all = [...byLower.values()];
    for (const info of all) info.files.sort((a, b) => fileLabel(a).localeCompare(fileLabel(b)));
    return all.sort((a, b) => a.key.localeCompare(b.key));
  }, [app, metaRev]);

  const needle = filter.trim().toLowerCase();
  const visible = needle ? keys.filter((k) => k.key.toLowerCase().includes(needle)) : keys;

  const toggle = (lower: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(lower)) next.delete(lower);
      else next.add(lower);
      return next;
    });

  const doRename = (key: string): void => {
    setResult(null);
    const input = window.prompt(t("allproperties.renamePrompt", { key }), key);
    if (input === null) return; // cancelled
    const newKey = input.trim();
    if (newKey === "" || newKey === key) return;
    void renamePropertyAcrossVault(
      { vault: app.vault, metadata: app.metadata, documents: app.documents },
      key,
      newKey,
    ).then((res) => {
      if (res.filesChanged === 0) {
        setResult(t("allproperties.renameNoop"));
        return;
      }
      let msg = t("allproperties.renameDone", {
        old: key,
        new: newKey,
        changed: res.filesChanged,
      });
      if (res.skipped.length > 0) {
        msg += t("allproperties.renameSkipped", { skip: res.skipped.length });
      }
      setResult(msg);
    });
  };

  const menuKey = menu?.key ?? null;

  return (
    <div className="allproperties-panel" data-testid="allproperties-panel">
      <div className="ap-toolbar">
        <input
          className="ap-filter"
          type="text"
          value={filter}
          placeholder={t("allproperties.filterPlaceholder")}
          aria-label={t("allproperties.filterPlaceholder")}
          spellCheck={false}
          data-testid="ap-filter"
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {result !== null && (
        <div className="ap-result" data-testid="ap-result" role="status">
          {result}
        </div>
      )}

      {keys.length === 0 ? (
        <div className="ap-empty" data-testid="ap-empty">
          {t("allproperties.empty")}
        </div>
      ) : (
        <div className="ap-list">
          {visible.map((info) => {
            const lower = info.key.toLowerCase();
            const isOpen = expanded.has(lower);
            const type = effectivePropertyType(info.key, info.sample, propertyTypes.get(info.key));
            return (
              <div className="ap-entry" key={lower}>
                <button
                  className={`ap-row${isOpen ? " is-open" : ""}`}
                  type="button"
                  data-testid={`ap-row-${info.key}`}
                  aria-expanded={isOpen}
                  onClick={() => toggle(lower)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, key: info.key });
                  }}
                >
                  <Icon name={isOpen ? "chevron-down" : "chevron-right"} size={13} />
                  <span className="ap-type" title={type}>
                    <TypeIcon type={type} />
                  </span>
                  <span className="ap-key">{info.key}</span>
                  <span
                    className="ap-count"
                    data-testid={`ap-count-${info.key}`}
                    aria-label={t("allproperties.usageCountAria", { count: info.count })}
                  >
                    {info.count}
                  </span>
                </button>
                {isOpen && (
                  <div className="ap-files">
                    {info.files.map((path) => (
                      <button
                        key={path}
                        className="ap-file"
                        type="button"
                        data-testid={`ap-file-${fileLabel(path)}`}
                        title={path}
                        onClick={() => app.workspace.openFile(path)}
                      >
                        <Icon name="file-text" size={13} />
                        <span className="ap-file-name">{fileLabel(path)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {menu && menuKey !== null && (
        <div
          ref={menuRef}
          className="ap-menu"
          data-testid="ap-menu"
          role="menu"
          aria-label={t("allproperties.menu")}
          style={{
            left: Math.min(menu.x, window.innerWidth - 200),
            top: Math.min(menu.y, window.innerHeight - 80),
          }}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="ap-rename"
            onClick={() => {
              const key = menu.key;
              setMenu(null);
              doRename(key);
            }}
          >
            <Icon name="pencil" size={14} />
            {t("allproperties.rename")}
          </button>
        </div>
      )}
    </div>
  );
}
