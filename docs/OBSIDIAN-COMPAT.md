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

## 验收方式（可度量，防自嗨）

1. **兼容套件**：选 5 个流行、开源、复杂度梯度分明的真实插件构成回归套件
   （建议起步：Recent Files、Word Count 类、Natural Language Dates、Paste URL into
   selection、Calendar——最后者覆盖 moment + 自定义 view，是 T2 的标杆）。
   每轮记录每个插件：加载✓/命令✓/设置页✓/核心功能✓/缺口列表。
2. **杀手演示**：`geode.exe <真实 Obsidian vault 路径>` → 已装插件出现在设置页并可启用。
3. 本文件维护「已实现 API ↔ 官方签名」对照表（实现后逐条追加），缺口显式列出而非沉默。

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
