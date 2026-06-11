/**
 * Auto-update chain (R9) — wraps tauri-plugin-updater + tauri-plugin-process.
 * Dual-end like core/net.ts: desktop runs the real updater (minisign-verified
 * download + NSIS passive install + relaunch); the browser build is inert.
 *
 * Static imports of the plugin packages are allowed per the R9 contract —
 * their tree-shaken stubs are browser-safe — but every call is still guarded
 * by `updateSupported()`.
 */
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "./vault";

export interface UpdateInfo {
  version: string;
  body: string;
}

export type UpdateProgress =
  | { kind: "started"; contentLength: number | null }
  | { kind: "progress"; downloaded: number; contentLength: number | null }
  | { kind: "finished" };

/** The `Update` resource from the last successful check, held module-level
 *  between check and install. Cleared when a check reports "up to date". */
let pendingUpdate: Update | null = null;

/** Desktop only. Browser (`!isTauri()`): supported=false, check resolves null. */
export function updateSupported(): boolean {
  return isTauri();
}

/** null = up to date. Rejects on network/endpoint errors (caller shows the error). */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!updateSupported()) return null;
  const update = await check();
  pendingUpdate = update;
  if (update === null) return null;
  return { version: update.version, body: update.body ?? "" };
}

/** Download + verify minisign signature + run NSIS passive install, then relaunch.
 *  The returned promise only settles on failure paths (relaunch exits the app). */
export async function downloadAndInstallUpdate(
  onProgress: (p: UpdateProgress) => void,
): Promise<void> {
  if (!updateSupported()) {
    throw new Error("downloadAndInstallUpdate: updates are not supported in the browser");
  }
  const update = pendingUpdate;
  if (update === null) {
    throw new Error(
      "downloadAndInstallUpdate: no pending update — call checkForUpdate() first " +
        "and only install after it resolved with an update",
    );
  }
  // Progress events deliver incremental chunk sizes; accumulate them here so
  // the UI receives running totals per the UpdateProgress contract.
  let contentLength: number | null = null;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        contentLength = event.data.contentLength ?? null;
        onProgress({ kind: "started", contentLength });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress({ kind: "progress", downloaded, contentLength });
        break;
      case "Finished":
        onProgress({ kind: "finished" });
        break;
    }
  });
  await relaunch();
}
