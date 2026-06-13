# Geode HANDOFF — 续接入口

> ▶ **START HERE**｜你的标准指令就是「**阅读 handoff，继续开发**」。读完本区直接执行 `/continue`，**不要问用户做哪一项**（仅 CLAUDE.md §自主开发契约 5 条硬边界才停下问）。

### ① 当前状态（每轮收尾**必须**刷新这几行）

- 版本 **v0.26.0**｜分支 `opus` → `origin/opus`（收尾 `git push`）｜开发机 macOS（本仓库路径）
- 上一轮：**R26 PDF/音视频嵌入 ✓ 已交付**（原生 `<audio>`/`<video>`/`<iframe>`，零新依赖；字节守卫 `r26-bytes` 入库）
- **下一项 = R27｜书签 Bookmarks**（core bookmarks store 兼容 `.obsidian/bookmarks.json` 形状 + 侧栏面板 + 命令 + compat；零新依赖——细则见 `docs/ROADMAP.md` R25+ 候选池表）
- 其后按序：④文件树拖拽 → ⑤折叠持久化 → ⑥Properties 侧栏 → ⑦斜杠命令
- ⏸ 待用户拍板（勿自动启动）：发布渠道 / Authenticode 签名 / `.tauri-keys` 私钥找回

### ② 续接 3 步

1. 读 `CLAUDE.md`（铁律 + 文档地图）→ 本区 → `docs/ROADMAP.md` 末候选池；其余文档按 CLAUDE.md「文档地图」**只读相关章节**。
2. 执行 **`/continue`**（自主整轮：契约 → 并行实现 → 集成验证 → 对抗评审 → 双端实测）。
3. **收尾必写文档 ＝ 循环闭合**（不写则 Stop hook 拦下、本轮结束不了、下次「阅读 handoff」会续到过时状态）：① 刷新上面「当前状态」；② 把本轮根因教训追加到下方「三句话背景」；③ `ROADMAP` 完成记录+出队、`ARCHITECTURE` As-built、`OBSIDIAN-COMPAT` 矩阵；④ `feat(rXX):`+`docs(rXX):` 提交并 `git push`。

---

## 详细口径 / 历史背景（机器按需查）

# 续接提示词（原文，可参考）

```
继续开发 Geode（/Users/cutealexander/Code/active/geode/geode，Obsidian 复刻桌面应用,
当前 v0.25.0，开发机 macOS——R23 起迁至本机）。启用 workflows。
远端：https://github.com/AlexHercules/geode（私有，分支 opus → origin/opus；每轮收尾
提交后 git push）。用户口径（2026-06-11）：发布不着急，暂不做渠道/证书决策。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R25 完成记录、R25+ 候选池（执行队列）
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R25 套件回归、缺口表（R25 更新 registerHoverLinkSource 行）
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、macOS 环境口径 + 桌面 probe
   时序纪律（必读）
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R25 节含悬停预览契约 + As-built：
   1 major + 3 minor + 2 个 E2E 抓获；R23 模板系统冻结语义；R22 properties；R21 搜索
   语义；R16 改写引擎算法动 vault/documents 前必读）
5. docs/DISTRIBUTION.md — 发布流程（Windows 向，本机仅参考）

候选池执行口径：迁移叙事第二梯队（R19+）已清空；**R25+ 候选池（Obsidian 原生功能补课）
执行中**——①悬停预览 ✓（R25）。**用户口径改新（2026-06-13）：R25+ 候选池逐项按序
自主推进，重开对话只读本 handoff 即继续，不再每轮问方向**。**下一项 = ②PDF 查看器 +
PDF/音视频嵌入（R26）**：音视频零依赖先做（`![[a.mp3]]`/`![[v.mp4]]` → `<audio>`/
`<video>`，走 `vault.readBinary`+blob，R11 图片嵌入先例，阅读/live/导出三态）；PDF =
**一次性依赖决策，由该轮自主拍板**（用户全权委托）——桌面 WKWebView 原生支持 PDF
（`<embed>`/iframe 内嵌），浏览器端需 PDF.js（体积敏感，**倾向零/轻依赖：浏览器端可
先 lazy-import PDF.js 或先降级链接**），页码锚点 `#page=N`；现状 = R12 缺口「PDF/音频/
canvas 嵌入均降级链接」，embeds.ts 仅 img/note/math/mermaid 分支。其后按序：③书签
Bookmarks ④文件树拖拽移动（接线为主，R16 改写引擎已就绪）⑤折叠持久化 + 阅读视图折叠
⑥Properties 侧栏视图 ⑦斜杠命令 `/` 菜单。另：发布渠道 + Authenticode（待拍板，
.tauri-keys 私钥未找回，**不主动启动**）+ 性能远期项仍待办。验收沿用四条底线 +
OBSIDIAN-COMPAT 套件矩阵不回退（macOS 下 = probe 插件方案）。用户全权委托决策，
目标=复刻 Obsidian——但发布/签名等不可逆外向动作仍须先确认。
（注：本仓已落 `.claude/commands/continue.md` 自主整轮命令 + `.claude/skills/data-safety`
写入安全清单 + `.github/workflows/ci.yml` CI + commit-guard hook，校准脚本已入库
`.calibration/`——换机 `cd .calibration && npm ci && npx playwright install chromium`。）
```

## 给接续者的三句话背景

- **R26（PDF/音视频嵌入）核心教训 = 改 `core/markdown.ts`（字节级阅读管线）的纪律**：
  r18-diff 本机未重建，于是先落 always-on 探针 `window.__geodeRenderMarkdown(source,
  sourcePath)`（main.tsx）+ `.calibration/r26-bytes.mjs`（36 例语料，基线数据
  `r26-bytes.baseline.json` 入库）作 rebuilt-r18-diff 等价物——**改 markdown.ts 前
  `node r26-bytes.mjs --baseline` 快照、改后 `node r26-bytes.mjs` diff 断言只有目标
  用例变、其余 Part-A 字节不变**。这套探针 + 语料是此后任何 markdown.ts 改动的复跑守卫，
  务必沿用（别再裸改字节管线）。本轮 emission 仅加 file-embed 分支（image 后、noteEmbeds
  前），实测仅 4 媒体用例变、32 非媒体用例（含 `![[x.zip]]` 仍降级链接）字节不变。
  另一教训：**reading 内链/嵌入 = 核心 markdown 管线（`a.internal-link` / `img.geode-embed`
  / `span.geode-embed-file`），live = CM 装饰 widget（`EmbedWidget`/`FileEmbedWidget`，
  类 `cm-live-embed`）——两条管线分开实现，加任何嵌入/内链类型务必两边都接**（R25 漏
  live wikilink、R26 这次两边都接到了）。MIME/扩展名分类收敛到 `core/markdown.ts` 单一
  真值（`AUDIO_EXTS`/`VIDEO_EXTS`/`fileEmbedKind`/`mimeForPath`），feature 别再各自留
  副本（仓内尚存 compat util / hover 两处旧 MIME 表，未来整合）。PDF/音视频零依赖（原生
  `<audio>`/`<video>`/`<iframe>`，桌面 WKWebView + 浏览器 Chromium 都原生渲染 PDF）——
  CLAUDE.md 硬边界 #5「新运行时依赖」遇到时取零依赖路线即可自主推进，不必停下问。
- 开发模式已验证二十六轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维
  评审 + 逐条对抗验证 + 双端运行时实测**。R25（悬停预览）= 1 core + 3 并行 agent
  （hover/sources/settings）+ 集成 + 5 维评审 Workflow 9 finding → 6 确认 3 证伪（去重
  4 根因：1 major + 3 minor），**外加浏览器 E2E 抓出 2 个评审漏网的缺陷**（共 6 修复）。
  那两个 E2E 抓获最值钱、静态评审看不到：① **live-preview 内链根本不是
  `a.internal-link`** 而是 CodeMirror 装饰的 `span.cm-live-wikilink[data-link-target]`
  （+`data-link-subpath`，空 target=自链）——契约「编辑器锚点已带 data-target」与实际
  渲染管线不符，控制器 `closest("a.internal-link")` 整个漏掉它 → **最常用的编辑视图
  悬停完全不触发**（修复 = extractTrigger 加 `.cm-live-wikilink` 第二触发源；教训：
  契约对 DOM 形状的断言务必以实际渲染管线为准，reading=核心 markdown `a.internal-link`
  与 live=CM 装饰 `cm-live-wikilink` 不同源）；② **subpath 滚动竞态**——`placeCard`
  把 max-height 设在 rAF 里，渲染链（内存 vault 极快）常在该 rAF 前完成 → 滚动时卡片
  未受 max-height 约束、不可滚 → scrollTop 夹到 0（真实磁盘慢时偶发可滚=flaky；修复
  = 滚动包进 rAF 落到定位帧后 + 陈旧守卫；教训：依赖「尺寸已定 + 内容已渲染」两个异步
  前置的 DOM 读写必须排到二者都落定的帧）。major = subpath 滚动用文本匹配而非
  `resolveSubpath` 序号（重复标题/嵌入副本/子串误命中——修复=镜像 EditorPane R15 序号
  + 排除 `.geode-embed-note`）。两处总工程师裁决：**hoverStore = core/hover.ts 单例
  Store**（控制器写、卡片订阅）；**卡内链接点击不走 openWikilink**（它在 features/editor，
  跨 feature import 违分层——卡片持有 resolved path，直接 openFile+resolveSubpath+
  requestReveal 替代）。**R25 还落了一个可复跑渲染钩子**：`window.__geodeHover(rawTarget,
  sourcePath)`（main.tsx，`__geodeRename`/`__geodeUnlinked` 同款 always-on probe——桌面
  WKWebView 无 CDP，靠它驱动真实 fs resolve→read→render 校验，返回 HTML 或 null）。
  R24 教训仍有效：声称「镜像某模块」务必把那模块的关键守卫也抄上（R24 是 post-rewrite
  断言，R25 是 R15 的 ordinal+embed 排除）；默认折叠态必须显式 seed（别靠 `?? true`
  与 toggle 打架）；React 卸载清理动 activeElement 用 useLayoutEffect；用户可输入文本必
  设对抗性输入评审维。
- **环境是新 macOS 机（R23 迁移，路径见上）**：dev server 后台直跑即可（本机无
  tmux/hook，端口 1420）；curl 加 `--noproxy '*'`；`.calibration/` 独立 package.json
  **必须先写再 npm i**（裸装会向上爬污染仓库根，R23 实测踩中）；cargo 要
  `PATH="$HOME/.cargo/bin:$PATH"` 前缀（漏掉 tauri build 报 "failed to run cargo
  metadata" 但管道下游可能假象 exit 0）。桌面 = `npm run tauri build` 产出裸二进制
  `src-tauri/target/release/geode <vault绝对路径>` + probe 插件自检（WKWebView 无
  CDP）——**后台启动的 app 里 probe 晚期 await/timer 不可靠（App Nap），断言放加载后
  前几秒、进度 fire-and-forget 写链、挂载断言查 sidebarPanels Store**。可复跑资产
  （本机）：浏览器 `node .calibration/r25-e2e.mjs` 17 断言（explorer/阅读/编辑修饰键/
  unresolved/subpath 滚动/卡内点击导航/设置 toggle）、`r24-e2e.mjs` 12 / `r23-e2e.mjs`
  22（需 dev server）；桌面 compat-vault probe `r25-probe`(7，经 `__geodeHover` 真实 fs
  渲染)/`r24-probe`(12)/`r23-suite`(9)/`r23-templates`(10)，**结果文件 `r25-results.md`
  与 `__r25/` 夹具、`r24-results.md`/`__r24/`、Probe Template*.md、Suite Home.md 重跑前
  先删/重置**。R20-R22 旧 e2e/probe 与 `.calibration/r18-diff` 字节级套件**未随迁未
  重建**——其套件不变量已由 r23-suite-probe 覆盖，但**改 core/markdown.ts 前必须先
  重建 r18-diff**（72+ 用例，Part A 33 无新语法字节一致；构建方式见 git 历史 R18 文档
  或重新生成基线）。
  **风险待用户确认（每轮务必提醒直至确认）：`.tauri-keys/` minisign 更新签名私钥
  仍未找回**——丢失 = 永远无法向已装机用户推更新；原 Windows 机
  （C:\Users\16778\Desktop\开发\rock）或其备份里应该还有。
- 守住的老规矩：UI 字符串走 t()/useI18n()（命令键在 dict.app.ts 的 cmd.*；settings.*
  选择器/字段在 dict.views.ts，palette.*/switcher.* 在 dict.panels.ts——分居是所有权
  使然，维护时多边都查）；命令/插件 name 是 thunk；live↔source 走 modeCompartment；
  阅读视图管线改动先重读「字节级承诺」+跑 diff 套件；**reading 内链 = `a.internal-link
  [data-target/data-subpath]`，live 内链 = `span.cm-live-wikilink[data-link-target/
  data-link-subpath]`——两者不同源，凡委托内链 DOM 务必两套都认（R25 教训）**；agent
  行内注释不能修订契约（上报 chief 裁决）；frontmatter 一律走 core/properties.ts
  builder（绝不手写 YAML 拼接）；模板变量展开走 core/templates.ts `expandTemplate`
  （单趟替换冻结语义）；挂载竞态用一次性消费 Store（revealTarget/addPropertyRequest/
  templatePickerMode/hoverStore 先例）；红色错误样式变量是 `--danger`、阴影是
  `--shadow-modal`（别硬编码 rgba，R25 教训）；mermaid 升级前复核 ARCHITECTURE R19
  两坑；R16 改写引擎五步算法动 vault/documents 前必读；版本号一轮三处（package.json /
  tauri.conf.json / SettingsModal APP_VERSION——R23 起对齐，别再漏）。
