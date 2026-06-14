# Obsidian 插件兼容层 — 方向校准（2026-06-10，R3 末确立）

## 战略判断（为什么做、为什么这样做）

**结论：把"Obsidian 插件可一键迁移"确立为商业方向的头号差异化，以兼容层（shim）方式落地，
分 Tier 推进，用真实插件套件验收，绝不追求 100% 兼容。**

依据：

1. **迁移闭环**：vault 格式（纯 .md + wikilink + frontmatter + tags）天然互通，
   唯一锁死用户的是插件生态。补上插件兼容，"从 Obsidian 切换"才从口号变成动作。
2. **架构成本低**：Geode 插件 API 自 R1 起按 Obsidian 形状设计（AppHandle ≈ App，
   vault/metadata/workspace/commands 一一有对应物）。兼容层是映射，不是重写。
3. **Geode 原生 API 保持第一公民**：shim 建立在原生 API 之上（`src/compat/obsidian*`），
   core 契约不被外部 API 形状绑架；shim 缺口不阻塞原生功能演进。
4. **法律边界**：接口兼容合法（API 不受版权保护的判例明确）；**不**复制 Obsidian 实现代码、
   不打包其资源、不冒用商标（措辞用 "compatible with Obsidian plugins"）；
   CSS 类名兼容做成独立可选层（主题/插件样式很多依赖 `.workspace-leaf` 等类名，
   逐步对齐但不承诺）。

## 自我校准机制（每轮必做）

权威口径只有两个，开发时用 WebFetch 实时对照，不凭记忆写 API：

- **官方开发者文档**：`https://docs.obsidian.md`（Plugin 生命周期、Vault、Workspace、
  Editor、MetadataCache 的语义描述与示例）
- **官方类型定义**：`https://github.com/obsidianmd/obsidian-api` 的 `obsidian.d.ts`
  （签名与 jsdoc 的唯一事实来源；只参照声明，不存在实现可抄）

校准动作：实现任何 shim API 前，先抓取对应章节 → 把签名/语义摘录进本文件的 Tier 表 →
实现 → 用验收插件实测。发现本文件与官方口径冲突时，以官方为准并更新本文件。

R4 已完成一次全表面校准：6 个并行 agent 从官方 `obsidian.d.ts`（8482 行）+ docs.obsidian.md
逐字提取 T0+T1 全部 160 条签名与语义，产物在 **`.calibration/API-REFERENCE.md`**（gitignore，
本地可再生：`curl -o .calibration/obsidian.d.ts https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts`
后重跑校准）。shim 实现一律对照该文件，不凭记忆。

## 分层兼容目标

| Tier | 范围 | 状态 |
|---|---|---|
| **T0 加载管道** | 发现并加载 `<vault>/.obsidian/plugins/<id>/{manifest.json, main.js, styles.css}`；`require("obsidian")` 模块注入；启用状态对齐 `community-plugins.json`；manifest 校验（minAppVersion 提示而非硬拒） | **R4 已实现** |
| **T1 高频核心** | `Plugin` 基类（addCommand / addRibbonIcon / addStatusBarItem / addSettingTab / registerEvent / registerInterval / loadData / saveData）；`App.{vault, workspace, metadataCache}`；`Vault`（read/cachedRead/modify/create/delete/rename/getAbstractFileByPath/getMarkdownFiles/getFiles + on("create"/"modify"/"delete"/"rename")）；`TFile`/`TFolder`/`TAbstractFile`；`MetadataCache`（getFileCache: headings/links/tags/frontmatter；resolvedLinks/unresolvedLinks）；`Workspace`（getActiveFile/openLinkText/on("file-open"/"active-leaf-change"/"layout-ready")）；`Notice`；`Modal`；`Setting`/`PluginSettingTab`；`normalizePath` | **R4 已实现** |
| **T2 编辑与视图** | ~~`ItemView` + `registerView`/`getLeavesOfType`/`getLeftLeaf`/`getRightLeaf`/`revealLeaf`/`detachLeavesOfType`/`ensureSideLeaf` 真实挂载（侧栏面板宿主）~~（**R5 已实现**，含 legacy `layout-ready` 事件/`splitActiveLeaf`/`getUnpinnedLeaf`）；~~`moment` 导出 + `window.moment`~~（**R5 已实现**，moment-with-locales 单实例 138 locale）；~~`workspace.on('editor-change')` 逐事务~~（**R5 已实现**，core `document:changed` 驱动）；~~`SuggestModal`/`FuzzySuggestModal`~~（R4）；~~`EditorSuggest` 真实触发~~（**R6 已实现**，含 Scope 做实 + 非公开 `suggestions.useSelectedItem`，解锁 nldates 自动建议）；~~`MarkdownRenderer.render`/`renderMarkdown`~~（**R6 已实现**，共享 core/markdown 管线）；~~`requestUrl`/`request`~~（**R6 已实现**，桌面 Rust ureq CORS-free / 浏览器 fetch / data: 层内解析）；`Editor` 完整版（transaction/extension） | R6 余项全清；`Editor` 完整版按需求驱动 |
| **T3 明确不做/远期** | Canvas API、移动端 API、未文档化内部、DOM 私有结构契约、Sync/Publish 专属 API | 不承诺 |

## R4 实现决策（2026-06-10）

- **T1.5 — 套件驱动的最小 `Editor` 子集**提前入轮：套件 5 插件中 2 个
  （NL Dates、Paste URL）核心功能依赖 `editorCallback`，符合「套件外 API 按需求驱动加」
  的闸门规则。子集 = getValue/setValue/getSelection/somethingSelected/replaceSelection/
  getCursor/setCursor/setSelection/replaceRange/getLine/lineCount/lastLine/getRange/
  posToOffset/offsetToPos/focus/hasFocus，映射到共享文档模型的 active view。
  完整 `Editor`/`MarkdownView`/`registerView` 仍是 T2。
- **`apiVersion = "1.5.0"`**：shim 自报的版本号；`requireApiVersion` 按 semver 对比。
  manifest `minAppVersion` 超出时 console.warn + 设置页标注，不硬拒。
- **moment 不入本轮**（违反「不加 npm 依赖」纪律，T2 一次性决策）；`import { moment }`
  得到抛出说明性错误的占位 → 套件记录缺口。
- **越级 API 一律 warn-stub**（warn 一次 + 入加载器缺口报告），插件不因调用 T2/T3 API 崩溃。
- **法律边界落地**：`.calibration/`（官方 d.ts 及其摘录）gitignore 不入库，仓库内只保留
  我们自己实现的接口形状。
- 浏览器 E2E 注入口：`window.__geodeObsidianPlugins`（Memory adapter）+ `?obsfixture=1`
  内置测试插件（compat/obsidian/fixture.ts，覆盖 manifest/命令/状态栏/设置页/Notice/
  vault 读写/getFileCache/事件）。
- **套件驱动追加（真实插件预检后补充）**：套件 5 插件中 4 个在 require/evaluate 阶段失败，
  按需求驱动闸门补齐以下最小表面：
  - `View` / `ItemView` / `FileView` 真实类骨架（constructor(leaf)、containerEl/contentEl
    detached、生命周期默认空实现）——插件类必须能 evaluate 并完成加载；
    **`registerView` 仍是 warn-stub，视图本轮不挂载（缺口见下表）**。
  - `PopoverSuggest` / `EditorSuggest` 骨架（constructor(app) 设 this.app + this.scope =
    new Scope()，子类构造 `super(app)` 后 `this.scope.register([...])` 不抛）；
    **`registerEditorSuggest` 仍是 warn-stub，不触发（缺口见下表）**。
  - `SuggestModal` / `FuzzySuggestModal` 最小真实实现：input + 建议列表、
    ArrowUp/ArrowDown 导航、Enter/点击选择后关闭；fuzzy 变体 = substring 优先、
    顺序字符 fuzzy 兜底。
  - `Menu` / `MenuItem` 最小真实弹层：addItem（链式 setTitle/setIcon/setDisabled/onClick）、
    addSeparator、showAtMouseEvent/showAtPosition（绝对定位 + 点击外部/Escape 关闭）、hide。
  - host require map 增加 `"path"` → 纯字符串 posix shim（join/dirname/basename/extname/
    normalize/relative/resolve/sep，posix/win32 自引用，无 node 依赖）。
- **启动语义对齐（CREATE-ON-LOAD）**：loader 在插件循环后对所有已索引文件回放 vault
  `create`（对齐官方"create is also called when the vault is first loaded"）；
  `Workspace.onLayoutReady` 回调在插件加载期间排队、回放之后统一 flush（即官方文档的
  回放豁免通道）。`metadataCache 'resolved'` 在初始索引已完成时于加载后补发一次。
- **加载报告进设置页**：每轮 load report（含 failed/skipped 的失败原因与 minAppVersion
  警告）通过 `obsidianLoadReport` Store 暴露，SettingsModal Obsidian 分组渲染失败条目
  （`data-testid="obsidian-plugin-error-<id>"`）与 minAppVersion 标注。

## R5 实现决策（2026-06-10）

- **moment 打包定案**：npm 依赖 `moment@2.30.1`，经 `moment/min/moment-with-locales`
  导入（138 locale 单实例；独立 locale 入口在 Vite 预打包下会注册到第二份副本——已踩坑）。
  套件实测两个 P0 插件**只用 `window.moment`**（零 import），loader 在求值任何插件前
  `window.moment ??= moment`、`window.app = ctx.app`（后者 calendar 30+ 处直读，缺失即
  TypeError——R5 评审 critical）。
- **registerView 挂载方案**：自定义视图挂**侧栏**（Obsidian 套件插件的真实用法），不进中央
  pane 树。core 侧新增通用 `SidebarPanelContribution` 贡献点（App shell 渲染左侧 ribbon
  按钮/右侧 tab + 元素宿主），compat 的 `SidebarViewLeaf` 实现完整 leaf 表面。同 type 二次
  挂载先 detach 旧 leaf（panel id 按 type 键控）；onOpen 抛错回滚拆除，不向插件冒泡。
- **官方全局原型扩展全集**落地（Array contains/remove/shuffle/unique、Object.isEmpty/each、
  Math.clamp/square、String.contains/format 等）——recent-files 的 redraw 在真实挂载后才
  暴露 `.contains()` 调用，证明"视图不挂载=调用面测不到"。
- `onUserEnable` 经 `PluginManager.enable(id, { userAction: true })`（设置页开关）触发。
- `editor-change` 逐事务化：core 新增 `document:changed` 事件（DocumentHandle 的
  updateListener 对本地事务 emit，CM6 在 listener 阶段已重置 update 锁，同步 dispatch 安全
  ——评审两条"必崩"finding 均被对抗验证以装包源码证伪）。

## R6 实现决策（2026-06-10）

- **EditorSuggest 触发管线**：core `document:changed`（逐本地事务）驱动，只对 active view；
  套件事实——nldates 的 onTrigger 锚点逐键增量建立（首键 "@" 落锚、后续 `context?.start`
  复用），manager 在重触发前**不清 context**；首个非 null onTrigger 胜出；async
  getSuggestions 走 stale-token（`closeActive` 无条件作废在途请求并清掉所有残留 context
  ——评审确认的 data-safety 修复）；popup 键盘捕获相先查 `suggest.scope._handlers`
  （nldates Shift+Enter）再内建导航，且带焦点守卫（target 不在编辑器+popup 内 → 关闭不消费）。
- **requestUrl 形状**：官方 RequestUrlResponsePromise（Promise + arrayBuffer/json/text 惰性
  Promise 属性）；`throw` 默认 true → 4xx/5xx reject；`data:` URL 层内解析（双端确定性
  fixture 路径）；桌面 Rust `http_request`（ureq 2、`#[tauri::command(async)]`、30s 超时、
  10MB 响应上限、method 白名单防 CRLF）；浏览器 fetch（受 CORS，契约口径）。
- **MarkdownRenderer**：阅读视图 markdown-it 管线提取到 `core/markdown.ts` 共享（分层合规：
  compat 只 import core）；wikilink 经宿主 metadata.resolveLink(sourcePath) 解析，内链点击
  → workspace.openFile；task checkbox 渲染 disabled；component.register 接管监听器拆除。
- **快捷键自定义**（Geode 原生功能，兼容面只受益）：`hotkeyFromEvent` 是捕获文法唯一权威
  （拒绝 Meta 组合/纯修饰/裸打印键，移位标点经 e.code 归一到物理基字符——与 matchHotkey
  的 PUNCT_CODES 口径一致，冲突检测才能同类比较）。

### 仍然显式保留的缺口（warn-stub / 行为偏差，按表追踪；R5/R6 已清项划线）

| 缺口 | 现状 |
|---|---|
| ~~`registerView` + 视图挂载~~ | **R5 已实现**：侧栏真实挂载（SidebarViewLeaf + core sidebar panel 宿主），onOpen/onClose 全生命周期；视图不持久化——重启后靠插件自身启动逻辑重建（calendar 的 layout-ready 路径实测可行，recent-files 走命令/onUserEnable） |
| ~~`moment`~~ | **R5 已实现**：moment-with-locales 2.30.1 单实例，`import { moment }` 与 `window.moment` 同源 |
| ~~`workspace.on('editor-change')`~~ | **R5 已修**：core `document:changed` 逐编辑事务驱动（pre-save，每 keystroke） |
| ~~`registerEditorSuggest` 触发~~ | **R6 已实现**：真实触发 + popup（nldates 自动建议桌面实测通过）。**R9 补齐**：~~setInstructions 指令条~~、~~纯光标移动不重评估~~。**R10 补齐**：~~popup 不随窗口 resize/scroll 重定位~~（rAF 合帧跟随，桌面实测 80px 精确跟随）。**EditorSuggest 偏差清零** |
| ~~`requestUrl`~~ | **R6 已实现**：桌面 Rust ureq（CORS-free，30s/10MB/method 白名单）；浏览器 fetch（**受 CORS**——浏览器端真实跨域请求会失败，契约口径）；`data:` URL 双端层内解析 |
| `getLeavesOfType("markdown")` 等内建类型 | 偏差：恒返回 `[]`（只跟踪 compat 自定义视图 leaf） |
| `WorkspaceLeaf.openFile` 的 openState | 仅映射 `mode: "source"|"preview"` → tab 模式；eState/group/active 忽略 |
| `vault.getConfig`（非公开 API） | 固定值：defaultViewMode→"source"、useMarkdownLinks→false，其余 undefined（每 key 记缺口） |
| `App.dragManager` / `App.internalPlugins` / `App.plugins` | warn-stub 形状（dragFile→null、getEnabledPluginById→null、plugins:{} 空字典）——recent-files 拖拽降级、daily-notes 探测返回"未启用" |
| `TFile.stat` | ctime/size 对既存文件恒为 0（Geode 树无 stats）；mtime 仅会话内跟踪本地 modify/create，加载时记一次缺口 |
| `App.fileManager` / `App.keymap` / `App.scope` | **R16：`fileManager.renameFile` 真实现**；**R22：`fileManager.processFrontMatter` 真实现**（core/properties 编辑引擎，逐 key diff 字节保留改写；opaque 条目不进 fm 对象且永不被改写、不可序列化值 TypeError reject、options/mtime 忽略——偏差见 ARCHITECTURE R22）；fileManager 其余方法仍为按访问记录缺口的 async no-op；keymap/scope 为惰性 no-op 对象 |
| `getFileCache().links` 缺 `[[#h]]` 条目 | 偏差（R16 记录）：同文链接不进 links 索引（官方含 `link: "#h"` 形态条目） |
| `DataAdapter.appendBinary`（及 readBinary/writeBinary/stat/trash*） | warn-stub + 说明性 throw；append/process/rmdir/copy 已用字符串 IO 真实实现 |
| DOM 增强 `onNodeInserted` / `onWindowMigrated` | warn-stub（单窗口宿主），返回 no-op destroyer |
| `Plugin.registerHoverLinkSource` / `hoverPopover`·`HoverParent` | **R25：`registerHoverLinkSource` 升真实无操作登记**（记录 source id 返回——Geode 全局悬停预览已覆盖插件渲染的 `a.internal-link`，无需插件参与）；插件自渲染预览 `hoverPopover`/`HoverParent` **仍为缺口**（插件被 Geode 全局 hover 被动覆盖，但其自挂 popover 不生效） |
| `app.internalPlugins`（书签 instance API） | **R27：书签数据文件 `.obsidian/bookmarks.json` 双向保真**（Geode 原生书签读写同一文件，未知键/类型 round-trip——见 ARCHITECTURE R27），但 `app.internalPlugins.getPluginById("bookmarks").instance`（`getBookmarks()`/`addItem()`/`removeItem()` 等程序化 API）**仍为缺口**（插件无法经 API 操作书签，只能间接经文件） |
| **R60 新登记 ↓（商业主轴 = 插件迁移，2026-06-14 全景调研 II code-verify）** | |
| `workspace.on('file-menu'/'editor-menu'/'files-menu')` 右键菜单钩子 | **缺**：Menu/MenuItem 基础设施已就绪（`compat/obsidian/ui.ts:506/583`），但宿主侧无 trigger（文件树/编辑器右键不发 `file-menu`/`editor-menu` 事件）。**生态高频**（无数插件靠它加右键项）；与原生 ㊿ 标签/文件右键菜单同根，宜一并接 |
| `Plugin.registerMarkdownPostProcessor` / `registerMarkdownCodeBlockProcessor` | **缺**：**生态影响最大单项**（Dataview / Tasks 等明星插件依赖）。需阅读侧 `core/markdown.ts` + 编辑侧 `liveBlockWidget`/`livePreview` 双线接 processor 管线，**工程大** |
| `Plugin.registerEditorExtension` | **缺**：可做——`cmExtensions.ts` 增设 compat compartment，`registerEditorExtension` reconfigure 追加插件的 CM6 扩展 |
| `app.commands`（executeCommandById / listCommands / commands） | **缺**：compat `App`（`plugin.ts:295-349`）仅 getter，无 `commands` 对象；跨插件触发/复用命令的事实标准，可在 core `commands` 上包一层 |
| `vault.readBinary` / `createBinary` / `modifyBinary` | **缺**：`compat/obsidian/vault.ts:223-310` 仅字符串 IO；Geode core 已有原生二进制读写（R11/R17 摄入），**导出即可**。图片/PDF/Excalidraw 类插件普遍用 |
| `MarkdownView.getMode/getViewData/setViewData/setMode` + `workspace.activeEditor` | **缺**：`compat/obsidian/workspace.ts:30-42` MarkdownView 无 mode/data 访问器；`activeEditor`（MarkdownFileInfo）零命中。模式探测/全文读写类插件用，新插件首选 `activeEditor` |
| `MetadataCache.getTags()` + `CachedMetadata.embeds/sections/listItems/frontmatterLinks` + `fileManager.generateMarkdownLink` | **缺/部分**：getTags（Geode 有 `getTagMap`，未导出 `Record<string,number>` 形态）+ getFileCache 形状余项（embeds 小、sections/listItems 大）+ generateMarkdownLink（高影响低成本，复用 linkRewrite + `metadata.fileToLinktext`） |
| `app.loadLocalStorage/saveLocalStorage/isDarkMode` + `MenuItem.setSubmenu` + `Editor` 完整版方法 | **缺/部分**：loadLocalStorage（per-vault UI 状态）/ isDarkMode；Menu 二级菜单（`ui.ts` MenuItem 无 setSubmenu）；Editor 余项（listSelections/setSelections/setLine/transaction/exec/wordAt/scrollTo/undo/redo——可直接映射 CM6，T1.5 子集扩展） |

## 验收方式（可度量，防自嗨）

1. **兼容套件**：选 5 个流行、开源、复杂度梯度分明的真实插件构成回归套件
   （建议起步：Recent Files、Word Count 类、Natural Language Dates、Paste URL into
   selection、Calendar——最后者覆盖 moment + 自定义 view，是 T2 的标杆）。
   每轮记录每个插件：加载✓/命令✓/设置页✓/核心功能✓/缺口列表。
2. **杀手演示**：`geode.exe <真实 Obsidian vault 路径>` → 已装插件出现在设置页并可启用。
3. 本文件维护「已实现 API ↔ 官方签名」对照表（实现后逐条追加），缺口显式列出而非沉默。

### 原生功能差距全景调研（2026-06-13，R31 末 · dev :1420 浏览器实测 + 源码核实 + 官方 obsidian.md 校准）

R25+ 候选池清空后的**纯调研轮（零代码、零 compat 改动）**：4 并行 explorer 全量盘点 Geode
editor / live 渲染 / 键盘命令 / feature 表面，WebFetch 官方 help.obsidian.md（→ obsidian.md/help）
建参照，dev server 实测 6 项核心交互行为。**完整缺口表 + 执行队列见 ROADMAP「R32+ 候选池」**
（21 项，按键盘/编辑交互优先分四梯队）。本条仅记运行时实测结论（写给后续轮，免重复发现）：

- **运行时确认缺口**：① **macOS Cmd 不通**——Ctrl+P 开命令面板、**Cmd+P 无反应**
  （`core/commands.ts:97/255/287` 三处拒 `metaKey`，Mod 写死=Ctrl）；② **格式化快捷键全缺**
  ——选 "Hello" 按 Ctrl+B 不加粗（无任何 toggleBold/wrap 命令）；③ **括号不自动配对**
  ——敲 `[` 得 `[` 不补 `]`（无 closeBrackets）；④ 编辑器内查找替换（Cmd/Ctrl-F）未接
  （`@codemirror/search` 仅 compat loader 引入）。
- **运行时纠偏（非缺口，勿重发现）**：列表续行 + 有序表自动重编号 + Tab 缩进 **均工作**
  ——来自 `markdown()` 内置 `markdownKeymap`（`cmExtensions.ts:314` 注释明示）；实测
  `- item`+Enter→`- item\n- `、`1. a`+Enter→`1. a\n2. `。静态 grep 查不到是因打包在
  `markdown().support` 内——**实际测试胜过静态扫描的样例**。
- **套件矩阵不回退**：本轮零代码、compat 调用面零改动，r31/r30/…/r24 全套不动；缺口表
  （插件 API 面）无变化。本调研针对的是**原生功能差距**（另一根轴），落 ROADMAP R32+ 候选池。

### 原生功能差距全景调研 II（2026-06-14，R60 · Workflow 14 域 fan-out + 147 项 code-verify · 零代码调研轮）

用户「再挖一轮 Geode vs Obsidian 差距，按文档格式补充」。本轮用 **Workflow 编排 14 个域 explorer** 全量盘点 Obsidian 功能面，**每条「缺口」断言再交对抗核查 agent 在 `src/` grep 证伪**（防 stale gap）。规模：**152 去重候选 → 147 code-verify → 131 确认真缺口（89 NEW）+ 3 项证伪**。完整执行队列见 **ROADMAP「第六梯队」㊵–㊿**；本节只记**写给后续轮的结论**（免重复发现）：

- **方法论价值 = 对抗核查抓住 stale gap**：本轮 3 项「缺口」经 code-verify **实为已完成**——㉖ 粘贴 URL 变链接（lang-markdown 内置 `pasteURLAsLink`，`cmExtensions.ts:400-408`）、㉚ Callout 未知类型 fallback（`markdown.ts:902-944` `data-callout`+类型名标题）、标签面板过滤（部分）。**连同历轮（Setext 样式/Setext-dim/`%%`），这是第三、第四次「候选池缺口实为已完成」**。教训坐实：**ROADMAP/候选池的「缺口」描述滞后于代码，动手前必 grep 现状**（写进了 CLAUDE.md/HANDOFF，本轮 Workflow 把它制度化成「survey→对抗 verify」两段）。
- **两根轴分流不变**：**原生功能差距**（㊵–㊿）落 ROADMAP 候选池；**插件 API 差距 = 商业主轴**落本文件「缺口表」R60 新登记 8 行（`file-menu`/`editor-menu` 右键钩子、`registerMarkdownPostProcessor`[Dataview 命脉]、`vault.readBinary`、`MarkdownView.getMode`、`app.commands`、`generateMarkdownLink` 等）。其中 `registerMarkdownPostProcessor` + `file-menu` 钩子是**插件迁移阻塞面最大**的两项，工程量也最大。
- **设置「重复」结论（用户提问）**：Templates/Daily/Unique 三区字段重复经 code-verify **忠实于 Obsidian**（三独立核心插件各一套设置，语义不同——位置指向不同文件夹、Templates 日期格式管变量 vs Daily 管文件名）→ **不应合并**；真实缺口仅是这些 setting-item 缺 `setting-desc` 说明文字（Obsidian 每项有澄清描述），归入 ㊶。
- **套件矩阵不回退**：本轮零代码、零 compat 调用面改动，r31/…/r57 全套不动；缺口表仅**新增** R60 8 行（未划任何旧行）。

### R63 套件回归（2026-06-14，macOS release 二进制 v0.60.0 实测 `r63-probe-vault`）

R63 = 多光标/多选 foundation（候选池第五梯队 ㉕，原生编辑器功能非 compat shim）+ ㉔ Smart typography 移除（非核心）。
㉔ **faithfulness 纠正**：WebSearch 证实弯引号/em-dash/省略号自动转换是 Obsidian **社区插件**（mgmeyers/obsidian-smart-typography），非核心 → 出队不做（与 `{{date+3d}}` 社区 Templater 同类）。
㉕ = buildEditorExtensions 加 4 个标准 CM6 扩展（`allowMultipleSelections`+`drawSelection`+`rectangularSelection`+`crosshairCursor`）解锁已有 keymap（Mod-Alt-↑/↓ 加光标、Esc 收起、Alt-drag 列选）。**零新依赖、无 Rust、纯 view/selection 配置**。Cmd+D 保留 daily-note（select-next 也是社区插件非核心）。
新增套件：`r63-e2e.mjs` **8/8**（drawSelection 渲染 3 光标 / addCursorBelow+Above / 多点同编 / Esc 收起）+ `r63-probe.mjs` **4/4**（真 WKWebView：allowMultipleSelections 持 2-range=2，control 无 facet=1）。
**对抗评审（Workflow 3 lens + verify）抓到 1 真数据安全回归→已修**：fmField Backspace 守卫只查 `selection.main`，多光标副光标可停在被保护首行正文起点删掉 frontmatter 闭合换行（INT-3 回归，本轮 foundation 引入）→ 改查所有 range（`ranges.some`）+ r63-e2e 锁。余 nit/behavioral（format/wrap 命令多光标下仅作用主选区=预存）。
- **套件矩阵不回退**：本轮零 compat 调用面改动，r31/…/r57 全 compat 套件不动；原生回归 r35[brackets]25/25 + r51[line-motion]10/10 + r34[find]15/15 + r55[live-tables]15/15（编辑器栈 + 块装饰 atomicRanges 全绿）。**OBSIDIAN-COMPAT 缺口表无变化**（R63 原生功能，不动插件 API 面）。

### R62 套件回归（2026-06-14，macOS release 二进制 v0.59.0 实测 `r62-probe-vault`）

R62 = 专用 Outgoing Links 出链面板（候选池第五梯队 ㉓，原生功能非 compat shim）。对照 Obsidian「Outgoing Links」核心插件（独立侧栏面板，与 Backlinks 分开）。
新增独立右栏 tab `features/outgoinglinks/`（镜像 OutlinePanel，复用 `metadata.getOutgoingLinks`，拆 Links/Unresolved 两分区 + `app:show-outgoing-links` 命令）；组合 BacklinksPanel 出链分区刻意保留（出链同显两处=deliberate，评审证伪）。纯只读 view，唯一写=点未解析链接 createAndOpen（数据安全证伪）。**零新依赖、无 Rust、compat 调用面零改动**。
新增套件：`r62-e2e.mjs` **14/14**（tab 开面板/resolved·unresolved 分区/计数/导航/命令/两种空态含真 no-active-file ol-empty）+ `r62-probe.mjs` **5/5**（真 WKWebView：setRightPanel 持久化 + 真 fs metadata getOutgoingLinks）。
**对抗评审（Workflow 4 lens + verify）：19 finding → 7 确认（全 nit/minor）+ 12 证伪**。确认修：别名显示 `alias||target`（对齐 Geode 约定）/ 自有 `outgoinglinks.*` i18n 键（self-containment）/ dict 头注释 / e2e 补 ol-empty / ARCHITECTURE Round 62 节。证伪：createAndOpen 数据安全（无穿越/覆盖/已 catch）、subpath 折叠（Obsidian 同款）、两栏冗余（deliberate）。
- **套件矩阵不回退**：本轮零 compat 调用面改动，r31/…/r57 全 compat 套件不动；原生回归 r30[allproperties]25/25 + r41[tags]21/21 面板切换全绿。**OBSIDIAN-COMPAT 缺口表无变化**（R62 原生功能，不动插件 API 面；惟 ㊷「反链/出链面板增强」的「出链独立面板」子项 = ㉓ 已由本轮交付）。

### R61 套件回归（2026-06-14，macOS release 二进制 v0.58.0 实测 `r61-probe-vault`）

R61 = 图片嵌入尺寸 `![[img.png|200]]` / `|200x100`（候选池第五梯队 ㉒，原生功能非 compat shim）。对照 Obsidian 图片尺寸语法（WebFetch obsidian.md/help/embeds 确认：`|宽`=等比、`|宽x高`=双维、小写 `x`、**仅图片**）。
共享 `parseEmbedSize`（reading+live 单一解析器，去漂移）→ `<img width height>`；导出 `export.ts` 零改动继承（hydrate 只设 src）；非数字别名仍当 alt（字节级 r26-bytes 不变）。**零新依赖、无 Rust、compat 调用面零改动**。
新增套件：`r61-e2e.mjs` **15/15**（阅读/live/导出继承/数据安全 doc 不变/边角含 cap）+ `r61-probe.mjs` **8/8**（真 WKWebView + 真 png）；字节级 `r26-bytes.mjs` **41 案 0 不变量违反**（重捕基线 + size 案翻 non-media 锁死）。
**对抗评审（Workflow 4 lens + verify）：1 根因确认修 + ~9 证伪**。确认（minor）：无上界 `Number()` → 巨数别名三端漂移（阅读/导出 `"1e+21"`/`"Infinity"` 无效 HTML→intrinsic；live `img.width` ToUint32→clamp）→ **修=正则封 5 位 `\d{1,5}`**（三端逐字节一致 by construction）。证伪：video/pdf 尺寸（Obsidian 仅图片）/ CSS 不加 height:auto（正确）/ 导出继承（安全）/ caption 当 alt（正确）。
- **套件矩阵不回退**：本轮零 compat 调用面改动，r31/…/r57 全 compat 套件不动；原生回归 r26[嵌入]/r57[live math] 全绿。**OBSIDIAN-COMPAT 缺口表无变化**（R61 是原生功能，不动插件 API 面）。

### R57 套件回归（2026-06-14，macOS release 二进制 v0.57.0 实测 `r57-probe-vault`）

R57 = Live preview 跨行 `$$` 数学（R32+ 候选池第四梯队 #⑱ live 渲染长尾）。对照 Obsidian Live Preview 渲染 `$$` display 数学。
① 抽共享 `liveHydratedWidget.ts` 的 `HydratedBlockWidget`（R56 mermaid 同款占位+异步 hydrate），重构 liveMermaid 复用；② `liveMath.ts`：`$$…$$` live 渲染为 KaTeX——lezer 无 `$$` 节点 → `findMathBlockRanges` 行扫描（镜像 markdown.ts 块规则）+ renderMarkdownToHtml self-check（slice 必须出 geode-math-block→渲染器为权威，检测零分歧）。纯 view 不改文档。
macOS probe 实测：新增 **r57-probe 9/9**——真实 WKWebView 上 `__geodeMath` 检测（findMathBlockRanges 含 single/inner-close/无闭合/inline 边角）+ 占位（renderMarkdownToHtml→geode-math-block）。
**r56/r55/r51/r52/r35/r33/r24/r29 套件不回退**（浏览器 r57-e2e **19/19**[7 纯检测 + 8 live widget 含**异步 KaTeX headless 真渲染**/揭示/源码不变 + 4 D1 缩进守卫] + r56 13[重构零回退]、r55 15 抽样实测全绿）。
**对抗评审 1 minor 修 / 11 维证伪**（重构等价、扫描=渲染器一致[18 输入实测]、slice-vs-context[仅 blockquote 安全方向]、data-safety 零修改无 XSS、R18 行染色与 R57 widget 干净分工）。D1=列表内缩进 `$$` 被 widget 化→opener 要求 indent===0 修。显式延期：`%%` 注释隐藏（#⑱ 收尾）；缩进/嵌套 math 显示源码。

### R56 套件回归（2026-06-14，macOS release 二进制 v0.56.0 实测 `r56-probe-vault`）

R56 = Live preview mermaid + 共享 block widget 抽取（R32+ 候选池第四梯队 #⑱ live 渲染长尾）。对照 Obsidian Live Preview 渲染 mermaid 图。
① 抽共享 `liveBlockWidget.ts`（R55 表格机制），重构 liveTables 复用；② `liveMermaid.ts`：```mermaid 围栏 live 渲染为图——`findMermaidRanges`（FencedCode CodeInfo 首词 mermaid，镜像 fence renderer）+ `MermaidWidget`（renderMarkdownToHtml 占位 + hydrateEmbeds 异步 SVG，复用 R19 管线含 mermaidBatchChain 全局串行）。纯 view 不改文档。
macOS probe 实测：新增 **r56-probe 7/7**——真实 WKWebView 上 `__geodeMermaid` 检测（findMermaidRanges 找 1 mermaid fence、js/大小写不匹配）+ 占位（renderMarkdownToHtml→.geode-mermaid）。
**r55/r51/r52/r35/r33/r24/r29 套件不回退**（浏览器 r56-e2e **13/13**[5 纯 + 8 live widget 含**异步 SVG headless 真渲染**/揭示/源码不变/无报错] + r55 15[重构零回退]、r51 10、r52 11 抽样实测全绿）。
**对抗评审 0 真缺陷 / 5 维全证伪**（重构等价、检测=渲染器判定一致[仅 HTML-实体 info 1 安全方向偏差]、**异步水合并发被 mermaidBatchChain 全局串行化**[实测 2 图无串色]、data-safety 零文档修改/无 XSS[复用 R19 strict DOMPurify]）。显式延期：跨行 `$$`·`%%`（复用 liveBlockWidget）；嵌套表格/mermaid live 渲染；theme 切换不重渲染。

### R55 套件回归（2026-06-14，macOS release 二进制 v0.55.0 实测 `r55-probe-vault`）

R55 = Live preview 表格（R32+ 候选池第四梯队 #⑱ live 渲染长尾）。对照 Obsidian Live Preview 把 GFM 管道表格渲染为真表格。
`features/editor/liveTables.ts`：StateField block-replace widget（复用阅读视图 `renderMarkdownToHtml`）+ atomicRanges，光标/点击进入揭示源码——**Geode 首个 cursor-aware block widget**（block 装饰必须经 StateField 非 ViewPlugin，否则 `RangeSet.spans` 崩溃）。纯 view 装饰不改文档。
macOS probe 实测：新增 **r55-probe 6/6**——真实 WKWebView 上 `__geodeTable` GFM 检测（findTableRanges 找 1 表）+ 渲染（renderMarkdownToHtml→`<table>`）+ 纯段落→无表。
**r54/r51/r52/r35/r33/r24/r29 套件不回退**（浏览器 r55-e2e **15/15**[4 纯 + 8 live widget 渲染/揭示/源码不变/无报错 + 3 nested-table guard] + r51 10、r52 11、r35 25 抽样实测全绿）。
**对抗评审 1 major + 2 minor 修 / data-safety 核心全证伪**（零文档修改、无编辑锁死、innerHTML 与阅读视图同信任模型[markdown-it html:false 转义]无 XSS 新面）。major=blockquote/list/缩进表格行中块装饰损坏→行首守卫降级显示源码。显式延期：内嵌表格 live 渲染；mermaid live / 跨行 `$$`·`%%`（复用本轮 block widget 范式）。

### R54 套件回归（2026-06-14，macOS release 二进制 v0.54.0 实测 `r54-probe-vault`）

R54 = Setext 标题折叠（R32+ 候选池第四梯队 #⑱ live 渲染长尾）。对照 Obsidian 对 Setext 标题（`text\n===`/`text\n---`）的折叠支持。
**纠过时判断**：Setext live 样式早已有（`syntaxHighlighting(mdHighlight)` 把 lezer heading1/2 tag 映射 `cm-md-h1/2`，覆盖 Setext）；真实缺口=折叠。本轮扩展 `folding.ts` foldService：
`headingLevel` 统一 ATX/Setext 层级，Setext 在文本行加折叠点（折隐藏下划线+section），ATX+Setext 互为 section 终止符。export `markdownFoldRange` + `__geodeFoldRange` 探针。**不碰 markdown.ts**（阅读视图 markdown-it lheading 已渲染）。
macOS probe 实测：新增 **r54-probe 8/8**——真实 WKWebView 上 `__geodeFoldRange` 纯几何（Setext H1→`{2,26}`、Setext H2→`{16,26}`、ATX→`{30,35}`、段落/下划线→null、多行 Setext 首行→`{5,16}`）。
**r29/r51/r52/r35/r33/r24 套件不回退**（浏览器 r54-e2e **11/11**[7 纯 fold-range + 4 live 折叠 editor:toggle-fold→`.cm-foldPlaceholder`] + r29 fold 持久化 19、r51 10、r52 11 抽样实测全绿）。
**对抗评审 0 真缺陷 / 全维证伪**（折叠几何 / `---`·`===`·frontmatter·fence 歧义 / 探针-live 解析树逐字节一致 / 分层）；顺带修「ATX section 折穿后续 Setext 同级标题」latent bug（纯 ATX 文档折叠逐行不变）。显式延期：Setext 下划线 dim 精修（需 cursor-aware 装饰）；live 表格 / 跨行 `$$`·`%%` / mermaid live（需块级 StateField）。

### R53 套件回归（2026-06-14，macOS release 二进制 v0.53.0 实测 `r53-probe-vault`）

R53 = Unique note creator 唯一笔记创建器（R32+ 候选池第四梯队 #㉑）。对照 Obsidian「Unique note creator」核心插件。
`core/uniqueNote.ts`（镜像 dailyNote R48）+ `plugins/unique-note.ts`（`unique-note:create` 命令，无默认键）：一条命令建一篇时间戳命名（Zettelkasten id，默认 `YYYYMMDDHHmmss`）的新笔记，
放可配置文件夹（默认 vault root）、可选模板、建后打开。`createUniqueNote` collision-retry 循环防同 tick 双触发只建一篇。SettingsModal 3 字段 + `__geodeUnique` 探针 + i18n。
macOS probe 实测：新增 **r53-probe 6/6**——真实 WKWebView 上 `__geodeUnique` 纯名/路径生成（name→`20260614090807`、root path、`Zettel/` 文件夹、traversal `../evil`→root 拒）。
**r52/r48/r50/r44/r24 套件不回退**（浏览器 r53-e2e **11/11**[5 纯变换 + 5 live create 含同 tick 竞态 + 1 设置 UI] + r48 13、r50 15、r44 25、r24 12 抽样实测全绿）。
**对抗评审 1 真缺陷（minor）修 / 11 证伪**：同 tick 双触发原只建一篇（create_new 拒后静默打开第一篇）→ collision-retry 拿 `X 1.md` + 补 Promise.all 竞态回归断言。data-safety：路径穿越被 assertSafeRelPath(JS)+Rust safe_join+create_new 三层拦死，防覆盖原子性可靠。显式延期：#⑧ stacked tabs（真版=内容级 cascade，需多 EditorPane，专门大轮）；format 含 "/"→子目录、非法字符→优雅降级（已知偏差）。

### R52 套件回归（2026-06-14，macOS release 二进制 v0.52.0 实测 `r52-probe-vault`）

R52 = 编辑命令补全 II（toggle-comment / indent / unindent / insert-blank-line / select-line，R32+ 候选池第四梯队 #⑳余项）。对照 Obsidian 的 toggle-comment / Indent / Unindent 命令。
`features/editor/editorEditCommands.ts` 把 `@codemirror/commands` 的 5 个 StateCommand 暴露成命名、palette 可发现、可重绑的命令。**headline = toggle-comment（Mod+/）产出 Obsidian `%%…%%` 注释**——
markdown 自身无 commentTokens，cmExtensions 加 `markdownLanguage.data.of({ commentTokens: { block: { open: "%%", close: "%%" } } })` → toggleComment 落 block 路径包/解 `%%`。`deleteLine` 排除（Command 类需真实 view）。
macOS probe 实测：新增 **r52-probe 6/6**——真实 WKWebView 上 `__geodeEdit` 纯变换（toggle-comment→`%% hello %%`、uncomment→`hello`、indent→2 空格、select-line→`2,4`）。
**r51/r35/r33/r40/r24 套件不回退**（浏览器 r52-e2e **11/11**[7 纯变换 + 3 live 命令 + 1 真实 `Meta+/` 键击路由] + r51 10、r35 25、r33 37、r40 19、r24 12 抽样实测全绿）。
**对抗评审 0 真缺陷 / 5 维全证伪**（Mod+/ 冲突 / %% 数据安全 / 类型探针 / 边角 / 分层 i18n）；一条 open===close=`%%` toggle 固有歧义备注（贴近 Obsidian、可逆，by-design 非缺陷）。显式延期：deleteLine 等 Command 类命令、其它长尾 CM 编辑命令未接（按需逐个）。

### R51 套件回归（2026-06-14，macOS release 二进制 v0.51.0 实测 `r51-probe-vault`）

R51 = 移动行 / 复制行编辑命令（Line motion，R32+ 候选池第四梯队 #⑳）。对照 Obsidian 的 `editor:move-line-up`/`-down` 命令。
`features/editor/editorMotionCommands.ts` 把 `@codemirror/commands` 的 `moveLineUp`/`moveLineDown`/`copyLineUp`/`copyLineDown` 暴露成命名、
palette 可发现、可重绑的命令。键 move=`Alt+ArrowUp/Down`、copy=`Shift+Alt+ArrowUp/Down`（CM defaultKeymap 已绑的通用约定 → 本轮价值 = 命名化）。
macOS probe 实测：新增 **r51-probe 6/6**——真实 WKWebView 上 `__geodeMotion` 纯变换（moveUp→`b\na\nc`、moveDown→`a\nc\nb`、copyUp→`a\nb\nb\nc`、首行 no-op）。
**r50/r49/…/r33/r40/r24 套件不回退**（浏览器 r51-e2e **10/10**[6 纯变换 + 3 live 命令 + 1 真实 `Alt+ArrowUp` 键击路由] + r33 37、r40 19、r24 12 抽样实测全绿）。
**对抗评审 0 真缺陷 / 4 维全证伪**（热键冲突/StateCommand 类型/边角数据安全/分层 i18n）；主动处理评审点名 1 项（键位由 `Mod+Shift+Arrow` 改 `Alt+Arrow` 对齐约定 + 消 macOS 原生 `Cmd+Shift+↑` 遮蔽 + 补真实键击断言）。显式延期：`insertBlankLine`/`toggleComment` 等其它 CM 编辑命令未接（按需逐个）。

### R50 套件回归（2026-06-14，macOS release 二进制 v0.50.0 实测 `r50-probe-vault`）

R50 = 可读行宽 + 拼写检查 + 应用级缩放（Appearance，R32+ 候选池第四梯队 #⑲）。对照 Obsidian Appearance「Readable line length」/
Spellcheck / 缩放。`core/appearance.ts`（localStorage Store）。Readable = 正文 `max-width` 改 `var(--readable-line-width, 46em)`（4 处:
`.cm-content`/`.preview-content`/`.editor-loading`/reading-view properties-panel），setter 切 documentElement var。Spellcheck = CM
contentDOM 属性反应式。Zoom = 既有 `setFontSize`。**默认保持现状**（readable ON / spellcheck OFF——故对既有用户零行为变化）。macOS probe
实测：新增 **r50-probe 6/6**——真实 WKWebView 上 `__geodeAppearance.setReadable` → `--readable-line-width` var 跟随（default→none→default）。
**r49/r48/…/r24/r25/r33 套件不回退**（浏览器 r50-e2e **15/15** + r33 37、r24 12、r25 17、r49 12 抽样实测全绿；`r26-bytes` 0）。
**2 维对抗评审 2 finding → 1 确认（minor，去重）修**（阅读视图 `.editor-preview > .properties-panel` 硬编码 46em 漏跟随 readable-line
开关→改同源 `var(--readable-line-width, 46em)` + 补 E2E 断言）。显式延期：行宽数值可调 / UI chrome 缩放 / spellcheck 默认 ON。

### R49 套件回归（2026-06-14，macOS release 二进制 v0.49.0 实测 `r49-probe-vault`）

R49 = 文件恢复快照（File recovery snapshots，R32+ 候选池第三梯队 #⑪ 另一半 → **#⑪ 完成**）。对照 Obsidian **File recovery**：周期保存
笔记内容快照、浏览/还原。**数据安全相关轮**。存储 = 每 note 单 JSON `.obsidian/snapshots/<encodeURIComponent(path)>.json`（复用
`vault.adapter.writeConfig`，配置写不触发 tree 刷新；非 Obsidian 的 IndexedDB——schema 不互通,Geode 自有恢复存储）。`file:modified`
hook（throttle 60s）→ 串行 RMW append + prune 25。RecoveryModal（浏览/预览/还原）+ `editor:file-recovery` 命令。macOS probe 实测：
新增 **r49-probe 9/9**——含 **on-disk 数据安全终态**：`__geodeSnapshots.record/restore` → Node 直读 `<vault>/.obsidian/snapshots/` 确认快照
落盘、restore 写回 OLD 内容、**restore 前 CURRENT 被快照（never lost）**。**r48/r47/…/r24/r27/r43/r45 套件不回退**（浏览器 r49-e2e
**12/12** + r24 12、r43 22、r27 22、r45 10、r47 11 抽样实测全绿；`r26-bytes` 0）。**3 维对抗评审（数据安全重点）9 finding → 7 确认
（2 major + 5 minor）逐条修 + 2 证伪**（① 坏 JSON→record 空 list 覆盖丢历史→**写路径 STRICT-parse 拒覆盖**[R45/R27「坏 JSON 拒写」契约
一致] ② restore 前不 flush→脏 buffer 覆盖丢未保存编辑→**flushAll**[R47 parity] ③ enqueue 静默吞错→guarded+warn ④ lastSnapTs 写失败毒化节流→
绑成功置位 ⑤ vault 切换不清 lastSnapTs ⑥ modal restore 无 .catch ⑦ revision bump 偷换 sel；证伪：并发 restore append-only 无丢、ts 碰撞）。
显式延期：周期定时器 / rename 迁移快照 key / 系统回收站[trash crate 待拍板] / 大库存储优化。

### R48 套件回归（2026-06-14，macOS release 二进制 v0.48.0 实测 `r48-probe-vault`）

R48 = 可配置日记设置（Configurable daily notes，R32+ 候选池第三梯队 #⑫ 另一半 → **#⑫ 完成**）。对照 Obsidian **Daily notes** 设置：
日期格式（moment token）/ 新文件位置 / 模板文件。compat：设置存 localStorage（Geode 偏好，非 `.obsidian/daily-notes.json` —— Obsidian
schema 桥接是 #⑭ 余项）。`core/dailyNote.ts` 改 moment-based（`dailyStamp = moment.format(effFormat)` + `parseDailyStamp` moment STRICT
parse），**完整保 R43 over-match 守卫**。macOS probe 实测：新增 **r48-probe 9/9**——真实 WKWebView 上 `__geodeDaily.setFormat/setFolder`
→ stamp/path/parse 跟随（默认 → DD-MM-YYYY → Journal 文件夹 → reset）。**r47/r43/…/r23/r28/r42 套件不回退**（浏览器 r48-e2e **13/13** +
r43-e2e 22、r43-probe 13、r23 22、r28 23、r42 17 抽样实测全绿——**moment 改写不破 R43、createFolder 守卫不破既有**；`r26-bytes` 0）。
**3 维对抗评审 9 finding → 6 确认（1 major + 5 minor）→ 修 2 + 3 已知偏差 + 3 证伪**（修：effFolder 只 trim 未 strip 斜杠→双斜杠路径→
strip+validateDir；`Vault.createFolder` 缺 assertSafeRelPath[R46 同根因漏补]→加守卫。延期 minor：无日粒度格式→文件名碰撞[校验+样例预览余项]、
FS 非法字符→Windows create 静默失败[sanitize 余项]、daily-note 插件描述硬编码。证伪：模板自引用循环、locale-token 跨会话[非 R48 引入]）。
显式延期：月历周一起 / 格式校验预览 / format 子文件夹支持 / `.obsidian/daily-notes.json` schema 桥接（#⑭）。

### R47 套件回归（2026-06-14，macOS release 二进制 v0.47.0 实测 `r47-probe-vault`）

R47 = 笔记合并（Note composer merge，R32+ 候选池第三梯队 #⑬ 另一半 → **#⑬ 完成**）。对照 Obsidian 核心插件 **Note Composer** 的
「Merge current file with another file」：当前笔记追加进目标 + 指向当前笔记的链接全改指目标 + 删当前笔记（入 `.trash`）。**数据安全关键轮**。
`linkRewrite.ts` 加 `{move}` 选项复用 R16 verified rewrite（不移动文件）+ `core/noteMerge.ts mergeNotes`（append-before-trash 无损 +
live-buffer 读防 flush 失败丢编辑 + `vault.trash` 可恢复删）+ QuickSwitcher merge 模式 + `editor:merge-file` 命令。macOS probe 实测：
新增 **r47-probe 7/7**——含 **on-disk 数据安全终态**：`__geodeMerge.merge()` → Node 直读磁盘确认 target 含两者内容、source 物理移到
`.trash/`（内容保留、可恢复）、referrer `[[source]]` → `[[target]]`（无悬空链）。**r46/r45/…/r24/r28/r42/r44 套件不回退**（浏览器
r47-e2e **11/11** + r28 23、r24 12、r44 25、r42 17 抽样实测全绿——**frozen R16 引擎 `{move}` refactor 不破 rename 路径**；`r26-bytes` 0）。
**3 维对抗评审（数据安全 + frozen 引擎重点）12 finding → 4 确认（全 major）逐条修 + 8 证伪**（① merge 丢弃 `result.skipped`→悬空链无告警→
consume+notice ② promise 链无 `.catch`→静默失败→catch+notice ③ `flushAll` 失败读旧磁盘→丢未保存编辑→live-buffer 读 ④ merge-file 命令
switcher 已开→`mergeTargetMode` 泄漏→守卫；**证伪**：脏 target buffer 覆盖、modify/trash 不入队[minor]、不剥源 frontmatter[Obsidian 同款]）。
显式延期：merge 拆分（split，Obsidian 无独立命令）/ 确认对话框 / extract 自动导航 / embed 命令。

### R46 套件回归（2026-06-14，macOS release 二进制 v0.46.0 实测 `r46-probe-vault`）

R46 = `obsidian://` URI 深链（零依赖 in-app 切片，R32+ 候选池第三梯队 #⑮）。对照 Obsidian URI scheme `obsidian://open|new|search`。
**本轮做 in-app 部分**：`core/obsidianUri.ts` 纯解析器 + `obsidianUriHandler` 执行器 + 笔记内 `obsidian://` 链接点击在 Geode 内路由。
**🛑 OS 级 deep-link（点 Geode 外的 obsidian:// 唤起 app）延后**——需 `tauri-plugin-deep-link` 新 crate = 硬边界#5，待用户拍板（Cargo.toml
现仅 dialog/updater/process）。compat `Plugin.registerObsidianProtocolHandler` 仍 gap-stub（内置 in-app 处理非插件路由）。macOS probe
实测：新增 **r46-probe 9/9**——含 **on-disk 核心**：`__geodeUri.handle("obsidian://new?...")` → Node 直读 `<vault>/ProbeNew.md`
确认内容落盘。**r45/r44/…/r24/r25/r28/r33 套件不回退**（浏览器 r46-e2e **18/18** + r44 25、r43 22、r28 23、r24 12、r25 17、r33 37、r45 10
抽样实测全绿；`r26-bytes` 0）。**3 维对抗评审（安全重点）12 finding → 5 确认（全 minor）逐条修 + 7 证伪**——**安全攻击面全证伪**：路径穿越被
Rust `safe_join` 拒、EditorPane obsidian:// 分支置于通用 preventDefault 前**强化** R19 SEC-1、`/^obsidian:/i` gate 与 `url.protocol` 口径一致且
不一致项落安全侧、`open` 穿越经 openWikilink 被 basename 中和、`search` query 复用已硬化搜索管线。确认修复（全 robustness）：① `obsidian://open`
对不存在文件经 openWikilink 静默建笔记→`resolveLink` gate ② Memory `createFile` 无路径守卫（双端分歧）→core `Vault.create` 加 `assertSafeRelPath`
③ `new` 文件名控制符→同守卫 ④ create 失败仍 openFile 幽灵 tab→`fileExists` 守卫 ⑤ `??` 遮蔽空 `file=`→`||`。显式延期：OS scheme 注册（待拍板）/
CM live preview 点击 hook / 跨库 vault 路由 / plugin protocol 接通。

### R45 套件回归（2026-06-14，macOS release 二进制 v0.45.0 实测 `r45-probe-vault`）

R45 = 保存的工作区布局（Workspaces，R32+ 候选池第三梯队 #⑭）。对照 Obsidian 核心插件 **Workspaces**：命名保存/切换整个面板布局，
存到 `<vault>/.obsidian/workspaces.json`。**compat 状态:path-compatible / schema-divergent**——文件落在 Obsidian 同路径、`workspaces`
键下，但 per-workspace 布局**值是 Geode pane-tree 形状**（非 Obsidian 布局 schema）。**非破坏性**:RMW `root={...parsed}` 保留 `active`
等 top-level key + Obsidian 原 workspace entry（init 读入 store→persist 全量写回）；Geode 载入 Obsidian 原 entry → `sanitizeState`
优雅回落默认（不崩）。`core/workspaces.ts` 镜像 R27 bookmarks 持久化（裸 `"workspaces.json"`——adapter 已相对 `.obsidian/` 解析）。
macOS probe 实测：新增 **r45-probe 6/6**——含 **on-disk 核心**：`__geodeWorkspaces.save("probe-ws")` → Node 直读
`<vault>/.obsidian/workspaces.json` 确认 `workspaces["probe-ws"].root` pane 树落盘。**r44/r43/…/r24/r27/r36/r37/r39 套件不回退**
（浏览器 r45-e2e **10/10** + r37 36、r39 17、r36 47、r43 22、r27 22 抽样实测全绿；`r26-bytes` 0）。**3 维对抗评审 10 finding → 6 确认
（1 major + 5 minor，含 1 doc）逐条修 + 4 证伪**（① captureLayout 误存 theme/fontSize→delete+applyLayout 保留当前外观 ② applyLayout
不 reconcile→pruneTabHistory+emitActiveFile ③ session 历史残留[同②] ④ enqueue 缺 try/catch+warn→拒写静默→补日志 ⑤ init 失败+persist
读成功抹盘 Obsidian entry→空-store 守卫 ⑥ WORKSPACES_CONFIG 契约字面量回写；**证伪**:applyLayout 不 flush[EditorPane unmount 已 flush]、
Modal load null→sanitizeState 回落默认、void persist unhandled[已加日志]）。显式延期：Obsidian 工作区 schema 桥接 / 切换快捷键 / `active` 跟随。

### R44 套件回归（2026-06-14，macOS release 二进制 v0.44.0 实测 `r44-probe-vault`）

R44 = Note composer 提取选区→新笔记（R32+ 候选池第三梯队 #⑬ extract 切片；compat 面无改动——纯新增 core/feature/command）。
对照 Obsidian 核心插件 **Note Composer** 的「Extract current selection」：选区→建新笔记+把选区替换为 `[[link]]`（**合并 merge 延后**=
#⑬ 另一半）。新 `core/noteComposer.ts`（纯函数,sanitizeNoteName 一类同守文件名+wikilink）+ `editor:extract-selection` 命令
（**create-before-edit** 数据安全不变式 + await 后乐观锁守卫）。macOS probe 实测：新增 **r44-probe 17/17**（真实 WKWebView 上
`__geodeComposer` 纯函数 + 对抗输入:空/全空白/CJK/非法字符/裸 `#`/`". ."` 塌点/控制符/超长截断）。**r43/r42/…/r24/r28/r31 套件
不回退**（浏览器 r44-e2e **25/25** + r43-e2e 22、r40-e2e 19、r33-e2e 37、r42-probe 10 抽样实测全绿;`r26-bytes` 0）。
**3 维对抗评审 13 finding → 5 确认（2 major + 3 minor,去重）逐条修 + 8 by-design/证伪**（① async create 后旧 offset dispatch
错删/RangeError→乐观锁文本指纹守卫[R16/R23 同根] ② `sanitizeNoteName` `". ."`塌成`"."`坏名→去首尾点 ③ C0 控制符泄漏→`\p{Cc}`
④ 名无长度上限 ENAMETOOLONG→UTF-8 边界裁 ≤200 字节 ⑤ 纯空白选区建空笔记→trim 守卫;证伪:链接 basename 歧义[Obsidian 同款]、
多选区取 main[与 formatCommands 一致]、getActiveView 双侧门控正确、parentPath/uniquePath 正确）。显式延期：合并 merge / extract
自动导航 / embed 模式命令 / 可配置新笔记位置。

### R43 套件回归（2026-06-14，macOS release 二进制 v0.43.0 实测 `r43-probe-vault`）

R43 = 日记日历 + 前/后一日导航（R32+ 候选池第三梯队 #⑫ 日历切片；compat 面无改动——纯新增 core/feature/plugin）。新
`core/dailyNote.ts`（纯函数 + `openOrCreateDailyNote`）+ `features/calendar/CalendarPanel`（右栏自绘月历，对照 Obsidian 官方
Calendar 插件：月格 + today 高亮 + 有笔记标记 + 点日开/建 + 上/下月）+ daily-note 插件 `next-day`/`prev-day`（`isDailyNotePath`
门控）。**这是 Geode 自家日历**（与 R5/R6 compat 矩阵里挂载的第三方 `calendar 1.5.10` 插件并存，互不冲突；第三方插件点日仍依赖
daily-notes 内部插件探测）。**评审顺手硬化 `vault_create` TOCTOU**（`create_new` 原子，补 R17 漏网命令）。macOS probe 实测：新增
**r43-probe 13/13**（真实 WKWebView 上 `__geodeDaily` 纯 helpers：stamp/path/parse[含 basename over-match 守卫]/gridDims）。
**r42/r41/…/r24/r28/r31 套件不回退**（浏览器 r43-e2e **22/22** + r42-probe 10、r41-e2e 21 抽样实测全绿；`r26-bytes` 0）。
**3 维对抗评审 9 finding → 8 确认（全 minor）逐条修 + 1 证伪**（parseDailyStamp 整 path over-match→basename 锚定 / 子文件夹
日记导航逃逸→isDailyNotePath 双门控 / `vault_create` TOCTOU 截断→`create_new` 原子+rollback / create 失败竞态仍 open / 月名星期
locale 走 i18n Store / aria-label 走 t() / monthLabel useMemo；证伪：`key=toISOString()`/UTC 边界/分层/颜色/tree 反应式无缺陷）。
显式延期：可配置日记设置 UI（格式/文件夹/模板）= #⑫ 另一半；月历周一起；create 真失败仅 console.error（core 无 toast infra）。

### R42 套件回归（2026-06-14，macOS release 二进制 v0.42.0 实测 `r42-probe-vault`）

R42 = 回收站 本地 `.trash/`（数据安全关键轮；已核实缺口：删除=永久、compat `trash*` 仅 stub）。**compat trash gap 部分关闭**
（`trashLocal`/`Vault.trash(local)` → core `vault.trash` 真本地回收站；`trashSystem` 仍 false[系统回收站不做]）。Rust 加
`vault_trash`/`vault_list_trash`（仅 `std::fs`，**零新 crate**）；vault.ts adapter.trash/listTrash（含 binaryFiles）+ Memory
listTree skip `.` 前缀 + Vault.trash/listTrash/restoreFromTrash。**修永久删=丢数据底线**：删除移到 `.trash/`（可恢复）。macOS
probe 实测：新增 **r42-probe 10/10**——含**真 fs 数据安全核心**：删除文件物理移到 `<vault>/.trash/`（Node 直读磁盘确认）、内容字节
保留、restore 回原位（绝不永久丢）。**r41/r40/…/r24/r28/r31 套件不回退**（浏览器 r42-e2e **17/17** + r41 21、r40 19、r39 17、
r38 19、r37 36、r36 47、r35 25、r34 15、r33 37、r32 24、r31 21、r28 23、r24 12 全绿；`r26-bytes` 0）。**3 维对抗评审 18 finding →
5 修复**（3 major：MemoryVaultAdapter.trash 漏 binaryFiles[浏览器删图片静默失败] / 文件夹 trash 漏 binaryFiles 子项[孤儿复活] /
restoreFromTrash 恢复文件夹不重索引子项[改 emit file:renamed→reindexFolder]；2 defensive：vault_trash 空路径守卫 / trash 前
flushAll 无损）**+ 13 nit/by-design/证伪**（trash flatten 丢原路径=Obsidian 同 / TOCTOU 覆盖已删数据 / to_string_lossy 非 UTF8 /
失败场景全 fail-safe）。

### R41 套件回归（2026-06-14，macOS release 二进制 v0.41.0 实测 `r41-probe-vault`）

R41 = 标签面板 + 编辑器 `#` 标签补全（已核实缺口：getTagMap 无面板消费、无 `#` 补全源）。**compat API 表面零代码改动**
——新 `features/tags/TagsPanel`（右栏，镜像 R30 allproperties，消费 getTagMap，点击 `requestSearch`）+ `features/editor/
tagCompletion.ts`（`#` 补全源镜像 R31 slashCommands → cmExtensions override 三源 + `__geodeTag` 探针）+ `core/workspace.ts`
新增 consume-once `searchRequest` Store + `requestSearch`（程序化搜索注入，SearchPanel 消费）+ metadata 加 getTagMap revision
缓存 + frontmatter 退化标签过滤。**零新依赖**。macOS probe 实测：新增 **r41-probe 11/11**——桌面驱动纯补全逻辑（trigger/
candidates，真 metadata 索引）+ searchRequest store 真值（SearchPanel 后台不挂载 → store 保持设值）；live `#` 弹窗+accept +
标签面板点击 = React 路径交浏览器 r41-e2e。**r40/r39/…/r24/r31 套件不回退**（compat 调用面零改动；浏览器 r41-e2e **21/21** +
r40 19、r39 17、r38 19、r37 36、r36 47、r35 25、r34 15、r33 37、r32 24、r31 21、r24 12 全绿；`r26-bytes` 0 违例）。**3 维对抗
评审 19 finding → 3 确认修复**（getTagMap 加 revision 缓存防 `#` 补全每键全库重建 / 退化 frontmatter 标签 `["#","bad space"]`
索引层过滤防泄漏进面板+补全 / `(#tag` 补全 gate 对齐 metadata `(^|[\s(])`）**+ 16 nit/by-design/证伪**（三补全源对重叠输入
互斥 / CJK 仅 BMP 三正则同步 / 标签计数=文件数同 SearchPanel / code 内弹补全为三源共有 gap）。

### R40 套件回归（2026-06-14，macOS release 二进制 v0.40.0 实测 `r40-probe-vault`）

R40 = 键盘切换复选框（Toggle checkbox status, Cmd/Ctrl-L；已核实缺口：仅鼠标点复选框、无键命令）。**compat API 表面
零代码改动**——整套复用 R33 format 基建：`core/format.ts` 加纯 op `toggle-task` + `toggleTaskStatus`，经既有 `applyFormatOp`
接通 → 既有 `__geodeFormat.apply` 探针**自动可驱动（零新探针）**；`formatCommands.ts` 注册 `editor:toggle-checkbox`（`Mod+L`）
走既有 applyFormat→CM 事务→documents dirty→autosave（活动文件门控 R23 DS-1）+ R33 `Prec.highest` keydown 拦截器。**零新 vault
写路径 / 零新依赖 / 零新文件**。校准 Obsidian「Toggle checkbox status」。macOS probe 实测：新增 **r40-probe 11/11**——桌面在
真二进制驱动纯 `toggle-task` 变换（任务翻转 / 自定义态 `[/]`→`[x]` / 非任务转换 / 多行）；live 真 Mod+L 键入（CM view）交浏览器
r40-e2e。**r39/r38/…/r23 套件不回退**（compat 调用面零改动；浏览器 r40-e2e **19/19** + r39 17、r38 19、r37 36、r36 47、r35 25、
r34 15、r33 37、r32 24 全绿；`r26-bytes` 0 违例，markdown.ts 未动）。**3 维对抗评审 10 finding → 1 确认修复（3 reviewer 一致）**：
自定义复选框态 `[/]`/`[-]`/`[>]` 被当非任务 → prepend 畸形双方框（`- [ ] [/] x`，无效 + 非幂等）→ `TASK_BOX_RE` 状态类
`[ xX]`→`[^\]]`（任意单字符态就地翻转、不误伤多字符 `[text]`）+ 翻转规则「checked→空 / 其余→x」（E2E + probe 补自定义态断言）
**+ 9 nit/by-design/证伪**（`- [ ]task` 无空格 toggle 但不渲染=三处任务定义未收敛记 gap / 全空多行 select-all 塌缩=极端边角 /
blockquote 内任务不识别 / `default:never` 穷尽断言补 / 与 R33 `checklist` op 独立不串扰）。

### R39 套件回归（2026-06-14，macOS release 二进制 v0.39.0 实测 `r39-probe-vault`）

R39 = 固定标签页（#⑧ 的 pinned 切片；stack/linked 延后）。**compat API 表面零代码改动**——`core/types.ts`（`TabState.pinned`）
+ `core/workspace.ts`（openFile/recordNavigation 加 `!active.pinned`、`toggleTabPin`、sanitizeTab、split 剔除/reopen 恢复 pin）
+ `app/App.tsx`（`app:toggle-pin` 命令 + TabBar 双击 + pin 图标）+ icons/i18n/css。校准 Obsidian「Pin」语义 + 双击手势。
**零新 window 探针**——pin 是 store 操作,探针/E2E 直驱 `app.workspace`。macOS probe 实测:新增 **r39-probe 8/8**——桌面直驱
真 store（toggleTabPin + openFile-respects-pin 固定活动 tab → 新 tab 不替换 + recordNav skip + 未固定仍替换）;命令/双击/持久化
= React/reload 路径,交浏览器 r39-e2e。**r38/r37/…/r23 套件不回退**（compat 调用面零改动；浏览器 r39-e2e **17/17** + r38 19、
r37 36、r36 47、r35 25、r34 15、r33 37、r32 24 全绿；`r26-bytes` 0 违例,markdown.ts 未动）。**3 维对抗评审 9 finding → 3 确认
修复**（split 副本继承 pin → dup 剔除;`.tab.is-pinned` CSS 缺失 → 补「固定 tab 关闭 X 淡显」;reopen 关闭的固定 tab 丢 pin →
`ClosedTab.pinned` 捕获+恢复）**+ 6 nit/by-design/证伪**（graph 可固定=Obsidian 允许记偏差 / sanitizeTab `===true` 等价 /
双击 draggable 真实 Chromium 照常 fire dblclick=Playwright 合成限制 E2E 用 dispatchEvent / openFile 守卫非回退 / 固定 tab 自身
back-forward 可移离=已记偏差）。openf 维 **0 finding**（openFile×pin 核心交互契约先行零缺陷,缺陷全在实例克隆/class hook/reopen 边角）。

### R38 套件回归（2026-06-14，macOS release 二进制 v0.38.0 实测 `r38-probe-vault`）

R38 = 快速切换器子模式（已核实缺口：QuickSwitcher 仅文件名+别名+create，无 heading/block 模式）。**compat API 表面零代码
改动**——新增 `core/switcherSearch.ts`（纯函数 `#`全库标题/`^`全库块搜索，复用 `metadata.getAll()` + `core/fuzzy`）+
QuickSwitcher.tsx（模式解析 + render + `openFile`/`requestReveal` 跳转）+ `main.tsx` `__geodeSwitcher` 探针 + i18n/css。
校准 Quick Switcher++ standalone（`#`/`^`）。**按 R33 模式抽纯函数到 core** → 组件/E2E/探针单一真值。macOS probe 实测:
新增 **r38-probe 13/13**——桌面在**真 metadata 索引**驱动纯 `#`/`^` 搜索（mode 解析 + 标题/块命中 + browse）+ `openFile`/
`requestReveal` 导航真值;活模态（真实键入 `#` 的 React 组件）= live-view 路径,交浏览器 r38-e2e。**r37/r36/…/r23 套件
不回退**（compat 调用面零改动；浏览器 r38-e2e **19/19** + r37 36、r36 47、r35 25、r34 15、r33 37、r32 24 全绿；`r26-bytes` 0
违例,markdown.ts 未动）。**3 维对抗评审 9 finding → 2 确认修复**（block 行 React key 同段两 `^id` 撞键 → 改用 `block.id`
[E2E 补「同段两块无重复 key 警告」断言];`headingSpan.to` 不准且全仓无消费者读 `reveal.to` → 移除 helper、heading reveal
锚 `from`）**+ 7 nit/by-design**（同分非确定序=getAll 既有属性 / 非空搜索不 boost 活动文件=合契约 / CSS 类名 As-built 对齐）。

### R37 套件回归（2026-06-14，macOS release 二进制 v0.37.0 实测 `r37-probe-vault`）

R37 = 前进/后退导航历史（已核实缺口：`workspace.ts` 仅 `lastActiveFile`、无 per-tab 导航栈）。**compat API 表面零代码
改动**——全在 `core/workspace.ts`（per-tab `tabHistory` Map + recordNavigation + navigateBack/Forward + 5 处清理）+
`app/App.tsx`（2 命令 + focus-pane 去默认键 + TabBar 箭头按钮）+ icons/i18n/css。校准 Obsidian 官方默认键
`Mod+Alt+←/→`（`Ctrl+Alt+←/→` win，WebSearch）——与 Geode 自创 `focus-next/prev-pane` 冲突 → **navigate 拿 canonical 键、
focus-pane 改无默认键**（命令仍在面板可自绑；r32 套件只在测 normalize/format 纯函数时用 `Mod+Alt+ArrowRight` 字面量，
不依赖 focus-pane 绑定 → 不回退）。**零新 window 探针**——导航是 store 操作,探针/E2E 直驱 `app.workspace`、热键复用 R32
`__geodeHotkey.match`。macOS probe 实测:新增 **r37-probe 18/18**——桌面直驱真实 store（a→b→c 导航 + back/forward + wrap
no-op + 新导航清 forward + 新 tab 空历史 + 热键 grammar）;命令层 App-effect 不可驱动交浏览器 r37-e2e。**r36/r35/…/r23
套件不回退**（compat 调用面零改动；浏览器 r37-e2e **36/36** + r36 47、r35 25、r34 15、r33 37、r32 24 全绿；`r26-bytes` 0
违例,markdown.ts 未动）。**3 维对抗评审 12 finding → 0 确认缺陷**（核心「recordNavigation 镜像 openFile 三分支」逐分支
证伪;反应式按钮无需独立 Store 的断言实证;多 pane 点非活动 pane 按钮经 onMouseDownCapture 先激活正确）**+ 1 行为偏差
记入已知偏差**（split 克隆 tab 用新 id → 副本无导航历史,Obsidian 会复制）**+ 2 证伪硬化成断言**（view-mode 恢复 +
forward 栈 delete-purge）。

### R36 套件回归（2026-06-14，macOS release 二进制 v0.36.0 实测 `r36-probe-vault`）

R36 = 标签页快捷键（已核实缺口：命令表无 next/prev-tab、go-to-tab N、new-tab、reopen-closed；仅 `focus-next/prev-pane`
是空间移动）。**compat API 表面零代码改动**——全在 `core/workspace.ts`（4 纯 store 导航方法 + `recentlyClosed` 栈）
+ `app/App.tsx`（13 命令注册）+ i18n。校准 Obsidian 官方 docs（`help/User+interface/Tabs`）:**next/prev-tab 两平台都是
字面 `Ctrl+Tab`/`Ctrl+Shift+Tab`**（`Cmd+Tab` 是 macOS 应用切换器 → 用 R32 体系的字面 `Ctrl` 区分）、`Mod+1..8` 第 N、
`Mod+9` 末、`Mod+T` 新、`Mod+Shift+T` 重开。**零新 window 探针**——标签切换是 workspace **store 操作**，探针/E2E 直接
驱动 `app.workspace`、热键复用 R32 `__geodeHotkey.match`。macOS probe 实测:新增 **r36-probe 18/18**——**桌面探针比
R34/R35 更强:直驱真实 store 功能逻辑**（开多 tab → cycle/activateTabAt/last/reopen + mode 恢复，store 变更不依赖绘制，
无需 live view）+ 热键 grammar；**唯一不可驱动 = 命令层**（App.tsx 在 `useEffect` 注册命令，后台 WKWebView 不绘制 →
effect 不跑 → 命令从不注册,cmCount=0；= R34 `editor:*` 同一 App Nap §D），故命令注册+execute 交浏览器 r36-e2e。
**r35/r34/…/r23 套件不回退**（compat 调用面零改动；浏览器 r36-e2e **47/47** + r35 25、r34 15、r33 37、r32 24、r31 21、
r25 17、r24 12、r23 22 全绿；`r26-bytes` 0 违例，markdown.ts 未动）。**3 维对抗评审 3 finding → 1 确认修复**（vault 切换
不清 `recentlyClosed` → 跨库同名相对路径碰撞，`Mod+Shift+T` 打开新库无关同名文件；修 = 订阅 `vault:changed` reason
"load" 反应式清栈，镜像 `lastActiveFile` 重置 + DocumentManager 句柄失效）**+ 2 证伪硬化成断言**（三处 purge/remap
钩子 6 断言含「删 `sub` 不误伤 `subextra.md`」字节级前缀边界 + `Mod+T`/`Mod+Shift+T` 真键端到端）。

### R35 套件回归（2026-06-13，macOS release 二进制 v0.35.0 实测 `r35-probe-vault`）

R35 = 括号/引号自动配对 + 选区包裹（实测缺口：敲 `[` 得 `[` 不补 `]`、源码无 closeBrackets）。**compat API
表面零代码改动**——全在原生编辑器层（新 `core/bracketWrap.ts` 纯函数 + `cmExtensions` 接 `closeBrackets()`/
`closeBracketsKeymap`/`markdownWrapHandler` inputHandler）。镜像 Obsidian 两设定：**「Auto pair brackets」**=
CM `closeBrackets()` 管 `( [ { " '`（自动配对 / 选区包裹 / type-over / Backspace 删配对 / 引号 contraction
安全）；**「Auto pair Markdown syntax」选区形态**= `core/bracketWrap` 管 `* _ \` ~ = $`（仅非空选区 additive
包裹）。新增 always-on 探针 `window.__geodeBrackets`（**装在 `loadExternal` 之前**，与 `__geodeFormat`/
`__geodeSearch` 同列）。macOS probe 实测：新增 **r35-probe 9/9**——**桌面探针首次能驱动「配对相关」真值**：
R35 的探针面是**纯函数**（`markdownWrapInput`），无需 live CM view，故真二进制能直接验 wrap 决策正确（present +
纯决策 `*foo*`/`(1,4)`/`` `foo` `` + 空/非标记/括号字符 → null + 启动 error-free）；唯一仍不可驱动的是
closeBrackets 的 auto-close/type-over（需 live view，R34 结论），交浏览器 r35-e2e。**r34/r33/…/r23 套件不回退**
（compat 调用面零改动；浏览器 r35-e2e 25/25 + r34 15、r33 37、r32 24、r31 21、r25 17、r24 12、r23 22 全绿；
`r26-bytes` 0 违例，markdown.ts 未动）。**对抗评审 5 维 5 finding → 0 确认 / 5 证伪**（2 观察硬化成断言：
apostrophe contraction + line-start 引号；2 记已知限制：空选区强调符不配对=刻意偏离 / closeBrackets 不按上下文
门控=保真 gap）。**关键回归保证**：closeBrackets 的 `[` 配对靠 wikilink source 既有 `sliceDoc(to,to+2)`
守卫零冲突——字面 `[[Note]]` 经 type-over 吸收手敲闭合括号仍得 `[[Note]]`，故既有套件所有 `[[` 键入断言不破。

### R34 套件回归（2026-06-13，macOS release 二进制 v0.34.0 实测 `r34-probe-vault`）

R34 = 编辑器内查找/替换（实测缺口：`@codemirror/search` 仅 compat loader 引入、features/editor 未接）。
**compat API 表面零代码改动**——本轮全在原生编辑器层（新 `features/editor/searchCommands.ts` + `cmExtensions`
接 `search()`/`searchKeymap`/phrases + editorTheme 面板主题）。镜像 Obsidian：Cmd-F 文内查找（与左栏全库
SearchPanel 两套互不影响）、面板含 replace 行、匹配全高亮、phrases 本地化（en+zh）。新增 always-on 探针
`window.__geodeSearch`（**装在 `loadExternal` 之前**，与 `__geodeFormat`/`__geodeHotkey`/`__geodeSlash` 同列）。
macOS probe 实测：新增 **r34-probe 3/3**——但**本轮明确了桌面探针的边界**：功能依赖 live CM view 时，后台
WKWebView 不绘制 → React effect 不执行 → EditorPane view/命令注册都不挂载（foreground 也无效，实测），
故桌面探针只验「探针嵌入真二进制 present+全 api + 启动 error-free」，**功能真值交浏览器 r34-e2e**（真实聚焦
view：Cmd-F 开面板 / 真键入高亮 ×3 / Escape 关 / 替换 + autosave 落盘）。**r33/r32/…/r23 套件不回退**
（compat 调用面零改动；浏览器 r34-e2e 15/15 + r33 e2e 37/37、r32 24、r31 21、r25 17、r24 12、r23 22 全绿；
桌面 r33-probe 12/12 在新二进制复跑；r26-bytes 0 违例，markdown.ts 未动）。**对抗评审 5 维 9 verdict → 7
确认 → 3 根因修复**（探针活动文件门控 / 空查询 no-op / 面板字号走 var）**+ 3 记已知限制**（IME 合成面板
input=CM 上游 / Mod+G 被 open-graph 遮蔽 / 选区>100 字符不预填）。

### R33 套件回归（2026-06-13，macOS release 二进制 v0.33.0 实测 `r33-probe-vault`）

R33 = Markdown 格式化命令 + 快捷键（实测缺口：选区按 Cmd-B 不加粗、无任何 toggle 命令）。**compat API
表面零代码改动**——本轮全在原生编辑器/命令层（新 `core/format.ts` 纯变换 + `features/editor/formatCommands.ts`
注册 + `cmExtensions` `Prec.highest` keydown 拦截器 + `core/commands.ts` 两守卫）。镜像 Obsidian 编辑器命令：
13 个格式化命令（仅 Cmd/Ctrl-B/I/K 默认键、余 10 个无默认键可绑）；`*`/`**` 星号记法、Cmd-K=`[text]()`。
新增 always-on 探针 `window.__geodeFormat`（**装在 `loadExternal` 之前**，与 `__geodeHotkey`/`__geodeSlash`/
`__geodeRename`/`__geodeProperties`/`__geodeFold` 同列）；`apply(op,text,from,to)` 暴露纯变换 → 桌面 WKWebView
无 CDP 也能确定性自检 13 op。macOS probe 实测：新增 **r33-probe 12/12**——真实 WKWebView runtime（bold
wrap/unwrap、italic 强调符歧义守卫、link、heading 循环、blockquote、checklist、numbered 多行、code-block、
callout）。**头号根因**：原生 contenteditable 的 Cmd+I 在 window 冒泡前把选区扩成整行 → 命令热键须在 CM
最高优先级拦截（不能只靠 window）。**r32/r31/…/r23 套件不回退**（compat 调用面零改动；浏览器 r33-e2e
**37/37** 含 live Cmd+B/I/K 真实 CM 编辑器 + autosave 落盘实测；r32 e2e 24/24 + probe 16/16、r31–r23
浏览器 21/17/12/22 全绿；r26-bytes 0 违例，markdown.ts 未动）。**对抗评审 5 维 18 verdict → 13 确认 → 去重
4 根因修复**（lineBounds 不变量 / IME isComposing / 双触发 defaultPrevented / heading 无空格）。

### R32 套件回归（2026-06-13，macOS release 二进制 v0.32.0 实测 `r32-probe-vault`）

R32 = macOS Cmd（Mod）修饰键支持（**头号缺口**：迁移前 Cmd+P 无反应、仅 Ctrl 通）。**compat API
表面零代码改动**——本轮全在原生命令层（`core/commands.ts` 热键语法 + `app`/`features` 显示/默认键）。
镜像 Obsidian `Mod` 语义：mac→⌘（metaKey）、Win/Linux→Ctrl（ctrlKey）；`Ctrl` 永远物理 Control、
`Meta` 永远 ⌘/Win；`matchParsedHotkey` 四态全等比对 → mac 下 `Ctrl+P` 不触发 `Mod+P` 绑定（镜像
Obsidian）。新增 always-on 探针 `window.__geodeHotkey`（**装在 `loadExternal` 之前**，与
`__geodeSlash`/`__geodeRename`/`__geodeProperties`/`__geodeFold` 同列）；`match`/`format` 显式收
`isMac` → 单二进制双平台分支确定性自检。macOS probe 实测：新增 **r32-probe 16/16**——真实 WKWebView
runtime：`isMac=true` 实测 + normalize（Mod≠Ctrl）+ 双平台 match 分支 + format 字形（⇧⌘E / Ctrl+Shift+E
/ ⌥⌘→）。**r31/r30/r29/…/r23 套件不回退**（compat 调用面零改动；浏览器 r32-e2e 24/24 含 live Cmd+P
开面板 / Ctrl+P 不开 / 面板 ⌘ 字形 / Cmd+, 开设置；r23–r31 浏览器 22/12/17/12/22/23/19/25/21 全绿；
r30/r31 desktop probe 10/10）。缺口表无变化（compat 外部插件 `Keymap`/`Scope` 热键路径是独立管线，
本轮不动——记为有意分流而非缺口）。

### R31 套件回归（2026-06-13，macOS release 二进制 v0.31.0 实测 `r31-probe-vault`）

R31 = 斜杠命令 `/` 菜单（编辑器输入 `/` 弹命令菜单、实时过滤、执行删 query）。**compat API
表面零代码改动**——**关键分层决策**：R6 `EditorSuggest` 管线在 `compat/obsidian/suggest.ts`
（外部插件 API），而 **features 绝不 import compat**，故内置 slash 菜单**不复用** compat
EditorSuggest，改**镜像原生 `[[` wikilink 所用 CM6 `@codemirror/autocomplete` 路径**——给
`cmExtensions.ts` 的 `autocompletion({override:[...]})` 追加一个 `slashCommandSource`（features/core
可 import `@codemirror/*`，分层清白）。改动 = `core/fuzzy.ts`（从 `features/palette/` 迁入复用）
+ `features/editor/slashCommands.ts`（新）+ `cmExtensions` override 追加 + `main.tsx` 探针。新增
always-on 探针 `window.__geodeSlash`（**装在 `loadExternal` 之前**，与 `__geodeRename`/
`__geodeProperties`/`__geodeFold` 同列）。macOS probe 实测：新增 **r31-probe 10/10**——真实
runtime：触发门控（行首/空白后 `/` 触发；`and/or`·`http://`·未闭合 `[[foo /zz` 抑制）+ 候选
排序/可用性（available 命令入、unavailable 排除、fuzzy 排序）。**r30/r29/r28/r27/r26/r25/r24
套件不回退**（compat 调用面零改动；浏览器 r31-e2e 21/21 含真实 CM 编辑器 apply 全流程 + C1
增量过滤锁 + M1 wikilink 抑制锁；fuzzy 迁 core 后命令面板/快速切换/模板选择排序零回归）。缺口表
无变化（compat `EditorSuggest` 仍是外部插件可用的独立管线，未与内置 slash 菜单合流——内置走
原生 CM6，记为有意分流而非缺口）。

### R30 套件回归（2026-06-13，macOS release 二进制 v0.30.0 实测 `r30-probe-vault`）

R30 = Properties 侧栏视图（All Properties 面板 + 全局属性改名 + 值建议），收口 R22 显式延期。
**compat API 表面零代码改动**——全局改名走新 `core/propertyRewrite.ts`（`renamePropertyAcrossVault`
**逐字镜像 R16 `linkRewrite.ts` verified-rewrite**：读 fresh、`buildRenameProperty` 绝不手写
YAML、post-rewrite 复解析断言、per-file skip+report、`runTail` 串行、types.json carry 经
regChain RMW），写字节全继承 R16/R22 咽喉点（`vault.modify` FNV 抑回声 + `applyExternalEdits`
canonical 守卫 + properties builder 序列化自验证）。改动 = `core/propertyRewrite.ts`（新）+
`metadata.getPropertyKeyCounts/getPropertyValues`（聚合）+ `features/allproperties/`（新右侧栏
面板）+ `PropertiesPanel.tsx`（值 datalist）+ `App.tsx`/`types.ts`/i18n/`main.tsx` 探针。新增
always-on 探针 `window.__geodeProperties`（**装在 `loadExternal` 之前**，与 `__geodeRename`/
`__geodeBookmarks`/`__geodeFold` 同列）。macOS probe 实测：新增 **r30-probe 10/10**——真实 fs
（Tauri Rust 后端）：keyCounts/values 聚合 + 全局改名 author→writer **值字节保真**（`writer: Ada`、
其余属性 `Status: draft` 未动）+ case-only 改名 `Status→status` 实测（C1 修复验证）+ 0 skipped。
**r29/r28/r27/r26/r25/r24 套件不回退**（compat 调用面零改动；浏览器 r30-e2e 25/25 含 case-only
C1 回归 + 撞名 skip + 开文件 buffer 路径 + 面板 filter/展开/点开 + 值 datalist）。缺口表无变化
（`app.metadata.getAllPropertyInfos`/属性类型 instance API 私有面未做——记缺口余项；search
集成 `[key:value]` 沿用 R21 属性搜索延期）。

### R29 套件回归（2026-06-13，macOS release 二进制 v0.29.0 实测 `r29-desk-vault`）

R29 为原生功能轮（折叠持久化 + 阅读视图标题折叠），**compat API 表面零代码改动**——折叠态
存 localStorage（`geode.fold.<path>`，镜像 Obsidian `{folds,lines}` 形状），**零新 vault
写路径、不动 `markdown.ts` 字节管线**（`r26-bytes` 0 违例）。改动 = `core/foldStore.ts`（新）+
`features/editor/foldPersistence.ts`（新捕获 ViewPlugin）+ `EditorPane.tsx`（mount 恢复 +
阅读视图标题折叠委托）+ `editor.css` + `main.tsx` 探针。新增 always-on 探针
`window.__geodeFold`（**装在 `loadExternal` 之前**，与 `__geodeRename`/`__geodeBookmarks`/
`__geodeExplorerMove` 同列）。macOS probe 实测：新增 **r29-probe 4/4**——WKWebView 真实
localStorage：`{folds,lines}` 往返保真 / empty→removeItem（不留空键）/ malformed→load null
（不抛）/ key 落盘可见；外部读结果文件判定。**r28/r27/r26/r25/r24 套件不回退**（compat
调用面零改动；折叠纯前端 localStorage+DOM，浏览器 r29-e2e 19/19 含真实 CM fold-all→
preview↔editor 往返恢复）。缺口表无变化（折叠持久化非 compat API 面；Obsidian 内部
`foldManager`/`applyFoldInfo` 私有 API 未做——记缺口余项）。

### R28 套件回归（2026-06-13，macOS release 二进制 v0.28.0 实测 `r28-desk-vault`）

R28 为原生功能轮（文件树拖拽移动），**compat API 表面零代码改动**——拖拽移动 = Explorer
内 HTML5 DnD 接到既有 `renameWithLinkUpdate`（R16 写咽喉，compat `fileManager.renameFile`
走同一引擎），无新 compat 面。改动在 `core/explorerMove.ts`（新增纯决策核心）+
`features/explorer` + `core/vault.ts`（`MemoryVaultAdapter.rename` 加 `to.exists` 守卫，
**与 Rust `vault_rename` 已有守卫对齐**，桌面行为零变化）+ `main.tsx` 探针。新增 always-on
探针 `window.__geodeExplorerMove`（**装在 `loadExternal` 之前**，与 `__geodeRename`/
`__geodeBookmarks` 同列）。macOS probe 实测：新增 **r28-probe 4/4**——真实 fs（Tauri
`vault_rename`，与 `__geodeRename` 同一已验证 IO 路径）：file→folder 移动 + 链接保持解析 /
**撞名拒绝且目标真实字节不被覆盖** / 文件夹移动带子项 / no-op + 后代守卫；外部读判定磁盘
状态一致。**r27/r26/r25/r24/r23 套件不回退**（compat 调用面零改动；`MemoryVaultAdapter`
守卫只在 target 已存在时 throw，正常改名/移动上游已 collision-check，r27-e2e 22/r25-e2e 17/
r24-e2e 12 全绿）。缺口表无变化（拖拽移动非 compat API 面）。

### R27 套件回归（2026-06-13，macOS release 二进制 v0.27.0 实测 `r27-probe-vault`）

R27 为原生功能轮（书签 Bookmarks），**compat API 表面零代码改动**——书签走
`@core/bookmarks`，features 绝不 import compat。compat 面 = **数据文件双向保真**：
`.obsidian/bookmarks.json` 读 Obsidian 写的形状不丢字段（未知顶层键 + 逐项 `_extra` +
未知 `type` carrier），写回 Obsidian 能继续读（序列化 RMW，malformed abort 不覆盖）。
新增 always-on 探针 `window.__geodeBookmarks`（main.tsx，**装在 `loadExternal` 之前**，
与 `__geodeRename`/`__geodeHover`/`__geodeRenderMarkdown` 同列）。macOS probe 实测：新增
**r27-probe 8/8**——真实 fs（Rust `vault_read_config`/`vault_write_config`，与 R20 themes/
R22 properties 同一已验证 IO 路径）：读 Obsidian 形状 bookmarks.json + 嵌套组/标题解析 +
toggleFile 真写持久化 + **未知顶层键/逐项字段跨真写保真**。**r26/r25/r24/r23 套件不回退**
（compat 调用面零改动）。缺口表新增一行（`internalPlugins` bookmarks instance API 未做）。

### R26 套件回归（2026-06-13，macOS release 二进制 v0.26.0 实测 `geode compat-vault`）

R26 为原生功能轮（PDF/音视频嵌入），**compat 表面零代码改动**（嵌入是阅读视图渲染
管线特性，不经任何 compat API）。改动在 core/markdown.ts（emission）+ core/embeds.ts
（hydrateFile）+ features/editor + features/export，均不在 compat 调用面上；
`MarkdownRenderer`/`getFileCache` 经同一 parseNote 管线，**字节级守卫 r26-bytes 36 例
实测仅媒体用例变化、其余 0 违反**，故 compat 渲染行为零变化。新增 always-on 探针
`window.__geodeRenderMarkdown`（main.tsx，与 `__geodeHover`/`__geodeUnlinked` 同列）。
macOS probe 实测：新增 **r26-probe 5/5**——真实 fs 发射 audio/video/pdf 占位 + zip 降级；
**r25/r24/r23 套件不回退**（同一渲染管线 + compat 调用面，媒体嵌入纯只读叠加）。缺口表
无变化（嵌入非 compat API 面）；R12「PDF/音频嵌入降级链接」缺口本轮于原生功能侧补齐
（PDF/audio/video 已渲染；canvas + 其它附件仍降级，见 ROADMAP R26）。

### R25 套件回归（2026-06-13，macOS release 二进制 v0.25.0 实测 `geode compat-vault`）

R25 为原生功能轮（悬停预览 / Page Preview），**compat 表面一处真实化**：
`Plugin.registerHoverLinkSource` 由 warn-stub 升真实无操作登记（记录 source id 返回，
缺口表已更新该行）；`hoverPopover`/`HoverParent` 仍缺口。其余 compat 零改动。
hover 控制器全局委托 `a.internal-link`/`.cm-live-wikilink`/`[data-hover-path]`，
插件渲染的内链锚点被动受益（无需插件参与）。macOS probe 实测：新增 **r25-probe 7/7**
——经 `window.__geodeHover` 钩子（main.tsx，`__geodeRename`/`__geodeUnlinked` 同款
always-on probe 先例）驱动真实 fs：resolve→read→`renderMarkdownToHtml` 渲染目标笔记
（含内链锚点输出）、unresolved→null。probe 结果文件 `r25-results.md` + `__r25/` 夹具
重跑前先删。**套件矩阵不回退**：浏览器 r24-e2e 12/12、r23-e2e 22/22 全绿（同一渲染
管线与 compat 调用面，hover 纯只读叠加，零回归）。缺口表仅 registerHoverLinkSource
一行更新。

### R24 套件回归（2026-06-13，macOS release 二进制 v0.24.0 实测 `geode compat-vault`）

R24 为原生功能轮（未链接提及 / 反链面板扩展），**compat 表面零代码改动**（contract
明令；git diff 确认 compat/** 无改动）。官方 Backlinks 插件 API 本就不在公开
`obsidian.d.ts`，无缺口表条目；core/unlinkedMentions.ts 与 BacklinksPanel 均不在任何
compat 调用面上。core/metadata.ts 本轮仅导出 `maskCodeRegions`（parseNote 内联纯抽取，
字节不变——compat 的 getFileCache/MarkdownRenderer 经同一 parseNote/管线，行为零变化）。
macOS probe 实测：**r23-suite-probe 9/9 不回退**（report 5/5、**5/5 插件 status
"enabled"**、recent-files/nldates 命令 + R23 insert-template 命令共存）；新增
**r24-probe 12/12**——经 `window.__geodeUnlinked` 钩子（main.tsx，`__geodeRename` 同款
always-on probe 先例）驱动真实 fs：检测 basename+alias 4 提及、Link-all 真实磁盘改写
（3 名→`[[Zettelkasten]]` + 别名→`[[ZK]]` surface 保留、行内代码/复数/既有链接不动）、
重扫归零、**数据安全 C# 跳过（含 wikilink 元字符的名字 post-rewrite 校验失败 →
filesChanged 0、源文件字节不变）**。probe 结果文件 + `__r24/` 夹具重跑前先删（create
拒已存在）。缺口表无变化。

### R23 套件回归（2026-06-13，macOS release 二进制 v0.23.0 实测 `geode compat-vault`——新开发机重建后首轮）

R23 为原生功能轮（模板系统），**compat 表面零代码改动**（contract 明令；git
diff 确认 compat/** 无改动）。模板引擎/选择器均不在 compat 调用面上。
**环境口径**：开发机再次迁移（新机器），compat-vault 本机重建——5 插件按原
版本 GitHub 重下（recent-files 1.7.9 / better-word-count 0.10.1 / nldates 0.6.2 /
url-into-selection 1.11.4 / calendar 1.5.10）；原 probe 脚本（gitignored）未随迁，
按 R20-R22 记录的不变量**重写** r23-suite-probe.js + r23-templates-probe.js。
macOS 实测：**r23-suite-probe 9/9**——report 5 条 ✓、**5/5 status "enabled"** ✓、
recent-files/nldates 插件命令注册 ✓、R23 insert-template 命令共存 ✓；
**r23-templates-probe 10/10**——真实 fs 模板插入/创建/变量展开 + **calendar
sidebarPanels 贡献点挂载** ✓。
probe 方法论修订（新机教训，写给后续轮次）：后台启动的 app 里 probe 晚期
await/timer 不可靠（App Nap/WKWebView 节流，t≈10s 后 setTimeout 可能永不
归来）——断言放生命周期早段、进度 fire-and-forget 写链落盘、挂载断言查
`plugins.sidebarPanels` Store 而非可见性依赖的 DOM（侧栏收起时 tab 不渲染）。
旧轮次专项探针（nldates 逐键 CDP/更新链路/NSIS）仍属 Windows 专项，本机不可
执行（非回归）。缺口表无变化。

### R22 套件回归（2026-06-12，macOS release 二进制 v0.22.0 实测 `geode compat-vault`）

R22 compat 改动一件：`fileManager.processFrontMatter` 从 no-op stub 升级为真
实现（官方签名 d.ts:2954；core/properties 同一编辑引擎——文本来源双路径
开文件 handle / 关文件 readFresh，R16 先例；fn 同步 mutate 对象后逐 key diff
应用，零变更不写盘，builder 拒绝即整体 reject 零写入）。官方语义偏差入档：
opaque 条目（嵌套 map/块标量/注释等）不进 fm 对象且永不被改写；整块不可
解析不抛 YAMLParseError（降级空对象）；嵌套对象等不可序列化赋值 TypeError
reject（官方全量 YAML 序列化——我们绝不静默写坏）；undefined 赋值 = 跳过
非删除；DataWriteOptions 忽略；开文件多 key 变更 = 多 undo 步。
macOS probe 实测：**r22-props-probe 22/22**（面板真实磁盘编辑/opaque 字节
保留/types.json 真实写入/processFrontMatter 真实改写含删 key + opaque 不动/
阅读视图面板）；**r20-suite-probe 9/9 不回退**（5/5 插件加载启用 + calendar
挂载 + bridge 共存）；**r21-search-probe 14/14 不回退**。新增共写口径：
`.obsidian/types.json` 与 Obsidian 同文件同形状（{"types":{name:type}}，
RMW 保留未知键与兄弟键）——同库往返类型绑定不丢。缺口表更新一行
（processFrontMatter 划入真实现）。

### R21 套件回归（2026-06-12，macOS release 二进制 v0.21.0 实测 `geode compat-vault`）

R21 为原生功能轮（搜索运算符），**compat 表面零代码改动**（contract 明令；
git diff 确认 compat/** 无改动）。搜索面板/core/search.ts 均不在任何 compat
调用面上（插件无搜索 API 缺口表条目，官方 Search 插件 API 本就不在公开 d.ts）。
macOS probe 方案复测：r20-suite-probe 9/9 不回退（5/5 加载启用 + calendar 挂载 +
bridge 共存）；新增 r21-search-probe 14/14（自建 R21 Fixtures 夹具驱动真实
SearchPanel DOM：tag:嵌套边界/path:+词/file:/引号短语/负向/OR/正则+tag 组合/
match-case 双向/line: 同行约束/parse error 面板呈现——原生 value setter +
input 事件驱动 React 受控输入的先例）。probe 结果文件重跑前须删除（create
撞已存在文件）。缺口表无变化。

### R20 套件回归（2026-06-12，macOS release 二进制实测 `geode compat-vault`——环境迁移后首轮）

R20 = **主题 CSS 兼容层落地**（R3 末规划的「CSS 类名兼容做成独立可选层」正式成层，
见 ARCHITECTURE R20）。compat 新增 themes.ts/theme-bridge.css（独立模块，不碰
loader 主链路）；AppContext 增 obsidianCss 句柄（obsidianLoadReport 同模式）。
**环境口径变化**：开发机迁 macOS，WKWebView 无 CDP——桌面套件回归改用
**probe 插件自检方案**（`.geode/plugins/r20-suite-probe.js` 读
`window.geode.app.obsidianLoadReport` + DOM 断言，结果写回 vault 文件）；
compat-vault 为本机重建（5 插件 GitHub 原版本重新下载：recent-files 1.7.9 /
better-word-count 0.10.1 / nldates 0.6.2 / url-into-selection 1.11.4 /
calendar 1.5.10）。Windows 专项链路（NSIS/nldates 逐键 CDP 探针/更新链路）本机
不可执行，**留待 Windows 机或 CI 复跑**（记录，非回归）。
macOS 实测 9/9：**5/5 加载启用 ✓**（report status 全 "enabled"）、calendar
sidebar-panel 真实挂载 ✓、R20 bridge 与插件 styles.css 共存 ✓（注入序不变量 =
插件样式在前，主题层经 obsidianLoadReport 订阅每轮重建恒守）。
新增已知口径：插件 styles.css 与社区主题同特异性时主题胜（文档序，Obsidian
同向）；`vault.getConfig("cssTheme")` 仍 undefined（compat getConfig 缺口表
既有条目，主题状态走 Geode 自有 obsidianCss 句柄）。缺口表无变化。

### R19 套件回归（2026-06-12，桌面 release v0.19.0 实测 `geode.exe compat-vault`）

R19 为原生功能轮（mermaid 图表），**compat 表面零代码改动**（contract 明令；
git diff 确认 compat/** 无改动）。共享管线本轮新增 ` ```mermaid ` fence 分流
——compat 的 `MarkdownRenderer.render` 经同一管线自动输出 `.geode-mermaid`
占位，且调用方若走共享水合（R13 接通的 hydrate 路径）自动获得 SVG（**有意的
基管线增强，非回归**；R18 同口径）。**字节级不变义务**：所有非 mermaid fence
输出对全部调用方字节一致（diff 套件 Part A 33 用例 + ```js/```Mermaid 负向
用例验证）。桌面逐项复测不回退：5/5 加载启用 ✓、nldates 指令条 + 逐键
`@tomorrow`→`[[2026-06-13]]` ✓（lastLine 空值为既有探针语义，非回归）、
reload 幂等 + calendar 重挂载 ✓、回声 suppressed 4 / external 2 正常 ✓；
R19 探针 14/14（图表渲染/降级/内链点击/锚点消毒/live 源码口径/打印自包含）。
新增已知口径：compat 输出图表中 internal-link 节点带 data-target，但点击
接线由调用方自理（宿主预览的委托不覆盖插件自渲染容器）。缺口表无变化。

### R18 套件回归（2026-06-12，桌面 release v0.18.0 实测 `geode.exe compat-vault`）

R18 为原生功能轮（Markdown 方言长尾：callouts/==高亮==/脚注/%%注释%%/KaTeX 数学），
**compat 表面零代码改动**（contract 明令；git diff 确认 compat/** 无改动）。但共享的
`core/markdown.ts` 渲染管线本轮新增五项语法——这是**有意的基管线增强**：compat 的
`MarkdownRenderer.render` 经同一管线**自动获得**全部新语法（callout/高亮/脚注/注释/数学），
属能力提升非回归。**字节级不变义务**：无新语法内容的渲染输出对所有调用方（含 compat
MarkdownRenderer）保持字节一致（diff 套件 Part A 33 用例验证）。桌面逐项复测不回退：
5/5 加载启用 ✓、nldates 指令条 + 逐键 `@tomorrow`→`[[2026-06-13]]` ✓（lastLine 空值是
弹层关闭后 Enter 落空的既有探针语义，非回归）、reload 幂等 + calendar 重挂载 ✓、回声
suppressed 4 / external 2 正常 ✓；r17 折叠+摄入 10/10（disk-roundtrip 70 字节无损）。
新增已知口径：compat `getFileCache()` 不收脚注/callout 专项元数据（官方 CachedMetadata
亦无此形状——非缺口）。缺口表无变化。

### R17 套件回归（2026-06-11，桌面 release v0.17.0 实测 `geode.exe compat-vault`）

R17 为原生功能轮（附件摄入 + 折叠），compat 表面零改动（contract 明令）。桌面逐项
复测不回退：5/5 加载启用 ✓、nldates 指令条 + 逐键 `@tomorrow`→`[[2026-06-12]]` ✓
（r16-nldates 专用探针；r9-probe-suite 的 lastLine 空值是其弹层关闭后 Enter 落空的
既有探针语义，非回归）、reload 幂等 + calendar 重挂载 ✓、回声计数正常 ✓；
r12（转写 ✓ compat-vault + 导出 data URI ✓ demo-vault）/r13（块）/r14（定位）探针
全绿；r16 改写引擎桌面回归全绿（d4 echo 断言本轮修订为精确语义——引擎写目标绝不
external；rename 事件无指纹面、external 是设计行为，r17-echo-diag.js 坐实）。
新增已知口径：编辑器 paste 处理器对纯文本粘贴返回 false 零干扰（url-into-selection
的 editorCallback 粘贴路径不受影响，实测 ✓）；`vault.getConfig("attachmentFolderPath")`
仍返回 undefined（Geode 的 attachmentFolder 设置未接 compat——R18+ 候选）。
缺口表无变化。

### R16 套件回归（2026-06-11，桌面 release v0.16.0 实测 `geode.exe compat-vault`）

R16 compat 改动一件：`app.fileManager.renameFile` 从 warn-stub 升级为真实现（接 core
renameWithLinkUpdate——rename + 全库链接改写，对齐官方 "update all links depending on
the user's preferences" 语义；`Vault.rename` 保持裸 rename **是官方对齐项非缺口**，
d.ts:7451 明示 "To ensure links are automatically renamed, use FileManager.renameFile
instead"）。桌面逐项复测不回退：5/5 加载启用 ✓、nldates 指令条 + 逐键
`@tomorrow`→`[[2026-06-12]]` ✓、reload 幂等 + calendar 重挂载 ✓、回声计数正常 ✓；
r12（转写/导出 data URI）/r13（块）/r14（定位）探针全绿。新增形状偏差记录：
`getFileCache().links` 不含 `[[#h]]` 同文链接条目（Geode 的 links 索引不收空 target
——官方含 `link: "#h"` 形态）。fileManager 其余方法仍为按访问记录缺口的 no-op stub
（getter 级 reportGap 移除——按方法粒度报告更诚实）。

### R15 套件回归（2026-06-11，桌面 release v0.15.0 实测 `geode.exe compat-vault`）

R15 整固轮（compat 零改动）。桌面逐项复测不回退：5/5 加载启用 ✓、nldates 指令条 +
逐键 `@tomorrow`→`[[2026-06-12]]` ✓、reload 幂等 + calendar 重挂载 ✓、回声计数正常 ✓；
另复跑 r12/r13/r14 全场景探针全绿（转写/导出 data URI/块引用/subpath 定位）。
缺口表无变化。

### R14 套件回归（2026-06-11，桌面 release v0.14.0 实测 `geode.exe compat-vault`）

R14 为原生功能轮（scroll-to-subpath + fence 排除统一），compat 零改动；渲染管线仅
含 subpath 的 internal-link 锚点新增 `data-subpath` 属性（compat MarkdownRenderer
输出同样获得该惰性属性，无行为变化）。桌面逐项复测不回退：5/5 加载启用 ✓、nldates
指令条+弹层 ✓、reload 幂等 + calendar 重挂载 ✓、回声计数正常 ✓。缺口口径：compat
`workspace.openLinkText` 不接 reveal（按需求驱动）。

### R13 套件回归（2026-06-11，桌面 release v0.13.0 实测 `geode.exe compat-vault`）

R13 compat 改动两件：`getFileCache().blocks`（官方 `Record<string, BlockCache>` 形状，
position 走既有 offset→Pos 映射）+ `MarkdownRenderer.render` 接通
resolveEmbed/noteEmbeds/hydrate（R12 缺口闭合——插件渲染的 markdown 中 `![[note]]`
真转写、`![[img]]` 真图片；blob 缓存为一次性 fragment 口径不订阅失效）。
桌面逐项复测不回退：5/5 加载启用 ✓、nldates 指令条+弹层 ✓、reload 幂等 + calendar
重挂载 ✓、回声计数正常 ✓。注意：阅读视图基管线本轮起剥行尾 `^block-id` 标记
（Obsidian 行为对齐，compat MarkdownRenderer 同样受益——有意变更非回归）。

### R12 套件回归（2026-06-11，桌面 release v0.12.0 实测 `geode.exe compat-vault`）

R12 为原生功能轮（笔记转写嵌入 + 导出内联），compat 零改动；渲染管线对无 noteEmbeds
调用方继续字节级不变（20 用例 diff）。桌面逐项复测不回退：5/5 加载启用 ✓、nldates
指令条+弹层 ✓、光标移出关弹层 ✓、reload 幂等 + calendar 重挂载 ✓、回声计数正常 ✓。
缺口口径更新：compat `MarkdownRenderer.render` 仍不传 noteEmbeds——插件渲染的 markdown
中 `![[note]]` 转写保持 "!"+链接（按需求驱动接线，R13 候选）。

### R11 套件回归（2026-06-11，桌面 release v0.11.0 实测 `geode.exe compat-vault`）

R11 为原生功能轮（模式切换零重建 + 图片嵌入），compat 表面零改动；阅读视图管线对
无 resolveEmbed 的调用方（含 compat MarkdownRenderer）字节级保持现状（12 用例 diff
验证）。桌面 release 逐项复测不回退：5/5 加载启用 ✓、nldates 指令条 + 弹层 ✓、
光标移出关弹层 ✓、reload 幂等 + calendar 重挂载 ✓、回声抑制计数正常 ✓。
新增已知口径：compat `MarkdownRenderer.render` 渲染 `![[img]]` 仍输出 "!"+internal-link
（未传 resolveEmbed——插件需要真嵌入渲染时再按需求驱动接线）。

### R10 套件回归（2026-06-11，桌面 release v0.10.0 实测 `geode.exe compat-vault`）

R10 compat 改动 = popup resize/scroll 重定位一项（suggest.ts 单文件）。逐项复测：
5/5 加载启用 ✓、nldates 指令条 + 逐键 `@tomorrow`→`[[2026-06-12]]` ✓、光标移出关弹层 ✓、
**弹层开启滚动编辑器 80px → popup 精确跟随 80px** ✓（新）、reload 幂等 + calendar
重挂载 ✓、回声抑制计数正常 ✓。**EditorSuggest 偏差行清零**——缺口表至此只剩
warn-stub 类条目（dragManager/internalPlugins/TFile.stat 等），无行为偏差项。

### R9 套件回归（2026-06-11，桌面 release v0.9.0 实测 `geode.exe compat-vault`）

R9 compat 改动 = EditorSuggest 两缺口闭合（setInstructions + 光标移动重评估），其余表面
零改动。桌面 release 逐项复测：5/5 加载启用 ✓、逐键 `@tomorrow` → 弹层 + **指令条
"Shift / Keep text as alias" 真实渲染**（R6 gap 可视闭合）→ Enter → `[[2026-06-12]]` ✓、
**光标移出触发区弹层即关**（R9 新语义）✓、`app:reload-plugins` 幂等 + calendar 重挂载 ✓、
浏览器 fixture `@@` 弹层 + 指令条 `↵ insert` + ArrowLeft 关闭 + 移回重开 ✓。
注：nldates 弹层关闭后光标移回不重开是该插件 onTrigger 锚点逐键建立的自身语义（官方
Obsidian 同行为），重开机制本身由 fixture 证明。缺口表仅剩 popup 不随 resize/scroll
重定位一条。截图 docs/screenshots/r9-desktop-nldates-instructions.png。

### R8 套件回归（2026-06-11，桌面 release v0.8.0 实测 `geode.exe compat-vault`）

R8 为原生功能轮（i18n 中/英 + watcher 回声抑制），compat 表面零改动（Command.name 拓宽为
`string | thunk` 向后兼容——compat 插件注册的字符串名原样工作）。桌面 release 逐项复测不回退：
5/5 加载启用、nldates 逐键 `@tomorrow` → 弹层 → Enter → `[[2026-06-12]]` 全链路 ✓、
`app:reload-plugins` 幂等（5/5 保持 on + calendar 重挂载，且在 zh locale 下复测）✓、
浏览器 `?obsfixture=1` fixture 零错误 ✓。R8 新增口径：真实 notify 链路自写回声全抑制
（`__geodeWatchEcho` suppressed 3 / 自写 external 0）、外部磁盘修改正常放行+编辑器实时重载
（external 1）；中文 UI 与套件共存截图 docs/screenshots/r8-desktop-zh-suite.png
（关系图谱 tab + 属性药丸 + 状态栏中文字数 + calendar 月历同框）。缺口表无变化。

### R7 套件回归（2026-06-10，桌面 release v0.7.0 实测 `geode.exe compat-vault`）

R7 为原生功能轮（图谱打磨 + 导出），compat 表面零改动。桌面 release 逐项复测不回退：
5/5 加载启用、nldates 逐键 `@tomorrow` → 弹层 → Enter → `[[2026-06-11]]` 全链路 ✓、
`app:reload-plugins` 幂等（5/5 保持 on + calendar 重挂载）✓、浏览器 `?obsfixture=1`
`@@` FixtureSuggest 弹层 ✓。缺口表无变化。

### R6 套件矩阵（2026-06-10，桌面 release v0.6.0 实测 `geode.exe compat-vault`）

R5 矩阵 5/5 全部不回退（加载/命令/设置页/核心功能逐项复测 ✓，`app:reload-plugins` 幂等、
calendar 重挂载、recent-files 面板 + onUserEnable 双路径），在此基础上 R6 新解锁：

| 插件 | R6 新增验证 | 剩余缺口 |
|---|---|---|
| nldates-obsidian 0.6.2 | **✓ 自动建议**：逐键输入 `@tomorrow` → suggest 弹层（"Tomorrow"）→ Enter → `[[2026-06-11]]`（autosuggestToggleLink 链接形态；DateSuggest 的 scope Shift+Enter 处理器、`suggestions.useSelectedItem`、context.start 锚点复用全链路真实走通） | setInstructions 指令条不渲染；纯光标移动不重评估（显式偏差） |
| recent-files-obsidian 1.7.9 | ✓ 不回退（左栏面板 + 实时列表） | dragManager 拖拽（同 R5） |
| calendar 1.5.10 | ✓ 不回退（legacy layout-ready 自动挂载，42 格月历） | 点日创建依赖 daily-notes 内部插件（同 R5） |
| better-word-count 0.10.1 | ✓ 不回退（状态栏字数） | — |
| url-into-selection 1.11.4 | ✓ 不回退（editorCallback 粘贴） | — |

桌面截图：docs/screenshots/r6-desktop-nldates-autosuggest.png（`@tom` 弹层 + 右栏月历同框）。
浏览器 fixture 追加：`@@` 触发 FixtureSuggest（过滤/导航/Enter 替换）、
`obsfixture-requesturl`（data: 探针 200）、`obsfixture-md-render`（MarkdownRenderer 真渲染，
内链 resolve + checkbox disabled）。

**探针方法论教训（写给后续轮次）**：nldates 的 onTrigger 锚点是逐键增量建立的——一次性
`dispatch` 整串 "@tomorrow" 时 `cursor-1` 处是 "w" 而非 "@"，永远不触发。桌面探针必须
逐字符独立事务模拟真实输入；synthetic Enter 必须派发到 `view.contentDOM`（document 级
target 会被 R6 的焦点守卫正确拦截——守卫本身就是这么设计的）。

### R5 套件矩阵（2026-06-10，桌面 release 实测 `geode.exe compat-vault`）

| 插件（上游版本） | 加载 | 命令 | 设置页 | 核心功能 | 缺口 |
|---|---|---|---|---|---|
| recent-files-obsidian 1.7.9 | ✓ | ✓ (1) | ✓ | **✓ 左栏面板实时列表**（open 命令 + onUserEnable 双路径；hover-link/拖拽降级） | dragManager 拖拽 |
| better-word-count 0.10.1 | ✓ | ✓ (0，状态栏驱动) | ✓ | ✓ 状态栏字数 | — |
| nldates-obsidian 0.6.2 | ✓ | ✓ (8) | ✓ | **✓ 日期解析**（"tomorrow"→`[[2026-06-11]]` 实测；nlp-now/today/time 全通） | EditorSuggest 自动建议触发 |
| url-into-selection 1.11.4 | ✓ | ✓ (1) | ✓ | ✓ editorCallback 粘贴 | — |
| calendar 1.5.10 | ✓ | ✓ (3) | ✓ | **✓ 右栏月历自动挂载**（legacy layout-ready 启动路径；42 格 + 周序号 + locale 全量） | 点日创建 daily note 依赖 daily-notes 内部插件（探测返回未启用，按钮降级） |

**R5 目标达成：5/5 核心功能列全 ✓**（R4 时为 2/5）。

### R4 套件矩阵（历史，修复前 1/5 可加载 → 修复后 5/5 加载、2/5 核心功能）

| 插件 | 核心功能（R4） | 当时缺口 |
|---|---|---|
| recent-files-obsidian | ✗ 面板不显示 | registerView 挂载 |
| better-word-count | ✓ | — |
| nldates-obsidian | ✗ 日期解析 | moment；EditorSuggest |
| url-into-selection | ✓ | — |
| calendar | ✗ 日历面板不显示 | registerView 挂载；moment |

R4 起点（修复前预检）仅 1/5 可加载；套件驱动追加 View/ItemView/EditorSuggest/
SuggestModal/Menu/path + getRightLeaf/getLeftLeaf/revealLeaf/leaf.setViewState
（calendar 重启用路径实测暴露）后 **5/5 加载启用**。manifest 边界用例已覆盖：
better-word-count 与 url-into-selection 上游 manifest 均缺 minAppVersion（warn 不拒载）。

**R5 桌面端杀手演示（发布版，截图 docs/screenshots/r5-desktop-killer-demo.png）**：
`geode.exe compat-vault` 直开 → calendar 经 legacy `layout-ready` 事件**自动**在右栏挂出
Jun 2026 月历（42 格）；`recent-files-open` 命令把 Recent Files 面板挂到左栏并 reveal，
列表随 file-open 实时更新；选中 "tomorrow" 跑 `nlp-dates` 得 `[[2026-06-11]]`；
`app:reload-plugins` 幂等（视图拆除重建，console 零 error）。探针脚本
`.calibration/cdp-run.mjs <expr文件>`（从文件读表达式，免 PowerShell 转义）+
`.calibration/cdp-shot.mjs <png>`（CDP 截屏）。

**R4 桌面端杀手演示（v0.4.0，截图 docs/screenshots/r4-desktop-killer-demo.png）**：
`geode.exe compat-vault` 直开 → 5 插件从真实 `.obsidian/plugins/` 加载、设置页
OBSIDIAN badge + 开关 + 设置区块齐全；disable/enable 往返实测
`community-plugins.json` 磁盘写回（顺序保留、跨会话状态还原）；calendar 在真实
文件系统写入 `data.json`（saveData 链路）。CDP 探针脚本 `.calibration/cdp-probe.mjs`
（发布版加 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 驱动）。

## 与现有架构的映射起点

| obsidian API | Geode 现有对应物 | 缺口 |
|---|---|---|
| `App` | `AppHandle` (core/plugins.ts) | 形状重排即可 |
| `Vault` | `Vault` (core/vault.ts) | TFile 对象化（现为 path 字符串）、cachedRead |
| `MetadataCache` | `MetadataIndex` (core/metadata.ts) | getFileCache 形状、resolvedLinks 图 |
| `Workspace` | `Workspace` pane 树 (core/workspace.ts) | leaf 概念暴露、registerView |
| `Plugin.addCommand` | `commands.register` | checkCallback/editorCallback 变体 |
| `Plugin.addSettingTab` | SettingsModal 插件区 | Setting DSL 组件 |
| `Editor` | EditorPane 内 CM6（未暴露） | **前置依赖：共享文档模型**（R4 P0，正好同轮） |
| `Notice` / `Modal` | 无 / modal 体系 | 新建轻量实现 |

## 风险与对策

- **表面积失控** → Tier 表是闸门，套件外的 API 按需求驱动加，不预铺。
- **插件摸 DOM 内部** → 不承诺；套件选型时排除重度 DOM hack 型插件，缺口如实记录。
- **moment/requestUrl 等运行时依赖** → T2 一次性决策（自带 moment ≈ +70KB，可接受）。
- **与原生 `.geode/plugins` 双轨** → 保留双轨：原生 API 是干净长期面，shim 是迁移面；
  文档明说新插件建议写原生。
