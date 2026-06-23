# Obsidian 完整复刻差距审计（常驻活文档）

> **定位**：辅助开发的单一差距来源。整合自三份历史文档——
> `OBSIDIAN_REPLICA_GAP_AUDIT_2026-06-23.md`（页面/视觉/设置 IA/右键菜单）、
> `OBSIDIAN_FUNCTIONAL_GAP_SUPPLEMENT_2026-06-23.md`（功能契约/命令/核心插件/桌面宿主/兼容 API）、
> `geode-设计讨论/11-复刻完成度盘点.md`（R22 早期盘点，已退化为指向本文的占位）。
> 本文取代上述三份；排期前以本文 + `ROADMAP.md` G/F 系列最新段落 + 当前代码为准。
>
> **最近审计**：2026-06-23 · 基线 Geode v0.173.0（开发服 `http://127.0.0.1:1420/`），代码线已至 R178（v0.175）。
> **对照基准**：Obsidian 1.9.10 简中截图（`reference/_截图/` 42 张，`2940×1912`）+ `reference/00–08`（注：`reference/` 当前位于工作区根、不在 `geode/` 仓库内，G 系列「逐像素验收」暂据审计文字 + Obsidian 实测，真·像素级须先补截图资产）。
> **维护约定**：活文档——每轮若改动复刻表面/功能闭环，顺手更新对应行的状态标注；勿再新建带日期的快照审计。

---

## 结论摘要

Geode 底层能力与兼容层推进充分，但「像 Obsidian 一样呈现」的信息架构、设置页、热键清单、视觉细节仍明显不足。当前状态是「**Obsidian 风格知识库 + 大量核心能力**」，尚非「**完整复刻 Obsidian 桌面端**」。

最大风险不是单个控件能否工作，而是**许多日常行为入口未成闭环**：命令没注册、设置页没真实功能、核心插件只有部分等价、桌面宿主与 Node/Electron 仍有硬边界。

| 维度 | 当前判断 | 复刻风险 |
|---|---|---|
| 知识库基础能力 | Markdown、wikilink、反链、图谱、搜索、属性、模板、日记、文件恢复、页面预览、块引用等已大量落地 | 基础足够强，但还不是完整桌面端体验 |
| 设置与命令 | 设置主导航历史为 5 项（G1/R177 已重构为三段式 IA）；热键 90 条 vs Obsidian 280 条 | 用户明显感知「不像 Obsidian」，且很多功能没有命令入口 |
| 核心插件 | 多数中小型核心插件已有或部分有；Canvas、Bases、录音、Web clipper、格式转换器仍缺 | Canvas / Bases 是完整复刻的硬大件 |
| 桌面宿主能力 | 单窗口 Tauri 宿主；pop-out、多窗口、系统 shell、Node/Electron 运行时未等价 | 影响右键菜单、第三方插件、桌面工作流 |
| 插件兼容 API | 高频 API 覆盖多；bounded 项基本清空，剩余为新依赖或跨层大集成 | 要兼容更多真实插件须补 getResourcePath、Lucide、YAML、protocol、StateField 等 |

**取向（✅ 2026-06-23 用户已拍板「完整复刻」优先）**：先以 `reference/` 为验收标准做表面复刻，**暂不先做差异化 E 系列**。后续不应只看「有没有页面」，而须对每个功能维护一张复刻矩阵（见末节）。

---

## 关键量化结论

| 项 | Obsidian 参考 | Geode 当前 |
|---|---:|---:|
| 设置左侧主导航 | 8 项（关于·编辑器·文件与链接·外观·快捷键·钥匙串·核心插件·第三方插件）+ 核心/第三方插件子项 | 审计时扁平 5 项；**G1/R177 已重构为三段式 IA**（选项 / 核心插件 / 第三方插件） |
| 快捷键命令数 | 截图显示 280 条 | 90 条 |
| 删除当前文件命令 | 存在，默认无键 | ✅ 已有 |
| 左右侧栏折叠命令 | 存在，默认无键 | ✅ 已有（R160） |
| 管理仓库命令 | 存在 | ❌ 未发现 |

校准测试基线（审计时运行，无运行时红灯）：`npm run typecheck` 0 错；`.calibration/` 套件 r176/r166/r160/r145/r139/r100/r94 全数通过。

---

## 一、视觉与页面差距（表面忠实度 = 最大迁移感知缺口）

### 1. 设置弹窗 IA

Obsidian 左栏三段：**选项**（关于·编辑器·文件与链接·外观·快捷键·钥匙串·核心插件·第三方插件）/ **核心插件**（白板·笔记重组·反向链接·快速切换·命令面板·模板·日记·同步·文件恢复·页面预览…）/ **第三方插件**（每个已启用插件一个设置入口）。

现状：审计时仅外观·插件·快捷键·命令面板·关于 5 项，许多设置（严格换行、行号、自动补全括号、新建位置、附件路径、模板、日记、页面预览）被塞进「外观」页。**G1（R177）已重构为三段式 IA 并把控件迁回 Obsidian 同名页**，保 store 绑定、reopen 回显零丢值；剩视觉像素级（G2）与核心插件总览/开关页（defer）。

### 2. 设置行样式（接近但未达像素级）

已有：左名称/描述 + 右控件的 setting row；Toggle、输入框、滑块、分隔线、右对齐控件。
差距：弹窗整体偏窄、内容密度不同；浅色图有多余的整窗蓝色 focus ring（Obsidian 无此态）；分组 section/card 感弱（多为连续行）；控件偏 Web 表单风（下拉·管理按钮·图标按钮·取色器·开关的尺寸/阴影不及原生桌面）；字体应为「管理」弹窗（现为文本输入框）、主题应为下拉+管理（现为 segmented control）。→ G2。

### 3. 热键页

Obsidian：280 条；顶部搜索+过滤；按来源分组（白板·表格·笔记重组·日记·书签·属性·数据库·同步·文件列表·反链·图谱·大纲·模板·编辑格式·视图外观·库应用…）；右侧键位 chip + 圆形加号/删除控件。
现状：90 行；搜索 + 「只显示已设置」筛选可用；右侧为「自定义」按钮（非加号/删除式）；无按来源分组的完整清单；`管理仓库` 等命令缺失，默认键位未逐项校准。→ G3（须配真 handler，见功能闭环）。

### 4. 第三方插件页

Obsidian：安全模式 / 社区市场浏览 / 安装检查·更新 / 自动检查更新 / 已安装列表（名·版本·作者·描述·设置·启停·删除）。
现状：内置·外部·Obsidian 三组；内置有开关；社区插件卸载入口 R166 过测；缺安全模式/市场/更新结构；核心与第三方未拆成 Obsidian 同名顶级页。→ G10。

### 5. 文件树 / 编辑器右键菜单

Obsidian 文件菜单：在新标签页/右侧标签页/新窗口中打开 · 创建副本 · 移动到其他文件夹 · 复制库内路径 / 复制 Obsidian 链接 · 打开历史 · 使用默认应用打开 · 在系统访达中显示 · 重命名 · 删除。
现状：文件夹菜单 5 项（在此新建笔记/文件夹·移动到·重命名·删除）；文件菜单含 新标签/右侧/副本/移动/重命名/删除。
仍缺：新窗口打开、复制库内路径、复制 Obsidian 链接、打开历史/版本历史、默认应用打开、访达显示；菜单分组·宽度·阴影·浅色样式未对齐。→ G4（多为桌面行为，见功能闭环）。

### 6. 侧栏折叠（功能已修，视觉待对齐）

R160 起左右侧栏可折叠 + 持久化 + 命令路径全过回归。**「无法收起」已非事实。** 仅 affordance 位置不同：Geode 用侧栏/主区边界中部的悬浮 chevron，Obsidian 更贴标题栏/侧栏头部、与 workspace chrome 融合。→ G5。

---

## 二、设置功能覆盖差距（按 Obsidian 同名页）

### 编辑器
已有/部分：固定行宽、严格换行、行号、折叠标题、自动补全括号、制表符/缩进宽度、默认新标签视图、拼写检查开关。
差距：无独立「编辑器」页（控件曾错放外观，G1 已迁）；拼写检查语言、自动补全英文标点、自动转换 HTML、Vim 模式、RTL、隐藏参考标记未完整呈现。→ G8。

### 文件与链接
已有/部分：自动更新内部链接、Wiki/Markdown 链接设置、链接路径格式、新笔记默认位置、附件路径、忽略文件、本地 `.trash`、`obsidian://` 内部处理。
差距：无独立「文件与链接」页（G1 已迁）；删除确认、删除附件策略、系统回收站/本地回收站/永久删除 UI、设置文件夹切换、URI 链接开关、重建缓存、默认打开文件未完整复刻。→ G7。

### 外观
已有/部分：深色/浅色/跟随系统、强调色、界面/正文/等宽字体、字号、可读行宽、inline title、ribbon 显隐、tab title bar / status bar 显隐。
差距：主题市场/已安装主题管理 UI 不完整；字体「管理」弹窗未复刻（现文本框）；快速调整字号、缩放比例、原生菜单、窗口边框样式、自定义应用图标、半透明、硬件加速等未按 Obsidian UI 呈现。→ G2/G9。

### 关于 / 账户 / 钥匙串 / CLI
Obsidian：安装版本·检查更新·自动更新·语言·帮助·账户·Catalyst·商用许可·高级启动通知·命令行界面·钥匙串密钥列表。
现状：「关于」更像产品说明页；账户/许可体系、钥匙串独立页、CLI 设置、帮助/翻译入口缺失。→ G9（多项须用户拍板：账户=E11、钥匙串=compat SecretStorage、CLI 形态、更新走 Tauri updater）。

### 核心插件
已实现但需 IA 对齐：反向链接/出链、关系图谱、快速切换、命令面板、模板、日记、文件恢复、书签、Properties、页面预览。
后续重点不是「有没有」，而是：设置 tab 是否按 Obsidian 同名出现、命令是否完整进 280 清单、右键/面板入口是否完整、插件 instance 是否接近、关闭核心插件后 UI/命令/面板是否一致消失。

---

## 三、功能域矩阵（差距等级 + 建议）

| 功能域 | Obsidian 期望 | Geode 当前 | 差距 | 建议 |
|---|---|---|---|---|
| Vault 管理 | 管理仓库、打开/切换/最近 vault、库级设置入口 | `管理仓库` 命令未发现；缺 vault 管理/切换器 | P0 | 入口级功能单独立项（G6） |
| 命令/热键 | 280 条，分组可逐项绑定 | ~90 条；搜索/筛选可用，总表不完整 | P0 | 先建命令矩阵再补真实命令，不只补 UI 行（G3） |
| 文件树操作 | 新标签/右侧/新窗口、复制路径/Obsidian 链接、历史、默认应用、访达、移动/重命名/删除 | 常用新建/移动/重命名/删除/副本已有；系统级与历史类缺 | P0 | 分纯前端项与宿主项推进，避免只画菜单（G4） |
| 编辑器工作流 | 查找替换、格式/表格命令、Vim、RTL、拼写语言、HTML 转换、隐藏参考标记 | 部分编辑设置已具备；多项未完整或缺命令 | P0/P1 | 从 280 清单反推编辑器命令与设置（G8） |
| 核心插件 | Canvas、Bases、Backlinks、Graph、Daily、Templates、File recovery、Page preview… | 多数已做或部分做；Canvas/Bases/Audio/Web clipper/格式转换器缺 | P0/P1/P2 | Canvas/Bases 单独立项；小插件先补零依赖项 |
| 设置页真实功能 | 各页有真实设置 | 部分已迁；About/Keychain/CLI/插件市场缺真实功能 | P0/P1 | G1/G2 之后跟 G6–G10 真实行为闭环 |
| 桌面宿主 | 多窗口、pop-out、系统打开、剪贴板、协议注册、外部程序、部分 Node/Electron | 单窗口宿主；`require()` 白名单很窄 | P1/P2 | 先定 Tauri 安全边界，再选 shell/clipboard/fs 子集（F1） |
| 插件生态 | 常见插件可加载、显图标、访问资源、读写 YAML、注册 URI/扩展名 | 高频 API 覆盖多；剩余高价值项需依赖或跨层接线 | P1 | 优先 getResourcePath、Lucide、parseYaml、protocol、StateField |

---

## 四、优先级（与 ROADMAP G/F 系列一一对应）

> 本文 = 差距来源；`ROADMAP.md`「表面复刻差距（G 系列）」「功能复刻补充」「兼容深化（F 系列）」= 执行队列与出队记录。条目编号与 ROADMAP 保持同步。

### P0 · 先修「看起来不像」的面（迁移感知第一）
- **G1 设置三段式 IA 重构** — ✅ DONE（R177）：扁平 5 段 → 三组 IA，控件迁回 Obsidian 同名页，零丢值。
- **G2 设置页视觉像素级** — **G2-a 已 R178 完成**（修浅色整窗蓝 focus ring、主题 segmented→原生下拉、弹窗 760→900/左栏 170→200/段标题分隔线，颜色走 CSS 变量）；**G2-b 余项**＝字体改「管理」弹窗（需系统字体枚举=功能）+ 下拉/图标按钮/取色器/开关原生阴影尺寸细抛光 + setting row 行高/主题「+管理」入口。与 G3 同为当前下一项。
- **G3 热键 90→280 总表** — 按来源分组 + 加号/删除控件 + 默认键位校准 + 补 `管理仓库` 等；每行须配真 handler。
- **G4 右键菜单补齐** — 新窗口/复制库内路径/复制 Obsidian 链接/打开历史/默认应用/访达；分组·样式对齐。
- **G5 侧栏折叠 affordance** — 行为已完成，仅移动 chevron 位置、与 chrome 融合（纯 CSS/布局）。

### P1 · 补设置页背后的真实功能
- **G6 Vault 管理/切换器 + `管理仓库` 命令** — = P2「Vault 管理」大件的命令入口。
- **G7 文件与链接页真实功能** — 删除确认/附件删除策略/三档回收站 UI/设置文件夹切换/URI 开关/重建缓存/默认打开文件（触 vault 删除路径 = data-safety 重轮）。
- **G8 编辑器页真实功能** — Vim/RTL/拼写语言/自动英文标点/自动转 HTML/隐藏参考标记。
- **G9 关于/账户/钥匙串/CLI 页** — 多项须用户拍板。
- **G10 第三方插件页结构** — 安全模式/市场/更新检查/已安装列表（须定网络源策略）。

### P2 · 大件 + 兼容层（多数已在 ROADMAP 候选池 A 节 / 第八梯队 D 系列 / E 系列登记，审计 = 优先级提升信号，不重复入队）
- Canvas / Bases / Stacked tabs / Pop-out 多窗口 / Vault 管理 → 候选池补充 A 节。
- Web clipper / Audio recorder / Markdown 格式转换器 → E8 + 第五梯队小众核心。
- getResourcePath / Lucide / adapter.stat / App.lastEvent / protocol 派发 / registerExtensions → 第八梯队 D 系列 + F1。
- parseYaml / stringifyYaml / Bases·Value 声明式 Settings / SecretStorage·Keychain / Popout 多窗口 API → T3 越界表（须拍板）。

---

## 五、核心插件差距

### 已有或部分有（勿当从零项重做）
Backlinks、Graph / local graph、Quick switcher、Command palette、Templates、Daily notes、Zettelkasten 唯一笔记、Word count、Properties view、Search、File recovery、File explorer、Slash commands、Page preview、Note composer、Bookmarks（数据 + 部分内部 API）、PDF/音视频只读预览。
→ 重点：设置 tab 同名、命令进 280 清单、右键/面板入口、插件 instance 接近、禁用后一致消失。

### 仍缺或未成闭环
| 项 | 判断 | 重要性 | 优先级 |
|---|---|---|---|
| Canvas `.canvas` | 缺（ROADMAP A 节大工程） | 核心插件 + 用户点名项 | P0 大件 |
| Bases | 缺（依赖数据库/查询引擎） | 2025 新核心，与 Properties 强相关 | P1/P2 大件 |
| Stacked tabs / linked view | pinned tabs 已有，堆叠/linked view 不完整 | 长文多 pane 工作流高频 | P1 |
| 独立 tag pane | 搜索面板有标签浏览，独立侧栏面板未做 | 侧栏核心工作流 | P1 |
| Audio recorder | 缺，需新能力 | 核心但人群窄 | P2 |
| Web clipper | 缺（E8 已登记 defuddle 方向） | 迁移/收集工作流 | P1/P2 |
| Markdown 格式转换器 | 缺（适合零依赖先做） | 导入/整理老 Markdown | P1 |
| Slides / Footnotes view | 缺 | 人群窄 / 写作场景 | P2 |
| Pop-out 多窗口 | 显式未做（单窗口宿主约束） | 桌面行为 + 插件 API 都涉及 | P2/需拍板 |

**Canvas** 是独立项目级工程，非普通 UI 轮：无限画布（缩放/平移/框选/拖拽/对齐）+ 节点类型（文本/笔记嵌入/媒体/网页卡）+ 连线（箭头/标签/颜色）+ 分组框 + `.canvas` JSON 读写（与 `.md` 同级纳入 vault）+ 设置页与命令。建议先定「复用 Excalidraw 交互 / 自建轻量画布」方向。

**Bases** 是 Properties 之后的第二层数据系统，非表格组件：属性字段模型 + 查询/过滤/排序 + 多视图 + 与 frontmatter/Properties 同步 + 命令与设置页 + Bases/Value/query 族插件 API。建议先写数据模型与查询语义，再做 UI。

---

## 六、插件兼容层差距（高价值缺口 + 推进顺序）

`OBSIDIAN-COMPAT.md` 结论：高频核心 API 覆盖不错，bounded 项基本清空；剩余高价值缺口多需新依赖、Rust/Tauri host、CM6 跨层或 app-shell 接线。

| 缺口 | 当前影响 | 需要的决策/工程 |
|---|---|---|
| `getResourcePath`（Vault/DataAdapter） | Excalidraw、图片/PDF/媒体插件生成 `<img>/<embed>` URI 失败 | Tauri asset protocol / `convertFileSrc` 接线 |
| Lucide `setIcon` 覆盖 | 很多插件 ribbon/命令图标为空（「加载了但看起来坏」） | 是否引入 lucide 依赖或维护图标子集 |
| `parseYaml` / `stringifyYaml` | Dataview、Templater、QuickAdd、Tasks、MetaEdit 读写 frontmatter 依赖 | 引入 YAML 运行时或自研最小子集（须拍板依赖） |
| CM6 `editorInfoField` 等 StateField / `Editor.getDoc` | CM6 插件无法可靠取得 active file/editor view | editor feature 层喂值，跨层集成 |
| `adapter.stat` | 插件无法读文件大小/时间元数据 | Rust `fs::metadata` + VaultAdapter 扩展 |
| `registerObsidianProtocolHandler` 派发 | Advanced URI、QuickAdd capture 等插件 URI 不生效 | host URI 管线给插件注册 action |
| `registerExtensions` | Excalidraw、PDF、图片查看器不能声明自定义扩展视图 | 文件类型→view 的注册与打开路径 |
| `App.lastEvent` | Mod/Shift 点击语义与 Keymap 判断不完整 | app-shell 全局事件捕获 |
| `SecretStorage` / `App.secretStorage` | AI、同步、API key 插件无法安全存密钥 | keychain 策略与 Tauri 能力 |

**推进顺序**：`getResourcePath`（媒体/Canvas/PDF 显示，最直接）→ Lucide（感知面）→ `parseYaml/stringifyYaml`（生态高价值，先拍板依赖）→ protocol 派发 + `registerExtensions`（高级插件入口）→ CM6 StateField（编辑器增强类）→ `SecretStorage`（与账户/AI/同步一起定）。对应第八梯队 D 系列 + T3 + F 系列。

---

## 七、Node/Electron 桌面宿主差距

Tauri 无 Node/Electron 运行时，但很多 Obsidian 插件按桌面 Electron 环境写。当前插件 `require()` 白名单（`loader.ts` `HOST_MODULES`）= `obsidian` + `path`(posix 字串垫片) + `@codemirror/*`×6 + `@lezer/highlight`，其余抛 `module not available`；Node 原生模块与 Electron 全家桶无 require 入口，用到即加载期报错。

| 能力 | 典型插件/场景 | 建议 |
|---|---|---|
| `shell.openExternal` / `showItemInFolder` | 默认应用打开、访达显示、外链插件 | 优先垫，ROI 高 |
| `clipboard` 富剪贴板 | 剪藏、复制富文本、图片插件 | 可桥 Tauri clipboard |
| `os.homedir/tmpdir` | 插件临时文件、路径配置 | 低风险垫片 |
| `fs` vault 外访问 | Obsidian Git、Pandoc、导入导出类 | 需明确安全边界 |
| `child_process` | Shell commands、Pandoc、Templater user script | 风险高，**必须用户拍板** |
| 原生 `.node` 模块 | 少数重型桌面插件 | Tauri 下基本不可承诺 |
| Electron `remote/ipcRenderer/dialog/Menu` | 深度 Electron 插件 | 不建议承诺完全兼容 |

**桌面兼容等级（先做分级说明，避免「支持 Obsidian 插件」被误读成「支持所有 Electron 插件」）**：
- **L0**：只支持官方 Obsidian API（移动端口径，最稳）。
- **L1**：+ 安全 `shell.openExternal/showItemInFolder` · `clipboard` · `os.homedir/tmpdir` · `path` 子集（ROI 高，多可桥 Tauri 现成插件）。
- **L2**：+ 受权限控制的 `fs`（vault 外）· 外部程序 `child_process`（须明确安全边界，`child_process` 须用户拍板）。
- **L3**：**不承诺** Electron 私有 API 与原生 `.node` 模块。

→ ROADMAP F1（垫片补全，先评估 `isDesktopOnly:true` 插件真实依赖再按 ROI 选垫）。

---

## 八、桌面端完整行为

**多窗口 / pop-out**：tab 移到新窗口、pop-out leaf、多窗口事件、窗口迁移。当前明确列为单窗口宿主天然不做或远期。影响：标签页命令与右键菜单、`WorkspaceWindow/WorkspaceFloating/moveLeafToPopout` API、文件树「在新窗口打开」、插件多窗口生命周期。若目标为完整复刻须重新拍板：继续不做，还是单独启动 Tauri 多窗口架构项目。

**系统集成**（应作为 host capabilities 单独矩阵管理，勿混进设置页 UI 轮）：系统默认应用打开、访达显示、打开外部 URI、注册 `obsidian://` 或 Geode 自有协议、CLI handler、应用更新、系统剪贴板、Keychain。

---

## 九、功能复刻验收矩阵（贯穿基建）

> 后续每个 Obsidian 功能一行，避免只看「有没有页面」。建议在本文或单表维护。

| 字段 | 含义 |
|---|---|
| Obsidian 功能名 / 所属页·插件 | 截图/官方名称；如编辑器·文件与链接·Canvas·Bookmarks |
| Geode 入口 | 设置 / 命令 / 热键 / 菜单 / 侧栏 / API |
| 行为状态 | `done` / `partial` / `ui-only` / `stub` / `missing` / `out-of-scope` |
| 数据安全 | 是否写 vault、是否需 byte-level 回归 |
| 宿主依赖 | 是否需 Tauri/Rust/系统权限 |
| 插件 API 依赖 | 是否涉 `obsidian.d.ts` / Electron·Node shim |
| 验收方式 | screenshot / e2e / probe / typecheck / byte-regression |

**最低验收线**：
- 设置项 = 控件存在 + 值持久化 + 重启生效 + 测试覆盖。
- 命令 = 面板可搜 + 热键可绑 + 真实行为 + 禁用相关插件后状态正确。
- 菜单 = 项存在 + 禁用态正确 + 点击等价 + 与命令/热键共享同一 handler。
- 插件 = 官方签名接近 + 运行不崩 + 真实加载矩阵验证。
- 桌面 = 跨平台路径、权限失败、取消操作、不可用宿主能力都有明确降级。

---

## 十、建议推进顺序

1. 建立**功能复刻矩阵**（280 命令 + 核心插件 + 设置页 + 右键 + compat API 同一张状态表）。
2. G1/G2 设置 IA + 视觉，每个迁移控件标注是否已有真实功能（G1 已 R177 完成）。
3. G3 热键总表**同步补 handler，不做空行**。
4. G4/G6/G7 文件树·Vault 管理·文件与链接（迁移日常工作流）。
5. G8 查找替换/格式/表格命令 + Vim·RTL·HTML·隐藏参考标记。
6. **Canvas / Bases 单独拍板立项**（非 polish，是两座大工程）。
7. 同步排 F1/F2 + 高价值 compat（getResourcePath/Lucide/YAML/protocol/registerExtensions/CM6 StateField）。
8. 最后才进 E 系列差异化（除非某延伸能直接服务复刻闭环）。

---

## 十一、防误判（排期前必复核 · 防假完成/重复劳动）

- 「侧栏无法收起」**已非事实**（R160 可收起 + 持久化，仅 affordance 视觉位置不同）。
- 早期 `geode-设计讨论/11-复刻完成度盘点.md`（R22）的缺口**多已被后续 R 轮完成/部分完成**（悬停预览、PDF/音视频预览、折叠等）；以当前代码 + 本文 + ROADMAP 最新段落为准（呼应「grep 现状门」纪律）。
- **核心插件「已有」≠「Obsidian 等价」**：须查设置 tab / 命令 / 面板 / 禁用态 / 持久化 / 插件 instance，别当从零项重做。
- **热键 280 非静态列表**：无真实 handler 的命令 = 假完成；`ui-only/stub` 严禁在热键页伪装可用。
- **高频 API 已覆盖 ≠ Electron 插件可跑**：Node/Electron shim 是另一条能力线（F1）。
- **Canvas/Bases 不能当普通设置页/菜单补丁**：须单独设计 + 验收。

---

## 相关文档

- `ROADMAP.md` — G 系列「表面复刻差距」、功能复刻补充、F 系列「兼容深化」的执行队列与出队记录。
- `OBSIDIAN-COMPAT.md` — 插件兼容层 Tier 表、校准机制、验收套件、越界表。
- `reference/00–08` + `reference/_截图/` — 像素级验收基准。
- `ARCHITECTURE.md` — R16 改写引擎 / R17 折叠摄入等显式口径与技术债根因。
