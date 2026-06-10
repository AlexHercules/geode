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
| **T2 编辑与视图** | `Editor` 抽象（**最小子集已在 R4 以 T1.5 落地**，完整版含 transaction/extension 仍 T2）；`MarkdownView` / `MarkdownRenderer.render`; `ItemView` + `registerView`/`getLeavesOfType` **真实挂载**（类骨架 R4 已可 evaluate）；~~`SuggestModal`/`FuzzySuggestModal`~~（R4 已落地最小真实版）；`requestUrl`；`moment` 导出（套件实测 nldates 核心功能的唯一阻断点，R5 P0） | R5 候选 |
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

### 仍然显式保留的缺口（warn-stub / 行为偏差，按表追踪）

| 缺口 | 现状 |
|---|---|
| `registerView` + 视图挂载 | warn-stub；View/ItemView/FileView 仅保证类可 evaluate，永不 onOpen/挂载 |
| `registerEditorSuggest` 触发 | warn-stub；EditorSuggest 子类可构造，onTrigger/getSuggestions 永不被调用 |
| `requestUrl` | warn-stub，始终 reject（网络不在 T0/T1） |
| `moment` | 不打包（npm 纪律）；属性访问记缺口、调用抛说明性错误 |
| `TFile.stat` | ctime/size 对既存文件恒为 0（Geode 树无 stats）；mtime 仅会话内跟踪本地 modify/create，加载时记一次缺口 |
| `App.fileManager` / `App.keymap` / `App.scope` | getter warn-stub：fileManager 方法为记录缺口的 async no-op，keymap/scope 为惰性 no-op 对象 |
| `DataAdapter.appendBinary`（及 readBinary/writeBinary/stat/trash*） | warn-stub + 说明性 throw；append/process/rmdir/copy 已用字符串 IO 真实实现 |
| `workspace.on('editor-change')` | 偏差：按保存的 file:modified 触发，而非每个编辑器事务 |
| DOM 增强 `onNodeInserted` / `onWindowMigrated` | warn-stub（单窗口宿主），返回 no-op destroyer |

## 验收方式（可度量，防自嗨）

1. **兼容套件**：选 5 个流行、开源、复杂度梯度分明的真实插件构成回归套件
   （建议起步：Recent Files、Word Count 类、Natural Language Dates、Paste URL into
   selection、Calendar——最后者覆盖 moment + 自定义 view，是 T2 的标杆）。
   每轮记录每个插件：加载✓/命令✓/设置页✓/核心功能✓/缺口列表。
2. **杀手演示**：`geode.exe <真实 Obsidian vault 路径>` → 已装插件出现在设置页并可启用。
3. 本文件维护「已实现 API ↔ 官方签名」对照表（实现后逐条追加），缺口显式列出而非沉默。

### R4 套件矩阵（2026-06-10，套件 vault 制备脚本见 compat-vault/，gitignore 本地再生）

| 插件（上游版本） | 加载 | 命令 | 设置页 | 核心功能 | 缺口 |
|---|---|---|---|---|---|
| recent-files-obsidian 1.7.9 | ✓ | ✓ (1) | ✓ | ✗ 面板不显示 | registerView 挂载（R5 P0） |
| better-word-count 0.10.1 | ✓ | ✓ (0，状态栏驱动) | ✓ | ✓ 状态栏字数 | — |
| nldates-obsidian 0.6.2 | ✓ | ✓ (8) | ✓ | ✗ 日期解析 | moment（R5 P0）；EditorSuggest 触发 |
| url-into-selection 1.11.4 | ✓ | ✓ (1) | ✓ | ✓ editorCallback 粘贴 | — |
| calendar 1.5.10 | ✓ | ✓ (3) | ✓ | ✗ 日历面板不显示 | registerView 挂载；moment |

R4 起点（修复前预检）仅 1/5 可加载；套件驱动追加 View/ItemView/EditorSuggest/
SuggestModal/Menu/path + getRightLeaf/getLeftLeaf/revealLeaf/leaf.setViewState
（calendar 重启用路径实测暴露）后 **5/5 加载启用**。manifest 边界用例已覆盖：
better-word-count 与 url-into-selection 上游 manifest 均缺 minAppVersion（warn 不拒载）。

**桌面端杀手演示（发布版 v0.4.0，截图 docs/screenshots/r4-desktop-killer-demo.png）**：
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
