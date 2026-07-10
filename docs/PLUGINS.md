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
| `app.ui` | Status-bar items plus `addViewHeaderAction(id, action)` for editor-header icons |

Everything registered through the handle is tracked and torn down on disable —
plugins cannot leak handlers.

### Editor view-header actions

Plugins can add an Obsidian-style icon beside the reading-view and more-actions
buttons. Contributions are data-based and rendered once per Markdown pane, so
the same action remains visible in every split without moving a shared DOM node.

```js
onload(app) {
  app.ui.addViewHeaderAction("spark", {
    title: "Run my note action",
    // Use a Geode icon id...
    icon: "star",
    // ...or one trusted standalone SVG root for a custom registered icon:
    // iconSvg: '<svg viewBox="0 0 24 24">...</svg>',
    onClick: () => console.log(app.workspace.getActiveFile()),
  });
}
```

The action is automatically removed when the plugin is disabled or reloaded.

## Built-in plugins (source = examples)

- `src/plugins/word-count.ts` — events + status bar
- `src/plugins/daily-note.ts` — commands + vault writes
- `src/plugins/random-note.ts` — navigation

Built-ins are regular `GeodePlugin` objects compiled in; they have no special powers.

## External plugins

### File location

Drop plain `.js` files into your vault at:

```
<vault>/.geode/plugins/*.js
```

Each file is loaded at startup (and on every reload, see below). One file may register
one or more plugins. External plugins show up under **Settings → Plugins → External**
with the same enable/disable toggles as built-ins; toggle state persists across
restarts and reloads.

### Authoring — two conventions

A plugin script runs with three injected values: `geode`, `module`, `exports`.
Use **either** convention:

**1. `module.exports` (CommonJS-style, recommended)**

```js
// <vault>/.geode/plugins/hello-status.js
module.exports = {
  id: "hello-status",
  name: "Hello Status",
  description: "Status bar item + a greet command.",
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
    // registrations made through `app` are disposed automatically
  },
};
```

`exports.default = { ... }` also works.

**2. `geode.registerPlugin(...)`**

```js
geode.registerPlugin({
  id: "my-plugin",
  name: "My Plugin",
  onload(app) {
    /* same AppHandle as above */
  },
});
```

A valid plugin object needs a non-empty string `id`, a non-empty string `name` and an
`onload` function (`description`/`version`/`onunload` optional). Invalid shapes are
skipped with a `console.error`; an `id` that collides with an existing plugin
(built-in or external) is rejected. A script that throws never affects other
plugins — each file is evaluated in its own try/catch.

A working sample ships in the demo vault: `demo-vault/.geode/plugins/hello-status.js`.

### Reloading

After adding or editing a plugin file, reload without restarting the app:

- Command palette → **Reload external plugins** (`app:reload-plugins`), or
- **Settings → Plugins → Reload external plugins** button.

Reloading is idempotent: all previously loaded external plugins are unloaded
(their commands, event handlers and status bar items torn down) and the
`.geode/plugins` folder is re-scanned from scratch.

### Trust model

External plugins are **not sandboxed**. They are evaluated as ordinary JavaScript in
the app and get the full `AppHandle` — the same trust model as Obsidian community
plugins. These are local files inside your own vault: you own them, you put them
there. Only add plugin files you have read or whose author you trust.
