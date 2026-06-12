# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.18.0）。
启用 workflows。远端：https://github.com/AlexHercules/geode（私有，origin/master）——
每轮收尾提交后 git push。用户口径（2026-06-11）：发布不着急，暂不做渠道/证书决策。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R18 完成记录、迁移路线图收官 + R19+ 候选池
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R18 套件回归、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、验证手段
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R18 节含 callout/脚注/数学/注释 DOM 契约
   + As-built 17 修复；R16 节改写引擎算法动 vault/documents 前必读）
5. docs/DISTRIBUTION.md — 发布流程/密钥管理/签名配置位

迁移体验路线图 R16-R18 已全部完成（重命名改写引用 / 附件摄入+折叠 / Markdown 方言长尾）。
本轮（R19）**无既定主线**——从 ROADMAP「R19+ 候选池」按用户诉求取一项。候选与建议：
- mermaid 图表（R18 显式延后；动态 import 先例已由 katex 蹚出，复用即可，~1MB）
- 主题 CSS 类名兼容层（R18 的 callout DOM 已按社区共识对齐，此层落地受益）
- Properties 可视化编辑（frontmatter 结构化面板）/ 模板系统 / 搜索运算符 / 未链接提及
- 真实发布渠道 + Authenticode 证书（用户拍板后随时可做，暂缓口径 2026-06-11）
**先问用户 R19 做哪一项**（路线图已无强制顺序）；若用户无偏好，按"迁移叙事价值 × 实现风险"
推荐主题 CSS 兼容层或搜索运算符。验收沿用四条底线 + OBSIDIAN-COMPAT 套件矩阵不回退。
```

## 给接续者的三句话背景

- 开发模式已验证十八轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证 + 双端运行时实测**。R18（方言长尾）评审 17 finding 全确认 0 证伪（4 major：
  callout 二次 inline.parse 致行内脚注双收集→geode-callouts 改注册 `before("inline")` 单次
  解析；`$$` 块闭合吞行→firstRest 非行尾 `$$` 保字面 + 闭合扫描遇 fence 止损；live 单行 `$$`
  无锚定→逐行镜像管线形态正则；外加预处理 fence 状态机三脱节、脚注 id 跨渲染碰撞→render-seq
  前缀、KaTeX maxSize DoS 三处、live callout 嵌套首行误判、live `%%` 行内 code 翻转状态机、
  live highlight 吞 setext 下划线、MathWidget 点击死区、live 行内数学转义 `$`）。**渲染管线
  `core/markdown.ts` 是本轮重灾区**——动它前必读 R18 As-built + 跑 `.calibration/r18-diff/run.cjs`
  字节级 diff 套件（72 用例：33 无新语法字节一致 + 39 新语法 DOM；这是改基管线的回归护栏）。
  R16 改写引擎五步算法在 ARCHITECTURE R16 节，**动 vault/documents/改写路径前必读其 As-built
  deltas**。KaTeX 是 R18 唯一新依赖，**动态 import**（core/math.ts loadKatex 单例），导出走
  MathML 输出（自包含）、应用内走 html + 注入 CSS。
- 验收套件在 `compat-vault/`（gitignore）；桌面 release 实测
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起
  `geode.exe <vault>`（env 与 Start-Process 同一条命令）；探针
  `.calibration/cdp-run.mjs <expr文件> [port]`、桌面截图 `cdp-shot.mjs <png>`；
  浏览器走 dev server :1420 + Playwright MCP（用 `window.geode.registerPlugin({onload(app)})`
  拿 AppHandle 驱动 vault/workspace 实测——R18 双视图就是此法）。**真实 fs 探针有状态**：
  r17 摄入探针在 compat-vault/assets 累积 `Pasted image*.png`，复跑前清残留 + 重启应用
  （否则 getFiles 计数/内存树过期误判失败——R18 踩过，非回归）。浏览器性能口径 headless
  Edge + `cdp-run-url.mjs`（**杀 Edge 按 PID**；**测性能前确认机器空载**）。
- PowerShell 5.1 改源码 mojibake+BOM——**只用 Read/Edit/Write 工具碰文件，版本号 bump
  也是**（package.json/Cargo.toml/Cargo.lock/tauri.conf.json 四处 + About 版本是 `{version}`
  运行时插值无需改）；Windows 无空串 env 变量。UI 字符串走 t()/useI18n()（R18 无新键）；
  命令/插件 name 是 thunk；live↔source 走 modeCompartment；阅读视图管线改动先重读"字节级
  承诺"口径 + 跑 diff 套件；图谱不要把边批进单个 Path2D；agent 行内注释不能修订契约；
  ripgrep 在含 NUL 字节的文件上静默跳过（新代码别写字面控制字符）。**lezer 节点名陷阱**：
  setext 标题节点是 `SetextHeading1`/`SetextHeading2` 非 `SetextHeading`（R18 LP-4 踩过，
  树遍历判类型用 startsWith 或精确版本名）；CSS 跨文件同步块（如 callout 图标 mask）用成对
  注释标记 `/* X-BEGIN */ … /* X-END */` 圈定，便于 chief 收尾在 editor.css↔export.css 间同步。
```
