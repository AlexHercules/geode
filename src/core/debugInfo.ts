/**
 * R217 (G3 §0): the text block for "Show debug info" (Obsidian app:show-debug-info) —
 * copied to the clipboard for bug reports. PURE: the command (App.tsx) gathers the live
 * values (APP_VERSION / navigator.platform / locale / plugins.list) and passes them in, so
 * this stays deterministically testable via the __geodeDebugInfo probe.
 */

export interface DebugPlugin {
  name: string;
  id: string;
  enabled: boolean;
}

export interface DebugInfoInput {
  version: string;
  platform: string;
  locale: string;
  plugins: DebugPlugin[];
}

/** Format the debug info as a plain-text block (Obsidian-style: a header, system lines, then
 *  a numbered list of the ENABLED plugins). */
export function buildDebugInfo(info: DebugInfoInput): string {
  const enabled = info.plugins.filter((p) => p.enabled);
  return [
    "Geode debug info:",
    `Version: ${info.version}`,
    `Platform: ${info.platform}`,
    `Locale: ${info.locale}`,
    `Plugins installed: ${info.plugins.length}`,
    `Plugins enabled: ${enabled.length}`,
    ...enabled.map((p, i) => `${i + 1}. ${p.name} (${p.id})`),
  ].join("\n");
}
