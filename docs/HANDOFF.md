# Geode HANDOFF — 续接入口

> ▶ **START HERE**｜你的标准指令就是「**阅读 handoff，继续开发**」。读完本区直接执行 `/continue`，**不要问用户做哪一项**（仅 CLAUDE.md §自主开发契约 5 条硬边界才停下问）。

### ① 当前状态（每轮收尾**必须**刷新这几行）

- 版本 **v0.53.0**｜分支 `opus` → `origin/opus`（收尾 `git push`）｜开发机 macOS（本仓库路径）
- 上一轮：**R53 Unique note creator（唯一笔记 / Zettelkasten）✓ 已交付**（R32+ 候选池第四梯队 **#㉑** 小众核心插件）。新 `core/uniqueNote.ts`（镜像 `core/dailyNote.ts` R48）+ `plugins/unique-note.ts`：`unique-note:create` 命令建一篇**时间戳命名**（默认 `YYYYMMDDHHmmss`）的新笔记，放可配置文件夹（默认 vault root，与 daily 回落具名文件夹不同）、可选模板、建后打开。`uniqueNoteName/PathPreview` 纯函数；`effFolder` traversal/dot 段回落 root；`createUniqueNote` = createFolder → await content → **collision-retry 循环**（`vault.uniquePath`→`vault.create`，reject 且文件已存在=竞态→重算后缀重试）。SettingsModal 3 字段 + `__geodeUnique` 探针 + i18n（cmd/plugin/settings，en+zh）。**零新依赖、无 Rust**。`r53-e2e` **11/11**（5 纯变换 + 5 live create[含同 tick 竞态] + 1 设置 UI）+ 桌面 `r53-probe` **6/6** + 回归 r48/r50/r44/r24 不回退。**评审 1 真缺陷（minor）修 / 11 证伪**：同 tick 双触发原只建一篇（`create_new` 拒后静默打开第一篇）→ collision-retry 拿 `X 1.md` + 补 Promise.all 竞态回归断言。data-safety：路径穿越被 assertSafeRelPath(JS)+Rust safe_join+create_new 三层拦死。**scope 记一句**：原定 #⑧ stacked tabs，探明真 Obsidian 版=内容级 cascade（需多 EditorPane 挂载，大轮）→ 改取确定一轮干净交付的 #㉑。
- **下一项 = R53→R54**。⚠️ **候选池「零依赖小加性轮」基本清空**——后续多为更大/更硬的项。**建议（Step 0 自选，按可一轮干净交付排序）**：① **#⑱ Setext 标题 live 样式**（`text\n===`/`text\n---` 下划线标题 live 无样式无折叠点）——CodeMirror ViewPlugin + line decoration 检测「非空行紧跟全 `=`/`-` 行」，**单子项、零依赖、可一轮**（其余 #⑱ 长尾[live 表格 / 跨行 `$$`·`%%` / mermaid live]需块级 StateField，更硬）；② 余下 **#㉑ 小插件**中较清爽的（Footnotes view 面板 / Format converter 纯转换，零依赖）。**🛑 需用户拍板/专门大轮（勿自动启动）**：#⑧ stacked tabs（内容级 cascade，多 EditorPane）/ #⑯ pop-out 弹出窗口 / #⑰ Canvas 白板（均「远期大工程」）/ #⑮ OS deep-link（新 crate=硬边界#5）。其余：#⑭ schema 桥接。**因小项将尽，宜在报告里向用户点明：剩余项多为大轮，可由用户指定优先级。** 全队列见 ROADMAP R32+ 候选池。
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

- **R53（Unique note creator）核心教训三条**：① **接候选池一项前先核「这项的真实实现规模」——explorer 给的可行性评估可能低估「忠实复刻」的代价**。本轮原定 #⑧ stacked tabs，explorer 说「加 `PaneLeaf.stacked` 字段 + 竖排 CSS = 低复杂度」；但真正的 Obsidian stacked tabs = **内容级横向 cascade**（同时挂载所有 tab 的窗格、横向滚动），Geode 当前只渲染 active tab 内容 → 忠实版要同时挂多个 EditorPane（大改 + 多编辑器 data-safety）。「加个字段 + CSS」只能做出**不忠实的竖排 tab 条**。**「每轮跑完整一轮 + 选最贴近 Obsidian 的方案」두个约束撞上「半成品」时,正确做法是换一个能一轮干净交付的忠实项,并把 scope 判断写进文档**（而非硬塞半成品或让一轮跨多 tick）。② **镜像一个成熟模块（dailyNote）时,差异点要显式想清楚、别无脑照抄**——unique note 的 `effFolder` 默认是 `""`(vault root,Obsidian 同款),而 dailyNote 回落具名 "Daily Notes";若无脑抄 dailyNote 的「坏值回落具名文件夹」就错了。**镜像 = 抄结构 + 逐字段问「这个默认/守卫对新场景成立吗」**（R45「复用序列化审全字段」同源）。③ **「每次都建新」语义的命令,`uniquePath`(读内存索引) + `await`(让出 microtask) + `create` 之间有同 tick 竞态窗口**——两次同 tick 触发都在对方 create 落盘前算出同一 free path,输家 create 被 `create_new` 拒（**绝不覆盖=数据安全可靠**),但 catch 里见「文件已存在」就静默打开第一篇 → 用户以为建了两篇实际一篇。**修 = create 在「reject 且文件已存在」时重算 uniquePath 重试**（拿 `X 1.md`),而非把竞态 reject 当「race 已存在直接 open」。**凡『总是新建』的写命令,测试必加 `Promise.all` 同 tick 双触发断言**(顺序 `await` 之间留 wait 的用例测不到竞态——本轮 E2E B 段一度因此漏过)。data-safety 正面收获:路径穿越(format/folder 嵌 `..`)被 `assertSafeRelPath`(JS)+Rust `safe_join`+`create_new` 三层拦死,评审 11 证伪里穿越/覆盖全安全——**新写路径的价值多在「证伪攻击面」**。
- **R52（编辑命令补全 II）核心教训三条**：① **「把 CM 命令命名化」前先按 `Command` vs `StateCommand` 分类——只有 StateCommand 能被纯变换探针驱动**。`moveLineUp`/`toggleComment`/`indentMore`/`selectLine`/`insertBlankLine` 是 `StateCommand`（`(target:{state,dispatch})=>bool`，可在一次性 `EditorState` 上跑、桌面 probe 可驱动）；但 `deleteLine` 是 `Command`（`(view:EditorView)=>bool`，内部调 `view.moveVertically` 等**只有真实 view 才有**的方法）→ 在 throwaway `{state,dispatch}` 上跑直接 `TypeError`。**接命令前先 grep `.d.ts` 看它声明的是 `Command` 还是 `StateCommand`**：StateCommand 走 R51/R52 探针范式全自动可验证，Command 类只能 live E2E 测、或干脆排除（deleteLine 这种 Obsidian 也无默认命令的直接弃）。**用一个 5 行 derisk 脚本（import @codemirror/* 在 node 里直接跑）提前把每个候选命令的真实行为 + 类型打出来**，比写完整套件再发现 TypeError 省一大圈。② **复用一个命令依赖「语言数据」时,要把语言数据一并配上——`toggleComment` 没 commentTokens 就静默 no-op**。markdown 语言**自身不定义 commentTokens**（HTML 注释是 markdown-it 阅读层的事，CM 语言层没配）→ 直接接 toggleComment 会「命令注册成功、按下去什么都不发生」=最坑的静默失败。修 = cmExtensions 加 `markdownLanguage.data.of({ commentTokens: { block: { open: "%%", close: "%%" } } })`（顺带选了 Obsidian 的 `%%` 注释语法而非 CM 默认会落空的 HTML 注释）。**接任何依赖 `languageDataAt`（commentTokens/indentUnit/closeBrackets…）的 CM 命令,先确认当前语言栈真配了那项数据,否则补上**。③ **探针返回值要覆盖命令的全部可观测效果——只看 doc 会漏掉「只改选区」的命令**。`selectLine` 不改 doc 只改 selection；若探针/E2E 只比对 `doc.toString()`,这条命令永远「绿」但其实没验证到任何东西。`__geodeEdit.runEdit` 改成返回 `{doc, from, to}`（捕获 `tr.state.selection.main`）→ selectLine 断言 `from,to=2,4` 才真正有效。**一个命令的「效果」= doc ∪ selection ∪ scroll…,探针/断言要对准它实际改的那一维,别默认 doc 是唯一真值**。
- **R51（移动行/复制行命令）核心教训三条**：① **接一个 feature 前先查「底层框架是否已经给了」——价值可能在「命名化/可发现/可重绑」而非「实现行为」**。CM `defaultKeymap` 早已绑 `Alt-Arrow`→move/`Shift-Alt-Arrow`→copy,移动行**今天就能用**;本轮真正的产出是把它们暴露成 palette 可搜、可重绑的**命名命令**（Obsidian 同款）。**别假设「Obsidian 有而我没有」就等于「零实现」——先在现有 keymap/扩展里实测一遍**,否则会重造已存在的轮子或误判工作量。② **命名命令与 defaultKeymap 同键时,靠拦截器的「先到先得 + 吃掉事件」消歧,不是靠避开键位**。cmExtensions 的 `Prec.highest` `handleKeydown`(L431) 跑在 `keymap.of([...defaultKeymap])`(L448) **之前**,匹配即 `preventDefault`+`stopPropagation`+`return true` → CM 停止派发 → defaultKeymap 同键**不再触发** = 单次。所以「命名命令复用 defaultKeymap 的键」是安全的、且去掉了「两套键做同一件事」的冗余。**评审一度担心「命名命令的键反被 defaultKeymap 抢先」——拦截器顺序证伪它**;用真实 `page.keyboard.press("Alt+ArrowUp")` 断言落点恰好一次 move 把这条焊死成回归。③ **键位选「编辑器通用约定」优先于「我以为的 Obsidian 默认」,且避开 OS 原生组合**。初版选了 `Mod+Shift+Arrow`,但 mac 上 `Cmd+Shift+↑`=原生「选到文档头」,会被遮蔽;改 `Alt+Arrow`(move)/`Shift+Alt+Arrow`(copy) 对齐 CM/VS Code/Sublime/Obsidian-CM6 通用约定,既消冗余又不抢 OS 键。**对抗评审「0 真缺陷」不等于「无可改进」——它点名的两处非缺陷（覆盖盲点 + 键位偏差）值得本轮顺手硬化,别因为「没确认缺陷」就原样放行**。
- **R50（Appearance 设置）核心教训两条**：① **「把写死值改成 CSS 变量」要 grep 全 css 找同语义的所有实例**——readable-line cap 散在 `.cm-content`(cmExtensions)/`.preview-content`/`.editor-loading`/reading-view `.properties-panel` 四处 46em,B 改了三处漏了 properties-panel,评审抓出（同 R48「纵深防御扫同族全入口」、R49「容错读不能被写路径复用」同源——**一类东西散在多处时,改一处=漏其余,先 grep 穷举**）。② **E2E 测试间有共享状态（活动文件/模式）时,改动前序断言会污染后续**——我新加的 properties 测试把活动文件切到 preview 模式,破了后续依赖 `.cm-content`(live 编辑器)的 spellcheck 段;**插入新断言后,把会话状态恢复到后续断言的前置（重开 live 编辑器）**,或把新断言放在序列末尾。
- **R49（文件恢复快照 · 数据安全相关轮）核心教训三条**：① **「容错读」不能被「写路径」复用**——`readList` 对坏 JSON 回空对**展示**安全,但 record 的 RMW 复用它,「读容忍」就变「写破坏」（空 list 覆盖丢快照历史）。**写路径必须 STRICT-parse 拒覆盖 malformed,只有读/展示路径才容错**——这是 R45/R27 早立的「坏 JSON 拒写」契约,新数据安全模块（哪怕自称「bookmarks precedent」）必须把那层守卫一并抄齐（与 R47「复用引擎复用全部消费契约」、R48「纵深防御扫同族全入口」**第三次**同源反复——凡新写 `.obsidian/`/`.geode/` 配置 RMW,先问「坏 JSON 我会不会覆盖」）。② **「读当前→写回」类操作（restore/merge）一律先 `flushAll`**——脏 buffer 的未保存编辑必须先落盘+捕获,否则覆盖丢编辑 + buffer 反噬写回结果（R47 merge、R49 restore 同根;`restoreSnapshot` 加 `documents` 依赖 + flush）。③ **节流/去抖的「窗口推进」绑成功不绑尝试**——`lastSnapTs` 置位绑「写成功」而非「同步尝试」,失败才可重试;副作用标记（throttle/dedup）的更新点 = 操作真正生效点,否则一次失败毒化后续。**附带**:候选池第三梯队整块功能已大幅清空,剩 #⑯ pop-out/#⑰ canvas「远期大工程」需用户拍板——若 /continue 续到这里且用户没拍板,优先做第四梯队小项（#⑲ 已选/#⑳）或 stacked-linked,别擅自启大工程。
- **R48（可配置日记设置）核心教训三条**：① **「配置化一个写死值」要把消费侧的规整一起补**——`effFolder` 抄了 `templateFolder` 的「RAW 存 + trim 消费」却漏了它的 strip-slash/validateDir,用户输尾斜杠 "Daily Notes/" 就出双斜杠路径;**镜像一个设置范式,要连它的消费侧规整（strip/validate/default-on-bad）一起抄,不只抄存储**。② **纵深防御补一处要扫同族全部入口**——R46 给 `Vault.create`/`createBinary` 加了 `assertSafeRelPath`,`createFolder` 是同族写路径却漏补,R48 配置文件夹（`..`）一来就暴露双端分歧;**加一道 core 守卫时 grep 同族所有写入口（create/createFolder/createBinary/write/modify/rename）一并对齐**（与 R43「修一类根因全命令面扫同类」、R47「复用引擎复用全部消费契约」同源,反复出现）。③ **把纯函数改成读全局 Store 的重构,用既有回归套件给「行为应不变」兜底**——`dailyStamp`/`parseDailyStamp` 从纯函数（手写 padStart + 正则）改为读设置 + moment strict parse,靠 r43-e2e 22 / r43-probe 13 全绿证明 R43 的 over-match 守卫（嵌入数字/带日期父目录/非法日期→null）被 moment strict 完整保住——**重构「应等价」的代码,既有套件就是等价性证明,先跑它再说**。
- **R47（笔记合并 · 数据安全关键轮）核心教训四条**：① **复用既有引擎要复用它的「全部消费契约」,不只是核心逻辑**——merge 复用了 R16 的 verified rewrite,却漏了 R16 所有调用方都遵守的「读 `result.skipped` 并告警」契约（Explorer/AllProperties/Backlinks 都做、merge 漏）→ source trash 后悬空链用户毫不知情。**接一个返回「部分失败报告」的 API,必须把报告消费掉**（数据安全「非静默损坏」底线）。② **fire-and-forget promise 链必须 `.catch`**——`void p.then(...)` 吞 rejection 成 unhandledrejection、用户零反馈;凡 UI 触发的 async 副作用都要 catch + 可见反馈。③ **「读后写」的读要走 live buffer 不走磁盘**——`flushAll` 可能失败（锁定/只读编辑器）,之后 `readFresh` 读到 flush 前旧字节,合并+删源 = 丢未保存编辑;**buffer 是真值,`documents.get()?.getText() ?? readFresh()` 是 linkRewrite 早有的范式,merge 该一开始就抄**。④ **一次性 Store「mount 消费」防「已挂载不 remount」**——命令置 store + `openModal`,若 modal 已是该值则组件不 remount、consume effect 不触发、store 泄漏 → 下次开意外触发;命令侧加 `if (already-open) return`。**附带**:frozen 引擎加 `{move}` 选项做 merge 复用是对的（r28/r24/r42/r44 回归证明没破 rename）——**给冻结的 data-safety 引擎加可选参数 + 全路径回归,比新写一遍 capture→verify→splice 安全得多**（避开了「镜像 R16 漏抄断言」的陷阱）。
- **R46（obsidian:// URI 深链）核心教训三条**：① **`obsidian://open` ≠ wikilink 点击**——复用 `openWikilink` 顺手继承了它「resolve 不到就 create」的语义,但 URI 的 `open` 必须只开既有（Obsidian 口径 + 不可信外部输入不该建文件）→ `open` 分支先 `resolveLink===null → return false` gate。**复用一个带副作用的 helper 前,先问它的副作用是否属于新调用方的语义**（R45「复用序列化审全字段」同源）。② **纵深防御放核心、别只放边界**——路径穿越只被 Rust IPC 边界 `safe_join` 挡,Memory adapter 无守卫,一来新写路径（URI handler）就双端分歧 → 把路径安全契约下沉到 `core/Vault.create`（`assertSafeRelPath` 拒空/绝对/`..`/控制符）,所有 adapter + 所有 caller 自动继承。③ **`??` vs `||` 对用户输入 fallback**——`a ?? b` 只在 null/undefined 落 b,present-but-empty `""` 会遮蔽 b;「首个非空者胜」用 `||`。**附带（R44 重犯）**:数值控制符范围 `[ -]` 经 Write/Edit 易落成裸 NUL/US 字节（破 grep/diff,本轮 bash grep 在改完后竟整段失灵疑似与此有关）→ **用 `ch.charCodeAt(0) < 0x20` charCode 扫描,绝不在源码写控制符 regex 范围**。安全轮的价值多在「证伪」:12 finding 7 证伪（穿越/SEC-1/scheme/search 全安全），确认的 5 条都是 robustness 而非漏洞——**对抗评审证伪攻击面 = 真实的安全背书**。
- **R45（保存的工作区布局）核心教训三条**：① **复用既有序列化要审「全字段语义」**——`captureLayout` 抄 `persist()` 的 `{...state, modal:null}`,顺手把 `theme`/`fontSize` 也存进了工作区,但工作区**只该存布局**（外观是全局）→ 载入工作区会改主题/字号且与 DOM 脱钩。复制一个状态快照时**逐字段问「这字段属于这次快照的语义吗」**（modal=session 已排除,theme/fontSize=全局外观漏了）。② **结构性改 state 树后要走既有 reconcile 惯例**——Workspace 所有「丢/换 tab」方法（close/reconcile-with-vault）后面都跟 `pruneTabHistory`+`purgeNavLocations`+`emitActiveFile`（剪 session 历史 + 刷新 lastActiveFile/派生面板）;`applyLayout` 是新的结构变更入口,**漏走这套 → 反链/大纲陈旧 + nav 历史残留串台**。改 state 树的新方法都对照既有 close 方法补齐 reconcile。③ **「逐字镜像 X」要连可观测性一起镜像**——只镜像了 bookmarks 的 RMW 守卫、漏了它的 try/catch+warn,导致「拒写保护用户文件」触发时反而最该有的诊断日志没了。镜像一个范式=连它的日志/错误处理一起抄。**附带**:赛前自审会误判（我预判 applyLayout 缺 flush 为缺陷,对抗评审证伪——EditorPane unmount 已 flush）→ **等评审「证伪」结果再批量修,别抢修未确认项**。
- **R44（Note composer 提取选区）核心教训三条**：① **引入 `await` 就引入重入窗口**——同步命令（formatCommands read→transform→dispatch）的绝对 offset 永远有效,但本轮 create-before-edit 的 `await vault.create`（桌面端是跨进程 IPC,毫秒级,编辑器无 readonly 守卫）期间用户/IME 可改文档 → await 前捕获的 `main.from/to` 变陈旧 → 用旧 offset dispatch 会**静默删错位置=数据损坏**(或越界 RangeError)。**修 = await 后、写前复验捕获跨度**（`doc.sliceString(from,to)===selected` 乐观锁文本指纹,不符则保留新笔记[无害重复]+不删源）——这是 R16 splice-verification、R23「await 后视图重校验」的**反复出现的同根**,凡「读快照→await→按快照写」必加这道复验。② **「用户文本→文件名」是对抗输入重灾区**:`sanitizeNoteName` 一个看似简单的纯函数藏 3 个 edge——`". ."` 去首点后塌成 `"."` 生成坏名 `"..md"`+坏链 `"[[.]]"`（要去**首尾**点）、C0 控制符（NUL/BEL,`\s` 不覆盖非空白控制符）泄漏（用 `\p{Cc}` 剥）、超长/CJK 超 255 字节文件名上限 ENAMETOOLONG（按 UTF-8 边界裁 ≤200 字节）。凡此类函数,评审必设 控制符/点/长度/元字符 四维对抗。③ **删 belt-and-braces 防御前先想清它防什么**——我为去源文件里的裸控制字节,直接删了 ILLEGAL_RE 的控制范围,却漏了「非空白控制符仍需剥离」,**正确做法是换等价干净写法（`\p{Cc}`）而非直接删防御**。
- **R43（日记日历 + 前后日导航）核心教训三条**：① **修一类数据安全根因要全命令面扫同类**——R17 评审硬化了
  `vault_write_binary` 的 check-then-act（`create_new` 原子）,但普通 `vault_create` 当年漏网;直到 R43 日历把它摆上热路径
  （Mod+D / 点日历高频 create）评审才揪出同款 TOCTOU 截断窗口。**历史薄弱根因会被新功能「重新激活」;改一处原子写时,grep 全部
  `fs::write`/`exists()`-then-write 同类命令一并硬化。** ② **正则抽日期必锚定到 basename**——`parseDailyStamp` 对整 path 跑
  `/(\d{4})-(\d{2})-(\d{2})/` → 父目录日期（`2020-01-01-backup/2026-06-14.md`→2020）、5 位年（`12025-06-14`→2025）、嵌入数字全
  over-match;契约写「从 basename 抽」实现却跑整 path = **注释与实现脱节**的经典坑。取 `slice(lastIndexOf("/")+1)` + `^…$` 锚定。
  ③ **「是不是日记」与「在哪个文件夹」是两件正交事**——next/prev 导航基准只认 `DAILY_FOLDER` 下的真日记,加 `isDailyNotePath`
  **双门控**（文件夹前缀 + 文件名形态）,否则任意带日期名的文件都会劫持基准、静默把用户从其文件夹「拽」回 Daily Notes。
  对抗评审「证伪≠无价值」再验证:9 finding 8 真（全 minor,无 critical/major）——小功能的缺陷密度也不低,find→verify 值回票价。
- **R42（回收站 .trash · 数据安全关键轮）核心教训三条**：① **改 vault IO 操作必须双 adapter（Memory + Tauri）+ 三类
  实体（files/folders/binaryFiles）全覆盖**——B 初版 Memory.trash 只处理 files/folders,漏 binaryFiles → 浏览器删图片附件
  静默 throw(桌面 Rust fs::rename 不挑内容、没漏)。文件夹递归也漏 binaryFiles 子项 → listTree 复活孤儿文件夹。**凡动
  Memory adapter 的文件操作,先列全 files/folders/binaryFiles 三个 Map,确保每个都处理(文件分支 + 文件夹递归两处)**。
  ② **"恢复/创建"一个文件夹时,emit 的事件必须能让 metadata 递归重索引子项**——restoreFromTrash 初版 emit `file:created`,
  但 metadata 的 reindexFile 对非 `.md` 路径早退 → 恢复文件夹后子笔记的 backlinks/graph/search 全失效。改 emit `file:renamed`
  (metadata 对文件夹走 reindexFolder 递归;且 `file:renamed` 事件本身不改写链接文本——改写在显式 renameWithLinkUpdate)。
  **emit 文件夹级事件前,查 metadata 对该事件的 文件 vs 文件夹 分支处理,别让文件夹路径掉进只认 `.md` 的早退**。
  ③ **数据安全轮的最强验证 = 探针在真二进制后用 Node fs 直读磁盘**——r42-probe 不只查 app 内 store 真值,更让 Node 脚本读
  `<vault>/.trash/` 确认删除文件物理移过去、内容字节保留、restore 回原位。**「删除可恢复」这种底线,要在真 fs 上眼见为实,
  不能只信 app 内 API**。**18 finding → 5 修复**:3 major 全在「Memory adapter binary 覆盖 / 文件夹事件重索引」,核心 trash
  逻辑(Rust + 双端对称)零缺陷——契约先行 + data-safety skill 全清单 + 真 fs 探针让数据安全轮稳落地。
- **R41（标签面板 + `#` 补全）核心教训三条**：① **「首次直接消费某个既有索引 API 的 keys」会暴露该索引一直容忍的脏数据**
  ——`getTagMap()` 一直把 frontmatter `tags: ["#","bad space"]` 的空串/带空格键收进来(行内 tag 因 TAG_RE 的 `+` 永不脏,
  无人注意),R41 的标签面板/补全首次直接 `[...keys()]` 消费 → 空名行 + `#bad space` 畸形补全。根因修在**索引层**(parseNote
  过滤),而非各消费点防御。**消费一个老 API 的原始输出前,先想它的所有数据来源会不会塞进非法值**。② **CM 补全源故意省
  validFor → 每键重跑 → 调的索引 API 必须有缓存**:`getTagMap` 原每键全库重建+sort(兄弟 `getPropertyKeys` 早有 revision
  缓存,唯它漏),补全热路径退化。加 revision 缓存(返回缓存 Map,消费方只读——同 getPropertyKeyCounts 口径)。**把一个 O(库)
  函数挂到「每键」热路径前,先确认它有 revision/版本缓存**。③ **同一识别规则散在多处(索引 / 装饰 / 补全)必须用同一正则
  gate**:`#tag` 的前导 gate 在 metadata 索引+装饰是 `(^|[\s(])`、补全初版写成 `(^|\s)` → `(#tag` 被索引却不弹补全。对齐到
  同一 gate。**复制一个正则去新场景时,grep 同概念的其它正则,对齐字符类/gate,别让"识别"与"补全/装饰"漂移**(CJK 字符类
  `一-鿿` 三处同步是正面例子)。**19 finding → 3 确认修复全在「消费老索引暴露脏数据 / 热路径缓存 / 多正则漂移」三类边角**:
  核心补全+面板逻辑(镜像 R31/R30)零缺陷,印证「复用成熟基建缺陷面极小」。
- **R40（键盘切换复选框）核心教训三条**：① **「翻转既有 X」的正则别把状态类写死成已知集**——`toggle-task` 的
  `TASK_BOX_RE` 初版只认 `[ xX]`,导致 Obsidian 自定义复选框态 `[/]`/`[-]`/`[>]` 落进「非任务→新建复选框」分支,prepend 出
  畸形双方框 `- [ ] [/] x`(无效 markdown + 非幂等)。3 个 reviewer 一致命中。修 = 状态类放宽到 `[^\]]`(任意单字符态都识别
  为任务 → 就地翻转)+ 翻转规则「checked→空 / 其余→x」。**凡"toggle 既有 X"的逻辑,先枚举 X 的全部形态,别让未覆盖形态
  掉进"新建 X"分支产出嵌套畸形**;单字符限定 `[^\]]` 同时避免误伤 `[text]`(多字符链接标签)。② **复用成熟基建 = 缺陷面
  极小**——R40 整轮零新文件/零新探针/零新写路径(新 op 挂既有 `applyFormatOp` → `__geodeFormat` 探针自动可驱动、`Mod+L`
  走 R33 keydown 拦截器 + autosave 管线),10 个 finding 里唯一确认缺陷就在新 op 的「状态类边界」一处。**能挂既有 op-dispatch/
  命令基建的功能,优先挂上去,别另起炉灶**。③ **同一概念多处定义易漂移,记成已知 gap**——「什么算任务」在源码 toggle
  (`TASK_BOX_RE`)/阅读视图渲染(`markdown.ts TASK_RE` 要 `]\s`)/live lezer 三处定义不同;R40 toggle 比渲染宽松(`]` 后不要求
  空格),收紧反会把 `- [ ]task` 推入非任务分支致畸形,故权衡保留 + 文档化为已知 gap(理想是收敛到一处,留后续轮)。
- **R39（固定标签页）核心教训三条**：① **「复制实例」vs「移动实例」对 per-instance 状态处理相反**——`moveTab` 复用
  原 tab 对象(pinned/历史应随之迁移,对),`splitActivePane` 用 `{...srcTab, id:newTabId()}` 复制**新实例**(per-instance
  态如 pinned、导航历史**不应继承**,需显式剔除 `pinned: undefined`)。R37 漏了 split 不复制历史、R39 漏了 split 不该继承
  pin——**同根:凡 `{...tab, id:newId()}` 克隆,先问哪些字段是「这个 tab 实例独有」不该带过去**。② **加了 class hook 就得
  有 CSS 消费它,否则是死 hook、契约承诺落空**——`is-pinned` 挂上 DOM 却无 `.tab.is-pinned{}` 规则,评审 grep 出来。加视觉
  class 时同帧加规则(本轮顺势让固定 tab 的关闭 X 淡显,兼向 Obsidian 靠拢)。③ **新增字段要顺 tab 生命周期全链问「跟不跟」**
  ——pinned 在 rename/move/sanitize 都靠 `{...t}` 自动透传(对),唯 **reopen(重建新 tab)** 与 **split(复制)** 需显式处理:
  reopen 要把 pin 存进 `ClosedTab` 再恢复、split 要剔除。评审逐路径(close→reopen / rename / move / split / sanitize)核查正是
  抓这两处的方法。**openf 维 0 finding**:openFile×pin 的核心交互(显式 newTab/reuse/graph/同文件)契约先行设计周全、零缺陷;
  缺陷全在「实例克隆」「class hook」「reopen 重建」这些**生命周期边角**——延续 R38:核心逻辑稳,缺陷集中在边角,评审逐路径抓全。
- **R38（快速切换器子模式）核心教训三条**：① **「段落近似」的块 span 让同段多块共享 `from`/`to`——凡拿
  `block.from` 当 React key / 唯一标识必撞,用 `block.id`**（id 才是块身份;metadata 对重复 id 保留最后一个）。同段
  `^aaa\\n^bbb` 两块 BlockRef 坐标完全相同,原 key `b:${path}:${from}` 重复 → React「same key」警告。E2E 原夹具块都在
  独立段落故漏网 → 补「同段两块 browse 无重复 key 警告」断言（`page.on("console")` 捕获）。**凡用解析出的坐标当唯一键,
  先想清解析粒度会不会让多个实体共享坐标**。② **导出一个「看起来精确」但无人消费的值是负债**——`headingSpan.to`
  假设 `#` 后 1 空格、用 trim 后 text,对多空格/尾随空格偏短;但全仓 reveal 链只读 `reveal.from`（grep `reveal.to` 零命中）
  → `to` 既不准又没人读。与其 fabricate 一个精确感的 span,不如锚 `from`、移除 helper、把不确定性显式化。**加导出前先
  grep 谁会读它;没人读的「精确值」是误导**。③ **React 组件里的纯逻辑抽到 core 才能被探针 + E2E 单测**（R33 模式延续）:
  switcher 的 #/^ 搜索抽成 `core/switcherSearch.ts` 纯函数 → `__geodeSwitcher` 探针在真二进制驱动 + 浏览器 E2E 驱动活模态,
  两端共用单一真值。**凡「React 组件内的决策逻辑」想要双端可测,先把纯部分拎到 core**。**9 finding → 2 确认缺陷均 minor、
  E2E 补断言锁住**:契约先行 + 纯函数抽取让缺陷集中在「UI 渲染键」「导出值精度」这种边角,核心搜索/导航零缺陷。
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
