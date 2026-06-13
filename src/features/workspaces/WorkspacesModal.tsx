import { useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import {
  workspacesStore,
  listWorkspaceNames,
  getWorkspaceLayout,
  saveWorkspaceLayout,
  deleteWorkspaceLayout,
} from "@core/workspaces";
import "./workspaces.css";

/**
 * Workspaces manager modal (R45) — save / load / delete named layout snapshots.
 * A "workspace" is a captured pane+tab layout (app.workspace.captureLayout())
 * persisted in the vault. Loading one applies it via app.workspace.applyLayout,
 * which is given an `exists` predicate so it can drop tabs whose files are gone.
 *
 * Reactive on workspacesStore so the list refreshes after save/delete without
 * a manual re-render. Mirrors the shared modal shell (overlay + overlay-click
 * close); Escape→closeModal is handled globally in App.tsx.
 */
export function WorkspacesModal() {
  const app = useApp();
  const t = useI18n();
  useStore(workspacesStore); // re-render on save/delete
  const [name, setName] = useState("");
  const names = listWorkspaceNames();

  const close = () => app.workspace.closeModal();

  const onOverlayMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) close();
  };

  const saveCurrent = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    void saveWorkspaceLayout(app.vault, trimmed, app.workspace.captureLayout());
    setName("");
  };

  const load = (n: string) => {
    app.workspace.applyLayout(getWorkspaceLayout(n), (p) => app.vault.fileExists(p));
    close();
  };

  return (
    <div className="modal-overlay" onMouseDown={onOverlayMouseDown} data-testid="workspaces-modal-overlay">
      <div
        className="modal-panel workspaces-panel"
        role="dialog"
        aria-label={t("workspaces.title")}
        data-testid="workspaces-modal"
      >
        <div className="workspaces-header">{t("workspaces.title")}</div>

        <div className="workspaces-save-row">
          <label className="workspaces-save-label">{t("workspaces.saveAs")}</label>
          <div className="workspaces-save-controls">
            <input
              className="workspaces-input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveCurrent();
                }
              }}
              placeholder={t("workspaces.placeholder")}
              spellCheck={false}
              data-testid="workspaces-name-input"
            />
            <button
              className="workspaces-btn workspaces-btn-primary"
              disabled={name.trim() === ""}
              onClick={saveCurrent}
              data-testid="workspaces-save"
            >
              {t("workspaces.save")}
            </button>
          </div>
        </div>

        <div className="workspaces-list">
          {names.length === 0 ? (
            <div className="workspaces-empty" data-testid="workspaces-empty">
              {t("workspaces.empty")}
            </div>
          ) : (
            names.map((n) => (
              <div className="workspaces-item" key={n} data-testid="workspaces-item" data-name={n}>
                <span className="workspaces-item-name" title={n}>
                  {n}
                </span>
                <div className="workspaces-item-actions">
                  <button
                    className="workspaces-btn"
                    onClick={() => load(n)}
                    data-testid="workspaces-load"
                  >
                    {t("workspaces.load")}
                  </button>
                  <button
                    className="workspaces-btn workspaces-btn-danger"
                    onClick={() => void deleteWorkspaceLayout(app.vault, n)}
                    data-testid="workspaces-delete"
                  >
                    {t("workspaces.delete")}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
