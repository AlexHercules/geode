# Geode — Claude 开发指南

Geode = Obsidian 复刻的本地优先 Markdown 知识库。
**Tauri 2 (Rust 壳) + React 18 + TypeScript(strict) + Vite + CodeMirror 6**。
当前 v0.66.0 · 开发机 macOS（本仓库路径即开发路径）· 远端 `github AlexHercules/geode`（私有, 分支 `opus` → `origin/opus`）。
核心使命：复刻 Obsidian 核心体验，本地优先 / 键盘优先 / 插件可拓展；商业主轴 = **Obsidian 插件生态一键迁移**（兼容层 shim 分 Tier）。详见 `docs/ROADMAP.md`「核心使命」。

---

## 🤖 自主开发契约（最重要 — 默认全自主）

用户的唯一输入是 **「继续开发」**（或 `/continue`）。收到它就**自主跑完一整轮**，全程**不要反问做哪一项、要不要这样、方案 A 还是 B**——目标清晰（复刻 Obsidian），由你全权决策。

- **自主范围**：选下一项（按 ROADMAP 候选池既定顺序）、技术方案与取舍、契约设计、缺陷修复、文档更新、对照 Obsidian 官方校准（`docs.obsidian.md` / `obsidian.d.ts`，自己 WebFetch，不需用户参与）。
- **遇到不确定**：默认「选最贴近 Obsidian 行为的方案，做下去，并在收尾报告里记一句」，而不是停下来问。
- **🛑 唯一必须停下来征得用户同意的硬边界**（不可逆 / 外向 / 毁数据）：
  1. 发布、渠道、证书、**Authenticode / minisign 签名**，或任何向**已装机用户**推送更新的动作；
  2. 动 `.tauri-keys/` 私钥（**私钥未找回**，见下方风险）；
  3. 删除或重写用户**真实 vault** 数据（`.calibration/*` 测试夹具不算）；
  4. `git push --force`、改写历史、删远端分支；
  5. 引入**新的运行时依赖**（候选池各项默认零新依赖）。
- 除以上五条，一律**自己决定、继续往前**。质量不靠人审，靠 §对抗评审 + data-safety skill + 双端实测 + 回归套件 兜住。

收尾后报告本轮成果 + 列出下一项，**停下等用户再敲「继续」**（用户口径：不着急一口气做完，逐项推进）。若用户说「连做 N 项 / 做到候选池清空」才连续多轮。

---

## 开场（用户的标准指令 =「阅读 handoff，继续开发」）

1. 读 `docs/HANDOFF.md` 顶部 **▶ START HERE** 区 = **单一续接入口**（当前状态 + 下一项 + 契约位置）。再扫本文件铁律、`docs/ROADMAP.md` 末候选池；其余按下方「文档地图」**只读相关章节**。
2. 直接执行 `/continue` 自主整轮，**不要问用户做哪一项**（仅 §自主开发契约 5 条硬边界才停下）。
3. **每轮收尾必须撰写文档** = 循环闭合的强制环节：刷新 HANDOFF 的 START HERE 状态 + 追加根因教训、ROADMAP 出队、ARCHITECTURE As-built、OBSIDIAN-COMPAT 矩阵，再提交 push。**漏写会被 Stop hook 拦下、本轮结束不了**（这样下次「阅读 handoff」才不会续到过时状态）。详见 `/continue` Step 6。

---

## 四条底线（每轮不可回退，违反 = 本轮未完成）

1. **数据安全**：任何路径下用户编辑不丢失（自动保存防抖、关窗 flush、重命名/删除/外部修改竞态全覆盖）。改 editor/vault/markdown 必触发 **data-safety skill** 回归。
2. **构建常绿**：`npm run typecheck`（TS strict）0 错误 + `cargo check` 通过 + 生产构建成功，才算完成。
3. **双端可验证**：浏览器模式（MemoryVaultAdapter）跑 E2E + 桌面端实测真实文件系统（probe 插件方案）。
4. **契约先行**：跨模块接口先冻结进 `docs/ARCHITECTURE.md`「Round XX additions」节，再并行开发。

## 分层铁律（违反即返工）

```
core/      纯 TS，无 React 组件（仅 store.ts/i18n.ts 含 hook）；可 import @codemirror/*；绝不 import features/app/compat
app/       shell（App.tsx/AppContext/icons）；import core + feature 入口 + compat(仅 bootstrap)
features/  一目录一 feature；只 import core + app/AppContext + app/icons；【绝不】import 别的 feature；【绝不】import compat
plugins/   内置插件；只 import core
compat/    Obsidian 兼容层；只 import core；自包含；features 绝不 import 它
```
别名 `@core/* @features/* @app/* @compat/*`。**颜色一律走 CSS 变量**（错误色 = `--danger`，绝不硬编码）。**UI 字符串一律 `t()/useI18n()`**（键放对应命名空间的 `core/i18n/dict.*.ts`）。

## 验证顺序（不可跳过 · 不可口头声称完成）

```
typecheck → 浏览器 E2E → 桌面 probe → cargo check / build
```
- typecheck：`npm run typecheck`（必须 0 错误，不用 `any`/`@ts-ignore` 绕过）
- 浏览器 E2E：dev server `npm run dev`（:1420，后台直跑）→ `node .calibration/r24-e2e.mjs` 等套件；`data-testid` 全覆盖；curl 探活加 `--noproxy '*'`
- 桌面 probe：裸二进制 `src-tauri/target/release/geode <vault绝对路径>` + `<vault>/.geode/plugins/*.js` probe（**WKWebView 无 CDP**），结果写回文件、外部读判定
- cargo / build：跑前必须前缀 `PATH="$HOME/.cargo/bin:$PATH"`（否则 tauri build 报 "failed to run cargo metadata" 且可能假装 exit 0）

> 改 `core/markdown.ts`（阅读视图管线）前：**先重建 `.calibration/r18-diff` 字节级套件再跑**（本机尚未重建）。细则全在 **data-safety skill**。

## ⚠️ 风险（每轮提醒，直到用户拍板）

`.tauri-keys/` minisign 更新签名**私钥未找回** → 丢失 = 永远无法向已装机用户推更新。原 Windows 机或其备份里应该还有。**不主动启动签名/发布**（属硬边界，须用户确认）。

## 环境口径（macOS 开发机）

- dev server 后台直跑即可（本机无 tmux/hook）；curl 加 `--noproxy '*'`。
- `.calibration/` 用**独立 `package.json`**：**必须先写 package.json 再 `npm i`**（裸装会向上爬污染仓库根，已踩坑）。
- cargo 命令前缀 `PATH="$HOME/.cargo/bin:$PATH"`。
- macOS 无 `.app/.dmg`（NSIS 是 Windows 配置）→ 桌面验证用裸二进制 `./geode <vault>`。
- **桌面 probe 时序纪律**：后台启动 app 的 webview 在 t≈10s 后 setTimeout/写 promise 可能不归来（App Nap）→ 断言放加载后前几秒、进度用 fire-and-forget 写链、挂载断言查 `plugins.sidebarPanels` Store 而非 DOM。详见 data-safety skill。

## 文档地图（按需进入「具体章节」，**勿全文通读**）

| 你要做的事 | 读哪里 |
|---|---|
| 选下一项 / 看四条底线 / 历轮记录 | `docs/ROADMAP.md`（末尾候选池 = 执行队列） |
| 当前状态 / 最新教训 / 续接背景 | `docs/HANDOFF.md`「三句话背景」 |
| 分层 / 核心 API / 组件契约 | `docs/ARCHITECTURE.md` 顶部（L1–73） |
| 本轮契约（R25 悬停预览已冻结） | `docs/ARCHITECTURE.md`「Round 25 additions」节 |
| 改某历轮模块前 | `docs/ARCHITECTURE.md` 对应「Round XX additions」节 |
| 每轮节奏 / 数据安全清单 / 环境细则 | `docs/DEVELOPMENT.md` + data-safety skill |
| Obsidian 兼容 Tier 表 / 套件矩阵 / 缺口 | `docs/OBSIDIAN-COMPAT.md` |
| 发布 / 签名 / 更新链路（仅参考） | `docs/DISTRIBUTION.md` |

> `ARCHITECTURE.md` 很大（>250KB）——永远按上表只读相关节，别一次性全读，省下的上下文留给写代码。

## 执行模式与编排

**Workflow 并行 agent（独占文件所有权），非 ralph-loop。** 一整轮的编排见 **`/continue` 命令**；分工用 **`.claude/agents/`**：
- `explorer` — 只读探索、定位代码、压缩成结论回报（保持主上下文干净）
- `implementer` — 在**独占文件/目录**内实现，冻结跨区签名
- `reviewer` — 多维**对抗性**评审（自主模式的质量守门人，替代人审）

agent 行内注释**不能修订契约**——契约冲突上报 chief（= 主对话 / 用户）裁决。

## 每轮收尾必做

- 版本号**一轮三处对齐**：`package.json` + `src-tauri/tauri.conf.json` + `src/features/settings/SettingsModal.tsx` 的 `APP_VERSION`。
- commit 前缀 `feat(rXX):`；`git add` 具体文件（不用 `git add .`）；收尾 `git push`。
- 更新 `docs/ROADMAP.md`（完成记录 + 候选池出队）、`docs/ARCHITECTURE.md`（As-built 根因）、`docs/HANDOFF.md`（续接词，保持精简）、`docs/OBSIDIAN-COMPAT.md`（套件矩阵不回退）。

## 老规矩速查（动到对应处再细看 ARCHITECTURE）

命令/插件 `name` 是 thunk · live↔source 走 `modeCompartment` · frontmatter 走 `core/properties.ts` builder（绝不手写 YAML 拼接）· 模板变量走 `core/templates.ts` `expandTemplate`（单趟替换，绝不重扫替换值）· 挂载竞态用一次性消费 Store（`revealTarget`/`addPropertyRequest`/`templatePickerMode` 先例）· React 卸载清理动 `activeElement` 用 `useLayoutEffect` · mermaid 升级前复核 ARCHITECTURE R19 两坑 · R16 改写引擎五步算法动 vault/documents 前必读。
