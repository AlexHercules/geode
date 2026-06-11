# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.10.0）。
启用 workflows。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R10 完成记录、R11 候选
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R10 套件回归（EditorSuggest 偏差清零）、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、验证手段
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R10 节含 closeMissingFileTabs/
                          getPluginName + as-built deltas）
5. docs/DISTRIBUTION.md — 发布流程/密钥管理/签名配置位（动更新相关必读）

本轮目标（R11）从 ROADMAP「R11 候选」按优先级取。P1（发布渠道+Authenticode 证书）
仍是两个用户外部决策——没有输入就改取 P2 组合（安装包瘦身 + live↔source 保留
选区/滚动，或图片嵌入 live preview 渲染）。瘦身碰 moment 必须重读 R5 实现决策
（Vite 预打包下独立 locale 入口会注册到第二份副本——已踩坑）并全量回归套件。
完成标准沿用四条底线 + OBSIDIAN-COMPAT.md 套件矩阵不回退。
```

## 给接续者的三句话背景

- 开发模式已验证十轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证 + 双端运行时实测**。R1-R10 共确认 118 处缺陷全处置（R10：6 finding
  全部被对抗验证证伪、0 确认——其一验证者跑了 1793 用例穷举模拟；质量基线已稳）。
  对抗验证的额外价值：R10 一条证伪揭出 R9 tauri.conf.json 漏提交，按轮收尾时
  **git status 必须清零核对**。
- 验收套件在 `compat-vault/`（gitignore）；桌面 release 实测
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起
  `geode.exe <vault>`（**每次 PowerShell 调用是新进程，env 变量要和 Start-Process
  同一条命令里设**），探针 `.calibration/cdp-run.mjs`（r9-probe-suite 套件一体探针、
  r10-probe1~3b 切库/插件名/popup 跟随、r9-up1~3 更新链路）、截屏 cdp-shot.mjs。
  滚动类探针要先确认文档有滚动空间（短文档 scrollTop 不动，测试假阴性——r10-probe3
  踩过）。更新链路本地 E2E 起 `.update-test/server.mjs`。
- PowerShell 5.1 改源码会 mojibake——只用 Read/Edit/Write 工具碰文件；Windows 无法
  表达空串 env 变量（签名密钥必须带密码，见 DISTRIBUTION.md）。UI 字符串一律
  t()/useI18n()；命令与内置插件的 name/description 都是 thunk（显示处经
  getCommandName/getPluginName）；快捷键文法权威 core/commands.ts；图谱不要把边批进
  单个 Path2D；compat 实现一律对照 .calibration 官方 d.ts（契约本身也要校准——R9
  Instruction 可选性写错传染到实现的教训）。
