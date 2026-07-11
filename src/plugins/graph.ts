import type { AppHandle, GeodePlugin } from "@core/plugins";
import { t } from "@core/i18n";

/**
 * Graph view - visualize relationships between notes as a force-directed graph
 * (Obsidian's "Graph view" core plugin). R295: wired as a real builtin plugin
 * per the R294 toggle contract. Graph is a main-area singleton view only (no
 * sidebar tab); this plugin owns the "Open graph view" / "Open local graph"
 * commands (the latter reuses the R240 one-shot `openLocalGraphRequest` to flip
 * the graph into local mode after opening) and the lifecycle that gates the
 * ribbon entry + empty-state button + main-area singleton render.
 */
export const graphPlugin: GeodePlugin = {
  id: "graph",
  name: () => t("cmdSource.graph"),
  description: () => t("settings.corePlugin.graphDesc"),
  version: "1.0.0",

  onload(app: AppHandle) {
    app.commands.register({
      id: "app:open-graph",
      name: () => t("cmd.openGraph"),
      hotkey: "Mod+G",
      callback: () => app.workspace.openGraph(),
    });
    app.commands.register({
      // R240: open the graph anchored to the active note. GraphView already
      // supports local mode (R103/R110); set the one-shot then open.
      id: "graph:open-local",
      name: () => t("cmd.openLocalGraph"),
      callback: () => {
        app.workspace.openLocalGraphRequest.set(true);
        app.workspace.openGraph();
      },
    });
  },
};
