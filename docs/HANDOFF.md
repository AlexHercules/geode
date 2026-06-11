# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.6.0）。
启用 workflows。

按顺序读这四个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R6 完成记录、R7 优先级
2. docs/OBSIDIAN-COMPAT.md — Tier 表（T2 余项 R6 全清）、R6 套件矩阵（nldates 自动建议 ✓）、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏（契约→并行 agent→评审+对抗验证→双端验证）、
                          数据安全回归清单、验证手段（?bench=N、?obsfixture=1、AppHandle 探针）
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R6 节含 hotkey 覆盖 API + EditorSuggest
                          管线 + core/markdown + core/net + as-built deltas）

本轮目标（R7）从 ROADMAP「R7 候选」按优先级取，典型组合：
P1 = 图谱打磨（最大化窗口居中偏移修复 + 局部图谱 + 10k 节点 settle 后按需渲染/抽样，
基准结论见 docs/PERFORMANCE.md）+ P2 一项（导出 PDF/HTML——core/markdown.ts 管线已就绪，
或 watcher 回声抑制）。
实现任何 obsidian API 前，先确认 .calibration/ 在（gitignore 不入库，缺了再生）：
curl -o .calibration/obsidian.d.ts https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts
R6 校准摘录在 .calibration/API-REFERENCE-R6.md（EditorSuggest/requestUrl/MarkdownRenderer/
Hotkey 官方签名 + 套件调用面），过期就重跑校准 workflow。
完成标准沿用四条底线 + OBSIDIAN-COMPAT.md 套件矩阵（5/5 + nldates 自动建议不回退）。
```

## 给接续者的三句话背景

- 开发模式已验证六轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证**。R1-R6 共确认 92 处缺陷全处置（R6：13 确认/9 根因 2 证伪，含 1 个事实性
  契约错误——Tauri 2 同步命令跑在主线程，30s 阻塞请求会停摆自动保存，修复 = 一行
  `#[tauri::command(async)]`——教训：契约里关于运行时行为的断言也要校准，不能凭印象写）。
- 验收套件在 `compat-vault/`（gitignore，5 个真实社区插件）；浏览器 `?obsfixture=1` 内置
  fixture（含 `@@` 触发 FixtureSuggest + requestUrl/MarkdownRenderer 探针）；桌面 release
  实测用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起
  `geode.exe compat-vault`，探针 `.calibration/cdp-run.mjs <expr.js>`、截屏
  `.calibration/cdp-shot.mjs <png>`。**驱动 EditorSuggest 的探针必须逐字符独立事务输入**
  （nldates 锚点逐键建立，整串插入测不到）；synthetic 键盘事件派发到 `view.contentDOM`
  （document 级 target 会被焦点守卫正确拦截）。
- PowerShell 5.1 改源码会 mojibake——只用 Read/Edit/Write 工具碰文件。Vite 预打包下
  moment 必须走 `moment/min/moment-with-locales` 单入口。快捷键文法的唯一权威是
  core/commands.ts 的 `hotkeyFromEvent`/`normalizeHotkey`/`matchHotkey` 三件套
  （移位标点经 e.code 归一），改键盘相关功能先读它们。
