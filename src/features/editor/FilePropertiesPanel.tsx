import { useEffect, useState } from "react";
import { useApp } from "@app/AppContext";
import { useStore } from "@core/store";
import { useI18n } from "@core/i18n";
import { findActiveTab } from "@core/workspace";
import type { DocumentHandle } from "@core/documents";
import { PropertiesPanel } from "./PropertiesPanel";
import "./fileproperties.css";

/**
 * R86 (㊼): the active note's properties as a right-sidebar pane (Obsidian's
 * "Properties view" core plugin). Reuses the R22 `PropertiesPanel` editor —
 * but as an INDEPENDENT second writer of the active document, so it must go
 * through the shared `DocumentHandle` (acquire/release + `applyExternalEdits`),
 * NOT a bare setText+modify: the handle keeps a live CM view (if the note is
 * also open in the editor) in sync and routes undo/dirty/save correctly (DS).
 */
export function FilePropertiesPanel() {
  const app = useApp();
  const t = useI18n();
  const ws = useStore(app.workspace.state);
  // R213: non-markdown active tab → follow the last active markdown file (Obsidian's
  // Properties view follows the active file), aligned with the sibling aux panels. This is
  // an editable writer, but the shared DocumentHandle (path-keyed) makes editing lastActive
  // safe regardless of whether it is the active tab; acquire-fail (file deleted) → fp-empty.
  const lastActive = useStore(app.workspace.lastActiveFile);

  const activeTab = findActiveTab(ws);
  const activePath = activeTab?.viewType === "markdown" ? activeTab.filePath : lastActive;

  // acquire the shared handle for the active file (refcounted; release on change)
  const [handle, setHandle] = useState<DocumentHandle | null>(null);
  // mirror handle.revision → re-render on every edit (live CM dispatch or our own
  // applyExternalEdits both bump it), so PropertiesPanel re-reads getDoc()
  const [docRevision, setDocRevision] = useState(0);
  useEffect(() => {
    if (!handle) return;
    setDocRevision(handle.revision.get());
    return handle.revision.subscribe(() => setDocRevision(handle.revision.get()));
  }, [handle]);
  useEffect(() => {
    if (!activePath) {
      setHandle(null);
      return;
    }
    let cancelled = false;
    let acquired: DocumentHandle | null = null;
    void app.documents.acquire(activePath).then(
      (h) => {
        if (cancelled) { h.release(); return; }
        acquired = h;
        setHandle(h);
      },
      () => { if (!cancelled) setHandle(null); },
    );
    return () => {
      cancelled = true;
      acquired?.release();
    };
  }, [app, activePath]);

  return (
    <div className="fileproperties-panel" data-testid="fileproperties-panel">
      <div className="panel-header">{t("fileproperties.title")}</div>
      {!activePath ? (
        <div className="fp-empty" data-testid="fp-empty">{t("fileproperties.empty")}</div>
      ) : !handle || handle.path !== activePath ? (
        <div className="fp-empty" data-testid="fp-loading">{t("fileproperties.loading")}</div>
      ) : (
        <PropertiesPanel
          getDoc={() => handle.getText()}
          applyEdit={(edit) => handle.applyExternalEdits([edit])}
          path={activePath}
          revision={docRevision}
        />
      )}
    </div>
  );
}
