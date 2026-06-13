# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（/Users/cutealexander/Code/active/geode/geode，Obsidian 复刻桌面应用,
当前 v0.24.0，开发机 macOS——R23 起迁至本机）。启用 workflows。
远端：https://github.com/AlexHercules/geode（私有，origin/master）——每轮收尾提交后
git push。用户口径（2026-06-11）：发布不着急，暂不做渠道/证书决策。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R23 完成记录、R19+ 候选池（执行队列）
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R23 套件回归（新机 probe 方案修订）、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、macOS 环境口径 + R23 桌面
   probe 时序纪律（必读）
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R23 节含模板系统冻结语义 +
   As-built 10 根因修复记录；R22 properties；R21 搜索语义；R16 改写引擎算法动
   vault/documents 前必读）
5. docs/DISTRIBUTION.md — 发布流程（Windows 向，本机仅参考）

候选池执行口径：迁移叙事第二梯队（R19+）逐项做完——R19 mermaid ✓、R20 主题 CSS ✓、
R21 搜索运算符 ✓、R22 Properties ✓、R23 模板系统 ✓、**R24 未链接提及 ✓**，**执行
队列清空**。已与用户登记 **R25+ 候选池（Obsidian 原生功能补课，见 ROADMAP「R25+
候选池」表）**：①悬停预览（Ctrl+hover 卡片，compat hoverPopover 也是空 stub）②PDF
查看器 + PDF/音视频嵌入（现全降级链接，PDF.js 是一次性依赖决策）③书签 Bookmarks
④文件树拖拽移动（R16 改写引擎已就绪，接线为主）⑤折叠持久化 + 阅读视图折叠（R17 债）
⑥Properties 侧栏视图（R22 延期）⑦斜杠命令 `/` 菜单。**用户口径（2026-06-13）：不着
急一口气都做，逐项记录在案——开工前问用户取项或按优先级挑**。另：发布渠道 +
Authenticode（待拍板，.tauri-keys 私钥未找回，**不主动启动**）+ 性能远期项仍待办。
验收沿用四条底线 + OBSIDIAN-COMPAT 套件矩阵不回退（macOS 下 = probe 插件方案）。
用户全权委托决策，目标=复刻 Obsidian——但发布/签名等不可逆外向动作仍须先确认。
```

## 给接续者的三句话背景

- 开发模式已验证二十四轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维
  评审 + 逐条对抗验证 + 双端运行时实测**。R24（未链接提及）= core 引擎 + ui 面板两
  并行 agent，评审 5 维 Workflow 13 finding → 7 确认 6 证伪（去重 5 根因：2 major +
  3 minor），**外加浏览器 E2E 抓出 1 个评审漏网的 UI 缺陷**（共 6 修复）。两条 major
  都在写入别的文件的数据安全面：① 源文件首字节 `#tag`（from===0）被 buildMasked 的
  `from>0` 守卫漏屏蔽 → Link 把标签改写成 `#[[Name]]` 损坏（修复 = 按字节
  `content[tag.from]==="#"` 门控）；② `buildLinkInsert` 对含 wikilink 元字符的名字
  （`C#`/`F#`/`a|b`）写出错链且**漏了 R16 的 post-rewrite 复解析断言**（修复 = doLink
  补复解析校验，不符即 skip+报告——教训：声称"镜像 R16"务必把那道 post-rewrite
  断言也抄上，否则错链静默落盘）。E2E 抓的 UI 缺陷：默认折叠节用 `collapsed.x ?? true`
  但 state 初值 `{}`，toggle `!c[key]` 首点 `!undefined===true` 仍折叠 → 首点展不开
  （教训：默认折叠态必须显式 seed `{x:true}`，别靠 `?? true` 默认值与 toggle 打架）。
  **R24 还落了一个可复跑写引擎钩子**：`window.__geodeUnlinked.{find,linkAll,linkOne}`
  （main.tsx，`__geodeRename` 同款 always-on probe——桌面 WKWebView 无 CDP，靠它驱动
  真实 fs 写校验）。R23（模板系统）评审 13 finding → 12 确认 1 证伪（去重 10 根因：1 critical + 1 major）：critical 是 preview→live 翻转与
  openModal 同一 React commit 时，被重建 EditorPane 的 effect `view.focus()` 在 modal
  autoFocus 之后执行抢走焦点——**键入直接污染正文并自动保存**（修复 = focus 带
  modal 守卫；教训：同 commit「翻模式+开 modal」时重建组件的焦点操作必须查 modal
  状态）；major 是 `documents.getActiveView()` 闩锁字段陈旧——它只在 focusin 设置、
  视图销毁清除，活动 tab 无编辑器时仍指向后台 pane，**第一方写命令走它会写进非
  活动文件**（修复 = `getActiveFileEditorView` 双侧门控；fold 等非破坏性消费方维持
  现状，后续写命令一律走带门控版本）。R22 教训继续有效：React 卸载清理动
  activeElement 用 useLayoutEffect；序列化必设外部解析器视角；R21 教训：用户可输入
  文本必设对抗性输入评审维。
- **环境是新 macOS 机（R23 迁移，路径见上）**：dev server 后台直跑即可（本机无
  tmux/hook）；curl 加 `--noproxy '*'`；`.calibration/` 独立 package.json **必须先
  写再 npm i**（裸装会向上爬污染仓库根，R23 实测踩中）；cargo 要
  `PATH="$HOME/.cargo/bin:$PATH"` 前缀。桌面 = 裸二进制
  `src-tauri/target/release/geode <vault绝对路径>` + probe 插件自检（WKWebView 无
  CDP）——**R23 新纪律：后台启动的 app 里 probe 晚期 await/timer 不可靠（App Nap），
  断言放加载后前几秒、进度 fire-and-forget 写链、挂载断言查 sidebarPanels Store**。
  可复跑资产（本机）：浏览器 `node .calibration/r24-e2e.mjs` 12 断言 /
  `r23-e2e.mjs` 22 断言（需 dev server）；桌面 compat-vault probe
  r24-probe(12，经 `__geodeUnlinked` 钩子驱动真实 fs Link 写)/r23-suite(9)/
  r23-templates(10)，**r24 结果文件 `r24-results.md` 与 `__r24/` 夹具、Probe
  Template*.md 重跑前先删、Suite Home.md 重置**。R20-R22 的旧 e2e/probe 脚本
  与 `.calibration/r18-diff` 字节级套件**未随迁且未重建**——其套件不变量已由
  r23-suite-probe 覆盖，但**改 core/markdown.ts 前必须先重建 r18-diff**（72+ 用例，
  Part A 33 无新语法字节一致；构建方式见 git 历史 R18 文档或重新生成基线）。
  **风险待用户确认（每轮务必提醒直至确认）：`.tauri-keys/` minisign 更新签名私钥
  仍未找回**——丢失 = 永远无法向已装机用户推更新；原 Windows 机
  （C:\Users\16778\Desktop\开发\rock）或其备份里应该还有。
- 守住的老规矩：UI 字符串走 t()/useI18n()（命令键在 dict.app.ts 的 cmd.*；R23 注：
  templates.* 选择器字符串也在 dict.app.ts，palette.*/switcher.* 在 dict.panels.ts
  ——分居是所有权使然，维护时两边都查）；命令/插件 name 是 thunk；live↔source 走
  modeCompartment；阅读视图管线改动先重读"字节级承诺"+跑 diff 套件；agent 行内
  注释不能修订契约（上报 chief 裁决）；frontmatter 一律走 core/properties.ts builder
  （绝不手写 YAML 拼接）；模板变量展开走 core/templates.ts `expandTemplate`（单趟
  替换冻结语义，绝不重扫替换值）；挂载竞态用一次性消费 Store（revealTarget/
  addPropertyRequest/templatePickerMode 先例）；红色错误样式变量是 `--danger`；
  mermaid 升级前复核 ARCHITECTURE R19 两坑；R16 改写引擎五步算法动 vault/documents
  前必读；版本号一轮三处（package.json / tauri.conf.json / SettingsModal
  APP_VERSION——R23 起对齐，别再漏）。
