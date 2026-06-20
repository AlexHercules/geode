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
| ~~`DataAdapter.readBinary` / `writeBinary`~~ | **R111+R122：桥接 core 原生二进制 IO**（readBinary 返拷贝防别名）。**R122：writeBinary 创建或覆盖**（try createBinary→catch modifyBinary 原子；连带修 R120 共享-tmp 并发撕裂写 MAJOR=唯一 tmp）。`appendBinary`/`stat`/`trash*` 仍 warn-stub；append/process/rmdir/copy 用字符串 IO 真实实现 |
| DOM 增强 `onNodeInserted` / `onWindowMigrated` | warn-stub（单窗口宿主），返回 no-op destroyer |
| `Plugin.registerHoverLinkSource` / `hoverPopover`·`HoverParent` | **R25：`registerHoverLinkSource` 升真实无操作登记**（记录 source id 返回——Geode 全局悬停预览已覆盖插件渲染的 `a.internal-link`，无需插件参与）；插件自渲染预览 `hoverPopover`/`HoverParent` **仍为缺口**（插件被 Geode 全局 hover 被动覆盖，但其自挂 popover 不生效） |
| `app.internalPlugins`（书签 instance API） | **R27：书签数据文件 `.obsidian/bookmarks.json` 双向保真**（Geode 原生书签读写同一文件，未知键/类型 round-trip——见 ARCHITECTURE R27），但 `app.internalPlugins.getPluginById("bookmarks").instance`（`getBookmarks()`/`addItem()`/`removeItem()` 等程序化 API）**仍为缺口**（插件无法经 API 操作书签，只能间接经文件） |
| **R60 新登记 ↓（商业主轴 = 插件迁移，2026-06-14 全景调研 II code-verify）** | |
| `workspace.on('file-menu'/'editor-menu'/'files-menu')` 右键菜单钩子 | **缺**：Menu/MenuItem 基础设施已就绪（`compat/obsidian/ui.ts:506/583`），但宿主侧无 trigger（文件树/编辑器右键不发 `file-menu`/`editor-menu` 事件）。**生态高频**（无数插件靠它加右键项）；与原生 ㊿ 标签/文件右键菜单同根，宜一并接 |
| `Plugin.registerMarkdownPostProcessor` / `registerMarkdownCodeBlockProcessor` | **缺**：**生态影响最大单项**（Dataview / Tasks 等明星插件依赖）。需阅读侧 `core/markdown.ts` + 编辑侧 `liveBlockWidget`/`livePreview` 双线接 processor 管线，**工程大** |
| ~~`Plugin.registerEditorExtension`~~ | **R115 出队**：新 core `editorExtensions` 注册表桥接（compat 写、EditorPane 读+订阅 revision）；新 compat compartment，register/dispose 经 revision reconfigure 所有 open view + 新 view seed。数据安全：reconfigure 无 doc change + autosave 是 view 外 updateListener → 编辑期注册不丢 |
| ~~`app.commands`（executeCommandById / listCommands / commands / findCommand / executeCommand / editorCommands）~~ | **R113+R118 出队**：架在 core `CommandRegistry` 上（共享原生 palette 注册表）。R113=executeCommandById（尊重 available 预检）/listCommands/commands（name thunk 解析成 string）。R118=findCommand(id)/executeCommand(command, by-id 回查)/editorCommands。**R121=removeCommand(id)**（新 core CommandRegistry.removeById=delete+revision bump，与 register disposer 逐字段一致）。**app.commands 全成员完成。** **偏离**：editorCommands 恒 `{}`（Geode 不单独追踪 editor-scoped）；executeCommand 不执行未注册的传入对象 |
| ~~`vault.readBinary` / `createBinary` / `modifyBinary`~~ | **R111+R120 出队**：R111=readBinary/createBinary 桥接 core 原生二进制 IO（toArrayBuffer 拷贝防别名、createBinary 返 TFile、连带修 core createBinary 缺的 assertSafeRelPath）。**R120=modifyBinary**（二进制覆盖写）——新 Rust `vault_modify_binary` 原子 tmp+rename（覆盖且无截断竞态，crash 只丢 tmp）。图片/PDF/Excalidraw 类插件可读/写/改附件。`DataAdapter.writeBinary` 仍 create-only（覆盖走 Vault.modifyBinary） |
| ~~`MarkdownView.getMode/getViewData/setViewData`~~ / `setMode` + ~~`workspace.activeEditor`~~ | **部分**：~~getMode/getViewData~~（**R116 出队**）+ ~~activeEditor~~（**R117 出队**：live getter→makeActiveMarkdownView，MarkdownFileInfo 超集）+ ~~setViewData~~（**R123 出队**：editor.setValue→CM dispatch→autosave 安全落盘，clear 忽略；**没用 handle.setText[会静默丢数据]**）。`setMode`（内部 MarkdownSubView 参数）+ `MarkdownFileInfo.hoverPopover` 仍缺。**已知偏离**：阅读视图非 CM-backed → reading mode active MarkdownView 返 null |
| ~~`MetadataCache.getTags()`~~ + ~~`CachedMetadata.embeds`~~/`sections/listItems/frontmatterLinks` + ~~`fileManager.generateMarkdownLink`~~ | **部分**：~~getTags~~（**R114 出队**：投影 core `getTagMap`→`Record<string,number>`，大小写敏感 deferred 偏离）+ ~~embeds~~（**R119 出队**：`![[..]]` wikilink 嵌入从 links 拆出，original/position 含 `!`；**偏离 O1**：EmbedCache.link 丢 `#anchor`+无 alias 不派生 displayText[既有]；**O2**：转义 `\![[]]` 误判为 embed[罕见]）+ getFileCache 形状余项 sections/listItems（大）+ ~~generateMarkdownLink~~（**R112 出队**） |
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

### R123 套件回归（2026-06-20，macOS release 二进制 v0.120.0 实测 `r123-probe-vault`）

R123 = compat `MarkdownView.setViewData`（编辑器全文替换，**插件 API 商业主轴**，**动 editor 写=data-safety**）。`setViewData(data, clear)` = `editor.setValue(data)` → 一笔 undoable CM 事务 → doc-change listener → autosave（正常保存周期）。clear 忽略（保持普通 undoable edit）。setMode 留 gap（内部 MarkdownSubView 参数）。**对抗评审 data-safety 优先 → 0 confirmed 代码缺陷**；**关键正确决策**：用 editor.setValue（标脏+调度保存）而非 handle.setText（后者不标脏永不保存=静默丢数据）。

新增套件：`r123-e2e.mjs` **7/7**（替换/CM doc 全替换/**autosave 落盘**/shorter 无残留/clear 忽略/替换后仍可编辑）+ `r123-probe.mjs` **3/3**（真 WKWebView 表面+null-guard；write 语义归 browser-E2E）。**套件矩阵不回退**：**r24 12/12（autosave 数据安全）**·r116 9/9·r117 9/9·r23 22/22·r46 18/18。

### R122 套件回归（2026-06-20，macOS release 二进制 v0.119.0 实测 `r122-probe-vault`）

R122 = compat `DataAdapter.writeBinary` 创建或覆盖（**插件 API 商业主轴**；从 sections parser 过重 pivot 而来）。try createBinary（新文件入树）→ catch modifyBinary（R120 原子覆盖）。**对抗评审揪出 MAJOR 并发数据安全隐患**：R120 `vault_modify_binary` 的 tmp 名确定性 per-path（`.{name}.geode-tmp`），两并发同 path 覆盖共享 tmp → 撕裂 half-A-half-B 写（R17 共享-tmp clobber 在覆盖路径复发），R122 高频 adapter.writeBinary 入口放大。**修**：抽 `atomic_write` 唯一 tmp（`.{name}.{pid}.{seq}.geode-tmp`），vault_write+vault_modify_binary 同改 → 每写者私有 tmp、last-writer-wins 完整文件。+ Memory modifyBinary folder 守卫（minor）。

新增套件：`r122-e2e.mjs` **9/9**（create/overwrite/folder-guard/path-guard）+ `r122-probe.mjs` **9/9**（真 WKWebView——create/overwrite + **16 并发同 path = 单写者完整 buffer 无撕裂 + HOST 带外读盘 + 无 tmp 残留**）。**套件矩阵不回退**：**r24 12/12（vault_write 数据安全，helper 重构零回归）**·r111-e2e 12/12·r111-probe 9/9·r42 17/17·r46 18/18·r23 22/22。

### R121 套件回归（2026-06-20，macOS release 二进制 v0.118.0 实测 `r121-probe-vault`）

R121 = compat `app.commands.removeCommand`（**插件 API 商业主轴**，收 R113/R118 余项——**app.commands 全成员完成**）。新 core `CommandRegistry.removeById(id): boolean`（delete + parsedCache=null + revision bump，与 register disposer 逐字段一致；未知 id 不 bump）。compat removeCommand = registry.removeById（丢 boolean 返 void）。**对抗评审 6 维 + obsidian-typings 核签名（string id 非 Command 对象）→ 0 confirmed 代码缺陷**。

新增套件：`r121-e2e.mjs` **10/10**（removeCommand 返 void/findCommand/exec/list/commands 全移除·kept 存活·未知 no-op·删后 re-register）+ `r121-probe.mjs` **9/9**（真 WKWebView 共享 registry，registry 级桌面全验）。**套件矩阵不回退**：r113 10/10·r118 13/13·r23 22/22。

### R120 套件回归（2026-06-20，macOS release 二进制 v0.117.0 实测 `r120-probe-vault`）

R120 = compat `Vault.modifyBinary`（二进制原子覆盖写，**插件 API 商业主轴**，收 R111 显式 gap）。新 Rust `vault_modify_binary`（dot-prefixed tmp + rename，镜像 text vault_write）→ 覆盖且无截断竞态（crash 中途只丢 throwaway tmp、原文件完好）。core Vault.modifyBinary（assertSafeRelPath + 无 refreshTree + emit modified）/ MemoryVaultAdapter overwrite / TauriVaultAdapter invoke。**对抗评审 data-safety 优先全维 → Rust/core 0 缺陷**。**reviewer 关键洞察**：browser e2e 跑 Memory adapter（plain set 无 tmp+rename）→「无残留」断言 tautological，真原子写唯桌面 probe 能验 → probe HOST 带外读真实落盘文件验证。

新增套件：`r120-e2e.mjs` **8/8**（覆盖往返/SHRINK 无残留/GROW/createBinary 仍 create-only/path guard）+ `r120-probe.mjs` **8/8**（真 WKWebView 原生 fs——SHRINK 10→3 精确无残留 + **HOST 带外读盘文件精确 + 无 `.geode-tmp` 残留** + path guard）。**套件矩阵不回退**：r111-e2e 12/12（gap→overwrite）·r111-probe 9/9·r42 17/17（createBinary intact）·r46 18/18·r23 22/22。

### R119 套件回归（2026-06-20，macOS release 二进制 v0.116.0 实测 `r119-probe-vault`）

R119 = compat `CachedMetadata.embeds`（getFileCache 形状补全，**插件 API 商业主轴**，缺口表出队）。`![[..]]` wikilink 嵌入从 .links 拆出进 .embeds（Obsidian 分开；R119 前所有 link 含嵌入都进 .links=既有偏差）。core WIKILINK_RE 不捕获前导 `!`（`![[foo]]` 索引为 wikilink、`!` 在 from-1），buildCache 按 `content[from-1]==="!"` 拆分，embed 的 original/position 含 `!`。纯读、零改 core。**对抗评审 6 维 → 0 confirmed 代码缺陷**（字节对齐核实、links 移除零回归=唯一内部消费者 fixture.ts 只读 headings/blocks）。**偏离**：O1 EmbedCache.link 丢 anchor（既有）+ O2 转义 `\![[]]` 误判（罕见）。

新增套件：`r119-e2e.mjs` **10/10**（embeds 含 2 嵌入/original 含 `!`/alias displayText/position·links 不含嵌入·只 link/只 embed 缺省）+ `r119-probe.mjs` **7/7**（真 WKWebView 原生 fs index——metadata 级无需 editor mount → 桌面全验）。**套件矩阵不回退**：r23 22/22·r46 18/18·r70 23/23。

### R118 套件回归（2026-06-20，macOS release 二进制 v0.115.0 实测 `r118-probe-vault`）

R118 = compat `app.commands` 余项 findCommand/executeCommand/editorCommands（**插件 API 商业主轴**，扩展 R113）。over 同一 core CommandRegistry。findCommand(id)→CompatCommand|undefined；executeCommand(command)→by-id 回查 executeById（尊重 available）；editorCommands 恒 `{}`（Geode 扁平 editor-scoped）。抽 find/executeById 共享 local（executeCommandById 逐字节等价）。**对抗评审 6 维 → 0 confirmed 代码缺陷**；**偏离**：editorCommands 空集 + executeCommand 不跑未注册传入对象（文档化）。

新增套件：`r118-e2e.mjs` **13/13**（findCommand 命中/thunk/未命中·executeCommand 跑/available 不跑/未知/round-trip·editorCommands 空·R113 回归）+ `r118-probe.mjs` **10/10**（真 WKWebView 共享 registry——registry 级无需 editor mount → 桌面全验）。**套件矩阵不回退**：r113 10/10·r23 22/22·r46 18/18。

### R117 套件回归（2026-06-20，macOS release 二进制 v0.114.0 实测 `r117-probe-vault`）

R117 = compat `Workspace.activeEditor`（MarkdownFileInfo，**插件 API 商业主轴**，缺口表出队）。live getter → `makeActiveMarkdownView`（复用 R116）；compat MarkdownView 即 MarkdownFileInfo 超集（editor/file/app）。新插件首选（替代 getActiveViewOfType）。纯读、零改 core、零新 import。**对抗评审 6 维 → 0 confirmed 代码缺陷**（无 R116 两源发散——只读单源 getActiveView 不读 tab mode；app 时序安全——_setApp 同步早于 plugin load）。

新增套件：`r117-e2e.mjs` **9/9**（.editor/.file/.app·切文件跟随·getValue 反映新内容·与 activeLeaf.view 同源·reading mode null 偏离·回 live 恢复）+ `r117-probe.mjs` **4/4**（真 WKWebView 表面+getter+null-guard；editor-mount headless 不可达→字段语义归 browser-E2E）。**套件矩阵不回退**：r116 9/9·r23 22/22·r46 18/18。

### R116 套件回归（2026-06-20，macOS release 二进制 v0.113.0 实测 `r116-probe-vault`）

R116 = compat `MarkdownView.getMode` + `getViewData`（读子集，**插件 API 商业主轴**，缺口表出队）。getMode hardcode "source"（compat MarkdownView 只在编辑模式经 getActiveView 构建、阅读视图非 CM-backed）；getViewData = `editor.getValue()` live 源文本。**对抗评审揪出 1 minor**：首版读 active TAB 的 mode 映射，但 active tab（findActiveTab 活动面板）与 active editor（getActiveView focus 追踪）是两独立活动源、split/瞬态时发散 → getMode 在 live 编辑器误报 "preview"；修 = hardcode "source"（纯减法，更简且严格更正确）。**已知偏离**：阅读视图返 null MarkdownView（Obsidian 返 view+"preview"）。

新增套件：`r116-e2e.mjs` **9/9**（live/source getMode "source"·getViewData 源文本+反映实时编辑+=== CM doc·reading mode active view null 偏离·回 live 恢复）+ `r116-probe.mjs` **3/3**（真 WKWebView compat 表面 + makeActiveMarkdownView null-guard；editor-mount headless 不可达[R115/§D]→语义归 browser-E2E 平台同码）。**套件矩阵不回退**：r23 22/22·r46 18/18。

### R115 套件回归（2026-06-20，macOS release 二进制 v0.112.0 实测 `r115-probe-vault`）

R115 = compat `Plugin.registerEditorExtension`（让插件注入 CM6 编辑器扩展，**插件 API 商业主轴**，缺口表出队）。**跨模块契约**：新 `core/editorExtensions.ts` 注册表（compat 写、features/editor 读+订阅 revision——compat 绝不 import features 经 core 桥）+ 新 EditorPane compat compartment。register/dispose 经 revision reconfigure 所有 open view，新 view 经 getEditorExtensions seed。**动 editor → data-safety 优先**：对抗评审确认 reconfigure 无 doc change + 待存编辑活在 handle（view 外 updateListener）+ register 不重建 view → 编辑期 register/dispose/unload 不丢数据。**0 confirmed 代码缺陷**（修 1 minor 注释精度：数组位置非保护机制，Prec.highest+updateListener 才是）。

新增套件：`r115-e2e.mjs` **7/7**（register 达已开 view/达新 view/**编辑 autosave 落盘**/dispose 移除/幂等）+ `r115-probe.mjs` **7/7**（真 WKWebView core 注册表 sync：register 增长+rev bump/dispose 收缩+rev bump/幂等；view 集成属 browser-E2E，§D 桌面只验 sync）。**套件矩阵不回退**：r24 12/12（autosave 数据安全）·r88 13/13·r92 21/21·r50 15/15·r63 9/9·r23 22/22。

### R114 套件回归（2026-06-20，macOS release 二进制 v0.111.0 实测 `r114-probe-vault`）

R114 = compat `MetadataCache.getTags(): Record<string,number>`（**插件 API 商业主轴**，缺口表出队）。投影 core `getTagMap`（tag→note-path Set，缓存）→ `#` 前缀 key + distinct 笔记数（对齐 Obsidian getAllTags per-file 聚合）。`#` 前缀顺带消解 R113 `__proto__` 类风险（literal `__proto__` 标签→key `#__proto__` 安全 own 属性）。**对抗评审 0 confirmed 缺陷**；**已知偏离（chief 拍板 deferred）= 大小写敏感**（Geode 全局标签模型大小写敏感，getTags 镜像之；只让 getTags 合并会内部不一致）。

新增套件：`r114-e2e.mjs` **12/12**（shape/`#`前缀/distinct 计数/大小写分离/frontmatter/nested `#a/b`/CJK/literal `#__proto__` 安全/live bump）+ `r114-probe.mjs` **8/8**（真 WKWebView 原生 fs index）。**套件矩阵不回退**：r99 16/16（tag graph 共享 getTagMap）·r69 36/36（tag rename）·r23 22/22·r113 10/10。

### R113 套件回归（2026-06-20，macOS release 二进制 v0.110.0 实测 `r113-probe-vault`）

R113 = compat `app.commands`（executeCommandById / listCommands / commands，**插件 API 商业主轴**，缺口表出队）。3 高频成员架在 core `CommandRegistry` 上（与原生 palette/hotkeys 共享同一注册表）。`executeCommandById` 尊重 `available` 预检（Obsidian 对 checkCallback 命令先 checkCallback(true)、false 不执行返 false）；命令名是 i18n thunk → `getCommandName` 解析成 string 给插件。**对抗评审 0 confirmed 缺陷**（纯读 registry + 触发 callback、无 fs 写无新竞态；2 信息级观察：CompatCommand 缺 *Callback 变体=Geode 已扁平化、`__proto__` Record 边角实际不可达，均文档化不修）。

新增套件：`r113-e2e.mjs` **10/10**（executeCommandById 四态 + listCommands[含 seeded/name 全 string/thunk 解析/含 native] + commands record[映射/live 注销]）+ `r113-probe.mjs` **10/10**（真 WKWebView 共享 registry；fire-and-forget+IPC 轮询）。**套件矩阵不回退**：r23 22/22·r46 18/18·r112 16/16。

### R112 套件回归（2026-06-20，macOS release 二进制 v0.109.0 实测 `r112-probe-vault`）

R112 = compat `fileManager.generateMarkdownLink`（**插件 API 商业主轴**，缺口表「高影响低成本」项出队）。委托 core `formatLink`（R72 既有引擎）——按用户设置生成 wikilink 或 markdown link，alias/subpath/path-format 全支持、resolve-back 验证、总返 string（formatLink null → basename fallback）。**对抗评审揪出 1 MAJOR：formatLink markdown 分支 subpath 未编码**（`#Heading With Spaces` 在 MARKDOWN_LINK_RE href 组 `[^\s)]+` 处截断 → 整体 NO MATCH 渲染成纯文本）——formatLink 既有潜伏缺陷，generateMarkdownLink 首次把任意 heading 路由进 markdown 分支而暴露；修 = markdown subpath `encodeMdHref`（wikilink 分支保持 raw 合法）。

新增套件：`r112-e2e.mjs` **16/16**（wikilink shortest 基本/subpath/alias/空串 alias/省略 alias/子目录·总返 string fallback·markdown 基本/alias/**含空格 subpath %-编码**/block·absolute）+ `r112-probe.mjs` **9/9**（真 WKWebView 原生 fs index；fire-and-forget+IPC 轮询破时序死锁）。**套件矩阵不回退**：r72 26/26（formatLink 改动零回归）·r77 14/14·r26-bytes 0 违反·r111 12/12·r46 18/18·r23 22/22。

### R111 套件回归（2026-06-20，macOS release 二进制 v0.108.0 实测 `r111-probe-vault`）

R111 = compat 二进制 IO 桥接 `readBinary`/`createBinary`（**插件 API 商业主轴**，非原生候选池）。`compat/obsidian/vault.ts` 从抛 gap 改桥接 core 原生二进制 IO（图片/PDF/Excalidraw 类插件）。新私有 `toArrayBuffer`（拷贝防别名 Memory 内部存储）。`modifyBinary`/`appendBinary`/二进制覆盖写仍诚实 gap（core 写 create-only）。**评审连带修 core `createBinary` 缺失的 `assertSafeRelPath`**（桥接后不可信插件 path 直达原未守的 core，浏览器 MemoryVaultAdapter 无 path 校验 → `..` 会污染 store；订正 `:442` 失实注释）。

新增套件：`r111-e2e.mjs` **12/12**（compat createBinary→readBinary 往返·桥到 core 真桥接·adapter.writeBinary 创建往返·返回 buffer 是拷贝不别名·modifyBinary/覆盖写诚实抛·**`..`/绝对 path 被 core guard 拒 + 无泄漏**）+ `r111-probe.mjs` **9/9**（真 WKWebView 原生 fs；探针 fire-and-forget+IPC 轮询 `window.app` 破 loadExternal/loadObsidianPlugins 时序死锁与 App-Nap）。**套件矩阵不回退**：r23 22/22·r27 22/22·r46 18/18·r42 17/17（compat + 附件二进制 IO 全绿）。

### R110 套件回归（2026-06-20，macOS release 二进制 v0.107.0 实测 `r110-probe-vault`）

R110 = graph 局部图谱 Neighbor links toggle（候选池 ㊵ 续 slice）。对照 Obsidian local graph 第三 toggle：Neighbor links ON=显示邻居间互连边、OFF=只显示触锚点的星形边。纯客户端（graphPrefs 纯函数 `localEdges` + GraphView 消费，零改 getGraph），默认 ON=零回归。R103 已做 depth+in/out，本轮第三件。

新增套件：`r110-e2e.mjs` **10/10**（localEdges probe[ON 全留/OFF 只 incident 丢 B↔C/global 不滤/精确丢 between-neighbour]·prefs 默认 ON+兼容+显式 false·local-mode toggle 在/持久/global 隐藏）+ `r110-probe.mjs` **5/5**（真 WKWebView，`__geodeLocalEdges` neighbor-links 边筛）。**套件矩阵不回退**：r78/r84/r99/r101/r103 graph 全套绿。

### R109 套件回归（2026-06-20，macOS release 二进制 v0.106.0 实测 `r109-probe-vault`）

R109 = wikilink `[[note#^` 块引用补全（候选池 ㊹ 续 slice，收官 ㊹）。对照 Obsidian：`[[note#^` 列块引用、显示块文本预览（按内容选）、插 `[[note#^id]]`。块早已索引 + navigate → 本轮加补全 surface（首个 async 补全源，读笔记取预览，因 BlockRef 无 text）。复用 R106 applyLink。

新增套件：`r109-e2e.mjs` **12/12**（wikilinkBlockTargets probe[`#^`/self-link/heading 路由/无块/不可解析]·`[[note#^` 按内容过滤选插 `[[ZZBlk#^blkfox]]`·无 caret heading 零回归·file 零回归）+ `r109-probe.mjs` **7/7**（真 WKWebView，`__geodeBlockComplete` async 真 fs 块解析 + 预览）。**套件矩阵不回退**：r31/r41/r106/r107/r108 补全 + r24/r70 链接全绿。**㊹ wikilink 补全增强收官**（alias/heading/attachment/block）。

### R108 套件回归（2026-06-20，macOS release 二进制 v0.105.0 实测 `r108-probe-vault`）

R108 = `[[` 补全列非 md 附件候选（候选池 ㊹ 续续 slice，核心功能）。对照 Obsidian：`[[` 列附件、插 `[[image.png]]`（含扩展名）、`![[image.png]]` 嵌入。附件早已 resolve + 渲染 → 本轮加补全 surface，串起 R102-R105 附件 + R106-R108 补全。纯前端、零写 .md，复用 R106 applyLink。

新增套件：`r108-e2e.mjs` **12/12**（wikilinkAttachmentCandidates probe[歧义→全路径]·`[[zzpic` 补全 offer/insert `[[zzpic.png]]`·`![[` 嵌入 insert `![[zzpic.png]]`·resolve 验证·无 `#` md note 补全零回归）+ `r108-probe.mjs` **7/7**（真 WKWebView，`__geodeWikilinkAttachments` 真 fs 含 md/无扩展名排除 + 歧义全路径）。**套件矩阵不回退**：r31/r41/r106/r107 补全 + r24/r70 链接全绿。

### R107 套件回归（2026-06-20，macOS release 二进制 v0.104.0 实测 `r107-probe-vault`）

R107 = wikilink `[[note#` 标题补全（候选池 ㊹ 续 slice，核心功能）。对照 Obsidian：`[[note#` suggest 目标笔记标题、`[[#` suggest 当前笔记标题、插 `[[note#Heading]]`。标题早已索引 + `[[note#h]]` 早已 navigate → 本轮加补全 surface。纯前端、零写 .md，复用 R106 applyLink。

新增套件：`r107-e2e.mjs` **12/12**（wikilinkHeadingTargets probe 6 case·`[[note#` CM 补全 offer/unsafe-filter/insert `[[ZZHead#Setup]]`·`[[#` self-link·无 `#` file 补全零回归）+ `r107-probe.mjs` **6/6**（真 WKWebView，`__geodeHeadingComplete` 真 fs 标题解析）。**套件矩阵不回退**：r31/r41 补全 + r106 alias + r24/r70 链接全绿。

### R106 套件回归（2026-06-20，macOS release 二进制 v0.103.0 实测 `r106-probe-vault`）

R106 = frontmatter aliases 在 suggester 层 surface（候选池 ㉟ 续 slice，核心功能）。对照 Obsidian：QuickSwitcher 按 name 或 alias 开笔记 + `[[` 补全 suggest alias（插 `[[canonical|alias]]`）。**Gate 救场**：alias 解析早已实现（resolveLink/nameToPaths）→ 真缺口是两 suggester 不 surface。纯加性 `getAliasMap`，零改解析层。

新增套件：`r106-e2e.mjs` **12/12**（getAliasMap probe·QuickSwitcher alias 开笔记+canonical hint·`[[` alias 补全插 `[[canonical|alias]]`·无-alias 零回归·bracket-alias skip 锁）+ `r106-probe.mjs` **4/4**（真 WKWebView，`__geodeAliasMap` 真 fs frontmatter 解析）。**套件矩阵不回退**：r31/r41 补全 + r47 switcher + r24/r70 链接全绿。

### R105 套件回归（2026-06-20，macOS release 二进制 v0.102.0 实测 `r105-probe-vault`）

R105 = Unsupported file denylist 翻转（候选池第六梯队 ㊽ 续续续续续续续 slice，数据安全收尾）。对照 Obsidian「Accepted file formats」：只 markdown 是 note，其余视作 media-viewable 或 Unsupported（只读）。`isAttachmentPath` 翻 allowlist→denylist：md+已知文本/代码+无扩展名可编辑，其余（含未知扩展名）只读。堵 R102/R104 评审标记的「未知二进制仍可编辑→损坏」洞。

新增套件：`r105-e2e.mjs` **12/12**（OLD_ATTACH 69 binary/media symmetric diff 零 flip·文本/代码全可编辑·未知扩展名只读·无扩展名可编辑·端到端路由·数据安全无 handle·plist 只读锁）+ `r105-probe.mjs` **6/6**（真 WKWebView，`__geodeAttachmentRouting` denylist 路由）。**套件矩阵不回退**：r102 20/20 + r104 19/19。**attachment 全链 R102+R104+R105 收官。**

### R104 套件回归（2026-06-20，macOS release 二进制 v0.101.0 实测 `r104-probe-vault`）

R104 = attachment viewer 续：audio/video/pdf 内联预览（候选池第六梯队 ㊽ 续续续续续续 slice，原生功能）。对照 Obsidian 原生媒体查看：非图片媒体从 R102 只读占位改 `<audio>`/`<video>`/`<embed>` 内联预览。**数据安全核心不变**：仍只 readBinary 裸读、绝不 documents.acquire。`core/attachments` mediaKind 分类，`isAttachmentPath` 总集与 R102 字节相同 + 仅新增 {3gp,ogv}（reviewer 对称差验证零丢失）。

新增套件：`r104-e2e.mjs` **19/19**（mediaKind 分类含 proto-safety fix·audio/video/pdf 真元素 blob 渲染·zip 占位·数据安全无 handle）+ `r104-probe.mjs` **12/12**（真 WKWebView，`__geodeMediaKind` 分类 + mime）。**套件矩阵不回退**：r102 20/20（pdf→placeholder 断言改用 .zip，因 pdf 现可预览）。

### R103 套件回归（2026-06-20，macOS release 二进制 v0.100.0 实测 `r103-probe-vault`）

R103 = 局部图谱增强（候选池第六梯队 ㊵ 续续续续续 slice，原生功能）。对照 Obsidian local graph：depth 滑块 1-5（Geode 原 1|2）+ Incoming/Outgoing 链接方向 toggle。**纯客户端**（graphPrefs 纯函数 `localSubgraph` + GraphView 消费，零改 getGraph 形状），默认 depth:1 + both 方向 on = R43 旧无向局部 BFS **逐字节等价**（reviewer 140k fuzz 验证零回归）。**注：Daily notes/Calendar 已在 R43/R48 完成——gate 发现候选池条目陈旧改取本项。**

新增套件：`r103-e2e.mjs` **23/23**（localSubgraph 方向[both/out/in/none]+depth+over-deep 有界探针·prefs depth 1-5 clamp + 方向默认 true + 向后兼容·local-mode depth select 5 option + 方向 toggle 持久·global 模式隐藏）+ `r103-probe.mjs` **8/8**（真 WKWebView，`__geodeGraphLocal` 方向/depth）。**套件矩阵不回退**：r78/r84/r90/r99/r101 graph 全套绿。

### R102 套件回归（2026-06-20，macOS release 二进制 v0.99.0 实测 `r102-probe-vault`）

R102 = 非 md 文件只读查看视图 attachment viewer（候选池第六梯队 ㊽ 续续续续续 slice，原生功能）。对照 Obsidian：非 md 图片/二进制开只读查看器（图片预览 / 其余 Unsupported 占位），不当 markdown 编辑。**数据安全核心**：新 `viewType:"attachment"` 绝不进 `documents.acquire` 编辑/autosave 路径——堵住「点 .png → 当 md 解码乱码 → 编辑损坏二进制」的既有 wart。allowlist 路由（md/文本仍可编辑=零回归）。

新增套件：`r102-e2e.mjs` **20/20**（路由→viewType·只读无 editor handle·二进制占位·md 仍可编辑·开新 tab 不替换·dedup·rename retarget·delete close·persist save+sanitize 往返·评审 fix 1a 恢复重算 viewType·fix 1b 跨类型 rename 翻转只读）+ `r102-probe.mjs` **11/11**（真 WKWebView：isAttachmentPath/isImagePath 分类含 docx/heic/exe + 真文件 open→viewType）。**套件矩阵不回退**：r37/r24/r45/r93/r42/r28/r44/r97/r70/r101/r36/r50/r23 共 13 套全绿（workspace.ts + vault.ts 改动经 tab/rename/delete/binary/autosave 套件验证）。附带修浏览器模式 MemoryVaultAdapter 二进制 rename/remove。

### R101 套件回归（2026-06-20，macOS release 二进制 v0.98.0 实测 `r101-probe-vault`）

R101 = 附件作图谱节点 attachments as graph nodes（候选池第六梯队 ㊵ 续续续续 slice，原生功能）。对照 Obsidian 图谱「Attachments」toggle：非 md 附件作**黄节点**、与嵌入/链接它的笔记连边。**纯前端 read-only 客户端合并**（`metadata.getAttachmentMap` + `buildAttachmentGraph`，不改 getGraph 形状），逐字镜像 R99 tags-as-nodes，默认 OFF=零回归。附带修 getGraph：附件引用不再当 unresolved 幽灵节点（贴近 Obsidian）。

新增套件：`r101-e2e.mjs` **23/23**（probe 构造·getGraph 去幽灵·prefs 默认 OFF+向后兼容·toggle 持久+legend delta·**click 路由=附件 openFile 真文件不生成幽灵 tab**·评审 #1 markdown 附件链接·评审 #2 后置创建附件出现）+ `r101-probe.mjs` **7/7**（真 WKWebView，`__geodeGraphAttachments` 真 fs 附件索引）。**套件矩阵不回退**：r99/r84/r90/r96/r98 全绿（getGraph 改动经 4 图谱套件验证）。缺口表 graph 行附件节点缺口划除。

### R100 套件回归（2026-06-19，macOS release 二进制 v0.97.0 实测 `r100-probe-vault`）

R100 = Show tab title bar + Show status bar（候选池第六梯队 ㊺ 续续续 slice，原生功能）。对照 Obsidian Appearance/Interface：Show tab title bar（显隐窗格标签栏）+ status bar 显隐。**纯前端 view-only**（appearance Store + 条件渲染 + 设置 toggle），逐字镜像 R94 showInlineTitle/showRibbon 范式，默认 ON=零回归。

新增套件：`r100-e2e.mjs` **15/15**（tab bar 默认显·toggle 隐→显·隐藏不丢 tab + status bar 同 + setChrome 往返）+ `r100-probe.mjs` **5/5**（真 WKWebView，`__geodeAppearance.setChrome`）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（chrome toggle 纯前端）；不碰 markdown.ts → **r26-bytes 不涉及**；TabBar 条件 return null（hooks 后）+ status footer 条件渲染、status 插件项 Store App 顶层无条件订阅（footer 卸载不报错） → **r94(inline title/ribbon)14/14 + r36(tabs)47/47 + r66(status bar)8/8 + r50(appearance)15/15 + r99(tags 节点)16/16 回归绿**。**对抗评审 6 维深挖 TabBar hooks 顺序/tab 丢失/status 插件 unmount → 0 confirmed**（EditorPane 是 TabBar 兄弟不被卸载=脏 tab 不困、PluginElementHost detach/reattach 同 R94）。**OBSIDIAN-COMPAT 缺口表**：㊺ tab title bar+status bar 交付（㊺ 外观补全续缺口：Native title bar / 半透明窗口 / Translucent——多需 Tauri 窗口能力）。

### R99 套件回归（2026-06-19，macOS release 二进制 v0.96.0 实测 `r99-probe-vault`）

R99 = 标签作图谱节点 tags as graph nodes（候选池第六梯队 ㊵ 续续续 slice，原生功能）。对照 Obsidian 图谱「Tags」toggle：标签作绿色节点 + 与含标签的笔记连边。**纯前端 read-only 客户端合并**（新纯函数 `buildTagGraph` + toggle，零改 getGraph/GraphNode 形状），默认 OFF=零回归。

新增套件：`r99-e2e.mjs` **16/16**（buildTagGraph 度数 + prefs 默认关·向后兼容 + 真图谱 toggle·legend 增 tag-node 数 + tag-click 开搜索不开 tab/note-click 开文件[MAJOR 锁]）+ `r99-probe.mjs` **7/7**（真 WKWebView，净库精确 2 标签节点/度/3 边）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（标签节点纯前端客户端）；不碰 markdown.ts → **r26-bytes 不涉及**；GraphNode 形状不变（tag 节点 id 前缀区分，沿用 `unresolved:` 惯例）、tags 走既有 exclude/filter/sample 管线 → **r78(graph 设置)16/16 + r84(graph 过滤)17/17 + r90(分组着色)17/17 + r96(excluded)17/17 + r98(more context)15/15 回归绿**。**对抗评审 6 维深挖（特别盯点击 tag 节点）→ 1 确认 MAJOR（已修）+ 5 维证伪**：MAJOR=点击 tag 节点 openNode 仅按 resolved 判→openFile("tag:…")→破损持久幽灵 tab（漏给 click handler 加 TAG_PREFIX 守卫）→ 修 openNode 加 tag 守卫 → requestSearch（对齐 Obsidian/TagsPanel）+ 加 `__geodeGraphClickNode` 探针锁。**OBSIDIAN-COMPAT 缺口表**：㊵ 标签作节点交付（㊵ 续缺口仅剩：附件作节点 / 嵌套标签层级 / 标签↔标签连边）。

### R98 套件回归（2026-06-19，macOS release 二进制 v0.95.0 实测 `r98-probe-vault`）

R98 = 反链「Show more context」（候选池第六梯队 ㊷ 续 slice，原生功能）。对照 Obsidian 反链面板「Show more context」toggle：片段从匹配行扩展到周围整段。**纯前端 read-only 面板侧现算**（新 `buildParagraph` + toggle，linked 仅 toggle 开时重读源），**零改 getBacklinks/索引**（规避 R82 延期理由）。

新增套件：`r98-e2e.mjs` **15/15**（整段边界 probe + 真面板 行→整段 + 隔离段 + 持久化 + toggle-off + F1 切档陈旧守卫）+ `r98-probe.mjs` **6/6**（真 WKWebView，`__geodeBacklinkParagraph` 边界）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（反链整段纯前端）；不碰 markdown.ts → **r26-bytes 不涉及**；面板侧 buildParagraph + linked async 重读 gated on moreContext、getBacklinks/BacklinkEntry 契约不动 → **r82(反链工具栏)27/27 + r62(出链)14/14 + r80(搜索 UI)17/17 + r97(Move to)15/15 回归绿**。**对抗评审 6 维深挖整段边界/async 竞态/data-safety → 0 critical/major + 2 minor（F1 切档陈旧整段[map 标 activePath guard]/F2 过度失效[依赖 data.backlinks 非 shownBacklinks]全修+F1 补 e2e）**。**OBSIDIAN-COMPAT 缺口表**：㊷ Show more context 交付（㊷ 续缺口仅剩：笔记底部内嵌 backlinks / 修改·创建时间排序需 adapter stat）。

### R97 套件回归（2026-06-19，macOS release 二进制 v0.94.0 实测 `r97-probe-vault`）

R97 = 右键「Move to…」文件夹选择器（候选池第六梯队 ㊽ 续续续续 slice，原生功能）。对照 Obsidian 文件浏览器右键「Move file to…」：fuzzy 文件夹建议器选目标移文件。**复用既有 vetted moveNode**（R28/R16/R70 renameWithLinkUpdate），本轮零新写机制；新 fuzzy picker（`MoveToModal.tsx` 镜像 QuickSwitcher）+ 纯函数 `moveTargets`。

新增套件：`r97-e2e.mjs` **15/15**（moveTargets 枚举 + 真 picker 移动→Dest·内容保留·md 链接移后仍解析[data-safety] + fuzzy 过滤 + Esc 不移动关闭 + 移到 root）+ `r97-probe.mjs` **6/6**（真 WKWebView+真 fs，`__geodeMoveFolders` 候选枚举）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（移动走既有 renameWithLinkUpdate）；不碰 markdown.ts → **r26-bytes 不涉及**；移动写路径 = vetted moveNode（resolveDropTarget 四守卫 + wouldCollide + R16/R70 改写引擎）→ **r28(拖拽移动)23/23 + r70(md 链接改写)23/23 + r44(文件夹改名)25/25 + r24(autosave/flush)12/12 + r93(右键菜单)22/22 + r96(excluded)17/17 回归绿**。**对抗评审 6 维深挖 data-safety 写路径/moveTargets 正确性/picker 生命周期/模态焦点 → 0 critical/major + 1 minor（React key 冲突病态——root 行键与文件夹路径同命名空间，已修不同前缀）**。**OBSIDIAN-COMPAT 缺口表**：㊽ 右键菜单 Move to 交付（㊽ 续缺口仅剩：detect-all-extensions / 非 md 查看视图 / Reveal in Finder[硬边界]）。

### R96 套件回归（2026-06-19，macOS release 二进制 v0.93.0 实测 `r96-probe-vault`）

R96 = Excluded files 排除列表（候选池第六梯队 ㊽ 续续续 slice，原生功能）。对照 Obsidian Settings>Files&Links>「Excluded files」：路径模式（glob `*` / `{regex}`）匹配的文件从搜索+图谱隐藏、文件树变暗（仍可打开）。**纯前端 read-only 过滤**（新 `core/excludedFiles.ts isExcluded` 单一谓词接 search/graph/explorer 三消费者），不写 .md、不动 markdown.ts。

新增套件：`r96-e2e.mjs` **17/17**（模式匹配 9 例[folder/ext glob + {regex} 锚定 + 非法忽略 + `?` 字面] + 真搜索排除 + explorer dim + 反应式 clear→现+亮）+ `r96-probe.mjs` **12/12**（真 WKWebView，`__geodeExcluded` glob/regex 匹配）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（排除过滤纯前端）；不碰 markdown.ts → **r26-bytes 不涉及**；search 扫描跳过 + graph rebuild 预过滤（R84 之前）+ explorer dim class 全加性 → **r80(search UI)17/17 + r68(search 运算符)40/40 + r84(graph 过滤)17/17 + r78(graph 设置)16/16 + r93(explorer 右键)22/22 + r91(explorer 排序)10/10 回归绿**。**对抗评审（reviewer subagent 两次中断→chief 亲评 6 维）→ 1 minor（glob 漏 escape `?`→当正则量词误匹配，已修+锁）+ 5 维证伪**（isExcluded 纯读不写、排除文件仍可点开[dim=opacity-only]、编译缓存无 stale、图谱预过滤无悬空边、反应式实测）。**OBSIDIAN-COMPAT 缺口表**：㊽ Excluded files 交付（续缺口：completion/quickswitcher/未链接提及接 isExcluded / 降权非硬隐藏精细度）。

### R95 套件回归（2026-06-19，macOS release 二进制 v0.92.0 实测 `r95-probe-vault`）

R95 = 代码块复制按钮（候选池第六梯队 ㊶ 续续 slice，原生功能）。对照 Obsidian 阅读视图代码块 hover→Copy（右上角复制代码）。**post-render hydration pass**（新 `codeCopy.ts`，镜像 hydrateEmbeds）——markdown.ts 不碰、按钮注入已渲染 DOM，reading view only。

新增套件：`r95-e2e.mjs` **12/12**（probe 匹配 + 真 clipboard 写[trim 尾换行] + Copied 反馈 + mermaid/query source-fallback 排除 + 真 mermaid+js 渲染仅 1 按钮）+ `r95-probe.mjs` **8/8**（真 WKWebView，`__geodeCodeCopy` 匹配逻辑）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（复制按钮纯前端 hydration）；**不碰 markdown.ts → r26-bytes 0 violations**（hydration 注入 DOM、渲染字节零回退）；hydration pass 与 hydrateEmbeds/mermaid/query 共存 → **r26(embeds)12/12 + r25(hover)17/17 + r75(query)16/16 + r55(live tables)15/15 + r94(inline title)14/14 回归绿**。**对抗评审 6 维深挖 DOM 生命周期/复制正确性/匹配精度/事件协调/XSS → 1 确认 MAJOR（已修）+ 1 minor（v1 gap）**：MAJOR=mermaid/query 的 `<pre class="geode-*-source">` source-fallback 在同步 hydrateCodeCopy 时仍在 DOM → 误加按钮（fixture 用空 div 遮蔽）→ 修 `pre.closest(".geode-mermaid,.geode-query")` 排除 + 真渲染断言；minor=note embed 内代码块 async 注入晚于同步 pass 拿不到按钮（v1 gap 记录）。**OBSIDIAN-COMPAT 缺口表**：㊶ 代码块复制按钮交付（续缺口：live preview 复制 / note embed 内代码块 / 语言标签 / blockquote 复制）。

### R94 套件回归（2026-06-19，macOS release 二进制 v0.91.0 实测 `r94-probe-vault`）

R94 = Show inline title + Show ribbon（候选池第六梯队 ㊺ 续续 slice，原生功能）。对照 Obsidian Appearance/Interface：Show inline title（文件名作 H1，默认 ON）+ Show ribbon（左侧功能区显隐，默认 ON）。**纯前端 view-only**（appearance Store + EditorPane/App 反应式 + 设置 toggle），不写 .md、不动 markdown.ts；inline title display-only（编辑→rename 延期）。

新增套件：`r94-e2e.mjs` **14/14**（inline title live/source/reading 三态 + toggle off→消失→on + ribbon 显→隐→复 + 持久化）+ `r94-probe.mjs` **5/5**（真 WKWebView，`__geodeAppearance.setToggles` Store+localStorage 往返）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（appearance toggle 纯前端）；不碰 markdown.ts → **r26-bytes 不涉及**；inline title 默认 ON 渲染于每篇笔记顶部（cm-host 同级/preview scroller 首子）+ ribbon 条件渲染 → 广跑 **r23(editor)22/22 + r25(hover)17/17 + r26(embeds)12/12 + r30(properties)25/25 + r50(appearance)15/15 + r88(行号/默认模式)13/13 + r74(slides)23/23 回归绿**（默认翻转零回归——inline title 是 preview-content 同级非内部、CM view 不重挂）。**对抗评审 6 维深挖 默认翻转/XSS/ribbon 锁死/反应式生命周期 → 0 confirmed critical/major/minor/nit**（tab.title rename 保鲜 + React 文本转义 + Ctrl+,/palette 独立于 ribbon + 片段位置稳定不重挂 cm-host）。**OBSIDIAN-COMPAT 缺口表**：㊺ inline title + ribbon 交付（续缺口：inline title 随内容滚动 + 编辑→rename / Show tab title bar / 状态栏显隐）。

### R93 套件回归（2026-06-19，macOS release 二进制 v0.90.0 实测 `r93-probe-vault`）

R93 = Explorer 右键上下文菜单补全（候选池第六梯队 ㊽ 续续 slice，原生功能）。**前置门 gate① 揭露 ㊽ 描述失准**：Explorer 早已有行右键菜单（New note here/New folder here/Rename/Delete）→ R93 朝 Obsidian 平价**加性扩展**：文件项 Open in new tab / Open to the right / Make a copy + 空白区根菜单 + R81 两轴 clamp + per-item testid。复用既有 vetted 路径（openFile/splitActivePane/createBinary/trash），零新依赖；Reveal in Finder/pop-out 延期（硬边界 #5）。

新增套件：`r93-e2e.mjs` **22/22**（文件/文件夹/根菜单项 + make-copy 创建·同内容·源不变·编辑副本再 copy 非陈旧·无扩展名无尾点 + open-in-new-tab + open-to-right 分 pane）+ `r93-probe.mjs` **9/9**（真 fs，`__geodeExplorerCopy` byte-identical + 唯一命名 + 子文件夹）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（右键菜单纯前端 + 复用 vetted vault 写）；不碰 markdown.ts → **r26-bytes 不涉及**；MemoryVaultAdapter `readFile` 加二进制回退 + 两 map 互斥（真 fs 平价）+ uniquePath ext="" 无尾点 → **r28(Explorer 移动)23/23 + r91(排序)10/10 + r24(autosave/flush)12/12 + r23(editor)22/22 + r89(createNewNote/uniquePath)16/16 回归绿**。**对抗评审 6 维深挖 data-safety 写路径 / readFile 回退 / 事件协调 / pane split → 0 confirmed critical/major + 3 minor（Finding 1 readBinary 陈旧[两 map 互斥修] / Finding 2 无扩展名尾点 / Finding 3 flushAll 进 try，全修）+ 1 注释订正**。desktop 写路径 `vault_write_binary` 用 `create_new(true)`=dest 撞硬错非覆盖、源只读。**OBSIDIAN-COMPAT 缺口表**：㊽ 右键菜单 Open/Copy/根菜单交付（续缺口：Move to…[文件夹 picker] / Reveal in Finder[Tauri opener=硬边界] / Open in new window[pop-out] / Bookmark / 多选批量 / excluded files / detect-all-extensions / 非 md 查看视图）。

### R92 套件回归（2026-06-19，macOS release 二进制 v0.89.0 实测 `r92-probe-vault`）

R92 = Tab 缩进设置（候选池第六梯队 ㊶ 续续 slice，原生功能）。对照 Obsidian Editor「Indent using tabs」（默认 ON）+「Tab indent size」（默认 4）。**纯前端 view/edit 配置**（appearance Store + CM `indentCompartment` 反应式 reconfigure + 设置 UI），不写 .md、不动 markdown.ts；默认对齐 Obsidian = 故意翻转（先例 R87）、不重写已存 .md。

新增套件：`r92-e2e.mjs` **21/21**（全链 set→reconfigure→真 Tab→断言插入字符 + clamp + persist + 设置 UI）+ `r92-probe.mjs` **9/9**（真 WKWebView，`__geodeIndentConfig` clamp+persist+pure 派生）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（缩进配置纯前端）；不碰 markdown.ts → **r26-bytes 不涉及**；`indentCompartment` 独立切片、effects-only reconfigure 不 dirty/不污染他 pane → **r88(行号 compartment)13/13 + r50(appearance)15/15 + r29(fold gutter)19/19 + r24(autosave/flush)12/12 回归绿**。**默认翻转致 live `editor:indent` 现插 `\t`：实跑抓回归 → r52 显式 pin `__geodeIndentConfig(2,false)` 后断言 + 加 tabs-on 集成（r52 12/12）**；全库扫唯 r52 受影响。**对抗评审 6 维深挖 CM facet 语义/compartment 生命周期/data-safety 写路径 → 0 confirmed critical/major/minor/nit**。**OBSIDIAN-COMPAT 缺口表**：㊶ Tab 缩进宽度 + Indent using tabs 交付（续缺口：自由数字输入 / 缩进参考线 / 代码块复制按钮 / fold 分项开关）。

### R91 套件回归（2026-06-16，macOS release 二进制 v0.88.0 实测 `r91-probe-vault`）

R91 = Explorer 文件树排序（候选池第六梯队 ㊽ slice，原生功能）。对照 Obsidian Explorer「File name A→Z / Z→A」。**纯展示层**（vault.ts sortTreeNodes + Explorer flattenVisible + toolbar toggle），不动 vault 存储序、不写 .md、不动 markdown.ts。

新增套件：`r91-e2e.mjs` **10/10**（sortTreeNodes 4 真值表[asc folders-first/desc/numeric/case] + 工具栏 toggle 重排 tree DOM + 持久化）+ `r91-probe.mjs` **5/5**（真 WKWebView，`__geodeSortTree`）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（排序纯前端展示层）；不碰 markdown.ts → **r26-bytes 不涉及**；sortTreeNodes 返回新数组不 mutate vault 存储序、name-asc comparator 逐字符等同 sortChildren → **r28(树拖拽/移动)23/23 回归绿**。**对抗评审 6 维深挖 name-asc 等同存储序 + 不 mutate folder.children → 0 confirmed critical/major/minor/nit**。**OBSIDIAN-COMPAT 缺口表**：㊽ 文件名排序交付（续缺口：mtime/ctime 排序需 adapter stat / 右键菜单完整化 / excluded files）。

### R90 套件回归（2026-06-16，macOS release 二进制 v0.87.0 实测 `r90-probe-vault`）

R90 = 图谱分组着色 color groups（候选池第六梯队 ㊵ 续续 v1，原生功能）。对照 Obsidian 图谱 Groups（每组=查询+颜色，匹配节点染色）。**纯客户端着色**（GraphView draw + graphPrefs.ts），零改 getGraph、不写 .md、不动 markdown.ts。

新增套件：`r90-e2e.mjs` **17/17**（nodeGroupColor 7 真值表[path:/text/first-match/空/非误匹配] + parseGraphPrefs groups 向后兼容 4 + 设置 Groups 列表 add/edit/remove+持久化）+ `r90-probe.mjs` **8/8**（真 WKWebView，`__geodeGraphGroupColor`+`__geodeGraphPrefs`）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（分组着色纯前端）；不碰 markdown.ts → **r26-bytes 不涉及**；draw 重构（按 color 分批）groups=[] 逐像素等价旧单批次 + 零改 getGraph → **r78(graph 设置)16/16 + r84(graph 过滤)17/17 回归绿**。**对抗评审 6 维深挖 draw 像素等价 + React key=index → 0 confirmed critical/major/minor/nit**（2 已知非缺陷取舍：hover/anchor 保留 accent；多 group 重叠+dim 亚像素 z-order，collide 保证不可见）。坏 hex 经 HEX_RE 在 parse 挡 localStorage 注入。**OBSIDIAN-COMPAT 缺口表**：㊵ 分组着色交付（续缺口：标签/附件作节点 / unresolved+连线着色 / tag:复杂查询）。

### R89 套件回归（2026-06-16，macOS release 二进制 v0.86.0 实测 `r89-probe-vault`）

R89 = 新文件默认位置设置（候选池第六梯队 ㊽ slice，原生功能）。对照 Obsidian Files & Links「Default location for new notes」三态：vault 根 / 与当前文件同文件夹 / 指定文件夹。新 `core/newNote.ts` + 5 建笔记调用点收敛。写 .md 经既有 vetted create 路径。

新增套件：`r89-e2e.mjs` **16/16**（resolveNewNoteFolder 6 真值表 + createNewNote 端到端[指定文件夹落盘+自建+slash-guard+root+撞名序号] + 设置 segmented+条件 folder input+持久化）+ `r89-probe.mjs` **8/8**（真 WKWebView + 真 fs，含嵌套文件夹真建盘）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（建笔记纯前端）；不碰 markdown.ts → **r26-bytes 不涉及**；5 建笔记调用点收敛到 createNewNote（QuickSwitcher/wikilinks/backlinks/outgoing/graph）→ **r82(backlinks/outgoing)27/27 + r84(graph)17/17 + r24(autosave/flush)12/12 回归绿**。**对抗评审 4 维深挖 data-safety 写路径 + path-bearing name 文件夹 → 0 confirmed critical/major + 2 minor/nit（QuickSwitcher 补 catch / wikilinks 用 fromPath，已修）**；非法 folder 路径经 assertSafeRelPath + Rust safe_join 防御不写库外。**OBSIDIAN-COMPAT 缺口表**：㊽ 全局新文件位置交付（续缺口：TemplateSelector/explorer 工具栏接 location / Reveal-in-Finder）。

### R88 套件回归（2026-06-16，macOS release 二进制 v0.85.0 实测 `r88-probe-vault`）

R88 = 行号 gutter + 新标签默认视图模式（候选池第六梯队 ㊶ slice，原生功能）。对照 Obsidian Editor：Show line numbers（默认 OFF）+ Default view for new tabs（Reading/Editing）+ Default editing mode（Live/Source）。**纯前端**（appearance Store + CM compartment + workspace openFile + 设置 UI），不写 .md、不动 markdown.ts。

新增套件：`r88-e2e.mjs` **13/13**（行号 gutter 反应式 toggle 出现/消失+持久化 + 与 fold gutter 共存+最左 + defaultNewTabMode 真值表[preview/source/live] + segmented UI + openFile newTab）+ `r88-probe.mjs` **5/5**（真 WKWebView，`__geodeNewTabMode` openFile 用 default mode）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（行号/默认 mode 纯前端）；不碰 markdown.ts → **r26-bytes 不涉及**；新增 CM lineNumberCompartment 独立切片、不动 modeCompartment/fold → **r50(appearance)15/15 + r79(accent/主题)21/21 + r29(fold 持久化)19/19 回归绿**（fold gutter 与行号共存）。**对抗评审 5 维深挖 gutter 共存 + 默认 mode 注入 → 0 confirmed critical/major + 2 minor（CM 基础 light 主题硬编码色泄漏行号 gutter，已修=editorTheme 走 `--text-faint`/`--text-muted`）+ 1 nit（已修）**。**OBSIDIAN-COMPAT 缺口表**：㊶ 行号 gutter + 默认视图模式交付（续缺口：Tab 缩进宽度 / fold 分项开关 / 代码块复制按钮 / 缩进参考线）。

### R87 套件回归（2026-06-16，macOS release 二进制 v0.84.0 实测 `r87-probe-vault`）

R87 = strict line breaks 严格换行渲染选项（候选池第六梯队 ㊶ slice，原生功能）。对照 Obsidian Editor 设置「Strict line breaks」：OFF（默认）= 单换行→`<br>` / ON = CommonMark。**字节敏感轮**（动 markdown.ts 阅读管线），纯前端 view-only（不写 .md）。

新增套件：`r87-e2e.mjs` **11/11**（breaks 真值表[默认<br>/strict join/硬换行两空格/空行分段] + 设置 toggle 反应式重渲 reading + 持久化双向）+ `r87-probe.mjs` **6/6**（真 WKWebView，`__geodeRenderMarkdown` 两模式）。

- **套件矩阵不回退**：本轮 compat 调用面：`compat/util.ts:450` registerMarkdownPostProcessor 渲染补传 `strictLineBreaks.get()`（与用户阅读设置一致，**功能增强非破坏**）；**改 markdown.ts → r26-bytes 字节套件**：改前 `--baseline` 重捕 + 加 soft-break 语料 + 改后**仅 3 处段内单换行 case 变字节**（blockquote + soft-break×2）、18 块级 case 字节不变 = **0 invariant violations**（隔离）+ 重捕锁新字节（默认翻转 breaks:true 匹配 Obsidian）→ **回归 r26(reading)12/12 + r25(hover)17/17 + r74(slides)23/23 绿**。**对抗评审 5 维深挖单例 breaks 污染 + 默认翻转回归 → 0 confirmed critical/major/minor + 2 nit**（SlidesOverlay/探针钩子非反应式，已知偏差）。**OBSIDIAN-COMPAT 缺口表**：㊶ Strict line breaks 交付（续缺口：行号 gutter / Tab 宽度 / fold 分项开关 / 代码块复制按钮）。

### R86 套件回归（2026-06-15，macOS release 二进制 v0.83.0 实测 `r86-probe-vault`）

R86 = File properties 右侧栏 + Cmd+Backspace 删属性（候选池第六梯队 ㊼ 续 v1，原生功能）。对照 Obsidian「Properties view」核心插件（活动笔记属性右栏）+ 删属性快捷键（Obsidian 未实现的 feature-request，本轮顺带补）。**写 .md（删属性）→ data-safety 触发**；复用 R22 PropertiesPanel 作独立第二写者经 DocumentHandle.applyExternalEdits，不动 markdown.ts。

新增套件：`r86-e2e.mjs` **11/11**（fileproperties tab + 复用 PropertiesPanel + **第二写者 edit 写活动 doc（live CM 共存无 mismatch crash）** + Cmd+Backspace 删属性保留其余 + plain Backspace 不删 + 切文件 re-target）+ `r86-probe.mjs` **6/6**（真 WKWebView + 真 fs，`__geodeFilePropsRemove` 删 status 留 author/count）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（右栏面板纯前端复用）；不碰 markdown.ts → **r26-bytes 0**；删属性走既有 buildRemoveProperty + applyExternalEdits（绝不手拼 YAML）→ **r83(键盘导航)15/15 + r30(properties)25/25 + r24(autosave/flush)12/12 回归绿**。**对抗评审 6 维深挖第二写者 + refcount → 0 confirmed critical/major/minor + 1 nit（已修）**：mismatch guard 不误 throw（CM updateListener 同步物化 this.text）/ acquire-release 配对不泄漏 / offset 三处同基准自洽。**OBSIDIAN-COMPAT 缺口表**：㊼ File properties 右栏 + 删属性交付（续缺口：Hidden 模式主编辑入口 / Date 值链日记 / 属性拖拽重排）。

### R85 套件回归（2026-06-15，macOS release 二进制 v0.82.0 实测 `r85-probe-vault`）

R85 = 字体三族：界面/正文/等宽字体设置（候选池第六梯队 ㊺ 续 v1，原生功能）。对照 Obsidian Appearance → Fonts：Interface（菜单/树）/ Text（正文，未设继承界面）/ Monospace（代码）。**纯前端**（appearance.ts + CSS 变量 + 设置 UI），不写 .md、不动 markdown.ts。

新增套件：`r85-e2e.mjs` **21/21**（sanitizeFontFamily 7 真值表[注入/控制符/折叠/空] + 3 setter 应用 `--font-*` 变量+持久化+清除 + 注入实测无 `;{}()<>"'` + 3 设置 input）+ `r85-probe.mjs` **6/6**（真 WKWebView，`__geodeFontSanitize`）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（字体覆盖纯前端 CSS 变量）；不碰 markdown.ts → **r26-bytes 0**（改 font-family CSS 非 HTML 字节）；appearance.ts 加性扩展 → **r79(accent/系统主题)21/21 + r50(readable/spellcheck)15/15 回归绿**。**对抗评审 6 维 + 实证 CSS 注入 → 0 confirmed critical/major + 2 minor（已修：text 缺失回退尊重界面覆盖；控制字符 strip）**。CSS 注入挡死（用户内容恒锁引号 string token + IACVT 兜底）。**OBSIDIAN-COMPAT 缺口表**：㊺ Interface/Text/Monospace 字体交付（续缺口：系统字体自动补全 / 字体识别 ✓ 标记）。

### R84 套件回归（2026-06-15，macOS release 二进制 v0.81.0 实测 `r84-probe-vault`）

R84 = 图谱过滤：孤立笔记 + 仅现有文件 toggle（候选池第六梯队 ㊵ 续 v1，原生功能）。对照 Obsidian Graph Filters 组：Orphans + Existing files only（Tags/Attachments/Search 延期）。**纯客户端过滤**（GraphView + graphPrefs.ts），零改 getGraph、不写 .md、不动 markdown.ts。

新增套件：`r84-e2e.mjs` **17/17**（applyGraphFilters 4 真值表[default 全保/existingOnly 去 unresolved/orphans-off 去 degree-0/combined] + parseGraphPrefs filters 向后兼容 4 + 面板 2 toggle 持久化 + 改渲染节点集 delta）+ `r84-probe.mjs` **8/8**（真 WKWebView，`__geodeGraphFilter` + `__geodeGraphPrefs`）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（图谱过滤纯前端，不动插件 API）；不碰 markdown.ts → **r26-bytes 0**；零改 metadata.getGraph 共享索引 → **r78(graph 设置)16/16 + r28(树拖拽)23/23 回归绿**。**对抗评审 6 维 → 0 confirmed critical/major + 2 minor**（空态文案未分「无笔记 vs 被过滤清空」= 已知 UX 偏差，无数据风险）。`resetSettings` 不重置 filters = 有意对齐 Obsidian（reset 属 Display/Forces 组）。**OBSIDIAN-COMPAT 缺口表**：㊵ Orphans + Existing-files-only 交付（续缺口：Tags/Attachments 作节点需扩 getGraph / Search 过滤框 / 分组着色）。

### R83 套件回归（2026-06-15，macOS release 二进制 v0.80.0 实测 `r83-probe-vault`）

R83 = Properties 增强：tags chip 点击搜索 + 属性行键盘导航（候选池第六梯队 ㊼ v1，原生功能）。对照 Obsidian Properties：点 tag 值 → 搜索 + Property Editor 键盘可用（↑↓ 切行、Enter 编辑、Escape 退出字段）。**改 PropertiesPanel.tsx（编辑器属性面板）**，不写 .md（除既有 commit 路径）、不动 markdown.ts。

新增套件：`r83-e2e.mjs` **15/15**（tags chip 渲染/点击 seed `#alpha`·`#beta`/非 tags 不可点 + ↑/↓/Enter 行导航 + 字段内 ↑↓ 不串行 + **Escape discards 不写 frontmatter** data-safety）+ `r83-probe.mjs` **3/3**（真 WKWebView，`requestSearch` 同步 seed + 切 leftPanel）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（属性面板交互纯前端）；不碰 markdown.ts → **r26-bytes 0**；**对抗评审 1 确认 CRITICAL（data-safety 第一底线）**：键盘导航 Escape→程序化聚焦行触发字段 blur-commit stale draft 误写 frontmatter → 修=结构性移除 Escape→行（字段 Escape 交回自身 discard）+ 补 data-safety e2e → **r30(properties)25/25 + r24(autosave/flush)12/12 + r23(22) 回归绿**。**OBSIDIAN-COMPAT 缺口表**：㊼ tags chip 点击搜索 + 键盘导航交付（续缺口：File properties 右侧栏 / date 链日记 / hover+embeds cssclasses / Cmd+Backspace 删属性）。

### R82 套件回归（2026-06-15，macOS release 二进制 v0.79.0 实测 `r82-probe-vault`）

R82 = 反链 / 出链面板增强（候选池第六梯队 ㊷ v1，原生功能）。对照 Obsidian backlinks/outgoing pane：sort order + collapse results + show search filter（show more context 延期）。**纯前端 view-only**（BacklinksPanel/OutgoingLinksPanel + core/linkPanel.ts），不写 .md、不动 markdown.ts。

新增套件：`r82-e2e.mjs` **27/27**（`sortAndFilterLinks` 7 真值表[default 保序/name-asc/desc/大小写子串过滤/过滤+排序复合/空过滤/无匹配] + backlinks sort/filter/collapse-all/per-source toggle + outgoing sort/filter + 跨笔记重置 4 条）+ `r82-probe.mjs` **6/6**（真 WKWebView，`__geodeLinkSortFilter`）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（面板工具栏纯前端，不动插件 API 面）；不碰 markdown.ts → **r26-bytes 0**（不涉及渲染）；view-only 无写 .md（outgoing create-on-click 语义未动）→ **r62(outgoing)14/14 + r80(search)17/17 回归绿**（零回归）。**对抗评审 6 维 → 1 确认 MAJOR + 1 MINOR（同根因：工具栏状态跨 activePath 不重置→新笔记假空，修=两面板 `useEffect(reset,[activePath])`+补跨笔记 e2e）**。**OBSIDIAN-COMPAT 缺口表**：㊷ 排序/过滤/折叠交付（续缺口：show more context 需改 getBacklinks 共享索引 / 笔记底部内嵌 backlinks / 修改·创建时间排序需 adapter stat）。

### R81 套件回归（2026-06-15，macOS release 二进制 v0.78.0 实测 `r81-probe-vault`）

R81 = 标签页右键上下文菜单（候选池第六梯队 ㊿ v1，原生功能）。对照 Obsidian 标签页右键：Close / Close others / Close to the right / Close all / Pin / Split right / Split down。**纯前端**（App.tsx 菜单 UI + core/workspace.ts 批量关闭方法），不写 .md、不动 markdown.ts。

新增套件：`r81-e2e.mjs` **14/14**（`tabIdsToClose` 4 真值表[others/right/all × 恒跳 pinned] + 右键弹菜单 + close-others 留 target + pin→close-all 留 pinned + split 增 pane + Esc 关）+ `r81-probe.mjs` **5/5**（真 WKWebView，`__geodeTabsToClose`）。

- **套件矩阵不回退**：本轮 compat 调用面零改动（标签操作纯前端，不动插件 API 面）；不碰 markdown.ts → **r26-bytes 0**；批量关闭走 vetted `closeTab` 逐个（绝不直接 splice）→ 继承 R24 autosave/flush，**r36(tab)47/47 + r37(split)36/36 + r39(pin)17/17 + r24(flush)12/12 回归绿**（零回归）。**对抗评审 7 lens + 6 lens data-safety skeptic-verify → 0 确认缺陷 + 3 nit（采纳 2：菜单定位下界 clamp / graph tab 禁 Split + CSS :disabled）**。data-safety 核心证伪：脏状态属 refcounted `DocumentHandle`（outlives view）→ EditorPane 卸载已调度 deferred-drop flush → 批量关闭不丢脏。**OBSIDIAN-COMPAT 缺口表**：㊿ 标签页右键菜单交付（续缺口：Move to new window=pop-out 硬边界 / 标签拖拽重排 / 侧栏面板拖拽堆叠）。右键菜单 compat `file-menu`/`editor-menu` 钩子仍缺（见缺口表）。

### R80 套件回归（2026-06-15，macOS release 二进制 v0.77.0 实测 `r80-probe-vault`）

R80 = 搜索面板 UI 选项（候选池第六梯队 ㊸，原生功能）。对照 Obsidian 搜索：排序（文件名 A-Z/Z-A、匹配数）+ 折叠结果 + 更多上下文 + 复制结果。**纯前端单文件**（SearchPanel.tsx），不写 .md、不动 markdown.ts。

新增套件：`r80-e2e.mjs` **17/17**（sortResults 5 key 真值表 + 排序下拉改序 + localStorage 持久化 + 折叠全部/每文件 + more-context 长行变长 + 复制剪贴板 + 复制按钮反馈）+ `r80-probe.mjs` **7/7**（真 WKWebView，`__geodeSearchSort`）。

- **套件矩阵不回退**：本轮零 compat 调用面改动（搜索 UI 纯前端，不动插件 API 面）；不碰 markdown.ts → **r26-bytes 0**；effect 重构（sort/slice 移 memo）默认 relevance 与原硬编码逐字节同序 → **r68(search 运算符)40/40 + r34(find)15/15 回归绿**（零回归）。**对抗评审 6 lens → 0 critical/0 major/2 minor（copy 反馈 + clipboard 守卫，均修）**。**OBSIDIAN-COMPAT 缺口表**：㊸ 排序/折叠/上下文/复制交付（续缺口：解释搜索词 / 大小写 UI toggle / 修改·创建时间排序需 adapter stat）。

### R79 套件回归（2026-06-15，macOS release 二进制 v0.76.0 实测 `r79-probe-vault`）

R79 = 外观补全 v1：强调色取色器 + 系统主题三态（候选池第六梯队 ㊺，原生功能）。对照 Obsidian Appearance：accent color override + base color scheme「Adapt to system」（随 OS）。**纯前端**（localStorage + CSS 变量 + matchMedia），不写 .md、不动 markdown.ts。

新增套件：`r79-e2e.mjs` **21/21**（resolveTheme 真值表 + accent 覆盖/persist/invalid-drop/reset + 系统三态 emulateMedia 实时跟随 + 显式 dark/light 覆盖 system + segmented 三按钮 + R45×system 不变式）+ `r79-probe.mjs` **7/7**（真 WKWebView，resolveTheme + accent apply sync）。

- **套件矩阵不回退**：本轮 compat 调用面仅 `compat/themes.ts:225` syncBodyClass 改读 resolved `dataset.theme`（更准，"system" 不再误判 dark）；`theme:changed` 事件载具不变（恒 resolved `"dark"|"light"`）→ compat/mermaid/graph 消费者不破；不碰 markdown.ts → **r26-bytes 0**；workspace 持久化树扩 "system" 向后兼容（旧 blob 无损）→ **r45(workspace)10/10 + r50(appearance)15/15 回归绿**。**对抗评审 7 lens → 0 确认缺陷**+ 2 nit（accent swatch 读 computed --accent / 补 R45×system 断言）。**OBSIDIAN-COMPAT 缺口表**：㊺ 强调色+系统主题交付（续缺口：字体三族 / inline title / ribbon 显隐）。

### R78 套件回归（2026-06-15，macOS release 二进制 v0.75.0 实测 `r78-probe-vault`）

R78 = 图谱设置完整化 v1：显示+力 持久化设置面板（候选池第六梯队 ㊵，原生功能；第六梯队起步）。对照 Obsidian 图谱设置：**力**（center/repel/linkForce/linkDistance）+ **显示**（arrows/text-fade/node-size/link-thickness）齿轮浮层滑块。**纯前端**（localStorage 持久化 + canvas/d3-force），不写 .md、不动 markdown.ts。

新增套件：`r78-e2e.mjs` **16/16**（parseGraphPrefs clamp/向后兼容旧 blob/corrupt + 齿轮开合 + 4 力滑块+3 显示滑块+arrows 持久化 localStorage + reset 回默认）+ `r78-probe.mjs` **6/6**（真 WKWebView，`__geodeGraphPrefs` 校验 sync）。

- **套件矩阵不回退**：本轮零 compat 调用面改动（图谱设置纯前端，不动插件 API 面）；不碰 markdown.ts → **r26-bytes 0 violations**；新 `features/graph/graphPrefs.ts` 复用旧 localStorage key `geode.graphPrefs` 向后兼容（旧 `{mode,depth,showAll}` blob 自动补 forces/display 默认，零迁移）。**对抗评审 7 lens → 0 确认缺陷**+ freeze DEFAULT_PREFS。**OBSIDIAN-COMPAT 缺口表**：㊵ 显示+力面板交付（续缺口：过滤组[标签/附件作节点、孤立笔记，动 getGraph] / 分组着色 / 局部深度>2）。

### R77 套件回归（2026-06-15，macOS release 二进制 v0.74.0 实测 `r77-probe-vault`）

R77 = 块 ID 自动铸造 `^id`（候选池第五梯队【中】㊴，原生功能；第五梯队【小】+【中】至此全清）。对照 Obsidian「Copy link to block」：对光标段落块无 `^id` 时自动铸短随机 id + 复制 `[[Note#^id]]`/`![[Note#^id]]`。**写 .md**（走活动编辑器 view.dispatch = R33/R40 既有 B-class autosave，非新写路径）。复用 R13 frozen block 基建（不动 markdown.ts）。

新增套件：`r77-e2e.mjs` **14/14**（blockRefAt 段落铸/reuse/空行/围栏/frontmatter null + 命令铸 id 写 doc + 剪贴板链接 + 幂等 + embed + unsafe 文件名不复制坏链 + unique shortest）+ `r77-probe.mjs` **6/6**（真 WKWebView，`__geodeBlockRef` 真 fs）。

- **套件矩阵不回退**：本轮零 compat 调用面改动（block 命令 + core 逻辑，不动插件 API 面）；不碰 markdown.ts（`^id` R13 已 strip）→ **r26-bytes 0 violations**；`core/linkFormat.ts formatLink` 加 `subpath` 形参为 **additive**（R72 默认零变）→ **r72-e2e 26/26 回归绿**。**对抗评审 1 MAJOR（块链接绕过 formatLink 单一真值 → 改走 formatLink+subpath）+ 2 minor**。**OBSIDIAN-COMPAT 缺口表**：㊴ 块引用自动铸交付（v1 已知延期：代码块/表格块 id / `[[#^` 补全铸 / switcher 选块铸）。

### R76 套件回归（2026-06-15，macOS release 二进制 v0.73.0 实测 `r76-probe-vault`）

R76 = 任务自定义状态渲染（候选池第五梯队【中】㊳，原生 + 主题特性）。对照 Obsidian：阅读视图把非标准复选框态 `[/]`(进行中)/`[-]`(取消)/`[>]`(推迟)/`[<]`(计划) 渲染为带 `data-task="<char>"` 的 checkbox，主题用 `li[data-task="/"]` 选择器画自定义标记。**字节敏感**（动 markdown.ts task rule → §C r26-bytes 守卫）。**v1 阅读视图专属**（live 的 lezer `TaskList` 硬编码 `[ xX]` + Obsidian 自身 live 也不渲染自定义态）。

新增套件：`r76-e2e.mjs` **17/17**（自定义态 data-task+checkbox+非 done + 标准态字节稳定 + 负样本 multi-char/empty/非列表/无空格 + 阅读点击 toggle 自定义态→done + 标准态不变）+ `r76-probe.mjs` **8/8**（真 WKWebView，`__geodeRenderMarkdown` 渲染自定义态）。

- **套件矩阵不回退**：本轮零 compat 调用面改动（task 渲染加 `<li data-task>` 属性、`<input class="task-checkbox">` 串不变 → compat/util.ts 可点性 + export.ts class 替换不受影响）；markdown.ts task rule **字节保守**（data-task 仅非标准态 emit + is-checked 标准态结果不变）→ **r26-bytes 标准 `list-task` 0 violations**（48 cases，仅新增 flagged `list-task-custom`）；原生回归 r26[embeds]12/12 + r35[brackets]25/25 + r68[search task:]40/40 全绿（搜索侧 task 收敛已 R68、本轮渲染侧对齐到同 `[^\]]`）。**对抗评审 1 MAJOR（阅读点击 toggle 第 5 处 task 消费者收敛）**。**OBSIDIAN-COMPAT 缺口表**：㊳ 阅读视图自定义态交付（v1 已知延期：live preview 自定义态渲染——lezer 限制 + Obsidian 自身限制）。

### R75 套件回归（2026-06-15，macOS release 二进制 v0.72.0 实测 `r75-probe-vault`）

R75 = `query` 搜索结果嵌入代码块（候选池第五梯队【中】㊲，原生功能）。对照 Obsidian 核心：` ```query ` 代码块 = 搜索语法 → 渲染为分组结果列表（reading + live preview），点击导航。复用 `core/search.ts`（parseSearchQuery/evaluateSearch，R21/R68 已支持 file/path/content/tag/line/task/[prop]）。**字节敏感**（动 markdown.ts fence renderer → §C r26-bytes 守卫）。

新增套件：`r75-e2e.mjs` **16/16**（runQueryBlock match/empty/error + reading 占位→结果列表 + reading 点击导航 + live widget→结果 + live 点击导航 passthrough + 错误 plate）+ `r75-probe.mjs` **8/8**（真 WKWebView + 真 fs，`__geodeQueryBlock` path/content/none/error/empty；result-list DOM browser-E2E only，§D 纪律）。

- **套件矩阵不回退**：本轮零 compat 调用面改动（query 渲染走 core hydrate pass + live widget，不动插件 API 面）；markdown.ts fence renderer **仅在 `lang==="query"` 分叉**→ **r26-bytes 0 violations**（47 cases，仅新增 flagged `code-fence-query`，js fence 等逐字节不变=字节隔离证明）；原生回归 r34[search]15/15 + r55[live tables]15/15 + r56[live mermaid]13/13 + r26[embeds]12/12 全绿（共享 HydratedBlockWidget mousedown 加 internal-link 导航分支不破 mermaid/table/math）。**对抗评审 0 critical/0 major/1 minor（doc 一致性，已订正 As-built）**。**OBSIDIAN-COMPAT 缺口表**：㊲ 嵌入查询交付（v1 已知延期：行内 snippet / collapse-sort 渲染选项 / 点击跳行）。

### R74 套件回归（2026-06-15，macOS release 二进制 v0.71.0 实测 `r74-probe-vault`）

R74 = Slides 演示模式（候选池第五梯队【中】㊱，原生功能）。对照 Obsidian 核心 Slides：当前笔记按整行 `---` 水平分页 → 全屏演示 overlay 逐页渲染 + ←/→/Space 导航 + Esc 停 + 命令「Slides: Start presentation」。**零依赖极简自实现**（非 reveal.js）、v1 纯静态只读、复用 core 渲染管线、不写 .md、不动 markdown.ts。

新增套件：`r74-e2e.mjs` **23/23**（splitSlides 5 形态 + overlay 挂载/计数/←→翻页/clamp/按钮导航/Esc+close 关 + **数据安全无变更不变式** + 图片 embed 真 hydrate）+ `r74-probe.mjs` **7/7**（真 WKWebView + 真 fs，splitSlides 6 形态经 `__geodeSplitSlides` sync 探针；overlay DOM browser-E2E only，§D 纪律）。

- **套件矩阵不回退**：本轮零 compat 调用面改动（Slides 是新 feature overlay，不动插件 API 面、不动 markdown.ts），r31/…/r57 全 compat 套件不动；原生回归 r26[reading-view embeds]12/12 + r30[properties/modal]25/25 + **r26-bytes 0 violations**（证 Slides 复用 renderMarkdownToHtml 只读、阅读视图字节零回退）全绿。**对抗评审修 1 MAJOR 数据安全**（overlay 夺焦防底层笔记被静默改写）。**OBSIDIAN-COMPAT 缺口表**：㊱ Slides 演示模式交付（v1 已知延期：仅 `---` 分页 / 无 fragment·垂直分页·speaker notes·导出 PDF——社区 Advanced Slides 才有，非核心）。

### R73 套件回归（2026-06-15，macOS release 二进制 v0.70.0 实测 `r73-probe-vault`）

R73 = `cssclasses` frontmatter 应用到笔记视图容器（候选池第六梯队 ㊼ slice，原生功能；㉟ Properties 类型化编辑经前置门判 R22 已实现而出队）。对照 Obsidian 核心：笔记 `cssclasses`（+遗留 `cssclass`）作为 CSS 类加到 reading view `.markdown-preview-view` / editor `.markdown-source-view`，供主题/CSS 片段定向单笔记样式（迁移叙事：Obsidian 主题对 cssclasses 的 DOM 假设在 Geode 成立）。

新增套件：`r73-e2e.mjs` **23/23**（list/空格串/逗号串/inline list/遗留 cssclass/去重/无 cssclasses 仅 base/preview+live 双容器/preview+live 双态响应性 stale 移除）+ `r73-probe.mjs` **8/8**（真 WKWebView + 真 fs，token 提取 6 形态经 `__geodeCssClasses` sync 探针；DOM 应用 browser-E2E only，§D 纪律）。

- **套件矩阵不回退**：本轮零 compat 调用面改动（cssclasses 应用是 EditorPane 容器 className 加性、不动插件 API 面、不动 markdown.ts），r31/…/r57 全 compat 套件不动；原生回归 r30[allproperties]25/25 + r26[embeds]12/12 + **r26-bytes 0 violations**（容器 className 不入 `previewHtml` 字节流，阅读视图渲染字节零回退）全绿。**OBSIDIAN-COMPAT 缺口表**：㊼ Properties 增强的「cssclasses 应用」子项交付（其余 ㊼ 子项——File properties 右侧栏/键盘导航/tags chip 搜索/date 链日记/hover+embeds 容器——续缺）。

### R72 套件回归（2026-06-15，macOS release 二进制 v0.69.0 实测 `r72-probe-vault`）

R72 = 新链接格式设置（候选池第五梯队【中】㉞-c，原生功能；㉞ 整项完成）。对照 Obsidian 核心：设置「新链接格式」（wikilink↔markdown）+「新链接路径」（最短/相对/绝对），影响全部新建链接构造点。
新 `core/linkFormat.ts`（`linkUseMarkdown`/`linkPathFormat` Store+setter，localStorage）= `formatLink()` 单一真值（wiki↔md × 最短/相对/绝对 × embed/alias，resolve-back 验证，无安全形→null=跳过），两道硬守卫：(a) wiki+相对→最短、(b) embed→恒 wikilink。接 5 构造点（noteComposer/attachments/cmExtensions/**unlinkedMentions**/SettingsModal）。**纯前端 additive——不写既有 .md、不动改写引擎/渲染（未碰 markdown.ts，无字节套件风险）。零依赖、无 Rust。**
新增套件：`r72-e2e.mjs` **26/26**（全组合 + 守卫 + round-trip + unlinked mention 三态 + extract 三态 + `]` 守卫）+ `r72-probe.mjs` **15/15**（真 WKWebView + 真 fs，含 spaced-name 落盘）。
**对抗评审（Workflow 9 agent / 4 lens + 逐条 skeptic verify）5 确认 0 证伪 → 2 根因 + 1 注释**：① **unlinkedMentions 改写后校验用 wikilink resolver 验 markdown 链接 → 空格名 `%20` href 静默跳过 → `resolveByKind`（对齐 R70）**；② **formatLink markdown 分支 display 含 `]` 产不可重解析坏链违反 null 契约 → display 含 `]`→null（对齐 WIKILINK_UNSAFE）**；③ extract 注释纠错。**插件 API**：linkFormat 是 features/core 内部链接构造，compat 调用面**零改动**（fileToLinktext shim 不变）。**已知偏差**：粘贴新建附件嵌入恒最短 wikilink（守卫 b）；compat fileToLinktext path-format 未接（faithful shim）。
- **套件矩阵不回退**：本轮零 compat 调用面改动，r31/…/r57 全 compat 套件不动；原生回归 r24[unlinked mentions]12 + r44[extract]25 + r67[drag-link]9 + r70[md rename]23 + r71[md render]17 全绿（链接构造/改写/渲染栈不破）。**OBSIDIAN-COMPAT 缺口表无变化**（R72 原生功能）。

### R71 套件回归（2026-06-15，macOS release 二进制 v0.68.0 实测 `r71-probe-vault`）

R71 = markdown 内部链接渲染 + 点击导航（候选池第五梯队【中】㉞-b，原生功能）。对照 Obsidian 核心：解析为 vault 路径的 md 链接渲染为内部可点击链接、点击导航（阅读视图 + live + hover 预览）。
改 core/markdown.ts 阅读视图管线（字节敏感）：`link_open` 对解析到 .md 笔记的 md href 产 internal-link anchor（data-target=已解析全路径，复用 wikilink 点击机器）；live `.cm-live-mdlink` 加 data-link-target + hover；新 `resolveMdLink` 由 5 渲染调用点注入。**字节契约**：r26-bytes `--baseline` 改前重捕 → 改后 **0 invariant violations**（仅 md-link-internal/-sub 两例预期变，44 例逐字节不变）。**纯前端 core+features，零依赖、无 Rust。**
新增套件：`r71-e2e.mjs` **17/17**（阅读+live 渲染/点击/根-绝对/角括号/Ctrl-点）+ `r71-probe.mjs` **8/8**（真 WKWebView __geodeRenderMarkdown）。
**对抗评审（Workflow 3 lens + verify）9 确认 → 修 5 根因 + 自查**：live Ctrl-点导航（非 window.open）/ hover 预览 / embeds+卡片传 resolveMdLink / 角括号剥 `<>` / **根-绝对 href 精确解析（修 R70 resolveMarkdownLink basename 模糊 MAJOR）**。**插件 API**：md 内部链接渲染走核心管线，compat MarkdownRenderer 同步获益。**已知偏差**：㉞-c 新链接格式设置（续）/ title tooltip nit / 重命名后陈旧 anchor（重渲消除）。
- **套件矩阵不回退**：compat 调用面仅 MarkdownRenderer 渲染获益（加性），r31/…/r57 全 compat 套件不动；原生回归 r23[editor]22 + r25[hover]17 + r26[embeds]12 + r35[brackets]25 + r55[live tables]15 + r63[multicursor]9 + r70[md rename]23 全绿（markdown.ts 字节不回退 + 编辑器栈不破）。

### R70 套件回归（2026-06-14，macOS release 二进制 v0.67.0 实测 `r70-probe-vault`）

R70 = markdown 标准链接 `[text](note.md)` 重命名改写（候选池第五梯队【中】㉞-a，原生功能）。对照 Obsidian 核心：重命名同步更新 markdown 链接。
把 R16 verified-rewrite 引擎按 `LinkRef.kind` 分叉：补 md 链接索引（`MARKDOWN_LINK_RE`）+ `resolveMarkdownLink`/`normalizeMdHref`，重命名/移动文件时 md 链接随 wikilink 一并改写（R16 三根因纪律全沿用 + external scheme 排除）。**插件 API 涟漪（商业主轴）**：`resolveByKind` 让 `app.metadataCache.resolvedLinks/unresolvedLinks`（compat）正确解析 md href（锚点/编码/相对），不再误入 unresolved 桶。
新增套件：`r70-e2e.mjs` **23/23** + `r70-probe.mjs` **9/9**（真 WKWebView 真实 fs）。
**对抗评审（Workflow 3 lens + verify）12 确认 → 修 5 根因 + 自查补 getGraph 附件崩溃**：href 编码 `%28%29%23%3F`、下游消费者 `resolveByKind`、compat original 按 kind、?query 保留、normalizeMdHref 相对一致。**已知偏差**：md 图片嵌入不改写（㉞ 续）/ md 内链不可导航（㉞-b）/ 新 href 用 vault 绝对形（㉞-c）/ 字面括号 href 不索引（Obsidian 编码故仅影响手写畸形）。
- **套件矩阵不回退**：compat 调用面仅 addLinkRows/buildCache 按 kind 分叉（resolvedLinks 更准），r31/…/r57 全 compat 套件不动；原生回归 r44[folder]25 + r47[merge]11 + r28[move]23 + r62[outgoing]14 + r66[backlink count]8 + r24 12 全绿（同族改写引擎 + 反链/出链/图谱消费者不破）。

### R69 套件回归（2026-06-14，macOS release 二进制 v0.66.0 实测 `r69-probe-vault`）

R69 = 全库标签重命名（候选池第五梯队【中】㉝，原生功能非 compat shim）。对照 Obsidian 核心右键标签 → rename（含嵌套）。
新建 `core/tagRewrite.ts` 镜像 R30 propertyRewrite 五步 verified-rewrite 纪律（inline 复用 metadata 导出的 `TAG_RE` 重扫现算偏移 + frontmatter 走 `buildSetProperty` + post-rewrite 复解析断言 + per-file skip + runTail 串行）。TagsPanel 右键 rename UI。**数据安全最高敏感（批量改写 .md）**，**纯前端 core 逻辑、零依赖、无 Rust**。
新增套件：`r69-e2e.mjs` **36/36**（inline/nested/boundary `#old-x`/frontmatter array+scalar/code-skip/CJK/no-op/descendant-guard/invalid/open-buffer/junk-item/UI 右键 rename）+ `r69-probe.mjs` **10/10**（真 WKWebView 真实 fs：inline+nested+frontmatter+code-skip）。
**对抗评审（Workflow 3 lens + verify）9 确认（多 minor/nit）→ 修 3 根因**：① frontmatter 重写集对齐 parseNote 索引判据 ⊆ 索引集（不动用户看不见的垃圾项）；② 全跳过仍显 skip 数（R47）；③ 删死 import。**已知偏差**：大小写敏感（不跨大小写合并）/ frontmatter 格式规范化（block list）/ 禁重命名进自己子树 / 自兄弟碰撞留重复项（Obsidian 加载自动合并）。
- **套件矩阵不回退**：本轮零 compat 调用面改动，r31/…/r57 全 compat 套件不动；原生回归 r41[tags]21/21 + r30[propertyRewrite]25/25 + r24[link rewrite]12/12 绿（同族改写引擎不破）。**OBSIDIAN-COMPAT 缺口表无变化**（R69 原生功能）。

### R68 套件回归（2026-06-14，macOS release 二进制 v0.65.0 实测 `r68-probe-vault`）

R68 = 搜索运算符扩展（候选池第五梯队【中】首项 ㉜，原生功能非 compat shim）。对照 Obsidian 核心 search：`task:`/`task-todo:`/`task-done:` + `[property]`/`[property:value]` 均 WebSearch 确认为核心运算符（非社区插件）。
扩展 R21 冻结的零依赖手写解析器：task 家族复用 `line:` 行级机制 + `TASK_LINE_RE`；property 查 `SearchInput.frontmatter`（大小写不敏感键 + 字符串/数组值子串）。`section:`/`block:` 故意延后（与 `line:` 无差异）。**纯只读、零依赖、无 Rust**。
新增套件：`r68-e2e.mjs` **40/40**（task 家族 11 + 自定义状态 5 + property 11 + 否定组合 3 + R21 回归 10）+ `r68-probe.mjs` **16/16**（真 WKWebView `__geodeSearchQuery` 纯函数）。
**对抗评审（Workflow 3 lens parser/evaluator/contract-faithful + verify）：2 根因修 + 1 已知偏差记**。① `TASK_LINE_RE` `[ xX]`→`[^\]]` 收敛 R40 `TASK_BOX_RE`（自定义复选框态 `[/]`/`[-]`/`[>]` 算 task）— 避免 task 定义第 4 次漂移；② `[key:]` 空值降级 key-exists。
- **已知偏差（R68 新增）**：裸方括号 token `[…]` 现按 frontmatter 属性谓词（`[key]`/`[key:value]`）解析，**非 R21 的字面方括号文本**。搜索字面方括号用 `content:[…]` 或引号 `"[…]"`。渲染器 `markdown.ts` `TASK_RE` 仍 `[ xX]`-only，与搜索/format 的 `[^\]]` 待收敛（单独记录的低优缺口）。
- **套件矩阵不回退**：本轮零 compat 调用面改动，r31/…/r57 全 compat 套件不动；原生回归 r34[find]15/15 + r41[tags]21/21 + r46 18/18 + r38 19/19（搜索解析器栈全绿，R21 frozen grammar 不破）。**OBSIDIAN-COMPAT 缺口表无变化**（R68 原生功能）。

### R67 套件回归（2026-06-14，macOS release 二进制 v0.64.0 实测 `r67-probe-vault`）

R67 = 拖拽 vault 文件入编辑器 → 链接/嵌入（候选池第五梯队 ㉛，原生功能非 compat shim）。对照 Obsidian 核心 drag-and-drop（help：拖文件入编辑器插入链接）。
编辑器 drop handler 识别 `EXPLORER_MIME`（核心共享 MIME，explorer 设/editor 读）：note→[[Name]]、附件→![[name.ext]]、文件夹/未知跳过；dragover 接管；effectAllowed move→copyMove。sync insert 无 await 不写 vault。**纯前端、零依赖、无 Rust**。
新增套件：`r67-e2e.mjs` **9/9**（note/附件/文件夹+未知跳过/纯插入/重名消歧→全路径/特殊字符跳过/dragover preventDefault）+ `r67-probe.mjs` **4/4**（真 Tauri fs fileExists 区分文件/文件夹）。
**对抗评审（Workflow 3 lens + verify）：1 主根因（3 lens 命中）+1 major → 修**。裸包 basename 的两病：重名消歧缺失（链错文件）+ wikilink-unsafe 字符（坏链）→ 修=复用全代码库 fileToLinktext 规则（解析回本文件的最短形 + 含 unsafe 字符不插）。
- **套件矩阵不回退**：本轮零 compat 调用面改动，r31/…/r57 全 compat 套件不动；原生回归 r28[tree drag-move]23/23 + r35 25/25 绿（effectAllowed copyMove 不破树拖拽移动）。**OBSIDIAN-COMPAT 缺口表无变化**（R67 原生功能）。**候选池第五梯队【小】项至此清空，进【中】梯队。**

### R66 套件回归（2026-06-14，macOS release 二进制 v0.63.0 实测 `r66-probe-vault`）

R66 = 状态栏增强：后链数 + 选中字数（候选池第五梯队 ㉙，原生功能非 compat shim）。对照 Obsidian 核心状态栏（官方 help：后链数/编辑器视图/字数）。
新 `backlink-count` 插件（getBacklinks 提及总数，metadata.revision 跨文件更新）+ word-count 加「N selected words」（getActiveView 选区）。光标行:列移除（非核心）。**纯前端、零依赖、无 Rust、不碰 vault/document**。
新增套件：`r66-e2e.mjs` **8/8**（后链 1→2 跨文件/0 后链/选中显示+撤选还原/打字覆盖清残留）+ `r66-probe.mjs` **3/3**（真 fs/WKWebView：getBacklinks 提及总数）。
**对抗评审（Workflow 3 lens + verify）抓到 1 major 性能回归 + 2 minor（全本轮引入）→ 全修**：MAJOR=selection-changed 每次光标移动整篇 countWords + App 根重渲 + plugins.ts disposer 无界增长 → 修=word-count 状态跃迁门 + 根因修 plugins.ts setStatusBarItem（值未变跳过 + 仅新增 push disposer）。minor=document:changed 清残留 + token bump 移顶部。
- **套件矩阵不回退**：本轮零 compat 调用面改动（compat addStatusBarItem 是 element-based 独立路径，不受 setStatusBarItem 去重影响），r31/…/r57 全 compat 套件不动；原生回归 r62/r24 绿。**OBSIDIAN-COMPAT 缺口表无变化**（R66 原生功能）。

### R65 套件回归（2026-06-14，macOS release 二进制 v0.62.0 实测 `r65-probe-vault`）

R65 = Footnotes 脚注面板（候选池第五梯队 ㉘，原生功能非 compat shim）。对照 Obsidian 1.9 核心 Footnotes view 插件（WebSearch 确认核心非社区）。
metadata 新增脚注索引（镜像 headings：`FOOTNOTE_DEF_RE` 行扫描 on masked 排围栏，content 取原文，`getFootnotes`）+ 新右栏 tab `features/footnotes/`（列 id+content，点击 jumpTo 定义复用 `geode:scroll-to-heading`）。**纯前端、零依赖、无 Rust、不碰 vault/document**。
新增套件：`r65-e2e.mjs` **12/12**（列 3 定义/围栏排除/leading 内联代码保留/计数/跳转/命令/空态）+ `r65-probe.mjs` **6/6**（真 fs/WKWebView：getFootnotes 解析 3 定义、围栏排除、原文 content、leading-code 保留）。
**对抗评审（Workflow 3 lens + verify）：1 根因（解析器=阅读视图脚注解析的子集→分歧，R56/R57 再现）→ 部分修+部分记限制**。修 body 首段内联代码丢失（从 `]:` 边界在原文 slice）；记限制 1-3 空格缩进定义被漏（保 col-0 锚定=代码库约定）+ 多行续行不合并（面板单行）。证伪：纯 view 无写、duplicate id 列全部可辩护。
- **套件矩阵不回退**：本轮零 compat 调用面改动，r31/…/r57 全 compat 套件不动；metadata 索引纯加性，原生回归 r41/r62/r64/r24/r26-bytes 全绿（不动 links/tags/headings/blocks/render）。**OBSIDIAN-COMPAT 缺口表无变化**（R65 原生功能）。

### R64 套件回归（2026-06-14，macOS release 二进制 v0.61.0 · 纯 view boot smoke）

R64 = Outline 内搜索过滤（候选池第五梯队 ㉗，原生编辑器/面板功能非 compat shim）。对照 Obsidian 核心 Outline 插件的过滤栏（WebSearch 确认是核心功能，非社区插件）。
`OutlinePanel.tsx` 新增 `filterRows` 纯函数：大小写不敏感 substring → 命中标题 + 祖先（淡显）不含后代（对齐 Obsidian）；query 切文件清空；过滤忽略 collapse、无匹配空态。**纯前端、零依赖、无 Rust、不碰 vault/document**。
新增套件：`r64-e2e.mjs` **15/15**（过滤=命中+祖先不含后代 / 大小写不敏感 / 无匹配空态 / 清空恢复 / 过滤时跳转可用 / 切文件重置）。**桌面 = 纯 view 无平台面**：binary build + boot smoke（r63-probe 4/4，R64 frontend 在真 WKWebView 启动+编辑器栈完好）；浏览器 e2e 跑真 React 组件即双端权威（不另造重复探针）。
**对抗评审（Workflow 3 lens + verify）：2 确认（minor+nit，本轮引入）+ 10 证伪**。修：① 切文件 query 被动 useEffect（paint 后）重置→闪「无匹配」一帧→改 useLayoutEffect；② is-ancestor 淡显 specificity 压过 hover→加 hover 规则。证伪：filterRows 逻辑全边角正确、纯 view 无写（数据安全满足）、count 显总数可辩护。
- **套件矩阵不回退**：本轮零 compat 调用面改动，r31/…/r57 全 compat 套件不动；原生回归编辑器/面板套件全绿。**OBSIDIAN-COMPAT 缺口表无变化**（R64 原生功能）。

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
