/**
 * i18n dictionary fragment — settings / graph / editor / export strings (R8).
 * Owner: sweep-views agent. Namespaces: settings.* / graph.* / editor.* / export.*
 * `zh` is keyed against `en` so a missing translation is a type error.
 */
export const en = {
  // ---- settings: shell ----
  "settings.title": "Settings",
  "settings.close": "Close settings",
  "settings.navAria": "Settings sections",
  "settings.section.appearance": "Appearance",
  "settings.section.plugins": "Plugins",
  "settings.section.hotkeys": "Hotkeys",
  "settings.section.about": "About",

  // ---- settings: appearance ----
  "settings.theme": "Theme",
  "settings.themeDesc": "Choose the base color scheme for the app.",
  "settings.themeDark": "Dark",
  "settings.themeLight": "Light",
  "settings.fontSize": "Editor font size",
  "settings.fontSizeDesc": "Font size used by the markdown editor and preview.",
  "settings.language": "Language",
  "settings.languageDesc": "Choose the interface language.",
  "settings.readableLineLength": "Readable line length",
  "settings.spellcheck": "Spellcheck",

  // ---- settings: Obsidian CSS (R20) ----
  "settings.obsidianCss": "Obsidian CSS",
  "settings.obsidianCssDesc":
    "Bridge Obsidian theme variables and load community themes and CSS snippets from this vault's .obsidian folder.",
  "settings.obsidianTheme": "Obsidian theme",
  "settings.obsidianThemeDesc": "Community theme from .obsidian/themes.",
  "settings.obsidianThemeNone": "None",
  "settings.obsidianSnippets": "CSS snippets",
  "settings.obsidianSnippetsDesc": "Toggle .css files from .obsidian/snippets.",
  "settings.obsidianSnippetsEmpty": "No CSS snippets found in this vault.",

  // ---- settings: editor (R22) ----
  "settings.editorHeading": "Editor",
  "settings.propertiesDisplay": "Properties in document",
  "settings.propertiesDisplayDesc":
    "How frontmatter properties are shown at the top of a note.",
  "settings.propertiesVisible": "Visible",
  "settings.propertiesHidden": "Hidden",
  "settings.propertiesSource": "Source",

  // ---- settings: page preview (R25) ----
  "settings.pagePreviewHeading": "Page preview",
  "settings.pagePreview": "Enable page preview",
  "settings.pagePreviewDesc":
    "Show a preview card of the target note when hovering over an internal link.",
  "settings.pagePreviewModifier": "Require Ctrl/Cmd to hover",
  "settings.pagePreviewModifierDesc":
    "When on, every preview requires holding Ctrl (Cmd on macOS) while hovering.",

  // ---- settings: files & links (R16) ----
  "settings.filesAndLinks": "Files & links",
  "settings.autoUpdateLinks": "Automatically update internal links",
  "settings.autoUpdateLinksDesc":
    "When a file is renamed or moved, automatically rewrite the links that point to it.",
  "settings.linkUseMarkdown": "Use Markdown links",
  "settings.linkUseMarkdownDesc":
    "On: new links use Markdown [text](path). Off: new links use wikilinks [[text]]. (Embeds always use ![[ ]].)",
  "settings.linkPathFormat": "New link format",
  "settings.linkPathFormatDesc":
    "Path used for new links. Relative applies to markdown links only; wikilinks always use the shortest path.",
  "settings.linkPathShortest": "Shortest path when possible",
  "settings.linkPathRelative": "Relative path to file",
  "settings.linkPathAbsolute": "Absolute path in vault",
  "settings.attachmentFolder": "Default location for new attachments",
  "settings.attachmentFolderDesc":
    'Folder for pasted or dropped images. "/" = vault root, "./" = same folder as the note, "./name" = subfolder under the note\'s folder, "name" = fixed vault folder.',

  // ---- settings: templates (R23) ----
  "settings.templates": "Templates",
  "settings.templateFolder": "Template folder location",
  "settings.templateDateFormat": "Date format",
  "settings.templateTimeFormat": "Time format",

  // ---- settings: daily notes (R48) ----
  "settings.dailyNotes": "Daily notes",
  "settings.dailyNoteFolder": "New file location",
  "settings.dailyNoteFormat": "Date format",
  "settings.dailyNoteTemplate": "Template file location",
  "settings.uniqueNotes": "Unique note creator",
  "settings.uniqueNoteFolder": "New file location",
  "settings.uniqueNoteFormat": "Unique prefix format",
  "settings.uniqueNoteTemplate": "Template file location",

  // ---- settings: plugins ----
  // note split around the inline <code> element (word order differs per locale)
  "settings.pluginsNotePre":
    "Built-in plugins extend Geode with commands, status bar items and more. Plugins can also be registered at runtime via ",
  "settings.pluginsNotePost": ".",
  "settings.pluginGroupBuiltin": "Built-in",
  "settings.pluginGroupExternal": "External",
  "settings.pluginGroupObsidian": "Obsidian",
  "settings.reloadPlugins": "Reload external plugins",
  "settings.reloadPluginsTitle": "Re-scan .geode/plugins and reload all external plugins",
  // "Drop <.js> files into <path> — see <doc> for the authoring guide."
  "settings.pluginPathHint1": "Drop ",
  "settings.pluginPathHint2": " files into ",
  "settings.pluginPathHint3": " — see ",
  "settings.pluginPathHint4": " for the authoring guide.",
  // "Obsidian community plugins from <path>, loaded through the compatibility layer."
  "settings.obsidianHintPre": "Obsidian community plugins from ",
  "settings.obsidianHintPost": ", loaded through the compatibility layer.",
  "settings.sourceBadgeBuiltin": "core",
  "settings.sourceBadgeExternal": "external",
  "settings.sourceBadgeObsidian": "obsidian",
  "settings.pluginFailed": "failed to load",
  "settings.pluginSkipped": "skipped",
  "settings.pluginNoDetail": "no detail recorded",
  "settings.pluginSettingsGroup": "Plugin settings",
  "settings.pluginEmptyBuiltin": "No built-in plugins registered.",
  "settings.pluginEmptyExternal": "No external plugins found.",
  "settings.pluginEmptyObsidian": "No Obsidian plugins found.",
  "settings.enablePlugin": "Enable {name}",
  "settings.disablePlugin": "Disable {name}",

  // ---- settings: hotkeys ----
  // instruction note split around inline <em>/<code> elements:
  // "Click <Customize>, then press the new key combination (must include
  //  <Ctrl> or <Alt>, except function keys). Press <Backspace> to remove a
  //  binding, <Escape> to cancel."
  "settings.hotkeysNote1": "Click ",
  "settings.hotkeysNote2": ", then press the new key combination (must include ",
  "settings.hotkeysNote3": " or ",
  "settings.hotkeysNote4": ", except function keys). Press ",
  "settings.hotkeysNote5": " to remove a binding, ",
  "settings.hotkeysNote6": " to cancel.",
  "settings.hotkeysFilter": "Filter commands…",
  "settings.hotkeysEmpty": "No matching commands.",
  "settings.hotkeyConflict": "Conflicts with {names}",
  "settings.hotkeyCapture": "Press a key…",
  "settings.hotkeyNotSet": "Not set",
  "settings.hotkeyResetTitle": "Restore default hotkey",
  "settings.hotkeyResetAria": "Restore default hotkey for {name}",
  "settings.customize": "Customize",
  "settings.cancel": "Cancel",

  // ---- settings: about ----
  "settings.aboutDesc":
    "Geode is a local-first markdown knowledge base. Your notes are plain files on your own disk — link them with wikilinks, follow backlinks, and explore the connections between ideas in an interactive graph.",
  "settings.aboutStack": "Built with Tauri 2 · React 18 · TypeScript · Vite · CodeMirror 6",

  // ---- settings: updates (R9, desktop only) ----
  "settings.update.title": "Updates",
  "settings.update.currentVersion": "Current version: {version}",
  "settings.update.check": "Check for updates",
  "settings.update.checking": "Checking…",
  "settings.update.upToDate": "You're up to date.",
  "settings.update.available": "New version v{version} available",
  "settings.update.installRestart": "Update and restart",
  "settings.update.downloadingPct": "Downloading… {pct}%",
  "settings.update.downloadingBytes": "Downloading… {size}",
  "settings.update.installing": "Installing update…",
  "settings.update.checkFailed": "Update check failed: {error}",
  "settings.update.installFailed": "Update failed: {error}",

  // ---- graph view ----
  "graph.global": "Global",
  "graph.local": "Local",
  "graph.depth1": "Depth 1",
  "graph.depth2": "Depth 2",
  "graph.fit": "Fit",
  "graph.fitTitle": "Fit graph to view",
  "graph.settings": "Graph settings",
  "graph.forces": "Forces",
  "graph.display": "Display",
  "graph.forceCenter": "Center force",
  "graph.forceRepel": "Repel force",
  "graph.forceLink": "Link force",
  "graph.linkDistance": "Link distance",
  "graph.nodeSize": "Node size",
  "graph.linkThickness": "Link thickness",
  "graph.textFade": "Text fade threshold",
  "graph.arrows": "Arrows",
  "graph.resetSettings": "Reset to defaults",
  "graph.legendTop": "top {shown} of {total} nodes",
  "graph.nodesOne": "{count} node",
  "graph.nodesMany": "{count} nodes",
  "graph.linksOne": "{count} link",
  "graph.linksMany": "{count} links",
  "graph.showAll": "Show all",
  "graph.showTop": "Show top {cap}",
  "graph.localEmpty": "Open a note to see its local graph.",
  "graph.emptyTitle": "No notes to graph yet",
  "graph.emptyHint": "Create a note and add [[wiki links]] to see connections.",

  // ---- editor ----
  "editor.noFile": "No file is open",
  "editor.openFailed": 'Couldn\'t open "{name}"',
  "editor.viewModeAria": "View mode",
  "editor.livePreview": "Live preview",
  "editor.sourceMode": "Source mode",
  "editor.readingView": "Reading view",
  "editor.placeholder": "Start writing…",
  "editor.taskMarkComplete": "Mark task complete",
  "editor.taskMarkIncomplete": "Mark task incomplete",
  "editor.propertiesOne": "Properties · {count} field",
  "editor.propertiesMany": "Properties · {count} fields",
  "editor.editProperties": "Edit properties",

  // ---- editor: properties panel (R22) ----
  "editor.addProperty": "Add property",
  "editor.propertyNamePlaceholder": "Property name",
  "editor.propertyValuePlaceholder": "Empty",
  "editor.deleteProperty": "Remove property",
  "editor.propertyTypeAria": "Property type: {type}",
  "editor.typeText": "Text",
  "editor.typeMultitext": "List",
  "editor.typeNumber": "Number",
  "editor.typeCheckbox": "Checkbox",
  "editor.typeDate": "Date",
  "editor.typeDatetime": "Date & time",
  "editor.typeTags": "Tags",
  "editor.typeAliases": "Aliases",
  "editor.propertiesOpaqueHint": "This entry can't be edited here — edit it in source mode.",

  "editor.embedCircular": "Circular embed: {name}",
  "editor.embedMissingHeading": 'Heading "{heading}" not found in {name}',
  "editor.embedMissingBlock": 'Block "^{block}" not found in {name}',

  // ---- in-editor find/replace panel (R34): CM @codemirror/search phrases ----
  "editor.search.find": "Find",
  "editor.search.replace": "Replace",
  "editor.search.next": "next",
  "editor.search.previous": "previous",
  "editor.search.all": "all",
  "editor.search.matchCase": "match case",
  "editor.search.regexp": "regexp",
  "editor.search.byWord": "by word",
  "editor.search.replaceBtn": "replace",
  "editor.search.replaceAll": "replace all",
  "editor.search.close": "close",
  "editor.search.currentMatch": "current match",
  "editor.search.gotoLine": "Go to line",
  "editor.search.go": "go",
  "editor.search.onLine": "on line",
  "editor.search.replacedOnLine": "replaced match on line $",
  "editor.search.replacedMatches": "replaced $ matches",

  // ---- export ----
  "export.success": 'Exported "{name}"',
  "export.failed": "Export failed: {error}",
  "export.printFailed": "Print failed: {error}",
} as const;

export const zh: Record<keyof typeof en, string> = {
  // ---- settings: shell ----
  "settings.title": "设置",
  "settings.close": "关闭设置",
  "settings.navAria": "设置分区",
  "settings.section.appearance": "外观",
  "settings.section.plugins": "插件",
  "settings.section.hotkeys": "快捷键",
  "settings.section.about": "关于",

  // ---- settings: appearance ----
  "settings.theme": "主题",
  "settings.themeDesc": "选择应用的基础配色方案。",
  "settings.themeDark": "深色",
  "settings.themeLight": "浅色",
  "settings.fontSize": "编辑器字号",
  "settings.fontSizeDesc": "Markdown 编辑器与预览所使用的字号。",
  "settings.language": "语言",
  "settings.languageDesc": "选择界面语言。",
  "settings.readableLineLength": "可读行宽",
  "settings.spellcheck": "拼写检查",

  // ---- settings: Obsidian CSS (R20) ----
  "settings.obsidianCss": "Obsidian CSS 兼容",
  "settings.obsidianCssDesc":
    "桥接 Obsidian 主题变量，并加载库内 .obsidian 目录下的社区主题与 CSS 片段。",
  "settings.obsidianTheme": "Obsidian 主题",
  "settings.obsidianThemeDesc": "来自 .obsidian/themes 的社区主题。",
  "settings.obsidianThemeNone": "无",
  "settings.obsidianSnippets": "CSS 片段",
  "settings.obsidianSnippetsDesc": "启用或停用 .obsidian/snippets 下的 .css 文件。",
  "settings.obsidianSnippetsEmpty": "当前库中没有 CSS 片段。",

  // ---- settings: editor (R22) ----
  "settings.editorHeading": "编辑器",
  "settings.propertiesDisplay": "文档内属性",
  "settings.propertiesDisplayDesc": "笔记顶部 frontmatter 属性的显示方式。",
  "settings.propertiesVisible": "可见",
  "settings.propertiesHidden": "隐藏",
  "settings.propertiesSource": "源码",

  // ---- settings: page preview (R25) ----
  "settings.pagePreviewHeading": "页面预览",
  "settings.pagePreview": "启用页面预览",
  "settings.pagePreviewDesc": "悬停在内部链接上时，显示目标笔记的预览卡片。",
  "settings.pagePreviewModifier": "要求按住 Ctrl/Cmd",
  "settings.pagePreviewModifierDesc":
    "开启后，所有预览都需要在悬停时按住 Ctrl（macOS 为 Cmd）。",

  // ---- settings: files & links (R16) ----
  "settings.filesAndLinks": "文件与链接",
  "settings.autoUpdateLinks": "自动更新内部链接",
  "settings.autoUpdateLinksDesc": "重命名或移动文件时，自动改写指向它的链接。",
  "settings.linkUseMarkdown": "使用 Markdown 链接",
  "settings.linkUseMarkdownDesc":
    "开：新链接用 Markdown [文本](路径)。关：新链接用 wikilink [[文本]]。（嵌入始终用 ![[ ]]。）",
  "settings.linkPathFormat": "新链接格式",
  "settings.linkPathFormatDesc": "新链接使用的路径形式。「相对」仅对 Markdown 链接生效；wikilink 始终用最短路径。",
  "settings.linkPathShortest": "尽可能用最短路径",
  "settings.linkPathRelative": "相对文件的路径",
  "settings.linkPathAbsolute": "库内绝对路径",
  "settings.attachmentFolder": "新附件默认位置",
  "settings.attachmentFolderDesc":
    "粘贴/拖入图片的保存目录。「/」表示库根目录，「./」表示笔记所在目录，「./名称」表示笔记所在目录下的子文件夹，「名称」表示库内固定文件夹。",

  // ---- settings: templates (R23) ----
  "settings.templates": "模板",
  "settings.templateFolder": "模板文件夹位置",
  "settings.templateDateFormat": "日期格式",
  "settings.templateTimeFormat": "时间格式",

  // ---- settings: daily notes (R48) ----
  "settings.dailyNotes": "日记",
  "settings.dailyNoteFolder": "新文件位置",
  "settings.dailyNoteFormat": "日期格式",
  "settings.dailyNoteTemplate": "模板文件位置",
  "settings.uniqueNotes": "唯一笔记创建器",
  "settings.uniqueNoteFolder": "新文件位置",
  "settings.uniqueNoteFormat": "唯一前缀格式",
  "settings.uniqueNoteTemplate": "模板文件位置",

  // ---- settings: plugins ----
  "settings.pluginsNotePre": "内置插件为 Geode 提供命令、状态栏项等扩展能力。也可以在运行时通过 ",
  "settings.pluginsNotePost": " 注册插件。",
  "settings.pluginGroupBuiltin": "内置",
  "settings.pluginGroupExternal": "外部",
  "settings.pluginGroupObsidian": "Obsidian",
  "settings.reloadPlugins": "重新加载外部插件",
  "settings.reloadPluginsTitle": "重新扫描 .geode/plugins 并重新加载全部外部插件",
  "settings.pluginPathHint1": "将 ",
  "settings.pluginPathHint2": " 文件放入 ",
  "settings.pluginPathHint3": "，编写指南见 ",
  "settings.pluginPathHint4": "。",
  "settings.obsidianHintPre": "来自 ",
  "settings.obsidianHintPost": " 的 Obsidian 社区插件，经兼容层加载。",
  "settings.sourceBadgeBuiltin": "核心",
  "settings.sourceBadgeExternal": "外部",
  "settings.sourceBadgeObsidian": "obsidian",
  "settings.pluginFailed": "加载失败",
  "settings.pluginSkipped": "已跳过",
  "settings.pluginNoDetail": "未记录详细信息",
  "settings.pluginSettingsGroup": "插件设置",
  "settings.pluginEmptyBuiltin": "未注册任何内置插件。",
  "settings.pluginEmptyExternal": "未发现外部插件。",
  "settings.pluginEmptyObsidian": "未发现 Obsidian 插件。",
  "settings.enablePlugin": "启用 {name}",
  "settings.disablePlugin": "停用 {name}",

  // ---- settings: hotkeys ----
  "settings.hotkeysNote1": "点击 ",
  "settings.hotkeysNote2": "，然后按下新的按键组合（须包含 ",
  "settings.hotkeysNote3": " 或 ",
  "settings.hotkeysNote4": "，功能键除外）。按 ",
  "settings.hotkeysNote5": " 移除绑定，按 ",
  "settings.hotkeysNote6": " 取消。",
  "settings.hotkeysFilter": "筛选命令…",
  "settings.hotkeysEmpty": "没有匹配的命令。",
  "settings.hotkeyConflict": "与 {names} 冲突",
  "settings.hotkeyCapture": "请按下按键…",
  "settings.hotkeyNotSet": "未设置",
  "settings.hotkeyResetTitle": "恢复默认快捷键",
  "settings.hotkeyResetAria": "恢复 {name} 的默认快捷键",
  "settings.customize": "自定义",
  "settings.cancel": "取消",

  // ---- settings: about ----
  "settings.aboutDesc":
    "Geode 是一个本地优先的 Markdown 知识库。你的笔记是存放在自己磁盘上的纯文本文件——用 wikilink 连接它们、追踪反向链接，并在交互式关系图谱中探索想法之间的关联。",
  "settings.aboutStack": "基于 Tauri 2 · React 18 · TypeScript · Vite · CodeMirror 6 构建",

  // ---- settings: updates (R9, desktop only) ----
  "settings.update.title": "更新",
  "settings.update.currentVersion": "当前版本：{version}",
  "settings.update.check": "检查更新",
  "settings.update.checking": "正在检查…",
  "settings.update.upToDate": "已是最新版本。",
  "settings.update.available": "发现新版本 v{version}",
  "settings.update.installRestart": "更新并重启",
  "settings.update.downloadingPct": "下载中… {pct}%",
  "settings.update.downloadingBytes": "下载中… {size}",
  "settings.update.installing": "正在安装更新…",
  "settings.update.checkFailed": "检查更新失败：{error}",
  "settings.update.installFailed": "更新失败：{error}",

  // ---- graph view ----
  "graph.global": "全局",
  "graph.local": "局部",
  "graph.depth1": "深度 1",
  "graph.depth2": "深度 2",
  "graph.fit": "适应",
  "graph.fitTitle": "缩放图谱以适应视图",
  "graph.settings": "图谱设置",
  "graph.forces": "力",
  "graph.display": "显示",
  "graph.forceCenter": "中心力",
  "graph.forceRepel": "斥力",
  "graph.forceLink": "链接力",
  "graph.linkDistance": "链接距离",
  "graph.nodeSize": "节点大小",
  "graph.linkThickness": "连线粗细",
  "graph.textFade": "文本淡出阈值",
  "graph.arrows": "箭头",
  "graph.resetSettings": "恢复默认",
  "graph.legendTop": "显示前 {shown} 个节点（共 {total} 个）",
  "graph.nodesOne": "{count} 个节点",
  "graph.nodesMany": "{count} 个节点",
  "graph.linksOne": "{count} 条连接",
  "graph.linksMany": "{count} 条连接",
  "graph.showAll": "显示全部",
  "graph.showTop": "仅显示前 {cap} 个",
  "graph.localEmpty": "打开笔记以查看其局部图谱。",
  "graph.emptyTitle": "还没有可生成图谱的笔记",
  "graph.emptyHint": "新建笔记并添加 [[wiki 链接]] 即可看到关联。",

  // ---- editor ----
  "editor.noFile": "没有打开的文件",
  "editor.openFailed": "无法打开“{name}”",
  "editor.viewModeAria": "视图模式",
  "editor.livePreview": "实时预览",
  "editor.sourceMode": "源码模式",
  "editor.readingView": "阅读视图",
  "editor.placeholder": "开始书写…",
  "editor.taskMarkComplete": "标记任务为已完成",
  "editor.taskMarkIncomplete": "标记任务为未完成",
  "editor.propertiesOne": "属性 · {count} 个字段",
  "editor.propertiesMany": "属性 · {count} 个字段",
  "editor.editProperties": "编辑属性",

  // ---- editor: properties panel (R22) ----
  "editor.addProperty": "添加属性",
  "editor.propertyNamePlaceholder": "属性名称",
  "editor.propertyValuePlaceholder": "空",
  "editor.deleteProperty": "删除属性",
  "editor.propertyTypeAria": "属性类型：{type}",
  "editor.typeText": "文本",
  "editor.typeMultitext": "列表",
  "editor.typeNumber": "数字",
  "editor.typeCheckbox": "复选框",
  "editor.typeDate": "日期",
  "editor.typeDatetime": "日期与时间",
  "editor.typeTags": "标签",
  "editor.typeAliases": "别名",
  "editor.propertiesOpaqueHint": "此条目无法在面板中编辑——请在源码模式中编辑。",

  "editor.embedCircular": "循环嵌入：{name}",
  "editor.embedMissingHeading": "在 {name} 中找不到标题 \"{heading}\"",
  "editor.embedMissingBlock": "在 {name} 中找不到块 \"^{block}\"",

  // ---- in-editor find/replace panel (R34): CM @codemirror/search phrases ----
  "editor.search.find": "查找",
  "editor.search.replace": "替换",
  "editor.search.next": "下一个",
  "editor.search.previous": "上一个",
  "editor.search.all": "全部",
  "editor.search.matchCase": "区分大小写",
  "editor.search.regexp": "正则表达式",
  "editor.search.byWord": "全字匹配",
  "editor.search.replaceBtn": "替换",
  "editor.search.replaceAll": "全部替换",
  "editor.search.close": "关闭",
  "editor.search.currentMatch": "当前匹配",
  "editor.search.gotoLine": "跳转到行",
  "editor.search.go": "跳转",
  "editor.search.onLine": "于第",
  "editor.search.replacedOnLine": "已替换第 $ 行的匹配",
  "editor.search.replacedMatches": "已替换 $ 处匹配",

  // ---- export ----
  "export.success": "已导出“{name}”",
  "export.failed": "导出失败：{error}",
  "export.printFailed": "打印失败：{error}",
};
