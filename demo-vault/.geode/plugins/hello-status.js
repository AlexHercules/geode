/**
 * Sample Geode external plugin (module.exports convention).
 * Lives at <vault>/.geode/plugins/hello-status.js — reload via the
 * "Reload external plugins" command (palette) or Settings → Plugins.
 */
module.exports = {
  id: "hello-status",
  name: "Hello Status",
  description: "Sample external plugin: status bar item + a greet command.",
  version: "1.0.0",
  onload(app) {
    app.ui.setStatusBarItem("hello", "🔌 hello from external plugin");

    app.commands.register({
      id: "hello-status:greet",
      name: "Hello plugin: greet",
      callback: () => {
        const path = app.workspace.getActiveFile();
        const note = path ? path.split("/").pop().replace(/\.md$/, "") : "no note open";
        app.ui.setStatusBarItem("hello", "🔌 hello, " + note + "!");
      },
    });
  },
  onunload() {
    // commands / status bar items registered through `app` are disposed automatically
  },
};
