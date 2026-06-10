# 💎 Geode

A local-first markdown knowledge base in the spirit of Obsidian — built with
**Tauri 2 + React 18 + TypeScript + CodeMirror 6**, for Windows first.

> Your notes are plain `.md` files in a folder you own. No database, no lock-in.

## Features

- **Vault** — open any folder as a vault; all notes stay plain markdown on disk
- **Live preview** — Obsidian-style WYSIWYG editing: markdown renders in place,
  syntax reveals itself only where your cursor is (Ctrl+Shift+E for raw source mode)
- **Editor** — CodeMirror 6 with `[[wikilink]]` autocomplete, click navigation,
  tags, interactive checkboxes, frontmatter properties, auto-save
- **Reading view** — rendered preview with clickable links and task checkboxes (Ctrl+E to toggle)
- **Split panes** — split right/down (Ctrl+\), drag tabs between panes or onto
  pane edges, drag the divider to resize; the same note stays in sync across panes
- **File watching** — edits made outside Geode (other editors, sync tools) appear live
- **Scales to 10k+ notes** — virtualized file tree, capped result rendering,
  ~110ms full metadata index (see [docs/PERFORMANCE.md](docs/PERFORMANCE.md))
- **Outline** — heading tree for the active note (right sidebar tab)
- **Backlinks** — linked mentions, outgoing links and tags for the active note
- **Graph view** — force-directed graph of every note and link (Ctrl+G)
- **Full-text search** — instant search across the vault, `#tag` search mode
- **Command palette** (Ctrl+P) and **quick switcher** (Ctrl+O, create-on-miss)
- **File explorer** — tree view, create/rename/delete, context menus, inline rename
- **Tabs**, dark/light **themes**, settings, persistent workspace
- **Plugins** — a real plugin API (commands, events, vault access, status bar);
  ships with Word Count, Daily Notes and Random Note built-ins, and loads
  **external plugins from `<vault>/.geode/plugins/*.js`** — no rebuild needed.
  See [docs/PLUGINS.md](docs/PLUGINS.md).

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
| `Ctrl+\` / `Ctrl+Shift+\` | Split pane right / down |
| `Ctrl+Alt+←/→` | Focus previous / next pane |
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

## Documentation

| Doc | What's inside |
|---|---|
| [docs/ROADMAP.md](docs/ROADMAP.md) | 核心使命（不变项）、已完成轮次、R3 商业化候选、技术债 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 上手路径、阅读顺序、开发纪律、每轮编排节奏、验证手段 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层规则、核心 API、组件契约（并行开发的"宪法"） |
| [docs/PLUGINS.md](docs/PLUGINS.md) | 插件 API + 外部插件（`.geode/plugins`）authoring 指南 |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | 万级笔记基准方法论、优化前后数字、剩余瓶颈 |

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short:

```
src/core/      framework-free TS: vault, metadata index, workspace, commands, events, plugin host
src/app/       shell: layout, context, icons
src/features/  editor / explorer / search / graph / backlinks / palette / settings
src/plugins/   built-in plugins (use the same public API as external ones)
src-tauri/     Rust: vault filesystem commands with path-traversal guards
```
