/**
 * R97 (㊽ 续续续续): "Move to…" folder picker — a fuzzy folder suggester (Obsidian's
 * file-explorer "Move file to…"). Explorer-local modal (reuses the `.modal-overlay` /
 * `.palette-*` chrome + `core/fuzzy`); selecting a folder calls back into the Explorer's
 * vetted `moveNode` (R28/R16 renameWithLinkUpdate) — this component never writes itself.
 */
import { useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { fuzzyMatch, toSegments } from "@core/fuzzy";
import { useI18n } from "@core/i18n";
import { Icon } from "@app/icons";

interface Candidate {
  /** vault-relative folder path, or null for the vault root */
  value: string | null;
  label: string;
}

export function MoveToModal({
  fromPath,
  folders,
  allowRoot,
  onSelect,
  onClose,
}: {
  fromPath: string;
  folders: string[];
  allowRoot: boolean;
  onSelect: (target: string | null) => void;
  onClose: () => void;
}) {
  const t = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const rootLabel = t("explorer.moveToRoot");
  const candidates = useMemo<Candidate[]>(() => {
    const all: Candidate[] = allowRoot ? [{ value: null, label: rootLabel }] : [];
    for (const f of folders) all.push({ value: f, label: f });
    return all;
  }, [folders, allowRoot, rootLabel]);

  const rows = useMemo(() => {
    const q = query.trim();
    if (!q) return candidates.map((c) => ({ c, indices: [] as number[], score: 0 }));
    return candidates
      .map((c) => {
        const m = fuzzyMatch(q, c.label);
        return m ? { c, indices: m.indices, score: m.score } : null;
      })
      .filter((r): r is { c: Candidate; indices: number[]; score: number } => r !== null)
      .sort((a, b) => b.score - a.score);
  }, [candidates, query]);

  const sel = Math.min(selected, Math.max(0, rows.length - 1));

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (rows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (Math.min(s, rows.length - 1) + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (Math.min(s, rows.length - 1) - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (sel >= 0 && sel < rows.length) onSelect(rows[sel].c.value);
    }
  };

  const onOverlayMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onMouseDown={onOverlayMouseDown} data-testid="move-to-modal">
      <div className="modal-panel" role="dialog" aria-label={t("explorer.moveToAria", { name: fromPath })}>
        <div className="palette-input-wrap">
          <input
            className="palette-input"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("explorer.moveToPlaceholder")}
            spellCheck={false}
            data-testid="move-to-input"
          />
        </div>
        <div className="palette-list" role="listbox">
          {rows.length === 0 ? (
            <div className="palette-empty">{t("explorer.moveToEmpty")}</div>
          ) : (
            rows.map((row, i) => (
              <div
                // distinct prefixes so the root row's key can't collide with a folder
                // path (a folder named "root" → "f:root", never the root row's "root")
                key={row.c.value === null ? "root" : "f:" + row.c.value}
                className={`palette-item${i === sel ? " is-selected" : ""}`}
                role="option"
                aria-selected={i === sel}
                data-testid="move-to-item"
                data-target={row.c.value ?? ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(row.c.value);
                }}
              >
                <span className="palette-item-icon">
                  <Icon name="folder" size={14} />
                </span>
                <span className="palette-item-name">
                  {toSegments(row.c.label, row.indices).map((seg, j) =>
                    seg.hit ? (
                      <span key={j} className="fz-hit">
                        {seg.text}
                      </span>
                    ) : (
                      <span key={j}>{seg.text}</span>
                    ),
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
