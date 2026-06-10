# Geode Plugin API

Geode is extensible through the same API its built-in features use.

## Quick start (runtime registration)

Open the devtools console (or load a script) and run:

```js
window.geode.registerPlugin({
  id: "my-plugin",
  name: "My Plugin",
  description: "Says hi in the status bar and adds a command",
  version: "1.0.0",
  onload(app) {
    app.ui.setStatusBarItem("hello", "👋 hi");
    app.commands.register({
      id: "my-plugin:shout",
      name: "My Plugin: shout active note",
      callback: async () => {
        const path = app.workspace.getActiveFile();
        if (path) console.log(await app.vault.read(path));
      },
    });
  },
  onunload() {
    // command/event/status-bar registrations made through `app` are
    // automatically disposed when the plugin is disabled.
  },
});
```

The plugin immediately appears under **Settings → Plugins** with an enable/disable toggle
(state persists across restarts).

## The `AppHandle` surface

| Member | What you get |
|---|---|
| `app.vault` | `read/modify/create/createFolder/rename/remove`, `getMarkdownFiles()`, `uniquePath()` |
| `app.metadata` | `resolveLink`, `getBacklinks`, `getOutgoingLinks`, `getTagMap`, `getGraph` |
| `app.workspace` | `openFile`, `openGraph`, `getActiveFile`, theme & layout controls |
| `app.commands` | `register({ id, name, hotkey?, callback })` → shows up in the palette |
| `app.events` | `on("file:modified" \| "active-file:changed" \| ...)` typed event bus |
| `app.ui` | `setStatusBarItem(id, text)` / `removeStatusBarItem(id)` |

Everything registered through the handle is tracked and torn down on disable —
plugins cannot leak handlers.

## Built-in plugins (source = examples)

- `src/plugins/word-count.ts` — events + status bar
- `src/plugins/daily-note.ts` — commands + vault writes
- `src/plugins/random-note.ts` — navigation

Built-ins are regular `GeodePlugin` objects compiled in; they have no special powers.
