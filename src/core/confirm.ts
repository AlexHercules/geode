import { isTauri } from "@core/vault";

/**
 * R140: the confirmation-dialog idiom (native dialog in Tauri — `window.confirm`
 * is unreliable in wry webviews — else the browser confirm). Shared by the
 * Explorer delete actions, the `app:delete-file` command (R161) and the
 * Note composer merge confirmation (R235).
 */
export async function confirmAction(message: string, title: string): Promise<boolean> {
  if (isTauri()) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(message, { title, kind: "warning" });
  }
  return window.confirm(message);
}
