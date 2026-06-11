# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.8.0）。
启用 workflows。

按顺序读这四个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R8 完成记录、R9 候选
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R8 套件回归（5/5 不回退）、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏（契约→并行 agent→评审+对抗验证→双端验证）、
                          数据安全回归清单、验证手段（?bench=N、?obsfixture=1、AppHandle 探针）
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R8 节含 i18n/getCommandName/
                          回声抑制 + as-built deltas）

本轮目标（R9）从 ROADMAP「R9 候选」按优先级取：
P1 = NSIS 签名 + 自动更新（tauri-plugin-updater）——前置：需要代码签名证书；若用户
未提供证书，先做 updater 链路（可用自签/无签验证）+ 把签名步骤做成配置位，或改取
P2 组合（compat suggest 指令条渲染 + 光标移动重评估，或 vault 切换 stale tab 关闭）。
实现任何 obsidian API 前，先确认 .calibration/ 在（gitignore 不入库，缺了再生）：
curl -o .calibration/obsidian.d.ts https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts
R6 校准摘录在 .calibration/API-REFERENCE-R6.md，过期就重跑校准 workflow。
完成标准沿用四条底线 + OBSIDIAN-COMPAT.md 套件矩阵（5/5 + nldates 自动建议不回退）。
```

## 给接续者的三句话背景

- 开发模式已验证八轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证 + 双端运行时实测**。R1-R8 共确认 115 处缺陷全处置（R8：评审 10 finding，
  对抗验证 5 确认全降级 minor、5 证伪——是质量最干净的一轮；唯一代码修复是写失败时清理
  回声指纹）。教训沉淀：i18n 字典按 agent 所有权拆片段文件（dict.app/panels/views）
  可让并行扫荡零合并冲突；`zh: Record<keyof typeof en, string>` 让缺译成为类型错误。
- 验收套件在 `compat-vault/`（gitignore，5 个真实社区插件）；浏览器 `?obsfixture=1` 内置
  fixture；桌面 release 实测用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
  起 `geode.exe compat-vault`，探针 `.calibration/cdp-run.mjs <expr.js>`（r7/r8-probe 可参考）、
  截屏 `.calibration/cdp-shot.mjs <png>`。驱动 EditorSuggest 的探针必须逐字符独立事务输入；
  synthetic 键盘事件派发到 `view.contentDOM`。i18n 验证口径：`settings-language` 下拉、
  localStorage `geode.locale`、`navigator.language` zh 自动检测；回声抑制口径：
  `window.__geodeWatchEcho` 计数器、浏览器 `window.__geodeFireWatch(paths)` 模拟事件。
- PowerShell 5.1 改源码会 mojibake——只用 Read/Edit/Write 工具碰文件。UI 字符串一律走
  `t()/useI18n()`（core/i18n.ts，新增键放对应命名空间片段）；命令注册 name 用 thunk
  `() => t("cmd.xxx")`，显示处必须经 `getCommandName`；快捷键文法唯一权威是
  core/commands.ts 三件套；图谱绘制**不要把边批进单个 Path2D**（PERFORMANCE.md 有实测）；
  导出文档样式在 features/export/export.css（内联进导出文件），应用内 toast 在 notice.css。
