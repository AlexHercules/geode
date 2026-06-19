/**
 * R102/R104 (㊽ 续续续续续/续续续续续续): read-only viewer for non-md attachment tabs
 * (`viewType: "attachment"`). Renders an inline preview by media kind — image (<img>),
 * audio (<audio>), video (<video>), pdf (<embed>) — via an object-URL blob
 * (vault.readBinary); anything else shows a read-only placeholder. The whole POINT is
 * data safety: this view NEVER calls documents.acquire — so a binary never enters the
 * editable CM buffer / autosave path (which is how clicking a .png used to corrupt it on
 * edit). Pure read; the blob holds the whole file in memory (fine for typical attachments).
 */
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "@app/AppContext";
import { useI18n } from "@core/i18n";
import { mediaKind, mediaMime, fileExtension } from "@core/attachments";
import type { TabState } from "@core/types";

export function AttachmentView({ tab }: { tab: TabState }) {
  const app = useApp();
  const t = useI18n();
  const path = tab.filePath;
  const kind = path !== null ? mediaKind(path) : "other";
  const previewable = kind !== "other";
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (path === null || !previewable) return;
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
        objUrl = URL.createObjectURL(new Blob([copy], { type: mediaMime(path) }));
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
  }, [app, path, previewable]);

  if (path === null) return null;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const ext = fileExtension(path);

  let body: ReactNode = null;
  if (failed) {
    // only reached when readBinary itself rejects (file gone / unreadable). A media element
    // that merely can't DECODE keeps rendering — <audio>/<video> show a native error, and a
    // broken <img> (no native UI) falls back to the placeholder via its onError below.
    body = (
      <div className="attachment-placeholder" data-testid="attachment-failed">
        <span>{t("attachment.loadFailed")}</span>
      </div>
    );
  } else if (!previewable) {
    body = (
      <div className="attachment-placeholder" data-testid="attachment-placeholder">
        <span className="attachment-name">{name}</span>
        <span className="attachment-meta">{t("attachment.noPreview", { ext: ext || "?" })}</span>
      </div>
    );
  } else if (url !== null) {
    if (kind === "image") {
      // an <img> has no native error UI → fall back to the placeholder if it can't decode
      body = <img className="attachment-image" data-testid="attachment-image" src={url} alt={name} onError={() => setFailed(true)} />;
    } else if (kind === "audio") {
      body = <audio className="attachment-audio" data-testid="attachment-audio" src={url} controls />;
    } else if (kind === "video") {
      body = <video className="attachment-video" data-testid="attachment-video" src={url} controls />;
    } else {
      // pdf — <embed> renders natively in Chromium + macOS WKWebView (PDFKit)
      body = <embed className="attachment-pdf" data-testid="attachment-pdf" src={url} type="application/pdf" />;
    }
  }

  return (
    <div className="attachment-view" data-testid="attachment-view" data-attachment-path={path} data-media-kind={kind}>
      {body}
    </div>
  );
}
