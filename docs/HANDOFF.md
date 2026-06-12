# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.17.0）。
启用 workflows。远端：https://github.com/AlexHercules/geode（私有，origin/master）——
每轮收尾提交后 git push。用户口径（2026-06-11）：发布不着急，暂不做渠道/证书决策。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R17 完成记录、迁移路线图
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R17 套件回归、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、验证手段
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R17 节含摄入/折叠契约 + 评审修复；
   R16 节改写引擎算法动 vault/documents 前必读）
5. docs/DISTRIBUTION.md — 发布流程/密钥管理/签名配置位

本轮目标（R18）按 ROADMAP「迁移体验路线图」执行：**R18 = Markdown 方言长尾**。
纯管线项（零新依赖）：callouts（`> [!note]` 全类型 + 折叠变体）、`==高亮==`、脚注、
`%%注释%%`（双视图隐藏）；外加一次性依赖决策（chief 级，moment/ureq 先例）：KaTeX
数学公式（比 MathJax 轻）+ mermaid（重 ~1MB——按需动态 import 或显式不做，决策时定）。
验收口径 = 双视图（live preview 装饰 + 阅读视图管线）+ 导出 css 同步 + 既有管线
字节级 diff 义务（无新语法用例不变）。完成标准沿用四条底线 + OBSIDIAN-COMPAT 套件
矩阵不回退。后续：R19+ 候选池（主题 CSS 类名兼容层 / Properties 面板 / 模板系统 /
搜索运算符，见 ROADMAP）。
```

## 给接续者的三句话背景

- 开发模式已验证十七轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证 + 双端运行时实测**。R17（附件摄入+折叠）评审 20 finding 全确认（5 major：
  并发摄入 TOCTOU→Rust create_new 独占 + 前端串行化链、paste 陈旧偏移删字节→doc 身份
  守卫、lang-markdown 内置 headerIndent 折叠服务绕过冻结语义→support 数组结构过滤剥离、
  桌面 drop 死路→dragDropEnabled:false、设置 trim-on-keystroke）。R16 改写引擎五步算法 +
  修复细节在 ARCHITECTURE R16 节，**动 vault/documents/改写路径前必读它的 As-built
  deltas**；R17 摄入/折叠口径在 R17 节。注意：rename 的 watcher 事件无指纹面、external
  是设计行为（r17-echo-diag.js 坐实，r16-desktop.js d4 断言已修订为「引擎写目标绝不
  external」）。
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
