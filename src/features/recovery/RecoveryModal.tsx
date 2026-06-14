import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import { useStore } from "@core/store";
import {
  snapshotsRevision,
  listSnapshots,
  restoreSnapshot,
  type Snapshot,
} from "@core/snapshots";
import "./recovery.css";

/**
 * File recovery modal (R49) — browse and restore version snapshots taken of the
 * active note. Snapshots are periodic captures kept by @core/snapshots; this
 * modal lists them newest-first and previews / restores a picked version.
 *
 * Reactive on snapshotsRevision so the list refreshes if a new snapshot lands
 * while the modal is open. Mirrors the shared modal shell (overlay + overlay-
 * click close); Escape→closeModal is handled globally in App.tsx.
 */
export function RecoveryModal() {
  const app = useApp();
  const t = useI18n();
  const rev = useStore(snapshotsRevision); // re-render when a snapshot is recorded
  const activePath = app.workspace.getActiveFile();
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [sel, setSel] = useState<number | null>(null);

  const close = () => app.workspace.closeModal();

  const onOverlayMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) close();
  };

  useEffect(() => {
    if (!activePath) {
      setSnaps([]);
      setSel(null);
      return;
    }
    let alive = true;
    void listSnapshots(app.vault, activePath).then((list) => {
      if (!alive) return;
      // listSnapshots returns old→new; show newest at the top
      const ordered = [...list].reverse();
      setSnaps(ordered);
      // keep the user's current selection if it still exists (a background save
      // must not silently steal it); else default to the newest (R49 review).
      setSel((prev) =>
        prev !== null && ordered.some((s) => s.ts === prev) ? prev : ordered.length ? ordered[0]!.ts : null,
      );
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, rev]);

  const selected = useMemo(() => snaps.find((s) => s.ts === sel) ?? null, [snaps, sel]);

  const restore = () => {
    if (!activePath || sel === null) return;
    void restoreSnapshot(app.vault, app.documents, activePath, sel, Date.now())
      .then(() => {
        app.workspace.closeModal();
      })
      .catch((err) => {
        // never swallow a restore failure silently (R49 review) — keep the modal open
        console.error("[recovery] restore failed", err);
      });
  };

  if (!activePath) {
    return (
      <div className="modal-overlay" onMouseDown={onOverlayMouseDown} data-testid="recovery-modal-overlay">
        <div
          className="modal-panel recovery-panel"
          role="dialog"
          aria-label={t("recovery.title")}
          data-testid="recovery-modal"
        >
          <div className="recovery-header">{t("recovery.title")}</div>
          <div className="recovery-empty" data-testid="recovery-no-file">
            {t("recovery.noFile")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onMouseDown={onOverlayMouseDown} data-testid="recovery-modal-overlay">
      <div
        className="modal-panel recovery-panel"
        role="dialog"
        aria-label={t("recovery.title")}
        data-testid="recovery-modal"
      >
        <div className="recovery-header">{t("recovery.title")}</div>

        <div className="recovery-body">
          <div className="recovery-list">
            {snaps.length === 0 ? (
              <div className="recovery-empty" data-testid="recovery-empty">
                {t("recovery.empty")}
              </div>
            ) : (
              snaps.map((s) => (
                <button
                  key={s.ts}
                  className={`recovery-item${s.ts === sel ? " is-selected" : ""}`}
                  data-testid="recovery-item"
                  data-ts={s.ts}
                  onClick={() => setSel(s.ts)}
                >
                  {new Date(s.ts).toLocaleString()}
                </button>
              ))
            )}
          </div>

          <div className="recovery-preview-pane">
            <div className="recovery-preview-header">
              <span className="recovery-preview-label">{t("recovery.preview")}</span>
              <button
                className="recovery-btn recovery-btn-primary"
                disabled={sel === null}
                onClick={restore}
                data-testid="recovery-restore"
              >
                {t("recovery.restore")}
              </button>
            </div>
            <pre className="recovery-preview" data-testid="recovery-preview">
              {selected?.content ?? ""}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
