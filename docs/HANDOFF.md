# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.5.0）。
启用 workflows。

按顺序读这四个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R5 完成记录、R6 优先级
2. docs/OBSIDIAN-COMPAT.md — Tier 表（T0/T1/T1.5/T2 主体已落地）、R5 套件矩阵 5/5 ✓、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏（契约→并行 agent→评审+对抗验证→双端验证）、
                          数据安全回归清单、验证手段（?bench=N、?obsfixture=1、AppHandle 探针）
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R5 节含 sidebar panel 贡献点 +
                          SidebarViewLeaf + document:changed 契约与 as-built deltas）

本轮目标（R6）从 ROADMAP「R6 候选」按优先级取，典型组合：
P1 = compat 余项（MarkdownRenderer.render / requestUrl / EditorSuggest 真实触发——
解锁 nldates 自动建议）+ 快捷键自定义（设置页 + 冲突检测）。
实现任何 obsidian API 前，先确认 .calibration/ 在（gitignore 不入库，缺了再生）：
curl -o .calibration/obsidian.d.ts https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts
R5 的 T2 校准摘录在 .calibration/API-REFERENCE-R5.md（含套件调用面），过期就重跑校准 workflow。
完成标准沿用四条底线 + OBSIDIAN-COMPAT.md 套件矩阵（5/5 不回退 + 新解锁项打 ✓）。
```

## 给接续者的三句话背景

- 开发模式已验证五轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证**。R1-R5 共确认 79 处缺陷零误杀全处置（R5：18 确认 2 证伪，含 1 critical——
  `window.app` 未注入，浏览器 fixture 测不到，桌面 calendar 必崩——教训：fixture 要探插件
  真实读的全局面）。
- 验收套件在 `compat-vault/`（gitignore，5 个真实社区插件）；浏览器 `?obsfixture=1` 内置
  fixture 插件（含 fixture-view + window.app 探针）；桌面 release 实测用
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起
  `geode.exe compat-vault`，探针 `.calibration/cdp-run.mjs <expr.js>`、截屏
  `.calibration/cdp-shot.mjs <png>`；注意持久化 workspace 可能让 tab 处于 preview 模式
  （编辑器命令需先 setTabMode live）。
- PowerShell 5.1 改源码会 mojibake——只用 Read/Edit/Write 工具碰文件。Vite 预打包下
  moment 必须走 `moment/min/moment-with-locales` 单入口（分入口会注册到第二份副本）。
