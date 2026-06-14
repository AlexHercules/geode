---
description: 自主开发一整轮 Geode（定位→契约→并行实现→集成验证→对抗评审→双端实测→提交收尾）。用户只需敲此命令或说「继续开发」。
argument-hint: [可选：指定项 / "连做N项" / "做到候选池清空"]
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task, WebFetch
---

# /continue — Geode 自主开发轮

自主完成**一整轮** Geode 开发，全程**不向用户索取决策**（仅 CLAUDE.md §自主开发契约的 5 条硬边界例外）。
`$ARGUMENTS` 若指定了具体项或「连做 N 项 / 做到候选池清空」则照它；否则取候选池下一项。

## Step 0 · 定位
- 确保已读 `CLAUDE.md`、`docs/ROADMAP.md` 末「候选池/执行队列」、`docs/HANDOFF.md`「三句话背景」。
- 选定本轮项 = `$ARGUMENTS` 指定项，或候选池既定顺序的**下一项**。**不要问用户做哪一项。**
- 该项契约已冻结在 `ARCHITECTURE.md`「Round XX additions」（如 R25 悬停预览）→ 直接照契约执行。

## Step 1 · 契约扩展（构建常绿）
- 跨模块接口（types/events/adapter 签名 + 外壳 stub）先写进 `ARCHITECTURE.md`「Round XX additions」节并落 stub，`tsc` 保持 0 错误。
- 列**文件所有权表**：每个并行 agent 独占哪些文件/目录，冻结跨区签名。
- 现状不清就先派 `explorer` subagent 只读摸清、压缩回报，再定契约。

## Step 2 · 并行实现（独占文件）
- 按所有权表派 `implementer` subagent（可多个并行），每个**只动自己独占的文件**，不碰他人区、不改已冻结契约。
- 每个小功能点完成立即 `npm run typecheck` 自检，不攒大改动再一起测。

## Step 3 · 集成验证
- `npm run typecheck`（0 错误）→ 浏览器 dev server（:1420，后台）+ `node .calibration/rXX-e2e.mjs` 套件 → `PATH="$HOME/.cargo/bin:$PATH" cargo check` / build。
- 浏览器实测 + 截图留证。

## Step 3.5 · 简化门（gate · 评审前 · 只减不增 · clean 即通过）
> 位置铁律：**简化必须在 Step 4 对抗评审之前落地**，让 reviewer 把简化后的形态当本轮终态来审——简化被免费复审、不新增评审面、杜绝未评审上线。评审后再简化 = 逻辑关缺席，禁。
- 派 **fresh `code-simplifier` subagent**（非 implementer：实现者锚定在自己刚写的抽象上看不见自己的间接层；非只读 reviewer：其合约禁改码）；范围 = **本轮 diff ∩ Step 1 所有权表独占文件**（Step 3.5 在 Step 6 提交**前**跑，本轮改动尚未提交 → 用 `git status --short` 看工作树未提交的修改 `M` + 新增 `??` 文件，**不是** `master...HEAD`），**就地改写**。
- **唯一不变量**：一次简化合法 ⟺ 在本轮 diff 已触碰的行上产生**净负复杂度**（更少行/分支/名字/间接层）且**行为与公共契约逐字节不变**。只删/内联/合并，**绝不新增**——新抽象是 Step 1 契约决策，不在此。
- **SIMPLIFY-YES（grep/tsc 可判）**：① 死代码（本轮新增、全仓零引用 / `return`/`throw` 后不可达分支）；② 残留脚手架（`console.log` / 注释码 / `TODO(temp)` / 无断言引用的 debug `data-testid` / 一次性 probe stub）；③ 未用 param/export/import（`noUnusedLocals` + grep 确认）；④ 本轮内两处 token 级相同（modulo 重命名）、≥~8 行复制，且收敛**不需发明新公共类型**；⑤ 多余间接（纯转发参数的包装函数 / 即取即返的单次局部 / 可直接当表达式的单分支 `if` / Promise 套 Promise）；⑥ 冗余或失效注释（逐字复述代码 / 与代码矛盾的过期注释）；⑦ **类型可证**的不可能态防御（类型已证非空的 null 检查 / 穷尽 union 的 `default:` / 不会抛的 try/catch——仅类型可证才删，非凭「我觉得不会发生」）。
- **SIMPLIFY-NO / STOP（任一命中即 `git restore` 该编辑）**：① 不新增 `<2` 个**当前真实调用点**的抽象（零/单调用点 helper 是删除对象，非创造对象）；② 不新增无调用方传入的 option/param/config/泛型（单调用点单取值应内联）；③ 不改任何公共契约/测试可观测行为（导出签名 · `ARCHITECTURE.md` 冻结接口 · 命令/插件 `name` · 产出 Markdown 字节 · DOM `data-testid` · store 形状——套件或 `r18-diff` 字节快照会变即 STOP）；④ **无实测数字（profiler / `?bench=N`）不做任何性能改动**（无 `for`→`while` / 无 memo/cache / 无「少分配」/ 无算法重写；平手可读性赢）；⑤ 不为炫技重写（不把可读命令式压成密集一行；diff 须**既更小又不更难读**）；⑥ 不碰本轮 diff 之外的代码（既有 wart 是未来 ROADMAP 项，非本步职责）。
- **跳过条件（满足任一即声明 clean、直接进 Step 4，不制造工作）**：本轮 diff `<~50` 改动行或仅碰 `≤2` 文件 / 新代码是单薄包装或单调用点 / 本轮内无 `≥~8` 行 token 级重复。
- **2nd-use 抽取守卫（调和 rule-of-three）**：判别器 = **减法 vs 加法**，非计数。token 级相同两处 + 一条等价回归（`.calibration/rXX-e2e.mjs`，对齐 r55/r56/r57 例）锁 before==after = **减去重复** → 第二次即可抽；造「以后会用到」的 helper / 仅相似非相同的合并 / 单调用点泛型 = **加间接层** → 等第三个真实实例，证伪驳回。「净负 LOC + 零新导出符号」自动只放行减法。
- **重验证门**：改写后重跑 `npm run typecheck`(0 错误) + `node .calibration/rXX-e2e.mjs`（与 Step 3 同一全绿集、零快照 churn）+ `PATH="$HOME/.cargo/bin:$PATH" cargo check`；碰 editor/vault/markdown 再跑 **data-safety** 套件（含 r18-diff 字节）。**任一红 ⇒ `git restore` 本步改动 ⇒ 跳过简化，以未简化（已绿）树进 Step 4。** 逃生口使失败的简化是 no-op、永不阻塞本轮。
- **找不到 = 常态、非失败**：写一行「简化门：clean，无 ≥8 行重复 / 无死代码 / 无脚手架」即进 Step 4。**禁**「顺手」重构 / 口味重命名 / 无重复支撑的重组。若几乎每轮都「找到东西」，是本门阈值太松、本门自己即膨胀。
- 幸存（简化后）形态**原样流入 Step 4 对抗评审**。

## Step 4 · 对抗评审（替代人审 = 自主模式质量关）
- 派 `reviewer` subagent 做**多维对抗性**评审；逐条 finding 标 确认/证伪，**只修确认缺陷**，去重到根因。审的是 Step 3.5 简化后的终态形。
- 本轮改了 editor/vault/markdown → **data-safety skill** 自动触发，跑数据安全竞态清单 + 历轮根因 checklist。

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
- 版本号**三处对齐**（package.json / tauri.conf.json / SettingsModal `APP_VERSION`）。
- 提交：`feat(rXX):` 代码 + `docs(rXX):` 文档（具体文件，不用 `git add .`）→ `git push`。
- 报告用户：本轮做了什么、修了几个根因、套件状态、**简化门结果（clean / 删了 N 处死代码+冗余——「不简化」也留痕、可审计是否被滥用成 churn）**、**下一项是什么**。
- `$ARGUMENTS` 要求连做 → 回 Step 0；否则停下等用户下次「阅读 handoff，继续开发」。

## 🛑 何时必须停下问用户
仅限 CLAUDE.md 的 5 条硬边界（发布/签名/私钥 · 毁真实 vault · `push --force`/改历史 · 新运行时依赖），或契约冲突无法自裁。**其余一律自主决定、继续往前。**
