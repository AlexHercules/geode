# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.15.0）。
启用 workflows。远端：https://github.com/AlexHercules/geode（私有，origin/master）——
每轮收尾提交后 git push。用户口径（2026-06-11）：发布不着急，暂不做渠道/证书决策。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R15 完成记录、R16 候选
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R15 套件回归、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、验证手段
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R15 节含瘦身不做的决策记录）
5. docs/DISTRIBUTION.md — 发布流程/密钥管理/签名配置位

本轮目标（R16）按 ROADMAP「迁移体验路线图（R16-R18）」执行（2026-06-11 与用户对齐，
取代旧的 P2 池逻辑）：**R16 = 重命名自动更新引用 + [[#h]] 同文链接**。这是数据安全
等级最高的一轮（批量改写用户文件）——契约前先用 WebFetch 校准 Obsidian 的链接更新
语义（basename 歧义、设置项），改写必须经共享文档模型（打开中文件不丢 undo）+
磁盘原子写 + watcher 自写指纹协同，评审对抗验证不可省，双端实测要含"改写前后链接
解析等价"断言。后续：R17 附件摄入+折叠、R18 方言长尾（见 ROADMAP）。
完成标准沿用四条底线 + OBSIDIAN-COMPAT.md 套件矩阵不回退。
```

## 给接续者的三句话背景

- 开发模式已验证十五轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证 + 双端运行时实测**。R1-R15 共确认 128 处缺陷全处置。R15 是整固轮：
  性能基线七轮欠账已清（bench=10000 零回归，graphSettle 反而 5771→3958ms；基线表在
  PERFORMANCE.md R15 节），全量回归探针（r12/r13/r14）+ 套件全绿。瘦身决策：**不做**，
  理由与重开条件入档 ARCHITECTURE R15 节——别在没有体积硬指标时重开这个坑。
- 验收套件在 `compat-vault/`（gitignore）；桌面 release 实测
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起
  `geode.exe <vault>`（env 与 Start-Process 同一条命令）；浏览器性能口径用
  headless Edge：`msedge --headless=new --remote-debugging-port=93xx
  --user-data-dir=<tmp> "http://localhost:1420/?bench=10000"` + `.calibration/
  cdp-run-url.mjs <expr> <port> <urlSub>`（**杀 Edge 按 PID 别按进程名**——
  会误杀用户自己的浏览器，R15 踩过）。reveal 口径：R15 起 preview 态直接消费
  （heading 序号定位需排除嵌入笔记内的 heading——已实现）。
- PowerShell 5.1 改源码 mojibake+BOM——只用 Read/Edit/Write 工具碰文件；Windows 无
  空串 env 变量（签名密钥必须带密码，见 DISTRIBUTION.md）。UI 字符串走 t()/useI18n()；
  命令/插件 name 是 thunk；live↔source 走 modeCompartment；live preview 新增扫描默认
  fence 排除；阅读视图管线改动先重读"字节级承诺"口径；图谱不要把边批进单个 Path2D；
  compat 对照 .calibration 官方 d.ts；agent 的行内注释不能修订契约。
