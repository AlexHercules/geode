/**
 * i18n dictionary fragment — Bookmarks (R27). Namespaces: bookmarks.* / cmd.bookmark*
 * `zh` is keyed against `en` so a missing translation is a type error.
 */
export const en = {
  // ---- panel ----
  "bookmarks.title": "Bookmarks",
  "bookmarks.empty": "No bookmarks yet",
  "bookmarks.emptyHint": "Bookmark a note from the command palette or right-click menu.",
  "bookmarks.newGroup": "New group",
  "bookmarks.newGroupName": "New group",
  "bookmarks.rename": "Rename…",
  "bookmarks.remove": "Remove",
  "bookmarks.renamePrompt": "New title (empty to clear):",
  // ---- bookmark type labels (untitled fallback display) ----
  "bookmarks.untitledSearch": "Search: {query}",
  "bookmarks.graph": "Graph",
  // ---- ribbon + commands ----
  "app.ribbonBookmarks": "Bookmarks",
  "cmd.bookmarkFile": "Bookmark the active note",
  "cmd.unbookmarkFile": "Remove bookmark for the active note",
  "cmd.bookmarkHeading": "Bookmark heading under cursor",
  "cmd.bookmarkBlock": "Bookmark block under cursor",
  "cmd.showBookmarks": "Show bookmarks",
} as const;

export const zh: Record<keyof typeof en, string> = {
  "bookmarks.title": "书签",
  "bookmarks.empty": "暂无书签",
  "bookmarks.emptyHint": "从命令面板或右键菜单收藏一篇笔记。",
  "bookmarks.newGroup": "新建分组",
  "bookmarks.newGroupName": "新分组",
  "bookmarks.rename": "重命名…",
  "bookmarks.remove": "移除",
  "bookmarks.renamePrompt": "新标题（留空则清除）：",
  "bookmarks.untitledSearch": "搜索：{query}",
  "bookmarks.graph": "关系图谱",
  "app.ribbonBookmarks": "书签",
  "cmd.bookmarkFile": "收藏当前笔记",
  "cmd.unbookmarkFile": "取消收藏当前笔记",
  "cmd.bookmarkHeading": "收藏光标所在标题",
  "cmd.bookmarkBlock": "收藏光标所在块",
  "cmd.showBookmarks": "显示书签",
};
