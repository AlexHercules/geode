import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useApp } from "@app/AppContext";
import { useStore } from "@core/store";
import { locale, useI18n } from "@core/i18n";
import { getCommandName, formatHotkey } from "@core/commands";
import type { Command } from "@core/types";
import { fuzzyMatch, toSegments, type FuzzyMatch } from "@core/fuzzy";
import { loadRecentCommands, recordRecentCommand } from "./commandMru";
import "./palette.css";

interface Row {
  cmd: Command;
  match: FuzzyMatch;
  /** effective hotkey (user override wins over the command default) */
  hotkey: string | null;
}

export function CommandPalette() {
  const app = useApp();
  const t = useI18n();
  // command names resolve per-locale — the rows memo must recompute on switch
  const loc = useStore(locale);
  const rev = useStore(app.commands.revision);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo<Row[]>(() => {
    // context-gated commands (available() === false) are hidden, like Obsidian
    const all = app.commands.list().filter((cmd) => cmd.available?.() !== false);
    const hotkey = (cmd: Command) => app.commands.getEffectiveHotkey(cmd.id);
    const q = query.trim();
    if (!q) {
      // R141: empty query → recently-used commands first (MRU order), then the rest (alpha). Recent
      // ids are filtered against `all`, so unregistered/unavailable recents are skipped. Once the user
      // types, fuzzy score takes over (Obsidian: recents are subject to fuzzy matching when filtering).
      const byId = new Map(all.map((cmd) => [cmd.id, cmd]));
      const recent = loadRecentCommands(app.vault.vaultName)
        .map((id) => byId.get(id))
        .filter((cmd): cmd is Command => cmd !== undefined);
      const recentIds = new Set(recent.map((cmd) => cmd.id));
      const rest = all.filter((cmd) => !recentIds.has(cmd.id));
      return [...recent, ...rest].map((cmd) => ({ cmd, match: { score: 0, indices: [] }, hotkey: hotkey(cmd) }));
    }
    return all
      .map((cmd) => ({ cmd, match: fuzzyMatch(q, getCommandName(cmd)), hotkey: hotkey(cmd) }))
      .filter((r): r is Row => r.match !== null)
      .sort((a, b) => b.match.score - a.match.score);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.commands, query, rev, loc]);

  const sel = rows.length === 0 ? -1 : Math.min(selected, rows.length - 1);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(".is-selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [sel, rows]);

  const run = (cmd: Command) => {
    recordRecentCommand(app.vault.vaultName, cmd.id); // R141: bump to the top of the MRU
    app.workspace.closeModal();
    app.commands.execute(cmd.id);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (rows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (Math.min(s, rows.length - 1) + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (Math.min(s, rows.length - 1) - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (sel >= 0) run(rows[sel].cmd);
    }
  };

  const onOverlayMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) app.workspace.closeModal();
  };

  return (
    <div className="modal-overlay" onMouseDown={onOverlayMouseDown} data-testid="command-palette">
      <div className="modal-panel" role="dialog" aria-label={t("palette.aria")}>
        <div className="palette-input-wrap">
          <input
            className="palette-input"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            spellCheck={false}
            data-testid="palette-input"
          />
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {rows.length === 0 ? (
            <div className="palette-empty">{t("palette.empty")}</div>
          ) : (
            rows.map((row, i) => (
              <div
                key={row.cmd.id}
                className={`palette-item${i === sel ? " is-selected" : ""}`}
                role="option"
                aria-selected={i === sel}
                onMouseMove={() => setSelected(i)}
                onClick={() => run(row.cmd)}
                data-testid="palette-item"
              >
                <span className="palette-item-name">
                  {toSegments(getCommandName(row.cmd), row.match.indices).map((seg, j) =>
                    seg.hit ? (
                      <span key={j} className="fz-hit">
                        {seg.text}
                      </span>
                    ) : (
                      <span key={j}>{seg.text}</span>
                    ),
                  )}
                </span>
                {row.hotkey && <span className="palette-hotkey">{formatHotkey(row.hotkey)}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
