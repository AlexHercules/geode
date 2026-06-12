/**
 * i18n dictionary fragment — sidebar panels + palette strings (R8).
 * Owner: sweep-panels agent. Namespaces: explorer.* / search.* / backlinks.* /
 * outline.* / palette.* / switcher.*
 * `zh` is keyed against `en` so a missing translation is a type error.
 */
export const en = {
  // ---- explorer ----
  "explorer.newNote": "New note",
  "explorer.newFolder": "New folder",
  "explorer.collapseAll": "Collapse all",
  "explorer.expandAll": "Expand all",
  "explorer.noVault": "No vault open",
  "explorer.emptyVault": "This vault is empty.",
  "explorer.createFirstNote": "Create your first note",
  "explorer.newNoteHere": "New note here",
  "explorer.newFolderHere": "New folder here",
  "explorer.rename": "Rename",
  "explorer.delete": "Delete",
  "explorer.deleteConfirmFile": 'Delete "{name}"?',
  "explorer.deleteConfirmFolder": 'Delete folder "{name}" and all its contents?',
  "explorer.linkUpdateSkipped": "{count} file(s) skipped during link update — see console",

  // ---- search ----
  "search.title": "Search",
  "search.placeholder": "Search notes…",
  "search.clear": "Clear search",
  "search.hintType": "Type to search all notes.",
  // rendered around a literal <code>#</code> element
  "search.hintTagsBefore": "Start with ",
  "search.hintTagsAfter": " to search tags.",
  "search.noTags": "No tags matching “#{query}”",
  "search.tagsOne": "{count} tag",
  "search.tagsMany": "{count} tags",
  "search.searching": "Searching…",
  "search.noResults": "No results for “{query}”",
  "search.resultsOne": "{count} result",
  "search.resultsMany": "{count} results",
  "search.notesOne": "{count} note",
  "search.notesMany": "{count} notes",
  // {results}/{notes} are pre-translated via the count keys above
  "search.meta": "{results} in {notes}",
  "search.showingTop": "showing top {count}",
  "search.lineTooltip": "Line {line}",
  // rendered as a plain text line under the type-to-search hint
  "search.hintOperators": 'Operators: path:, tag:, file:, "...", OR, - (exclude), /regex/',
  "search.errorBadRegex": "Invalid regular expression",
  "search.errorUnclosedQuote": "Unclosed quote in query",
  "search.errorUnclosedParen": "Unclosed parenthesis in query",
  "search.errorEmptyGroup": "Empty group in query",

  // ---- backlinks ----
  "backlinks.title": "Backlinks",
  "backlinks.empty": "Open a note to see its backlinks",
  "backlinks.linkedMentions": "Linked mentions",
  "backlinks.noBacklinks": "No backlinks yet",
  "backlinks.outgoingLinks": "Outgoing links",
  "backlinks.noOutgoing": "No outgoing links",
  "backlinks.tags": "Tags",
  "backlinks.noTags": "No tags",
  "backlinks.createTitle": 'Create "{name}"',
  "backlinks.newBadge": "new",

  // ---- outline ----
  "outline.title": "Outline",
  "outline.empty": "Open a note to see its outline",
  "outline.noHeadings": "No headings in this note",
  "outline.ariaTree": "Document outline",
  "outline.expandSection": "Expand section",
  "outline.collapseSection": "Collapse section",

  // ---- command palette ----
  "palette.aria": "Command palette",
  "palette.placeholder": "Type a command…",
  "palette.empty": "No matching commands",

  // ---- quick switcher ----
  "switcher.aria": "Quick switcher",
  "switcher.placeholder": "Find or create a note…",
  "switcher.empty": "No notes in vault",
  "switcher.create": "Create note: {name}",
} as const;

export const zh: Record<keyof typeof en, string> = {
  // ---- explorer ----
  "explorer.newNote": "新建笔记",
  "explorer.newFolder": "新建文件夹",
  "explorer.collapseAll": "全部折叠",
  "explorer.expandAll": "全部展开",
  "explorer.noVault": "尚未打开任何库。",
  "explorer.emptyVault": "这个库还是空的。",
  "explorer.createFirstNote": "创建第一篇笔记",
  "explorer.newNoteHere": "在此新建笔记",
  "explorer.newFolderHere": "在此新建文件夹",
  "explorer.rename": "重命名",
  "explorer.delete": "删除",
  "explorer.deleteConfirmFile": "删除“{name}”？",
  "explorer.deleteConfirmFolder": "删除文件夹“{name}”及其全部内容？",
  "explorer.linkUpdateSkipped": "链接更新跳过 {count} 个文件——详见控制台",

  // ---- search ----
  "search.title": "搜索",
  "search.placeholder": "搜索笔记…",
  "search.clear": "清除搜索",
  "search.hintType": "输入以搜索所有笔记。",
  "search.hintTagsBefore": "以 ",
  "search.hintTagsAfter": " 开头可搜索标签。",
  "search.noTags": "没有匹配“#{query}”的标签。",
  "search.tagsOne": "{count} 个标签",
  "search.tagsMany": "{count} 个标签",
  "search.searching": "正在搜索…",
  "search.noResults": "没有找到“{query}”的结果。",
  "search.resultsOne": "{count} 个结果",
  "search.resultsMany": "{count} 个结果",
  "search.notesOne": "{count} 篇笔记",
  "search.notesMany": "{count} 篇笔记",
  "search.meta": "在 {notes} 中找到 {results}",
  "search.showingTop": "仅显示前 {count} 项",
  "search.lineTooltip": "第 {line} 行",
  "search.hintOperators": "支持运算符：path:、tag:、file:、\"...\"、OR、-（排除）、/正则/",
  "search.errorBadRegex": "正则表达式无效",
  "search.errorUnclosedQuote": "查询中的引号未闭合",
  "search.errorUnclosedParen": "查询中的括号未闭合",
  "search.errorEmptyGroup": "查询中存在空分组",

  // ---- backlinks ----
  "backlinks.title": "反向链接",
  "backlinks.empty": "打开笔记以查看其反向链接。",
  "backlinks.linkedMentions": "链接提及",
  "backlinks.noBacklinks": "暂无反向链接。",
  "backlinks.outgoingLinks": "出链",
  "backlinks.noOutgoing": "暂无出链。",
  "backlinks.tags": "标签",
  "backlinks.noTags": "暂无标签。",
  "backlinks.createTitle": "新建“{name}”",
  "backlinks.newBadge": "未创建",

  // ---- outline ----
  "outline.title": "大纲",
  "outline.empty": "打开笔记以查看其大纲。",
  "outline.noHeadings": "此笔记中没有标题。",
  "outline.ariaTree": "文档大纲",
  "outline.expandSection": "展开小节",
  "outline.collapseSection": "折叠小节",

  // ---- command palette ----
  "palette.aria": "命令面板",
  "palette.placeholder": "输入命令…",
  "palette.empty": "没有匹配的命令。",

  // ---- quick switcher ----
  "switcher.aria": "快速切换",
  "switcher.placeholder": "查找或创建笔记…",
  "switcher.empty": "库中没有笔记。",
  "switcher.create": "新建笔记：{name}",
};
