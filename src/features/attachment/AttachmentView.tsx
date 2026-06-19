/**
 * R102 (㊽ 续续续续续): read-only viewer for non-md attachment tabs (`viewType:
 * "attachment"`). Images render via an object-URL blob (vault.readBinary); other
 * binaries show a read-only placeholder. The whole POINT is data safety: this view
 * NEVER calls documents.acquire — so a binary never enters the editable CM buffer /
 * autosave path (which is how clicking a .png used to corrupt it on edit). Pure read.
 */
import { useEffect, useState } from "react";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import { isImagePath, fileExtension, imageMime } from "@core/attachments";
import type { TabState } from "@core/types";

export function AttachmentView({ tab }: { tab: TabState }) {
  const app = useApp();
  const t = useI18n();
  const path = tab.filePath;
  const isImage = path !== null && isImagePath(path);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (path === null || !isImage) return;
    let cancelled = false;
    let objUrl: string | null = null;
    // read-only raw bytes — NOT documents.acquire (no handle, no autosave, no dirty buffer)
    app.vault.readBinary(path).then(
      (bytes) => {
        if (cancelled) return;
        // copy into a fresh ArrayBuffer-backed view: adapter bytes are typed over
        // ArrayBufferLike, which BlobPart rejects (mirrors compat/util embed src).
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        objUrl = URL.createObjectURL(new Blob([copy], { type: imageMime(path) }));
        setUrl(objUrl);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [app, path, isImage]);

  if (path === null) return null;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const ext = fileExtension(path);

  return (
    <div className="attachment-view" data-testid="attachment-view" data-attachment-path={path}>
      {isImage ? (
        failed ? (
          <div className="attachment-placeholder" data-testid="attachment-failed">
            <span>{t("attachment.loadFailed")}</span>
          </div>
        ) : (
          url && (
            <img
              className="attachment-image"
              data-testid="attachment-image"
              src={url}
              alt={name}
              onError={() => setFailed(true)}
            />
          )
        )
      ) : (
        <div className="attachment-placeholder" data-testid="attachment-placeholder">
          <span className="attachment-name">{name}</span>
          <span className="attachment-meta">{t("attachment.noPreview", { ext: ext || "?" })}</span>
        </div>
      )}
    </div>
  );
}
