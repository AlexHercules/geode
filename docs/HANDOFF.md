# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（/Users/maoliang/Desktop/geode，Obsidian 复刻桌面应用，当前 v0.20.0，
开发机 macOS——R20 起从 Windows 迁移）。启用 workflows。
远端：https://github.com/AlexHercules/geode（私有，origin/master）——每轮收尾提交后
git push。用户口径（2026-06-11）：发布不着急，暂不做渠道/证书决策。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R20 完成记录、R19+ 候选池（执行队列）
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R20 套件回归（macOS probe 方案）、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、macOS 环境口径（R20 新增节，必读）
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R20 节含变量桥三段式/注入序
   不变量/opChain 串行化契约 + As-built；R19 mermaid 全局状态两坑；R16 改写引擎
   算法动 vault/documents 前必读）
5. docs/DISTRIBUTION.md — 发布流程（Windows 向，本机仅参考）

候选池执行口径（用户拍板 2026-06-12）：逐项推进，无需再问主线——R19 mermaid ✓、
R20 主题 CSS 兼容层 ✓，下一项按建议顺序取 **搜索运算符（path:/tag:/file:/正则）**，
其后 Properties 可视化编辑 → 模板系统 → 未链接提及；真实发布渠道 + Authenticode
证书仍待用户拍板（暂缓口径 2026-06-11，不主动启动）。验收沿用四条底线 +
OBSIDIAN-COMPAT 套件矩阵不回退（macOS 下 = probe 插件方案 9/9 面）。
```

## 给接续者的三句话背景

- 开发模式已验证二十轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维
  评审 + 逐条对抗验证 + 双端运行时实测**。R20（主题 CSS 兼容层）评审 11 finding →
  10 确认（2 major）0 证伪 + 安全维补跑 1 minor：major#1 是 CSS 特异性坑——桥语义
  变量放 `.theme-dark{}`（0,1,0）会压制主流主题（Minimal/Things）在官方 `body{}`
  （0,0,1）作用域的 accent 覆写，**特异性先于文档序**，修复 = 私有 `--geode-ob-*`
  原语进模式类、语义默认值进 body{}（真实 Obsidian 同形状）；major#2 是 setter
  并发丢更新，修复 = themes.ts 单 `opChain` 串行化全部变更 + RMW 在 mutate 内增量
  计算。**动 theme-bridge.css 或 app.css 调色板必须双向同步**（成对注释
  OBSIDIAN-BRIDGE-PALETTE-BEGIN/END，E2E 恒等断言会抓）。注入序不变量（插件
  styles.css → bridge → theme → snippets）靠订阅 obsidianLoadReport 整组重建维持。
- **环境是 macOS（R20 迁移）**：dev server 必须 tmux 起（hook 强制）；curl 加
  `--noproxy '*'`；Playwright 在 `.calibration/` 独立 package.json（别在仓库根
  npm i 任何测试工具）；桌面 = 裸二进制 `src-tauri/target/release/geode <vault>`
  + **probe 插件自检**（WKWebView 无 CDP——`.geode/plugins/*.js` 拿
  window.geode.app 断言、写结果文件回 vault，r20-*-probe.js 先例）；浏览器 E2E
  `.calibration/r20-e2e.mjs` 33 断言可直接复跑（需 dev server）。**风险待用户
  确认：`.tauri-keys/` minisign 更新签名私钥没有随云端迁移到本机**——丢失 =
  永远无法向已装机用户推更新；原 Windows 机（C:\Users\16778\Desktop\开发\rock）
  或其备份里应该还有，下轮务必提醒用户找回备份。`.calibration/r18-diff` 字节级
  diff 套件也未重建——**改 core/markdown.ts 前先重建**（`npx esbuild
  src/core/markdown.ts --bundle --format=cjs --platform=node
  --outfile=.calibration/r18-diff/markdown-new.cjs`，run.cjs 在 git 历史/原机）。
- 守住的老规矩：UI 字符串走 t()/useI18n()；命令/插件 name 是 thunk；live↔source
  走 modeCompartment；阅读视图管线改动先重读"字节级承诺"+跑 diff 套件；agent
  行内注释不能修订契约；红色错误样式变量是 `--danger`（`--text-error` 现在是
  **桥的 Obsidian 变量**，别再混）；lezer setext 节点名 `SetextHeading1/2`；
  mermaid 升级前复核 ARCHITECTURE R19 两坑；R16 改写引擎五步算法动
  vault/documents 前必读。套件 5 插件 compat-vault 已在本机重建（版本与 R5 口径
  一致）；compat-vault/.geode/plugins/r20-suite-probe.js 每轮直接复跑。
