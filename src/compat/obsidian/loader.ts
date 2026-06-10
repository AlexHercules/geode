import type { AppHandle } from "@core/plugins";
import type { Vault } from "@core/vault";

/**
 * Obsidian plugin compatibility loader (T0) — discovers and runs plugins from
 * `<vault>/.obsidian/plugins/`. Idempotent like PluginManager.loadExternal:
 * previously loaded obsidian records are unloaded first.
 *
 * Contract: docs/ARCHITECTURE.md "Round 4 additions"; calibrated signatures:
 * .calibration/API-REFERENCE.md. (Stub — implemented by the R4 compat agent.)
 */
export async function loadObsidianPlugins(
  _app: Omit<AppHandle, "ui">,
  _vault: Vault,
): Promise<void> {
  // not yet implemented — wired into bootstrap so the call site is frozen
}
