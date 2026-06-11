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
| ~~`registerEditorSuggest` 触发~~ | **R6 已实现**：真实触发 + popup（nldates 自动建议桌面实测通过）。保留偏差：onTrigger 逐本地文档事务驱动，**纯光标移动不重评估**（gap 记一次）；`setInstructions` 指令条不渲染（gap）；popup 不随窗口 resize/scroll 重定位 |
| ~~`requestUrl`~~ | **R6 已实现**：桌面 Rust ureq（CORS-free，30s/10MB/method 白名单）；浏览器 fetch（**受 CORS**——浏览器端真实跨域请求会失败，契约口径）；`data:` URL 双端层内解析 |
| `getLeavesOfType("markdown")` 等内建类型 | 偏差：恒返回 `[]`（只跟踪 compat 自定义视图 leaf） |
| `WorkspaceLeaf.openFile` 的 openState | 仅映射 `mode: "source"|"preview"` → tab 模式；eState/group/active 忽略 |
| `vault.getConfig`（非公开 API） | 固定值：defaultViewMode→"source"、useMarkdownLinks→false，其余 undefined（每 key 记缺口） |
| `App.dragManager` / `App.internalPlugins` / `App.plugins` | warn-stub 形状（dragFile→null、getEnabledPluginById→null、plugins:{} 空字典）——recent-files 拖拽降级、daily-notes 探测返回"未启用" |
| `TFile.stat` | ctime/size 对既存文件恒为 0（Geode 树无 stats）；mtime 仅会话内跟踪本地 modify/create，加载时记一次缺口 |
| `App.fileManager` / `App.keymap` / `App.scope` | getter warn-stub：fileManager 方法为记录缺口的 async no-op，keymap/scope 为惰性 no-op 对象 |
| `DataAdapter.appendBinary`（及 readBinary/writeBinary/stat/trash*） | warn-stub + 说明性 throw；append/process/rmdir/copy 已用字符串 IO 真实实现 |
| DOM 增强 `onNodeInserted` / `onWindowMigrated` | warn-stub（单窗口宿主），返回 no-op destroyer |

## 验收方式（可度量，防自嗨）

1. **兼容套件**：选 5 个流行、开源、复杂度梯度分明的真实插件构成回归套件
   （建议起步：Recent Files、Word Count 类、Natural Language Dates、Paste URL into
   selection、Calendar——最后者覆盖 moment + 自定义 view，是 T2 的标杆）。
   每轮记录每个插件：加载✓/命令✓/设置页✓/核心功能✓/缺口列表。
2. **杀手演示**：`geode.exe <真实 Obsidian vault 路径>` → 已装插件出现在设置页并可启用。
3. 本文件维护「已实现 API ↔ 官方签名」对照表（实现后逐条追加），缺口显式列出而非沉默。

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
