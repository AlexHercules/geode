# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.14.0）。
启用 workflows。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R14 完成记录、R15 候选
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R14 套件回归、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、验证手段
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R14 节含 resolveSubpath/
                          revealTarget + as-built deltas）
5. docs/DISTRIBUTION.md — 发布流程/密钥管理/签名配置位

本轮目标（R15）从 ROADMAP「R15 候选」按优先级取。P1（发布渠道+Authenticode 证书）
仍是两个用户外部决策——没有输入就改取 P2 组合（安装包瘦身现在是 P2 之首：moment
locale 裁剪必须重读 R5 实现决策（Vite 预打包下独立 locale 入口注册到第二份副本的坑）
且 compat 套件全量回归是硬门槛；可配阅读视图内 reveal）。注意 P2 池子已基本见底，
若瘦身做完仍无 P1 输入，下一轮考虑整固轮（全量回归+性能基线刷新+文档审计）而非
硬找新特性。
完成标准沿用四条底线 + OBSIDIAN-COMPAT.md 套件矩阵不回退。
```

## 给接续者的三句话背景

- 开发模式已验证十四轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证 + 双端运行时实测**。R1-R14 共确认 128 处缺陷全处置（R14：11 finding，
  1 确认 minor 已修、10 证伪；R13 的"agent 注释不能修订契约"教训已生效——agent 把
  契约/指令分歧如实上报而非自行偏离）。reveal 机制口径：`workspace.revealTarget`
  一次性消费、仅编辑器模式消费、preview 态挂起到切 live（探针验证时别忘了这一层——
  r14-probe1 初版在 preview 态断言 flash 是假阴性）。
- 验收套件在 `compat-vault/`（gitignore）；桌面 release 实测
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起
  `geode.exe <vault>`（env 与 Start-Process 同一条命令），探针 `.calibration/
  cdp-run.mjs`（r9-probe-suite 套件一体、r12/r13/r14-probe 嵌入/块/定位全场景——
  动态夹具自清理范式；跑完查 compat-vault/Welcome.md 残留）。嵌入/定位共享面：
  core/embeds.ts（水合引擎）+ metadata.resolveSubpath（heading/block 解析唯一权威），
  动它们必须复跑 r12/r13/r14 探针。
- PowerShell 5.1 改源码 mojibake+BOM——只用 Read/Edit/Write 工具碰文件；Windows 无
  空串 env 变量（签名密钥必须带密码，见 DISTRIBUTION.md）。UI 字符串走 t()/useI18n()；
  命令/插件 name 是 thunk；live↔source 走 modeCompartment 绝不重建视图；live preview
  新增扫描默认 fence 排除（fencedLines 集合现成）；阅读视图管线改动先重读"字节级
  承诺"当前口径（R13 起剥块标记、R14 起 subpath 链接带 data-subpath）；图谱不要把边
  批进单个 Path2D；compat 对照 .calibration 官方 d.ts。
