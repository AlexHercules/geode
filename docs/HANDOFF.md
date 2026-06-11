# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.11.0）。
启用 workflows。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R11 完成记录、R12 候选
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R11 套件回归、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、验证手段
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R11 节含 readBinary/
                          resolveAttachment/RenderMarkdownOptions/embeds + as-built）
5. docs/DISTRIBUTION.md — 发布流程/密钥管理/签名配置位

本轮目标（R12）从 ROADMAP「R12 候选」按优先级取。P1（发布渠道+Authenticode 证书）
仍是两个用户外部决策——没有输入就改取 P2 组合（笔记转写嵌入 ![[note]] +
导出 HTML 内联图片是天然一对：同吃 R11 的 resolveEmbed/attachment 管线）。
转写嵌入实现前先用 WebFetch 对照 docs.obsidian.md 的嵌入语义（深度上限、循环
引用处理、#heading/#^block 子集），circular embed 必须有护栏。
完成标准沿用四条底线 + OBSIDIAN-COMPAT.md 套件矩阵不回退。
```

## 给接续者的三句话背景

- 开发模式已验证十一轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证 + 双端运行时实测**。R1-R11 共确认 121 处缺陷全处置（R11：11 finding，
  2 确认同根因降 minor、9 证伪、1 条 verify 网络故障由 chief 裁决）。管线兼容的硬承诺
  要用 **diff 验证而非声称**（R11 的 12 用例字节级对比是范式）；verify agent 偶发
  API 故障时 chief 必须自行裁决该 finding，不能静默丢弃。
- 验收套件在 `compat-vault/`（gitignore）；桌面 release 实测
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起
  `geode.exe <vault>`（env 与 Start-Process 必须同一条 PowerShell 命令），探针
  `.calibration/cdp-run.mjs`（r9-probe-suite 套件一体、r11-probe1/2 嵌入+模式切换、
  r9-up1~3 更新链路）。探针陷阱备忘：CM6 SelectionRange 不能 spread（getter 在原型，
  要显式取 anchor/head）；套件探针跑完查 compat-vault/Welcome.md 残留；滚动类探针
  先确认文档有滚动空间。嵌入夹具：demo-vault/assets/geode-dot.png ↔ vault.ts
  DEMO_BINARY 双端同源。
- PowerShell 5.1 改源码会 mojibake——只用 Read/Edit/Write 工具碰文件；Windows 无空串
  env 变量（签名密钥必须带密码）。UI 字符串走 t()/useI18n()；命令/插件 name 是 thunk
  （显示处经 getCommandName/getPluginName）；live↔source 切换走 modeCompartment.
  reconfigure 绝不重建视图（动 EditorPane 生命周期前先读懂 documents.ts 的
  history host 迁移）；阅读视图管线改动必须保住"无 resolveEmbed 调用方字节级不变"；
  图谱不要把边批进单个 Path2D；compat 对照 .calibration 官方 d.ts。
