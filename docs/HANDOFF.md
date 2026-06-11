# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.13.0）。
启用 workflows。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R13 完成记录、R14 候选
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R13 套件回归、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、验证手段
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R13 节含 BlockRef/块切片/
                          标记剥除 + as-built deltas）
5. docs/DISTRIBUTION.md — 发布流程/密钥管理/签名配置位

本轮目标（R14）从 ROADMAP「R14 候选」按优先级取。P1（发布渠道+Authenticode 证书）
仍是两个用户外部决策——没有输入就改取 P2 组合（scroll-to-subpath 定位+高亮是
体验闭环收尾；可配 live preview 全扫描统一 fence 排除——R13 记的债，或安装包瘦身）。
完成标准沿用四条底线 + OBSIDIAN-COMPAT.md 套件矩阵不回退。
```

## 给接续者的三句话背景

- 开发模式已验证十三轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证 + 双端运行时实测**。R1-R13 共确认 127 处缺陷全处置（R13：12 finding，
  4 确认——3 条同根因 major 是 agent **违反契约明文**（"fence 内不处理"）并用文件内
  旧口径自我合理化，评审正确识破，chief 修复。教训：**agent 的行内注释不能修订契约**；
  实现 agent 报告里的"我按既有口径保持了一致"必须对照契约原文核验）。
- 验收套件在 `compat-vault/`（gitignore）；桌面 release 实测
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起
  `geode.exe <vault>`（env 与 Start-Process 同一条命令），探针 `.calibration/
  cdp-run.mjs`（r9-probe-suite 套件一体、r12-probe1/2 转写+导出、r13-probe1 块引用
  全场景——动态夹具自清理范式）。嵌入水合引擎 core/embeds.ts（深度 5/循环/heading
  stripHeading 二次匹配/^block 切片）双端共用，动它必须双端复测；阅读视图基管线
  自 R13 起剥行尾块标记（fence 外），改它先重读"字节级承诺"的当前口径。
- PowerShell 5.1 改源码 mojibake+BOM——只用 Read/Edit/Write 工具碰文件；Windows 无
  空串 env 变量（签名密钥必须带密码）。UI 字符串走 t()/useI18n()；命令/插件 name 是
  thunk；live↔source 走 modeCompartment 绝不重建视图；live preview 新增任何扫描默认
  **fence 排除**（FencedCode 行集合已有，复用它）；图谱不要把边批进单个 Path2D；
  compat 对照 .calibration 官方 d.ts。
