# G3 Command Matrix — Side-panels domain

Cross-reference of Obsidian 1.9.x commands against the Geode command inventory for the
**Side-panels** domain: backlinks / outgoing links / outline / tags / word-count / properties.

- Source of truth for Geode ids: registrations in `src/app/App.tsx` (L259–301) and the
  word-count plugin `src/plugins/word-count.ts`.
- Status legend: **full** = registered command with a real handler · **partial** =
  capability exists but not as a standalone command (gap noted) · **missing** = no Geode
  equivalent · **oos** = out of scope (depends on a big feature/host capability).
- Feasibility (for partial/missing): **pure-frontend** · **host-dependent** ·
  **big-feature** · **n/a**.

| Obsidian command | Obsidian id | Geode id | Status | Feasibility | Note |
|---|---|---|---|---|---|
| Backlinks: Show backlinks | `backlink:open` | `app:show-backlinks` | full | n/a | `workspace.setRightPanel('backlinks')`, real handler at `src/app/App.tsx:282`. |
| Backlinks: Toggle backlinks in document | `backlink:toggle-backlinks-in-document` | — | partial | pure-frontend | "Backlink in document" exists only as a settings/appearance toggle (`backlinksInDoc`, `SettingsModal.tsx:738`; `core/appearance.ts:103` renders linked mentions at note bottom). Not exposed as a palette command. Pure-frontend: register a command that flips the existing `backlinksInDoc` setting. |
| Outgoing links: Show outgoing links | `outgoing-links:open` | `app:show-outgoing-links` | full | n/a | `workspace.setRightPanel('outgoinglinks')`, real handler at `src/app/App.tsx:259`. |
| Outgoing links: Toggle outgoing links in document | `outgoing-links:toggle-outgoing-links-in-document` | — | missing | pure-frontend | Obsidian's core Outgoing-links plugin offers an in-document toggle paralleling backlinks-in-document. No Geode feature/command. Lower priority; pure-frontend feasible alongside the backlinks-in-document analog. |
| Outline: Show outline | `outline:open` | `app:show-outline` | full | n/a | `workspace.setRightPanel('outline')`, real handler at `src/app/App.tsx:287`. |
| Tags view: Show tags | `tag-pane:open` | `app:show-tags` | full | n/a | `workspace.setRightPanel('tags')`, real handler at `src/app/App.tsx:292`. |
| Word count: Show word count (status bar) | — | `word-count` (plugin) | full | n/a | Obsidian's core Word Count plugin shows a status-bar count and registers no palette command (auto-updates, incl. "N selected words"). Geode mirrors exactly via `src/plugins/word-count.ts`: status-bar item, selection-aware, locale-aware. No command on either side → coverage is full. |
| Properties view: Show all properties | `properties:open-global` | `app:show-all-properties` | full | n/a | `workspace.setRightPanel('allproperties')`, real handler at `src/app/App.tsx:297`. Mirrors Obsidian's vault-wide global Properties view. |
| Properties view: Show file properties (in-document) | `properties:open` | — | partial | pure-frontend | Obsidian also has a per-file Properties sidebar view distinct from the global one. Geode has in-document frontmatter editing (`editor:add-property`) but no standalone right-panel "file properties" view command. Pure-frontend feasible as another `setRightPanel` target. |
| Footnotes: Show footnotes (adjacent right-panel family) | `app:show-footnotes` | `app:show-footnotes` | full | n/a | Adjacent/bonus: `workspace.setRightPanel('footnotes')` at `src/app/App.tsx:264`. Not a stock Obsidian 1.9 core command but in the same right-panel family; listed for completeness. |

## Summary

- **Full (7):** show backlinks, show outgoing links, show outline, show tags, show all
  properties, word count, show footnotes.
- **Partial (2):** toggle backlinks in document (settings toggle only), show file
  properties (in-document properties view) — both pure-frontend.
- **Missing (1):** toggle outgoing links in document — pure-frontend.
- No **oos** items in this domain.
