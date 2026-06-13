# Geode HANDOFF — 续接入口

> ▶ **START HERE**｜你的标准指令就是「**阅读 handoff，继续开发**」。读完本区直接执行 `/continue`，**不要问用户做哪一项**（仅 CLAUDE.md §自主开发契约 5 条硬边界才停下问）。

### ① 当前状态（每轮收尾**必须**刷新这几行）

- 版本 **v0.37.0**｜分支 `opus` → `origin/opus`（收尾 `git push`）｜开发机 macOS（本仓库路径）
- 上一轮：**R37 前进/后退导航历史 ✓ 已交付**（R32+ 候选池第二梯队 #⑥：`workspace.ts` 原仅 `lastActiveFile`、无 per-tab 导航栈）。校准 Obsidian 官方默认键 **`Mod+Alt+←/→`**（`Ctrl+Alt+←/→` win；与 Geode 自创的 `focus-next/prev-pane` 冲突 → **navigate 拿 canonical 键、focus-pane 改无默认键**,命令仍在面板可自绑）。实现:`core/workspace.ts` per-tab `tabHistory: Map<tabId,{back,forward}>`(session-only、NAV_HISTORY_MAX=50);`openFile` 起始 `recordNavigation`(精确镜像三分支:replace 才记旧 location+清 forward,reuse/new-tab 不记);`navigateBack/Forward`(活动 tab 上回放)+`canTabNavigateBack/Forward(tabId)`+`setTabLocation`(改位不记录);**5 处清理**(closeTab delete、delete purge+prune、rename remap、missing prune、**vault 切换 clear**)。App.tsx 2 命令 + TabBar 加 back/forward 箭头按钮(`disabled` 走 `canTabNavigate*`,**反应式靠 useStore(state)——每次历史变更都伴随 state 变更,无需独立 Store**);icons.tsx 加 arrow-left/right。**零新 vault 写路径**(导航只改 tab.filePath)+ **零新依赖** + **零新探针**(store 直驱 `app.workspace`,热键复用 `__geodeHotkey.match`)。**与 R36 recentlyClosed 两套独立栈**(导航历史=访问序、reopen=关闭序)。`r37-e2e` **36/36** + 桌面 `r37-probe` **18/18** + r32-r36 不回退 + r26-bytes 0。**3 维对抗评审 12 finding → 0 确认缺陷**(核心「recordNavigation 镜像 openFile」逐分支证伪 + 1 行为偏差记入已知偏差[split 不复制历史] + 2 证伪硬化成断言[mode 恢复 + forward 栈 purge])。
- **下一项 = R37→R38 = R32+ 候选池第二梯队 #⑦ 快速切换器子模式 / 文内标题跳转**（QuickSwitcher 现仅文件名+别名+create，无 heading `#`/block `^`/symbol 模式）。Obsidian：键入 `#`→标题模式、`^`→块模式、Ctrl/Cmd+O 文件。切入：QuickSwitcher 加**前缀模式解析**（query 以 `#`/`^` 开头切模式）+ 复用 outline/`metadata` 的 headings/blocks 索引。其后队列：⑧ 固定/堆叠标签+链接面板 → ⑨ 键盘切换复选框（Cmd/Ctrl-L 复用 `preview.ts` toggleTaskOnLine）→（全队列见 ROADMAP R32+ 候选池）。
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

- **R37（前进/后退导航历史）核心教训三条**：① **当新逻辑「镜像」既有函数的分支决策时,逐分支对照证伪
  是评审的硬要求**——`recordNavigation` 必须只在 openFile 的 replace 分支记一次旧 location(reuse=切 tab、
  new-tab=新 tab 都不记)。评审核心担忧正是「镜像是否精确」,逐分支核对:reuse 判据
  `tabs.some(markdown&&filePath===path)` ≡ openFile 的 `existing && !newTab`;graph/null-filePath 活动 tab
  两边都走 new-tab 不记;`s0` 单快照无 TOCTOU——全等价。**凡写「镜像 X 的决策」的代码,把 X 的每个分支与你的
  判据并排列出来逐一证伪,别只测 happy path**。② **「session 态每次变更都伴随 store 变更」⇒ 反应式 UI 无需
  独立 Store——但这是个需要逐变更点枚举证明的断言,不是想当然**。本轮 nav 按钮禁用态靠 `useStore(state)`:枚举
  tabHistory 全部变更点(record/navigate/closeTab/handleDeleted/Renamed/closeMissingFileTabs)均调 `this.update`
  (→state 新引用→重渲染),含「仅存在于历史的删除/改名」也因 handleDeleted 的 `{...s}` 总产新对象而通知;唯一
  `vault:changed load→clear` 不直接 update 由其后 closeMissingFileTabs 兜住。**省一个 Store 前,先证明每条变更
  路径都搭车了一次 state.set,否则按钮态会 stale**。③ **平台默认键冲突时,prime directive(复刻 Obsidian)优先于
  既有自创键**——`Mod+Alt+←/→` 被 Geode 自创的 focus-pane 占着,而 Obsidian 官方给 navigate;解法 = navigate 拿
  canonical 键、focus-pane 降级为无默认键(命令保留可自绑)。WebSearch 官方确认键位 + grep 全仓确认无双绑后再动。
  **延续 R35/R36:** split 不复制导航历史(评审证实=行为偏差非缺陷)记入「已知偏差」;mode 恢复 + forward 栈 purge
  两个证伪硬化成 E2E 断言。**12 finding → 0 确认缺陷**:契约先行 + 逐分支镜像 + 对齐 R36 已审模式让本轮零返工。
- **R36（标签页快捷键）核心教训三条**：① **桌面探针可驱动「store / 纯函数」层,但不可驱动「React-effect /
  live-view」层——命令注册也在不可驱动一侧**。R36 探针初版断言 `app.commands.execute("app:next-tab")` +
  `app.commands.list()` 含 13 命令 → 桌面实测 **cmdCount=0、execute 不切 tab**:根因 = App.tsx 在 `useEffect`
  里注册命令,**后台 WKWebView 不绘制 → React effect 不跑 → 命令从不注册**(= R34「`editor:*` 命令始终未
  注册」同一 App Nap §D)。**但 `app.workspace.cycleActiveTab/reopen` 等是纯 store 调用、不经 effect → 桌面
  探针能真实驱动**(比 R34/R35 只能验纯函数更强)。沉淀分界线:**store/纯函数 → 桌面探针可验;React-effect/CM
  view/命令注册 → 交浏览器 E2E(前台真渲染)**。② **凡新增「持相对路径的内存会话态」,in-place 切库清单上必加
  一笔**。`recentlyClosed` 漏清 → 切库后 `Mod+Shift+T` 打开**新库里同名的无关文件**(`closeMissingFileTabs` 的
  `exists()` 守卫恰好放行新库同名路径)。现有代码本就为此清了 `lastActiveFile`(注释「same-named files would
  silently collide」),新栈照抄。修法 = Workspace 订阅 `vault:changed` reason `"load"` 反应式清空(镜像
  `DocumentManager` 句柄失效;反应式留 core、覆盖所有切库路径,优于 App.tsx 单点)。③ **平台差异键位先查官方
  docs、再用 R32 `Ctrl`/`Mod`/`Meta` 四态体系精确表达,别想当然 mac=Cmd**。next/prev-tab 官方在**两平台都是
  字面 `Ctrl+Tab`**(`Cmd+Tab` 是 macOS 应用切换器)——靠 R32 区分字面 `Ctrl` 与 `Mod` 直接表达,`matchParsedHotkey`
  四态全等保证 mac 下 `Cmd+Tab` 绝不误触 `Ctrl+Tab` 绑定。**对抗评审「证伪≠无价值」延续 R35:** 三处 purge/remap
  钩子 + Mod+T/Shift+T 真键虽行为正确但原零覆盖 → 硬化成 8 条新断言(含「删 `sub` 不误伤 `subextra.md`」字节级前缀边界)。
- **R35（括号/引号自动配对 + 选区包裹）核心教训三条**：① **复用 CM 内置（`closeBrackets()`）前先实测它的默认
  集 + 与既有补全源的协同点**——CM `closeBrackets()` 默认括号集 `( [ { ' "` 恰好 = Obsidian「Auto pair
  brackets」（零配置即对齐），且引号有自带 quote-before-word 守卫（`don't` 不配对、行首 `'`→`''`，实测锁住）。
  **最高风险 = `[` 配对撞 wikilink `]]`**：敲 `[[` 得 `[[]]`（CM `before` 集含 `]`），但 wikilink source 既有
  `sliceDoc(to,to+2)==="]]"?"":"]]"` 守卫已防双补、`anchor=+2` 落到既存 `]]` 后——**未改 wikilink 源一字**。
  **字面键入 `[[Note]]` 仍得 `[[Note]]`**（`]]` 由 type-over 吸收手敲闭合括号）——这解释了**为何 closeBrackets
  上线后 r23–r34 所有 `[[` 键入断言零回退**（手敲的闭合括号被 type-over 吃掉，doc 不变）。凡引入 CM input-level
  扩展，先想清它与既有补全/装饰源在「同一串字符」上的交互，再用既有守卫协作而非各补一遍。② **括号配对 vs
  markdown 强调符包裹是两套机制，职责切死**：括号/引号交 CM `closeBrackets()`（well-tested，含 type-over /
  Backspace 删配对 / 选区包裹）；markdown 强调符 `* _ \` ~ = $` 选区包裹自写 `core/bracketWrap.ts` 纯函数
  （字符集与括号不相交，`Prec.high` inputHandler 先行确定性）。**markdown 包裹仅非空选区触发、保留内层选区 →
  additive**（`*sel*`→`**sel**`，连按累积 `** ~~ == $$`）；**空选区刻意不配对**（避让行首 `* ` 列表 / 围栏 /
  CJK——Obsidian 此处自身有 bug 报告，候选池 #④ 明列形态本就是「选中包裹」）。纯决策放 core（镜像 R33
  `format.ts`/R28）→ `__geodeBrackets` 探针可单测，**桌面探针首次能驱动配对真值**（pure fn 无需 live view，
  不同于 R34 search 必须 live view → 桌面只能验 present+error-free）。③ **对抗评审「证伪 ≠ 无价值」——把「未测
  但行为正确」的有效观察硬化成断言**：5 维 5 finding 全证伪，但其中 apostrophe-in-contraction 与 line-start 引号
  虽属 CM 正确行为、原 E2E 未覆盖 → **补 2 条断言**（don't 不配对 / `'`→`''`）把「未测」转「已测」。另 2 个保真度
  观察（空选区不配对 / closeBrackets 不按代码块上下文门控）记为**已知限制**（刻意偏离 / 保真 gap，非缺陷）。
- **R34（编辑器内查找/替换）核心教训三条**：① **功能依赖 live CM view 时，桌面探针根本无法驱动**
  ——本轮首次遇到，实测发现**后台 WKWebView 不绘制 → React effect 永不执行** → EditorPane 建 view 的
  effect 与 App 注册命令的 effect 都不跑（探针实测 `.cm-content` 始终缺席、`editor:*` 命令始终未注册，
  **即便 System Events 把窗口 foreground 也无效**）。这正是 data-safety §D「App Nap」的根因，也解释了
  **为何历轮桌面探针从不驱动 live view、只测 main.tsx 同步装的纯 hook**（`__geodeFormat`/`__geodeHotkey`）。
  结论：**凡功能依赖 live CM view → 桌面探针只能验「探针嵌入真二进制 + 启动不崩」，功能真值交浏览器
  E2E（真实聚焦 view）**。别再试图在后台桌面窗口里 openFile+驱动编辑器。② **`window.__geode*` 写类探针
  必须复刻命令层的写守卫**——`installSearchProbe` 初版裸用 `getActiveView()`（闩锁会陈旧），评审指出经
  `__geodeSearch.replaceAll` 可能写错文件 → 加 `active.path===getActiveFile()` 双侧门控（镜像
  `getActiveFileEditorView`）。探针是生产全局、不是测试专用，别因「只是探针」就免掉 R23 DS-1 门控。
  ③ **复用 CM 内置（search/searchKeymap）的两个协同点**：(a) 开命令走 app 命令层（Mod+F），靠 R33
  `Prec.highest` 拦截器先处理、searchKeymap 自身 Mod-f 无害遮蔽——别两边都绑成双开；(b) **CM 查找框在
  `keyup` 提交 query → E2E 必须 `keyboard.type` 真键入，`page.fill` 不触发、高亮测 0 假绿**（R34 抓获）。
  另：CM `replaceAll` 对 invalid query（空查询）会 fall through 到 openSearchPanel 而非 no-op，探针需自守。
- **R33（Markdown 格式化命令）核心教训三条**：① **编辑器内的命令热键必须在 CM 输入处理链的
  最高优先级拦截，不能只靠 window 冒泡**——原生 contenteditable 会在冒泡到 window 之前改 DOM/选区。
  实测：选 `[0,5]`"Hello" 按 **Cmd+B 干净包裹**，但 **Cmd+I 把整行斜体**（原生先把选区扩成整行）；
  `commands.execute("editor:toggle-italic")` 直接调却正确 → 锁定是**键盘投递**不是命令逻辑（逐层
  探针：capture 阶段选区仍 `[0,5]`、window 冒泡时已 `[0,11]`）。修复 = `cmExtensions` 加
  `Prec.highest(EditorView.domEventHandlers({keydown: e => app.commands.handleKeydown(e)}))`，在真选区上、
  CM keymap/原生动作之前处理；命中即 `preventDefault`+`stopPropagation` 防 window 二次触发。**「某修饰键
  碰巧没事」≠「都没事」，每个修饰键都要在真编辑器里敲一遍**（R31「先在运行的编辑器里敲一遍」复现）。
  ② **把「每次 keydown 都过 handleKeydown」必加 `isComposing`+`defaultPrevented` 两道守卫**——前者保护
  IME 合成（CJK 高频，zh 用户）、后者防 CM「更新中延迟派发」次序下的双触发；加在 `commands.ts`
  handleKeydown 顶部、只在「合成中/已被占用」短路，不影响正常命中。③ **纯变换放 `core/format.ts`
  （R28 教训）**：`main.tsx` 的 `__geodeFormat` 探针要 import 它，放 feature 就成 bootstrap→feature
  耦合；命令层与探针共用 `applyFormatOp` 单一真值。**强调符歧义守卫**：`toggleWrap` 的 marker 仅当「该位
  续字符≠同强调符」才算成对，故 `*`（斜体）不从 `**`（粗体）抠星、`**` 不误吞 `***`——pure-correctness
  评审专设此维（A 段 26 例 probe 全锁）。格式化**零新 vault 写路径**（走 CM 事务→autosave，活动文件门控
  fail-safe），但仍触发 data-safety skill：B 类写守卫全继承、唯一要点是 `getActiveFileEditorView` 双侧门控。
- **R32（macOS Cmd/Mod 修饰键）核心教训三条**：① **`Mod` 必须升为一等修饰符 + 「四态全等」
  比对**——旧码把 `Mod` collapse 成 `Ctrl`、丢了平台语义。正确 = canonical 保留 `Mod`/`Ctrl`/`Meta`
  三者各异，match 时按平台解析（mac `Mod`→metaKey、其余 `Mod`→ctrlKey），且**逐一全等比
  `metaKey/ctrlKey/shiftKey/altKey` 四态**。四态全等是两件事的关键：mac 下 `Ctrl+P` 自然不触发
  `Mod+P`（needCtrl=false 但 e.ctrlKey=true → 不匹配 = 镜像 Obsidian），**且** 编辑器 Cmd+C/V/X/A/Z
  绝不被命令层误吞（不匹配任何 `Mod+*` → `handleKeydown` 返 false → 事件流向 CM/浏览器）。删
  `if(e.metaKey) return false` 后务必核：无任何默认键是 `Mod+C/V/X/A/Z`。② **双平台分支用「纯函数
  显式收 isMac + always-on 探针」做确定性双测**——host 恒是 mac，真实按键测不到非 mac 分支 → 把平台
  作显式入参（`matchParsedHotkey(p,e,isMac)`/`formatHotkey(h,isMac)`）+ `window.__geodeHotkey` 探针
  暴露 → **单 mac 二进制同帧验 mac 与非 mac 两分支**（镜像 R31 `__geodeSlash` 纯 gate / 单一真值
  思路）。③ **环境坑：改前端不改 Rust → `cargo build --release` 可能 0.4s「假完成」却不重嵌资产**
  ——Tauri `generate_context!` 编译期读 dist，`.rs` 源未变 cargo 不重编、嵌入资产陈旧。修复 =
  `touch src-tauri/src/main.rs` 强制重编；**唯一可靠校验 = 跑 probe**（`strings 二进制|grep` 因
  brotli 压缩恒 0，绝非有效校验，新旧二进制都是 0）。

- **原生差距全景调研轮（2026-06-13，R31 末，零代码）核心三条**：① **实际测试胜过静态扫描**
  ——explorer 静态 grep `insertNewlineContinueMarkup` 查不到 → 误报「列表续行缺失」，但 dev :1420
  实测 `- item`+Enter→`- item\n- `、`1. a`→`2.` **均工作**（来自 `markdown()` 打包的 `markdownKeymap`，
  `cmExtensions.ts:314` 注释明示）。**凡断言「某 CM 行为缺失」，先在运行的编辑器里敲一遍再写**——
  库内置功能常打包在 `lang-xxx().support` 内、按名 grep 抓不到。② **头号缺口 = macOS Cmd 不通**
  （实测 Ctrl+P 开面板、**Cmd+P 无反应**）：`core/commands.ts:97/255/287` 三处 `if(e.metaKey) return false`、
  Mod 写死=Ctrl；编辑器 `defaultKeymap` 经 CM 把 Mod→Cmd（Cmd+A/Z 可用）**与 app 命令层割裂**——
  这是 R32 首项。③ **缺口分两根轴**：OBSIDIAN-COMPAT 缺口表 = **插件 API 面**；ROADMAP 候选池 =
  **原生功能面**。本轮产物（21 项 R32+ 候选池）落 ROADMAP；OBSIDIAN-COMPAT 仅加一条调研纪录、
  插件缺口表不动。另：格式化快捷键（Cmd-B/I/K）、括号自动配对（closeBrackets）、编辑器内查找
  （Cmd-F，`@codemirror/search` 已装未接）三项亦实测确认缺失。
- **R31（斜杠命令 `/` 菜单）核心教训三条**：① **分层：复用「补全/建议」前先确认它在哪层**——
  R6 `EditorSuggest` 在 `compat/obsidian/suggest.ts`（给外部 Obsidian 插件的 API shim），而
  **features 绝不 import compat**。原生 `[[` wikilink 补全走的是另一套 = CM6
  `@codemirror/autocomplete`（`cmExtensions.ts`，core/features 可 import `@codemirror/*`）。
  **要在编辑器里加内置补全/建议菜单 = 追加一个 CM6 `CompletionSource` 进 `autocompletion override`
  数组，不是 compat EditorSuggest。** ② **CM6 autocomplete：`filter:false` 必须配「无 `validFor`」**——
  `validFor` 是"token 仍匹配就 reuse 结果、别重查源"的优化；叠加 `filter:false`（CM 不自己过滤）
  → 列表在打开那刻**冻结**，键入不收窄。自定义 fuzzy 排序源要实时重排就**别给 validFor**（CM 每键
  重跑源）。**且：测增量过滤必须逐键带 delay（> CM 100ms 去抖）——`keyboard.type` 一次性快打只查
  一次源、全 query 一次到位，会把"冻结"bug 测成假绿**（C1 正是这样漏过初版 E2E、被对抗评审实测抓获）。
  ③ **「两触发上下文互斥」断言要验"容器内含触发字符"的嵌套**——slash 门控 `(^|\s)/` 看似与 `[[`
  wikilink 互斥，但 `[[foo /bar`（链接文本含空格再跟 `/`）两源同帧 co-fire 出坏菜单。守卫 = 未闭合
  `[[`（`lastIndexOf("[[")>lastIndexOf("]]")`）则 slash 不触发。**纯逻辑 gate（`slashTrigger`）源与
  探针共用 = 单一真值、桌面可测。**
- **R30（Properties 侧栏视图）核心教训两条**：① **「旧标识须消失」类 post-rewrite 断言遇
  case-only 改名必须短路**——全局属性改名 `Author`→`author` 时，post-rewrite 断言
  `hasVisibleKey(rewritten, from)`（大小写不敏感）会把合法的小写键误判成「旧键残留」→ throw
  → **每个文件落 skip、整轮报 noop**（C1 critical，对抗评审抓获，静态 + E2E 双证）。Obsidian
  **支持** case-only 属性改名，故这是行为缺失。修复 = 仅 `from.toLowerCase()!==to.toLowerCase()`
  才跑该检查（`to`-visible 检查已证成功，builder 撞名守卫已防重复）。**凡「改名/移动后旧名须不
  再存在」的断言，case-only 变更是天然反例——大小写不敏感的存在性检查会把成功误判成失败。**
  ② **全库批量写 = R16/R24 verified-rewrite 纪律的逐字复刻，一道都不能省**：读 fresh（开着的
  文件读 buffer 否则 `vault.readFresh`，**绝不 cache**——watcher 防抖窗口让 cache 陈旧）、每写前
  post-rewrite 复解析断言（never blind-write）、per-file try/catch skip+report 不毒化队列、module
  `runTail` 串行化（两并发改名共享文件会 read→write 交错互删）、**绝不手写 YAML 恒走
  `buildRenameProperty`**、计数仅写成功后自增；评审专设「逐行对照 `linkRewrite.ts`」一维。新增
  写路径**继承 `vault.modify` 的 FNV 自写指纹抑回声 + `applyExternalEdits` 的 canonical/buffer
  一致守卫**（B 类写清单全继承）。`metadata.getPropertyKeyCounts` 用**独立缓存字段**（不 clobber
  `getPropertyKeys` 的 `propertyKeysCache`）按 revision 失效；面板默认折叠用 `Set.has`（非
  `?? true`，R24 教训）；值 datalist 用 index-based id（key 可含空格，非法作 id/`list=`）。
- **R29（折叠持久化 + 阅读视图折叠）核心教训三条**：① **reading 类 CSS 别挂裸
  `.markdown-rendered` / `.preview-content`——这俩被 hover 预览卡片复用**（HoverPreview.tsx
  的卡片 className = `hover-preview-content preview-content markdown-preview-view
  markdown-rendered`，连 compat `MarkdownRenderer` 也用 `.markdown-rendered`）。标题折叠
  样式初版挂 `.markdown-rendered :is(h1..h6)` → hover 卡片标题平白得 `cursor:pointer`+死
  chevron（点击委托 gated 在编辑器 `previewContentRef.contains`，卡片里点了没反应）。**修复 =
  收窄到 `.markdown-reading-view`**（仅编辑器阅读窗外层 wrapper EditorPane.tsx:739；hover/
  compat/export 均无此类）。**「仅编辑器阅读窗」选择器 = `.markdown-reading-view`，不是
  `.preview-content`/`.markdown-rendered`。** ② **折叠是 view-only 装饰、不碰 doc——这是
  R29 数据安全的根本**：恢复在 mount 派 `foldEffect`（**无 docChanged**）→ autosave 在
  documents.ts:86 `if(!update.docChanged) return` 早退、不标 dirty、绝不写 .md；持久化只进
  localStorage（**零新 vault 写路径，B 类写清单全免**）。捕获 ViewPlugin 的 `destroy()` 同步
  flush 是 preview↔editor / tab 关闭两丢失点的关键（live↔source 已靠 base-list
  `markdownFolding` 在 EditorState 内保留）。③ **CM 折叠区间 ↔ Obsidian 行号双投影**：存盘
  镜像 Obsidian `{folds:[{from,to}], lines}`（0-based 行），`foldInfoFromState` 字符→行
  （`doc.lineAt(c).number-1`）、`foldRangesFromInfo` 行→字符（`doc.line(n+1).to`）；回投务必
  加 **整数/非负 + 越界守卫**（`loadFoldInfo` 只校验 `typeof number`，篡改的负/小数 `from`
  会让 `doc.line()` 抛 RangeError 中断 mount effect）——fail-safe 方向：丢折叠态不抛、不丢
  内容。阅读视图标题折叠 = 纯运行时 DOM toggle（`nextElementSibling` 遍历至下个同/更高级
  标题，嵌套子标题独立保持折叠），**本轮不持久化**（与编辑器共享 FoldInfo 需给 heading emit
  `data-line` = 改 markdown.ts 字节管线，显式延期）。
- **R28（文件树拖拽移动）核心教训两条**：① **凡浏览器 `MemoryVaultAdapter` 与 Tauri
  Rust 后端都实现的写操作，fail-safe 守卫必须两端对齐**——`MemoryVaultAdapter.rename`
  原本盲写覆盖目标，而 Rust `vault_rename` 有 `to.exists()` 守卫（main.rs:243）→ 外部
  watcher 在拖拽渲染窗口内把同名文件投进落点时，浏览器有极窄盲写丢数据窗口、桌面被 Rust
  兜住（浏览器 E2E 全绿却在真实并发下能丢）。修复 = 给 Memory adapter 加等价 `to.exists`
  throw。**评审专设这一维：Memory↔Rust 双 adapter 的守卫对账**（R24「首字节门控」、本轮
  「to.exists」都是这类——一端有守卫另一端必须镜像）。② **「纯接线轮」= 复用既有写咽喉、
  绝不新增写路径**：移动只新增「落点解析 + 四守卫」纯逻辑决定**是否**调
  `renameWithLinkUpdate`（R16），字节写全部继承 R16 的 verified rewrite + skip 不盲写——
  这是本轮数据安全的根本保证（B 类 checklist 全继承、无新写）。**纯决策核心放 core 而非
  feature**：初版导出在 `Explorer.tsx`，但 main.tsx 探针要 import 它就成了全仓唯一一处
  bootstrap→feature 耦合（其余探针都 import core）→ 迁入 `core/explorerMove.ts`，feature
  与探针共享单一真值、零跨层耦合。**DnD Chromium 纪律**沿用 R3：`draggable` 行 + onDragStart
  里 `setTimeout(0)` 再 setState（同帧 setState 取消拖拽）+ 容器级 dragover 读
  `closest('.explorer-item')` 集中解析落点（免每行挂 handler）。
- **R27（书签 Bookmarks）核心教训三条**：① **「先删后插」的树变更，删除会让目标路径
  本身漂移**——`move()` 把顶层项移入「位于其后」的 group 时，`removeAtPath(from)` 使该
  group 前移一位、`toGroup` 仍指旧位 → `insertInto` 找不到 group 静默 no-op、**被移动项
  被删却没重插＝数据丢失**（E2E 抓获、静态评审漏网）。修复=移除后按移除深度 `depth`
  调 `toGroup[depth]--`（当它经由 `fromIndex` 之后的同级兄弟下降）。**任何 move/reorder
  务必把「移入靠后兄弟」这条验进 E2E**。② **要给外部/Obsidian 插件 onload 看见的
  `window.__geode*` 探针/钩子，必须装在 `plugins.loadExternal` 之前**（桌面 probe 抓获：
  探针主机原放 boot 末尾、晚于 loadExternal → 探针插件 onload 同步读到 undefined →
  `bm.reload` 抛错；与 `__geodeRename`/`__geodeHover`/`__geodeRenderMarkdown` 同位即可）。
  ③ **subpath 两侧约定不一致＝「存了书签点了不跳」**：bookmarks.json 的 heading/block
  `subpath` 是 **Obsidian 形状带前导 `#`**（`#Heading`/`#^id`），而 `resolveSubpath` 要
  **去 `#`**（block 以裸 `^` 判别）——创建侧（命令）存 `#…`、导航侧（面板 activate）
  先 `.replace(/^#/,"")` 再 resolve。**写 `.obsidian/*.json` 一律镜像 `properties.ts`
  序列化 RMW**：重读磁盘只换目标键、保留未知顶层键 + 逐项 `_extra`、malformed abort 不
  覆盖、vault 切换 adapter 身份守卫——这是「绝不毁 Obsidian 数据」的咽喉点（R27 桌面
  probe 8/8 实测真实 fs 跨写保真）。已知限制：文件改名/删除不联动更新书签路径（导航
  no-op 不毁内容）、search 书签不注入 query、block 仅收已有 `^id`、折叠态不持久化、
  `app.internalPlugins` bookmarks instance API 未做（均记 ROADMAP 余项/缺口表）。
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
