# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（/Users/cutealexander/Code/active/geode/geode，Obsidian 复刻桌面应用，
当前 v0.23.0，开发机 macOS——R23 起迁至本机）。启用 workflows。
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

候选池执行口径（用户拍板 2026-06-12）：逐项推进，无需再问主线——R19 mermaid ✓、
R20 主题 CSS ✓、R21 搜索运算符 ✓、R22 Properties ✓、R23 模板系统 ✓，下一项取
**未链接提及（反链面板扩展）**；其后候选池只剩发布渠道（待用户拍板，暂缓口径
2026-06-11，不主动启动）与性能远期项。验收沿用四条底线 + OBSIDIAN-COMPAT 套件
矩阵不回退（macOS 下 = probe 插件方案）。
```

## 给接续者的三句话背景

- 开发模式已验证二十三轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维
  评审 + 逐条对抗验证 + 双端运行时实测**。R23（模板系统）评审 13 finding → 12 确认
  1 证伪（去重 10 根因：1 critical + 1 major）：critical 是 preview→live 翻转与
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
  可复跑资产（本机）：浏览器 `node .calibration/r23-e2e.mjs` 22 断言（需 dev
  server）；桌面 compat-vault probe r23-suite(9)/r23-templates(10)，结果文件与
  Probe Template*.md 重跑前先删、Suite Home.md 重置。R20-R22 的旧 e2e/probe 脚本
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
