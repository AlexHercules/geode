// R218 — host-shell file ops (G3 §6). Reveal a vault file in the OS file
// manager, or open it with the OS default app. Desktop-only: a no-op in browser
// mode (MemoryVaultAdapter has no real filesystem path). Mirrors the gated-IPC
// shape of core/net.ts and core/export.ts — core may import @tauri-apps/api
// (the TauriVaultAdapter already does).
//
// Security: the webview passes the vault-RELATIVE path only; the Rust command
// safe_join's it onto the vault root (rejecting `..` traversal), so absolute
// paths never leave the shell. Scope is vault files — never arbitrary URLs.
import { isTauri } from "@core/vault";

/** Reveal a vault file in the OS file manager (Finder/Explorer). No-op in browser. */
export async function revealInSystem(vaultRoot: string, relPath: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reveal_in_system", { vault: vaultRoot, path: relPath });
}

/** Open a vault file with the OS default application. No-op in browser. */
export async function openInDefaultApp(vaultRoot: string, relPath: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_in_default_app", { vault: vaultRoot, path: relPath });
}
