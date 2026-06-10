# 💎 Geode

A local-first markdown knowledge base in the spirit of Obsidian — built with
**Tauri 2 + React 18 + TypeScript + CodeMirror 6**, for Windows first.

> Your notes are plain `.md` files in a folder you own. No database, no lock-in.

## Features

- **Vault** — open any folder as a vault; all notes stay plain markdown on disk
- **Editor** — CodeMirror 6 with markdown syntax styling, `[[wikilink]]` autocomplete,
  Ctrl+Click navigation, tags, auto-save
- **Reading view** — rendered preview with clickable links and interactive task checkboxes (Ctrl+E to toggle)
- **Backlinks** — linked mentions, outgoing links and tags for the active note
- **Graph view** — force-directed graph of every note and link (Ctrl+G)
- **Full-text search** — instant search across the vault, `#tag` search mode
- **Command palette** (Ctrl+P) and **quick switcher** (Ctrl+O, create-on-miss)
- **File explorer** — tree view, create/rename/delete, context menus, inline rename
- **Tabs**, dark/light **themes**, settings, persistent workspace
- **Plugins** — a real plugin API (commands, events, vault access, status bar);
  ships with Word Count, Daily Notes and Random Note built-ins. See [docs/PLUGINS.md](docs/PLUGINS.md).

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+P` | Command palette |
| `Ctrl+O` | Quick switcher |
| `Ctrl+N` | New note |
| `Ctrl+E` | Toggle edit / reading view |
| `Ctrl+G` | Graph view |
| `Ctrl+D` | Open today's daily note |
| `Ctrl+W` | Close tab |
| `Ctrl+,` | Settings |

## Development

```sh
npm install
npm run dev            # browser mode with an in-memory demo vault (great for UI dev)
npm run tauri dev      # full desktop app against the real filesystem
npm run tauri build    # produce the Windows installer (NSIS)
npm run typecheck      # strict TS check
```

Browser mode uses `MemoryVaultAdapter` (a seeded demo vault) so the entire UI runs
and can be E2E-tested without the native shell. The desktop build swaps in
`TauriVaultAdapter`, which talks to the Rust backend over IPC.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short:

```
src/core/      framework-free TS: vault, metadata index, workspace, commands, events, plugin host
src/app/       shell: layout, context, icons
src/features/  editor / explorer / search / graph / backlinks / palette / settings
src/plugins/   built-in plugins (use the same public API as external ones)
src-tauri/     Rust: vault filesystem commands with path-traversal guards
```
