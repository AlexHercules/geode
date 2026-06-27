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
| `App.fileManager` / `App.keymap` / `App.scope` | **R16：`fileManager.renameFile` 真实现**；**R22：`fileManager.processFrontMatter` 真实现**（core/properties 编辑引擎，逐 key diff 字节保留改写；opaque 条目不进 fm 对象且永不被改写、不可序列化值 TypeError reject、options/mtime 忽略——偏差见 ARCHITECTURE R22）；fileManager 其余方法仍为按访问记录缺口的 async no-op；keymap/scope **【2026-06-21 全表面校准更正：原「惰性 no-op 对象」为 stale】** 导出的 `Scope`（ui.ts:64，register/unregister 真注册、父链）/ `Keymap.isModifier`·`isModEvent`（平台感知静态法）**已做实**，仅 `app.keymap.pushScope/popScope` + `app.scope`（detached、从不派发）仍 no-op |
| `getFileCache().links` 缺 `[[#h]]` 条目 | 偏差（R16 记录）：同文链接不进 links 索引（官方含 `link: "#h"` 形态条目） |
| ~~`DataAdapter.readBinary` / `writeBinary`~~ | **R111+R122：桥接 core 原生二进制 IO**（readBinary 返拷贝防别名）。**R122：writeBinary 创建或覆盖**（try createBinary→catch modifyBinary 原子；连带修 R120 共享-tmp 并发撕裂写 MAJOR=唯一 tmp）。`appendBinary`/`stat`/`trash*` 仍 warn-stub；append/process/rmdir/copy 用字符串 IO 真实实现 |
| DOM 增强 `onNodeInserted` / `onWindowMigrated` | warn-stub（单窗口宿主），返回 no-op destroyer |
| `Plugin.registerHoverLinkSource` / `hoverPopover`·`HoverParent` | **R25：`registerHoverLinkSource` 升真实无操作登记**（记录 source id 返回——Geode 全局悬停预览已覆盖插件渲染的 `a.internal-link`，无需插件参与）；插件自渲染预览 `hoverPopover`/`HoverParent` **仍为缺口**（插件被 Geode 全局 hover 被动覆盖，但其自挂 popover 不生效） |
| `app.internalPlugins`（书签 instance API） | **R27：书签数据文件 `.obsidian/bookmarks.json` 双向保真** + **R158：`getPluginById("bookmarks").instance` 真实现**（`getBookmarks`[经 serializeItem→canonical wire 形]/`getItemTitle`/`addItem`→`bookmarks.add`/`removeItem`→递归 value-match+`removeAt`，写 delegate R27 vetted opChain；`getPluginById/getEnabledPluginById` 对 "bookmarks" 返实例、其余 null；非公开 API de-facto 形状）。**R159：`getPluginById("daily-notes").instance.options`** 真实现（`{folder,format,template,autorun}` live getter 读 R48 设置 Stores；两-id inline 重构成查找 record + `Object.hasOwn` 守卫防原型键；`plugins["daily-notes"]` 现得真 wrapper）。**仍缺**：bookmarks instance Events(`on`)/`editItem`/`bookmarkLookup`；其余 `getPluginById(X)`（global-search/graph/file-explorer 等，几乎无插件依赖）仍 null |
| **R60 新登记 ↓（商业主轴 = 插件迁移，2026-06-14 全景调研 II code-verify）** | |
| `workspace.on('file-menu'/'editor-menu'/'files-menu')` 右键菜单钩子 | **全收官（R130 file + R131 editor + R139 files 出队）**：~~file-menu~~（**R130 phase 1**：core 菜单贡献注册表在 core 会合——compat 写 provider[`menuCollect.ts` CollectorMenu 录项零 DOM] + Explorer 读 `collectFileMenu` 渲染）+ ~~editor-menu~~（**R131 phase 2**：compat-only——`editorMenu.ts` 经 R115 core editorExtensions 注入 always-on CM contextmenu 扩展，fire `editor-menu` + 真 Menu showAtMouseEvent；**plugin items only**=文档化偏离）+ ~~files-menu~~（**R139 phase 3**：多文件右键——镜像 R130 跨 3 层平行=core `FilesMenuContext`/`registerFilesMenuProvider`/`collectFilesMenu`[与单文件 trio **独立**=Obsidian 真发两事件 TFile vs TFile[]] · compat files-menu provider[`getFolder??getFile` 解析混选、CollectorMenu 复用、trigger] · Explorer 右键多选内调多文件版[{count} header]、无插件项回落单文件；render contributed 提取共享尾块=单文件 byte-identical；R138 多选解锁前置）。**续 phase 缺**：editor-menu 原生编辑项 · 其它 source（tab/link/more-options）· section 排序（v1 按插入序）· 批量操作（原生 data-safety 轮）· 文档化偏离=files-menu v1 无插件项回落单文件菜单 |
| `Plugin.registerMarkdownPostProcessor` / `registerMarkdownCodeBlockProcessor` | **部分（R132 phase 1：阅读视图出队）**：新 core `markdownPostProcessors` 注册表（镜像 R115）在 core 会合——compat 写、EditorPane 阅读视图读 `getMarkdownPostProcessors` 在 hydration effect 应用到渲染后的 `.preview-content`（**不动 `core/markdown.ts` 字节渲染**=加性 display-only、§C 不触发、无 vault 写，r26-bytes 0 invariant 坐实）。ctx={docId,sourcePath,frontmatter,containerEl}+sortOrder；getSectionInfo/addChild=phase-1 桩。**R133：~~registerMarkdownCodeBlockProcessor~~ 阅读视图出队**（Dataview/Tasks 主要机制）——core `makeCodeBlockPostProcessor`（渲染后扫 `pre>code.language-<lang>`、移除 `<pre>`、给 handler 新 div）经 R132 注册表；内置 mermaid/query=`.geode-*` div 不冲突。**R134：~~代码块 live preview~~ 出队（大头闭环）**——`​```dataview`/`​```tasks` 在**编辑模式**也渲染：新 core `lang→handler` 注册表（`registerCodeBlockProcessor` 单点双注册阅读 post-processor + live Map）+ `livePluginCodeBlocks` 复用 liveQuery/liveMermaid 的 `liveBlockWidgets`（块级 REPLACE + atomicRanges + 光标揭源，纯视图零字节写、不动 markdown.ts）+ EditorPane revision→reconfigure；detector 排除内置 mermaid/query 防双装饰。**R135：~~addChild~~ + ~~live getSectionInfo~~ 出队（ctx 补全·大头收尾）**——ctx 的 `addChild(child)`（MarkdownRenderChild 生命周期）+ `getSectionInfo(el)` 转真：新 core `RenderChildOwner`（跨层 owner、features 建之 core 不 import compat Component）+ compat `MarkdownRenderChild extends Component`；阅读视图卸载钩=EditorPane preview effect cleanup、live=`PluginCodeBlockWidget.destroy(dom)`（owner 挂 dom WeakMap）。**byte-neutral**：live getSectionInfo `{text,lineStart,lineEnd}` 经 CM `doc.lineAt`；阅读视图 getSectionInfo 返 null（DOM→源行需 markdown.ts `data-line`=§C，defer）。评审 1 MAJOR 修=addChild 加 `loaded` 终态守卫（漏抄 Component `if(_loaded)`→异步 late-add 泄漏）。**R136：~~阅读视图 getSectionInfo~~ 出队（大头真·收官）**——**opt-in `sourcePos` flag**（仅 EditorPane 传）→ 新 core ruler `geode-source-pos` 守卫 `if(!env.geodeSourcePos) return` 给顶层块发 `data-line`/`data-line-end`（默认路径**逐字节不变 r26-bytes 0 按构造**、export/hover/embeds 不染）；feature `readingViewSectionInfo` `el.closest("[data-line-end]")` DOM-walk。评审 1 MINOR 修=walk 键改 data-line-end（旧 task-checkbox 只写 data-line 致倒置区间）；§C byte-isolation 追 12 调用点+对抗等价全证伪。**大头真·收官**（R132 通用·R133 代码块阅读·R134 代码块 live·R135 ctx addChild/live-getSectionInfo·R136 阅读视图 getSectionInfo）。**v1 gap**：自定义渲块（fence/math/callout/table/hr）+ 嵌入无 data-line→getSectionInfo null（文档化偏离） |
| ~~`Plugin.registerEditorExtension`~~ | **R115 出队**：新 core `editorExtensions` 注册表桥接（compat 写、EditorPane 读+订阅 revision）；新 compat compartment，register/dispose 经 revision reconfigure 所有 open view + 新 view seed。数据安全：reconfigure 无 doc change + autosave 是 view 外 updateListener → 编辑期注册不丢 |
| ~~`app.commands`（executeCommandById / listCommands / commands / findCommand / executeCommand / editorCommands）~~ | **R113+R118 出队**：架在 core `CommandRegistry` 上（共享原生 palette 注册表）。R113=executeCommandById（尊重 available 预检）/listCommands/commands（name thunk 解析成 string）。R118=findCommand(id)/executeCommand(command, by-id 回查)/editorCommands。**R121=removeCommand(id)**（新 core CommandRegistry.removeById=delete+revision bump，与 register disposer 逐字段一致）。**app.commands 全成员完成。** **偏离**：editorCommands 恒 `{}`（Geode 不单独追踪 editor-scoped）；executeCommand 不执行未注册的传入对象 |
| ~~`vault.readBinary` / `createBinary` / `modifyBinary`~~ | **R111+R120 出队**：R111=readBinary/createBinary 桥接 core 原生二进制 IO（toArrayBuffer 拷贝防别名、createBinary 返 TFile、连带修 core createBinary 缺的 assertSafeRelPath）。**R120=modifyBinary**（二进制覆盖写）——新 Rust `vault_modify_binary` 原子 tmp+rename（覆盖且无截断竞态，crash 只丢 tmp）。图片/PDF/Excalidraw 类插件可读/写/改附件。`DataAdapter.writeBinary` 仍 create-only（覆盖走 Vault.modifyBinary） |
| ~~`MarkdownView.getMode/getViewData/setViewData`~~ / ~~程序化模式切换~~ + ~~`workspace.activeEditor`~~ | **部分**：~~getMode/getViewData~~（**R116 出队**）+ ~~activeEditor~~（**R117 出队**：live getter→makeActiveMarkdownView，MarkdownFileInfo 超集）+ ~~setViewData~~（**R123 出队**：editor.setValue→CM dispatch→autosave 安全落盘，clear 忽略；**没用 handle.setText[会静默丢数据]**）+ ~~程序化模式切换~~（**R137 出队**：gate 揭示 Obsidian `MarkdownView` 无 public `setMode`[`currentMode` 是内部属性]→真 API=`WorkspaceLeaf.setViewState({type:markdown, state:{mode,source}})`；补 setViewState honor mode-only 变更→`applyViewStateMode`→setTabMode[Ctrl+E 同 sink]，preview→preview/source+source:false→live/source→source；评审修=加 viewType==markdown 守卫防盖非 md tab）。`MarkdownFileInfo.hoverPopover` 仍缺。**已知偏离**：阅读视图非 CM-backed → reading mode active MarkdownView 返 null；source bool 缺省→raw source（同 openFile collapse） |
| ~~`MetadataCache.getTags()`~~ + ~~`CachedMetadata.embeds`~~/~~`sections`~~/~~`listItems`~~/~~`frontmatterLinks`~~ + ~~`fileManager.generateMarkdownLink`~~ | **部分**：~~getTags~~（**R114 出队**：投影 core `getTagMap`→`Record<string,number>`，大小写敏感 deferred 偏离）+ ~~embeds~~（**R119 出队**：`![[..]]` wikilink 嵌入从 links 拆出，original/position 含 `!`；**偏离 O1**：EmbedCache.link 丢 `#anchor`+无 alias 不派生 displayText[既有]；**O2**：转义 `\![[]]` 误判为 embed[罕见]）+ ~~sections~~（**R124 出队**：顶层块 segmenter，fenced code 原子、heading/thematic 单行断段、按首行分类；D2-D6 顶层近似偏离文档化）+ ~~listItems~~（**R125 出队**：行级 parser，缩进栈 parent、task、`^id`；评审揪修 2 MAJOR[fence 不感知 + `^id` 挂错连续兄弟末项]；position 单行近似文档化）+ ~~frontmatterLinks~~（**R126 出队**：属性值 `[[wikilink]]` 扫描，key=field/`field.N`，link 去 subpath 镜像 core WIKILINK_RE，displayText=alias；markdown 式属性链接 = 文档化偏离）+ ~~footnotes/footnoteRefs~~（**R127 出队**：core 补 `[^id]` 引用捕获[定义 R65 已有]，扫 `masked` 排除 code/frontmatter；compat 桥接两者 {id 无 caret, position}，跨 no-content transient；内联 `^[text]` 脚注=文档化偏离）+ getFileCache 形状余项 referenceLinks + ~~generateMarkdownLink~~（**R112 出队**） |
| ~~`app.loadLocalStorage/saveLocalStorage/isDarkMode`~~ + `MenuItem.setSubmenu` + ~~`Editor` 完整版方法~~ | **部分**：~~loadLocalStorage/saveLocalStorage/isDarkMode~~（**R129 出队**：per-vault localStorage[key=`geode-ls:<vault>:k`，JSON round-trip，null 清除] + isDarkMode 读 resident body theme class；纯 UI 态零 data-safety）；Menu 二级菜单（`ui.ts` MenuItem 无 setSubmenu）；~~Editor 余项~~（**R128 出队**：listSelections/setSelections/setLine/transaction/wordAt/scrollIntoView/scrollTo/getScrollInfo/exec[17 命令映射]/undo/redo/blur/refresh——直接映射 CM6，写经 dispatch→autosave；~~**多光标折叠**=Geode CM 无 allowMultipleSelections[R57]~~ **【2026-06-21 全表面校准更正：上述 R57 注为 stale】** R63 已 `EditorState.allowMultipleSelections.of(true)`（cmExtensions.ts:651）→ 多光标实际可用、listSelections/setSelections 覆盖全 ranges；唯一残留偏差 = setSelections 漏 `main?` 索引参数（obsidian.d.ts setSelections(ranges, main?)）） |

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

### 全表面再校准审计（2026-06-21 · 13 域并行 explorer + 对抗 code-verify · 对照权威 obsidian.d.ts ≈v1.9，297 导出）

> **方法**：13 个域 explorer 逐成员对照 obsidian.d.ts（≈v1.9.x，含至 1.13.0 成员），每条「缺口」断言由 verifier 在 `src/` grep 证伪防 stale gap。**统计绝不通胀**：type-only 接口（运行时擦除、bundle 插件不 import 本仓 .d.ts）不计为可执行缺口；out-of-scope（Bases/CLI/popout/移动端）按 T3 只记录不入队。

#### 13 域覆盖矩阵

| 域 | full | partial | stub | missing | out-of-scope | 备注 |
|---|---:|---:|---:|---:|---:|---|
| global-augmentations | 25 | 1 | 2 | 8 | 1 | sleep 全局缺席=唯一 med |
| app-plugin-lifecycle | 24 | 5 | 5 | 4 | 4 | fileManager/Command/SettingTab 三 partial 是 high |
| vault-files | 49 | 6 | 9 | 3 | 2 | getResourcePath 是 high |
| metadata-cache | 26 | 6 | 0 | 13 | 0 | parseLinktext 缺席=high |
| workspace | 17 | 23 | 0 | 52 | 1 | missing 多为 popout/layout-tree=low |
| views | 9 | 4 | 0 | 17 | 0 | TextFileView/previewMode 偏 T2/T3 |
| editor | 6 | 4 | 1 | 11 | 0 | editorInfoField/LivePreviewField 是 med |
| suggest-keymap | 15 | 1 | 1 | 1 | 0 | ✅ AbstractInputSuggest done（R167，full+1/missing−1） |
| ui-components | 16 | 3 | 3 | 7 | 0 | addColorPicker/ColorComponent=med |
| markdown-render-search | 6 | 4 | 1 | 18 | 0 | prepareFuzzySearch/loadMermaid/sanitizeHTMLToDom |
| utils-icons-platform | 12 | 3 | 0 | 19 | 0 | parseYaml/setIcon Lucide/base64 桥 |
| bases-values-cli | 0 | 0 | 0 | 2 | 54 | 整族 T3，仅 Tasks/DisplayValue 记为 missing |
| settings-secrets-protocol-events | 11 | 1 | 1 | 50 | 0 | missing 多为 1.13.0 声明式 Settings |
| **合计** | **215** | **61** | **23** | **206** | **62** | 总 567 |

#### apiVersion 漂移（载入性结论，非纯文档）

**✅ R168 已解决（升 "1.8.0"）**——下文为原始审计记录。`apiVersion = "1.5.0"`（util.ts:51）落后于审计所对 d.ts（≈1.9，成员至 1.13.0），且 `requireApiVersion` 对此字符串做 semver 比较（util.ts:67）。**漂移是载入性的**：Geode 实际已实现远超 1.5.0 的面（removeCommand 1.7.2 · onUserEnable 1.7.2 · getFileByPath 1.5.7 · getAllFolders 1.6.6 · copy 1.8.7 · footnoteRefs 1.8.7 · frontmatterLinks 1.4.0 · setErrorMessage 1.13.0 · addComponent 1.11.0），却自报 1.5.0 → 任何 `requireApiVersion(">=1.6")` 的插件得 `false`，**静默走 legacy/禁用分支**，且 manifest `minAppVersion>=1.6` 触发载入器 warn+设置页标注。反向看 1.5.0 对「未实现的 1.10+ Bases / 1.13 声明式 Settings」是诚实的。**建议**：升到 ≈"1.8.0"/"1.9.0"（匹配已实现面、避免假阴性），同时保持对 1.10+ 全新族的诚实门控；纯字符串常量改动，semverCompare 逻辑本身正确。注意 appendBinary(1.12.3) 等未实现，故不可虚报过高版本。

#### NEW 缺口清单（未在 live gap 表 L126–155 追踪 · 按迁移价值排序）

**高价值（零新依赖、流行插件直接依赖）**
- ~~**parseLinktext**（metadata，missing）~~ — ✅ **R168 完成**（util.ts，不 trim、subpath 含 `#`，对齐 Obsidian 真实源、与 getLinkpath 分立不合并）。Dataview/Templater/链接处理插件普遍调用。
- ~~**prepareFuzzySearch + prepareSimpleSearch**（render-search，missing）~~ — ✅ **R171 完成**（ui.ts：prepareFuzzySearch curry 私有 fuzzyMatch、prepareSimpleSearch 新 word-substring；+ SearchMatches/SearchMatchPart 类型别名；r171-e2e 14/14）。Dataview/QuickAdd 直接调用。
- ~~**AbstractInputSuggest&lt;T&gt;**（suggest-keymap，missing）~~ — ✅ **R167 完成**（=第七梯队 B3①/第八梯队 D4）：新类 extends 既有 `PopoverSuggest`、`textInputEl.getBoundingClientRect()` 自包含浮层（不复用 manager 绑死 CM6 坐标的 position()）、复用 `.geode-suggest-popup` 样式=零 CSS/零依赖。Templater/QuickAdd/Periodic Notes 的 FolderSuggest/FileSuggest import 不再 module-eval 抛错。r167-e2e 25/25。
- **Vault.getResourcePath / DataAdapter.getResourcePath**（vault-files，stub，L 高）— 现返回 vault 相对路径而非可加载 URI；全仓无 Tauri asset-protocol/convertFileSrc 桥。Excalidraw/image-toolkit/PDF++/媒体嵌入构建 `<img>/<embed> src` 静默失败。
- **setIcon Lucide 覆盖**（utils-icons，partial，L 高）— 仅 12 个手绘内置图标，其余 Lucide 名渲染空 placeholder（不崩但无字形）。生态绝大多数 ribbon/command 图标不可见。
- **parseYaml / stringifyYaml**（utils，missing，L 高）— Dataview/Templater/QuickAdd/Tasks/MetaEdit 读写配置/frontmatter 重度调用；**但需打包 YAML 运行时库 = §自主契约硬边界 #5（新运行时依赖），须用户拍板**，故记录但不自动入队（或评估自研 YAML 子集）。

**中价值（多为已有内部能力的一行级桥接 / 速赢）**
- ~~**sleep（全局）+ nextFrame + Document.on/off**（global-aug，missing，med）~~ — ✅ **R169 完成**（dom.ts g block 加 `g.sleep`/`g.nextFrame`，`()=>resolve()` 包装防 timer-id 透传；抽 `delegatedOn`/`delegatedOff` 共享函数、HTMLElement+Document 两 prototype 复用委托监听；global.d.ts 补 interface Document + declare sleep/nextFrame）。QuickAdd/Templater 脚本 crash-safety。
- **editorInfoField + editorLivePreviewField + editorEditorField + editorViewField + Editor.getDoc**（editor，missing，med）— R115 已开放 registerEditorExtension 后，CM6 装饰/widget 插件靠这几个 runtime StateField 取活动文件/EditorView、并把渲染门控到 Live Preview。Geode 已有 live/source modeCompartment + activeEditor 可回填。getDoc 一行 `getDoc(){return this;}` 救 CM5-legacy 插件。
- ~~**loadMermaid（再导出）+ renderMath/finishRenderMath + sanitizeHTMLToDom**（render-search，missing，med）~~ — ✅ **全完成**：~~loadMermaid~~ R168；~~renderMath/finishRenderMath/loadMathJax~~ R170；~~sanitizeHTMLToDom~~ ✅ **R173**（compat/obsidian/sanitize.ts 保守 allowlist + 惰性 template + 迭代 TreeWalker + isSafeUrl 控制字符剥离；🔒 heavy XSS 对抗评审 ~50 向量 0 可执行绕过；r173-e2e 31/31）。设置页/渲染输出常用安全 DOM 构建器。
- ~~**arrayBufferToBase64 / base64ToArrayBuffer / getBlobArrayBuffer**（utils，missing，med）~~ — ✅ **R168 完成**（util.ts 三件套桥接 core/net bytesToBase64/base64ToBytes，`.buffer` 无 slack 因 exact-size alloc）。Excalidraw/媒体附件用。
- ~~**MarkdownPreviewRenderer 静态 registerPostProcessor**（views/render，missing，med）~~ — ✅ **R172 完成**（plugin.ts 新静态类，registerPostProcessor/unregisterPostProcessor 桥接 R132 核心注册表[disposers Map 跟踪] + createCodeBlockPostProcessor 纯工厂；r172-e2e 6/6）。老式静态调用路径渲染插件。
- **~~FileManager.getAvailablePathForAttachment + getNewFileParent~~ + adapter.stat**（vault-files，stub，med）— ~~getAvailablePathForAttachment/getNewFileParent~~ ✅ **R174**（接进 makeFileManager Proxy、复用 uniquePath/resolveAttachmentDir/resolveNewNoteFolder）；**剩 adapter.stat ⏸**=须新 Rust fs::metadata + 扩 VaultAdapter（defer）。paste-image/QuickAdd/Excalidraw 去重附件路径。
- **Setting.addColorPicker + ColorComponent**（ui-components，stub/missing，med）— 现 reportGap 静默丢控件。Style-Settings 邻近、callout/tag 颜色、主题微调插件用。约 120 行组件（hex↔rgb↔hsl + 原生 `<input type=color>`）即闭合。
- **registerObsidianProtocolHandler 派发 + registerExtensions**（lifecycle/protocol，stub，med）— Geode 已有原生 obsidian:// 管线（core/obsidianUri.ts + features/editor/obsidianUriHandler.ts）但只跑内置 open/new/search；插件注册的自定义 action（Advanced URI、QuickAdd capture URI）不派发。registerExtensions 让 Excalidraw `.excalidraw`/图片/PDF 查看器关联视图。
- ~~**Workspace.getMostRecentLeaf + setActiveLeaf + openLinkText eState 子路径**（workspace，missing/partial，med）~~ — ✅ **R175 完成**（openLinkText parseLinktext+resolveSubpath.slice(1)→requestReveal 滚动 #heading/^block；getMostRecentLeaf=activeLeaf facade；setActiveLeaf=sidebar reveal/no-op；r175-e2e 10/10）。Templater/QuickAdd 导航。
- **~~getLanguage + getIcon + getIconIds + Platform.resourcePathPrefix~~ + App.lastEvent**（utils/lifecycle，missing/stub，med）— ~~getLanguage/getIcon/getIconIds/Platform.resourcePathPrefix~~ ✅ **R174**（locale.get() / getIconSvg→SVGSVGElement / BUILTIN+registered keys / 占位 ""）；**剩 App.lastEvent ⏸**=须 app-shell 全局事件捕获（越 compat 自包含、defer）致 Mod/Shift 点击 Keymap.isModEvent 不识别。

#### 全新 API 族（T3 / out-of-scope，只记录不入队，防下轮重发现）

- **Bases / Value / FormulaContext / QueryController / parsePropertyId**（≈54 导出，@1.10.0）— 依赖未建的数据库引擎；Dataview/Templater/Tasks/Calendar/Excalidraw/QuickAdd/Periodic Notes/Style Settings/Admonition 零依赖。**crash-safety 缓解（可选）**：导出抛友好错误的惰性占位类（BasesView/各 Value 子型），避免 `extends undefined` 在 class-eval 硬崩、让插件其余功能仍载入。
- **声明式 Settings 族**（SettingDefinition*/SettingControl*/SettingGroup/SettingPage/SettingTab.getSettingDefinitions 等 ≈50，@1.13.0）— 全字段经 grep 证实一致缺席；被 apiVersion 1.5.0 门控、插件回落 display()+new Setting()（已全实现）。截至 cutoff 无流行插件采用。
- **SecretStorage / SecretComponent / App.secretStorage**（@1.11.4）— AI/sync/API-key 插件 niche。
- **registerCliHandler / CliFlags**（@1.12.2）— CLI 面，GUI 插件无关。
- **popout / 多窗口**（WorkspaceWindow/WorkspaceFloating/moveLeafToPopout/openPopoutLeaf/onWindowMigrated）— 单窗口宿主天然不做。
- **RenderContext（@1.10.0）/ TextFileView·EditableFileView·MarkdownPreviewView / FileSystemAdapter**— 偏 T2/T3（中央 pane 自定义视图宿主、桌面绝对路径），demand 低。
- **DisplayValueComponent(1.13.1) / ConfirmationModal(1.13.0) / ProgressBarComponent / SecretComponent**— 全新、几乎零插件采用。

> 校准结论：高频核心面已 full/partial 覆盖到位；剩余 missing 以「无当前流行插件依赖的全新 1.10–1.13 族」为主（无害、apiVersion 已正确门控）。下轮入队只取上「NEW 高/中价值」清单，绝不把 T3 全新族当可执行缺口刷数。

### R265 套件回归（2026-06-28，TFile.stat 真 ctime/mtime/size：FS metadata → core tree → compat TFile·跨 Rust+core+compat·逻辑档·零新依赖·只读元数据 · 简化门 −5 · ultracode 4-lens 4 confirmed[1 minor+3 nit·均 ship·全已修]+17 refuted · 桌面 by-equivalence）

R265 = r264-probe 法（载真 Templater+Dataview 跑基操·捕 reportGap）取最高值非投机 gap = **TFile.stat**（probe 实测 `f.stat.size===0`·应 501·Dataview `file.size`/`SORT file.ctime` 静默错数据·像 R262 类型化）。Templater 设置渲染=1.13 声明式框架（9 类型）证伪太深搁置。**详见 ARCHITECTURE「Round 265 additions」**。

**套件矩阵（R265·不回退）**：
- **r265-e2e 11/11 全绿**（新增）= create size=501（content byte length·原 0）· modify size=8 + ctime 保留 + mtime 进 · **rebuild ctime+size 存活**（设计守的回归：memory times map + tree-carried stats）· 真 Dataview `TABLE file.size` 非零。
- **修 3 层（全只读元数据·零写路径）**：Rust `read_dir_recursive` 读 `fs::metadata`→ctime/mtime/size 进 `Node::File`（`invoke<FolderNode>` 直反序列化）· core `FileNode` 加可选 stats + `MemoryVaultAdapter` times map（touch/moveTimes/dropTimes）+ fileStat（size=byte length）· compat `applyStat`/`ensureFile(node?)`/`treeNode` 外部改兜底 · 删 `reportGap("TFile","stat")`。
- **回归不回退**：r261 Dataview 13 · r263 Templater 10 · r264 8 · r262 18 · **r28 rename 23** · **r93 copy 22** · **r42 delete 17** · **r33 字节 37** · r24 12 · r127 15。
- **🔓 依赖**：零新依赖。**数据安全**：stat 全程**只读元数据**（grep 无写路径读 `.stat`·touch/moveTimes/dropTimes 纯 times-map 副作用·内容写路径未碰）·4-lens data-safety 零数据丢失/零内容损坏（1 nit）。
- **桌面 probe by-equivalence**：headless WKWebView 此环境不载 GUI → Rust `fs::metadata` cargo+release build 验证 + `FileNode→TFile.stat` 管线两端同码且浏览器证明 + 只读元数据无写面。

### R264 套件回归（2026-06-28，编辑器抗插件 inline-query ViewPlugin 崩溃硬化：editorInfoField 非空 + tokenClassNodeProp 桥·逻辑档·零新依赖·纯读 · 简化门 clean · ultracode 4-lens 3 confirmed[全文档级·均 ship]+15 refuted · 桌面 N/A-by-equivalence）

R264 = R263 后**用新 probe 法**（载真 Templater+Dataview 跑基操·捕 reportGap+未捕异常）揪出 Dataview inline-query CM6 ViewPlugin 在编辑器开 live 模式时的**真崩溃**（CM6 隔离·编辑器存活·但每开笔记报错+inline 渲染断）：① `field(editorInfoField).file` 读 null（R260 字段初始 null·插件构造期在 seeding microtask 前无守卫读）② `type.prop(tokenClassNodeProp)`（新版 @codemirror/language 删此导出→undefined→崩）。**详见 ARCHITECTURE「Round 264 additions」**。

**套件矩阵（R264·不回退）**：
- **r264-e2e 8/8 全绿**（新增）= Part A probe 插件 CM6 ViewPlugin 构造期读 `editorInfoField` **非空** + `.file` 不抛 + `app` 在（直接复现 Dataview 崩路径）· Part B 真 Dataview 开笔记 live 模式编辑器渲染 + **0「CodeMirror plugin crashed」**（原 2）。
- **修两处（全只读·零写路径）**：`editorFields.ts` editorInfoField.create() 返非空 info（新 editorInfoHostFacet 携 {app,registry}·editor 省略·microtask 仍 reseed 全 info）·`loader.ts` 桥 @codemirror/language 加 `tokenClassNodeProp ?? new NodeProp()`（NodeProp 取已 bundle 的 @lezer/common·零新依赖·未动 package.json）。
- **回归不回退**：**r260 StateFields 12/12（editorFields 重写不退）** · **r261 Dataview LIST 13/13** · **r263 Templater 10/10** · r262 typed-frontmatter 18 · r115 editor-extension 7 · r134 code-block 24 · r106 editor 12 · r33 字节 37。
- **🔓 依赖**：零新依赖（@lezer/common 是 @codemirror 的 transitive dep·已 bundle·已直接 import 先例 formatCommands.ts·未动 package.json）。**数据安全**：纯读·零新写路径（4-lens data-safety 0 confirmed·create 只读 info·microtask effect-only 不触 autosave）。
- **2 记档 + 1 nit（均 ship·非码缺陷）**：① @lezer/common phantom（守边界不动 package.json）；② editorEditorField 留 null 真因（create 无 view + Dataview 不读·latent gap 记档）；③ reading-view inline 渲染降级声明（验证的是 reading-view BLOCK·inline 未断言）。
- **桌面 probe N/A-by-equivalence**：纯 JS editor-field/bridge·两端同码。

### R263 套件回归（2026-06-28，🎉 真 Templater 2.23 = Obsidian 第二大插件载入并执行模板：compat shim 补 newer-app(~1.13) API 面 + CM5 null-mode·逻辑档·零新依赖 · 简化门删 8 死成员 · ultracode 5-lens 1 confirmed[nit·已修]+22 refuted · 桌面 N/A-by-equivalence）

R263 = R261 Dataview milestone 之后**商业主轴 breadth 第二大件**。**Step 0 probe 纠误**：候选 dataviewjs 实为 faithful 非 gap（seed 真 data.json{enableDataviewJs:true} 后 JS 执行真工作·桌面读真 data.json 即生效）→ 转载真 **Templater 2.23（GPL·`isDesktopOnly:false`）**。先 static-diff Templater 的 `require("obsidian")` 用法 vs shim 出口**界定 gap 有界**（非 cascade），再**崩哪补哪 9 blocker**补 newer-app API 面。**详见 ARCHITECTURE「Round 263 additions」**。

**套件矩阵（R263·不回退）**：
- **r263-e2e 10/10 全绿**（新增·Templater GPL bundle 未 committed=gitignored·e2e header 载 fetch）= 真 Templater status=enabled + 4 命令 + `tp.date.now`/`tp.file.title`/`tp.frontmatter.count=7`（经 R262 typed frontmatter）展开 + **展开 PERSIST 落盘（data-safety）** + frontmatter 块完整 + 0 page error。
- **新增 compat API 出口**：`ConfirmationModal`/`SettingPage`/`SettingGroup`（newer settings ~1.13·setting UI render 延后记档）·`FileSystemAdapter`（marker·instanceof 正确 false）·`getFrontMatterInfo`/`resolveSubpath`·`Plugin.registerCliHandler`/`SettingTab.update`（no-op/守卫）·**CM5 stub null-mode**（`getMode→{name:"null"}` 哨兵·插件优雅跳过 CM5 高亮·防 StreamLanguage 崩编辑器）。
- **回归不回退**：**r261 Dataview LIST 13/13（共用 CM5 stub·null-mode 优雅跳过验证不退）** · r258 Sort&Permute 12 · r259 read-time 7 · r260 StateFields 12 · r262 typed-frontmatter 18 · r126 frontmatterLinks 11 · r150 tags 20 · r33 markdown 字节 37。
- **🔓 依赖**：零新依赖（child_process/util 是 Node built-in·Templater lazy require·null-mode 后未触；非 npm·不触硬边界#5）。**数据安全**：全加性 compat shim·零新写路径（5-lens data-safety 0 confirmed·Templater 模板写经既有 editor→autosave[R258 先例]·纯读 getFrontMatterInfo/resolveSubpath）。
- **桌面 probe N/A-by-equivalence**：纯 JS·两端同码·Templater 同 webview·写经 R258-vetted autosave。

### R262 套件回归（2026-06-28，Dataview 深用面 崩哪补哪：compat metadataCache **类型化 frontmatter**·逻辑档·纯读投影·零新依赖 · 简化门 clean · ultracode 5-lens 2 confirmed[均 minor·均非回归·记档]+28 refuted · 桌面 N/A-by-equivalence）

R262 = R261 Dataview milestone 之上**深用面第一刀**。**Step 0 probe 决定性纠误**：`r262-probe` 实测 **LIST/TABLE/TASK/inline-field(`key::`)/inline-`=` 查询全已渲染**（compat metadataCache + cachedRead 已够·非缺失）；唯一 ERROR=`dataviewjs`（Dataview 自身 `enableDataviewJs` 默认 off·faithful·注入 data.json 未被 loadData 接管=次要·留 R263）。`r262-probe2` **判别性数据**揪真 bug：`TABLE rating WHERE rating > 3` 返**全部 3 行**（应 1）——`rating` 经 compat 投影是字符串 `"5"`，Dataview 类型序 `string > number` **恒真** → **静默错数据·无报错**。**根因 = compat `metadataCache.frontmatter` 字符串化**（core `FrontmatterData.fields` 故意 `string|string[]` 撑字节级 properties 写）；真 Obsidian 该面是**类型化 YAML 值**。**修=`compat/obsidian/metadata.ts` 单文件**：新 `typedFrontmatter(content,fm)` 用已授权 js-yaml `parseYaml` 重解析原始 YAML 块为类型值（number/bool/date/null/nested）·try/catch+仅纯对象+content 缺省 fallback；`frontmatterPosition`/`frontmatterLinks`（扫字符串 fields）不变·`FrontMatterCache` 本就 `unknown`=零契约加宽。**详见 ARCHITECTURE「Round 262 additions」**。

**套件矩阵（R262·不回退）**：
- **r262-e2e 18/18 全绿**（新增）= Part A compat 类型投影（getFileCache().frontmatter：number=5/boolean/float=3.5/null/nested map/inline 数组 + getAllTags 消费者不破 + 坏 YAML fallback 不抛）· Part B **真 Dataview 0.5.70 类型查询修复**（`WHERE rating>3`=1 行[改前 3]·NUMERIC SORT 10/2/1[判别 string-sort]·boolean WHERE=2 行）。
- **回归不回退**：r261 Dataview LIST 13/13 · r126 frontmatterLinks 11/11（保留字符串扫描·零影响）· r150 tags 20/20 · r151 13/13 · r33 markdown 字节 37/37。
- **🔓 依赖**：零新依赖（复用 R261 已授权 js-yaml）。**数据安全**：纯读投影·零新写路径（5-lens data-safety 维 6 refuted 坐实·不碰 properties/documents/vault 写·markdown.ts 未碰）。
- **2 记档边界（非回归·均 strictly better than 改前）**：① ctx.frontmatter（`markdownPostProcess.ts`·features 不可 import compat）仍字符串化=保真分歧·Dataview 读 metadataCache 不受影响·统一须 core typed helper（R263 候选 B）；② 无内容 warm-up 不发 changed 事件·仅 >30M 字符库冷文件边缘=同 sections/listItems 既有降级。
- **桌面 probe N/A-by-equivalence**：纯 JS 读投影·两端同码·Dataview 同 webview。

### R261 套件回归（2026-06-28，🎉 真插件迁移商业主轴 milestone：js-yaml parseYaml/stringifyYaml + 真 Dataview 0.5.70 载入并渲染查询·逻辑档·data-safety · 简化门 clean · ultracode 4-lens 0 confirmed+17 refuted · 桌面 N/A-by-equivalence）

R261 = 用户 R260 拐点拍板「授权 js-yaml·试载 Dataview」→ **🔓 硬边界#5 对 `js-yaml@^4.1.0` 解除**（仅此一 runtime dep·仅为 parseYaml/stringifyYaml·实装 4.3.0·+1 包·零 net-new transitive[argparse 早存在]·CM6 不重复）。**🎉 结果：真·未改 Dataview（MIT·2.4M·ES6·require obsidian + @codemirror/* 全在 host bridge）在 Geode 载入 + `dataview LIST` 查询渲染出 vault 笔记列表**——商业主轴最高价值 milestone。**详见 ARCHITECTURE「Round 261 additions」**：`yaml.ts`(parseYaml=js-yaml.load/stringifyYaml=js-yaml.dump·薄 wrapper·global.d.ts 最小 declare module 避 @types/js-yaml 守「仅此一依赖」) + **崩哪补哪 against 真 Dataview**(R258 getLastError 硬化逐次 surface 真错误)：① `Workspace.updateOptions()`=bump editorExtensionsRevision(Dataview 第一阻断·register stable 数组+mutate+updateOptions re-apply 模式)；② loader 旧 `window.CodeMirror` CM5 stub(`{defineMode:()=>undefined, getMode:()=>({})}`·Dataview registerDataviewjsCodeHighlighting·Geode 纯 CM6 该模式不用)。

**data-safety（底线①·逻辑档·满跑·零丢失）**：**R261 不加任何 Geode 写路径**(parseYaml/stringifyYaml 是导出给插件的读/序列化工具·Geode core 不经它 round-trip 用户 .md·grep 证·updateOptions 仅 bump revision·CM5 stub no-op·markdown.ts 未碰[Dataview 渲染走阅读视图 post-processor R132]·r18-diff N/A)·插件经 API 写走 vetted vault.modify。**ultracode 4-lens 对抗评审（21 agents）= 0 confirmed + 17 refuted**(data-safety 全 clear·parseYaml throw-on-malformed/dump-lineWidth:80 = Obsidian 同行为·js-yaml schema 同版·updateOptions+R115 机制对真 Dataview bundle 验证·CM5 stub 边界=doc 建议非缺陷)。**桌面 probe N/A-by-equivalence**(compat-frontend·Dataview 经共享 loader 载入·跨端同)。

**⚠️ 已知 compat 边界（评审建议记档）**：CM5 stub 仅 `defineMode`/`getMode` no-op——真依赖 CodeMirror-5 实例(调 defineMIME/Pos/defineSimpleMode 等·或 feature-detect `if(window.CodeMirror)` 走 CM5 路径)的插件仍崩(Geode 纯 CM6·无 legacy editor)。崩哪补哪 增量·按需扩。

新增套件：`r261-e2e.mjs` **13/13**（Part A parseYaml nested-map/list/scalar/bool + 序列化 + round-trip·Part B **真 Dataview status=enabled[obsidianLoadReport] + window.DataviewAPI set + `dataview LIST` 渲染 `.dataview.list-view-ul` >0 `<li>` 真结果[真 query engine over metadataCache] + raw code block 被消费**）。**套件矩阵不回退**：**r115 7/7[editor ext]·r258 12/12·r259 7/7·r260 12/12[3 真插件 + StateFields]·r221/r171 14/14·r33 37/37·r24 12/12**·typecheck 0·生产构建 ✓·cargo ✓。**Dataview 2.4M bundle 未 committed**(太大·gitignored `.calibration/dataview/`·e2e header 载 fetch 命令)。**真插件迁移进度（Tier 大跃）**：5 手动真插件 + 3 committed 证明(Sort&Permute commands+editor / read-time statusbar+lifecycle) + ES5/tslib 修复 + CM6 StateFields + **parseYaml → 真 Dataview 查询渲染**（重型生态 tier 首次落地）。**下一片**：R262 = Dataview 深用(TABLE/TASK/dataviewjs/inline-fields 写回·崩哪补哪) 或 Templater(也用 parseYaml)·**js-yaml 仅此一个·第二个 dep 须再授权**。

### R260 套件回归（2026-06-27，真插件迁移 pre-Dataview gap：obsidian CM6 editor StateFields[editorInfoField/editorEditorField/editorLivePreviewField + editorViewField 别名]·逻辑档·data-safety·零新依赖 · 简化门 clean · ultracode 4-lens 对抗评审 0 confirmed + 8 refuted · 桌面 probe N/A-by-equivalence）

R260 = R257 roadmap 的 pre-Dataview 无依赖 gap。真插件（Dataview inline fields / decoration 插件）从自己的 CM6 扩展里 `view.state.field(editorInfoField).file` / `editorLivePreviewField`(gate live-preview-only 渲染) / `editorEditorField`(从裸 EditorState 取回 view)。**Editor.getDoc 早 done（R220）。** **type 纠误（scout）**：editorEditorField=`StateField<EditorView>`(裸 CM6 view·非 obsidian Editor)·editorInfoField=`StateField<MarkdownFileInfo>`(轻 `{app, file, editor?, hoverPopover}`·非完整 MarkdownView)。**详见 ARCHITECTURE「Round 260 additions」**：三层桥——`core/editorContext.ts`(2 Facet：editorPathFacet/editorLivePreviewModeFacet·core 定义·features provide·compat read·同 R115 editorExtensions registry 桥)·`features/editor/cmExtensions.ts`(editorModeExtensions 加 `editorLivePreviewModeFacet.of(mode==="live")`[mode compartment 内→3 reconfigure 站点全经它·live↔source 免费 re-provide]+基列表加 `editorPathFacet.of(getPath)`)·`compat/obsidian/editorFields.ts`(3 StateField+别名+`editorFieldsExtension(app,registry)` ViewPlugin 构造期 `new Editor(view)` 一次+`queueMicrotask` effect-only dispatch 填充)·`context.ts` registerCoreEditorExtension(disposer 管理·reload 重注册)·`index.ts` export 4 field。

**data-safety（底线①·逻辑档·满跑·坐实零丢失）**：填充 dispatch **effect-only**(setEditorView/setEditorInfo·无 doc change)→无 docChanged→**无 autosave/dirty**(r260 实测 doc 磁盘字节不变)·editorModeExtensions 仅 ADD facet 值在 livePreview 扩展旁·无 decoration 逻辑改·§C **markdown.ts 未碰**(live-preview CM·非阅读视图)·r18-diff N/A·**桌面 probe N/A-by-equivalence**(纯前端 StateField/facet/ViewPlugin·真插件经共享 loader/registry 读·editor pipeline 跨端同)。**ultracode 4-lens 对抗评审（12 agents·data-safety/faithfulness/edgecases/regression × 逐 finding 对抗证伪）= 0 confirmed + 8 refuted**(microtask-null-window 被 3 lens 提但全证伪：真插件在 update()/decoration provider 读·seed transaction 重触发拿到值·constructor-read-and-cache 非现实·非 regression；editorViewField 别名=现代 Obsidian 真行为；info.editor vs activeEditor.editor 非身份保证；data-safety lens 无丢失路径)。**已知设计**：editorEditorField/editorInfoField 在 seed microtask 前 null（CM6 禁构造期 dispatch·真插件 reactive 读不受影响）。

新增套件：`r260-e2e.mjs` **12/12**（真注入插件注册 CM6 ViewPlugin 读 3 field·**editorInfoField.file=ext1.md + app + editor[getValue]**·**editorEditorField===view**·**editorLivePreviewField true→false on setTabMode source[reactive·mode-compartment facet 翻转]**·editorViewField 别名·**effect-only seed 后 doc 字节不变[底线①]**·无 page error）。**套件矩阵不回退**：**live-preview r106/107/108/109 各 12·r134 24·r135 18·r137 13·r128 19[decoration 不退]·r115 7/7[registerEditorExtension]·r33 37/37·r24 12/12·r258 12/12[真插件]**·typecheck 0·生产构建 ✓·cargo ✓。**简化门 clean**。**真插件迁移进度**：2 个 committed 真插件证明 + ES5/tslib 修复(R258) + CM6 StateFields(R260)·覆盖面渐向 Dataview-class。**下一片**：**R261 STOP-POINT**（Dataview/Templater 卡 parseYaml/stringifyYaml → `js-yaml@^4.1.0` = 硬边界#5·**须用户授权**才能 npm i + 实现 faithful parseYaml + 试载）；或无依赖余 gap（adapter.stat[Rust]/getResourcePath[Tauri asset-protocol]/suggest-modal ES5 支持）。

### R259 套件回归（2026-06-27，真插件迁移：第二 committed 真插件证明[read-time「Words to Read Time」1.0.0·MIT·ES6·零新依赖·零 src 改动]·validation/fixture 轮·focused review CLEAN · 桌面 probe N/A-by-equivalence）

R259 = R258 后续·**零 src 代码改动**（read-time 是 ES6 esbuild bundle·走既有 loader·不需 ES5 fix）= validation 轮：验 committed 真插件 harness 泛化到第二真插件 + 拓宽 API 覆盖面。**vendor** `compat-fixtures/obsidian-read-time-plugin/`（main.js+manifest.json 1.0.0 release 原物·**sha 逐字节同上游**·LICENSE[MIT © ryanschiang]+README）。**互补覆盖面（vs R258 Sort&Permute 的 addCommand+Editor）**：read-time **无命令**·exercises `addStatusBarItem`+`registerInterval`(500ms)+`registerDomEvent(document,"click")`+`getActiveViewOfType(MarkdownView)`+真 `PluginSettingTab`(wpm)·读 active note 词数→状态栏 `"<m>m <s>s read time"`(130wpm)。`isDesktopOnly:true` loader 不 gate（浏览器 E2E = desktop app 的 dev surface·非 mobile·正确）。**data-safety 非 scope**（read-only 插件·只读 editor 词数+写状态栏 DOM+saveData 持 wpm 到 data.json·**零 vault 写**·grep 证）。**分档=validation 轮（零 src·非数据安全）→ 跳简化门 → focused review（e2e 假阳性 + fixture 完整性 + data-safety sanity）= CLEAN + 1 nit[e2e 注释误称 click 触发 recompute·实 interval·已校]**·review 坐实 e2e 真绑插件执行（status=enabled 仅 onload 不抛才达·状态栏文字是插件 `setText` 非 Geode·非零值仅能来自插件读 live 词数·dynamic recompute 真切 note）。

新增套件：`r259-e2e.mjs` **7/7**（真 MIT 插件 enabled[obsidianLoadReport]·状态栏初始 "0m 0s read time"·**260 词→~2 min[260/130]·字节级**·**13 词→0 min·dynamic recompute 真按 active note**·无 page error）。**套件矩阵不回退**：**r258 12/12[共享 loader/harness·两真插件并存]**·typecheck 0·桌面 probe N/A-by-equivalence（同 loader·read-only 插件）。**真插件迁移进度**：2 个 committed 自动化真插件证明（Sort&Permute commands+editor·read-time statusbar+lifecycle+settings）+ ES5/tslib 修复（R258）→ 覆盖 addCommand/Editor/metadataCache/workspace/addStatusBarItem/registerInterval/registerDomEvent/getActiveViewOfType/PluginSettingTab。**下一片**：R260（CM6 editorInfoField StateFields / adapter.stat[Rust] / getResourcePath·无依赖 pre-Dataview gap）→ **R261 STOP-POINT**（js-yaml@^4.1.0 授权 + parseYaml + 试载 Dataview）。

### R258 套件回归（2026-06-27，真插件迁移：首 committed 真插件证明 + ES5/tslib base-class 修复 + loader 硬化[Sort & Permute lines 0.7.0·MIT·零新依赖]·逻辑档·data-safety · 简化门 clean · ultracode 4-lens 评审 data-safety PASS + 1 confirmed[已修]+8 refuted · 桌面 probe N/A-by-equivalence）

R258 = 用户拍板「选项1 真插件迁移商业主轴」R257 立项首项。**🔑 立项 read-only scout 决定性发现**：Geode `compat/obsidian/loader.ts` 早已是完整 host·**5 个真社区插件今天就在跑**（nldates/calendar/recent-files/url-into-selection/better-word-count·gitignored compat-vault·手动 desktop probe）→「真插件迁移」非从零·T0-T2 闭环已成。R258 把「5 个跑·手动信我」变成**首个 committed/自动化真插件回归**：vendor 真 MIT 插件 **Sort & Permute lines 0.7.0**（`compat-fixtures/obsidian-sort-and-permute-lines/{main.js,manifest.json,LICENSE,README}`·release 原物·**非 src/·不 ship**·e2e fs 读 + `window.__geodeObsidianPlugins` 注入·镜像 r221）。

**🔑 首证明立抓真 gap = ES5/tslib base-class 不兼容**（详见 ARCHITECTURE「Round 258 additions」）：真插件编译为 **ES5 + tslib `__extends`** 时派生 ctor 经 `Base.apply(this, args)` 继承·shim base 是 **ES6 class** → 抛 "Class constructor cannot be invoked without 'new'"。**5 个既有真插件能跑 = 它们 ES6-target（super()）；ES5/tslib 插件全挂**（Tier 盲区·此前无 committed 真插件证明故未暴露）。**修 = `compat/obsidian/es5compat.ts` `es5Callable(Base)` Proxy `apply` trap**（构造真实例·Object.assign own 字段嫁接到已带原型链的 this·`|| this` 期望 truthy 返回·new/super 走默认 [[Construct]] 透明转发·**instanceof 双向保持**）·接 `loader.ts` require("obsidian") bridge（`obsidianForPlugins`·仅插件可见·shim 内部+index.ts 仍 raw ES6）。**评审纠（minor·已修）**：throwaway-harvest 仅对【字段-init/detached-DOM-in-fields】base 正确·**ctor 绑 `this`-捕获 listener 的 base（Modal/SuggestModal/FuzzySuggestModal/EditorSuggest/AbstractInputSuggest）拷贝后 listener 仍绑废弃 throwaway→静默失效**→**包装集收窄至 throwaway-safe only**（Plugin/Component/MarkdownRenderChild/PluginSettingTab/View/ItemView/FileView）·suggest/modal 族故意不包→ES5 继承它们 hard-fail 带清晰 getLastError 错误（非静默坏实例·不比 R258 前差）·留 R259+ 把它们 ctor 注册延迟出 ctor。**②loader 硬化**：`core/plugins.ts` `lastError`+`getLastError(id)`·loader onload-fail report 带真错误（非吞 console）。

**data-safety（底线①·逻辑档 满跑·坐实零丢失）**：真插件经 `editor.setValue/replaceRange`（obsidian Editor shim）→`cm.dispatch`(无 sync annotation)→docChanged→autosave updateListener→防抖落盘·**R258 未碰任何写路径**（editor.ts/documents.ts/vault 零改）·§C markdown.ts 未碰 r18-diff N/A·**桌面 probe N/A-by-equivalence**（loader/shim/es5compat 跨端同码·真 bundle 经真 loader 浏览器载入证明·5 desktop 插件 ES6 不受影响）。**ultracode 4-lens 对抗评审（13 agents·data-safety/faithfulness/edgecases/regression × 逐 finding 对抗证伪）= data-safety lens PASS + 1 confirmed[throwaway-suggest·已修]+8 refuted**（含 MIT LICENSE 复制·已补）。

新增套件：`r258-e2e.mjs` **12/12**（真 MIT 插件 `status=enabled`[obsidianLoadReport]·11 命令注册[namespaced `<id>:<cmd>`]·**sort-alphabetically→"apple|banana|cherry" 编辑器+磁盘字节级**·**permute-reverse→"cherry|banana|apple" 磁盘·底线① 真插件编辑 autosave 落盘**·**坏插件 report 带真 onload 错误[R258_BOOM]·硬化坐实**·无 page error）。**套件矩阵不回退**：**r221 14/14[ES6 注入插件 + `instanceof MarkdownView` 经 wrapped class]·r171 14/14·r166 18/18·r167 25/25[EditorSuggest fixture]·r175 10/10[AbstractInputSuggest fixture]·r33 37/37·r24 12/12**·typecheck 0·生产构建 ✓·cargo ✓。**简化门 clean**。**下一片**：R259（第二代表 read-time·证 PluginSettingTab+statusbar·或 suggest/modal 族 ES5 支持）→ R260（adapter.stat[Rust]/CM6 editorInfoField StateFields/getResourcePath·无依赖 gap）→ **R261 STOP-POINT**（js-yaml@^4.1.0 授权 + faithful parseYaml/stringifyYaml + 试载 Dataview/Templater）。

### R256 套件回归（2026-06-27，view-header「…」more-options 聚合菜单[Obsidian native tab/view 顶部「更多选项」·聚合 视图模式 + 文件操作 + tab/pane·全 wire 既有 vetted 命令]·机械档·零依赖 · 跳简化门 · scoped review[ultracode 3-lens] 1 confirmed[已修]+13 refuted · 桌面 probe N/A-by-equivalence）

R256 = 用户 R255 拐点拍板「收尾最后 bounded 小件」→ autonomous-safe 池最后一件。**verify-first（ultracode 3-scout workflow·web-native + codebase + reference）= native-confirmed**：Obsidian 每个 view/tab 顶部右缘「…」more-options 按钮真 vanilla-core（官方 Tabs help + 版本特定 forum bug 实证），由 leaf pane-menu 构建 = tab 右键菜单 ∪ 文件操作 ∪ 视图模式 toggle。**🔑 pointer 纠误**：「reference 08:35」实为编辑器右键菜单（reference 全树无「更多选项/view-header」字样·spec 从未截「…」按钮）→ 但 web 证实功能真 native → **非 R253-A3 式 phantom·是 mislabeled pointer·BUILD**（faithfulness 使命 > reference 覆盖缺口·R222/R223 先例）。**详见 ARCHITECTURE「Round 256 additions」**：TabBar menu state 加 `kind:"tab"|"viewopts"` 判别·`.tab-bar` 右缘「…」按钮（`more-vertical`·margin-left:auto·按钮在 `.pane` section 内→mousedown-capture 先 setActivePane→wired 命令 target 该 leaf active file）·`cmdMenuItem(id,testid,danger?)` helper（commands.list().find·`available?.()===false` 隐藏[桌面 reveal/open 浏览器隐藏]·label getCommandName·execute(id)）·viewopts 菜单（视图模式 app:toggle-mode[md]｜文件 bookmark/add-property[md]/export-pdf[md]/copy-path/copy-url/**reveal-active-file[跨端·评审补]**/reveal-in-system[桌面]/open-in-default[桌面]/rename/delete[is-danger]｜tab/pane pin/split[fileless 禁用]/close/close-others·markdown/filePath gating·DEFER linked-view 子菜单）·`app.moreOptions` i18n·`.tab-more-options`+`.is-danger` CSS·App.tsx shell 不 import compat（wire 同命令 id·非代码重复）。

**分档=机械档（菜单 wiring 既有 vetted 命令·零新写路径·未碰 editor/vault/markdown·非数据安全）→ 跳简化门 → scoped review（ultracode 3-lens：mechanical/faithfulness/regression × 逐 finding 对抗证伪·17 agents）= 1 confirmed + 13 refuted**。confirmed=「Reveal file in navigation」(`file-explorer:reveal-active-file`·跨端·已注册) 遗漏（**浏览器下两个桌面 reveal 经 available() 隐藏→零 reveal 选项**）→**已修**(+1 行 + e2e 断言)。13 refuted（all-clear 确认 + 正确降级 nit：pin 排序/toggle-mode 静态名/点按钮重开/version-bump 在收尾·均可接受 flat-menu/机械档 行为；命令 id 全注册·i18n/icon/testid 齐·层规合规[只 import @core/commands]·tab 右键菜单不退）。**底线①**：删除走 `app:delete-file`[R242 confirm + R244 孤儿 + flush + recoverable trash]·重命名走 `workspace:edit-file-title`[R16]·菜单零 vault 写（同 R252 口径）。

新增套件：`r256-e2e.mjs` **30/30**（「…」按钮在场[more-vertical glyph]·点击开 view-options-menu[与 tab-context-menu 判别]·markdown view 含全项[toggle-mode/bookmark/add-property/export-pdf/copy-path/copy-url/**reveal-nav**/rename/delete/pin/split/close/close-others]·**桌面项 reveal-in-system/open-default 浏览器隐藏[available() gate]**·delete is-danger·label 走命令名非裸 key·**pin 真执行+active tab pinned+label 翻转 Unpin·toggle-mode 真执行+mode 变**·右键仍开 tab-context-menu·Escape dismiss·无 page error）。**套件矩阵不回退**：**r81 14/14[tab 右键菜单]·r131 8/8·r252 20/20[editor 右键菜单]·r33 37/37·r229 9/9**·typecheck 0·生产构建 ✓·cargo ✓·**桌面 probe N/A-by-equivalence**（纯前端菜单·所 wire 命令 R218/R252 已桌面验证·菜单 UI 跨端同）。**🏁 至此 A 系列 + Vim + Stacked tabs + view-header 菜单全交付 → autonomous-safe bounded 池真清空 → loop 停下盘点交用户**（剩全 boundary-gated：删除去向 parked / Canvas·Bases·真插件迁移 须拍板立项或批依赖）。

### R255 套件回归（2026-06-27，Stacked tabs 实现[Obsidian native「Stack/Unstack tabs」·一个 tab 组同时渲全部 tab 为横向 cascade·R254 立项冻结契约+R255 实现]·逻辑档·零新依赖 · 简化门 clean · ultracode Workflow 4-lens 对抗评审 data-safety PASS + 3 confirmed[1 minor 已修+2 nit]+9 refuted · 桌面 probe N/A-by-equivalence）

R255 = 用户 R253 收尾拐点拍板「Stacked tabs 立项」→ R254 立项（explorer 决定性发现 **Geode 已 split 多 EditorPane 同屏共存 → 多挂载 data-safety 早被 split 解决·非新建面**）+ R255 实现。Obsidian「Stack tabs」= tab 组（`PaneLeaf`）内全部 tab 同时渲为横向 cascade（vs 仅 active tab）·每组独立 toggle。**详见 ARCHITECTURE「Round 254 additions」+ As-built**：加性 `PaneLeaf.stacked?:boolean`·`workspace.toggleStacked(paneId)`[mapLeaf·镜像 toggleTabPin]·`sanitizeNode` leaf 分支 `stacked: n.stacked === true`[**持久化 parity·漏写=重启丢·serialized-field 教训**]·App.tsx PaneLeafView 抽 `renderTab(tab,autoFocus)`[既有 6-way viewType dispatch 提取共用] + stacked 分支 map 全 tab 渲 `.stacked-column`·命令 `workspace:toggle-stacked-tabs`·tab 右键 Stack/Unstack·EditorPane `autoFocus?:boolean`[门控 mount focus·防 N 挂载抢焦]·app.css 横向 cascade·i18n 6 键×中英（官方串 Stack/Unstack tabs·堆叠/取消堆叠标签页）。

**data-safety（底线①·逻辑档 data-safety skill 满跑·坐实零丢失）**：多 EditorPane 同挂 autosave **per-DocumentHandle 非 per-pane**（`documents.ts:54`·split 先例继承）·**unstack 卸载非 active 列 → `release()`[documents.ts:293-306]→`queueMicrotask`→`flush().finally(drop)` 先 flush 待落盘的防抖编辑再 drop**[R16 fix 继承]→ 编辑不丢·§B 无新 .md 写路径（编辑走标准 CM dispatch→autosave）·§C `markdown.ts` 未碰→**r18-diff N/A**·**桌面 probe N/A-by-equivalence**（纯前端渲染 + localStorage 持久化·autosave 落盘已跨端验证·WKWebView 难驱多编辑器焦点）。**ultracode Workflow 4-lens 并行对抗评审（16 agents·data-safety/faithfulness/edgecases/regression × 逐 finding 对抗证伪）= data-safety lens PASS（0 新丢失路径·5 向量全被 split+R16+report-effect 先例覆盖）+ 3 confirmed + 9 refuted**。confirmed：① minor focus-on-activation（stacked 编辑器常驻·经 header/tab-bar/命令 activate 时 mount focus 不重跑→键入落上一聚焦列·**非数据丢失但键盘优先 UX 缺陷**）→**已修**（EditorPane `autoFocus` false→true transition focus effect[modal-guarded R23] + header button `onMouseDown preventDefault` 防 button 抢回焦点）；② nit 注释误称 scrolls→改正；③ nit drop-overlay stacked 横向滚动错位=**v1 限制记档**（niche·零数据安全影响）。9 refuted（off-screen-active 不滚=可接受·inactive 列全宽=可接受表示·双标题=忠实前提错·remount 清 undo=与既有切 tab 一致[undo 存 handle historyHost]·均正确驳回）。

新增套件：`r255-e2e.mjs` **20/20**（默认非 stacked 单挂载·toggle 命令 → 全 tab 同挂为 column[多 EditorPane 同屏]·**双 tab 各自编辑各自落盘[底线①]**·**header 激活聚焦该列编辑器+键入落对列[review 修]**·**非 active 列待保存编辑 unstack-unmount 仍 flush[release→flush·底线①]**·切换不丢编辑·`stacked` reload round-trip[sanitizeNode parity]）。**套件矩阵不回退**：**r81 14/14[tabs]·r39 17/17·r88 13/13·r232 10/10·r33 37/37[字节锁]·r51 10/10·r229 9/9**·typecheck 0·生产构建 ✓·cargo check ✓。**简化门 clean**（renderTab 提取=减重复非加抽象）。**下一片**：A 系列 + Vim + Stacked tabs 全交付 → autonomous-safe bounded 池实质见底 → 盘点交用户（剩 boundary-gated 大件 / 删除去向 parked）。

### R253 套件回归（2026-06-27，编辑器「Vim 模式」toggle[Obsidian native Editor 高级组「Vim 模式」·默认 OFF]·🔓 引入 `@replit/codemirror-vim`[硬边界#5·用户 R250 授权仅此一依赖仅为 Vim]·逻辑档 · 简化门 clean · ultracode Workflow 4-lens 对抗评审 1 confirmed[已修]+8 refuted · 桌面 probe N/A-by-equivalence）

R253 = 用户 R250 拍板「bounded 做完即 Vim」的收官项。**verify-first 跳过 A3**：A3「默认打开文件」WebSearch 证伪疑非 vanilla-native（forum=feature-request + Bug-graveyard 拒绝·疑 Homepage community plugin 漏入 reference 截图）→跳过防 phantom（R145/R242 纪律）→直接做已授权高价值的 Vim。**详见 ARCHITECTURE「Round 253 additions」+ As-built 修订**：`vimMode` Store（默认 OFF·`geode.vimMode`）·`cmExtensions.ts` `vimExtension(on)=on?**Prec.high(vim())**:[]` + `vimCompartment` **基列表注入**（非 modeCompartment·live↔source 切换不销毁·在 R33 `Prec.highest` 命令拦截之下=Cmd+P 等热键仍赢）·`EditorPane.tsx` ref+Compartment+useStore+reconfigure effect+cleanup（逐字镜像 R232 智能列表 compartment-toggle）·SettingsModal **EditorSection 新增「高级」subheader**（`data-testid="settings-subheader-editor-advanced"`·reference 01:42 ground truth：Vim 属 Editor 高级非行为）下放 toggle·ZH 标签对齐官方 obsidian-translations「Vim 模式」。**🔑 实测根因修复（底线① 边缘）**：裸 `vim()` 时 defaultKeymap 的 `Escape→simplifySelection`（R63 多光标）抢过 vim 的 insert→normal Escape **困死用户在 insert 模式**（编辑可继续但退不出=伪正常）→ `Prec.high(vim())` 抬高 vim keymap（仍在 R33 之下）→ r253-e2e 调试探针确认修复。

新增套件：`r253-e2e.mjs` **10/10**（vimMode toggle 默认 OFF + 持久化·**ON→编辑器入 normal 模式[x 删字非插入]**·**i/Z/Esc 编辑触发 autosave→文件落盘[底线① 核心]**·live↔source 切换 vim 存活[vimCompartment 基列表]·OFF→普通键入恢复·无 page error）。**套件矩阵不回退**：**r232 10/10[智能列表 compartment 邻位]·r33 37/37[字节锁]·r88 13/13·r51 10/10·r191 15/15·r225 10/10·r226 9/9**·typecheck 0·生产构建 ✓·cargo check ✓（无 Rust delta）。**分档=逻辑档（碰 editor 管线[cmExtensions/EditorPane] + 新依赖·底线①一票否决）→ data-safety skill 满跑**（vim 编辑走标准 CM dispatch→docChanged→autosave updateListener[documents.ts·无 userEvent/composing 门控·顺序无关]·i+Esc 实测落盘·§A 竞态全不碰·§B 无新 .md 写路径·§C markdown.ts 未碰→**r18-diff N/A**）**→ 简化门 clean[镜像 R232·附带重接被孤立的 R232 smartList JSDoc] → ultracode Workflow 4-lens 并行对抗评审（data-safety/faithfulness/edgecases/regression·每 finding 对抗证伪·13 agents）= 1 confirmed + 8 refuted**。confirmed=Vim toggle 属 Editor**高级**非「行为」（reference 01:42 ground truth·评审误判可复用 FilesAndLinks 的 `settings-subheader-advanced`→实新增 Editor 专属 subheader）→已修+顺带 ZH 标签对齐官方；refuted=data-safety all-clear·R33 precedence faithful-by-design（Obsidian 同样 app 热键压 vim）·`:w` autosave-fallback 契约已授权（codemirror-vim 6.3.0 write handler 需 `cm.save`[undefined]→裸 :w 静默 no-op·数据无损）·static-import bundle nit·无模式指示器=Obsidian native 默认亦无·均正确驳回。**CM6 单份 deduped**（`@codemirror/state@6.6.0`·`view@6.43.1`·无 instanceof 破坏）。**桌面 probe N/A-by-equivalence**（vim() 纯前端 CM6·零 Rust/fs·浏览器权威）。**下一片**：A 系列 + Vim 全交付 → autonomous-safe bounded 池实质见底 → 盘点交用户（剩 boundary-gated 大件 / 删除去向 parked / Stacked tabs 待 data-safety 立项）。

### R252 套件回归（2026-06-27，A2 编辑器右键菜单加 file-action 项[收藏/属性/导出/复制/[桌面]系统操作/重命名/删除·全 wire 既有 vetted 命令·对齐 Obsidian reference 08 编辑器菜单]·逻辑档·零新依赖 · 简化门 clean · ultracode Workflow 4-lens 对抗评审 0 confirmed 缺陷 · 桌面 probe N/A-by-equivalence）

R252 = 用户 R250 拍板续 bounded 的 A2。编辑器右键菜单（`compat/obsidian/editorMenu.ts` `editorContextMenuExtension`·R200 已加原生 Cut/Copy/Paste）补 reference 08 file-action 项。**全是对【既有 vetted 命令】的菜单 wiring**（`handle.commands.execute(id)`·命令内部读 `workspace.getActiveFile()`·无需传 path）·**底线①：删除走 `app:delete-file`[R242 deleteConfirm+R244 孤儿+flush+recoverable trash]·重命名走 `workspace:edit-file-title`[R16]·editorMenu.ts 零 vault 写·绝不另起删除/重命名路径**。**详见 ARCHITECTURE「Round 252 additions」**：`addFileActionItems(menu, commands)` 3 组（① 收藏/增加属性/导出PDF/复制库内路径/复制 Obsidian URL ② [桌面]在系统中显示/在默认应用打开 ③ 重命名/删除）·**非空组才 `addSeparator()` 防悬空**·`cmd.available?.()!==false` 门控[桌面项浏览器隐藏·因 `execute()` 不查 available]·label `getCommandName(cmd)`[收藏自动翻转]·删除 `setWarning(true)` 红·icon-less[与 clipboard 项一致]·`editorContextMenuExtension(workspace, commands)`·context.ts:240 传 `handle.commands`。

新增套件：`r252-e2e.mjs` **20/20**（file-action 项在 clipboard 后·7 命令名 label 在场·桌面项[reveal/open]浏览器隐藏[available 门控]·删除项 warning 类·分隔线 2 个无悬空·**点删除→走 app:delete-file[deleteConfirm dialog]→recoverable .trash**·收藏 label 翻转[命令名 thunk]）+ 截图实证（删除项红·分组分隔）。**套件矩阵不回退**：**r200 21/21·r131 8/8[编辑器右键 clipboard + 插件项·stale 断言更新=行为加 file-actions·新断言 first-3-clipboard + plugin-LAST 更精确]·r242 11/11[删除确认·菜单删除走同 vetted 路径]**·typecheck 0·桌面 probe N/A-by-equivalence（reveal/open=R218 桌面 vetted·浏览器断 available 隐藏·删除/重命名=既有命令·跨端同）。**分档=逻辑档（新菜单项 + 控制流 wiring 删除/重命名·碰 editor 右键关联）→ data-safety skill（删除走 vetted 无旁路坐实）→ 简化门 clean → ultracode Workflow 4-lens 并行对抗评审（data-safety/faithfulness/edgecases/regression·每 finding 对抗验证）= 0 confirmed 缺陷**（data-safety 坐实底线①·label 偏长 nit 证伪[契约冻结 getCommandName 复用·DRY+自动翻转]）。**r18-diff N/A**（不碰 markdown.ts·菜单零 .md 写）。**下一片**：A3 默认打开文件下拉（reference 02:12·启动行为）→ Vim 模式（codemirror-vim 已授权）。

### R251 套件回归（2026-06-26，A1 热键页保真·命令名加来源前缀[插件命令「书签: xxx」·核心命令无前缀·扁平非分组·对齐 Obsidian reference 04 热键-01]·逻辑档·零新依赖 · 简化门 clean · ultracode Workflow 4-lens 对抗评审揪 1 major 全修 · 桌面 probe N/A）

R251 = 用户 R250 拍板续 bounded 首项。**verify-first 纠误**：Obsidian 热键页是【扁平列表】（**非分组 section**·热键-01 截图实证·防 R145/R242 phantom 教训复发），命令名带【来源前缀】（插件命令「书签: 收藏当前搜索」·核心 app/editor/workspace/file-explorer 命令无前缀）。Geode `Command` 无 source 字段 → 按 **id 前缀**派生来源。**详见 ARCHITECTURE「Round 251 additions」**：模块级 `CMD_SOURCE_KEYS`（9 插件前缀→i18n 键·核心前缀不在表→无前缀）+ HotkeysSection `cmdLabel(cmd)`（**幂等守卫**：名字已以来源标签开头[ASCII 或全角冒号]则不加前缀·防双前缀）·用于 行名/冲突名/reset-aria/过滤 + dict.views 加 9 个 `cmdSource.*` ×中英。

新增套件：`r251-e2e.mjs` **14/14**（插件命令带「Bookmarks: /Graph view: 」前缀·**baked-name 命令[backlink:/outline:/outgoing-links:]单前缀不双**·核心 app/editor 无来源前缀·过滤「Bookmarks」命中插件/drops 核心·**扁平无分组 section**[非 phantom]）+ 截图实证。**套件矩阵不回退**：**r145 15/15·r142 18/18·r23 22/22**·typecheck 0·桌面 N/A。**分档=逻辑档（新 CMD_SOURCE_KEYS + cmdLabel 控制流 + 过滤·非数据安全[纯设置 UI·零 .md 写]）→ 简化门 clean → ultracode Workflow 4-lens 并行对抗评审**（每 finding 对抗验证）：**i18n/regression 0 缺陷·faithfulness+edgecases 两 lens 独立揪 1 confirmed major[双前缀]**——backlink:/outline:/outgoing-links: 4 命令注册名已含来源标签（R211/212/219·ZH 全角冒号）·id 前缀又在表 → 初版双前缀·初版 e2e 漏 → **修=幂等守卫**（折叠 commandSourcePrefix 进 cmdLabel·净删 helper）+ e2e +4 断言。**colon-width nit 对抗验证证伪**（ASCII 忠实·reference 04 半角）。**桌面 probe N/A**·**r18-diff N/A**。**新教训**：加【派生前缀/变换】必【幂等】（查 baked-in 版本·注意 ASCII vs 全角冒号变体）+ 测【碰撞用例】非干净用例·多维 lens 评审揪单 e2e 会漏的此类[[geode-derived-prefix-idempotency]]。**下一片**：A2 编辑器右键 file-action（reference 08）→ A3 默认打开文件 → Vim（codemirror-vim 已授权）。

### R249 套件回归（2026-06-26，G2-b 续 slice·设置下拉框原生观感[`appearance:none` + 主题化双 gradient `v` chevron·替原生 OS 箭头·对齐 Obsidian reference 00 §四] + section-子标题 sub-slice 收官·纯 CSS·机械档·零新依赖 · 简化门机械档跳过 · scoped review 0 缺陷 · 桌面 probe N/A）

R249 = ① **section-子标题 sub-slice 收官**：Step 0 实查剩余设置页全单组（模板/日记/唯一笔记/笔记重组/快切=各 3 项·页面预览=2·钥匙串=1·关于/命令面板/快捷键/第三方插件=列表/非分组页）·Obsidian 本就无页内子标题→三个多组页(外观 R246/编辑器 R247/文件与链接 R248)已覆盖全部需分组页·**分组工作完成**。② **下拉 fidelity**：`.settings-select`(settings.css:208) 原无 `appearance:none`→显原生 OS 箭头(macOS 蓝双箭头⇅)·与 Obsidian 自定义下拉中性 `⌄` 不符。**详见 ARCHITECTURE「Round 249 additions」**：`.settings-select` 加 `-webkit-appearance:none`+`appearance:none`·`background` 拆 `background-color:var(--bg-input)` + **双 `linear-gradient` 画 `v` chevron**(45deg+135deg·`--text-muted` 双主题·纯 CSS 渐变规避 SVG 不继承 currentColor 的主题化难题)·`padding:4px 28px 4px 10px` 留位·**7 个设置 select 共用类一并受益**。

新增套件：`r249-e2e.mjs` **7/7**（computed-style：`.settings-select` `appearance==='none'`[webkit 兜底]·`background-image` 含 2 个 linear-gradient·`--text-muted` 运行时解析值出现在 bgImage[主题色非硬编码·非字面匹配]·padding-right≥20·**`selectOption` 改值仍生效**[功能不破]·link-path-format 跨实例共用样式）+ 截图实证（原生箭头→灰 `⌄`）。**套件矩阵不回退**：**r231 13/13[快切 select]·r234 14/14[note composer select]·r242 11/11·r244 29/29[删除 select·selectOption]·r23 22/22[设置模态]**·typecheck 0（全 src·.css 不入 tsc）·cargo N/A（纯 CSS）。**分档=机械档（diff = settings.css `.settings-select` 1 规则·纯样式·无新逻辑/无新契约/未碰数据安全面）→ 简化门机械档跳过 → scoped review（窄域 6 维全证伪·0 缺陷）**：① `appearance:none` 双前缀不破功能（selectOption + 4 套回归全绿）·② chevron `--text-muted` 双主题 + 几何向下 `v` 正确·③ padding 不挤文字·④ `background` 拆分无语法错·⑤ **共用类影响面干净**（`.settings-select` 全仓仅 7 处·全在 SettingsModal·全 `<select>`·零非-select 误用[无幽灵 chevron]·零跨 feature 泄漏·hover/focus 未破）·⑥ e2e 强无假阳。**桌面 probe N/A**（纯 CSS·webkit-appearance 已设跨端同）·**r18-diff N/A**。**下一片 G2-b（R250 backlog）**：设置视觉核心 gap 已覆盖（nav R245 / 分组 R246-248 / 下拉 R249）→ 收敛核对·转 ROADMAP 取用序下一项（字体管理弹窗 / 表格编辑器 / 其余 G 系列）。

### R248 套件回归（2026-06-26，G2-b 续 slice·文件与链接页分组 section 子标题[默认位置/链接/回收站/高级 四组·对齐 Obsidian reference 02]·复用 R246 `.settings-subheader`·JSX 块搬迁 + 子标题 + i18n·机械档·零新依赖 · 简化门机械档跳过 · scoped review 0 缺陷[byte 级 set-diff + R242/R244 数据安全绑定逐字不变] · 桌面 probe N/A）

R248 = R246/R247 分组模式推广到文件与链接页（四组·比外观/编辑器多一组）。reference 02 分组 = 顶部(默认位置)→链接(Links)→回收站(Trash)→高级(Advanced)。Geode 原 11 项扁平且组间交错→重排进四组 + 加 链接/回收站/高级 3 子标题（顶部=首组 headerless；Geode 无 Obsidian「默认打开文件/切换设置文件夹/启用 URI」项→各组只放已有项）。**详见 ARCHITECTURE「Round 248 additions」**：`FilesAndLinksSection` **仅重排既有 11 个 setting-item 块**（testid/绑定逐字保留·**newnote segmented 块 + 其后 `{newNoteLoc==="folder" && …}` 条件 path 块一起搬·保持相邻**）+ 插 3 `<h3 className="settings-subheader">` + i18n `settings.subheaderLinks`/`Trash`/`Advanced` ×中英（**无 CSS 改·复用 R246 类**）。

新增套件：`r248-e2e.mjs` **13/13**（文件与链接页 12 原 testid 全在·链接/回收站/高级 3 子标题[文案 Links/Trash/Advanced·class]·**四组 DOM 顺序 8 断言**[顶部→链接→回收站→高级·detect 移入链接组·delete-confirm 在回收站组·excluded 在高级组]·**newnote=folder 时条件 path 仍在顶部组**[above 链接子标题]）。**套件矩阵不回退**：**r242 11/11[删除确认·R242 绑定不变]·r244 29/29[删除附件·R244 绑定不变·底线① frontmatter 保护]·r247 11/11[编辑器分组未回退]·r23 22/22[设置模态]**·typecheck 0（全 src）·cargo N/A（纯 JSX 重排/i18n·无 Rust/TS 逻辑 delta）。**分档=机械档 → 简化门机械档跳过 → scoped review（窄域 6 维全证伪·0 缺陷）**：**#1 byte 级 set-diff 坐实纯搬迁**（删除行集 == 新增行集[去 3 标题行]·86 非空内容行相等·set-diff 空）·**#2 R242 delete-confirm[`onClick setDeleteConfirm`] + R244 attachment-delete[`onChange setAttachmentDeleteMode`] 数据安全绑定逐字未改**·newnote 条件块紧随 segmented·无遗漏/无重复·i18n 双语·顺序符 reference 02·未碰 R246/R247 区 + CSS。**桌面 probe N/A**（纯前端 IA/i18n）·**r18-diff N/A**。**下一片 G2-b（R249 backlog）**：核对剩余设置页（多数 plugin 页单组·本就无子标题）→ section-子标题 slice 大概率收官·转 G2-b 下一视觉 slice。

### R247 套件回归（2026-06-26，G2-b 续 slice·编辑器页分组 section 子标题[顶部/显示/行为·对齐 Obsidian reference 01]·复用 R246 `.settings-subheader`·JSX 块搬迁 + 子标题 + i18n·机械档·零新依赖 · 简化门机械档跳过 · scoped review 0 缺陷[byte 级 set-diff 坐实纯搬迁] · 桌面 probe N/A）

R247 = R246 分组模式推广到编辑器页。reference 01 编辑器分组 = 顶部(无分组)→显示(Display)→行为(Behavior)→高级(Advanced)。Geode 编辑器页原 17 项扁平且显示/行为交错（view-mode→focus→readable→spellcheck→strict→…）→ 重排进 顶部/显示/行为 三组 + 加 显示/行为 子标题（顶部=首组 headerless；Geode 无 Obsidian 高级项[自动转换 HTML/Vim 模式·Vim 待批依赖]→不造空高级组）。**详见 ARCHITECTURE「Round 247 additions」**：`EditorSection` **仅重排既有 17 个 setting-item 块**（testid/绑定/默认值逐字保留·只移位置·两个 segmented 块[newtab reading/live/source + tabsize 2/4/8]整段搬迁）+ 插 2 个 `<h3 className="settings-subheader">` + i18n `settings.subheaderDisplay`/`Behavior` ×中英（**无 CSS 改·复用 R246 `.settings-subheader` 类**）。**deviation 记档**：backlinks-indoc（在文档显示反链）是 Obsidian Backlinks 核心插件设置·Geode 历轮放 Editor·本片不挪页·就近归显示组。

新增套件：`r247-e2e.mjs` **11/11**（编辑器页 21 个原 testid 全在[含 newtab-reading/live/source + tabsize-2/4/8 segmented 子按钮·纯重排无遗漏/无重复]·显示/行为 子标题[文案 Display/Behavior·class settings-subheader]·**DOM 顺序 6 断言**：顶部(focus+view-mode) → 显示子标题 → 显示组(readable) → backlinks 在显示组 → 行为子标题 → 行为组(spellcheck)·**含 view-mode/spellcheck 跨组移动验证**[view-mode 从中部移上顶部·spellcheck 从近顶移下行为组]）。**套件矩阵不回退**：**r246 10/10[外观分组未回退]·r23 22/22[设置模态]**·typecheck 0（全 src）·cargo N/A（无 Rust/TS 逻辑 delta·纯 JSX 重排/i18n）。**分档=机械档（diff = SettingsModal EditorSection 块搬迁 + 2 子标题 + i18n 2 键·纯 IA 重排/文案·复用既有 CSS·无新逻辑/无新契约/未碰数据安全面）→ 简化门机械档跳过 → scoped review（窄域 6 维全证伪·0 缺陷）**：**#1 搬迁完整性 byte 级 set-diff 坐实**（删除行集 == 新增行集[去 2 标题行]→每块 testid/value/onClick/onChange/aria 一字未改）·无遗漏/无重复（21 testid 各 1 次·两 segmented 整段未拆）·i18n 双语真实·顺序符 reference 01·未碰其它 section（R246 外观/FilesAndLinks 未动·`.settings-subheader` CSS 未改）。**桌面 probe N/A**（纯前端 IA/i18n·跨端同）·**r18-diff N/A**（不碰 markdown.ts）。**下一片 G2-b（R248 backlog）**：文件与链接页分组子标题（reference 02·默认位置/链接/回收站/高级）·续其余设置页逐页推进。

### R246 套件回归（2026-06-26，G2-b 续 slice·设置内容区分组 section 子标题[外观页·主题/界面/字体 三组·对齐 Obsidian 页内分组 reference 03 §三/§五]·JSX 块搬迁 + 子标题 + CSS + i18n·机械档·零新依赖 · 简化门机械档跳过 · scoped review 0 缺陷[byte 级 set-diff 坐实纯搬迁] · 桌面 probe N/A）

R246 = G2-b 视觉打磨续片。reference 03 外观页分组 = 主题→界面→字体→（高级），每组前灰色 section 子标题（外观-02 截图实证「高级」子标题：较大较粗·正常色·上方留白·无下划线）。Geode 外观页原**扁平无分组**且顺序非忠实（theme→字体→界面→obsidian-css）→ 本片重排进 主题/界面/字体 三组 + 加 界面/字体 子标题（主题=首组 headerless 对齐 Obsidian 首组隐式；Geode 无 Obsidian 高级桌面设置[缩放/原生菜单/窗口边框/半透明/硬件加速]→不造空高级组）。**详见 ARCHITECTURE「Round 246 additions」**：新 `.settings-subheader` CSS（`font-size:16px`<页标题 17px·`font-weight:600`·`color:var(--text-normal)`·`margin:22px 0 2px` 上方留白·无下划线）·`AppearanceSection` **仅重排既有 14 个 setting-item 块**（testid/绑定/默认值逐字保留·只移位置）+ 插 2 个 `<h3 className="settings-subheader">` + i18n `settings.subheaderInterface`/`Fonts` ×中英。

新增套件：`r246-e2e.mjs` **10/10**（外观页 13 个原 testid 全在[纯重排无遗漏/无重复]·界面/字体 子标题存在[文案 Interface/Fonts·class settings-subheader]·**DOM 顺序：主题组 → 界面子标题 → 界面组 → 字体子标题 → 字体组**[5 条 getBoundingClientRect top 升序断言]·accent 在字体组之上[fonts 不再先于 toggles]）+ 截图实证（界面子标题灰色分隔·主题组 headerless）。**套件矩阵不回退**：**r23 22/22[设置模态 e2e·仍正常开/导航]**·typecheck 0（全 src）·cargo N/A（无 Rust/TS 逻辑 delta·纯 JSX 重排/CSS/i18n）。**分档=机械档（diff = SettingsModal AppearanceSection 块搬迁 + 2 子标题 + settings.css 1 类 + i18n 2 键·纯 IA 重排/样式/文案·无新逻辑/无新契约/未碰数据安全面）→ 简化门机械档跳过 → scoped review（窄域 6 维全证伪·0 缺陷）**：**#1 搬迁完整性 byte 级 set-diff 坐实**（删除行集 == 新增行集[去 2 标题行·各 trim+sort 后 diff 空]→每块 testid/value/onChange/onClick/aria 一字未改·只移位置）·无遗漏/无重复（13 testid 各 1 次·snippets 条件渲染整段未动）·i18n 键真实双语·CSS 未误伤[R245 nav-active 未回退]·顺序符 reference·未碰其它 section（diff 2 hunk 均在 AppearanceSection）。**桌面 probe N/A**（纯前端 IA/CSS/i18n·跨端同）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写）。**新教训**：① 「分组/IA 子标题」忠实度 = 按参照的【组顺序】重排 + 组内序都对·不是在现状（错误）顺序上插标题制造假忠实（外观页须 theme→界面→字体·Geode 原 theme→字体→界面 须重排）；② 机械重排轮用【字节级 set-diff】自证「只移位置零内容改」（removed set == added set 模新增标记行）·不靠肉眼·任何块绑定/testid 意外改动都会让两集合不等暴露。**下一片 G2-b（R247 backlog）**：其它设置页（编辑器/文件与链接等）页内分组子标题·按 reference 各页结构逐页推进。

### R245 套件回归（2026-06-26，G2-b 设置页视觉打磨 slice·设置左导航选中项忠实度[accent 紫 → 中性灰·对齐 Obsidian `--background-modifier-active-hover`]·纯 CSS·机械档·零新依赖 · 简化门机械档跳过 · scoped review 0 缺陷 · 桌面 probe N/A）

R245 = 用户 R244 拍板「转设置页视觉打磨」后的 G2-b 首片（R245「删除文件去向」parked 待授权）。**Step 0 实测纠误**：`settings.css` **零硬编码颜色**（R178/G2-a 早立全 CSS 变量）→「硬编码→变量」无活；真偏差 = 左导航选中项用 accent 紫高亮（`rgba(139,124,246,.18)` bg + accent 紫文字/图标），而 **Obsidian 设置 nav 选中是中性灰**（reference 03 §三「选中项有灰底高亮」·§四 accent 仅 开关 ON/主按钮/链接·**不含 nav 选中**·截图实证 nav 内无紫）。**详见 ARCHITECTURE「Round 245 additions」**：`.settings-nav-item.is-active` `background: var(--accent-muted)`→`var(--bg-active)`（= Obsidian `--background-modifier-active-hover` 同名变量·浅 `rgba(0,0,0,.09)`/深 `rgba(255,255,255,.1)`）·`color: var(--accent)`→`var(--text-normal)`（图标 currentColor 一并转中性）。**审计 settings.css 全部 accent 用处**确认仅 nav 选中误用——toggle ON/slider thumb/主按钮/focus 边框/funnel filter active/segmented active 均正确保留 accent（§四 accent 语义）→ 只改此一处。

新增套件：`r245-e2e.mjs` **7/7**（computed-style·探针元素解析变量为 rgb 精确比对·**theme-independent**：active nav 文字 === `--text-normal` 且 !== `--accent`·active nav bg === `--bg-active`[中性] 且 !== `--accent-muted`[旧紫]·**含防空断言 `--bg-active`≠`--accent-muted`**·toggle ON 仍 === `--accent`[accent 语义保留]）+ 截图实证（紫→中性灰）。**套件矩阵不回退**：**r23 22/22[设置模态 e2e·仍正常开/导航]**·typecheck 0（.css/.mjs 不入 tsc·全 src 仍 0）·cargo N/A（无 Rust/TS delta·纯 CSS+docs）。**分档=机械档（diff = settings.css 单文件 2 属性 + 注释·纯样式·无新逻辑/无新契约/未碰数据安全面）→ 简化门机械档跳过 → scoped review（窄域 5 维全证伪·0 缺陷）**：变量双主题真实解析（`--bg-active`/`--text-normal` 在 app.css + theme-bridge 映射）·选中态 vs hover 同特异性源序后者胜（选中项 hover 仍 bg-active·可接受）·无其他 accent 误伤（diff 单 hunk）·e2e 含防空断言够强·忠实性确认（faithful 提升非口味）。**桌面 probe N/A**（纯 CSS·跨端同样式·浏览器 + 截图全覆盖）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写）。**新教训**：① 「视觉/样式打磨」轮开工前先 verify-first 实测【当前到底哪里偏离参照】（截图 + computed-style）——预设的问题类型（硬编码/间距）常被前轮解决·真偏差是另一类（语义角色误用）·别制造无效改动；② 语义颜色变量（accent/danger）的修正是【按角色精修】非【全局替换】——同变量在不同 UI 角色有对有错·逐处核对语义角色（强调？选择？危险？）只改错的（nav 选中=选择态该中性·toggle ON=强调态该 accent）。**下一片 G2-b（R246 backlog）**：内容区分组 section 子标题（界面/字体 等·reference §三·Obsidian 页内分组·Geode 扁平）= 结构档[需 SettingsModal JSX 改]·单独排。

### R244 套件回归（2026-06-26，回收站组余 slice 2a「删除附件处理」下拉[Obsidian native Files&Links·删除文件时删除附件·reference 02:30·默认「每次都询问」]·删笔记联动删【独占引用】孤儿附件·走 recoverable vault.trash·绝不永久删·零新依赖 · **逻辑档[碰 core/metadata.ts + vault 多文件删除·底线①最高危]** · 简化门 clean · 多维对抗 0 crit/0 major·data-safety 四性坐实 · 桌面 probe N/A-by-equivalence）

R244 = 回收站组余 2 的 slice 2a，建在 R243 已纳入嵌入索引 + 已记 frontmatter 盲区之上。**忠实性**：reference 02:30 ground-truth 截图确认 native（默认「每次都询问」）·官方 help 页 404 → 次级选项标签语义忠实推定（记 deviation）。**data-safety crux 兑现（R243 评审降级的前置约束）**：孤儿判定**绝不只信 getAttachmentMap**（漏 frontmatter）——否则别的笔记 frontmatter `cover: "[[pic.png]]"` 引用的附件被误判孤儿→误删=破坏别的笔记（底线①）。**详见 ARCHITECTURE「Round 244 additions」**：新 `core/metadata.ts getOrphanedAttachments(deletedNotePaths): string[]`（完整 referrer 集 = 正文 getAttachmentMap ∪ frontmatter `[[att]]`[复用既有 WIKILINK_RE 扫 fields·resolveAttachment·`!byPath.has` 排除笔记]·referrer 集 ⊆ deletedNotePaths 且非空才算孤儿）·新 `core/attachmentDeletion.ts resolveAttachmentDeletion`（keep→[]·**过滤 deletedRoots 内附件防文件夹双删**·ask→confirmAction 列孤儿清单·declined→[]）·enum Store `attachmentDeleteMode`[默认 ask]·3 删除点接线[App app:delete-file + Explorer deleteNode/bulkDelete·序 = R242 deleteConfirm gate→resolve(ask 在 flush 前)→flushAll→trash(note)→per-att trash 孤儿]·`__geodeResolveAttachmentDeletion` probe·下拉 + i18n。

新增套件：`r244-e2e.mjs` **29/29**（getOrphanedAttachments 正文孤儿·**frontmatter 保护[note-b 引号 frontmatter `[[fm.png]]` → getAttachmentMap-alone 会误删·此处保住]**·裸串 `image: x.png` 非引用[忠实]·多笔记·无 .md 误判为附件·resolveAttachmentDeletion keep-空/delete/**文件夹 deletedRoots 双删过滤**·集成 app:delete-file delete[无 dialog]/keep/ask-accept/ask-dismiss[各 1 dialog]·**frontmatter 集成保护**·`.trash` listTrash 可恢复实证）。**套件矩阵不回退**：**r242 11/11[删除确认·默认 ask 不破坏(orphans 空先短路)]·r101 23/23[attachment map]·r126 11/11[frontmatter links]·r42 17/17[trash 写路径不变]·r243 11/11·r70 23/23·r33 37/37[字节锁]**·typecheck 0（全 src）·cargo check 通过（无 Rust delta）。**分档=逻辑档（碰 core/metadata.ts + vault 多文件删除写路径·底线①最高危）→ data-safety skill 满跑·多维对抗 0 crit/0 major·四性坐实**：① **别的笔记正文/frontmatter 引用的附件绝不被误删**（完整 referrer 集 union·`!byPath.has` 排除笔记·e2e 实证 fm.png 受 note-b frontmatter 保护）·② **全程 recoverable trash 无永久删**（枚举全仓 5 个 trash/remove 点·`vault.remove` 仅底层原语/compat shim/卸插件目录·R244 路径无一触达·noteMerge 的 trash 正确未接线[合并不成孤儿]）·③ **flush-before-trash 序不丢编辑**（ask 在 flush 前同 R242 precedent·flushAll 永在任何 trash 前）·④ **默认 ask 不破坏既有删除套件**（orphans 空先 return·r242/r140/r161 删的笔记无附件→不弹·R235 教训未复发）。**评审 4 minor 处理**：① **评审驱动 code 硬化**——deleteNode + app:delete-file 孤儿 trash 循环加 per-att try/catch（镜像 bulkDelete·一个孤儿失败不中止其余·笔记已安全 trash）；②③④ 覆盖边界 deviation 上记（**未加引号 frontmatter `[[x]]` 不识别 = Obsidian[YAML 解析裸叶]/compat R126 既有限制·非 R244 回退** + 孤儿判定读 flush 前索引[未保存新引用看不见·极端窗口] → **纵深防御兜底：默认 ask 二次确认 + recoverable .trash**）。**简化门 clean**（3 删除点接线 similar-not-identical[2nd-use guard 禁合并]·单一数据安全算法·单调用点薄接线·无可简化面）。收尾 bump 版本三处 0.240。**桌面 probe N/A-by-equivalence**（孤儿检测纯 TS 平台无关·trash 写 = R42/R161 FS-vetted·零 Rust delta·`__geodeResolveAttachmentDeletion` 浏览器 probe 全覆盖编排）·**r18-diff N/A**（不碰 markdown.ts·零 .md 字节写[trash 移整文件非内容写]）。**新教训**：① 一个【破坏性操作】依赖某【派生索引】判「安全可动」时·先问索引【看不到什么】·补全覆盖到该操作的安全边界（孤儿判定必跨正文+frontmatter·别拿为导航建的下界索引兜底删除）；② **默认破坏性操作的安全靠纵深防御非单点正确**（完整算法 + 默认 ask 二次确认 + recoverable trash + 边界显式记 deviation·任何单点漏洞不致命）；③ 删除联动 gate 顺序铁律不破（ask 在 flush 前·flush 在 trash 前·trash 走 vetted recoverable·R242 序逐字保留）。**🛑🛑 R245 撞硬边界·收尾停 loop 待用户拍板**：回收站组余 slice 2b「删除文件去向」三档（系统回收站/.trash/永久）= 永久删除不可恢复底线①最高危[实现前必经用户同意] + 系统回收站可能需新 Rust/Tauri 能力[或撞硬边界#5]·.trash 档已是现状→整项 boundary-gated 无 autonomous-safe slice·**用户拍板：(A) 授权实现 R245 / (B) 跳过转设置页视觉打磨 G2-b[autonomous-safe] / (C) 其他**。

### R243 套件回归（2026-06-26，回收站组余 2 的 data-safety 前置 · 索引 markdown 图片嵌入 `![](x)`[用户拍板 Option 1]·修复 rename 不改写嵌入既有 bug + 解锁正文嵌入孤儿判定·零新依赖 · 逻辑档[碰 core/metadata.ts + 影响 R16 rename·改 .md 字节面·底线①] · 简化门 clean · 多维对抗揪 2 major+1 minor 全修 · 桌面 probe N/A）

R243 = 回收站组余 2「删除附件处理」的 data-safety 前置。**Step 0 发现 data-safety 阻断**：孤儿判定需准确判断附件是否还被引用·但 `parseNote`（metadata.ts:250）显式跳过 markdown 图片嵌入 `![](x)`（`if(m[1]=="!")continue`·㉞ 延后项·**wikilink 嵌入 `![[x]]` 早已索引**）→ `meta.links` 不含它们 → `getAttachmentMap` 漏判 → 误删仍被 `![](x)` 引用的附件=破坏别的笔记。**用户拍板 Option 1：先补 markdown 嵌入索引**（顺带修 rename 不改写嵌入既有 bug）。**详见 ARCHITECTURE「Round 243 additions」**：parseNote 删 `continue`·嵌入 push 进 meta.links[kind markdown]·**关键 LinkRef `from=m.index+1`（排除前导 `!`）**→ `content.slice(from,to)="[text](href)"`（不含 `!`）→ R16 改写校验 `^\[…\)$`/重建 `[text](newhref)` 逐字不变即处理·`!` 在 span 外永不触碰（`![](old)`→`![](new)`·非降级为链接）·R16 引擎零改。

新增套件：`r243-e2e.mjs` **11/11**（getAttachmentMap 现含 markdown 嵌入引用[note.md+other.md 引同附件·孤儿判定见 embed referrer]·getOutgoingLinks 含嵌入[isolated other.md 仅嵌入]·**rename att.png→嵌入改写为 `![](renamed.png)`[byte 精确·`!` 保留·非降级]**·markdown 链接也改·无 stale·renamed 路径 attachment map·**embed-into-metachar：rename 进 `m p(1).png`→`![cap](m%20p%281%29.png)`[byte+`!`+percent-encode]**）。**套件矩阵不回退**：**r33 37/37[字节锁]·r70 23/23[markdown 链接 rename·翻新嵌入断言]·r119 15/15[compat embeds·+5 md 嵌入分桶断言]·r101 23/23[attachment map]·r24 12/12[unlinked]·r126 11/11[frontmatter links]·r72 26/26·r46 18/18·r189 17/17·r28 23/23·r68 40/40·r156 14/14**·typecheck 0（全 src）·cargo check 通过（无 Rust delta）。**分档=逻辑档（碰 core/metadata.ts + 影响 R16 rename·改 .md 字节面·底线①）→ data-safety skill 满跑**：① rename 嵌入字节逐字正确·`!` 永不丢·不降级（span 排除 `!`→R16 step-4 markdown 分支逐行 trace + r243/r70/r33 实证）·② 所有 meta.links 消费者不退·③ 孤儿映射现含正文嵌入·C 阅读视图 r18-diff N/A（不碰 markdown.ts·嵌入渲染不变）·D 桌面 probe N/A（纯 TS·rename 写 = R16-vetted·字节平台无关）。**多维对抗评审揪 2 major+1 minor 全修**：① **compat buildCache**（`compat/obsidian/metadata.ts:538`）嵌入分桶门原死写 `kind=="wikilink"` → markdown 嵌入误落 `cache.links`（丢 `!`·position 偏 1）·**改 `content[l.from-1]=="!"` 不限 kind**（非嵌入 markdown 链接的 `[` 前不可能是 `!`）→ `getFileCache().embeds` 正确含 md 嵌入·r119 加 md 嵌入分桶断言锁回归·**〔widen-recheck 教训复发：初版只 grep core/ 消费者漏 compat/ 这层·消费者复查必跨全部分层〕**；② **getAttachmentMap 仍漏 frontmatter/property 附件引用**（parseNote blank 整段 frontmatter·compat 另有独立 buildFrontmatterLinks 证该类引用真实存在）→ 是引用**下界非完整集**·ARCHITECTURE 措辞降级（覆盖正文引用·不含 frontmatter）+ **R244 前置约束**（销毁前必补 frontmatter 覆盖或当下界+二次确认·不可直接信其权威去删[误删 frontmatter 引用附件=违底线①]）；③ r243 #2 弱断言隔离 other.md。**简化门 clean**（metadata.ts 单文件 ~8 行：删 1 continue+加 from 三元·无新抽象/重复/脚手架）。收尾 bump 版本三处 0.239。**新教训**：① 拓宽多消费集合时消费者复查必跨【全部分层】——compat/ 常把核心结构再投影成另一套语义（LinkRef→EmbedCache 分桶）·其「markdown kind 必非嵌入」假设从 core/ 不可见·套件无新成员夹具会照样全绿掩盖缺口；② 派生索引（getAttachmentMap）对外宣称的覆盖度必须诚实标注结构性盲区（frontmatter 被 blank → 附件引用未索引 → 下界非完整集）·否则误导下游数据安全决策（R244 删除）·宁低估别高估；③ span 排除标记字符（embed `!`）使 R16 改写引擎零改即正确处理新语法——把语义标记留在 [from,to] 之外。**🛑 R244 = 回收站组余 slice 2a 删除附件处理**（现可在【标注了 frontmatter 盲区的】getAttachmentMap 上安全做孤儿判定·但须补 frontmatter 覆盖或二次确认）。

### R242 套件回归（2026-06-26，表面复刻序 回收站组 slice 1 · 「删除文件时确认」toggle[Obsidian native Files&Links·Confirm file deletion]·data-safety careful 轮·零新依赖 · 逻辑档[gate 删除路径·data-safety] · 简化门 clean · 多维对抗 8 维 PASS·0 缺陷 · 桌面 probe N/A）

R242 = 表面复刻序近枯竭拐点。**Step 0 全表面 scout（R228 纪律）**：文件/文件夹右键基本补齐（reference 08·剩 多窗口 oos / 打开历史 community）·命令多撞边界·**WebSearch 纠误「热键冲突筛选」是 Obsidian community feature-request 非 native**（reference 04「冲突」实指冲突 badge 非筛选·Geode 已有 assignedOnly 筛选 + 冲突 badge R145）→ **不加冲突筛选[防造非 native]** → 剩唯一 native 功能缺口 = Files&Links 回收站组三设置（reference 02:29-31：删除文件时确认[开关·默认关] / 删除附件处理[下拉] / 删除文件去向[下拉·系统回收站/.trash/永久]）= 用户预留 data-safety 重轮 → **取最安全 slice = 删除确认 toggle**（仅 gate confirm UX·不碰 vetted `.trash` 写）。**详见 ARCHITECTURE「Round 242 additions」**：`deleteConfirm` Store（默认 true·`geode.deleteConfirm`·镜像 mergeConfirm）+ gate 3 删除 confirm 点（`if(deleteConfirm.get() && !(await confirmAction(...))) return;`·App app:delete-file + Explorer 单删/批删）+ FilesAndLinksSection toggle + i18n。**🛑 default deviation**：Obsidian 默认 OFF·Geode **默认 ON**（=现状·零回归·守意外删除·用户 flag「默认 OFF 放松防护」→ 取安全默认·toggle 关即 Obsidian 忠实无确认[删除仍 recoverable .trash·关确认也安全]）。

新增套件：`r242-e2e.mjs` **11/11**（Files&Links「删除文件时确认」toggle 默认 ON·**ON+accept→文件 trash·ON+dismiss→文件存活[零丢失]·OFF→无 dialog 直接 trash[Obsidian 忠实·仍 .trash]**·localStorage `geode.deleteConfirm` 持久化·reload 恢复 OFF）。**套件矩阵不回退**：**r140 18/18·r161 15/15[delete-confirm·默认 ON 仍弹]·r42 17/17[trash·写路径不变]·r93 22/22[explorer]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（gate 删除路径·数据安全红线·但 confirm gate 不改 trash 写）→ data-safety 坐实零丢失**：① 3 gate 全在 `vault.trash` **之前**（trash 写 R42 vetted 逐字不变）·② **cancel/dismiss 绝不 trash**（`deleteConfirm.get() && !(await confirmAction)` dismiss→false→`!false`→return·不 flush 不 trash·三处同款·e2e 实证）·③ **OFF 不旁路 flush-before-trash**（OFF→`&&` 短路 false→不 return→继续 flush+trash·**关确认时最易丢数据点·守住 lossless 序**·评审坐实）·④ OFF 仍 recoverable `.trash`（桌面 + MemoryVault 双端同 dest）·⑤ 默认 ON `true && !(await confirmAction)` ≡ 旧式·字节同 → **简化门 clean**（3 gate 非 token 级相同[各异 message·跨 app/+features/]·合并需发明 helper STOP·Store/toggle 镜像 mergeConfirm 跨轮 idiom） → **多维对抗 8 维 PASS·0 确认缺陷**（3 gate 完整：grep 全仓 vault.trash 5 点·3 UI 删除全 gate·compat shim/noteMerge[mergeConfirm 门]/插件卸载 confirm **正确未 gate**·无键盘删除旁路[onTreeKeyDown 无 Delete 分支]·TOCTOU 无丢数据·deviation 三处记档·i18n parity）。收尾 bump 版本三处 0.238。**桌面 probe N/A**（delete 写 = R42/R161 FS-vetted·confirmAction = R140 vetted·R242 纯 gate 接线·`.trash` 双端同·浏览器 dialog accept/dismiss ≡ 桌面 ask）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写[trash 移动非内容写]）。**新教训**：① data-safety 设置默认——当 faithful 默认会放松防护(删除确认默认 OFF)·取安全默认(ON)+toggle 提供 faithful·清晰记 deviation(用户已 flag)；② **gate 删除确认时 confirm 门须在 flush+trash 之【前】·且 OFF 分支绝不旁路 flush-before-trash**(`&&` 短路只跳 confirm 不跳 flush)·否则关确认=丢未存编辑(评审最高危点·守住)；③ 删除确认仅 gate UX·绝不碰 vetted trash 写路径(R42 trash-after-flush lossless 逐字不变)。**🛑🛑 R243 真拐点·表面复刻 native 功能缺口已近清**(命令全补/右键补齐/热键页 native 全有)·剩=回收站余 2[data-safety 高·尤永久删除底线①最高危·系统回收站需 Rust]+视觉打磨——**强烈建议 R243 前请用户拍板方向**(继续 data-safety 回收站 / 转视觉 / 选项1 真插件[批依赖硬边界#5] / Canvas·Bases 立项)。

### R241 套件回归（2026-06-26，表面复刻序 文件操作命令 · `file-explorer:copy-absolute-path`「复制当前文件绝对路径」[Obsidian native·Copy file path·桌面 gated]·零新依赖 · 逻辑档[碰 core/vault.ts 红线·但纯助手+只读代理+clipboard·零 vault 写] · 简化门删 1 转发包装 · 多维对抗 8 维 PASS·0 缺陷·3 informational 不修 · 桌面 probe N/A）

R241 = 表面复刻序续。**Step 0 verify-first**：文件/文件夹右键菜单基本补齐（reference 08 对照·剩 多窗口=oos / 打开历史=community 非 native）·热键页早有搜索+筛选+改键（R145）→ 取 G3 line 180 真 missing `file-explorer:copy-absolute-path`（命令面板·**非右键**·右键已有 relative「复制库内路径」）。**桌面向**：绝对路径 = vault 根绝对路径 + 文件相对路径·浏览器 MemoryVault `getVaultPath()`=null → **桌面 gated（镜像 R218 reveal/open）**。**详见 ARCHITECTURE「Round 241 additions」**：纯函数 `toAbsolutePath(vaultPath, relativePath)`（OS-aware：`sep = includes("\\")?"\\":"/"`·strip 尾 sep·windows 时 rel `/`→`\\`·`base+sep+rel`·**纯字符串零 IO**）；Vault 类 `getVaultPath()` 代理（只读转发 adapter·feature 不直碰 adapter）；命令 `available: getActiveFile!==null && getVaultPath()!==null`·callback `clipboard.writeText(toAbsolutePath(vp,path))`+notice；probe `__geodeAbsolutePath = toAbsolutePath`（测纯 join）；i18n copyAbsolutePath/copiedAbsolutePath 中英。

新增套件：`r241-e2e.mjs` **12/12**（命令注册 + 名「Copy absolute path」+ 无默认键·**桌面 gated：浏览器 available()=false[有 active file 仍 false·证 getVaultPath 门]·getVaultPath()=null[MemoryVault]**·**toAbsolutePath probe：unix `/Users/x/v`+`a/b.md`→`/Users/x/v/a/b.md`·尾 sep strip·windows `C:\x\v`+`a/b.md`→`C:\x\v\a\b.md`[sep+rel 转换]·root-level**）。**套件矩阵不回退**：**r179 10/10[右键 copy-path/url]·r183 11/11[copy 命令]·r218 15/15[reveal/open 桌面 gating]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（碰 `core/vault.ts` 数据安全红线一票否决·**但本轮只加纯字符串 join 助手 + 只读 getVaultPath 代理 + clipboard·零 vault 写/零文件 IO**）→ data-safety 维快速彻底证伪（toAbsolutePath 纯 String 拼接无 await/无 adapter/不碰 documents·getVaultPath 代理只读转发内存值·callback 仅 read+clipboard[R183 vetted]+notice·非底线①） → 简化门**删 1 处转发包装**（probe `(a,b)=>toAbsolutePath(a,b)` → `= toAbsolutePath`·纯函数无 this/闭包等价·镜像既有 main.tsx:282/290 裸引用 probe） → **多维对抗 8 维 PASS·0 确认缺陷**（OS-aware join 全输入正确[混合分隔符/空值不可达 informational]·桌面 gating 比 R218 isTauri 更精确[同挡「桌面但未开 vault」]·命令 id 真实[G3 line 180 权威源·非 phantom]·i18n parity·clipboard 复用 vetted·分层[getVaultPath 代理避 adapter 直访]）。**3 informational 不修**（① Explorer.tsx:530/539 仍直访 `vault.adapter.getVaultPath()`=pre-existing 层级 smell·非 R241 引入·新代理使其可迁·留后续；② 命令名「复制绝对路径」短于截图「复制当前文件绝对路径」·合 R183 house style；③ 仅命令版无右键·契约 scope）。收尾 bump 版本三处 0.237·G3 line 180 missing→done + §6 小结 done 7→8/missing 2→1。**桌面 probe N/A**（命令桌面 gated 浏览器不可执行·clipboard.writeText = R183 vetted·join 逻辑经 `__geodeAbsolutePath` probe 浏览器测·gating 经浏览器 available()=false 测·桌面真复制 = 同 vetted clipboard 路径）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写）。**新教训**：① 桌面专属命令（绝对路径/reveal/open）用 `getVaultPath()!==null` gating 比 `isTauri()` 更精确（同挡桌面未开 vault）；② OS-aware path join 从 vaultPath 的分隔符推断目标 OS（`includes("\\")`）·避免硬编码 sep·纯函数经 probe 双 OS 测；③ 碰 core/vault.ts 触发 data-safety 红线逻辑档·即便是纯助手也走满评审·data-safety 维快速证伪零 IO（红线宁可过严）。**🛑 R242 = 表面复刻序近枯竭拐点·宜全表面 scout 再定（设置页视觉 / 热键冲突筛选 / 回收站 data-safety 专轮）·R228 纪律宣布枯竭前必全表面穷举。**

### R240 套件回归（2026-06-26，表面复刻序 高频命令 · `graph:open-local`「打开局部关系图」[Obsidian native Graph·Open local graph]·复用 R103/R110 local 图基建·零新依赖 · 逻辑档[新 store+命令+消费 effect·非数据安全] · 简化门 clean · 多维对抗 8 维 PASS·0 缺陷·1 minor 测试覆盖已补 · 桌面 probe N/A）

R240 = 表面复刻序续。**Step 0 verify-first + 半成品发现**：grep 坐实 G3 line 238 `graph:open-local` = missing；但 **GraphView 早支持 local 模式**（`graphPrefs.ts:49` `mode:"global"|"local"` + R103 BFS depth/方向 follow + R110 邻居间连线·`GraphView.tsx:225` `anchor = mode==="local" ? lastActiveFile : null`）→ 缺的只是**直接以 local 打开图谱的命令**（现状须开全局图再 UI 切 local）。**详见 ARCHITECTURE「Round 240 additions」**：`workspace.openLocalGraphRequest` one-shot Store（镜像 searchRequest idiom）；命令 `graph:open-local`（无默认键）callback `set(true)+openGraph()`（先置请求再开图·图未开→mount 即消费·已开→请求变触发消费）；GraphView 消费 effect（clear-FIRST 守卫）`setPrefs((p) => p.mode==="local"?p:{...p,mode:"local"})`（已 local 返同引用免 rebuild·**与既有 mode toggle setMode 逐字一致**）·anchor 自动 = lastActiveFile（R103 既有）·savePrefs 持久化；i18n cmd.openLocalGraph 中英。

新增套件：`r240-e2e.mjs` **13/13**（命令注册 + 名「Open local graph」+ 无默认键·**path A：图未开 → 执行 → 图开 + mode local + anchor=该笔记**·**path B：全局图已开 → 执行 → 切 local**·idempotent[再执行仍 local 不抛]·持久化[localStorage geode.graphPrefs mode=local]）。**套件矩阵不回退**：**r78 16/16[图谱基础]·r103 23/23[local BFS depth/方向]·r110 10/10[邻居间连线]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（新 store openLocalGraphRequest + 新命令 + 消费 effect + setPrefs·**但非数据安全**[图谱只读 viz·prefs localStorage·R78 vetted·零 .md 写·不碰 editor/vault/documents/markdown]）→ 简化门 clean（全薄接线/单调用点/镜像·命中跳过条件·clear-first 守卫 + same-ref 优化均受保护不变量） → 多维对抗 8 维 PASS·0 确认缺陷**（one-shot 消费两路径[未开 mount 即消费 / 已开 request 变触发]都成立[评审自测]·StrictMode clear-first + 鲜读 .get() + setPrefs 同引用幂等·anchor 无笔记时 localEmpty 空图不抛[评审自测]·same-ref 优化与既有 mode toggle 一致·分层/i18n parity·无默认键合 G3）·**1 minor 测试覆盖已补**（评审揪：套件只测 path B「已开切 local」→ 补 path A「未开打开 local」+ anchor + 无笔记自测）。收尾 bump 版本三处 0.236·G3 line 238 missing→done + §16 小结 done 1→2/missing 2→1。**桌面 probe N/A**（图谱 + localStorage prefs·跨端同码·浏览器全覆盖）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写）。**新教训**：① 复用既有「半成品」基建——GraphView 早有 local 模式（R103/R110）·缺的只是「直接以该模式打开」的命令→one-shot request store[命令 set+open] + 视图消费切 prefs·**不重写视图逻辑**；② setState 切模式用 `(p) => cond ? p : {...p}`（已是目标态返同引用）免无谓 rebuild·镜像既有同模式 setter；③ 测试要覆盖契约声明的【全部】路径（未开打开 vs 已开切换）·评审揪「只测一条」补全。**R241 续表面复刻序高频命令/缺口（copy-absolute-path / 文件夹右键补齐 / 热键页结构）。**

### R239 套件回归（2026-06-26，表面复刻序 · 完成「搜索书签」= `bookmarks:bookmark-search`「收藏当前搜索」命令 + 修点击恢复[Obsidian native Bookmarks·Bookmark current search]·零新依赖 · 逻辑档[新 store+命令+effect·非数据安全] · 简化门 clean · 多维对抗 8 维 PASS·0 缺陷·1 minor 已硬化 · 桌面 probe N/A）

R239 = 表面复刻序续。**Step 0 verify-first + 半成品发现**：grep 坐实 HANDOFF 候选随机笔记/复制路径早 done；G3 line 265 `bookmarks:bookmark-search` = missing → 取它。**关键**：bookmark store **早支持 `type:"search"`**（`core/bookmarks.ts:54`·R158）+ BookmarksPanel **早渲染** search 书签（title/icon）·**但两缺口**：缺创建命令 + **点击恢复是 stale stub**（`BookmarksPanel.tsx:139`「no programmatic query injection」——其实 `workspace.requestSearch` R222 已建）→ **R239 双补**（否则建的书签点击死掉=假完成·违 GAP_AUDIT 第十一节）。**详见 ARCHITECTURE「Round 239 additions」**：`workspace.currentSearchQuery` Store（**reflection**：SearchPanel sync effect 镜像 live query → 命令读它·**非 one-shot trigger**——因 add+notice 都在 App.tsx[`bookmarks` 单例 + `showCommandNotice`]·命令直接读 query 做事·避免把 toast 接进 SearchPanel·且 add 在用户触发 callback 非 effect→**无 StrictMode 写双发**）；命令 `bookmarks:bookmark-search` 读 `currentSearchQuery.get().trim()`·空→noSearch notice early-return·非空→`bookmarks.add({type:"search",query,ctime})`+searchBookmarked notice；BookmarksPanel search 点击 stub→`requestSearch(item.query)`；i18n +3 键×中英。

新增套件：`r239-e2e.mjs` **8/8**（命令注册 + 名「Bookmark current search」·**键入 query → 执行命令 → search 书签落库[经 `__geodeBookmarks.list()` walk 验 query·非 DOM 文本]**·空查询 no-op[count 不变]·**点击 search 书签 → 搜索面板开 + query 注入恢复[search-input value]**·无 page error）。**套件矩阵不回退**：**r158 13/13[bookmark store]·r193 17/17[bookmark 命令]·r222 24/24[搜索面板/tag 注入]·r27 22/22[bookmarks 持久 probe]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（新 store currentSearchQuery + 新命令 + reflection sync effect + 点击逻辑改·**但非数据安全**[bookmarks.json 串行 RMW·R158 vetted·零 .md 写·不碰 editor/vault/documents 管线]）→ 简化门 clean（全薄接线/单调用点·命中跳过条件·STOP 守卫覆盖） → 多维对抗 8 维 PASS·0 确认缺陷**（reflection 正确[sync 即时 query·命令 .get() 鲜值]·空 .trim early-return·search 书签形状合法·**add 不在 effect/updater→无 StrictMode 写双发**·sync effect set 同值幂等·点击 requestSearch 注入无循环[searchRequest 注入 vs currentSearchQuery 镜像两独立 store]·分层/i18n parity·重复 search 书签合 Obsidian[不去重]）·**1 minor 已硬化**（评审揪：切库不重开搜索面板跑命令→把 A 的 last query 收进 B 的 bookmarks.json[纯字符串无害] → `vault:changed("load")` 加 `currentSearchQuery.set("")` 与 recentlyClosed 同处清）。收尾 bump 版本三处 0.235·G3 line 265 missing→done + §11 小结 done 6→7/missing 0 整组补完。**桌面 probe N/A**（bookmarks.json 持久 = R158/R27 FS-proven·reflection store + 命令 + 点击 = 纯 JS/store·跨端同码·浏览器全覆盖）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写）。**新教训**：① 「半成品」补全——data model/render 早建但缺创建命令 + 行为 stub（点击死掉）·Step 0 grep 实证后**两缺口一并补**否则假完成（建的书签点击死=违「真 handler」）；② 「命令需面板当前态」用 reflection（面板镜像态到 store·命令读）优于 one-shot trigger 当 add+notice 都在命令侧——避免把 toast 接进面板 + 规避 StrictMode 写双发（add 在用户触发 callback 非 effect）；③ session 镜像 store 须在 vault 切换时清（防跨库脏值）。**R240 续表面复刻序高频命令/缺口（graph:open-local / copy-absolute-path / 文件夹右键补齐）。**

### R238 套件回归（2026-06-26，表面复刻序 高频命令 · `editor:focus`「将焦点切换至编辑区」[Obsidian native「Focus on the editor」]·零新依赖 · 逻辑档[新命令·非数据安全] · 简化门 clean · 聚焦评审 6 项全证伪·0 实现缺陷·1 minor 测试质量已修 · 桌面 probe N/A）

R238 = 表面复刻序续·取较轻**非删除**项（回收站+删除确认留 data-safety 专轮·避免连碰底线①）。**Step 0 verify-first 纠误（R222/R223 纪律再验）**：HANDOFF 命名的 R238 候选「随机笔记」`random-note:open`（`src/plugins/random-note.ts` 早建）+「复制路径」`file-explorer:copy-path`（R179/R183 早建）**都已 done** → 改取 G3 矩阵 line 139 真·missing 项 `editor:focus`。**详见 ARCHITECTURE「Round 238 additions」**：`commands.register({id:"editor:focus", name:()=>t("cmd.focusEditor"), callback: () => { const active = app.documents.getActiveView(); if (active) active.view.focus(); }})`（**逐字镜像既有 5 个 getActiveView fold 命令**·`EditorView.focus()` = CM6 把键盘焦点移到 active 编辑器 contentDOM·无 active null-guard no-op）+ i18n cmd.focusEditor 中英（EN「Focus on the editor」/ ZH「将焦点切换至编辑区」）。

新增套件：`r238-e2e.mjs` **9/9**（`editor:focus` 注册 + 名「Focus on the editor」+ `getEffectiveHotkey` null[无默认键]·**blur 编辑器后执行→焦点回 `.cm-content`**·**graph tab active 时 getActiveView()===null → execute no-op 不抛 + 焦点不跳入编辑器**·无 page error）。**套件矩阵不回退**：**r188 14/14[fold 命令·镜像源]·r113 10/10[compat 命令]·r217 8/8[命令注册]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（新命令注册 + callback null-guard `if`·虽 thin·默认逻辑档·**但非数据安全**[view.focus 是纯 DOM 焦点·零 .md 写·零 vault IO·不碰 editor 编辑/decoration/save 管线·不改文档字节]）→ 简化门 clean（跳过条件命中：单命令镜像既有 fold·diff <50 行/2 production 文件·无 ≥8 行重复·无死代码脚手架·不制造工作） → 聚焦评审（单命令·非数据安全·非全维对抗）6 项全证伪·0 实现缺陷**（命令 id 与 G3 line 139 逐字一致·非空 handler / null-guard 逐字节同 5 个 fold 命令 + 实测 no-throw / i18n en+zh 双在 typecheck 强制 parity / id 全仓唯一 name thunk / 无数据安全面 / 无默认键 getEffectiveHotkey null）·**1 minor 测试质量已修**（r238 第三节注释称 open graph 实际 openFile→null 分支未真驱动 → 改 `workspace.openGraph()` 令 getActiveView null·真覆盖 + 断言 null + no-op）。收尾 bump 版本三处 0.234·G3 矩阵 line 139 missing→done + §13 小结 done 22→23/missing 8→7。**桌面 probe N/A**（纯 DOM 焦点·跨端同码·浏览器全覆盖）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写）。**新教训**：① 表面复刻「即取序候选」常已 done（随机笔记/复制路径）→ Step 0 必 grep 实证 + 查 G3 矩阵取真 missing（[[geode-verify-feature-state-and-native]] 再验）；② 补高频命令 = 镜像既有同族命令（getActiveView + null-guard + CM 方法）·复用 i18n 模式·= 最薄逻辑档；③ 测试要真驱动 null/边界分支（openGraph 令 getActiveView null）·别让注释声称的覆盖与代码实际不符（评审揪出）。**R239 续表面复刻序高频命令/缺口（graph:open-local / copy-absolute-path / 文件夹右键补齐）。**

### R237 套件回归（2026-06-25，二次拍板「表面复刻序」第 1 项 · 换库常驻入口[状态栏 vault 名可点→app:switch-vault 切换器]·零新依赖 · 机械档[纯 UI 入口 affordance·未碰数据安全面] · 跳简化门 · scoped review 8 项全过·0 缺陷 · 桌面 probe N/A）

R237 = 旧 bounded backlog 笔记重组（R234-236）收官后·正式转二次拍板「表面复刻序」第 1 项。**Step 0**：explorer 坐实 `App.tsx:1362` 状态栏 vault 名是静态 `<span class="status-vault">`（**当前不可点**）；`app:switch-vault` 命令（callback `openModal("vaultswitcher")`）+ VaultSwitcherModal + 最近仓库 store **早 R203 已建** → 本轮只补 UI 入口·不碰切库逻辑。**详见 ARCHITECTURE「Round 237 additions」**：`<span>` → `<button type="button" data-testid="status-vault" title={t("cmd.switchVault")} onClick={() => app.commands.execute("app:switch-vault")}>{vaultName}</button>`（thunk 到既有 vetted 命令·复用 cmd.switchVault i18n 无新键）+ `.status-vault` CSS button reset（视觉同其它 status-item + hover affordance·`.status-item` white-space:nowrap 保留）。

新增套件：`r237-e2e.mjs` **9/9**（status-vault 是 `<button>`·显 vault 名[非空]·title 含 vault·初始无 modal·**click → modal==="vaultswitcher" + `[data-testid=vaultswitcher-modal]` DOM 现身**·关闭后再点幂等再开）。**套件矩阵不回退**：**r203 21/21[换库切换器·切库逻辑]·r100 15/15[状态栏 showStatusBar·OFF 时 button 随 footer 一起隐藏不退]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=机械档（diff ~26 行/2 文件[App.tsx status-bar JSX span→button + app.css button reset 样式]·纯 nav/IA 入口 affordance + 样式·onClick thunk 到既有 `app:switch-vault` 命令·**无新承载逻辑控制流**[无 if/for/while/switch/三元]·**未碰数据安全面**[click 路径 `execute→callback→openModal`·仅置 `workspace.state.modal`·不碰 vault 写/switchToVault/.md IO·真正切库是 R203 vetted modal `open(path)`·本轮未触]·无新依赖·未动 Rust）→ 跳简化门 + scoped review** 8 项全确认（命令 id `app:switch-vault` 与 App.tsx:1026 注册逐字符一致·非空 handler 非假完成 / testid `status-vault` 全仓唯一 / `cmd.switchVault` i18n en+zh 双在 / `t`[App.tsx:119]·`app` 同组件作用域[无 shadowing] / button reset 完整中和 bg/border/padding+font:inherit 继承 12px+color:inherit 继承 --text-muted·不破坏 .status-bar flex / vault 名仍显[Demo Vault] + R100 OFF 整条隐藏 / a11y type=button+可访问名[vault 名]+title+键盘可触发 / 无数据安全暴露面）·**0 缺陷**（评审记 1 可接受：button reset 未中和 outline → :focus-visible 焦点环保留=a11y 正面·视觉可接受不修）。收尾 bump 版本三处 0.233。**桌面 probe N/A**（纯 UI affordance·button click→openModal·跨端同码·切库逻辑 R203 已 FS-proven·浏览器全覆盖）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写·只 openModal）。**新教训**：① 给既有静态显示元素补「常驻入口」affordance = `<span>`→`<button>` + onClick thunk 到**既有 vetted 命令**（单一真源·不复制命令逻辑）+ CSS button reset（视觉不变·hover affordance）·复用既有 i18n·= 最小机械档；② 验收「真 handler 非空行」= 核命令 id 与注册逐字符一致 + callback 真 openModal（非假完成）。**正式进入二次拍板表面复刻主线·R238 续取序中较轻非删除项（避免连碰 data-safety）。**

### R236 套件回归（2026-06-25，笔记重组设置 Tab 收官 slice 3 · 「模板文件位置」[Obsidian native「Note composer」Template file location·提取选区→新笔记套模板]·零新依赖 · 逻辑档[改 extract 写新笔记字节·底线①] · 简化门 clean · 多维对抗 8 维 PASS·0 阻断·1 minor 已修 · 桌面 probe N/A）

R236 = Note composer Tab 第 3 设置·**收官 3/3**（R234 下拉 + R235 合并提示 + R236 模板位置）。**Step 0**：WebFetch `obsidian.md/help/Plugins/Note+composer` 实证模板变量 `{{content}}/{{fromTitle}}/{{newTitle}}/{{date:FORMAT}}`·{{content}} 缺省追加底部·无模板=仅内容；explorer 坐实 `expandTemplate`(core/templates.ts) 仅支持 `{{title}}/{{date}}/{{time}}`（**单趟 String.replace·replacement 不重扫**=对抗输入安全）。**详见 ARCHITECTURE「Round 236 additions」**：新 `expandExtractTemplate`（**逐字镜像 expandTemplate 单趟 regex-callback**·regex `(content|fromTitle|newTitle|date)`·content/fromTitle/newTitle 字面替换[带 :fmt 返回原文]·date→moment.format·**不扩 expandTemplate**[templates feature 零触碰]）；`extractTemplatePath` string Store（默认 ""·`geode.extractTemplatePath`·镜像 accentColor readString）；extractRange `vault.create` **前** inline 读模板→展开→{{content}} 缺省追加（case-insensitive 检测·评审修）→末尾归一·**默认空/读失败→`extractedContent` verbatim**；NoteComposerSection +text input；i18n +2 键×中英。

新增套件：`r236-e2e.mjs` **16/16**（template 输入默认空·**默认 verbatim[字节锁 `=== "verbnote\nplain body\n"`]**·四变量 {{fromTitle}}/{{newTitle}}/{{date}}/{{content}} 各展开正确·{{content}} 缺省追加底部·**uppercase {{CONTENT}} 展开一次不重复[case-insensitive 修]**·**对抗：提取内容含字面 {{fromTitle}} 单趟不重扫保字面**·**读取失败→verbatim fallback[字节锁]**·持久化 reload）。**套件矩阵不回退**：**r44 25/25[extract 端到端字节]·r216 17/17[move-heading byte]·r23 22/22[templates 引擎·修了 pre-existing 测试 nav 崩溃→`settings-nav-templates` click]·r234 14/14·r235 14/14**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（改 extract 写新笔记字节·数据安全红线一票否决 + 新 templates 函数 + extractRange 控制流）→ data-safety 坐实零丢失**：① 模板 read 失败 `.catch(()=>null)` → fallback `extractedContent(content)`·**新笔记绝不空/坏·不丢提取内容**（e2e fallback 字节断言）；② **create-before-edit + stale-guard 序不变**（新笔记先 `vault.create`·`content` 在任何 await 前捕获·两 await[read+create]后 guard 重验 `sliceString(from,to)===content`·变了保新笔记跳 splice·窗口变大但 guard 正确性不变）；③ **单趟 String.replace** 提取内容含 `{{...}}` 字面不二次展开（实测 + e2e 双证）；④ 默认空 `noteBody===extractedContent(content)` 逐字节同 R236 前（r44/r216 字节锁）。§A 竞态不碰·§C r18-diff N/A → **简化门 clean**（expandExtractTemplate 与 expandTemplate date 逻辑相似仅<8 行+变量集不同·合并需泛型 helper STOP·inline 模板 build 单调用点·Store 镜像 accentColor idiom） → **多维对抗 8 维 PASS·0 阻断·1 minor 已修**（**大小写不一致致内容重复**：展开 regex case-insensitive 但 `{{content}}` 缺省检测 case-sensitive → `{{CONTENT}}` 展开 + 追加双重 → 改 `tmpl.toLowerCase().includes("{{content}}")`[对 `{{content:fmt}}` 仍正确 false]+加 uppercase 回归；newTitle/fromTitle 取值与 splice finalName 一致·move-heading 共用模板 faithful·readString hoisted 前向引用合法·分层/i18n parity 全合规；评审记 1 可不修 minor[空模板首部两空行·罕见无害]）。收尾 bump 版本三处 0.232。**桌面 probe N/A**（extract 写 = R44 FS-vetted·R236 加 `vault.read`[既有只读 API] + 纯字符串展开·跨端同码·浏览器 byte 等价·同 R234/R223 write-path-proven）·**r18-diff N/A**（extract 写编辑器/新笔记 doc 非阅读管线·不碰 markdown.ts）。**新教训**：① 套模板到「提取到新笔记」——写 composer 专用单趟展开（**逐字镜像既有 expandTemplate 的 String.replace 单趟语义**·绝不多趟/多次 replace·提取内容含 `{{var}}` 字面不被二次展开=对抗输入）·**不扩既有 expandTemplate**（变量集不同·避免破坏 templates feature）·模板 read 失败必 fallback verbatim（缺模板不丢内容）·默认空=verbatim 字节零回归；② 大小写无关的变量 regex 配套的「变量是否出现」检测也必须 case-insensitive（`toLowerCase().includes`）·否则 `{{CONTENT}}` 展开+追加双重；③ 触 templates.ts/extract 写时跑 r23/r44/r216 字节套件·**pre-existing 崩溃的相邻套件顺手修复**（r23 测试 nav 漏 click templates section·非本轮回归·修复恢复验证覆盖）。**笔记重组（旧 bounded backlog 最后一项）收官·正式转二次拍板「表面复刻序」R237 换库常驻入口。**

### R235 套件回归（2026-06-25，笔记重组设置 Tab 补完 slice 2 · 「合并提示」toggle[Obsidian native「Note composer」Ask to confirm before merging·默认 ON]·零新依赖 · 逻辑档[碰 merge vault 写 + delete-confirm 重命名·数据安全红线] · 简化门 clean · 多维对抗 8 维 deliverable·0 阻断·1 minor 已修 · 桌面 probe N/A）

R235 = R234 建的 Note composer 设置 Tab 补「合并提示」（→ 2/3·模板文件位置留 R236）。**Step 0 scout**：WebFetch `obsidian.md/help/Plugins/Note+composer` 实证「By default, Note composer asks you to confirm when merging notes」默认 **ON**；explorer 坐实 Geode 合并**无 confirm**（`QuickSwitcher.tsx:200` 直接 `void mergeNotes`）+ **已有可复用 confirm** `core/confirm.ts confirmDelete`（泛型但 delete-命名·4 调用点）。**详见 ARCHITECTURE「Round 235 additions」**：`confirmDelete`→**`confirmAction`**（泛化重命名·body 字节不变·4 调用点 sed 改·typecheck 全校）；`mergeConfirm` Store（默认 true·`geode.mergeConfirm`）；QuickSwitcher merge activate 包 `void(async()=>{ if(mergeConfirm.get() && !(await confirmAction(...))) return; mergeNotes(...).then().catch() })()`（confirm = vetted mergeNotes 前的 gate·不改 merge 写）；confirm 消息 `stripExtension(basename())`；NoteComposerSection +toggle；i18n +4 键×中英；probe `__geodeMerge` 不 gate；`r47-e2e` 加 `page.on("dialog",accept)`。

新增套件：`r235-e2e.mjs` **14/14**（Note composer Tab 有「合并前确认」toggle 默认 ON·**ON+accept→merge[源 trash·target 含两端 body]·ON+dismiss→源存活+target 零污染[NO merge·零丢失]·OFF→无 dialog 直接 merge**·localStorage `geode.mergeConfirm` 持久化·reload 恢复 OFF）。**套件矩阵不回退**：**r47 11/11[merge·加 dialog accept 后 part B 仍真 merge]·r140 18/18 + r161 15/15 + r166 18/18[delete-confirm 重命名零破坏]·r38 19/19[switcher]·r231 13/13·r234 14/14[Note composer Tab]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（碰 merge vault 写路径 + delete-confirm 函数重命名·数据安全红线一票否决 + 新 store + merge 控制流）→ data-safety 坐实零丢失**：confirm gate 真在 `mergeNotes` 之**前**·cancel（dismiss）布尔代数逐分支验证 `true && !(false)=true→return`【绝不调 mergeNotes】（e2e dismiss 场景实测源存活 + target 零污染）·`mergeNotes` 写路径（append-before-trash + live-buffer 读 + R16 link rewrite + `vault.trash` 可恢复）逐字节未动·OFF = R235 前直接 merge 零回归·§A 竞态不碰·§C r18-diff N/A → **简化门 clean**（async IIFE 为同步 activate 里 await confirm 所必需·STOP-protected·`.then/.catch` 既有结构搬入·重命名是泛化既有泛型函数非删除对象·mergeConfirm 镜像 readBool idiom） → **多维对抗 8 维 deliverable·0 阻断·1 minor 已修**（confirm 消息 `basename` 带 `.md` 与 switcher 列表[FileNode.basename 无扩展名]及 Obsidian 不一致 → 改 `stripExtension(basename())`；async IIFE 闭包 const-narrowing 穿透[mergeSource string 非 null·typecheck 0 坐实]；重命名 src 零残留[grep]·delete 行为零变[r140/r161/r166 绿]；mergeNotes 唯一 UI 入口 = QuickSwitcher·命令只开 switcher·无其它 merge 路径漏 gate；await confirmAction 对 browser[window.confirm boolean]/Tauri[ask Promise]皆正确）。收尾 bump 版本三处 0.231。**桌面 probe N/A**（merge 写 = R47 FS-vetted·confirmAction Tauri `ask` = R140-vetted[delete 已用·跨端同机制]·R235 纯 gate 接线·浏览器 dialog accept/dismiss ≡ 桌面 ask）·**r18-diff N/A**（不碰 markdown.ts·merge 写非阅读管线）。**新教训**：① 给「破坏性/移动」操作加确认——复用既有泛型 confirm（泛化命名 confirmDelete→confirmAction）·confirm 是 vetted 写之**前**的 gate（不碰写路径）·cancel 必 early-return 不调写（data-safety）·默认 ON 改变现状但更忠实；② 加默认-ON 的 UI confirm 后·驱动该 UI 的回归套件（r47 part B）会撞 `window.confirm`（Playwright 默认 dismiss→操作取消）→ 套件顶加 `page.on("dialog",d=>d.accept())` 走真实「用户确认」路径保绿。**backlog 余 5 项·R236 续取（笔记重组 Tab 补完最后一格「模板文件位置」→3/3·改 extract 字节 data-safety 单独轮·后转二次拍板表面复刻序「换库常驻入口」）。**

### R234 套件回归（2026-06-25，选项2 bounded backlog 续 · 笔记重组(Note composer)设置 Tab +「替代原文的方式」下拉[Obsidian native 核心插件·Replace selection with: Link 默认/Embed/None]·零新依赖 · 逻辑档[碰 editor/vault extract 写路径·数据安全红线] · 简化门 clean · 多维对抗 9 维 deliverable·0 缺陷 · 桌面 probe N/A）

R234 = **选项2 bounded backlog 续取**（ROADMAP 把笔记重组拆两项·本轮做清爽下拉·合并提示+模板位置留 R235）。**Step 0 三 scout**：① reference `05-核心插件.md:41` ground truth = 笔记重组三设置「替代原文的方式(下拉)·模板文件位置(输入)·合并提示(开)」；② WebFetch `obsidian.md/help/Plugins/Note+composer` 实证「Replace selection with」= **Link(默认)/Embed/None**；③ explorer 坐实 `core/noteComposer.ts:76` `extractReplacement` **embed 路径已建**但 `noteComposerCommands.ts` 调用方**写死 "link"**·`ExtractMode` 缺 "none"。**详见 ARCHITECTURE「Round 234 additions」**：`core/noteComposer.ts` `ExtractMode` 加 "none"(→ extractReplacement 命中返回 ""·embed/link 字节不变)；`core/appearance.ts` `ExtractReplaceMode` enum Store(默认 "link"·`geode.extractReplaceMode`·镜像 defaultNewTabMode·命名避撞纯函数 extractReplacement)；`noteComposerCommands.ts` 注入 `extractReplaceMode.get()` 替换硬编码 "link"(extract-selection + move-heading 共用 extractRange·= Obsidian 同一设置管两者)；`main.tsx` probe 类型 → `ExtractMode`；`SettingsModal.tsx` 新核心插件设置 Tab「Note composer」(SectionId + NAV_GROUPS[icon "files" 真注册] + route + NoteComposerSection select 三 option·镜像 R231)；i18n +6 键×中英。

新增套件：`r234-e2e.mjs` **14/14**（Note composer 设置 nav + 下拉默认 link + 恰 link/embed/none 三 option + nav 标签「Note composer」·纯 helper replacement 三模式·**真 extract 三模式：link→源留 `[[WORDlink]]` 无 embed·embed→`![[WORDembed]]`·none→无引用且保 before+after + 新笔记仍建[move 非 delete]**·localStorage `geode.extractReplaceMode` 持久化·reload 恢复 none）。**套件矩阵不回退**：**r44 25/25[extract 端到端]·r216 17/17[move-heading byte-exact]·r47 11/11[merge]·r231 13/13[设置 Tab 模式]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（碰 editor/vault extract 写路径·数据安全红线一票否决 + 新 enum store + ExtractMode 联合扩展 + 注入控制流）→ data-safety 坐实零丢失**：none 走既有 `extractRange` **create-before-edit**（`vault.create` 新笔记先落盘·失败 return 源不动）+ **stale-guard**（await 让出后重验 `sliceString(from,to)===content`·变了保新笔记跳替换）+ 普通 CM 事务（`userEvent:"input.extract"`→dirty→autosave·**非** applyExternalEdits）·"none" 仅令 insert=""·`selection.anchor=from` 合法·**不新开写路径**·= **move 语义**（提取内容已落新笔记后才删源·非 destructive delete）·§A 竞态(autosave/flush/rename/delete/watcher)全不碰·§C 未碰 markdown.ts(r18-diff N/A) → **简化门 clean**（enum-store + read-helper 逐字镜像既有 defaultNewTabMode·NoteComposerSection 跨轮 UI idiom·零可减·零新导出符号本步） → **多维对抗 9 维 deliverable·0 缺陷**（data-safety 维坐实 none 不丢[create-before-edit + 新笔记仍建 e2e 证]·默认 link 字节零回归[r44/r216 双绿]·**ExtractMode union 扩展全站 grep 无漏 case**[extractReplacement 仅 3 调用点·if-chain 穷举·无 switch 漏 default]·设置四处齐 + testid 唯一 + icon "files" 真注册 + cast 安全·分层/命名/i18n parity 全合规）。评审 2 文档 nit（行号漂移 :51→:53 已修·键数口径）。收尾 bump 版本三处 0.230。**桌面 probe N/A**（extract 写路径 = R44 FS-proven[r44-probe 已证 DocumentHandle→vault→Rust fs]·R234 纯 enum 注入 + "none"→"" 纯 JS + localStorage/select 设置 UI·跨端同码·浏览器真-extract byte 等价·同 R223 write-path-proven 推理）·**r18-diff N/A**（extract 写编辑器 doc 非阅读管线·不碰 markdown.ts）。**新教训**：① 给「提取/移动到新笔记」类命令加「替代原文」设置——核心是把硬编码的 replacement mode 经 enum Store 注入既有 extractRange 单一钥匙点·"none"=空 replacement 复用既有 dispatch（不新开写路径·保 create-before-edit move 语义零丢失）；② 扩展穷举 union(ExtractMode 加 none)必 grep 全部消费点(helper if-chain / probe 类型 / switch)确认无漏 case·probe 类型用命名类型 import 而非内联联合防漂移。**backlog 余 5 项·R235 续取（笔记重组设置 Tab 补完=合并提示 toggle + 模板文件位置·把 Tab 从 1/3 补到 3/3）。**

### R233 套件回归（2026-06-25，选项2 bounded backlog 续 · 编辑器「始终聚焦新标签页」toggle[Obsidian native Editor「Always focus new tabs」·默认 ON] · gate `workspace.openFile` 新 tab 抢焦·零新依赖 · 逻辑档[碰 core openFile·数据安全红线→纯 tab 状态·零 .md 写] · 简化门 clean · 多维对抗 8 维 deliverable·0 阻断·评审揪 1 minor 已修 · 桌面 probe N/A）

R233 = **选项2 bounded backlog 续取**（碰 `core/workspace.ts` openFile = 核心导航·逻辑档）。**Step 0 三 scout**：① reference `01-编辑器.md:12` ground truth = 「始终聚焦新标签页 | 开关 | **开** | 创建或打开文件时，立即切换至该标签页」→ native·默认 ON·EN「Always focus new tabs」；② WebSearch 实证 OFF = 从主区/书签面板打开到新 tab 保持当前 tab 焦点（后台打开）；③ explorer 定位抢焦唯一钥匙点 `workspace.ts:445-446`（新 tab 分支置 `activeTabId`+`activePaneId`）。**详见 ARCHITECTURE「Round 233 additions」**：`appearance.ts` `focusNewTab` Store（默认 true·`geode.focusNewTab`·镜像 R229 showViewModeToggle）；`workspace.ts` openFile 签名加性 `focus?: boolean`（冻结契约·~20 调用点默认不变）·新 tab 分支 `shouldFocus = opts.focus ?? focusNewTab.get()`→ 抢焦 / 后台（append tab·不改 active/activePaneId）·`openedInBackground` 旗标仅后台分支跳 `emitActiveFile()`；两显式命令强制 focus:true（Cmd+T `app:new-tab` + `reopenClosedTab`:878 依赖 getActiveTab 还原 mode/pin）；SettingsModal EditorSection +1 toggle 行；i18n +2 键×2 语言。

新增套件：`r233-e2e.mjs` **17/17**（设置 toggle 默认 ON + native 串「Always focus new tabs」·ON openFile 新 tab 抢焦[active→新文件]·**OFF 后台打开[active 不变 AND 新 tab 仍存在于 pane]**·OFF+focus:true 旁路强制抢焦·**Cmd+T 命令 OFF 下仍 focus 新 tab**·**reopenClosedTab OFF 下仍 focus + 还原**·localStorage `geode.focusNewTab` 持久化·toggle 回 ON 恢复抢焦·reload OFF honored）。**套件矩阵不回退**：**r81 14/14[tab 套件]·r39 17/17[reopen/pin·独立坐实 focus:true 旁路保 getActiveTab 还原]·r229 9/9·r232 10/10·r88 13/13[new-tab-mode probe·改 focus:true 自卫后绿]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（碰 core openFile·数据安全红线一票否决 + 新 store action setFocusNewTab + openFile opts 加性扩展 + 新控制流后台分支）→ data-safety §A 竞态(1-6) 全不碰[autosave/flush/rename/delete/watcher 零改·仅改「新 tab 是否 active」store 态]·§B 无新 .md 写路径·§C markdown.ts 未碰→r18-diff N/A → 简化门 clean[`openedInBackground` 旗标 load-bearing 确认：reuse/replace 早返分支必须照常 emit·消除会破坏] → 多维对抗 8 维 deliverable·0 阻断缺陷**（默认 ON 逐状态同 R233 前[抢焦分支字节同]·`??` 对 false/undefined 区分正确·后台分支无漏 state 字段·旗标精确只后台 true·焦点豁免完整[全仓 grep openFile(newTab:true) 后读 getActive* 仅 reopen/Cmd+T 两处·均已 focus:true]·后台 tab 下游鲁棒[无组件假设末位=active]·reveal path-guarded[EditorPane:891]不 mis-scroll·data-safety 后台 tab EditorPane 未挂载无未存编辑可丢）。**评审揪 1 minor 已修**：probe `__geodeNewTabMode`（main.tsx:561）`openFile(newTab:true)` 后读 `getActiveTab()?.mode` 未传 focus:true→在 `geode.focusNewTab` 持久化 OFF 库上假阴性→**加 focus:true 自卫**。收尾 bump 版本三处 0.229。**桌面 probe N/A**（纯 Store + 导航逻辑·跨端同码·core/workspace 两 adapter 同行为·WKWebView 无 CDP 难驱焦点切换·browser E2E 全覆盖·同 R229/R232）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写）。**新教训**：① 给核心导航 openFile 加焦点设置——抢焦是单一钥匙点（新 tab 分支置 activeTabId/activePaneId）·gate 用加性 opt[默认 nullish-coalesce 到设置]保 ~20 调用点零回归；② **加焦点门控前必 grep 全仓 `openFile(newTab:true)` 后紧跟 `getActive*` 的内部调用点**——这些依赖「新 tab 即 active」做后续操作（reopen 还原 mode/pin、probe 读 mode），OFF 时会静默失败·须显式 focus:true 旁路（[[geode-panel-write-live-handle-not-cache]] 同源「依赖隐式活动态」教训）。**backlog 余 6 项·R234 续取（笔记重组 link/embed 下拉 / 笔记重组设置）。**

### R232 套件回归（2026-06-25，选项2 bounded backlog 续 · 编辑器「智能列表」toggle[Obsidian native Editor「Smart lists / 智能列表」·默认 ON] · gate `@codemirror/lang-markdown` markdownKeymap 进新 CM6 compartment·零新依赖 · 逻辑档[碰 editor keymap·数据安全红线] · 简化门 clean · 多维对抗 deliverable·7 维全证伪·0 缺陷 · 桌面 probe N/A）

R232 = **选项2 bounded backlog 续取**（碰 editor 逻辑档·镜像 R225 compartment）。**Step 0 双 scout**：① reference `01-编辑器.md:38`（编辑器-03.png ground truth）+ Obsidian 官方翻译仓 `setting.editor.option-smart-indent-lists` = native 核心 Editor 设置·**默认 ON**·EN「Smart lists」/ ZH「智能列表」；② 代码 scout 坐实 Geode 列表续行来自 lang-markdown `markdownKeymap`·bundled 在 `markdown()` 内（`addKeymap` 默认 true）·`markdownSansHeaderFold()` 只滤 foldService·**keymap 无门控**。**详见 ARCHITECTURE「Round 232 additions」**：`appearance.ts` `smartLists` Store（默认 true·`geode.smartLists`）；`cmExtensions.ts` `markdown({addKeymap:false})` + `smartListExtension(on)=Prec.high(keymap.of(markdownKeymap))` 进 `smartListCompartment`（buildEditorExtensions opts 冻结契约三处对齐）；`EditorPane.tsx` ref+Compartment+useStore+reconfigure effect+cleanup（逐位镜像 markdownWrapCompartment 7 处）；SettingsModal EditorSection +1 toggle 行；i18n +2 键×2 语言。

新增套件：`r232-e2e.mjs` **10/10**（编辑器设置 Smart lists toggle 默认 ON·`- foo`+Enter 续 `- `·`1. foo`+Enter 重编号 `2. `·`> foo`+Enter 引用块续 `> `[证 bundled 耦合]·OFF 后 `- foo`+Enter 不续[gate 坐实]·localStorage `geode.smartLists="false"` 持久化·toggle 回 ON 续行恢复·reload OFF honored）。**套件矩阵不回退**：**r225 10/10·r153 8/8·r35 25/25[sibling editor compartment + 自动配对字节不退]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（碰 editor 管线 keymap·数据安全红线一票否决 + 新 store action smartLists + 新 compartment/reconfigure effect）→ data-safety §A 竞态(1-6) 全不碰[autosave/flush/rename/delete/watcher 零改·toggle 只改 Enter/Backspace 插入物·不改保存机制]·§B 无新 .md 写路径[ON 逐字节同·OFF defaultKeymap 纯换行]·§C markdown.ts 未碰→r18-diff N/A → 简化门 clean → 多维对抗 deliverable·7 维全证伪·0 缺陷**（评审对 `node_modules/@codemirror/lang-markdown/dist/index.js:422` 核实 `Prec.high(keymap.of(markdownKeymap))` 逐字节同·`addKeymap:false` 只摘 keymap[pasteURL/HTML 完成各自 flag 不动]·6 处 compartment 生命周期齐·compartment.reconfigure 纯配置交换不动 doc/selection·e2e 非同义反复）。收尾 bump 版本三处 0.228。**桌面 probe N/A**（keymap + localStorage·跨端同码·WKWebView 无 CDP 合不出 Enter·browser 全覆盖·同 R225）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写）。**deviation 记一句**：gate 整条 markdownKeymap·OFF 时引用块续行 + 退格降级一并停（lang-markdown 把列表+引用块续行耦合进单条 Enter 命令·拆分须自写上下文判定命令=data-safety 高风险不值·默认 ON 零感知·Obsidian 官方描述本身含糊可辩护）。**backlog 余 7 项·R233 续取（始终聚焦新标签页 / 笔记重组设置）。**

### R231 套件回归（2026-06-25，选项2 bounded backlog 续 · Quick switcher 3 设置 Tab「仅显示已创建/显示附件/显示所有受类型」[Obsidian native Quick switcher settings] · QuickSwitcher files 集合三路条件化 + create 行门控·零新依赖 · 逻辑档[纯只读导航·拓宽被多处消费的 files 集合] · 简化门 clean · 多维对抗 deliverable·评审揪 1 真缺陷[exact 守卫]·已修 · 桌面 probe N/A）

R231 = **选项2 bounded backlog 取最清爽单项**（轻逻辑·纯只读导航）。**Step 0**：reference `05-命令面板:18` 确认 native·QuickSwitcher 功能在但硬用 `getMarkdownFiles()`·无设置面。**详见 ARCHITECTURE「Round 231 additions」**：`core/appearance.ts` +3 Store（`switcherShowExistingOnly` 默认关 / `switcherShowAttachments` 默认开 / `switcherShowAllTypes` 默认关·`geode.switcher*` localStorage）；QuickSwitcher `files` memo 三路条件化（all→`getFiles()` / attachments→`getFiles().filter(md||isAttachmentPath)` / 默认→`getMarkdownFiles()`）+ create 行 gate `!showExistingOnly`；SettingsModal 新 `quick-switcher` 设置 Tab（3 toggle 行·镜像既有 inline 模式）；i18n +4 键×2 语言。

新增套件：`r231-e2e.mjs` **13/13**（设置 Tab 入口 + 3 toggle·默认 ON 附件现身·默认 OFF .txt 不现·create 行·**附件名精确匹配仍显 create 行[评审揪缺陷·exact 加 .md 守卫]**·existing-only 隐 create·附件 OFF 移附件·all-types 纳 .txt·3 toggle 持久化 reload 恢复）。**套件矩阵不回退**：**r38 19/19[QuickSwitcher 基础套件不退]·r106 12/12**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（拓宽被多处消费的 `files` 集合·条件化导航控制流；纯只读·零 .md 写·零 documents 触碰）→ 简化门 clean → 多维对抗 deliverable·评审揪 1 真缺陷**：拓宽 `files` 纳附件后，旧 `exact` 判定（决定隐藏 create-note 行）遍历 `files` 找 basename 精确匹配·旧假设「files 全是可建 .md 笔记」被附件破——键入恰为某附件名会误隐 create 行→无法建同名 .md。**修**：`exact` 仅 `file.extension==="md"` 命中才置 + 补 attachment-collision 用例。收尾 bump 版本三处 0.227。**桌面 probe N/A**（设置 + localStorage + 模态·浏览器全覆盖）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写·仅 localStorage + 只读导航）。**新教训**：拓宽/改变被多处消费的核心集合（switcher files / tab 列表 / 命令注册表 / metadata index）时，同轮必 grep 全部下游消费点、逐个核对其对集合内容的隐含假设是否仍成立——拓宽常静默破坏「这集合里全是 X」式假设（[[geode-collection-widen-recheck-consumers]]）·零回归测试绿 ≠ 无新 bug（r38 fixture 全 .md 盖不住附件混入）。**backlog 余 8 项·R232 续取（智能列表 toggle / 始终聚焦新标签页）。**

### R230 套件回归（2026-06-25，选项2 bounded backlog 续 · 文件夹右键「设为附件文件夹」[Obsidian native folder context「Set as attachment folder」] · 复用既有 setAttachmentFolder·零新依赖 · 机械档[context-menu IA·调既有 setter·非 vault IO] · 跳简化门 · scoped review deliverable·5 点全确认·0 缺陷 · 桌面 probe N/A）

R230 = **选项2 bounded backlog 取最清爽单项**（scout 评「★最干净单项」）。**Step 0**：reference `08-右键菜单:30` 确认 native·后端 `core/attachments.ts:27 setAttachmentFolder()`（写 `geode.attachmentFolder` localStorage 设置·非 vault/file IO）早 vetted·设置输入框已用·仅文件夹右键缺此项。**详见 ARCHITECTURE「Round 230 additions」**：Explorer folder 分支 +1 按钮 `explorerctx-set-attachment-folder`·onClick `setMenu(null)+setAttachmentFolder(node.path)+showLinkUpdateNotice` toast·镜像 new-note-here；i18n +2 键×2 语言。

新增套件：`r230-e2e.mjs` **8/8**（文件夹右键见「设为附件文件夹」·点击→`geode.attachmentFolder` localStorage = "myassets"·toast 确认·菜单关·**file 右键无此项[folder-only]**·持久化 reload）。**套件矩阵不回退**：**r130 12/12·r93 22/22[explorer 套件·context menu 不退]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=机械档（context-menu IA +1 项 + i18n·调既有 vetted setter·非 vault/file IO/documents·无新控制流/store action·未碰数据安全面）→ 跳简化门 → scoped review deliverable·5 点全确认·0 缺陷**（testid 唯一·icon `folder` 已注册非 fallback·i18n 2 键中英真存在 + `{folder}` 占位对齐·`setAttachmentFolder(node.path)` 与设置输入框同源[存 RAW·消费 trim]·菜单项只在 folder 分支[file 零改]·showLinkUpdateNotice 复用既有 toast）。收尾 bump 版本三处 0.226。**桌面 probe N/A**（右键 + localStorage·浏览器全覆盖）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写·仅 localStorage）。**backlog 余 9 项·R231 续取（快切 3 档 toggle 最清爽）。**

### R229 套件回归（2026-06-25，选项2 bounded backlog 取首项 · 编辑器设置「视图状态切换」toggle[Obsidian native Editor「Show view mode toggle」·默认开·每标签页显示编辑/阅读切换按钮] · 纯渲染门·零新依赖 · 逻辑档[碰 editor·纯 React 渲染门零 .md 写] · 简化门 clean · 多维对抗 deliverable·7 维全证伪·0 缺陷 · 桌面 probe N/A）

R229 = **R228 拐点纠误后从 ROADMAP「选项2 bounded backlog」(scout 余 11 项) 取最清爽**（纯渲染门）。**Step 0**：reference `01-编辑器:15` 确认 native（Editor 顶部组·R226「Display 组全清」未覆盖此顶部组·scout 找出漏检）·`EditorPane:1200` 的 `.editor-mode-group`(live/source/preview 三按钮) 无条件渲染。**详见 ARCHITECTURE「Round 229 additions」**：逐点镜像 R94 showRibbon/R100 showTabTitleBar——`showViewModeToggle` Store(默认 true·零回归)；EditorPane `useStore` + 把 `.editor-mode-group` 包进 `{viewModeToggleVisible && (...)}`；SettingsModal EditorSection toggle。

新增套件：`r229-e2e.mjs` **9/9**（默认 ON mode-group 显·**真 Settings UI**[settings-nav-editor→settings-view-mode-toggle] OFF→隐·**OFF 下 setTabMode→source 仍切[逻辑未门控·只隐按钮]**·持久化 reload·反向 ON）。**套件矩阵不回退**：**r106 12/12·r50 15/15·r131 8/8[editor 套件·mode-live/source/preview testid·默认 true 零变]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（碰 editor·纯 React 渲染门零 .md 写非数据安全）→ 简化门 clean[纯镜像 R94/R100 + 1 Store + 1 条件渲染门] → 多维对抗 deliverable·7 维全证伪·0 缺陷**（JSX wrap 闭合平衡未误吞 header·OFF 仅隐按钮组·模式切换两路径[按钮 setMode + 全局命令 `app:toggle-mode` Ctrl+E·App 层解耦]均不依赖 mode-group render·默认 true 恒渲染=prior·header bookmark/body 未卷入·持久化·分层/i18n/testid·faithfulness 同 showRibbon OFF 保命令先例）。收尾 bump 版本三处 0.225。**minor（评审记·非缺陷）**：wrap 内 3 按钮少缩进 2 空格（纯排版·Prettier 可归位·保最小 diff）。**桌面 probe N/A**（纯渲染门·浏览器全覆盖·R94/R100 先例）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写）。**新教训**：UI affordance 显隐设置（视图切换按钮/功能区/标签栏）= 纯 React 渲染门·只条件渲染该 UI 元素·**绝不门控背后逻辑/命令路径**（OFF 隐按钮但 Ctrl+E 命令仍切·同 Obsidian「隐 X 保命令」）·默认 prior behavior 保零回归·镜像最近 vetted 同模式（showRibbon/R94）。**backlog 余 10 项·R230 续取（设为附件文件夹 / 快切 3 档）。**

### R228 套件回归（2026-06-25，选项2 补深七轮 · 文件与链接设置「重建仓库缓存」[Obsidian native Files&Links 高级组「Rebuild vault cache」·命令 `app:rebuild-cache` + 设置按钮] · 复用既有 rebuildAll·零新依赖 · 逻辑档[surface rebuildAll vault 读·保守] · 简化门 clean · 多维对抗 + data-safety deliverable·7 维全过·0 缺陷 · 桌面 probe N/A）

R228 = **🔑 拐点纠误轮**：R227 收尾据 R226 explorer（仅扫 editor/appearance）误判「bounded 矿脉见底·交回大方向」→ **Ultracode 6 表面并行穷举 scout（workflow `geode-bounded-work-scout`·6 readers + high-effort 综合者·104 项分类）纠误：实剩 13 bounded-autonomous**（文件与链接/核心插件各设置 Tab/右键/Editor 顶部组等漏扫表面）→ 矿脉远未枯竭·loop 继续。R228 = 综合者首推（最低风险）。**详见 ARCHITECTURE「Round 228 additions」**：reference `02:40` 确认 native·Geode 重走引擎 `metadata.rebuildAll()`（清两 Map+重 indexFiles+bump·vault-load 路径实测）早存在·仅缺用户可达面 → App.tsx 命令 `app:rebuild-cache`(callback 调 rebuildAll + R183 toast) + SettingsModal FilesAndLinksSection action 按钮(execute 命令·镜像 reload-plugins) + `.settings-action-btn` CSS + i18n 5 键×2 语言。

新增套件：`r228-e2e.mjs` **9/9**（命令注册·执行 rebuildAll→metadata.revision bump + tag 'rbtag' 仍在 + tag→note 映射 rb.md 仍在[cache 重派生非丢]·**真 Settings UI**[settings-nav-files-and-links→settings-rebuild-cache] 按钮触发 revision bump·toast·无 page error）。**套件矩阵不回退**：**r24 12/12·r65 12/12·r127 15/15[metadata 套件·rebuildAll 未改零变]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（surface rebuildAll vault 读·保守·但 read-only 重 index 零 .md 写）→ 简化门 clean[纯接线·命令 thunk+按钮+i18n+CSS·无 intra-round 重复] → 多维对抗 + data-safety deliverable·7 维全过·0 缺陷**（**data-safety 核心问坐实**：reviewer grep metadata.ts 全文零 `vault.write/create/modify/delete`+零 `documents/DocumentHandle`·rebuildAll 仅 clear 两 Map→indexFiles[唯一 IO=vault.read 纯读]→bump·与 CM live/未存内容隔离·零丢失；命令 id 唯一·toast `.then` 真完成才提示·空/大 vault 不抛·重复点击幂等）。收尾 bump 版本三处 0.224。**桌面 probe N/A**（命令 + 内存重索引·浏览器全覆盖）·**r18-diff N/A**（不碰 markdown.ts·零 .md 写）。**新教训**：① 别据【部分表面】scout 宣布 bounded 矿脉枯竭——宣布 exhaustion 前用 Workflow 并行 fan-out 跨全表面（所有 reference 页 + 核心插件每设置 Tab + 右键 + 候选池）穷举（R226/R227 仅扫两表面误判·穷举 scout 纠出 13 项）；② surface 既有 read-only 引擎（rebuildAll/setFontSize）= 最低风险 bounded 轮·data-safety 核心问 = grep 被调方零 vault 写/零 documents 触碰即坐实。**🆕 ROADMAP 新增「选项2 bounded backlog」节（scout 余 11 项持久执行队列·后续轮免重 scout）。**

### R227 套件回归（2026-06-25，选项2 补深六轮[bounded 矿脉收尾] · 外观设置「快速调整字体大小」toggle[Obsidian native Appearance「Quick font size adjustment」·字体组·默认关·Ctrl/Cmd+滚轮调字号] · 零新依赖 · 逻辑档[新控制流=wheel 处理器·非 data-safety] · 简化门 clean · 多维对抗 deliverable·8 维全证伪·0 阻断 · 桌面 probe N/A）

R227 = **选项2 即取序 + Editor Display 组消化后最后一个 trivial bounded 项·完成后外观字体组补完**。**Step 0**：reference `03-外观:34` 确认 native·Geode 已有字号基建（`workspace.fontSize`+`setFontSize`[clamp 11-28·驱动 `--editor-font-size`]·R50·zoom 命令复用）→ 缺口 = toggle 门控的全局 wheel 处理器。**详见 ARCHITECTURE「Round 227 additions」**：`quickFontZoom` Store(默认 false·零回归)；App.tsx 全局 wheel effect（**评审驱动 gate on `useStore`·OFF 不装 non-passive 监听·保 passive 默认快路径**）·仅 `(ctrlKey||metaKey)&&deltaY≠0` 时 `preventDefault()` + 复用 vetted `setFontSize(cur±1)`；SettingsModal 外观字体组 toggle。

新增套件：`r227-e2e.mjs` **11/11**（默认 OFF Ctrl+wheel 无变·**真 Settings UI**[openModal→settings-nav-appearance→settings-quick-font-zoom-toggle] ON→Ctrl+Cmd wheel up/down 改 fontSize·非修饰键滚轮无变·clamp 28/11 边界·持久化 reload·反向 OFF）。**套件矩阵不回退**：**r50 15/15[font size/spellcheck] 全绿（默认 false 零变）**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（新控制流·非 data-safety[零 .md 写/vault IO·未碰 editor 管线·复用 vetted setFontSize]）→ 简化门 clean[纯新 Store + 1 effect + 1 toggle·wheel/keydown effect 相似非相同不合并·三段守卫/passive:false load-bearing] → 多维对抗 deliverable·8 维全证伪·0 阻断**（三段守卫各必要·gated 读 live·preventDefault 仅动作时[OFF/无修饰键不拦正常滚动]·默认 false early-return 零回归·cleanup 对称无泄漏·跨平台 ctrl||meta[mac pinch 发 ctrlKey]·分层/i18n/testid）。评审驱动改进：effect gate on toggle→默认 OFF passive 快路径。收尾 bump 版本三处 0.223。**已知 minor defer**：ON 时 Ctrl+scroll over graph canvas 双触发（GraphView wheel handler 不 stopPropagation·niche·gated 在 opt-in 后）。**桌面 probe N/A**（wheel + localStorage·浏览器全覆盖·R50 先例）·**data-safety 套件 N/A**（零 .md 写/vault IO·未碰 editor/markdown 管线）。**新教训**：① 全局 wheel listener 加设置必 `{passive:false}`(preventDefault 生效) + 仅真正动作时 preventDefault(否则 early-return 不拦默认) + effect gate on toggle 保默认 passive 快路径；② 装全局 listener 前 grep 既有同类(graph wheel)核冲突。**🛑🛑 bounded 矿脉见底拐点**：选项2 即取序 + Editor Display + 外观字体组全 done·剩余全撞硬边界#5/需立项→**R227 后强烈建议暂停 loop 请用户选向**（选项1 须批依赖 / Canvas·Bases·stacked-tabs 立项·R158/R175 纪律）。

### R226 套件回归（2026-06-25，选项2 补深五轮 · G8 编辑器设置「从右到左 RTL」global toggle[Obsidian native Editor「Right-to-left」·显示组·默认关] · 纯视觉·零新依赖 · 逻辑档[碰 editor·底线①·纯 DOM dir 属性零字节] · 简化门 clean · 多维对抗 + data-safety deliverable·7 维全证伪·0 缺陷 · 桌面 probe N/A）

R226 = **选项2 即取序 G8 Display 组最后缺口·完成后 Display 组全清**。**Step 0 verify-first**：reference 截图 `_截图/01-编辑器/编辑器-02.png`（R224 ground-truth·行号与 RTL 间）确认 native core 全局方向 toggle·WebSearch 辨 per-note frontmatter direction 是 community esm7/obsidian-rtl 不做。**详见 ARCHITECTURE「Round 226 additions」**：纯 DOM 属性·镜像 R50 spellcheck——`rightToLeft` Store(默认 false·零回归)；EditorPane 编辑视图 seed+effect `contentDOM.setAttribute("dir",rtl?"rtl":"ltr")`+`requestMeasure()`（CM6 原生 bidi 接管光标/选区·零编辑逻辑改）；阅读视图 preview div 加 `dir` prop（不碰 previewHtml 串→r18 N/A）；SettingsModal 显示组 toggle。

新增套件：`r226-e2e.mjs` **9/9**（默认 OFF `.cm-content` dir=ltr·**真 Settings UI**[openModal→settings-nav-editor→settings-rtl-toggle] ON→编辑 dir=rtl + 阅读 preview div dir=rtl·持久化 reload 恢复·反向 OFF→ltr·**doc bytes 逐字节不变[RTL 视觉-only]**）。**套件矩阵不回退**：**r33 37/37[format 字节锁]·r50 15/15[spellcheck·镜像源]·r35 25/25·r24 12/12·r106 12/12 全绿（默认 false 零变）**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（碰 editor·底线①·纯 contentDOM dir 属性零字节）→ 简化门 clean[纯镜像 R50 + 1 Store·seed+effect 对称必要实例非重复·requestMeasure 必需] → 多维对抗 + data-safety deliverable·7 维全证伪·0 缺陷**（视觉-only[r226 末断言 doc bytes 不变]·CM6 bidi 接管[livePreview decoration offset-based direction-agnostic 不动]·reactivity[镜像 R50·seed+effect 双覆盖]·阅读 div dir 不碰 previewHtml→r18 N/A·默认 false=LTR=prior·持久化·分层/i18n/testid·data-safety[无 dispatch/flush/activeElement·与 autosave/undo 零交互]）。收尾 bump 版本三处 0.222。**faithfulness minor**：Obsidian RTL 挂更高层 dir→行号 gutter 翻右·Geode 仅挂 contentDOM→gutter 可能仍居左·纯像素 nuance·在「纯视觉」scope 内。**桌面 probe N/A**（纯 DOM 属性·浏览器全覆盖·R50/R88/R224 先例）·**r18-diff N/A**（不碰 markdown.ts·preview div dir prop 不碰 previewHtml）。**新教训**：① CM6 原生 bidi——RTL 仅设 contentDOM `dir` 属性·CM 自动接管光标/选区·不动编辑逻辑·零字节；② 阅读视图加方向只在 host div 加 `dir` prop·不碰 previewHtml 渲染字节串（保 r18 N/A）。**⚠️ 拐点**：bounded 零-dep native toggle 矿脉将于 R227（快速调整字体大小）见底·后续宜转选项1[批依赖]/大件立项（交回大方向·R158/R175 纪律）。

### R225 套件回归（2026-06-25，选项2 补深四轮 · G8 编辑器设置「自动补全 Markdown 语法」toggle[Obsidian native Editor「Auto pair Markdown syntax」·行为组·默认 ON] · 零新依赖 · 逻辑档[碰 editor·底线①·纯 localStorage+reconfigure·markdownWrapHandler 行为零改] · 简化门 clean · 多维对抗 + data-safety deliverable·0 代码缺陷 · 桌面 probe N/A）

R225 = **选项2 即取序 G8 续项**。**Step 0 双纠误**：候选「自动补全英文标点」拆两 native 设置——①「自动补全英文标点符号」= Obsidian「Auto pair brackets」= **R153 已 done**（autoPairBrackets toggle·配对 `( [ { " '`·非 R63 出队 community typography）；②「自动补全 Markdown 语法」= Obsidian「Auto pair Markdown syntax」= R35 markdownWrapHandler 功能在但**恒开无 toggle = partial**（`bracketWrap.ts` JSDoc 自证映射）→ **R225 真缺口 = 第二项 toggle**。web 实证（forum）：两设置正交（brackets 管 `[]()` / markdown 管 `* ** _ \``）。**详见 ARCHITECTURE「Round 225 additions」**：逐点镜像 R153 closeBracketsCompartment 模式——appearance.ts `autoPairMarkdown` Store(默认 true·零回归)；cmExtensions 新 `markdownWrapExtension(on)` + 把 `:677` markdownWrapHandler 移进新 `markdownWrapCompartment`；EditorPane 7 接线点逐点镜像 closeBrackets；SettingsModal 行为组 toggle。**markdownWrapHandler/bracketWrap.ts 行为逐字节零改**（仅加门控·维持 R35「仅非空选区包裹」scope）。

新增套件：`r225-e2e.mjs` **10/10**（默认 ON `*/\`/_` 包裹选区→`*hello*`·**真 Settings UI**[openModal→settings-nav-editor→settings-autopair-markdown-toggle] OFF→选区被 `*` 替换不包裹·**正交[autoPairBrackets 仍 `(`→`()`]**·持久化 reload 恢复·反向 toggle 回 ON 复包裹）。**套件矩阵不回退**：**r35 25/25[bracket/wrap]·r153 8/8[auto-pair toggle]·r24 12/12[autosave] 全绿（默认 true 零变）**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（碰 editor·底线①·纯 localStorage+reconfigure·零新写路径）→ 简化门 clean[纯镜像 vetted R153 + 1 Store·compartment 7 接线点是既有模式对称实例非新重复] → 多维对抗 + data-safety deliverable·0 代码缺陷**（8 维全证伪：markdownWrapExtension(true)===原 base-list 直挂·移位无双挂[grep]·Prec.high 保留[Compartment.of 保 precedence·位置不变]·reconfigure 逐点镜像·正交·data-safety[仅既有非空选区包裹·input.type 有 undo/autosave·toggle 不 dispatch]·默认 true no-op·据实纠误映射正确）。评审揪 minor i18n（desc 漏 `$`·已补 en/zh）。**桌面 probe N/A**（CM 输入 + localStorage·浏览器 e2e 全覆盖·R153/R88/R92 先例）·**r18-diff 字节套件 N/A**（不碰 markdown.ts 阅读视图·markdownWrapHandler 既有写路径未改）。**新教训**：① reference 相邻设置名逐个 explorer + web 精确映射（「英文标点」= Auto pair brackets ≠ R63 community 弯引号·险混淆）；② 给既有恒开行为补 toggle = 移进 Compartment + Store 门控·逐点镜像最近 vetted 同模式（R153）·默认 prior behavior 零回归。

### R224 套件回归（2026-06-25，选项2 补深三轮 · G8 编辑器设置「隐藏参考标记」[Obsidian native Editor「Hide reference marks」·显示组·默认 ON] · 纯 CM decoration 零 .md 写·零新依赖 · 逻辑档[碰 editor/livePreview·底线①·非字节守恒] · 简化门 clean · 多维对抗 + data-safety deliverable·0 代码缺陷 · 桌面 probe N/A[纯渲染浏览器等价]）

R224 = **选项2 即取序 G8 首项**。**Step 0 verify-first**：WebSearch/WebFetch 未确证 native 设置名（Obsidian online docs 稀疏·`/help/editor` 404）→ **读 reference 截图 `_截图/01-编辑器/编辑器-02.png` 确认 ground truth**（toggle 实图可见·显示组·行号与从右到左之间·默认 ON）·语义 ON=live preview 只在光标处显示语法标记 / OFF=始终显示但保 widget 渲染（非 source mode）。**详见 ARCHITECTURE「Round 224 additions」**：**单一门控** = `livePreview.ts` 的 `hide()` helper（唯一空-`Decoration.replace({})` 路径·13 个分隔符 hide 全经它）加 `if (!hideMarks) return;`；widget（replaces.push widget）+ 样式（.cm-live-*·others.push）不经 hide() → OFF 保渲染；`hideMarks` 穿 `editorModeExtensions→livePreview→livePreviewPlugin→computeDecorations`；appearance.ts `hideReferenceMarks` Store(默认 true·prior behavior·零回归)；EditorPane 新 effect reconfigure modeCompartment（ViewPlugin 仅 doc/selection/viewport 重建·Store 变须 reconfigure）。

新增套件：`r224-e2e.mjs` **11/11**（默认 ON 隐 `**bold**`+hr widget 渲染·**真 Settings UI**[app:open-settings→settings-nav-editor→settings-hide-reference-marks-toggle] OFF→显 `**bold**`+hr widget 仍在[非 source mode]·持久化 reload 恢复·反向 toggle 回 ON 复隐）。**套件矩阵不回退**：**r106/r107/r108/r109 12·r134 24·r135 18·r137 13·r128 19 全绿（默认 true 零变·livePreview decoration 行为不退）**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（碰 editor/livePreview·底线①·纯 CM decoration 零 .md 写）→ 简化门 clean[穿参线 reactive 必需·3 reconfigure effect 相似非相同不可合并·门控 load-bearing] → 多维对抗 + data-safety deliverable·0 代码缺陷**（门控只控 hide() 空-replace·widget/样式 OFF 保渲染非 source mode·reactivity 经新 effect·appliedModeRef 不阻新 effect·默认 true no-op·纯 decoration 零写）。收尾 bump 版本三处 0.220。**桌面 probe N/A**（纯 CM decoration 渲染·WKWebView 与浏览器同·本特性零 file IO→MemoryVault↔FS adapter 差异无关·浏览器 E2E 等价）·**r18-diff 字节套件 N/A**（动 livePreview 编辑视图·非 markdown.ts 阅读视图·零 .md 写）。**新教训**：① native 设置名 online docs 查不到时 reference 截图（PNG）是 ground truth、胜过稀疏官方 docs；② 给 livePreview 这类散落决策核心文件加全局开关前 explorer 确证隐藏逻辑是否收口单一 helper（13 hide 全经一个 → 单一门控 bounded）；③ 设置→CM reactive 接线必经 Compartment.reconfigure（ViewPlugin 不随 Store 重建）。

### R223 套件回归（2026-06-25，选项2 补深次轮 · FootnotesPanel 内联编辑脚注文本[对齐 Obsidian 1.9 native「Footnotes view」「Click a footnote to edit its text」] · data-safety 写 .md·零新依赖 · 逻辑档[documents 写路径] · 简化门 clean · 多维对抗 + data-safety 全回归 deliverable·0 阻断 · 桌面 probe = vetted 写路径等价）

R223 = **选项2 即取序第 2 项**。**Step 0 双纠误**：① 面板早 R65 建·R213 增强（只读·跟随 lastActiveFile）；② explorer 据 reference/05[1.9 前快照] 初判「非 native」→ **WebSearch 纠误 Obsidian 1.9.0（2025-05）新增 native「Footnotes view」核心插件（可 view+edit）**。native 真缺口 = 内联编辑（Geode 只读·native「click to edit its text」）。**详见 ARCHITECTURE「Round 223 additions」**：core/metadata 抽 `extractFootnoteDefs(content,masked)`[parseNote 内联循环逐字节搬出·复用已算 masked·零行为变]+`parseFootnoteDefinitions(content)`[薄包装·FM offset-preserving blank+maskCodeRegions]；FootnotesPanel acquire DocumentHandle[R86 第二写者]·**解析 LIVE handle 文本**（非滞后 metadata cache→防 stale position 写损坏）·`^id` marker 跳转 + content click→`<input>` 编辑·提交 = re-parse live + `fresh[index]?.id===id` 守卫 + no-op 跳过 + `applyExternalEdits([{from,to,insert:\`[^${id}]: ${draft.trim()}\`.trimEnd()}])`。

新增套件：`r223-e2e.mjs` **13/13**（内联编辑 byte 精确[仅 def 行变·body/frontmatter/其它脚注逐字保留]·no-op commit revision 不 bump[守卫]·Escape 取消不写·空内容 trimEnd→`[^id]:`·marker navigate dispatch·笔记开在编辑器=两写者同步）。**套件矩阵不回退**：**r213 13/13[面板跟随 lastActiveFile + byte 保留]·r65 12/12[脚注索引·jump 断言改点 fn-marker·非真空]·r127 15/15[footnoteRefs]·r24 12/12[maskCodeRegions]**·typecheck 0（全 src）·生产构建成功·cargo check 通过。**分档=逻辑档（data-safety 红线·写 .md 字节·碰 documents 写路径）→ 简化门 clean[extractFootnoteDefs 两调用点·FootnoteEdit hooks 约束必需组件·re-validate load-bearing] → 多维对抗 + data-safety 全回归 deliverable·0 阻断**（**字节损坏族 R192/R197/R216 逐点证伪**：EOF 无尾换行/多行 continuation 在 `to` 外不动/code-fence 经 maskCodeRegions 排除/frontmatter offset-preserving blank/含 `]:`·wikilink·inline-code/空内容全字节正确；两写者经 R86 vetted·切文件 setEditing(null)+release 不写错文件·handle 生命周期镜像 FilePropertiesPanel 无泄漏；index+id 守卫字节绝对安全·残留重复-id 重排边角可 undo 非损坏 minor defer）。评审揪 4 minor 全收尾修（版本三处 bump 0.219·r65 jump 断言改点 fn-marker·r65/r213 加 waitForSelector(fn-item)·As-built invariant ① 措辞校到 re-parse+index/id 机制）。**桌面 probe：write=R86/R213 vetted DocumentHandle→vault→Rust fs[已 FS-probe 证]·R223 新逻辑纯 JS·浏览器 byte 精确（MemoryVault 与 FS adapter 共享同一 DocumentHandle 写逻辑·仅 backend 异·backend 已证）→ 等价桌面保证**。**新教训**：① native 演进——reference 截图/G3 矩阵会滞后新版（Footnotes view 是 1.9.0 新核心插件·reference/05 漏）→ 核 native 有无须 WebSearch/WebFetch 当前官方；② 面板做 data-safety 写要解析 LIVE handle 文本而非滞后 cache·commit 再 re-parse 取新鲜位置。

### R222 套件回归（2026-06-25，选项2 补深首轮 · TagsPanel ↔ Obsidian native「Tags view」对齐三缺口[嵌套 树↔扁平 切换 + 全部展开/折叠 + Cmd/Ctrl-click 累积 `tag:` 过滤到搜索] · 纯读·零新依赖 · 逻辑档[新增导出契约 + 新控制流·但非 data-safety 红线] · 简化门 clean · 对抗评审 10 维 deliverable·0 confirmed · 桌面 probe N/A）

R222 = **选项2 即取序首项**（2026-06-25 用户拍板「新取用顺序」补深·R221 F2 末片不打断）。**Step 0 gate 实查纠误（R160 纪律）**：「独立 tag pane」其实 R41 早建全功能（右侧栏树形·R69 改名·R150 嵌套·R151 排序·`app:show-tags`=`tag-pane:open` 早 done）→ 改对照 native 补真缺口。**关键忠实度避坑**：WebFetch `obsidian.md/help/Plugins/Tags+view` 权威 + forum 实证「Search/Filter Box in Tag Pane」属 **Feature-archive 未实现**（filter box 是 Tags Overview/Tag Tactician 等 community 插件加的·**非 native**）→ **不加 filter box**（防造非 native 功能伤忠实·与造 phantom 命令同害）。**详见 ARCHITECTURE「Round 222 additions」**：workspace.ts `searchTagToggle` Store + `toggleSearchTag`（不改 requestSearch 签名/5 caller）；SearchPanel.tsx 纯函数 `toggleTagInQuery` + **StrictMode-safe 一次性 Store 消费**（`.get()` 读现值+先置 null·因 toggle 自反·双触发会 on→off 抵消=[[geode-oneshot-store-strictmode]]）；TagsPanel.tsx `buildFlatTags`[Set 去重]·displayMode[持久化 `geode.tagsDisplay`]·collapsiblePaths·openTag[修饰键分支]·renderTagButton[tree+flat 共享减法去重]。

新增套件：`r222-e2e.mjs` **24/24**（树默认/扁平切换·扁平去 phantom 父+全路径名·全展开折叠·Cmd-click 累积 `tag:solo tag:nest/alpha`·**单击只切一次[自反双触发防住]**·plain click 替换 `#tag`·display pref reload 持久化）。**套件矩阵不回退**：**r150 20/20[嵌套树]·r151 13/13[排序]**·typecheck 0（全 src）·生产构建成功（vite 4.46s）·cargo check 通过。**分档=逻辑档（新增导出 `toggleSearchTag`/`searchTagToggle`/`buildFlatTags`/`toggleTagInQuery` + 新控制流[display/修饰键/token 切换]·**但纯读·零 vault/documents/markdown 管线触碰→非 data-safety 红线·byte 套件 N/A**）→ 简化门 clean[fresh code-simplifier·无 ≥8 行重复/死代码/脚手架·两 comparator map 相似非相同→拒并] → 对抗评审 10 维 确认/证伪 → deliverable·0 confirmed**（StrictMode 自反双触发[最高危]手工推演两路径只切一次·toggleTagInQuery 自反幂等+嵌套 token 不破·buildFlatTags 无重 React key·修饰键不误触 plain/右键·collapsiblePaths 深度递归全覆盖·sort×display 正交·纯读底线①[renameTagAcrossVault 字节未动]·分层合规[ReactMouseEvent 别名不遮蔽 DOM MouseEvent]·i18n/图标真注册·testid 无重无遗漏）。**桌面 probe N/A（纯前端·只读 getTagMap()+UI state·零 vault/FS adapter/Rust/host·浏览器 E2E 全覆盖即等价桌面行为·precedent R220/R221）·data-safety byte 套件 N/A（零 .md 写/vault IO/markdown 管线）**。**新教训**：① 即取序/候选池项标「部分/未做」常已实现（tag pane 早 R41）→ Step 0 explorer 实查必经；② 补 native 缺口前 WebFetch 权威 + 查 forum Feature-archive 辨「community 加的 ≠ native」→ 不造非 native 功能。

### R221 套件回归（2026-06-25，F2 类型对齐末片 · `Command` editorCallback ctx 字字对齐 obsidian.d.ts[`MarkdownView`→`MarkdownView | MarkdownFileInfo`] + 新增 hover 链 5 类型 + `MarkdownView implements MarkdownFileInfo` · compat 自包含[唯一运行时改＝MarkdownView.hoverPopover 恒 null·零新依赖] · 逻辑档[改导出 Command 契约 + 5 新导出类型] · 简化门 删 1 处自相矛盾 stale 注释 · 对抗评审 7 维 deliverable·0 confirmed · 桌面 probe N/A）

R221 = **F2 末片**（用户 2026-06-25 拍板 F2 降级·明示 R221「不打断」跑完·R222 转选项2「设置/核心插件补深」）。**目标**：插件 `import { X } from "obsidian"` 对 Geode compat shim 编译一致（续 R220）。oracle = `.calibration/obsidian.d.ts`。**详见 ARCHITECTURE「Round 221 additions」**：新 `compat/obsidian/hover.ts`（`Point{x;y}` d.ts:5179 / `enum PopoverState{}` d.ts:5193 空枚举 / `HoverParent{hoverPopover:HoverPopover|null}` d.ts:3464 / `class HoverPopover extends Component` d.ts:3476·**惰性 shim**[Geode 无 hover-preview]）+ workspace.ts `MarkdownFileInfo extends HoverParent` d.ts:3954 + **MarkdownView `implements MarkdownFileInfo`**（既有 `View.app!`/`FileView.file`/`MarkdownView.editor` 3/4·补 `hoverPopover:HoverPopover|null=null` 字段=唯一运行时改）+ plugin.ts Command ctx widen（type-only·内部零破坏）+ barrel 5 导出。**关键洞察**：ctx widen 要真生效，compat MarkdownView 须**真 assignable 进** MarkdownFileInfo→故补 hoverPopover + implements（光 widen union 是装饰·annotated 用例仍 differ）。**保留 callback 返回 `unknown` 不随 d.ts 改 `any`**（CLAUDE.md 硬律·文档化偏离·变性证对插件编写零影响）。

新增套件：`r221-types.ts` + `tsconfig.r221.json`（**编译期 exit 0**：5 类型 import type/value 可解析 + editorCallback 接受 `ctx: MarkdownFileInfo` 注解 + **4 个 `@ts-expect-error` 全 bite**：HoverParent.hoverPopover 必填 / Point.y 必填 / ctx≠`any`[`_ctx:number` 错] / ctx 是 union 非 MarkdownView[`_ctx:MarkdownView` narrow 错·同 obsidian strictFunctionTypes 行为]·含 ambient global.d.ts 防 green-by-omission）+ `r221-e2e.mjs` **14/14**（**运行期** require('obsidian')：HoverPopover class+PopoverState enum 值导出存在·`new HoverPopover(...)` inert 不抛[hoverEl=DIV·instanceof Component]·compat addCommand editorCallback 注册[`r221-test:r221-ed`]+执行·ctx instanceof MarkdownView 且带 hoverPopover/editor/app[MarkdownFileInfo 实证]·replaceSelection 写穿+无 page error）。**套件矩阵不回退**：**r220 7/7[compat Editor 类型面]·r166 18/18[obsidian 插件加载·同 seed 路径]·r128 19/19[compat Editor 既有方法]**·typecheck 0（全 src）·`tsc -p tsconfig.r221.json` exit 0。**分档=逻辑档（改导出 Command 契约 + 5 新导出类型 + MarkdownView implements·虽近零运行时）→ 简化门 删 1 处自相矛盾 stale 注释[净 −2·MarkdownFileInfo jsdoc 误留「defer implements」与实际 implements 矛盾·fresh simplifier 揪删] → 对抗评审 7 维 确认/证伪 → deliverable·0 confirmed**（d.ts 字字核·MarkdownView 真 assignable 实证[View.app!/FileView.file/editor/hoverPopover 四面齐]·ctx widen 零内部 provider/caller 破坏[typecheck 0]·HoverPopover shim inert 无泄漏·`unknown` 偏离变性证安全·测非 green-by-omission）。**cargo N/A（零 Rust）·桌面 probe N/A（纯类型面+惰性 shim·typecheck/浏览器可验证）·data-safety byte 套件 N/A（零 .md 写/vault IO/markdown 管线）**。**新教训**：F2「ctx 类型 widen」单独不够——编译一致须让 compat 实现类**真 implements** 目标接口（补缺字段）·否则 annotated 用例仍 differ。

### R220 套件回归（2026-06-25，F2 类型对齐首片 · compat `Editor` 类型面字字对齐 obsidian.d.ts + 5 metadata cache 接口补 barrel 再导出 · 纯类型面[无运行时/data-safety 风险·零新依赖] · 逻辑档[editor-family + R128 契约修订] · 简化门 clean[跳过条件] · 对抗评审 deliverable·0 confirmed · 桌面 probe N/A）

R220 = 转 **F 系列「兼容深化」首片**（G 表面复刻 bounded 项 + 第八梯队 D-compat bounded 项均已枯竭·商业主轴=插件迁移）。**目标**：插件 `import type { X } from "obsidian"` 对 Geode compat shim 编译一致。oracle = 仓库内 `.calibration/obsidian.d.ts`（≈v1.13）。**详见 ARCHITECTURE「Round 220 additions」**：`compat/obsidian/editor.ts` 字字对齐 7 处（`EditorRange.to` `?`→必填 / 新 `EditorRangeOrCaret` / `EditorChange extends EditorRangeOrCaret` / `EditorTransaction` selection→EditorRangeOrCaret + selections? / `replaceSelection(,origin?)` / `setSelections(,main?)` / `getDoc(): this`）+ barrel `index.ts` 补 `EditorRangeOrCaret` & 5 metadata cache 接口（SectionCache/ListItemCache/FootnoteCache/FootnoteRefCache/FrontmatterLinkCache·Dataview 等 `import type` 依赖）。**v1 defer**：`selections`/`main` honor（行为面·caret-only 非 .md 写）、`processLines`（需写运行时=出纯类型范围·单独轮）。**R128 契约修订**：EditorRange/EditorTransaction 原冻结 R128，本轮字字对齐 d.ts·全仓 grep 证零内部构造点破坏 + typecheck 0。

新增套件：`r220-types.ts` + `tsconfig.r220.json`（**编译期**：插件 d.ts 形状用法对 Geode shim 编译·`npx tsc -p` exit 0=通过·`@ts-expect-error` 证 EditorRange.to 必填确实 bite[去掉则 exit 2]·含 ambient global.d.ts 防 green-by-omission）+ `r220-e2e.mjs` **7/7**（**运行期**：getDoc()===editor 身份 + getDoc().getValue + replaceSelection(text,origin) 2 参插入[origin 忽略] + setSelections(ranges,main) 2 参[main 忽略] + 1 参回归 + 无 page error）。**套件矩阵不回退**：**r128 19/19[compat Editor 既有方法]**·typecheck 0（全 src）·`tsc -p tsconfig.r220.json` exit 0。**分档=逻辑档（editor-family + R128 契约修订·虽纯类型面）→ 简化门 clean[跳过条件 36 行/2 文件] → 对抗评审 6 维 确认/证伪 → deliverable·0 confirmed**（字字 d.ts 对齐逐项核·R128 修订 grep 证零破坏·纯类型零运行时变·barrel 5 接口真存在无冲突·测试非空转·v1 defer 诚实记[caret-only 非数据丢失]）。**cargo N/A（零 Rust）·桌面 probe N/A（纯类型面·typecheck/浏览器可验证·compat Editor 无桌面特异行为）。data-safety byte 套件 N/A（零 .md 写路径改动）**。**reviewer 记 1 可选未来硬化（非缺陷）**：可加自动「Geode 类型 vs oracle d.ts 结构可赋值性」断言套件防未来漂移（本轮对齐精确·暂不需）。

### R219 套件回归（2026-06-25，G3 §8 · 表面复刻 G 系列 · backlink:toggle-backlinks-in-document[注册命令翻 R154 既有 showBacklinksInDocument 外观设置] · 机械档[非数据安全·复用 vetted setter·零新依赖] · 跳简化门[Step 3.4] · scoped review deliverable · 桌面 probe N/A + 矩阵据实纠误 ui-only 真·全清）

R219 = G3 矩阵 §8 末项 `ui-only`「在文档中显示反链（开关）」补为命令（`backlink:toggle-backlinks-in-document`）。**web 实证**：Obsidian 命令「Backlinks: Toggle backlinks in document」翻「Backlink in document」设置（笔记底部链接提及）；并确认 backlinks 核心仅 3 命令（open[Show]/open-backlinks[R211]/toggle-in-document[R219]）→ §8 line 212 `backlink:open-in-new-tab` 为 phantom。**详见 ARCHITECTURE「Round 219 additions」**：1 命令注册复用 R154 `showBacklinksInDocument` Store+setter（镜像 R185/R195 toggle 兄弟）+ 1 i18n 键 en/zh。**矩阵据实纠误（ui-only 真·全清）**：§8 backlinks-in-document ui-only→done；§8 backlink:open-in-new-tab partial→oos[phantom]；§1 copy-url + §6 edit-title/copy-path/duplicate/move + §7 new-folder 共 6 项经 grep 实证 R183/R184 早注册命令、矩阵 status 列当时漏翻 → ui-only→done。**G3 矩阵 ui-only 计数 6→0**。

新增套件：`r219-e2e.mjs` **8/8**（A 命令注册 + i18n 名「Backlinks: Toggle backlinks in document」+ 无键 · B 执行翻转 showBacklinksInDocument 设置 OFF→ON→OFF[localStorage geode.backlinksInDocument 实证] · C 兄弟 toggle 不受影响）。**套件矩阵不回退**：**r185 19/19[toggle 命令组]·r195 11/11·r217 8/8**·typecheck 0。**分档=机械档**（diff src 12 行/3 文件·1 命令注册复用 R154 vetted setter[callback 仅 `!store.get()` 无新控制流]·1 i18n·未碰数据安全面[appearance Store 非 .md 写]·无新依赖·非 Rust）→ **跳简化门（Step 3.4）+ scoped review**（命令 id 唯一·i18n 键 en/zh 真实存在·store+setter 引用正确·无默认键冲突·矩阵据实纠误 facts 核实）→ **deliverable·0 confirmed**。**cargo N/A（零 Rust 改动）·桌面 probe N/A（纯 appearance Store toggle·无 fs/host 面·浏览器可验证）**。

R218 = G3 矩阵 §6 两项 missing「在访达中显示」「使用默认应用打开」补全（§6 done 1→3·missing 4→2）。**硬边界#5（新运行时依赖）经用户 2026-06-25 显式授权解锁，仅对 Tauri 官方 `tauri-plugin-opener`**（用途上限＝库内文件 reveal/open·不含 `open_url`/任意 URL·不得借此引入其它依赖·其余四条硬边界不动）。**web 实证**：Obsidian 命令面板名「Files: Show in system explorer」「Files: Open in default app」（macOS 右键显「Reveal in Finder」·命令身份同名）→ Geode 取跨平台中性命令名免平台分支。**详见 ARCHITECTURE「Round 218 additions」**：新 `core/reveal.ts` isTauri 门控 IPC（浏览器 no-op）+ 2 薄 Rust 命令 `reveal_in_system`/`open_in_default_app`（`safe_join(vault,rel)` 堵 `..` 逃逸后调 `app.opener().reveal_item_in_dir`/`open_path`·前端不碰绝对路径）+ App.tsx 2 命令（isTauri+active-file 双门控·fire-and-forget catch·无 toast）+ Explorer 右键 2 项（isTauri 隐藏）+ __geodeReveal probe。**capabilities 不改**（app 自有命令 + Rust-side opener API 皆不受权限系统约束·reviewer 读 plugin 源码证实）。

新增套件：`r218-e2e.mjs` **15/15**（A 2 命令注册 + i18n 名 + 无键 · B available() 浏览器 gating false[有 active file 仍 false·证 isTauri 门] · C core/reveal 浏览器 no-op[resolve 不抛] · D 右键菜单项浏览器隐藏[copy-path 在=sanity]）+ `r218-probe.mjs` **桌面 5/5**（真 WKWebView 二进制：vault 根解析 + __geodeReveal pre-React + **`..` traversal 被 safe_join 拒于 opener 之前=confinement** + 真实库内文件 reveal→Ok[opener Rust API 无需 capability·实测确认] + 无错）。**套件矩阵不回退**：**r179 10/10[右键 copy-path/url]·r183 11/11[copy 命令]·r184 22/22[file-op 命令]·r215 10/10·r217 8/8**·typecheck 0/cargo check/**release 构建**。**⭐ 分档逻辑档（新依赖 + 新 Rust 命令 + 新 core 模块控制流·虽只读 OS 动作非 .md 写）→ 简化门 clean（薄包装 + 镜像既有 copy-path/url 兄弟·dup 低于 8 行阈）→ 对抗评审 7 维 确认/证伪 → deliverable·0 confirmed**（最深挖 capability 维：reviewer 读 `tauri-plugin-opener-2.5.4` 源码确认 ACL 仅在 command/IPC 层、Rust API 直调无门→无需 `opener:default`·与既有 15+ vault_* app 命令同 baseline）。**3 informational 记不修**：① 文件夹无 reveal/open（契约定 file 节点·Obsidian 文件夹亦有·v1.1 fidelity gap）；② 非 UTF-8 路径 open_path 优雅失败（plugin-API 约束·fail-safe）；③ reveal/open 删文件竞态→swallow Err。

### R217 套件回归（2026-06-25，G3 §0 · 表面复刻 G 系列 · app:show-debug-info[收集版本/平台/语言/插件→剪贴板+toast] · 新 core/debugInfo.ts 纯 builder · 逻辑档[非数据安全·只读+clipboard] · 聚焦 reviewer deliverable·0 confirmed · 桌面 probe N/A）

R217 = G3 矩阵 §0 missing「显示调试信息」(`app:show-debug-info`) 补全。**web 实证**：Obsidian「Show debug info」把 SYSTEM INFO（版本/OS/主题/插件数+列表）拷剪贴板供 bug 报告。Geode 取忠实子集（版本/平台/语言/插件 installed+enabled+列表）·略 theme（compat 层·Geode 无 light/dark base-theme）。**详见 ARCHITECTURE「Round 217 additions」**：新 `core/debugInfo.ts` 纯 `buildDebugInfo`（命令注入 live 值·enabled-only 编号列表）+ 命令复用 R183 showCommandNotice toast + clipboard + **export 既有 APP_VERSION**（App.tsx 复用·避第 4 处版本硬编码·三处流程不变）+ __geodeDebugInfo probe。

新增套件：`r217-e2e.mjs` **8/8**（A 纯 buildDebugInfo 精确格式 + **enabled-only 编号** · B 注册无键 · C 执行→剪贴板含调试块[版本/插件·含 r217 probe 插件] + command-notice toast）。**套件矩阵不回退**：**r183 11/11[toast/copy-path]·r214 10/10·r195 11/11·r81 14/14**·typecheck 0/cargo/生产构建。**桌面 probe N/A 浏览器可验证 + pure-fn probe**。**分档逻辑档（builder 含 filter+map）但非数据安全面（只读+clipboard）→ 聚焦 reviewer（非满跑 Workflow）**：7 维 确认/证伪 → **0 confirmed·deliverable**·1 nit 记（clipboard fire-and-forget 后无条件 toast「已复制」失败时误导·但字字沿用 R183 copy-path/copy-url 既有约定·secure context·无数据安全后果→不单独改）。

### R216 套件回归（2026-06-25，G3 §12 收尾 · 表面复刻 G 系列 · editor:move-heading[移动光标处章节到新笔记] · 新 core/moveHeading.ts headingSectionAt + 复用 R44 extract 写路径 · data-safety 逻辑档[byte 写两侧]·**Ultracode 3-lens+skeptic 对抗评审 初判 needs-fixes→修后 deliverable·1 major[frontmatter 掏空源·底线①]修**·桌面 probe N/A）

R216 = G3 矩阵 §12 末项 missing「移动当前章节」(`note-composer:move-heading`) 补全·**note-composer 组整组补完**。Obsidian「Move current heading to…」移光标处章节到另一笔记、留链接。Geode 既有 `editor:extract-selection`(R44) 已是 auto-create 新笔记语义，move-heading 复用同机制·仅 range 不同。**详见 ARCHITECTURE「Round 216 additions」**：新 `core/moveHeading.ts` 纯 `headingSectionAt`（maskCodeRegions + **parseFrontmatter** blank·扫 ATX 标题·section end=下个 level≤本级·尾部 trim）+ 重构 R44 抽 `extractRange`（create-before-edit + stale-guard 复用·2 调用点）+ 注册 editor:move-heading。

新增套件：`r216-e2e.mjs` **17/17**（A 纯 headingSection：中段/末段/嵌套/光标在首标题前→null/**fenced `## Fake` 非标题** · B 端到端移动→新笔记 + **源 byte-exact** · C 无章节 no-op · **D frontmatter 安全：`# ` YAML 注释非标题→不掏空源 + frontmatter 下真实移动保 frontmatter byte-intact**）。**套件矩阵不回退**：**r44 25/25[extract 重构不变]·r204 23/23·r192 28/28·r197 28/28·r33 37/37**·typecheck 0/cargo/生产构建。**桌面 probe N/A 浏览器可验证 + pure-fn probe**（headingSection via __geodeComposer·写路径 R44-vetted）。**⭐ Ultracode 3-lens 对抗评审（data-safety-bytes/adversarial-markdown/correctness-fidelity + skeptic）→ 初判 needs-fixes → 修后 deliverable·1 major 修·4 minor/nit·1 refuted**：**1 major（底线①）**＝headingSectionAt 漏 blank frontmatter → column-0 `# ` YAML 注释当标题 → move splice 跨闭合 `---` 掏空源笔记（adversarial-markdown lens 复现）→ 修=扫描前 parseFrontmatter offset-preserving blank。**根因＝heading 扫描没对齐阅读视图管线**（parseNote/resolveSubpath 都先 blank frontmatter）。1 minor 修（cmd 去尾「…」无 picker）+ 3 记（auto-create 无 picker fidelity gap·setext 不识别·静默 no-op）+ 1 refuted（空标题当 body 安全）。**本轮教训（新记忆 [[geode-heading-scan-blank-frontmatter]]）**：Geode 任何 heading/section 扫描必须**先 blank frontmatter（不只 code regions）**·否则 col-0 `# ` YAML 注释=假标题→byte corruption。

### R215 套件回归（2026-06-25，G3 §7 收尾 · 表面复刻 G 系列 · file-explorer:new-file-in-new-pane[⌘⇧N 在右侧新建笔记] · 复用 vetted splitActivePane + app:new-note create · data-safety 逻辑档[vault create]·**Ultracode 2-lens+skeptic 对抗评审 deliverable·0 crit/major·3 nit accept-as-is**·桌面 probe N/A）

R215 = G3 矩阵 §7 missing「在右侧新建笔记」(`file-explorer:new-file-in-new-pane`·默认键 ⌘⇧N) 补全。**web 实证**：⌘⇧N 是 Obsidian「create a note in a new pane」真默认键（非 phantom）。**详见 ARCHITECTURE「Round 215 additions」**：复用 app:new-note 的 vault.uniquePath+create + splitActivePane("row")（R202 split-right 先例）·`openFile(path, paneId?{paneId}:{newTab:true})`·split 返 null（singleton 活动）→ 回退新标签页。当前标签页变体据实纠误（app:new-note 即此语义）·**§7 整组补完**。

新增套件：`r215-e2e.mjs` **10/10**（A 注册 + ⌘⇧N · B markdown tab → 新 split pane[新空 Untitled 笔记 active·Base.md 另 pane 保留] · **C 边界：graph singleton 活动 → split null → 回退新标签页·命令不丢·不崩**）。**套件矩阵不回退**：**r81 14/14[tabs/split]·r202 12/12·r207 32/32[split]·r36 47/47·r212 17/17**·typecheck 0/cargo/生产构建。**桌面 probe N/A 浏览器可验证**（复用 vetted vault.create + splitActivePane·新空文件不碰既有字节）。**⭐ Ultracode 2-lens 对抗评审（data-safety/correctness-fidelity + skeptic）→ deliverable·0 crit/major·3 nit accept**：① 快速双击 ⌘⇧N 第二次 create 抛未捕获（严格 no-op·throw 在 split/open 前·无数据丢失·与 vetted app:new-note 同模式→不单独加 .catch 避免不对称）；② attachment 活动时新 pane 留 dup tab（cosmetic·罕见）；③ singleton 回退新标签页非新 pane（intentional·无 split-singleton 原语）。data-safety lens 证仅创建新空文件·源文件零变。

### R214 套件回归（2026-06-25，G3 §10 收尾 · 表面复刻 G 系列 · app:show-file-properties 命令揭示 R86 FilePropertiesPanel · 机械档[命令注册镜像 5 兄弟·复用 vetted setRightPanel·无写] · scoped review · 桌面 probe N/A）

R214 = G3 矩阵 §10 唯一 partial「显示当前笔记的属性列表」(`file-properties:open`) 收尾。**web 实证**：Obsidian Properties 核心插件有两命令——「Show file properties」(当前笔记) + 「Show all properties」(全库)。Geode 有 `app:show-all-properties` 但缺前者，尽管 R86 早已建 FilePropertiesPanel（右侧栏 fileproperties tab·仅 right-tab 可达·无命令）。**详见 ARCHITECTURE「Round 214 additions」**：加 `app:show-file-properties`（name "Show file properties"·callback setRightPanel("fileproperties")·逐字镜像 app:show-all-properties·无默认键）+ i18n 键 cmd.showFileProperties（en/zh）。矩阵旧注「无当前笔记属性面板」stale（R86 已有）→ 真实 gap = 缺命令。

新增套件：`r214-e2e.mjs` **10/10**（A 命令注册[name 解析为 "Properties view: Show file properties"·无默认键] · B 执行揭示 FilePropertiesPanel[right-tab-fileproperties is-active·显当前笔记 property-row-count] · C 与 app:show-all-properties 互斥切换[file↔all 来回]）。**套件矩阵不回退**：**r86 11/11[fileproperties 第二写者]·r213 13/13[aux 面板 lastActiveFile]·r211 12/12·r212 17/17**·typecheck 0/cargo/生产构建。**桌面 probe N/A 浏览器可验证**（纯命令注册揭示侧栏面板·复用 vetted setRightPanel·同 R181 app:show-* 兄弟无 Rust/fs）。**分档机械档（命令注册镜像兄弟·无新逻辑·未碰数据安全面）→ scoped review**（命令 id 唯一 · i18n 键 en+zh 真实存在 · callback panel 名 "fileproperties" 与 right-tab 对齐 · typecheck 验 RightPanel 类型合法）·**简化门机械档跳过**。**教训续**：做矩阵 partial 前 web 实证真 Obsidian 命令（[[geode-verify-obsidian-command-real]]）——本轮证 file-properties:open 是真命令（非 theme:switch 式 phantom）·且 Geode 侧 stale 注（R86 面板已存在·仅缺命令）。

### R213 套件回归（2026-06-25，G3 §8 收尾 · 表面复刻 G 系列 · FootnotesPanel + FilePropertiesPanel 跟随 lastActiveFile + 修 R211 BacklinksPanel unlinked 扫描卡死 · data-safety 逻辑档[FilePropertiesPanel 可写第二写者]·**Ultracode 2-lens+skeptic 对抗评审 deliverable·0 crit/major·1 confirmed minor[R211 遗留缺陷·本轮主动修]**·桌面 probe N/A）

R213 = 收尾 R212 评审 deferred minor。R211/R212 给 backlinks/outgoing/outline 加了 lastActiveFile 回退（非 markdown active tab 跟随最后活动 markdown），但 footnotes/properties 仍 `: null`→同侧栏 5 面板不对称。**详见 ARCHITECTURE「Round 213 additions」**：两 Panel activePath 改 `: lastActive`（镜像 R212 OutlinePanel）。FootnotesPanel 纯读；FilePropertiesPanel 可写第二写者（DocumentHandle·激活「非 markdown tab 编辑 lastActiveFile 属性」写路径·机制=vetted R86 不变·仅文件选择变）。

新增套件：`r213-e2e.mjs` **13/13**（A footnotes 跟随 lastActive · B properties 跟随 · **C data-safety：graph tab 上编辑属性写对 lastActiveFile[count→42·脚注+正文字节保真·active tab 不切]** · D 精度[markdown active 优先于 lastActive·re-target Doc2] · **E backlinks unlinked-mentions 扫描完成不卡 Searching**）。**套件矩阵不回退**：**r65 12/12[footnotes]·r86 11/11[fileproperties·第二写者]·r82 27/27[backlinks]·r62 14/14·r211 12/12·r212 17/17**·typecheck 0/cargo/生产构建。**桌面 probe N/A 浏览器可验证**（FilePropertiesPanel 写机制 R86-vetted 不变·仅前端目标文件选择变·data-safety 字节验证测 C 已在浏览器 MemoryVaultAdapter 跑）。**⭐ Ultracode 2-lens 对抗评审（data-safety-write-path/correctness-fidelity + skeptic）→ deliverable·0 crit/major·1 confirmed minor**：data-safety lens 证 FilePropertiesPanel 写机制 = R86 既有 DocumentHandle（acquire/release·applyExternalEdits·acquire 拒→fp-empty）·仅选哪个文件变 → 非缺陷。**唯一 confirmed（原判 out-of-scope defer）→ 本轮主动修**：BacklinksPanel unlinked-mentions 异步 stale-guard 原 `: null` 而 render 已 `: lastActive`（R211）→ 非 markdown tab 跟随 lastActive 时守卫早 return → **永久卡「Searching…」**（R211 遗留）→ 修=guard 镜像 render 回退。**本轮教训**：给面板 render 加 lastActiveFile 回退时，该面板**所有读 activePath 的异步副作用/stale-guard 必须同步镜像同一回退**（render 跟随而异步不跟随→卡死/数据缺失）。

### R212 套件回归（2026-06-25，G3 §8「出链+大纲主区视图」续片 · 表面复刻 G 系列 · 2 命令 outgoing-links:open-outgoing-links + outline:open-outline · 复用 R211 主区视图 host · `isFilelessSingletonView` 守卫统一序列化触点[消 R211 漏判类] · data-safety 逻辑档[workspace 序列化·无 .md 写]·**Ultracode 3-lens+skeptic 对抗评审 deliverable·0 crit/major·2 confirmed-low[reopenClosedTab nit 主动修+补测·footnotes/properties 回退 minor defer]** · 桌面 probe r212-probe 8/8）

R212 = 续 R211 收割 §8 余两个 `partial`「出链/大纲在标签页中显示」，**完全照搬 R211 主区视图 host 模式**（viewType singleton·镜像 openBacklinks·跟随 lastActiveFile）。**详见 ARCHITECTURE「Round 212 additions」**：核心重构 = `isFilelessSingletonView(vt)` 类型守卫（graph|backlinks|outgoinglinks|outline）+ `openSingletonView` 收 4 singleton-open 为一行委托·**把全部序列化触点（sanitizeTab 拒收门+重派生·duplicate·split·评审后含 reopenClosedTab）路由经 helper** = 根除 R211「只加拒收门漏重派生」漏判类（加视图只更新 helper 即覆盖各站点）。types.ts viewType+2；两 Panel activePath 回退 lastActiveFile；App.tsx render+title+icon+split+命令；i18n+css。

新增套件：`r212-e2e.mjs` **17/17**（A 注册无默认键×2 + B/C 各命令开主区 tab[跟随 lastActiveFile 显 Spoke 出链/Heading 大纲] + D singleton×2 + **E 真 persist→reload→restore 全 4 singleton viewType[graph/backlinks/outgoinglinks/outline 恢复为本型·非幻影 markdown]** + F openSingletonView 重构未破 graph + **G reopen 经 helper 恢复为本型[补 skeptic 指出的覆盖缺口]**）+ `r212-probe.mjs` **8/8**（桌面裸二进制·直调 workspace.openOutgoingLinks/openOutline 绕命令注册时序·验真 WKWebView：两 viewType 开+singleton+markdown 仍开·cmd_count_diag=5 证 plugin onload 早于 React 命令注册→命令注册经浏览器 e2e 覆盖）。**套件矩阵不回退**：**r62-e2e 14/14[出链侧栏·空态据新 lastActiveFile 回退行为校准·非回归]·r211-e2e 12/12·r81 14/14·r82 27/27·r36 47/47**·typecheck 0/cargo/生产构建。**⭐ Ultracode 3-lens 对抗评审（serialization-completeness/refactor-fidelity/regression-blast-radius 并行 + skeptic 综合）→ deliverable·0 crit/major**：① nit reopenClosedTab 唯一未走 helper 触点[当前 4 类型对·未来第 5 个会静默 no-op=R211 漏判类挪 reopen]→**主动修[4 分支→helper 路由·net −10 行]+补 r212-e2e G**；② minor FootnotesPanel/FilePropertiesPanel 缺 lastActiveFile 回退与 3 兄弟面板不对称[非回归·出范围]→**defer 候选池**（尤 FilePropertiesPanel·Obsidian Properties 跟随活动文件）。**本轮教训**：序列化枚举的「单一真相源」触点清单要含 **reopenClosedTab**（不止 sanitizeTab 两处）——[[geode-serialized-enum-multiple-sites]] 的延伸。

### R211 套件回归（2026-06-25，G3 §8「反链主区视图」首片 · 表面复刻 G 系列 · 1 命令 backlink:open-backlinks · 把反链面板开成主工作区 tab[viewType "backlinks"·镜像 graph·跟随 lastActiveFile] · data-safety 逻辑档[workspace 序列化·无 .md 写]·**Ultracode 2-lens 对抗评审 初判 needs-fixes→修后 deliverable·1 critical[sanitizeTab viewType 重派生漏]+2 major 全修** · 桌面 probe N/A 浏览器可验证）

R211 = 按 R182 矩阵收割 §8 `partial`「反向链接在标签页中显示」（Obsidian「Open backlinks for the current file」·把反链面板开成**主工作区 tab**·非仅侧栏），**主区视图 host 立项首片**（bounded 矩阵项近枯竭·explorer 评 §8 backlinks 最 bounded+忠实+双端可验证）。**详见 ARCHITECTURE「Round 211 additions」**：复用 graph 主区先例（viewType "graph" 已 filePath:null·主区 singleton·可序列化）+ 反链需「当前文件」→ 复用 lastActiveFile（emitActiveFile 仅 active file 非空时更新→保留最后 markdown 文件）。workspace.ts viewType+"backlinks" + openBacklinks(镜像 openGraph) + ClosedTab/duplicate 守卫/reopenClosedTab/sanitizeTab[拒收门+重派生]；App.tsx 主区 render+title+icon"link"+split-disabled+命令；BacklinksPanel activePath 非 markdown active tab 回退 lastActiveFile；i18n。

新增套件：`r211-e2e.mjs` **12/12**（A 注册无默认键 + B 命令开主区 backlinks tab[viewType "backlinks"·`.main-backlinks-view .backlinks-panel` 渲染·跟随 lastActiveFile 显源笔记反链] + C singleton[二次调用仍 1 tab] + backlinks tab active 时 lastActiveFile 回退仍显反链 + **D 真 persist→reload→restore round-trip[写 localStorage geode.workspace.v1→reload→sanitizeTab→断言恢复为 backlinks view 非幻影 markdown editor]**）。**套件矩阵不回退**：**r81-e2e 14/14[tabs]·r82-e2e 27/27[backlinks 侧栏·activePath 改未破]·r36-e2e 47/47[tab 键盘/reopenClosedTab]**·typecheck 0/cargo check/生产构建。**桌面 probe N/A 浏览器可验证**（openBacklinks + viewType 序列化 + 主区 render + lastActiveFile 跟随 browser-E2E 兜）。**分档逻辑档（workspace 序列化·主区视图 host·view-only 无 .md 写零 vault IO）→ data-safety skill 已跑**：扩 viewType 冻结契约·序列化 round-trip 须全·BacklinksPanel 纯前端视图不写文档。**⭐ Ultracode 2-lens 对抗评审（serialization-workspace/correctness-fidelity 并行 + skeptic synthesis）→ 初判 needs-fixes → 修后 deliverable·1 critical+2 major 全修·4 refuted**：serialization lens **穷举全部 `viewType === "graph"` touch-point 查 backlinks 对等**揪 1 漏。**1 critical 修（序列化完整性·正是本 lens 存在的意义）**：`sanitizeTab` 有**两处** viewType 处理——拒收门[1371·我已加 backlinks] + **viewType 重派生[1384·漏]**（原仅 `graph ? "graph" : ...`·持久化 backlinks tab[filePath null] 非 graph 且 filePath null → 重派生为 "markdown" → 重启变幻影空 editor·graph 活 backlinks 死）→ 修=重派生保 graph **AND** backlinks。**2 major 修**：(a) r211「round-trips」断言原 `JSON.parse(JSON.stringify(state))` 假阳性[只验字段·从不调 sanitizeTab→认证坏路径为绿]→改**真 persist→reload→restore**[此测在 critical 修前会红]；(b) `.main-backlinks-view` 无 CSS·wrapper 缺 flex:1/height → `.backlinks-panel{height:100%}` 对无定高父解析为内容高·`.bl-scroll` 无界 viewport 不滚·长反链列表被 `.main-content overflow:hidden` 裁剪无滚动条[graph/editor 是直接 flex child 填高]→修 `.main-backlinks-view{flex:1;min-height:0;padding:0 8px}`。**4 refuted**：侧栏 lastActiveFile 回退[有意·更忠实·r82 不退·delete 清 null→空]/lastActiveFile 指已关 tab 文件[数据仍对·同 local-graph 先例]/singleton+follow diverge[v1·同 graph 先例]/e2e 缺口[两要害已成 confirmed]。**方法论根因（新记忆 [[geode-serialized-enum-multiple-sites]]）**：**扩展持久化枚举（viewType）有多处处理点·须穷举**（拒收门 sanitizeTab[1371] AND viewType 重派生[1384]·漏一即静默降级 tab 布局·graph 两处都特判故活·backlinks 只加一处故死）；**测序列化 round-trip 必走真 persist→reload→restore 路径·非 JSON clone**（clone 假阳性认证坏路径为绿）。**v1 偏差/defer**：outgoing-links/outline 主区变体（复用 R211 host 基建·follow-on）；pinned 模式（仅 follow-active）；主区 backlinks 不可 dup/split（singleton·同 graph）；侧栏反链在非 markdown active tab 改显 lastActiveFile（更忠实 Obsidian）。

### R210 套件回归（2026-06-25，G3 §10「折叠/展开当前笔记属性」· 表面复刻 G 系列 · 1 命令 editor:toggle-fold-properties · 折叠属性面板·纯视图态[per-path·不改文档] · data-safety 逻辑档[editor·CM heightmap·无写]·**Ultracode 2-lens 对抗评审 deliverable·0 crit/major·2 minor[1 修 1 记]+1 nit 修·§10 整组补完 + 据实纠误 §5/§14** · 桌面 probe N/A 浏览器可验证）

R210 = 按 R182 矩阵收割 §10 末项 `missing`「折叠/展开当前笔记属性」（Obsidian 内置「toggle properties folding」·web 实证真命令），**§10 整组补完**。**做前先 web 实证避 phantom**：原拟 §5「更换主题 theme:switch」→ 实证 **Obsidian 核心无独立主题切换命令**（仅设置下拉·命令面板切换是社区插件特性）→ phantom·不做·改 matrix done-as-Obsidian；§14「搜索默认键」实查 R185 已绑 Mod+Shift+F·stale partial→done。**详见 ARCHITECTURE「Round 210 additions」**：新 `features/editor/foldProperties.ts`（`foldedPropertiesPaths` Store<ReadonlySet<path>>·in-memory per-path + togglePropertiesFold）+ PropertiesPanel chevron[is-collapsed CSS] + useLayoutEffect(onLayoutChange) + EditorPane live 传 `useCallback(()=>viewRef.requestMeasure(),[])`[CM heightmap 重测]·阅读视图不传 + App.tsx 命令[门控笔记有属性块] + i18n。

新增套件：`r210-e2e.mjs` **19/19**（A 注册无默认键 + B 命令折叠/展开[`.is-collapsed` class + `.property-row` display:none] + **底线① 文档字节 fold 前后逐字一致[零 .md 写]** + C chevron 点击 + aria-expanded + D **per-note 态[折 A 不折 B·返 A 仍折·path-keyed]** + E **命令门控[有属性可用/无属性不可用·防幻影 fold 态]**）。**套件矩阵不回退**：**属性套件 r30 25/25·r126 11/11·r194 12/12·r196 15/15[chevron 上置未破属性编辑]·r33 37/37[EditorPane onLayoutChange 加性未破格式引擎]**·typecheck 0/cargo check/生产构建。**桌面 probe N/A 浏览器可验证**（折叠纯前端·Store + DOM class + requestMeasure browser-E2E 兜）。**分档逻辑档（editor 管线·CM heightmap）但纯视图态·零 .md 写·零 vault IO → data-safety skill 已跑**：折叠不 mutate 文档·data-safety 不在丢数据意义受威胁。**⭐ Ultracode 2-lens 对抗评审（datasafety-cm/correctness-fidelity 并行 + skeptic synthesis）→ verdict=deliverable·0 crit/major·2 minor[1 修 1 记]+1 nit 修·7 refuted**：data-safety lens **证折叠零文档写**（togglePropertiesFold 仅 copy in-memory Set + Store.set·chevron/命令两触发皆只调它·collapsed 渲染仅改 className+label·rows 仍 read-only parseProperties·无 applyEdit/dispatch 路径）；CM lens **证 heightmap 重测时机正确**（useLayoutEffect 在 React commit `.is-collapsed`[display:none 瞬时]后 paint 前跑·requestMeasure 排下帧 layout flush 后读塌缩高度·null viewRef optional-chain no-op·StrictMode 双触发幂等不双 toggle）。**1 minor 修（#1·真 UX bug）**：命令 available() 原仅判 active editor·非「笔记有属性块」→ 无 frontmatter 笔记 toggle 存幻影 fold 态·后续加属性面板 mount 即 `.is-collapsed` 隐藏新行 + 延后 .focus() 落 display:none input → 修=available()/callback 加 `parseProperties(doc)!==null` 门控（对齐面板渲染门）·e2e +「无属性笔记命令不可用」断言。**1 nit 修（#3）**：onLayoutChange inline arrow 每渲染重建 → 布局 effect 每次 portaled 重渲染都重测[无害·CM 合帧·但多余]→ 修=useCallback 稳定化·只 fold 翻转时重测。**1 minor 记不修（#2）**：纯阅读视图命令灰显[getActiveFileEditorView 返 null·CM view 已销毁·同 R23 全编辑器命令惯例·chevron 仍折叠]。**7 refuted**：折叠改文档[零写路径]/heightmap 时机错[时机正确]/Set 不清理[v1 in-memory·零数据影响]/per-note 跨笔记泄漏[path-keyed 稳健]/Set 无界增长[session-bounded]/CSS·aria·always-chevron 错[正确·chevron 有意 discoverability]/e2e 覆盖缺口[17→19 已覆盖核心]。**方法论根因（新通则·已记 HANDOFF）**：**做矩阵 partial/missing 前先 web 实证是否真 Obsidian 命令·避 phantom**（theme:switch「语义待定」实为 Obsidian 无此命令→据实纠误非新建·避免发明非 Obsidian 命令损忠实度；§10 folder-properties 实证真命令→做）。**v1 偏差/defer**：fold 态 in-memory（restart resets·Obsidian workspace 持久化 follow-on）；折叠 affordance = always-visible chevron（Obsidian hover gutter·近似）；纯阅读视图命令灰显（chevron 仍折叠）。

### R209 套件回归（2026-06-25，G3 §2「插入附件」· 表面复刻 G 系列 · 1 命令 editor:attach-file · `<input type=file>`→拷进 vault→插 `![[]]` · 复用 R17 ingestFiles/importAttachment · data-safety 逻辑档[vault 二进制写·异步 picker]·**Ultracode 2-lens 对抗评审 deliverable·1 minor 修[无扩展名→.png]·§2 整组补完** · 桌面 probe N/A 浏览器可验证[filechooser]）

R209 = 按 R182 矩阵收割 §2 末项 `missing`「插入附件」（Obsidian `editor:attach-file`「Insert attachment」），**§2 编辑器命令组整组补完**。**关键：用 `<input type=file>` 而非 Tauri 原生对话框**（原生回 vault 外绝对路径·无命令能读=safe_join 限 + plugin-fs 未装硬边界#5；`<input>` 双端回 `File`·和 paste/drop 同种→100% 复用 R17 vetted 摄取）。**详见 ARCHITECTURE「Round 209 additions」**：新 `features/editor/attachCommand.ts`（隐藏 `<input>`→change：**重取 getActive() 新鲜 view+path**[picker 长异步]→ ingestFiles）+ `attachments.ts` ingestFiles 改 export（窄改）+ App.tsx mount + i18n `cmd.attachFile` en/zh。任意文件类型·no-overwrite（uniquePath+大小写不敏感）·cancel 移孤儿 input。

新增套件：`r209-e2e.mjs` **13/13**（A 注册无默认键[name=Insert attachment] + C 全流程[Playwright **filechooser** 驱真命令 pick pic.png[1,2,3,4]→`![[pic.png]]` 插入 + `vault.readBinary("pic.png")`===[1,2,3,4] + 瞬态 input 移除] + D **no-overwrite**[同名二次→`![[pic 1.png]]`·原 pic.png [1,2,3,4] 不变·新 pic 1.png [9,9,9]] + E **extensionless 保留**[Makefile→`![[Makefile]]` 非 .png + vault 无扩展名文件 [7,7]]）。**套件矩阵不回退**：**r67-e2e 9/9（drop/paste 摄取·importAttachment 改未破）**·typecheck 0/cargo check/生产构建。**桌面 probe N/A 浏览器可验证**（filechooser 拦 `<input>` 驱真命令端到端·MemoryVault 二进制写回；原生对话框不可自动化是所有桌面 picker 共性·桌面手测）。**分档逻辑档（data-safety·vault 二进制写 + editor 插入·异步 picker 新时序）→ data-safety skill 已跑**：经 ingestFiles→importAttachment→`vault.createBinary`（create_new 拒覆盖）·复用 R17 vetted 全护栏（uniquePath + 大小写不敏感 no-overwrite·doc-identity stale 退化光标插入·isConnected）·picker 后重取新鲜 view+path（同一 getActive() 快照·view/path 一致）·零新写机制。**⭐ Ultracode 2-lens 对抗评审（datasafety-timing/correctness-wiring 并行 + skeptic synthesis）→ verdict=deliverable·1 minor 修·6 refuted**：**1 minor 修（fidelity·本轮 any-file picker 新暴露 R17 fallback）**：无扩展名文件命中 `doImport`「无扩展名→硬默认 .png」（paste/drop 名总带扩展名·从未触此）→ `Makefile`→`Makefile.png`+`![[Makefile.png]]`（背离 Obsidian 逐字保留·无数据丢失但保真偏差）→ 修=doImport 无扩展名分支**保原名**（`ext=""`·uniquePath 已 empty-ext-safe[`suffix=ext?'.'+ext:''`]·大小写碰撞 loop 同改 empty-ext-aware）；扩展名分支不变→零 risk 图片命名·**r67 9/9 不退证**。**6 refuted=v1 设计选择/测试覆盖建议非缺陷**（cancel-leak[best-effort 已加监听]·切文件中途丢 embed[isConnected+docAtStart 守卫·同 R17 退化·孤儿附件可恢复无字节丢]·e2e 未测非图片[byte-generic·已被 extensionless 修捕获]·单文件[v1]·重取新鲜插当前活动笔记[有意 data-safety·避陈旧 offset]·e2e 未覆盖 cancel/no-active 分支[构造守卫]）。**no-overwrite 三层证**（uniquePath + 大小写不敏感 + createBinary create_new·e2e pic.png 二次→pic 1.png·原字节不变）。**方法论根因（记忆 [[geode-oneshot-store-strictmode]] 邻域 + 新通则）**：(i) **picker/长异步回调读新鲜状态**（重取 getActive() 取 view+path·非闭包旧值）；(ii) **复用 image-only vetted 路径于 any-file 场景·须审其图片隐含假设**（doImport .png fallback 是 paste/drop image-only 的隐含·any-file picker 暴露之）。**v1 偏差/defer**：单文件 picker（下游引擎已多文件就绪·增强 follow-on）；切文件中途插入落当前活动笔记（同 R17 退化语义）；cancel 清理 best-effort（现代引擎）；Tauri 原生对话框（需 Rust read-external-binary·硬边界#5）。

### R208 套件回归（2026-06-25，G3 §2「嵌入内容」· 表面复刻 G 系列 · 1 命令 editor:insert-embed · 插入 `![[]]`[镜像 R189 insertWikilink + `!`] · 扩 R33 format 引擎 insertEmbed · data-safety 逻辑档[byte]·**focused reviewer 放行·0 confirmed·渲染调查证非死语法** · 桌面 probe N/A 浏览器可验证）

R208 = 按 R182 矩阵收割 §2 `missing`「嵌入内容」（Obsidian `editor:insert-embed`「Insert embed」·热键截图转写·真命令）。bounded·**镜像 R189 insertWikilink 仅多 `!` 前缀**（`![[]]` vs `[[]]`）。`插入附件`（§2 余 1·需原生 picker + vault 拷贝·桌面中心）defer。**详见 ARCHITECTURE「Round 208 additions」**：`core/format.ts` 纯 `insertEmbed`（空选区→`![[]]` 光标 `from+3`·有选区→`![[sel]]` 光标 `]]` 后·只替换 [from,to]）+ FormatOp `+"embed"` + applyFormatOp case；formatCommands +1 spec[无默认键]；i18n +1 键 en+zh。

新增套件：`r208-e2e.mjs` **12/12**（A byte __geodeFormat.apply[空选区 `![[]]` 光标+3·mid-text·选区 `![[Note]]`·中段选区 span=[from,to]·startsWith `![[`·**CONTRAST wikilink op `[[x]]` vs embed op `![[x]]`**] + B 注册无默认键[name=Insert embed] + C live[选区 `Target`→`![[Target]]`·周边字节保留]）。**套件矩阵不回退**：**r33-e2e 37/37（format 引擎）·r189-e2e 17/17（insert-wikilink 镜像源不退）**·typecheck 0/cargo check/生产构建。**桌面 probe N/A 浏览器可验证**（纯函数 `__geodeFormat.apply` 探针 + live CM dispatch·同 R189/R198 format 引擎既定）。**分档逻辑档（data-safety·core/format.ts editor 写路径）→ data-safety skill 已跑**：纯字符串插入·**不读 syntaxTree/overlay**（非 Lezer 损坏族）·镜像 R189 vetted insertWikilink（仅多 `!`）·只替换 [from,to]·零新 vault 写路径。**⚠️ 渲染调查（评审 key 点·证非死语法）**：render PROOF 初见 `__geodeRenderMarkdown("![[Note]]")`→字面 `!`+link（非 embed）→ 根因 **裸探针不传 noteEmbeds 选项 + null resolver** → markdown.ts:536-540 fallback；**真实阅读视图**（preview.ts/EditorPane/HoverPreview/Slides/Export 均 `{noteEmbeds:true}`+resolver）→ markdown.ts:489-535 渲 **geode-embed**[图片]/**geode-embed-file**[音视频/PDF]/**geode-embed-note**[笔记 span]（旁证 noteComposer.ts:77 既用 `![[]]` embed 形态）→ **命令产出有意义·非死语法**。修正：r208 移除探针 render PROOF（测探针缺省非命令·embed 渲染属 R12/R26/R61 既有套件域）。**⭐ 对抗评审（focused reviewer·非满 workflow——~28 行镜像 vetted 码·最低风险 逻辑档）→ 放行·0 confirmed**：① insertEmbed 字节逐字镜像 insertWikilink（node 实测 5 边界 空/选区/CJK/doc-start/元字符 `*|`·空选区光标 `from+3`=wikilink+1·只动 [from,to]·永不 no-op）；② 非死语法（见渲染调查）；③ `!` 前缀无副作用（空 `![[]]` 不匹配 `WIKILINK_RE` 不触坏 widget·走标准 CM 事务→autosave）；④ wiring 齐（union/switch/never 门/spec 唯一/i18n en+zh·typecheck 0 证无 phantom 键）；⑤ SIMPLIFY-NO（~6 行低于 dedup 阈值·镜像兄弟 insertInlineMath 先例不合并）。**方法论印证（非新教训）**：**评审力度匹配风险**——~28 行镜像 vetted 码用 focused reviewer 而非满 3-lens workflow（对照 R206 greenfield 满跑 + 焦点复评）；render PROOF 失败先**调查根因**（探针缺省 vs 命令缺陷）再决定移除/修——避免误把探针局限当命令缺陷。**v1 偏差/defer**：`插入附件`（需原生 picker + vault 拷贝·桌面中心·单独轮）；embed 仅插结构（用户键入/补全目标·同 insert-wikilink·Geode 不弹建议器）；embed 渲染属 R12/R26/R61。

### R207 套件回归（2026-06-25，G3 §17「表格编辑器」片 B · 表面复刻 G 系列 · 9 命令 复制/移动行列+列对齐 · 扩 R206 已 vetted core/tableEditor.ts +9 thin op[解析/序列化/检测/守卫层不动] · data-safety 逻辑档[byte·整表重写]·**Ultracode 2-lens 对抗评审 verdict=deliverable·0 confirmed·§17 整组 15 全 done** · 桌面 probe N/A 浏览器可验证）

R207 = 收割 §17「表格 Table」**片 B = 剩 9 命令**（复制行/复制列·向上/下移动行·向左/右移动列·左/右/居中对齐），补完 §17 整组（R205 入口 + R206 片 A 6 + R207 片 B 9 = 15）。**详见 ARCHITECTURE「Round 207 additions」**：`TableOp` +9 成员·`applyOp` +9 case（纯 model→model：copy=插入行/列副本·move=swap·align=设 ColumnAlign）+ `swapCols` helper（move-column-left/right 共 2 调用点）；`TABLE_COMMANDS` +9 spec + i18n +9 键 en+zh[官方名]。`复制`=duplicate（剪贴板 copy/paste = follow-on）·align=SET 非 toggle。**R206 字节风险层[parse/serialize/locateCell/hasOverlayPipe/renderCell/runTableOp indent 保留]全未改**。

新增套件：`r207-e2e.mjs` **32/32**（A byte 9 op[copy-row/column·move-row-up/down·move-column-left/right·align-left/right/center 精确字节] + no-op 守卫[copy-row 表头/move-row-up 首行/move-row-down 末行/move-column-left 首列/move-column-right 末列 → null] + **A3 align render PROOF**[`:--`/`:-:`/`--:` → markdown-it HTML text-align:left/center/right] + **G overlay-pipe 守卫统一 gate 片 B**[move/align/copy on `[[Page|Alias]]`→null] + B 注册 9 命令无默认键 + C live[editor:table-move-row-down 实测换行·表头/分隔保留]）。**套件矩阵不回退**：**r206-e2e 52/52（片 A·字节风险层未改回归绿）·r33-e2e 37/37**·typecheck 0/cargo check/生产构建。**桌面 probe N/A 浏览器可验证**（applyTableOp 纯函数探针 + live CM dispatch·同 R206）。**分档逻辑档（data-safety·整表重写）→ data-safety skill 已跑**：9 op 纯重排/复制/改 align·不碰解析/序列化/检测/守卫（hasOverlayPipe 仍 gate·renderCell 仍转义·indent 仍保留·均 R206 vetted 不变）·整表替换走 view.dispatch 单事务·零新写路径·内容字节保留。**⭐ Ultracode 2-lens 对抗评审（op-correctness/data-safety 并行 + skeptic synthesis）→ verdict=deliverable·0 confirmed[0 crit/major/minor/nit]**：op-correctness lens **0 finding**（逐 op 手算边界守卫·focus 落点·swapCols 三处一致·align SET·分隔字节·never 穷尽门）；data-safety lens 6 raw **全 refuted=安全断言成立**（片 B 不产新 cell 串·只 relocate 既有 cell 经 vetted renderCell round-trip·escaped-pipe 复制双侧重转义·align 不改 aligns.length·hasOverlayPipe 统一 gate 全 9 op[applyTableOp→parseTable→null 无旁路]·ragged 经 parseTable 先 rectangularize·op 保矩形·indent 保留共享 runTableOp op-agnostic·非光标行 sliced 副本保留）。**关键验证：R206 字节风险层未改 → r206-e2e 52/52 回归绿证片 B 纯加性零回归。** **策略印证（非新教训）**：**片 A/片 B 拆分奏效**——R206 把模型做对（critical 在彼处揪净·重审）→ 片 B thin ops 复用 vetted 基建·评审零缺陷净过（风险匹配力度：高风险 greenfield 单独重审 + 后续加性 thin ops 轻审）。**v1 偏差/defer**：剪贴板 copy/paste row/column（Obsidian「copy and paste」真义·需 paste-row 解析）；align SET 非 toggle（无清除对齐命令·Obsidian 同）；含 overlay-pipe/blockquote/缩进越界表仍 safe decline（R206 守卫）。

### R206 套件回归（2026-06-25，G3 §17「表格编辑器」片 A · 表面复刻 G 系列 · 6 命令 表格增删行列 · 新 core/tableEditor.ts 纯模型[markdown-it escapedSplit 对齐阅读视图] + features/editor/tableCommands.ts[复用 R55 findTableRanges] · data-safety 逻辑档[byte·整表重写]·**Ultracode 3-lens + 焦点复评 · 初判 needs-fixes→修后 deliverable·1 critical+3 minor+1 nit 全修** · 桌面 probe N/A 浏览器可验证）

R206 = 按 R182 矩阵收割 §17「表格 Table」（Obsidian 1.5+ 内置表格编辑器·命令组 ~15·无默认键）**片 A = 增删行列 6 命令**（insert-row-above/below·insert-column-left/right·delete-row/column）+ 建可复用表格模型；move/align/copy 9 命令 = 片 B（R207）defer。**详见 ARCHITECTURE「Round 206 additions」**：新 `core/tableEditor.ts` 纯 greenfield `applyTableOp(op,tableText,offset)→{text,cursorOffsetInTable}|null`（parse→locate→op→serialize）·**cell 切分逐字复刻 markdown-it escapedSplit**（对齐阅读视图 markdown.ts:550）·6 op 纯 model→model·serialize 单空格填充+align 分隔；新 `features/editor/tableCommands.ts` 复用 **R55 findTableRanges**（Lezer Table·code-fence 排除）找含光标的表 → 单事务整表替换；App.tsx mount + i18n 6 键 en+zh[官方名] + probe `__geodeTableEdit`。

新增套件：`r206-e2e.mjs` **52/52**（A byte 6 ops + 光标 offset[含 escape +1] + A1 no-op 守卫[表头删行/单列删列/非表格] + **A1b overlay-pipe 守卫[body `[[Page|Alias]]` 撕裂防护→null·header `[[a|b]]`·inline-code `a|b`·math `$a|b$`·**escaped-`$` `$a\$|b$`**·货币 `$5|$10` 可编辑·pipe-less `[[Page]]` 可编辑保留·blockquote `> ` safe decline]** + **A3 ragged 不丢 cell**[多出 body cell 保留·header 补列] + A2 escape round-trip[in-cell `|`→`\|`] + D/D2 render PROOF[3 列表渲染·escaped cell 不损坏 2 列] + B 注册无默认键 + C live[insert-row+前文保留] + **C2 live 缩进/列表内嵌表保 indent·table count 1→1·delim/body 不 flush-left**)。**套件矩阵不回退**：**r33-e2e 37/37（format 引擎）·r55-e2e 15/15（live tables findTableRanges 复用源）·r198-e2e 34/34**·typecheck 0/cargo check/生产构建。**桌面 probe N/A 浏览器可验证**（applyTableOp 纯函数探针 + live CM dispatch + findTableRanges[R55 既有 probe]）。**分档逻辑档（data-safety·editor 写路径·整表重写）→ data-safety skill 已跑**：纯字符串模型·**不读 syntaxTree**（检测用 vetted findTableRanges·只读 Table 节点名·R201 规则允许）·cell 切分镜像 markdown-it（编辑与渲染一致）·整表替换走 view.dispatch 单事务[undo 原子]·零新 vault 写路径·内容字节保留（仅 inter-cell 空白规整）。**⭐ Ultracode 3-lens 对抗评审（byte-correctness/data-safety/fidelity-wiring 并行 + skeptic synthesis）+ 焦点复评 → 初判 needs-fixes → 修后 deliverable**：**1 critical 修**=缩进/列表内嵌表编辑剥 delim/body 行 indent→表格塌陷（live 复现 1 table→0·改非光标行·底线①·list-nested 是 Obsidian 常见型）→ 命令层 indent 重补每行 + 光标偏移 `indent.length*(L+1)`（复评实证光标落新 cell·table 1→1）。**3 minor 修**=（a 实现自查）renderCell 管道重转义[否则 in-cell `|` 重解析为列断=损坏]·（b 实现自查）ragged 行截断丢 cell→规整到最宽行[底线①]·（c 评审+复评）hasOverlayPipe 货币 `$5|$10` 误拦[coarse math regex]+ escaped-`$` 下 under-strip 撕裂 math cell→escape-aware regex `/\$(?=\S)(?:\\.|[^$\\\n])*?\$(?!\d)/`（排 `\` 防 `\$` 被拆·`(?!\d)` 放过货币）。**1 nit 修**=TableModel.rows 过期「truncated」注释。**6 refuted**：escapedSplit 字节对/光标 offset/boundary ops 全对·两处自查 fix 完备·整表重序列化改未编辑字节[markdown-it 渲染等价·非损坏]·blockquote `> ` 表（findTableRanges 检出但 delim 行 `>` cell 令 parseAlign 失→null·safe decline）·tab 缩进表（Lezer 不识别 indented code→no-op）·available 非表格内仍 enabled[同 R33 先例]。**方法论根因（记忆 [[geode-lezer-tree-not-geode-overlays]] + 新 [[geode-non-self-terminating-block-fence]] 邻域）**：(i) **「编辑器对齐阅读视图」扩到表格 cell 切分**——overlay（wikilink/code/math）内 `|` 绝不切（阅读视图视为原子），否则撕裂[R192/R201/R204/R205 同族]；(ii) **整块替换 [from,to] 时块外/逐行前缀（indent/`> `）必须保留**——findTableRanges 的 range.from 在表头首管道之后，flush-left 序列化会丢后续行 indent。**v1 偏差/defer**：片 B move/align/copy 9 命令；序列化单空格填充[非列宽 pretty-format·渲染等价·CJK 显示宽]；含 overlay-pipe 的表格 no-op（overlay-aware 编辑=follow-on）；blockquote/tab 缩进表 no-op（safe decline）。

### R205 套件回归（2026-06-25，G3 §2「插入表格」· 表面复刻 G 系列 · 1 命令 editor:insert-table · 空 2×2 GFM 骨架 + 首格光标 · 扩 R33 format 引擎 insertTable · data-safety 逻辑档[byte·阅读视图保真]·**Ultracode 3-lens 对抗评审 初判 needs-fixes→修后 deliverable·1 major+1 minor+1 nit 全修** · 桌面 probe N/A 浏览器可验证）

R205 = 按 R182 矩阵收割 §2 `missing`「插入表格」（Obsidian `editor:insert-table`「Insert table」），亦 §17 表格组**入口片**（列/行编辑 ~15 命令仍 missing·整片立项另计）。web 实证：Obsidian 插 **2×2 表格**（表头+1 数据行·2 列）·空单元格·光标首格·无默认键。**详见 ARCHITECTURE「Round 205 additions」**：`core/format.ts` 纯 `insertTable(text,_from,to)`（镜像 vetted insertHorizontalRule：**不消选区**[塌缩 `to`=底线①]·`lead` 非行首补前导·`trail` 尾部 fence·骨架 `|     |     |\n| --- | --- |\n|     |     |\n`·光标 `to+lead.length+2`）+ FormatOp `+"table"`[按内容命名·对齐兄弟] + applyFormatOp `case "table"`[never 穷尽门]；formatCommands +1 spec[无默认键]经既有 registerFormatCommands 派发；i18n +1 键 en+zh；probe 无需改（`__geodeFormat.apply` 通用覆盖任意 FormatOp）。

新增套件：`r205-e2e.mjs` **32/32**（A byte insertTable[空/行尾 lead/空行无 lead/行中/**选区不消=底线①**] + **A3 尾 fence**[上方插表补尾 `\n`/行下有文补/已空行不重复/文末不补] + A2 skeleton shape[3 行·GFM 2 列分隔·空格格] + **D render PROOF[孤立 SKEL→`<table>`+2 th+td]** + **D2 render PROOF[把「上方插表」真实产出字节回喂渲染→恰 2 td + `below` 独立 `<p>`·CONTRAST 反证无 fence 的 `SKEL+below` 被吸收]** + B 注册无默认键[name=Insert table] + C live[exec 插表·前文逐字保留·首格光标 head=13]）。**套件矩阵不回退**：**r33-e2e 37/37（format 引擎字节锁）·r198-e2e 34/34（insert-math/HR 同引擎）**·typecheck 0/cargo check/生产构建。**桌面 probe N/A 浏览器可验证**（纯函数 `__geodeFormat.apply` 探针 + live CM `view.dispatch`·同 R198 format 引擎既定）。**分档逻辑档（data-safety·碰 core/format.ts editor 写路径）→ data-safety skill 已跑**：纯字符串插入·**不读 syntaxTree/overlay**[非 R192/R197/R201/R204 Lezer 损坏族·grep 实证]·不消选区[塌缩到 `to`]·零新 vault 写路径[走正常 CM transaction→documents dirty→autosave]。**⭐ Ultracode 3-lens 对抗评审（Workflow byte-offset/data-safety/fidelity-contract 并行 + skeptic synthesis）→ byte/data-safety lens 0 finding·初判 needs-fixes → 修后 deliverable**：**1 major 已修（fidelity·阅读视图保真）**：insertTable 原仅镜像 insertHorizontalRule 单尾 `\n`，但 **GFM 表格非自终止**（不同于自终止 `<hr>`）——markdown-it **贪婪吸收下一非空行为表格体行**。在已有文本行**上方**插表（光标行首·无 lead·下方紧跟文本）→ 下方段落被并入表格成第 4 个 `<td>`（reviewer 经仓库**真实 markdown-it** 复现）。字节/选区不丢（底线①未破）·但阅读视图保真破·高频可达 → 修=**对称尾部 fence**（`trail = to<text.length && text[to]!=="\n" ? "\n":""`·光标 offset 不受影响）。**1 minor 已修（测试盲区·正是漏 major 的根因）**：r205-e2e render PROOF 原仅渲染孤立 SKEL（平凡 2 th/td）·从未把并接文档回喂渲染 → 漏吸收 → 修=+D2（上方插表真实字节回喂·断言恰 2 td+独立 `<p>`·CONTRAST 反证）。**1 nit 已修**：op `insert-table` 重复兄弟丢弃的动词 → 改 op 名 `table`（命令 id 不变·纯内部）。**1 refuted**：有意 Obsidian 偏差（2×2/首格/无键/en+zh/单 `\n` lead/5 宽格被裁剪）皆正确。简化门 **clean**（diff 29 行·insertTable 单调用点·唯一共享 1 行 lead 抽取=加间接层失 2nd-use 减法判据）。**方法论根因（记忆 [[geode-lezer-tree-not-geode-overlays]] 邻域）**：**插入「非自终止块」（表格·未来 callout）必须两侧都 fence，不能照搬「自终止块」（HR/分隔线）的单侧换行**；且 render PROOF 必把**并接文档**（块+周边文本）回喂渲染、非仅渲染孤立块（漏掉本 major 的测试盲区）。**v1 偏差/defer**：§17 列/行编辑 ~15 命令（整片立项）；骨架固定 2×2 空表（同 Obsidian·无「指定行列数」入口）；游标在既有表格内插表=嵌套骨架（同 Obsidian·纯插入不检测既有表·非损坏）。

### R204 套件回归（2026-06-25，G3 §2「重命名当前小标题」片 A · 表面复刻 G 系列 · 1 命令 editor:rename-heading · 改 heading 文字 + 同文件自锚更新 · core/renameHeading.ts 纯函数 + window.prompt · data-safety 逻辑档[byte 风险·链接改写]·**Ultracode 3-lens 对抗评审 verdict=deliverable·0 crit/major** · 桌面 probe N/A 浏览器可验证）

R204 = 按 R182 矩阵收割 §2 `missing`「重命名当前小标题」（Obsidian `editor:rename-heading`「Rename this heading…」）片 A。**忠实基线 + 局部增强**：web 实证（Obsidian dev Licat 明确表态）**Obsidian 核心 rename-heading 不更新任何 heading 链接引用**（`[[#Section]]` 静默失效·正式不实现）→ 忠实基线=改 heading 文字；**片 A 加同文件自锚更新**（同一文档内破链明显不可取的局部完整性增强）。**跨档 `[[File#OldH]]`=片 B**（R16-重·高 data-safety·字节套件重建·下一轮·与 Obsidian 核心同样不做）defer。**详见 ARCHITECTURE「Round 204 additions」**：`core/renameHeading.ts` 纯函数 `renameHeadingAt(text,pos,newText): HeadingChange[]|null`（光标行测 heading + 扫自锚 `(!?)[[#sub(|alias)?]]`·`stripHeadingText` 匹配[复用 metadata·同 resolveSubpath 语义]·只换子路径保 `!`/alias/区外字节·**maskCodeRegions 扫码外**·块引用 `^` 跳·link-unsafe[`|[]#`]/换行守卫·overlap 守卫·changes 排序）+ `currentHeadingText`；formatCommands 注册命令（先测 heading 再 window.prompt[复用 TagsPanel/BookmarksPanel vetted 先例·零新模态] → 单 view.dispatch[CM 映射光标·undo 原子]）；探针 + i18n en+zh。

新增套件：`r204-e2e.mjs` **23/23**（byte renameHeadingAt[plain heading·自锚更新·大小写匹配·alias 保·embed `![[#]]`·markdown heading strip 匹配·**link-unsafe 跳自锚**·**跨档 `[[Other#]]` 不改**·非匹配不改·**inline-code 内自锚不改**·**fence 内自锚不改**·**fenced `## x` no-op**·**块引用 `[[#^id]]` 跳**·**换行折叠单行**·非 heading null·空/不变 null] + 注册无默认键 + live[prompt→改 heading+自锚单事务·**undoable**·非 heading 不弹 prompt 不改]）。**套件矩阵不回退**：**r33-e2e 37/37（format 引擎）·r192-e2e 28/28（clear-formatting 同注册文件）**·typecheck 0/cargo check/生产构建。**桌面 probe N/A 浏览器可验证**（renameHeadingAt 纯函数探针 + live CM dispatch；window.prompt 三处 vetted 先例·WKWebView 偶返 null 既定）。**分档逻辑档（data-safety·byte 风险·链接改写）→ data-safety skill 已跑**：纯单文件 string ops·走 view.dispatch 单事务 undo 原子·**不碰 vault/documents/跨档写路径**·零新写机制；自锚只换子路径保区外·link-unsafe/换行/块引用守卫不写破链·overlap 守卫·**maskCodeRegions 排码区**。**⭐ Ultracode 3-lens 对抗评审（Workflow byte-correctness/data-safety-corruption/fidelity-wiring 并行 + skeptic synthesis）→ verdict=deliverable·0 critical/0 major**：byte-correctness lens **建独立 harness 复算全 offset**（textFrom/subFrom 含 embed 偏移·overlap 半开区间·CRLF 经 normalizeContent →LF）；data-safety lens **grep 实证 zero syntaxTree 读**（非 R192/R197 Lezer 损坏族）。**1 minor 已修**：renameHeadingAt 原扫 raw 无 maskCodeRegions → 码内字面 `[[#Old]]` 被改写、fence 内 `## x` 误判 heading（背离阅读视图 + 全仓 scanner R68/R125/R127「detector 须对齐 reading-view」纪律 + R201 code-context 教训）→ 修=heading 检测 + 自锚扫描跑 `maskCodeRegions`（同长 blank offset 对齐·应用于 raw·复用 metadata 与 resolveSubpath/unlinkedMentions 同源）。**2 nit 已修**：换行守卫（`replace(/[\r\n]+/g," ")`）+ 块引用 `^` 显式跳。**1 nit 契约漂移**（裸 `HeadingChange[]` vs 冻结 `{changes,selFrom,selTo}`）As-built 已调和。**5 refuted**（重复同名过匹配=resolveSubpath 首匹配歧义/跨档 defer/window.prompt UI/overlap 抛/缺 zh 键）。简化门 **删 1 处**（探针 wrapper→直赋）。**方法论根因（记忆 [[geode-lezer-tree-not-geode-overlays]] 已记 R204 扩展）**：扫 .md 文本找结构（heading/链接）的纯函数必跑 `maskCodeRegions`（pure-function/全文层）或命令层 syntaxTree code 守卫（单 pos 层）——R192/R197 Lezer 损坏、R201 导航幻影、R204 改写幻影同一根「detector 须对齐阅读视图 code-skip/overlay-exclude」。**v1 偏差/defer**：跨档片 B；markdown 自锚 `[x](#OldH)`；link-unsafe newText 跳自锚（heading 仍改·同 Obsidian）；重复同名 heading 自锚全改向 newTrim（固有歧义）。

### R203 套件回归（2026-06-25，G C1「管理/切换仓库」首片 · 表面复刻 G 系列 · 最近仓库 store + 切换器模态 + app:switch-vault 命令 · 重构 switchToVault 复用 openVaultFlow 切库全序 · data-safety 逻辑档[vault 切换]·**Ultracode 3-lens 对抗评审 verdict=deliverable·0 confirmed** · 桌面 probe N/A 主体浏览器可验证）

R203 = 审计点名 `管理仓库`/`切换仓库`（C1）首片（按矩阵推进建议 ROI #4）。**bounded + 浏览器可验证**（explorer 实证：唯一桌面-only 是 `pickVaultFolder()` 原生对话框；切到**已知最近路径**不需对话框——`openVaultFlow` 函数体除首行就是接受路径的切库全序）。**详见 ARCHITECTURE「Round 203 additions」**：`core/recentVaults.ts`（新·纯·镜像 commandMru·全局 `geode.recentVaults` string[]·防御式解析·上限 10·**零 fs**）；App.tsx 重构 openVaultFlow body 抽 `switchToVault(app,path)`（逐字节保留切库全序 flushAll→lastActiveFile.set(null)→setVaultPath→localStorage→load→pushRecentVault[load 成功后]→closeMissingFileTabs→重载插件）+ inline VaultSwitcherModal + `app:switch-vault` 命令（不门控 isTauri）；main.tsx boot push + `__geodeRecentVaults` 探针；i18n +5 键 en+zh；app.css vaultswitcher 样式。**附带据实纠误**：矩阵 §2「小标题切换 partial」陈旧→done（Geode toggleHeading 已全级循环 none→H1…H6→none；cycle-heading 在 Obsidian 是社区插件非核心）。

新增套件：`r203-e2e.mjs` **21/21**（A store CRUD via `__geodeRecentVaults`[push 序最新在前·re-push dedupe 移前·cap 10·remove·**防御式解析：坏 JSON/非数组/非 string/去重→[]或 filtered**] + B 命令注册[非 isTauri 门控]+模态渲染[basename+path·空态] + C **移除最近→列表+localStorage 更新·vault 数据未删=硬边界#3**[r203-keep.md 存活] + D 点最近→切库流程跑·模态关·**recents 移前保留**[seed [Delta,Gamma] 点旧的 Gamma→[Gamma,Delta]]·vault 文件存）。**套件矩阵不回退**：**r33-e2e 37/37（app boot/editor）·r81-e2e 14/14（tabs）**·typecheck 0/cargo check/生产构建。**桌面 probe N/A 主体浏览器可验证**（store CRUD + 模态 + 命令 + switchToVault 不抛 browser-E2E 兜；真实 fs 切库内容变=既有 openVaultFlow 序·未改）。**分档逻辑档（data-safety·vault 切换红线）→ data-safety skill 已跑**：**switchToVault 逐字节保留 openVaultFlow 切库全序**（唯一插入 pushRecentVault 于 load 后·flushAll 必 FIRST 先于 setVaultPath=A.2 防晚存覆盖新库丢编辑）；recentVaults 零 import·remove 只写 localStorage=**硬边界#3**（绝不触 fs/vault 数据）。**⭐ Ultracode 3-lens 对抗评审（Workflow switchToVault-datasafety-sequence/recentVaults-store-boundary3/modal-wiring-fidelity 并行 + skeptic synthesis）→ verdict=deliverable·0 critical/0 major·0 confirmed**：lens **git diff 实证 switchToVault body 对旧 openVaultFlow 逐字节一致**（唯一插入 pushRecentVault）·硬边界#3 satisfied·防御式解析逐字镜像 commandMru.loadIds·wiring 全（命令 ungated·ModalKind·render·i18n en+zh·boot push·probe）·模态无 setState-on-unmount。**3 raw findings 全 refuted**：① 坏 recent 路径切换不回滚 adapter（2 lens 同根因）=pre-existing openVaultFlow 既有·flushAll 先行无数据丢失·桌面 only·重启恢复（记 v1 限制·非阻塞）；② test-D click 欠验 push-to-front=测试质量 nit（产品码在位且 load 后）→**已收紧**（seed 二·点旧的·断言移前+保留）。简化门 **clean**（switchToVault 2 调用点·防御式解析 STOP-guarded）。**方法论根因（记忆）**：**重构关键数据安全路径必逐字节保留既有序**——切库全序少一步即踩历轮根因（flushAll FIRST 防晚存覆盖）；副作用记录（pushRecentVault）置 load 成功后·坏路径不入列表。**v1 已知限制**：坏 recent 路径切换中断态不回滚（同 openVaultFlow 既有·无数据丢失·重启恢复）；浏览器无多库语义；VaultPicker 空态加最近列表 defer。

### R202 套件回归（2026-06-25，G3 §4「在新标签组中打开光标处链接」· 表面复刻 G 系列 · 1 命令 editor:open-link-in-new-split[⌘⌥Enter] · 续 R201·followLinkAtCursor newTab→mode 重构 + 复用 vetted splitActivePane · 纯导航零新写路径 · data-safety 逻辑档·**Ultracode 3-lens 对抗评审 verdict=deliverable** · 桌面 probe N/A）

R202 = 按 R182 矩阵续 R201 收割 §4 末可达项 `editor:open-link-in-new-split`（⌘⌥Enter「在新标签组中打开光标处链接」/ Obsidian「Open link under cursor to the right」missing→done）。`open-link-in-new-window`（多窗口）仍 defer。**bounded·复用 R201 全部基建**（linkAtCursor + openWikilink/resolveMarkdownLink/window.open + code-context 守卫）+ vetted `splitActivePane("row")`（app:split-right 同源）。**详见 ARCHITECTURE「Round 202 additions」**：`followLinkAtCursor` 第 4 参 `newTab:boolean`→`mode:"current"|"tab"|"split"`（`newTab=mode==="tab"`·R201 两命令改传 mode·命令行为不变）；split 编排=pre-split 原 view 取 link → wikilink: `if(mode==="split") splitActivePane("row")`→openWikilink（开进 active=新窗格·openFile replace-in-place RETARGET dup tab 单 tab 无残留）/ markdown internal: **先 resolve 后 split**（unresolved return false 无空窗格）/ external: window.open 不 split；+1 命令 Mod+Alt+Enter；i18n +1 键 en+zh（与 Obsidian 官方一致）。

新增套件：`r202-e2e.mjs` **12/12**（注册 Mod+Alt+Enter + live[split wikilink→新窗格+B202·split markdown→新窗格+C202·split subpath·external→浏览器无 split·inline-code 守卫 no-op 无 split 无幻影·**degenerate `[[#]]` 无残留窗格**]·paneCount 走 workspace 树实测非仅 active file）。**套件矩阵不回退**：**r201-e2e 29/29（重构内部·命令行为不变）·r71-e2e 17/17（openWikilink 向后兼容）**·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（编辑器导航 + split·同 R183/R201 既定 browser-E2E；splitActivePane 纯 workspace 树操作平台无关）。**分档逻辑档（data-safety）→ data-safety skill 已跑**：**零新写机制**（复用 R201 全部 vetted 路径 + splitActivePane 纯 workspace 树操作无 vault IO）；唯一写仍 openWikilink→createNewNote（unresolved wikilink·vetted uniquePath）·split 不增不改写。**⭐ Ultracode 3-lens 对抗评审（Workflow split-composition/refactor-regression-datasafety/fidelity-wiring 并行 + skeptic synthesis）→ verdict=deliverable·0 critical/0 major**：lens **追进 workspace.ts 证 splitActivePane dup tab → openFile replace-in-place(ws.ts:409) RETARGET 单 tab·无残留 dup/双开/错窗格**、newTab=（mode==="tab"）current/tab 与 R201 逐字节等价、code-context 守卫读 pre-split 原 view、热键 Mod+Alt+Enter 无撞、en/zh 标签与 Obsidian 官方一致。**1 minor 已修**：split 模式 degenerate `[[#]]`/`[[#|x]]`（空 target+空 subpath）wikilink 分支无条件 split 后 openWikilink no-op→残留 dup 窗格→修=wikilink 分支 split **前**加 `if(target===""&&!subpath) return false`（镜像 openWikilink no-op·current/tab 字节等价）。**2 nit 不改（R201 fidelity 已实证反驳）**：热键 Alt/Mod/Mod+Alt+Enter 即 Obsidian 默认键、zh `在新标签组中打开光标处链接` 即官方字符串（加『右侧』反偏离）。**6 refuted**（new-window defer/self-link split 开源副本忠实/重构无回归/无双开/热键无撞/无新写路径）。简化门 **clean（skip：2 文件/~30 行·split 分支契约决策非可减面）**。**方法论根因（记忆）**：副作用编排（split/create/open）的每条分支，**先确认 open 真会发生再做不可逆前置副作用（split）**——「open 可能 no-op」的分支（degenerate wikilink）必在 split 前判，否则残留窗格（markdown/external 因「先 resolve/判后 split」免疫）。**v1 defer**：§4 余 open-link-in-new-window（多窗口）；split 方向固定 "row"（向右·Obsidian 默认）。

### R201 套件回归（2026-06-25，G3 §4「打开光标处链接」· 表面复刻 G 系列 · 2 命令 editor:follow-link[⌥Enter] + editor:open-link-in-new-leaf[⌘Enter] · 复用 vetted openWikilink/resolveMarkdownLink/window.open · 纯导航零新写路径 · data-safety 逻辑档·**Ultracode 4-lens 对抗评审 verdict=deliverable** · 桌面 probe N/A）

R201 = 按 R182 矩阵收割 §4 链接导航：`editor:follow-link`（⌥Enter「打开光标处链接」partial→done）+ `editor:open-link-in-new-leaf`（⌘Enter「在新标签页打开」missing→done）。**bounded 纯命令项耗尽后的高确定性纯导航选项**（真 Obsidian 核心命令·零 vault 写[复用 vetted 路径]·rename-heading=大件[R16 heading 锚点 verbatim 不可复用]/§8 新标签页=大件[面板 sidebar-only]故 defer）。**详见 ARCHITECTURE「Round 201 additions」**：`core/linkAtCursor.ts`（新·纯）扫光标行 wikilink/markdown 返链接 span+subpath+external；`linkCommands.ts` `followLinkAtCursor` 三分支（wikilink→openWikilink[+`opts.newTab`，扩既有 8 调用点向后兼容]/markdown external→window.open/markdown internal→resolveMarkdownLink+openFile）；`registerLinkCommands` 注册 2 命令 Alt+Enter/Mod+Enter；main.tsx 探针 `__geodeLinkAtCursor`；i18n +2 键 en+zh（与 Obsidian 官方本地化逐字一致）。

新增套件：`r201-e2e.mjs` **29/29**（byte linkAtCursor[wikilink·subpath·alias-drop·embed `!`·self-link·markdown internal/external/external+frag·**平衡括号 URL**·无链接·双链接·边界含界] + 注册 Alt+Enter & Mod+Enter + live[no-op·follow 同 tab·new-leaf 2 tab·subpath·markdown internal·external window.open + **inline-code/fence code-context 守卫 no-op + 无幻影笔记**]）。**套件矩阵不回退**：**r71-e2e 17/17（markdown-link 导航·openWikilink 向后兼容）**·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（编辑器导航 + window.open·同 R183 既定「clipboard/导航仅 browser-E2E」；`linkAtCursor` 纯函数浏览器探针直驱）。**分档逻辑档（data-safety）→ data-safety skill 已跑**：**零新写机制**（全复用 vetted openWikilink[含 unresolved→createNewNote·uniquePath 不覆盖]/resolveMarkdownLink/openFile/window.open）；导航主体只读；R23 active-file 门控。**⭐ Ultracode 4-lens 对抗评审（Workflow linkAtCursor-bytes/data-safety-navigation/fidelity/wiring-hotkey 并行 + skeptic synthesis）→ verdict=deliverable·0 critical/0 major**：lens **追进 metadata.ts 证 `javascript:`/`data:` 无 `://`→非 external→resolveMarkdownLink 经 normalizeMdHref scheme 守卫返 null→no-op（无 window.open 无执行）**、openWikilink 加 opts 向后兼容（openFile `opts.newTab??false`·8 调用点 newTab=undefined 不变·r71 17/17 佐证）、热键 `Alt+Enter`/`Mod+Enter` 经 matchParsedHotkey 精确模位比对**不破裸 Enter/IME/补全接受**、en+zh 标签与 Obsidian 官方逐字一致。**2 minor 已修**：① **`linkAtCursor` 无 inline-code/fence 感知→跟随码内字面 `[[X]]` 导航 + unresolved 写幻影笔记**（背离阅读视图 markdown.ts:440/465-468 跳码 + Obsidian）→ 修=命令层 Lezer code-context 守卫（`syntaxTree.resolveInner` 祖先名含 `Code` 即 no-op·**只读节点名安全·非动 emphasis mark·R192/R197 规则正向用法**）；② `MDLINK_RE` href `[^)]+` 截断平衡括号 URL→`(?:[^()]|\([^()]*\))+`。**1 nit 记**：Mod+Enter 有意遮蔽 CM insertBlankLine（同 editorMotionCommands 先例·insert-blank-line 仍在仅无默认键）。**3 refuted**（javascript: 安全/openWikilink 向后兼容/真 unresolved 创建 = Obsidian 忠实）。简化门 **clean**（splitSubpath 2 调用点·两 matchAll 字段不同非 token 重复）。**方法论根因（记忆）**：编辑器命令扫 .md 文本找结构（链接/标题/块）须**对齐阅读视图 code-skip/overlay-exclude**——码块内误判 = 导航幻影 / 写幻影笔记（本轮）或 R192 字节损坏（动 mark）。**v1 defer**：§4 余 open-link-in-new-split[需 splitLeaf]/new-window[多窗口]；markdown unresolved internal 不 create（仅 wikilink·更安全）。

### R200 套件回归（2026-06-24，G3 missing→done「编辑器光标处上下文菜单」· 表面复刻 G 系列 · 完成 R131 延后片：编辑器右键原生 Cut/Copy/Paste + 总是显示 · data-safety 逻辑档[cut/paste 写]·**Ultracode 4-lens 对抗评审 verdict=deliverable** · 桌面 probe N/A）

R200 = 按 R182 矩阵收割 §3 末项「光标处上下文菜单」（Obsidian 编辑器右键菜单）。**正是 R131 显式延后的片**（R131 建了 `editor-menu` 事件 + 真 compat `Menu`，但 contextmenu handler 仅当插件贡献项才替换浏览器菜单、无原生项）。**Path A（最小 diff·与 R131 设计一致）**：编辑器上下文菜单本就是 compat 的 `editor-menu` 实现面，扩 `compat/obsidian/editorMenu.ts` 一处即可（editor feature + core 零改；compat→core 允许、features 绝不 import compat 不破）。**详见 ARCHITECTURE「Round 200 additions」**：`contextmenu(evt,view)` → `addClipboardItems`[Cut(选区禁用·`writeText().then(写成功才删·范围重验证).catch(不删)`=底线①)·Copy(只读)·Paste(`readText().then(插 fresh 选区)`)] → fire editor-menu(插件项) → 原生/插件间插一条分隔线(仅插件加非分隔节点·`for` 剥尾随) → 总是 preventDefault + show；i18n +3 键 editorMenu.cut/copy/paste en(Cut/Copy/Paste)+zh(剪切/复制/粘贴)。

新增套件：`r200-e2e.mjs` **21/21**（总显示 + 原生 Cut/Copy/Paste 序 + **选区禁用态**[无选区 Cut/Copy is-disabled·Paste 总启用] + Copy 写剪贴不改文 + **Cut 删选区+写剪贴+undoable** + Paste 插光标 + **插件 editor-menu 项在原生+分隔线后** + 无插件无尾分隔线 + **裸分隔线插件无孤儿**[§F 锁分隔线鲁棒修] + 同步 contextmenu 事件保程序化选区 + clipboard 权限 grant）。**套件矩阵不回退**：**改测 r131-e2e 8/8**（R200 行为变更：菜单含原生 Cut/Copy/Paste + 插件项·**总是显示**[此前「无插件→浏览器菜单」2 断言据实改])·**r144-e2e 7/7（Menu 组件不退）**·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（右键菜单 DOM + clipboard·同 R183 既定「clipboard + CM dispatch 仅 browser-E2E、clipboard 从不 desktop-probe」；菜单逻辑纯 compat/CM 平台无关）。**分档逻辑档（data-safety）→ data-safety skill 已跑**：cut/paste 经 view.dispatch 改 .md（undo-safe·绝不裸写 vault）；**Cut = copy 成功才删（clipboard 失败 .catch 不删=绝不丢字）+ 范围重验证（只删拷过的字节）**、Paste 读 fresh 选区 in-bounds、走既有 R23 active-file 编辑→autosave 路径无新写机制。**⭐ Ultracode 4-lens 对抗评审（Workflow data-safety-clipboard/menu-lifecycle/fidelity/wiring-layering 并行 + skeptic synthesis）→ verdict=deliverable·0 critical/0 major**：lens **追进 documents.ts 证 delete.cut/input.paste 走既有 updateListener→scheduleSave 无新写路径**、**追进 menu mousedown 关闭链证右击重开无菜单泄漏**、throwing 插件经 tryTrigger 隔离不阻 show。**3 confirmed 已修**：① (nit·data-safety 硬化) Cut 复用 await 前选区 vs Paste 读 fresh → 范围重验证 `if(sliceDoc(sel)!==copied) return`；② (nit) 单 `if` 去分隔线留裸 separator 孤儿/相邻双线 → `childElementCount` 边界插 + `for` 剥尾随；③ (minor) editor-menu JSDoc(workspace.ts/context.ts) 过期 → 据 R200 改写。**1 minor 记 v1 已知限制（下方缺口）**；**1 refuted**（原生项无图标=既定 v1·compat BUILTIN 缺·setIcon 降级空 span 非错图标）。

> **R200 v1 已知缺口（COMPAT 矩阵·非回退）**：① **总是 preventDefault 抑制浏览器原生拼写建议菜单**——R50 编辑器拼写检查开（默认关）的用户右击拼错词，原本浏览器菜单给纠正建议，R200 后只见 Cut/Copy/Paste（Obsidian 把拼写建议并入自身菜单、Geode v1 未做）。窄 cohort（非默认偏好）；完整修=平台拼写建议作菜单项注入（更大件、defer）。② 原生项无图标（compat BUILTIN 集缺 scissors/copy/clipboard）。③ 键盘 `editor:context-menu`（光标处弹出同菜单）薄包装 defer。④ Cut/Copy 仅 `selection.main`（多光标只主选区·右击 mousedown 本就归一选区故实测不可达）。

### R199 套件回归（2026-06-24，G3 missing→done「插入脚注」· 表面复刻 G 系列 · core/format.ts 纯函数 insertFootnote 双址插+双向跳转 · data-safety 逻辑档 + byte 回归·**Ultracode 4-lens 对抗评审 verdict=deliverable**、零 compat 调用面改动 · 桌面 probe N/A）

R199 = 按 R182 矩阵收割 §2 `missing`「插入脚注」（Obsidian `editor:insert-footnote`，v1.8.9，**双向**）。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 199 additions」**：`core/format.ts` +`insertFootnote(text,_from,to)` 纯函数返判别 union `{kind:"insert",changes,selTarget}|{kind:"jump",selTarget}`（双址非单 contiguous→走 clear-formatting/delete-paragraph 标准命令注册非 FormatOp）；formatCommands +1 standalone 注册（无默认键）+ dispatch；i18n +1 键 en+zh；main.tsx +`__geodeFootnote` 探针。**Mode A 插入**：编号 max(数字 label)+1（collision-safe）、ref 插 `to`（选区不消=底线①）、def 插末行带 leadNL 三态、selTarget=新文档末尾。**Mode B 跳转（零变更）**：def 行→首个非定义 `[^id]` ref（`indexOf` 闭合 `]` 防前缀撞）。

新增套件：`r199-e2e.mjs` **23/23**（Mode A byte[空文档→`[^1]\n[^1]: `·无尾换行·有尾换行落末空行无空行 gap] + 编号[max+1·gap 不填→`[^6]`·named `[^note]` 忽略] + **底线①选区不消[ref 插选区尾 `to`]** + Mode B[def→ref 跳转 selTarget=8·无 body ref 停留·**`[^1]`⊄`[^10]` 前缀守卫**·**缩进 1-3 空格 def 行也跳转**] + 渲染证[含内容 sup.footnote-ref + **实出无空行空 def `alpha[^1]\n[^1]: ` 也渲 footnote-ref**] + 注册+名称解析非裸键+无默认键 + live[插入 `alpha beta[^1]\n[^1]: ` caret 末·2nd run def 行**双向跳转**回 body ref·**同位置变更** `x`→`x[^1]\n[^1]: `]）。**套件矩阵不回退**：**r33 37/37（format 引擎字节锁不退）·r198 34/34·r192 28/28（clear-formatting 同文件注册不退）**·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 core 引擎 + view.dispatch 复用 R33/R23 写路径，`__geodeFootnote` 浏览器侧已直驱纯函数，同 R198/R197）。**分档逻辑档（data-safety）→ data-safety skill 已跑**：Mode A 双 INSERT 绝不删（changes 无 `to` 字段）、原子单 undo、ref 插 `to` 选区文本保留；Mode B 纯 selection 零变更。**⭐ Ultracode 4-lens 对抗评审（Workflow byte-offset/data-safety/footnote-semantics/wiring 并行 + skeptic synthesis）→ verdict=deliverable·0 critical/0 major**：data-safety lens **追进 CM6 `ChangeSet.of` 源码**证同位置（caret==docEnd）双 insert 按数组序合成 ref-then-def 不抛/不重排（唯一 throw 是 `from>to||<0||>len`，本轮 `to≤L===len` 不触）、CRLF 经 CM `DefaultSplit` 建 doc 时 →LF；空 def `[^N]: ` 经 markdown.ts:756 注册（空内容也存）→ ref 仍渲 `sup.footnote-ref`（probe 实证）；编号 max+1 过扫只抬 N 无重号。**2 confirmed nit 全修**：① `FOOTNOTE_DEF_LINE_RE` 列 0 锚 vs 渲染器 `tShift` 容缩进→缩进 def 行漏判走 Mode A（byte-safe 无损但命令/渲染器不一致）→ 正则放宽 `/^ {0,3}\[\^…/`+e2e 加缩进跳转用例；② r199-e2e 渲染证用带空行布局非命令实出无空行字节→加实出字节渲染断言。简化门 **删 1 处**（Mode B 手写行边界→复用 lineBounds，字节等价 -2 行零新符号）。**v1 偏差/defer**：ref→def 反向跳转 defer（Obsidian 文档仅明述 def→ref）；编号 gap 不填（与 Obsidian 同）；选区时 ref 插 `to` 非 head。

### R198 套件回归（2026-06-24，G3 missing→done「行内数学 + 插入数学块 + 插入分隔线」· 表面复刻 G 系列 · 扩 R33 format 引擎 3 纯插入 op · data-safety 逻辑档 + byte 回归·**Ultracode 4-lens 对抗评审 verdict=deliverable**、零 compat 调用面改动 · 桌面 probe N/A）

R198 = 按 R182 矩阵收割 §2 `missing` insert 家族 3 项（Obsidian `editor:insert-math` 行内数学 / `editor:insert-math-block` 插入数学块 / `editor:insert-horizontal-rule` 插入分隔线）。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 198 additions」**：`core/format.ts` +3 FormatOp[inline-math/math-block/horizontal-rule] + 3 纯函数 helper（insertInlineMath 单 `$` 包裹 / insertMathBlock `lineBounds` 行级 `$$\n…\n$$` / insertHorizontalRule **不消选区**[from=to=选区尾·底线①] 用 `***`） + applyFormatOp 3 case；formatCommands +3 spec（无默认键）；i18n +3 键 en+zh。与 R189(insertWikilink)/R186(setHeadingLevel) 同槽。

新增套件：`r198-e2e.mjs` **34/34**（inline-math byte[空选→`$$` 光标居中·选区包裹·content verbatim·非 toggle `$x$`→`$$x$$`] + math-block byte[空行→`$$\n\n$$` 光标中间·选区内层选中·lineBounds 行级·邻行不动] + horizontal-rule byte[空文档·行尾加 lead·空行不加·**底线① 选区不消[span 收为 [to,to]]**·`***` 非 `---`] + **setext-safety render proof：`Hello\n***\n`→`<hr>`+`<p>Hello</p>`、对比 `Hello\n---\n`→`<h2>`** + inline/block 渲染为 `geode-math-inline/block`[收紧后 load-bearing] + 3 命令注册+名称解析非裸键+无默认键 + live CM[inline-math `beta`→`$beta$`·HR 自成行不毁正文] + 无 page error）。**套件矩阵不回退**：**r33 37/37（format 引擎字节锁不退）·r189 17/17**·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 `core/` format 引擎、无 fs/vault 路径，`__geodeFormat.apply` 浏览器侧已直驱 applyFormatOp，同 R197/R189/R186）。**分档逻辑档（data-safety）→ data-safety skill 已跑**：3 op 全纯插入、只替换 [from,to]（math wrap 选区·HR 不消选区）、不 `syntaxTree`/不读 overlay → **R192/R197「Lezer 树≠Geode overlay」损坏族经证实不适用**（纯 slice 无树读）；CRLF 经 vault.ts:356 normalizeContent（R16 choke）已 →LF、HR `text[to-1]` 判定无 `\r` 漏判；走既有 R33 dispatch→autosave 路径无新写机制。**⭐ Ultracode 4-lens 对抗评审（Workflow byte-offset/data-safety-overlay/fidelity/wiring 并行 + skeptic synthesis）→ verdict=deliverable·0 critical/0 major**：4 lens 逐项独立复核 offset 全对、损坏族不适用、wiring 干净（唯一 `switch(op)` 是 `default:never` 穷尽、3 键 en+zh 齐、id 无撞）。**fidelity lens 洞见**：`***` 不只规避 setext 陷阱、更让 Geode 渲染对齐 Obsidian（Obsidian 不支持 setext、其 `text\n---` 渲段落+`<hr>`；Geode 阅读视图却渲 setext h2=既有失真、R198 已绕开）。**唯一 confirmed=nit（已修）**：r198-e2e 两条 math-渲染断言原带 `||includes("a^2")` 回退（正则 `\$` 匹配未渲染裸 `$`）→近恒真，收紧为 `class="…geode-math-inline/block"` 后仍 34/34=渲染证明 load-bearing；refuted=命令 id 非 Obsidian 逐字 core id（内部 id 用户不可见、零功能影响）。简化门 **clean**（3 helper 形状似但 marker/光标算术各异、合并=加 marker 参泛型 SIMPLIFY-NO）。**v1 偏差（记录非 corruption）**：inline-math 空选区 `$$`（整空行=瞬时 block-math 起始、与 Obsidian 同）/ math-block 行级整行包裹 / HR 用 `***`。

### R197 套件回归（2026-06-24，G3 missing→done「删除段落」· 表面复刻 G 系列 · data-safety 逻辑档 + byte 回归·**Ultracode 多 agent 对抗评审揪 4 字节损坏全修**、零 compat 调用面改动 · 桌面 probe N/A）

R197 = 按 R182 矩阵收割 §3「删除段落」（Obsidian `editor:delete-paragraph`）。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 197 additions」**：`editorEditCommands.ts` `deleteParagraph`（syntaxTree 顶层块 + frontmatter 守卫 + overlay 交集展开 fixpoint[blockMathRanges 缩进≤3·commentSpans pairedOnly] + 缩进码行首 snap + F2 块末行尾 retry）；`commentSpans` 改 export + `pairedOnly` 参；i18n +1 键。

新增套件：`r197-e2e.mjs` **28/28**（段落/列表/标题整删 + body 保留 + **代码围栏含空行整删不切** + frontmatter no-op + **多行 frontmatter 值 no-op** + body 后段独立 + **A 缩进码不残留缩进** + **B 缩进≤3 block math 整删不腰斩** + **C 跨界 comment 不留孤儿** + **未配对 `%%` 不吞 EOF** + F2 块末行尾删 + undoable + graph tab no-op + 无 page error）。**套件矩阵不回退**：**r33 37/37·r192 28/28（commentSpans export+pairedOnly 参不退）**·r52 12/12·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（syntaxTree+view.dispatch 复用 R23 编辑→autosave 路径、无新 fs 写路径；byte 全覆于 28 e2e）。**分档逻辑档（data-safety）→ data-safety skill 已跑**。**⭐ Ultracode 多 agent 对抗评审（Workflow 4 lens[overlay-hunt/algorithm/data-safety/faithfulness]并行 probe + synthesis skeptic 复审，再 2 轮定向复审）→ 揪 4 个字节损坏全修闭合、0 残留**：① probe 自查 block math/comment 含空行被 Lezer 腰斩；② A 缩进码 node.from 非行首残留缩进；③ B findMathBlockRanges indent===0 漏检缩进≤3 math；④ C overlay 守卫光标成员判定漏判跨界 comment；⑤ C 修引入 over-expansion（未配对 `%%` 的 clearFormatting 保护 span 喂进删除路径翻转成删到 EOF）。**方法论铁律**：删/改 .md 块的命令，多行 Geode overlay（math 缩进≤3/comment/frontmatter）必逐一查 Lezer 空行腰斩 + 保护 span 翻转过删——**单 probe 4 缺陷里 3 个没抓到、对抗评审 fan-out 才扫净**。简化门 **clean（3 遍）**。**v1 偏差（记录非 corruption）**：列表删整个列表 / frontmatter no-op / 消所有尾随 \n。

### R196 套件回归（2026-06-24，G3 missing→done「添加别名 + 添加标签」· 表面复刻 G 系列 · data-safety 逻辑档·复用 vetted submitAdd 写路径、零 compat 调用面改动 · 桌面 probe N/A）

R196 = 按 R182 矩阵收割 §3「添加别名」「添加标签」（Obsidian `editor:add-alias`/`add-tag`）。**非 compat-API 轮**（r30 properties 面板 + r126 frontmatter compat 复跑核验不退）。**详见 ARCHITECTURE「Round 196 additions」**：`workspace.ts` addPropertyRequest Store +`key?`；`PropertiesPanel.tsx` tryConsume 加 `if(req.key) submitAdd(req.key)`（复用 vetted submitAdd）；`app/App.tsx` +2 命令镜像 add-property body 带 key；i18n +2 键 en+zh。

新增套件：`r196-e2e.mjs` **15/15**（2 命令注册+名称解析非裸键+无默认键 + add-alias 无 frontmatter→create+加 aliases·body 保留 + add-tag 加 tags 不覆盖 aliases + **同名再 add-alias dedup 不重复**[submitAdd 同名聚焦] + graph tab no-op + 无 page error）。**套件矩阵不回退**：**r30 25/25（properties 面板·确认 add-property 流不退）**·r126 11/11（frontmatter compat）·r194 12/12·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（frontmatter 写复用 R22/R30 buildSetProperty→applyEdit→autosave[已覆盖]、无新 fs 写路径，同 R194）。**分档逻辑档（data-safety）→ data-safety skill 已跑**：reviewer 证全复用 vetted submitAdd→buildSetProperty→applyEdit 无新写机制；**R22 stale-tab/file-mismatch 守卫[tryConsume:638/642/648]全在 key 分支前→stale 请求先 discard 绝不写错文件**；frontmatter-ensure 后 submitAdd 重读 getDoc fresh 无 TOCTOU；opaque aliases→buildSetProperty 返 null 不 clobber；StrictMode 读 .get() fresh 单次写。**对抗评审 6 维 → 0 confirmed defect**（data-safety 全证 / 向后兼容 key=undefined 原行为零回归 / 同名 dedup·add-tag 不覆盖 / 命令+i18n / Obsidian 忠实）。简化门 **clean**（2 callback 块 token 相同但低于阈值·放置约束→保 inline）。**非阻塞 minor（继承自既有 add-property、非新引入）**：preview 模式+无 frontmatter 两步 applyPreviewEdit 真 fs 理论瞬时竞态留空块=非 corruption（payload 含全文 body·自愈·底线①不破）；命令 source→live 翻 + live 默认 debounce 单保存=干净。**v1 nuance**：属性 null 值加入（不预设 aliases/tags 的 list 型）。

### R195 套件回归（2026-06-24，G3 missing→done「切换新标签页的默认视图」· 表面复刻 G 系列 · 逻辑档[非数据安全 appearance]、零 compat 调用面改动 · 桌面 probe N/A）

R195 = 按 R182 矩阵收割 §5「切换新标签页的默认视图」（Obsidian `app:toggle-default-new-tab-view`，R185 当时 defer 为「三态非布尔 cycle」）。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 195 additions」**：`app/App.tsx` 紧邻 R185 既有 `app:toggle-ribbon` +1 命令，循环 `defaultNewTabMode` 三态 `["live","source","preview"]`（复用 vetted setDefaultNewTabMode、纯 appearance 设置无 vault/doc 写）；i18n +1 键 en+zh。**映射偏差**：Obsidian 拆 view+editing-mode 两设置、Geode 合并单一 NewTabMode 三态故循环全 3 态。

新增套件：`r195-e2e.mjs` **11/11**（命令注册+名称解析非裸键+无默认键 + 循环 live→source→preview→live 全 3 态可达·wrap 正确 + 持久化 localStorage reload 后存活 + 无 active file graph tab 可执行 + 无 page error）。**套件矩阵不回退**：**r185 19/19（appearance toggle）**·r194 12/12·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 appearance localStorage 设置、零 fs/Rust/平台分支，同 R185）。**分档逻辑档（非数据安全：纯 appearance localStorage、零 vault/.md 写、data-safety skill 不触发）**。**简化门 clean（skip：diff 16 行/2 文件单命令）**。**对抗评审 6 维 scoped → 0 confirmed defect**（cycle 全 3 态可达·wrap·indexOf -1 兜底回 live[类型约束实不可达] / 持久化 reload 后读回·非法值回退 live / 非数据安全零 vault 写·无 active file 可执行 / 命令+i18n / Obsidian 映射偏差已记录 / 分层·defaultNewTabMode 非死设置[workspace.openFile 消费+SettingsModal 反应式]）。**矩阵附带**：补录 R185 §5 功能区/行号/行宽/拼写检查 4 项 missing/partial→done（§5 done 9→13/partial 1/missing 0）。

### R194 套件回归（2026-06-24，G3 missing→done「清除笔记属性」· 表面复刻 G 系列 · data-safety 逻辑档 + byte 回归·复用 vetted properties 边界、零 compat 调用面改动 · 桌面 probe N/A）

R194 = 按 R182 矩阵收割 §3「清除笔记属性」（Obsidian `editor:clear-metadata-properties`）。**非 compat-API 轮**（但 r30 properties 面板 + r126 frontmatter compat 复跑核验不退）。**详见 ARCHITECTURE「Round 194 additions」**：`core/properties.ts` 新增纯 `buildClearProperties`（复用 R22-vetted parseInternal/findBlock 边界删整 frontmatter 块、镜像 buildRemoveProperty 末项、`entries.length===0`→null）；`app/App.tsx` +1 命令（getActiveFileEditorView 读 doc→buildClearProperties→view.dispatch、active-file gated、undoable）；i18n +1 键 en+zh。

新增套件：`r194-e2e.mjs` **12/12**（命令注册+名称解析非裸键+无默认键 + 单/多属性→body only + frontmatter-only→空 + **body `[[link]] **bold** $math$` 逐字保留** + 无 frontmatter/前置内容/纯文本 no-op + **undo Ctrl-Z 恢复整块** + 无 page error）。**套件矩阵不回退**：**r30 25/25（properties 面板）**·r126 11/11（frontmatter compat）·r193 17/17·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯字符串 buildClearProperties 字节验证 + view.dispatch 复用 R22/R23 frontmatter 写→autosave[已覆盖]、无新 fs 写路径，同 R192）。**分档逻辑档（data-safety）→ data-safety skill 已跑**：reviewer 12 例对抗字节驱动证只删 `[parsed.from,parsed.to)`、body 逐字保留（body 内第二 `---` 取首闭合不误删 / 闭合 fence 超 20k→no-op 不删半块 / frontmatter 不在偏移 0→no-op / 空块·opaque·CRLF·CJK·EOF 无尾换行 全安全 / undoable / 无 TOCTOU / 无新写路径）。**对抗评审 6 维 → 0 confirmed defect**（data-safety 全证 / 命令双门控 no-op / PropertiesPanel 反应式删块后行 2→0 无 stale / 命令+i18n / Obsidian 忠实 / 分层）。简化门 **clean**（单函数+单命令、buildClearProperties 与 buildRemoveProperty 末项相似非相同、合并须改 diff 外既有码驳回）。**关键决策**：删 frontmatter 用 vetted properties 边界**非 Lezer 树**（R192 教训：Lezer 不模 frontmatter）。**v1 nuance**：opaque-only frontmatter 也清除=clear-ALL 语义（body 始终保留、非数据安全）。

### R193 套件回归（2026-06-24，G3 missing→done「书签命令组：移除当前文件书签 + 收藏所有标签页」· 表面复刻 G 系列 · 逻辑档[书签 persist 非 .md]·复用 vetted store、零 compat 调用面改动 · 桌面 probe N/A）

R193 = 按 R182 矩阵收割 §11「移除当前文件的书签」「收藏所有标签页」（Obsidian `bookmarks:unbookmark`/`bookmark-all-tabs`）。**非 compat-API 轮**（但 r158 书签 compat 套件复跑核验不退）。**详见 ARCHITECTURE「Round 193 additions」**：`app/App.tsx` 注册 2 命令复用 vetted 书签 store（unbookmark available=isFileBookmarked·复用 toggleFile；bookmark-all-tabs allTabs filePath 去重·复用 add 幂等，**零 core/bookmarks.ts 改动**）；i18n +1 键 en+zh。

新增套件：`r193-e2e.mjs` **17/17**（2 命令注册+名称解析非裸键+无默认键 + unbookmark 门控[未收藏 unavailable→收藏后 available→移除→再 unavailable] + unbookmark 非收藏 no-op 绝不误加 + bookmark-all-tabs 收藏 bm1/bm2/Welcome 全开标签 + **再运行无重复[幂等]** + 无 page error）。**套件矩阵不回退**：**r158 13/13（书签 compat internalPlugins）**·r190 14/14·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（命令路由平台无关 + 书签 persist 复用 R27/R158 vetted 路径[regEnqueue 串行化·vault-switch 守卫已覆盖]、无新 fs 写路径，同 R190）。**分档逻辑档→ data-safety skill 已跑**：书签写全复用 vetted persist（写 `.obsidian/bookmarks.json`=vault 文件 IO 非用户 .md）、零新写机制、循环 for-await add 无 persist 互踩（regEnqueue 单链串行）、add 容器级 dedup 幂等。**对抗评审 6 维 → 0 confirmed defect**（data-safety 全证 / unbookmark 双门控绝不误加 / bookmark-all-tabs allTabs·filter·Set 去重·空集 no-op / 命令+i18n / Obsidian 忠实 / 分层）。简化门 **clean**。**reviewer 记非缺陷 honest gap**：add 容器级 dedup vs isFileBookmarked 全树（文件仅在某分组已收藏时顶层再加=Obsidian 同文件可跨 group 并存既有行为）。**v1 defer**：bookmark-search（搜索 query 集成）。

### R192 套件回归（2026-06-24，G3 missing→done「清除格式」· 表面复刻 G 系列 · data-safety 逻辑档 + byte 回归·**对抗评审揪 2 CRITICAL 字节损坏全修**、零 compat 调用面改动 · 桌面 probe N/A）

R192 = 按 R182 矩阵收割 §2「清除格式」（Obsidian `editor:clear-formatting`）。**「字节风险高、单独轮」名副其实**。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 192 additions」**：`formatCommands.ts` `clearFormatting(view)` syntaxTree 节点级删完整包含选区的 Emphasis/Strong/Strikethrough/InlineCode 子 mark + **Geode overlay 排除**（hasLinkAncestor wikilink/embed/alias + protectedSpans frontmatter/findMathBlockRanges 块math/commentSpans[fence 感知]/inline math 正则）；i18n +1 键 en+zh。

新增套件：`r192-e2e.mjs` **28/28**（字节级 live CM view：GFM 原生 bold/italic/strike/code + **代码跨距字面 `*` 保[`` `a*b*c` ``→`a*b*c`]** + 部分选中不变[防残半标记] + 嵌套 `***bi***`→`bi` + **7 overlay 损坏场景全保**[`[[**x**]]`/`[[a|**b**]]`/`![[**x**]]`/`$a*b*c$`/`$a**b**$`/`$$..$$`/frontmatter `k: **v**`] + 混合 `[[**x**]] **y**`→`[[**x**]] y` + **3 comment[单行/跨行块/混合] + fence-内孤立 `%%` 不 over-protect** + highlight `==` defer 不动 + no-op + 无 page error）。**套件矩阵不回退**：**r33 37/37（format 引擎字节锁不退）**·r189 17/17·r191 15/15·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（syntaxTree+view.dispatch 复用 R33 派发[r33-probe 覆盖]、overlay 排除纯 JS 字符串/树扫描、无 fs/Rust/平台分支）。**分档逻辑档（data-safety）→ data-safety skill 已跑**。**对抗评审（同一 reviewer 三轮深挖）→ 2 CRITICAL confirmed 全修闭合**：① wikilink/math/frontmatter/embed/alias 内字面 `*` 误删（裸 syntaxTree 信 Lezer GFM 树、忽略 Geode 正则 overlay）→ hasLinkAncestor + protectedSpans 修；② `%%comment%%` 内字面 `*` 误删（同根因第二实例，第一轮修漏、第二轮补）→ commentSpans 修。**+2 minor**（均 under-removal 安全方向、非 corruption）：highlight `==` 不剥除=feature gap[Lezer 不误判 `==`]；INLINE_MATH_RE 过匹配 currency[已记录]，commentSpans-fence over-protect[已修]。简化门 **clean（2 遍）**。**方法论根因**：overlay 权威清单=reading-view pre-pass 的全部 literal 结构，补排除须逐项对照勿临时枚举（本轮典型打地鼠：漏 comment）。**v1 honest gap**：highlight `==` 剥除 / INLINE_MATH_RE currency over-match。

### R191 套件回归（2026-06-24，G3 missing→done「在上方/下方添加光标 多光标」· 表面复刻 G 系列 · 逻辑档[editor]·selection-only 无 .md 写、零 compat 调用面改动 · 桌面 probe N/A）

R191 = 按 R182 矩阵收割 §3「在上方/下方添加光标」（Obsidian `editor:add-cursor-above`/`-below`）。Geode 编辑器早开 `allowMultipleSelections`，仅缺命令入口。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 191 additions」**：`editorMotionCommands.ts` 新增 `addCursorVertical`（view.moveVertically 加副光标·边界 no-op·去重·新光标设 main 级联）+ 2 spec（无默认键）经既有 registerEditorMotionCommands 自动注册；i18n +2 键 en+zh。**仅改 selection 无 doc 写**。

新增套件：`r191-e2e.mjs` **15/15**（2 命令注册+名称解析非裸键+无默认键 + live CM view：cursor line2 col2→add-cursor-below 加 line3 同列[7,12]·连按级联 line4[7,12,17] + **doc 字节不变[selection-only 无 .md 写]** + add-cursor-above 级联上 + 顶行 no-op + 去重不重复加 + 无 page error）。**套件矩阵不回退**：**r51 10/10（motion 模块）**·r190 14/14·r33 37/37·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 CM selection 状态操作、零 fs/Rust/平台分支、data-safety skill 触发但实测无写路径，同 R188 fold）。**分档逻辑档（editor）→ data-safety skill 已跑**：reviewer 真驱动命令把副光标置 frontmatter 受保护 body-start（offset 17）+ 真键 Backspace 证闭合 fence 存活（R63 livePreview.ts:1400-1405 查每个 range）；add-cursor 无 `changes`/`docChanged=false`/零 autosave；多光标损坏面=R63 既有面未扩大。**对抗评审 6 维 → 0 confirmed defect**（data-safety 全证 / moveVertically goal-column·折行·Tab·CJK / 边界 no-op / create normalized 追踪 main / 命令+i18n / Obsidian 忠实）。简化门 **clean**（addCursorVertical 单算法、spec 箭头绑 forward 必需、纠正失效注释）。**既有口径**：CM defaultKeymap 早绑 `Mod-Alt-↑/↓`→addCursor（R63），R191 加的是命令面板可见+可重绑的具名 Obsidian-id 命令（无默认键=与 Obsidian 一致）、两入口无冲突。**v1 defer**：清除格式[字节风险高单独轮] / panel 新标签页变体 / theme:switch / 管理仓库 C1。

### R190 套件回归（2026-06-24，G3 ui-only→done「关闭其他标签页 / 关闭此标签页分组」· 表面复刻 G 系列 · 逻辑档[tab flush]·无新写路径、零 compat 调用面改动 · 桌面 probe N/A）

R190 = 按 R182 矩阵收割 §4「关闭其他标签页」「关闭此标签页分组」（Obsidian `workspace:close-others`/`workspace:close-tab-group`）。矩阵原标 missing，实为 **ui-only**（closeOtherTabs/closeAllTabs 早是 vetted workspace 方法、由标签右键菜单调用）。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 190 additions」**：`app/App.tsx` 紧邻 `app:close-tab` 注册 2 命令（镜像 getActiveTab 守卫、无默认键、复用 vetted closeOtherTabs/closeAllTabs，**零 workspace.ts 方法改动**）；i18n +2 键 en+zh。

新增套件：`r190-e2e.mjs` **14/14**（2 命令注册+名称解析非裸键+无默认键 + close-others 保活动 tab[3→1] + **close-others 跳 pinned[pin ra·active rc→保 ra+rc·闭 rb]** + close-tab-group 清空活动组[→0] + close 后 reopen-closed-tab 可恢复[recently-closed 由 close 路径喂] + 无 page error）。**套件矩阵不回退**：**r81 14/14（close-tabs 逻辑 tabIdsToClose 跳 pinned）**·r36 47/47·r37 36/36·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯命令路由平台无关 + close→flush 复用既有 vetted autosave 路径[r81/r16/r42 桌面已覆盖]、无新 fs 写路径，同 R184）。**分档逻辑档（tab 生命周期·flush）→ data-safety skill 已跑**：reviewer 追全链 close→`release()`→deferred-drop `flush()`（documents.ts:293-308=R16 type-then-close race 修复点）证关闭前 flush 未存编辑不丢 + 非活动 tab 早 flush（App.tsx:1496 仅渲活动 tab EditorPane）+ 批量关闭 id 先快照（closeTabBatch）无遍历竞态 + **无新写路径**。**对抗评审 6 维 → 0 confirmed defect**（data-safety 全链证 / getActiveTab 作用活动组 / 空·单·全 pinned no-op / id 唯一·无 hotkey·i18n / Obsidian 忠实[单 leaf=单组覆盖 close-others-tab-group]）。简化门 **clean**（getActiveTab 守卫=既有命令注册习语、抽 helper 越界+加抽象层驳回）。**v1 defer**：panel 新标签页变体 / theme:switch / missing 纯编辑（清除格式·多光标）/ 管理仓库 C1。

### R189 套件回归（2026-06-24，G3 partial→done「插入内部链接 wikilink」· 表面复刻 G 系列 · data-safety 逻辑档 + byte 回归、零 compat 调用面改动 · 桌面 probe N/A）

R189 = 按 R182 矩阵收割 §2 `partial`「插入内部链接」（Obsidian `editor:insert-wikilink`=`[[]]`，此前 Geode 仅 `editor:insert-link`=Markdown 链接）。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 189 additions」**（R186 同款扩 R33 引擎）：`core/format.ts` 新增纯 `insertWikilink`（镜像 insertLink、只替换 [from,to]、绝不 unwrap）+ FormatOp `wikilink` + applyFormatOp case；`formatCommands.ts` +1 spec（无默认键、Mod+K 仍归 insert-link）经既有 applyFormat 派发；i18n +1 键 en+zh。

新增套件：`r189-e2e.mjs` **17/17**（A 字节级纯 `__geodeFormat.apply` 探针：空选区→`[[]]` 光标居中 / 中位空选区插入 / `[[foo]]` 光标落 `]]` 后 / 中段包裹 span=[from,to] / **内容保留 `**bold**`→`[[**bold**]]`** / 非 toggle 机械嵌套 `[[[[foo]]]]` + B 命令注册+名称解析非裸键+**无默认键**+insert-link 仍 Mod+K 未被偷 + C live CM view 选区 `beta`→`[[beta]]` 余文逐字不变 + 无 page error）。**套件矩阵不回退**：**r33 37/37（format 引擎字节锁不退）**·r186 27/27·r188 14/14·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯函数 transform 字节探针验证 + 派发复用 R33 applyFormat→CM→autosave[r33-probe 覆盖]、无新 fs/Rust/平台分支，同 R186）。**分档逻辑档（data-safety）→ data-safety skill 已跑**：reviewer 手算 9 对抗 case（空/CJK/emoji 代理对/多行/含 `]]`/嵌套）证选区外字节逐字不动 + 无新写路径 + R23 只写 active-file view。**对抗评审 6 维 → 0 confirmed defect**（data-safety 选区外字节不动/cursor math 无 off-by-one/非 toggle/id 唯一·无 hotkey 冲突·i18n en+zh/FormatOp 穷尽门/Obsidian 忠实）。简化门 **clean**（insertWikilink 与 insertLink 相似非相同、合并需发明 marker 参数=加间接层驳回）。**v1 defer**：panel 新标签页变体[需主区视图类型] / theme:switch[语义待定] / missing 纯编辑（清除格式·多光标）。

### R188 套件回归（2026-06-24，G3 partial→done「折叠 / 展开分拆」· 表面复刻 G 系列 · 逻辑档[editor]·无 .md 写、零 compat 调用面改动 · 桌面 probe N/A）

R188 = 按 R182 矩阵收割 §15 `partial`「折叠」「展开」（Obsidian `editor:fold`/`editor:unfold`，此前均映射 Geode 单条 `editor:toggle-fold`）。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 188 additions」**：`features/editor/folding.ts` +2 薄包装 `foldAtCursor`→CM `foldCode`、`unfoldAtCursor`→CM `unfoldCode`（层级决策：App 层保持 @codemirror-free）；App.tsx +2 命令（`if(active)` 守卫、无 `available` gate、无默认键）；i18n +2 键 en+zh。

新增套件：`r188-e2e.mjs` **14/14**（2 命令注册+名称解析非裸键 + 无默认热键[Obsidian parity、CM keymap 拥有 Cmd-Alt-[/]] + 驱动 live CM view：光标置可折叠标题 → `editor:fold` 渲染 `.cm-foldPlaceholder` + **doc 字节不变[data-safety：view-only 无 .md 写]** + `editor:unfold` 移除占位 + 字节仍不变 + fold/unfold 与 toggle-fold 效果一致 + graph tab 无 active view → 守卫 no-op 不抛 + 无 page error）。**套件矩阵不回退**：r187 29/29·r186 27/27·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 CM view 状态操作、零 fs/Rust/平台分支、data-safety skill 触发但实测无写路径，同 R181/R183/R185）。**分档逻辑档（碰 editor → 底线①强制）→ data-safety skill 已跑**：reviewer 追到 gate `documents.ts:85-97`「`if(!update.docChanged) return`」证 fold 事务 `docChanged=false` 永不达 dirty/autosave/关窗 flush 分支；`foldEffect` 无 `changes` 不污染 undo；复用 vetted `editor:toggle-fold` 同款 CM 命令零新写机制。**对抗评审 7 维 → 0 confirmed defect**（无 .md 写[gate 追踪]/映射无张冠李戴/`if(active)` 守卫/折叠基建无回归/App CM-free 层级/命令+i18n 对齐/Obsidian 忠实）。简化门 **clean**（薄包装受 ARCHITECTURE 冻结层级豁免、内联会破 App CM-free 边界）。**v1 defer**：panel 新标签页变体 / theme:switch[语义待定] / insert-wikilink 分拆 / missing 纯编辑（清除格式·多光标）。

### R187 套件回归（2026-06-24，G3 partial→done「方向性聚焦标签页组」· 表面复刻 G 系列 · 非数据安全逻辑档、零 compat 调用面改动 · 桌面 probe N/A）

R187 = 按 R182 矩阵收割 §4 `partial`「聚焦上方/下方/左侧/右侧标签页组」（Obsidian `workspace:focus-{top,bottom,left,right}-tab-group`）。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 187 additions」**：`core/workspace.ts` 新增纯 `FocusDirection`/`LeafRect` + 纯 `leafRects`（split 树→归一化矩形）+ 纯 `directionalPaneTarget`（方向边界判据 + 跨轴重叠选最近邻 + (主距,跨距,布局序) 稳定排序）+ 方法 `focusDirectionalPane`（复用既有 setActivePane、无该向邻居 no-op）；App.tsx +4 命令（无默认键）；i18n +4 键 en+zh。

新增套件：`r187-e2e.mjs` **29/29**（4 命令注册+名称解析非裸键 + 4 命令无默认热键[Obsidian parity] + 单窗格 no-op + 构 `row[col[A,C],B]` 布局 + 几何独立重算交叉验证[A 左上/C 左下/B 右满高] + 11 条方向焦点[A→右=B·下=C·左·上 no-op / C→上=A·右=B·下·左 no-op / B→左=A 布局序 tiebreak·上·右 no-op] + 无 page error）。**套件矩阵不回退**：r185 19/19·r36 47/47·r37 36/36·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 in-memory 窗格状态算法、adapter 无关[MemoryVaultAdapter≡TauriVaultAdapter 窗格树同构]、零 fs/Rust/平台分支、非数据安全，同 R183–R186 纯命令轮先例）。**分档逻辑档（非数据安全：workspace.ts 仅读 root/写 activePaneId，未碰 markdown/vault/documents/editor 管线/文件 IO）→ data-safety skill 不触发；新增几何算法 → 满跑对抗评审 8 维 → 0 confirmed defect**（reviewer 构 `row[col[A,C],col[D,B]]` 角接触反例证 `overlap<=EPS` 剔除对角 pane / tiebreak 布局序确定性 / no-op 短路零副作用 / 复用 setActivePane 无回归 / 命令+i18n 对齐 / Obsidian 词汇映射无错位 / 分层 clean）。简化门 **clean**（冻结公共纯函数不得内联 / 4 register 块 <8 行结构各异抽 helper=加间接驳回）。**v1 defer**：panel 新标签页变体 / theme:switch[语义待定] / fold-unfold 分拆 / insert-wikilink 分拆 / missing 纯编辑（清除格式·多光标）。

### R186 套件回归（2026-06-24，G3 missing→done「设为小标题 1-6 + 移除小标题」· 表面复刻 G 系列 · data-safety 逻辑档、零 compat 调用面改动 · 桌面 probe N/A）

R186 = 按 R182 矩阵收割 `missing` 纯编辑最高价值缺口（设为小标题 1-6 / 移除小标题）。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 186 additions」**：`core/format.ts` 扩 `setHeadingLevel`（固定级、复用 R33 去标记+lineEdit、仅改前缀 body 保留、no-op 守卫）+ FormatOp `heading-1..6`/`remove-heading`；formatCommands +7 specs 经既有 applyFormat 派发（无新写路径）；i18n +7 键 en+zh。

新增套件：`r186-e2e.mjs` **27/27**（A 字节级纯 `__geodeFormat.apply` 探针：set-1/3/6/重定级/移除/无标题移除 null/已是级 idempotent null/全空 null/**内容保留 `**b** x`→`## **b** x`**/多行/FormatEdit 整行 span + B 7 命令注册+名称解析非裸键 + 无 page error）。**套件矩阵不回退**：**r33 37/37（format 引擎字节锁不退）**·r32 24/24·r161 15/15·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯函数 transform 字节探针验证 + 派发复用 R33 applyFormat→CM→autosave[r33-probe 覆盖]、无新 fs/Rust/平台分支）。**data-safety skill 已跑**（内容保留仅前缀/idempotent no-op 守卫/复用 vetted 派发无新写路径/R23 双门控只写 active-file/字节回归全绿）。**对抗评审 8 维 → 0 confirmed R186 defect**。简化门 **clean**（toggleHeading 委托 out-of-round 驳回）。**继承 R33 限制（非新引入）**：`#tag`/frontmatter/代码围栏行误加 # 无块守卫（cycle 命令早有）。**v1 defer**：清除格式（字节风险高）、多光标。

### R185 套件回归（2026-06-24，G3 partial 校准「视图/外观切换命令 + 搜索默认键」· 表面复刻 G 系列 · 机械档、零 compat 调用面改动 · 桌面 probe N/A）

R185 = 按 R182 矩阵收割 `partial` 校准档纯前端子片。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 185 additions」**：`app/App.tsx` 注册 4 视图/外观切换命令（editor:toggle-line-numbers/readable-line-length/spellcheck + app:toggle-ribbon，回调 `setX(!X.get())` 翻转既有 appearance 设置）+ `app:show-search` 加默认键 Mod+Shift+F；i18n +4 键 en+zh。

新增套件：`r185-e2e.mjs` **19/19**（4 命令注册+名称解析非裸键 + show-search 有效键=Mod+Shift+F + 各 toggle 翻转正确 localStorage 键[null≡default 布尔比较]+round-trip + toggle 无需 active file graph tab 可执行 + 无 page error）。**套件矩阵不回退**：r79 21/21·r181 26/26·r183 11/11·r32 24/24·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯前端外观切换=localStorage+反应式重配、零 fs/Rust/平台分支，同 R181/R183）。**分档机械档 → scoped 窄域 review 0 confirmed defect**（i18n en+zh 各 2·4 id 各唯一·hotkey 无冲突·store/setter 配对 e2e 验正确）。简化门机械档跳过。**v1 defer**：theme:switch（语义待定）、toggle-default-new-tab-view（三态非布尔）、panel 新标签页变体/方向性聚焦（新逻辑）、missing 纯编辑（编辑器写 data-safety）。

### R184 套件回归（2026-06-24，G3 ui-only→done「文件操作命令化 duplicate/rename/move/new-folder」· 表面复刻 G 系列 · data-safety 逻辑档、零 compat 调用面改动 · 桌面 probe N/A）

R184 = 按 R182 命令矩阵收割 `ui-only→done` **余四项文件操作**——至此矩阵 ui-only 6 项全清（R183 纯 2 + R184 余 4）。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 184 additions」**：workspace +`explorerFileAction` 一次性 Store + 4 命令（矩阵指定 id）→ Explorer `findNode` + 消费 effect 路由到既有 vetted 处理器（makeCopy R42 / startRename→R16 / setMovePath→R28 / newFolder R17），**无新写路径**；命令名复用 R179 i18n（零新增）。

新增套件：`r184-e2e.mjs` **22/22**（4 命令注册+名称解析+gating[3 active-file 门控、new-folder 不门控] + duplicate 经 makeCopy 建 `<name> 1.md` 源不动 + rename 开 inline input 命中 active 行 + Escape 取消文件不变 + move 开 move-to-modal + Escape 关 + new-folder 经 createFolder 建文件夹+rename input + **StrictMode mount-path 单触发守卫**[切走 explorer→exec duplicate→无 `<name> 2.md`] + graph 无 active gating false + 无 page error）。**套件矩阵不回退**：r93 22/22·r140 18/18·r97 15/15·r180 12/12·r183 11/11·r179 10/10·typecheck 0/cargo check/生产构建 + 命令面板截图。**桌面 probe N/A**（写经 makeCopy createBinary[r42-probe]/newFolder createFolder/rename R16[r70-probe]/move R28 vetted 已覆盖、bridge 无新 fs 路径、命令路由平台无关，同 R161）。**data-safety skill 已跑**（A.3 rename 不丢编辑/duplicate flushAll 字节拷贝源不动/R23 捕获 path 无 stale-latch/无新写路径）。**对抗评审 10 维 → 1 MAJOR confirmed 已修**：StrictMode mount 双触发写型一次性消费（闭包读→`.get()` 现读修复）+ mount-path 守卫断言。简化门 **clean**（fresh code-simplifier：3 命令抽 helper=SIMPLIFY-NO⑤ 加抽象+违约定）。

### R183 套件回归（2026-06-24，G3 ui-only→done「复制路径/复制 Obsidian URL 命令化」· 表面复刻 G 系列 · 逻辑档、零 compat 调用面改动 · 桌面 probe N/A）

R183 = 首次按 **R182 命令矩阵**（用户交付 `docs/G3-命令复刻矩阵.md`，权威源 `../reference/` 16 张热键截图——reference/ 在仓库上一级、磁盘可读，R179-181「不在仓库」系发现性误报）收割 ui-only→done 最快档的**纯档两项**。**非 compat-API 轮**。**详见 ARCHITECTURE「Round 183 additions」**：`app/App.tsx` 注册 `file-explorer:copy-path` + `workspace:copy-url`（矩阵指定 id），active-file + 复用 R179 core `buildOpenUri` + R179 i18n 键，app-local `command-notice` toast（独立 class 防与 Explorer toast 互删）。

新增套件：`r183-e2e.mjs` **11/11**（2 命令注册 + 名称解析非裸键 + copy-path→剪贴板得库内路径 + command toast 现 + copy-url→`obsidian://open?vault&file`[.md 去除·vault 匹配·`/`→%2F] + available 在 graph tab 无活动文件为 false + 无 page error；剪贴板 R77 monkeypatch 捕获）。**套件矩阵不回退**：r181 26/26·r179 10/10（Explorer copy toast 仍工作）·r32 24/24·r161 15/15（命令面板/注册）· typecheck 0/cargo check/生产构建 + 命令面板截图证。**桌面 probe N/A**（纯 app-level 命令=读 active path+剪贴板+DOM toast、零 fs/Rust/平台分支，同 R179/R181）。**分档逻辑档 → 对抗评审 7 维 1 minor confirmed（已修：toast class 互删→独立 command-notice class）+ 余证伪**。简化门 **clean**。**v1 defer（R184）**：矩阵 ui-only 余四项 duplicate/rename/move/new-folder（data-safety + Explorer-node-bridge）。

### R181 套件回归（2026-06-23，G3「侧栏面板 Show 命令组」· 表面复刻 G 系列 · 机械档、零 compat 调用面改动 · 桌面 probe N/A）

R181 = 表面复刻 **G 系列**（向 G3「热键 90→280」推进——补真 handler 命令、不做空行）。**非 compat-API 轮**。**Gate（R160）**：命令清单实查（grep 全 82 id）证面板齐全但仅 footnotes/outgoing-links 有命令 → 补 6 个 `app:show-*`（file-explorer/search/backlinks/outline/tags/all-properties），回调单调用既有 setLeft/RightPanel（同开侧栏）。**详见 ARCHITECTURE「Round 181 additions」**。

新增套件：`r181-e2e.mjs` **26/26**（6 命令全注册 + 名称解析非裸键[i18n en 存在] + 4 右面板命令切 rightPanel + 开右侧栏[先 toggle 关再验开] + 2 左面板命令切 leftPanel + 开左侧栏 + show-outline 无 available 门恒可执行 + 无 page error）。**套件矩阵不回退**：r32 24/24·r142 18/18·r161 15/15·r113 10/10（命令面板/命令注册）·r180 12/12（上轮 reveal 命令）· typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 UI 面板切换命令 = workspace state、零 fs/Rust/平台分支，同 R164/R179/R180）。**分档机械档 → scoped 窄域 review 0 confirmed defect**（i18n en+zh 各 2 全在 · 6 id 各唯一 · panel-id typecheck 强校验）。简化门 **机械档跳过**。**v1 defer**：fileproperties（属性内联编辑器）、calendar（插件自带）、search 命令不强制 focus 输入框。

### R180 套件回归（2026-06-23，G4-b「Reveal active file in navigation 命令」· 表面复刻 G 系列 · 纯 UI、零 compat 调用面改动 · 桌面 probe N/A）

R180 = 表面复刻 **G 系列**（G4 续片 + 一条真 handler 命令）。**非 compat-API 轮**。**Gate（R160）**：explorer 实查证 Explorer 仅高亮活动文件、无「展开+选中+滚动到活动文件」命令（滚动 effect 由 selected 驱动非 activeFile）→ 命令完全缺失（grep 零）。**实现/根因详见 ARCHITECTURE「Round 180 additions」**：workspace 新增 `revealInExplorer` 一次性 Store（R14 同型）+ `requestRevealInExplorer`（setLeftPanel("explorer")+set）；命令 `file-explorer:reveal-active-file`（Obsidian 同 id、available=getActiveFile!==null）；Explorer 消费 effect expandAncestors+selectOnly+rAF 强制滚动；i18n en+zh +1 键。

新增套件：`r180-e2e.mjs` **12/12**（前置：折叠夹+嵌套文件行不在 DOM + openFile 后仍不自动露出 → **执行命令后：左栏切 explorer + 嵌套文件行渲染[祖先展开] + 行 is-selected + 一次性 Store 消费后清 null** + **available() 在无活动文件[graph tab]时为 false** + 无 page error）。**套件矩阵不回退**：r93 22/22·r140 18/18·r97 15/15·r179 10/10（Explorer 选择/菜单/上轮回归）· typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 UI expand/select/scroll + setLeftPanel + Store，零 fs/Rust/平台分支，同 R164/R179 先例）。**分档逻辑档 → 对抗评审 8 维 1 minor confirmed（已修：reveal 在「已选中但滚出视野」时 no-op → rAF 强制滚动）+ 余证伪**。简化门 **clean**（diff 35 行 <50 阈值）。**v1 nuance**：虚拟化+已选中+滚出视野三重边角 rAF 找不到行时不滚（极罕见）。

### R179 套件回归（2026-06-23，G4-a「文件右键菜单：复制库内路径 + 复制 Obsidian 链接」· 表面复刻 G 系列 · 纯前端、零 compat 调用面改动 · 桌面 probe N/A）

R179 = 表面复刻 **G 系列**（G4「右键菜单补齐」纯前端可先补子片）。**非 compat-API 轮**。**R160 纪律收获**：explorer 实查证命令面远比审计「90 vs 280」标题富——编辑格式（R33 formatCommands）/ 标签导航（go-to-tab-N）早已存在；G3「280 总表」正确下一步是先建命令矩阵、但权威源 `reference/04-热键命令` 当前不在仓库，故取**确认缺失**（grep 零命中）的 G4 copy 菜单子片。**实现/根因详见 ARCHITECTURE「Round 179 additions」**：core 新增纯 `buildOpenUri`（去 .md + encodeURIComponent，回环 parseObsidianUri+resolveLink）；Explorer 文件菜单 +2 项复用 R77 剪贴板 + 既有 toast；i18n en+zh +4 键。

新增套件：`r179-e2e.mjs` **10/10**（右键文件开菜单 + 含 copy-path/copy-obsidian-url 两项 + **Copy path→剪贴板得含 .md 的库内路径 + toast 现** + **Copy URL→`obsidian://open?vault&file` 且 .md 去除、vault 匹配 vaultName、`/`→%2F** + **file-only：文件夹菜单无此两项** + 无 page error；剪贴板用 R77 monkeypatch 捕获）。**套件矩阵不回退**：r93 22/22·r140 18/18·r97 15/15（Explorer 右键菜单结构回归）· typecheck 0/cargo check/生产构建。**桌面 probe N/A**（剪贴板 writeText + DOM 菜单 + 纯 URL builder、零 fs/Rust/平台分支；`navigator.clipboard.writeText` 在 WKWebView 经菜单点击用户手势可用，同 R77/R164 先例）。**分档逻辑档 → 对抗评审 7 维 0 confirmed defect**（回环/`.md` 边角/编码/分层/零 vault 写/i18n/图标/vaultName 全 clean）。简化门 **clean**（单薄包装、3 行样板 <8 阈值不抽）。**v1 defer**：文件夹右键此两项、命令版（菜单-only=faithful）、标签/编辑器菜单同项；toast 在 clipboard 失败仍显示（沿 blockRefCommands 约定）。

### R178 套件回归（2026-06-23，G2-a「设置弹窗视觉校准」· 表面复刻主线 G 系列第二项 · 纯前端、零 compat 调用面改动 · 桌面 probe N/A）

R178 = 表面复刻 **G 系列第二项**（G2「设置页视觉像素级校准」首个可验证子片）。**非 compat-API 轮**——不动 obsidian 兼容层调用面，只改 `features/settings` 设置弹窗的视觉 + 一处全局 modal CSS。**对 compat 套件矩阵零影响**。**实现/根因详见 ARCHITECTURE「Round 178 additions」**：① 修浅色「整窗蓝 focus ring」bug（`.modal-panel:focus{outline:none}`，根因＝`tabIndex=-1` 容器开窗 `.focus()` 触 WebKit UA outline；作用于所有 modal 根容器、交互子元素 focus 样式不受影响）；② 主题控件 segmented→原生 `<select data-testid=settings-theme-select>`（对齐 Obsidian「基础颜色方案」下拉、调既有 `setTheme`、移除旧 3 testid）；③ 弹窗 760→900 / 左栏 170→200 / 段标题加分隔线（颜色走 CSS 变量）。**⚠️ 根因教训（承接 R177）**：换设置控件型破 `r177`/`r79` 两套件 → 改 `r177` testid 断言 + `r79` `.click()`→`selectOption`；**G2 续做凡换控件型必同步扫引用该 testid 的旧套件**。

新增套件：`r178-e2e.mjs` **16/16**（**focus-ring**：modal 根开窗即获焦 + 获焦根 `outline-style:none`[无蓝环] · **主题下拉**：present + 是 `<select>` + 旧 3 segmented testid 全缺席 + 3 选项 system/light/dark + selectOption dark/light/system → `workspace.theme` 跟变 + select.value 回显 + **关窗重开仍回显持久 theme=dark（受控绑定未脱节）** · **视觉**：弹窗 offsetWidth>800 且 ∈[880,904] + 左栏 ∈[196,206] + 段标题 borderBottom solid 非 0 + 无 page error）。**套件矩阵不回退**：**改动 2 套件修复后全绿**（`r177` 52/52[theme testid 断言改]·`r79` 21/21[`.click()`→`selectOption`]）· r163 20/20（appearance nav 同面）· typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 React 设置弹窗 + CSS、平台无关、theme setter 是未改的 localStorage-backed `workspace.setTheme`、焦点环/宽度/分隔线纯 CSS、零 fs/Rust/平台分支，同 R177/R164 先例；WKWebView≡Chromium 对 `<select>`/`:focus` outline/CSS 尺寸同构）。**分档机械档 → scoped 窄域 review（testid/绑定/i18n/图标）0 confirmed defect**：旧 theme testid 仅在 r178 负向断言出现（验已删）· 主题 i18n 键 en+zh 全在（未新增）· 主题控件移除的 moon/sun/monitor 仅 Icon 字符串参（Icon 组件仍 6 处用、非死引用）· 全局 `.modal-panel:focus` 经 7 个 modal 用例核验只压制容器 outline、无交互子元素失焦环。简化门 **机械档跳过（Step 3.4）**。**v1 defer（G2 余项 = partial）**：字体「管理」弹窗（需系统字体枚举 = 功能、下子轮 G2-b）、控件原生阴影尺寸细抛光（无 reference 截图、低置信）、浅深主题逐项细校。

### R177 套件回归（2026-06-23，G1「SettingsModal 三段式 IA 重构」· 表面复刻主线首项 · 纯前端、零 compat 调用面改动 · 桌面 probe N/A）

R177 = 表面复刻 **G 系列首项**（✅ 用户拍板「完整复刻·表面优先」G1→G2→G3）。**非 compat-API 轮**——不动 obsidian 兼容层调用面，只重排 `features/settings` 的设置弹窗 IA（扁平 5 段 → 三组 12 段 + 控件迁回 Obsidian 同名页）。**对 compat 套件矩阵零影响**（compat 面未碰）。**实现/根因详见 ARCHITECTURE「Round 177 additions」**：12 段 SectionId + `NAV_GROUPS` 三组（选项/核心插件/第三方插件）、臃肿 `AppearanceSection` 拆 12 组件、迁控件保 store 绑定（reopen-回显 e2e 双证零丢值）、新增空页 `KeychainSection`、`app/icons.tsx` 补 lucide `key`。**⚠️ 本轮根因教训**：迁设置控件破 **15 个**「openModal 后直接点控件」旧套件（默认段仍 appearance、控件搬走）→ 全部补「先导航到目标段」修复（只加导航、零行为断言改）；**G2/G3 续迁设置面必须同步扫这批 UI-驱动套件**。

新增套件：`r177-e2e.mjs` **52/52**（三组导航+组标题`settings-navgroup-options/-core-plugins`+组顺序 + 12 段 nav 条目全在 + 默认段仍 appearance[r163 不变量] + 编辑器/文件与链接/模板/日记/唯一/页面预览/关于 各托管正确控件 + **appearance 不再含迁走的 line-numbers/attachment/language** + 钥匙串空态 + **DATA-SAFETY：editor 段 toggle line-numbers → aria-checked 翻转 + 写穿 `localStorage["geode.showLineNumbers"]` + 关窗重开仍回显持久值（读绑定未脱节）+ 还原默认** + R163 per-plugin tab 与新组共存 + 无 page error）。**套件矩阵不回退**：**15 个 UI-驱动套件修复后全绿**（r25 17/17·r48 13/13·r50 15/15·r53 11/11·r87 11/11·r88 13/13·r89 16/16·r92 21/21·r96 17/17·r153 8/8·r154 13/13·r155 11/11·r156 14/14·r157 12/12·r159 14/14）· r163 20/20·r145 15/15·r142 18/18·r166 18/18 · **r79 21/21·r85 21/21·r94 14/14·r100 15/15**（appearance 留存控件未动）· typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 React 设置弹窗、平台无关、setter 是未改的 localStorage-backed appearance/core/hover store、零 fs/Rust/平台分支，同 R164 先例）。**对抗评审 7 维 → 1 minor（key 图标静默回退，已修补 lucide path）+ 余证伪**。简化门 **clean（零编辑）**（7 段 `<section><h2>` 样板抽 wrapper = SIMPLIFY-NO 加抽象，STOP）。**v1 defer**：视觉像素级=G2、热键 280=G3、核心插件总览/开关页（需 enable 模型）。

### R176 套件回归（2026-06-22，Tier 8 D13「`Setting.addColorPicker` + `ColorComponent`」· compat ui.ts · 原生 `<input type=color>` + 自写 hex↔rgb↔hsl 转换 · 桌面 probe N/A）

R176 = 第八梯队 **D13**（2026-06-22 复核发现「全部清空」漏登的最后一个纯前端零依赖速赢）。**Gate（R160）**：explorer 实查确认 `addColorPicker` 确为静默 stub（reportGap 丢控件、回调参 `never`）、`ColorComponent` 类不存在、`type=color`/颜色转换全仓零命中（非误判）。**实现**：ui.ts 新增 `ColorComponent extends ValueComponent<string>`（原生 `<input type=color>` = hex source-of-truth、`change` 事件→`changeCallback?.(getValue())`）+ `RGB`/`HSL`/`HexString` 类型（逐字匹配 d.ts:1647/3498/5506）+ 4 自写转换 helper（hexToRgb/rgbToHex/rgbToHsl/hslToRgb + clampByte 2 调用点）；`addColorPicker` stub→`addControl(new ColorComponent(controlEl))`（删 reportGap）；barrel +ColorComponent（值）+3 类型。**对抗评审 7 维 → 0 confirmed defect（clean）**：① 契约逐字匹配 + barrel 值/type 正确 + loader `import *` 自动暴露；② **冻结不变量「setValue 绝不 fire onChange」成立**（三 setter 仅写 colorEl.value、唯一 changeCallback 路径=构造器原生 change 监听）；③ **颜色数学人工验算全对**（纯色/灰阶 d===0 不 NaN/hslToRgb hp∈[0,6) 无缺重档/h=360 wrap/round-trip e2e 选值无损非脆弱）；④ 原生 input `#rrggbb`-only 回落 `#000000` 已记 nuance、fixture 只喂合法 hex 故无假绿；⑤ 分层 clean；⑥ 回归面 clean（reportGap 其它调用方不动、无符号碰撞、IIFE try/catch 不中断 onload）；⑦ 零写路径非 data-safety 轮。简化门 **clean**（无死代码/脚手架/≥8 行重复、零编辑）。

新增套件：`r176-e2e.mjs` **16/16**（IIFE 无异常 + **addColorPicker 渲染原生 `<input type=color>`**[旧 stub 静默丢] + 回调收 ColorComponent 实例 + setValue("#ff0000")→getValue/getValueRgb{255,0,0}/getValueHsl{0,100,50} + **setValue 静默不 fire onChange** + setValueRgb{0,255,0}→"#00ff00"+hsl{120,100,50} + setValueHsl{240,100,50}→"#0000ff"+rgb{0,0,255} + **原生 change 事件 fire onChange 一次 + 值"#123456"** + setDisabled(true)→input.disabled + fixture 仍 enabled + 无 page error）。**套件矩阵不回退**：r174 14/14（同 fixture 文件）·r168 16/16·r167 25/25（同 ui.ts Setting/Component 面）·r113 10/10·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 JS + DOM 标准 web API：原生 `<input type=color>` + 内存颜色转换，零 fs/Rust/平台分支，WKWebView/Safari 18 支持 type=color，同 R167–R175 compat-shim 先例）。**v1 nuance**：① 原生 input 仅接 `#rrggbb`（3 位 hex/命名色/非法值浏览器回落 `#000000`；setValueRgb/Hsl 经 rgbToHex 必产 6 位故不受影响）；② onChange 绑 `change`（提交时）非 `input`（拖拽连续）——对齐 Obsidian ColorComponent 真实语义。

**🛑🛑 第八梯队【可纯自主 compat 完成的项现已真·全部清空】（R167→R176 十轮零回归，含 R176 补登的 D13）**：剩余 D6 lucide（硬边界#5 新依赖）/ D5 getResourcePath（Tauri asset、Rust/host）/ D8 editorInfoField 等 CM6 StateField（跨层 features/editor 喂值）/ D12-7 adapter.stat（Rust fs::metadata）/ D16-4 App.lastEvent（app-shell 事件捕获）/ D14 protocol 派发（host）—— 每项须用户拍板或跨层/host 大集成；C3/C1/C6/C7/C8 须先确认诉求。**下一个 loop 即取项落到「候选池补充」E4（图谱联动卡片，方案已定）/ E9（硬忽略，软忽略基建已有）。**

### R175 套件回归（2026-06-22，Tier 8 D15「Workspace 导航：openLinkText eState 子路径滚动 + getMostRecentLeaf + setActiveLeaf」· compat workspace.ts · 复用 R14 reveal 基建 + R171 parseLinktext · 桌面 probe N/A）

R175 = 第八梯队 **D15**（第八梯队最后一个纯前端中型项、零新依赖）。**Gate（R160）**：三子项全缺非误判（openLinkText 实现存在但 `.split("#")[0]` 丢 subpath + 忽略 openViewState）。**实现**：openLinkText 用 `parseLinktext(linktext.split("|")[0])` 拆 {path,subpath} + openFile 后 `resolveSubpath(resolvedPath, subpath.slice(1))`[去前导 `#`、保 `^`]→`if(span)`→`requestReveal(resolvedPath, from, to)`（逐字镜像 vetted `wikilinks.ts:29-38`、**vault.create 未解析分支字节未动**）；getMostRecentLeaf=返 activeLeaf facade；setActiveLeaf=sidebar→reveal/否则 no-op。**对抗评审 8 维 → 0 confirmed defect（clean）+ 红线全证伪**：# 形 slice(1) 只吃 `#` 保 `^`、reveal 用 resolvedPath、openFile 后时序对齐 R14 vetted、vault.create 字节未变（r71 17/17 证）、纯 subpath 自链接早退（nuance）、新建空文件 resolveSubpath 返 null 不 reveal、分层 compat→core 无 features import、两层 shim 共享同一 core Workspace。简化门 **删 1 行**（void openViewState no-op）。

新增套件：`r175-e2e.mjs` **10/10**（getMostRecentLeaf 非 null+object + openLinkText 无 subpath 开正确文件 + **#heading subpath 经 revealTarget Store 捕获断言 path 匹配 + 数值 span**[from>0,to>=from] + setActiveLeaf 不抛 + 无 page error）。**套件矩阵不回退**：r71 17/17（md 链接导航、openLinkText 改动验证）·r107 12/12（wikilink heading 补全）·r64 15/15（outline scroll-to-heading reveal 机制）·r174 14/14（同 fixture）·r113 10/10·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯导航/reveal 编排、reveal 滚动几何经 r64-probe[同 requestReveal 路径]覆盖、openLinkText 平台无关）。**v1 nuance**：纯 subpath 自链接 `#h` 早退不导航；openViewState 不消费 eState（subpath 来自 linktext 主源）；setActiveLeaf 非 sidebar no-op（单 active-pane facade、recorded deviation）；e2e 未测 `#^blockid`（slice(1) 保 `^`→resolveSubpath block 分支逻辑正确、下轮可补断言）。

**🛑🛑 第八梯队【可纯自主 compat 完成的项全部清空】（R167→R175 九轮零回归）→ loop 在 R175 后【暂停、交回用户定大方向】**：剩余 D6 lucide（硬边界#5 新依赖）/ D5 getResourcePath（Tauri asset、Rust/host）/ D8 editorInfoField 等 CM6 StateField（跨层 features/editor 喂值）/ D12-7 adapter.stat（Rust fs::metadata）/ D16-4 App.lastEvent（app-shell 事件捕获）/ D14 protocol 派发（host）—— 每项须用户拍板或跨层/host 大集成；C3/C1/C6/C7/C8 须先确认诉求。

### R174 套件回归（2026-06-21，Tier 8 D12+D16 中型纯 API 打包 · FileManager.getAvailablePathForAttachment/getNewFileParent + getLanguage + getIcon/getIconIds + Platform.resourcePathPrefix · compat 复用既有 core/compat · 桌面 probe N/A）

R174 = 第八梯队 **D12+D16 的 5 个纯 compat 子项**（复用既有 core/compat、零新依赖）。**Gate（R160：explorer 逐子项实查分类）**：D12/D16 混合难度 bundle → 挑纯 compat 可复用子集做一轮，**defer** D12-7 adapter.stat（须 Rust fs::metadata + 扩 VaultAdapter）、D16-4 App.lastEvent（须 app-shell 事件接线）。**实现**：D12-5 getAvailablePathForAttachment（拆 stem/ext→resolveAttachmentDir[R17/R97]→vault.createFolder→uniquePath[去重]）+ D12-6 getNewFileParent（resolveNewNoteFolder[R89]→registry.getFolder ?? ensureFolder(**false**)→TFolder，makeFileManager 加 registry 参）接进 Proxy；D16-1 getLanguage=locale.get()[@core/i18n]；D16-2 getIcon=getIconSvg→template 解析→SVGSVGElement instanceof 守卫 + getIconIds=BUILTIN+registered keys；D16-3 Platform.resourcePathPrefix=""。barrel +getLanguage/getIcon/getIconIds。**对抗评审 8 维 → 1 confirmed minor（已修）+ 红线全证伪**：minor=getNewFileParent 纯查询却 fireCreate=true 广播 phantom create 事件→修 false；**🔴 D12-5 createFolder data-safety 红线证伪**（Rust create_dir_all 遇同名文件返 Err 不删、Memory adapter 只动 folders set 不碰 files、复用 vetted vault.createFolder、零 .md 写）。简化门 **clean/skip**（5 项全薄 delegation）。

新增套件：`r174-e2e.mjs` **14/14**（getLanguage==="en"[预置 locale] + getIconIds 非空数组 + getIcon(builtin) 是 SVGSVGElement + getIcon(unknown)=null + Platform.resourcePathPrefix==="" + getAvailablePathForAttachment 返非空 .png 路径 + getNewFileParent 返带 .path 的 TFolder + fixture enabled + 无 page error）。**套件矩阵不回退**：r173 31/31（同 fixture）·r172 6/6·r113 10/10·**r89 16/16（newNote 位置）·r97 15/15（MoveTo/附件）**（复用基未坏）·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（唯一写 getAvailablePathForAttachment→vault.createFolder→Rust vault_mkdir 复用 R17/R48 probe-covered 路径、无新 Rust；getNewFileParent/getLanguage/getIcon/getIconIds/Platform 纯 JS、零平台分支）。**v1 nuance**：D12-5 不叠大小写不敏感去重/不串行化（路径建议非预留、实际写走 create_new 独占）；Platform.resourcePathPrefix="" 占位（真值待 D5）；getIconIds 同名覆盖出现两次 id（Obsidian 亦不去重）；getNewFileParent newFilePath 未消费（无按扩展名分流）。

### R173 套件回归（2026-06-21，Tier 8 D9「sanitizeHTMLToDom HTML 清洗器」· compat sanitize.ts · 保守 allowlist · 🔒 安全敏感 · 桌面 probe N/A）

R173 = 第八梯队 **D9 sanitizeHTMLToDom**（自写保守 allowlist 清洗器、零新依赖）。**Gate（R160 教训）**：compat 缺（grep 零、现有 sanitize* 无关）→ 须自写。**实现**（src/compat/obsidian/sanitize.ts）：`<template>.innerHTML` 惰性解析（inert、直返 fragment 防 mXSS）→ 迭代 TreeWalker（非递归防爆栈）→ 标签 allowlist（FORBID_DROP 整除 script/style/iframe/svg/math/form/audio/video 等 / ALLOWED_TAGS 洗属性 / 未知 unwrap）+ 属性洗（strip on*/style/非allowlist、URL 经 isSafeUrl[剥 `[\x00-\x20 ]` 控制字符 + scheme allowlist 只放 http/https/mailto/tel]、data-*/aria- 放行）+ 剥注释；barrel +1。**🔒 heavy XSS 对抗评审 → 0 可执行绕过（clean）**：reviewer 对 **live 编译代码实跑 ~50 向量电池**（每 payload adopt 进 live DOM + 300-500ms 查 window flag），全部脚本/事件未执行——标签整除、on* 全覆盖、scheme 拒、**控制字符+实体绕过全拦**（`java\tscript:`/`&#106;avascript:`/`&Tab;`/大小写）、namespace 混淆（svg>script/foreignObject）、非 URL_ATTRS 携 URL、unwrap 提升安全、mXSS、NUL→相对路径不可执行、5000 层深嵌套不爆栈；**元测试反证** e2e 的 did-not-execute 是真测执行（喂未清洗 onerror→150ms 内确实 fire）。简化门 **clean**（紧凑纯安全函数、allowlist/isSafeUrl/双 post-walk 循环/迭代 TreeWalker 全 load-bearing 不可减）。

新增套件：`r173-e2e.mjs` **31/31**（每危险向量 sanitize→**adopt 进 live DOM**→验脚本/onerror 不执行 + 危险标签/属性缺席 + 合法内容保留：script 整除+不执行 + img onerror 剥 + href javascript:/data:/`java\tscript:` 剥 + iframe/svg 整除 + 未知标签 unwrap 保内层 + style 剥 + class/data-/aria- 留+任意属性剥 + 注释剥 + **3 条 did-not-execute**[scriptDidNotRun/imgOnerrorDidNotFire/svgScriptDidNotRun] + 安全 href/相对 href 保留）。**套件矩阵不回退**：r172 6/6（同 fixture）·r171 14/14·r113 10/10·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 DOM 清洗、零 fs/Rust/平台分支、WKWebView≡Chromium）。**v1 nuance（保守取舍）**：拒所有 data:（含 data:image）、剥 style、form/input/audio/video 整除、svg/math 整除、协议相对 `//host` 放行（导航非脚本）、保留 id。**⚠️ 工程教训**：契约 isSafeUrl 正则误嵌字面控制字节→ARCHITECTURE.md 变 binary、plain grep 找不到节→doc 写控制字符范围用转义序列。

### R172 套件回归（2026-06-21，Tier 8 D11「MarkdownPreviewRenderer 静态 post-processor 类」· compat plugin.ts · 薄桥接 R132 核心注册表 · 桌面 probe N/A）

R172 = 第八梯队 **D11**（薄桥接既有 R132 核心注册表、零新依赖）。**Gate（R160 教训）**：① **D6 setIcon Lucide 撞硬边界 #5**（package.json 无 lucide、须用户拍板、本轮跳过上报）；② D9 sanitizeHTMLToDom 安全敏感 deferred；③ 选 D11（最贴薄桥接模式）。compat 缺 MarkdownPreviewRenderer；core `registerCoreMarkdownPostProcessor`（markdownPostProcessors.ts:94 返 disposer）+ `makeCodeBlockPostProcessor`（:124 纯 builder）已在。**实现**：plugin.ts 新顶层 `MarkdownPreviewRenderer`：`registerPostProcessor`（先拆旧同 pp 再 registerCore、存模块级 disposers Map）/`unregisterPostProcessor`（查 Map dispose+delete、未注册 no-op）/`createCodeBlockPostProcessor`（返 makeCodeBlockPostProcessor 纯工厂、不注册）；barrel +1。**对抗评审 8 维 → 0 confirmed defect（clean）**：registry 路由=与实例 registerMarkdownPostProcessor 调同一 core 函数（r132 11/11 不受影响双向证）；disposer Map dedup（重复注册先拆旧、与 Obsidian push 多次偏离=有意更安全 v1 nuance）+ 静态 API 无 plugin-unload 生命周期（须手动 unregister=Obsidian 同款 nuance）；createCodeBlockPostProcessor 纯工厂符合 createX/registerX 语义；实例版字节未动。简化门 **clean/skip**（纯加性薄类 + 1 import + barrel）。

新增套件：`r172-e2e.mjs` **6/6**（**静态 registerPostProcessor 路由核心注册表 → reading view `.preview-content` 带 data-r172** + unregisterPostProcessor 后强制重渲[preview→live→preview] 不再带 data-r172 + **createCodeBlockPostProcessor 纯工厂**[返 function、调用时 `<pre>`→`<div>` 变换、handler 跑 source="hello"] + 无 page error）。**套件矩阵不回退**：r132 11/11（实例 post-processor 不受影响）·r134 24/24（code-block builder 复用未坏）·r171 14/14（同 fixture）·r113 10/10·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（compat registry-bridge orchestration 平台无关，同 R113/R130/R132）。**v1 nuance**：disposer Map 重复注册 dedup；静态 API 卸载后须手动 unregister（Obsidian 同款）。

### R171 套件回归（2026-06-21，Tier 8 D3「prepareFuzzySearch/prepareSimpleSearch 模块级搜索函数」· compat ui.ts · 复用私有 fuzzyMatch · 桌面 probe N/A）

R171 = 第八梯队 **D3**（curry 既有私有 fuzzyMatch + 新薄 word-substring、零新依赖）。**Gate（R160 教训）**：compat 缺两者（grep 零）；ui.ts:483 私有 `fuzzyMatch(text,query):SearchResult|null`（substring 优先、否则字符 fuzzy、matches 已 `[start,end)`）+ `SearchResult{score,matches}`（ui.ts:472 已导出）。**实现**：`prepareFuzzySearch(q)=(text)=>fuzzyMatch(text, q.trim())`（同模块 curry 私有、不导出 fuzzyMatch）；`prepareSimpleSearch(q)`=token 按空白拆、每 token 必为子串否则 null、matches=[start,end) 按 start 排、`score-=at`；加 `SearchMatches`/`SearchMatchPart` 类型别名。**对抗评审 7 维 → 0 confirmed defect（clean）**：curry 无状态污染（prepared fn 多 text 复用）；**prepareSimpleSearch 重复/重叠/多次出现三边角全为可接受 v1 nuance**（renderMatches 尚未实现=无 consumer 受损，留待实现时在其内部去重/合并区间）；matches `[start,end)` 与 d.ts SearchMatchPart 一致；score 方向与 fuzzyMatch 一致（高=好）；元字符/CJK 安全（indexOf 字面量、无 ReDoS）；`fuzzyMatch` 仍私有 + `SearchResult`/`FuzzySuggestModal` 未动。简化门 **clean/skip**（纯加性 2 薄函数 + 2 类型别名 / ≤2 文件 / 无 existing-code 重构）。

新增套件：`r171-e2e.mjs` **14/14**（fuzzy substring 快路径 matches `[[0,3]]` + 非连续字符命中[`fb`→`foobar`] + 不匹配返 null + **prepared fn 可跨 text 复用** + simple 全 token 命中 + matchCount===2 + **matches 按 start 排序** + 缺 token 返 null + 两导出皆 function + fixture 仍 enabled + 无 page error）。**套件矩阵不回退**：r170 12/12（D9 math，同 fixture 文件）·r168 16/16·r113 10/10·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 JS 字符串匹配、零 fs/Rust/平台分支、WKWebView≡Chromium，同 R165/R167-R170）。**v1 nuance**：prepareSimpleSearch 是 word-substring（非 Obsidian 完整加权算法、够多数 picker 用）；后续实现 renderMatches 时在其内部去重/合并重叠区间。

### R170 套件回归（2026-06-21，Tier 8 D9「数学渲染 API 簇 renderMath/finishRenderMath/loadMathJax」· compat · 复用 core loadKatex · 桌面 probe N/A）

R170 = 第八梯队 **D9 renderMath/finishRenderMath/loadMathJax**（复用 core 已打包 KaTeX、零新依赖）。**Gate（R160 教训）**：compat 缺三者（grep 零命中）；core `loadKatex()`（core/math.ts:16 动态 import+缓存）+ embeds.ts hydrateMath 安全范例可复用。**关键设计 = sync-return + async-finish**（对齐 Obsidian 真实 MathJax 模型）：新 `compat/obsidian/math.ts`——`renderMath(source, display)` 同步返 `<span class="math math-inline/block">`+source fallback，异步 `loadKatex().then(katex.render(...,{displayMode,throwOnError:false,output:"html",maxSize:100[rule-bomb 防护]}))` 入模块级 `pending` 队列、render 后加 `is-loaded`、catch 兜底永不抛；`finishRenderMath()=Promise.all(pending.splice(0))`；`loadMathJax()=loadKatex().then(()=>undefined)`；barrel 一行再导出。**对抗评审 8 维 → 0 confirmed defect（clean）**：队列竞态证伪（push 早于 return → finishRenderMath 必捕获、无漏 await）、永不抛/reject、maxSize:100 DoS 防护 + textContent 非 innerHTML、契约逐字匹配 d.ts:3193/3854/5423。简化门 **clean/skip**（新 ~25 行薄适配 / ≤2 文件 / 无 existing-code 重构）。

新增套件：`r170-e2e.mjs` **12/12**（renderMath 同步返 HTMLElement + inline/block class + **非法 LaTeX renderMath 不抛**[throwOnError:false] + finishRenderMath resolve + **`.katex` 子元素 finish 后真实存在**[inline+block] + is-loaded class 加在返回元素 + loadMathJax resolve + fixture 仍 enabled + 无 page error）。**套件矩阵不回退**：r169 11/11（D7，同 fixture 文件）·r168 16/16（D1/D2/D10/D9-loadMermaid）·r113 10/10（compat boot）·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 JS + DOM 标准 API + 动态 import KaTeX，零 fs/Rust/平台分支，WKWebView≡Chromium，同 R165/R167/R168/R169）。**v1 nuance**：renderMath 同步返但 typeset 异步（调用方须 await finishRenderMath 后看结果——与 Obsidian 同契约）；KaTeX≠MathJax 极冷僻宏覆盖有别（throwOnError:false 优雅降级）。**v1 defer**：D9 sanitizeHTMLToDom（安全敏感）留后续轮。

### R169 套件回归（2026-06-21，Tier 8 D7「全局 sleep/nextFrame + Document.on/off 委托监听」· compat global/dom · crash-safety · 桌面 probe N/A）

R169 = 第八梯队 **D7**（复用既有 HTMLElement 委托机制、零新依赖）。**Gate（R160 教训）**：sleep/nextFrame 全仓零命中=完全缺（插件调全局 `sleep()` 直接 ReferenceError 崩）；Document.on/off 缺（dom.ts 只 patch 了 HTMLElement.prototype.on/off + DocumentFragment.find）；**关键复用**：Document.on/off 与 HTMLElement.on/off 委托逻辑 token 级相同 → 抽 `delegatedOn`/`delegatedOff` 模块函数两 prototype 共用（净减法、2 真实调用点）。**实现**：dom.ts 抽取 + `define(Document.prototype,{on,off})` + g block `g.sleep`/`g.nextFrame`（`()=>resolve()` 包装防 timer-id 透传）；global.d.ts `interface Document{on/off}` + `declare function sleep/nextFrame`。**对抗评审 8 维 → 0 confirmed defect（clean）**：抽取零回归（git diff 逐行字节等价 + e2e HTMLElement.on/off 回归锁）；Document 宿主 `_EVENTS` 实例属性不串台；`()=>resolve()` 包装必要（裸 `setTimeout(resolve,ms)` 透传 timer-id 破 Promise<void>，简化门独立确认）；ambient 无冲突（typecheck 0、lib.dom 无 jQuery 式 Document.on/全局 sleep）。简化门 **clean**（净 0 行；抽取=减法去重）。

新增套件：`r169-e2e.mjs` **11/11**（IIFE 无异常 + sleep(25)≥15ms + nextFrame resolve + **Document.on 命中 click fire 一次 + delegateTarget===匹配元素 + 非命中 click 不 fire + off 后不 fire** + **HTMLElement.prototype.on/off 抽取回归**[elOnFires/elOffFires] + fixture 仍 enabled + 无 page error）。**套件矩阵不回退**：r168 16/16（D1/D2/D10/D9，同 fixture 文件）·r165 9/9（compat shim + fixture 加载）·r113 10/10（compat boot）·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 JS + DOM 标准 API：Promise 定时器/委托监听，零 fs/Rust/平台分支，WKWebView≡Chromium，同 R165/R167/R168）。**§D 提示（非缺陷）**：`nextFrame` 依赖 `requestAnimationFrame`，桌面 probe 后台 t≈10s 后 await 它受 App Nap 可能不归来——断言放加载后前几秒。**v1 defer**：D9 renderMath/finishRenderMath（KaTeX 适配）、D9 sanitizeHTMLToDom（安全敏感）、D3 prepareFuzzySearch 留后续轮。

### R168 套件回归（2026-06-21，Tier 8 D 系列零依赖打包 · D1 apiVersion→1.8.0 + D2 parseLinktext + D10 base64 三件套 + D9 loadMermaid 再导出 · compat util · 桌面 probe N/A）

R168 = 第八梯队 **D1+D2+D10+D9-loadMermaid** 打包（纯再导出/极薄桥接、复用既有内部实现、零新依赖）。**Gate（R160 教训：explorer 逐项实查）**：D1 apiVersion 常量 util.ts:51 旧 "1.5.0"；D2 compat 缺 parseLinktext（getLinkpath 是 trim 半成品、语义不同）；D10 core/net 已有 bytesToBase64/base64ToBytes；D9 loadMermaid 实现已在 core/mermaid.ts:15 仅缺再导出。**实现**：D1→"1.8.0"（匹配已实现 1.7.x 全+早期 1.8.x、不虚高 appendBinary 1.12.3 仍 stub）；D2 `parseLinktext`（不 trim、subpath 含 `#`，对齐 Obsidian 真实源、与 getLinkpath 分立不合并）；D10 三件套桥接 @core/net（`.buffer` 无 slack 因 exact-size alloc）；D9 barrel `export {loadMermaid} from "@core/mermaid"`。**对抗评审 8 维 → 0 confirmed defect（clean）**——**D1 版本假承诺严格排除**（枚举全部 39 stub×引入版本：(1.5.0,1.8.0] 区间零 stub、所有 stub 均 >1.8.0 或 pre-1.0 era 既有，1.8.0=诚实最大值）；D2 与 Obsidian 真实源逐字节等价（10 边角实跑）；D10 `.buffer` 无 slack；D9 类型更精确子类型 + live `.render` 是 function（非 mock）；分层 compat→core 无循环。简化门 **clean/skip**（生产 diff ~20 行/≤2 文件/全薄包装）。

新增套件：`r168-e2e.mjs` **16/16**（IIFE 无异常 + apiVersion==="1.8.0" + **requireApiVersion("1.6.0")===true[对旧 1.5.0 回归]** + req("1.8.0")===true + req("1.9.0")===false + 4 parseLinktext 形状[含 subpath 含 `#`/空 path/空 subpath] + **base64 round-trip `[72,105,33]`→"SGkh"→还原** + getBlobArrayBuffer 字节保真 + **loadMermaid().render 是 function** + fixture 仍 enabled + 无 page error）。**套件矩阵不回退**：r167 25/25（AbstractInputSuggest，同 fixture 文件）·r165 9/9（compat global shim + fixture 加载路径）·r113 10/10（compat boot）·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 JS：版本常量/字符串拆分/base64/动态 import mermaid，零 fs/Rust/平台分支，WKWebView≡Chromium 标准 web API，同 R165/R167）。**v1 defer**：D7 sleep/nextFrame/Document.on/off、D9 renderMath/finishRenderMath（KaTeX 适配）、D9 sanitizeHTMLToDom（安全敏感）留后续轮。

### R167 套件回归（2026-06-21，Tier 7 B3① ＝ Tier 8 D4「`AbstractInputSuggest<T>` 输入框 type-ahead 基类」· compat · 零 CSS/零依赖 · 桌面 probe N/A）

R167 = 第七梯队 **B3①「补缺超类导出」** ＝ 第八梯队 **D4「`AbstractInputSuggest<T>`」**（合并做）。**Gate（R160 教训：explorer 实查）**：`AbstractInputSuggest` 完全缺失（compat 零定义/零导出，仅 vendored `.calibration/obsidian.d.ts:294-338` 有权威类型）；父类 `PopoverSuggest`（suggest.ts:37-63）已实现可直接 extends、CSS `.geode-suggest-popup .suggestion-item` 现成。**关键定位陷阱**：既有 `EditorSuggestManager.position()` 硬绑 CM6 坐标（`coordsAtPos`）→ 新类**绝不复用**、改用通用 `textInputEl.getBoundingClientRect()`、不进 manager（Obsidian 真实 AbstractInputSuggest 构造时自挂 input 事件、不经 registerEditorSuggest）。新 `AbstractInputSuggest<T> extends PopoverSuggest<T>`（suggest.ts，与 PopoverSuggest/EditorSuggest 同文件、不动 manager）：构造 `(app, textInputEl)` 挂 input/focus→重算、blur→close、keydown→Arrow/Enter/Escape；自包含浮层（token-guard async + rAF reposition + 外点关 + 幂等 close）；`getValue`/`setValue`（instanceof HTMLInputElement 守卫）；`selectSuggestion` 具体（onSelect 回调 + close）；`onSelect` 链式；barrel 一行导出。**对抗评审 9 维 → 0 confirmed defect（clean）**（生命周期=官方一致取舍 + document 监听 close 干净撤 + rAF 归零、async token-guard 同 SuggestModal 纪律、blur↔click 竞态 preventDefault 保焦 + close 幂等、**无意写路径 grep 实证证伪=非 data-safety 轮**、`_itemEls===_items` 不变量在 renderSuggestion 抛错下仍成立、`limit=0`=unlimited 贴官方 d.ts:297）。简化门 **clean**（净 0 行：与 manager/SuggestModal 同名方法仅相似非 token 级相同 + 既有两个 out-of-diff + 合并=加间接层 → 不抽）。

新增套件：`r167-e2e.mjs` **25/25**（初始无浮层 + focus→全列表 3 条[空查询] + type "ap" 过滤剩 2[apple/apricot 无 banana] + 首条默认 `.is-selected` + ArrowDown 移第 2 + **Enter→popup 关 + input.value 写回 "apricot"[setValue] + selected div="selected: apricot"[onSelect 触发]** + 清空 type "ba" 单条 **click 选中写回 banana** + Escape 关保值[Escape 关 popup 但保 input 焦点=对齐 Obsidian] + 外点关 + **fixture 仍 status "enabled"**[新 input suggest 不破插件] + 无 page error）。**套件矩阵不回退**：r165 9/9（compat global shim + fixture 加载路径，本轮扩展 fixture）·r113 10/10（compat boot）·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 JS + DOM 类、零 fs/Rust/平台分支；`getBoundingClientRect`/`focus`/DOM 事件是 WKWebView 与 Chromium 同构的标准 web API；同 R113/R116/R158/R159/R165 compat-shim 先例）。**v1 defer**：键盘不跑 scope._handlers 优先链（无已知 input-suggest 插件用）；不渲 instructions 条（Obsidian input suggest 无）；contenteditable div 锚点 getValue/setValue 支持但触发仍靠 input 事件。

### R166 套件回归（2026-06-21，Tier 7 B1 插件卸载入口 · PluginManager.uninstall · 删 .obsidian/plugins/<dir> · DATA-SAFETY 相邻 · 桌面 probe N/A）

R166 = Tier 7 **B1「插件管理面板·卸载入口」**（删除/卸载部分）。**Gate**：启停对齐 community-plugins.json（R4），grep 无 uninstall→缺。SettingsModal 给 obsidian 社区插件加卸载按钮 → `confirmDelete` → 新 `PluginManager.uninstall(id)`：removeRecord（停运行时）→ persistEnabled(false)（摘 community-plugins.json 钩子，避 core import compat）→ vault.remove(.obsidian/plugins/<dir>)。**v1 scope = 仅 obsidian**（external 无 id→file 映射 defer、builtin 打包、marketplace 越界）。**DATA-SAFETY 相邻**：**对抗评审 9 维 → 1 MAJOR（D1 已修）**：D1 = 删除路径用 manifest id 而非真实 `source.dir`（loader warn 二者可异）→ `dir!==id` 时漏删/错删另一插件配置（红线未破、仍封闭 `.obsidian/plugins/`）→ 修=`RegisterOptions` 加 `installDir`、删 dir 非 id。红线全证伪（dir 校验封死越界双层 + Rust safe_join；删除顺序停运行时优先；confirmDelete 弹窗）。简化门 clean。

新增套件：`r166-e2e.mjs` **18/18**（seeded obsidian 插件 enabled + 卸载按钮仅 obsidian[builtin 无] + 点击卸载→registry 移除 + **vault.remove spy 验封闭 `.obsidian/plugins/<dir>`** + 摘 community-plugins.json + **D1 dir≠id 删 folder 非 id 回归** + guard[builtin/nonexistent no-op] + 无 page error）。**套件矩阵不回退**：r113 10/10（compat boot、本轮动 loader register）·r163 20/20（settings IA、本轮动 PluginList）·r165 9/9（global shim）·typecheck 0/cargo/生产构建。**桌面 probe N/A**（orchestration 平台无关、e2e 验路径+guard；fs 删用既有 vault.remove→vault_delete[Rust safe_join + remove_dir_all]、r42/r140 delete probe 已桌面覆盖）。**v1 defer**：external/builtin 不可卸载、marketplace 浏览/安装。

### R165 套件回归（2026-06-21，Tier 7 B3③ `global` 垫片 · loader 注入 globalThis.global · 商业主轴 compat · 桌面 probe N/A）

R165 = Tier 7 **B3③「`global` 垫片」**（B3-附 表 ③ 出队）。**Gate**：Node-targeting 插件 bundle（obsidian-git 等）引用 Node 全局 `global` 作自由变量，`loader.ts` `new Function("require","module","exports", code)` 求值时崩 `Can't find variable: global`。修=`runLoad()` 在 moment 注入后加 `(globalThis as {global?:unknown}).global ??= globalThis`（求值前、幂等、cast 绕 TS7017）。**对抗评审 9 维 → 0 confirmed defect**；**最关键 = 假绿排除**（reviewer 实测 vite 无 global define/polyfill、`about:blank` global undefined、删 shim 即 `ReferenceError`、装即解 → shim 是唯一修复源）+ 副作用证伪（lodash/mermaid `typeof global` 守卫前后同解 window）+ 不垫 process/Buffer 取舍正确。简化门 skip（单文件 1 行）。bonus：native 插件 eval 也受益。

新增套件：`r165-e2e.mjs` **9/9**（window.moment 设[runLoad 跑] + `window.global===window` + `globalThis.global===globalThis` + `typeof global==="object"` + **复刻 loader exact eval** `new Function("require","module","exports","module.exports=global")`→exports===window + `?obsfixture=1` 回归 fixture status "enabled"[shim 不破 obsidian 插件加载路径] + 无 page error）。**套件矩阵不回退**：r113 10/10（compat boot）·r116 9/9（getMode compat）·typecheck 0/cargo/生产构建。**桌面 probe N/A**（纯 JS 全局赋值平台无关、WKWebView 语义一致；真实 obsidian-git 完整功能需 isomorphic-git+fs 另评）。**v1 defer**：只垫 global（不垫 process/Buffer）；obsidian-git 完整功能（isomorphic-git+fs/网络）= B3②④/新依赖远期。

### R164 套件回归（2026-06-21，Tier 7 C2 inline title 改名 · 复用 R16 renameWithLinkUpdate · DATA-SAFETY 轮 · 桌面 probe N/A）

R164 = Tier 7 **C2「编辑页内 inline title 改名」**。**Gate**：explorer 确认 inline title（R94）display-only，`renameWithLinkUpdate`（R16）+ Explorer RenameInput 模式全在，唯一缺口=让 inline title 可编辑。inline title 改可点击元素，提交走 `renameWithLinkUpdate`（**R16 vetted、绝不新起 vault.rename**：内部 flush 脏正文→改写链接→改名→`file:renamed` 自动跟 tab）。validate 镜像 Explorer.validateName（case-insensitive dup 守卫）。**DATA-SAFETY 轮**：**对抗评审 + data-safety 8 维 → 1 confirmed minor（D1 skipped-link notice 缺失，已修自写 notice）**；**关键澄清 = rename-over-existing 三重防护**（validate dup 守卫 + Memory adapter throw + Rust `to.exists()` 检查）+ renameWithLinkUpdate 抛错 catch → **零数据丢失路径、四底线守住**。简化门 clean（自纠注释脱节）。

新增套件：`r164-e2e.mjs` **16/16**（inline title 显 basename + 点击进编辑 input 预填 + Escape 取消 + 空名 is-invalid + dup is-invalid + invalid Enter 不改名/不覆盖 dup + commit 改名+**tab 跟随**+**内容保全**[无数据丢失]+**链接改写** `[[orig]]→[[renamed]]` + 同名 no-op + 无 page error）。**套件矩阵不回退**：r70 23/23（md 链接改写、本轮 onClick 走它）·r28 23/23（rename）·r94 14/14（inline title 显示，本轮扩展）·typecheck 0/cargo/生产构建。**桌面 probe N/A**（inline title UI 平台无关 DOM；fs 写经 R16 `renameWithLinkUpdate`=Explorer 已用 vetted 路径、r70-probe 已桌面覆盖）。**v1 defer**：commit 后焦点不回编辑器、case-only 改名引擎 throw no-op。

### R163 套件回归（2026-06-21，Tier 7 B2 插件设置「一个插件一个 Tab」· SettingsModal 左栏 per-plugin IA · 桌面 probe N/A）

R163 = Tier 7 **B2「插件设置：一个插件一个 Tab」**。**Gate**：explorer 确认机制全在（compat `addSettingTab`→core `addSettingsSection`→`settingsSections` Store + `PluginSettingsBody` 命令式挂载），唯一缺口 = IA（所有插件设置挤 Plugins 分组折叠卡片堆，非 Obsidian 左栏每插件一项）。改 SettingsModal 左栏为每个 enabled 插件 settingsSection 生成独立 nav 条目，点击右栏只渲该插件 `display()`（复用 `PluginSettingsBody`，`key` 保证切插件真卸载/挂载）。**纯前端 IA 重排零写**。**对抗评审 9 维 → 0 confirmed defect**（命令式 mount/unmount 生命周期、section 字符串协议无碰撞、fallback effect 无循环、enabled 过滤 + revision 实时增减、删 crammed 组零回归、死 CSS 删除安全、分层无 compat import）。简化门 1 减法（`pluginTab` 守卫→裸 find）+ 删 5 条 orphan 死 CSS。

新增套件：`r163-e2e.mjs` **20/20**（per-plugin nav 条目 + 固定 section 仍在 + 老折叠块缺席 + display() 仅选中时挂 + 切走卸载/切回重挂 + Plugins 段不再内联设置 + **cross-plugin A→B 切换卸载/挂载** + **live-add 条目**[revision bump] + **移除选中 section→fallback 回 plugins** + 无 page error）。**套件矩阵不回退**：r94 14/14（inline title/ribbon 显隐 settings）·r88 13/13（行号/默认视图 settings）·r92 21/21（Tab 缩进 settings）——固定 section 零回归·typecheck 0/cargo/生产构建。**桌面 probe N/A**（settings modal DOM IA、平台无关、无 fs/平台分支）。**v1 defer**：插件自定义图标（全用 puzzle）。

### R162 套件回归（2026-06-21，Tier 7 C4 收藏按钮显式 UI 入口 · 复用 R27 vetted toggleFile · 桌面 probe N/A）

R162 = Tier 7 **C4「收藏按钮显式 UI 入口」**。**Gate**：explorer 亲自 `rg` 确认无现存可见收藏按钮（只有命令 + ribbon 开面板）；R27 已有 `bookmarks.toggleFile`/`isFileBookmarked`/`items` Store 全部所需。**唯一缺口 = 可见 UI 入口** → editor-header 加星标 toggle 按钮，点击走既有 toggleFile（**R27 vetted 序列化 RMW、非新写路径**），`useStore(bookmarks.items)` 订阅实时刷新实心/空心。**对抗评审 + data-safety 8 维 → 0 confirmed defect**（toggleFile RMW 同步原子 + regChain 串行化、并发双击安全；CM EditorView/previewHtml deps 不含 bookmarks → 书签变化不重建 view/不重算阅读视图；per-file 绑定正确；attachment/graph pane 不渲此按钮）。简化门 skip（单文件 ~18 行加性单用按钮）。零 core/CSS/i18n 新增（复用 editor-mode-btn + cmd.bookmarkFile/unbookmarkFile + bookmark icon fill 切换）。

新增套件：`r162-e2e.mjs` **16/16**（按钮存在/可见 + 默认未收藏[aria-pressed=false/fill=none/无 is-active] + 点击 ON[filled accent] + 再点 OFF + **命令路径 live-sync 刷新按钮**[useStore 订阅] + **per-file 绑定**[切文件星标跟随] + graph tab 按钮 absent + 无 page error）。**套件矩阵不回退**：r27 22/22（书签 bi-directional 持久化、本轮 onClick 走它）·r158 13/13（书签 instance API）·typecheck 0/cargo/生产构建。**桌面 probe N/A**（按钮纯 DOM/UI 平台无关；toggleFile 写 `.obsidian/bookmarks.json` 是 R27 vetted 路径未改）。**v1 defer**：标签页/文件树行收藏入口（仅 editor-header 一处）、heading/block 级走命令。

### R161 套件回归（2026-06-21，Tier 7 A1 删除当前笔记命令 · 复用 vetted flush→trash · data-safety · 桌面 probe N/A）

R161 = Tier 7 **A1「删除当前笔记命令」`app:delete-file`**（Obsidian 真实 id）。**Gate**：explorer 亲自 `rg` 确认无现存删除命令（遵 R160 教训）。复用 Explorer 右键删除的 vetted 链 `await workspace.flushAll(); await vault.trash(path)`（R42 本地 `.trash/` 可恢复、非永久删）+ 删后 `file:deleted` 反应式关 tab/清索引。active 文件 `getActiveFile()`（markdown-only）+ callback 自守卫（`commands.execute` 不查 available）。确认弹窗抽出共享 `@core/confirm`（3 调用点：Explorer deleteNode/bulkDelete + 新命令）。**对抗评审 + data-safety 9 维 → 0 confirmed defect**（flush-before-trash 顺序、recoverable、删打开文件优雅清理、竞态[flushAll join in-flight + no-resurrect 守卫]、callback confirm-await 前捕获 path、对抗输入[basename 仅进文案、t() split/join 无注入]、Explorer 抽取零回归、分层无循环）。命令**无默认热键**（对齐 Obsidian）。

新增套件：`r161-e2e.mjs` **15/15**（命令注册 + available 真[md 活动] + 取消[dismiss confirm]保文件+tab + 接受[accept]trash 文件+关 tab + **listTrash +1=可恢复非永久删** + 确认文案含文件名 + available 假[graph 活动] + callback 自守卫[无 md 时 execute 不弹框不删] + 无 page error）。**套件矩阵不回退**：r140 18/18（Explorer bulk delete）·r138 11/11（Explorer delete）·r93 22/22（Explorer 右键菜单）·r42 17/17（回收站/恢复）——**`confirmDelete` 抽取零回归**·typecheck 0/cargo/生产构建。**桌面 probe N/A**（命令逻辑平台无关；`confirmDelete` native `ask()` + `vault.trash`→Rust `vault_trash` 是 Explorer 删除已用 vetted 路径、r42-probe/r140-probe 已桌面覆盖，未引入新 fs 写/平台分支）。**v1 缺口（gap 表）**：markdown-only——`getActiveFile()` 对 attachment/PDF/graph 返 null → 命令在非 md 活动 tab 不可用；Obsidian 的 delete-file 删任意类型 active 文件。attachment 删除 defer。

### R160 套件回归（2026-06-21，Tier 7 C5 侧栏可收起 · gate 纠误 · app-shell overlay · 桌面 probe N/A）

R160 = Tier 7 **C5「左右侧栏可收起」**。**Gate 纠误**：ROADMAP 第七梯队 C5「缺」是陈旧误判——explorer 实查发现 C5 **约 85% 早在 R2+ 落地**（state `leftSidebarOpen`/`rightSidebarOpen`[正向命名、已落盘]、`toggleLeftSidebar/Right`、命令 `app:toggle-left-sidebar`/`-right-sidebar`、`WorkspaceState` 持久化、`SidebarResizer` 拖拽调宽、ribbon 再点收起）。**唯一真缺口 = 没有专用可见折叠 affordance** → 本轮只补可见 toggle。**纯 app-shell DOM/CSS overlay 零 data-safety**（无 editor/vault/markdown/fs 写）。**对抗评审 7 维 → 0 critical / 0 major / 1 minor（M1=mid-height toggle 遮 editor 滚动条 → 各 toggle `margin-left/right:12px` inset 避让；关键风险「`.app-body{position:relative}` 改 containing-block」全证伪[每个 abs 后代已有更近 positioned 祖先、fixed 元素免疫]）**+ 简化门 1 减法（合并 transform 进基类）。命令**保持未绑键**（对齐 Obsidian 真实默认）。

新增套件：`r160-e2e.mjs` **24/24**（两 toggle 存在/可见 + 默认双栏开 + icon open 时内指[chevron-left/right=折叠] + open 时居 sidebar↔main 边界[centerX>300] + 点击折叠→栏 DOM 消失 + icon 外指[展开]+移向 ribbon[<100] + 再点展开恢复 + 右栏对称折叠/展开 + **reload 后仍折叠**[`geode.workspace.v1` 持久化] + icon 仍外指 + **命令 `app:toggle-left-sidebar` 仍可执行**[未绑键但 palette/commands.execute 可调] + 无 page error）。**套件矩阵不回退**：r100 15/15（tab/status bar 显隐 = app-shell 同区）·r81 14/14（tab 右键菜单）·r86 11/11（file properties）·typecheck 0/cargo check/生产构建。**桌面 probe N/A**（纯 DOM/CSS overlay + localStorage、平台无关，reviewer 证 Memory adapter 与 WKWebView 同构，沿 R150-R159 DOM-only 先例）。**v1 nuance**：默认无快捷键（用户在 Hotkeys 自绑，对齐 Obsidian）；toggle 为 mid-height 边缘 pill（Geode tab-bar per-pane 不宜放角 → 边缘 overlay 是解耦最优）。

### R159 套件回归（2026-06-21，compat daily-notes instance.options · 商业主轴 · 复用 R48 设置 · 纯只读 · 桌面 probe N/A）

R159 = compat **`app.internalPlugins.getPluginById("daily-notes").instance.options`**（`obsidian-daily-notes-interface` 读它=Calendar/Periodic Notes 依赖）。续 R158 instance 模式（niche compat，bounded 池枯竭后续做最高价值的两个 instance）。**Gate**：库 `getDailyNoteSettings()` 读 `instance.options={folder,format,template,autorun}`；R48 `core/dailyNote.ts` 已有 folder/format(moment、与 Obsidian 同 lib)/template Stores → 直接暴露。`plugin.ts`：`dailyNotesInstance={get options(){folder:RAW/format/template/autorun:false}}`(**live getter** 读 Store、非快照)；**重构 R158 两-id inline → 查找 record** `{bookmarks,daily-notes}`，`getPluginById/getEnabledPluginById` 用 `Object.hasOwn(record,id)?...:null`(**守卫防 `getPluginById("toString")` 命中原型方法**，R104 先例)，`plugins`=record(calendar `plugins["daily-notes"]` 得真 wrapper)。**纯只读零 data-safety**(读 3 setting Store、零写、比 R158 还干净)。**对抗评审 6 维全 CONFIRMED clean → 0 confirmed defect**(record 重构对 bookmarks 同对象引用零回归 + 守卫两 method 都在 + live getter 真[改设置 options 跟变] + folder RAW 匹配 Obsidian + 全仓零 `.plugins` 迭代者)+ 简化门 clean。

新增套件：`r159-e2e.mjs` **14/14**（getPluginById('daily-notes')→{enabled,instance} + options 默认 folder/format/template/autorun + **live 改设置 options 跟变无 reload** + `getPluginById('toString')→null`[原型守卫] + `getPluginById('nope')→null` + `plugins['daily-notes']===getPluginById(...)`[同 wrapper] + getEnabledPluginById + **R158 bookmarks instance 仍工作**[record 重构零回归] + 无 page error）。**套件矩阵不回退**：r158 13/13（bookmarks instance，record 重构零回归）·r113 10/10（compat boot）·r43 22/22（daily-note）·typecheck/cargo。**桌面 probe N/A**（纯 JS API shim 平台无关，同 R158/R113/R116）。**v1 defer**：autorun 恒 false；不暴露 instance 方法（getDailyNote=消费 lib 自 options+vault 算）；periodic-notes 检测。

### R158 套件回归（2026-06-21，compat bookmarks instance API · 商业主轴 · 复用 R27 原生库 · 桌面 probe N/A）

R158 = compat **`app.internalPlugins.getPluginById("bookmarks").instance`** 程序化 API（getBookmarks/addItem/removeItem/getItemTitle）。🛑 **赛道枯竭信号**：本轮 gate 横扫确认 Geode 近乎完整 Obsidian 平价（bounded 原生 + 大插件 API 全做）→ 转 compat 缺口表。**Gate**：缺口表 line 145 显式列此 instance API 仍缺；R27 已让 bookmarks.json 双向保真 + 原生 `BookmarksApi` 完整，只差暴露。**非公开 API**（不在 d.ts）→ de-facto 形状。`plugin.ts internalPluginsStub` 替：`getPluginById/getEnabledPluginById` 对 "bookmarks" 返 `{enabled,instance}`/instance、其余 null（calendar `plugins["daily-notes"]` 不动）；instance=getBookmarks(经 `serializeItem` map=canonical wire 形、重建 carrier)/getItemTitle(strip .md)/addItem→`bookmarks.add`/removeItem→递归 `bookmarkPath` value-match+`removeAt`。**写 delegate R27 vetted opChain=非新写路径**。**对抗评审 6 维 → 3 确认修+e2e 锁**：D1 MAJOR=`main.tsx` bookmarks.init 在插件 load 后→onload 期 store 空/addItem 丢→hoist `await bookmarks.init` 到插件块前；D2 MINOR=getItemTitle file 带 .md→`stripExtension`；D3 MINOR=未知类型 carrier sentinel `__geode_unknown_type__` 泄漏→export `serializeItem` 重建 wire 形。+ 简化门 clean。

新增套件：`r158-e2e.mjs` **13/13**（getPluginById('bookmarks')→{enabled:true,instance} + getPluginById('nope')→null + getEnabledPluginById + getBookmarks 数组 + addItem 后 getBookmarks 含之[写命中原生库] + ctime 保真 + removeItem 后移除 + getItemTitle file strip 扩展名/custom title/search query + 无 page error）。**套件矩阵不回退**：r27 22/22（书签 bi-directional 持久化、本轮写 delegate 它）·r113 10/10（compat 插件 boot、本轮动 main.tsx init 序）·typecheck/cargo。**桌面 probe N/A**（纯 JS API shim、平台无关，同 R113/R116/R130）。**v1 defer**：instance Events(`on`)/`editItem`/`bookmarkLookup`；其余核心插件 instance（daily-notes/global-search）。

### R157 套件回归（2026-06-21，笔记内嵌反链补 Unlinked mentions · 复用 core 扫描器 · 桌面 probe N/A）

R157 = **笔记内嵌反链补「Unlinked mentions」**（㊷ 收官，完成 R154——R154 in-document 区只做 linked，Obsidian「Backlink in document」还显未链接提及）。**Gate（一口气排除 10+「缺口实为已完成」）**：㊺ 外观=theme[R79 含 watchSystemTheme live-follow]/accent/fonts/font-size/readable-line/inline-title/ribbon/tab-bar/status-bar 全 done；properties-in-document[R22]done；unlinked mentions 在 BacklinksPanel 已 done[R82/R98] → 真缺口=接进 in-document 区。`core/unlinkedMentions.ts` 纯函数 `deriveMentionTerms(meta)`[标题+aliases]+`findUnlinkedMentions(content,meta,terms)`（core、features/editor 可 import；`buildSnippet` 是 panel feature-local 不可跨→自写极简 `lineSnippet`）。`BacklinksInDocument.tsx`：linked 段（原 getBacklinks sync）+ 新 unlinked 段=**eager async vault 扫描**（`useEffect([app,path,rev])` cancellation guard：唯一 `await vault.read` 后即 `if(cancelled)return`、终态 `setUnlinked` 前再 check、cleanup 置 `cancelled=true`）；`renderGroups(groups,prefix)` 两段共用[2 call-site dedup、linked 归一化成 `{sourcePath,snippets}`]；组件 render 条件改 linked‖unlinked 非空。**纯读零 data-safety**（vault.read 只读+findUnlinkedMentions 纯+openFile、零写、不动 markdown.ts、节点在 `.preview-content` 后=§C 不触）。**对抗评审 6 维全 REFUTED → 0 confirmed defect（clean）**（reviewer 证 cancellation 无 stale-path 泄漏 + `metadata.revision` 仅 per-debounced-save bump 非 keystroke[且组件仅阅读视图挂载=编辑期不扫]=perf 同 panel + lineSnippet 边界[from=0/行首/无尾换行]全对 + `:first-child` 去边逻辑成立）+ 简化门 clean。

新增套件：`r157-e2e.mjs` **12/12**（设置 ON 阅读视图显 linked 段[Solar System]+unlinked 段[Astronomy×2/Trivia]+计数 + snippet 行 + **linked 笔记 `[[Mercury]]` 被 mask 不进 unlinked** + 无关笔记两段皆无 + click unlinked source→openFile 导航 + 0 提及笔记无 unlinked 段[whole block 也无] + 无 page error）。**套件矩阵不回退**：r154 13/13（in-document linked，本轮扩展）·r98 15/15（unlinked panel，**未碰**）·r26-bytes 0（§C 不触）·typecheck/cargo。**桌面 probe N/A**（阅读视图 DOM + 扫描逻辑平台无关，同 R154）。**v1 defer**：lazy-on-expand perf / unlinked 段 collapse / click position 跳转 / 「Link」按钮。

### R156 套件回归（2026-06-21，编辑器「Fold heading」开关 · foldService compartment · Fold indent defer · 桌面 probe N/A）

R156 = 编辑器**「Fold heading」开关**（㊶，续编辑器设置 R153 auto-pair → R156 Fold heading）。**Gate**：候选 ㊶ indentation guides 经 gate 判**需新 CM 依赖=硬边界#5 弃**；改做 fold 设置（CM6 既有 foldService 零依赖）。**🛑 实现中 gate 抓硬约束→只交付 Fold heading、defer Fold indent**：`@codemirror/language` 的 `foldable()` 先试 `foldService` facet、**全返 null 才 fallback 到内置 `syntaxFolding`（读 grammar 的 foldNodeProp，无法经 facet filter 剥）**；lang-markdown 给「除 heading/list/Document 外多行 Block」挂 foldNodeProp → list item 内多行 Paragraph 经 syntaxFolding 仍折叠（foldService 返 null=不处理、非 veto）。禁它须改 parser foldNodeProp=动冻结 R17 fold 语言=出范围。**heading 不受此影响**（foldNodeProp 显式排除 heading）→ 只 gate heading。`appearance.ts` `foldHeading` Store（持久 `geode.foldHeading`、默认 ON=Obsidian）+ `folding.ts` markdownFoldRange 加 `foldHeadingOn=true` 参 gate heading 分支[ListItem 不 gate]+新 `markdownFoldService(foldHeadingOn)`[foldService 从 markdownFolding() 移出到 `foldServiceCompartment`、复用 R153 模式]+`foldAllInView` 读 foldHeading.get() + cmExtensions base-list compartment[活过 live↔source]+EditorPane reconfigure effect。**fold 纯视图态零 data-safety**（codeFolding 隐藏行不改字节、save 写全文、foldPersistence 不变、reconfigure 无 doc changes、不触 markdown.ts/r26-bytes）。默认 ON=逐字节同旧=零回归。**对抗评审 6 维 → 2 确认修+e2e 锁**：MAJOR=foldGutter 默认只在 fold-STATE 变时重算 chevron→toggle OFF 后 heading chevron 残留→修 foldGutter 加 `foldingChanged:(u)=>u.startState.facet(foldService)!==u.state.facet(foldService)`；MINOR=teardown 漏 null `foldServiceCompartmentRef`→补齐；余证伪 + 简化门 clean。

新增套件：`r156-e2e.mjs` **14/14**（默认 ON 标题折叠+gutter 2 chevron + Fold heading OFF→heading 无 fold/**chevron 即消失（无残留）**/列表仍折叠[证 heading-specific] + aria + 持久 false + 回 ON 恢复 + reload 持久）。**套件矩阵不回退**：r54 11/11（Setext/ATX fold 几何+live fold）·r29 19/19（fold 持久化）·r24 12/12（autosave/data-safety）·r153 8/8（closeBrackets compartment 同级）·typecheck/cargo。**桌面 probe**=设置 N/A（CM/localStorage、同 R153）+ fold 几何已由 r54-probe 真 WKWebView 覆盖（markdownFoldRange 3-arg 默认 foldHeadingOn=true 不变=零回归）。**defer**：Fold indent（CM syntaxFolding/foldNodeProp fallback 缠绕）/ indentation guides（需新依赖）。

### R155 套件回归（2026-06-21，Explorer「Detect all file extensions」开关 · 复用既有 .explorer-ext 徽章 · 桌面 probe N/A）

R155 = Explorer**「Detect all file extensions」开关**（㊽，换子系统：㊷ 反链[R154]→㊽ Explorer/Files 设置）。**Gate**：① Obsidian「Detect all file extensions」=Files & Links 设置、默认 OFF、效果=ON 时 markdown 笔记也显 `.md` 扩展名；② grep Geode 现状揭露**基础设施已在**——`vault.ts listTree` 已含 `files`+`binaryFiles`（Explorer 已显示所有文件、不按扩展名过滤）、`Explorer.tsx:804` 已把非 md 扩展名渲为独立 `.explorer-ext` 徽章（dimmed uppercase pill）、gate=`node.extension !== "md"` → **唯一缺口=ON 时让 .md 也显徽章=放宽一个 gate**。`appearance.ts` `detectAllExtensions` Store（持久 `geode.detectAllExtensions`、默认 OFF=Obsidian）+ Explorer `.explorer-ext` gate 改 `node.extension !== "" && (detectAll || node.extension !== "md")`+`data-testid="explorer-ext"` + SettingsModal「Files and links」节 toggle + i18n EN+ZH。**`.explorer-name`(=basename)+RenameInput initial 逐字不动 → 零回归、零 rename 影响**。**纯显示 toggle 零 data-safety**（localStorage flag + 放宽渲染 gate、不写 vault/.md、不动 markdown.ts/rename）。**对抗评审 6 维全证伪 → 0 confirmed defect（clean）**（reviewer 真值表逐 case 证 OFF 分支 `ext!=="" && (false||ext!=="md")` 与旧 `ext!=="md" && ext!==""` 代数等价=零回归、extensionless/dotfile 两态无徽章、renderNode 纯函数 toggle 即时刷新）+ 简化门 clean。

新增套件：`r155-e2e.mjs` **11/11**（默认 OFF→`.md` 行无徽章 + `.png` 行显「png」徽章 + toggle ON→`.md` 行显「md」徽章 + `.png` 仍显 + aria-checked + 持久 true + OFF 回退隐 md 徽章 + 持久 false + reload 持久 ON + 无 page error）。**套件矩阵不回退**：r91 10/10（Explorer 排序）·r96 17/17（excluded files dim）·typecheck/cargo 全绿。**桌面 probe N/A**（Explorer DOM 显示、平台无关逻辑，同 R150/R151 纯前端轮）。**v1 nuance**：Obsidian 把扩展名附进文件名文本（"Note.md"），Geode 沿用自身既有=独立 dimmed 徽章（"Note"+[MD]），内部一致、观察效果（md 扩展名可见）已交付。

### R154 套件回归（2026-06-21，反链笔记底部内嵌 Backlink in document · 阅读视图 DOM 追加不动 markdown.ts · 桌面 probe N/A）

R154 = **反链笔记底部内嵌「Backlink in document」**（㊷，换子系统：㊶ 编辑器设置[R153]→㊷ 反链增强）。**Gate**：WebFetch obsidian.md/help/plugins/backlinks 确认 Obsidian「Backlink in document」=阅读视图笔记底部显示 linked mentions（默认 OFF=opt-in）；grep 确认 `getBacklinks(path):BacklinkEntry[]` 含 `{sourcePath, contexts:[{snippet,from}]}`（snippet 已索引）→ 用**纯 core 数据**渲反链区、**不 import features/backlinks（守分层）、不改 markdown.ts（避 §C）**。`appearance.ts` `showBacklinksInDocument` Store（持久 `geode.backlinksInDocument`、默认 OFF）+ 新 `features/editor/BacklinksInDocument.tsx`（`useStore(metadata.revision)`+`getBacklinks`→header「Linked mentions {N}」+ 每 source basename + 每 context snippet、`navProps` 2-call-site dedup role=button/Enter/Space、click→`openFile`、0 反链返 null）+ EditorPane `.preview-content` 后 gated 渲染（reading mode only）+ SettingsModal toggle + i18n EN+ZH。**纯读 click→openFile 零 data-safety**（不写 .md/不触 autosave、节点在 `.preview-content` 后 = §C/r26-bytes 不触）。**对抗评审 7 维 → 1 MAJOR 确认修+截图锁**（D1=反链区作 `.preview-content` 同级兄弟没复制阅读列几何[列由 .preview-content 自身扛、`.editor-preview` 滚动容器无 padding]→满宽贴边错位+120px 空洞→照既有 `.editor-preview > .properties-panel` 先例收窄 `.editor-preview > .embedded-backlinks` 对齐 `--readable-line-width`+`.preview-content:has(+ .embedded-backlinks)` 收紧）+ 余 6 维（分层/§C/竞态/正确性/a11y/i18n）证伪 + 简化门 clean。

新增套件：`r154-e2e.mjs` **13/13**（默认 OFF 无区 + toggle ON 显区 + header 计数 2 + 两 source basename[去 .md] + context snippet + 每-source data-testid + click source→openFile 导航 + live 模式不显[reading-only] + 0 反链笔记不显 + reload 持久 false + 无 page error）。**套件矩阵不回退**：**r26-bytes 0 violation**（节点在 `.preview-content` 后、markdown.ts 字节不变=§C 不触）·r152 12/12（阅读视图 click 链）·r41 21/21（tags/backlinks 索引）。**桌面 probe N/A**（阅读视图 DOM、平台无关逻辑、WKWebView 渲染 App-Nap-不可靠 §D，同 R152/R29）。

### R153 套件回归（2026-06-21，编辑器 Auto pair brackets toggle · CM compartment · 桌面 probe N/A）

R153 = 编辑器**「Auto pair brackets」开关**（㊶，换子系统：㊻ 标签面板 3 轮收官→㊶ 编辑器设置）。**Gate**：grep 确认 Geode `closeBrackets()` always-on 但无 toggle；Obsidian「Auto pair brackets」是 ubiquitous Editor 设置（默认 ON、非 phantom）。**复用 R88 lineNumbers / R92 indent 的 CM Compartment 模式**：closeBrackets 移进 `closeBracketsCompartment` + `autoPairBrackets` Store（持久 `geode.autoPairBrackets`、默认 ON=零回归）+ `closeBracketsExtension(on)` helper（init+reconfigure DRY）+ EditorPane reconfigure effect + SettingsModal toggle。**纯 input-assist 零 data-safety**（toggle=localStorage、reconfigure 无 changes 不触 autosave）。**对抗评审 9 维全证伪 → 0 confirmed defect（clean）**（reviewer 查 CM 源码证 closeBrackets 位置上移行为中性=markdownWrap Prec.high 永先评估+字符集 disjoint）+ 简化门 clean。

新增套件：`r153-e2e.mjs` **8/8**（默认 ON 键入 `(`→`()` + `[`→`[]` + toggle OFF→`(` 不补 + 回 ON 恢复 + pref reload 持久）。**套件矩阵不回退**：**r35 25/25**（bracket-pair + backspace-delete + type-over，closeBrackets 移 compartment 行为保持）·**r24 12/12**（autosave/data-safety）·r88 13/13（lineNumber compartment parity）·r34 15/15·r92 21/21。**桌面 probe N/A**（CM 输入行为 + 设置 UI、浏览器 e2e 全覆盖，同 R88/R92）。

### R152 套件回归（2026-06-21，阅读视图 tag pill 点击 · 事件委托不动 markdown.ts · 桌面 probe N/A）

R152 = **阅读视图 `#tag` pill 点击→搜索**（㊻ 收官：R150 树 + R151 排序 + R152 pill 点击）。**Gate（§C 规避）**：grep `markdown.ts:1185` 确认阅读视图 #tag 已渲 `<span class="tag-pill" data-tag="<tag>">`（已有 class+data）→ EditorPane `onPreviewClick` **事件委托**加 `.tag-pill` 分支即可、**不改 markdown.ts 字节=不触 §C/r26-bytes**。分支早置（让 #tag in heading 搜索而非折叠）+ `!el.closest("a")` 守卫（pill 作 link 显示文本时 fall through 导航、匹配 heading/callout 同守卫）。`.tag-pill` 加 cursor:pointer+hover。**纯 click→requestSearch 零 data-safety**（同 TagsPanel sink）。**对抗评审 9 维 → 1 MINOR 确认修+e2e 锁**（F4=`[#tag](url)` pill 嵌 `<a>` 内、分支漏 `!closest("a")` 守卫吞 link 导航→加守卫）+ 余证伪 + 简化门 clean。

新增套件：`r152-e2e.mjs` **12/12**（pill 渲 + click→search + 嵌套 pill 全路径 + tag-in-heading wins over fold + heading text 仍 fold + **pill-in-link 导航不搜索**=F4 锁 + 非 pill no-op）。**套件矩阵不回退**：r29 19/19（阅读视图 click 链 heading-fold/internal-link）·**r26-bytes 0**（markdown.ts 字节不变=§C 不触）。**桌面 probe N/A**（阅读视图 DOM 委托、WKWebView 渲染 App-Nap-不可靠 §D、逻辑平台无关）。

### R151 套件回归（2026-06-21，原生标签排序菜单 · 桌面 probe N/A）

R151 = **标签面板排序菜单**（㊻ 续 R150 树）。**Gate**：WebFetch obsidian.md/help/plugins/tags 确认 Obsidian「Change sort order: Tag name / Frequency」（4 选项）。TagsPanel：`TagSortKey`(freq-desc/asc + name-asc/desc) + `buildTagTree(map, sortKey="freq-desc")` 参数化（`TAG_CMP[sortKey]` 每层重排）+ `sortKey` state（持久 `geode.tagsSort` inline raw localStorage、`isTagSortKey` **显式 4 值校验非 `v in TAG_CMP`** 防原型键 bug）+ panel-header `<select>` 4 option。**默认 freq-desc=R150 序逐字符同=零回归**。**纯 UI 排序零 data-safety**。**对抗评审 9 维全证伪 → 0 confirmed defect（clean）** + 简化门 clean（简化 agent 主动驳回 `v in TAG_CMP` 原型键 bug）。

新增套件：`r151-e2e.mjs` **13/13**（4 排序序 top-level + 子树 siblings 翻转 + **collapse 跨排序存活** + pref reload 持久 + 默认 freq-desc=R150 序）。**套件矩阵不回退**：r150 20/20·r41 21/21。**桌面 probe N/A**（纯前端排序 UI、无 fs/WKWebView 特异行为）。

### R150 套件回归（2026-06-21，原生标签树 · 桌面 probe N/A）

R150 = **标签面板嵌套层级树 + 折叠**（㊻ 原生功能，**脱离 R144–R149 六轮 compat 审计、转回原生候选池**）。**Gate**：WebFetch obsidian.md/help/plugins/tags 确认 Obsidian 标签面板「display nested tags as a tree」（折叠树 chevron + 排序菜单 name/freq）。TagsPanel 扁平→树：纯函数 `buildTagTree(getTagMap)` 按 `/` 拆段建树（phantom 父 + `split.filter(空段)` 防 malformed slash）+ 递归 `renderNode`（chevron 折叠 / leaf segment / click→search / ARIA role=tree+treeitem+group）+ per-session collapsed。**count**：real=exact / phantom=子树 distinct 并集（文档化）。**纯读零 data-safety**（rename 走 R69 vetted）。**对抗评审 9 维 → 2 MINOR 修+2 nit 采纳 + 余证伪 + 简化门 clean**。

新增套件：`r150-e2e.mjs` **20/20**（树渲 leaf segment + 父 chevron/叶无 + phantom aggregate count + 折叠隐展子树 + click→search + sibling sort + **malformed tag 无空名无撞键**）。**套件矩阵不回退**：r41 21/21（tags-pane section flat→tree 合法更新、仍测渲染/count/click→search）。**桌面 probe N/A**（纯前端树渲染、无 fs/WKWebView 特异行为，浏览器 e2e 全覆盖；同 R142/R143）。

### R149 套件回归（2026-06-21，平台分支委托 isModifier · 桌面 probe N/A）

R149 = compat **`Keymap.isModEvent` 补全**（续 R148——R148 reviewer 标的真缺口）。**Gate**：d.ts 注释逐字（'tab' if Mod OR 中键；'split' if Mod+Alt；'window' if Mod+Alt+Shift @0.16.0）+ grep 确认 **无内部调用者**（纯 compat API 补全、零内部行为改）。`ui.ts` isModEvent 重写：`mod=Keymap.isModifier(evt,"Mod")`（**复用 R148 平台感知 Mod**）→ most-specific first（Mod+Alt+Shift→window / Mod+Alt→split / Mod→tab / `evt instanceof MouseEvent && button===1` 中键→tab / else false）；`main.tsx` `__geodeKeymapIsModEvent` 钩子。**零 data-safety**（纯 static 读 event flag）。**对抗评审 9 维 → 1 MINOR 确认修+e2e 锁**：原 `mod=ctrlKey||metaKey`（跨平台 either-mod）与同类 R148 isModifier 平台感知不一致（mac Ctrl+click=OS context-menu 不该当 mod）→修=复用 `isModifier(evt,"Mod")`（平台感知+DRY+类内一致）、e2e 改平台无关 XOR；余全证伪 + 简化门 clean。

新增套件：`r149-e2e.mjs` **16/16**（平台 Mod XOR + Mod/Mod+Alt/Mod+Alt+Shift→tab/split/window + 非 Mod 键/无 mod/partial→false + 中键→tab/左右键→false + mouse Mod+Alt→split + most-specific 中键+mod 组合 win）。**套件矩阵不回退**：r148 14/14（Keymap isModifier 同文件、isModEvent 现复用之）·r51 10/10。**桌面 probe N/A**（isModEvent 把唯一平台分支[Mod]委托给 isModifier=r148-probe 已在真 mac 二进制验过 Mod=Cmd；其余 split/window/中键平台无关 if-cascade、浏览器 e2e 全覆盖）。

### R148 套件回归（2026-06-21，macOS release 二进制 v0.145.0 实测 `r148-probe-vault`）

R148 = compat **`Keymap.isModifier`（static）**（插件 API 商业主轴，续 R146/R147 surface 审计）。**Gate（d.ts + 范围裁剪）**：`awk` 提 Keymap 类确认四方法（`static isModifier`@0.12.17 / `pushScope`/`popScope`@0.13.9 / `static isModEvent` Geode 已有）。**只做 `isModifier`**——static、plugins 直接经类调、缺它即崩=真 crash-gap；**pushScope/popScope 故意不做**（已 no-op on `app.keymap`=keymapStub、Keymap 类 instance 方法 plugins 够不到=无调用路径=死代码，**reviewer 核验 SOUND**）。`ui.ts` Keymap 加 `static isModifier(evt,modifier):boolean`（switch Mod/Ctrl/Meta/Shift/Alt[Mod=`Platform.isMacOS?metaKey:ctrlKey`]+`default:return false` 防 untyped JS 传非法串返 undefined）+ `Platform` import；`main.tsx` `__geodeKeymapIsModifier` 测试钩子。**零 data-safety**（纯 static 读 event flag）。**对抗评审 8 维全证伪 → 0 confirmed defect（clean）+ 采纳 1 nit（default-case）** + 简化门 clean（2 文件）。

新增套件：`r148-e2e.mjs` **14/14**（Ctrl/Meta/Shift/Alt 各 flag→true + 非对应→false + cross + **Mod 平台键 XOR** + Mod neither/shift→false + **未知 modifier→false 不 undefined**）+ `r148-probe.mjs` **10/10**（真 WKWebView：各 modifier + **真 mac UA→isMac=true→Mod=Cmd(metaKey)** §D-safe 同步纯函数）。**套件矩阵不回退**：r51 10/10（Keymap isModEvent）。**informational（非本轮，未来审计候选）**：`isModEvent` 只返 `"tab"|false`、d.ts 是 `"tab"|"split"|"window"`+中键。

### R147 套件回归（2026-06-20，委托 R34 openSearchPanel · 桌面 probe N/A）

R147 = compat **`MarkdownView.showSearch(replace?)`**（插件 API 商业主轴，续 R146 surface 审计）。**Gate**：① d.ts `awk` 提 MarkdownView 类确认 `showSearch(replace?:boolean):void` 是 `@public`（d.ts:4233）；② Geode 现状——R34 有 editor find（CM `openSearchPanel`）+ compat `MarkdownView.editor.cm: EditorView`（public readonly），但 MarkdownView 没 showSearch→插件调即崩。compat MarkdownView 加 `showSearch(replace)`→`openSearchPanel(this.editor.cm)`（R34 同机制、同一 EditorView 实例）+ replace 时聚焦 replace 字段（5 行内联镜像 features `focusReplaceField`——compat 不能 import features、分层强制小 dup；**scope 到 `view.dom` 非 `document`**=split 内不抓兄弟编辑器面板）。`import openSearchPanel from @codemirror/search`（R34 既有 dep、**零新依赖**）。**零 data-safety**（开搜索面板=纯 display UI、不写文档；replace 实际替换走 R34 vetted CM 路径）。**对抗评审 8 维全证伪 → 0 confirmed defect（clean）** + 简化门 clean（1 文件）。

新增套件：`r147-e2e.mjs` **13/13**（showSearch() 开 `.cm-search` + Escape 关 + showSearch(true) 聚焦 replace + showSearch(false) 不聚焦 + **再入 open-only 保持开+聚焦**=采纳 reviewer 覆盖建议锁 open-only 语义 + 方法 shape）。**套件矩阵不回退**：r34 15/15（editor find/replace）·r116 9/9（MarkdownView getMode/getViewData）。**桌面 probe N/A**（showSearch 委托 R34 `openSearchPanel`——其 WKWebView 行为已由 r34-probe 验证；rAF 用户调触发非后台定时器=无 App-Nap 暴露）。

### R146 套件回归（2026-06-20，纯 React/core tab 状态 · 桌面 probe N/A）

R146 = compat **`WorkspaceLeaf.setPinned` + `togglePinned`**（插件 API 商业主轴，compat surface 审计轮）。**两道 gate 核查**：① stale-gap——HANDOFF 默认项 Properties 增强续经 grep 揭示全已实现（tags chip 搜索=R83、File properties 右栏=R86）或非 faithful（date→日记）→弃；② **compat surface 审计**——`curl` 全量 obsidian.d.ts（8482 行）`awk` 提类体 + `grep` 比对 Vault/Notice/MetadataCache/Component/Workspace/WorkspaceLeaf 等类 `@public` 方法 vs Geode（多数 R111–R144 已填），真·缺失且 bounded+faithful=`setPinned(pinned)`+`togglePinned()`（均 `@public`，Geode 有 R39 tab-pin 但 leaf facade 没暴露→插件调即崩）。compat WorkspaceLeaf 加两方法（操作 `findActiveTab` facade、复用 vetted `core/workspace.toggleTabPin`、setPinned **toggle-if-differs 幂等** `!!tab.pinned!==pinned`、零 core 改）。**零 data-safety**（纯 tab pin 态，toggleTabPin 仅改 pinned flag 无 .md/autosave 写）。**对抗评审 7 维 → 1 MINOR 确认修+e2e 锁**：`SidebarViewLeaf extends WorkspaceLeaf` 继承新方法无 override（而子类系统 override 每个 findActiveTab-based 方法防侧栏操作主区）→ `getRightLeaf(false).setPinned(true)` 会 pin 无关主区 tab→**修**=子类 no-op override（faithful=侧栏面板非可固定 tab）+ 3 e2e 锁；余全证伪 + 简化门 clean。

新增套件：`r146-e2e.mjs` **12/12**（setPinned true/false + 幂等双设 + togglePinned 翻转 + 方法 shape + **侧栏 leaf pin no-op 不动主区 tab**=F1 锁）。**套件矩阵不回退**：r39 17/17（tab-pin）·r137 13/13（WorkspaceLeaf setViewState）·r117 9/9。**桌面 probe N/A**（纯 React/core tab 状态、无 WKWebView 特异 DOM/fs 行为，同 R142/R143；浏览器 e2e 用真开 tab 全覆盖）。

### R145 套件回归（2026-06-20，纯前端设置 UI · 桌面 probe N/A）

R145 = 快捷键面板**「只显已分配」funnel 过滤 toggle**（续 R142 设置面增强）。**Gate 确认真实（防 phantom，R144 教训）**：WebFetch obsidian.md/help/User+interface/Hotkeys 逐字证实「To show only commands that have assigned hotkeys, select the **filter icon** in Settings → Hotkeys」→ Obsidian 真有此 funnel filter。HotkeysSection 加 `assignedOnly` state（per-mount 不持久=同既有文本 filter）+ rows filter 加 `&& (!assignedOnly || getEffectiveHotkey(id)!==null)` + 文本 input 包 `.hotkeys-filter-row`(flex) + funnel toggle 按钮；新 `filter` funnel 图标（icons.tsx）+ `settings.hotkeysAssignedOnly` i18n（EN+ZH）。**faithfulness 关键**=getEffectiveHotkey 覆盖 default hotkey + 用户 override 两者、**显式 unbind（override=null）→ 返 null → 过滤掉**（被移除默认的命令不出现在「只显已分配」）。**零 data-safety**（纯 UI 过滤态、无 localStorage、无 vault 写）。**对抗评审 8 维全证伪 → 0 confirmed defect（clean）** + 简化门 clean（0 编辑）。

新增套件：`r145-e2e.mjs` **15/15**（funnel 默认 OFF 显全部 + ON 只显有 effective hotkey 的命令 + OFF 恢复 + 与文本 filter 复合 AND + is-active/aria-pressed + **默认 hotkey 显示 / 显式 unbind(override=null) 隐藏**=采纳 reviewer 覆盖建议锁 faithfulness 分支）。**套件矩阵不回退**：r142 18/18（设置 modal nav + CommandPaletteSection 不受影响）。**桌面 probe N/A**（纯前端设置 UI，同 R142/R143）。

### R144 套件回归（2026-06-20，macOS release 二进制 v0.141.0 实测 `r144-probe-vault`）

R144 = compat **Menu 类 API 补全**（`static forEvent` + `setParentElement`，插件 API 商业主轴）。**Gate 否决 setSubmenu（反 completionism）**：HANDOFF 默认项 `MenuItem.setSubmenu`——`curl` 拉全量 obsidian.d.ts（8482 行）`grep setSubmenu`=**0 命中**、官方 docs MenuItem 页只列 8 方法（Geode 已全有）、setSubmenu dedicated 页「does not exist」→**不是 public API、不实现**（造它=反 faithful）。**但同次 d.ts 比对揪出两个真·缺失 `@public` Menu 方法**：`setParentElement(el): this`(@0.16.0) + `static forEvent(evt: PointerEvent|MouseEvent): Menu`(@1.6.0)——后者是 Obsidian 1.6+ 插件建右键菜单的**现代惯用法**（`Menu.forEvent(evt).addItem(…).showAtMouseEvent(evt)`），Geode 缺它→插件调用即崩。`ui.ts` Menu 加 `parentEl` 字段 + `static forEvent`（target 是 HTMLElement 则 setParentElement）+ `setParentElement`（存 + 返 this）+ `showAtPosition` append `document.body`→`(parentEl?.ownerDocument ?? document).body`（**单窗口逐字节零回归**=parentEl 默认 null、菜单 position:fixed 视口定位、CollectorMenu 是独立类不受影响）；`main.tsx` 加 `__geodeMenuProbe` 测试钩子（镜像 `__geodeProbeRenderChild` 先例）。**零 data-safety**（纯菜单 DOM UI）。**对抗评审 8 维全证伪 → 0 confirmed defect（clean）** + 简化门 clean（0 编辑）。**文档化 out-of-scope**（present-but-narrow，非本轮）：Menu 未 `implements HistoryHandler` + showAtPosition `{x,y}` 窄类型 vs `MenuPositionDef`（运行时无害）。

新增套件：`r144-e2e.mjs` **7/7**（forEvent 返 Menu 实例 + setParentElement 可链 + 菜单显示 DOM + item 点击 fire + 二次调用稳定 + 无残留菜单 DOM）+ `r144-probe.mjs` **7/7**（真 WKWebView `__geodeMenuProbe` §D-safe 同步：forEvent + setParentElement + 显示 + 点击 + 无泄漏）。**套件矩阵不回退**：r130 12/12（file-menu）·r131 7/7（editor-menu）·r139 14/14（files-menu）——三者用 Menu 类、showAtPosition append 改单窗口逐字节等价故零回归。

### R143 套件回归（2026-06-20，macOS release 二进制 v0.140.0 实测 `r143-probe-vault`）

R143 = 搜索**全局「Match case」开关**（Obsidian 搜索栏 `Aa`，续 R68 `match-case:`/`ignore-case:` 逐词运算符）。faithful WebFetch obsidian.md/help/plugins/search 确认：搜索栏有「Match case」开关、**默认 OFF**、ON=整条查询区分大小写。**关键设计**：开关只翻转 `default`-mode 词、显式运算符永远胜、**regex 词不受全局开关影响**（用自己 `/i` flag、bounded 不重编译）。`core/search.ts` 加可选 `evaluateSearch(expr,input,defaultCaseSensitive=false)`（**加性向后兼容**）+ `EvalCtx.defaultSensitive` + 私有 `caseSensitive(mode,ctx)=mode==="sensitive"||(mode==="default"&&ctx.defaultSensitive)` 替 4 处 `caseMode==="sensitive"`；`main.tsx` `__geodeSearchQuery` 探针加 3rd 参；`SearchPanel.tsx` `matchCase` state（持久 `geode.searchCase`）+ 常驻 `Aa` 按钮 + eval deps 加 matchCase。**双消费者**：SearchPanel（传 toggle）+ `core/queryEmbed.ts:60`（R75 query 嵌入，2-arg→缺省 false→逐字节同旧、永远 insensitive=faithful Obsidian 嵌入块无 per-block case UI）。**零 data-safety**（纯只读搜索 + localStorage pref，同 R80）。**对抗评审 8 维全证伪 → 0 confirmed defect（clean）** + 简化门 clean（0 编辑）。

新增套件：`r143-e2e.mjs` **23/23**（core：default 词跟随 flag + 显式 match-case:/ignore-case: 永胜 + basename/tag/property 跟随 + regex 不受 flag + /i 仍工作；UI：`Aa` 切换重扫 2→1 结果 + aria-pressed + pref reload 持久）+ `r143-probe.mjs` **14/14**（真 WKWebView 3-arg `__geodeSearchQuery` core 层全局开关 §D-safe 同步纯函数）。**套件矩阵不回退**：r68 40/40（搜索运算符核心）·r80 17/17（搜索面板工具栏）·r75 16/16（query 嵌入第二消费者，加性参逐字节同旧）。

### R142 套件回归（2026-06-20，纯前端 localStorage UI · 桌面 probe N/A）

R142 = 命令面板**固定命令 pinned**（Obsidian「Settings→Command palette」固定常用命令置顶，**命令面板故事收官**=R141 recent + R142 pinned）。faithful WebFetch 确认：设置页「New pinned command」Select-a-command picker + 「Pinned commands」叉号移除列表；pinned 仅空查询置顶在 recent 之上，输入后 fuzzy 仍主导（pinned/recent 都让位）；空查询排序 = pinned→recent(去 pinned)→rest。**分层根因**：R141 把 `commandMru.ts` 放 `features/palette/`（单消费者），R142 pinned 由两 feature 消费（palette 排序 + settings 管理）→分层铁律逼 `commandMru.ts` **上移 `core/commandMru.ts`**（纯 localStorage helper、vaultName 入参、caller 传 `app.vault.vaultName`）。新 `loadIds` 私有共用 defensive parse（集中 R141 dedupe 教训）+ `loadPinnedCommands`/`setPinnedCommands`（`geode.cmdPinned:<vaultName>`、dedupe-on-write、best-effort）。**零 data-safety**（纯 UI 排序 + localStorage id 列表，同 R141/R129，零 vault/.md/markdown.ts 写）。**对抗评审 7 维全证伪 → 0 confirmed defect（clean）** + 简化门 clean（0 编辑）。

新增套件：`r142-e2e.mjs` **18/18**（设置 pin→Pinned 列表显+localStorage 写 + 空查询置顶 + pinned 排在 recent 之上 + 输入 fuzzy 仍主导 pinned 不破坏 search + pinned∩recent 渲一次[去重无 React key 撞] + ghost/未注册 pinned id 跳过不崩 + 设置 unpin→列表删+localStorage 删+面板不再首位 + reload 持久）。**套件矩阵不回退**：r141 13/13（recent 行为零变、文件移 core 仅改 import 路径）·r32 24/24·r41 21/21·r38 19/19（palette 开/渲染）。**桌面 probe N/A**（纯前端 localStorage UI，WKWebView headless 设置面 §D 不可靠、且本特性无文件系统面，同 R141 先例）。

### R139 套件回归（2026-06-20，macOS release 二进制 v0.136.0 实测 `r139-probe-vault`）

R139 = compat `workspace.on('files-menu')`（多文件右键菜单，**file-menu 大头收官**，插件 API 商业主轴）。R130 单文件 file-menu + R131 editor-menu 后的最后一片——Obsidian 右键文件多选 fire `files-menu` 传 `TAbstractFile[]`，插件加批量项；R138 Explorer 多选解锁前置。**完全镜像 R130 跨 3 层 core-meet 范式**：core 新 `FilesMenuContext`/`registerFilesMenuProvider`/`collectFilesMenu`（与单文件 trio **各自独立**=Obsidian 真发两个不同事件 TFile vs TFile[]、不合并 generic）· compat context.ts files-menu provider（`getFolder??getFile` 解析混选、CollectorMenu 复用、`trigger("files-menu",menu,files,source)`）· workspace.ts on-table 加 files-menu 重载 · Explorer 右键当 `selection.size>1&&has(node)` 调多文件版、有项→多文件菜单（{count} header）、无项→回落单文件（v1 批量操作 defer）· render contributed 块从单文件 IIFE 提取共享尾块（React fragment 扁平→单文件 byte-identical）。**对抗评审 7 维全证伪 0 代码缺陷**（render 提取 byte-identity / provider 空集不 fire / onContextMenu / data-safety 零写盘 / 分层 / files-menu 注册表独立正确 / 边角）。

新增套件：`r139-e2e.mjs` **14/14**（fallback 无 handler→单菜单 + 数据路径 collectFilesMenu fire 事件返项 + handler 拿 TFile[]/source + 空→[] + UI 多选右键多文件菜单 header+贡献项+无单文件 built-in + 点击 onClick 拿全选 files + 右键选外塌缩单菜单）+ `r139-probe.mjs` **6/6**（真 WKWebView：collectFilesMenu fire 事件 + handler 拿 TFile[] §D-safe 数据路径）。**套件矩阵不回退**：r130 12/12（file-menu render 提取不变）·r131 7/7·r93 22/22·r138 11/11·r28 23/23·r137 13/13.

### R137 套件回归（2026-06-20，macOS release 二进制 v0.134.0 实测 `r137-probe-vault`）

R137 = compat `WorkspaceLeaf.setViewState` 程序化模式切换（mode-only，**插件 API 商业主轴**，收 R116/R126 留口）。**gate 拐点**：HANDOFF 默认项「MarkdownView.setMode」经 gate 读 obsidian.d.ts 揭露 **Obsidian `MarkdownView` 无 public `setMode`**（公开面只有 getViewType/getMode/getViewData/clear/setViewData/showSearch；`currentMode` 是内部 sub-view 属性）→ R126「非干净 API」根因=它不是 public API → 真 faithful 路径=`WorkspaceLeaf.setViewState({type:"markdown", state:{mode:"source"|"preview", source?}})`，**不造假 setMode**（R128 反 completionism）。Geode `setViewState` 原只处理 file（重开）对 mode-only `reportGap`→R137 补 honor mode 变更。新 module-private `applyViewStateMode`（Obsidian mode+`source` bool→Geode ViewMode：preview→preview/source+source:false→live/source→source；**收敛 openFile×2+setViewState 3 处重复**）。**对抗评审 1 MINOR 修**：helper 漏 `viewType==="markdown"` 守卫（Ctrl+E toggle 有）→ mode-only setViewState 在 graph/attachment tab 盖 mode（cosmetic 零数据丢失但 unfaithful）→加守卫镜像键盘 toggle。**data-safety-neutral**（setTabMode 是 Ctrl+E 同 sink、脏内容活在 handle 非 CM view→纯 display-only 切换不丢数据）；openFile 重构 byte-compat（无内部调用者传 source）+ 分层全证伪。

新增套件：`r137-e2e.mjs` **13/13**（mode-only 切 preview/source/live + source bool + DOM 阅读↔编辑 + 未知 type/空 state reportGap no-op + file+mode 同设 + **graph tab 不被盖 mode=MINOR 锁**）+ `r137-probe.mjs` **5/5**（真 WKWebView：window.app.workspace.activeLeaf.setViewState→napp.workspace.getActiveTab().mode preview/live/source §D-safe Store）。**套件矩阵不回退**：r116 9/9·r117 9/9·r123 7/7·r47 11/11·r130 12/12·r131 7/7·r136 13/13·r26-bytes 0 invariant.

### R136 套件回归（2026-06-20，macOS release 二进制 v0.133.0 实测 `r136-probe-vault`）

R136 = 阅读视图 `getSectionInfo` 真实现（opt-in `sourcePos` → 块级 `data-line` · **postProcessor 大头真·收官** · §C byte-isolable）。R135 阅读视图 getSectionInfo 暂返 null（需 markdown.ts 块级源行=§C），R136 补。**§C byte-isolable 设计**：块级 `data-line`(0-based 起)/`data-line-end`(0-based 末 inclusive) 仅在 **opt-in `RenderMarkdownOptions.sourcePos`** 开时由新 core ruler `geode-source-pos` 发射（守卫 `if(!env.geodeSourcePos) return`、顶层开块 `level0+nesting1+map`、trailing-blank trim）；**阅读视图（EditorPane renderPreview）唯一传**、export/hover/slides/embeds/r26-bytes 语料都不传 → **默认输出逐字节不变、r26-bytes 0 invariant 按构造保持**。feature `readingViewSectionInfo`（`el.closest("[data-line-end]")` DOM-walk + sourceText 从 EditorPane `handle.getText()` 透传）。**对抗评审 1 MINOR 修**：getSectionInfo 落 task-checkbox（旧 `<input data-line>` 无 data-line-end）返倒置 {N,0}→walk 键改 `[data-line-end]`（块 ruler 唯一写者）。§C byte-isolation（追 12 render 调用点+env 每渲染新建+守卫循环前返+对抗等价语料全等+真二进制 probe）+ 行号对齐+分层全证伪。

新增套件：`r136-e2e.mjs` **13/13**（sourcePos 渲 [data-line] + getSectionInfo h1=0..0/p=2..3/ul=5..6/li→list + pre/container null + DOM attr 值 + **task-checkbox 解析到 list section 不倒置=MINOR 锁**）+ `r136-probe.mjs` **4/4**（真 WKWebView `__geodeRenderMarkdown` 同步：sourcePos:true 渲 data-line、sourcePos:false 渲零=§C byte-isolation 在真二进制坐实）。**套件矩阵不回退**：**r26-bytes 0 invariant**（默认路径逐字节不变=§C 核心安全网）·r135 18/18·r134 24/24·r133 9/9·r132 11/11·r95 12/12·r24 12/12·r75 16/16·r23 22/22.

### R135 套件回归（2026-06-20，macOS release 二进制 v0.132.0 实测 `r135-probe-vault`）

R135 = MarkdownPostProcessorContext `addChild` + `getSectionInfo`（**postProcessor ctx 补全·大头收尾**，Dataview 组件生命周期）。R132/R133/R134 让 Dataview/Tasks 阅读+编辑双态渲染，R135 把 ctx 的 `addChild`（MarkdownRenderChild 生命周期，拆除时 onunload 清理）+ `getSectionInfo`（元素→源行）从 phase-1 stub 转真。**byte-neutral（不触 §C）**：阅读视图 getSectionInfo 需 markdown.ts 发块级 `data-line`=§C→暂返 null（Obsidian 不可映射本返 null）；live preview EASY（`PluginCodeBlockWidget.toDOM` 有 `view.state`+`this.from`→`doc.lineAt`）。新 core `RenderChildOwner`（**跨层生命周期 owner**——core 不 import compat Component 故 owner 是 core 结构型 `RenderChild{load,unload}` 容器）+ `MarkdownSectionInformation`/`RenderChild` 类型 + compat `MarkdownRenderChild extends Component`；阅读视图卸载钩=EditorPane preview hydration effect `return ()=>owner?.unload()`、live=`PluginCodeBlockWidget.destroy(dom)`（owner 挂 dom WeakMap 因 eq 复用 DOM）。**对抗评审 1 MAJOR 修**：`RenderChildOwner.addChild` 漏抄 Component `if(_loaded)` 守卫→handler await 后 late addChild 在已卸载 owner 上仍 load→子组件泄漏→加 `loaded` 终态。data-safety/CM destroy-leak 追源/分层/throw 非对称全证伪。

新增套件：`r135-e2e.mjs` **18/18**（A. live addChild load/destroy-unload/re-render + getSectionInfo text/lineStart=2/lineEnd=5 · B. 阅读视图 addChild load + 离 preview unload + getSectionInfo null · **C. async addChild teardown 后不加载泄漏子=MAJOR 锁**）+ `r135-probe.mjs` **4/4**（真 WKWebView：RenderChildOwner+MarkdownRenderChild 同步 addChild→load/unload→unload §D-safe；真 ctx 渲染受 App-Nap→由 e2e 覆盖）。**套件矩阵不回退**：r134 24/24·r133 9/9·r132 11/11·r56 13/13·r57 19/19·r75 16/16·**r26-bytes 0 invariant**（byte-neutral 坐实）·r23 22/22·r24 12/12·r115 7/7。

### R134 套件回归（2026-06-20，macOS release 二进制 v0.131.0 实测 `r134-probe-vault`）

R134 = 插件代码块 **live preview**（编辑模式也渲染，**registerMarkdownPostProcessor 大头 phase 3 闭环**，Dataview/Tasks 主要机制续）。R132/R133 阅读视图 → R134 让 `​```dataview`/`​```tasks` 在 live preview 也实时渲染。**关键约束**：R133 把 handler 存成不透明 post-processor（lang 不可查）→ 新增 core `lang→handler` 注册表（`registerCodeBlockProcessor` 单点双注册=阅读 post-processor + live Map，`dispose` 撤两者带 identity 守卫；阅读视图逐字节不变=R133 e2e 9/9 保持）+ `makeMarkdownPostProcessorContext` ctx 单一真源。`livePluginCodeBlocks` 复用 liveQuery/liveMermaid 的 `liveBlockWidgets`（块级 REPLACE + atomicRanges + 行首对齐 + 光标揭源，**纯视图零字节写、不动 `core/markdown.ts`→§C 不触发**）+ `PluginCodeBlockWidget`（splitFence→handler(body,div,ctx)、错误隔离镜像 R133、`attachLiveBlockReveal` 与 HydratedBlockWidget 共享提取）+ EditorPane `codeBlockProcessorsRevision`→modeCompartment reconfigure。**对抗评审 2 MINOR 边角确认修**：fix1=插件注册内置 lang（mermaid/query）双块装饰撞同 fence→detector 加 `BUILTIN_LIVE_FENCE_LANGS` 排除；fix2=splitFence 闭合剥离绑定开 marker 字符（未闭合反型 marker body 发散）；data-safety/分层/反应式/dispose identity/错误隔离全证伪。

新增套件：`r134-e2e.mjs` **24/24**（live 渲染+body/ctx/div + 未注册留裸 + 开着注册重渲 reconfigure + 光标揭源往返 + 文档字节不变 + disposer 撤渲 + **fix1 内置 lang 不双渲** + **fix2 反型 marker body 保留**）+ `r134-probe.mjs` **6/6**（真 WKWebView：核心 lang→handler 注册表 register→true/dispose→false 转换 §D-safe 验真；live 编辑器 widget headless 不渲染[App-Nap §D]→渲染语义由 e2e 覆盖）。**套件矩阵不回退**：r133 9/9·r132 11/11·r56 13/13·r57 19/19·r75 16/16·**r26-bytes 0 invariant**·r23 22/22·r24 12/12·r115 7/7。

### R133 套件回归（2026-06-20，macOS release 二进制 v0.130.0 实测 `r133-probe-vault`）

R133 = compat `Plugin.registerMarkdownCodeBlockProcessor`（阅读视图代码块处理器，**Dataview/Tasks 主要机制**）。Obsidian口径=post-processor 语法糖（移除渲染后 `<pre><code>`、给 handler 新 `<div>`）→ 复用 R132 注册表。新 core `makeCodeBlockPostProcessor`（放 core 因认渲染结构，同 embeds）：扫 `pre>code.language-<lang>`、`pre.replaceWith(div)`、调 handler(source[去尾\n], div, ctx)。内置 mermaid/query=`.geode-*` div 不匹配（无冲突）；inline code 被 `pre>code` 排除。compat-mostly、加性 display-only。

新增套件：`r133-e2e.mjs` **8/8**（注册块替换+source/div/ctx + 未注册 ```js 不动 + disposer）+ `r133-probe.mjs` **3/3**（真 WKWebView helper 干净加载 + hook registerable；preview headless 不渲染→替换语义 e2e 覆盖）。**套件矩阵不回退**：r132 11/11·r26 12/12·**r26-bytes 0 invariant**·r115 7/7·r23 22/22·r130 12/12·r131 7/7。

### R132 套件回归（2026-06-20，macOS release 二进制 v0.129.0 实测 `r132-probe-vault`）

R132 = compat `Plugin.registerMarkdownPostProcessor`（阅读视图后处理器，**Dataview/Tasks 旗舰、第二个主线大头、phase 1**）。**gate 拐点**：editor-menu 原生项（复杂低价值）+ files-menu（Explorer 无多选）受阻 → gate 揭露 registerMarkdownPostProcessor phase 1 可做成「渲染后 DOM 后处理」（不动 `core/markdown.ts` 字节渲染→§C 不触发、无 vault 写、display-only）→ 清除 data-safety 顾虑自主启动。新 core 注册表（镜像 R115）在 core 会合——compat 写、EditorPane 阅读视图在 hydration effect 应用到 `.preview-content`。fresh el 每 render 不累积。

新增套件：`r132-e2e.mjs` **9/9**（跑在渲染 DOM + ctx sourcePath/frontmatter/containerEl + sortOrder + disposer）+ `r132-probe.mjs` **3/3**（真 WKWebView 干净加载 + hook registerable；preview headless 不渲染[App-Nap §D]→语义由 e2e 覆盖）。**套件矩阵不回退**：r115 7/7·r23 22/22·r130 12/12·r131 7/7·r26 12/12·**r26-bytes 0 invariant**（阅读视图字节不退，坐实加性 display-only）。

### R131 套件回归（2026-06-20，macOS release 二进制 v0.128.0 实测 `r131-probe-vault`）

R131 = compat `workspace.on('editor-menu')`（编辑器右键菜单，**file-menu 大头 phase 2**）。**与 phase 1 架构不同**：editor-menu 是独立 popup→用真 Menu（`showAtMouseEvent` 已工作）非 CollectorMenu；Geode 编辑器无原生右键菜单→**compat-only**（`editorMenu.ts` 经 R115 core editorExtensions 注入 always-on CM contextmenu 扩展，fire `editor-menu` + 仅当插件加项才 preventDefault+show，否则放行浏览器默认）。**plugin items only**（无原生 cut/copy/paste）=文档化偏离。

新增套件：`r131-e2e.mjs` **7/7**（右键→editor-menu fire(editor/info 正确)→插件项显示→点击→菜单关；无项→浏览器默认）+ `r131-probe.mjs` **3/3**（真 WKWebView editorMenu 扩展干净加载；editor headless 不挂载→完整 fire 由 e2e 覆盖）。**套件矩阵不回退**：r115 7/7（editorExtensions）·r23 22/22（编辑器）·r128 19/19·r130 12/12（file-menu）·r93 22/22。

### R130 套件回归（2026-06-20，macOS release 二进制 v0.127.0 实测 `r130-probe-vault`）

R130 = compat `workspace.on('file-menu')`（右键菜单钩子，**插件迁移阻塞面最大的主线大头之一，phase 1 = Explorer 文件/文件夹菜单**；R119–R129 连做 11 小项后自主启动）。**跨 3 层在 core 会合**（分层铁律下 compat/features 互不 import）：core 新菜单贡献注册表（`MenuContribution` 纯数据 + `registerFileMenuProvider`/`collectFileMenu`）· compat `menuCollect.ts` CollectorMenu 录插件项零 DOM + context.ts fire `file-menu` 事件 · Explorer 收集渲染。editor-menu 延后（需建原生编辑器菜单）。

新增套件：`r130-e2e.mjs` **12/12**（数据路径 titles/icons/warnings/source/file/onClick + folder→TFolder + unknown→[]；**Explorer UI** 右键→contributed 按钮→点击→onClick→菜单关）+ `r130-probe.mjs` **7/7**（真 WKWebView collectFileMenu 数据路径全验；UI 无 CDP 由 e2e 覆盖）。**套件矩阵不回退**：r93 22/22（Explorer 右键菜单）·r91 10/10·r129 11/11·r128 19/19·r127 15/15·r126 11/11·r125 16/16。

### R129 套件回归（2026-06-20，macOS release 二进制 v0.126.0 实测 `r129-probe-vault`）

R129 = compat `App.loadLocalStorage`/`saveLocalStorage`/`isDarkMode`（per-vault UI 态 + 主题查询，**插件 API 商业主轴**）。3 真方法（非 stub）：localStorage 按 vault 命名空间 `geode-ls:<vault>:k`、JSON round-trip（string/number/object）、null/undefined 清除；isDarkMode 读 themes.ts 维护的 resident body theme class。纯 compat 单文件、零改 core、零新依赖、**零 data-safety 面**（localStorage 是浏览器 UI 态非 vault 数据）。

新增套件：`r129-e2e.mjs` **10/10**（round-trip/缺省 null/null 清除/vault 命名空间/不泄漏 bare key/isDarkMode 暗亮/reload 持久化）+ `r129-probe.mjs` **9/9**（真 WKWebView 原生 localStorage——**App 方法无需编辑器挂载、headless 全验**，对比 R128 editor 不挂载）。**套件矩阵不回退**：r128 19/19·r127 15/15·r126 11/11·r125 16/16·r23 22/22。

### R128 套件回归（2026-06-20，macOS release 二进制 v0.125.0 实测 `r128-probe-vault`）

R128 = compat `Editor` 方法补全（编辑器操作类插件高频面，**插件 API 商业主轴**）。13 方法直接映射 CM6：listSelections/setSelections（单选；多光标折叠=Geode CM 无 allowMultipleSelections 文档化偏离 R57）/ setLine / transaction（change offset 相对原始 doc + 升序满足 CM6 有序不重叠）/ wordAt / scrollIntoView/scrollTo/getScrollInfo / exec（17 EditorCommandName→@codemirror/commands+language）/ undo/redo / blur / refresh(no-op)。**写经 cm.dispatch→autosave**（与既有 replaceRange 同 proven-safe 路径，非 handle.setText 静默丢数据）。纯 compat 单文件、零改 core、零新依赖。**gate 拐点**：HANDOFF 默认 referenceLinks 经 WebFetch 揭露 @since 1.8.7 + shape 矛盾 + 低价值 → 自主改取「可直接映射 CM6」的 Editor 余项。

新增套件：`r128-e2e.mjs` **15/15**（listSelections/setSelections/setLine/transaction/wordAt/exec/undo·redo 往返/getScrollInfo/scroll/blur + **setLine 落盘持久化**）+ `r128-probe.mjs` **3/3**（真 WKWebView：editor.ts+新 CM imports 干净加载 + null-guard；编辑器 headless 不挂载[R115/§D]→方法语义 e2e 全覆盖）。**套件矩阵不回退**：r23 22/22（编辑器）·r127 15/15·r126 11/11·r125 16/16·r124 10/10·r119 10/10。

### R127 套件回归（2026-06-20，macOS release 二进制 v0.124.0 实测 `r127-probe-vault`）

R127 = compat `CachedMetadata.footnotes`（`[^id]: content` 定义）+ `footnoteRefs`（正文 `[^id]` 引用，**插件 API 商业主轴**）。**本轮触 core**（index parser）：定义早在 core（R65），本轮 core 补 `FOOTNOTE_REF_RE` 引用扫描 + `FootnoteRefMark`，**与定义同跑在 `masked` 上**（frontmatter blanked + maskCodeRegions）→ code/frontmatter 里的 `[^id]` 自动排除（复用 proven masking 绕开 R125 式 fence 误判）；`(?!:)` 排除定义自身 marker。compat 桥接两者 {id 无 caret, position}，跨过 no-content transient。内联 `^[text]` 脚注=文档化偏离。

新增套件：`r127-e2e.mjs` **13/13**（定义/引用/重复保留/orphan/masking[fenced+inline+frontmatter]/无脚注缺省/引用 position 跨 marker/定义 marker 不计为引用）+ `r127-probe.mjs` **7/7**（真 WKWebView 原生 fs index：defIds/defLines/refIds/refLines + masking 不泄漏）。**core 回归零退**：r126 11/11 · r125 16/16 · r124 10/10 · r119 10/10 · r70 23/23（links）· r27 22/22（tags）——动 index parser 全绿。

### R126 套件回归（2026-06-20，macOS release 二进制 v0.123.0 实测 `r126-probe-vault`）

R126 = compat `CachedMetadata.frontmatterLinks`（属性值里的 `[[wikilink]]`，**插件 API 商业主轴**；Dataview/图谱读 `related: "[[Note]]"` 命脉）。`buildFrontmatterLinks`：遍历 core `frontmatter.fields`，string 值在 `key`、list 值第 N 元素在 `key.N` 下扫 `[[..]]` → `{key, link(去 #subpath，镜像 core WIKILINK_RE), original, displayText?(alias)}`。无 position（Obsidian 用 key 标识）；只需 fields 不需 content → **跨过 no-content transient**（优于 sections/listItems）。**gate 拐点决策**：HANDOFF 默认项 setMode 经 gate 揭露为非干净 API（代码库注释自记「插件改用 leaf.setViewState」）→ 自主改取真实高价值字段 frontmatterLinks。markdown 式属性链接 = 文档化偏离（官方文档未明、Properties UI 产 wikilink）。

新增套件：`r126-e2e.mjs` **11/11**（string/alias/subpath/一值两链/inline-array/block-list key + 无链接 + 无 frontmatter 缺省 + body 链接排除）+ `r126-probe.mjs` **7/7**（真 WKWebView 原生 fs index：keys/links/originals/displayText + body 排除）。**套件矩阵不回退**：r125 16/16（listItems 同 buildCache）·r124 10/10（sections）·r119 10/10（embeds）·r27 22/22·r70 23/23·r23 22/22·r46 18/18。

### R125 套件回归（2026-06-20，macOS release 二进制 v0.122.0 实测 `r125-probe-vault`）

R125 = compat `CachedMetadata.listItems`（每个列表项一条，**插件 API 商业主轴**；Tasks/Dataview 命脉）。`buildListItems`：缩进栈解析 parent（嵌套→父行号、root→`-firstLine` 负值）、`task` = `[ ]` 字符、`id` = 项自身行尾 `^id`。**对抗评审 6 维 → 揪出 2 个 MAJOR，均评审后修**：**(a) fence 不感知**——fenced code 内 `- x` 被当真列表项（与同文件 buildSections 围栏处理不一致），修=前置标记 fenced 行两循环跳过；**(b) `^id` 挂错项**——原经 core block.to 归给连续兄弟段末项（`- a ^x/- b/- c` 把 id 挂 c 丢 a），修=直接在项自身行尾正则取 id（逐字镜像 core `BLOCK_MARKER_RE`）、删 `blocks` 形参。`position` 单行 = 顶层近似（Obsidian 跨子树），文档化。

新增套件：`r125-e2e.mjs` **14/14**（全捕获/嵌套 parent/root 负行/loose/task/有序/no-list + **(a) fence 零幻影** + **(b) id 仅挂 a**）+ `r125-probe.mjs` **6/6**（真 WKWebView 原生 fs index：lines/parents/tasks/ids + fence 排除 + `^x` 挂 a）。**套件矩阵不回退**：r124 10/10（sections 同 buildCache）·r119 10/10（embeds）·r27 22/22·r70 23/23·r23 22/22·r46 18/18。

### R124 套件回归（2026-06-20，macOS release 二进制 v0.121.0 实测 `r124-probe-vault`）

R124 = compat `CachedMetadata.sections`（顶层块文档结构 parser，**插件 API 商业主轴**；committed 做完两度延期的 parser）。`buildSections`：frontmatter→yaml、fenced code 原子、heading/thematicBreak 单行断段、其余按空行分块按首行分类（blockquote/list/html/table/paragraph）+ block id 挂载。Obsidian section typing 明言 non-exhaustive→顶层近似。**对抗评审 6 维 → 0 confirmed 代码缺陷**（CRLF 安全/未闭合 fence 不崩/判序正确）；**D1 评审修**（heading 无空行也断段）；D2-D6 顶层近似偏离文档化。

新增套件：`r124-e2e.mjs` **10/10**（type 序列/fence 原子/position 准/block id/plain/D1 断段）+ `r124-probe.mjs` **4/4**（真 WKWebView 原生 fs index）。**套件矩阵不回退**：r119 10/10（embeds 同 buildCache）·r27 22/22·r70 23/23·r23 22/22·r46 18/18。

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
