# Obsidian 功能差距补充审计

日期：2026-06-23  
对象：Geode v0.173.0 文档现状  
定位：补充 `docs/OBSIDIAN_REPLICA_GAP_AUDIT_2026-06-23.md`。上一份报告重点覆盖页面、截图、设置 IA、视觉与右键菜单；本文件专门补上“完整复刻 Obsidian”所需的功能契约、命令体系、核心插件、桌面宿主能力与插件兼容差距。

## 结论摘要

如果目标是“完整复刻 Obsidian”，当前最大风险不是单个页面样式，而是许多 Obsidian 用户每天使用的行为入口还没有形成完整闭环：命令没有注册、设置页没有真实功能、核心插件只有部分等价能力、桌面宿主 API 和第三方插件运行环境仍有硬边界。

当前状态可以概括为：

| 维度 | 当前判断 | 复刻风险 |
|---|---|---|
| 知识库基础能力 | Markdown、wikilink、反链、图谱、搜索、属性、模板、日记、文件恢复、页面预览等已经大量推进 | 基础足够强，但还不是完整桌面端体验 |
| 设置与命令 | 设置主导航 5 项 vs Obsidian 8 项 + 插件子项；热键 90 条 vs Obsidian 280 条 | 用户会明显感知“不像 Obsidian”，且很多功能没有命令入口 |
| 核心插件 | 多数小中型核心插件已有或部分已有；Canvas、Bases、录音、Web clipper、格式转换器仍缺 | Canvas/Bases 是完整复刻的硬大件 |
| 桌面宿主能力 | 单窗口/Tauri 宿主下，pop-out、多窗口、系统 shell、Node/Electron 运行时仍未等价 | 影响右键菜单、第三方插件和桌面工作流 |
| 插件兼容 API | 高频 API 已覆盖很多；剩余 bounded compat 已基本清空，留下新依赖或跨层大集成项 | 要兼容更多真实插件，必须补 getResourcePath、Lucide、YAML、protocol、StateField 等 |

因此后续不应只按“页面像素级”推进，也需要一张功能复刻矩阵：每个 Obsidian 功能必须同时检查 UI 入口、命令/热键、设置项、实际行为、持久化、插件 API 是否存在。

## 资料口径

本文件只做文档审计，不改源码。依据如下：

- `docs/OBSIDIAN_REPLICA_GAP_AUDIT_2026-06-23.md`：当前截图对比、运行测试、设置和表面差距。
- `docs/ROADMAP.md`：R176 后候选池、A/F/G 系列登记、剩余大件与兼容深化。
- `docs/OBSIDIAN-COMPAT.md`：Obsidian 插件兼容层缺口、API 分层、全表面再校准。
- `../reference/04-热键命令.md`：Obsidian 快捷键页 280 条命令分组。
- `../reference/05-核心插件.md`：Obsidian 核心插件总表与设置 tab。
- `../geode-设计讨论/11-复刻完成度盘点.md`：早期复刻盘点；其中部分缺口已被后续 R 轮完成，本文以 `ROADMAP` 和 `OBSIDIAN-COMPAT` 的较新状态为准。

## 功能域矩阵

| 功能域 | Obsidian 期望 | Geode 当前状态 | 差距等级 | 建议 |
|---|---|---|---|---|
| Vault 管理 | 管理仓库、打开/切换 vault、最近 vault、库级设置入口 | `管理仓库` 命令未发现；缺完整 vault 管理/切换器 | P0 | 作为完整复刻的入口级功能单独立项 |
| 命令/热键 | 280 条命令，按核心/插件/视图/应用分组，可逐项绑定 | 约 90 条；搜索和筛选可用，但命令总表不完整 | P0 | 先建命令矩阵，再补真实命令，不只补 UI 行 |
| 文件树操作 | 新标签/右侧/新窗口、复制路径/Obsidian 链接、历史、默认应用、访达、移动/重命名/删除 | 常用新建/移动/重命名/删除/副本已有；系统级和历史类缺 | P0 | 分纯前端项与宿主项推进；避免只画菜单 |
| 编辑器工作流 | 查找替换、格式命令、表格命令、Vim、RTL、拼写语言、HTML 转换、隐藏参考标记 | 一部分编辑设置已具备；多项未完整呈现或缺命令 | P0/P1 | 从热键 280 清单反推编辑器命令与设置 |
| 核心插件 | Canvas、Bases、Backlinks、Graph、Daily、Templates、File recovery、Page preview 等 | 多数已做或部分做；Canvas/Bases/Audio/Web clipper/Format converter 缺 | P0/P1/P2 | Canvas/Bases 单独立项；小插件先补零依赖项 |
| 设置页真实功能 | 编辑器、文件与链接、外观、快捷键、钥匙串、核心插件、第三方插件各自有真实设置 | 许多设置混在外观页；About/Keychain/CLI/插件市场缺真实功能 | P0/P1 | G1/G2 之后必须跟 G6-G10 的真实行为闭环 |
| 桌面宿主 | 多窗口、pop-out、系统打开、剪贴板、协议注册、外部程序、部分 Node/Electron 能力 | 单窗口宿主；Node/Electron require 白名单很窄 | P1/P2 | 先定 Tauri 安全边界，再选 shell/clipboard/fs 子集 |
| 插件生态 | 常见 Obsidian 插件可加载、显示图标、访问资源、读写 YAML、注册 URI/扩展名 | 高频 API 覆盖多；剩余高价值项需依赖或跨层接线 | P1 | 优先 getResourcePath、Lucide、parseYaml、protocol、StateField |

## P0：用户迁移会立刻撞到的功能差距

### 1. Vault 管理和 `管理仓库` 命令

Obsidian 的“管理仓库”不是单个设置按钮，而是 vault 生命周期入口：打开其他 vault、创建/管理 vault、切换最近 vault，以及进入库级别管理。

当前缺口：

- 热键参考清单确认有 `管理仓库` 命令，Geode 当前审计未发现该命令。
- 设置和命令体系里缺 vault manager 级入口。
- 如果后续支持多个 root、项目库、多 vault 插件配置，这个入口会成为必要基础设施。

验收建议：

- 命令面板可搜索到 `管理仓库`。
- 热键页有该命令，默认键位按 Obsidian 口径显示为未设置。
- 打开后至少支持当前 vault 信息、最近 vault 列表、打开本地 vault、创建 vault、切换 vault。
- 切换时明确处理未保存编辑器、插件状态、工作区布局、索引重建和最近文件。

### 2. 命令总表从 90 扩展到 280 不是纯 UI 工作

上一份审计已经量化：Obsidian 截图显示 280 条快捷键，Geode 当前约 90 条。这里的关键是，不能只把 280 行画出来。每一行都应对应一个真实 command id、可执行 handler、可绑定 hotkey、可在命令面板出现或按 Obsidian 规则隐藏。

高优先缺口组：

- 应用/库：管理仓库、删除当前文件、复制 Obsidian URI、导出 PDF、显示调试信息、重新加载应用。
- 文件列表：显示当前文件、新建文件夹、复制库内路径、复制 Obsidian 链接、默认应用打开、访达显示。
- 标签页/窗口：移动当前标签页到新窗口、聚焦上下左右标签页组、转到标签页 1-8、关闭其他/右侧/分组标签页。
- 编辑/格式：加粗、斜体、高亮、行内代码、引用、有序/无序列表、标题 1-6、清除格式、上下移动行、多光标命令。
- 表格：插入表格、增删行列、移动行列、对齐列。
- 插件分组：Canvas、Bases、Daily notes、Templates、Bookmarks、Properties、Backlinks、Graph、Outline、File recovery、Page preview。

验收建议：

- 建一份 `Obsidian command id -> Geode command id -> status` 矩阵。
- `status` 至少分为 `done`、`ui-only`、`stub`、`missing`、`out-of-scope`。
- 对 `ui-only/stub` 不允许在热键页伪装成可用功能。
- 回归测试覆盖：命令面板搜索、热键触发、禁用插件后的命令隐藏/失效、命令执行后的文档字节安全。

### 3. 文件树和右键菜单缺的是“桌面行为”，不只是菜单项

Obsidian 文件菜单里的很多项背后是操作系统能力或 vault 历史能力。补 UI 但不补行为，会造成复刻假象。

纯前端/已有能力可优先补：

- 复制库内路径。
- 复制 Obsidian 链接。
- 在文件列表中显示当前文件。
- 打开历史/文件恢复入口。
- 文件/文件夹菜单分组和禁用态。

依赖宿主或大能力的项：

- 在新窗口中打开：需要 pop-out / multi-window。
- 使用默认应用打开：需要 Tauri opener/shell。
- 在访达中显示：需要系统 reveal 命令。
- 打开历史：如果要等价 Obsidian File recovery，需要快照选择与恢复流程。

验收建议：

- 菜单项必须同时在右键菜单、命令系统、热键系统里一致出现。
- 对宿主能力缺失的项，应显示禁用或暂不提供，避免点击后无行为。
- 复制链接类命令要覆盖文件、标题、块引用、相对路径、URL 编码与中文路径。

### 4. 编辑器功能差距要按“日常写作动作”补

当前编辑器已有很多基础能力，但完整复刻需要覆盖 Obsidian 用户的写作肌肉记忆。

高优先动作：

- 当前笔记查找 `Cmd/Ctrl+F`。
- 当前笔记查找并替换 `Option/Alt+Cmd/Ctrl+F`。
- 保存当前文件 `Cmd/Ctrl+S` 的显式命令语义。
- 插入链接 `Cmd/Ctrl+K`。
- 打开光标处链接、在新标签打开光标处链接。
- 格式化命令：加粗、斜体、高亮、引用、标题、列表、行内代码、清除格式。
- 表格命令：插入表格、增删/移动行列、列对齐。

设置背后的真实功能：

- Vim mode。
- RTL。
- 拼写检查语言，而不是只有拼写检查开关。
- 自动补全英文标点。
- 自动转换 HTML。
- 隐藏参考标记。
- 折叠状态持久化、阅读视图折叠等历史技术债。

验收建议：

- 每个编辑动作都要有命令、默认键位、菜单入口和编辑器行为测试。
- 命令执行必须走同一套文档修改路径，保留 undo/redo 和 autosave 安全。
- 对格式化命令补 byte-level regression，防止选区包裹破坏 frontmatter、代码块、wikilink。

## P0/P1：核心插件差距

### 1. 已有或部分已有的核心插件，不应重复当作“完全缺失”

根据较新的 `ROADMAP` 和 `OBSIDIAN-COMPAT`，早期设计讨论里的部分缺口已被后续 R 轮推进。后续排期不要再把它们作为从零项目处理。

已做或已有明显基础的项：

- Backlinks。
- Graph / local graph 相关能力。
- Quick switcher。
- Command palette。
- Templates。
- Daily notes。
- Zettelkasten unique note。
- Word count。
- Properties view。
- Search。
- File recovery。
- File explorer。
- Slash commands。
- Page preview。
- Note composer。
- Bookmarks 数据和部分内部 API。
- PDF/audio/video 只读预览能力已在后续轮推进，不应沿用 R22 旧口径当作纯缺失。

这些项的后续重点不是“有没有”，而是：

- 设置 tab 是否按 Obsidian 同名项出现。
- 命令是否完整进入 280 条清单。
- 右键菜单/面板入口是否完整。
- 对插件 API 的 internal plugin instance 是否足够接近。
- 关闭核心插件后 UI、命令、面板是否一致消失。

### 2. 明确仍缺或未成闭环的核心插件/功能

| 项 | 当前判断 | 为什么重要 | 建议优先级 |
|---|---|---|---|
| Canvas `.canvas` | 缺；已在 ROADMAP A 节登记为大工程 | Obsidian 核心插件，且是用户点名项 | P0 大件 |
| Bases | 缺；依赖数据库/查询引擎 | Obsidian 2025 新核心能力，与 Properties 强相关 | P1/P2 大件 |
| Stacked tabs / linked view | pinned tabs 已有，堆叠和 linked view 不完整 | 长文、多 pane 工作流高频 | P1 |
| 独立 tag pane | 搜索面板有标签浏览，独立侧栏面板未做 | Obsidian 侧栏核心工作流 | P1 |
| Audio recorder | 缺，需新能力 | 核心插件但人群较窄 | P2 |
| Web clipper | 缺；E8 已登记 defuddle 方向 | 迁移和收集工作流重要 | P1/P2 |
| Markdown format converter | 缺，较适合零依赖先做 | 导入/整理老 Markdown 时有用 | P1 |
| Slides | 缺，低优先 | 使用人群较窄 | P2 |
| Footnotes view | ROADMAP 登记缺 | 写作场景有价值 | P2 |
| Pop-out 多窗口 | 显式未做，单窗口宿主约束 | Obsidian 桌面行为和插件 API 都涉及 | P2/需拍板 |

### 3. Canvas 是完整复刻的独立项目，不适合塞进普通 UI 轮

Canvas 不只是一个侧栏面板。完整复刻至少包括：

- 无限画布：缩放、平移、框选、拖拽、对齐。
- 节点类型：文本卡、笔记嵌入卡、媒体卡、网页卡。
- 连线：方向箭头、标签、颜色。
- 分组框。
- `.canvas` JSON 读写，与 `.md` 同级纳入 vault。
- Canvas 设置页和命令：新建白板、导出图片、转换为文件、跳转所选等。

建议单独立项：先定“复用 Excalidraw 交互/自建轻量画布”的方向，再拆存储、渲染、命令、设置、兼容 API。

### 4. Bases 是 Properties 之后的第二层数据系统

Bases 不是一个表格组件，而是库内数据库视图。至少需要：

- 属性字段模型。
- 查询/过滤/排序。
- 多视图。
- 与 Markdown frontmatter / Properties 同步。
- 命令与设置页。
- 插件 API 中 Bases/Value/query 族的策略。

建议不要只做外观表格。应先写数据模型和查询语义设计，再做 UI。

## P1：设置页“真实功能”补齐

上一份报告已经列出 G1-G10。这里强调功能闭环。

### 1. 文件与链接页

Obsidian 期望这页承担文件创建、链接格式、附件、删除策略、URI、缓存等行为。

仍需确认/补齐：

- 删除确认。
- 删除附件策略。
- 系统回收站 / 本地 `.trash` / 永久删除的 UI 和实际行为。
- 默认新建文件位置的所有入口一致生效。
- 附件路径策略对粘贴、拖入、导入、插件写入一致生效。
- `obsidian://` URI 开关、注册、重建缓存。
- 默认打开文件、打开外部文件、显示当前文件。

### 2. 编辑器页

设置页不应只是控件搬家。每个控件要能改变编辑器行为，并被命令/热键/重启持久化验证。

优先闭环：

- Vim mode。
- RTL。
- 拼写检查语言。
- 自动转换 HTML。
- 隐藏参考标记。
- 自动补全英文标点。
- 折叠标题/列表的持久化和阅读模式一致性。

### 3. 关于、账户、钥匙串、CLI

Obsidian 的通用设置包含应用版本、更新、语言、账户、商用许可、Catalyst、命令行接口、钥匙串密钥列表等。Geode 当前“关于”更接近产品说明页。

需要先做范围决策：

- 更新检查和自动更新是否按 Tauri updater 做完整桌面行为。
- 账户体系是否属于 E11 远期生态身份层。
- 商用许可/许可证页面与 E1 开源许可证决策如何衔接。
- CLI 是 GUI 内设置入口，还是独立 `geode` 命令。
- SecretStorage/Keychain 是纯本地能力、Tauri keychain 插件，还是先做兼容层占位。

### 4. 第三方插件页

当前有内置/外部/Obsidian 插件分组和卸载入口，但 Obsidian 的第三方插件页还包含：

- 安全模式。
- 社区插件市场浏览。
- 已安装插件更新检查。
- 自动检查更新。
- 插件列表：名称、版本、作者、描述、设置、启停、删除。

这不是单纯表格。要先定插件市场来源、网络策略、版本索引、签名/安全策略。

## P1：插件生态兼容缺口

`OBSIDIAN-COMPAT.md` 显示高频核心 API 已经推进很多，且第八梯队纯自主 bounded 项已基本清空。剩下的高价值缺口大多需要新依赖、Rust/Tauri host、CM6 跨层或 app-shell 接线。

优先项：

| 缺口 | 当前影响 | 需要的决策/工程 |
|---|---|---|
| `Vault.getResourcePath` / `DataAdapter.getResourcePath` | Excalidraw、图片工具、PDF/媒体插件生成 `<img>/<embed>` URI 会失败 | Tauri asset protocol / `convertFileSrc` 接线 |
| Lucide `setIcon` 覆盖 | 很多插件 ribbon/命令图标为空 | 是否引入 lucide 依赖或维护图标子集 |
| `parseYaml` / `stringifyYaml` | Dataview、Templater、QuickAdd、Tasks、MetaEdit 等读写配置/frontmatter 依赖 | 引入 YAML 运行时或自研最小子集 |
| CM6 `editorInfoField` 等 StateField / `Editor.getDoc` | CM6 插件无法可靠取得 active file/editor view | editor feature 层喂值，跨层集成 |
| `adapter.stat` | 插件无法读取文件大小/时间等元数据 | Rust `fs::metadata` + VaultAdapter 扩展 |
| `registerObsidianProtocolHandler` 派发 | Advanced URI、QuickAdd capture 等插件 URI 不生效 | host URI 管线给插件注册 action |
| `registerExtensions` | Excalidraw、PDF、图片查看器等不能声明自定义扩展视图 | 文件类型到 view 的注册和打开路径 |
| `App.lastEvent` | Mod/Shift 点击语义和 Keymap 判断不完整 | app-shell 全局事件捕获 |
| `SecretStorage` / `App.secretStorage` | AI、同步、API key 插件无法安全存密钥 | keychain 策略和 Tauri 能力 |

建议顺序：

1. `getResourcePath`：直接影响媒体、Canvas/Excalidraw、PDF 等显示。
2. Lucide：影响感知面，很多插件“加载了但看起来坏了”。
3. `parseYaml/stringifyYaml`：高生态价值，但先拍板依赖。
4. protocol/registerExtensions：影响高级插件入口。
5. CM6 StateField：影响编辑器增强类插件。
6. SecretStorage：和账户/AI/同步方向一起定。

## P1/P2：Node/Electron 和桌面宿主差距

用户已指出：Tauri 没有 Node/Electron 运行时，但很多 Obsidian 插件是按桌面 Electron 环境写的。当前插件 `require()` 白名单较窄，Node 原生模块和 Electron 全家桶没有入口，用到就会在 require 阶段失败。

缺口分层：

| 能力 | 典型插件/场景 | 建议 |
|---|---|---|
| `shell.openExternal` / `showItemInFolder` | 默认应用打开、访达显示、外链插件 | 优先垫，ROI 高 |
| `clipboard` 富剪贴板 | 剪藏、复制富文本、图片插件 | 可桥 Tauri clipboard |
| `os.homedir/tmpdir` | 插件临时文件、路径配置 | 可低风险垫片 |
| `fs` vault 外访问 | Obsidian Git、Pandoc、导入导出类插件 | 需明确安全边界 |
| `child_process` | Shell commands、Pandoc、Templater user script | 风险高，必须用户拍板 |
| 原生 `.node` 模块 | 少数重型桌面插件 | Tauri 下基本不可承诺 |
| Electron `remote/ipcRenderer/dialog/Menu` | 深度 Electron 插件 | 不建议承诺完全兼容 |

建议先做“桌面兼容等级”说明：

- Level 0：只支持官方 Obsidian API。
- Level 1：支持安全 shell/clipboard/os/path 子集。
- Level 2：受权限控制地支持 fs 和外部程序。
- Level 3：不承诺 Electron 私有 API 和原生模块。

这样可以避免用户误以为“支持 Obsidian 插件”就等于支持所有 Electron 插件。

## P2：桌面端完整行为

### 1. 多窗口和 pop-out

完整 Obsidian 桌面端包含 tab 移到新窗口、pop-out leaf、多窗口事件、窗口迁移。当前文档明确将其列为单窗口宿主天然不做或远期。

影响面：

- 标签页命令和右键菜单。
- WorkspaceWindow / WorkspaceFloating / moveLeafToPopout 等 API。
- 文件树“在新窗口打开”。
- 插件多窗口生命周期。

如果目标是完整复刻，需要重新拍板：是继续明确不做，还是单独启动 Tauri 多窗口架构项目。

### 2. 系统集成

完整桌面工作流还包括：

- 系统默认应用打开。
- 在 Finder 中显示。
- 打开外部 URI。
- 注册 `obsidian://` 或 Geode 自有协议。
- CLI handler。
- 应用更新。
- 系统剪贴板。
- Keychain。

这些不应混在设置页 UI 轮里做，应该作为 host capabilities 单独矩阵管理。

## 功能复刻验收矩阵建议

建议新建或在 ROADMAP 中维护一张矩阵，避免后续继续只看“有没有页面”。

每个功能至少记录：

| 字段 | 含义 |
|---|---|
| Obsidian 功能名 | 截图/官方文档里的名称 |
| Obsidian 所属页/插件 | 如编辑器、文件与链接、Canvas、Bookmarks |
| Geode 入口 | 设置、命令、热键、菜单、侧栏、API |
| 行为状态 | `done` / `partial` / `ui-only` / `stub` / `missing` / `out-of-scope` |
| 数据安全 | 是否写 vault、是否需要 byte-level 回归 |
| 宿主依赖 | 是否需要 Tauri/Rust/系统权限 |
| 插件 API 依赖 | 是否涉及 obsidian.d.ts 或 Electron/Node shim |
| 验收方式 | screenshot / e2e / probe / typecheck / byte regression |

最低验收标准：

- 设置项：控件存在、值持久化、重启后生效、行为被测试覆盖。
- 命令：命令面板可搜、热键可绑、执行有真实行为、禁用相关插件后状态正确。
- 菜单：菜单项存在、禁用态正确、点击后行为等价、快捷键/命令共享同一 handler。
- 插件：官方 API 签名接近、运行时行为不崩、真实插件加载矩阵验证。
- 桌面：跨平台路径、权限失败、取消操作、不可用宿主能力都有明确降级。

## 建议推进顺序

如果目标已经确定为“完整复刻优先”，建议不要马上跳到差异化 E 系列。更稳的顺序：

1. 建立功能复刻矩阵，把 280 条命令、核心插件、设置页、右键菜单、compat API 放到同一张状态表。
2. 推进 G1/G2：设置 IA 和视觉先对齐，但每个迁移控件标注是否已有真实功能。
3. 推进 G3：热键总表扩展时同步补 command handler，不做空行。
4. 推进 G4/G6/G7：文件树、Vault 管理、文件与链接设置，优先补迁移日常工作流。
5. 推进 G8：编辑器查找替换、格式命令、表格命令、Vim/RTL/HTML/隐藏参考标记。
6. 单独拍板 Canvas 和 Bases。它们不是普通 polish，是完整复刻路线的两座大工程。
7. 同步排 F1/F2 与高价值 compat：getResourcePath、Lucide、YAML、protocol、registerExtensions、CM6 StateField。
8. 最后再进入 E 系列差异化路线，除非某项差异化能力能直接服务复刻闭环。

## 需要避免的误判

- “侧栏无法收起”已经不是当前事实；应改为“可收起，但折叠 affordance 与 Obsidian 视觉位置不同”。
- 早期 `11-复刻完成度盘点.md` 中的部分缺口已经被后续 R 轮完成或部分完成；排期前应以当前代码和 `ROADMAP` 最新段落复核。
- 热键 280 条不是静态列表工作；没有真实 handler 的命令会制造假完成。
- 核心插件“已有”不等于“Obsidian 等价”；必须检查设置 tab、命令、面板、禁用态、持久化和插件 API。
- 插件兼容“高频 API 已覆盖”不等于“Electron 插件可跑”；Node/Electron shim 是另一条能力线。
- Canvas/Bases 不能按普通设置页或菜单补丁处理，应单独设计和验收。

