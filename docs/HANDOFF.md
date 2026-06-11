# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.7.0）。
启用 workflows。

按顺序读这四个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R7 完成记录、R8 候选
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R7 套件回归（5/5 不回退）、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏（契约→并行 agent→评审+对抗验证→双端验证）、
                          数据安全回归清单、验证手段（?bench=N、?obsfixture=1、AppHandle 探针）
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R7 节含 lastActiveFile + 图谱工具栏/
                          抽样/rAF 合帧 + core/export + as-built deltas）

本轮目标（R8）从 ROADMAP「R8 候选」按优先级取，典型组合：
P1 = i18n（UI 字符串集中化，中/英起步）或 NSIS 签名+自动更新（tauri-plugin-updater，
商业分发前提）+ P2 一项（watcher 回声抑制，或 compat suggest 指令条渲染）。
实现任何 obsidian API 前，先确认 .calibration/ 在（gitignore 不入库，缺了再生）：
curl -o .calibration/obsidian.d.ts https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts
R6 校准摘录在 .calibration/API-REFERENCE-R6.md，过期就重跑校准 workflow。
完成标准沿用四条底线 + OBSIDIAN-COMPAT.md 套件矩阵（5/5 + nldates 自动建议不回退）。
```

## 给接续者的三句话背景

- 开发模式已验证七轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证 + 双端运行时实测**。R1-R7 共确认 110 处缺陷全处置（R7：评审 18 确认/8 根因
  0 证伪，浏览器实测另抓 2 个评审漏网的运行时缺陷——StrictMode 下 cancelAnimationFrame 后
  rAF id 未归零导致画布永久空白、巨型 Path2D 批量描边光栅比逐边 stroke 慢 20 倍。教训：
  **canvas 性能优化必须用帧间隔实测验证，JS 侧计时看不到 raster 线程成本；静态评审抓不到
  只有运行才暴露的缺陷，截图是必要验收手段**）。
- 验收套件在 `compat-vault/`（gitignore，5 个真实社区插件）；浏览器 `?obsfixture=1` 内置
  fixture；桌面 release 实测用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
  起 `geode.exe compat-vault`，探针 `.calibration/cdp-run.mjs <expr.js>`（r7-probe1~5 可参考：
  套件状态/nldates 逐键/export_write/图谱居中像素度量）、截屏 `.calibration/cdp-shot.mjs <png>`。
  驱动 EditorSuggest 的探针必须逐字符独立事务输入；synthetic 键盘事件派发到 `view.contentDOM`。
  图谱性能口径：`?bench=10000` + `window.__geodePerf.{graphSettleMs,graphDrawMs}` + 帧间隔采样。
- PowerShell 5.1 改源码会 mojibake——只用 Read/Edit/Write 工具碰文件。快捷键文法唯一权威是
  core/commands.ts 三件套；图谱绘制**不要把边批进单个 Path2D**（PERFORMANCE.md 有实测数据）；
  导出文档样式在 features/export/export.css（内联进导出文件），应用内 toast 样式在独立的
  notice.css——别混。
