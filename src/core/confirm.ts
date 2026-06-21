import { isTauri } from "@core/vault";

/**
 * R140: the delete-confirmation idiom (native dialog in Tauri — `window.confirm`
 * is unreliable in wry webviews — else the browser confirm). Shared by the
 * Explorer delete actions and the `app:delete-file` command (R161).
 */
export async function confirmDelete(message: string, title: string): Promise<boolean> {
  if (isTauri()) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(message, { title, kind: "warning" });
  }
  return window.confirm(message);
}
