# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.19.0）。
启用 workflows。远端：https://github.com/AlexHercules/geode（私有，origin/master）——
每轮收尾提交后 git push。用户口径（2026-06-11）：发布不着急，暂不做渠道/证书决策。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R19 完成记录、R19+ 候选池（执行队列）
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R19 套件回归、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、验证手段
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R19 节含 mermaid 占位/水合/锚点消毒
   契约 + As-built 11 修复；R18 节方言 DOM 契约；R16 节改写引擎算法动 vault/documents 前必读）
5. docs/DISTRIBUTION.md — 发布流程/密钥管理/签名配置位

候选池执行口径（用户拍板 2026-06-12）：**从 mermaid 开始，逐步完成每一项**——R19 已
完成 mermaid，R20 起无需再问主线，按「迁移叙事价值 × 实现风险」从 ROADMAP「R19+
候选池」顺序取下一项即可。建议顺序：主题 CSS 类名兼容层（R18 callout DOM 已按社区
共识对齐，落地受益）→ 搜索运算符（path:/tag:/file:/正则）→ Properties 可视化编辑 →
模板系统 → 未链接提及；真实发布渠道 + Authenticode 证书仍待用户拍板（暂缓口径
2026-06-11，不主动启动）。验收沿用四条底线 + OBSIDIAN-COMPAT 套件矩阵不回退。
```

## 给接续者的三句话背景

- 开发模式已验证十九轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证 + 双端运行时实测**。R19（mermaid）评审 13 finding → 11 确认（1 major）
  2 证伪：major 是 strict 模式下 `click A "url"` 仍生成 `<a xlink:href>`（setLink 无
  securityLevel 闸门、sanitizeUrl 放行相对路径），`closest("a[href]")` 属性选择器不
  匹配命名空间 href → 恶意图一键导航整个 webview——修复 = 水合层锚点消毒（embeds.ts
  neutralizeMermaidAnchors：https 补 _blank+noopener、其余剥除）+ 点击守卫放宽为
  `closest("a")` 双层。**mermaid 全局状态有两个坑**：initialize 同步改全局 config 而
  render 走模块级 executionQueue 出队时才取主题 → 跨批次主题竞态（修复 = embeds.ts
  `mermaidBatchChain` promise 链把 initialize+整批 render 原子串行化）；render 不传第三
  参时临时容器直挂 document.body（打印样式已加 guard 隐藏）。**升级 mermaid 或改用
  mermaidAPI.render 前必须复核这两点**（As-built 已显式化对库内队列的依赖）。渲染管线
  `core/markdown.ts` 改动前必读 R18/R19 As-built + 跑 `.calibration/r18-diff/run.cjs`
  字节级 diff 套件（78 用例；改完先 `npx esbuild src/core/markdown.ts --bundle
  --format=cjs --platform=node --outfile=.calibration/r18-diff/markdown-new.cjs` 重建）。
  R16 改写引擎五步算法在 ARCHITECTURE R16 节，动 vault/documents/改写路径前必读。
  KaTeX/mermaid 均动态 import（core/math.ts、core/mermaid.ts 单例 loader 先例）。
- 验收套件在 `compat-vault/`（gitignore）；桌面 release 实测
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起
  `geode.exe <vault>`（env 与 Start-Process 同一条命令）；探针
  `.calibration/cdp-run.mjs <expr文件> [port]`、桌面截图 `cdp-shot.mjs <png>`；
  R19 桌面探针 `r19-probe1.js`（图表 14 断言）可直接复跑。浏览器走 dev server :1420 +
  Playwright MCP（`window.geode.registerPlugin({onload(app)})` 拿 AppHandle 驱动——
  R18/R19 均此法）；**dev-only 现象**：mermaid 首次按需优化会触发 Vite 整页 reload
  （内存 vault 清空，探针需重建场景；生产构建无此事）。**真实 fs 探针有状态**：
  compat-vault 残留要清（r17 摄入的 `Pasted image*.png`、R19 的 `R19*.md`——探针自带
  cleanup，但异常中断会留痕）。`npm run tauri build` 末尾 updater 签名步骤因无
  `TAURI_SIGNING_PRIVATE_KEY` 报 exit 1——**exe 与 NSIS 包已产出，非构建失败**。
- PowerShell 5.1 改源码 mojibake+BOM——**只用 Read/Edit/Write 工具碰文件，版本号 bump
  也是**（package.json/Cargo.toml/Cargo.lock/tauri.conf.json 四处）；Windows 无空串
  env 变量。UI 字符串走 t()/useI18n()（R19 无新键）；命令/插件 name 是 thunk；
  live↔source 走 modeCompartment；阅读视图管线改动先重读"字节级承诺"口径 + 跑 diff
  套件；agent 行内注释不能修订契约；**红色错误样式变量是 `--danger`**（R18 契约写过
  的 `--text-error` 是幽灵变量，R19 已在契约正文修正——别再照抄）；lezer setext 节点
  名是 `SetextHeading1/2`；CSS 跨文件同步块用 `/* X-BEGIN */ … /* X-END */` 成对注释；
  ARCHITECTURE.md 的字面 NUL 字节 R19 已替换为 `\0` 转义（ripgrep 恢复可见——新代码
  别写字面控制字符）；onPreviewClick 的 e.target 收窄是 `Element`（R19 起，SVG 点击
  进分支是有意行为）。
