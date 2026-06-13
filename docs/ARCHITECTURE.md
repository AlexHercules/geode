# Geode Architecture Contract

Geode is an Obsidian-style local-first markdown knowledge base.
Stack: **Tauri 2 (Rust shell) + React 18 + TypeScript (strict) + Vite + CodeMirror 6**.

## Layering — who may import what

```
src/core/      pure TS, NO React components (only hooks in store.ts / i18n.ts). Never imports features/app.
               (May import @codemirror/* — the shared document model lives here.)
src/app/       shell: App.tsx layout, AppContext, icons. Imports core + feature entry components
               + compat (bootstrap wiring only).
src/features/  one folder per feature. Imports core + app/AppContext + app/icons ONLY.
               NEVER import from another feature folder. NEVER import compat.
src/plugins/   built-in plugins (GeodePlugin[]). Imports core only.
src/compat/    Obsidian plugin compatibility layer (R4+). Imports core ONLY.
               Self-contained: own CSS, own DOM helpers. Never imported by features.
```

Path aliases: `@core/*`, `@features/*`, `@app/*`, `@compat/*` (see tsconfig).

## Core API (read these files before coding)

- `core/types.ts` — all shared types. Paths are vault-relative, forward slashes.
- `core/store.ts` — `Store<T>` observable + `useStore(store)` React hook. All shared state.
- `core/events.ts` — typed `EventBus`. Events: `vault:changed`, `file:modified|created|deleted|renamed`, `metadata:updated`, `active-file:changed`, `theme:changed`.
- `core/vault.ts` — `Vault` (use this, never the adapter): `tree` store, `read/readCached/modify/create/createFolder/rename/remove`, `getFiles()/getMarkdownFiles()/fileExists/uniquePath`. Adapters: Tauri (desktop fs) & Memory (browser demo/E2E).
- `core/metadata.ts` — `MetadataIndex`: `revision` store (subscribe via `useStore` to re-render on index change), `getMetadata(path)`, `resolveLink(target, fromPath)`, `getBacklinks(path)`, `getOutgoingLinks(path)`, `getTagMap()`, `getGraph()`, plus `parseNote()` pure parser.
- `core/workspace.ts` — `Workspace`: `state` store (`WorkspaceState`), `openFile(path, {newTab})`, `openGraph()`, `closeTab/setActiveTab/setTabMode/toggleActiveTabMode`, `setLeftPanel/toggle*Sidebar`, `openModal/closeModal`, `setTheme/toggleTheme/setFontSize`, `getActiveTab()/getActiveFile()`.
- `core/commands.ts` — `CommandRegistry`: `register({id, name, hotkey?, callback})` → disposer, `execute(id)`, `list()`, `revision` store. Hotkeys handled globally by App shell. Hotkey grammar (R32): `Mod` = Cmd on macOS / Ctrl elsewhere (distinct from physical `Ctrl`/`Meta`); exports `isMacPlatform`, `parseHotkey`/`matchHotkey`/`normalizeHotkey`/`hotkeyFromEvent`, `formatHotkey(hotkey, isMac?)` (display: ⌘P on mac, Ctrl+P elsewhere), `matchParsedHotkey(p, e, isMac)` + `KeyEventLike`.
- `core/plugins.ts` — `GeodePlugin { id, name, onload(app: AppHandle), onunload? }`, `PluginManager` (`list()`, `enable/disable`, `statusBarItems` store). `AppHandle.ui.setStatusBarItem(id, text)`.

## Using app context in feature components

```tsx
import { useApp } from "@app/AppContext";
import { useStore } from "@core/store";

function MyPanel() {
  const app = useApp();                       // { vault, metadata, workspace, commands, events, plugins }
  const ws = useStore(app.workspace.state);   // re-renders on workspace change
  const rev = useStore(app.metadata.revision); // re-renders on index change
  ...
}
```

To navigate: `app.workspace.openFile(path)`. To create-from-unresolved-link:
`await app.vault.create(app.vault.uniquePath(folder, name)); app.workspace.openFile(path)`.

## Styling rules

- Use the CSS variables in `src/styles/app.css` (`--bg-panel`, `--text-muted`, `--accent`, `--border`, ...). Never hard-code colors.
- Shared classes available: `.modal-overlay` + `.modal-panel` (modals), `.panel-header` (+`.panel-actions`) for sidebar panels.
- Each feature adds its own CSS file inside its folder and imports it from its component (`import "./explorer.css"`).
- Look & feel target: Obsidian — dense, quiet, keyboard-first. 13–14px UI font, subtle hovers.
- Add `data-testid` attributes on key interactive elements (used by E2E).

## Component contracts (App.tsx imports these — keep signatures EXACTLY)

| File | Export | Props |
|---|---|---|
| `features/explorer/Explorer.tsx` | `Explorer` | none |
| `features/search/SearchPanel.tsx` | `SearchPanel` | none |
| `features/editor/EditorPane.tsx` | `EditorPane` | `{ tab: TabState }` (re-mounted per tab via key) |
| `features/graph/GraphView.tsx` | `GraphView` | none |
| `features/backlinks/BacklinksPanel.tsx` | `BacklinksPanel` | none (reads active file from workspace) |
| `features/palette/CommandPalette.tsx` | `CommandPalette` | none, renders own `.modal-overlay`; close via `app.workspace.closeModal()` |
| `features/palette/QuickSwitcher.tsx` | `QuickSwitcher` | none, same modal rules |
| `features/settings/SettingsModal.tsx` | `SettingsModal` | none, same modal rules |
| `plugins/index.ts` | `BUILTIN_PLUGINS: GeodePlugin[]` | — |

Escape key closing is handled globally by the shell; modals must ALSO close on overlay click.

## Round 40 additions — 键盘切换复选框（Toggle checkbox status, Cmd/Ctrl-L）【As-built v0.40】

> **状态：As-built（2026-06-14）。** R32+ 候选池第二梯队 #⑨ = 已核实缺口（仅鼠标点 `cm-live-checkbox`，无键命令）。
> **整套复用 R33 format 基建**：新增纯 op `toggle-task` 到 `core/format.ts`，经既有 `applyFormatOp` 接通 → 既有
> `__geodeFormat.apply` 探针**自动可驱动**（零新探针）；注册 `editor:toggle-checkbox`（`Mod+L`，Obsidian-canonical）走
> 既有 `applyFormat`→CM 事务→documents dirty→autosave（`getView` 活动文件门控 R23 DS-1）+ R33 `Prec.highest` keydown 拦截器。
> **零新 vault 写路径**（编辑器写,继承 R33 B 类守卫）+ **零新运行时依赖** + **零新文件**。校准 Obsidian「Toggle checkbox status」。
> **验证**：typecheck 0 + 浏览器 `r40-e2e` **19/19**（纯变换 15 含自定义态 + live 真 Mod+L + autosave 落盘 + 命令转换）+
> 桌面 `r40-probe` **11/11**（纯变换在真二进制）+ r32-r39 不回退 + `r26-bytes` 0 + cargo/build 绿。
> **3 维对抗评审 10 finding → 1 确认修复（含 3 reviewer 一致）+ 9 nit/by-design/证伪**（详见下）。

### 契约（冻结 + As-built）

**core/format.ts**：`FormatOp` 加 `"toggle-task"`；`applyFormatOp` 加 case（末尾补 `default: never` 穷尽断言）；新纯函数：
```ts
const TASK_BOX_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([^\]])(\])/;  // 状态 = 任意单个非 ] 字符
export function toggleTaskStatus(text, from, to): FormatEdit | null;
```
语义（逐非空行）：① 任务行 → 翻转勾选（**checked `x`/`X` → 空格;其余任意单字符态（含自定义 `[/]` `[-]` `[>]`）→ `x`** —— 就地
翻转、绝不畸形、幂等）；② 非任务行 → `<indent>- [ ] <stripListMarker(body)>`（`* foo`/`1. foo`/`foo` 皆 → `- [ ] foo`）；
③ 有非空行时空行保留;全空（光标在空行）→ `<indent>- [ ] `（缩进保留）。

**features/editor/formatCommands.ts**：`{ id:"editor:toggle-checkbox", nameKey:"cmd.toggleCheckbox", op:"toggle-task", hotkey:"Mod+L" }`。
**core/i18n/dict.app.ts**：`cmd.toggleCheckbox`（en/zh）。版本 0.39→0.40。

### As-built（评审修复 + 教训）

**1 个确认缺陷（已修，3 reviewer 一致）— 自定义复选框态产出畸形双方框**：初版 `TASK_BOX_RE` 状态类只认 `[ xX]`，对
Obsidian 自定义态 `- [/] doing`（进行中）/`[-]`（取消）/`[>]`（转交）走**非任务分支** → prepend `- [ ] ` → `- [ ] [/] doing`
（一个方框里套另一个方框,无效 markdown,且非幂等:再按 → `- [x] [/] doing`,永回不到 `[/]`）。修 = **状态类 `[ xX]`→`[^\]]`**
（任意单字符态都识别为任务 → 就地翻转）+ 翻转规则改「checked→空 / 其余→x」→ `- [/] doing`→`- [x] doing`（Obsidian 行为、
幂等、不畸形）。**单字符限定** `[^\]]` 不误伤 `[text]`（多字符）/`[]`（空）——它们仍走非任务转换。E2E + probe 补自定义态断言。

**9 个 nit/by-design/证伪**：① `- [ ]task`（`]` 后无空格）会被 toggle 但渲染层（markdown.ts `TASK_RE` 要 `]\s`）不显示复选框
——**收紧 `(?=\s|$)` 反会把它推入非任务分支致畸形,故不收紧,记为渲染-gap 边角**;② 全空多行 select-all（`\n\n` 全选）因
`lineBounds` 对「选区以尾随 `\n` 结束」的裁剪 + toggleTaskStatus「空行也转」叠加 → 两空行塌缩成一个 `- [ ] `（极端边角:仅
「对纯空行文档全选」触发;单空行/光标常规场景正确;不动共享 `lineBounds` 避免回归 R33,记为已知边角）;③ blockquote 内任务
`>  - [ ] x` 不识别（`TASK_BOX_RE` 行首不允许 `>`）→ 转换;④ `default: never` 穷尽断言已补;⑤ 注释与纯空白行实现已对齐;
其余证伪（Mod+L 无冲突 / 与 R33 `checklist` op 独立不串扰 / FormatOp 消费点全核 / 写路径继承 R33 活动文件门控）。

**根因教训**：① **「翻转既有标记」的正则别把状态类写死成已知集**——只认 `[ xX]` 导致自定义态走「新建」分支 prepend 出畸形;
状态类放宽到 `[^\]]`（单字符）让翻转对任意态成立、且不误伤多字符括号。**凡"toggle 既有 X"的逻辑,先想清 X 的全部形态,
别让未覆盖形态掉进"新建 X"分支产出嵌套畸形**。② **三套"什么算任务"的定义（源码 toggle / 阅读视图渲染 / live lezer）易漂移**
——R40 的 toggle 比渲染层宽松（`]` 后不要求空格）,记为已知 gap;理想是收敛到一处,但本轮收紧会致畸形,故权衡保留+文档化。
③ **复用成熟基建（R33 format）= 缺陷面极小**:整轮零新文件/零新探针/零新写路径,缺陷只在新 op 的「状态类边界」一处。

## Round 39 additions — 固定标签页（pinned tabs）【As-built v0.39】

> **状态：As-built（2026-06-14）。** R32+ 候选池第二梯队 #⑧ 的 **pinned-tabs 切片**（#⑧ 三子特性 = 固定/堆叠/链接面板；
> 本轮只取「固定」一个 coherent slice，stack/linked 入后续轮）。本轮 **纯 workspace store + 命令注册，零新 vault 写路径**
> （pin 只改 `TabState.pinned` 标志 + 影响 openFile 建 tab 决策，不写 `.md`）+ **零新运行时依赖** + **零新 window 探针**
> （store 操作 → 探针/E2E 直驱 `app.workspace`）。校准 Obsidian 「Pin」语义 + 双击 tab 切换固定的手势。
> **验证**：typecheck 0 + 浏览器 `r39-e2e` **17/17**（toggleTabPin + openFile-respects-pin + recordNav skip + 未固定仍替换 +
> 双击切换 UI + 命令 + **split 副本不继承 pin + reopen 恢复 pin** + reload 持久化）+ 桌面 `r39-probe` **8/8**（store 直驱真二进制）
> + r32-r38 不回退 + `r26-bytes` 0 + cargo/build 绿。**3 维对抗评审 9 finding → 3 确认修复 + 6 nit/by-design/证伪**（详见 As-built）。

### 契约（冻结）

**core/types.ts**：`TabState` 加 `pinned?: boolean`（可选,持久化;缺省 = 未固定）。

**core/workspace.ts**：
- **openFile replace 分支加守卫**：`if (active && active.viewType === "markdown" && !opts.newTab && !active.pinned)` ——
  活动 tab **已固定** → 不替换其内容，落到 new-tab 分支（= 在新 tab 打开,Obsidian Pin 行为）。reuse 分支不变（同文件已开
  仍切过去,固定与否无关）。
- **recordNavigation 同步加 `&& !active.pinned`**：固定 tab 不会被替换 → 不能把它的 location 记进导航历史（否则 phantom 记录）。
- `toggleTabPin(tabId: string)`：翻转该 tab 的 `pinned`（`this.update` + 不动 activeTabId/emitActiveFile 非必需——纯标志,
  但走 update 以持久化 + 触发 UI 重渲染）。
- `sanitizeTab`：读 `pinned`（`typeof t.pinned === "boolean" ? t.pinned : undefined`),纳入持久化往返。

**app/App.tsx**：注册 `app:toggle-pin`（`name:()=>t("cmd.togglePin")`,无默认键,`available:()=>workspace.getActiveTab()!=null`,
callback 翻转活动 tab pin）;**TabBar**：tab `onDoubleClick` → `toggleTabPin(tab.id)`（Obsidian 双击手势）;`tab.pinned` 时
className 加 `is-pinned` + 标题前渲染 `pin` 图标（指示,非按钮）。close 按钮保留（固定 tab 仍可关 = 显式偏差）。

**app/icons.tsx**：加 `pin`（Lucide）。**core/i18n/dict.app.ts**：`cmd.togglePin`（en/zh）+ `app.pinnedTab`（pin 图标 aria/title）。
**styles/app.css**：`.tab.is-pinned` 视觉（pin 图标色走变量）。版本 0.38→0.39。

**探针/E2E（无新 window 全局）**：`app.workspace.toggleTabPin` + `openFile`-respects-pin（固定活动 tab openFile 别文件 → tab 数 +1
而非替换）直驱 store 读 `getPanes()[].tabs` 真值;命令层（App-effect）交浏览器 E2E。

### 文件所有权（chief 亲自，小而集中）
- core/types.ts + core/workspace.ts + app/App.tsx + app/icons.tsx + core/i18n/dict.app.ts + styles/app.css + 3 版本 + `.calibration/r39-*`。

### 已知偏差（写给后续轮）
- **固定 tab 的关闭 X 淡显（hover 显），但仍可关闭**（R39 评审后:`.tab.is-pinned .tab-close` opacity 0.35 / hover 1，兼向 Obsidian「固定隐 X」靠拢，但不阻止关闭）。
- **固定 tab 自身的 back/forward 仍可导航**（pin 只挡「外部 openFile 替换」,不挡 tab 自己的历史回放;`navigateBack`/`setTabLocation` 直改 filePath 绕过 openFile）——Obsidian 固定更严格;本轮取最小 pin 语义。具体翻车序列见 As-built。
- **toggle 仅双击 + 命令**（无右键上下文菜单——避免引入菜单框架;双击 = Obsidian 手势）。
- **graph tab 也可被固定**（双击/命令无 viewType 守卫）——Obsidian 本就允许固定任意 tab;Geode 内 graph 永不被 openFile 替换,故固定 graph 是 inert 指示（无害,不加守卫以保持 Obsidian「任意 tab 可固定」语义）。
- **#⑧ 的 stack / linked-view 子特性未做**（入后续轮）。

### As-built（评审修复 + 教训）

**3 个确认缺陷（已修）**：① **`splitActivePane` 分屏副本继承 pinned**——`dup = {...srcTab, id:newTabId()}` 把 `pinned:true`
带进新副本（Obsidian pin 是 per-tab-instance,split 副本不继承）。修 = dup 时 `pinned: undefined`（镜像 R37「split 不复制
历史」)。② **契约承诺的 `.tab.is-pinned` CSS 缺失（死 class hook）**——初版只加 `.tab-pin`（图标 span）,`is-pinned` class 挂上
DOM 却无 CSS 消费。修 = 加 `.tab.is-pinned .tab-close{opacity:.35}` + `:hover{opacity:1}`（既兑现契约视觉,又兼向 Obsidian
「固定隐 X」靠拢）。③ **reopen 关闭的固定 tab 丢 pin**——`ClosedTab` 不存 pinned,`reopenClosedTab` 走 `openFile(newTab)` 建无
pin 的新 tab。修 = `ClosedTab` 加 `pinned?`、closeTab 捕获、reopen 后 `if(entry.pinned) toggleTabPin`。

**6 个 nit/by-design/证伪**：sanitizeTab 落地 `if(t.pinned===true)`（省 false 字段,与契约文本 `typeof==="boolean"` **行为等价**
——全仓 pinned 读取皆真值判断,false vs 缺省不可观测;旧无字段持久数据迁移安全,reload round-trip 已验）;graph 可固定（记
已知偏差,Obsidian 允许）;双击 draggable tab 真实 Chromium 照常 fire dblclick（Playwright 合成限制 → E2E 用 `dispatchEvent`
派发真 dblclick 验 handler 接通）;openFile/recordNav 加 `!active.pinned` 对现有 tab（pinned=undefined→`!undefined`=true）行为
不变（= r32-r38 不回退根因）;固定 tab 自身 back/forward 仍可移离（已记偏差,具体序列:a→b 导航后在 b 固定→back 把固定 tab
变回 a,与 pin 语义矛盾,本轮最小语义接受）。

**根因教训**：① **复制实例 vs 移动实例对「实例级状态」处理不同**——`moveTab` 复用原 tab 对象（pin 应随之迁移,对）,`split`
复制新实例（pin/历史这类 per-instance 态不应继承,需显式剔除）。R37 split-history + R39 split-pin 同根。② **契约写了
「.tab.is-pinned 视觉」就必须有 CSS 消费它,否则是死 hook**——加 class 钩子时同步加消费它的规则,别让契约承诺落空。
③ **tab 生命周期全链（close→reopen / rename / move / split / sanitize）都要问「这个新字段跟不跟」**——pinned 在 rename/move/
sanitize 都正确透传,唯 reopen（重建新 tab）+ split（复制）需显式处理,评审逐路径核查抓出这两处。

## Round 38 additions — 快速切换器子模式（Quick Switcher `#` heading / `^` block modes）【As-built v0.38】

> **状态：As-built（2026-06-14）。** R32+ 候选池第二梯队 #⑦ = 已核实缺口（QuickSwitcher 仅文件名+别名+create，
> 无 heading/block 模式）。本轮 **复用 `metadata.getAll()` 的 headings/blocks 索引 + `core/fuzzy`**，新增 `#`/`^`
> 前缀子模式;**零新 vault 写路径**（heading/block 跳转 = `openFile` + `requestReveal`，R14 reveal 机制，BookmarksPanel
> 先例）+ **零新运行时依赖**。校准 Quick Switcher++ standalone 模式（`#` 全库标题、`^` 全库块）。
> **按 R33 模式抽纯函数到 core** → 组件 / 浏览器 E2E / 桌面探针共用单一真值。
> **验证**：typecheck 0 + 浏览器 `r38-e2e` **19/19**（纯搜索 mode/heading/block + 真实模态键入 #/^ → 行 → Enter 导航 +
> create 行抑制 + browse 活动文件优先 + **block React key 同段两 ^id 不撞 key**）+ 桌面 `r38-probe` **13/13**（纯搜索在
> 真 metadata 索引 + openFile/requestReveal 导航真值）+ r32-r37 不回退 + `r26-bytes` 0 + cargo/build 绿。
> **3 维对抗评审 9 finding → 2 确认修复**（block 行 React key 同段两 `^id` 撞键 → 改用 `block.id`;`headingSpan.to`
> 不准且无消费者读取 → 移除该 helper、heading reveal 改锚 `from`）**+ 7 nit/by-design**（详见 As-built）。

### 契约（冻结）

**core/switcherSearch.ts（NEW，纯函数，已落）**：
```ts
export type SwitcherMode = "file" | "heading" | "block";
export interface HeadingHit { path: string; heading: HeadingRef; indices: number[]; score: number }
export interface BlockHit { path: string; block: BlockRef; indices: number[]; score: number }
export function switcherMode(query: string): SwitcherMode;        // 首字符 # → heading, ^ → block, 否则 file
export function stripSigil(query: string): string;                 // 去前缀 sigil + trim
export function searchHeadings(metas: NoteMetadata[], query: string, activeFile: string|null, cap?): HeadingHit[];
export function searchBlocks(metas: NoteMetadata[], query: string, activeFile: string|null, cap?): BlockHit[];
```
（`headingSpan` 在 As-built 移除——见下「评审修复」。）
语义:空 query = browse（活动文件的标题/块**优先排前**，再其余，cap 100）;非空 = `fuzzyMatch` 打分排序（heading 匹
heading.text、block 匹 block.id）。纯函数、`fuzzyMatch` 纯、`metadata.getAll()` 读已缓存 `byPath`——无副作用。

**features/palette/QuickSwitcher.tsx**：`switcherMode(query)` 选模式;Row 联合加 `heading`/`block` 两 kind;heading/block
模式调 `searchHeadings/searchBlocks(metadata.getAll(), stripSigil(query), workspace.getActiveFile())` 产行（create 行仅
file 模式）;渲染 heading 行（`hash` 图标 + fuzzy 高亮标题文本 + 文件 basename）/ block 行（`^id` + basename）;
**activate**：heading → `openFile(path)` + `requestReveal(path, h.from, h.from)`（reveal 只读 `from`，见 As-built）;
block → `openFile(path)` + `requestReveal(path, block.from, block.to)`（openFile 自带 modal:null 关闭弹窗，requestReveal
随后，EditorPane R14 消费）。

**src/main.tsx**：`window.__geodeSwitcher` 探针（loadExternal 前，闭包 metadata+workspace）:
```ts
__geodeSwitcher = {
  mode: (q) => switcherMode(q),
  headings: (q) => searchHeadings(metadata.getAll(), stripSigil(q), workspace.getActiveFile()).map(h => ({ path: h.path, text: h.heading.text, from: h.heading.from })),
  blocks: (q) => searchBlocks(metadata.getAll(), stripSigil(q), workspace.getActiveFile()).map(b => ({ path: b.path, id: b.block.id })),
};
```

**core/i18n/dict.panels.ts**：加 `switcher.placeholderHeading`/`switcher.placeholderBlock`/`switcher.emptyHeading`/
`switcher.emptyBlock`（en+zh）。**palette.css**：heading/block 行复用 `.palette-item`，加通用 `.palette-item-icon`（图标）+
`.palette-block-id`（`^id` 视觉，色走变量）。版本 0.37→0.38。

### 文件所有权（并行 implementer）
- **core/switcherSearch.ts**：已由 chief 亲自落（冻结签名）。
- **A（UI+i18n+css）**：`src/features/palette/QuickSwitcher.tsx` + `src/features/palette/palette.css` + `src/core/i18n/dict.panels.ts`。
- **B（探针+版本）**：`src/main.tsx`（`__geodeSwitcher`）+ 三处版本号。
- **C（验证，chief 亲自）**：`.calibration/r38-e2e.mjs` + `.calibration/r38-probe.mjs`。

### 已知偏差（写给后续轮）
- **`^` 块模式按 id 匹配、无文本预览**（`BlockRef` 仅存 id，不含块文本;全库文件内容未加载、逐键读太贵）——显示 `^id — file`;Obsidian 显示块文本。仅活动/已开文件理论上可取文本，为一致性统一不取。
- **全库 heading/block 索引每键 `getAll()` 迭代**（headings 可达文件数 ×N）——cap 100 限渲染;打分 O(总 headings),大库（10k+）可能数十 ms,记 `__geodePerf`。switcher 为瞬态模态、可接受。
- **模态打开期 metadata 后台变更不刷新**（query 不变则行不重算）——瞬态模态、可接受。
- **`#`/`^` 仅作前缀模式切换**（query 首字符）——文件名以 `#`/`^` 开头者无法直接搜（Obsidian 同样以 sigil 为模式）。
- **非空搜索不 boost 活动文件**（纯 score 排序，仅空 query browse 模式活动文件优先）——合本轮冻结契约;Quick Switcher++
  对键入查询给活动文件小加权,未来轮可决定是否镜像。
- **同分跨文件命中顺序非确定**（`getAll()` 按 `byPath` 插入序、8-worker 并发池按 I/O 完成序填充）——纯 `getAll()` 既有
  属性（graph/backlinks/文件名搜索共享）,非 R38 引入;文件内顺序由稳定排序保留。

### As-built（评审修复 + 教训）

**2 个确认缺陷（已修）**：① **block 行 React key 同段两 `^id` 撞键**——`core/metadata.ts` 块解析把「连续非空行整段」算一个
paragraph span,同段内两个 `^id` 标记拿到**相同 `from`/`to`（仅 id 不同）**,原 key `b:${path}:${block.from}` 重复 → React
「same key」警告 + 可能 DOM/选中态错乱（E2E 原夹具块都在独立段落故漏网）。修 = key 改用 `block.id`（文件内唯一,metadata
对重复 id 保留最后一个）→ `b:${path}:${block.id}`;补 E2E:同段 `^aaa\n^bbb` browse `^` 两行都渲染且**无重复 key 警告**
（page.on("console") 捕获）。heading 行无此问题（`HEADING_RE` matchAll 各 match index 唯一 → `from` 唯一）。② **`headingSpan.to`
不准且无消费者读取**——`to = from + level + 1 + text.length` 假设 `#` 后恰好 1 空格 + 用 trim 后 text,对 `#   多空格` / 尾随
空格偏短;但 **全仓 reveal 链只读 `reveal.from`**（`EditorPane` 滚动/锚点 + `cmExtensions` revealFlash 只携 `{from}`,grep
`reveal.to` 零命中）→ `to` 是误导性死值。修 = **移除 `headingSpan` helper,heading reveal 改 `requestReveal(path, h.from,
h.from)`**（诚实锚 `from`,行为不变;block 仍用真实 `block.from/to`,因 BlockRef.to 准确无害）。

**根因教训**：① **「段落近似」的块 span 让同段多块共享坐标——凡用 `block.from`/`to` 当唯一键必出错,用 `block.id`**（id 才是
块的身份）。② **导出一个「看起来精确」但无人消费的 span 是负债**——`requestReveal` 形参收 `(from,to)` 但 reveal 只用 `from`,
헤딩 span 的 `to` 既不准又没人读 → 与其 fabricate 不如锚 `from`、把不确定性显式化。**延续 R33 抽纯函数到 core 让 #/^ 搜索
可被探针 + E2E 单测**（9 finding 中 7 为 nit/by-design,2 确认缺陷均 minor 且 E2E 补断言锁住）。

## Round 37 additions — 前进/后退导航历史（back/forward navigation history）【As-built v0.37】

> **状态：As-built（2026-06-14）。** R32+ 候选池第二梯队 #⑥ = 已核实缺口（`workspace.ts` 仅 `lastActiveFile`，
> 无 per-pane/per-tab 导航栈）。本轮 **纯 workspace store + 命令注册，零新 vault 写路径**（导航只改 tab 的
> filePath，不写 `.md`）+ **零新运行时依赖** + **零新 window 探针**（store 操作 → 探针/E2E 直驱 `app.workspace`，
> 热键复用 R32 `__geodeHotkey.match`）。校准 Obsidian 官方默认键（`Ctrl/Cmd+Alt+←/→`，WebSearch 2026-06-14）。
> **与 R36 `recentlyClosed` 是两套独立栈**：导航历史 = 某 tab 内「显示过哪些文件」的访问序（per-tab back/forward）；
> reopen = 「关闭过哪些 tab」的关闭序。
> **验证**：typecheck 0 + 浏览器 `r37-e2e` **36/36**（tab 内 back/forward/wrap/canTabNavigate + 新导航清 forward +
> 命令层 execute + 新 tab 空历史 + **UI 按钮禁用态反映 + 真键 Mod+Alt+←/→** + rename/delete/vault-switch 清理 +
> mode 恢复 + forward 栈 purge）+ 桌面 `r37-probe` **18/18**（store 层真二进制直驱；命令层 App Nap §D 交 E2E）+
> r36 47 / r35 25 / r34 15 / r33 37 / r32 24 不回退 + `r26-bytes` 0 + cargo/build 绿。
> **3 维对抗评审 12 finding → 0 确认缺陷**（核心担忧「recordNavigation 镜像 openFile 三分支」逐分支证伪；
> 1 行为偏差记入已知偏差 + 2 证伪硬化成断言；详见 As-built）。

### 官方键位校准 + 冲突解决

| 命令 id | 名称 | 默认热键 |
|---|---|---|
| `app:navigate-back` | Navigate back | `Mod+Alt+ArrowLeft`（mac Cmd+⌥←，win/linux Ctrl+Alt+←） |
| `app:navigate-forward` | Navigate forward | `Mod+Alt+ArrowRight` |

> **冲突解决**：`Mod+Alt+ArrowLeft/Right` 此前被 Geode 自创的 `focus-next/prev-pane` 占用，而 Obsidian 官方把这两个键
> 给 navigate-back/forward。prime directive = 复刻 Obsidian → **navigate 拿 canonical 键，`focus-next/prev-pane`
> 改为无默认键**（命令仍在面板，用户可自绑；Obsidian 本就无 pane-focus 默认键）。r32 套件只在测 `normalize`/`format`
> 纯函数时用到 `Mod+Alt+ArrowRight` 字面量，不依赖 focus-pane 绑定 → 不回退。

### 契约（冻结）

**core/workspace.ts — per-tab 导航历史（session-only，不持久化，键 = TabState.id）**：
```ts
const NAV_HISTORY_MAX = 50;
interface NavLocation { filePath: string; mode: ViewMode }
interface NavHistory { back: NavLocation[]; forward: NavLocation[] }
private tabHistory = new Map<string, NavHistory>();
```
- **记录点 = openFile 的 replace 分支**（活动 markdown tab 的内容 A→B）。openFile 起始处调
  `recordNavigation(s0, targetPaneId, path, newTab)`（targetPaneId = `opts.paneId ? paneId0(s0,opts.paneId) : s0.activePaneId`）：
  `newTab` → 不记；目标 pane 已开同文件（reuse 分支=切 tab）→ 不记；活动 tab 是 markdown 且 `filePath` 非空且
  `!==path`（replace 分支）→ push `{filePath:旧, mode:旧}` 到该 tab 的 back、清 forward、超 `NAV_HISTORY_MAX` 丢最旧。
- `navigateBack()` / `navigateForward()`：作用于**活动 tab**；非 markdown / 无 filePath / 该向栈空 → no-op；否则
  pop 源栈、push 当前 `{filePath,mode}` 到目标栈、`setTabLocation(tab.id, 目标.filePath, 目标.mode)`。
- `canTabNavigateBack(tabId)` / `canTabNavigateForward(tabId)`：读 Map 长度（UI 按钮禁用态；每次历史变更都伴随
  workspace.state 变更 → `useStore(state)` 重渲染即读到新值，**无需额外 Store**）。
- `private setTabLocation(tabId, filePath, mode)`：改 tab 的 filePath+title+mode 并激活，**不经 openFile → 不记录新导航**。
- **清理（镜像 R36 recentlyClosed）**：`closeTab` → `tabHistory.delete(id)`；`handleDeleted(path)` → purge 所有 tab
  历史里 `filePath===path||startsWith(path+"/")` 的 Location + `pruneTabHistory()`；`handleRenamed` → remap Location
  filePath（含文件夹前缀）；`closeMissingFileTabs` → `pruneTabHistory()`；`vault:changed` reason `"load"` →
  `tabHistory.clear()`（与 recentlyClosed 同处，防跨库同名相对路径 back 到错文件）。`pruneTabHistory()` = 删除 Map 中
  不再属于任何 live tab 的键。

**app/App.tsx**：注册 `app:navigate-back`（`Mod+Alt+ArrowLeft` → `workspace.navigateBack()`）+ `app:navigate-forward`
（`Mod+Alt+ArrowRight`）；**删除 `app:focus-next-pane`/`app:focus-previous-pane` 的 `hotkey` 字段**（命令保留、无默认键）。
**TabBar**：在 `leaf.tabs.map` 之前 prepend back/forward 图标按钮组（`disabled = !canTabNavigate{Back,Forward}(leaf.activeTabId)`，
`onClick` → `workspace.navigateBack/Forward()`；非活动 pane 的按钮靠 PaneLeafView 既有 `onMouseDownCapture` 先激活 pane）。

**app/icons.tsx**：加 `arrow-left` / `arrow-right`（Lucide）。**core/i18n/dict.app.ts**：`cmd.navigateBack`/`cmd.navigateForward`
+ `app.navigateBack`/`app.navigateForward`（按钮 aria-label），en+zh。**styles/app.css**：`.tab-nav` / `.tab-nav-btn`
（28px 图标按钮、`:disabled` 淡显，色走 `--text-muted`/`--bg-hover`/`--text-faint` 变量）。

**探针/E2E（无新 window 全局）**：`__app.workspace` 直驱 —— openFile 序列建历史、navigateBack/Forward、读
`getActiveFile()` + `canTabNavigateBack/Forward(tabId)`；热键 grammar 复用 `__geodeHotkey.match("Mod+Alt+ArrowLeft",…)`。
桌面 `r37-probe` 可真实驱动 store 层（命令层 App-effect 不可驱动，交 E2E）。

### 文件所有权（并行 implementer）
- **A（core）**：`src/core/workspace.ts`（tabHistory + recordNavigation + navigate/canTabNavigate + setTabLocation + 5 处清理钩子）。
- **B（app+i18n+css+版本）**：`src/app/App.tsx`（2 命令 + focus-pane 去键 + TabBar 按钮）+ `src/app/icons.tsx`（2 图标）+ `src/core/i18n/dict.app.ts`（4 键 en+zh）+ `src/styles/app.css`（.tab-nav）+ 三处版本号 0.36→0.37。
- **C（验证）**：`.calibration/r37-e2e.mjs` + `.calibration/r37-probe.mjs`（独占新建）。

### 已知偏差（写给后续轮）
- **导航历史 session-only**（Obsidian 跨重启持久化）——避持久化栈 stale-path 风险；与 R36 recentlyClosed 一致。
- **back/forward 限单 tab 内**（Obsidian 同样 per-tab）——切 tab 走 R36 Ctrl+Tab，跨 pane 走 focus-pane。
- **导航到「已删除文件」从历史 purge**（不像 stale tab 留着）——back 不会落到缺失文件。
- **`focus-next/prev-pane` 失去默认键**（让位 Obsidian-canonical 的 navigate 键；命令仍在面板可自绑）。
- **TabBar reuse 分支（切到已开 tab）不记历史**——Obsidian 同样视为切 tab 非导航。
- **`splitActivePane` 克隆 tab 用新 tabId → 分屏副本的导航历史不随之复制**（新 pane 副本 back/forward 恒空，
  即使源 tab 有历史）。Obsidian 拆分 pane 会复制历史到新 leaf。非泄漏/非数据丢失（fresh 空历史安全），纯功能偏差；
  对照 `moveTab` 保留原 tabId → 历史正确随 tab 迁移。（R37 对抗评审证实，列为已知偏差，未来轮可补 split 复制历史。）

### As-built（评审结论 + 教训）

**0 个确认缺陷**——3 维 12 finding 全为 nit/by-design/证伪。核心担忧（recordNavigation 是否精确镜像 openFile 的
reuse/replace/new-tab 三分支）经**逐分支对照证伪**：reuse 判据 `tabs.some(markdown&&filePath===path)` ≡ openFile 的
`existing && !newTab`；graph/null-filePath 活动 tab → 两边都走 new-tab 不记；同文件被 `!==path` 双重守卫；`s0` 单快照
无 TOCTOU。**反应式按钮无需独立 Store 的契约断言也被实证**：枚举 tabHistory 全部变更点均伴随 `this.update`（→state
引用变更 → `useStore(state)` 重渲染读到新 `canTabNavigate*`），含「删/改名仅存在于历史的文件」也因 handleDeleted/
Renamed 的 `{...s}` 总产新对象而通知；唯一不直接 update 的 `vault:changed load → clear` 由其后必跟的 closeMissingFileTabs
兜住。**多 pane 点非活动 pane 的按钮**：`onMouseDownCapture` 先 `setActivePane`（Store 同步），click 的 navigateBack 经
`getActiveTab()` 读到已是该 pane 的 tab → 同手势内一致。

**2 个证伪 → 硬化成断言**（延续 R35「未测但行为正确→转已测」）：① navigateBack 的 view-mode 恢复（`{filePath,mode}`
双值入/出栈，setTabLocation 回放 mode）原只断言 filePath → 补「a 切 source→openFile b→back a 仍 source」；②
`purgeNavLocations` 同清 back+forward，原 H 节只测 back 栈条目删除 → 补「fwd=[c,b]，删 b，forward 跳过 b→c」。

**1 个无害冗余（保留）**：`closeMissingFileTabs` 内的 `purgeNavLocations/pruneTabHistory` 在现两个调用点（启动恢复 /
in-place 切库）实为 no-op——切库走 `vault.load()` 先 emit `vault:changed load` 已 `tabHistory.clear()`，启动时 Map 本空。
属防御性冗余（若未来出现「不经 vault:changed 就调 closeMissingFileTabs」的新路径则真正生效），故**保留更稳**。

## Round 36 additions — 标签页快捷键（tab keyboard shortcuts）【As-built v0.36】

> **状态：As-built（2026-06-14）。** R32+ 候选池第一梯队 #⑤ = 已核实缺口（命令表无 next/prev-tab、
> go-to-tab N、new-tab、reopen-closed；仅 `focus-next/prev-pane` 是**空间**移动，非 tab 切换）。本轮
> **纯 workspace store + 命令注册，零新 vault 写路径**（标签切换不写 `.md`；`app:new-tab` 复用既有
> `app:new-note` 的 `vault.create` 写路径——同一咽喉点，B 类守卫全继承）+ **零新运行时依赖** + **零新
> window 全局探针**（不同于 R34/R35 的 live-view 功能：标签切换是 store 操作 → 探针/E2E 直接驱动
> `app.workspace` 读 store 真值；热键解析复用 R32 `__geodeHotkey.match`）。
> 校准 Obsidian 官方 docs（`help/User+interface/Tabs`，WebFetch 2026-06-13）。
> **验证**：typecheck 0 + 浏览器 `r36-e2e` **47/47**（store ops + 命令层 execute + reopen LIFO/mode 恢复 +
> UI 反映 + 双平台热键 grammar + 真键 Ctrl+Tab/Shift+Tab/Mod+3/Mod+9/**Mod+T**/**Mod+Shift+T** + G 节
> purge/remap）+ 桌面 release `r36-probe` **18/18**（store 层在真 WKWebView 直驱 + 热键 grammar；命令层
> 因 App Nap §D 不可驱动，交 E2E）+ r35 25 / r34 15 / r33 37 / r32 24 不回退 + `r26-bytes` 0 + cargo/build 绿。
> **3 维对抗评审 3 finding → 1 确认修复（vault 切换清 recentlyClosed）+ 2 证伪硬化成断言**（见 As-built）。

### 官方键位校准（写进契约，勿臆造）

| 命令 id | 名称 | 默认热键 | 修饰键性质 |
|---|---|---|---|
| `app:next-tab` | Go to next tab | **`Ctrl+Tab`** | **字面 Ctrl**（两平台都是物理 Ctrl，非 Cmd——`Cmd+Tab` 是 macOS 应用切换器） |
| `app:previous-tab` | Go to previous tab | **`Ctrl+Shift+Tab`** | **字面 Ctrl** |
| `app:go-to-tab-1..8` | Go to tab #N | `Mod+1`..`Mod+8` | **Mod**（mac=Cmd，其余=Ctrl） |
| `app:go-to-last-tab` | Go to last tab | `Mod+9` | **Mod** |
| `app:new-tab` | New tab | `Mod+T` | **Mod** |
| `app:reopen-closed-tab` | Reopen closed tab | `Mod+Shift+T` | **Mod** |

> **关键：next/prev-tab 用字面 `Ctrl`（R32 体系区分 `Ctrl`/`Mod`/`Meta`）。** `parseHotkey("Ctrl+Tab")`→
> `wantCtrl=true,wantMod=false`；`matchParsedHotkey` 四态全等：mac 下需 `ctrlKey=true,metaKey=false`（=物理
> Ctrl+Tab），且 `Cmd+Tab`（metaKey=true）绝不误触。`NAMED_KEYS.tab="Tab"`、数字键走 `key.length===1` 路径
> → `Tab`/`1`..`9` 均可表达（commands.ts 已就绪，无需改）。`Ctrl+Tab` 在编辑器内不会被 CM 当成缩进：R33
> 的 `Prec.highest` keydown 拦截器先调 `handleKeydown` 匹配并 `preventDefault`，CM 永远收不到这个 Tab。

### 契约（冻结）

**core/workspace.ts — 4 个新公开方法（additive，不改任何既有签名）**。导航作用于**活动 pane**（`getActivePane()`，
镜像 `focusAdjacentPane` 在活动 pane 内循环——Obsidian Ctrl+Tab 在当前 tab group 内循环）：

```ts
/** Cycle the ACTIVE pane's active tab by delta (+1 next / -1 prev), wrapping.
 *  No-op when the active pane has < 2 tabs. (Ctrl+Tab / Ctrl+Shift+Tab.) */
cycleActiveTab(delta: 1 | -1): void

/** Activate the tab at 0-based `index` in the ACTIVE pane. Out-of-range → no-op
 *  (Obsidian: Cmd+5 with 3 tabs does nothing). (Mod+1..8 → index 0..7.) */
activateTabAt(index: number): void

/** Activate the LAST tab in the active pane. No-op when empty. (Mod+9.) */
activateLastTab(): void

/** Reopen the most-recently USER-closed tab (LIFO), restoring its view mode,
 *  in a NEW tab — preferring its original pane if it still exists, else the
 *  active pane. Returns true if one was reopened. (Mod+Shift+T.) */
reopenClosedTab(): boolean
```

**recentlyClosed 栈（session-only，不持久化）**：
```ts
interface ClosedTab { viewType: "markdown" | "graph"; filePath: string | null; mode: ViewMode; paneId: string }
private recentlyClosed: ClosedTab[] = [];   // most-recent LAST; cap RECENTLY_CLOSED_MAX = 20
```
- **只有 `closeTab(id)` 入栈**（用户显式关闭）——关闭前捕获被关 tab 的 `{viewType,filePath,mode,paneId}` push，超 cap 丢最旧。
- **反应式清理一律 PURGE 不入栈**（删/改名/缺失文件无法 reopen）：`handleDeleted(path)` 删 `filePath===path || startsWith(path+"/")` 的条目；`handleRenamed(old,new)` 同 tab 规则 remap 栈内 filePath；`closeMissingFileTabs(exists)` 删 `filePath` 不再存在的条目。
- `reopenClosedTab()`：`pop()` 取最近条目；`viewType==="graph"`→`openGraph()`；否则 `filePath` 非空→`openFile(filePath,{newTab:true,paneId:entry.paneId})`（`openFile` 的 `paneId0` 在原 pane 已塌缩时回退活动 pane）后 `setTabMode` 恢复 mode；返回是否 reopen。

**app/App.tsx — 注册 13 个命令**（`commands.register({id,name:()=>t(...),hotkey,callback})` 样板，hotkey 字段直接被 commands 层消费）：`app:next-tab`/`app:previous-tab`（callback `cycleActiveTab(±1)`）、`app:go-to-tab-1..8`（循环注册，`name:()=>t("cmd.goToTab",{n})`，callback `activateTabAt(n-1)`）、`app:go-to-last-tab`（`activateLastTab()`）、`app:new-tab`（`Mod+T`，复刻 `app:new-note` 但 `openFile(path,{newTab:true})` = 加新 tab 不替换）、`app:reopen-closed-tab`（`reopenClosedTab()`）。

**core/i18n/dict.app.ts — 6 个新键 en+zh**：`cmd.nextTab`/`cmd.previousTab`/`cmd.goToTab`（含 `{n}` 插值，`t()` 支持 number）/`cmd.goToLastTab`/`cmd.newTab`/`cmd.reopenClosedTab`。

**探针/E2E（无新 window 全局）**：`__app.workspace.*` + `__app.commands.execute("app:next-tab"|...)` 直接驱动，读 `getActiveTab().filePath`/`getPanes()[0].tabs`/`.tab.is-active .tab-title` 验真值；热键解析复用 `window.__geodeHotkey.match("Ctrl+Tab", evt, isMac)`。桌面 `r36-probe` **可真实驱动命令层**（store 操作不依赖 live view，强于 R34/R35）。

### 文件所有权（并行 implementer）
- **A（core）**：`src/core/workspace.ts`（4 方法 + recentlyClosed 栈 + 3 处反应式 PURGE/remap 钩子）。
- **B（app+i18n+版本）**：`src/app/App.tsx`（13 命令注册）+ `src/core/i18n/dict.app.ts`（6 键 en+zh）+ 三处版本号 0.35.0→0.36.0（`package.json`/`src-tauri/tauri.conf.json`/`src/features/settings/SettingsModal.tsx` APP_VERSION）。
- **C（验证）**：`.calibration/r36-e2e.mjs` + `.calibration/r36-probe.mjs`（独占新建）。

### 已知偏差（写给后续轮）
- **`app:new-tab` 急切建 `Untitled.md` 文件**（Obsidian Cmd+T 开空白 tab、不建文件）——Geode 标签页是文件支撑（`TabState` 无「空白 tab」视图），故复刻为「新 untitled 笔记 + 新 tab」。
- **TabBar「+」按钮仍调 `app:new-note`（替换活动 tab，pre-existing）**——本轮只补键盘快捷键（候选池 #⑤ = tab 快捷键），「+」repoint 列为余项。
- **导航限活动 pane**（Obsidian 同样在当前 tab group 内循环；跨 pane 用 `focus-next/prev-pane`）。
- **recentlyClosed session-only**（Obsidian 跨重启持久化）——避持久化栈的 stale-path 风险；重启清空。

### As-built（评审修复 + 根因教训）

**1 个确认缺陷（已修）— vault 切换不清 `recentlyClosed` → 跨库同名相对路径碰撞**：in-place 切库（`openVaultFlow`
重指 adapter，**非** `location.reload`，内存栈存活）后只调 `closeMissingFileTabs(p => 新库.fileExists(p))`，其
栈 purge 条件 `c.filePath===null || exists(c.filePath)` 会**放行新库恰好同名的旧库条目**（两库都有 `Notes/x.md`
时 `exists()=true`）→ `Mod+Shift+T` 打开新库里**无关的同名文件**。现有代码本就为此在切库处清了 `lastActiveFile`
（注释「same-named files would silently collide」），却漏了新增的栈。**修复 = Workspace 构造器订阅
`vault:changed` reason `"load"` → `recentlyClosed = []`**（镜像 `DocumentManager` 在同一事件失效所有句柄
`documents.ts:476`；反应式、留在 core、覆盖所有切库路径含启动 last-vault 恢复，优于 App.tsx 单点清）。
**非数据损坏**（reopen 只读 acquire、flush 有 fileExists no-resurrect 守卫）——纯正确性/UX。

**2 个证伪 → 硬化成 E2E 断言**（R35 教训「未测但行为正确 → 转已测」）：① 三处反应式 purge/remap 钩子
（delete-purge / rename-remap / **文件夹前缀**非误伤 / missing-purge 保留 graph）原零覆盖 → 补 G 节 6 断言（含
`删 "sub" 不误伤 "subextra.md"` 的字节级前缀边界——历轮反复踩坑点）；② `Mod+T`/`Mod+Shift+T`（任务点名的
「浏览器/系统可能吞」风险点）原仅测 grammar → 补 F 节真键端到端断言（CDP 实测两者均经 R33 `Prec.highest`
拦截器正确触发）。

**根因教训 — 命令层（App.tsx `useEffect` 注册）桌面探针不可驱动，store 层可**：R36 探针初版断言
`app.commands.execute("app:next-tab")` + `app.commands.list()` 含 13 命令 → 桌面实测 **cmdCount=0、execute 不切
tab**。根因 = **App.tsx 在 `useEffect` 里注册命令，后台 WKWebView 不绘制 → React effect 不跑 → 命令从不注册**
（= R34 「`editor:*` 命令始终未注册」同一 App Nap §D 现实）。**但 `app.workspace.*`（cycleActiveTab/reopen 等）
是纯 store 调用、不经 effect → 桌面探针能真实驱动**（store 变更不依赖绘制）——这是 R36 探针面比 R34/R35 强的原因
（驱动真实功能逻辑而非仅纯函数）。结论沉淀：**桌面探针可驱动「store/纯函数」层，不可驱动「React-effect/live-view」
层（命令注册、CM view、EditorPane）**；后者真值一律交浏览器 E2E（前台真渲染）。R36 探针遂只验 store + hotkey
grammar，命令注册+execute 交 r36-e2e（B 节 6 断言全绿）。

## Round 35 additions — 括号/引号自动配对 + 选区包裹（auto-close brackets + wrap selection）【As-built v0.35】

> **状态：As-built（2026-06-13）。** R32+ 候选池 #④ = 实测缺口（敲 `[` 得 `[` 不补 `]`；源码无
> closeBrackets）。本轮**纯 editor 扩展、零新 vault 写路径**（配对/包裹走普通 CM transaction →
> documents.ts dirty → autosave，**B 类写守卫全继承、无新写路径**）+ **零新运行时依赖**
> （`@codemirror/autocomplete` 已在）。校准 Obsidian「Auto pair brackets」+「Auto pair Markdown
> syntax」两设定（含选区包裹）。验证：浏览器 `r35-e2e` **25/25**（7 probe 纯函数 + 18 live：自动配对
> `( [ { " '`、line-start `'`→`''`、contraction `don't` 不配对、type-over、Backspace 删配对、选区包裹
> `(foo)`/`*foo*`→`**foo**`/`` `foo` ``、空选区 `*`→单字符、`[[`→`[[]]`、字面 `[[Note]]` round-trip、
> 补全 accept→单 `]]`、autosave 落盘）+ 桌面 release `r35-probe` **9/9**（探针 present + 纯 wrap 决策在
> 真 WKWebView 正确 + 启动 error-free）+ r23–r34 全套不回退（r33 37 / r32 24 / r31 21 / r25 17 / r24 12 /
> r23 22）+ `r26-bytes` 0 违例（markdown.ts 未动）+ typecheck/cargo/build 绿。**5 维对抗评审 5 finding →
> 0 确认 / 5 证伪**（2 个有效观察硬化成 E2E 断言 + 2 记为已知限制；详见 As-built）。

### 设计：两层职责清晰分割

Obsidian 拆成两个独立设定。本轮照此分两层实现，**职责边界钉死防回归**：

- **Layer 1 — 括号/引号（CM `closeBrackets()` 内置，well-tested）**：对 `( [ { " '`（CM
  `defaultBrackets` 恰为此集）提供：空选区自动配对（`(`→`()` 光标居中）、**选区包裹**（选区+`(`→`(sel)`）、
  type-over（光标前是 `)` 时再敲 `)` 跳过不重插）、Backspace 删空配对。**全部来自 CM 扩展，无自写逻辑**
  → 桌面探针无法驱动（R34 结论：依赖 live view），真值交浏览器 E2E。
- **Layer 2 — Markdown 强调符选区包裹（自写纯函数，core）**：对 `* _ \` ~ = $`，**仅非空选区**触发包裹
  （`*sel*`，**保留选区 → additive**：再敲 `*` 得 `**sel**`）；**空选区一律透传**（敲单字符）。空选区不配对
  是**刻意偏离** Obsidian 的 `*`→`*|*`——理由：行首 `* ` 列表项、代码围栏 ` ``` `、CJK 输入都会与空配对
  冲突（Obsidian 自身此处亦有 bug 报告），选区包裹是候选池 #④ 明列的形态（「选中文本敲 `[`/`*`/`\` ` 包裹」）。
  纯决策放 `core/bracketWrap.ts` 供探针单测。

### 契约（已实现）

- `core/bracketWrap.ts`（NEW，纯 TS）：
  - `MARKDOWN_WRAP_CHARS = new Set(["*","_","`","~","=","$"])`（单字符强调符，`** ~~ == $$` 经连按累积）。
  - `markdownWrapInput(doc: string, from: number, to: number, ch: string): { changes:{from,to,insert}, selection:{anchor,head} } | null`
    —— `to>from`（非空选区）且 `ch∈MARKDOWN_WRAP_CHARS` → 返回包裹 edit：`insert = ch + doc.slice(from,to) + ch`，
    新选区 `{anchor: from+1, head: to+1}`（**仍选住内层 sel，光标偏移 +1 让连按再包**）；否则 `null`。
    纯函数、零副作用，main.tsx 探针与 inputHandler 共用单一真值（镜像 R33 `format.ts` 先例）。
- `features/editor/cmExtensions.ts`（OWNED by implementer-A）：
  - import `closeBrackets, closeBracketsKeymap` from `@codemirror/autocomplete`。
  - `buildEditorExtensions` 数组加三项：
    1. `Prec.high(EditorView.inputHandler.of(markdownWrapHandler))`——非空选区敲强调符即调
       `markdownWrapInput`，命中则 `view.dispatch(...)` + `return true`（吞掉默认插入），否则 `return false`。
       **置于 closeBrackets 之上**：字符集 `* _ \` ~ = $` 与 closeBrackets 的 `( [ { " '` 不相交，
       但显式 `Prec.high` 保证确定性。
    2. `closeBrackets()`——放 autocompletion 附近。
    3. `keymap.of(closeBracketsKeymap)`——**放 `keymap.of([...defaultKeymap, indentWithTab])` 之上**
       （Backspace 删空配对优先于默认删除）。
  - **与 wikilink 补全源协同（最高风险点，钉死）**：`[` ∈ closeBrackets → 敲 `[[` 得 `[[]]`（CM `before`
    集含 `]` → 第二个 `[` 在 `]` 前仍配对）。wikilink `apply` 既有守卫 `sliceDoc(to,to+2)==="]]"?"":"]]"`
    已防双补 `]]`，`anchor=from+linkText.length+2` 落到既存 `]]` 之后——**guard 已正确，本轮只需 E2E 锁住
    回归，不改 wikilinkCompletionSource**。字面键入 `[[Note]]`：`[[`→`[[]]`，`Note`→`[[Note]]`，`]]` type-over
    吸收 → 仍得 `[[Note]]`（既有套件 `[[` 键入断言不破）。`![[` 嵌入同理。
- `main.tsx`（OWNED by implementer-A）：`window.__geodeBrackets = { wrap: (doc, from, to, ch) => markdownWrapInput(...) }`
  always-on 探针，**装在 `loadExternal` 之前**（与 `__geodeFormat`/`__geodeSearch` 同位，R27 教训）。
- i18n：**零新 UI 字符串**（配对/包裹纯键入行为，无面板、无命令名、无 phrase）。
- 设置项：**本轮不暴露开关**（Obsidian 默认两设定均 ON；与 Obsidian 默认一致即可，toggle 列为余项）。

### 文件所有权表（并行/独占）

| 区 | owner | 改动 |
|---|---|---|
| `src/core/bracketWrap.ts` | implementer-A | NEW 纯决策函数 |
| `src/features/editor/cmExtensions.ts` | implementer-A | import + 3 项接线 + wikilink 协同（不改 wikilink 源）|
| `src/main.tsx` | implementer-A | `__geodeBrackets` 探针块 |
| `.calibration/r35-e2e.mjs` / `r35-probe.mjs` / `r35-probe-vault/` | implementer-B | 复用 r34 脚手架 |
| `docs/*` + 版本三处 | chief 收尾 | — |

> 冻结的唯一跨区契约 = `markdownWrapInput` 签名（探针 + inputHandler + E2E 三方共用）+「`[` 配对归
> closeBrackets、`]]` 补全归 wikilink source，靠 `sliceDoc(to,to+2)` 守卫协作」。

### As-built 根因教训 + 对抗评审结论

1. **closeBrackets 的 `[` 配对与 wikilink `]]` 补全靠既有 `sliceDoc` 守卫零冲突协作（最高风险点，实测锁住）**：
   敲 `[[` 得 `[[]]`（CM `before` 集含 `]` → 第二个 `[` 在 `]` 前仍配对）；wikilink `apply` 既有守卫
   `sliceDoc(to,to+2)==="]]"?"":"]]"` 防双补，`anchor=from+linkText.length+2` 落到既存 `]]` 之后（补全
   accept → `[[Target]]` 单 `]]`、光标在链接后——实测 E2E 锁住）。**字面键入 `[[Note]]` 仍得 `[[Note]]`**
   （`[[`→`[[]]`，`Note` 填入，`]]` 由 type-over 吸收）——这解释了**为何 r23–r34 既有套件里所有 `[[` 键入
   断言零回退**（type-over 吸收掉手敲的闭合括号，doc 不变）。**未改 wikilinkCompletionSource 一字**。
2. **两层职责切分 = closeBrackets（CM 内置）管括号引号、`core/bracketWrap` 纯函数管 markdown 强调符选区包裹**：
   字符集不相交（`( [ { " '` vs `* _ \` ~ = $`），`markdownWrapHandler` 用 `Prec.high` 保证确定性先行。
   markdown 包裹**仅非空选区**触发、保留内层选区 → additive（`*sel*`→`**sel**`，连按累积出 `** ~~ == $$`）。
   纯决策放 core 供 `__geodeBrackets` 探针单测（镜像 R33 `format.ts`/R28「纯决策核心放 core」先例）——
   **桌面探针首次能驱动配对相关真值**（pure fn，无需 live view；不同于 R34 的 search 必须 live view）。
3. **对抗评审 5 维（wikilink 协同 / IME-CJK / 包裹语义 / 数据安全+分层 / Obsidian 保真）9 agent → 5 finding
   → 0 确认 / 5 证伪**。证伪要点：① wikilink 光标 `+2` 在 `]]` 已存时正确（E2E 实证）；② IME 无需额外守卫
   ——handler 只认单字符 ASCII 强调符，CJK 合成提交非 ASCII、无法触发，即便触发「包裹」也无损（非破坏路径，
   不同于 R33 命令误触发路径）；③④⑤ 属保真度观察非缺陷。**响应：把 ②(apostrophe) 类「未测但行为正确」
   硬化成 E2E 断言**（line-start `'`→`''`、contraction `don't` 不配对——CM quote-before-word 守卫实测生效）。
4. **记为已知限制（刻意偏离 / CM 上游行为，非缺陷）**：
   - **空选区不对 markdown 强调符配对**（敲 `*` 得单 `*`，非 Obsidian 的 `*`→`*|*`）——刻意偏离：空配对与
     行首 `* ` 列表项、代码围栏 ` ``` `、CJK 输入冲突（Obsidian 自身此处亦有 bug 报告），且候选池 #④ 明列
     形态是「选中文本敲包裹」。括号引号则照常空配对（= Obsidian「Auto pair brackets」）。
   - **closeBrackets 不按上下文门控**（代码块 / 行内 code / 数学 / frontmatter 内仍配对）——Obsidian 在部分
     上下文禁用配对，本轮用 CM 默认（全局配对），属保真度 gap、非数据问题。语言感知门控列为余项。
   - **设置开关未暴露**（Obsidian 默认两设定均 ON，与之一致即可）——toggle 列为余项。

## Round 34 additions — 编辑器内查找 / 替换（in-editor find/replace）【As-built v0.34】

> **状态：As-built（2026-06-13）。** R32+ 候选池 #③ = 实测缺口（`@codemirror/search` 仅 compat
> loader 引入，features/editor 无 searchKeymap/openSearchPanel）。验证：浏览器 `r34-e2e` **15/15**
> （8 probe：open/isOpen/replaceAll 全词替换/文档模型/**autosave 落盘**/close；7 live：Cmd+F 开
> `.cm-search` 面板 / 显示 replace 行 / 本地化标签 / 真键入高亮 `.cm-searchMatch`×3 / Escape 关 /
> editor:search·replace 注册）+ 桌面 release `r34-probe` **3/3**（present + 全 api + error-free，
> **见下「桌面探针边界」**）+ r23–r33 全套不回退（r33 37 / r32 24 / r31 21 / r25 17 / r24 12 /
> r23 22）+ `r26-bytes` 0 违例（markdown.ts 未动）+ typecheck/cargo/build 绿。**5 维对抗评审 9
> verdict → 7 确认 → 3 根因修复 + 3 记为已知限制**（详见 As-built）。

### 契约（已实现）

- `features/editor/searchCommands.ts`（NEW）：
  - `registerSearchCommands(app, getView)` 注册 **`editor:search`（Mod+F）** + **`editor:replace`（无
    默认键）**——both `available = getView()!==null`，`getView` 由 App 注入 `getActiveFileEditorView`
    （活动文件双侧门控）。callback 调 `openSearchPanel(view)`；replace 额外 `focusReplaceField`（rAF
    后聚焦 `.cm-search [name="replace"]`）。
  - **`editor:replace` 无默认键是刻意取舍**：macOS Cmd+H = 系统「隐藏 App」、浏览器 = 历史，绑它跨端
    不安全；替换仍可经 Cmd+F 面板（含 replace 行）+ 命令面板/自定义键到达。
  - `editorSearchPhrases()`：CM 英文 phrase key → `t()`（17 个，`EditorState.phrases.of` 消费）。
  - `installSearchProbe(app)`：`window.__geodeSearch {open,isOpen,close,replaceAll}`，**活动文件门控**
    （镜像 getActiveFileEditorView，防经探针写错文件）+ **empty-search no-op 守卫**。loadExternal 前装。
- `cmExtensions.ts`：`search({ top: true })` + `keymap.of(searchKeymap)` + `EditorState.phrases.of(editorSearchPhrases())`
  加入 buildEditorExtensions；editorTheme 加 `.cm-panel.cm-search`/`.cm-searchMatch` 主题（**纯 CSS
  变量**，字号走 `--editor-font-size`）。**开命令走 app 命令层**（R33 `Prec.highest` 拦截器先处理
  Mod+F → searchKeymap 自身 Mod-f 被无害遮蔽）；searchKeymap 仅提供面板内键（Enter/Shift-Enter/Escape/
  F3/Mod-d）。
- i18n：`dict.app.ts` `cmd.searchFile`/`cmd.replaceFile`；`dict.views.ts` 17 个 `editor.search.*`（en+zh）。
- 全局搜索（左栏 `features/search` 全库）与本轮**文内 CM 面板**是两套，互不影响。

### As-built 根因教训

1. **桌面探针边界（最重要的方法论结论）**：本轮首次遇到「功能依赖 live CM view」的桌面验证。实测发现
   **后台 WKWebView 不绘制 → React effect 永不执行** → EditorPane 的建 view effect 与 App 的命令注册
   effect 都不跑（探针实测：`.cm-content` 始终缺席、`editor:*` 命令始终未注册，**即便用 System Events
   把窗口 foreground 也无效**）。这正是 data-safety §D「App Nap」的根因，也解释了**为何历轮桌面探针
   从不驱动 live view**——它们只测 main.tsx 同步装的纯 hook（`__geodeFormat`/`__geodeHotkey` 等）。
   故 R34 桌面探针**只断言「探针已嵌入真二进制（present + 全 api）+ 启动 error-free」**，功能真值交给
   浏览器 r34-e2e（真实聚焦 view）。**结论：凡功能依赖 live CM view，桌面探针不可能驱动，必须靠浏览器
   E2E；桌面探针只验证 main.tsx 同步 wiring + 不崩。**
2. **探针也是生产全局，必须同样做活动文件门控**：`installSearchProbe` 初版用裸 `getActiveView()`（闩锁字段
   会陈旧），评审指出经 `__geodeSearch.replaceAll` 可能写到后台非活动文件（DocumentHandle sync →
   autosave 错文件）。修复 = 镜像 `getActiveFileEditorView` 的 `active.path===getActiveFile()` 双侧门控。
   **凡 `window.__geode*` 写类探针都要复刻命令层的写守卫，别因为「只是探针」就裸用 getActiveView。**
3. **CM `replaceAll` 对 invalid query 会「开面板」而非 no-op**：`new SearchQuery({search:""})` → `valid=false`
   → CM 的 searchCommand 包装器 fall through 到 `openSearchPanel`。探针 replaceAll 加 `search===""` 提前
   返回（不 dispatch）。
4. **测试纪律**：① CM 查找框在 `keyup` 提交 query，`page.fill` 不触发 → 高亮测 0，必须 `keyboard.type`
   真键入（R34 e2e 抓获）；② 桌面探针 setTimeout 长链在后台会被 App Nap 冻结 → flush 永不到 → 改
   **每条 recFlush 即写（fire-and-forget）+ 短链**（§D 复刻）。
5. **记为已知限制（非缺陷，多为 CM 上游行为）**：① **IME 合成**——CM 搜索面板 input 的 keydown 自走
   `runScopeHandlers`、不查 `isComposing`，故 CJK 合成中 Enter 会触发 findNext（find 只读无害；replace
   字段为窄边）——与 CM 上游一致，未做自定义面板改写；② **Mod+G 被 `app:open-graph` 占用**→ CM
   searchKeymap 的 Mod-g findNext 被遮蔽（R33 设计：编辑器内 app 命令优先；findNext 走 Enter/F3/next
   按钮）；③ **选区 >100 字符不预填查找框**（CM `defaultQuery` 上限；≤100 字符会预填 = 免费好行为）。

## Round 33 additions — Markdown 格式化命令 + 快捷键（formatting commands）【As-built v0.33】

> **状态：As-built（2026-06-13）。** R32+ 候选池 #② = 实测缺口（选区按 Cmd/Ctrl-B 不加粗、
> 源码无任何 toggle 命令）。验证：浏览器 `r33-e2e` **37/37**（26 纯函数 probe 覆盖 13 op 的
> wrap/unwrap/empty/emphasis-guard/边界 + 9 live：Cmd+B/I 包裹+往返、Cmd+K 建链、命令注册/
> available + 2 评审修复边界）+ 桌面 release `r33-probe` **12/12** 真实 WKWebView runtime（纯
> 函数）+ r23–r32 全套不回退（r32 24 / r31 21 / r25 17 / r24 12 / r23 22）+ r26-bytes 0 违例
> （markdown.ts 未动）+ typecheck/cargo/build 绿 + **autosave→vault 落盘实测**（Cmd+B 后
> `vault.read` 见 `**Hello**`）。**5 维对抗评审 18 verdict → 13 确认/部分 → 去重 4 根因修复**
> （lineBounds 不变量 / IME isComposing / 双触发 defaultPrevented / heading 无空格），其余证伪
> （insertLink 光标 off-by-one = 评审误数；分屏 undo = 与打字同路径无新风险；多行加粗/选区端点 =
> 镜像 Obsidian 非缺陷）。

### 契约（已实现）

**分层落点（R28 教训）**：纯变换在 `core/format.ts`（纯 TS，零 CM/React 依赖）——这样
`main.tsx` 的 `__geodeFormat` 探针能 import 它而**不引入 bootstrap→feature 耦合**；
`features/editor/formatCommands.ts` 才是 CM dispatch + 命令注册层。

- `core/format.ts`：
  - `FormatEdit = { from, to, insert, selFrom, selTo }`（单段连续替换 + 替换后绝对选区）；
    `FormatOp`（13 个）。`null` = no-op，调用方不 dispatch。
  - `applyFormatOp(op, text, from, to): FormatEdit | null` = **唯一入口**（命令层与探针共用
    → 行为单一真值）。底层：`toggleWrap`（bold/italic/strike/highlight/inline-code）、
    `insertLink`、`toggleList`（bullet/numbered/checklist）、`toggleBlockquote`、`toggleHeading`、
    `toggleCodeBlock`、`toggleCallout`。
  - **幂等 toggle**：再按一次脱（包裹↔脱、标题 none→H1..H6→none 循环、围栏 wrap↔unwrap）。
  - **强调符歧义守卫**（`toggleWrap`）：marker 仅当「该位继续字符 ≠ 同强调符」才算成对——
    故 `*`（斜体）不会从 `**`（粗体）里抠一个星、`**` 不会误吞 `***`。对 selection 内成对与
    selection 外贴邻成对两种情况都判。空选区 → `marker|marker` 光标居中。
- `features/editor/formatCommands.ts`：`applyFormat(view, op)` 读 `state.doc`+`selection.main`→
  调 `applyFormatOp`→ 一次原子事务（`changes`+`selection`，`userEvent:"input.format"`）；
  `registerFormatCommands(app, getView)` 注册 13 命令，`getView` 由 App 注入
  （`() => getActiveFileEditorView(app)?.view ?? null`）；`available = getView()!==null`。
- 命令集 + 默认键（**仅 B/I/K 有默认键 = 镜像 Obsidian**；其余无默认键，可在设置绑定）：
  `editor:toggle-bold`(Mod+B) `editor:toggle-italic`(Mod+I) `editor:insert-link`(Mod+K)
  `editor:toggle-strikethrough` `editor:toggle-highlight` `editor:toggle-inline-code`
  `editor:toggle-heading` `editor:toggle-blockquote` `editor:toggle-bullet-list`
  `editor:toggle-numbered-list` `editor:toggle-checklist` `editor:toggle-code-block`
  `editor:insert-callout`。i18n 键在 `dict.app.ts` 的 `cmd.*`（en+zh）。
- `cmExtensions.ts`：新增 **`Prec.highest(EditorView.domEventHandlers({keydown: e => app.commands.handleKeydown(e)}))`**——见下「头号根因」。
- `main.tsx`：`window.__geodeFormat.apply(op,text,from,to)`（loadExternal 前，always-on 探针）。

### As-built 根因教训

1. **头号坑：原生 contenteditable 的 Cmd+I 会先把选区扩成整行，而 app 命令层在 window 冒泡阶段
   读选区 = 读到被扩后的整行。** 实测：选 `[0,5]`"Hello" 按 **Cmd+B 干净包裹**（选区不变），但按
   **Cmd+I 把整行 `[0,11]` 斜体**（`*Hello world*`）。`commands.execute("editor:toggle-italic")`
   直接调却正确（`*Hello*`）→ 锁定问题在**键盘事件投递**，不在命令逻辑。逐层探针证：keydown
   capture 阶段选区仍 `[0,5]`，到 window 冒泡时已 `[0,11]`——CM 的 contentDOM keydown 处理（在
   window 冒泡 handler 之前跑）触发了原生/CM 的选区扩展。**修复 = 把命令热键路由提到编辑器层、
   最高优先级**：`Prec.highest` 的 CM `domEventHandlers.keydown → app.commands.handleKeydown(e)`，
   在 CM 自身 keymap / 原生 contenteditable 动作**之前**处理（在真选区上）；`handleKeydown` 命中即
   `preventDefault`+`stopPropagation`→ window listener 不再二次触发。**教训：编辑器内的命令热键
   必须在 CM 输入处理链的最高优先级拦截，不能只靠 window 冒泡——原生 contenteditable 会在冒泡前
   改 DOM/选区。** Cmd+B「碰巧」没事不代表 Cmd+I 也没事，**每个修饰键都要在真编辑器里敲一遍**
   （R31 教训复现）。
2. **该拦截把「每次 keydown 都过 handleKeydown」→ 必加两道守卫**（评审抓获）：① **IME
   `isComposing`**——CJK 合成期 keydown 会进来，`handleKeydown` 顶部 `if(e.isComposing) return false`
   保护中文/日文输入不被命令误吞（zh 用户高频）；② **`defaultPrevented`**——若更早的处理者已占用
   该键（CM 拦截器命中并 preventDefault），window listener 不再重跑（防 CM「更新中延迟派发」这一
   罕见次序下的双触发）。两守卫加在 `core/commands.ts handleKeydown` 顶部，对所有命令生效、且只在
   「合成中 / 已被占用」时短路，不影响正常命中（r32/r31 全绿验证）。
3. **零新 vault 写路径**：格式化经普通 CM 事务 → `documents.ts` dirty → autosave 去抖落盘
   （与打字同管线，B 类写守卫全继承）。唯一安全要点 = **活动文件门控（R23 DS-1）**：命令经
   `getActiveFileEditorView`（path===活动文件 双侧门控）取 view，焦点/活动 tab 分叉时**fail-safe
   返 null 不写**，绝不误写后台文件。CM 拦截器只路由热键、无数据路径。
4. **评审修复的两处纯函数边界**：① `lineBounds` 对 doc=`"\n"` + 全选会算出 `start>end`（trailing
   newline 把 effTo 推到 start 前）→ code-block/callout 会建 `from>to` change（`view.dispatch`
   抛 RangeError）→ 加 `if(end<start)end=start` 守不变量；② `toggleHeading` 对无空格 `#Heading`
   原产出 `# #Heading`（strip 正则要求空格、不匹配）→ strip 改 `/^#{1,6} ?/`（空格可选），循环出
   干净 `# Heading`。

## Round 32 additions — macOS Cmd（Mod）修饰键支持【As-built v0.32】

> **状态：As-built（2026-06-13）。** 实现与下方契约一致。验证：浏览器 `r32-e2e` 24/24（20
> grammar 双分支 probe + 4 live：Cmd+P 开面板 / Ctrl+P 不开 / 面板 ⌘ 字形 / Cmd+, 开设置）+
> 桌面 release `r32-probe` 16/16 真实 WKWebView runtime（isMac=true + 双平台分支）+ r23–r31
> 全套不回退 + r30/r31 desktop probe 10/10 + r26-bytes 0 违例 + typecheck/cargo/build 绿。
> **对抗评审 8 维功能正确性全证伪为非问题**（四态匹配 / 编辑器 Cmd 剪贴板不撞 / 可编辑守卫 /
> 捕获 / 冲突检测 / 字形 / 分层 / KeyEventLike 结构类型），仅 2 项收口（版本三处对齐 +
> daily-note JSDoc 陈旧注释）。
>
> **As-built 教训（环境）：改前端但不改 Rust 时，`cargo build --release` 可能 0.40s「完成」
> 却不重嵌前端资产**——Tauri `generate_context!` 在编译期读 dist，若 `.rs` 源未变 cargo 不重编、
> 嵌入资产保持陈旧（`strings 二进制 | grep __geodeHotkey` 因 brotli 压缩恒为 0，不是有效校验）。
> 修复 = `touch src-tauri/src/main.rs` 强制重编含 `generate_context!` 的 crate；**唯一可靠校验 =
> 跑 probe**（probe 命中即资产已更新）。
>
> R32+ 候选池 #① = **头号缺口**（实测 Ctrl+P 开命令面板、
> **Cmd+P 无反应**）。官方校准（obsidian.md help "Hotkeys"，2026-06-13 复核）：Obsidian
> 热键语法用 **`Mod`** 作平台主修饰符——**macOS 解析为 ⌘（Cmd/metaKey），Windows/Linux 解析
> 为 Ctrl**；`Ctrl` 永远指物理 Control（即使 mac），`Meta` 永远指 ⌘/Win 键。本轮把 Geode
> 命令层从「写死 Mod=Ctrl、三处拒 `metaKey`」改为镜像该语义。**纯键路由，零 vault 写**（data-safety
> §B/§C 不适用；唯一持久化是既有 `geode.hotkeyOverrides` localStorage，形状不变）。

### 设计（契约）

**修饰符语法（canonical hotkey 字符串）** — `Mod` 升为一等修饰符，**不再** collapse 成 `Ctrl`：
- `Mod` = 平台主键（match 时：mac→`metaKey`，非 mac→`ctrlKey`）。
- `Ctrl` = 物理 Control（任何平台都查 `ctrlKey`）。
- `Meta` = ⌘/Win 键（任何平台都查 `metaKey`）。`Alt`/`Shift` 不变。
- canonical 顺序：`Mod` → `Ctrl` → `Meta` → `Alt` → `Shift` → key。
  `normalizeHotkey("mod+p")→"Mod+P"`、`"ctrl+p"→"Ctrl+P"`（两者**不同** canonical，mac 下解析到
  不同物理键 → 不互判冲突，正确）。**旧存 `Ctrl+*` override 保持物理 Ctrl 语义，不迁移**。

**平台探测** — `core/commands.ts` 内 `detectMacPlatform()`（`/Mac|iPhone|iPad|iPod/` test
`navigator.platform||userAgent`，try/catch→false），模块加载时求值一次存 `isMacPlatform`。
（与 `features/hover/hoverController.ts:isApplePlatform`、`compat/util.ts:isMacOS` 同源，但
core 不能 import features/compat → 各自独立一份，可接受的小重复。）

**纯函数签名（平台显式入参，便于双分支确定性测试）** — core/commands.ts 导出：
```ts
export interface ParsedHotkey {
  wantMod: boolean; wantCtrl: boolean; wantMeta: boolean;
  wantShift: boolean; wantAlt: boolean; key: string; isFunctionKey: boolean;
}
export function parseHotkey(hotkey: string): ParsedHotkey;          // 平台无关
export function matchHotkey(hotkey: string, e: KeyboardEvent): boolean;   // 用 isMacPlatform
export function hotkeyFromEvent(e: KeyboardEvent): string | null;        // 用 isMacPlatform
export function normalizeHotkey(hotkey: string): string;                 // 平台无关
export function formatHotkey(hotkey: string, isMac?: boolean): string;   // 新增：显示用
// 内部（probe 暴露）：matchParsedHotkey(p, e, isMac)，isMac 默认 isMacPlatform
```

- **`matchParsedHotkey(p, e, isMac)`**：四态全等比对——
  `needMeta = (isMac && p.wantMod) || p.wantMeta`；`needCtrl = (!isMac && p.wantMod) || p.wantCtrl`；
  要求 `e.metaKey===needMeta && e.ctrlKey===needCtrl && e.shiftKey===p.wantShift && e.altKey===p.wantAlt`，
  再比 key（含 `Space`/`PUNCT_CODES` 物理码回退）。**故 mac 下 `Ctrl+P` 不触发 `Mod+P` 绑定**（needCtrl=false
  但 e.ctrlKey=true）→ 镜像 Obsidian「Ctrl+P 在 mac 无效」。
- **`handleKeydown`**：删 `if(e.metaKey) return false`；可编辑元素守卫扩为
  `hasModifier = wantMod||wantCtrl||wantMeta||wantAlt`（裸键/纯 Shift 仍不在输入框触发）。
- **`hotkeyFromEvent`**（设置捕获）：主修饰符录成 `Mod`——mac 把 `metaKey`→`Mod`、非 mac 把
  `ctrlKey`→`Mod`；mac 上单独的 `ctrlKey`（无 meta）→ `Ctrl`。可绑定门控扩为
  `e.ctrlKey||e.metaKey||e.altKey||isFunctionKey`（之前漏 meta）。
- **`formatHotkey`**：display only，不进存储。非 mac：`Mod`→`Ctrl`、`+` 连接（`Mod+Shift+E`→`Ctrl+Shift+E`）。
  mac：Apple 顺序 `⌃⌥⇧⌘` 后接 key，无分隔符（`Mod+P`→`⌘P`、`Mod+Shift+E`→`⇧⌘E`、`Mod+Alt+ArrowRight`→`⌥⌘→`）；
  常见命名键映射符号（箭头→↑↓←→、Enter→↵、Backspace→⌫、Space→␣、Escape→⎋、Tab→⇥）。

**默认键改 `Mod+…` 语义**（mac 下即 ⌘）：`app/App.tsx` 13 处 + `plugins/daily-note.ts` 1 处
`"Ctrl+…"`→`"Mod+…"`（命令面板/快速切换/新建/切换模式/源码/图谱/设置/关 tab/分屏×2/聚焦窗格×2/加属性/日记）。
**无一为 `Mod+C/V/X/A/Z`** → 编辑器 Cmd 剪贴板/全选/撤销不被命令层吞（matchParsed 要求修饰符全等，
Cmd+C 不匹配任何 `Mod+*`；不匹配则 `handleKeydown` 返回 false，事件流向 CM/浏览器）。

**显示接线**：`features/palette/CommandPalette.tsx:116` 与 `features/settings/SettingsModal.tsx`
hotkey chip 把 raw `effective` 改走 `formatHotkey(effective)`；设置页 capture 提示文案按平台呈现
`⌘`/`Ctrl`。冲突检测 `findHotkeyConflicts` 仍比 `normalizeHotkey`（canonical，平台无关），不变。

**probe 钩子**（桌面双分支确定性自检，镜像 R31 `__geodeSlash`）：`main.tsx` 装
`window.__geodeHotkey = { parse, match, format, normalize, isMac }`，`match(hotkey, eventInit, isMac)`
与 `format(hotkey, isMac)` 显式收平台 → 同一二进制内同时验 mac 与非 mac 两分支（host 是 mac 也能测 Ctrl 分支）。

### 文件所有权（本轮串行：core 语法先冻结，消费方随后）

| 区 | 文件 | 改动 |
|---|---|---|
| **core 语法**（先） | `core/commands.ts` | isMacPlatform + Mod 一等化 + 4 函数对齐 + formatHotkey 新增 |
| 默认键 | `app/App.tsx`、`plugins/daily-note.ts` | `Ctrl+…`→`Mod+…` |
| 显示 | `features/palette/CommandPalette.tsx`、`features/settings/SettingsModal.tsx` | `formatHotkey` 接线 + 平台文案 |
| probe | `src/main.tsx` | `window.__geodeHotkey` always-on 钩子 |
| i18n | `core/i18n/dict.*.ts` | 设置页 capture 文案（按需）|

### 显式取舍 / 边界
- mac 下 `Ctrl+P` 不再开面板（Obsidian 同此，物理 Ctrl ≠ Mod）——这是**修复**不是回退。
- 非 mac 下 `Mod` 与 `Ctrl` 都映射 `ctrlKey`，运行时同键但 canonical 不同 → 冲突检测不互判（与 Obsidian 存储模型一致，显式小偏差）。
- compat 插件热键路径（Obsidian `Keymap`/`Scope` for 外部插件）**本轮不动**——那是另一套（compat 自包含、features 不 import），属独立缺口，按需后续。
- `Mod+W`=Cmd+W、`Mod+N`=Cmd+N 等：`handleKeydown` 命中即 `preventDefault`，压住 webview/OS 默认（与 Obsidian 同）。

## Round 31 additions — 斜杠命令 `/` 菜单（slash command menu）【契约冻结 v0.30→v0.31】

> **状态：契约冻结（2026-06-13）。** R25+ 候选池 #⑦（候选池**最后一项**）。官方校准
> （obsidian.md core plugin "Slash commands"，2026-06-13 复核）：编辑器中行首或空白后键入
> `/` 弹命令菜单、随输入过滤、Enter/点击执行所选命令并**删除 `/query` 文本**、Esc 关闭。
> Obsidian 展示「编辑器情境」命令子集；**Geode 取舍 = 展示全部 `available()` 命令**（与命令
> 面板同口径，`available` 门控已隐藏情境不当命令——超集，记 As-built）。
>
> **🚧 分层关键决策**：R6 `EditorSuggest` 管线在 **`compat/obsidian/suggest.ts`**——而
> **features/ 绝不 import compat**（分层铁律）。故**不能**复用 compat EditorSuggest。改**镜像
> 原生 `[[` wikilink 补全所用的 CM6 `@codemirror/autocomplete` 路径**（`cmExtensions.ts`
> `wikilinkCompletionSource` 先例，features/core 可 import `@codemirror/*`）——给
> `autocompletion({override:[...]})` 数组**追加一个 slash 补全源**。两源触发上下文互斥
> （`[[` vs 行首/空白后 `/`），永不同帧 co-fire。

### Core: `core/fuzzy.ts`（**从 `features/palette/fuzzy.ts` 迁入**，core agent 所有）

`fuzzy.ts` 是纯函数（零 import），但位于 `features/palette/`——slash 源在 `features/editor/`
需复用它做一致排序，而 **features 绝不 import 别的 feature**。故**迁入 `core/fuzzy.ts`**
（`fuzzyMatch`/`toSegments`/`FuzzyMatch` 原样搬），更新三处 palette 引用
（`CommandPalette.tsx`/`QuickSwitcher.tsx`/`TemplateSelector.tsx`）`@features/palette/fuzzy`
→ `@core/fuzzy`。**纯搬迁零行为改动**（命令面板/快速切换排序字节级不变）。

### Editor: `features/editor/slashCommands.ts`（新；ui/editor agent 所有）

```ts
import type { GeodeApp } from "@app/AppContext"; // 或 core 的 App 类型（见 cmExtensions 现状）
import type { Command } from "@core/types";
import type { CompletionSource } from "@codemirror/autocomplete";

/** 共享触发正则：行首或空白后的 `/` + 命令名字符（字母数字/连字符）。
 *  `(^|\s)` 门控 = 绝不在词中/URL `://`/wikilink `foo/bar` 里误触发。 */
export const SLASH_RE = /(^|\s)(\/[\w-]*)$/;

/** 纯触发判定（探针 + 源共用）：行首到光标的文本 → {query} 或 null。 */
export function slashTrigger(before: string): { query: string } | null;
  // SLASH_RE.exec(before)；命中返回 { query: m[2].slice(1) }（去掉前导 `/`）。

/** 候选 = 全部 available()!==false 命令，按 fuzzyMatch(query, getCommandName) 降序；
 *  query 空 → 注册表顺序（list() 已按命令名字典序）。探针 + 源共用。 */
export function slashCandidates(app: GeodeApp, query: string): Command[];

/** CM6 补全源：追加进 cmExtensions 的 autocompletion override 数组。 */
export function slashCommandSource(app: GeodeApp): CompletionSource;
  // const line = ctx.state.doc.lineAt(ctx.pos);
  // const before = ctx.state.sliceDoc(line.from, ctx.pos);
  // const m = SLASH_RE.exec(before); if (!m) return null;
  // const slashText = m[2]; const from = ctx.pos - slashText.length;
  // const cmds = slashCandidates(app, slashText.slice(1)); if (!cmds.length) return null;
  // options = cmds.map(c => ({ label: getCommandName(c), apply: (view, _c, from, to) => {
  //   view.dispatch({ changes: { from, to, insert: "" } }); // 删除 /query
  //   app.commands.execute(c.id);                            // 再执行命令
  // }}));
  // return { from, options, filter: false };  // ← 无 validFor，见 As-built C1
```
- **`filter: false` + 无 `validFor`**（**评审后修订**）：自己用 fuzzyMatch 预排序（与命令面板
  一致排序），CM 不二次过滤；**不给 validFor** → CM 每次按键重跑本源 → 候选随输入实时
  重排/收窄（给了 validFor 且 filter:false 会**冻结**列表，见 As-built C1）。SLASH_RE
  不匹配（空格/非命令名字符）→ null → 关闭。`slashTrigger` 内含 **`[[` 未闭合守卫**
  抑制 wikilink 上下文 co-fire（见 As-built M1）。
- **apply 两步 = 两个 CM 事务**：先删 `/query`（光标落回 `/` 处）再 `commands.execute`
  （命令的插入/副作用在该处生效，如 `/date` → 删 `/date` 插日期）。两个 undo 步（命令是
  不透明副作用，不强行合并）。**数据安全**：均走 CM 事务 → autosave 防抖/flush 全覆盖；
  无新 vault 写路径、不手写文件。
- **触发门控**：`(^|\s)` 确保 `and/or`、`http://`、`[[a/b]]` 不误触发；live + source 双模式
  都生效（源在 `buildEditorExtensions` base，非 modeCompartment）。

### `cmExtensions.ts` 接线（editor agent 所有）

`autocompletion({ override: [wikilinkCompletionSource(app), slashCommandSource(app)], icons: false })`
——追加一个源，wikilink 源不动。

### 探针（main.tsx，装 `loadExternal` 之前 —— R27 教训）

`window.__geodeSlash = { trigger(before): {query}|null, candidates(query): string[] }`
（`candidates` 返回命令 id 列表）——驱动桌面 probe 真实 fs 验证触发门控 + 候选排序（apply
全流程靠浏览器 E2E 真实 CM 编辑器：键入 `/` → 弹 `.cm-tooltip-autocomplete` → 选中 →
命令执行 + `/query` 删除）。

### 显式延期（记 ROADMAP）

Obsidian「编辑器情境」命令精选子集（我们展示全部 available 超集）；命令图标（core
`Command` 无 icon 字段，命令面板亦不渲染图标——一致不做）；slash 触发的 `activateOnTyping`
细调 / 自定义 `/` 触发字符；分类分组（Obsidian 平铺，我们亦平铺）；CJK 字符后无空格的 `/`
不触发（`\s` 不含 CJK——与「不在词中触发」一致的显式偏差，minor）。

### As-built（根因修复记录，2026-06-13）

对抗评审 7 维抓获 **1 critical + 1 major + 1 minor**，critical/major **已修**：

- **【C1 critical】菜单不随输入过滤——列表在键入 `/` 那刻被冻结**。根因：初版
  `{ filter: false, validFor: /^\/[\w-]*$/ }`。CM6 在 token 仍匹配 `validFor` 时**复用**结果
  且**停止重查源**，叠加 `filter: false`（CM 不自己过滤）→ 键入 `/ne`、`/new` 选项始终是键入
  `/` 时返回的全量字母序列表（实测复现：`/`→`/ne`→`/new` 三步选项不变）。**初版 E2E 用
  `keyboard.type` 一次性快打被 CM 100ms 去抖掩盖**（只查一次源 = 全 query 一次到位）。修复 =
  **去掉 `validFor`** → CM 每次按键重跑本源 → 每次以新 query 跑 `slashCandidates` 实时重排。
  **教训：`filter:false` 必须配「无 validFor」——validFor 是"别重查、自己 reuse"的优化，与
  自定义排序源互斥；想要实时重排就别给 validFor。E2E 测增量过滤必须逐键带 delay（> CM 去抖），
  一次性打字会假绿。**
- **【M1 major】slash 源在未闭合 `[[` wikilink 内 co-fire**。契约原断言两源「永不同帧」，但
  `[[foo /bar`（链接文本含空格再跟 `/`）两源都匹配 → CM 合并出坏菜单（实测 `[[foo /ne` 弹空
  列表）。修复 = `slashTrigger` 加 **未闭合 `[[` 守卫**（`before.lastIndexOf("[[")>lastIndexOf("]]")`
  → null），源与探针共用该 gate。**教训：「两触发上下文互斥」的断言要把"容器内含触发字符"的
  嵌套情形验进去。**
- **【minor】** CJK 后无空格 `/` 不触发——记显式延期，不改（broaden 反而易误触发 CJK 正文）。

**clean 维**：apply 双事务偏移正确（删 `[slash, cursor]` = 恰 `/query`、命令副作用落回 `/` 处）；
`slashCandidates` 每键 O(n) 可接受、`available()` 廉价无副作用；fuzzy.ts 纯搬迁零行为改动、三处
palette 引用全改 `@core/fuzzy`、无残留 `./fuzzy`；分层（slash 源仅 import core/app/`@codemirror`，
**不碰 compat/别的 feature**）；数据安全（纯 CM 事务，autosave 覆盖，无新 vault 写路径）。

**验证**：浏览器 `r31-e2e` **21/21**（触发门控 6 + 候选排序/可用性 5 + 真实 CM apply 全流程 5 +
**增量实时过滤 C1 锁 2** + **mid-word/wikilink 抑制 M1 锁 3**）+ 桌面 release **probe 10/10**（真实
runtime：触发门控含 wikilink 抑制 + 候选排序/可用性）+ r30 25 / r29 19 不回退 + `r26-bytes` 0
违例（markdown.ts 未动）+ typecheck/cargo/build 绿 + fuzzy 迁 core 后命令面板/快速切换/模板选择
排序零回归。

## Round 30 additions — Properties 侧栏视图（All Properties view + 全局改名 + 值建议）【契约冻结 v0.30】

> **状态：契约冻结（2026-06-13）。** R25+ 候选池 #⑥ / R22 显式延期项收口。R22
> 交付了**文档内**属性面板（live + reading 双模式编辑），但显式延期了三件：
> ①侧栏「All Properties」视图（全库属性浏览）②全局重命名（一个 key 跨全库文件改名 +
> types.json）③属性值跨库建议（datalist）。本轮三件一并补齐。官方校准（obsidian.md
> core plugin "Properties view" + obsidian.d.ts，2026-06-13 复核）：右侧栏 tab、全库
> 属性名列表（类型图标 + 使用计数）、右键属性 → Rename（全库改名）。
>
> **数据安全总原则（本轮第一底线，评审必设维度）**：全局改名 = **R16/R24 verified-rewrite
> 纪律的逐字复刻**——never blind-write、读 fresh（开着的文件读 buffer 而非 cache）、
> 每文件 `buildRenameProperty`（**绝不手写 YAML**）+ post-rewrite 复解析断言、per-file
> try/catch skip+report、module-level `runTail` 串行化、types.json RMW 保未知键。改名
> **绝不重排/重写未被改的字节**（只 splice 单个 key 文本，值字节不动）。

### Core: `core/metadata.ts` 两个聚合查询（core agent 所有，parseNote/parseFrontmatter 零改动）

```ts
/** R30: 每个 frontmatter key → 使用它的文件数（authored casing 同 getPropertyKeys，
 *  大小写不敏感归并取首见）。惰性缓存 per revision（getPropertyKeys 先例）。 */
getPropertyKeyCounts(): Map<string, number>;
/** R30: 给定 key 在全库 frontmatter 中出现过的去重值（string 化、原文呈现、
 *  字典序）。string[] 直接进、string 标量直接进；用于值建议 datalist。
 *  大小写不敏感匹配 key；值层面大小写敏感去重（Obsidian 同口径）。不缓存
 *  （按 key 调用、调用面小）。 */
getPropertyValues(key: string): string[];
```
- 数据源 = `meta.frontmatter?.fields`（`Record<string, string | string[]>`，metadata 的
  简化子集——只有 string/string[]，无 bool/number/null 区分，聚合够用）。
- `getPropertyKeyCounts` 与 `getPropertyKeys` 共享同一 lower→authored 归并，但额外累加
  计数（同一文件同一 key 计 1）。

### Core: 新模块 `core/propertyRewrite.ts`（纯 TS，零新依赖；core agent 所有）

```ts
export interface PropertyRewriteSkip { path: string; reason: string }
export interface PropertyRewriteResult {
  filesChanged: number; propertiesRenamed: number; skipped: PropertyRewriteSkip[];
}
export interface PropertyRewriteDeps {
  vault: Vault; metadata: MetadataIndex; documents: DocumentManager;
}
/** 把 frontmatter 属性键 oldKey 在全库每个用到它的文件里改名为 newKey，并更新
 *  types.json 注册表。镜像 R16 renameWithLinkUpdate 的 verified-rewrite 五步纪律。
 *  返回 {filesChanged, propertiesRenamed, skipped}。绝不抛——逐文件 skip+report。 */
export function renamePropertyAcrossVault(
  deps: PropertyRewriteDeps, oldKey: string, newKey: string,
): Promise<PropertyRewriteResult>;
```
**五步算法（逐字镜像 `linkRewrite.ts` 纪律）**：
1. **入口 guard**：`oldKey`/`newKey` trim 后等值（大小写不敏感）→ 直接返回空 result；
   `newKey` 非法（`isInsertableKey` 在 properties.ts 内部，这里靠 `buildRenameProperty`
   返回 null 兜住）。module-level `runTail` 串行化（R16/R24 先例，失败不毒化后继）。
2. **capture（写前收敛）**：`await documents.flushAll()` →
   `await metadata.ensureFresh(documents.getOpenPaths(), p => documents.get(p)?.getText())`
   （让未保存编辑可见于发现扫描）。然后遍历 `metadata.getAll()`，凡 `frontmatter.fields`
   含 oldKey（大小写不敏感）的 path 收进 affected 集合。空集 → 返回空 result。
3. **逐文件 verified rewrite（串行 for-of，绝不并发）**：
   - 真值源 = `documents.get(path)?.getText() ?? await vault.readFresh(path)`（**never cache**）。
   - `const edit = buildRenameProperty(content, oldKey, newKey)`；null → `continue`
     （key 不在该文件 / opaque / 撞名——非错误，静默跳过，不计 skip）。
   - `const rewritten = content.slice(0,edit.from) + edit.insert + content.slice(edit.to)`。
   - **post-rewrite 断言**：`parseProperties(rewritten)` 必须非 null 且 entries 中存在
     newKey 的可见条目、且不再存在 oldKey；否则 `throw`（落 skip+report，绝不写盘）。
   - 写：开着的文件 `handle.applyExternalEdits([edit])`（CM 事务，一个 undo 步 + 触发
     autosave）；关着的 `await vault.modify(path, rewritten)`（FNV 指纹抑回声）。
   - per-file try/catch：异常 → `result.skipped.push({path, reason})` + `console.warn`，
     绝不中断队列。`filesChanged++ / propertiesRenamed++` 仅在写成功后。
4. **types.json 注册表**：`const oldType = propertyTypes.get(oldKey)`；若有 →
   `await propertyTypes.assign(newKey, oldType)`（regChain 串行 RMW 保未知键，R22 先例）。
   非致命：失败仅 warn，文件改名已成功。（不主动 unassign oldKey——types.json 前向兼容。）
5. **return** result。

> **与 R16 的差异**：R16 改的是 wikilink 正文引用（跨文件指向同一被改名文件）；R30 改的是
> 每个文件**自己的** frontmatter key（互不指向）。所以 R30 无「rename on disk」中间步、无
> 引用解析断言，只有「逐文件 key 文本 splice + 复解析确认」。affected 发现走 metadata 索引
> （frontmatter.fields 已含 key），不需 capture 期建引用图。

### Core: `core/types.ts` + i18n（core agent 所有）

- `RightPanelKind` 追加 `"allproperties"`：`"backlinks" | "outline" | "allproperties" | (string & {})`。
- 新 `core/i18n/dict.allproperties.ts`（namespace `allproperties.*`）：`title`/`empty`/
  `filterPlaceholder`/`usageCount`（`{count} 个文件`复数）/`rename`/`renamePrompt`/
  `renameDone`（`{changed} 改 / {skipped} 跳`）/`renameNoop`/`noFiles` 等；en + zh 双表，
  注册进 i18n dict 索引。`dict.app.ts` 加 `app.tabAllProperties`（tab title）。

### UI: `features/allproperties/`（ui agent 所有）— 右侧栏面板

`AllPropertiesPanel.tsx` + `allproperties.css` + `index.ts`。**只 import core + app/AppContext + app/icons**（分层铁律；绝不 import 别的 feature）。

- **渲染**：`useStore(app.metadata.revision)` + `useStore(propertyTypes.revision)` 触发重算。
  `const counts = app.metadata.getPropertyKeyCounts()`；按 key 名（已含计数）渲染行：
  类型图标（`effectivePropertyType(key, sample, propertyTypes.get(key))`——sample 取该 key
  首个值用于推断）+ key 名 + 使用计数 badge。顶部 filter input（大小写不敏感子串过滤 key）。
- **空态**：库内零属性 → `allproperties.empty` 提示行。
- **行展开（自包含导航）**：点击行 toggle 展开，列出用到该 key 的文件（遍历
  `metadata.getAll()` 筛 `frontmatter.fields` 含该 key，取 basename，字典序）；点文件
  `app.workspace.openFile(path)`。默认折叠态**显式 seed**（R24 教训：用 `expanded.has(key)`
  Set 判定，不靠 `?? true`）。
- **全局改名（右键菜单，镜像 BookmarksPanel 内联菜单模式）**：行 `onContextMenu` → 绝对
  定位菜单 div（state 驱动，document click/Escape 关闭）→ "Rename property" →
  `window.prompt(renamePrompt, key)` 取 newKey → `renamePropertyAcrossVault(deps, key, newKey)`
  → 结果用 `app.notices`（或 console + 面板自刷新）报告 `renameDone {changed,skipped}`。
  改名后 metadata.revision 随 vault.modify/applyExternalEdits 自然 bump → 面板重渲染。
- **testid 面（冻结）**：`allproperties-panel`、`ap-filter`、`ap-row-<key>`、`ap-count-<key>`、
  `ap-file-<basename>`、`ap-menu`、`ap-rename`。
- **App.tsx 集成**：`RightPanelKind` 已加 → 右 tab 栏加 "allproperties" 按钮（icon
  `book-open` 或 `file-text`——选 `book-open` 区别于 backlinks=link / outline=list）+
  `effectiveRight` 三元加分支 + `right-panel-body` dispatch 加 `ws.rightPanel==="allproperties"`
  → `<AllPropertiesPanel />`。

### UI: `features/editor/PropertiesPanel.tsx` 值建议 datalist（ui agent 所有，R22 契约**最小增量**）

- text / multitext 值编辑器附 per-key 值 datalist：`ValueEditor` 的 text fallback
  （`ScalarInput inputType="text"`）与 `ChipsValue`（multitext，非 tags）接受可选
  `valueListId`，指向面板内渲染的 `<datalist id={...}>`（值 = `metadata.getPropertyValues(key)`）。
  tags 的 datalist 保持 R22 既有 tagListId 不变（标签建议 ≠ 值建议）。
- **不动**：number/checkbox/date/datetime/tags/aliases 的编辑语义、提交路径、单 splice
  不变量、20k 闸 `canCreatePropertiesBlock` 全部 R22 冻结不回归。datalist 纯建议、非约束
  （用户可输入任意值）。每 key 一个 `<datalist>`（id 含 uid + key 哈希避撞）。

### 探针（ui agent 所有，main.tsx，装在 `plugins.loadExternal` 之前 —— R27 教训）

`window.__geodeProperties = { rename(oldKey,newKey), values(key), keyCounts() }` always-on
钩子，驱动桌面 probe 真实 fs 全局改名 + 聚合查询校验。

### 显式延期（候选池余项，记 ROADMAP）

跨库属性**删除**（destructive 全库写，数据安全面更大，本轮不做）；属性**类型**侧栏内联改
（仍走文档内面板）；search 集成（点 key 注入 `[key]` 搜索——R21 属性搜索本就延期）；改名
后旧 types.json key 不清理（前向兼容保留）；值建议不含 number/date 类型化建议（按 string
呈现）。

### As-built（根因修复记录，2026-06-13）

实现与契约一致，对抗评审 7 维抓获 **1 critical + 2 minor，全修**：

- **【C1 critical】case-only 改名（`Author`→`author`）对每个文件静默失败 → 整轮报
  "renameNoop"**。根因：post-rewrite「旧键须消失」断言 `hasVisibleKey(rewritten, from)`
  是**大小写不敏感**的（`hasVisibleKey` 两侧 `toLowerCase`）。case-only 改名后文件里
  合法地仍有小写键（那正是被改名的条目），断言把它误判成「旧键残留」→ throw → 每个
  文件落 skip、`filesChanged:0`。Obsidian **支持** case-only 属性改名，故这是行为缺失而
  非仅报错。修复 = 仅当 `from.toLowerCase() !== to.toLowerCase()` 才跑「旧键须消失」检查
  （`to`-visible 检查已证明成功，buildRenameProperty 的撞名守卫已防重复）。**教训：凡
  「改名后旧标识须消失」类 post-rewrite 断言，遇 case-only 改名必须短路——大小写不敏感
  的「存在性」检查会把成功误判成失败。** 已加 `r30-e2e` case-only 回归 + 桌面 probe 实测。
- **【m1 minor】值建议 datalist 对所有类型都渲染 + 每渲染全库扫描**。`getPropertyValues`
  （未缓存、全 `getAll()` 扫描）原本对每个条目无差别 inline 调用，而仅 text/multitext 消费
  `valueListId`。修复 = datalist 仅在 `effType==="text"||"multitext"` 时渲染（其余类型零
  扫描）。
- **【m3 minor】死 i18n 键**（title/noFiles/usageCount 未用）已删；`menu` 接上菜单
  `aria-label`。

**显式保留（m2，非缺陷）**：开着的文件经全局改名走 `applyExternalEdits`（CM 事务），
metadata 重索引要等防抖 autosave flush 后才发生 → 侧栏计数对**开着的**文件短暂滞后（关着的
走 `vault.modify` 立即 bump）。纯视觉滞后、无数据风险，autosave（~数百 ms）后自愈。

**写安全 7 维 clean**（评审逐行对照 `linkRewrite.ts`）：读 fresh（开着读 buffer 否则
`vault.readFresh`，绝不 cache）、每写前 post-rewrite 复解析断言、per-file try/catch
skip+report 不毒化队列、module `runTail` 串行、绝不手写 YAML（恒走 buildRenameProperty）、
计数仅写成功后自增；types.json carry 经 regChain RMW + vault-switch 守卫、前向兼容不清理；
聚合 case-insensitive 归并 + per-file dedup、独立 `propertyKeyCountsCache`（不 clobber
`propertyKeysCache`）按 revision 失效；分层（仅 import core/app、TypeIcon 路径复制避免跨
feature）、CSS 全 `var()`、串全 `t()`；面板默认折叠用 `Set.has`（非 `?? true`，R24 教训）。

**验证**：`r30-e2e` **25/25**（聚合/全局改名 byte-safe/撞名 skip/no-op/case-only C1/开文件
buffer 路径/面板 tab+filter+展开+点开/值 datalist）+ 桌面 release probe **10/10**（真实 fs：
keyCounts/values + 全局改名值字节保真 + case-only 实测）+ r29 19 / r27 22 不回退 + r26-bytes
0 违例（markdown.ts 未动）+ typecheck/cargo/build 绿。

## Round 29 additions — 折叠持久化 + 阅读视图折叠（Fold persistence + reading-view fold）【契约冻结 v0.29】

> **状态：契约冻结（2026-06-13）。** R25+ 候选池 #⑤ / R17 显式债收口。R17 折叠
> （`features/editor/folding.ts` 冻结 ATX 节语义 + fold-all/unfold-all + foldGutter）
> 已就绪，但**折叠态零持久化**（grep foldState 零命中）：live↔source 在 EditorState 内
> 保留（base 扩展），但 **preview↔editor 往返 + tab 关闭重开全丢**。阅读视图仅 callout
> 折叠半截（R18 click 委托 toggle `.is-collapsed`），**标题无折叠**。本轮 =
> ①编辑器折叠态按文件持久化（localStorage，**镜像 Obsidian `{folds, lines}` 形状**）
> + ②阅读视图标题折叠点击委托（运行时视觉 toggle，**不动 markdown.ts 字节管线**）。

### 官方校准（Obsidian fold 持久化形状，已 WebFetch 核实）

- Obsidian 把折叠态存 **localStorage（不入 vault `.obsidian/*.json`）**，**按文件**一条，key
  `${appId}-note-fold-${filePath}`，value = `JSON.stringify(FoldInfo)`：
  ```ts
  interface FoldRange { from: number; to: number } // 0-based 行号
  interface FoldInfo  { folds: FoldRange[]; lines: number } // lines = 存盘时总行数（用于行数漂移对账）
  ```
  `from` = 折叠起始行（标题行 / 列表父项行），`to` = 折叠末行；**无 type 标记**（heading/list/callout
  统一为行区间，apply 时由内容重新判定）；**编辑与阅读视图共享同一条 `FoldInfo`**。
- **Geode 取舍**：**镜像 value 形状**（便于未来导入真实 vault），但**存 localStorage**（不写
  vault `.md`／不写 `.obsidian` → 零新 vault 写路径，数据安全 B 类全免）。key 用 Geode 命名
  `geode.fold.<path>`（与 Explorer `EXPANDED_KEY` 同风格）。

### 决策核心 — `core/foldStore.ts`（**新建**，纯 TS，可 import `@codemirror/state`）

| 导出 | 签名 | 语义 |
|---|---|---|
| `FoldRange` | `{ from: number; to: number }` | 0-based 行号区间（镜像 Obsidian） |
| `FoldInfo` | `{ folds: FoldRange[]; lines: number }` | 镜像 Obsidian；`lines` = 存盘时 `doc.lines` |
| `loadFoldInfo(path)` | `(path: string) => FoldInfo \| null` | 读 `geode.fold.<path>`；try/catch，解析失败/缺失返 null |
| `saveFoldInfo(path, info)` | `(path: string, info: FoldInfo \| null) => void` | `info===null \|\| folds.length===0` → **removeItem**（不留空键）；否则 setItem；try/catch |
| `foldInfoFromState(state)` | `(state: EditorState) => FoldInfo` | `foldedRanges(state)` 字符区间 → 0-based 行 FoldInfo：每段 `from=doc.lineAt(charFrom).number-1`、`to=doc.lineAt(charTo).number-1`，`lines=doc.lines` |
| `foldRangesFromInfo(state, info)` | `(state, info) => {from:number;to:number}[]` | 行→字符回投：跳过 `from+1>doc.lines` 的越界段（文件缩短对账）；`charFrom=doc.line(from+1).to`（折叠起始行末）、`charTo=doc.line(min(to,doc.lines-1)+1).to`；仅保留 `charFrom<charTo` 段 |

- **localStorage 访问全 try/catch**（沿用 Explorer/hover/graph 先例，私密模式/配额异常静默降级会话态）。

### 捕获扩展 — `features/editor/foldPersistence.ts`（**新建**，import `core/foldStore`）

- 导出 `foldPersistence(getPath: () => string): Extension` = 一个 `ViewPlugin`：
  - `update(u)`：若 `u.transactions` 任一 `tr.effects` 含 `foldEffect`/`unfoldEffect`（`e.is(foldEffect)||e.is(unfoldEffect)`）→ **防抖（400ms）** `saveFoldInfo(getPath(), foldInfoFromState(view.state))`。
  - `destroy()`：清防抖 timer + **同步 flush 最后一次 save**（覆盖 preview↔editor / tab 关闭这两个丢失点）。
- **接线**：`cmExtensions.ts` `buildEditorExtensions` 的 base 列表加 `foldPersistence(getPath)`（`getPath` 已是入参 → **不改 buildEditorExtensions/createViewState/EditorPane 调用点签名**，零跨区耦合）。

### 恢复 + 阅读视图标题折叠 — `features/editor/EditorPane.tsx`（B 区）

- **编辑器恢复**（mount effect，`attachView`+会话恢复之后，~L245）：
  ```ts
  const info = loadFoldInfo(handle.path);
  if (info?.folds.length) {
    const ranges = foldRangesFromInfo(view.state, info);
    if (ranges.length) view.dispatch({ effects: ranges.map((r) => foldEffect.of(r)) });
  }
  ```
  foldEffect 事务**无 docChanged → 不触发 autosave**（documents.ts:86 `if(!update.docChanged) return`）、不标 dirty。live/source mount 均恢复；preview mount 无 CM view（不恢复，阅读视图折叠走下条）。
- **阅读视图标题折叠**（`onPreviewClick` 内，callout 分支后、link 分支前）：
  ```ts
  const heading = el.closest<HTMLElement>("h1,h2,h3,h4,h5,h6");
  if (heading && previewContentRef.current?.contains(heading) && !el.closest("a")) {
    e.preventDefault(); toggleHeadingFold(heading); return;
  }
  ```
  `toggleHeadingFold`：从 tagName 取 level；`heading.classList.toggle("is-collapsed")`；遍历 `nextElementSibling` 至**遇到 level ≤ 本级的标题**（节边界）止——折叠则给区间内兄弟加 `geode-heading-folded`（`display:none`）；展开时**尊重嵌套折叠**（遇到自身 `.is-collapsed` 的子标题，显示该标题但跳过其子节，保持子节隐藏）。纯 DOM class toggle、**无 doc 写**（同 callout 折叠语义：re-render 回到初始态——本轮**阅读视图折叠不持久化**，见下「显式偏差」）。
- **CSS**（`features/editor/editor.css`，B 区）：阅读视图 `.markdown-rendered :is(h1..h6)` hover 折叠箭头提示（CSS 变量、`::before` chevron，`.is-collapsed` 旋转）+ `.geode-heading-folded{display:none}`。颜色走变量。

### 探针 — `main.tsx`（A 区，**装在 loadExternal 之前**，R27 教训）

- `window.__geodeFold = { save(path, info), load(path) }`（As-built：`peek` 删去——`load` 已覆盖读路径，无独立需求）：桌面 probe 经此驱动 localStorage 往返真实校验（WKWebView 无 CDP；`foldInfoFromState`/`foldRangesFromInfo` 需 EditorState，由编辑器内部行使，不暴露裸态）。

### 文件所有权表（并行实现，独占文件）

| Agent | 独占文件 |
|---|---|
| **A（core + 捕获 + 探针）** | `src/core/foldStore.ts`（新）· `src/features/editor/foldPersistence.ts`（新）· `src/features/editor/cmExtensions.ts`（加 1 行接线）· `src/main.tsx`（加 `__geodeFold` 探针） |
| **B（恢复 + 阅读视图 + 样式）** | `src/features/editor/EditorPane.tsx`（恢复 + 标题折叠委托）· `src/features/editor/editor.css`（标题折叠样式） |

- B import A 的冻结 API（`loadFoldInfo`/`foldRangesFromInfo` from `@core/foldStore`，`foldEffect` from `@codemirror/language`）。两区零文件重叠。

### 显式偏差（记 ROADMAP 余项）

- **阅读视图折叠不持久化、且不与编辑器共享 `FoldInfo`**：Obsidian 编辑/阅读共享一条 FoldInfo（行号）；Geode 阅读视图 DOM→源行映射需给标题 emit `data-line`（= **改 markdown.ts 字节管线**，违背本轮「不动字节」纪律）→ 本轮阅读视图折叠为**纯运行时视觉态**（re-render 复位），编辑器折叠持久化为行号态。未来如要共享需先在 markdown.ts 给 heading 加 `data-line`（过 r26-bytes 基线重快照）。
- **同文件多 pane**：各 pane 的 ViewPlugin 都 save 同一 path（幂等，last-writer-wins，内容一致）；A pane 折叠不实时同步到 B pane（重开才反映最新存盘——Obsidian 亦按 leaf 渲染）。
- **行数漂移**：`foldRangesFromInfo` 越界段丢弃（文件外部变短）；不做内容级对账（Obsidian 用 `lines` 字段做更细的 reconcile，本轮仅做越界裁剪——fail-safe 方向：丢折叠态不丢内容）。

### As-built（评审 + 双端实测，v0.29）

- **评审 1 major + 2 minor 修复**：① **CSS 泄漏（major）** — 标题折叠样式初版用 `.markdown-rendered :is(h1..h6)`，但 `.markdown-rendered` **也被 hover 预览卡片（HoverPreview.tsx）+ compat `MarkdownRenderer`（util.ts）+ `.preview-content` 复用**（连 hover 卡片都带 `preview-content`！）→ 卡片标题平白得到 `cursor:pointer`+chevron 但点击无效（委托 gated 在 `previewContentRef.contains`）。**修复 = 收窄到 `.markdown-reading-view`**（仅编辑器阅读窗的外层 wrapper，EditorPane.tsx:739；hover/compat/export 均无此类）。**教训：reading 类样式别挂裸 `.markdown-rendered`/`.preview-content`——这俩被 hover 卡片复用；要「仅编辑器阅读窗」用 `.markdown-reading-view`。** ② **越界吞 throw（minor）** — `loadFoldInfo` 的 `isFoldRange` 只校验 `typeof number`，篡改的负/小数 `from` 会让 `doc.line(from+1)` 抛 RangeError、半途中断 mount effect（focusin/active-view 接线漏挂）→ `foldRangesFromInfo` 加 `Number.isInteger && >=0` 守卫（丢折叠不抛）。③ **`__geodeFold` 去 `peek`（minor）**：`load` 已覆盖读路径，契约对齐 as-built（见上探针行）。
- **双端实测全绿**：浏览器 `r29-e2e.mjs` **19/19**（foldStore 探针往返 6 + 真实 CM fold-all→持久化→preview↔editor 往返**恢复**→unfold 清空 4 + 阅读视图标题折叠/嵌套独立/链接守卫 9）；桌面 release probe `r29-probe.js` **4/4**（WKWebView 真实 localStorage 往返 / empty→removeItem / malformed→null / key 落盘）；`r26-bytes` **0 违例**（markdown.ts 零改动，字节管线不动）；typecheck 0 / cargo check 通过。

## Round 28 additions — 文件树拖拽移动（Explorer drag-to-move）【契约冻结 v0.28】

> **状态：契约冻结（2026-06-13）。** R25+ 候选池 #④。Explorer 此前**零 drag 处理**
> （grep onDragStart/onDrop 零命中）。本轮 = 把 HTML5 DnD 接到既有 `renameWithLinkUpdate`
> 写路径上——**纯接线轮，零新写路径、零新依赖**（CLAUDE.md 硬边界 #5）。
> 官方校准（Obsidian 行为，2026-06-13）：文件/文件夹拖到文件夹 = 移动；文件按名自动
> 排序、**不可手动重排**（故与 R3 tab 拖拽不同——**无插入指示线/无 reorder**，只有
> 「放进哪个文件夹」单一落点高亮）；移动即改名、`renameWithLinkUpdate` 自动更新全库链接。

### 数据安全口径（最高优先级 — 移动 = 改名，会改用户 `.md` 文件 + 全库引用）

移动**复用 R27/R16 同一写咽喉** `renameWithLinkUpdate(deps, oldPath, newPath)`（capture →
rename → ensureFresh → verified rewrite → report，自带 flushAll/串行队列/skip 不盲写）。
**本轮不新增任何写路径**——只新增「落点解析 + 守卫」纯逻辑，决定**是否**调用既有写。
四道守卫（全部纯函数、可单测、E2E 必覆盖）：

1. **no-op 守卫**：`parentPath(dragged) === targetFolder` → 不动（已在该文件夹；含「拖到
   同级兄弟文件」「拖到自己所在文件夹空白」）。返回 null，dragover 不高亮、`dropEffect="none"`。
2. **自身/后代守卫**：拖的是文件夹时，`targetFolder === dragged.path` 或
   `targetFolder.startsWith(dragged.path + "/")` → 拒绝（否则把文件夹移进自己 = 环 / 孤儿）。
3. **撞名守卫**：落点文件夹已有同名子项（大小写不敏感，镜像 `validateName`）→ **不写**，
   弹 `explorer.moveCollision` 通知 abort（**绝不覆盖**——数据安全咽喉）。撞名**不**在
   dragover 阻断高亮（结构合法即高亮），在 **drop 时**检测 + 通知，给用户反馈。
4. **陈旧守卫**：drag 期 tree 可能被外部 watcher 刷新——drop 时从 live `tree` 重新解析
   被拖节点；不存在则静默 abort（拖动中文件已被外部移走/删除）。

> 落点解析：hover 文件夹行 → 落点 = 该文件夹；hover 文件行 → 落点 = 该文件的
> `parentPath`（Obsidian 一致：拖到文件上 = 进它所在文件夹）；hover 树容器空白 → 落点
> = 根 `""`。`dropTarget` 状态：`null`=无/非法、`""`=根、`"a/b"`=该文件夹。

### 纯决策核心（`features/explorer/Explorer.tsx` 导出，单一真值 — 组件 drop 与 probe 共用）

```ts
/** 结构合法性（no-op + 自身/后代守卫）→ 落点文件夹路径，或 null。撞名不在此判。 */
export function resolveDropTarget(
  tree: FolderNode, draggedPath: string, hoveredPath: string | null,
): string | null;
/** 落点文件夹是否已有同名子项（撞名守卫，drop 时调）。 */
export function wouldCollide(tree: FolderNode, draggedPath: string, targetFolder: string): boolean;
```

组件 `onDrop` 与 main.tsx 探针 `window.__geodeExplorerMove(fromPath, hoveredPath|null)` 都走
同一序列：`resolveDropTarget` → null 则 `{moved:false, reason}`；`wouldCollide` 则
`{moved:false, reason:"collision"}`；否则 `renameWithLinkUpdate` → `{moved:true, target,
linksRewritten, filesChanged, skipped}`。**探针装在 `plugins.loadExternal` 之前**（R27 教训：
晚于 loadExternal 则外部插件 onload 同步读到 undefined）。

### DOM 接线（HTML5 DnD，借 R3 tab 拖拽的 Chromium 纪律）

- 每行 `draggable={!isRenaming}`（renaming 时关，避免与内联编辑/选区打架）；
  `onDragStart`：`setData(EXPLORER_MIME="application/x-geode-path", node.path)` +
  `effectAllowed="move"` + `setTimeout(()=>setDraggingPath(node.path), 0)`（R3 先例：同帧
  setState 会被 Chromium 取消拖拽）；`onDragEnd` 清 `draggingPath`/`dropTarget`。
- **容器级**（`.explorer-tree`）`onDragOver`：`isExplorerDrag` 守卫 → `preventDefault` +
  读 `e.target.closest('.explorer-item')` 的 `data-path` → 解析 hover 节点 →
  `resolveDropTarget` → 有效则 `dropEffect="move"` + setDropTarget，无效则 `dropEffect="none"`
  + setDropTarget(null)（容器级集中逻辑，免每行挂 handler）；`onDrop` 走 move 序列；
  `onDragLeave`：`!container.contains(relatedTarget)` 才清 `dropTarget`（避免子元素穿越误清）。
- 高亮：行 `is-drop-target`（`node.path === dropTarget`，复用 BookmarksPanel `is-drop-into`
  样式：`background: var(--accent-muted)` + `inset 0 0 0 1px var(--accent)`）；
  根落点（`dropTarget===""`）给容器 `is-drop-root`；源行 `is-dragging`（dim）。
- move 成功后：文件夹则 `remapPaths(expanded)`（R27 commitRename 先例）；
  `expandAncestors(newPath)`（展开落点文件夹让移动项可见）；`setSelected(newPath)`；
  `skipped.length>0` 弹 `explorer.linkUpdateSkipped`（复用 R16 通知）。

### i18n（`core/i18n/dict.panels.ts`，explorer 命名空间）

新增 `explorer.moveCollision`（参数 `{name}`）= "A file or folder named "{name}" already
exists here" / "此处已存在名为"{name}"的文件或文件夹"。

### data-testid / 探针（E2E）

行新增 `draggable` 属性可断言；`is-drop-target`/`is-dragging` 类可断言；
`window.__geodeExplorerMove` 探针驱动真实 fs 的 move（浏览器 Memory + 桌面 WKWebView 双端）。
E2E 必覆盖：移进文件夹（行重挂到新父）+ 链接改写 / no-op 拒绝 / 自身后代拒绝 / 撞名拒绝
（不写）/ 文件夹移动 + expanded remap。**已知限制**：虚拟化大库滚动外的落点需先滚动
（不做 auto-scroll，记缺口）；移动期源行 dim 为锦上添花。

### As-built（评审 2 confirmed minor → 全修；其余 6 维 confirmed-correct）

对抗评审 7 findings：5 维 confirmed-correct（字符串前缀后代守卫 `"Foobar".startsWith("Foo/")`
= false 无误命中、no-op/自身/根落点全对、macOS 大小写撞名两端覆盖、`closest` 从子 span
冒泡正确、`setTimeout(0)` drop-before-state 也安全、i18n/CSS 变量齐备），**2 confirmed
根因已修**：

1. **分层（minor）**：纯决策核心初版导出在 `Explorer.tsx`，但 main.tsx 探针要 import 它
   = bootstrap→feature 耦合（全仓唯一一处 `@features/*` 进 main.tsx；其余探针都 import
   `@core`）。**修复 = 决策核心迁入 `core/explorerMove.ts`**（`EXPLORER_MIME` /
   `findFolder` / `resolveDropTarget` / `wouldCollide`），Explorer 与 main.tsx 都从 `@core`
   引；Explorer 原 local `findFolder` 也删除改引 core（去重）。契约冻结时写在 feature，
   As-built 落 core——单一真值 + 零跨层耦合。
2. **浏览器模式陈旧树覆盖窗口（minor，data-safety）**：`moveNode` 的 `wouldCollide` 读
   React-state `tree`（可能慢一帧），而 `MemoryVaultAdapter.rename` **盲写覆盖**（不像
   Rust `vault_rename` 有 `to.exists()` 守卫，main.rs:243）→ 外部 watcher 在拖拽渲染窗口
   内把同名文件投进落点时，浏览器有极窄覆盖窗口（桌面被 Rust 守卫兜住）。**修复 = 给
   `MemoryVaultAdapter.rename` 加 `to.exists()` 等价守卫**（target 已存在即 throw，镜像
   Rust 后端）——两端 adapter 行为一致，盲写彻底关闭；正常改名/移动上游已 collision-check，
   该守卫只在竞态触发、throw 被 moveNode catch→abort（无丢失）。**教训：凡浏览器
   Memory adapter 与 Tauri 后端都实现的写操作，fail-safe 守卫必须两端对齐**（Rust 有
   `to.exists`/`from===0` 类守卫时，Memory adapter 不能盲写——否则浏览器 E2E 全绿却在
   真实并发下丢数据）。

## Round 27 additions — 书签 Bookmarks（`.obsidian/bookmarks.json` 兼容）【契约冻结 v0.27】

> **状态：契约冻结（2026-06-13）。** R25+ 候选池 #③。补齐「完全缺失」的书签功能。
> 官方校准（obsidian.md/help/Plugins/Bookmarks，2026-06-13）：可书签 file/folder/
> heading/block/search/graph/（web）link 七类 + group 分组（可嵌套）；侧栏面板点击打开、
> 拖拽排序/移组、右键改名/删除/新建组；命令「Bookmark the active tab / heading under
> cursor / block under cursor」。**零新依赖**（CLAUDE.md 硬边界 #5）。

### 数据安全口径（最高优先级 — 这是会写用户 `.obsidian/` 的代码）

书签持久化到 `<vault>/.obsidian/bookmarks.json`——**Obsidian 自己也读写这个文件**，
所以**绝不能破坏 Obsidian 写入的数据**。两条铁律（镜像 `core/properties.ts` types.json
的 RMW 纪律）：

1. **序列化 RMW + 队列**：所有写经一个 module-level promise 链串行（`properties.ts`
   `regChain` / `themes.ts` `appearanceChain` 先例）；每次写**先重读磁盘**当前文件，
   只改 `items`，**保留顶层未知键**；malformed（非对象 / `items` 非数组）→ **abort 写**
   并 `console.warn`（绝不从 `{}` 重写覆盖掉 Obsidian 的数据）。
2. **逐项未知字段保真**：每个书签项可能含 Obsidian 写的我们没建模的键——in-memory 项
   带 `_extra?: Record<string, unknown>`（解析时收集已知字段以外的键），序列化时
   `{ ..._extra, ...canonicalFields }` 先铺 `_extra` 再覆盖规范字段。group 递归。
3. **vault 切换守卫**：写前后比对 `vault.adapter` 身份 + `vault.isOpen`（properties.ts
   `adapterBefore` 先例）；切了库就 skip 写。

### 数据模型（`core/bookmarks.ts`，Obsidian 形状）

文件顶层 = `{ "items": BookmarkItem[], ...其它顶层键保留 }`。`BookmarkItem` 判别联合：

```ts
export type BookmarkType =
  | "file" | "folder" | "heading" | "block" | "search" | "graph" | "group";

interface BookmarkBase {
  ctime?: number;                       // ms epoch，Obsidian 写；新建项由 caller 传入（探针/probe 可传固定值）
  title?: string;                       // 可选自定义显示名
  _extra?: Record<string, unknown>;     // 保真：本模型未覆盖的原始键（序列化时回铺）
}
export interface FileBookmark    extends BookmarkBase { type: "file";    path: string; }
export interface FolderBookmark  extends BookmarkBase { type: "folder";  path: string; }
export interface HeadingBookmark extends BookmarkBase { type: "heading"; path: string; subpath: string; }  // subpath "#Heading"
export interface BlockBookmark   extends BookmarkBase { type: "block";   path: string; subpath: string; }  // subpath "#^blockId"
export interface SearchBookmark  extends BookmarkBase { type: "search";  query: string; }
export interface GraphBookmark   extends BookmarkBase { type: "graph"; }
export interface GroupBookmark   extends BookmarkBase { type: "group";   items: BookmarkItem[]; }
export type BookmarkItem =
  | FileBookmark | FolderBookmark | HeadingBookmark | BlockBookmark
  | SearchBookmark | GraphBookmark | GroupBookmark;
```

### 模块 API（镜像 `core/properties.ts` 的 `propertyTypes` 单例风格）

```ts
export interface BookmarksApi {
  /** 顶层 items 树（含嵌套 group.items）。订阅 useStore 重渲染。 */
  readonly items: Store<ReadonlyArray<BookmarkItem>>;
  /** boot + vault:changed(reason==="load") 调用：从 .obsidian/bookmarks.json 载入。 */
  init(vault: Vault): Promise<void>;
  /** 是否已书签某 file（type==="file" && path 匹配，递归全树）。面板/命令判定用。 */
  isFileBookmarked(path: string): boolean;
  /** 加一项到 groupPath（undefined=顶层）。已存在等价项则 no-op。返回 Promise（持久化完成）。 */
  add(item: BookmarkItem, groupPath?: ReadonlyArray<number>): Promise<void>;
  /** toggle file 书签：未书签则 add file，已书签则移除所有匹配该 path 的 file 项。 */
  toggleFile(path: string): Promise<void>;
  /** 按 index 路径（顶层 [i]，组内 [groupIdx, childIdx, ...]）移除一项。 */
  removeAt(path: ReadonlyArray<number>): Promise<void>;
  /** 改某项 title（空串=清除自定义 title）。 */
  setTitleAt(path: ReadonlyArray<number>, title: string): Promise<void>;
  /** 新建空 group（顶层或组内），返回它的 index 路径。 */
  addGroup(title: string, groupPath?: ReadonlyArray<number>): Promise<void>;
  /** 移动 from → 目标组 toGroup 的 toIndex 处（拖拽排序/移组）。toGroup=[] 顶层。 */
  move(from: ReadonlyArray<number>, toGroup: ReadonlyArray<number>, toIndex: number): Promise<void>;
}
export const bookmarks: BookmarksApi;
```

> **index 路径寻址**：`[2]` = 顶层第 3 项；`[2,0]` = 顶层第 3 项（必为 group）的第 1 个子项。
> 所有变更走序列化队列 + RMW 持久化。内存态 `items` Store 立即更新（乐观），写盘异步。

### 面板契约（`features/bookmarks/BookmarksPanel.tsx`，无 props）

- 复用 `.panel-header`；空态文案 `bookmarks.empty`；树形渲染 group 可展开/折叠
  （折叠态 feature 本地 `useState`，本轮不持久化——与 R17 折叠债一致，注明）。
- **点击打开**（镜像 R25 hover 卡导航，不跨 feature import openWikilink）：
  - file → `openFile(path)`；heading/block → `openFile(path)` 后
    `resolveSubpath(path, subpath)` → `requestReveal(path, from, to)`；
  - folder → `setLeftPanel("explorer")` +（best-effort 选中，本轮可仅切 explorer）；
  - graph → `openGraph()`；search → `setLeftPanel("search")`（query 注入本轮 best-effort，
    无 SearchPanel 程序化 API → 注明缺口，仅切面板/不崩）。
- **右键菜单**（ad-hoc，镜像 Explorer `MenuState{x,y,...}` + 视口 clamp）：Rename / Remove /
  New group。Rename = inline input 或 prompt 风格（feature 自决，走 `setTitleAt`）。
- **拖拽**（镜像 App.tsx tab DnD：私有 MIME `application/geode-bookmark`、`onDragStart`
  setData(index 路径 JSON)、`onDragOver` 算插入位、插入指示线、`onDrop` 调 `bookmarks.move`）。
  组可作为放置目标（拖到组上=移入组）。
- `data-testid`：`bookmarks-panel` / `bookmark-item` / `bookmark-group` / `bookmarks-empty`。

### App / 命令 / 探针接线（集成层，chief 自持）

- `core/types.ts`：`LeftPanelKind` 增 `"bookmarks"`（已是 `(string&{})` 宽松，仅为可读性）。
- `App.tsx`：ribbon 加书签按钮（icon `"bookmark"`，`setLeftPanel("bookmarks")`）；
  左栏 render 分支 `ws.leftPanel === "bookmarks" ? <BookmarksPanel/>`；注册命令：
  - `bookmarks:bookmark-file`（toggle 当前 file，`available` = 有 active md file）
  - `bookmarks:bookmark-heading`（光标所在 heading：取 `documents.getActiveView()` 光标
    offset → `metadata.getMetadata(path).headings` 找 `from<=cursor` 的最后一个 → add
    heading，subpath=`#text`）
  - `bookmarks:bookmark-block`（光标所在 block：`metadata...blocks` 找 `from<=cursor<to`
    → subpath=`#^id`；无现成 block id 的本轮要求光标落在已有 `^id` 块上才可，否则命令
    `available`=false——不自动生成 block id，留作余项）
  - `bookmarks:show`（`setLeftPanel("bookmarks")`）
- `main.tsx`：`void bookmarks.init(vault)` + `vault:changed reason==="load"` 重 init
  （镜像 `propertyTypes.init`）；**always-on probe** `window.__geodeBookmarks`（镜像
  `__geodeRename`/`__geodeHover`——WKWebView 无 CDP，桌面 probe 靠它驱动真实 fs 读写）：

```ts
window.__geodeBookmarks = {
  list: () => BookmarkItem[];                                  // 当前 items 快照（去 _extra 噪音可选）
  toggleFile: (path) => Promise<void>;                          // 走真实持久化
  add: (item, groupPath?) => Promise<void>;
  reload: () => Promise<void>;                                  // 强制从磁盘重 init
};
```

### 文件所有权表（并行实现，独占）

| Agent | 独占文件 | 不碰 |
|---|---|---|
| impl-core | `src/core/bookmarks.ts`（填实现）| 其余一切 |
| impl-panel | `src/features/bookmarks/BookmarksPanel.tsx` + `index.ts` + `bookmarks.css` | core / app / 别的 feature |
| chief（集成）| `src/core/i18n/dict.bookmarks.ts`、`src/core/i18n.ts`、`src/core/types.ts`、`src/app/App.tsx`、`src/main.tsx` | — |

> chief 先落 **stub**（`core/bookmarks.ts` 骨架 + `dict.bookmarks.ts` + i18n 合并 + types）
> 使 `tsc` 0 错误，两 agent 再并行填实现。冻结签名见上，agent 行内注释不得改契约。

### compat 口径（本轮范围）

compat 面 = **数据文件双向保真**（上「数据安全口径」已覆盖：读 Obsidian 写的
bookmarks.json 不丢字段、写回 Obsidian 能继续读）。**`app.internalPlugins`
bookmarks instance API（`getBookmarks()`/`addItem()` 等）本轮不做**——属深 compat，
记入余项（OBSIDIAN-COMPAT 缺口表）。features 绝不 import compat（books 走 `@core/bookmarks`）。

### R27 As-built（v0.27，2026-06-13 — 双端验证通过）

契约按冻结设计落地（core 单例 + 面板 + 4 命令 + 探针）。**2 个并行 implementer
（impl-core / impl-panel，独占文件）+ chief 集成 + 1 个对抗评审 agent（9 维）+ 浏览器
E2E（22 断言）+ 桌面真实 fs probe（8 断言）。** 根因记录：

1. **`move()` 跨容器索引漂移 = 数据丢失（E2E 抓获，静态评审漏网）**：把顶层项移入
   一个**位于其后**的 group 时，`move` 先 `removeAtPath(from)` 再 `insertInto(toGroup)`
   ——但移除使该 group 的索引**前移一位**，`toGroup` 仍指旧位 → 落到越界/错误节点 →
   `insertInto` 找不到 group 静默 no-op，**被移动的书签项被移除却没重新插入＝丢失**。
   修复 = 移除后按移除深度 `depth` 调整目标路径：若 `toGroup` 经由一个「在 `fromIndex`
   之后的同级兄弟」下降（`toGroup[depth] > fromIndex` 且前缀 === parentPath），则
   `toGroup[depth]--`；同容器重排的 `toIndex` 漂移单独处理。教训：**「先删后插」的树
   变更，删除会让目标路径本身漂移，不只是插入下标**——任何 move/reorder 都要把这条
   验进 E2E（本轮 “Beta moved INTO the group” + “no longer at top level” 双断言守住）。
2. **`__geodeBookmarks` 探针主机赋值晚于 `loadExternal`（桌面 probe 抓获）**：探针主机
   原放在 `propertyTypes.init` 之后（≈boot 末尾），但 `plugins.loadExternal`（跑外部
   `.geode/plugins/*.js` 的 onload）在更早执行 → 探针插件 onload 里同步读
   `window.__geodeBookmarks` 时它还 undefined → `bm.reload` 抛错。修复 = 把探针主机赋值
   **上移到 `loadExternal` 之前**（与 `__geodeRename`/`__geodeHover`/`__geodeRenderMarkdown`
   同位）。教训：**任何要给外部/Obsidian 插件 onload 看见的 `window.__geode*` 探针/钩子，
   必须在 `loadExternal` 之前装好**（init 本身可仍按 properties 先例放 vault.load 后）。
3. **评审 1 minor + 1 nit（已修）**：① 未知类型 carrier（`UNKNOWN_TYPE_MARKER`，
   round-trip 保真未来 Obsidian 新书签类型）被 Rename 后，`serializeItem` 的 carrier 分支
   只回铺 `_extra`、丢掉新 `title`/`ctime` → 修复=carrier 分支叠加 item 自身的 title/ctime；
   ② 面板 `labelFor` 对「标题本身以 `#` 开头」的 heading（存 subpath `##tag`）贪婪
   `replace(/^#+\s*/,"")` 把两个 `#` 都吃掉 → 改为只剥一个前缀 `#`（与导航 strip 对齐）。

**subpath 约定（务必记牢）**：bookmarks.json 里 heading/block 的 `subpath` 是 **Obsidian
形状带前导 `#`**（`"#Heading"` / `"#^blockId"`）；而 `core/metadata.ts resolveSubpath`
要的是**去掉 `#`** 的形式（block 以裸 `^` 判别）。所以：**创建**（命令 `headingUnderCursor`
/`blockUnderCursor`）存 `#…`；**导航**（面板 `activate`）先 `.replace(/^#/,"")` 再
`resolveSubpath`。两侧约定不一致就会「存了书签但点了不跳」。

**已知限制（记入候选池余项 / 缺口表）**：① 文件改名/删除**不更新书签路径**（Obsidian 会
更新；`.obsidian/bookmarks.json` 非 .md，不进 R16 改写面）→ 失效书签点击=导航 no-op（不
毁内容）；② search 书签点击仅切到搜索面板、**不注入 query**（SearchPanel 无程序化查询 API）；
③ block 书签**只收已有 `^id` 的块**（不自动铸 block id）；④ 折叠态不持久化（与 R17 折叠债
一致）；⑤ `app.internalPlugins` bookmarks instance API 未做。

## Round 26 additions — PDF/音视频嵌入（`![[x.pdf]]`/`![[a.mp3]]`/`![[v.mp4]]`）【As-built v0.26】

> **状态：已实现并双端验证（v0.26，2026-06-13）。** 契约（下文）按冻结设计落地，
> As-built 见本节末「R26 As-built」。
>
> 补齐 R12 缺口「PDF/音频/canvas 嵌入
> 均降级链接」中的 PDF/音频/视频三类。官方校准（obsidian.md/help/How to/Embed files，
> 2026-06-13）：Obsidian 支持嵌入 audio/video/PDF，PDF 可带 `#page=N`/`#height=N`。
> **零新依赖**（CLAUDE.md 硬边界 #5）：音视频用原生 `<audio>`/`<video>`，PDF 用原生
> `<iframe>`（桌面 WKWebView 与浏览器 Chromium 均原生渲染 PDF）——**不引入 PDF.js**。

### 数据安全口径 + 字节级承诺

纯只读渲染：嵌入只 `readBinary`→blob（feature 私有缓存，文件事件失效，R11 先例），
绝不写任何文件。**改 `core/markdown.ts` 的字节级守卫**：本轮新建
`.calibration/r26-bytes.mjs`（rebuilt r18-diff 等价物，经 `window.__geodeRenderMarkdown`
探针渲染 36 例语料）——markdown.ts 改动**只允许改变 `![[x.{audio,video,pdf}]]` 的
输出**，所有其它用例（含 image/note embed、`![[x.zip]]` 非媒体附件仍降级链接）**字节
不变**（Part-A 不变量）。改动前已 `--baseline` 快照；改动后 `node r26-bytes.mjs` 断言
仅媒体用例变化。

### 共享分类（`core/markdown.ts`，与 `IMAGE_EXTS` 同源——单一真值，避免 emission/
### hydration/live/export 四处漂移）

```ts
export const IMAGE_EXTS: ReadonlySet<string>; // 既有：png/jpg/jpeg/gif/svg/webp/bmp
export const AUDIO_EXTS: ReadonlySet<string>; // mp3/wav/m4a/ogg/oga/opus/3gp/flac/aac
export const VIDEO_EXTS: ReadonlySet<string>; // mp4/webm/ogv/mov/mkv（webm 归 video）
/** 媒体嵌入分类：pdf / video / audio / null（非媒体——保持降级链接）。video 先于 audio 判（webm 归 video）。*/
export function fileEmbedKind(ext: string): "audio" | "video" | "pdf" | null;
/** 路径 → MIME（含 image + audio + video + pdf；未知 → application/octet-stream）。feature blob 缓存与 export 共用，修正媒体 MIME。*/
export function mimeForPath(path: string): string;
```

### 渲染管线（emission：`core/markdown.ts`）

`![[...]]` 嵌入决策在 image 分支后、noteEmbeds 分支前插入 file-embed 分支：

```
if (bang && resolveEmbed) {
  const resolved = resolveEmbed(target);          // resolveAttachment（非 .md）
  if (resolved !== null) {
    const ext = <resolved 扩展名小写>;
    if (IMAGE_EXTS.has(ext)) → <img class="geode-embed" data-embed-path …>   // 既有，不动
    if (fileEmbedKind(ext))  → file-embed 占位（下）                          // 新增
    // 其它附件（zip 等）落空 → 继续 noteEmbeds/legacy link（字节不变）
  }
}
```

file-embed 占位 HTML（异步由 hydration 填充，与 image/note 同构）：

```html
<span class="geode-embed-file" data-embed-path="<resolved>" data-embed-ext="<ext>"
  data-embed-subpath="<subpath 或空>" data-embed-display="<display>"></span>
```

`LinkInfo` 加字段 `fileEmbedPath?: string` + `fileEmbedExt?: string`（复用既有 `subpath`
承载 PDF `page=N`）。emission 仅此一处改 markdown.ts。

### Hydration（`core/embeds.ts`，新增 `hydrateFile` 分支）

`hydrateEmbeds` 增 `span.geode-embed-file[data-embed-path]` 采集 → `hydrateFile`：
按 `fileEmbedKind(data-embed-ext)` 派生元素 —— audio→`<audio controls>`、video→
`<video controls>`、pdf→`<iframe class="geode-embed-pdf">`；`src = await ctx.imageSrc(path)`
（feature 用 `mimeForPath` 给 blob 正确 MIME，故原生播放器/PDF 可渲染）；pdf 的
`data-embed-subpath` 非空时 `src += "#" + subpath`（`page=N` 锚点）；失败 → 占位加
`.geode-embed-failed`、不抛。`ctx.imageSrc` 名义仍是「二进制→url」回调（不改签名）。

### 三态接线（feature owner）

- **阅读视图**：走核心 `hydrateEmbeds`（features/editor/embeds.ts 的 `imageSrc` 用
  `mimeForPath`，MIME_BY_EXT 旧表删除/改为 import 核心）——零额外接线。
- **Live preview**（features/editor/livePreview.ts）：内链嵌入检测在 `IMAGE_EXTS`→
  `EmbedWidget` 后增 `fileEmbedKind`→`FileEmbedWidget`（CM widget，`toDOM` 按 kind 建
  audio/video/iframe，`getEmbedUrl` 取 blob，pdf 拼 `#subpath`）。
- **导出**（features/export/export.ts）：`inlineEmbeds` 的 `imageSrc` 用 `mimeForPath`
  生成 `data:<mime>;base64,…`（媒体以 data-URI 内联，体积偏大但行为正确——记缺口）。
- **CSS**（features/editor/editor.css）：`.geode-embed-file`/`.geode-embed-pdf`/
  `audio.geode-embed-file`/`video.geode-embed-file` 尺寸（max-width 100% / pdf 默认
  高度 / `.cm-live-embed` 同区），CSS 变量。

### Agent 文件所有权（独占）

| agent | 文件 |
|---|---|
| **core（chief 亲自，带字节守卫）** | `core/markdown.ts`（ext 集 + `fileEmbedKind` + `mimeForPath` + emission）、`core/embeds.ts`（`hydrateFile`） |
| editor | `features/editor/embeds.ts`（MIME 改用核心 `mimeForPath`）、`features/editor/livePreview.ts`（`FileEmbedWidget` + 检测）、`features/editor/editor.css`（嵌入样式） |
| export | `features/export/export.ts`（MIME 改用核心 `mimeForPath`） |

> 显式偏差/缺口：canvas 嵌入仍降级（非本轮）；其它附件（zip/docx 等）仍降级链接；
> 导出媒体走 data-URI 内联（大文件体积，记缺口）；PDF 不用 PDF.js（浏览器/WKWebView
> 原生渲染，`#page` 由原生查看器解释，跨平台外观略有差异——可接受）。验收：四条底线 +
> `r26-bytes` Part-A 不变量 + 浏览器 E2E（音视频/pdf 三态出元素、page 锚点、失败降级）+
> 桌面 probe（真实 fs blob 渲染——`__geodeRenderMarkdown` 或 DOM 断言）+ r23/r24/r25 套件不回退。

### R26 As-built（实现修订记录，2026-06-13）

实现与契约一致，编排 = chief 亲自做字节敏感的 core（markdown.ts + embeds.ts）+ 1 editor
agent（live widget + MIME + CSS）+ export（chief，2 行）。**对抗评审 5 维 0 缺陷**
（emission 仅影响媒体附件、escapeHtml 全覆盖无注入、hydration kind 派发 + 失败降级、
live `FileEmbedWidget.eq()` 含 path+ext+subpath、webm→video、MIME 全覆盖、CSS 纯变量）。

**关键基建（字节级守卫，偿还 r18-diff 未重建债）**：改 core/markdown.ts 前先落
`window.__geodeRenderMarkdown(source, sourcePath)` always-on 探针（main.tsx，
`__geodeHover`/`__geodeRename` 同款）+ `.calibration/r26-bytes.mjs`（36 例语料快照/diff，
基线数据 `r26-bytes.baseline.json` 入库）。流程：改动**前** `--baseline` 快照 → 改动 →
diff 断言**仅 4 个媒体用例变化、32 个非媒体用例（含 `![[x.zip]]` 仍降级链接、image/note
embed、全 R18 方言）字节不变**（Part-A 不变量）——实测 0 违反。这套探针 + 语料是后续
任何 markdown.ts 改动的复跑守卫（替代未重建的 r18-diff）。

**显式偏差/缺口（入档）**：① iframe 在 PDF 原生查看器渲染失败时不触发 `error` 事件
（二进制已读成功，故不加 `.geode-embed-failed`——可接受，原生查看器口径）；② 导出媒体
走 data-URI base64 内联（自包含但大文件体积偏大）；③ canvas 嵌入 + 其它附件（zip/docx）
仍降级链接（非本轮）；④ 仓内另有两处 MIME 表（`compat/obsidian/util.ts`、
`features/hover/HoverPreview.tsx`）属未来整合候选，本轮按所有权未动。

**验证**：浏览器 `node .calibration/r26-e2e.mjs` **12/12**（阅读+live 三态出
audio/video/iframe、`#page=N` 锚点、zip 仍链接）+ `r26-bytes.mjs` 36 例 0 违反；
R25 17 / R24 12 / R23 22 不回退；生产 build 绿。桌面 macOS release `geode compat-vault`
+ `r26-probe` **5/5**（`__geodeRenderMarkdown` 真实 fs 发射 audio/video/pdf 占位 +
zip 降级）。

## Round 25 additions — 悬停预览（Page Preview / Ctrl+hover 页面预览卡片）【As-built v0.25】

> **状态：已实现并双端验证（v0.25，2026-06-13）。** 契约（下文）按冻结设计落地，
> As-built 修订记录见本节末「R25 As-built」。
>
> 官方校准（obsidian.md/help/plugins/page-preview，2026-06-13 WebFetch）：Page preview
> 核心插件**默认开启**；**默认无修饰键**——在 File explorer / Search / Backlinks 等
> 处 hover 内链即预览；**编辑视图（live/source）需按住 Ctrl（macOS Cmd）** hover；
> 设置项可「要求所有预览都按 Ctrl/Cmd」。预览内容 = 目标笔记（subpath 链接滚到对应
> heading/block——官方行为，本轮复刻）。
> **R25 范围** = `features/hover/` 悬停控制器 + 预览卡片（复用
> `renderMarkdownToHtml` + `hydrateEmbeds` 渲染管线，**零新依赖**）+ 触发源（内链锚点 /
> explorer 文件行 / backlinks·未链接·outgoing 源项）+ 修饰键规则 + 设置两项 + i18n +
> compat `registerHoverLinkSource` 接通。
> **显式偏差/延期**：plugin 自渲染的 `hoverPopover`/`HoverParent`（插件自己挂预览）
> 保持 gap（Geode 全局 hover 已覆盖其 `a.internal-link`，插件被动受益——记缺口）；
> graph 节点 hover 预览延期（图谱节点非 `a.internal-link`，按需驱动）；嵌入文件
> （`![[x]]`）内的链接 hover 走同一委托自动受益；预览卡片内**再 hover**（嵌套预览）
> 不做（单层，hover 卡片内链接点击 = 导航）。

### 数据安全口径

悬停预览**纯只读**：渲染走既有 `renderMarkdownToHtml`（同 compat/reading 管线）+
`hydrateEmbeds`，**绝不写任何文件**、不改 workspace/tab 状态（不 openFile，除非用户
点击卡片内链接 → 既有 `openWikilink` 导航）。图片走 `vault.readBinary` → blob（feature
私有模块缓存 + 文件事件失效，R11 先例；hover feature 不 import editor 的 blob 缓存——
分层，自建小缓存）。

### 新模块 `core/hover.ts`（纯 TS；core agent 所有）

```ts
import { Store } from "./store";

/** 一次悬停请求的目标（控制器写入，卡片消费）。 */
export interface HoverTarget {
  /** 解析出的目标笔记 vault 路径（已 resolveLink；unresolved → 不预览，控制器不写）*/
  path: string;
  /** subpath（"#heading" / "#^block" 去掉前导 "#" 后的原文；无则空串）*/
  subpath: string;
  /** 触发锚点的视口矩形（卡片定位锚）*/
  rect: { top: number; left: number; bottom: number; right: number };
}

/** 设置 Store（R17/R23 先例：localStorage，消费侧读）。 */
export const pagePreviewEnabled: Store<boolean>;        // geode.pagePreviewEnabled，默认 true（官方默认开）
export function setPagePreviewEnabled(v: boolean): void;
export const pagePreviewRequireModifier: Store<boolean>; // geode.pagePreviewRequireModifier，默认 false
export function setPagePreviewRequireModifier(v: boolean): void;
// false = 官方默认（编辑视图需 Ctrl/Cmd、其余无修饰）；true = 所有来源都需 Ctrl/Cmd

/** 悬停延迟（ms）冻结常量：进入 SHOW_DELAY 后显示，离开 anchor+card HIDE_DELAY 后隐藏。 */
export const HOVER_SHOW_DELAY = 300;
export const HOVER_HIDE_DELAY = 120;
```

### UI: `features/hover/`（新，hover agent 所有）

- `HoverController`（`hoverController.ts`，非 React 或 React effect 均可，挂在卡片
  组件的 useEffect 里）：document 级委托监听 `mouseover`/`mouseout`/`mousemove`/
  `keydown`/`scroll`（capture）：
  - **触发源解析**（首个命中胜出）：① `el.closest("a.internal-link")` →
    `data-target`（空 + 有 `data-subpath` = 同文链接，path=当前笔记）+ `data-subpath`；
    ② `el.closest("[data-hover-path]")`（explorer 行 / backlinks·未链接·outgoing 项，
    见下）→ `data-hover-path` + 可选 `data-hover-subpath`。
  - **修饰键规则**：`pagePreviewEnabled` 关 → 不触发；锚点在 `.cm-content` 内（live/
    source 编辑器）**且** `pagePreviewRequireModifier===false` → 需 Ctrl/Cmd（hover 时
    或 keydown 补触发）；`requireModifier===true` → 所有来源都需 Ctrl/Cmd；其余（reading
    `.preview-content` / sidebar / explorer）→ 无修饰。
  - 解析 target：`metadata.resolveLink(rawTarget, sourcePath)`，**unresolved → 不预览**
    （官方同向，不弹"未创建"卡）。解析得 path → `SHOW_DELAY` 后写 `hoverStore`。
  - 隐藏：离开 anchor 且未进入 card 后 `HIDE_DELAY`；Escape / scroll（卡片外）/ 点击
    卡片内链接导航后 → 立即隐藏。进入 card 取消隐藏计时（可滚动/点链接）。
- `HoverPreview.tsx`（卡片，App.tsx 挂一份）：订阅 `hoverStore`；目标变化时
  `renderMarkdownToHtml(content, {...})` + `hydrateEmbeds(root, ctx)` 注入 ref 容器
  （异步，hover 变更即取消旧渲染——陈旧守卫，R24/R19 先例）；subpath 非空 → 渲染后
  `resolveSubpath` 定位并把卡片滚到该 heading/block（DOM 序号或锚点，R15 reveal 先例）；
  定位 = 锚 rect 下方优先、视口溢出翻转（R10 popup 重定位 rAF 合帧先例）；卡片内
  `a.internal-link` 点击 → `openWikilink` 导航 + 关卡片。`data-testid="hover-preview"`。
- `hover.css`：卡片样式（`--bg-panel`/`--border`/阴影、max-height + 滚动、
  `.preview-content` 复用阅读视图排版）。

### 触发源 data 属性（各 feature owner 加；锚点类无需改——已有 data-target）

- `features/explorer/Explorer.tsx`：文件行加 `data-hover-path={file.path}`。
- `features/backlinks/BacklinksPanel.tsx`：backlinks 源按钮 / 未链接源按钮 / outgoing
  已解析项加 `data-hover-path`（outgoing 未解析项不加——无目标）；未链接/反链片段
  按钮可加 `data-hover-path`（指向源文件）。
- 编辑器内链锚点（reading/live/embed/mermaid）**已带 `data-target`/`data-subpath`**，
  零改动。

### 设置页（SettingsModal.tsx）+ i18n + compat

- 设置：「外观」或新「页面预览」小节两个 toggle —— `settings.pagePreview`（启用，
  默认开）、`settings.pagePreviewModifier`（要求 Ctrl/Cmd，默认关）。testid
  `settings-page-preview` / `settings-page-preview-modifier`。
- i18n：上述 + 节标题，en/zh（dict.views.ts，settings.* 归属）。
- compat：`Plugin.registerHoverLinkSource(id, info)` 由 reportGap stub 升级为**真实
  无操作登记**（记录 source id，返回——Geode 全局 hover 已覆盖插件渲染的
  `a.internal-link`，无需插件参与）；`hoverPopover`/`HoverParent`（插件自挂预览）
  **保持 gap**（缺口表更新一行）。

### Agent 文件所有权（独占，执行时据此分发）

| agent | 文件 |
|---|---|
| core | `core/hover.ts`（新：设置 Store + HoverTarget + 常量） |
| hover | `features/hover/HoverPreview.tsx` + `hoverController.ts` + `hover.css`（新）、`app/App.tsx`（仅挂卡片一行 + hoverStore 提供） |
| sources | `features/explorer/Explorer.tsx`、`features/backlinks/BacklinksPanel.tsx`（仅加 `data-hover-*` 属性） |
| settings | `features/settings/SettingsModal.tsx`、`core/i18n/dict.views.ts`、`src/compat/obsidian/plugin.ts`（仅 registerHoverLinkSource 升级 + hoverPopover gap 注释） |

> `hoverStore`（`Store<HoverTarget | null>`）的归属：放 core/hover.ts 或由 App 在
> bootstrap 建好下放 AppContext——执行时 chief 定（建议 core/hover.ts 导出单例
> Store，controller/card 同源订阅，最省接线）。验收：四条底线 + 浏览器 E2E
> （hover 内链出卡 / 编辑器需 Ctrl / subpath 滚动 / unresolved 不出 / 卡内点击导航 /
> 设置 toggle）+ 桌面 probe（真实 vault hover 渲染——`__geodeHover` 钩子或 DOM 断言）+
> r24/r23 套件不回退。

### R25 As-built（实现修订记录，2026-06-13）

按上述契约落地，编排 = 1 core + 3 并行 agent（hover/sources/settings）+ 集成 +
5 维评审 Workflow。总工程师裁决 2 项 + 评审/E2E 共 6 修复，分述：

**总工程师裁决（契约留给 chief 的两点）：**
1. **`hoverStore` 归属** = core/hover.ts 导出单例 `Store<HoverTarget | null>`（控制器
   写、卡片 `useStore` 订阅），如契约建议——最省接线。
2. **卡内链接点击导航不走 `openWikilink`**。`openWikilink` 在 `features/editor/`，
   跨 feature import 违反分层。卡片持有的 `path` 已是 resolved，故直接
   `app.workspace.openFile(resolved)` + `resolveSubpath` → `requestReveal`（等价
   openWikilink 的 resolved 分支，分层干净；unresolved 永不进卡，故无 create-note 分支需求）。

**评审确认根因（5 维 9 finding → 6 确认 / 3 证伪 → 去重 4 根因 = 1 major + 3 minor）：**
- **[major] subpath 滚动用文本匹配而非 `resolveSubpath` 序号**：原实现按标题
  `textContent` 大小写匹配（精确→子串回退），违反契约「`resolveSubpath` 定位 + R15
  reveal 先例」。失效面：重复标题、`.geode-embed-note` 嵌入副本标题、子串误命中
  （"Intro" 命中 "Introduction…"）。**修复 = 镜像 EditorPane R15**：`resolveSubpath`
  得 span.from → `getMetadata().headings.findIndex(h.from===span.from)` 得文档序序号 →
  index 进 `querySelectorAll("h1..h6")` 过滤掉 `.closest(".geode-embed-note")` 的元素。
  块引用 `#^id` 自然落 ordinal<0 → 不滚（与阅读视图同口径，见延期）。
- **[minor] hover.css box-shadow 硬编码** `0 8px 28px rgba(0,0,0,.32)` → 改
  `var(--shadow-modal)`（主题感知；全仓唯一硬编码 drop-shadow）。
- **[minor] 链接源用全局活动文件而非锚点所在 pane**：控制器原用
  `workspace.getActiveFile()` 作 resolve 源路径；非聚焦分屏内 hover 重名链接、或
  graph tab 活动时 hover 自链 `[[#h]]` 会误解析到别的 pane 的笔记。**修复 =
  EditorPane 根 div 加 `data-leaf-path={tab.filePath}`（chief 授权的跨所有权一行非
  行为属性）+ 控制器 `el.closest("[data-leaf-path]")` 取锚点所在 pane 源路径，回退
  getActiveFile()**（侧栏源走全路径 data-hover-path，不受影响）。
- **[minor] keydown 重触发对非本平台修饰键放行**：原 `e.key==="Control"||"Meta"`
  双键放行，macOS 按 Control（非 Cmd）也越过 `hasModifier()` 平台门。**修复 = gate
  到本平台键**（Apple→"Meta"，否则→"Control"）。
（证伪 3：块引用「无 DOM 标记」非缺陷而是 R15 同口径；blob 缓存模块级不在卸载全 revoke
——materiality 证伪；陈旧 body 写——已被 cancelled/store 守卫兜住。）

**浏览器 E2E 另抓 2 个评审漏网缺陷（静态评审看不到、必须实跑）：**
- **live-preview 内链根本不是 `a.internal-link`**：CodeMirror live preview 折叠
  wikilink 渲染为 `span.cm-live-wikilink[data-link-target]`（+ `data-link-subpath`，
  空 target=自链），**不带 `data-target`/`a.internal-link`**（契约「编辑器锚点已带
  data-target」与实际编码不符）。原控制器 `closest("a.internal-link")` 整个漏掉它 →
  **最常用的编辑视图悬停完全不触发**。**修复 = `extractTrigger` 增第二触发源
  `.cm-live-wikilink`**（`data-link-target`/`data-link-subpath`，inEditor=true）。
  教训：契约对锚点 DOM 形状的断言务必以实际渲染管线为准——reading 与 live 的内链编码
  不同源（reading=核心 markdown 管线 `a.internal-link`；live=CM 装饰 `cm-live-wikilink`）。
- **subpath 滚动竞态**：`placeCard` 把 max-height 设在 `requestAnimationFrame` 里
  （合帧），但渲染链（read+hydrate，内存 vault 极快）常在该 rAF 前完成 →
  `scrollToSubpath` 跑时卡片尚未受 max-height 约束 → 内容不溢出 → `scrollTop` 夹到 0
  （真实磁盘读较慢时偶发可滚——flaky）。**修复 = subpath 滚动包进 `requestAnimationFrame`
  并补 cancelled/store 陈旧守卫**，落在定位帧之后再滚。教训：依赖「尺寸已定 + 内容
  已渲染」两个异步前置的 DOM 读写，必须排到二者都落定的帧。

**验证**：浏览器 `node .calibration/r25-e2e.mjs` **17/17**；R24 12/12、R23 22/22 不
回退；生产 build 绿。桌面 macOS release `geode compat-vault` + `r25-probe` **7/7**
（`__geodeHover` 真实 fs resolve→read→render，含 unresolved→null）。可复跑资产：
`.calibration/r25-e2e.mjs`（17 断言，需 dev server）、`compat-vault/.geode/plugins/
r25-probe.js`（7 断言，重跑前删 `r25-results.md` + `__r25/`）。

**显式延期/缺口**：块引用 `#^id` 子滚动——阅读视图 R15 reveal 同样只认 heading 序号
（块标记 R13 剥离、无 DOM 锚），卡片停顶部 = 一致行为；补块滚动需给 markdown.ts 加块
DOM 标记（动字节管线 → 须先重建 r18-diff，缓做）。插件自渲染 `hoverPopover`/
`HoverParent` 保持缺口（Geode 全局 hover 已覆盖其 `a.internal-link`，插件被动受益）。
嵌套预览（卡内再 hover）不做。图谱节点 hover 延期。backlinks 片段按钮 hover 官方
「可加」未加。

## Round 24 additions — 未链接提及（Unlinked Mentions / 反链面板扩展）

> 官方校准（obsidian.md/help/plugins/backlinks，2026-06-13 WebFetch）："Unlinked
> mentions are backlinks to any unlinked occurrence of the name of the active
> note"——即活动笔记**名字**（basename + frontmatter aliases）在别的笔记正文里
> **没被 `[[..]]` 链接**的明文出现。官方 UI：反链面板「Linked mentions」节之下一个
> 「Unlinked mentions」节，按源文件分组，每个提及有「Link」把该处明文转成
> wikilink，每个文件组有「Link all」一键链接该文件内全部提及；面板级
> Collapse results / Show more context / Excluded files 控件作用其上。
> **R24 范围** = core/unlinkedMentions.ts 匹配引擎 + 链接改写引擎（R16 写纪律）+
> BacklinksPanel「未链接提及」节（异步扫描 + 每条 Link + 每文件 Link all）+
> i18n。compat 零改动（官方 Backlinks 插件 API 不在公开 d.ts，无缺口表条目）。
> **显式偏差/延期**：Excluded files 模式（Geode 无该设置——扫全库除活动文件
> 自身）；面板级 Collapse/Show-more-context/排序/搜索过滤工具栏（沿用既有 Section
> 折叠模型，源文件按 path localeCompare 排序，片段取命中行）；点击提及只
> openFile 不滚动到该 offset（subpath reveal 是 heading/block 锚点，明文 offset
> 定位延期——minor 偏差）；只匹配 basename + aliases，**不**匹配 headings/标签
> （官方"name of the active note"口径）。

### 数据安全口径（本轮第一底线——Link 动作写**别的**文件）

「Link」/「Link all」改写的是源文件（可能正在编辑器里打开），一律走 **R16
linkRewrite 写纪律**：① 模块级 `runTail` 串行化（本模块独立队列；与 rename 引擎
跨模块重叠为微秒窗口，双方都 flush+ensureFresh+fresh-read+校验，最坏 skip+报告，
入已知限制）；② 写前 `documents.flushAll()` + `metadata.ensureFresh(openPaths,
getText)`；③ 真值源 = 打开的 buffer（`documents.get`）否则 `vault.readFresh`
（**绝不读 content cache**——watcher 防抖窗口内的外部改动对 cache 不可见）；
④ **从 fresh 内容重新派生提及**（`findUnlinkedMentions` 重扫，offset 构造性正确）
——扫描期的旧 offset **绝不**直接 splice；⑤ 应用 = 打开 buffer 走
`handle.applyExternalEdits`（单 CM 事务、undo 一步、标脏 + 防抖保存），关闭文件走
`vault.modify`（回声指纹抑制）；⑥ 逐文件 try/catch，任何不一致 skip + 报告，
绝不盲写。扫描（只读 `vault.read`）不碰这些纪律。

### 新模块 `core/unlinkedMentions.ts`（纯 TS 零依赖；core agent 所有）

```ts
import type { NoteMetadata } from "./types";
import type { Vault } from "./vault";
import type { MetadataIndex } from "./metadata";
import type { DocumentManager } from "./documents";

/** 一处明文提及：[from,to) 为源文件 content 的字节区间，text = 命中的原文 */
export interface MentionSpan { from: number; to: number; text: string }

/** 活动笔记的匹配词条 = basename（去 .md）+ 全部 aliases；大小写不敏感去重、
 *  去空白空串。供面板派生一次、对全库源文件复用。 */
export function deriveMentionTerms(meta: NoteMetadata): string[];

/** 在源文件 content 中找出 terms 的未链接明文出现（冻结语义）：
 *  - 屏蔽（同长空白替换，offset 与 content 对齐）后扫描：frontmatter 区
 *    （parseFrontmatter.to）+ 代码围栏/行内代码（maskCodeRegions）+ 既有
 *    wikilink span（sourceMeta.links 的 from/to）+ 标签 span（sourceMeta.tags
 *    中 from>0 的 `#tag`，长度 1+tag.length）——故 `[[Name]]`/`#Name`/代码内
 *    /frontmatter 内的名字都不算未链接提及。
 *  - 大小写不敏感子串匹配。
 *  - **边界规则（CJK 感知，冻结）**：定义 isLatinWord(ch) = ch ∈ \p{L}\p{N}_
 *    且 ch 非 CJK（Han 含扩展/假名/谚文/全角）。某一侧边界**失效**（非词界）
 *    当且仅当命中串该侧的内缘字符与紧邻外部字符**都** isLatinWord（= 会切断
 *    一个拉丁词）。两侧都不失效才是合法提及。效果：拉丁词 "Note" 不命中
 *    "Notebook"（内 e + 外 b 都拉丁 → 失效）；CJK 名 "未链接提及" 命中
 *    "这是未链接提及的例子"（内/外 Han 非 isLatinWord → 不失效，按子串命中——
 *    CJK 无词隔，官方同向）；CJK 紧邻拉丁、词紧邻空白/标点/文首尾均合法。
 *  - **重叠去重**：跨 terms 收集全部候选，按 from 升序、长度降序，左到右贪婪
 *    取非重叠（取最长，避免嵌套链接）。
 *  - 永不抛。 */
export function findUnlinkedMentions(
  content: string,
  sourceMeta: NoteMetadata,
  terms: readonly string[],
): MentionSpan[];

export interface MentionLinkDeps { vault: Vault; metadata: MetadataIndex; documents: DocumentManager }
export interface MentionLinkResult {
  filesChanged: number;
  mentionsLinked: number;
  skipped: Array<{ path: string; reason: string }>;
}

/** 链接源文件内 activePath 的全部当前未链接提及（从 fresh 内容重扫，链接所有）。
 *  插入文本：surfaceText = 命中原文；若 `resolveLink(surfaceText, sourcePath)
 *  === activePath` → `[[surfaceText]]`（原文即可解析，含 alias/任意大小写——
 *  Obsidian 同口径）；否则用消歧全路径 `[[fullPathNoExt|surfaceText]]` 并校验
 *  其 resolveLink === activePath，再不成则 skip+报告。改写按升序 splice 重建
 *  字符串、一次 applyExternalEdits/modify。 */
export function linkAllMentionsInFile(
  deps: MentionLinkDeps,
  activePath: string,
  sourcePath: string,
): Promise<MentionLinkResult>;

/** 链接源文件内某一处提及：从 fresh 重扫，按 (text, 近似 from) 定位唯一命中
 *  （精确 from 优先，否则同 text 最近者，容差外 → skip+报告"content changed"）。
 *  其余写纪律同上。 */
export function linkOneMention(
  deps: MentionLinkDeps,
  activePath: string,
  sourcePath: string,
  target: MentionSpan,
): Promise<MentionLinkResult>;
```

### `core/metadata.ts` 微调（core agent 所有；行为保持）

导出 `export function maskCodeRegions(s: string): string`（= 现有
`.replace(CODE_FENCE_RE).replace(INLINE_CODE_RE)` 同长空白逻辑），`parseNote`
内联处改调它——**纯抽取，字节行为不变**（parseNote 既有语义冻结）。
`unlinkedMentions.ts` 复用它做屏蔽，避免围栏/行内代码识别两处分叉。

### UI: BacklinksPanel 扩展（features/backlinks/，ui agent 所有）

「Outgoing links」「Tags」之间（或 Linked mentions 之下、Outgoing 之上——
按官方紧贴 Linked mentions）插入新 `<Section>`「未链接提及」
（`bl-section-unlinked` testid）：

- **异步扫描**（R21 SearchPanel 先例）：useEffect/useMemo+异步 IIFE，键
  `[activePath, rev]`；派生 terms（活动 meta），对 `metadata.getAll()` 中
  `path !== activePath` 的每个源文件 `await vault.read(path)` →
  `findUnlinkedMentions` → 收集 `{sourcePath, items:[{from,to,text,snippet,
  markFrom,markTo}]}`（snippet 在 feature 层用 content 现成构造，命中相对偏移
  渲染 `<mark>`，复用 search 高亮先例）。**可取消 + 陈旧守卫**：闭包内
  `cancelled` 标志 + 完成时比对 activePath；revision/activePath 变即丢弃在途
  结果。**Loading 态**：扫描中节标题计数显示占位（`backlinks.scanning` 行）。
  count = 全部源文件提及总数。section 默认折叠（官方默认折叠未链接节）。
- **每文件组**：源文件名（点击 openFile）+ 该文件提及计数 + 「Link all」按钮
  （`bl-link-all` testid，调 `linkAllMentionsInFile`）。
- **每条提及**：高亮片段（点击 openFile——offset 滚动延期）+ 「Link」按钮
  （`bl-link-one` testid，调 `linkOneMention`）。
- **Link 后**：vault 改动 → 索引 reindex → revision bump → 自动重扫，该提及
  从「未链接」消失、转入「Linked mentions」。Link 期间按钮 busy 守卫（防重入
  双写，R23 LIFE 教训）；引擎返回 skipped 非空 → console.warn（重扫即反映真相，
  不弹错；与 linkRewrite 报告口径一致）。

### i18n（dict.panels.ts，backlinks.* 命名空间，ui agent 所有；en/zh 双语）

`backlinks.unlinkedMentions`（"Unlinked mentions"/"未链接提及"）、
`backlinks.noUnlinked`（"No unlinked mentions"/"没有未链接提及"）、
`backlinks.scanning`（"Searching…"/"搜索中…"）、`backlinks.linkMention`
（"Link"/"链接"）、`backlinks.linkAll`（"Link all"/"全部链接"）。

### Demo vault 夹具（core/vault.ts DEMO_FILES + demo-vault 磁盘，core agent 所有）

新增确定性夹具供浏览器 E2E：`Zettelkasten.md`（frontmatter `aliases: [ZK]`）+
`On Knowledge.md`（正文含未链接 "Zettelkasten" ×N、alias "ZK" ×1、已链接
`[[Zettelkasten]]` ×1、代码 `` `Zettelkasten` `` ×1 应排除、负向 "Zettelkastens"
复数应因词界不命中）。磁盘 demo-vault 同步两文件（双端一致先例）。

### Agent 文件所有权（独占）

| agent | 文件 |
|---|---|
| core | `core/unlinkedMentions.ts`（新）、`core/metadata.ts`（仅导出 maskCodeRegions + parseNote 内联改调）、`core/vault.ts`（仅 DEMO_FILES 增条目）、`demo-vault/Zettelkasten.md` + `demo-vault/On Knowledge.md`（新） |
| ui | `features/backlinks/BacklinksPanel.tsx`、`features/backlinks/backlinks.css`、`core/i18n/dict.panels.ts` |

`core/types.ts` 本轮不动（MentionSpan 等类型定义在 unlinkedMentions.ts，ui 从该模块 import）。

### R24 As-built deltas（评审后修订记录）

执行 = Workflow 并行 agent（core 引擎 / ui 面板，独占文件所有权）+ 集成 typecheck。
评审 5 维 Workflow（数据安全 / 对抗性输入 / 契约符合性 / 生命周期竞态 /
分层-i18n-性能，18 agent）：**13 finding → 对抗验证 7 确认 / 6 证伪，去重 5 根因
（2 major + 3 minor）全修复**；浏览器 E2E 另抓 1 个评审漏网的 UI 缺陷（共 6 处修复）：

- **major DS-1（masking 漏洞）**：源文件**首字节**就是 `#tag`（无 frontmatter）时，
  TAG_RE 的 `^` 空匹配使该正文标签 `from===0`，与合成 frontmatter 标签同值，被
  `buildMasked` 的 `if (tag.from > 0)` 守卫漏掉——`#Name` 被误报为未链接提及，
  Link 把合法标签改写成 `#[[Name]]`（关闭文件即静默落盘损坏）。R16 fresh-rederive
  无济于事（同一 matcher 缺陷）。修复 = 按**实际字节**门控 `content[tag.from] === "#"`
  （正文标签恒指向 `#`；合成 frontmatter 标签 from=0 指向 `---` 的 `-`，且已被
  frontmatter 区屏蔽）。**冻结 masking 规则更正**：标签屏蔽判据由 "from>0" 改为
  "该字节为 `#`"。
- **major DS-2（写校验缺失）**：`buildLinkInsert` 对 `resolveLink(surfaceText)===
  activePath` 即输出 `[[surfaceText]]`，但 `resolveLink` 不解析 wikilink 语法而
  `WIKILINK_RE` 解析——名字/别名含 `# | [ ]`（如 `C#`/`F#`/`a|b`）时 `[[C#]]`
  回解析为 target "C"，写出**指向错误笔记或损坏**的链接，且**无 R16 那道
  post-rewrite 断言**兜底（契约声称"完全镜像 R16"实则漏了 linkRewrite.ts:286-295
  的复解析校验）。修复 = doLink 补 post-rewrite verification：重建串后 `parseNote`
  复解析，逐 edit 按 post-edit offset 定位插入链接并断言 `resolveLink === activePath`，
  不符即 throw → 既有 try/catch 转 skip+报告，绝不盲写。此类名 Obsidian 本就非法
  （标题禁 `# ^ [ ] |`），skip 是忠实结果。**写纪律新增第 ⑤.5 步：应用前 post-rewrite
  复解析校验。**
- **minor IN-1（subpath 链接漏屏蔽）**：同文链接 `[[#Heading]]`/`[[#^block]]`
  无 target，WIKILINK_RE 不收进 `sourceMeta.links`，未被屏蔽——名字命中其中会被
  误报、Link 写成 `[[#[[Name]]]]`。修复 = buildMasked 增一道
  `/\[\[#[^[\]]*\]\]/g` 屏蔽（**第 5 个 mask 源**）。
- **minor LC-1（闪烁）**：扫描占位 `{scanning ? …}` 在每次 revision bump（活动笔记
  每次自动保存都 bump）把已填充列表整段闪成 "Searching…"，偏离所引 SearchPanel
  先例。修复 = 门控改 `scanning && unlinked.length === 0`（已有结果时后台重扫不闪）。
- **minor I18N-1**：zh `backlinks.noUnlinked` 漏全角句号（与同 dict 全部空态串不
  一致）。修复 = "没有未链接提及。"。
- **UI-1（E2E 抓出，评审漏网）**：未链接节默认折叠用 `collapsed.unlinked ?? true`，
  但 collapsed state 初值 `{}`——toggle 的 `!c[key]` 首点算 `!undefined === true`
  仍折叠，**首次点击展不开**。修复 = 初值 `{ unlinked: true }` + 节 prop 改
  `!!collapsed.unlinked`（首点 true→false 正常展开）。教训：默认折叠节的折叠态必须
  显式 seed，不能靠 `?? true` 默认值——toggle 语义会与之打架。

证伪 6（对抗验证驳回，记录于评审产物）：eager 全库扫描（折叠态也扫——计数徽标
Obsidian 恒显需要，契约冻结）；rev-bump 重扫（正确的最小失效信号，且 cancelled
标志已合帧）；Link-one/Link-all 同文件并发（引擎 runTail 串行 + fresh-rederive，
最坏 skip，无数据风险）；开 buffer 链接后 metadata.revision 滞后到防抖保存（全应用
reindex-on-save 模型，自愈，与 Linked mentions 同口径）；折叠态计数瞬时陈旧（占位
是 body 行，折叠不可见）；matcher 热循环分配（只读扫描、跨 await 分散、契约采纳
SearchPanel 同款 per-file 同步匹配）。**性能优化采纳为后续候选**（热循环首字符
小写门控、保存 burst 去抖 300-500ms——非缺陷，记 ROADMAP）。

验证：浏览器 E2E `.calibration/r24-e2e.mjs` **12/12**（检测 basename+alias / 排除
既有链接·行内代码·复数词界 / Link-all 改写+surface 保留 / CJK 子串匹配 /
**DS-1 tag@0 排除** / **DS-2 C# 跳过文件零改动**）；R23 templates E2E 22/22 不回退
（maskCodeRegions 纯抽取 + DEMO_FILES 仅增条目，零回归）；生产 build 绿。
桌面 probe（见 OBSIDIAN-COMPAT R24 套件回归）经 `window.__geodeUnlinked` 钩子
（main.tsx，`__geodeRename` 同款）驱动真实 fs 写。

## Round 23 additions — 模板系统（Templates 核心插件复刻 + 新建套模板）

> 官方校准（obsidian.md/help/plugins/templates，2026-06-13 WebFetch）：设置三项
> Template folder location / Date format（默认 `YYYY-MM-DD`）/ Time format（默认
> `HH:mm`）；命令 "Insert template"（选择器，光标处插入）+ "Insert current date" +
> "Insert current time"；变量 `{{title}}`（活动笔记标题）/`{{date}}`/`{{time}}`，
> date/time 支持冒号后 Moment.js 格式令牌（`{{date:YYYY-MM-DD}}`）。
> **R23 范围** = core/templates.ts 变量引擎 + 模板枚举 + 设置三项 + TemplateSelector
> 选择器 modal + 四命令（insert-template / new-note-from-template / insert-date /
> insert-time）。**「从模板新建笔记」是 Geode 显式扩展**（官方核心插件无此命令，
> 候选池口径"新建套模板"）。
> **显式偏差/延期**：官方模板文件夹默认未设置——Geode 默认 `"templates"`（demo 可用性，
> 空设置 = 未配置语义保留）；ribbon 按钮不做（命令面板 + 可自定义快捷键覆盖）；
> 日记/Unique note creator 插件的 `{{date+Nd}}` 偏移语法不做（官方 Templates 页无此
> 语法）；模板内嵌套变量（替换值再扫描）**显式不做**（单趟替换，见冻结语义）；
> Obsidian 官方"模板文件夹笔记不排除于库"同口径（模板笔记照常进索引/搜索/图谱）。

### 数据安全口径

插入 = 经活动 EditorView 单事务 dispatch（共享文档模型 undo 一步、标脏 + 防抖保存
既有链路）；模板文件本身**永不被改写**（只读展开）；新建笔记走 `vault.uniquePath`
防撞 + `vault.create`（已存在路径绝不覆盖）。

### 新模块 `core/templates.ts`（纯 TS；moment 经 `moment/min/moment-with-locales`
import——与 compat 同 specifier 单实例，主 chunk 零增长；core agent 所有）

```ts
/** 设置 Store（R17 attachmentFolder 先例：存原文不 trim，消费侧 trim） */
export const templateFolder: Store<string>;       // localStorage geode.templateFolder，默认 "templates"
export function setTemplateFolder(v: string): void;
export const templateDateFormat: Store<string>;   // localStorage geode.templateDateFormat，默认 ""（空 = YYYY-MM-DD）
export function setTemplateDateFormat(v: string): void;
export const templateTimeFormat: Store<string>;   // localStorage geode.templateTimeFormat，默认 ""（空 = HH:mm）
export function setTemplateTimeFormat(v: string): void;

/** 选择器打开模式（一次性语义：命令先 set 再 openModal("templates")，modal 挂载时读取） */
export const templatePickerMode: Store<"insert" | "create">;

export interface TemplateInfo { path: string; name: string }  // name = basename 去 .md
/** 模板枚举：folder = templateFolder 消费态（trim + 剥首尾斜杠）。
 *  空串/含 ""|"."|".."|点前缀段 → null（= 未配置/非法，选择器显示配置提示，不抛）。
 *  否则返回 folder 下（含子文件夹递归）全部 .md，name 字典序（localeCompare）。
 *  文件夹不存在/无 md → []（选择器显示空提示）。 */
export function listTemplates(vault: Vault): TemplateInfo[] | null;

/** 变量展开（冻结语义）：
 *  - 识别 /\{\{(title|date|time)(?::([^}]*))?\}\}/gi —— 变量名大小写不敏感
 *    （官方未文档化，冻结为不敏感）；格式串 = 冒号后至最近 "}}"，原文传给
 *    moment(now).format(fmt)，不含 "}" 字符（[^}]*，更长贪婪不做）。
 *  - {{title}} → ctx.title（字面替换）；{{title:...}} 不是变量，原文保留。
 *  - {{date}} → moment(now).format(dateFormat 消费态)；{{date:FMT}} → format(FMT)；
 *    {{time}}/{{time:FMT}} 同理走 timeFormat。FMT 为空串（"{{date:}}"）→ 同
 *    {{date}}（设置消费态；设置为空才落 YYYY-MM-DD/HH:mm——评审 R23-F1 勘误）。
 *  - **单趟替换**（String.replace 回调一次扫描）：替换值不再被扫描——
 *    title 含 "{{date}}" 不二次展开（对抗性输入口径）。
 *  - 纯文本变换，永不抛（moment.format 对任意串安全）。 */
export function expandTemplate(content: string, ctx: { title: string; now: Date }): string;
```

### 命令四条（App.tsx 注册，ui agent 所有；无默认快捷键——官方同口径，
Hotkeys 设置页可自定义）

- `editor:insert-template`（name `cmd.insertTemplate`）：`available` = 活动 tab 有
  filePath；callback：tab.mode === "preview" → `setTabMode(tab.id, "live")`（官方
  "光标不在正文则插到上次光标位"的 Geode 对应口径 = 翻到可编辑模式，add-property
  先例）；`templatePickerMode.set("insert")` → `openModal("templates")`。
- `app:new-note-from-template`（name `cmd.newNoteFromTemplate`）：无 available 门
  （不需要活动文件）；`templatePickerMode.set("create")` → `openModal("templates")`。
- `editor:insert-date` / `editor:insert-time`（name `cmd.insertDate`/`cmd.insertTime`）：
  `available` = `documents.getActiveView() !== null`；callback 取 active view，按
  对应格式（消费态，空 → 默认）`moment().format(...)` 后在当前选区单事务
  replace（光标落插入文本末尾）。
- 选择器内确认动作：
  - insert 模式：`documents.getActiveView()` 取 view 与 path；title = path basename
    去扩展名；`vault.read(模板 path)` → expandTemplate → 在 view 当前主选区
    `dispatch({ changes: {from, to, insert}, selection: { anchor: from+insert.length } })`
    （选区非空 = 替换选区，官方"光标处插入"的超集口径）→ closeModal。
    view 为 null（极端竞态）→ closeModal + console.warn，零写入。
  - create 模式：`vault.uniquePath("", template.name)` → title = 实际唯一路径的
    basename 去扩展名（"Meeting 1" 而非 "Meeting"）→ expandTemplate →
    `vault.create(path, expanded)` → `workspace.openFile(path)` → closeModal。
    新笔记落 vault 根（attachmentFolder 不适用；默认新建位置设置项延期）。

### UI: TemplateSelector — `features/palette/TemplateSelector.tsx`（新，ui agent 所有）

QuickSwitcher 同构 modal（`.modal-overlay` + 输入框过滤 + ArrowUp/Down + Enter +
点击 + overlay 点击关闭；Escape 由 shell 全局处理）。`ModalKind` 增 `"templates"`
（types.ts 该行本轮归 ui agent）；App.tsx 渲染
`{ws.modal === "templates" && <TemplateSelector />}`。
状态呈现：`listTemplates` 返回 null → 单行提示 `templates.notConfigured`（含"在设置
中配置"文案）；[] → `templates.empty`；过滤无命中 → `templates.noMatch`。
`data-testid`：`template-selector`（容器）、`template-selector-input`、
`template-option`（每行，`data-path` 属性）、`template-selector-hint`（提示行）。

### 设置页（SettingsModal.tsx，ui agent 所有）

"文件与链接" h2 之后新增 "模板" h2（`settings.templates`）三行设置：
模板文件夹（`settings.templateFolder`，文本输入，placeholder "templates"）、
日期格式（`settings.templateDateFormat`，placeholder "YYYY-MM-DD"）、
时间格式（`settings.templateTimeFormat`，placeholder "HH:mm"）。受控输入存原文
（R17 先例——trim 在消费侧）。`data-testid`：`settings-template-folder` /
`settings-template-date-format` / `settings-template-time-format`。

### i18n（ui agent 所有）

`cmd.*` 四键进 dict.app.ts；`settings.templates*` 三 + 1 节标题进 dict.views.ts；
`templates.aria/notConfigured/empty/noMatch` + 选择器 placeholder
`templates.placeholder` 放 dict.app.ts（**勘误 R23-STYLE-01**：原句"按既有 palette
字符串归属"理由有误——palette.*/switcher.* 实际在 dict.panels.ts；选 dict.app.ts 的
真实依据是本轮 agent 所有权不含 dict.panels.ts，三个同构 modal 字符串自此分居两
文件，记维护注意项）。en/zh 双语（zh 类型锁定缺译即错）。

### Demo vault 夹具（core/vault.ts DEMO_FILES，core agent 所有；浏览器 E2E 依赖）

新增 `templates/Meeting Notes.md`（含 frontmatter + `{{title}}`/`{{date}}`/`{{time}}`）
与 `templates/Daily Log.md`（含 `{{date:dddd, MMMM Do YYYY}}` 自定义格式 +
`{{title:bogus}}` 负向字面量）。磁盘 demo-vault 同步两文件（双端一致先例）。

### Agent 文件所有权（独占）

| agent | 文件 |
|---|---|
| core | `core/templates.ts`（新）、`core/vault.ts`（仅 DEMO_FILES 增条目）、`demo-vault/templates/*`（新） |
| ui | `features/palette/TemplateSelector.tsx`（新）+ palette css、`app/App.tsx`、`core/types.ts`（仅 ModalKind 一行）、`features/settings/SettingsModal.tsx`、`core/i18n/dict.app.ts`、`core/i18n/dict.views.ts` |

### R23 As-built deltas（评审后修订记录）

评审 5 维 Workflow（数据安全/对抗性输入/契约符合性/生命周期竞态/分层 i18n，
18 agent）：**13 finding → 对抗验证 12 确认 / 1 证伪，去重 10 根因
（1 critical + 1 major + 8 minor）全修复**：

- **critical LIFE-1**：preview→live 翻转 + openModal 同一 commit 时，EditorPane
  重建 effect 的无条件 `view.focus()` 在 modal input autoFocus 之后执行，抢走焦点
  ——选择器开着但所有键入直接进正文并被防抖保存持久化（验证者浏览器三次复现，
  契约主路径）。修复 = focus 前查 `workspace.state.get().modal`（镜像 modal:closed
  恢复守卫）。**教训：同一 commit 内「翻模式 + 开 modal」时，被重建组件的 effect
  焦点操作必须带 modal 守卫**（autoFocus 在 commit 相、passive effect 在其后）。
- **major DS-1**：`documents.getActiveView()` 是闩锁字段（focusin 设置、仅视图
  销毁清除）——活动 tab 无编辑器（preview/graph）时仍指向后台 pane 的旧视图，
  insert-date/time 作为**首个走该句柄的第一方写命令**会把日期写进非活动文件并
  自动保存（验证者分屏实测复现）。修复 = `getActiveFileEditorView`：报告视图
  须与 `workspace.getActiveFile()` 同路径才可用（available + callback 双侧）。
  既有消费方（fold 命令）为非破坏性视图操作，维持现状。
- minor 八项：activate() 重入守卫（busyRef——桌面 vault.read 是真 IPC 窗口，
  双击/连 Enter 双插入；QuickSwitcher 先关 modal 先例本轮未沿用被评审抓出）；
  await 后视图重校验（Ctrl+W 穿透 modal 销毁编辑器 → dispatch 静默丢弃，现
  console.warn 降级）；create 路径补 R17 大小写不敏感撞名层；`{{date:}}` 契约
  措辞勘误（≡ {{date}} 消费态，非硬编码默认——实现保持）；版本号 0.23.0 三处
  （含 **前存缺陷**：SettingsModal `APP_VERSION` 自 R16 起硬编码 "0.16.0"，About
  页七轮显示旧版本，本轮根治）；i18n 归属契约理由勘误（见上节）；新增
  `templates.aria` 专用键（原复用 placeholder，与姊妹 modal 名词性 aria 不一致）；
  en 空态文案去句号对齐 palette/switcher。
- 证伪 1：vault_create TOCTOU 覆盖（Tauri 2 同步命令主线程串行，无并发交错面；
  external 进程残余窗口为微秒级加固项非缺陷）。
- 开发 agent 上报偏差 3 条全采纳：fuzzy 打分复用同 feature 文件夹 `./fuzzy` 模块
  （非跨 feature import）；选择器字符串按所有权放 dict.app.ts（契约理由已勘误）；
  read/create 异步失败 catch + console.error + finally closeModal（零写入）。

**环境教训（新开发机迁移，2026-06-13）**：① `.calibration` 必须先有自己的
package.json 再 `npm i`——目录里裸 npm install 会向上爬到仓库根污染主
package.json（HANDOFF 老警告的新变体，本轮实测踩中后回滚）；② **后台启动的
桌面 app 里 probe 插件的晚期 await/timer 不可靠**（t≈10s 后 setTimeout/写入
promise 可能永不归来——App Nap/WKWebView 节流），probe 断言要在生命周期早段
完成、进度用 fire-and-forget 写链落盘、挂载类断言查贡献点 Store 而非
可见性依赖的 DOM。

## Round 22 additions — Properties 可视化编辑（frontmatter 结构化面板）

> 官方校准（obsidian.md/help/properties + obsidian.d.ts:2954，2026-06-12 WebFetch）：
> 7 种属性类型（text/list/number/checkbox/date/datetime/tags）；类型按属性名**全库绑定**
> （存 `.obsidian/types.json`）；默认属性 tags/aliases/cssclasses；显示三选项
> Visible/Hidden/Source；命令 "Add file property"（Cmd/Ctrl+;）；内链须引号；
> JSON frontmatter 自动转 YAML（我们不做，见偏差）。
> **R22 范围** = 文档内属性面板（live + reading 双模式可编辑）+ 类型系统 + 显示设置 +
> `editor:add-property` 命令 + compat `fileManager.processFrontMatter` 真实现。
> **显式延期**：Properties 侧栏视图（全库属性浏览/全局改名）、属性值自动补全
> （已有值建议）、text 属性内链点击渲染、JSON frontmatter、嵌套属性编辑
> （不透明保留，见下）、属性搜索 `[key:value]`（R21 既有延期项）。

### 数据安全总原则（本轮第一底线，评审必设维度）

面板**绝不重排/重写未被编辑的字节**。所有编辑 = 针对单个属性条目行区间的
splice（其余内容含其他条目、注释、不支持的 YAML 构造逐字节保留）。超出解析子集
的条目（嵌套 map、`|`/`>` 多行标量、重复键的后者等）解析为**不透明条目**
（opaque：原文行只读呈现，不可视化编辑，永不被改写）。整块完全不可解析时面板
降级为只读提示行（"在源码模式编辑"），零写入。

### 新模块 `core/properties.ts`（纯 TS，零新依赖；core agent 所有）

```ts
export type PropertyType =
  | "text" | "multitext" | "number" | "checkbox" | "date" | "datetime"
  | "tags" | "aliases";
export type PropertyValue = string | number | boolean | string[] | null;

export interface PropertyEntry {
  key: string;                  // 原文大小写
  value: PropertyValue;         // null = 空值（`key:`）
  /** 该条目完整行区间 [from, to)（含行尾 \n；to 为下一行首或块体末） */
  from: number; to: number;
  /** 不透明条目：原文行保留，value 无意义，面板只读 */
  opaque?: boolean;
  /** opaque 时的原文（含换行） */
  raw?: string;
}
export interface ParsedProperties {
  entries: PropertyEntry[];     // 文档序
  /** 整块区间（含两道 --- 围栏与末尾换行），坐标同 FrontmatterData */
  from: number; to: number;
}
/** null = 无 frontmatter 块。块边界判定与 metadata.parseFrontmatter 冻结一致：
 *  首行恰为 `---`，闭合为行首 `---`。仅解析前 20_000 字符（livePreview 同口径）。 */
export function parseProperties(content: string): ParsedProperties | null;

export interface PropertyEdit { from: number; to: number; insert: string }
/** 以下构造器均针对传入 content 计算单一 splice；冲突/键不存在/大小写不敏感
 *  撞名等不可安全执行的情形返回 null（调用方重新 parse 后重试或放弃）。 */
export function buildSetProperty(content: string, key: string, value: PropertyValue): PropertyEdit | null;
  // 已存在（大小写不敏感匹配，保留原键写法）→ 重写该条目行区间；
  // 不存在 → 在闭合 --- 前插入新行；无块 → 在偏移 0 创建 "---\nk: v\n---\n"。
  // opaque 条目不可 set（返回 null）。
export function buildRenameProperty(content: string, key: string, newKey: string): PropertyEdit | null;
  // 仅替换键文本，值字节不动；newKey 与既有键大小写不敏感撞名 → null；
  // newKey 须匹配 /^[^\s:][^:]*$/（拒绝冒号/前导空白）。
export function buildRemoveProperty(content: string, key: string): PropertyEdit | null;
  // 删除条目行；删除后块内无任何条目（含 opaque）→ 连两道围栏一起删除。
export function inferPropertyType(value: PropertyValue): PropertyType;
  // boolean→checkbox；number→number；/^\d{4}-\d{2}-\d{2}$/→date；
  // /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/→datetime；array→multitext；其余 text。
export function effectivePropertyType(key: string, value: PropertyValue, assigned?: string): PropertyType;
  // 内建键固定：tags→tags、aliases→aliases、cssclasses→multitext（大小写不敏感）；
  // 其余：assigned（registry 值，未知字符串回退推断）?? inferPropertyType。
```

**值解析（冻结，扩展自 parseFrontmatter 子集但独立实现，互不改动）**：
未引号标量 `true`/`false` → boolean、`null`/`~` → null、有限十进制数字面量 → number、
其余 → string；引号标量（单/双）恒 string（剥引号，双引号内 `\"`→`"`、`\\`→`\\`）；
行内 `[a, b]` 与块列表 → string[]（逐项同标量剥引号但**不**做 bool/number 推断——
列表是文本列表，官方同口径）；`key:` 空值 → null（紧随块列表项时成为列表）。
**不透明判定**：行既非 `key: ...`（键 charset 同 parseFrontmatter）也非当前列表的
`- item` 续行 → 该行自成匿名 opaque 条目；嵌套缩进 map（值后随更深缩进的 k: v）、
`|`/`>` 块标量 → 整条目 opaque；同名键（大小写不敏感）再现 → 后者 opaque。
`#` 整行注释 → opaque。**CRLF 不在解析面**（vault.read 咽喉点已统一 LF，R16）。

**值序列化（冻结，含评审后修订）**：string 需要引号当且仅当（空串 | 首/末空白 |
首字符 ∈ `[ { " ' # & * ! | > % @ \` - ?` | 含 `: ` | **尾冒号 `/:$/`**（R22-01
评审修订：`draft:` 裸写对 js-yaml 是非法 YAML/列表项静默变嵌套 map） | 含 `#`
（前导空白后） | 形如 bool/number/null 字面量 | 含 `[[`）——**date/datetime
字面量不引号**（评审修订：本子集中日期本就是 string，引号无意义且偏离
Obsidian 写法）——用双引号，内部 `\`→`\\`、`"`→`\"`；number/boolean 字面量
（**指数记法数字拒写**——`String(n)` 离开十进制子集时返回 null，往返不变量
优先；`canSerializeNumber` 导出给面板做 text 回退）；null → `key:`（裸键）；
list → 块列表（`key:\n  - a\n  - b`，两空格缩进），空 list → `key: []`。
**全部行终结符拒写**（\n、\r、U+2028、U+2029——后三者能活过引号但杀死
re-parse 的 KV 正则，critical 评审修复）。**新键/改名键拒绝 `-` 前缀**
（`---` 前缀序列化即闭合围栏截断块、`- ` 前缀 re-parse 成匿名 opaque 行，
critical 评审修复；rename 与 set 同走 isInsertableKey）。**逐笔自验证**：
serializeEntry 产物 re-parse 必须恰得一条同键等值可见条目，否则返回 null
（未枚举到的冲突类在此兜底，绝不落盘）。

**类型注册表（registry，core/properties.ts 内）**：
```ts
export interface PropertyTypeRegistry {
  revision: Store<number>;
  get(key: string): string | undefined;                 // 大小写不敏感
  assign(key: string, type: PropertyType): Promise<void>;
  init(vault: Vault): Promise<void>;                    // 读 .obsidian/types.json
}
export const propertyTypes: PropertyTypeRegistry;
```
存储 `.obsidian/types.json` 形状 `{"types": {"<name>": "<type>"}}`（Obsidian 实际
文件，类型词汇 text/multitext/number/checkbox/date/datetime/tags/aliases）。
读：缺失/坏 JSON → 空表 warn 一次；**未知类型值原样保留**（get 返回原串，
effectivePropertyType 兜底推断）。写：RMW 保留未知键与 `types` 外的兄弟键
（R20 appearance.json 先例）；写经模块级 promise 链串行化（R20 opChain 先例）。
main.tsx 启动 `void propertyTypes.init(vault)`（不阻塞）；vault:changed 重读。
浏览器 Memory adapter 经既有 configFiles/`__geodeObsidianConfig` 注入口。

### Core: 配套扩展（core agent 所有）

- `core/metadata.ts`：`MetadataIndex.getPropertyKeys(): string[]`——聚合全库
  frontmatter 键（原文大小写、大小写不敏感去重取首见、字典序），按 revision
  惰性缓存。parseFrontmatter/parseNote **零改动**（metadata 路径字节级不回归）。
- `core/workspace.ts`：`propertiesInDocument: Store<"visible"|"hidden"|"source">`
  + `setPropertiesInDocument(v)`，localStorage `geode.propertiesInDocument`
  持久化，默认 "visible"（theme/fontSize 先例）。**不进 WorkspaceState 持久化树**。

### UI: PropertiesPanel — `features/editor/PropertiesPanel.tsx`（新）+ EditorPane 集成 + 设置页 + 命令（ui agent 所有）

```tsx
export function PropertiesPanel(props: {
  /** 当前文档文本（commit 时以 getDoc() 重取，不用渲染时快照） */
  getDoc: () => string;
  /** 应用一笔 splice：live 模式 = CM dispatch；preview 模式 = setText+modify */
  applyEdit: (edit: PropertyEdit, focusAfter?: boolean) => void;
  path: string;          // tags/键名自动补全 & registry 用
  revision: number;      // handle.revision 镜像，触发重渲染
}): JSX.Element | null;
```

- **渲染**：parseProperties(getDoc())；null → 仅在收到 add-property 聚焦请求时
  创建块。条目按文档序渲染行：类型图标按钮 + 键名 input + 值编辑器 + 删除按钮
  （hover 显示）。opaque 条目 → 只读原文行（`property-row-opaque`）。
  **20k 边缘口径（评审修订，原"不会出现"断言被证伪）**：闭合围栏落在 20k
  解析上限之外的块，parseProperties 返回 null 而 metadata（无上限）仍判有块
  ——此类文件**禁止任何写入**：`canCreatePropertiesBlock(content)`（导出）
  在首行为 `---` 且全文存在 `\n---` 闭合时返回 false，buildSetProperty 无块
  创建路径与面板/命令的空块创建路径都以它为闸（评审 critical 组合后果：
  原先会在偏移 0 叠第二个块，原 frontmatter 整体沦为正文）。
- **值编辑器按 effectivePropertyType**：text=单行 input；number=`type="number"`
  （commit 时 Number() 非有限 → 按 text 字符串存）；checkbox=复选框（非 boolean
  值显示 indeterminate，点击落 true）；date/datetime=原生 `type="date|datetime-local"`
  （存值非法格式 → 退 text input 编辑）；multitext/tags/aliases=chips + 追加
  input（Enter/逗号提交一项、Backspace 空输入删末项、chip ✕ 删除）；tags 输入
  带 datalist（metadata.getTagMap() 键，存值剥前导 `#`）。
- **提交语义（冻结）**：聚焦行持本地草稿，blur/Enter 提交（与 Obsidian 逐键
  落盘的偏差，记录）、Escape 还原草稿；提交时以 getDoc() 现值重算 builder，
  builder 返回 null → 放弃并重渲染（响亮 console.warn）。键名改名提交 =
  buildRenameProperty；新增 = 名称 input（datalist = getPropertyKeys()）+
  Enter 落 `key: null` 后聚焦值编辑器。每笔提交恰一笔 splice = live 模式下
  恰一个 undo 步。
- **类型按钮**：点击弹类型菜单（8 选 1 内建键禁用），选择 →
  `propertyTypes.assign(key, type)`（全库绑定，官方口径）；值不即时转换
  （显示层随 effectiveType 切换，下次提交按新类型序列化——记录口径）。
- **testid 面（冻结）**：`properties-panel`、`property-row-<key>`、
  `property-row-opaque`、`property-name-<key>`、`property-value-<key>`、
  `property-type-<key>`、`property-delete-<key>`、`property-add`、
  `property-add-input`、`property-chip-<key>-<i>`。
- **EditorPane 集成**：① live 模式 = createPortal 到 pane 持有的稳定容器 div
  （经 buildEditorExtensions 新 opts 传给 livePreview，见下），applyEdit =
  `viewRef.current.dispatch({changes: edit, userEvent: "input"})`（不动选区——
  选区在 fm 区间外时面板不触发 reveal）；② preview 模式 = 面板直接渲染在
  `.preview-content` 之前（同 scroller 内，随滚动），applyEdit = 任务复选框
  先例（splice 应用于 handle.getText() → handle.setText + vault.modify；
  **preview 态编辑不进 undo 历史——显式口径**）；③ source 模式无面板。
  显示设置 hidden → 双模式均不渲染面板；source → 不渲染面板（live 原文显示
  交给 livePreview 段）。订阅 handle.revision 驱动 revision prop。
- **命令**：`editor:add-property`（name thunk t("cmd.addProperty")——As-built
  修订：原契约写 commands.* 命名空间系笔误，仓库命令键惯例是 dict.app.ts 的
  cmd.*，实现循惯例（评审 F7 上报后裁决）。默认热键 `Ctrl+;`，App.tsx 既有
  编辑器命令注册点）。行为：活动 tab 无文件 → no-op；mode==="source" → 先
  setTabMode("live")；显示设置非 visible → 先 setPropertiesInDocument
  ("visible")（命令即编辑意图，评审 INT-2 修订）；请求经
  `workspace.requestAddProperty(tabId, filePath)` 一次性 Store（As-built
  修订：原契约的同步 CustomEvent 在 source→live 翻转时面板尚未挂载、事件
  丢失——改 revealTarget R14 一次性消费形态；带 filePath，tab 导航走后的
  陈旧请求被丢弃而非写错文件）。面板消费：无 fm 块且
  canCreatePropertiesBlock 通过 → 创建空块（`---\n---\n` 偏移 0）并聚焦
  新增名称输入。
- **设置页**（features/settings/SettingsModal.tsx，Editor 节）：
  "文档内属性" 三选下拉（`settings-properties-display`），绑
  workspace.propertiesInDocument。
- **i18n**（dict.views.ts，en+zh 成对）：`editor.addProperty`、
  `editor.propertyNamePlaceholder`、`editor.propertyValuePlaceholder`、
  `editor.deleteProperty`、`editor.propertyTypeAria`、`editor.typeText/
  typeMultitext/typeNumber/typeCheckbox/typeDate/typeDatetime/typeTags/
  typeAliases`、`editor.propertiesOpaqueHint`、`commands.addProperty`、
  `settings.propertiesDisplay`、`settings.propertiesDisplayDesc`、
  `settings.propertiesVisible/Hidden/Source`。既有 `editor.propertiesOne/
  propertiesMany/editProperties` 键保留（pill 退役后删除 → 不删，compat
  面板空态备用；删除与否由 ui agent 上报 chief 裁决，不得自行修订契约）。

### live preview: 面板宿主 widget — `features/editor/livePreview.ts` + `cmExtensions.ts`（livePreview agent 所有）

- `buildEditorExtensions` opts 新增 `propertiesHost?: HTMLElement`（EditorPane
  创建的稳定容器；同文件双 pane 各持自己的容器/视图）。经新 Facet
  `propertiesHostFacet` 注入 state。**签名冻结**：
  `buildEditorExtensions({ app, getPath, mode, modeCompartment, propertiesHost })`。
- `frontmatterField` 改造（替换 FrontmatterWidget 药丸）：
  - 显示设置 = "visible" 且存在 fm 块 → block replace 装饰 [0, blockTo) 挂
    `PropertiesHostWidget`（toDOM = 返回包一层的 div 并 append
    `state.facet(propertiesHostFacet)` 容器；`eq` 恒真——容器身份稳定，CM 复用
    DOM、portal 内容跨 doc 变更存活；`ignoreEvent` 恒真——面板事件全归 React；
    `estimatedHeight` 提示减抖）。**选区进入 fm 区间不再 reveal 原文**（面板
    即编辑面；键盘把光标移进区间时装饰保持——与药丸时代行为变更，记录）。
    光标紧邻区间的上下行导航不得死锁（widget 块装饰 CM 原生跳过）。
  - "source" → 恒不装饰（原文 YAML 常显）；"hidden" → block replace 为零内容
    widget（fm 整段视觉隐藏；光标可经键盘进入？冻结：hidden 同样不 reveal，
    源码模式是编辑入口——记录口径）。
  - 显示设置变更响应：新 StateEffect `refreshProperties`，EditorPane 订阅
    `workspace.propertiesInDocument` 后 dispatch（refreshWikilinks 先例）；
    frontmatterField 的 update 对该 effect 重算。
  - `propertiesHost` 未提供（防御）→ 退化为既有药丸行为（compat 或孤立调用面）。
- pill 相关代码（FrontmatterWidget）保留为退化路径，不删。

### Compat: `fileManager.processFrontMatter` 真实现（compat agent 所有；plugin.ts）

官方签名（d.ts:2954）`processFrontMatter(file: TFile, fn: (fm: any) => void,
options?: DataWriteOptions): Promise<void>`，语义 = 同步 mutate 对象后落盘：

- 文本来源：`documents.get(path)` 开着 → `handle.getText()`；否则
  `vault.readFresh(path)`（R16 双路径先例）。
- `parseProperties` → 可视条目构成普通对象（opaque 条目**不进对象**且永不被
  改写——与官方"完整 YAML 对象"的偏差，记录）；无块 → 空对象。fn 同步执行，
  抛错原样 reject（官方口径）。
- diff 应用：被删键 → buildRemoveProperty；变更/新增键（浅相等比较，数组逐项）
  → buildSetProperty（新增按 fn 内赋值序追加块尾）；逐笔 builder 串行重算
  （每笔基于上一笔结果文本）。零变更 → 不写盘。
- 落盘：开着 → `handle.applyExternalEdits(edits 合并为逐笔序列)`（标脏+防抖
  保存+进共享 undo）；关着 → `vault.modify(path, next)`（回声指纹既有）。
  `options`（mtime）忽略，记缺口。非 .md 文件 → reject。
- 值面：fn 可写入 string/number/boolean/string[]/null 之外的类型（嵌套对象等）
  → 该键以 JSON.stringify 字符串落盘？**不**——冻结：不可序列化类型抛
  TypeError reject（绝不静默写坏 YAML；与官方全量 YAML 序列化的偏差，记录）。
- `reportGap` 该方法条目移除；其余 fileManager 方法仍 no-op stub。

### 验证基建（test agent 所有；.calibration/，gitignore）

- `r22-props-tests.mjs`：esbuild 打包 core/properties.ts 为 cjs 后 node 直跑
  （r21-parser-tests 先例）。矩阵 ≥60 用例：解析（7 类型/引号/转义/行内与块
  列表/空值/null/数字边界/日期判别）、不透明（嵌套 map、`|`/`>`、重复键、
  注释行、匿名行）、**对抗性输入维**（R21 教训冻结进流程）：emoji/astral 键名
  与值、U+0130 İ 大小写敏感撞键、`\r` 内嵌、超长行、值含 `---`、键含引号、
  YAML 炸弹形状（深嵌套缩进——全 opaque 不递归）、`__proto__`/`constructor`
  键名（对象构造用 null-prototype 或 Map 防原型污染——**冻结要求**）；
  序列化往返（set 后 re-parse 等值）、builder 字节保留断言（编辑 A 键，
  B 键与 opaque 区字节不变）、删除最后条目连围栏、registry RMW 保留未知键。
- `r22-e2e.mjs`：浏览器 Playwright（dev server tmux）：面板渲染/7 类型编辑器/
  add/rename/delete/chips/tags datalist/类型菜单 assign + types.json 往返
  （`__geodeObsidianConfig` 注入口）/显示三模式/source 模式无面板/preview 态
  编辑落盘/live undo 单步/无 fm 命令创建块/opaque 行只读/全 opaque 降级/
  metadata 联动（fm tags 改动 → 标签面板）/数据安全（编辑面板期间另一 pane
  source 同文档编辑不互踩）。
- 桌面 probe：`compat-vault/.geode/plugins/r22-props-probe.js`（r21 先例：自建
  fixtures、驱动真实面板 DOM、结果写回 vault；重跑前删结果文件）覆盖：面板
  渲染+编辑落真实磁盘、types.json 真实写入、processFrontMatter 经 fixture
  插件调用真实改写、r20/r21 probe 复跑、套件 5/5。

### 一次性决策与显式偏差（chief 拍板，agent 不得修订）

- 零新 npm 依赖（不引 js-yaml——子集+不透明保留比全量解析更符合字节保留承诺）。
- 提交粒度 = blur/Enter（Obsidian 逐键落盘——偏差，记录；undo 噪声与焦点
  重建风险不对称）。
- preview 态编辑不进 undo（任务复选框先例同口径）。
- JSON frontmatter 不支持（官方自动转 YAML——缺口记录）。
- 面板内 text 值的 `[[链接]]` 不渲染为可点链接（官方渲染——延期）。
- `.obsidian/types.json` 与 Obsidian 共写（迁移叙事：同库往返类型不丢）。
- metadata 侧 parseFrontmatter 不动（搜索/别名/标签链路零回归面）。

### As-built deltas（评审修复后回填）

评审 5 维（数据安全/对抗性输入/契约分层/交互正确性/安全）workflow 32 agent：
**25 finding → 逐条对抗验证 25 确认 / 2 证伪；去重 13 根因（3 critical +
5 major + 5 minor），全部修复**并经复现探针反向验证 + 84 断言 E2E +
150 用例矩阵 + 桌面 22 断言 probe 回归：

- **critical#1（CSS/CM 度量）**：面板 host 的垂直 margin 折叠逃出 widget
  wrapper，CM heightmap 少量 ~16px → **带 frontmatter 笔记的全部鼠标点击
  光标偏一行**。修复 = `.properties-host` 垂直间距改 padding + wrapper
  `flow-root`（editor.css 有 CRITICAL 注释，改动须保持非折叠形态）。
  教训：**CM 块 widget 的样式必须保证 getBoundingClientRect 含全部占位**。
- **critical#2（键名危险前缀）**：isInsertableKey 原放行 `---*`（序列化行
  即闭合围栏，块截断属性凭空消失）与 `- *`（re-parse 成匿名 opaque）键名
  → 拒绝 `-` 前缀；rename 同谓词；另加 entryRoundTrips 逐笔自验证兜底。
- **critical#3（行终结符）**：serializeEntry 原只拒 \n——\r/U+2028/U+2029
  活过引号但杀死 re-parse KV 正则（条目变匿名 opaque，键失踪）→ 全终结符
  拒写。注意 **JS 正则字面量内不能写裸 U+2028/2029**（终结字面量），用转义。
- **major**：尾冒号字符串引号缺失（js-yaml 报错/列表项静默变嵌套 map——
  自家子集能往返故套件全绿掩蔽，靠外部解析器视角的评审抓出）；嵌套 flow
  序列 `[[a,b],c]` 误压平（→ splitInlineList 见未引号括号返 null、整条目
  opaque）；20k 边缘叠块（→ canCreatePropertiesBlock 三处闸）；块列表夹
  空行/注释半解析（→ gap 后再现 item = 整段 opaque）；date/datetime 逐
  change 提交（键盘清段瞬时 "" 即写 null 毁日期 → 草稿化与 ScalarInput
  同构）；add-property 陈旧请求跨文件写入（→ 请求带 filePath + 显示态
  翻转 + 失配即弃）；widget 边界 Backspace 吞围栏换行正文无声消失（→
  atomicRanges + Prec.high keymap 在 blockTo+1 处吞键）。
- **minor**：types.json RMW 跨 vault 切换窗口（→ adapter 身份写前校验）；
  number 指数形态有限数两头不接（→ canSerializeNumber 面板 text 回退）；
  拒绝提交后草稿不回弹（→ commitText 返 boolean，false 即 setDraft(stored)）；
  类型菜单零键盘（→ Escape/方向键/focusout）；卸载丢草稿（→
  **useLayoutEffect** 清理冲刷——passive effect 清理跑在 DOM 摘除后，
  activeElement 判断必失败，实测踩过）。
- **证伪 2**：processFrontMatter 逐笔 applyExternalEdits 中途抛错留半写
  （验证者证明守卫不变量在同步循环内每步重建，不可构造）；number 类型
  非数字存值显示为空（契约口径后果，入 polish 候选非缺陷）。
- 其余 As-built：facet/effect 定义移 livePreview.ts 经 cmExtensions 再导出
  （单文件内聚，公共导入面不变）；vault:changed 重读 types.json 过滤
  reason==="load"（每次保存都重读是性能噪声）；rename 自身改大小写放行
  （"既有键"读作"其他键"）；设置页新增 "Editor" 节标题（settings.editorHeading
  i18n 键，契约未列）；ScalarInput 卸载冲刷只覆盖值草稿——键名改名/半敲
  chips 草稿卸载即弃（自动提交半敲键名更危险，口径记录）。
- **已知限制（入档不修）**：双 pane 同文件 add 聚焦首消费者赢；显式
  cursorDocStart 仍可把光标放进 widget 区间（typing 落点可见无声损坏面
  已被 atomicRanges+Backspace 闸收窄）；退化药丸路径在 atomicRanges 下
  键盘选区进入不再触发 reveal（点击 reveal 不受影响——compat 防御面）；
  灾难性回溯类 YAML 无新增暴露面（解析全手写状态机零回溯正则）。
- 性能：10k metadataIndexMs 125.8ms（优于 R16 基线 151）；searchScan
  22-69ms 持平 R21；getPropertyKeys 0.1ms（revision 缓存）。
- 验证资产（.calibration/，gitignore）：r22-props-tests.mjs 150 用例、
  r22-e2e.mjs 84 断言、评审复现探针 r22-review-probe*.mjs /
  r22-verify-*.mjs / r22-adv-*.mjs（修复后反向复跑全数确认）；桌面
  compat-vault/.geode/plugins/r22-props-probe.js 22 断言。

## Round 21 additions — 搜索运算符（path:/tag:/file:/正则 + 布尔组合）

> 官方校准（obsidian.md/help/plugins/search，2026-06-12 WebFetch）。R21 范围 =
> `file:` `path:` `content:` `tag:` `line:` `match-case:` `ignore-case:` + 引号短语 +
> `OR` + `-` 排除 + `()` 分组 + `/regex/`。**显式延期**（R22+ 候选）：`block:` /
> `section:` / `task:`/`task-todo:`/`task-done:` / 属性搜索 `[key:value]` / 比较运算。
> compat 表面零改动（原生功能轮）。

### 新模块 `core/search.ts`（纯 TS，仅可 import core/types）

```ts
export type CaseMode = "default" | "sensitive" | "insensitive";

export type SearchMatcher =
  | { kind: "text"; text: string; caseMode: CaseMode }   // substring 匹配
  | { kind: "regex"; source: string; flags: string };    // JS 正则，parse 期校验

export type SearchField = "content" | "file" | "path" | "tag";

export type SearchExpr =
  | { type: "and"; children: SearchExpr[] }              // children.length >= 1
  | { type: "or"; children: SearchExpr[] }
  | { type: "not"; child: SearchExpr }
  | { type: "term"; field: SearchField | "default"; matcher: SearchMatcher }
  | { type: "line"; child: SearchExpr };                 // 子式逐行求值

export type SearchParseErrorCode =
  | "bad-regex" | "unclosed-quote" | "unclosed-paren" | "empty-query-group";

export interface ParsedSearch {
  expr: SearchExpr | null;                       // null = 空白查询或有 error
  error: { code: SearchParseErrorCode; detail?: string } | null;
}
export function parseSearchQuery(raw: string): ParsedSearch;

export interface SearchInput {
  path: string;                 // vault 相对路径（正斜杠）
  fileName: string;             // 末段含扩展名（file: 的匹配面）
  basename: string;             // 不含扩展名（default 字段的文件名侧）
  content: string;
  tags: readonly string[];      // metadata 索引标签，无 '#'，嵌套形如 "a/b"
}
export interface SearchMatchRange { from: number; to: number }
export interface SearchOutcome {
  matched: boolean;
  /** content 锚定的正向命中区间（排序+合并去重叠）；负向/未命中分支不贡献 */
  ranges: SearchMatchRange[];
  /** basename 上的命中区间（default/file 字段）——面板高亮文件名用 */
  nameRanges: SearchMatchRange[];
}
export function evaluateSearch(expr: SearchExpr, input: SearchInput): SearchOutcome;
```

### 冻结语法语义（实现与评审以此为准）

1. **分词**：空白分隔；`"..."` 引号短语（`\"` 转义，未闭合 → `unclosed-quote`）；
   `/.../flags` 正则 token（flags ⊆ `imsu`，`new RegExp` 校验失败 → `bad-regex`；
   正则体内 `\/` 转义）；`(`/`)` 分组（未闭合 → `unclosed-paren`；空组 →
   `empty-query-group`）；token 恰为大写 `OR` = 或运算符；`-` 紧贴下一元素 = 取反。
2. **运算符**（仅小写识别）：`file:` `path:` `content:` `tag:` `line:`
   `match-case:` `ignore-case:`。操作数 = 冒号后紧贴的单 token（裸词/引号短语/正则）
   或括号组。括号组语义：`path:(a OR b)` 把组内 **default 字段的裸词**重绑定到该
   字段；组内显式运算符保持自身字段。`line:(...)` 子式对每一行独立求值，任一行
   整体命中即命中（`-line:(...)` = 取反）。`match-case:`/`ignore-case:` 递归重绑
   操作数的 caseMode（正则：match-case 剥 `i`、ignore-case 加 `i`）。
   **字段运算符的单 token 裸词操作数按字面文本绑定该字段，`#` 不触发标签糖**
   （`content:#todo` 搜正文字面 `#todo`，不退化为 tag 词；R21 评审修订）；
   `tag:` 操作数照常剥前导 `#`。
3. **默认口径**：裸词 field="default" = **content ∪ basename**（任一命中即命中，
   basename 命中参与排序加权——Geode R1 以来既有 UX，保留；与官方 content-only
   倾向的差异记显式偏差）。**例外：`line:` 作用域内 default 词只看行内 content**
   ——否则文件名命中会让同行约束对裸词退化（R21 评审上报后冻结）。文本默认
   大小写不敏感（官方同口径）；正则按书写形态（无隐式 `i`）。
4. **`#token` 裸标签词** = `tag:#token`（官方同形）。`tag:` 操作数剥前导 `#`；
   文本匹配 = 标签全等 **或** 前缀 + `/` 边界（嵌套子标签命中，`tag:work` 命中
   `work/phone`，不命中 `workshop`，大小写不敏感）；正则操作数对每个标签 test。
5. **优先级**：`-` > 隐式 AND > `OR`；括号覆盖。`a b OR c d` = `(a AND b) OR
   (c AND d)`（Lucene 同构，冻结口径）。
6. **空操作数**（`path:` 后随空白/EOF）→ 整个 token 降级为字面文本词（不报错）。
7. **求值/区间**：matched 按布尔树；ranges 只收命中文件中**实际参与命中**的正向
   content 锚定匹配（default 的 content 侧、`content:`、`line:` 子式行内命中、
   content 正则）；`not` 子树与未命中的 `or` 分支零贡献；file/path/tag 命中不进
   ranges（nameRanges 单独收 basename 区间）。正则求值统一补 `g` 收区间；零长
   匹配前进一位防死循环。
8. **性能**：parse 每次查询一次；逐文件求值 O(content)（不敏感文本匹配按
   每文件一次 lowercase 缓存）；`line:` 行拆分逐文件惰性一次。bench=10000
   `searchScanMs` 口径不回退。

### SearchPanel 接入契约（features/search 所有权）

- 全文模式改走 `parseSearchQuery` + `evaluateSearch`（扫描循环/防抖/
  MAX_FILE_RESULTS=200/MAX_LINES_PER_FILE=5/排序 nameMatch→total→basename 全保留；
  nameMatch := nameRanges.length>0；total := ranges.length + nameMatch?1:0）。
- 行命中由 ranges 推导（行偏移映射），`<mark>` 高亮按区间渲染（替换现 query 子串
  highlight；contextSlice 窗口锚定行内首个区间）。
- **标签浏览模式收窄**：仅 `/^#\S*$/` 整查询走现有 tag 浏览器（列表+计数+展开）；
  含空白/其他 token 的查询进解析器（`#tag` 成 tag 词）。
- parse error → 提示行（`search.errorBadRegex` / `search.errorUnclosedQuote` /
  `search.errorUnclosedParen` / `search.errorEmptyGroup`）；空 expr 显示既有 hint。
- hint 文案更新提及运算符（`search.hintOperators`）。新 i18n 键全在
  dict.panels.ts（en+zh 成对）。data-testid 不变（search-panel/input/clear/result），
  新增 `search-error`。

### As-built deltas（评审修复后回填）

评审 4 维 13 finding → 对抗验证 **10 确认（1 critical + 1 major + 8 minor，去重 5
根因）/ 3 证伪**，全部修复或入档：

- **critical（已修）**：`regexScan` 零长匹配步进 `m.index+1` 在 `u` flag 正则 +
  surrogate pair（emoji/astral CJK）处死循环——`u` 模式下 mid-pair 的 lastIndex
  被 V8 回退到 pair 起点，同位置零长匹配永复（验证者看门狗实测挂死）。修复 =
  零长步进时遇 high surrogate 前进 2（按 code point 步进）。
- **major（已修）**：大小写不敏感文本匹配在 `toLowerCase` 变长码点（U+0130 İ →
  "i̇"）后区间整体右移、可产生超出 content 的非法区间（4 finding 同根因）。修复 =
  `LoweredText`（lowered 串 + 长度变化时惰性建 lowered→原始偏移 Int32Array 双映射，
  常见同长路径零开销），content/basename/fileName/path 文本匹配统一走该结构。
- **minor（已修）**：字段运算符单 token 裸词操作数被 `#` 标签糖劫持
  （`path:#foo` ≡ `tag:foo`、`content:#todo` 永不命中字面正文）→ 语义条款 2 修订
  （字面绑定），实现同步。
- **minor（已修）**：`deriveLineHits` 对恰始于行尾 `\n` 的区间归给前一行并吞掉
  （真实命中行不列出）→ 行归属改严格 `<` + 跨行起点 clamp。
- **minor（契约回填）**：`line:` 作用域内 default 词跳过 basename——实现取舍
  合理但原契约未写明，条款 3 增补例外（agent 上报，未自行修订契约——程序正确）。
- **已知限制（不修，入档）**：灾难性回溯正则（如 `/(a+)+b/`）无执行预算护栏，
  可冻结主线程且殃及防抖保存窗口（`-/re/` 取反形态同样触发）——JS 主线程无廉价
  缓解（worker 化/RE2 是远期项），与 Obsidian 自身暴露面同级。零长正则挂死类
  （上条 critical）已根治，与此项不同因。
- 证伪 3：`content:#x` 改写主张的 layering 维变体（parser 维同根因已确认采纳）、
  未闭合正则报 bad-regex 属契约一致行为、测试覆盖缺口清单（非缺陷，缺口用例
  已在修复回归中补齐）。

## Round 20 additions — Obsidian 主题 CSS 兼容层（变量桥 + 类名对齐 + theme/snippets 加载）

R19+ 候选池第 2 项（OBSIDIAN-COMPAT R3 末规划过的「独立可选层」；R18 callout DOM
已按社区共识对齐，本层落地直接受益）。官方校准（docs.obsidian.md/Themes/App+themes/
Build+a+theme + Reference/CSS+variables/*，2026-06-12 WebFetch）：

- **主题文件布局**：`<vault>/.obsidian/themes/<name>/{manifest.json, theme.css}`，
  manifest `name` 须与目录名一致；激活主题记录在 `.obsidian/appearance.json` 的
  `cssTheme` 键（空/缺失 = 默认主题）；CSS snippets 在 `.obsidian/snippets/*.css`，
  启用列表在 appearance.json `enabledCssSnippets`（string[]，不含 .css 后缀）。
- **主题作用域**：官方主题在三个选择器下覆写变量——`body`（两模式共用）、
  `.theme-dark` / `.theme-light`（按色调）；这两个类挂在 **body** 上。
- **变量面**：官方 400+ 变量；基础色板 = `--background-primary/-alt`、
  `--background-secondary/-alt`、`--background-modifier-*`（hover/active-hover/
  border/border-hover/border-focus/form-field/error）、`--text-normal/muted/faint/
  on-accent/accent/accent-hover/error/selection/highlight-bg`、`--interactive-
  normal/hover/accent/accent-hover`、`--accent-h/s/l`、`--caret-color`。
- **关键事实（探查确认）**：Geode 调色板本就镜像 Obsidian 默认主题观感
  （#1e1e1e/#262626/#2a2a2a/#363636/#dadada 即 Obsidian dark base 色板），且
  `--text-normal/--text-muted/--text-faint/--text-on-accent/--text-highlight-bg`
  五个变量**直接同名**——桥接面小于预期。

### 一次性决策（chief；agent 不得加依赖、不碰 Rust）

- **零新 npm 依赖**。Rust 新增一条通用命令 `vault_list_config_dir`（chief 落地，
  见下）；无其他 Rust 改动。
- **三层结构**：① 变量桥（bridge）= 注入式样式表：Obsidian 基础变量默认值
  （字面量 = Geode 现值，**零视觉变化承诺**）+ Geode 变量 repoint 到 Obsidian
  变量；② 类名对齐 = 常驻 DOM class 子集（不随开关增删，无主题 CSS 时惰性）；
  ③ 加载链 = appearance.json 读写 + theme.css / snippets 注入。
- **总开关**（设置页 "Obsidian CSS"，默认 **开**）：localStorage
  `geode.obsidianCss`（"on"/"off"）。开 = 注入 bridge + 激活主题 + 启用 snippets；
  关 = 移除全部三组 style 元素（兜底逃生口——桥变量链路若有差错一键归零）。
  开且未装任何主题 = bridge 恒等映射，**计算样式与关闭时一致**（E2E 断言，
  accent HSL 表示允许 ±1/255 舍入）。
- **CSS 信任口径（记录）**：theme.css/snippet 是用户自装的任意 CSS，可经
  url()/@import 发起网络请求——与社区插件同级信任（Obsidian 同口径），不消毒
  不拦截。路径安全由 Rust `safe_join_obsidian` 兜底（`.obsidian/` 禁越界）。
- **主题色调跟随 Geode**：theme.css 同时带 .theme-dark/.theme-light 两套作用域，
  body 类随 Geode 主题切换自动选边；appearance.json 的 `theme`（base 色调）与
  `accentColor` 键**忽略**（Geode 自有主题/accent 设置，缺口记录）。

### Rust: `vault_list_config_dir`（chief 已落地）

```rust
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
struct ConfigDirEntry { name: String, is_dir: bool }
/// List entries directly under `<vault>/.obsidian/<path>`.
/// Missing dir → empty vec (not an error). safe_join_obsidian 防越界。
#[tauri::command]
fn vault_list_config_dir(vault: String, path: String) -> CmdResult<Vec<ConfigDirEntry>>
```

### Core: adapter 扩展 — `core/vault.ts`（core agent）

```ts
export interface ConfigDirEntry { name: string; isDir: boolean }
// VaultAdapter 新增（readConfig/writeConfig 同族）：
listConfigDir(relPath: string): Promise<ConfigDirEntry[]>;
```

- Tauri 实现：invoke `vault_list_config_dir`。Memory 实现：扫 `configFiles` Map
  键前缀合成（`themes/X/theme.css` → "themes" 列出 `{name:"X", isDir:true}`），
  名字典序；首次 config 访问时惰性种子 `window.__geodeObsidianConfig`
  （`Record<string,string>`，键 = `.obsidian` 相对路径——E2E 注入口，
  `__geodeObsidianPlugins` 先例）。消费方走 `vault.adapter.listConfigDir`
  （loader 的 readConfig 直访先例，不加门面方法）。
- body 的 `.theme-dark/.theme-light` 同步**不在 core**（分层：compat 自管，见下）。

### Compat: 管理器 — `compat/obsidian/themes.ts`（新）+ `theme-bridge.css`（新，?raw import）（compat agent）

```ts
export interface ObsidianCssTheme { dir: string; name: string }   // name = manifest.name ?? dir
export interface ObsidianCssSnippet { name: string; enabled: boolean } // name 不含 .css
export interface ObsidianCssState {
  enabled: boolean;
  themes: ReadonlyArray<ObsidianCssTheme>;
  activeTheme: string;                       // theme dir；"" = 无
  snippets: ReadonlyArray<ObsidianCssSnippet>;
}
export const obsidianCssState: Store<ObsidianCssState>;
export function initObsidianCss(ctx: { vault: Vault; events: EventBus; workspace: Workspace }): Promise<void>;
export function setObsidianCssEnabled(on: boolean): Promise<void>;
export function setObsidianTheme(dir: string): Promise<void>;     // "" 清除
export function setObsidianSnippet(name: string, on: boolean): Promise<void>;
```

- **发现**：`listConfigDir("themes")` 的 isDir 项 → `readConfig("themes/<dir>/
  manifest.json")`（JSON 失败 → name 退 dir，warn 一次）；theme.css 缺失的目录
  跳过。`listConfigDir("snippets")` 的 `*.css` 文件项。manifest `minAppVersion`
  不校验（记录）。
- **appearance.json**：读 `cssTheme`/`enabledCssSnippets`（缺失文件/坏 JSON →
  视为 `{}`，warn 一次）；写 = read-modify-write **保留未知键**（与真实
  Obsidian vault 往返不丢字段）；激活主题不在发现列表 → 不注入但 UI 显示该值
  （Obsidian 同口径：主题文件删了配置仍在）。
- **注入（冻结 DOM）**：`<style id="geode-obsidian-bridge">`（bridge）→
  `<style id="geode-obsidian-theme" data-theme-dir="<dir>">`（theme.css 原文）→
  `<style data-obsidian-snippet="<name>">`（按 enabledCssSnippets 序）。三组按
  此序 append 到 `document.head` 末尾；任何变更 = 整组移除重注入（顺序不变量
  靠重建保证，不靠 insertBefore 微调）。总开关关 → 三组全移除。
- **body 类同步**：init 时按 `workspace.state` 设 `body.theme-dark|theme-light`，
  订阅 `theme:changed` 切换。**常驻**（不随总开关移除——类名惰性，snippets/
  theme 的作用域锚点）。
- **vault:changed** → 全量重发现 + 重注入（旧 vault 的 style 元素先移除）。
  `initObsidianCss` 幂等（重复调用 = 重新发现）；测试钩子
  `window.__geodeObsidianCssReinit = () => initObsidianCss(ctx)`。
- 主题文件磁盘外部修改**不热重载**（.obsidian 不在 watcher 面；重切主题/重开
  vault 生效——口径记录）。

### Compat: 变量桥 — `theme-bridge.css`（冻结映射表）

选择器形状镜像**真实 Obsidian**（评审 R20-CSS-01 修正）：模式原语用私有
`--geode-ob-*` 名放 `.theme-dark`/`.theme-light`（主题永不触碰私有名，不可能
压制主题覆写），全部 Obsidian **语义变量默认值放 `body{}`**（官方 app.css 同
形状）——主题在 `body{}` 覆写按文档序赢（本表注入序在 theme.css 之前）、在
`.theme-dark{}` 覆写按特异性赢，两路都通。三段：

**①a 私有模式原语 + ①b body 作用域语义默认值**（字面量 = app.css 现值的
拷贝；CSS 同步块成对注释 `/* OBSIDIAN-BRIDGE-PALETTE-BEGIN */` … `-END`，
app.css 变量节加对应注释提示改动须同步）：

| Obsidian 变量 | dark（= Geode 现值） | light |
|---|---|---|
| `--background-primary` | `#1e1e1e`（--bg-app） | `#f5f5f5` |
| `--background-primary-alt` | `#1c1c1c`（--bg-input） | `#fafafa` |
| `--background-secondary` | `#262626`（--bg-panel） | `#ffffff` |
| `--background-secondary-alt` | `#2a2a2a`（--bg-panel-alt） | `#f0f0f0` |
| `--background-modifier-hover` | `rgba(255,255,255,0.055)` | `rgba(0,0,0,0.05)` |
| `--background-modifier-active-hover` | `rgba(255,255,255,0.1)` | `rgba(0,0,0,0.09)` |
| `--background-modifier-border` | `#363636` | `#e0e0e0` |
| `--background-modifier-border-hover` | `#444444` | `#c8c8c8` |
| `--background-modifier-border-focus` | `#444444` | `#c8c8c8` |
| `--background-modifier-form-field` | `#1c1c1c` | `#fafafa` |
| `--text-normal/muted/faint/on-accent/highlight-bg` | （同名既有，桥不重复定义——主题在 body 级覆写天然生效） | 同左 |
| `--text-error` | `#e06c75`（--danger） | `#d04848` |
| `--text-accent` | `#8b7cf6` | `#6c5ce7` |
| `--text-accent-hover` | `#9d90f8` | `#5a4bd1` |
| `--text-selection` | `rgba(139,124,246,0.3)` | `rgba(108,92,231,0.25)` |
| `--accent-h/s/l` | `#8b7cf6` 的精确 HSL 三分量 | `#6c5ce7` 的 |
| `--interactive-accent` | `hsl(var(--accent-h), var(--accent-s), var(--accent-l))` | 同左 |
| `--interactive-accent-hover` | `#9d90f8` | `#5a4bd1` |
| `--interactive-normal` | `#2a2a2a` | `#f0f0f0` |
| `--interactive-hover` | `#363636` | `#e0e0e0` |
| `--code-background` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.05)` |
| `--link-unresolved-color` | `#8b7cf680` | `#6c5ce780` |
| `--background-modifier-error` | `#e06c75`（--danger） | `#d04848` |
| `--caret-color` | `var(--interactive-accent)`（消费侧 cmExtensions `caretColor: var(--caret-color, var(--accent))`——桥开恒等 accent，主题覆写生效） | 同左 |

**② Geode 变量 repoint**（`body` 作用域——元素级覆盖 html[data-theme] 定义，
无环：桥默认值全为字面量）：`--bg-app: var(--background-primary)`、
`--bg-panel: var(--background-secondary)`、`--bg-panel-alt:
var(--background-secondary-alt)`、`--bg-input: var(--background-modifier-
form-field)`、`--bg-hover: var(--background-modifier-hover)`、`--bg-active:
var(--background-modifier-active-hover)`、`--border: var(--background-
modifier-border)`、`--border-strong: var(--background-modifier-border-hover)`、
`--accent: var(--interactive-accent)`、`--accent-hover: var(--interactive-
accent-hover)`、`--selection: var(--text-selection)`、`--danger:
var(--text-error)`、`--code-bg: var(--code-background)`、`--link-unresolved:
var(--link-unresolved-color)`。**不 repoint**（无精确对应物，零视觉变化承诺
优先，缺口记录）：`--bg-modal`、`--shadow-modal`、`--accent-muted`、
`--callout-*`。
**字体钩子**：`body { font-family: var(--font-text-theme, <Geode 现默认栈
字面量>) }`（主题设 `--font-text-theme` 即生效；--font-interface/-monospace
不接，记录）。

### UI: 类名对齐 + 设置页 — `app/App.tsx` + `features/editor/EditorPane.tsx` + `features/settings/SettingsModal.tsx` + `core/i18n/dict.views.ts`（ui agent）

- **类名追加**（常驻、只增不改，app.css 选择器零改动）：`.app-body` +=
  `workspace`；`.ribbon` += `workspace-ribbon side-dock-ribbon mod-left`；
  `.sidebar-left` += `workspace-split mod-horizontal mod-left-split`；
  `.sidebar-right` += `workspace-split mod-horizontal mod-right-split`；
  `.main` += `workspace-split mod-vertical mod-root`；`.editor-pane` +=
  `workspace-leaf`；`.editor-preview` += `markdown-reading-view`；
  `.preview-content` += `markdown-preview-view markdown-rendered`；
  `.editor-cm-host` += `markdown-source-view mod-cm6`。（tab header/nav 树/
  modal/设置页类名不对齐——后续逐步，缺口记录。）
- **设置页 Appearance 节新增 "Obsidian CSS" 三项**（经 AppContext 的
  `obsidianCss` 句柄，features 不 import compat）：总开关
  （`data-testid="obsidian-css-toggle"`，settings-toggle 既有形态）；主题下拉
  （`obsidian-theme-select`，"无" + 发现列表，value=dir，显示 manifest name；
  激活值不在列表时附加显示）；snippets 开关列表（`obsidian-snippet-toggle-
  <name>`；空 → muted 提示行）。开关/下拉变更即调句柄 setter（async，错误
  console.warn 不抛 UI）。
- **i18n 8 键**（dict.views.ts，en+zh 双全）：`settings.obsidianCss`（"Obsidian
  CSS" / "Obsidian CSS 兼容"）、`settings.obsidianCssDesc`、
  `settings.obsidianTheme`、`settings.obsidianThemeDesc`、
  `settings.obsidianThemeNone`（"None"/"无"）、`settings.obsidianSnippets`、
  `settings.obsidianSnippetsDesc`、`settings.obsidianSnippetsEmpty`。

### 接线 — `main.tsx` + `app/AppContext.tsx`（compat agent；bootstrap wiring 例外面）

- main.tsx：`loadObsidianPlugins` 之后 `void initObsidianCss({vault, events,
  workspace})`（不阻塞启动）；AppContext 新增
  `obsidianCss: { state: Store<ObsidianCssState>; setEnabled; setTheme;
  setSnippet }`（obsidianLoadReport 先例——shell 持有 compat 句柄下放，
  features 仍零 compat import）。

### 口径（零代码，记录）

- 主题 CSS 只承诺**变量层生效 + 已对齐类名子集**；主题对未对齐 DOM 结构的规则
  （tab/nav/modal 深层）不生效或部分生效——「逐步对齐但不承诺」（OBSIDIAN-COMPAT
  R3 末战略口径）。
- compat 插件注入的 styles.css 与本层共存：插件样式在前（loader 既有时序），
  主题在后——同特异性主题胜（Obsidian 实际加载序同向）。
- 桥 repoint 后 Geode 变量经一层 var() 间接——DevTools 里追值多一跳（记录，
  非缺陷）。
- E2E（浏览器）：开关恒等断言（无主题时桥开/关计算样式一致）、fixture 主题
  变量穿透（--background-primary → .editor-pane 计算背景）、dark/light 切换
  选边、snippet 启停往返 appearance.json、总开关移除全部 style 元素、body 类
  跟随、设置页三控件交互。桌面（macOS .app）：真实社区主题（Minimal）目检
  截图。

### Round 20 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| core | core/vault.ts（ConfigDirEntry + listConfigDir 三实现） |
| compat | compat/obsidian/themes.ts（新）, compat/obsidian/theme-bridge.css（新）, src/main.tsx（接线行）, src/app/AppContext.tsx（obsidianCss 句柄） |
| ui | src/app/App.tsx（类名）, features/editor/EditorPane.tsx（类名）, features/settings/SettingsModal.tsx（Obsidian CSS 节）, core/i18n/dict.views.ts（8 键 en+zh） |

Chief pre-phase：本节契约 + Rust `vault_list_config_dir`。Frozen surfaces：
adapter `listConfigDir`/`ConfigDirEntry` 形状、themes.ts 导出五件套签名、
`obsidianCssState` 形状、三组 style 元素 id/attr 与注入序、变量映射表全表、
类名追加清单、localStorage 键、appearance.json 读写口径、AppContext.obsidianCss
形状、i18n 8 键。每 agent 结束前 `npx tsc --noEmit`；不加依赖；不碰 docs/、
src-tauri/**、core/markdown.ts、core/embeds.ts；ui agent 不碰 app.css 选择器
（仅 chief 核可的同步注释）；agent 行内注释不得修订契约（R13 教训）。

### As-built deltas (post-review — R20)

Review: 4 维（变量桥与层叠 / 注入与路径安全 / 生命周期与并发 / 分层契约），
评审 workflow 11 finding → 对抗验证 **10 confirmed（2 major）/ 0 refuted**
（security 维 agent 流超时，单独补跑 = 1 minor confirmed），全部修复：

- **FIXED (major) — R20-CSS-01：桥语义变量锁在 `.theme-dark` 特异性下，
  压制主题的官方 `body{}` 覆写**：真实 Obsidian 把语义变量（含 accent 系）
  定义在 `body{}`，Minimal/Things 等主流主题也在 `body{}` 覆写 accent——
  原桥把全部默认值放 `.theme-dark/.theme-light`（0,1,0），特异性恒胜主题的
  `body{}`（0,0,1），文档序救不了，主题 accent 被静默忽略（验证者 headless
  Chrome 复现 + 比对真实 Obsidian app.css 与 Minimal/Things 源码实锤）。
  修复 = 桥改三段式：私有 `--geode-ob-*` 模式原语进 `.theme-dark/.theme-light`
  （主题不触私有名），语义默认值全部移到 `body{}` 一跳 var() 引用——主题
  body{}（文档序）与 .theme-dark{}（特异性）两路覆写都生效。E2E 新增
  body{} accent 覆写回归用例。
- **FIXED (major) — R20-LC-1：setObsidianSnippet 并发丢更新**：next 数组在
  await 前从模块级 snippetOrder 快照、await 后整体覆盖回写——交错调用第二次
  覆盖第一次（磁盘丢数据 + state/DOM/磁盘三方不一致）。修复 = ① next 改在
  persistAppearance 的 mutate 内从刚读出的 obj 计算（增量 RMW）；② 单条
  `opChain` promise 链把 init + 全部 setter 串行化（enqueue），同时根治
  **LC-2**（init 尾部整体 state.set 用过期快照回滚交错 setter 的变更）。
  E2E 新增并发双 toggle 回归用例。
- **FIXED (minor) — R20-CSS-02：--caret-color 死旋钮**：桥定义了它但全仓无
  消费者（CM 主题硬编码 var(--accent)）。修复 = cmExtensions 两处改
  `var(--caret-color, var(--accent))` + 桥默认值改 `var(--interactive-accent)`
  （桥开恒等 accent、桥关走 fallback，零视觉变化承诺保持；主题覆写生效）。
  契约表已更新。
- **FIXED (minor) — R20-LC-3/CC-5：插件 styles.css 与主题的 head 文档序
  不变量**：切库/重载插件时 loader 把插件 style 追加到我们三组之后，
  「插件样式在前、主题在后」被打破。修复 = themes.ts 订阅
  `obsidianLoadReport`（compat 内部 import，分层合规），每轮插件加载后
  applyInjection 重建三组（append 回 head 末尾恢复不变量）。
- **FIXED (minor) — 安全 F-01：appearance.json 坏 JSON 触发最小化覆写**：
  原实现 parse 失败降级 `{}` 再写回——Obsidian 自有键（theme/accentColor/…）
  被静默清空。修复 = 文件缺失才从 `{}` 新建；存在但 unreadable/非对象 →
  抛错中止写入（fail-visible，setter 经 opChain warn 降级、state 不前进）。
  其余五个审计面（Rust 越界/symlink、setAttribute/textContent 注入、React
  转义、localStorage 异常、Memory 前缀匹配）零 finding。
- **FIXED (minor) — R20-CC-2**：`--background-modifier-error` 补入桥
  （= --danger 字面量，契约表已补行）。
- **FIXED (minor) — R20-CC-4**：`*.css?raw` 全局声明从 features/export/
  raw-import.d.ts 迁至 **src/raw-import.d.ts**（compat 不再编译依赖 feature
  目录内文件；katex-css.d.ts 注释同步修正）。
- **as-built 口径修正三处（实现合理、契约入档）**：① `vault:changed` 重发现
  收窄为 `reason === "load"`（vault ROOT 切换；逐文件事件不重发现——.obsidian
  不在 watcher 面，且逐 keystroke 重建 style 元素有闪烁风险）；② 总开关关闭
  时设置页主题下拉与 snippet 开关均加原生 `disabled` + aria-disabled（CC-3
  统一两控件机制）；③ ui agent 自加 `data-testid="obsidian-snippets-empty"`
  空态行（非冻结面）。
- 已知限制（记录）：appearance.json 写入沿用 `vault_write_config` 非原子
  fs::write（崩溃窗口可留半文件；F-01 修复保证后续操作不会再放大为键丢失，
  原子化留 R21+）；桥变量 `--text-accent`/`--interactive-normal`/
  `--interactive-hover` 等暂无 Geode 消费者（主题引用它们可正常解析——
  仅作默认值面，与真实 Obsidian 的消费深度有差距，逐步对齐口径）。

浏览器 E2E（dev :1420 + Playwright，.calibration/r20-e2e.mjs）33/33：恒等
开关、fixture 主题穿透（背景/侧栏）、**body{} 作用域 accent 覆写**（CSS-01
回归）、light/dark 选边、类名对齐、snippet 注入序/启停往返/未知键保留、
**并发双 toggle**（LC-1 回归）、**caret 旋钮**（CSS-02 回归）、总开关移除
三组、reinit 钩子。桌面（macOS，见 OBSIDIAN-COMPAT R20 节）。

## Round 19 additions — mermaid 图表（```mermaid fence → 动态 import 渲染）

R19+ 候选池首项（用户拍板 2026-06-12：「从 mermaid 开始，逐步完成每一项」）。
官方校准（obsidian.md/help/Editing+and+formatting/Advanced+formatting+syntax，
2026-06-12 WebFetch）：

- 语法 = ` ```mermaid ` 代码围栏；官方提及 flow charts / sequence diagrams /
  timelines，全量类型以 mermaid 官方文档为准。
- **internal-link 节点**：官方支持 `class A,B internal-link;` 把图内节点变为可点
  内链（特殊字符节点名用双引号包）；官方明示 "Internal links from diagrams
  don't show up in the Graph view"——不进 links 索引是官方行为，非偏差。
- 主题/样式官方未文档化——自定冻结口径：图表主题跟随应用主题
  （dark → mermaid "dark"，light → "default"）。

### 一次性决策（chief，agent 不得加依赖/不碰 Rust）

- **mermaid ^11（11.15.0）**——本轮唯一新增依赖（chief 已预装；自带类型，无需
  @types）。**动态 import**（katex R18 先例：core/mermaid.ts loadMermaid 模块级
  单例 promise，失败清缓存可重试；Vite 自动 code-split——主 chunk 零增长，
  零 mermaid 文档零加载）。
- **initialize 冻结配置**：`{ startOnLoad: false, securityLevel: "strict",
  suppressErrorRendering: true, theme }`——strict 走 mermaid 内置 DOMPurify
  消毒（maxTextSize/maxExpand 默认护栏不放宽）；suppressErrorRendering 禁止
  v11 向 body 注入错误 SVG（降级由我们自己的 error 口径接管）。theme 每次
  hydrate 批次按当前值 initialize（重复 initialize 廉价且幂等）。
- **渲染串行**：单文档多图逐个 `await mermaid.render(id, src)`（mermaid 全局
  状态，不并发）；id = 模块级自增 `geode-mermaid-{seq}`（脚注 render-seq 先例）。
- **live preview 零处理**（显式偏差，记录）：fence 在 live 维持源码呈现（既有
  fencedLines 排除面不动）。Obsidian live 光标外渲染 widget——跨行块 widget
  需 StateField 跨行 replace（R18 `$$` 块同因显式延后），入 R20+ polish 候选。
- **compat 零代码改动**：MarkdownRenderer 经共享管线 + 共享水合自动获得图表
  （R18 同口径：有意的基管线增强，非回归）。
- 无新增 i18n 键、无设置项、无 Rust 改动。

### Core: fence 渲染分流 — `core/markdown.ts`（core agent）

- **fence renderer 覆写**（首个 renderer.rules.fence 自定义；保存 default 引用）：
  `token.info` 经 markdown-it `unescapeAll().trim()` 后**首个空白分隔词与
  "mermaid" 大小写敏感全等** → 输出占位（冻结 DOM）：
  `<div class="geode-mermaid" data-mermaid="{escapeHtml(content.trimEnd())}">
  <pre class="geode-mermaid-source"><code>{escapeHtml(content.trimEnd())}</code>
  </pre></div>\n`（未水合显示源码——math 降级可读口径沿用）。
- 其余一切 fence **走 default renderer，输出字节级不变**（diff 义务：Part A
  33 用例含 ```js fence 不回退）；`Mermaid`/`MERMAID` 等非全等 info 照常走
  default（负向用例）。callout/blockquote/list 内的 mermaid fence 经 token 流
  天然分流（无行级特判）。
- **diff 套件（core agent 义务）**：改完重建 `.calibration/r18-diff/markdown-new.cjs`
  （esbuild bundle，现有产物同法），run.cjs 增 ≥5 个 mermaid Part B 用例
  （占位 DOM / data-mermaid 转义（`-->` → `--&gt;`）/ info 尾随空白容忍 /
  大小写负向 / callout 体内占位 / ```js 不受影响），72 旧用例全绿不回退。

### Core: 加载器 + 水合 — `core/mermaid.ts`（新）+ `core/embeds.ts`（core agent）

```ts
// core/mermaid.ts —— mermaid 动态加载器（katex/math.ts 同构）
/** Dynamic import("mermaid"). Caches the in-flight promise; a load failure
 *  clears the cache so the next call retries. No CSS import (mermaid inlines
 *  styles into each rendered SVG). */
export function loadMermaid(): Promise<typeof import("mermaid").default>;
```

- `HydrateContext` 增 `mermaidTheme?: "default" | "dark"`——缺省**水合时**读
  `document.documentElement.dataset.theme === "dark" ? "dark" : "default"`
  （应用内调用方含 compat 零接线自动跟主题）；导出显式传 `"default"`
  （export.css 浅色自包含口径）。**递归透传**（嵌套转写内图表同口径，
  mathOutput 先例）。
- hydrateEmbeds 新 pass：`root.querySelectorAll(".geode-mermaid[data-mermaid]")`
  非空才 `loadMermaid()`（零图表文档零开销）→ initialize（冻结配置 + theme）→
  **for 循环串行**逐元素 render：成功 → `el.innerHTML = svg`（SVG 自带内联
  样式，导出序列化自包含）→ **internal-link 后处理**：`el.querySelectorAll(
  ".internal-link")` 逐节点 `setAttribute("data-target", textContent.trim())`；
  失败 → `el.classList.add("geode-mermaid-error")` + 保留源码 fallback
  （**不预清内容**——render 返回字符串，成功才替换；单元素降级绝不抛，
  loadMermaid 失败整批保留 fallback，hydrate 纪律沿用）。

### Editor: 阅读视图交互 + 样式 — `features/editor/{EditorPane.tsx, editor.css}`（editor agent）

- onPreviewClick：`e.target instanceof HTMLElement` 收窄放宽为 `Element`
  （SVG 内点击现状直接 bail——closest 是 Element 方法，分支匹配器均锚定 HTML
  元素，类型安全；**as-built 修正**：既有 SVG 死区点击（如 KaTeX `\sqrt`
  拉伸件）放宽后会进入既有分支——可折叠 callout 标题内的 KaTeX svg 点击现在
  触发折叠，方向良性的行为变化，显式记录）。internal 分支之后新增：
  `el.closest(".geode-mermaid .internal-link[data-target]")` 命中 →
  preventDefault + `openWikilink(app, data-target, handle.path)`（unresolved
  → create-from-unresolved 既有语义；不传 subpath）→ return（不落入
  a[href] 分支）。
- editor.css：`.geode-mermaid`（居中 + 上下 margin + `svg { max-width: 100% }`）；
  `.geode-mermaid-source`（等宽淡显，未水合/加载失败可读）；
  `.geode-mermaid-error`（红色边框提示，`--danger` 变量——app.css 既有红色对，
  `.geode-math-error` 同口径；契约原文误称 `--text-error` R18 已有，该变量从未
  落地，as-built 修正）；
  `.geode-mermaid .internal-link { cursor: pointer }` + 节点文字 accent 色
  （`text { fill: var(--accent) }` 级别，仅 internal-link 节点）。

### Export — `features/export/{export.ts, export.css}`（export agent）

- inlineEmbeds ctx 增 `mermaidTheme: "default"`（打印路径同一调用点，自动同源）。
- export.css：`.geode-mermaid` 居中 + margin、`svg { max-width: 100% }`、
  `.geode-mermaid-source`/`.geode-mermaid-error` 同口径（本地变量体系，
  不引用 app.css）；internal-link 节点**无交互**（导出零 JS 口径——样式
  保持普通文字，不加 pointer）。
- 导出验证：含 mermaid 用例输出含 `<svg`（图内联自包含）且不含 blob:/外链
  脚本引用。

### 口径（零代码，记录）

- live preview 不渲染 mermaid widget（源码呈现，显式偏差，R20+ polish 候选）。
- 主题切换后**已渲染**图表保持旧主题至该视图重渲染（R11 外部改图 stale
  widget 先例）；导出恒浅色（export.css 主题无关口径）。
- 图内 internal-link 不进 links 索引 / graph（官方同行为，非偏差）；compat
  MarkdownRenderer 输出的图表带 data-target 但点击接线由调用方自理（记录）。
- mermaid 渲染含 `<foreignObject>` HTML 标签（flowchart htmlLabels）——strict
  模式经 DOMPurify 消毒；导出文件含其序列化结果（自包含，无外部引用）。
- 浏览器 E2E：阅读视图 mermaid SVG 出现 + 错误图降级 + internal-link 点击
  跳转 + 导出含 `<svg` 断言；diff 义务见 core 节。

### Round 19 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| core | core/markdown.ts, core/embeds.ts, core/mermaid.ts (new), .calibration/r18-diff/{run.cjs, markdown-new.cjs 重建} |
| editor | features/editor/{EditorPane.tsx, editor.css} |
| export | features/export/{export.ts, export.css} |

Chief pre-phase：本节契约 + mermaid ^11 预装。Frozen surfaces：`.geode-mermaid` /
`.geode-mermaid-source` / `.geode-mermaid-error` 类名与占位 DOM、`data-mermaid`
属性、info 首词大小写敏感全等规则、`loadMermaid` 签名、`HydrateContext.mermaidTheme`、
initialize 冻结配置、internal-link data-target 后处理规则。每 agent 结束前
`npx tsc --noEmit`；不加依赖；不碰 docs/、compat/**、src-tauri/**、core/markdown.ts
预处理段（replaceWikilinks——本轮 fence renderer 不动预处理）；agent 行内注释
不得修订契约（R13 教训）；core agent 跑 diff 套件全绿。

### As-built deltas (post-review — R19)

Review: 4 维（管线正确性 / 注入安全 / 水合生命周期 / 分层契约），13 findings →
对抗验证 **11 confirmed（1 major）/ 2 refuted**，确认项全部修复（去重后 7 个
独立根因）：

- **FIXED (major) — SEC-1：mermaid click 链接生成 `<a xlink:href>` 绕过预览
  a[href] 守卫**：strict 模式下 flowchart `click A "url"` 仍生效（setLink 无
  securityLevel 闸门；sanitizeUrl 只剥 javascript:/data:，相对路径/mailto 等
  放行），且 SVG 锚只带命名空间 `xlink:href`——`closest("a[href]")` 属性选择器
  永不匹配，非 http preventDefault 安全网失效，恶意图一键导航整个 webview
  （csp null）。双层修复：① core/embeds.ts 水合后处理 `neutralizeMermaidAnchors`
  ——http(s) 锚补平 `href` + `target="_blank"` + noopener（对齐 markdown 外链
  策略，导出序列化同样受益）、其余协议剥除两种 href 置惰性；② EditorPane 锚
  分支放宽为 `closest("a")` + 读 href ?? xlink:href（第二层防线）。浏览器实测：
  `click C "https://example.com"` → `_blank` 外链；`click D "../../evil"` →
  href 全剥除、导出内零非 http 锚点（`data-mermaid` 属性内的源码文本是惰性
  转义字面，非攻击面）。
- **FIXED (minor，三 finding 同根因 RENDER-1/SEC-2/HYD-1) — 跨批次主题竞态**：
  `mermaid.initialize` 同步改全局 config，而 render 经 mermaid 模块级
  executionQueue 串行消费、**出队执行时**才 getConfig() 取主题——导出
  （default）与应用内（dark）水合并发时，后发 initialize 毒化先发批次已排队
  的 render（验证 agent 以 Playwright 实跑复现：a2/e2 被互相截胡）。修复 =
  模块级 `mermaidBatchChain` promise 链把每批次（initialize + 全部 render）
  原子串行化，链路 catch 防断。嵌套转写递归批次排在外层之后，无死锁。
- **FIXED (minor) — internal-link accent 着色被 #id 作用域样式恒压制**：
  mermaid 向 SVG 内联 `#geode-mermaid-N` 前缀的主题样式（stylis 编译），
  含 ID 的选择器恒胜类链——accent 规则从不生效。修复 = editor.css 两条规则
  加 `!important`（mermaid label 规则自身无 !important，稳赢）。
- **FIXED (minor) — 打印路径杂散临时容器**：mermaid render 执行期向
  document.body 同步挂无样式临时 `div#d<render-id>`，print 样式不隐藏它——
  并发预览水合 + 打印时窗口真实（验证 agent 微任务级推演确认必现序）。修复 =
  printActiveNote 注入样式补 `@media print { body >
  div[id^="dgeode-mermaid-"] { display:none !important } }`。
- **FIXED (minor) — 陈旧水合批次无取消**：预览重渲染 detach 旧 DOM 后，旧批次
  继续全成本渲染（body 内真实布局测量）并占用全局队列。修复 = 批次起点
  `els.some(isConnected)` 才跟踪连接性，循环内跳过已 detach 元素——导出的
  detached container 批次不受影响（其元素从未 connected）。
- **FIXED (minor) — diff 套件判别性缺口**：info 首词规则缺第二词正向用例，
  「整串全等」变异体可存活（验证 agent 变异测试确认）。补
  `"```mermaid graph"` 用例封口（套件 78 用例全绿）。
- **FIXED (minor) — export.css 错误面板缺 padding**：与 editor 侧降级面板
  口径漂移，红框贴住源码块。补 `padding: 8px 12px`。
- **契约文本 as-built 修正两处**（实现合理、契约写错）：`--text-error` 为幽灵
  变量（R18 实际落地 `--danger`，本契约正文已改）；Element 放宽「行为不变」
  断言不实——KaTeX `\sqrt`/拉伸件 SVG 死区点击现在会进入既有分支（可折叠
  callout 标题内 KaTeX svg 点击触发折叠），方向良性的行为变化，正文已补记。
- **Refuted（2，记录）**：「成功绘制后置区段抛错泄漏临时 div」——装包源码逐
  路径核实该区段无可达抛出（DOMPurify 入参恒字符串、addA11yInfo 仅 textContent
  赋值）；「递归水合打破渲染串行契约」——mermaid v11 自带模块级 executionQueue
  全局串行化 render，directive 状态每次 render 起点 reset（跨批次并发由库内
  队列兜底——该依赖现已在 hydrateMermaid 注释与本节显式化；升级 mermaid 或
  改用 mermaidAPI.render 时须复核）。

桌面 release（v0.19.0 `geode.exe compat-vault`）实测结果见 OBSIDIAN-COMPAT R19
套件回归节。浏览器 E2E（dev :1420 + AppHandle 探针）：合法图 SVG 渲染 ✓、
非法图 `.geode-mermaid-error` 保源码 ✓、`class A internal-link` 节点
data-target + 点击 openWikilink 跳转 ✓、js fence 字节不变 ✓、mermaid chunk
零图表文档不加载（按需 import 实测）✓、导出/打印 HTML 内联 `<svg` 自包含 +
深色应用 vs 浅色导出主题分流（#id 归一化后样式串不同）✓、live 模式 fence
源码呈现零装饰 ✓。dev-only 已知现象：mermaid 首次按需优化触发 Vite 整页
reload（生产构建无此事）。

## Round 18 additions — Markdown 方言长尾：callouts + ==高亮== + 脚注 + %%注释%% + 数学公式

迁移体验路线图第三轮（ROADMAP R16-R18）。官方校准（obsidian.md/help/callouts +
basic-formatting-syntax + advanced-formatting-syntax，2026-06-11 WebFetch）：

- **callouts**：`> [!type]` 标题行 + 可选自定义标题；折叠变体 `[!type]-`（初始收起）/
  `[!type]+`（初始展开）；嵌套官方支持（"can nest in multiple levels"）；未知类型
  官方降级 note（"Any unsupported type defaults to the note type"）；体内容支持
  完整 markdown/wikilink/嵌入。13 类型 + 别名：note / abstract(summary,tldr) /
  info / todo / tip(hint,important) / success(check,done) / question(help,faq) /
  warning(caution,attention) / failure(fail,missing) / danger(error) / bug /
  example / quote(cite)。**颜色与图标官方未文档化**——色板与 mask 图标为自定冻结
  口径（向 Obsidian 默认主题观感对齐）；DOM 类名向社区共识对齐（.callout /
  .callout-title / .callout-icon / .callout-title-inner / .callout-content、
  data-callout、is-collapsible/is-collapsed）——主题 CSS 兼容层（R19+ 候选）受益。
- **`==高亮==`**：官方无附加限制文档；渲染为 `<mark>`。
- **脚注**：`[^id]` 引用 + `[^id]: 定义`（多行定义 = 续行行首 2 空格缩进）+
  行内脚注 `^[text]`；官方原文 "Inline footnotes only work in reading view,
  not in Live Preview"——live preview 零处理即官方行为。
- **`%%注释%%`**：行内与跨行块两形态；官方 "Comments are only visible in
  Editing view"——阅读视图完全剥除。
- **数学**：inline `$...$` + 块 `$$...$$`。**官方引擎是 MathJax，本轮选 KaTeX**
  （HANDOFF 口径：更轻）——TeX 宏覆盖面差异显式记录为偏差（KaTeX 不支持的宏
  红色降级显示原文，永不抛）。

### 一次性决策（chief，agent 不得加依赖/不碰 Rust）

- **katex ^0.17 + @types/katex（dev）**——本轮唯一新增依赖（moment/ureq 先例，
  chief 已预装）。**动态 import**（Vite code-split：主 chunk 零增长，首个含数学
  的渲染才加载）；katex CSS 经 loader 一次性注入应用。
- **mermaid 显式不做**（决策入档）：~1MB 级、主题/交互接线重、迁移叙事优先级低于
  数学公式；记入 R19+ 候选池。动态 import 先例本轮由 katex 蹚出，将来按需直接复用。
- 其余四项**零新依赖**：core/markdown.ts 内手写 markdown-it 规则（不装任何
  markdown-it-* 插件）；live preview 沿用既有装饰结构（语法树 + 正则扫描）。
- **导出数学走 MathML 输出**（katex `output:"mathml"`）：自包含单文件零 CSS/字体
  依赖；应用内走 `output:"html"` + katex CSS。打印（PDF）路径与导出同源同值。
- **compat 零代码改动**：MarkdownRenderer 经共享管线自动获得全部新语法
  （有意的基管线增强，非回归——OBSIDIAN-COMPAT 收尾记录）。
- 无新增 i18n 键、无设置项、无 Rust 改动。

### Core: 管线规则 — `core/markdown.ts`（core agent）

**预处理扩展（replaceWikilinks 的行级状态机）**——执行序：fence 跟踪（现状）→
**frontmatter 排除**（首行 `---` 至闭合 `---`，状态机新增，镜像 R17 foldService
口径——阅读视图接收完整源文，实测确认）→ **`%%注释%%` 剥除（新）** → 行尾块标记
剥除（现状）→ wikilink 占位（现状）：

- 同行成对 `%%...%%` → 行内剥除（非贪婪逐对；行号稳定义务沿用）。
- 跨行块注释：行内出现无配对的 `%%`（backtick 奇偶分割后的非 code 段中）→ 该行
  自 `%%` 起剥到行尾，其后每行整行清空（**保留空行**，行号稳定），直至含闭合
  `%%` 的行（剥至闭合符含；闭合符后同行余文保留参与渲染）。
- fence 内 `%%` 字面保留（fence 优先级最高）；frontmatter 区不剥。
- 行内 code 段（奇数段）内的 `%%` 不剥、不开块（与 wikilink 同口径）。文档无
  `%%` 时该步零改动（diff 义务）。

**markdown-it 规则（全部手写，规则名 geode-* 前缀）**：

- **highlight（inline rule，delimiter 法照 strikethrough 模式）**：`==text==` →
  `<mark>`。开闭定界紧邻非空白（scanDelims flanking）；不跨段落；`<mark>` 内
  强调/链接/wikilink 占位符正常解析。单个/不成对 `==` 字面保留。
- **footnotes（block rule + inline rule + core rule 收尾）**：
  - 定义：行首 `[^id]:`（id 冻结 `[^\s\[\]]+`，大小写敏感）+ 内容；续行 = 行首
    ≥2 空格缩进的后续行（并入同段，inline 渲染）。定义体不支持嵌套块结构
    （列表/fence 不解析——口径记录）。
  - 引用：`[^id]` → `<sup class="footnote-ref"><a id="fnref-{N}" href="#fn-{N}"
    class="footnote-link" data-footnote="{N}">[{N}]</a></sup>`；行内脚注
    `^[text]` → 匿名定义自动收集同形态。N = 首次引用序（1 起）。
  - 文末（有被引用定义才输出）：`<hr class="footnotes-sep"><section
    class="footnotes"><ol class="footnotes-list"><li id="fn-{N}"
    class="footnote-item">{定义 inline 渲染} <a href="#fnref-{N}"
    class="footnote-backref">↩</a></li>…</ol></section>`。
  - 同 id 多次引用同号，backref 回首个引用；未引用定义不输出；未定义引用保持
    字面原文（含 `[^`）。
- **callouts（core rule，blockquote token 树改写，处理全部层级——嵌套递归）**：
  blockquote 首个 inline 的首行匹配冻结正则
  `/^\[!([A-Za-z0-9_-]+)\]([+-]?)(?:[ \t]+(.*))?$/`：
  - blockquote_open/close 改写为 `<div class="callout{ is-collapsible}{ is-collapsed}"
    data-callout="{type 小写}"{ data-callout-fold="+|-"}>`；`-` = is-collapsible +
    is-collapsed，`+` = is-collapsible。
  - 标题行 → `<div class="callout-title"><div class="callout-icon"></div><div
    class="callout-title-inner">{标题 inline 渲染}</div></div>`（icon 空容器，
    图形由 CSS data-callout mask 提供）；无标题 → 输入 type 原词首字母大写
    （别名不归一显示——`[!tldr]` 显示 "Tldr"，所见即所写口径）。
  - 标题行之后的全部内容（含首段余行）→ `<div class="callout-content">` 包裹。
  - 未知类型照常改写，data-callout 保留原词小写（CSS 兜底 note 配色）。
  - 普通 blockquote（首行不匹配）字节级不变（diff 义务）。
- **math（block rule + inline rule）**：
  - block：行首 `$$`（缩进 ≤3）至闭合 `$$` 行（`$$x$$` 单行形态成立）→
    `<div class="geode-math geode-math-block" data-math="{tex escaped}">{原文
    escaped}</div>`（未水合时显示原文——降级可读）。
  - inline：**单** `$`（开 `$` 后不跟 `$`、闭 `$` 前不是 `$`——`$$` 永远不参与
    inline 配对）、开 `$` 后紧邻非空白、闭 `$` 前紧邻非空白、闭 `$` 后不跟数字、
    内容无换行 → `<span class="geode-math geode-math-inline" data-math="{tex}">{原文
    escaped}</span>`。`\$` 经 markdown-it escape 规则天然豁免；fence/inline code
    内天然豁免（规则层级）。货币护栏即上述 flanking（"$5 and $10" 不触发）。
  - 已知口径：`$...$` 内的 `[[x]]` 会先被 wikilink 预处理替换（罕见路径，记录）。

### Core: 水合 — `core/embeds.ts` + `core/math.ts`（新）（core agent）

```ts
// core/math.ts —— katex 动态加载器（模块级单例 promise）
/** Dynamic import("katex") + one-time CSS injection
 *  (import("katex/dist/katex.min.css")). Caches the in-flight promise;
 *  a load failure clears the cache so the next call retries. */
export function loadKatex(): Promise<typeof import("katex").default>;
```

- `HydrateContext` 增 `mathOutput?: "html" | "mathml"`（缺省 "html"；**递归透传**
  ——嵌套笔记转写内的数学同口径）。
- hydrateEmbeds 新 pass：`root.querySelectorAll(".geode-math[data-math]")` 非空
  才 `loadKatex()`（无数学文档零开销）→ 逐元素
  `katex.render(tex, el, { displayMode: <is geode-math-block>, throwOnError:
  false, output })`（render 前清空回退原文）。单元素异常 → 加 `.geode-math-error`
  类 + 保留原文，绝不抛（hydrate 逐元素降级纪律沿用）。

### Editor: live preview 装饰 — `features/editor/livePreview.ts`（editor agent）

全部沿用现有结构（visibleRanges + selectionTouches reveal + fencedLines/
frontmatter 排除；正则扫描不跳行内 code 的既有不对称沿用并记录）：

- **highlight**：正则扫描（单行、定界紧邻非空白）→ 内容 mark
  `.cm-live-highlight`；两侧 `==` replace 隐藏（选区触及还原）。
- **comment**：同行成对 `%%...%%` → 整段 replace 隐藏（选区触及还原）；**跨行块
  注释 → 行级装饰 `.cm-live-comment-line`（--text-faint 淡显，不隐藏）**——
  ViewPlugin 不得建跨行 replace（CM 约束），块 widget 不值当；显式偏差：Obsidian
  live preview 全隐藏。
- **footnote**：`[^id]` → mark `.cm-live-footnote-ref`（上标样式，不隐藏）；
  `^[text]` 与定义行零处理（官方 live 行为）。
- **callout**：语法树遍历中 Blockquote 节点首行内容匹配冻结正则 → 该 blockquote
  全部行 line decoration `.cm-callout-line` + `attributes: {"data-callout":
  "<type 小写>"}`；首行另加 `.cm-callout-line-title`；`[!type]±` 标记 replace
  隐藏（该行选区触及还原）；`>` 标记隐藏走既有 QuoteMark 路径（现状不动）。
  图标 = CSS `::before` on `.cm-callout-line-title`（data-callout mask，零 DOM
  注入）。折叠交互不做标题点击（既有 blockquote hover 折叠箭头可用——R17
  foldNodeProp 回退面，偏差记录）。既有 `.cm-live-quoteline` 与 callout 行装饰
  共存口径：callout 行**不再**叠加 quoteline（视觉冲突），Blockquote 分支内分流。
- **math**：inline `$...$`（flanking 与管线冻结规则一致）选区未触及 →
  `MathWidget` replace（EmbedWidget 同构：sync toDOM 占位 span
  `.cm-live-math`，异步 loadKatex + render(html 输出) 填充；视图 destroy 后回调
  不再触碰 DOM）；单行 `$$x$$` → displayMode widget 同路径；**跨行 `$$` 块 →
  行级装饰 `.cm-live-math-line`（等宽淡显），不渲染 widget**（偏差记录，阅读
  视图全量支持）。

### Editor: 阅读视图交互 — `features/editor/EditorPane.tsx`（editor agent）

onPreviewClick 委托扩展两条（既有 internal-link/checkbox 委托之前判定）：
- `.callout.is-collapsible > .callout-title` 点击 → 最近 `.callout` toggle
  `.is-collapsed`（纯 class 切换，重渲染后回到初始态——状态不持久化口径）。
- `a.footnote-link` / `a.footnote-backref` 点击 → preventDefault + 预览容器内
  `getElementById(href 目标)` → `scrollIntoView({block:"center"})`（不触发
  internal-link 委托）。

### Styles — editor agent: `features/editor/editor.css` + `src/styles/app.css`（变量节）；export agent: `features/export/export.css`

- **callout 色板（冻结，rgb 三元组，dark/light 同值）**——app.css `:root` 新增：
  `--callout-note: 68,138,255`、`--callout-abstract: 0,191,188`、
  `--callout-info: 0,184,212`、`--callout-todo: 0,184,212`、
  `--callout-tip: 0,191,188`、`--callout-success: 68,207,110`、
  `--callout-question: 236,151,49`、`--callout-warning: 236,151,49`、
  `--callout-failure: 233,49,71`、`--callout-danger: 233,49,71`、
  `--callout-bug: 233,49,71`、`--callout-example: 168,130,255`、
  `--callout-quote: 158,158,158`；高亮 `--text-highlight-bg`：dark
  `rgba(255,208,0,0.22)` / light `rgba(255,208,0,0.35)`。
- callout 呈现：容器 `border-left: 3px solid rgb(var(--callout-*))` + 背景
  `rgba(var(--callout-*), 0.08)` + 圆角；标题行加粗、文字色 rgb(var(--callout-*))；
  图标 = mask data-URI（13 个 lucide 风格 SVG 内联进 CSS，--callout-* 着色）；
  别名经 CSS 属性选择器映射同色（`[data-callout="summary"]` → abstract 色等，
  别名表冻结于上）；未知类型兜底 note 色（`.callout` 基础规则即 note 值）。
  `.callout.is-collapsed > .callout-content { display: none }`；is-collapsible
  标题加折叠指示（::after chevron，is-collapsed 旋转）。
- `<mark>` / `.cm-live-highlight`：背景 var(--text-highlight-bg)，前景继承。
- footnotes section：上边距 + --text-muted 小字号；`.footnote-ref` 上标；
  `.footnote-backref` 无下划线。
- math：`.geode-math-block` 居中 + 上下 margin；`.geode-math-error` 红字保
  原文（dark `#ff6b6b` / light `#d33` 级，走新变量 `--text-error` 或既有等价
  变量，agent 查 app.css 现状后跟随）；`.cm-live-math-line` 等宽 + --text-faint。
- export.css 本地变量体系同步实现全部上述（callout 13 色 + 图标 mask + 高亮 +
  footnotes + MathML 基础 margin）——导出文件自包含，不引用 app.css 变量。

### Export — `features/export/export.ts` + `export.css`（export agent）

- inlineEmbeds 的 hydrateEmbeds ctx 增 `mathOutput: "mathml"`；打印路径同。
- 折叠 callout 导出静态呈现初始态（is-collapsed 即收起，无交互脚本——导出
  零 JS 口径不变）。
- 导出验证：含数学用例输出含 `<math` 且不含 katex 字体/CSS 引用。

### 口径（零代码，记录）

- live vs reading 四条显式偏差：跨行 `$$` 块 live 不渲染 widget、跨行块注释
  live 淡显不隐藏、行内脚注 live 零处理（官方同行为）、callout 标题点击折叠
  live 不做（gutter 手动折叠可用）。
- KaTeX vs MathJax 宏覆盖面差异（mhchem 等扩展不带）；不支持宏红色降级。
- 脚注定义体无嵌套块结构；callout 标题显示原词 capitalize；`$...$` 内 wikilink
  先被预处理（罕见）。
- compat `getFileCache()` 不收脚注/callout 元数据（官方 CachedMetadata 也无
  此专项形状）；compat 本轮零改动。
- 浏览器 E2E：五项语法双视图 DOM 断言 + 导出 MathML/类名断言 + 折叠交互；
  **diff 义务（core agent）**：无新语法用例（沿用 r12 起的 20+ 用例面）渲染输出
  字节级一致。

### Round 18 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| core | core/markdown.ts, core/embeds.ts, core/math.ts (new), core/katex-css.d.ts (new — CSS import shim，沿 R7 raw-import.d.ts 先例，R18 评审 CONTRACT-05 追认登记) |
| editor | features/editor/{livePreview.ts, EditorPane.tsx, editor.css}, src/styles/app.css（仅变量节） |
| export | features/export/{export.ts, export.css} |

Chief pre-phase：本节契约 + katex/@types/katex 预装。Frozen surfaces：上述全部
类名与 data-* 属性、五项冻结正则/flanking 规则、callout 类型别名表与色板、
`HydrateContext.mathOutput`、`loadKatex` 签名、footnote DOM 形状、`<mark>` 输出。
每 agent 结束前 `npx tsc --noEmit`；不加依赖；不碰 docs/、compat/**、src-tauri/**；
agent 行内注释不得修订契约（R13 教训）；core agent 跑无新语法用例字节级 diff；
动 vault/documents 路径前必读 R16 As-built deltas（本轮不应触碰）。

### As-built deltas (post-review — R18)

Review: 4 维（管线正确性 / 注入安全 / live 共存生命周期 / 分层契约），**17 findings →
对抗验证 17 confirmed（0 证伪）**，全部修复，浏览器 E2E + 桌面 release 实测逐项复验。
17 条归并为 ~11 个独立根因（4 major），集中在 core/markdown.ts 与
features/editor/livePreview.ts：

- **FIXED (major) — callout 二次 inline.parse 导致行内脚注双收集**（PIPE-01/CONTRACT-01）：
  geode-callouts 原注册在内置 "inline" core rule **之后**，callout 首段已被完整分词一次
  （geode-footnote-inline 把 `^[text]` push 占编号），随后 callout 改写对标题/首段余行用同一
  env **二次** md.inline.parse → 重复 push（幽灵 li + 悬空 backref + 编号跳号/逆序）。根治 =
  改 `md.core.ruler.before("inline", "geode-callouts")`：在 inline 分词前改写 blockquote token
  （此时 inline child 仅有 .content、children 未解析），标记行从 content 切除、标题/体留未分词
  inline token 交内置规则**只解析一次**；删除两处手动 inline.parse；geode-footnotes-tail 仍
  after("inline")。`[^id]` 形式本就因 order Map 去重不受影响。
- **FIXED (major) — `$$` 块闭合判定吞行 + 与 live 分叉**（PIPE-04/CONTRACT-03）：block rule
  首行 `firstRest` 含**非行尾** `$$` 时直接 return false 保字面（`$$x$$ foo` 不再跨行吞并后续
  段落/合法公式块）；跨行闭合扫描遇 fence 开启行（缩进≤3 的 ```/~~~）止损按未闭合处理。
- **FIXED (major) — live 单行 `$$` 无锚定**（LP-1）：widget 路径弃全文盲扫正则，改逐行
  `/^ {0,3}\$\$([^$\n]+?)\$\$[ \t]*$/`（镜像管线 block rule：行首、缩进≤3、闭合后仅空白）；
  缩进代码块（CodeBlock lezer 节点）行并入 highlight/footnote/math 统一排除集。
- **FIXED (minor) — 预处理 fence 状态机三处脱节**（PIPE-02/03/05+CONTRACT-02）：replaceWikilinks
  的 fence 跟踪重写为 (char, len, indent) 感知（闭合要求同字符 + 长度≥开启 + 无 info string，
  缩进≤3，与 markdown-it 对齐——`````不再被 ``` 假闭合）；%%注释剥除后与跨行注释闭合余文
  **重跑 fence 检测**；frontmatter 行**仍参与 fence 奇偶跟踪**（仅跳过替换本身）——三者共同
  消除 `@@GEODELINK@@` 占位符泄漏进代码块 / fence 内字面 %% 被删 的盲区。「no placeholder
  ever survives」不变式恢复；Part A 33 字节级用例不回退。
- **FIXED (minor) — 脚注 DOM id 跨渲染碰撞**（PIPE-06）：每次 render 加模块级 `footnoteRenderSeq`
  前缀，id = `fn-{seq}-{n}` / `fnref-{seq}-{n}`（data-footnote 仍 `{n}`）——宿主与转写嵌入笔记
  （分别 render）id 不再撞，点击不跨笔记错跳。
- **FIXED (minor) — KaTeX maxSize DoS**（SEC-01）：三处 katex.render（embeds.ts 阅读/导出 +
  livePreview.ts MathWidget）均加 `maxSize: 100`——`\rule{1e6em}` 类巨尺寸不再冻结渲染线程
  （maxExpand 默认 1000 已拦宏炸弹）。
- **FIXED (minor) — live callout 嵌套首行误判**（LP-2）：Blockquote 前缀剥离从「吞所有 `>` 层级」
  改为按节点自身 offset **只剥一层**——`> > [!tip]` 的外层普通引用不再整体误染 callout。
- **FIXED (minor) — live `%%` 行内 code 翻转状态机**（LP-3）：%% 扫描做 backtick 奇偶分割（本地
  重实现，不 import core 私有函数），行内 code 内 `%%` 不再开幽灵注释块污染后续行。
- **FIXED (minor) — live highlight 无结构感知**（LP-4）：highlight 扫描排除 setext 下划线行
  （lezer 节点名是 **`SetextHeading1`/`SetextHeading2`** 非 `SetextHeading`——chief 实测修正
  agent 的精确等值判断为 `startsWith`）+ wikilink 折叠区间——`=====` 下划线与 `[[a==b==c]]`
  显示文本不再被切割。
- **FIXED (minor) — MathWidget 点击死区**（LP-5）：MathWidget 覆写 `ignoreEvent(){return false}`
  ——点击公式落标还原源码，且不再吞落在公式上的 drop/paste（R17 attachmentIngest）。
- **FIXED (minor) — live 行内数学闭合 `$` 不检查转义**（CONTRACT-04）：INLINE_MATH_RE 改手写
  `scanInlineMath`（镜像 markdown.ts isEscapedAt 反斜杠奇偶），`$a\$b$` 不再在转义 `$` 处提前
  闭合——live 与阅读视图收敛。
- **Accepted（记录）**：`$$a$b$$`（内含单 `$`）live 保字面而阅读渲染（charset 既有偏差，LP-1
  范围外）；真正嵌套 callout 自身首行可能同时带 quoteline + callout-line（只剥一层范围内，罕见）；
  `katex-css.d.ts` 登记入所有权表（CONTRACT-05，见上）。

桌面 release（v0.18.0 `geode.exe compat-vault` 真实文件系统）：R18 双视图实测 17/17 全绿
（阅读 callout/`<mark>`/脚注 seq-id/inline+block KaTeX 0 error/注释隐藏/货币字面；live setext
下划线完整/`foo $$x$$ bar` 不误渲染/嵌套 callout 外层 quote/`[[a==b==c]]` 完整/2 math widget
KaTeX）；套件 5/5 + nldates 指令条 + reload 幂等 + 回声 suppressed4/external2 不回退；r17
折叠+摄入 10/10（disk-roundtrip 70 字节无损——探针陈旧字面 68 顺手修正）。字节级 diff 套件
72 用例全绿（33 无新语法字节一致 + 39 新语法 DOM）。katex 独立异步 chunk（260KB gzip 77KB，
零数学文档不加载），主 chunk 仅 +约 2KB。

## Round 17 additions — 附件摄入（粘贴/拖拽图片入库）+ 标题/列表折叠

迁移体验路线图第二轮（ROADMAP R16-R18）。官方校准（obsidian.md/help/attachments +
obsidian.md/help/folding，2026-06-11 WebFetch）：

- **附件位置**四选项："Vault folder"（库根）/ "In the folder specified below"（指定
  文件夹）/ "Same folder as current file" / "In subfolder under current folder"；
  子文件夹缺失时 **"If it doesn't exist, Obsidian creates it when you add an
  attachment"**（自动创建）。配置值格式官方未文档化——按 Obsidian 实际
  `attachmentFolderPath` 语义自校准（见下 resolveAttachmentDir，显式口径）。
- **折叠**：Settings → Editor 的 "Fold heading" + "Fold indent"，**默认开**；箭头
  "hovering the mouse cursor over the section … selecting the arrow on the left"，
  **已折叠的节无论 hover 与否常显箭头**；命令 "Fold all headings and lists" /
  "Unfold all headings and lists"。
- 粘贴图片命名 `Pasted image YYYYMMDDHHMMSS.<ext>` 为 Obsidian 实测惯例（官方帮助
  未文档化）——自定口径显式采用。

### 一次性决策（chief，agent 不得加依赖/不碰 Rust）

- **零新增 npm 依赖**：折叠用既有 `@codemirror/language`（codeFolding/foldGutter/
  foldService 全在其中，R4 起已在依赖树，从未接线）。
- Rust 新命令 `vault_write_binary`：`#[tauri::command(async)]`（文件 IO 离主线程，
  R6 教训）+ safe_join + **已存在即拒绝**（镜像 vault_create）+ `create_dir_all(parent)`
  + **原子写**（sibling `.{name}.geode-tmp` + rename，vault_write R16 先例——点前缀
  落在 watcher 噪声过滤里，启动清扫顺带覆盖）。
- 二进制自写**不打回声指纹**（FNV-1a 是文本口径）：桌面 watcher 会把自写 create 当
  外部事件 → 仅多一次 refreshTree（非 md 不发 file:modified，无编辑器干扰），失败
  方向安全——显式口径，不为此扩展指纹机制。
- 折叠扩展进 buildEditorExtensions **基础列表**（live 与 source 共用，不进
  modeCompartment——CM fold 状态存 EditorState，模式 reconfigure 天然保留）。

### Chief pre-phase: 二进制写全链 — `core/vault.ts` + `src-tauri/src/main.rs`

```ts
// VaultAdapter:
/** Write raw bytes to a NEW file (attachment ingestion, R17). Rejects when the
 *  path already exists. Parent folders are created as needed. */
writeBinary(path: string, data: Uint8Array): Promise<void>;
// Tauri → base64 编码 → invoke("vault_write_binary")（与 readBinary 互为镜像）。
// Memory → files/binaryFiles 任一已含该 path 即 throw；binaryFiles.set + 父文件夹注册
//          （镜像 createFile）。

// Vault facade:
/** Create a new binary file: adapter.writeBinary → refreshTree →
 *  emit file:created → emit vault:changed({reason:"create"})（与 create() 同序，
 *  attachmentMaps 因 vault:changed 失效 → resolveAttachment 即刻可见新文件）。
 *  不进 contentCache、不打回声指纹（见一次性决策）。 */
createBinary(path: string, data: Uint8Array): Promise<void>;
```

### Core: 附件摄入引擎 — `core/attachments.ts`（新，core agent）

```ts
/** localStorage "geode.attachmentFolder"，默认 "assets"。存 trim 后原文。 */
export const attachmentFolder: Store<string>;
export function setAttachmentFolder(value: string): void; // set + persist（linkRewrite 模式）

/** Obsidian attachmentFolderPath 语义（冻结）：
 *  ""/"/"        → vault 根（返回 ""）
 *  "./"          → 笔记同目录
 *  "./sub/x"     → 笔记同目录下子路径
 *  "folder/sub"  → vault 级固定文件夹
 *  返回 vault 相对目录（无尾随 "/"，根 = ""）。notePath 取 parent 目录。 */
export function resolveAttachmentDir(notePath: string, setting: string): string;

export interface ImportAttachmentDeps { vault: Vault; metadata: MetadataIndex }
/** 把二进制摄入附件目录：sanitize baseName（剥路径分隔符与 \/:*?"<>| 及控制字符 →
 *  "-"；空名 → "attachment"）→ resolveAttachmentDir(notePath, attachmentFolder.get())
 *  → 目录缺失时递归创建（vault.folderExists 守卫 + vault.createFolder——Rust mkdir
 *  = create_dir_all；Memory 同语义，agent 验证）→ vault.uniquePath(dir, stem, ext)
 *  防冲突 → vault.createBinary → 返回 { path, linktext }。
 *  linktext = createBinary 后 resolveAttachment(完整文件名, notePath) === path 时用
 *  完整文件名（basename 含扩展名），否则全路径（fileToLinktext 消歧精神，R16 同源）。
 *  全程错误向上抛（调用方决定 UI 反馈）。 */
export async function importAttachment(
  deps: ImportAttachmentDeps, notePath: string, baseName: string, data: Uint8Array,
): Promise<{ path: string; linktext: string }>;
```

### Editor: paste/drop 摄入 — `features/editor/attachments.ts`（新，editor agent）

```ts
/** CM 扩展：EditorView.domEventHandlers({ paste, drop })。 */
export function attachmentIngest(app: GeodeApp, getPath: () => string): Extension;
```

- **paste**：`clipboardData.items` 中 `kind === "file"` 且 type 以 `image/` 开头的
  全部项 → 命中至少一个即 `preventDefault` + 返回 true（吃掉整个粘贴——Obsidian
  同行为：富文本中混图时图片胜出，口径记录）；每项命名一律
  `Pasted image YYYYMMDDHHMMSS.<ext>`（ext 经 MIME 映射表；同秒多张靠 uniquePath
  ` 1`/` 2` 后缀）。无图片项 → 返回 false，文本粘贴零干扰。
- **drop**：`dataTransfer.files` 过滤（扩展名 ∈ core IMAGE_EXTS 或 MIME image/*）；
  命中至少一个 → `preventDefault`，插入点 = `view.posAtCoords({x,y}) ?? 当前光标`，
  文件名保留原名（sanitize + uniquePath 防冲突）。零命中 → 不消费（CM 默认文本
  拖放不受影响）。
- 插入文本：每文件 `![[linktext]]`，多文件 `\n` 连接；paste 替换当前选区，drop 在
  drop 点插入（不替换选区）。导入是 async——dispatch 前检查视图存活
  （`view.dom.isConnected`），位置 clamp 到当前文档长度（导入期间用户可能继续编辑
  ——clamp 即可的保守口径，编辑竞态属罕见路径）。
- 单文件导入失败：console.error + 跳过该文件，不阻断其余（全程不抛进 CM）。
- MIME → ext 映射（冻结）：image/png→png、image/jpeg→jpg、image/gif→gif、
  image/svg+xml→svg、image/webp→webp、image/bmp→bmp；映射外的 image/* → 按
  MIME 子类型字符串兜底（剥 "+xxx"）。

### Editor: 折叠 — `features/editor/folding.ts`（新，editor agent）

```ts
/** codeFolding + foldGutter + 自定义 foldService + fold keymap（一揽子）。 */
export function markdownFolding(): Extension;
// App.tsx 命令消费（经 documents.getActiveView()）：
export function foldAllInView(view: EditorView): void;
export function unfoldAllInView(view: EditorView): void;
export function toggleFoldAtCursor(view: EditorView): void;
```

**foldService 语义（冻结——评审按此对抗）**：

- **heading**：行首为 ATXHeading1-6 节点（syntaxTree——fence 内天然不解析为
  heading，零额外排除逻辑）→ 折叠范围 = 标题行末 → **节末**（下一个 level ≤ 当前
  的 ATXHeading 行首之前的行末；无后继 → doc 末尾）。SetextHeading 出轮（缺口）。
- **列表项**：ListItem 节点跨多于一行 → 折叠范围 = 项首行末 → `node.to`（含全部
  嵌套子项/续行；嵌套列表由内层 ListItem 自身再提供折叠点）。
- **foldGutter**：自定义 markerDOM = chevron（CSS 旋转三角）；**可折叠行的箭头仅
  编辑器 hover 时显示，已折叠行常显**（官方行为）；gutter 背景透明无边框（编辑器
  此前零 gutter，不得引入视觉底色/布局突变——editor.css 收口）。折叠占位符走默认
  `.cm-foldPlaceholder`，配色用 --text-muted/--border 变量。
- **live preview 共存（评审重点，口径冻结）**：computeDecorations 走 visibleRanges
  ——折叠区不可见、不装饰**是正确行为**（fold 状态变化触发 viewportChanged →
  装饰重算）；heading 行自身的 `#` 标记隐藏装饰与 gutter 元素无 DOM 交叠；
  frontmatter pill 不在 heading/list 折叠面内，互不相干。评审验证项：折叠跨
  widget（EmbedWidget/NoteEmbedWidget 在折叠区内）往返后装饰正确重建、
  replace 装饰不跨折叠边界报错。
- App.tsx 三命令（editor agent 接线，i18n 键 chief 预置）：`editor:toggle-fold` /
  `editor:fold-all` / `editor:unfold-all`，name thunk `t("cmd.toggleFold")` 等，
  无默认快捷键（Obsidian 同样无）；callback 经 `app.documents.getActiveView()`，
  无活动 CM 视图 → no-op。

### UI: 附件目录设置 — `features/settings/SettingsModal.tsx`（ui agent）

- R16 "Files & links" 组追加 setting-item：**文本输入**
  `data-testid="settings-attachment-folder"`，value 绑 attachmentFolder store
  （useStore），onChange → setAttachmentFolder（即时持久化）；placeholder
  `"assets"`；输入框样式新增 `.settings-text-input`（settings css，走既有 CSS
  变量，无硬编码色）。
- 文案键（chief 预置 dict.views.ts）：`settings.attachmentFolder` +
  `settings.attachmentFolderDesc`（desc 说明 "/"、"./"、"./sub"、"folder" 四语义）。

### 口径（零代码，记录）

- 仅图片摄入；非图片文件的粘贴/拖拽不消费（Obsidian 导入任意附件类型——缺口表
  记录，R18+ 按需）。
- 折叠状态**不持久化**：存 EditorState，live↔source 切换保留（Compartment 不重建
  state），tab 关闭/重开、preview 往返（CM 销毁）丢失——Obsidian 按文件持久化，
  显式偏差记录。
- 阅读视图（preview）无折叠（Obsidian 阅读视图可折叠——缺口记录）。
- "Fold heading"/"Fold indent" 细分设置开关出轮：折叠常开（官方默认开；细分开关
  按需 R18+）。
- compat `vault.getConfig("attachmentFolderPath")` 仍返回 undefined（缺口表既有
  条目不变；接通 attachmentFolder 为 R18+ 候选）。compat 本轮零改动。
- 浏览器 E2E 注入口径：合成 `File` + `DataTransfer` 构造 `ClipboardEvent("paste")`
  / `DragEvent("drop")` 派发到 `.cm-content`（Chromium 双端可构造，无需新探针）。

### As-built deltas (post-review — R17)

Review: 4 dimensions (data-safety / correctness / live-coexist / layering-contract),
20 findings → 对抗验证 20 confirmed（去重后 ~12 根因：5 major + minors）0 证伪。
全部确认缺陷已修，浏览器 E2E 逐项实测验证：

- **FIXED (major) — 并发摄入竞态 + Rust TOCTOU**：(1) 前端 importAttachment 模块级
  promise 链串行化（R16 引擎先例，失败不毒化队列）——同秒双粘贴的 uniquePath 不再
  拿到同一路径（E2E 实测 ` 1` 后缀正确生成）；(2) Rust `vault_write_binary` 弃用
  「exists 检查 + 共享 tmp + rename」（check-then-act：两并发可同过检查、共享
  `.{name}.geode-tmp` 互踩、Windows rename 带 REPLACE_EXISTING 静默换掉先到者），
  改为 **`create_new` 独占创建直写 + sync_all**——独占性是原子保证（大小写不敏感
  文件系统同样生效）；崩溃中途最多截断这枚全新附件自身，永不波及既有数据（与
  vault_write 的场景不同：改写既有笔记必须 tmp+rename，新建文件独占性 > 原子性，
  口径记录）。写失败清理半成品文件后报错。
- **FIXED (major) — paste 陈旧偏移删字节**：ingestFiles 捕获导入前的 `state.doc`
  （Text 不可变，身份比较即变更检测）；async 导入完成时 doc 已变 → 放弃捕获的
  [from,to] 选区替换，退化为当前光标处纯插入——导入窗口期的用户编辑/外部重载
  不再可能被覆盖删除。
- **FIXED (major) — lang-markdown 内置 headerIndent foldService 剥离**：markdown()
  的 support 数组携带它（Setext/ATX 节折叠，绕过冻结语义；frontmatter 中的伪标题
  经它可一键折掉整个正文）。cmExtensions `markdownSansHeaderFold()` 按
  「facet === foldService」结构匹配过滤该项后重建 LanguageSupport——markdown
  keymap/paste-URL/HTML 补全 support 全保留。配套：**foldService 增加 frontmatter
  排除**（首行 "---" 至闭合行；解析器把 YAML 当 markdown，`# 注释` 是真 ATXHeading
  ——WeakMap 按 doc 身份缓存）。E2E：fm 伪标题无节折叠、Setext 行无折叠点。
- **FIXED (major) — 桌面 drop 死路**：tauri.conf.json 窗口加 `dragDropEnabled:
  false`——Tauri 默认拦截 OS 文件拖放，DOM 永远收不到带 files 的 drop 事件。
- **FIXED (major) — 设置输入 trim-on-keystroke**：setAttachmentFolder 改存原文
  （trim 移到消费端 resolveAttachmentDir）——受控输入框可正常键入含空格目录名。
  契约「存 trim 后原文」措辞由此修订。
- **FIXED (minor) — 附件目录穿越/点前缀**：importAttachment 增 validateDir——
  解析后的目录含 ""/"."/".." 或点前缀段 → 响亮抛错（桌面 safe_join 本会拒
  ".."，但 Memory 适配器会照写：双端分叉收口；点前缀目录写得进却永不进树/索引
  ——UI 黑洞）。sanitizeFileName 同步剥文件名前导点。E2E："../evil" 设置下粘贴
  零写入 + console 明确报错。
- **FIXED (minor) — fold-all 语义统一**：弃 foldKeymap（其 Ctrl-Alt-[ 绑库版
  foldAll，会把 fence/blockquote/table 经 foldNodeProp 卷入），显式 keymap 四绑定
  ——Ctrl-Alt-[/] 走 foldAllInView/unfoldAllInView（仅冻结语义自扫描 +
  ensureSyntaxTree 500ms 保证大文档全量解析）。
- **FIXED (minor) — 缩进 1-3 空格 ATX 标题**：`n.from === lineStart` 精确匹配改
  ownsLine（行内前缀全空白）——缩进标题可折叠且正确终止上节（之前会被上节整段
  吞掉）。headingSectionEnd 同步改 **cursorAt + next() 游标前向遍历真早退**
  （iterate 无法跨兄弟中止，大文档下每次 gutter 查询 O(doc)）。
- **FIXED (minor) — Memory writeBinary 文件夹撞名**：exists 检查补 folders.has。
- Accepted（已裁决记录）：foldNodeProp 回退使 fence/blockquote/table/多行段落仍
  显示折叠箭头且可手动折叠（CM 系折叠面大于 Obsidian；箭头仅编辑器 hover 可见、
  fold-all 不卷入——显式偏差）；`.` 设置值归一化为 `./`；无扩展名 baseName 兜底
  .png + console.warn（真实调用方必带扩展名）；设置输入框背景用 --bg-input（与
  modal 内既有输入控件一致）；vault 切换窗口内的 in-flight 摄入写入新库（毫秒级
  TOCTOU 同类已知限制）；fold gutter 位于面板最左缘（宽窗口下与 46em 居中正文
  有距离——Obsidian 把箭头贴正文，R18+ polish 候选）。

| Agent | Files |
|---|---|
| core | core/attachments.ts (new) |
| editor | features/editor/{attachments.ts (new), folding.ts (new), cmExtensions.ts, editor.css}, app/App.tsx |
| ui | features/settings/SettingsModal.tsx, features/settings/settings.css（如存在） |

Chief pre-phase：本节契约 + src-tauri vault_write_binary + core/vault.ts writeBinary/
createBinary 全链 + dict.app.ts（cmd.toggleFold/foldAll/unfoldAll）+ dict.views.ts
（settings.attachmentFolder/Desc）en/zh。Frozen surfaces：上述全部代码块签名、
`geode.attachmentFolder` key、`settings-attachment-folder` testid、三个命令 id、
MIME 映射、`Pasted image YYYYMMDDHHMMSS` 命名、foldService 语义。每 agent 结束前
`npx tsc --noEmit`；不加依赖；不碰 docs/、compat/**；agent 行内注释不得修订契约
（R13 教训）；动 vault/documents 路径前必读 R16 As-built deltas。

## Round 16 additions — 重命名自动更新引用 + `[[#h]]` 同文链接

迁移体验路线图第一轮（ROADMAP R16-R18，2026-06-11 与用户对齐）。**数据安全等级最高的
一轮**：批量改写用户文件。官方校准（obsidian.md/help + obsidian.d.ts）：

- 设置项 "Automatically update internal links"（Files and links 节，默认开；关闭时
  Obsidian 改为弹询问——本轮口径：关闭 = 纯 rename 不改写，不做询问对话框，记录偏差）。
- `FileManager.renameFile`（d.ts:2896）："Rename or move a file safely, and update all
  links to it depending on the user's preferences."；官方 `Vault.rename`（d.ts:7451）
  **不**更新链接（"To ensure links are automatically renamed, use FileManager.renameFile
  instead."）——compat 的 Vault.rename 保持裸 rename 是官方对齐而非缺口。
- `MetadataCache.fileToLinktext`（d.ts:4425）："If file name is unique, use the
  filename. If not unique, use full path." —— 新名歧义时的消歧权威规则。

### 一次性决策（chief，agent 不得加依赖/不碰 Rust）

- Rust `vault_write` 升级为**原子写**：同目录 sibling temp（命名 `.{name}.geode-tmp`，
  **点前缀使其落在 watcher 噪声过滤里**——to_vault_relative 跳过 dotfile 段，tmp 的
  create/rename 事件不会进前端）+ `fs::rename` 替换（Windows MoveFileEx 语义，
  export_write 先例）。失败清 tmp 并报错。自动保存与本轮批量改写同享 crash 安全。
- 改写引擎走 `Vault.modify`（未打开文件）/ DocumentHandle（打开文件），**自动获得
  R8 回声指纹抑制**——引擎自身不直接碰 adapter。

### Core: 改写引擎 — `core/linkRewrite.ts`（新，core agent）

```ts
/** localStorage "geode.autoUpdateLinks"，默认 true。 */
export const autoUpdateLinks: Store<boolean>;
export function setAutoUpdateLinks(on: boolean): void; // set + persist

export interface LinkRewriteSkip { path: string; reason: string }
export interface LinkRewriteResult {
  filesChanged: number;     // 实际写入/改缓冲的引用方文件数
  linksRewritten: number;   // 改写的链接处数
  skipped: LinkRewriteSkip[]; // 校验不过而跳过的文件（绝不盲写）
}
export interface LinkRewriteDeps {
  vault: Vault; metadata: MetadataIndex; documents: DocumentManager;
}
/** Rename oldPath→newPath（文件或文件夹）并改写全库指向它的链接/嵌入。
 *  autoUpdateLinks 关闭时退化为 vault.rename + 空结果。绝不抛出改写阶段的
 *  错误（rename 本身的错误照常向上抛——调用方既有 catch）。 */
export async function renameWithLinkUpdate(
  deps: LinkRewriteDeps, oldPath: string, newPath: string,
): Promise<LinkRewriteResult>;
```

**算法（冻结——评审按此逐条对抗）**：

1. **capture（rename 前）**：`await documents.flushAll()` →
   `await metadata.ensureFresh(documents.getOpenPaths())`（索引与缓冲收敛——防抖窗口
   内刚敲的链接也进发现）。受影响文件表 = oldPath 为 .md 文件时一项；为文件夹时
   getMarkdownFiles() 中 oldPath+"/" 前缀的全部（old→new 路径映射）。**附件同表**：
   文件夹下非 md 文件、或 oldPath 自身是非 md 文件时，同样参与（链接经
   resolveAttachment 解析）。引用方发现 = 遍历 metadata.getAll()（含被改名文件自身
   ——自引用 `[[A]]` in A.md 也要更新，getBacklinks 排除自身故不直接用它）：对每个
   引用方 R 的每条 LinkRef，`resolveLink(target, R.path)`（md）或
   `resolveAttachment(target, R.path)`（非 md，按 target 扩展名分流）命中受影响
   oldFilePath → 记录 `R.path → Map<targetLower, {oldFile, newFile}>`。
2. `await vault.rename(oldPath, newPath)`（documents 自动重 key、metadata 自动重索引）。
3. `await metadata.ensureFresh(全部 new 路径)`——消歧校验前索引必须已含新名。
4. **rewrite（逐引用方 R，路径经文件夹重映射）**：
   - 当前内容：`documents.get(R)?.getText() ?? await vault.read(R)`。
   - **fresh parse**：`parseNote(R, content).links` 重新定位（偏移按当前内容构造性
     正确，fence/inline-code/frontmatter 天然排除）；逐条按 targetLower 查 capture 映射。
   - **only-fix-broken**：若该 target 在 rename 后仍解析到 newFile（basename 链接随
     文件夹移动不破、alias 链接随 frontmatter 走）→ **不改写**（最小 diff 原则）。
     **修订（chief，浏览器实测发现）**：判定按 target 形态走严格语义——含 "/" 的
     path-form target 仅当与 newFile **精确路径相等**（大小写不敏感）才算存活；
     resolveLink 的 basename 兜底会掩盖过期路径前缀（字节错了、Obsidian 打开即断，
     虽然 Geode 导航碰巧能走）。basename-form 维持 lenient 判定。
   - **新 target 文本（风格保持 + fileToLinktext 消歧）**：原 target 含 "/" → 新全
     路径（md 去 .md 后缀，附件含扩展名）；否则新 basename。生成后**消歧校验**：
     resolve(新 target, R) === newFile 不成立 → 退全路径再校验；仍不成立 → 该文件
     skip + reason。
   - **splice 校验（绝不盲写）**：`content.slice(link.from, link.to)` 必须形如
     `[[原inner]]`，且 inner 重新拆解出的 target 与 capture 一致；新 inner = 新
     target + 原 subpath 原文 + 原 alias 原文逐字节保留（`#`/`|` 分隔符还原）。
     任何不一致 → 整文件 skip + reason，不写。
   - 应用：打开中 → `handle.applyExternalEdits(edits)`（CM 单事务、undo 进历史、
     标脏 + 调度自动保存）；未打开 → `vault.modify(R, 新内容)`（回声指纹）。
   - 改写后断言（探针级口径）：新内容 parseNote 后这些链接 resolve 到 newFile。
5. 聚合 LinkRewriteResult 返回。skip 一律 console.warn 全文原因。

### Core: 配套 API — `core/metadata.ts` + `core/documents.ts`（core agent）

```ts
// MetadataIndex
/** Re-parse the given paths from CURRENT vault content right now (missing or
 *  unreadable paths are DROPPED from the index — delete-event parity), rebuild
 *  the name map, bump once (unconditionally). Deterministic alternative to
 *  waiting for async event-driven reindex. `readText`（评审修复）：可选的
 *  内存源——live buffer 必须赢过磁盘，flush 失败时发现阶段仍收敛。 */
ensureFresh(paths: string[], readText?: (path: string) => string | undefined): Promise<void>;

// DocumentManager
getOpenPaths(): string[];   // 现存 handle 的路径快照

// DocumentHandle
/** Apply programmatic edits AS A LOCAL EDIT: single CM transaction on an
 *  attached view (sync glue forwards to others, marks dirty, schedules the
 *  debounced save, undo lands in the shared history). Zero attached views
 *  (preview-only/backgroundtab) → splice text directly + mark dirty +
 *  schedule save + bump revision. edits 按 from 升序、互不重叠（调用方保证）。 */
applyExternalEdits(edits: Array<{ from: number; to: number; insert: string }>): void;
```

### UI: 触发点 + 设置 + 通知 — `features/explorer/Explorer.tsx` + `features/settings/SettingsModal.tsx`（ui agent）

- Explorer `commitRename` 改调 `renameWithLinkUpdate({vault, metadata, documents}, …)`
  （任何 kind——文件夹/md/附件统一走引擎；引擎内部 autoUpdateLinks 关闭时退化）。
  结果处理：linksRewritten>0 → console.info 计数；skipped.length>0 → explorer 本地
  transient notice（仿 export-notice 模式，自有 css，`data-testid="link-update-notice"`，
  文案 `t("explorer.linkUpdateSkipped", { count })`，警示色，4s 自动消失）。
- SettingsModal：通用节新增 "Files & links" 组——toggle
  `data-testid="settings-auto-update-links"` 绑 autoUpdateLinks store。
- i18n：`explorer.linkUpdateSkipped`（dict.panels.ts）、
  `settings.autoUpdateLinks` + `settings.autoUpdateLinksDesc` + `settings.filesAndLinks`
  （dict.views.ts），en/zh 双语，术语：链接自动更新。
- `src/main.tsx`：bootstrap 处挂常驻探针
  `window.__geodeRename = (o, n) => renameWithLinkUpdate({vault, metadata, documents}, o, n)`
  （返回 Promise<LinkRewriteResult>，浏览器/桌面双端可驱动——R8 __geodeFireWatch 同模式）。

### Editor + 管线: `[[#h]]` 同文链接 — editor agent（含 core/markdown.ts，本轮唯一触碰者）

R14 记录的缺口：target 为空的 `[[#Heading]]`/`[[#^id]]` 解析为当前笔记。

- `core/markdown.ts` replaceWikilinks：`!target` 分支拆细——**空 target 且 subpath
  非空且非 embed（bang 为空）**→ 走 internal-link 占位（`data-target=""` +
  `data-subpath`，class 恒为 "internal-link" 不带 is-unresolved——subpath 存在性
  点击时校验，Obsidian 同样不在渲染期校验）；显示文本 = alias else inner 原文
  （含 "#"，与 `[[note#h]]` 显示 "note#h" 的现状一致）。`![[#h]]` 同文嵌入**出轮**
  （保持原文渲染，缺口记录）。**diff 验证义务**：除 `[[#...]]` 用例外全字节一致。
- `features/editor/wikilinks.ts` openWikilink：`target === ""` 且 subpath 有值 →
  resolved = fromPath（**绝不走创建新笔记分支**），openFile(fromPath) 为 no-op 后
  requestReveal 照常（R14 同文 reveal 路径已验证）。
- `features/editor/livePreview.ts` 扫描：`!target` 时若 subpath 非空且非 embed →
  照常折叠装饰（data-link-target=""、data-link-subpath）；embed/无 subpath → 现状跳过。
- `features/editor/cmExtensions.ts` wikilinkDecorations：同上放行空 target；样式按
  resolved（cm-wikilink 不带 unresolved 变体）。**click 链路三处守卫放宽**：
  `wikilinkClickHandler`（`data-link-target` 为空串但元素有 `data-link-subpath` →
  仍触发，target 传 ""）、livePreview 内两处委托同规则、EditorPane onPreviewClick
  （`data-target` 空串 + `data-subpath` → openWikilink(app, "", handle.path, subpath)）。

### Compat: fileManager.renameFile 接通 — `compat/obsidian/`（compat agent）

- `app.fileManager` 从全量 warn-stub 升级：**renameFile(file, newPath) 真实现**——
  归一化路径后调 core `renameWithLinkUpdate`（deps 经 compat ctx 取 geode 单例），
  返回 Promise<void>（结果丢弃，Obsidian 签名无返回值）；其余方法保持记录缺口的
  no-op stub（Proxy 结构保留，renameFile 特判）。
- `Vault.rename` **保持裸 rename**（官方语义校准——本轮起这是对齐项非缺口）。
- gaps 口径 + OBSIDIAN-COMPAT 缺口表由 chief 收尾时更新文档，compat agent 只改代码注释。

### 口径（零代码，记录）

- 改写只针对 wikilink `[[...]]`/`![[...]]` 形态；markdown 标准链接 `[text](note.md)`
  不在 Geode 解析面内（R1 起现状），不改写——缺口表记录。
- `[[A.md]]` 带扩展名形态被改写后统一为不带 .md 的新形态（Obsidian linktext 规则）。
- 重命名导致**其他文件的** basename 链接被新文件"劫持"（同名优先级变化）不处理
  ——Obsidian 同样不处理（basename 链接固有语义）。
- autoUpdateLinks 关闭时 Obsidian 弹确认对话框，本轮不做（纯不改写），记录偏差。
- 改写不触发 `[[#h]]` 同文链接（target 为空不指向被改名文件）；同文链接不进
  links 索引（parseNote 正则不变——graph 无自环边，与 Obsidian 行为一致；
  getFileCache().links 含 `#h` 条目的官方形状偏差记录进缺口表）。
- `[[#` 的 heading 自动补全不在本轮（缺口表）。

### As-built deltas (post-review — R16)

Review: 4 dimensions (data-safety / correctness / races / layering), 22 findings →
12 confirmed (1 critical + 4 major + minors/adjudications), 10 refuted by adversarial
verification. All confirmed code defects FIXED by chief; integration re-verified.

- **FIXED (critical) — CRLF offset-basis mismatch**: `handle.getText()` kept raw
  CRLF while the CM doc is LF-normalized (`@codemirror/state` DefaultSplit), so
  applyExternalEdits dispatched CRLF-space offsets into an LF doc — silent mid-file
  corruption of an open-but-unedited CRLF referrer (verifier reproduced it against
  the real package). Root fix: **Vault.read 咽喉点统一 CRLF→LF**（BOM 剥除旁；
  modify/create 的 cacheSet 同步归一化，回声指纹仍按原始字节）。记录口径：保存即
  LF 化——R16 前首次击键本就如此转换，现在全路径一致（Obsidian 保留 CRLF，显式
  偏差）。Belt-and-braces：applyExternalEdits 视图分支前 `doc.toString() !==
  this.text` 即 throw → 上游 skip+报告，错切位永不可能静默。
- **FIXED (major) — closed-referrer 不再读缓存**：新增 `Vault.readFresh(path)`
  （绕过 contentCache 直读磁盘 + 归一化 + 刷新缓存）；引擎 step 4 未打开文件一律
  readFresh——watcher 防抖窗口（~400ms）内落地的外部修改不再被陈旧快照覆盖（且
  自写指纹不再吞掉信号）。残余 read→write 毫秒级 TOCTOU 记录为已知限制。
- **FIXED (major) — flush() JOIN 在飞行的保存**：`saving: boolean` →
  `savePromise: Promise|null`，flush 先循环 join 再判脏——flushAll 的"缓冲已落盘"
  保证此前对防抖定时器刚触发的文档是空话（capture 会建立在未写完的磁盘态上）。
- **FIXED (major) — type-then-close 竞态**：release() 的微任务改为 flush 完成后
  才 drop——句柄在最终 flush 期间保持可发现，引擎走同步缓冲路径而非陈旧缓存；
  期间的并发 acquire 复活句柄（refs 守卫保留）。
- **FIXED (minor) — 引擎运行串行化**：模块级 promise 链——Explorer / compat
  renameFile / __geodeRename 三入口重叠时按序执行（每轮起手 flushAll+ensureFresh，
  次序无关）；前一轮失败不毒化队列。
- **FIXED (minor) — capture 在 flush 失败时仍收敛**：ensureFresh 增 `readText`
  缓冲提供者（见上方签名修订），capture 传 `documents.get(p)?.getText()`。
- **FIXED (minor) — Rust .geode-tmp 残留清扫**：vault_watch 起表前递归 best-effort
  删除 `.{name}.geode-tmp`（写后崩溃残留；点前缀对 vault_list/watcher 不可见，
  必须主动扫）。
- **契约修订（chief）— capture 统一解析优先级**：实现为 resolveLink 命中即胜
  （遮蔽 resolveAttachment——与点击导航一致，capture 与校验共用同一优先级），
  取代契约原文的"按扩展名分流"。已知后果入口径：与附件 basename 撞名的 md
  alias / `X.ext.md` 会在 capture 期遮蔽该附件——重命名该附件时其 `![[...]]`
  嵌入漏改（嵌入渲染是 attachment-first），方向安全（漏改非误写，消歧校验
  fail-closed）。
- **卫生（pre-existing）**：metadata.ts getGraph 边键里 R3 时代的字面 NUL 字节
  改为 `\0` 转义（运行时字符串等价）——该字节让 ripgrep 把整个文件按二进制
  跳过，本轮评审两次被它绊倒。
- Accepted（agent 上报已采纳）：根目录改名且 basename 撞车时双形态消歧均败 →
  skip+报告（安全方向）；整文件 skip 粒度（契约原文）；`[[ A ]]` 内空白不保留；
  零视图 applyExternalEdits 不 emit document:changed（revision store 已覆盖
  preview 重渲染）。

### Round 16 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| core | core/linkRewrite.ts (new), core/metadata.ts, core/documents.ts |
| ui | features/explorer/Explorer.tsx + explorer.css, features/settings/SettingsModal.tsx, core/i18n/dict.panels.ts, core/i18n/dict.views.ts, src/main.tsx |
| editor | core/markdown.ts, features/editor/{wikilinks.ts, livePreview.ts, cmExtensions.ts, EditorPane.tsx} |
| compat | compat/obsidian/plugin.ts（fileManager 特判）, compat/obsidian/gaps.ts 按需 |

Chief pre-phase：本节契约 + src-tauri vault_write 原子化。Frozen surfaces：上述全部
代码块签名、`geode.autoUpdateLinks` key、两个 testid、改写算法五步、`[[#h]]` 守卫
放宽规则。每 agent 结束前 `npx tsc --noEmit`；不加依赖；不碰 docs/；editor agent
跑无-`[[#...]]` 用例字节级 diff 验证；agent 行内注释不得修订契约（R13 教训）。

## Round 15 additions — 整固轮：阅读视图 reveal + 性能基线刷新 + 全量回归

P2 池见底 + P1 仍无用户输入 → HANDOFF 预授权的整固轮。**安装包瘦身显式不做**（决策
记录：R5 的 moment-with-locales 全 locale 单实例是 compat 正确性选择——calendar/nldates
依赖任意系统 locale；330KB min 前收益对 12.4MB 安装包边际；Vite 双副本坑风险不对称。
重开条件：商业分发对体积有硬指标时，按 R5 实现决策重读后专轮处理）。

### 阅读视图内 reveal — `features/editor/EditorPane.tsx` + editor.css（editor agent）

R14 口径升级：preview 态不再挂起，直接在渲染 DOM 内定位。
- 消费条件扩展：`isPreview && previewContentRef` 就绪且 reveal.path === handle.path。
- **heading 定位**：用 `metadata.getMetadata(path).headings` 找到 reveal.from 对应的
  heading（from 精确匹配），取其在 document order 中的序号 n → preview DOM 中
  `querySelectorAll("h1,h2,h3,h4,h5,h6")[n]`（管线 1:1 渲染 heading，序号稳定——比文本
  匹配可靠）→ `scrollIntoView({ block: "center" })` + 元素加 `.preview-reveal-flash`
  类（1.2s CSS 动画后移除，timer 卸载清理）。
- **block/无法定位**：reveal.from 不是任何 heading.from → 比例近似滚动
  `previewScrollRef.scrollTop = (from / contentLength) * scrollHeight - clientHeight/2`
  （无 flash，近似口径记录）。消费后照常 `revealTarget.set(null)`。
- css：`.preview-reveal-flash` 与 `.cm-reveal-flash` 同源动画（--accent 透明度）。
- 探针口径更新：r14-probe1 的 pendingInPreview 断言反转（preview 即消费）。

### 性能基线刷新（chief，零代码——纯测量 + PERFORMANCE.md 更新）

- 浏览器 `?bench=10000`（headless Edge + CDP）：graphSettleMs/graphDrawMs、switcher
  开启、全文搜索、explorer 展开——对照 R3/R7 基线，回归超 20% 立案排查。
- bench=1000 图谱 60fps 口径不回退。
- 新路径补口径：10k vault 下 resolveSubpath/resolveAttachment 首次构建耗时记录。

### 全量回归（chief）

最终 v0.15.0 build 上复跑：r9-probe-suite（套件+nldates）、r12-probe1/2（转写+导出）、
r13-probe1（块）、r14-probe1（定位，按新口径修订）。更新链路（r9-up*）自 R9 零改动，
跳过并记录。

### Round 15 file ownership

| Agent | Files |
|---|---|
| editor | features/editor/EditorPane.tsx, features/editor/editor.css |

## Round 14 additions — scroll-to-subpath 定位 + live preview fence 排除统一

P2 组合轮（P1 渠道/证书继续等用户决策）。引用体验闭环收尾：点击 `[[note#Heading]]` /
`[[note#^id]]` 打开笔记并**滚动定位到目标 + 居中 + 短暂闪烁高亮**（Obsidian 行为）。

### Core: subpath 解析统一 — `core/metadata.ts`（core agent）

```ts
export interface SubpathSpan {
  kind: "heading" | "block";
  /** anchor start（heading 行首 / 块段落首） */
  from: number;
  /** 范围终点：heading = 节末（下一同级及以上标题前）；block = 块段落末 */
  to: number;
}
/** `subpath` 不含 '#'。heading：精确（大小写不敏感）→ stripHeading 二次匹配；
 *  `^` 开头按块 id（大小写不敏感）。未命中/无 subpath → null。 */
resolveSubpath(path: string, subpath: string): SubpathSpan | null;
```

core/embeds.ts 的 heading/block 切片逻辑**重构为调用它**（行为不变——切片范围与现有
逐字一致，stripHeading 逻辑随迁 metadata；embeds 保留警示牌分支）。

### Core: reveal 机制 — `core/workspace.ts`（core agent）

```ts
/** One-shot reveal request: EditorPane consumes (scroll+flash) then clears.
 *  Session-only. Set AFTER openFile so the consuming pane already targets path. */
readonly revealTarget: Store<{ path: string; from: number; to: number } | null>;
requestReveal(path: string, from: number, to: number): void; // set 即可，无副作用
```

### Core: 链接 subpath 透传 — `core/markdown.ts` + `core/embeds.ts`（core agent）

- markdown.ts：`[[note#sub]]`/`[[note#^id]]` 的 internal-link 锚点增加
  `data-subpath="<#后原文，转义>"`（无 subpath 的链接**零字节变化**——diff 验证义务：
  仅含 subpath 链接的用例新增该属性，其余全字节一致）。
- embeds.ts：转写 header 链接与降级链接牌同样带 data-subpath（指向被嵌入笔记的
  subpath）。

### Editor: 点击贯通 + 闪烁 + fence 排除 — `features/editor/`（editor agent）

- `wikilinks.ts` openWikilink 增参 `subpath?: string`：openFile 后
  `metadata.resolveSubpath(resolved, subpath)` 命中 → `workspace.requestReveal(...)`；
  未命中/无 subpath → 现状。
- 点击链路三处透传：阅读视图委托（EditorPane onPreviewClick 读 `data-subpath`）、
  live preview wikilink 装饰（mark 增 `data-link-subpath` 属性 + click handler 读取——
  装饰属性在 cmExtensions/livePreview 哪边建，按现状跟随）、NoteEmbedWidget 内部
  委托（core 已在锚点带 data-subpath，读它）。
- `EditorPane.tsx`：订阅 `revealTarget`——匹配当前 handle.path 且 CM 视图在（live/
  source）→ `view.dispatch({ selection: { anchor: from }, effects:
  EditorView.scrollIntoView(from, { y: "center" }) })` + 触发闪烁 → 清 store
  （set(null)）。preview 模式或路径不匹配 → 不消费不清除（挂起到下次 CM 挂载——
  openFile 默认 live，正常链路必达；preview 态点击自身锚点的场景记录口径）。
- 闪烁：cmExtensions 新增 reveal-flash 扩展——`StateEffect<{from,to}>` → 行级
  `Decoration.line({ class: "cm-reveal-flash" })`，~1200ms 后第二个 effect 清除
  （setTimeout 持 view 引用，destroy 时清定时器，rAF/timer id 归零纪律）。css
  动画淡出，颜色走 `--accent` 透明度变体。
- **fence 排除统一（R13 债）**：livePreview 的 wikilink 正则扫描跳过
  `fencedLines`（集合已存在）——fence 内 `[[x]]`/`![[x]]` 不再装饰/不再出 widget，
  与阅读视图对齐。行内 code 的不对称保留（记录，Obsidian 行为是也不装饰——远期）。

### 口径（零代码）

compat `openLinkText` 不接 reveal（缺口记录，按需求驱动）；preview 阅读视图内
锚点点击目标是当前笔记自身的 subpath（`[[#h]]` 同文跳转）——同文 reveal 走同一
requestReveal 路径（openFile 同路径是 no-op，reveal 正常消费）；`[[#h]]` 形态
target 为空 → resolve 按当前笔记处理（wikilinkTarget 返回空串——现状这类链接
怎么渲染先查清，若现状不支持同文链接则整体出轮记缺口，不强做）。

### As-built deltas (post-review — R14)

Review: 2 dimensions, 11 findings → 1 confirmed minor (fixed), 10 refuted.

- **FIXED — expanded-state Ctrl+Click carries the subpath too**: `wikilinkDecorations`
  (cmExtensions) now emits `data-link-subpath` and `wikilinkClickHandler` forwards it —
  the contract listed three pass-through sites; the reviewer correctly held the fourth
  (Ctrl+Click on a revealed/source-mode link) in scope.
- **Accepted shape delta**: the flash effect is `StateEffect<{from}>` (the contract block
  said `{from,to}`; the line decoration only needs `from`). The editor agent FLAGGED the
  divergence instead of silently deviating — the R13 lesson working as intended.
- Recorded口径: reveal is consumed by EDITOR modes only — a click from reading view
  opens the target in reading view (tab keeps its mode) and the request stays pending
  until the user switches to live/source (verified end-to-end on desktop). In-preview
  reveal is an R15 candidate. resolveSubpath trims its input (same as the embed path
  always did); unresolved subpath-bearing links also carry data-subpath (inert).

### Round 14 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| core | core/metadata.ts, core/workspace.ts, core/markdown.ts, core/embeds.ts |
| editor | features/editor/{wikilinks.ts, cmExtensions.ts, EditorPane.tsx, livePreview.ts, editor.css} |

Frozen surfaces：SubpathSpan/resolveSubpath、revealTarget/requestReveal、
`data-subpath`/`data-link-subpath` 属性名、`cm-reveal-flash` 类。core agent diff
验证义务（仅 subpath 链接新增属性）；embeds 重构后切片行为与 R13 逐字一致（用例复跑）。
每 agent 结束前 `npx tsc --noEmit`；不加依赖；不碰 compat/**、docs/。

## Round 13 additions — `^block` 块引用（链接+嵌入）+ compat noteEmbeds 接通

P2 组合轮（P1 渠道/证书继续等用户决策）。官方校准（.calibration/obsidian.d.ts:1283/1462）：
`BlockCache extends CacheItem { id: string }`、`CachedMetadata.blocks?:
Record<string, BlockCache>`、CacheItem.position 为 Pos（line/col/offset 双端点）。

### Core: 块索引 — `core/types.ts` + `core/metadata.ts`（core agent）

```ts
// types.ts
export interface BlockRef {
  /** block id WITHOUT the '^' */
  id: string;
  /** span of the whole block (paragraph approximation) INCLUDING the marker */
  from: number;
  to: number;
}
// NoteMetadata gains: blocks: BlockRef[];
```

parseNote：fence 外扫描行尾标记 `/\s\^([A-Za-z0-9-]+)\s*$/`；块范围 = 含标记行的
**连续非空行段**（段落近似——表格/嵌套列表的复杂块按此近似，显式偏差记录）；同 id
重复 → 后者胜（对齐官方 Record 覆盖语义）。

### Core: 块嵌入切片 — `core/embeds.ts`（core agent）

`subpath` 以 `^` 开头不再降级链接：在 `metadata.getMetadata(path).blocks` 中大小写
不敏感匹配 id → 切 `[from, to)` 并**去掉切片尾部的 ` ^id` 标记**再渲染；未命中 →
`.geode-embed-missing` 警示牌，新键 `t("editor.embedMissingBlock", { block, name })`
（en `Block "^{block}" not found in {name}` / zh `在 {name} 中找不到块 "^{block}"`，
键进 dict.views.ts，本轮 core agent 顺带写入——无其他 agent 碰该文件）。

### Core: 阅读视图块标记隐藏 — `core/markdown.ts`（core agent，**有意的全调用方变更**）

渲染前置步骤：fence/inline-code 外的行尾 ` ^id` 标记剥除（Obsidian 阅读视图行为）。
这是**故意打破"字节级不变"的基管线变更**（compat MarkdownRenderer 同样受益——Obsidian
本来就不渲染标记）；diff 验证义务改为：**除含行尾块标记的行外，全用例输出仍字节级一致**。

### Editor: live preview 标记隐藏 — `features/editor/livePreview.ts`（editor agent）

选区未触及该行时 `Decoration.replace` 隐藏行尾 ` ^id`（含前导空格），光标进入 →
既有 reveal 规则还原。fence 内不处理（跟随既有 wikilink 正则的 fence 跳过结构）。

### Compat: blocks + MarkdownRenderer noteEmbeds — `compat/obsidian/`（compat agent）

- `getFileCache()` 返回值增加 `blocks: Record<string, BlockCache>`（按官方形状：键 =
  id，值含 position——跟随既有 headings 的 offset→Pos 映射模式；无块时官方为
  undefined/缺省——对照现有 headings 缺省行为保持一致）。
- `MarkdownRenderer.render`：渲染改传 `resolveEmbed`（metadata.resolveAttachment 绑
  sourcePath）+ `noteEmbeds: true`，innerHTML 后调 core `hydrateEmbeds`（compat 自带
  极简 imageSrc：`vault.readBinary` → blob URL，模块级 Map 缓存即可，不订阅失效——
  compat 渲染是一次性 fragment，记录口径）+ `ancestors = new Set([sourcePath])`。
  内链点击委托已有（R6）。fixture.ts：`obsfixture-md-render` 命令的渲染源加
  `![[Welcome]]` 与 `^block` 用例，探针可断言 `.geode-embed-note-content` 存在。
- 缺口表删除"compat MarkdownRenderer 未接 noteEmbeds"口径（R12 记录的）。

### 链接路径口径（零代码）

`[[note#^id]]` 链接经既有 wikilinkTarget 剥 `#` 后正常解析/打开（已工作）；
**点击后不滚动定位到块**——显式缺口记录（链接/嵌入的 scroll-to-subpath 是远期项）。

### As-built deltas (post-review — R13)

Review: 3 dimensions, 12 findings → 4 confirmed (3 = ONE root cause, major; 1 minor
debt), 8 refuted.

- **FIXED (contract violation) — live-preview marker hiding now EXCLUDES fences**: the
  editor agent shipped the marker hide without fence exclusion, rationalizing it via the
  in-file wikilink scan's parity — but the R13 contract mandated "fence 内不处理". Fixed
  by collecting FencedCode line numbers during the existing syntaxTree pass and skipping
  them in the marker loop. Lesson: an agent's inline comment cannot amend the contract;
  reviewers correctly flagged the rationalization.
- **Recorded debt (pre-existing, R1)**: the live-preview WIKILINK regex scan does not
  skip fences either — out of this round's scope, listed in ROADMAP tech debt / R14.
- Accepted deltas: duplicate block ids dedupe case-INsensitively with later-wins
  (official Record overwrite is exact-key; chosen so embed matching can't hit a shadowed
  entry); the frozen marker regex requires leading whitespace, so a column-0 standalone
  `^id` line is not recognized (Obsidian does — recorded deviation); paragraph-approx
  block spans may extend into an adjacent fence (Obsidian-like, recorded).

### Round 13 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| core | core/types.ts, core/metadata.ts, core/markdown.ts, core/embeds.ts, core/i18n/dict.views.ts |
| editor | features/editor/livePreview.ts ONLY |
| compat | compat/obsidian/**（blocks 映射点、util.ts、fixture.ts 按需） |

Frozen surfaces：BlockRef 形状、embedMissingBlock 键、标记正则
`/\s\^([A-Za-z0-9-]+)\s*$/`、段落近似口径。每 agent 结束前 `npx tsc --noEmit`；
不加依赖；不碰 docs/。core agent 跑 diff 验证（义务口径见上）。

## Round 12 additions — 笔记转写嵌入 `![[note]]` + 导出 HTML 内联图片

P2 组合轮（P1 渠道/证书继续等用户决策），同吃 R11 的 resolveEmbed/附件管线。
官方校准（obsidian.md/help/embeds）：嵌入"内联显示内容、随源文件更新"；`#heading` 与
`#^block` 语法官方存在；嵌套/循环深度**官方无文档**——以下护栏为自定口径，显式记录：
**深度上限 5、循环 → 警示牌**。范围出轮项（缺口表记录）：`#^block` 块引用、PDF/音频/
canvas 嵌入（均按 R11 现状渲染为 "!"+链接）。compat 零改动；**无 noteEmbeds 的调用方
渲染输出继续字节级不变**（R11 同款 diff 验证义务）。

### Core: note-embed 占位 — `core/markdown.ts`（core agent）

```ts
export interface RenderMarkdownOptions {
  resolveEmbed?: (target: string) => string | null;   // R11，不变
  /** R12: present ⇒ `![[inner]]` 中 resolveEmbed 未命中图片、但 resolve(target)
   *  命中 .md 笔记时，渲染 `<span class="geode-embed-note"
   *  data-embed-note="<resolved>" data-embed-subpath="<#后子路径或空>"
   *  data-embed-display="<alias|inner>"></span>`（空容器，调用方异步水合；
   *  span+CSS display:block——div 在段落内会被浏览器破坏结构）。
   *  absent ⇒ R11 行为；其余 fallback 路径全部不变。 */
  noteEmbeds?: boolean;
}
```

subpath 解析：`inner` 形如 `note#Heading|alias`——target 已有 wikilinkTarget 剥 `#`，
本轮把 `#` 与 `|` 之间的原文存入 data-embed-subpath（HTML 转义；`^` 开头 = 块引用 →
照常输出占位，由水合端降级为链接）。

### Core: 嵌入水合引擎 — `core/embeds.ts`（新，core agent；编辑器与导出共用——features 互不 import 的合规解）

```ts
export interface HydrateContext {
  vault: Vault; metadata: MetadataIndex;
  /** image src provider — editor 给 blob URL，export 给 data URI */
  imageSrc(path: string): Promise<string>;
  depth?: number;                       // 默认 0
  ancestors?: ReadonlySet<string>;      // 含当前根笔记路径
}
/** Walk root: fill img.geode-embed[data-embed-path] via imageSrc (failure →
 *  .geode-embed-failed, never throws); expand span.geode-embed-note —
 *  cycle (path ∈ ancestors) → .geode-embed-cycle 警示牌（文案 t("editor.embedCircular")）；
 *  depth ≥ 5 → 仅渲染链接牌（a.internal-link + display 文本，点击走调用方既有委托）；
 *  否则 vault.read → subpath 有值时按 heading 切片（metadata headings，大小写不敏感
 *  精确文本匹配；未命中 → .geode-embed-missing 警示牌 t("editor.embedMissingHeading")；
 *  `^` 开头 → 链接牌降级）→ renderMarkdownToHtml(切片, 以被嵌入笔记为 fromPath 的
 *  resolve/resolveEmbed, {noteEmbeds:true}) → 容器内 = header（笔记名+subpath，
 *  a.internal-link data-target 指向被嵌入笔记）+ .geode-embed-note-content innerHTML
 *  → 递归 hydrateEmbeds(content, {...ctx, depth+1, ancestors+path})。全程不抛。 */
export function hydrateEmbeds(root: HTMLElement, ctx: HydrateContext): Promise<void>;
```

heading 切片规则：从命中 heading 行起，到下一个 level ≤ 它的 heading 前（不含），
含 heading 行本身（Obsidian 行为）。core/embeds.ts 可 import markdown/i18n/vault/
metadata 类型；不 import React/features。

### Editor — `features/editor/`（editor agent）

- `embeds.ts`：保留 getEmbedUrl（blob 缓存，R11 原样）；旧 `hydrateEmbeds(root, app)`
  改为薄包装：调 core hydrateEmbeds，imageSrc=getEmbedUrl(app,·)、ancestors={当前笔记}
  ——签名变为 `hydrateEmbeds(root, app, currentPath: string)`（EditorPane 调用点跟改）。
- `livePreview.ts`：`NoteEmbedWidget`——`![[inner]]` 在 resolveAttachment 未命中图片但
  resolveLink 命中 md 且选区未触及时 replace（eq 按 resolvedPath+subpath+display）；
  toDOM 建容器，异步：构造与阅读视图同构的占位 span → core hydrateEmbeds（ancestors=
  {宿主笔记}），完成后若 isConnected 挂载；容器上一个 click 委托：`a.internal-link`
  → openWikilink（阻断 CM 选区副作用 preventDefault）。**display-only 红线不变**。
  嵌入内容随源文件更新：不做实时刷新——widget 重建（光标动/编辑）时重渲染（已知口径，
  与 R11 图片同款）。
- `EditorPane.tsx`：preview 分支 hydrateEmbeds 调用点传 handle.path；renderPreview 的
  opts 增 `noteEmbeds: true`。
- css：`.geode-embed-note`（块、左边框 var(--border) 风格容器）、`-header`（小字、
  hover 显链接色）、`-content`、`.geode-embed-cycle/.geode-embed-missing` 警示牌、
  `.cm-live-embed-note` 同源样式。
- dict.views.ts：editor.embedCircular / editor.embedMissingHeading（en/zh）。

### Export 内联 — `features/export/export.ts`（export agent）

- `exportActiveNoteHtml`：渲染时传 `resolveEmbed + noteEmbeds:true`；存盘前在
  **detached container** 上跑 core hydrateEmbeds，imageSrc = readBinary → `data:`
  URI（MIME 按扩展名，base64）；ancestors={笔记自身}；完成后取 innerHTML 进
  buildStandaloneHtml。嵌入笔记的样式子集补进 export.css（自包含承诺不变：单文件、
  无外链、无 JS）。打印路径（printActiveNote）同样水合后再 print。
- 失败口径：单个图片/嵌入失败不阻断导出（警示牌/failed 类入文档），整体 IO 失败走
  既有 toast。**不新增 UI 字符串**（警示牌文案来自 core 引擎的 t()）。

### As-built deltas (post-review + desktop — R12)

Review: 4 dimensions, ~16 findings → 2 confirmed (both downgraded major→minor, both
fixed), rest refuted. Fixes & deltas:

- **FIXED — heading match gets a stripHeading second pass**: exact raw-text match first,
  then a markdown-stripped/space-collapsed comparison (Obsidian's stripHeading link
  semantics) — `![[note#Bold]]` now matches `# **Bold**`.
- **FIXED — note-branch display = alias ?? pre-pipe trim** (was alias ?? full inner):
  aligns with the image branch and the live-preview widget; the contract text above
  saying `<alias|inner>` is superseded by this delta.
- **FIXED (pre-existing, exposed by transclusion testing) — UTF-8 BOM**: fixture files
  written by PS5.1-era tooling carried a BOM that silently broke first-line headings in
  BOTH markdown-it and metadata parsing. Stripped at the single choke point
  (`Vault.read`); the three BOM'd demo-vault fixtures normalized on disk. Lesson: a
  feature that points the render pipeline at arbitrary files is a latent-bug amplifier —
  desktop verification must use real historical files.
- Accepted agent deltas (recorded): embed header is an Obsidian-style breadcrumb
  "Note > Subpath"; warning callouts REPLACE the container class (standalone styling);
  generic read-failures reuse the missing-heading callout visuals with display text
  (only two i18n keys were authorized); `noteEmbeds` technically activates without
  `resolveEmbed` (unobservable — real callers always pass both).

### Round 12 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| core | core/markdown.ts, core/embeds.ts (new) |
| editor | features/editor/{embeds.ts, livePreview.ts, EditorPane.tsx, editor.css}, core/i18n/dict.views.ts |
| export | features/export/export.ts, features/export/export.css |

Frozen surfaces：上述代码块全部签名 + DOM 类名/data 属性契约 + 深度 5/循环护栏语义。
每 agent 结束前 `npx tsc --noEmit`；不加依赖；不碰 compat/**、docs/。core agent 必须
重跑 R11 式无-opts 字节级 diff 验证（含 noteEmbeds 缺省用例）。

## Round 11 additions — 模式切换保留选区/滚动 + 图片嵌入 `![[...]]`

P2 组合轮（P1 渠道/证书继续等用户决策）。compat 表面零改动——套件只需不回退；
阅读视图管线对无 resolveEmbed 的调用方必须**字节级保持现状**（compat MarkdownRenderer
继续把 `![[x]]` 渲成 `!` 字面量 + internal-link，记录为已知偏差）。

### Editor: live↔source 不重建视图 — `features/editor/EditorPane.tsx` + `cmExtensions.ts`

- `cmExtensions.ts`：`buildEditorExtensions` 增参 `modeCompartment: Compartment`，
  mode 相关切片改为 `modeCompartment.of(editorModeExtensions(app, getPath, mode))`；
  新导出 `editorModeExtensions(app, getPath, mode: "live" | "source"): Extension`
  （live = livePreview(...) 全套，source = []）。其余扩展不动。
- `EditorPane.tsx`：CM 生命周期 effect 依赖去掉 `tab.mode`（→ `[app, tab.id, handle]`，
  preview 态仍无 CM 视图）；每视图持一个 `Compartment` 实例（ref）；独立 effect 在
  live↔source 间 `view.dispatch({ effects: modeCompartment.reconfigure(...) })`——
  选区/滚动/undo 因视图不重建而天然保留（R4 时代债清偿）。
- **live|source ↔ preview 往返（尽力恢复）**：模块级 session map（keyed by `tab.id`）：
  CM 卸载时存 `{ anchor, head, scrollTop }`，重建时恢复（位置 clamp 到文档长度）；
  preview 容器的 scrollTop 存独立槽位同样往返恢复。不持久化、不清理（量级 = 会话内
  开过的 tab 数，记录即可）。

### Core: 附件解析 + 二进制 IO（chief pre-phase 落地 vault/Rust，core-md agent 落地 metadata/markdown）

```ts
// VaultAdapter（chief）:
readBinary(path: string): Promise<Uint8Array>;
// Tauri → invoke("vault_read_binary") 返回 base64 再解码；
// Rust：#[tauri::command(async)]（文件 IO 不占主线程，R6 教训）+ safe_join + fs::read + base64。
// Memory → 内部 binaryFiles: Map<string, Uint8Array>（demo 种子图见下），缺失 reject。

// MetadataIndex（core-md agent）:
/** Resolve a NON-markdown attachment target（"img.png" / "assets/img.png"）。
 *  规则镜像 resolveLink：含 "/" 先精确相对路径（大小写不敏感）；否则按 basename
 *  匹配（多命中取排序后首个）。内部 map 从 vault.getFiles() 非 md 文件惰性构建，
 *  vault:changed 失效重建。 */
resolveAttachment(target: string, fromPath: string): string | null;
```

### Core: markdown 管线嵌入占位 — `core/markdown.ts`（core-md agent）

```ts
export interface RenderMarkdownOptions {
  /** present ⇒ `![[target]]`（图片扩展名）渲染为
   *  `<img class="geode-embed" data-embed-path="<resolved>" alt="<inner>">`（无 src，
   *  由调用方异步 hydrate）。absent/解析失败/非图片 ⇒ 与现状字节级一致（"!" 字面量
   *  + internal-link 占位走原路径）。 */
  resolveEmbed?: (target: string) => string | null;
}
export function renderMarkdownToHtml(
  source: string,
  resolve: (target: string) => string | null,
  opts?: RenderMarkdownOptions,
): string;
export const IMAGE_EXTS: ReadonlySet<string>; // png jpg jpeg gif svg webp bmp（小写比较）
```

`![[` 检测在 replaceWikilinks 内做（fence/inline-code 跳过规则沿用）；alias
`![[img.png|alt]]` 的 alias 作 alt。导出的 HTML（features/export）走同一管线——
导出文件里 img 无 src 不可用：export 路径**不传 resolveEmbed**（导出行为不变，
缺口记录：导出含图待后续轮内联 data URI）。

### Editor: 嵌入渲染 — `features/editor/`（editor agent）

- `embeds.ts`（新）：`getEmbedUrl(app, path): Promise<string>`——blob URL 模块级缓存，
  订阅 file:modified/renamed/deleted 失效并 `URL.revokeObjectURL`（惰性订阅一次）；
  `hydrateEmbeds(root: HTMLElement, app): void`——查 `img.geode-embed[data-embed-path]`
  异步填 src（加载失败加 `.geode-embed-failed` 类，不抛）。MIME 按扩展名映射。
- `livePreview.ts`：`EmbedWidget`——整个 `![[...]]` 匹配在 **resolveAttachment 命中
  图片** 且选区未触及时 replace 为 `<img class="cm-live-embed">`（src 经 getEmbedUrl
  异步填充；eq 按 resolvedPath）；光标进入 → 现有 reveal 规则还原原文；未解析/非图片
  → 维持现状（原文显示）。只处理 visibleRanges（bench 口径不回退）。
- `preview.ts`/`EditorPane.tsx` 阅读视图：renderPreview 增透传 opts；EditorPane 的
  preview 分支传 `resolveEmbed: (t) => app.metadata.resolveAttachment(t, path)` 并在
  innerHTML 后调 `hydrateEmbeds`。
- css：`.cm-live-embed`/`.geode-embed` max-width:100%、块级、圆角与 `--border` 变量。

### Demo fixture（chief pre-phase）

`demo-vault/assets/geode-dot.png`（1x1 真实 png 文件，仓库内）+ `Home.md` 增一行
`![[geode-dot.png]]`；Memory demo vault 同步：DEMO_FILES 增同名引用 + `DEMO_BINARY`
（同一 png 的 base64 → Uint8Array）。浏览器/桌面同一夹具口径。

### As-built deltas (post-review — R11)

Review: 4 dimensions, 11 findings → 2 confirmed (ONE root cause, both downgraded
critical→minor), 9 refuted, 1 verification dropped to a network fault (chief-adjudicated).

- **FIXED — blob cache subscribes `file:created`**: external edits to NON-md files
  surface as `file:created` (the vault pipeline reserves `file:modified` for .md), so
  the embed cache also invalidates on it. Without this an externally updated image
  served a stale blob URL for the whole session.
- **Recorded limitation** (chief-adjudicated after the verifier network fault): an
  already-rendered EmbedWidget keeps showing the OLD decoded bitmap after an external
  image edit until the widget rebuilds (cursor move/edit/reopen) — revoking a blob URL
  does not clear decoded images, and `eq` compares by resolved path by design.
- **Beyond contract letter (kept)**: `Vault.readBinary` facade added (chief) — embeds.ts
  initially called `vault.adapter.readBinary` directly, contradicting the "use Vault,
  never the adapter" rule.
- resolveAttachment deliberately does NOT mirror resolveLink's same-folder preference
  (lexicographic-first on basename collisions, frozen contract); flagged for future
  revisit if vaults with duplicate attachment names surface.
- Verified byte-identical no-opts rendering with a 12-case diff harness (fences, inline
  code, aliases, double-bang, unresolved) — compat/export pipelines unchanged.

### Round 11 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| core-md | core/metadata.ts, core/markdown.ts |
| editor | features/editor/**（EditorPane/cmExtensions/livePreview/preview/embeds.ts 新/css） |

Chief pre-phase：本节 + core/vault.ts readBinary 全链 + src-tauri vault_read_binary +
demo 夹具（磁盘 + Memory 种子）。Frozen surfaces：上述全部代码块签名 + IMAGE_EXTS +
`.geode-embed`/`data-embed-path`/`.cm-live-embed` 类名契约。每 agent 结束前
`npx tsc --noEmit`；不加依赖；不碰 compat/**、docs/。

## Round 10 additions — stale tab 清理 + 插件名本地化 + popup 重定位（缺口表清零）

R10 取 P2 组合（P1 发布渠道/证书等用户外部决策，HANDOFF 备选路径）。三项互不依赖。

### Core: stale tab cleanup — `core/workspace.ts` + `app/App.tsx` + `src/main.tsx`

R4 残留债：workspace state 是全局 localStorage（不按 vault 键控），切库后旧库 tab 残留。

```ts
// Workspace addition:
/** Close every markdown tab whose filePath no longer exists. One batched state
 *  update (normalize once), preserves graph tabs and the active-pane invariants.
 *  Returns the number of tabs closed. */
closeMissingFileTabs(exists: (path: string) => boolean): number;
```

- 调用点两个：`openVaultFlow`（App.tsx，`await vault.load()` 之后、插件重载之前）与
  bootstrap 初始加载（main.tsx，vault.load 后同一位置——上轮会话期间被外部删除的文件
  同样适用）。调用形态 `workspace.closeMissingFileTabs((p) => vault.fileExists(p))`。
- 行为：只动 `viewType === "markdown"` 且 `filePath !== null` 且 `!exists(filePath)` 的
  tab；graph tab 与空路径 tab 不动；每 leaf 的 activeTabId 按 closeTab 同规则修正；
  normalize 一次（空 leaf 塌缩；全空时保底单 leaf）；activePaneId 失效时退到首 leaf；
  结束 `emitActiveFile()`。静默清理（console.info 一条计数即可，不弹 toast）。

### Core: plugin name/description 本地化 — `core/plugins.ts` + `src/plugins/*` + SettingsModal

与 R8 Command.name 同模式：

```ts
// GeodePlugin:
name: string | (() => string);
description?: string | (() => string);
// core/plugins.ts exports:
export function getPluginName(p: GeodePlugin): string;
export function getPluginDescription(p: GeodePlugin): string | undefined;
```

- `isGeodePlugin` 校验放宽为 string|function；compat（manifest.name）与外部插件传
  字符串不受影响。显示点全部改经 getter：SettingsModal 插件名/描述/设置块标题/
  toggle aria-label（grep `plugin.name` 全仓确认无残留直读）。
- 内置三插件 name/description 改 thunk，键 `plugin.*` 进 dict.app.ts（en/zh，
  术语表口径：daily note=日记、word count=字数统计、random note=随机笔记）。

### Compat: suggest popup 重定位 — `compat/obsidian/suggest.ts` ONLY（缺口表最后一条）

- popup 打开期间增挂 `window` resize 监听 + `document` capture 相 scroll 监听
  （scroll 不冒泡，capture 才能抓到编辑器 scroller）；回调经 rAF 合帧（一帧至多一次）
  调既有 `position(this.active)`（其 coordsAtPos 失败回退编辑器盒的逻辑保持不变）。
- 监听与 rAF 在 popup 关闭/manager dispose 时全部拆除（id 归零——R7 StrictMode 教训）。
- OBSIDIAN-COMPAT 缺口表删除该行（**表清零**）。fixture 不需新增（桌面实测：弹层开着
  滚动编辑器，popup 跟随）。

### As-built deltas (post-review — R10)

Review: 3 dimensions, 6 findings → **ALL 6 refuted by adversarial verification (zero
confirmed)** — one verifier ran an exhaustive 1,793-case simulation of the
closeMissingFileTabs activeTabId repair rule. Notes:

- Beyond the contract letter (kept): `closeMissingFileTabs` also clears
  `lastActiveFile` when it points at a missing file (mirrors `handleDeleted` — a
  stale anchor must not drive the local graph after a vault switch).
- A refutation surfaced that R9's `tauri.conf.json` updater config never made it into
  the R9 feat commit (work-tree only) — it lands with the R10 release commit.
- Browser note: this round had no independent browser E2E (the automation tooling
  disconnected mid-session); all three features are webview-identical code paths and
  were fully verified on the desktop release build.

### Round 10 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| workspace-tabs | core/workspace.ts, app/App.tsx (openVaultFlow only), src/main.tsx (bootstrap call only) |
| plugins-i18n | core/plugins.ts, src/plugins/*.ts, features/settings/SettingsModal.tsx, core/i18n/dict.app.ts |
| compat-popup | compat/obsidian/suggest.ts ONLY |

Frozen surfaces：`closeMissingFileTabs` 签名、`getPluginName/getPluginDescription` 签名。
每 agent 结束前 `npx tsc --noEmit`；不加依赖；不碰 docs/。

## Round 9 additions — 自动更新链路（tauri-plugin-updater）+ compat suggest 余项

P1 取 HANDOFF 预授权的备选路径：**无 Authenticode 证书也能完整落地的更新链路**——tauri
自带 minisign 更新签名（本地生成密钥，与商业代码签名证书无关）；Windows Authenticode
（防 SmartScreen）做成 `bundle.windows.signCommand` 配置位，购证后填入即可（见
docs/DISTRIBUTION.md）。P2 清 R6 两条 compat 显式缺口：setInstructions 指令条渲染 +
纯光标移动重评估 onTrigger。

### One-time dep decisions (chief) — implementation agents must NOT add further deps

- Cargo: `tauri-plugin-updater = "2"`, `tauri-plugin-process = "2"`；main.rs 注册两插件。
- npm: `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`。
- capabilities/default.json 增加 `"updater:default"`, `"process:default"`。
- tauri.conf.json：`bundle.createUpdaterArtifacts: true`；`plugins.updater = { pubkey,
  endpoints: [GitHub latest.json 占位 URL], windows: { installMode: "passive" } }`。
- 更新签名密钥：`tauri signer generate` → `.tauri-keys/geode.key`（**gitignore，仓库内
  绝不提交私钥**；丢失即无法向已装机用户推送更新——备份责任在用户，DISTRIBUTION.md 写明）。
  构建发布版时设 `TAURI_SIGNING_PRIVATE_KEY`(+`_PASSWORD`) 环境变量。

### Core: update chain — `core/update.ts` (new, dual-end like core/net.ts)

```ts
export interface UpdateInfo { version: string; body: string }
export type UpdateProgress =
  | { kind: "started"; contentLength: number | null }
  | { kind: "progress"; downloaded: number; contentLength: number | null }
  | { kind: "finished" };
/** Desktop only. Browser (`!isTauri()`): supported=false, check resolves null. */
export function updateSupported(): boolean;
/** null = up to date. Rejects on network/endpoint errors (caller shows the error). */
export function checkForUpdate(): Promise<UpdateInfo | null>;
/** Download + verify minisign signature + run NSIS passive install, then relaunch.
 *  The returned promise only settles on failure paths (relaunch exits the app). */
export function downloadAndInstallUpdate(
  onProgress: (p: UpdateProgress) => void,
): Promise<void>;
```

Implementation: static imports of `@tauri-apps/plugin-updater` / `plugin-process` are
allowed (tree-shaken stubs are browser-safe); every call guarded by `updateSupported()`.
The `Update` object from `check()` is held module-level between check and install
(`downloadAndInstallUpdate` throws if no prior successful check).

### Settings UI: update section — `features/settings/SettingsModal.tsx` (About section)

About 节顶部新增 update 区（仅 `updateSupported()` 时渲染）：
- 当前版本行 + 按钮 `data-testid="settings-check-updates"`（idle/checking/最新/可用）。
- 可用时显示 `v{version}` + 按钮 `data-testid="settings-install-update"`（“更新并重启”），
  点击后进度条（`data-testid="settings-update-progress"`，百分比文本；contentLength 缺失
  时显示已下载字节数）。错误显示在行内 `data-testid="settings-update-error"`（完整错误
  文案，不吞）。状态机 idle→checking→(none|available)→downloading→installing；组件卸载
  不取消下载（插件不支持取消，重开设置页按钮态降级为 idle——已知限制）。
- 命令 `app:check-updates`（name thunk `cmd.checkUpdates`，`available: updateSupported`）
  打开设置页 About 节并触发检查（workspace.openModal("settings") + 节内自动 check 一次，
  实现细节 agent 自定，testid 冻结）。
- i18n：settings.update.* 键进 dict.views.ts，cmd.checkUpdates 进 dict.app.ts（本轮仅
  updater agent 碰这两文件，无所有权冲突）。

### Compat: setInstructions 指令条 — `suggest.ts` + `modal.ts`(SuggestModal) + `compat.css`

Calibrated（obsidian.d.ts:2712/3556/6898 + nldates main.js:9280）：
`setInstructions(instructions: Instruction[]): void`，`Instruction { command: string;
purpose: string }`（两字段官方均 **required**（无 `?`）——shim 类型照抄 required，
渲染时仍 `?? ""` 容空，因为运行时插件不受 TS 约束）。
- `PopoverSuggest`（EditorSuggest 继承）与 `SuggestModal` 都存 `_instructions`；再次调用
  整体替换；空数组/未调用 → 不渲染条。
- EditorSuggest popup：列表底部 `.prompt-instructions` 条（每项 `.prompt-instruction` =
  `<span class="prompt-instruction-command">{command}</span><span>{purpose}</span>`——
  官方 CSS 类名，主题兼容）；popup 翻转到行上方时条仍在列表底部。`data-testid=
  "editor-suggest-instructions"`。SuggestModal 同条渲染在 modal 底部。
- 移除 setInstructions 的 gap 上报（两处）。样式进 compat.css，颜色走 CSS 变量。

### Compat: 纯光标移动重评估 onTrigger — `core/documents.ts` + `core/events.ts` + compat `context.ts`/`suggest.ts`

官方语义：onTrigger "very often (on each keypress)" 基于光标位置评估——R6 只在文档事务时
驱动，纯光标移动不重评估（已记录偏差，本轮清除）。
- `core/events.ts` EventMap 新增：
  ```ts
  /** the LOCAL selection moved without a doc change (cursor motion, mouse click) */
  "document:selection-changed": { path: string };
  ```
  由 `DocumentHandle.syncExtension` 的 updateListener 在 `update.selectionSet &&
  !update.docChanged` 且非远端 sync 事务时 emit（每 update 至多一次，在
  document:changed 同一选择逻辑旁；setText/外部重载不触发）。
- compat `EditorSuggestManager` 订阅之（active view only，同 document:changed 守卫），
  跑与 document:changed 完全相同的触发循环（首个非 null 胜出；全 null → closeActive）。
  注意：trigger 循环内部 replaceRange 等编辑引发的 selection 事件天然被"逐 update 至多
  一次 + 内容判等"约束，无递归风险；评审重点核对。
- 缺口表删除该偏差行；popup 不随窗口 resize/scroll 重定位的偏差保留。
- fixture：FixtureSuggest `setInstructions([{command:"↵",purpose:"insert"}])`；浏览器
  E2E 断言指令条渲染 + 光标移出触发区后 popup 关闭（ArrowLeft 数次 → popup 消失）。

### As-built deltas (post-review + desktop E2E — R9)

Review: 5 dimensions, 8 findings → 3 confirmed (ALL minor), 5 refuted; the
updater-security / data-safety / contract-layering dimensions returned ZERO findings.

- **FIXED — `Instruction` fields are REQUIRED** (obsidian.d.ts:3556 has no `?`): the shim
  type now matches the official shape; rendering still `?? ""`-tolerates missing values
  (runtime plugins are untyped). The contract text above originally said "officially
  optional" — corrected; the error had propagated from contract → implementation.
- **Version constant converged at release** (`APP_VERSION` 0.9.0 = package.json =
  Cargo.toml = tauri.conf.json) — the mid-round mismatch was the documented release-flow
  intermediate state, not a defect (adversarial verification refuted the duplicate
  finding citing the R8 release commits as precedent).
- **Ops lesson (cost: one hung build): Windows cannot express empty-string environment
  variables** — PowerShell `$env:X = ""` DELETES the variable, and the tauri signer then
  blocks forever on an interactive password prompt in a non-interactive shell. The
  updater keypair therefore MUST have a password (regenerated; password in
  DISTRIBUTION.md, rotate before public release).
- Desktop E2E verified the FULL chain (running 0.8.5 app → check → download → minisign
  verify → NSIS passive install to %LOCALAPPDATA%\Geode → auto-relaunch as v0.9.0) plus
  two negative cases: corrupted-encoding signature and validly-encoded-but-wrong
  signature both fail inline ("Invalid encoding in minisign data" / "The signature
  verification failed") with the app alive.
- Behavioral note: cursor-move re-evaluation CLOSES the popup when the cursor leaves the
  trigger range (verified with nldates), but whether moving BACK re-opens it depends on
  the plugin's own onTrigger (nldates builds its anchor per-keystroke and does not
  re-match a completed phrase — official Obsidian behaves identically; the fixture
  suggest proves the re-open path works).

### Round 9 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| updater-ui | core/update.ts (new), features/settings/SettingsModal.tsx, app/App.tsx (command only), core/i18n/dict.views.ts, core/i18n/dict.app.ts |
| compat-suggest | compat/obsidian/{suggest,modal,ui,plugin,context,fixture,gaps}.ts (按需), compat/obsidian/compat.css |

Chief pre-phase（agent 起跑前已完成，tsc+cargo 常绿）：本节 + 全部依赖/conf/capabilities/
main.rs 插件注册 + 密钥生成 + core/events.ts + core/documents.ts 的 selection 事件。
Frozen surfaces：core/update.ts API 块、`document:selection-changed` 事件形状、三个
settings testid、`editor-suggest-instructions` testid、Instruction 渲染 DOM 类名。
每 agent 结束前 `npx tsc --noEmit`（updater-ui 另跑 `cargo check`——本轮其实 Rust 由
chief 预改，agent 不碰 Rust）。不加任何新依赖。

## Round 8 additions — i18n（中/英）+ watcher 回声抑制

Native round（compat 表面零改动——套件只需不回退）。No new npm deps（i18n 手写，不引 i18next）。

### Core: i18n — `core/i18n.ts` (new) + `core/i18n/dict.*.ts` (new, 3 fragments)

Layering amendment: `core/i18n.ts` is the SECOND hooks exception besides store.ts
(pure TS + one React hook; never imports components).

```ts
export type Locale = "en" | "zh";
export type I18nKey = keyof typeof en;   // en = merged fragment dictionaries
/** singleton — current locale. Initial: localStorage "geode.locale" if valid,
 *  else navigator.language startsWith("zh") → "zh", else "en". */
export const locale: Store<Locale>;
export function setLocale(l: Locale): void;  // sets store + persists localStorage
/** Translate: current-locale dict → en fallback → the key itself (never throws).
 *  Params interpolate "{name}"-style placeholders. */
export function t(key: I18nKey, params?: Record<string, string | number>): string;
/** React hook: subscribes to `locale` (useStore) and returns `t` — components
 *  re-render on locale switch. Usage: `const t = useI18n();` */
export function useI18n(): typeof t;
```

- **Dictionary fragments** (one per sweep agent — exclusive ownership, no merge
  conflicts): `core/i18n/dict.app.ts`, `dict.panels.ts`, `dict.views.ts`, each
  `export const en = { ... } as const;` + `export const zh: Record<keyof typeof en, string> = { ... };`
  `core/i18n.ts` spreads them: `const en = { ...appEn, ...panelsEn, ...viewsEn }`.
  Key namespaces match the fragment: `app.*`/`cmd.*`/`plugin.*` (dict.app),
  `explorer.*`/`search.*`/`backlinks.*`/`outline.*`/`palette.*`/`switcher.*` (dict.panels),
  `settings.*`/`graph.*`/`editor.*`/`export.*` (dict.views).
- **Scope**: every user-visible string in src/app, src/main.tsx, src/features,
  src/plugins — JSX text, placeholder/title/aria-label, command names, empty states,
  toasts, confirm dialogs. **NOT in scope**: console.* messages (stay English),
  src/compat/** (untouched this round), data-testid values, localStorage keys.
- **Persisted strings stay language-neutral**: tab titles persist in workspace
  state — the graph tab's stored title is ignored at render time (tab strip renders
  `t("app.graphTab")` when `viewType === "graph"`); file tabs keep the basename.

### Core: command names become translatable — `core/types.ts` + `core/commands.ts` (chief, pre-phase)

```ts
// types.ts
interface Command { name: string | (() => string); ... }   // string still valid (compat passes strings)
// commands.ts
export function getCommandName(cmd: Command): string;       // resolves the thunk
```

- Native registrations switch to `name: () => t("cmd.xxx")` — NO re-registration on
  locale switch; display sites resolve at render time.
- `CommandRegistry.list()` sorts via `getCommandName`. All display/filter sites
  (CommandPalette fuzzy + chips, SettingsModal hotkeys rows + conflict labels) use
  `getCommandName` and subscribe to locale via `useI18n()`.

### Settings: language picker — `features/settings/SettingsModal.tsx` (Appearance section)

Setting row "Language / 语言": `<select data-testid="settings-language">` with options
`en` → "English", `zh` → "中文" (option labels are SELF-named, never translated).
onChange → `setLocale`. Locale persists across reload.

### 中文术语表（zh 文案统一口径，向 Obsidian 中文社区习惯对齐）

vault=库 · note=笔记 · tab=标签页 · pane=窗格 · backlinks=反向链接 · outgoing links=出链 ·
outline=大纲 · graph view=关系图谱 · command palette=命令面板 · quick switcher=快速切换 ·
live preview=实时预览 · reading view=阅读视图 · source mode=源码模式 · appearance=外观 ·
hotkeys=快捷键 · theme=主题 · dark/light=深色/浅色 · export=导出 · tag=标签 ·
folder=文件夹 · daily note=日记 · word count=字数 · status bar=状态栏 · sidebar=侧边栏 ·
unresolved=未创建 · settings=设置 · plugin=插件。语气：简体中文、不加句号的短标签、
按钮用动词短语（"新建笔记"），空状态用完整句（"打开笔记以查看其反向链接。"）。

### Core: watcher echo suppression — `core/vault.ts` ONLY

Self-writes echo back through the fs watcher today (full refreshTree + double
reload reads per save, downstream equality makes it a no-op). Suppress at the source:

- `modify()`/`create()` record `recentSelfWrites: Map<path, { hash, at }>`
  (FNV-1a 32-bit over the written content, local helper) **BEFORE** awaiting
  `adapter.writeFile` (the echo can arrive while the write promise is pending).
  Entries expire after 10s (TTL pruned opportunistically); a newer write to the
  same path overwrites the entry. Entries are KEPT until expiry (notify may
  deliver several echo batches for one write).
- `handleExternalChanges(paths)` partitions first: a path with a fresh entry →
  `adapter.readFile` + hash compare. Match → **suppressed**: keep the content
  cache (it IS the written content — no cacheDelete), emit nothing for this path.
  Mismatch or read error → delete the entry, treat as a real external change.
- ALL paths suppressed → return before `refreshTree` (the main win: zero work per
  auto-save echo). Otherwise the existing pipeline runs for the surviving paths only.
- Deletes/renames/folders: out of scope — only paths with recorded entries are
  ever suppressed; everything else keeps current behavior.
- Probes: `window.__geodeWatchEcho = { suppressed, external }` counters (both ends,
  cheap, always on). `MemoryVaultAdapter.startWatch` additionally registers
  `window.__geodeFireWatch = (paths: string[]) => onChange(paths)` so browser E2E
  can simulate watcher events (desktop notify path is exercised in the desktop pass).

### As-built deltas (post-review, adversarially verified — R8)

Review: 5 dimensions, 10 findings → 5 confirmed (ALL downgraded to minor by adversarial
verification — zero surviving major/critical), 5 refuted. Disposition:

- **FIXED — failed writes clear their fingerprint**: `modify()`/`create()` wrap the adapter
  write in try/catch; on failure `clearSelfWrite(path, content)` removes the entry only if
  it still belongs to that write (hash equality — a newer concurrent write keeps its own).
  Without this, a failed write's fingerprint could suppress a byte-identical REAL external
  change within the 10s TTL.
- **Recorded limitation (no code change)** — un-awaited concurrent `modify()` calls to the
  same path keep only the LAST fingerprint; an echo of the first write hashes as external →
  one redundant refresh + spurious external events. Downstream is fully guarded (dirty
  check + content-equality no-op; `vault:external-changed` has zero subscribers) and the
  failure direction is safe-by-design (mis-classify as external, never mis-suppress).
- **Recorded limitation (no code change)** — strings resolved at CM6 view/widget BUILD time
  (editor placeholder, task-checkbox aria-label, frontmatter pill) keep the previous locale
  until the view/widget rebuilds (mode switch / tab reopen / editing the line). Intentional:
  rebuilding live editors on locale switch risks editor state for an a11y label. Noted in
  code comments at each site.
- Refuted (not defects, examples): non-md external creates emitting `file:created` is
  pre-existing R2 behavior untouched by the partition; `Record<keyof typeof en, string>`
  exactly matches the contract's fragment shape; ErrorBoundary's imperative `t()` is a
  terminal page (no live switch reachable).

### Round 8 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| watcher | core/vault.ts ONLY |
| sweep-app | app/App.tsx, src/main.tsx, src/plugins/*.ts, core/i18n/dict.app.ts |
| sweep-panels | features/explorer/*, features/search/*, features/backlinks/*, features/outline/*, features/palette/*, core/i18n/dict.panels.ts |
| sweep-views | features/settings/*, features/graph/*, features/editor/* (strings only), features/export/*, core/i18n/dict.views.ts |

Pre-phase (chief, before agents start): this section + `core/i18n.ts` complete +
3 fragment stubs + `Command.name` widening + `getCommandName` — tsc green at the
starting line. Frozen cross-agent surfaces: the `core/i18n.ts` API block, the
fragment file shape, `getCommandName`, `data-testid="settings-language"`,
`window.__geodeFireWatch` / `__geodeWatchEcho`. Every agent runs `npx tsc --noEmit`
before finishing; no agent touches another's files; no new npm deps.

## Round 7 additions — 图谱打磨（fit/局部图谱/10k 性能）+ 导出 HTML/PDF

Native round (no obsidian API surface change — compat suite must simply not regress).

### Core: last-active-file tracking — `core/workspace.ts`

```ts
// Workspace addition:
/** Most recent NON-NULL active file (survives switching to the graph tab / modals).
 *  Session-only — not persisted. Seeded from the active tab on load. */
readonly lastActiveFile: Store<string | null>;
```

Updated wherever `active-file:changed` is emitted with a non-null path (single choke point —
find the emit site and tap it; do NOT add a second source of truth). Switching to a graph tab
or closing the file does NOT clear it. The graph view's local mode subscribes to this store.

### Graph view — `features/graph/` (GraphView.tsx + graph.css, feature-internal)

**Toolbar** (`.graph-toolbar`, top-left, must not block canvas drag elsewhere):
mode toggle Global/Local (`data-testid="graph-mode-global"` / `"graph-mode-local"`),
depth select 1|2 shown in local mode (`data-testid="graph-depth"`),
fit button (`data-testid="graph-fit"`). UI prefs persist to localStorage
`"geode.graphPrefs"` as `{ mode: "global"|"local", depth: 1|2, showAll: boolean }`
(corrupt/missing → defaults global/1/false).

**Fit-to-view + centering fix (R3 debt)**:
- `fitToView()` — bounding box over RENDERED node positions (+node radius + ~40px padding)
  → transform centers the bbox in the viewport, `k` clamped to [MIN_ZOOM, 1.5].
- Auto-fit triggers: once when the first simulation settles (sim "end") unless the user has
  panned/zoomed since mount (interaction flag); after every local-mode re-anchor.
- Root-cause the maximized-window offset (acceptance: open graph in a maximized window →
  visually centered; maximize/restore AFTER open → still centered). The existing
  keep-viewport-center resize compensation may stay, but the initial mount must measure the
  real laid-out rect.

**Local mode**:
- Anchor = `workspace.lastActiveFile` resolved to a graph node id; BFS over the adjacency map
  to depth ≤ N (1|2), unresolved neighbors included; simulation runs over the SUBGRAPH only.
- Anchor node: accent ring + label always visible. Anchor change → existing 250ms debounced
  rebuild path + auto-fit. No anchor (null / not in graph) → empty-state card
  "Open a note to see its local graph." (`data-testid="graph-local-empty"`).

**10k performance** (PERFORMANCE.md recommendations 1+2; targets measured at `?bench=10000`):
- **Degree sampling**: `RENDER_CAP = 3000` nodes. `nodes > cap && !showAll` → keep top-cap by
  degree (stable tie-break by id), edges among kept nodes only, simulation over the sample;
  legend shows "top 3,000 of 10,212 nodes" + toggle button (`data-testid="graph-show-all"`).
- **Draw batching**: all non-highlighted edges in ONE `beginPath`/`stroke`; nodes bucketed by
  fill style; labels and nodes outside the viewport (±margin) are culled. Hover state may
  redraw only via the batched path (no per-edge stroke loops).
- **rAF coalescing**: every internal draw request goes through a dirty-flag +
  `requestAnimationFrame` scheduler — at most one canvas draw per frame, zero draws when idle
  (post-settle, no interaction).
- Perf marks on `window.__geodePerf`: `graphDrawMs` (last full draw), `graphSettleMs`
  (rebuild → sim end). PERFORMANCE.md gains a before/after table for bench=10000 and
  bench=1000 (no regression at 1k: 60fps).

### Export — `core/export.ts` (new) + `features/export/` (new) + Rust

`core/export.ts` (mirrors core/net.ts dual-end pattern, uses `isTauri()` from core/vault):

```ts
export interface SaveTextFileOptions {
  suggestedName: string;   // e.g. "Welcome.html"
  filterName: string;      // e.g. "HTML"
  extensions: string[];    // e.g. ["html"]
}
/** Desktop: native save dialog (@tauri-apps/plugin-dialog) + `export_write` command.
 *  Browser: Blob + anchor download (always resolves "saved"). */
export function saveTextFile(
  content: string,
  opts: SaveTextFileOptions,
): Promise<"saved" | "cancelled">;
```

Rust `export_write` (src-tauri/src/main.rs):
`#[tauri::command(async)]` (file IO off the main thread — R6 lesson)
`fn export_write(path: String, content: String) -> CmdResult<()>` — ABSOLUTE path as returned
by the save dialog; reject relative paths; write UTF-8; parent dir must already exist
(the dialog guarantees it). No safe_join — exporting outside the vault is the point;
the path always comes from a user-driven native dialog.

`features/export/` (export.ts + export.css):
- `buildStandaloneHtml({ title, bodyHtml }): string` — complete standalone document with an
  INLINE `<style>` (self-contained reading-view subset: typography, headings, code, blockquote,
  tables, tag pills, disabled task checkboxes, internal/external link colors — light,
  print-friendly, independent of the app theme). Import the css as a string via Vite `?raw`.
- `exportActiveNoteHtml(app)` — active file → `vault.read` → `renderMarkdownToHtml(content,
  target => metadata.resolveLink(target, path))` → `saveTextFile`. Internal links become
  non-navigating styled text (href="#", no JS in the export).
- `printActiveNote(app)` — same html into a `#geode-print-root` div appended to body;
  `@media print` hides `#root` and shows only the print root; `window.print()`;
  cleanup on `afterprint` (and a safety timeout). Desktop WebView2 print dialog includes
  "Microsoft Print to PDF" — that IS the PDF export path (documented, no extra dep).
- Commands registered in App.tsx beside the existing ones:
  `app:export-html` ("Export note as HTML…"), `app:export-pdf` ("Export note as PDF (print)…"),
  both with `available: () => workspace.getActiveFile() !== null`.
- Browser E2E hooks: the download anchor must carry `data-testid="export-download"` long
  enough for Playwright's download event; print path exposes `window.__geodeLastPrintHtml`
  (dev-only probe, set before `window.print()` and in browser E2E `print` may be stubbed).

### As-built deltas (post-review + runtime verification — R7)

Review: 5 dimensions, 18 findings confirmed (8 unique root causes), 0 refuted. Browser
verification then caught 2 ADDITIONAL runtime bugs the static review missed. All fixed:

- **`lastActiveFile` is remapped directly in `handleRenamed`** (equal path + folder-prefix
  branches) — the emitActiveFile choke point can't see a rename while a non-markdown tab
  (graph) is active: `getActiveFile()` is null and the non-null guard keeps the stale path,
  blanking the local graph for a still-open note. `handleDeleted` clears a deleted anchor;
  `openVaultFlow` resets the store before `vault.load()` (old-vault relative paths must
  never anchor the local graph in a new vault).
- **Export reads the LIVE document buffer first**
  (`app.documents.get(path)?.getText() ?? await vault.read(path)`) — vault.read returns the
  last *saved* content; with the 600ms save debounce an export right after typing silently
  missed the latest edits.
- **Export surfaces its outcome** — `exportActiveNoteHtml` never rejects: success/failure
  shows a transient toast (`data-testid="export-notice"`, styles in `notice.css`, kept OUT
  of export.css which ships inside every exported file). Previously a failed disk write
  died as an unhandled rejection behind the already-closed save dialog.
- **`export_write` writes a sibling temp file + rename** — `fs::write` truncates before
  writing; a mid-write failure (disk full, kill) must never destroy the user-chosen
  existing file.
- **Print re-entry settles the previous print** via a module-level `pendingPrintCleanup`
  (listener + timer + `document.title` restore), not just DOM removal — back-to-back prints
  were cross-restoring titles when `afterprint` never fired.
- GraphView: the full-graph adjacency is built only in the local branch (global built and
  dropped an O(E) map per rebuild); user pan/zoom also cancels a PENDING re-anchor
  settle-fit (not just the first-settle fit).
- **[runtime-only] rAF id reset on unmount cleanup** — `cancelAnimationFrame` without
  `rafRef.current = 0` left a stale truthy id after StrictMode's dev double-mount, making
  every future `requestDraw` early-return: the canvas stayed BLANK forever in dev while
  legend/toolbar looked alive. Static review missed it; only a screenshot caught it.
- **[runtime-only] per-edge strokes, NOT a batched mega-`Path2D`** — one 6.5k-segment
  stroked path rasterizes in ~197ms vs ~9ms for individual strokes (20x, compositor-side,
  invisible to JS timing); plus label suppression while the sim is hot (a 3k `fillText`
  pass throttled settle 43s → 5.8s). Numbers + "do not reintroduce" note in PERFORMANCE.md.

### Round 7 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| graph | features/graph/GraphView.tsx, features/graph/graph.css, core/workspace.ts (lastActiveFile ONLY) |
| export | core/export.ts (new), features/export/* (new), app/App.tsx (command registration ONLY), src-tauri/src/main.rs (export_write + invoke_handler list ONLY) |

Frozen cross-agent surfaces: `Workspace.lastActiveFile`, `saveTextFile` signature, the two
command ids. Neither agent touches the other's files; both run `npx tsc --noEmit` (and the
export agent `cargo check`) before finishing.

## Round 6 additions — compat 余项（EditorSuggest 真实触发 / MarkdownRenderer / requestUrl）+ 快捷键自定义

Calibration source: **`.calibration/API-REFERENCE-R6.md`** (generated 2026-06-10 from official
obsidian.d.ts + suite main.js call-site scans). Implement EXACTLY against it.
Suite facts that drive this contract:
- The suite has **ZERO callers** of MarkdownRenderer/requestUrl — both are implemented to the
  official d.ts shape only, no suite-specific accommodation needed.
- nldates' DateSuggest (the EditorSuggest unlock) additionally needs: `this.scope.register(
  ["Shift"], "Enter", cb)` (a REAL Scope), `this.setInstructions(...)`, **the non-public
  `this.suggestions.useSelectedItem(evt)`**, context.start reuse across keystrokes,
  `editor.getRange/replaceRange`, `el.setText`, `vault.getConfig("useMarkdownLinks")` (exists).
- onTrigger officially fires "very often (on each keypress)" — we drive it from the
  `document:changed` core event (per local transaction). Cursor-move-only re-evaluation is a
  recorded deviation (suite unaffected).

### Core: hotkey overrides — `core/commands.ts`

```ts
// CommandRegistry additions (all bump `revision`):
getEffectiveHotkey(id: string): string | null;      // override ?? command.hotkey ?? null
setHotkeyOverride(id: string, hotkey: string | null): void; // null = explicitly unbound; persists
clearHotkeyOverride(id: string): void;              // back to the command's default; persists
hasHotkeyOverride(id: string): boolean;
findHotkeyConflicts(hotkey: string, excludeId?: string): Command[]; // normalized effective-hotkey match
export function normalizeHotkey(hotkey: string): string; // canonical "Ctrl+Alt+Shift+Key" (Mod→Ctrl)
```

- Overrides persist to localStorage `"geode.hotkeyOverrides"` as `Record<string, string | null>`
  (same global-key pattern as the plugin enabled-set). Unknown command ids are kept (a plugin
  may register later).
- `handleKeydown` matches EFFECTIVE hotkeys only. `matchHotkey` keeps its signature.
- CommandPalette displays `getEffectiveHotkey(cmd.id)` instead of `cmd.hotkey`.

### Core: markdown pipeline extraction — `core/markdown.ts` (new)

The markdown-it pipeline moves VERBATIM from `features/editor/preview.ts` to `core/markdown.ts`
(core may import markdown-it; no React). Exports:
`renderMarkdownToHtml(source: string, resolve: (target: string) => string | null): string`
(wikilinks/tags/task checkboxes — semantics unchanged).
`features/editor/preview.ts` keeps its exports (`renderPreview`, `toggleTaskOnLine`) — 
`renderPreview` becomes a thin delegate; EditorPane is untouched.

### Core: HTTP transport — `core/net.ts` (new)

```ts
export interface HttpRequestParams { url: string; method?: string;
  headers?: Record<string, string>; contentType?: string;
  bodyText?: string; bodyBase64?: string; }
export interface HttpResponseData { status: number;
  headers: Record<string, string>; bodyBase64: string; }
/** Tauri: invoke("http_request") — CORS-free. Browser: fetch (CORS-bound; rejects on network error). */
export function httpRequest(params: HttpRequestParams): Promise<HttpResponseData>;
```

Pure transport: never throws on HTTP status (4xx/5xx return normally) — `throw` semantics live
in the compat layer. Browser path reads the response as ArrayBuffer → base64.

### Rust: `http_request` command (src-tauri)

One-time dep decision (chief): **`ureq = "2"` (rustls) + `base64 = "0.22"`** in Cargo.toml —
implementation agents still must not add further deps. Command (serde camelCase,
**`#[tauri::command(async)]` — a plain sync command runs ON the main thread in Tauri 2 and a
blocking 30s request would stall the event loop and every queued vault_* command**):
`http_request(req: HttpRequest) -> CmdResult<HttpResponse>` where HttpRequest
`{ url, method?, headers?, bodyBase64? }`, HttpResponse `{ status, headers, bodyBase64 }`.
Method defaults GET; 30s timeout; redirects followed (ureq default); 4xx/5xx are NOT errors
(`ureq::Error::Status` maps to a normal response); duplicate response headers join with ", ".
Only http/https URLs accepted (anything else → CmdResult error).

### Compat: requestUrl / request — `util.ts`

Implement per API-REFERENCE-R6 (official shapes):
- `requestUrl(request: RequestUrlParam | string): RequestUrlResponsePromise` over
  `core/net.httpRequest`. The returned object is a Promise PLUS `arrayBuffer/json/text`
  promise properties (official RequestUrlResponsePromise).
- Resolved `RequestUrlResponse`: `status`, `headers`, and `arrayBuffer/json/text` as
  PROPERTIES (not methods): text = utf-8 decode, json = lazy JSON.parse(text),
  arrayBuffer = base64 decode.
- `throw` defaults true → status ≥ 400 rejects with a descriptive Error; `throw: false`
  resolves normally.
- `body: string | ArrayBuffer` maps to bodyText/bodyBase64; `contentType` becomes the
  Content-Type header (explicit `headers["Content-Type"]` wins).
- **`data:` URLs are resolved in-layer** (no network, both ends — the deterministic fixture
  path). `export function request(req): Promise<string>` = `requestUrl(req).text`.
- Remove the requestUrl gap plumbing. Network failures reject with the transport error.

### Compat: MarkdownRenderer — `util.ts`

- `static async render(app, markdown, el, sourcePath, component)`: html =
  `renderMarkdownToHtml(markdown, target => metadata.resolveLink(target, sourcePath))` from
  the CURRENT loader context (module-level handle, see below); `el.innerHTML = html`
  (markdown-it runs html:false — no raw-HTML injection); add `.markdown-rendered` class;
  one delegated click listener wires `.internal-link` → `workspace.openFile(resolved)`;
  task checkboxes render disabled (no source mapping for plugin-rendered fragments).
  When `component` looks like a Component (`typeof component?.register === "function"`),
  register the listener teardown there.
- `static renderMarkdown(markdown, el, sourcePath, component)` (deprecated 4-arg) delegates.
- Module-level current-handle plumbing: `context.ts` calls `_setCompatHostHandle(handle)`
  on create and `_setCompatHostHandle(null)` in dispose; `render` falls back to the `app`
  argument's internal handle when module handle is absent. Remove the MarkdownRenderer gap
  reporting.

### Compat: EditorSuggest real triggering — `suggest.ts` + `ui.ts` + `plugin.ts` + `context.ts`

- `ui.ts` Scope becomes REAL: stores `{ modifiers, key, func }` handlers;
  `register(modifiers: Modifier[] | null, key: string | null, func): KeymapEventHandler`
  (returns `{ modifiers, key, scope }`); `unregister(handler)` removes by identity;
  internal readonly `_handlers` array for the popup's keydown dispatch. (Calibrated:
  modifiers `null` = match any modifier state; `Mod` → Ctrl on the host.)
- `suggest.ts` gains the runtime (one manager per compat context):
  - `class EditorSuggestManager`: ordered registry of EditorSuggest instances
    (`registerEditorSuggest` order, per-plugin disposers).
  - Trigger loop, subscribed in `context.ts` to `document:changed` (active view only —
    same guard as the editor-change wiring): build the Editor shim + TFile from the
    registry; for each suggest in order run `onTrigger(cursor, editor, file)`; first
    non-null wins → `suggest.context = { ...info, editor, file }` → `getSuggestions`
    (await; stale-token guard) → non-empty → popup; empty/null → close.
  - Popup (`compat.css`, `.geode-suggest-popup`): fixed-position at
    `view.coordsAtPos(posToOffset(start))`, below the line (flips above near the bottom);
    items capped at `suggest.limit`; `renderSuggestion(item, itemEl)`; hover selects,
    click → `selectSuggestion(item, evt)` + close; `data-testid="editor-suggest-popup"`,
    items `data-testid="editor-suggest-item"`.
  - Document-capture keydown while open: suggest.scope `_handlers` are consulted FIRST
    (exact modifier-set match; `func(evt, ctx)` returning false → preventDefault +
    stopPropagation — nldates' Shift+Enter path); then ArrowDown/ArrowUp navigate,
    Enter → `selectSuggestion(selected, evt)` + close, Escape → close. Plain typing
    falls through to the editor.
  - Non-public surface nldates needs: every EditorSuggest instance gets
    `this.suggestions = { useSelectedItem(evt) }` → selectSuggestion(current) + close.
  - `PopoverSuggest.open/close` drive the popup; `close()` clears `suggest.context = null`
    and is idempotent. Close on: trigger returning null, selection made, active file/view
    switch (`active-file:changed`), mousedown outside popup + editor, Escape, plugin unload.
  - Deviation (recorded once as a gap note, not per keystroke): onTrigger re-evaluates per
    local doc transaction, not on pure cursor movement.
- `plugin.ts`: `registerEditorSuggest(suggest)` becomes REAL — registers into the manager,
  unload disposer unregisters. Remove its gap reporting.
- `fixture.ts` (browser E2E): a fixture EditorSuggest (trigger phrase `@@`, static
  suggestions, selection replaces the trigger range), a command probing
  `requestUrl("data:application/json,...")` into a status-bar item
  (`data-testid` via existing fixture pattern), and a command rendering
  `"**bold** [[Welcome]] - [ ] task"` through `MarkdownRenderer.render` into a probe
  element (`data-testid="obsfixture-md-render"`).

### Settings: Hotkeys section — `features/settings/SettingsModal.tsx`

- New section `{ id: "hotkeys", label: "Hotkeys", icon: "command" }` (between Plugins and
  About; pick any existing keyboard-ish icon if "command" is absent).
- Filter input (`data-testid="settings-hotkeys-filter"`); rows from
  `commands.list()` + `useStore(commands.revision)`, each row
  (`data-testid="hotkey-row-<id>"`): command name, effective-hotkey chip (or "Not set"),
  customize button (`data-testid="hotkey-edit-<id>"`) entering CAPTURE mode:
  - capture takes the NEXT keydown with a non-modifier key → candidate hotkey string
    (built consistently with `matchHotkey`'s grammar, via `normalizeHotkey`);
    Escape cancels; Backspace/Delete sets the override to null (unbound);
    modifier-only chords are never saved.
  - Conflict check via `findHotkeyConflicts(candidate, id)`: warning inline
    (`data-testid="hotkey-conflict-<id>"`) naming the conflicting command; saving is still
    allowed (Obsidian behavior) — both rows then show a conflict badge.
  - Reset-to-default button when `hasHotkeyOverride(id)` (`data-testid="hotkey-reset-<id>"`).
- `features/palette/CommandPalette.tsx`: hotkey chip reads `getEffectiveHotkey`.

### As-built deltas (post-review, adversarially confirmed — R6)

Review: 5 dimensions, 13 findings confirmed (9 unique root causes), 2 refuted. All fixed:

- **`closeActive()` cancels in-flight `getSuggestions`** (token bump) and clears EVERY
  lingering `suggest.context` — a pending async suggest has a context but no popup yet, so
  closing only the active one let a stale popup open later (Enter would then replaceRange
  stale coordinates — data-safety). Trigger-null / file-switch / Escape / outside-click /
  dispose all route through it. The winner-selection loop closes other suggests by
  context, not just the active one.
- **Suggest popup keydown has a focus guard**: keystrokes whose target is outside the
  editor + popup (palette input, modals) are never consumed — the popup closes instead.
- **`hotkeyFromEvent(e): string | null` lives in `core/commands.ts`** (exported), not in the
  settings UI: single grammar authority. It returns null (capture keeps waiting) for Meta
  combos, modifier-only chords, a literal "+", and **bare printable keys — a binding
  without Ctrl/Alt (function keys exempt) would swallow normal typing**. Shifted
  punctuation is normalized to the physical base char via e.code (capturing Ctrl+Shift+\
  yields "Ctrl+Shift+\", matching the default binding's spelling, so conflict detection
  compares like with like).
- **`handleKeydown` pre-parses effective hotkeys** (cache invalidated on register/
  unregister/override change), rejects `e.metaKey` outright, and **suppresses
  Ctrl/Alt-less bindings while an editable element has focus** (defense for stale
  persisted bare-key overrides). `matchHotkey` also rejects metaKey.
- **`http_request` is `#[tauri::command(async)]`** — a plain sync command runs ON the main
  thread in Tauri 2; a blocking 30s request would stall the event loop and every queued
  vault_* command (the original contract sentence claimed the opposite and was corrected).
  The HTTP method is validated (`is_ascii_alphabetic`) — ureq validates headers but writes
  the method into the request line unchecked (CRLF smuggling).
- `setInstructions` (EditorSuggest + SuggestModal) reports a gap once instead of silently
  no-op'ing (nldates' "Shift: keep text as alias" hint bar is not rendered).
- Refuted (not defects): Backspace-with-modifiers unbinding in capture mode is the
  contract's explicit carve-out; the 10MB body cap mapping to a transport error has no
  reachable trigger in the suite and falls under the declared transport-error bucket.

### Round 6 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| core | core/commands.ts, core/markdown.ts (new), core/net.ts (new), features/editor/preview.ts (pipeline move only) |
| compat-suggest | compat/obsidian/{suggest,plugin,context,ui}.ts, compat/obsidian/compat.css |
| compat-net-render | compat/obsidian/{util,index,fixture}.ts |
| shell-settings | features/settings/*, features/palette/CommandPalette.tsx, src-tauri/Cargo.toml, src-tauri/src/main.rs |

Frozen cross-agent surfaces: everything in this section's code blocks. compat-net-render
consumes `core/net.ts` + `core/markdown.ts` exactly as declared; compat-suggest consumes
`document:changed` + the Editor shim as declared; shell-settings consumes the
CommandRegistry additions as declared.

## Round 5 additions — compat T2: moment + registerView real mounting

Calibration source: `.calibration/API-REFERENCE-R5.md` (regenerated 2026-06-10 from official
obsidian.d.ts + suite main.js call-site scans). Implement EXACTLY against it.
Suite facts that drive this contract:
- nldates & calendar consume moment **exclusively via `window.moment`** (zero imports);
  the official module also has `export const moment: typeof Moment` — we provide BOTH.
- calendar uses the LEGACY startup API: `workspace.layoutReady` bool + `on("layout-ready")`
  **event**, then `getRightLeaf(false).setViewState({type})` chained synchronously (non-null!).
- recent-files: `[leaf] = getLeavesOfType(type)`, `getLeftLeaf(!1)`, `await setViewState({type})`,
  `await revealLeaf(leaf)`, `detachLeavesOfType(type)`, `ensureSideLeaf(type,"left",{reveal:true})`
  (onUserEnable), `getLeavesOfType(type).first()` (obsidian's Array.prototype extension!).
- calendar's ItemView subclass touches `this.app` and `this.registerEvent` **inside its
  constructor** — `View`'s constructor must set `app` from the leaf before subclass code runs.

### moment (one-time T2 decision, ROADMAP R5 P0)

- npm dependency `moment@^2.30.1` is added by the chief — implementation agents still must
  NOT add further deps.
- `compat/obsidian/util.ts`: `export const moment` becomes the real moment instance
  (replaces the throwing placeholder; remove the gap plumbing for it).
- Loader sets `window.moment` (idempotent) BEFORE evaluating any plugin main.js, in both
  desktop and browser/fixture paths. Do not overwrite an existing `window.moment`.
- `window._bundledLocaleWeekSpec` writes by calendar are allowed (plain window global, no-op for us).

### Core: `document:changed` event (per-transaction editor signal)

`core/events.ts` EventMap gains:
```ts
/** a LOCAL editor transaction changed a document's text (pre-save, per keystroke) */
"document:changed": { path: string };
```
Emitted from `DocumentHandle.syncExtension` (core/documents.ts) when an update contains a
local (non-sync-annotated) doc change — one emit per update, after forwarding to other views.
NOT emitted for setText/external reload/undo-history moves without doc change.
compat `context.ts` rewires workspace `'editor-change'` to this event (replacing the
file:modified DEVIATION — remove that gap report and the warn in workspace.on).

### Core: plugin sidebar panels (host for compat custom views)

`core/plugins.ts`:
```ts
export interface SidebarPanelContribution {
  id: string;                 // unique, e.g. "obsidian:view:recent-files"
  side: "left" | "right";
  title: string;
  iconSvg?: string;           // raw <svg> markup for the selector button
  el: HTMLElement;            // panel body, owned by the contributor
}
// PluginManager:
addSidebarPanel(p: SidebarPanelContribution): () => void;   // disposer removes it
readonly sidebarPanels: Store<ReadonlyArray<SidebarPanelContribution>>;
```

`core/types.ts`: `LeftPanelKind = "explorer" | "search" | (string & {})` and
`RightPanelKind = "backlinks" | "outline" | (string & {})` — dynamic ids are sidebar panel
ids. `core/workspace.ts` sanitizeState accepts any non-empty string for both fields.
Selecting/falling back is the App shell's job: an unknown id renders the default panel
(explorer / backlinks) WITHOUT mutating state, so a panel that registers later wins again.

App shell (`app/App.tsx`):
- Left side: one ribbon button per left `sidebarPanels` entry (after the built-in buttons,
  before plugin ribbon icons; `data-testid="sidebar-panel-btn-<id>"`), toggling
  `setLeftPanel(p.id)` like the built-ins.
- Right side: one extra tab per right entry in the existing `right-tabs` strip
  (`data-testid="sidebar-panel-tab-<id>"`), switching `setRightPanel(p.id)`.
- Body: when the selected id matches a registered panel, host `p.el` via an element-host
  div (`data-testid="sidebar-panel-<id>"`, same append/remove pattern as PluginElementHost).
- Panel removal while selected: App falls back to the default panel automatically on the
  next render (store update re-renders; no workspace state mutation).

### Compat: real WorkspaceLeaf for sidebar views

`compat/obsidian/workspace.ts` — view registry + two leaf kinds:
- Workspace gains `_viewRegistry: Map<string, { creator: ViewCreator; pluginId: string }>`
  and `_sideLeaves: Set<SidebarViewLeaf>` (internal).
- `Plugin.registerView(type, viewCreator)` (plugin.ts) becomes REAL: registers into the
  active Workspace shim's registry; duplicate type → console.warn + ignore. The plugin's
  unload disposer runs `detachLeavesOfType(type)` then unregisters the creator.
- `class SidebarViewLeaf` implements the WorkspaceLeaf surface (same class hierarchy or
  duck-typed twin of the active-pane facade — implementor's choice; `instanceof
  WorkspaceLeaf` is NOT required by the suite):
  - carries `side: "left" | "right"`, `_app: App` (View constructor reads it), the mounted
    `view: View | null`, panel wrapper el + panel disposer.
  - `async setViewState({ type, active? })`: unknown type → gap report (current behavior);
    known type → tear down any current view, `view = creator(this)`, `view.load()`,
    append `view.containerEl` into a `.geode-compat-view-panel` wrapper,
    `plugins.addSidebarPanel({ id: "obsidian:view:" + type, side, title:
    view.getDisplayText(), iconSvg: getIconSvg(view.getIcon()), el: wrapper })`,
    then `await view.onOpen()` (cast — it is protected), register in `_sideLeaves`.
    `active: true` → reveal (below).
  - `detach()`: fire-and-forget `view.onClose()`, `view.unload()`, panel disposer,
    remove from `_sideLeaves`. Safe to call twice.
  - `getViewState()` → `{ type: view?.getViewType() ?? "empty" }`;
    `getDisplayText()`/`getIcon()` delegate to the view; `openFile` → workspace.openFile.
- Workspace methods (signatures per API-REFERENCE-R5):
  - `getLeftLeaf(split)` / `getRightLeaf(split)` → ALWAYS a fresh non-null SidebarViewLeaf
    (calendar chains `.setViewState` without a null check).
  - `getLeavesOfType(type)` → real array of mounted SidebarViewLeaf matching; built-in
    types ("markdown" etc.) keep returning `[]` (recorded deviation).
  - `revealLeaf(leaf)` → `Promise<void>`: mounted sidebar leaf → `setLeftPanel/'s panel id
    or setRightPanel` (this also opens the sidebar); other leaves → resolved no-op.
  - `detachLeavesOfType(type)` → detach every matching leaf (replaces the warn-stub).
  - `ensureSideLeaf(type, side, opts?: { reveal?: boolean })` → existing leaf or create on
    `side` + `setViewState({type})`; reveal when asked; returns `Promise<WorkspaceLeaf>`.
  - `iterateAllLeaves(cb)` → activeLeaf facade + every mounted side leaf.
  - `splitActiveLeaf(_direction?)` (legacy) → `handle.workspace.splitActivePane("row")` and
    return a fresh active-pane facade; `getUnpinnedLeaf()` (legacy) → active-pane facade.
  - `_flushLayoutReady()` additionally `this.trigger("layout-ready")` AFTER flushing the
    onLayoutReady queue (calendar's legacy startup path).
- `view.ts`: `View` constructor sets `this.app` from the leaf's `_app` when present
  (active-pane facade also carries `_app` now); `onOpen`/`onClose` stay protected.
  Remove the "never mounted this round" comments.

### Compat: misc surface the suite's runtime paths hit

- `dom.ts`: add obsidian's `Array.prototype.first()/last()` augmentation (idempotent,
  non-enumerable) + global `activeDocument`/`activeWindow` (aliases of document/window);
  verify `createDiv("cls-string", cb)` / `createEl(tag, "cls-string")` string-info overload
  works (official DomElementInfo | string).
- `icons.ts`: export `setTooltip(el: HTMLElement, tooltip: string, options?: unknown): void`
  (sets aria-label + title); `getIconSvg` already exists.
- `ui.ts`: export `class Keymap` with static `isModEvent(evt?: UserEvent | null):
  PaneType | boolean` (ctrl/meta → "tab", else false).
- `plugin.ts` App shim getters (warn-stub once + gap report, never crash):
  `dragManager` → `{ dragFile: () => null, onDragStart: () => {} }`;
  `internalPlugins` → `{ getEnabledPluginById: () => null, getPluginById: () => null }`;
  `plugins` → `{ getPlugin: () => null, enabledPlugins: new Set<string>(), plugins: {} }`.
- `vault.ts` shim: `getConfig(key: string): unknown` (non-public API calendar/nldates call):
  `defaultViewMode` → `"source"`, `useMarkdownLinks` → `false`, anything else `undefined`;
  each key reported as gap once.
- `index.ts` re-exports the new names: `Keymap`, `setTooltip` (moment is already exported).
- `fixture.ts`: register a fixture ItemView (`type "fixture-view"`, content carries
  `data-testid="obsfixture-view-body"`), a command `fixture: open view` running the
  recent-files sequence (getLeavesOfType → getRightLeaf(false) → await setViewState →
  await revealLeaf), and a command asserting `window.moment` works
  (`window.moment().format("YYYY-MM-DD")` written into a status bar item).

### As-built deltas (post-review, all adversarially confirmed)

- **`window.app = ctx.app`** is assigned in the loader before any plugin evaluates (both
  suite P0 plugins read `window.app` directly — fixture probes it via
  `data-testid="obsfixture-app-probe"`). `window.moment ??= moment` (typed, no cast).
- moment ships as **`moment/min/moment-with-locales`** (138 locales on ONE instance —
  a separate `moment/min/locales` entry registers against a second copy under Vite's dep
  optimizer); global locale restored to `"en"` after the locale definitions run.
- dom.ts installs the FULL official global block (obsidian.d.ts lines 10-48):
  `Array.prototype.{first,last,contains,remove,shuffle,unique}`, `Array.combine`,
  `Object.{isEmpty,each}`, `Math.{clamp,square}`, `String.{isString}` +
  `String.prototype.{contains,format}`, `Number.isNumber` (recent-files' settings probe
  calls `.contains()` on arrays at redraw time).
- compat `MarkdownView extends FileView` (calendar gates on `view instanceof FileView`).
- `SidebarViewLeaf.setViewState` detaches other leaves of the same type before mounting
  (panel ids are type-keyed) and contains a rejecting `onOpen()` (console.error +
  gap + rollback detach — mirrors detach()'s onClose containment).
- `addSidebarPanel`'s disposer removes by object identity, not id.
- `WorkspaceLeaf.openFile` maps `openState.state?.mode ?? openState.mode`
  ("source"/"preview") onto `setTabMode`; anything else keeps the live default.
- `GeodePlugin.onUserEnable?()` exists on the core interface;
  `PluginManager.enable(id, { userAction: true })` (the SettingsModal toggle) calls it
  after a successful onload — the loader wrapper forwards to the obsidian instance
  (recent-files auto-mounts its view on user enable via `ensureSideLeaf`).
- App shell highlights use the FALLBACK-resolved panel id (stale persisted ids no longer
  produce a zero-selected tablist); `iconSvg` is mounted only when it parses to a single
  `<svg>` root. SettingsModal no longer imports `@compat` — `obsidianLoadReport` is
  forwarded through the app context (`app.obsidianLoadReport`, wired in main.tsx).

### Round 5 file ownership (parallel agents — do not cross)

| Agent | Files |
|---|---|
| core | core/events.ts, core/documents.ts, core/plugins.ts, core/types.ts, core/workspace.ts |
| compat-views | compat/obsidian/{workspace,view,plugin,loader,context}.ts |
| compat-misc | compat/obsidian/{dom,icons,ui,util,vault,index,fixture,gaps}.ts, global.d.ts, compat.css |
| shell | app/App.tsx, styles/app.css |

## Round 4 additions — Obsidian compat T0+T1 + shared document model

### Shared document model — `core/documents.ts`

One `DocumentHandle` per open file replaces per-EditorPane text/dirty/save state.
Fixes (R3 debt): double-dirty last-writer-wins across panes; rename rebuilding the
CM view (undo/cursor/scroll loss). Also the foundation for the compat `Editor` shim.

```ts
class DocumentManager {
  constructor(vault: Vault, events: EventBus);
  /** Load (or share) the document for a vault path. Refcounted: pair with release(). */
  acquire(path: string): Promise<DocumentHandle>;
  /** The live handle for a path, if any (sync). */
  get(path: string): DocumentHandle | null;
  /** Editor panes report the focused CM view (active markdown tab). */
  setActiveView(view: EditorView | null, path: string | null): void;
  /** The focused editor view — consumed by the compat Editor shim. */
  getActiveView(): { view: EditorView; path: string } | null;
  /** Flush every dirty document (main.tsx registers this as a workspace flusher). */
  flushAll(): Promise<void>;
}
class DocumentHandle {
  readonly path: string;          // live — retargeted in place on rename
  readonly dirty: boolean;
  getText(): string;
  /** Build a per-view EditorState seeded with the shared doc + sync glue. */
  createViewState(extensions: Extension[]): EditorState;
  /** Attach a view created from createViewState(); returns a disposer. */
  attachView(view: EditorView): () => void;
  /** Programmatic full replace (external reload / plugin writes). Does NOT mark dirty. */
  setText(text: string): void;
  flush(): Promise<void>;
  release(): void;
}
```

Behavior contract (the data-safety rules move from EditorPane into the handle):
- ONE dirty flag + ONE debounced auto-save (600ms) per file, no matter how many panes.
- All attached views stay byte-identical at all times; undo in any view never desyncs.
- Save failure restores `dirty` unless newer content is pending (retry on next flush).
- `file:renamed` retargets `path` in place — attached views are NOT rebuilt.
- `file:deleted` cancels pending saves; a deleted file is never resurrected.
- `file:external-modified` / `file:modified` → reload only when clean (in-flight save
  counts as dirty; re-check after the async read; content-equality no-op).
- EditorPane keeps per-view mode/selection/scroll; acquires on mount, releases on unmount.

### Vault adapter additions (Obsidian plugin discovery + config IO)

```ts
interface ObsidianPluginSource {
  dir: string;                    // folder name under .obsidian/plugins
  manifestJson: string;
  mainJs: string;
  stylesCss: string | null;
  dataJson: string | null;
}
// VaultAdapter:
listObsidianPlugins(): Promise<ObsidianPluginSource[]>;
/** Read a file under <vault>/.obsidian/ (e.g. "community-plugins.json",
    "plugins/<id>/data.json"). Returns null when missing. */
readConfig(relPath: string): Promise<string | null>;
/** Write under <vault>/.obsidian/, creating parent dirs. */
writeConfig(relPath: string, content: string): Promise<void>;
```

Rust commands (serde camelCase): `vault_obsidian_plugins(vault) -> Vec<ObsidianPluginSource>`,
`vault_read_config(vault, path) -> Option<String>`, `vault_write_config(vault, path, content)`.
Both config commands safe_join under `<vault>/.obsidian` only. Memory adapter: configs in an
in-session Map; `listObsidianPlugins()` returns `window.__geodeObsidianPlugins ?? []` (E2E injection).

### PluginManager extensions

```ts
type PluginSource = "builtin" | "external" | "obsidian";
register(plugin, source?, opts?: {
  enabled?: boolean;                          // overrides the localStorage enabled-set
  persistEnabled?: (enabled: boolean) => void; // replaces localStorage persistence for this record
}): Promise<void>;
unregister(id: string): void;                 // teardown without persisting enabled:false
// Element-based UI contributions (App shell hosts the elements):
addStatusBarElement(id: string, el: HTMLElement): () => void;
readonly statusBarElements: Store<ReadonlyArray<{ id: string; el: HTMLElement }>>;
addRibbonElement(id: string, el: HTMLElement): () => void;   // el carries its own click handler
readonly ribbonItems: Store<ReadonlyArray<{ id: string; el: HTMLElement }>>;
// Plugin settings sections (SettingsModal renders mount/unmount into a host div):
interface PluginSettingsSection { id: string; pluginId: string; name: string;
  mount(container: HTMLElement): void; unmount(): void; }
addSettingsSection(s: PluginSettingsSection): () => void;
readonly settingsSections: Store<ReadonlyArray<PluginSettingsSection>>;
```

### Command availability

`Command.available?: () => boolean` — palette hides and hotkeys skip commands whose
`available()` returns false (used by compat editorCallback variants).

### Compat layer — `src/compat/obsidian/`

`loadObsidianPlugins(app: Omit<AppHandle, "ui"> & { plugins: PluginManager }, vault: Vault): Promise<void>` (from `@compat/obsidian/loader`)
is idempotent like `loadExternal`: unloads previously loaded obsidian records first.
Calibrated signatures live in `.calibration/API-REFERENCE.md` (regenerate per
docs/OBSIDIAN-COMPAT.md); implement EXACTLY against it, never from memory.
Internal layout is the implementor's choice within `src/compat/`; fixed points:
- `index.ts` exports the full `require("obsidian")` module surface.
- `loader.ts`: discover → validate manifest (missing id/name/version rejects; other gaps warn;
  minAppVersion > apiVersion warns, never blocks) → evaluate main.js as CommonJS
  (`exports.default ?? module.exports`, must be a constructor) → `new Ctor(appShim, manifest)`
  → wrap as a GeodePlugin record `register(wrapper, "obsidian", { enabled, persistEnabled })`.
  Enabled state mirrors `.obsidian/community-plugins.json` (flat id array; preserve unknown ids
  on write). styles.css injected per plugin on enable, removed on disable.
- require map: `obsidian` → shim; `@codemirror/state|view|language|commands|search|autocomplete`,
  `@lezer/highlight` → the HOST instances (instanceof must work); anything else throws a clear
  error which the loader records as that plugin's failure reason (shown in settings).
- `dom.ts`: global prototype augmentation (createEl & friends) applied idempotently before any
  plugin code runs. Only compat may USE these helpers even though types are global.
- TFile/TFolder identity: ONE canonical instance per path, registry synced from vault events;
  rename mutates the instance and fires per-descendant rename(oldPath). Shim exports the real
  constructors (plugins use `instanceof TFile`).
- `apiVersion = "1.5.0"`; `requireApiVersion` does a semver compare against it.
- Suite-driven minimal `Editor` subset (T1.5) over `documents.getActiveView()`:
  getValue/setValue/getSelection/somethingSelected/replaceSelection/getCursor/setCursor/
  setSelection/replaceRange/getLine/lineCount/lastLine/getRange/posToOffset/offsetToPos/
  focus/hasFocus. editorCallback/editorCheckCallback map to Command.available.
- Out-of-tier APIs (registerView, MarkdownRenderer, moment, …) are warn-stubs: console.warn
  once + recorded in the loader's gap report, never a crash. Browser fixture: `?obsfixture=1`
  makes the loader register the built-in test plugin from `compat/obsidian/fixture.ts`.

### Bootstrap wiring (main.tsx / App.tsx)

`DocumentManager` is created in bootstrap and exposed as `app.documents` (AppHandle + GeodeApp);
its `flushAll` is registered as a workspace flusher. After `plugins.loadExternal(vault)` the shell
calls `loadObsidianPlugins(app, vault)`; the reload-plugins command re-runs both.

## Round 3 additions

- **Pane tree** replaces the flat tab list. `WorkspaceState.root: PaneNode` + `activePaneId`;
  `PaneNode = PaneLeaf { id, tabs, activeTabId } | PaneSplit { id, direction: "row"|"column", children, sizes }`.
  Persisted v1 states (flat `tabs`) migrate automatically to a single leaf.
- Tab-level Workspace methods (`openFile`, `closeTab`, `setActiveTab`, `setTabMode`, the toggles)
  keep their signatures and target the **active pane**; `openFile` additionally accepts `{ paneId }`.
- New pane methods: `setActivePane(id)`, `splitActivePane(direction)` (duplicates the active tab,
  Obsidian-style), `moveTab(tabId, targetPaneId, index?)`, `moveTabToEdge(tabId, targetPaneId, edge)`,
  `setSplitSizes(splitId, sizes)`, `focusAdjacentPane(±1)`, `getActivePane()`, `getPanes()`.
- Pure helpers exported from `@core/workspace`: `flattenLeaves`, `findLeaf`, `findTabLeaf`,
  `allTabs(root)`, `findActiveTab(state)` — features derive "the active tab" via `findActiveTab`,
  never by scanning a tabs array.
- Tree invariants (enforced by `normalize`): empty leaves collapse (except a lone root leaf),
  single-child splits unwrap, same-direction nested splits merge, `sizes` stay normalized with
  a 0.12 minimum fraction.
- Commands: `app:split-right` (Ctrl+\), `app:split-down` (Ctrl+Shift+\),
  `app:focus-next-pane` / `app:focus-previous-pane` (Ctrl+Alt+←/→).
- The same file may be open in several panes at once; editors reconcile via `file:modified`
  (reload only when not dirty and content actually differs — same rule as external changes).

## Round 2 additions

- `ViewMode` is now `"live" | "source" | "preview"` ("live" = Obsidian-style live preview, the default; old persisted "edit" migrates to "live"). `workspace.toggleActiveTabMode()` toggles live↔preview (Ctrl+E); `workspace.toggleActiveSourceMode()` toggles live↔source (Ctrl+Shift+E).
- Right sidebar is tabbed: `WorkspaceState.rightPanel: "backlinks" | "outline"`, switched via `workspace.setRightPanel()`. New component contract: `features/outline/OutlinePanel.tsx` exports `OutlinePanel` (no props).
- Sidebars are resizable: `leftWidth`/`rightWidth` in state, `workspace.setSidebarWidth(side, px)`.
- File watching: `VaultAdapter.startWatch(onChange)` — Tauri impl listens to the backend event `vault:fs-change` (Vec<String> of vault-relative changed paths) and the Rust command `vault_watch(vault)` starts/replaces a debounced recursive watcher. `Vault.load()` wires this automatically and emits: `file:external-modified` (open files decide whether to reload — reload ONLY if not dirty), `file:created`/`file:deleted`, `vault:external-changed`.
- Frontmatter: `parseNote` extracts a leading YAML block into `NoteMetadata.frontmatter` (`fields`, `from`, `to`), plus `aliases` (which now participate in `resolveLink`) and frontmatter tags (merged into `tags`). Editors should render/hide the frontmatter region based on `parseFrontmatter(content)` from `@core/metadata`.
- External plugins: `VaultAdapter.listPluginFiles()` returns `{name, content}` for `<vault>/.geode/plugins/*.js`; `PluginManager.loadExternal(vault)` evaluates and registers them (idempotent: unloads previously loaded external plugins first). Rust command: `vault_plugin_files(vault)`.

## Verification every agent must run before finishing

```
npx tsc --noEmit     # must pass with zero errors
```
Do not edit files outside your assigned folder(s). Do not add npm dependencies.
Already available deps: @codemirror/* (state, view, commands, language, lang-markdown,
language-data, autocomplete, search), @lezer/highlight, markdown-it, d3-force, @tauri-apps/api & plugin-dialog.
