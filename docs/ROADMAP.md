# Geode Roadmap

## 核心使命（不变项）

> 复刻 Obsidian 的核心用户体验，做成一个**完整、可拓展、可商业交付**的 Windows 桌面知识库应用。
> 本地优先（笔记是用户磁盘上的纯 .md 文件）、键盘优先、插件可拓展。

每一轮迭代都必须守住四条底线：

1. **数据安全**：任何路径下用户的编辑不丢失（自动保存、关窗 flush、重命名/删除/外部修改竞态全覆盖）
2. **构建常绿**：TS strict 0 错误、`cargo check` 通过、生产构建成功才算完成
3. **双端可验证**：浏览器模式（MemoryVaultAdapter）跑 E2E，桌面端实测真实文件系统
4. **契约先行**：跨模块接口先冻结在 `ARCHITECTURE.md`，再并行开发

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

## R3 候选 — 商业交付轮（按优先级）

| P | 功能 | 备注 |
|---|---|---|
| P0 | 分屏 panes（左右/上下拆分，拖拽 tab） | Workspace 模型从 tabs 数组升级为 pane 树，动 core 契约 |
| P0 | 万级笔记性能基准 + 优化 | 生成 10k 笔记测试 vault；索引/搜索/图谱的退化曲线 |
| P1 | 快捷键自定义（设置页 + 冲突检测） | CommandRegistry 已有 hotkey 字段，做编辑 UI + 持久化 |
| P1 | 导出 PDF / HTML | 阅读视图已有渲染管线，接打印/文件输出 |
| P1 | 图谱打磨 | 最大化窗口居中偏移修复；局部图谱（当前笔记邻域） |
| P2 | i18n（中/英起步） | UI 字符串集中化 |
| P2 | NSIS 签名 + 自动更新（tauri-plugin-updater） | 商业分发前提 |
| P2 | watcher 回声抑制 | vault.modify 记录 (path, hash)，外部事件命中则跳过 |

## 已知技术债

- ~~版本号 0.1.0 未 bump~~（R2 文档轮已统一为 0.2.0）
- 图谱最大化窗口下居中偏移（R3 P1）
- 自身写入回声触发 watcher（幂等无害，R3 P2）
- 图片/嵌入 `![[...]]` 在 live preview 中保持原文（特性缺口，可并入 R3）
- **同文件双 pane 同时为脏**时整缓冲 last-writer-wins，先存一侧的键入会被覆盖（R3 评审确认，
  非脏侧已实时同步；根治需共享 EditorState/文档模型，列 R4）
- 重命名打开中的文件会重建 CodeMirror 视图，undo 历史/光标/滚动丢失（R3 评审确认，列 R4）
- 图谱 10k 节点 ~12fps（基准结论：需 settle 后按需渲染/抽样/WebGL，见 docs/PERFORMANCE.md）
