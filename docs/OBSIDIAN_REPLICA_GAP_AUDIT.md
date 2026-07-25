# Obsidian 完整复刻差距审计（常驻活文档）

> **定位**：Geode 复刻差距的单一事实源。状态只允许 `done / partial / missing / excluded`，
> 每项必须附当前代码、测试或 Obsidian 官方证据。历史 ROADMAP 只作 round 证据，不直接推断现状。
>
> **最近重审**：2026-07-10 · Geode v0.284.0 / commit `ec29233` / R292 后工作树。
> **冻结验收基线**：Obsidian Desktop 1.9.10 简中 + `reference/` 42 张截图。
> **版本漂移**：当前 Public = Desktop 1.12.7（2026-03-23）；1.13.1 仍为 Catalyst，
> 只观察、不抬高 1.9.10 当期终点。
> **排除边界**：1.9.10 阶段排除 Obsidian Sync、Publish、账户/许可商业服务和移动端；
> Canvas、Bases、PDF.js、多窗口、Audio recorder 等本地桌面能力不得因工程量大而排除。

---

## 结论

Geode 已经跨过“Obsidian 风格编辑器”阶段：本地 vault、Markdown/live preview、链接与嵌入、
搜索、图谱、文件树、工作区、主题和一批真实 Obsidian 插件均可使用。普通本地 Markdown
用户的高频主路径大体接近替代线。

但距离“完美复刻”仍有五个结构性缺口：

1. **核心插件开关不真实**：设置总表 21 行中只有 Random note、Daily notes、Unique notes、
   Word count 4 行绑定真实 `pluginId`；其余大量已有功能仍是 always-on，禁用开关只能显示为 disabled。
2. **插件生态是工程证明，不是产品承诺**：加载、设置、启停、卸载和失败报告已有，但资源 URI、
   扩展名、协议、用户事件、SecretStorage 仍有明确 warn-stub/null；市场、更新和兼容级别未闭环。
3. **Obsidian 本体大件缺失**：PDF 仍用原生 iframe；Canvas、Bases、Audio recorder、多窗口没有实现文件。
4. **桌面分发证明不足**：本地校准资产很多，但 CI 只执行 r23/r24；Rust、最新回归、真插件与桌面 smoke
   未形成持续闸门，版本号仍有 package/Tauri `0.284.0` vs Cargo `0.22.0` 漂移。
5. **复刻基线会漂移**：1.12 已新增 CLI、拖拽图片缩放、自动附件清理与 API 变化。必须用“冻结基线收口 →
   Public 漂移晋级”的节奏追赶，不能一边做 1.9.10 一边无限改终点。

若只作方向判断，当前整体仍约在 **70% 左右**；该数字不作为验收。真正验收是本文矩阵不再有本地桌面
核心能力的 `partial/missing`，并且每个 `done` 都有用户入口、持久化、禁用态和回归证明。

## 本轮删除的过时结论

- “设置仍只有 5 项”“热键只有 90 条”“右键缺复制路径/默认应用/访达”“侧栏无法折叠”均已过时。
- Vault manager 已在 R280 补新建/打开/移除等主路径；Stacked tabs 已 R255 完成；Tags 与 Footnotes 早已有
  独立面板并多轮补深，不再作为从零候选。
- Files & Links 的删除确认、孤儿附件 Ask/Delete/Keep 和本地 `.trash` 已在 R242/R244/R42 完成，
  不得再以“删除功能缺失”重复入队；真实余项是**默认打开文件 + 删除去向三档 + 系统回收站桥**。
- G3 的 bounded 高频命令池已重审枯竭。Obsidian 截图里的 280 条包含已启用插件命令，不能用
  “280 - Geode 命令数”制造假任务；剩余命令跟随大件或宿主能力交付。
- Apache-2.0 许可证已经落地；“仓库无 LICENSE”是历史状态。

---

## 总体矩阵

| 域 | 状态 | 当前事实 | 阻止 `done` 的缺口 | ROADMAP |
|---|---|---|---|---|
| Vault 与数据安全 | `partial` | 本地 vault、watch、原子写、共享 DocumentHandle、flush-first trash、恢复、rename 引用改写已建立 | 系统回收站、删除去向三档、默认启动文件、20 条真实迁移任务 | R298 / R316 |
| Markdown 编辑与阅读 | `partial` | live/source/reading、常见 Markdown、wikilink、标题/块引用、嵌入、Properties、表格、数学、Mermaid 等已覆盖 | 固定视觉回归；PDF 独立视图；1.12 拖拽图片缩放进入漂移池 | R299 / R304+ / D2 |
| 导航与工作区 | `partial` | tabs、splits、stacked tabs、历史、侧栏折叠、工作区保存恢复已完成 | pop-out/多窗口、跨窗 leaf 生命周期与插件事件 | R307+ |
| 设置与视觉 | `partial` | 三段式 IA、主要设置页和控件已有，多轮 screenshot 校准；R297 已让现存核心插件 toggle/设置 Tab 真联动 | 无 8–12 张固定整屏 baseline/diff；Keychain 空页 | R299 / R302 |
| 命令与热键 | `partial` | 高频编辑/导航/文件/面板命令主干已注册；绑定 UI 与筛选可用 | 余项主要从 Canvas/Bases/多窗口/Audio/CLI 等未建能力派生；默认键与来源仍需随功能闭环复核 | 随各大件 |
| 核心插件 | `partial` | R294–R297 已完成 21/29 行真实启停，现存中小能力的 toggle/命令/面板/设置 Tab 已联动 | Slides 仍为能力在但未插件化；Canvas/Bases/Audio/Markdown converter 缺；Publish/Sync 商业服务 excluded | R315 / 大件对应轮 |
| 社区插件产品 | `partial` | `.obsidian/plugins` 扫描、manifest、启停、设置页、卸载、失败原因、多个真插件已证明 | Restricted mode、浏览/安装/升级、兼容分级、代表矩阵缺 | R303 |
| Obsidian API 兼容 | `partial` | Vault/Workspace/Metadata/Editor/UI/CM6 大量 API 与真插件路径已跑通 | asset URI、extensions、protocol、lastEvent、SecretStorage、stat/appendBinary 等 | R300–R302 / D3 |
| 本体大件 | `missing` | PDF 只有原生 iframe；无 Canvas/Bases/多窗口/Audio 源文件 | PDF.js、JSON Canvas、Bases query/view、Tauri 多窗口、MediaRecorder | R304–R315 |
| CI 与分发 | `partial` | typecheck/build/cargo/local probes/updater/NSIS 文档均有 | CI 只跑早期 r23/r24；版本漂移；Windows install/update/rollback 未持续验证 | R299 / R317 |

---

## 一、核心插件：最大结构性缺口

### 当前证据

- `SettingsModal.tsx` 的 `CORE_PLUGIN_ROWS` 有 29 行（R294 补齐 1.9.10 目录：+search/bookmarks/properties-view/footnotes-view/bases/web-clipper/markdown-converter/sync）。
- 21 行配置真实 `pluginId`：4 原始 + `tags`（R294）+ `outline`/`outgoing-links`/`backlinks`/`graph`（R295 wave-1）+ `file-explorer`/`search`/`quick-switcher`/`command-palette`/`workspaces`（R296 wave-2）+ `templates`/`file-recovery`/`note-composer`/`page-preview`/`bookmarks`/`properties-view`/`footnotes-view`（R297 wave-3）。
- 没有注册插件支撑的行继续显示 disabled toggle，但现在只对应未建、excluded 或尚待独立纵切的能力，不再把已存在 feature 伪装成不可关闭。
- `src/plugins/index.ts` 已注册上述内建插件；`backlink-count` 是额外内建能力，仍没有对应 Obsidian 核心插件总表开关。

因此“功能存在”不能标为核心插件 `done`。单项必须同时满足：

1. 总表真实启停并持久化；
2. 关闭后命令、面板、ribbon、状态栏、右键、设置 Tab 一致消失；
3. 开启后恢复原工作区状态或给出 Obsidian 等价默认；
4. compat `internalPlugins` / 插件实例行为按承诺暴露；
5. 有 cold start + reopen + 禁用态 E2E。

### 状态分组

| 状态 | 项目 |
|---|---|
| `done`（可真实启停） | Random note、Daily notes、Unique notes、Word count、Tags（R294）、Outline、Outgoing links、Backlinks、Graph（R295 wave-1）、File explorer、Search、Quick switcher、Command palette、Workspaces（R296 wave-2）、Note composer、Templates、File recovery、Page preview、Bookmarks、Properties view、Footnotes view（R297 wave-3） |
| `partial`（能力在但非真插件） | Slides |
| `missing` | Canvas、Bases、Audio recorder、Markdown converter |
| `excluded` | Publish、Sync（仅商业服务；本地文件兼容与相关设置仍须优雅展示） |

R294–R297 三波核心插件化已闭环；剩余核心插件缺口转入 R315 独立纵切（Slides / Audio recorder / Markdown converter）及 Canvas/Bases 大件轮，不回退为一个巨大布尔值。

---

## 二、Files & Links 与真实迁移

### 已完成，禁止重复入队

- 新笔记位置三档、附件位置四档、链接格式与自动更新、忽略规则、URI 开关、重建缓存。
- 删除确认（默认安全开启）。
- 孤儿附件 Ask/Delete/Keep；正文和 frontmatter 引用纳入判断。
- 本地 `.trash`、恢复、删除前 flush、批量删除与附件 best-effort 路径。

### 真实余项

| 项 | 状态 | 验收 |
|---|---|---|
| 默认打开文件 | `missing` | 启动/切库后按设置打开指定文件；缺失/改名/无扩展名安全降级 |
| 删除去向：系统/本地/永久 | `partial` | 设置持久化；所有入口共用策略；永久删除有明确二次边界；浏览器无系统能力时不可伪成功 |
| `DataAdapter.trashSystem` / `Vault.trash(system)` | `missing` | Tauri OS trash 成功/取消/权限失败可诊断，不再静默回落后声称 system trash |
| 20 条真实迁移任务 | `missing` | 用未经改造的 Obsidian vault 验证一周级日常工作流和字节不变量 |

---

## 三、社区插件与兼容 API

### 已站稳

- `.geode/plugins` 与 `.obsidian/plugins` 扫描；manifest/minAppVersion；启停与 unload；每插件设置 Tab；
  community plugin 卸载；失败/跳过原因可见。
- 多个真插件路径已证明：Dataview、Templater、Tasks、Calendar 2.0，以及编辑/字数/日期等小插件。
- `parseYaml/stringifyYaml`、CM6 StateFields、TFile stat 等早期大缺口已完成；旧审计不得再列 missing。

### 仍是明确 gap 的 API

| API / 能力 | 状态 | 当前代码事实 | 目标 |
|---|---|---|---|
| `Vault/DataAdapter.getResourcePath` | `missing` | 返回 vault-relative path 并 `reportGap` | Tauri asset URI + browser fallback + 路径安全 |
| `Plugin.registerExtensions` | `missing` | warn-stub | 扩展名→view registry→打开/恢复完整链 |
| `registerObsidianProtocolHandler` | `missing` | warn-stub | URI action 注册、派发、卸载与确认/allow-list |
| `App.lastEvent` | `missing` | 永远 `null` | shell 级用户事件追踪，支持 Mod/Shift 点击语义 |
| `App.secretStorage` / `SecretStorage` | `missing` | 无实现；Keychain 仅空态 | OS keychain + secret name 引用 + 插件 smoke |
| `DataAdapter.stat` | `partial` | adapter 仍返回 `null`；TFile stat 是另一条已完成路径 | 对齐官方 adapter 返回与失败语义 |
| `DataAdapter.appendBinary` | `missing` | 明确抛错 | 随 1.12 API 漂移补原子 append/错误行为 |
| `App.plugins` / `internalPlugins` | `partial` | `App.plugins` 仍 stub；internalPlugins 只真实暴露少量实例 | 随核心插件化补可预测实例与 enable/disable 状态 |

### 产品页余项

- Restricted mode / safe mode。
- 浏览、安装、检查更新、升级失败回滚、自动检查更新。
- 安装前 Tier A/B/C 兼容级别、桌面权限和已知降级。
- 10–15 个代表插件常驻矩阵；每个记录加载、设置、命令、核心行为、写文件安全和跨版本结果。

---

## 四、本体大件

| 大件 | 状态 | 当前起点 | 最小正确拆法 |
|---|---|---|---|
| PDF.js | `missing` | `core/embeds.ts` 和 live preview 以原生 iframe 显示 PDF | view/asset → canvas+text layer → 搜索/选中/缩放/大纲/页码 → 嵌入 |
| Canvas | `missing` | 无 `.canvas` 文件/view；图谱 canvas 不是 Canvas 功能 | JSON Canvas 往返 → 画布交互 → 节点 → 连线 → 分组/嵌入/API |
| Bases | `missing` | Properties/frontmatter 基础可复用；无 `.base` parser/query/view | 语法/查询 → filter/sort/formula → table → list/cards → embed/API |
| 多窗口/pop-out | `missing` | Tauri config 仅一个 window；compat 有 single-window warn-stub | 共享 vault/文档 → leaf 跨窗 → 生命周期/API → 恢复/崩溃安全 |
| Audio recorder | `missing` | 音频附件播放已有；无录音 | 权限/MediaRecorder → 原子附件落盘 → active note embed → 中断恢复 |
| Markdown converter | `missing` | `htmlToMarkdown` 仍退化为 plain text | clean-room 转换规则、备份/预览、批处理与字节安全 |

大件到队首时自动做 docs-only 规划，不再以“工程大”为理由等待是否启动。

---

## 五、视觉、测试与分发

### 视觉

设置 IA、控件、shell chrome、文件树密度、阅读视图、图谱等已多轮对齐，但当前主要靠分散的
computed-style 断言和人工 round 记忆。`done` 还需要：

- 固定 OS、窗口尺寸、DPR、缩放、主题、字体和 demo vault；
- 8–12 张覆盖空库/编辑/阅读/设置/插件/图谱/文件操作的整屏基线；
- 有阈值与人工复核入口的 pixel diff；
- 视觉任务必须携带截图编号和差异位置，禁止无基线 CSS 微调。

### CI / 版本

- `.calibration/` 当前约有 262 个 E2E 与 127 个 probe 文件，但 GitHub Actions 只运行 r23/r24。
- CI 没跑 `cargo check`、最新 round、数据安全 smoke、核心迁移任务或 compat 真插件。
- `package.json` / `tauri.conf.json` = 0.284.0，`Cargo.toml` = 0.22.0。
- updater/NSIS 链路有本地文档，但 Windows 安装、正式 endpoint、签名、更新失败回滚不是持续验证。

R299 先建最小常驻闸门和版本单一真源；R317 再关闭真实 Windows 分发闭环。

---

## 六、版本漂移

官方 Changelog 显示 1.12.7 是当前 Public；1.12 主增量中与本地桌面复刻直接相关的有：

- Obsidian CLI；
- Live Preview 拖拽调整图片尺寸；
- 删除笔记时自动清理附件；
- `appendBinary` 等插件 API 漂移。

其中自动附件清理在 Geode 已有近似实现，晋级时做语义复核；其余进入 ROADMAP D1–D3。
1.13.1 是 Catalyst，设置独立窗口/全局搜索/键盘导航等只做观察。Public 发布后再新增基线快照，
不能拿 Catalyst 变化打断 1.9.10 收口。

官方证据：

- Changelog：https://obsidian.md/changelog/
- Canvas：https://obsidian.md/help/plugins/canvas
- Bases：https://obsidian.md/help/bases
- Audio recorder：https://obsidian.md/help/plugins/audio-recorder
- SecretStorage：https://docs.obsidian.md/plugins/guides/secret-storage

---

## 七、完成定义

### 单项 `done`

- 设置：控件存在、默认值/持久化/重启生效、不可用态诚实、视觉基线通过。
- 命令：命令面板可搜、热键可绑、真 handler、相关插件关闭时一致消失。
- 菜单/面板：入口与命令共用核心 handler，权限/空态/错误态完整。
- 核心插件：真实启停、所有入口和设置 Tab 一致、compat instance 按承诺可见。
- 社区插件：真插件加载并完成核心行为；gap report 不是完成证明。
- 写 vault：实时 DocumentHandle、flush/竞态/范围外字节不变量和桌面真实 FS probe 全过。
- 桌面：成功、取消、权限失败、能力不存在四条路径都有明确行为。

### 1.9.10 阶段结束

- 未经改造的 1.9.10 vault 直接打开，Markdown/附件无损。
- 20 条迁移任务全过。
- 核心插件真实启停；本地桌面核心能力没有整块 `missing`。
- 代表插件矩阵达到预定成功率，宿主边界用户可读。
- 固定视觉基线通过。
- CI 覆盖 TS、Rust、数据安全、迁移主路径、最新 round 与 compat smoke。
- Windows 安装/首次启动/更新/失败回滚可验证。
- Sync/Publish/账户/移动端明确 `excluded`；Canvas/Bases/PDF.js/多窗口不能 `excluded`。

完成 1.9.10 后，把当前 Public 漂移池整体晋级为下一验收基线；仍不自动转 Chain、AI、云端、
多 root 或 Git 同步。

## 相关文档

- `docs/ROADMAP.md`：顶部单一执行队列与 round 证据。
- `docs/G3-命令复刻矩阵.md`：命令逐项对照；不再用裸数量差生成任务。
- `docs/OBSIDIAN-COMPAT.md`：插件 API、真插件套件与历轮证据。
- `reference/00–08` + `reference/_截图/`：1.9.10 视觉与设置事实标准。
- `geode-设计讨论/16-第一阶段-Obsidian复刻差距与规划.md`：产品阶段与复刻优先原则。

---

### R293 据实纠误 + 差距重审确认（2026-07-10·docs-only）

- **G3 命令矩阵据实纠误**：3 stale missing->done（`app:show-release-notes` R291 / `help:open` R291 / `workspace:toggle-stacked-tabs` R255）+ 6 多窗口命令 missing->oos（单窗口宿主显式不做）+ 2 推断列 missing->语义待定（`graph:animate` / `app:open-trash`·reference/ 无·WebSearch 失效·phantom 疑似·defer）。G3 bounded 命令池确认枯竭。
- **差距重审**（永久续接规则 Step 0.1 branch 3·清池后唯一 1 轮）：8 域并行 Workflow 因 API 配额 429 全失败 -> 主循环聚焦重审，确认 5 结构性缺口仍成立（核心插件 toggle 不真实 / 插件 API stub / 大件缺失 / 分发 CI+版本漂移 / 基线漂移）。
- **队首**：R294 = 核心插件 enable/disable 真实绑定（实现轮·logic-tier·零依赖）--见 ROADMAP「单一执行队列」。R294 Step 0 先验 plugin loader 是否 respect `enabledPluginIds`。
