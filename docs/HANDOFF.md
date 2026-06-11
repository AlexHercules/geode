# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.16.0）。
启用 workflows。远端：https://github.com/AlexHercules/geode（私有，origin/master）——
每轮收尾提交后 git push。用户口径（2026-06-11）：发布不着急，暂不做渠道/证书决策。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R16 完成记录、迁移路线图
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R16 套件回归、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、验证手段
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R16 节含改写引擎全算法 + 评审修复）
5. docs/DISTRIBUTION.md — 发布流程/密钥管理/签名配置位

本轮目标（R17）按 ROADMAP「迁移体验路线图」执行：**R17 = 附件摄入（粘贴/拖拽图片
入库）+ 标题/列表折叠**。前者需要 VaultAdapter.writeBinary + Rust 命令（readBinary
镜像，#[tauri::command(async)] + safe_join + 原子写先例）、附件目录设置项（校准
Obsidian 的 attachment folder 语义）、命名冲突 uniquePath、Memory 适配器同步实现
（浏览器 E2E 用 DataTransfer 注入）；后者是 CM6 folding 接线，live preview 装饰
共存性是评审重点。完成标准沿用四条底线 + OBSIDIAN-COMPAT 套件矩阵不回退。
后续：R18 方言长尾（callouts/高亮/脚注/%%注释%% + KaTeX/mermaid 一次性依赖决策）。
```

## 给接续者的三句话背景

- 开发模式已验证十六轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证 + 双端运行时实测**。R16 是数据安全重轮（重命名自动改写引用 + [[#h]]）：
  评审 22 finding 确认 12（1 critical：CRLF/LF 偏移基准错位切错字节——根治 = vault.read
  咽喉点 CRLF→LF 统一；3 major 竞态全修），浏览器实测另抓 1 个（only-fix-broken 被
  resolveLink 的 basename 兜底骗过）。改写引擎五步算法 + 全部修复细节在 ARCHITECTURE
  R16 节，**动 vault/documents/改写路径前必读它的 As-built deltas**。
- 验收套件在 `compat-vault/`（gitignore）；桌面 release 实测
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起
  `geode.exe <vault>`（env 与 Start-Process 同一条命令）；探针
  `.calibration/cdp-run.mjs <expr文件> [port]`、桌面截图 `cdp-shot.mjs <png>`；
  浏览器性能口径 headless Edge + `cdp-run-url.mjs <expr> <port> <urlSub>`（**杀 Edge
  按 PID**；**测性能前确认机器空载**——R16 在 release 编译同机时测出过 321ms 假回归，
  干净复测 151ms 优于基线）。r16 全套探针/清理脚本在 .calibration/r16-*.js。
- PowerShell 5.1 改源码 mojibake+BOM——**只用 Read/Edit/Write 工具碰文件，版本号 bump
  也是**（R16 用 Set-Content 烧过 package.json 的 em-dash，靠 git checkout 救回）；
  Windows 无空串 env 变量。UI 字符串走 t()/useI18n()；命令/插件 name 是 thunk；
  live↔source 走 modeCompartment；阅读视图管线改动先重读"字节级承诺"口径；图谱不要
  把边批进单个 Path2D；agent 行内注释不能修订契约；ripgrep 在含 NUL 字节的文件上
  静默跳过（R3 的字面 NUL 已转义根治，新代码别再写字面控制字符）。
