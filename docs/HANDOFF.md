# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（/Users/maoliang/Desktop/geode，Obsidian 复刻桌面应用，当前 v0.21.0，
开发机 macOS——R20 起从 Windows 迁移）。启用 workflows。
远端：https://github.com/AlexHercules/geode（私有，origin/master）——每轮收尾提交后
git push。用户口径（2026-06-11）：发布不着急，暂不做渠道/证书决策。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R21 完成记录、R19+ 候选池（执行队列）
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R21 套件回归（macOS probe 方案）、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、macOS 环境口径（R20 新增节，必读）
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R21 节含搜索语义 8 条冻结 +
   As-built；R20 变量桥三段式/注入序不变量/opChain；R16 改写引擎算法动
   vault/documents 前必读）
5. docs/DISTRIBUTION.md — 发布流程（Windows 向，本机仅参考）

候选池执行口径（用户拍板 2026-06-12）：逐项推进，无需再问主线——R19 mermaid ✓、
R20 主题 CSS 兼容层 ✓、R21 搜索运算符 ✓，下一项按建议顺序取 **Properties 可视化
编辑（frontmatter 结构化面板）**，其后模板系统 → 未链接提及；真实发布渠道 +
Authenticode 证书仍待用户拍板（暂缓口径 2026-06-11，不主动启动）。验收沿用四条
底线 + OBSIDIAN-COMPAT 套件矩阵不回退（macOS 下 = probe 插件方案）。
```

## 给接续者的三句话背景

- 开发模式已验证二十一轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维
  评审 + 逐条对抗验证 + 双端运行时实测**。R21（搜索运算符）评审 13 finding →
  10 确认（1 critical + 1 major）3 证伪：critical 是 `u` flag 零长正则 + emoji 的
  V8 lastIndex 回退死循环（修复 = 按 code point 步进）；major 是 U+0130 İ
  toLowerCase 变长致高亮区间漂移（修复 = LoweredText 偏移双映射）。**教训：凡涉
  用户可输入的正则/Unicode 文本处理，评审必设「对抗性输入」维度**——42 用例 ASCII
  矩阵全绿也测不到这两个。搜索语义 8 条冻结在 ARCHITECTURE R21（含两处评审后修订：
  字段操作数 `#` 字面绑定、`line:` 内 default 词跳 basename）；灾难性回溯正则无护栏
  是入档已知限制（与 Obsidian 同级），worker 化远期。
- **环境是 macOS（R20 迁移）**：dev server 必须 tmux 起（hook 强制）；curl 加
  `--noproxy '*'`；Playwright 在 `.calibration/` 独立 package.json（别在仓库根
  npm i 任何测试工具）；**cargo 不在默认 PATH**——`PATH="$HOME/.cargo/bin:$PATH"`
  前缀再跑 cargo/tauri build（R21 踩坑：漏了它 tauri build 静默失败但 exit 0 假象）。
  桌面 = 裸二进制 `src-tauri/target/release/geode <vault>` + **probe 插件自检**
  （WKWebView 无 CDP——`.geode/plugins/*.js` 拿 window.geode.app 断言、写结果文件
  回 vault；r21-search-probe.js 先例展示了驱动真实面板 DOM：原生 value setter +
  input 事件）。probe 结果文件重跑前先删（r20 探针 create 撞已存在文件会留陈旧
  结果）。浏览器 E2E `r20-e2e.mjs` 33 断言 + `r21-e2e.mjs` 29 断言可直接复跑（需
  dev server）；解析器矩阵 `r21-parser-tests.mjs` 51 用例（esbuild 打包 node 直跑）。
  **风险待用户确认：`.tauri-keys/` minisign 更新签名私钥没有随云端迁移到本机**——
  丢失 = 永远无法向已装机用户推更新；原 Windows 机（C:\Users\16778\Desktop\开发\rock）
  或其备份里应该还有，**每轮务必提醒用户找回备份直至确认**。`.calibration/r18-diff`
  字节级 diff 套件也未重建——**改 core/markdown.ts 前先重建**（`npx esbuild
  src/core/markdown.ts --bundle --format=cjs --platform=node
  --outfile=.calibration/r18-diff/markdown-new.cjs`，run.cjs 在 git 历史/原机）。
- 守住的老规矩：UI 字符串走 t()/useI18n()；命令/插件 name 是 thunk；live↔source
  走 modeCompartment；阅读视图管线改动先重读"字节级承诺"+跑 diff 套件；agent
  行内注释不能修订契约（R21 又一例：line: basename 例外是上报后由 chief 回填契约，
  程序正确）；红色错误样式变量是 `--danger`（`--text-error` 是桥的 Obsidian 变量）；
  lezer setext 节点名 `SetextHeading1/2`；mermaid 升级前复核 ARCHITECTURE R19 两坑；
  R16 改写引擎五步算法动 vault/documents 前必读。套件 5 插件 compat-vault 在本机
  可用；`.geode/plugins/` 下 r20-suite-probe.js 与 r21-search-probe.js 每轮直接复跑
  （后者自建 R21 Fixtures/ 夹具，幂等）。
