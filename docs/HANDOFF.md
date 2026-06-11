# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.12.0）。
启用 workflows。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R12 完成记录、R13 候选
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R12 套件回归、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、验证手段
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R12 节含 core/embeds 水合引擎
                          契约 + as-built deltas）
5. docs/DISTRIBUTION.md — 发布流程/密钥管理/签名配置位

本轮目标（R13）从 ROADMAP「R13 候选」按优先级取。P1（发布渠道+Authenticode 证书）
仍是两个用户外部决策——没有输入就改取 P2 组合（#^block 块引用是体验闭环的下一块：
链接+嵌入双路径，需要 metadata 索引 ^block-id，先用 .calibration/obsidian.d.ts +
docs.obsidian.md 校准 BlockCache/blocks 的官方形状；可配安装包瘦身或 compat
MarkdownRenderer 接通 noteEmbeds）。
完成标准沿用四条底线 + OBSIDIAN-COMPAT.md 套件矩阵不回退。
```

## 给接续者的三句话背景

- 开发模式已验证十二轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证 + 双端运行时实测**。R1-R12 共确认 123 处缺陷全处置（R12：~16 finding，
  2 确认降 minor 已修、其余证伪；桌面实测另抓 1 个评审抓不到的预先存在缺陷——
  **UTF-8 BOM 让 markdown-it/metadata 首行标题失效**，修在 Vault.read 咽喉点。教训：
  转写类"把渲染管线指向任意文件"的特性是潜伏缺陷放大器，实测必须用真实历史文件；
  静态评审与字节级 diff 都看不到只有真文件才暴露的问题）。
- 验收套件在 `compat-vault/`（gitignore）；桌面 release 实测
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起
  `geode.exe <vault>`（env 与 Start-Process 同一条命令），探针 `.calibration/
  cdp-run.mjs`（r9-probe-suite 套件一体、r12-probe1/2 转写全场景+导出 data URI——
  动态建夹具自清理的范式、r9-up1~3 更新链路）。嵌入水合引擎在 core/embeds.ts
  （深度 5/循环警示牌/heading 切片含 stripHeading 二次匹配），编辑器与导出共用——
  动它必须双端复测转写场景。print 路径可 stub window.print 后查 #geode-print-root
  做无对话框导出验证。
- PowerShell 5.1 改源码会 mojibake、写文件带 BOM——只用 Read/Edit/Write 工具碰文件；
  Windows 无空串 env 变量（签名密钥必须带密码）。UI 字符串走 t()/useI18n()；命令/
  插件 name 是 thunk；live↔source 走 modeCompartment 绝不重建视图；渲染管线改动必须
  保住"无新 opts 调用方字节级不变"（diff 验证不是口头声称）；图谱不要把边批进单个
  Path2D；compat 对照 .calibration 官方 d.ts（契约本身也要校准）。
