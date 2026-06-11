# Geode Roadmap

## 核心使命（不变项）

> 复刻 Obsidian 的核心用户体验，做成一个**完整、可拓展、可商业交付**的 Windows 桌面知识库应用。
> 本地优先（笔记是用户磁盘上的纯 .md 文件）、键盘优先、插件可拓展。

每一轮迭代都必须守住四条底线：

1. **数据安全**：任何路径下用户的编辑不丢失（自动保存、关窗 flush、重命名/删除/外部修改竞态全覆盖）
2. **构建常绿**：TS strict 0 错误、`cargo check` 通过、生产构建成功才算完成
3. **双端可验证**：浏览器模式（MemoryVaultAdapter）跑 E2E，桌面端实测真实文件系统
4. **契约先行**：跨模块接口先冻结在 `ARCHITECTURE.md`，再并行开发

### 方向校准（2026-06-10，R3 末）

商业主轴确立为 **Obsidian 插件生态一键迁移**：以兼容层（shim）方式实现 Obsidian 插件
API 的分 Tier 兼容，开发中用 WebFetch 对照 `docs.obsidian.md` 与官方 `obsidian.d.ts`
自我校准，用真实插件套件验收。完整判断、Tier 表、法律边界、验收方式见
**`docs/OBSIDIAN-COMPAT.md`**（后续轮次的头号输入）。Geode 原生插件 API 保持第一公民，
shim 建立其上。

## 已完成

### R1 — v0.1（2026-06-10）核心复刻

vault/文件树/CM6 编辑器（wikilink 补全+跳转）/阅读视图/反链/图谱/全文搜索/
命令面板/快速切换/标签页/主题/设置/插件 API + 3 内置插件/Tauri Rust 后端/NSIS 安装包。
评审确认 12 缺陷全修复（2 critical：文件夹重命名丢索引、重命名竞态丢编辑）。

### R2 — v0.2（2026-06-10）实时预览 + 桌面级完整性

**Live Preview**（CM6 选区感知装饰，语法标记就地隐藏/揭示）、三态模式 live/source/reading、
**文件监听**（Rust notify → 编辑器非脏自动重载）、**外部插件** `<vault>/.geode/plugins/*.js`、
大纲面板、frontmatter（aliases 参与链接解析）、侧栏拖拽调宽、右栏 Tab 化。
评审确认 4 缺陷全修复（1 critical：watcher 文件夹路径误判为删除）。

### R3 — v0.3（2026-06-10）分屏 + 万级性能

**分屏 panes**：Workspace 升级为 pane 树（`PaneLeaf`/`PaneSplit`，v1 持久化自动迁移）；
split 拖拽调宽（12% 下限）、tab 跨 pane 拖拽（五分区边缘 drop + 插入指示线）、
Ctrl+\\ / Ctrl+Shift+\\ 分屏命令；同文件多实例非脏实时同步。
**性能**（`?bench=N` 合成 vault，10k 笔记优化前→后）：switcher 打开 471→15ms、
全文搜索最坏 2585→347ms、explorer 展开全部 424→10ms（>200 行虚拟化）、索引 ~110ms。
评审 5 维度 24 finding，对抗验证确认 21（去重 16）全部修复或显式延期。详见 docs/PERFORMANCE.md。

### R4 — v0.4（2026-06-10）Obsidian 插件兼容层 + 共享文档模型

**Obsidian compat T0+T1+T1.5**（`src/compat/obsidian/`，详见 docs/OBSIDIAN-COMPAT.md）：
`.obsidian/plugins` 发现/加载/启停对齐 community-plugins.json；`require("obsidian")` 注入
（+@codemirror/* host 实例 + path shim）；Plugin/Vault(TFile 单例 registry)/MetadataCache/
Workspace/Notice/Modal/Setting DSL/SuggestModal/Menu/最小 Editor 子集；DOM 原型增强；
越级 API warn-stub + 缺口报告进设置页。开发全程对照官方 obsidian.d.ts 校准（160 条签名）。
**共享文档模型**（core/documents.ts）：单文件单脏标志/单防抖保存，多视图逐键同步 +
单 undo 历史（host 移交时移植），根治 R3 双脏 last-writer-wins 与重命名丢 undo 两项债。
评审 5 维度 24 finding 对抗验证全确认（0 误杀）全修复。
**真实插件套件 5/5 加载启用**（Recent Files / Better Word Count / NL Dates /
Paste URL into selection / Calendar），缺口显式记录（moment、registerView 挂载）。

### R5 — v0.5（2026-06-10）compat T2：moment + registerView 真实挂载，套件 5/5 ✓

**moment**（一次性决策落地）：moment-with-locales 2.30.1 单实例，`import { moment }` 与
`window.moment` 同源（套件实测两个 P0 插件只用后者）；`window.app` 同步注入（评审 critical）。
**registerView 真实挂载**：core `SidebarPanelContribution` 贡献点（左 ribbon 按钮/右 tab +
元素宿主）+ compat `SidebarViewLeaf`（setViewState 全生命周期、revealLeaf/detachLeavesOfType/
ensureSideLeaf、legacy layout-ready/splitActiveLeaf/getUnpinnedLeaf）；官方全局原型扩展全集
（Array.contains 等）；MarkdownView extends FileView；onUserEnable 接线。
**editor-change 逐事务化**：core `document:changed` 事件（R3/R4 偏差债清除）。
评审 5 维 20 finding，对抗验证确认 18（2 证伪），全修复。
**套件矩阵 5/5 核心功能 ✓**（R4 为 2/5）：calendar 月历自动挂载、Recent Files 实时列表、
nldates "tomorrow"→`[[date]]` 桌面实测通过；reload 幂等零 error。
截图 docs/screenshots/r5-desktop-killer-demo.png。

## R6 候选 — 兼容层余项 + 商业打磨（按优先级）

| P | 功能 | 备注 |
|---|---|---|
| P1 | compat：MarkdownRenderer.render / requestUrl / EditorSuggest 真实触发 | 按套件需求驱动；EditorSuggest 触发解锁 nldates 自动建议 |
| P1 | 快捷键自定义（设置页 + 冲突检测） | CommandRegistry 已有 hotkey 字段，做编辑 UI + 持久化 |
| P1 | 图谱打磨 | 最大化窗口居中偏移修复；局部图谱；10k 节点 settle 后按需渲染/抽样 |
| P2 | 导出 PDF / HTML | 阅读视图已有渲染管线，接打印/文件输出 |
| P2 | i18n（中/英起步） | UI 字符串集中化 |
| P2 | NSIS 签名 + 自动更新（tauri-plugin-updater） | 商业分发前提 |
| P2 | watcher 回声抑制 | vault.modify 记录 (path, hash)，外部事件命中则跳过 |

## 已知技术债

- 图谱最大化窗口下居中偏移（R3 P1）
- 自身写入回声触发 watcher（幂等无害，R3 P2）
- 图片/嵌入 `![[...]]` 在 live preview 中保持原文（特性缺口）
- 图谱 10k 节点 ~12fps（基准结论：需 settle 后按需渲染/抽样/WebGL，见 docs/PERFORMANCE.md）
- ~~同文件双 pane 双脏 last-writer-wins~~（R4 共享文档模型根治）
- ~~重命名打开中的文件丢 undo/光标/滚动~~（R4 根治）
- vault 切换后指向新 vault 不存在路径的 tab 不自动关闭（保存被 no-resurrect 守卫挡住，
  数据安全无虞，但 UX 上应关闭/标记，R4 评审 A 残留项；R5 桌面演示再次撞见）
- ~~compat `workspace.on('editor-change')` 按保存触发而非逐事务~~（R5 document:changed 根治）
- live↔source 模式切换仍重建视图丢选区/滚动（R4 前已有，未恶化）
- compat 自定义视图不随 workspace 持久化——重启后靠插件自身启动逻辑重建
  （calendar 的 layout-ready 路径可自愈；recent-files 需用户再开，官方行为是布局还原）
- moment-with-locales 全量打包（主 chunk +~330KB min 前）；如需瘦身可改按需 locale 子集
- bench 口径未覆盖 compat 视图挂载/卸载路径（R5 无性能回归实测，10k vault 下未量化）
