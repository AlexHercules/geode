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

## Step 4 · 对抗评审（替代人审 = 自主模式质量关）
- 派 `reviewer` subagent 做**多维对抗性**评审；逐条 finding 标 确认/证伪，**只修确认缺陷**，去重到根因。
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
- 报告用户：本轮做了什么、修了几个根因、套件状态、**下一项是什么**。
- `$ARGUMENTS` 要求连做 → 回 Step 0；否则停下等用户下次「阅读 handoff，继续开发」。

## 🛑 何时必须停下问用户
仅限 CLAUDE.md 的 5 条硬边界（发布/签名/私钥 · 毁真实 vault · `push --force`/改历史 · 新运行时依赖），或契约冲突无法自裁。**其余一律自主决定、继续往前。**
