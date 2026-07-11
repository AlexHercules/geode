---
description: 自主开发一整轮 Geode（定位→契约→并行实现→集成验证→对抗评审→双端实测→提交收尾）。用户只需敲此命令或说「继续开发」。
argument-hint: [可选：指定项 / "连做N项" / "做到候选池清空"]
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task, WebFetch
---

# /continue — Geode 自主开发轮

自主完成**一整轮** Geode 开发，全程**不向用户索取决策**（仅 CLAUDE.md §自主开发契约的 5 条硬边界例外）。
`$ARGUMENTS` 若指定了具体项或「连做 N 项 / 做到候选池清空」则照它；否则取候选池下一项。

**唯一产品目标：完美复刻 Obsidian。** `/continue` 不会因 bounded 候选池枯竭而停机，也不会自动转入 Chain / AI / 云端 / 多 root / Git 等差异化路线。

## Step 0 · 定位
- 确保已读 `CLAUDE.md`、`docs/ROADMAP.md` 顶部「下一轮候选/执行队列」、`docs/HANDOFF.md` 顶部 `START HERE`。
- 运行 `gitnexus status`；索引缺失或 stale 时先 `gitnexus analyze`。用 `gitnexus query "本轮概念"` 找执行流程，关键符号再用 `gitnexus context <symbol>` 收窄；GitNexus 只辅助定位，事实仍以源码为准。
- 选定本轮项 = `$ARGUMENTS` 指定的 Obsidian 复刻项，或按下方「自动续池状态机」决定。**不要问用户做哪一项。**
- 实现项若已在 `ARCHITECTURE.md`「Round XX additions」冻结契约 → 直接照契约执行；若未冻结且属大项 → 走 Step 0.1 「大项规划轮」，不越过规划直接写代码。

### Step 0.1 · 自动续池状态机（永不因 backlog 枯竭停机）

按以下顺序且只选一种轮次类型：

1. **实现轮**：ROADMAP 顶部存在经源码复核后仍为 `partial / missing` 的可执行 Obsidian 复刻项 → 按队列取下一项。已 `done / excluded`、重复、幻影功能或只有过时文档支撑的条目不算可执行池子。
2. **大项规划轮**：下一个高优先复刻缺口是 Canvas / Bases / PDF.js / 多窗口 / Stacked tabs 等大项，且尚无已冻结契约 → **不停下问方向，本轮自动做 docs-only 规划**：核实 Obsidian 行为、当前代码起点、范围/非目标、数据契约、分轮切片、依赖/硬边界、风险与验收矩阵，把**第一个可实现切片**冻结进 `ARCHITECTURE.md`，并写回 ROADMAP/HANDOFF。下次 `/continue` 直接实现该切片。
3. **Obsidian 差距重审轮**：没有可执行项，也没有一个已明确排在队首的未规划大项 → **本轮自动做 docs-only 全面研究与对比**，不等用户再次发出「盘点」指令。必须：
   - 对照第一阶段冻结基线 + Obsidian 官方当前 Public 版本的基线漂移，以官方 help/changelog/`obsidian.d.ts` 和 `reference/` 为准；
   - 逐域核验 shell、设置、命令、菜单、核心插件、文件语义、桌面宿主、插件兼容、分发；
   - 每项只允许 `done / partial / missing / excluded`，附代码/测试/官方证据；
   - 删掉已完成、重复和过时候选，重写 ROADMAP 顶部**单一可执行队列**；
   - 若新队首是未规划大项，同轮补全其规划，或在 HANDOFF 把下一轮明确设为「大项规划轮」。

**禁止的第四分支**：因复刻池子空了就转做差异化功能。除非用户之后显式改变核心目标，E 系列不得被 `/continue` 自主取用。

> 「做到候选池清空」的连续模式：清完实现队列后最多再自动跑 **1 轮**差距重审/大项规划并补回池子，然后停下报告，避免「重审补池 → 继续清池」的无限循环。

### Step 0.2 · docs-only 重审/规划轮的执行口径

- 重审/规划轮仍是完整 round：必须有证据、自检、ROADMAP 出/入队、HANDOFF 续接和提交，不能只在对话里给结论。
- 不改产品源码，不跑与文档无关的全量 E2E/桌面 probe，不升产品版本；但要运行文档链接/Markdown 结构/相互状态的针对性自检。
- 调研事实必须追回当前代码/测试或 Obsidian 官方一手资料；不从历史 ROADMAP 反抄「似乎还没做」。
- 当轮至少更新 `docs/ROADMAP.md` + `docs/HANDOFF.md`；全面差距轮同步更新 `docs/OBSIDIAN_REPLICA_GAP_AUDIT.md`，大项规划轮同步冻结 `docs/ARCHITECTURE.md`。
- docs-only 轮完成上述调研/规划和针对性自检后，**跳过 Step 1–5 的代码实现、分档、E2E 与桌面 probe，直接进 Step 6 收尾**。不得为了让 docs-only 轮套用实现流程而制造占位代码。

## Step 1 · 契约扩展（构建常绿）
- 跨模块接口（types/events/adapter 签名 + 外壳 stub）先写进 `ARCHITECTURE.md`「Round XX additions」节并落 stub，`tsc` 保持 0 错误。
- 改公共符号、跨层接口、移动/重命名或重构前，运行 `gitnexus impact <symbol> --direction upstream --depth 3`，把受影响调用方、流程和对应回归纳入契约；同名符号用 `--file` / `--uid` 消歧。
- 列**文件所有权表**：每个并行 agent 独占哪些文件/目录，冻结跨区签名。
- 现状不清就先派 `explorer` subagent 只读摸清、压缩回报，再定契约。

## Step 2 · 并行实现（独占文件）
- 按所有权表派 `implementer` subagent（可多个并行），每个**只动自己独占的文件**，不碰他人区、不改已冻结契约。
- 每个小功能点完成立即 `npm run typecheck` 自检，不攒大改动再一起测。

## Step 3 · 集成验证
- `npm run typecheck`（0 错误）→ 浏览器 dev server（:1420，后台）+ `node .calibration/rXX-e2e.mjs` 套件 → `PATH="$HOME/.cargo/bin:$PATH" cargo check` / build。
- 浏览器实测 + 截图留证。

## Step 3.4 · 分档（diff 实测自动判 · 决定 3.5/4 力度 · 默认逻辑档、举证责任在机械档）
> 目的：让闸门力度匹配本轮**实际改动**而非一律满跑。判定在此（diff 已成形、简化门之前），**只影响 Step 3.5 与 Step 4**；Step 0–3、Step 5 双端实测、Step 6 收尾**两档完全一致**。
- 取本轮未提交 diff：`git diff --stat` + `git diff --name-only`（工作树 `M`+`??`，**非** `master...HEAD`）。
- **数据安全红线（一票否决 → 强制逻辑档）**：`git diff --name-only` 命中 `core/markdown.ts` / `core/vault*` / `core/documents*` / editor 管线 / 任何 vault·文件 IO → **逻辑档**，不再往下判（对应 CLAUDE.md 底线①）。
- **机械档 ⟺ 同时满足以下全部**（任一不满足即逻辑档——**默认逻辑档**）：
  1. 未碰数据安全面（上一条已过）；
  2. **无新逻辑**：未新增/改 `ARCHITECTURE.md` 冻结契约（导出 types/events/adapter 签名）、未新增承载逻辑的控制流（新 `if/for/while/switch` 或三元分支）、未新增/改 store action·reducer·算法；
  3. 纯属：JSX 块搬迁 / 样式 / 文案·i18n 键 / nav·IA 结构 / 图标注册 / 常量重排；
  4. 未新增 runtime 依赖、未动 Rust 壳逻辑。
- 写一行判定留痕：`分档：机械档（diff N 行/M 文件，纯 IA 搬迁，无新逻辑·未碰数据安全面）` 或 `分档：逻辑档（命中：新增 store action / 碰 markdown 管线 …）`。**判定可审计 → 防机械档被滥用成偷工。**

## Step 3.5 · 简化门（gate · 评审前 · 只减不增 · clean 即通过）
> 位置铁律：**简化必须在 Step 4 对抗评审之前落地**，让 reviewer 把简化后的形态当本轮终态来审——简化被免费复审、不新增评审面、杜绝未评审上线。评审后再简化 = 逻辑关缺席，禁。
> **分档（Step 3.4）**：**机械档跳过本步**——纯 IA 搬迁本就 0 可简化面，写一行「简化门：机械档跳过（Step 3.4）」即进 Step 4；**逻辑档照常**跑下文全部。
- 派 **fresh `code-simplifier` subagent**（非 implementer：实现者锚定在自己刚写的抽象上看不见自己的间接层；非只读 reviewer：其合约禁改码）；范围 = **本轮 diff ∩ Step 1 所有权表独占文件**（Step 3.5 在 Step 6 提交**前**跑，本轮改动尚未提交 → 用 `git status --short` 看工作树未提交的修改 `M` + 新增 `??` 文件，**不是** `master...HEAD`），**就地改写**。
- **唯一不变量**：一次简化合法 ⟺ 在本轮 diff 已触碰的行上产生**净负复杂度**（更少行/分支/名字/间接层）且**行为与公共契约逐字节不变**。只删/内联/合并，**绝不新增**——新抽象是 Step 1 契约决策，不在此。
- **SIMPLIFY-YES（grep/tsc 可判）**：① 死代码（本轮新增、全仓零引用 / `return`/`throw` 后不可达分支）；② 残留脚手架（`console.log` / 注释码 / `TODO(temp)` / 无断言引用的 debug `data-testid` / 一次性 probe stub）；③ 未用 param/export/import（`noUnusedLocals` + grep 确认）；④ 本轮内两处 token 级相同（modulo 重命名）、≥~8 行复制，且收敛**不需发明新公共类型**；⑤ 多余间接（纯转发参数的包装函数 / 即取即返的单次局部 / 可直接当表达式的单分支 `if` / Promise 套 Promise）；⑥ 冗余或失效注释（逐字复述代码 / 与代码矛盾的过期注释）；⑦ **类型可证**的不可能态防御（类型已证非空的 null 检查 / 穷尽 union 的 `default:` / 不会抛的 try/catch——仅类型可证才删，非凭「我觉得不会发生」）。
- **SIMPLIFY-NO / STOP（任一命中即 `git restore` 该编辑）**：① 不新增 `<2` 个**当前真实调用点**的抽象（零/单调用点 helper 是删除对象，非创造对象）；② 不新增无调用方传入的 option/param/config/泛型（单调用点单取值应内联）；③ 不改任何公共契约/测试可观测行为（导出签名 · `ARCHITECTURE.md` 冻结接口 · 命令/插件 `name` · 产出 Markdown 字节 · DOM `data-testid` · store 形状——套件或 `r18-diff` 字节快照会变即 STOP）；④ **无实测数字（profiler / `?bench=N`）不做任何性能改动**（无 `for`→`while` / 无 memo/cache / 无「少分配」/ 无算法重写；平手可读性赢）；⑤ 不为炫技重写（不把可读命令式压成密集一行；diff 须**既更小又不更难读**）；⑥ 不碰本轮 diff 之外的代码（既有 wart 是未来 ROADMAP 项，非本步职责）。
- **跳过条件（满足任一即声明 clean、直接进 Step 4，不制造工作）**：本轮 diff `<~50` 改动行或仅碰 `≤2` 文件 / 新代码是单薄包装或单调用点 / 本轮内无 `≥~8` 行 token 级重复。
- **2nd-use 抽取守卫（调和 rule-of-three）**：判别器 = **减法 vs 加法**，非计数。token 级相同两处 + 一条等价回归（`.calibration/rXX-e2e.mjs`，对齐 r55/r56/r57 例）锁 before==after = **减去重复** → 第二次即可抽；造「以后会用到」的 helper / 仅相似非相同的合并 / 单调用点泛型 = **加间接层** → 等第三个真实实例，证伪驳回。「净负 LOC + 零新导出符号」自动只放行减法。
- **重验证门**：改写后重跑 `npm run typecheck`(0 错误) + `node .calibration/rXX-e2e.mjs`（与 Step 3 同一全绿集、零快照 churn）+ `PATH="$HOME/.cargo/bin:$PATH" cargo check`；碰 editor/vault/markdown 再跑 **data-safety** 套件（含 r18-diff 字节）。**任一红 ⇒ `git restore` 本步改动 ⇒ 跳过简化，以未简化（已绿）树进 Step 4。** 逃生口使失败的简化是 no-op、永不阻塞本轮。
- **找不到 = 常态、非失败**：写一行「简化门：clean，无 ≥8 行重复 / 无死代码 / 无脚手架」即进 Step 4。**禁**「顺手」重构 / 口味重命名 / 无重复支撑的重组。若几乎每轮都「找到东西」，是本门阈值太松、本门自己即膨胀。
- 幸存（简化后）形态**原样流入 Step 4 对抗评审**。

## Step 4 · 评审（替代人审 = 自主模式质量关 · 力度随 Step 3.4 分档）
- 评审前运行 `gitnexus detect-changes --scope all`，把 affected processes / risk level 交给 reviewer；它是遗漏扫描，不替代 diff、测试或 data-safety。
- **逻辑档 → 多维对抗评审（满跑）**：派 `reviewer` subagent 做**多维对抗性**评审；逐条 finding 标 确认/证伪，**只修确认缺陷**，去重到根因。审的是 Step 3.5 简化后的终态形。
- **机械档 → scoped review（窄域）**：派 `reviewer` 只审本轮 diff 的**残留风险面** = automated 套件覆盖不到、却正是搬迁高发的盲区：① 迁移控件的 `data-testid`/绑定/默认值逐一保留（对照 Step 1 控件清单）；② 新增 nav·控件的图标**已注册**（非 fallback 到 `file-text`）；③ 新引用的 i18n 键在 `dict.*` **真实存在**（非键名直显）；④ 搬迁后无重复/遗漏 `testid`。**不做全维对抗扫描**（纯 IA 重排无新逻辑面值得对抗）；逐条确认/证伪，只修确认缺陷。
- 本轮改了 editor/vault/markdown → 已被 Step 3.4 强制为逻辑档 → **data-safety skill** 自动触发，跑数据安全竞态清单 + 历轮根因 checklist。

## Step 5 · 双端实测
- 浏览器 E2E 全绿；桌面裸二进制 `./src-tauri/target/release/geode <vault>` + probe 插件自检（遵守 App Nap 时序纪律，见 data-safety skill §D）。
- OBSIDIAN-COMPAT 套件矩阵**不回退**。

## Step 6 · 收尾（写文档 = 循环闭合，不可省）
> **Stop hook 会强制把关**：有未提交改动、或代码改了却没更新 `docs/HANDOFF.md`，本轮**结束不了**。文档必须写全、改动必须提交，循环才闭合（下次「阅读 handoff」才能续上）。
- **撰写交付文档**：
  - `docs/HANDOFF.md`：刷新顶部 **START HERE** 区（版本 / 上一轮 / 下一项+契约位置 / 待拍板项）+ 把本轮根因教训追加到「三句话背景」。
  - `docs/ROADMAP.md`：完成记录 + 候选池出队。
  - `docs/ARCHITECTURE.md`：本轮 As-built（根因修复记录）。
  - `docs/OBSIDIAN-COMPAT.md`：套件矩阵不回退。
- **实现轮**：版本号三处对齐（package.json / tauri.conf.json / SettingsModal `APP_VERSION`）；提交 `feat(rXX):` 代码 + `docs(rXX):` 文档。
- **docs-only 差距重审/大项规划轮**：不升产品版本，提交 `docs(rXX): audit ...` 或 `docs(rXX): plan ...`。
- 两类都只 `git add` 具体文件（不用 `git add .`）→ `git push`。
- 提交完成后运行 `gitnexus analyze` 增量刷新索引，再用 `gitnexus status` 确认下一轮不会读取 stale graph（`.gitnexus/` 已忽略，不进提交）。
- 报告用户：本轮做了什么、**下一项是什么**。实现轮同时报分档、根因、套件状态和简化门；docs-only 轮改报为**轮次类型（差距重审/大项规划）+证据范围+清理/新增了哪些候选+文档自检结果**，不伪造机械/逻辑分档或 E2E 结果。
- `$ARGUMENTS` 要求连做 → 回 Step 0（但遵守 Step 0.1 「清池后最多一轮重审/规划」的无限循环保护）；否则停下等用户下次「阅读 handoff，继续开发」。

## 🛑 何时必须停下问用户
仅限 CLAUDE.md 的 5 条硬边界（发布/签名/私钥 · 毁真实 vault · `push --force`/改历史 · 新运行时依赖），或契约冲突无法自裁。**其余一律自主决定、继续往前。**
