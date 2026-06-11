# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.9.0）。
启用 workflows。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R9 完成记录、R10 候选
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R9 套件回归、缺口表（仅剩 popup 重定位一条）
3. docs/DEVELOPMENT.md  — 每轮编排节奏（契约→并行 agent→评审+对抗验证→双端验证）、
                          数据安全回归清单、验证手段（?bench=N、?obsfixture=1、
                          AppHandle 探针、更新链路本地 E2E）
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R9 节含 core/update.ts +
                          document:selection-changed + as-built deltas）
5. docs/DISTRIBUTION.md — 发布流程/密钥管理/签名配置位（动更新相关必读）

本轮目标（R10）从 ROADMAP「R10 候选」按优先级取。P1（发布渠道+Authenticode 证书）
有两个外部依赖需用户拍板：发布渠道选择、证书购买——若用户未给输入，改取 P2 组合
（stale tab 关闭 + GeodePlugin 本地化，或安装包瘦身）。
实现任何 obsidian API 前，先确认 .calibration/ 在（gitignore 不入库，缺了再生）：
curl -o .calibration/obsidian.d.ts https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts
完成标准沿用四条底线 + OBSIDIAN-COMPAT.md 套件矩阵（5/5 + nldates 自动建议+指令条不回退）。
```

## 给接续者的三句话背景

- 开发模式已验证九轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证 + 双端运行时实测**。R1-R9 共确认 118 处缺陷全处置（R9：8 finding，
  3 确认全 minor、5 证伪，安全/数据安全/分层三维零 finding）。R9 踩坑入档：
  **Windows 无法表达空串环境变量**——PowerShell `$env:X=""` 是删除变量，空密码签名密钥
  会让 tauri build 在非交互 shell 里死等密码提示，updater 密钥必须带密码
  （现密码见 DISTRIBUTION.md，对外发布前轮换）。
- 验收套件在 `compat-vault/`（gitignore，5 个真实社区插件）；桌面 release 实测用
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起
  `geode.exe compat-vault`，探针 `.calibration/cdp-run.mjs <expr.js>`（r9-probe-suite =
  套件+指令条+光标重评估一体探针；r9-up1~3 = 更新链路检查/负向/正向）、截屏
  `.calibration/cdp-shot.mjs <png>`。EditorSuggest 探针必须逐字符独立事务输入；
  更新链路本地 E2E 要起 `.update-test/server.mjs`（:17321）并临时改 conf endpoint
  （不得提交）。nldates 弹层关闭后移回光标不重开是其插件自身锚点语义，非缺陷。
- PowerShell 5.1 改源码会 mojibake——只用 Read/Edit/Write 工具碰文件。UI 字符串一律
  `t()/useI18n()`（键进对应命名空间字典片段）；命令 name 用 thunk + getCommandName；
  快捷键文法权威在 core/commands.ts；图谱绘制不要把边批进单个 Path2D；compat 实现
  一律对照 .calibration 官方 d.ts（R9 教训：契约写错 Instruction 可选性，错误会从
  契约传染到实现——契约本身也要校准）。发布构建需设 TAURI_SIGNING_PRIVATE_KEY(+_PASSWORD)，
  流程见 DISTRIBUTION.md。
