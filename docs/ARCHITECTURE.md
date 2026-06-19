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

## Round 95 additions — 代码块复制按钮 code-fence copy button（候选池第六梯队 ㊶ 续续 v1）【As-built v0.92】

> **状态：As-built（v0.92 交付，2026-06-19）。** Obsidian 阅读视图代码块 hover→「Copy」按钮（右上角，复制代码）。**post-render hydration pass**（镜像 hydrateEmbeds）——**markdown.ts 完全不碰**（r26-bytes 0），按钮注入已渲染 DOM。reading view only（live preview 延期）。

**契约（无冻结接口改动）**：
- 新 `features/editor/codeCopy.ts`：`hydrateCodeCopy(root)`——`querySelectorAll("pre")` 找每个 `pre>code`、加 hover Copy 按钮（`.code-copy-button`，绝对定位右上、`pre:hover`/`:focus-visible` opacity 0→1）；点击复制 `code.textContent`（trim 单尾换行）+ 瞬态「Copied」1500ms + `.catch` 吞不安全上下文；幂等守卫（已带按钮的 pre 跳过）。**关键排除（对抗评审根因）**：`pre.closest(".geode-mermaid, .geode-query")` 跳过 mermaid/query 占位符的 source-fallback pre。
- `features/editor/EditorPane.tsx`：hydration effect（`[app,tab.mode,handle,previewHtml]`）在 `hydrateEmbeds` 后调 `hydrateCodeCopy(el)`。
- editor.css：`.code-copy-button` 规则 + `.preview-content pre{position:relative}`（锚定按钮，CSS 不影响 HTML 字节）。dict.views.ts `editor.copyCode`/`editor.copied`×en/zh。main.tsx `__geodeCodeCopy(html)` probe 返按钮数。

**对抗评审（reviewer 6 维各独立 + skeptic verify，核 DOM 生命周期/复制正确性/匹配精度/事件协调/XSS/分层）→ 1 确认 MAJOR（已修）+ 1 minor（记 v1 gap）：**
- **MAJOR（根因·已修）= mermaid/query source-fallback pre 误加按钮**：markdown.ts 把 mermaid/query fence 渲染成 `<div class="geode-mermaid"><pre class="geode-mermaid-source"><code>${src}</code></pre></div>`——**source pre 在 hydrateCodeCopy 同步跑时仍在 DOM**（async mermaid/query 渲染尚未 swap）→ 误给图表源加 Copy 按钮（瞬态闪现；若 mermaid 加载失败/渲染 error/query throw 则**永久**残留、复制的是图表源码）。**测试遮蔽=fixture 用了不真实的空 `<div class="geode-mermaid">`（无内层 pre）→ 平凡返 0**。**修=`pre.closest(".geode-mermaid, .geode-query")` 排除 + fixture 改真实输出 `div>pre.geode-*-source>code` 断言 0 + 加真 mermaid+js 渲染断言（仅 js 块得按钮=1）**。
- **minor（v1 gap，记录不修）= note embed 内代码块无按钮**：`hydrateNote` 经 `await vault.read` 异步注入 embed HTML，在同步 hydrateCodeCopy 之后 → 转写笔记内的代码块拿不到按钮（false-negative，Obsidian 有）。同根因（hydrateCodeCopy 单次同步先于 async embed/mermaid/query settle）；v1 可接受，未来轮可在 embed hydration resolve 后重跑。
- **PASS 维度**：setTimeout 在 detached btn 不抛、closures GC 安全；textContent 重组顺序 + 实体解码正确（Geode 阅读视图不做高亮、code 纯文本）；inline code（无 pre）排除；button `e.stopPropagation` 阻 onPreviewClick + 真 `<button type=button>`+aria-label 键盘可达；label 静态 tr()、textContent 读非写=无 XSS；codeCopy 仅 import @core/i18n（features→core 合法）；`--bg-secondary` 无基定义→`var(--bg-secondary, var(--code-bg))` 回退 load-bearing。

**验证（As-built）**：typecheck 0 · `r95-e2e` **12/12**（probe 匹配 + 真 clipboard 写[trim 尾换行] + Copied 反馈 + mermaid/query source 排除 + 真 mermaid+js 渲染仅 1 按钮）· `r95-probe` **8/8** 真 WKWebView · **r26-bytes 0 violations**（markdown.ts 未碰）· 回归 r26(12)/r25(17)/r75(16)/r55(15)/r94(14) 绿 · release build exit 0 · 简化门 clean（hydrateCodeCopy 2 用点[effect+probe]、label/code 闭包捕获不内联、无 ≥8 行重复）。

**v1 已知延期**：live preview 代码块复制（CM 装饰）· note embed 内代码块按钮（async 时序 gap）· hover preview/slides/export 代码块按钮 · 语言标签显示 · blockquote 复制（Obsidian 社区请求非核心）。

## Round 94 additions — Show inline title + Show ribbon（候选池第六梯队 ㊺ 续续 v1）【As-built v0.91】

> **状态：As-built（v0.91 交付，2026-06-19）。** Obsidian Appearance/Interface 两 toggle：**Show inline title**（笔记顶部把文件名作 H1 显示，默认 ON=Obsidian）+ **Show ribbon**（左侧主功能区显隐，默认 ON）。**纯前端 view-only**（不写 .md、不动 markdown.ts）。inline title **display-only**——编辑→重命名延期（避 data-safety 写路径）。镜像 R85/R88 appearance toggle 范式。

**契约（无冻结接口改动）**：
- `core/appearance.ts`：`showInlineTitle` Store（默认 true）+ `showRibbon` Store（默认 true）+ setter（persist，镜像 `showLineNumbers`）。
- `features/editor/EditorPane.tsx`：`useStore(showInlineTitle)` → `inlineTitleEl`（`<div className="inline-title">{tab.title}</div>`，仅 `inlineTitleOn && tab.filePath`）渲染在**两处**：live/source body 片段首（cm-host **同级上方**，非 CM 内）+ reading view scroller 首子（PropertiesPanel 之前，**随笔记滚动**）。空/错/loading 不渲染。text=`tab.title`（rename 经 workspace.handleRenamed 保鲜，与 editor-header 同源）。**React 文本子节点=转义无 XSS**。
- `app/App.tsx`：`useStore(showRibbon)` → `{ribbonVisible && (<nav className="ribbon …">…</nav>)}`（OFF 卸载 nav；设置经 Ctrl+,/palette 仍可达，无锁死）。
- `features/settings/SettingsModal.tsx`：2 toggle。dict.views.ts 2 键+2 desc×en/zh。editor.css `.inline-title`（`max-width:var(--readable-line-width)` 居中 + `var(--text-normal)`，与内容列对齐）。main.tsx `setToggles` 并入**既有** `__geodeAppearance` probe（非新 host）。

**对抗评审（reviewer 6 维各独立 + skeptic verify，核 默认翻转回归/XSS/ribbon 锁死+布局/CSS/反应式生命周期/分层）→ 0 confirmed critical/major/minor/nit（全维证伪）：**
- **默认翻转证伪**：tab.title 经 `handleRenamed`(workspace.ts:1011/1015) + `file:renamed` 事件保鲜不 stale；reveal/flash 用 `scrollIntoView({block:"center"})` 实时重算、新增顶部高度不破；scroll round-trip 一致存恢复。新笔记→"Untitled"（对齐 Obsidian）。
- **XSS 证伪**：`{tab.title}` React 文本子节点转义（非 dangerouslySetInnerHTML）；`<img>`/反引号/`&`/CJK/超长 渲染为惰性文本（word-break+max-width）；永不写盘。
- **ribbon 锁死证伪**：`app:open-settings`(Mod+,)/`app:command-palette`(Mod+P) 全局命令独立于 ribbon；`.app-body` flex 无 `:first-child`/ribbon 依赖选择器、卸载 nav 仅塌列；plugin ribbon items store 保留 els、重挂回贴。
- **反应式生命周期证伪（关键）**：片段子节点位置稳定 `[inlineTitleEl, cm-host, portal]`——index 0 null↔div 切换**不重挂** index 1 的无 key cm-host → CM view（handle-keyed effect 建、挂 hostRef）保留、选区/滚动/undo 存活；reading 同理 previewContentRef(index 2) 稳定不重渲。
- **CSS/a11y/分层证伪**：`--text-normal`/`--readable-line-width` 均存在、无硬编码色；cm-host `flex:1;min-height:0` 同级 title 不破局；inline title 用 `<div>` 非 `<h1>`（对齐 Obsidian + 避 onPreviewClick 的 `closest("h1..h6")` fold 分支误命中）；App/EditorPane/main→@core/appearance app/features→core 合法。

**验证（As-built）**：typecheck 0 · `r94-e2e` **14/14**（inline title live/source/reading + toggle off→消失→on + ribbon 显→隐→复 + 持久化）· `r94-probe` **5/5** 真 WKWebView · 回归 r23(22)/r25(17)/r26(12)/r30(25)/r50(15)/r88(13)/r74(23) 绿 · release build exit 0 · 不碰 markdown.ts（r26-bytes 不涉及）· 简化门 clean（inlineTitleEl 2 用点不内联、两 toggle 块结构似而非 token 同[合并需新抽象]、setToggles 并入既有 probe）。

**v1 已知延期（reviewer 记 3 by-design）**：live/source inline title **不随内容滚动**（CM scroller 外，Obsidian 随滚——未来轮带进 scroller）· inline title **编辑→重命名**（contenteditable→renameWithLinkUpdate）· block/不可定位 reveal 近似落点因 title 高度微移（已是「approximate by design」、可忽略）· title↔内容双顶 padding（纯观感）。

## Round 93 additions — Explorer 右键上下文菜单补全（候选池第六梯队 ㊽ 续续 v1）【As-built v0.90】

> **状态：As-built（v0.90 交付，2026-06-19）。** **前置门 gate① 揭露 ㊽ 描述失准**：Explorer **早已有**行右键菜单（New note here / New folder here / Rename / Delete-trash）——R93 非从零，而是**朝 Obsidian 平价扩展**（㉒–㉜ 同类失准已制度化两道门，本轮再次成功拦截「重建已有菜单」）。本轮**加性**补：文件项 **Open in new tab / Open to the right / Make a copy** + **空白区根菜单**（New note / New folder at root）+ R81 两轴 clamp + per-item testid。全部复用既有 vetted 路径（openFile/splitActivePane/createBinary/trash/renameWithLinkUpdate），**零新依赖**。**Reveal in Finder / Open in new window 延期**（需 Tauri opener / pop-out = 硬边界 #5）。

**契约（无冻结接口改动；MenuState 是 Explorer 内部类型）**：
- `features/explorer/Explorer.tsx`：`MenuState.node: VaultNode | null`（null = 空白区根菜单）。新 handler `openInNewTab`（`workspace.openFile(path,{newTab:true})`）/ `openToRight`（`splitActivePane("row")`→`openFile(path,{paneId})`，**null→newTab 兜底**[graph/无活动 pane]）/ `makeCopy`（**R42 flushAll → readBinary → createBinary at uniquePath(parent,basename,ext)**，byte-identical，md 副本 openFile；源永不写）。行 `onContextMenu` 加 `e.stopPropagation()`（不冒泡到容器根菜单 handler）；`.explorer-tree` 容器加 `onContextMenu`→根菜单。菜单 render `menu.node === null ? 根 : ((node)=>(…))(menu.node)` **IIFE 收窄**（闭包不保留 `=== null ?` 三元收窄 → 必须捕获非空 const，否则满地 `menu.node!`）。
- `core/vault.ts`（**对抗评审修根因**）：MemoryVaultAdapter `readFile` 缺二进制回退 → createBinary 写的 md 在浏览器模式不可文本读（真 fs 无此分裂）→ **加对称回退**（`files` 缺则 decode `binaryFiles`）；+ **两 map 互斥**（`writeFile` 删 binary twin / `createFile` 碰撞检查含 binaryFiles）防 readBinary 读到陈旧字节；+ `uniquePath` ext="" 不加尾点（`README` 不变 `README.`）。
- `main.tsx`：`__geodeExplorerCopy(path)` always-on probe（uniquePath+readBinary+createBinary+逐字节比对）。dict.panels.ts 3 键 × en/zh。

**对抗评审（reviewer 6 维各独立 + skeptic verify，核 data-safety 写路径/readFile 回退/事件协调/pane split/IIFE 收窄/分层）→ 0 confirmed critical/major + 3 minor（全确认已修）+ 1 注释（已订正）：**
- **Finding 1（minor，根因·已修）**：MemoryVaultAdapter `files`/`binaryFiles` 非互斥——makeCopy(createBinary→binaryFiles) 后编辑+存(writeFile→files) → 两 map 并存、`readFile`(files-first 新) 与 `readBinary`(binaryFiles-first 旧) 分歧 → 再 copy 读到陈旧字节（违 R93 自身注释引的「one file」不变式）。**修=writeFile 删 binary twin + createFile 碰撞含 binaryFiles**（一路一表示=真 fs 平价）。**测试遮蔽=r93-e2e 从不 edit-then-recopy → 补「编辑副本→再 copy→断言新内容非陈旧」**。
- **Finding 2（minor，已修）**：无扩展名文件（README/LICENSE）`uniquePath(…,"")` 产 `README.` 尾点（mac 怪名/win 静默撞源）。**修=uniquePath ext="" 略点**。补无扩展名 copy e2e（`LICENSE 1` 无点）。
- **Finding 3（minor，已修）**：`flushAll()` 在 makeCopy try 外 → flushAll reject = unhandled。**修=移进 try**（对齐 deleteNode）。
- **注释订正**：「createBinary assertSafeRelPath guarded」失准（Vault.createBinary 不调它，仅 create/createFolder 调）→ 改述「dest 由源 path 派生天然在库内 + Rust safe_join/create_new 兜底」。
- **PASS 维度**：desktop 写路径（`vault_write_binary` 用 `create_new(true)`→dest 撞=硬错非覆盖、源只读、flushAll 先行）；stopPropagation 仅 contextmenu（不碰 drag/click）；空白区 handler 仅真空白触发（行恒 stop）；splitActivePane null 兜底 + openFile retarget 新 pane 无孤儿 dup；非 md「Open in new tab」与既有 activateNode 一致（非 R93 回归）；IIFE 分区干净；分层合规。

**验证（As-built）**：typecheck 0 · `r93-e2e` **22/22**（文件/文件夹/根菜单项 + make-copy 创建+同内容+源不变 + **编辑副本再 copy 非陈旧[Finding 1]** + **无扩展名无尾点[Finding 2]** + open-in-new-tab + open-to-right 分 pane）· `r93-probe` **9/9** 真 fs（byte-identical copy + 唯一命名 + 子文件夹 + 源文本可读）· 回归 r28(23)/r91(10)/r24(12)/r23(22)/r89(16) 绿 · release build exit 0 · 不碰 markdown.ts（r26-bytes 不涉及）· 简化门 clean（3 handler 各单站不同体非重复、按钮块结构似而非 token 同[合并需新抽象 + 碰 out-of-diff]、IIFE/vault 修/probe 受保护）。

**v1 已知延期**：Move to…（需文件夹 picker modal）· Reveal in Finder / Open in default app（Tauri opener=硬边界 #5）· Open in new window（pop-out=硬边界）· Bookmark 项 · 多选批量操作。

## Round 92 additions — Tab 缩进设置：Indent using tabs + Tab indent size（候选池第六梯队 ㊶ 续续 v1）【As-built v0.89】

> **状态：As-built（v0.89 交付，2026-06-19）。** Obsidian Editor 两设置：「Indent using tabs」（默认 ON → Tab 插制表符；OFF → 空格）+「Tab indent size」（默认 4 = 一级缩进宽度）。**纯前端 view/edit 配置**（不写 .md、不动 markdown.ts/改写引擎；只改 Tab 键插入的字符）。**默认对齐 Obsidian = 故意翻转**（Geode 此前用 CM 默认 2 空格；先例 R87 翻转 breaks）——**不重写任何已存 .md**，仅未来 Tab 按键产出不同字符。CM 翻译走 Compartment 反应式 reconfigure，**镜像 R88 lineNumberCompartment**。

**契约（冻结接口）**：
- `core/appearance.ts`（**保持 core 纯净、不 import @codemirror**）：`tabIndentSize` Store<number>（默认 4，`readTabSize` 缺键→4）+ `indentUsingTabs` Store<boolean>（默认 true）+ `clampTabSize(n)`（1–8 整数 round，非有限→4，导出供 setter/reader/probe 共用）+ `setTabIndentSize`/`setIndentUsingTabs`（persist；size 存 `String(1..8)`）。
- `features/editor/cmExtensions.ts`（CM 翻译属编辑器 feature，与 R88 `lineNumbers()` 同址）：`indentUnitString(size, useTabs)` = `useTabs ? "\t" : " ".repeat(size)`（**单一真值**，2 调用点）；`indentExtensions(size, useTabs)` = `[EditorState.tabSize.of(size), indentUnit.of(indentUnitString(...))]`（2 调用点：seed + EditorPane effect）。`buildEditorExtensions` opts **additive** 加 `indentCompartment: Compartment`，seed `indentExtensions(tabIndentSize.get(), indentUsingTabs.get())`。
- `features/editor/EditorPane.tsx`：`indentCompartmentRef` 在 build effect 创建、传入 buildEditorExtensions、cleanup 置 null（镜像 lineNumberCompartmentRef 生命周期）；反应式 effect `compartment.reconfigure(indentExtensions(indentSize, useTabs))`，deps `[indentSize, useTabs]`。
- `features/settings/SettingsModal.tsx`：toggle `settings-indent-tabs-toggle` + segmented `settings-tabsize-{2,4,8}`。dict.views.ts 4 键 × en/zh。
- `main.tsx`：always-on probe `__geodeIndentConfig(size, useTabs)`（经真 setter 设置 → 返 `{size, useTabs, unit}`，证 clamp+persist+pure 派生于真 WKWebView）。

**对抗评审（reviewer 6 维各独立 + skeptic verify，核 CM facet 语义/compartment 生命周期/data-safety 写路径/默认翻转/clamp/分层）→ 0 confirmed critical/major/minor/nit：**
- **CM facet 语义证伪**：核 `@codemirror/commands` 源——`indentWithTab={key:"Tab",run:indentMore,shift:indentLess}`；`indentMore` 在 line.from 插 `state.facet(indentUnit)`；`indentLess` 读 `state.tabSize`+`getIndentUnit`。`indentExtensions` 同时供 tabSize+indentUnit 一致（`getIndentUnit("\t")=tabSize=size` 与 `getIndentUnit(" ".repeat(size))=size` 一致）→ Shift-Tab/选区缩进/Enter 续行皆按一单位、无 tab/space 错配。无重复 facet provider（无 basicSetup）。
- **compartment 生命周期证伪**：R88 忠实克隆。build effect 先于反应式 effect 声明 → 同 commit 重建时 ref 已同步置位、反应式 effect 读到不 stale；preview 模式（无 CM view）改设置=no-op，下次 build 用 `.get()` seed 重拾不丢。
- **data-safety 证伪**：`documents.ts` updateListener `if(!update.docChanged) return` 早退；`compartment.reconfigure` 是 effects-only 事务（无 changes/docChanged）→ 切设置永不 dirty/不调度 save/不污染他 pane buffer = 零字节重写已存内容。Tab 按键带 `userEvent:"input.indent"`+docChanged 走常规路径、只在新按键加单位、绝不重排已存字节。markdown.ts 未碰。r24(autosave/flush)12/12 回归绿。
- **默认翻转证伪**：仅改未来 Tab 产出字节、不改已存内容。**关键：reviewer 漏判 r52 仍绿、实跑抓到真回归**——live `editor:indent` 命令对配置后 view 现插 `\t`（r52:75 旧断言 2 空格）→ **修=r52 显式 pin `__geodeIndentConfig(2,false)` 后断言（确定性、解耦 ambient 默认）+ 加 tabs-on 插 `\t` 集成断言（12/12）**。全库扫：唯 r52 受影响（r44/r57 是硬编码解析器输入、r74 仅 no-mutation）。
- **clamp/分层证伪**：clampTabSize NaN/∞→4、0→1、99→8、round 非整；appearance.ts 不 import @codemirror（core 纯）；indentExtensions 属 features/editor；main.tsx(bootstrap)→@features/editor app→features 合法；buildEditorExtensions 新字段 additive、唯一消费者 EditorPane。

**验证（As-built）**：typecheck 0 · `r92-e2e` **21/21**（**全链**：set 设置→反应式 reconfigure→真 Tab 按键→断言插入字符；clamp；persist；设置 UI 反应式回灌）· `r92-probe` **9/9** 真 WKWebView · `r52-e2e` **12/12**（修回归 + 加 tabs-on 集成）· 回归 r88(13)/r50(15)/r29-folds(19)/r35(25)/r87(11)/r24(12)/r91(10) · release build exit 0 · 不碰 markdown.ts（r26-bytes 不涉及）· 简化门 clean（indentUnitString/indentExtensions 各 2 调用点不可删、R92 effect 与 R88 effect 故意非 token 相同[不同 facet 不合并]、无 ≥8 行内重复）。

**已知偏差（非缺陷，记录）**：`__geodeEdit.indent` 纯逻辑 probe（r52 A 段，`runEdit` 裸 EditorState 无 indentUnit facet）**故意配置无关**（确定性命令逻辑测试，CM 默认 2 空格）——与配置后 live `editor:indent` 现分流（live 用配置单位）；二者皆有意，live 配置路径由 r92-e2e 全覆盖。**v1 已知延期**：自由数字输入（v1 用 segmented 2/4/8）/ 缩进参考线 / 行号点击选行（R88 延期项）。

## Round 91 additions — Explorer 文件树排序（候选池第六梯队 ㊽ 续 v1）【As-built v0.88】

> **状态：As-built（v0.88 交付，2026-06-16）。** Obsidian Explorer「File name A→Z / Z→A」排序。**纯展示层**（只重排渲染顺序、不动 vault 存储序/不写盘）。默认 name-asc = vault.ts sortChildren 存储序 = 零回归。时间排序（mtime/ctime）延期（需 adapter stat=跨 Rust）。

**契约（冻结接口）**：
- `core/vault.ts`：`ExplorerSortKey = "name-asc" | "name-desc"` + 新纯函数 `sortTreeNodes<N extends {kind,name}>(nodes, sortKey): N[]`——**folders 永远在前**（kind 子句不受方向影响）；组内 `dir * name.localeCompare(b.name, undefined, {sensitivity:"base", numeric:true})`（dir=name-desc?−1:1）。**返回新数组 `[...nodes].sort`（不 mutate 输入）**——vault 存储序不被污染（flattenFiles/getMarkdownFiles/索引等消费者读到的仍是存储序）。name-asc 的 comparator 与既有 `sortChildren`（vault 存储序）**逐字符相同** → 默认显示序逐项等同存储序 = 零回归。probe `__geodeSortTree`。
- `core/appearance.ts`：`explorerSort` Store（默认 "name-asc"，readExplorerSort 坏值/缺键→name-asc）+ `setExplorerSort`（localStorage，name-asc→removeItem）。`import type ExplorerSortKey from "./vault"`（编译期擦除、无运行时循环；vault 不 import appearance）。
- `Explorer.tsx`：`flattenVisible(root, expanded, sortKey)` 每层 `sortTreeNodes(folder.children, sortKey)` 后遍历（**唯一显示路径**，collectFolderPaths/碰撞检测是顺序无关用途不过 sort）；rows memo `useStore(explorerSort)` + 入 deps（排序改即重排、不重建 tree）；toolbar sort toggle 按钮（`explorer-sort-toggle`，asc↔desc，icon arrow-down-up[新增 lucide 图标]）。

**对抗评审（reviewer 6 维各独立 + skeptic verify，深挖 name-asc 等同存储序 + 是否 mutate folder.children）→ 0 confirmed critical/major/minor/nit：**
- **零回归证伪（核心）**：sortTreeNodes(name-asc) 的 folders-first 子句 + name 子句与 sortChildren **逐字符相同**；输入 `folder.children` 已是 sortChildren 排过的存储序，`sensitivity:"base"` 相等元素 comparator 返 0 → 稳定排序保留输入序 = 存储序 → 默认 name-asc 显示序逐项等同存储序、零回归。
- **不 mutate 证伪**：`[...nodes].sort` 浅拷贝再排拷贝，原 folder.children 不动；flattenVisible 渲染用返回值非原数组 → 其他消费者读存储序无污染。
- **证伪其余**：desc 时 dir 只乘 name 子句、kind 子句不变 → folders 仍在前（对齐 Obsidian Z→A）；numeric 自然序（n2<n10）+ case-insensitive(base)+CJK 正确；虚拟化按 rows.length / 键盘按 rows 顺序 / expanded Set 按 path 不受 sort 影响，sort 改 rows 顺序长度不变、scrollTop 保留指向不同行（可接受 UX 不崩）；r28(拖拽/移动)回归绿；分层无环；纯前端不写 .md；arrow-down-up 4 段 path 合法 SVG。

**验证（As-built）**：typecheck 0 · `r91-e2e` **10/10**（sortTreeNodes 4 真值表[asc folders-first/desc/numeric/case] + 工具栏 toggle 重排 tree DOM[asc默认/desc/复位] + 持久化双向）· `r91-probe` **5/5** 真 WKWebView · 回归 r28(23) · 不碰 markdown.ts（r26-bytes 不涉及）· 简化门 clean（sortChildren/sortTreeNodes comparator 仅~2 行重叠、形态不同[mutate 递归固定 asc vs 纯单层带 dir]，统一=加抽象，不动）。

**v1 已知延期**：修改/创建时间排序（需扩 adapter stat=跨 Rust，同 R80）· 自定义手动排序 · 右键排序菜单（v1 用 toolbar toggle）。

## Round 90 additions — 图谱分组着色（color groups）（候选池第六梯队 ㊵ 续续 v1）【As-built v0.87】

> **状态：As-built（v0.87 交付，2026-06-16）。** Obsidian 图谱 Groups：每组 = 一个查询 + 一个颜色，匹配的节点染该色。纯客户端着色（不动 getGraph 数据形状/不写盘/不动 markdown.ts）。默认无组 → 每个 resolved 节点保持 accent = 零回归。

**契约（冻结接口）**：
- `graphPrefs.ts`：`GraphGroup = { query: string; color: string }`；`GraphPrefs.groups: GraphGroup[]`，`DEFAULT_PREFS.groups = Object.freeze([])`（零回归）。`parseGraphPrefs` 加 groups 校验：过滤非法项（query 须 string + color 须 `/^#[0-9a-fA-F]{6}$/`）+ cap 24（防 corrupt blob 炸 UI/draw）。新纯函数 `nodeGroupColor(node{id,label}, groups, defaultColor): string`——**first-match**：`path:<folder>` 匹配 `node.id.startsWith(folder+"/")`（尾斜杠 strip、空 folder 跳过）/ 裸文本 case-insensitive 子串匹配 `node.label`（basename）/ 空 query 跳过 / 无匹配→defaultColor。`includes`/`startsWith` 纯字符串（query 含正则元字符当字面）。probe `__geodeGraphGroupColor`。
- `GraphView.tsx` draw：resolved 节点从单批次（全 accent）改成**按 color 分批**（`Map<color,{normal,dim}>`，每节点 `groups.length ? nodeGroupColor(n,groups,p.accent) : p.accent`，每 color 一个 `fill(normal)@α1 + fill(dim)@0.16`）。**groups=[] 时单 color batch=accent → 与旧 fillNormal/fillDim 逐像素等价**。unresolved 仍 hollow（v1 不上色）。`setGroups`（整数组替换 + 镜像 `s.prefs.groups` + requestDraw——只改色不改节点集，**不 rebuild**，对比 setFilter 需 rebuild）。设置面板「Groups」section：map groups 渲染 `<input type=color>` + query input + remove，+ add 按钮（受控 value，key=index 删中间项不错位因受控）。
- graph.css `.graph-group-*`（color 走 CSS 变量，hex 用户值进 canvas fillStyle 非 CSS 选择器无注入面）；i18n graph.groups/group*。

**对抗评审（reviewer 6 维各独立 + skeptic verify，深挖 draw 像素等价 + React key=index）→ 0 confirmed critical/major/minor/nit：**
- **draw 像素等价证伪（核心）**：groups=[] 时 `nodeGroupColor` 短路不调（`groups.length`），单 color=accent batch，normal@α1 + dim@0.16 + fillStyle=accent 与旧三要素逐一致 → **逐像素等价零回归**；简化门合并 moveTo/arc（`let path` 提升、resolved 进 colorBatch / unresolved 进 hollow 分流正确）无 bug。
- **匹配/镜像/key 证伪**：path: 不误匹配 `ProjectsX`（startsWith folder+"/"）；node.id=resolved 完整路径（nodeGroupColor 仅对 resolved 调）；first-match=数组序；setGroups 镜像 `s.prefs.groups`（draw 空 deps 闭包读最新）+ requestDraw 不 rebuild 正确；settings input **受控**（value=state）→ key=index 删中间项不 stale；坏 hex 经 HEX_RE 在 parse 挡 localStorage 注入、`<input type=color>` 只产合法 hex → fillStyle 恒合法；纯前端 view-only；r78/r84 回归绿。
- **已知非缺陷取舍（留痕）**：① hovered/anchor 节点保留 accent/accentHover 不取 group 色（hover 高亮优先，对齐 Obsidian）；② 多 group 重叠 + dim(hover 瞬态) 时亚像素 z-order 差异（collide force radius+5 保证静止不重叠不可见）。

**验证（As-built）**：typecheck 0 · `r90-e2e` **17/17**（nodeGroupColor 7 真值表[path:/text/first-match/空/非误匹配] + parseGraphPrefs groups 向后兼容 4[旧 blob []/有效保留/非法丢弃/corrupt] + 设置 Groups 列表 add/edit-query/remove+持久化）· `r90-probe` **8/8** 真 WKWebView · 回归 r78(16)/r84(17) · 不碰 markdown.ts（r26-bytes 不涉及）· 简化门 1 处合并（merge 重复 moveTo/arc）。

**v1 已知延期**：unresolved 节点上色 · 连线着色 · `tag:`/复杂 search 查询匹配（需 GraphNode 带 tags + search.ts 解析器，v1 仅 path:/裸文本）· 局部图谱组继承全局。

## Round 89 additions — 新文件默认位置设置（候选池第六梯队 ㊽ v1）【As-built v0.86】

> **状态：As-built（v0.86 交付，2026-06-16）。** Obsidian「Default location for new notes」三态：vault 根 / 与当前文件同文件夹 / 指定文件夹。默认 root = 既有 `uniquePath("",…)` 行为 → 零回归。写 .md 经既有 vetted create 路径（assertSafeRelPath + Rust safe_join）。

**契约（冻结接口）**：
- 新 `core/newNote.ts`（core 仅 import store + vault，无环）：`newNoteLocation` Store（`NewNoteLocation = "root"|"current"|"folder"`，默认 "root"=零回归，readLocation 坏值→root）+ `newNoteFolder` Store + setter（localStorage，root→removeItem）。`resolveNewNoteFolder(activePath): string`（current→`parentPath(activePath)` 或 ""[无 active]，folder→`newNoteFolder` trim + strip 首尾斜杠，default→""）纯函数=probe 真值表。`createNewNote(vault, name, activePath, content=""): Promise<string>`——**slash-guard**：`name` 含 "/"（path-bearing，如 `[[area/Note]]`）视为 vault 相对、**不嵌套**配置文件夹（folder=""）；**folder-ensure**：非空 folder 先 `createFolder`（try/catch 已存在）；`uniquePath` 防撞名；`create`；返回 path。
- **5 个建笔记调用点收敛到 createNewNote**（正向减重复，simplify 门确认）：QuickSwitcher（switcher 建笔记）/ wikilinks（点未解析 `[[link]]`，name 已 stripExtension(basename) 成裸名）/ BacklinksPanel·OutgoingLinksPanel（createAndOpen 未解析链接）/ GraphView（建未解析节点）——各 `createNewNote(app.vault, name, <active>).then(openFile, errLog)`。wikilinks 用 `fromPath`（含链接的源文件）而非 getActiveFile（obsidian:// URI 时更精确）。
- SettingsModal segmented（root/current/folder，镜像 theme）+ 条件 folder input（仅 location="folder" 显示）+ i18n。probe `__geodeNewNoteFolder`/`__geodeCreateNewNote`。

**对抗评审（reviewer 4 维各独立 + skeptic verify，深挖 data-safety 写路径 + path-bearing name 文件夹）→ 0 confirmed critical/major + 2 minor/nit（同根因，已修）：**
- **data-safety 证伪（核心）**：① **path-bearing name 中间文件夹自动建**——slash-guard 跳过 folder-ensure 的 `sub/Note`，两端 createFile 都自动建父目录（Memory vault.ts:956-960 回溯注册 / Tauri Rust `vault_create` 内 `fs::create_dir_all(parent)`），e2e `Projects/Roadmap`（Projects/ 不存在）实落盘通过。② **非法 folder 设置防御到位**——`newNoteFolder="../evil"`：resolveNewNoteFolder 只剥首尾斜杠、内层 `..` 存活 → createNewNote 的 create 的 `assertSafeRelPath` 抛错冒泡到调用点 errLog（不写库外、不崩）+ Tauri `safe_join` 再兜一层。撞名 uniquePath 加序号正确。
- **[minor 已修]** QuickSwitcher 建笔记缺 `.catch`——R89 把「folder 设非法→create throw」变成可达拒绝路径 → unhandled rejection（控制台噪声）→ 修=与其余 4 点对齐补 errLog。
- **[nit 已修]** wikilinks「current 文件夹」用 getActiveFile 而非已在手的 `fromPath`（obsidian:// URI 时 active 可能 null/别的文件）→ 修=传 fromPath。
- **证伪其余**：默认 root=零回归（5 点原本 root 行为字节一致）；持久化/strip 斜杠/坏值 fallback 正确；分层无环；时序未变（fire-and-forget `.then`）；r82/r84 回归绿确认 createAndOpen 改动没破面板。

**验证（As-built）**：typecheck 0 · `r89-e2e` **16/16**（resolveNewNoteFolder 6 真值表[root/current±active/folder±斜杠] + createNewNote 端到端[指定文件夹落盘+folder 自建 + slash-guard 不嵌套 + root + 撞名序号] + 设置 segmented+条件 folder input+持久化）· `r89-probe` **8/8** 真 WKWebView + 真 fs（含嵌套文件夹真建盘）· 回归 r82(27)/r84(17)/r24(12) · 简化门 clean（5 调用点收敛=正向减重复）。

**v1 已知延期**：TemplateSelector 建笔记接 location（其流程含 expanded 内容+README 拒绝逻辑，单列）· explorer 工具栏「新建笔记」无文件夹上下文时接 location · Reveal-in-Finder（需 Tauri opener 依赖=可能硬边界）。

## Round 88 additions — 行号 gutter + 新标签默认视图模式（候选池第六梯队 ㊶ 续 v1）【As-built v0.85】

> **状态：As-built（v0.85 交付，2026-06-16）。** 两个 Obsidian Editor 设置：① **Show line numbers**（行号 gutter，默认 OFF=Obsidian 默认+零回归）；② **Default view for new tabs**（新标签默认 live/source/preview）。纯前端 view-only（不写 .md、不动 markdown.ts）。

**契约（冻结接口）**：
- `core/appearance.ts`：`showLineNumbers` Store（默认 false，镜像 spellcheck，localStorage）+ `setShowLineNumbers`；`defaultNewTabMode` Store（`NewTabMode = "live"|"source"|"preview"`，默认 "live"=零回归，`readTabMode` 校验 null/坏值→"live"）+ `setDefaultNewTabMode`。无 DOM 副作用 → 不入 applyAppearanceSettings boot（惰性消费）。
- **行号 gutter**：`cmExtensions.ts` opts 加 `lineNumberCompartment: Compartment`，return 含 `lineNumberCompartment.of(showLineNumbers.get() ? [lineNumbers()] : [])`（`lineNumbers` from `@codemirror/view`=既有依赖）。`EditorPane.tsx` 每 view 创建 lineNumberCompartment（镜像 modeCompartment：ref + 创建传入 + cleanup 置 null）+ `useStore(showLineNumbers)` + 反应式 effect `view.dispatch({effects: compartment.reconfigure(on ? [lineNumbers()] : [])})`（镜像 spellcheck 反应式 effect）。**gutter 顺序**：lineNumbers() 在扩展列表先于 markdownFolding()→foldGutter() → 行号最左、fold 在右（Obsidian 一致）；两者独立 `.cm-gutter` 互不污染。
- **新标签默认模式**：`workspace.ts` openFile 新建分支 `mode: "live"` → `mode: defaultNewTabMode.get()`（唯一 markdown 新标签创建点；graph tab 硬编码 preview 不取 default、reopenClosedTab 恢复 entry.mode、split 继承源 mode、layout 恢复读持久化 mode——均不受影响）。`core/workspace` import `core/appearance` 合规（无环，appearance 只 import store）。
- SettingsModal：行号 toggle（`settings-line-numbers-toggle`，镜像 spellcheck）+ 默认模式 segmented（`settings-newtab-reading/live/source`，镜像 theme 三态）+ i18n。probe `__geodeNewTabMode`。

**对抗评审（reviewer 5 维各独立 + skeptic verify，深挖 gutter 共存 + 默认 mode 注入完整性）→ 0 confirmed critical/major + 2 minor（同根因，已修）+ 1 nit（已修）：**
- **[minor 同根因 已修] 行号 gutter 沿用 CM 基础 light 主题硬编码色**：编辑器从未声明 `EditorView.darkTheme` facet → CM 按 light 处理 → 行号数字 `#6c6c6c` + active-line gutter 浅蓝块（`#e2f2ff`），与 Geode 暗色主题冲突、违反「颜色走 CSS 变量」铁律（此前 fold gutter 用自绘 chevron 无文字色故未暴露，本轮首个带文字+activeLine 背景的 gutter 才暴露）。**修=`editorTheme` 加 `.cm-lineNumbers .cm-gutterElement { color: var(--text-faint) }` + `.cm-activeLineGutter { background: transparent; color: var(--text-muted) }`**（一处修两条）。
- **[nit 已修]** r88-e2e 补行号 gutter 与 fold gutter 共存 + 行号最左断言。
- **证伪其余**：gutter 渲染顺序正确（行号左 fold 右）；live↔source 与行号双 compartment 独立不互扰；preview→editor 往返行号初值按 Store 重播种、effect 守 `!view||!compartment` 不崩；多 pane 各自 useStore+effect 独立响应；默认 mode 注入点完整（graph/reopen/split/layout 各保留自身 mode）；`mode:"preview"` 新标签正确进阅读视图；无循环依赖；readTabMode 坏值全归 live；lineNumbers 非新依赖；R50/R11/R17/R29 未波及。

**验证（As-built）**：typecheck 0 · `r88-e2e` **13/13**（行号 gutter 反应式 toggle 出现/消失+持久化 + **与 fold gutter 共存+最左** + defaultNewTabMode 真值表[preview/source/live] + segmented UI + openFile newTab 用 default）· `r88-probe` **5/5** 真 WKWebView（`__geodeNewTabMode` openFile 用 default mode）· 回归 r50(15)/r79(21)/r29(folds 19) · 不碰 markdown.ts（r26-bytes 不涉及）· 简化门 clean。

**v1 已知延期**：行号点击选行 · Tab 缩进宽度 / fold 分项开关 / 代码块复制按钮（㊶ 续续）。

## Round 87 additions — strict line breaks（严格换行渲染选项）（候选池第六梯队 ㊶ v1）【As-built v0.84】

> **状态：As-built（v0.84 交付，2026-06-16）。字节敏感轮（动 markdown.ts 阅读管线）。** Obsidian「Strict line breaks」设置：OFF（默认）= 单换行渲染成 `<br>`（Obsidian 默认阅读视图）/ ON = 严格 CommonMark（单换行 join，需两空格或空行）。**关键=改了渲染默认**：旧 md 无 `breaks` 选项 = `breaks:false`（CommonMark）；本轮默认翻转为 `breaks:true` 匹配 Obsidian。纯前端 view-only（不写 .md），只影响 reading 视图（live preview 的 CM 软换行本就视觉换行=Obsidian 一致）。

**契约（冻结接口）**：
- `core/markdown.ts`：`RenderMarkdownOptions` 加 `strictLineBreaks?: boolean`；`renderMarkdownToHtml` 渲染前 `md.options.breaks = !opts?.strictLineBreaks`（**单例 md 每渲染前 set**——render 同步纯函数无交错，自定义 rules[fence/image/link_open]**无一回调 renderMarkdownToHtml**=无嵌套重入污染）。**默认（opts 无 strictLineBreaks）= breaks:true**。
- `core/appearance.ts`：`strictLineBreaks` Store（默认 false）+ `setStrictLineBreaks`（localStorage，镜像 spellcheck，无 DOM 副作用 → 不入 applyAppearanceSettings boot）。
- 注入链 7 处传 `strictLineBreaks`：**EditorPane**（`useStore(strictLineBreaks)` 反应式 + 入 previewHtml useMemo deps → 改设置即重渲染 reading）/ embeds.ts（transclusion，host 重渲染→重 hydrate→`.get()` 取新值）/ HoverPreview / SlidesOverlay / export.ts / compat/util.ts 各 `.get()` / main.tsx `__geodeRenderMarkdown` 加 3rd param（测两模式）。结构块 live widget（query/mermaid/math/tables）**故意不传**（无段内软换行）。SettingsModal toggle（`settings-strict-linebreaks-toggle`，镜像 spellcheck）+ i18n。
- **r26-bytes 字节套件**：加 soft-break 语料（`line one\nline two` 等——单换行段内是唯一能区分 breaks false↔true 的输入类）+ 重捕 baseline 吸收默认翻转。

**对抗评审（reviewer 5 维各独立 + skeptic verify，深挖单例 breaks 污染 + 默认翻转回归）→ 0 confirmed critical/major/minor + 2 nit（记已知偏差）：**
- **单例 breaks 污染证伪（核心）**：`renderMarkdownToHtml` 全仓唯一 `md.render` 调用（:1271），自定义 rules **无一回调** renderMarkdownToHtml/md.render → 无 set-breaks 重入；set→render→return 同步单线程无交错；embeds 是渲染后独立 render 调用非内嵌；render 抛错 breaks 残留但下次必先 set 无害。
- **默认翻转隔离证伪**：r26-bytes 重捕 baseline **仅 3 处变字节**（blockquote[含段内单换行] + 新增 soft-break×2），**18 个块级 case 字节不变**（callout/list/table/mixed 全隔离——它们语料段内无单换行，故无 `<br>` 可生）。**0 invariant violations**。实测 Obsidian 语义正确：默认单换行→`<br>`、strict ON→join、`  \n` 两空格硬换行两模式皆 `<br>`、空行分段两模式皆双 `<p>` 无 `<br>`。
- **[nit 已知偏差]** ① SlidesOverlay useMemo `.get()` 但 strict 未入 deps → 放映中途切设置不重渲（瞬态模态、每次打开重建、与 export/hover 非反应式取值一致，可接受）；② `__geodeHover` 探针钩子（main.tsx:282）未传 strict（probe-only，用户真实悬停走 HoverPreview 已传）。

**验证（As-built）**：typecheck 0 · `r87-e2e` **11/11**（breaks 真值表[默认<br>/strict join/硬换行/段落] + 设置 toggle 反应式重渲 reading + 持久化双向）· `r87-probe` **6/6** 真 WKWebView · `r26-bytes` **0 violations**（隔离，改前 `--baseline` 重捕 + 改后验证 + 重捕锁新字节）· 回归 r26(12)/r25(17)/r74(23) · 简化门 clean。

**v1 已知延期**：SlidesOverlay/探针钩子反应式（nit）· strict line breaks 影响 live preview 的软换行装饰（Obsidian 也不在 live 改，故不做）。

## Round 86 additions — File properties 右侧栏 + Cmd+Backspace 删属性（候选池第六梯队 ㊼ 续 v1）【As-built v0.83】

> **状态：As-built（v0.83 交付，2026-06-15）。** Obsidian「Properties view」核心插件 = 活动笔记属性的右侧栏面板。复用 R22 PropertiesPanel，但作为活动文档的**独立第二写者**——经共享 `DocumentHandle`（acquire/release + `applyExternalEdits`）而非裸 setText+modify。+ Cmd/Ctrl+Backspace 键盘删属性（接 R83 行键盘导航）。写 .md（删属性）→ data-safety 触发。

**契约（冻结接口）**：
- `RightPanelKind` 加 `"fileproperties"`（types.ts；workspace sanitize 接受任意非空字符串=零改）。App.tsx 三处接线：effectiveRight 链 + tab 按钮（`right-tab-fileproperties`，icon file-text）+ 面板渲染链。
- 新 `features/editor/FilePropertiesPanel.tsx`（**必须在 features/editor/ 内** = 同 feature 复用 PropertiesPanel，features 绝不互 import）：`findActiveTab(ws)` 取活动 markdown 文件 → `app.documents.acquire(activePath)` 拿共享 handle（refcount，cleanup release，镜像 EditorPane acquire 模式）→ docRevision 订 `handle.revision`（mirror 进 local state，每次编辑 bump）→ 渲染 `<PropertiesPanel getDoc={()=>handle.getText()} applyEdit={(e)=>handle.applyExternalEdits([e])} path={activePath} revision={docRevision}/>`。**关键写路径=`handle.applyExternalEdits([edit])`**（PropertyEdit `{from,to,insert}` 直接是其入参形状）：命中第一个 attached live CM view → `view.dispatch`（合并进 live buffer、保留用户脏编辑、走单一 dirty/save），无 view → splice + scheduleSave + bump revision。
- `PropertiesPanel.tsx`：`onRowKeyDown(e, key)` 柯里化（row `onKeyDown={(e)=>onRowKeyDown(e, entry.key)}`），加 Cmd/Ctrl+Backspace 分支（在 `e.target===e.currentTarget` 行壳守卫**之后**）：`focusSiblingRow(row,1); if(activeElement===row) focusSiblingRow(row,-1); removeKey(key)`（删前移焦到兄弟行=删后焦点不落 body）。复用既有 `removeKey`（buildRemoveProperty + applyEdit），与每行 delete 按钮同一路径。probe `__geodeFilePropsRemove`（acquire + buildRemoveProperty + applyExternalEdits）。

**对抗评审（reviewer 6 维各独立 + skeptic verify，深挖第二写者 + refcount）→ 0 confirmed critical/major/minor + 1 nit（已修）：**
- **data-safety 第二写者证伪（核心）**：live CM 视图存在 + 用户有脏编辑时右栏并发删属性**不触发 mismatch guard throw**——`documents.ts` syncExtension updateListener 在每次本地编辑**同步**物化 `this.text = doc.toString()`（CM updateListener 在 dispatch 后同步、JS 单线程无交错）→ `applyExternalEdits` 的守卫 `view.state.doc.toString() !== this.text` 恒等 → 走 `view.dispatch` 把删属性合并进 live buffer、保留用户已打内容、单一 dirty/save 链正确。offset 自洽（getDoc/removeKey/applyExternalEdits 三处同一 `this.text` 基准）。buildRemoveProperty 按解析 entry from/to 精确删（绝不正则扫原文），CJK/元字符键安全，删唯一属性连 `---` 围栏一并删（对齐 Obsidian）。
- **refcount 证伪**：acquire/release 配对（cleanup 先 cancelled 再 release，promise 未归时 .then 内 cancelled 分支自 release）；快速 A→B→A 靠 manager deferred-drop 微任务 + 同步 re-acquire retain 不误 drop；revision 订阅 cleanup 退订；rename 简化无害（FilePropertiesPanel 无自有 CM view，rename 时 activePath 变→短暂 loading→re-acquire retarget handle，无状态可丢）。
- **[nit 已修]** loading 分支补 `data-testid="fp-loading"`（测试可观测性）。
- **证伪其余**：Cmd+Backspace 字段内不误删（行壳守卫早退）、删最后/唯一/第一行焦点补位不崩、Mac/Win 双接；EditorPane 内嵌 PropertiesPanel 同获删能力=合理增强（同组件统一）、柯里化未破 R83 导航；分层合规；allproperties（vault 级 R30）vs fileproperties（文件级 R86）独立不混淆。

**验证（As-built）**：typecheck 0 · `r86-e2e` **11/11**（fileproperties tab + 复用 PropertiesPanel + **第二写者 edit 写活动 doc（live CM 共存无 mismatch）** + Cmd+Backspace 删属性保留其余 + plain Backspace 不删 + 切文件 re-target）· `r86-probe` **6/6** 真 WKWebView + 真 fs（`__geodeFilePropsRemove` 删 status 留 author/count，no-view splice 分支）· 回归 r83(15)/r30(25)/r24(12) · 不碰 markdown.ts（r26-bytes 0）· 简化门 clean。

**v1 已知延期**：Hidden 模式下 File properties 作主编辑入口的联动 · Date 值链接日记 · 属性拖拽重排 · 右栏与编辑器内嵌 panel 的滚动同步。

## Round 85 additions — 字体三族：界面/正文/等宽字体设置（候选池第六梯队 ㊺ 续 v1）【As-built v0.82】

> **状态：As-built（v0.82 交付，2026-06-15）。** 镜像 R79 accent 手法，加 3 个用户字体覆盖（运行时 CSS 变量 + localStorage 持久化）：**Interface**（菜单/侧栏/树）、**Text**（笔记正文，未设时继承界面）、**Monospace**（代码）。纯前端 view-only（不写 .md、不动 markdown.ts 渲染管线，改的是 `font-family` CSS 非 HTML 字节）。

**契约（冻结接口）**：
- `core/appearance.ts`：`sanitizeFontFamily(raw): string` 纯函数（CSS 注入防护 + 控制字符清洗：strip `["'\\;{}()<>]` + 控制符 `\x00-\x08\x0b\x0c\x0e-\x1f\x7f`[**不含 \t\n\r**] + `\s+`→单空格 + trim；"" = 无覆盖）；`interfaceFont`/`textFont`/`monospaceFont` 三 Store + `setInterfaceFont`/`setTextFont`/`setMonospaceFont`（set Store + persistString(**sanitized**) + applyFont）。`applyFont(prop,raw,stack)` = `setProperty(prop, \`"<sanitized>", <stack>\`)` 或空→`removeProperty`（回 CSS fallback）。boot `applyAppearanceSettings()` 应用 3 字体。
- CSS 变量（默认 stack 与 `appearance.ts` 的 `STACK_INTERFACE`/`STACK_MONOSPACE` **逐字节一致**）：app.css body→`var(--font-interface, <stack>)`；editor.css `.cm-editor` + `.markdown-reading-view`→`var(--font-text, var(--font-interface, <stack>))`（**正文未设→继承界面**=Obsidian 语义）；6 editor + 2 settings mono 点→`var(--font-monospace, <mono-stack>)`。
- SettingsModal 加 3 text input（`data-testid="settings-font-{interface,text,monospace}"`，复用既有 `.settings-text-input`）；probe `__geodeFontSanitize` + `__geodeAppearance.setFont/fontVar`。

**对抗评审（reviewer 6 维各独立 + skeptic verify + 实证 CSS 注入）→ 0 confirmed critical/major + 2 minor（同根因，已修）+ 余证伪：**
- **CSS 注入证伪（核心）**：用户内容恒被包在引号 string token 内（`"<sanitized>", <stack>`），sanitize 已 strip `"` 和 `\` → 无法闭合引号/起转义 → 无法越出 token 成新声明；且 `var()` 代入非法值只触发 IACVT（回退继承/初始值），规范不允许越出外层声明。实证 `url()`/`@import`/`!important`/`/* */`/`}body{` 全被锁为引号内字面名→CSS 当「找不到该字体」回退 stack。
- **[minor F1 已修] text 「已设但缺失」回退不尊重界面覆盖**：`setTextFont` 原 fallback 写死 `STACK_INTERFACE`，当用户同时覆盖界面+正文且正文字体缺失时回退到默认 stack 而非用户界面字体（与 CSS `var(--font-text, var(--font-interface, …))` 语义分叉）→ **修=fallback 传 `var(--font-interface, ${STACK_INTERFACE})`**。
- **[minor F2 已修] 控制字符未 strip 致声明静默失效**：原 strip 集不含控制符，粘贴含 NUL/C0/DEL 的字体名→引号内非法 string→`font-family` 声明非法→覆盖静默丢失（非安全问题，仍锁引号内）→ **修=strip 集加 `\x00-\x08\x0b\x0c\x0e-\x1f\x7f`（保留 \t\n\r 交 `\s+` 归一）**。
- **证伪其余**：settings mono fallback 由历史不一致的 `Consolas,...` **故意统一**为 editor 全栈（字节对齐 STACK_MONOSPACE，macOS 上 ui-monospace 更贴原生=改进非缺陷）；所有 stack 字节核对一致；`.markdown-reading-view` 新规则是外层 wrapper、内层 `.preview-content code`（mono）特异性更高正确覆盖、reading 代码不被正文字体污染；持久化 sanitized vs Store raw 的「刷新后输入框由 raw 变 sanitized」= 与 R79 accent 同款可接受 UX；分层合规（core 无 React）；R20 fontSize/R50 readable/R79 accent 未波及。

**验证（As-built）**：typecheck 0 · `r85-e2e` **21/21**（sanitizeFontFamily 7 真值表[含注入/控制符/折叠/空] + 3 setter 应用 CSS 变量+持久化+清除 + 注入实测无 `;{}` + 3 设置 input 应用+持久+清除）· `r85-probe` **6/6** 真 WKWebView · 回归 r79(21)/r50(15) · 不碰 markdown.ts（r26-bytes 0）· 简化门 clean。

**v1 已知延期**：系统已装字体的自动补全建议（Obsidian 给系统字体下拉）· font 设置生效的「字体已识别 ✓」标记 · CJK 字体回退栈细化。

## Round 84 additions — 图谱过滤：孤立笔记 + 仅现有文件 toggle（候选池第六梯队 ㊵ 续 v1）【As-built v0.81】

> **状态：As-built（v0.81 交付，2026-06-15）。** 给 R78 图谱设置面板加 Obsidian「Filters」组的两个核心 toggle：**Orphans**（显示无连接笔记）+ **Existing files only**（仅显示已存在文件、隐藏 unresolved 链接目标）。**纯客户端过滤**——`GraphNode` 已带 `resolved`（types.ts）+ getGraph 预算 `degree`，零改 getGraph 共享索引、零写盘。

**契约（冻结接口）**：
- `graphPrefs.ts`：`GraphPrefs.filters: GraphFilters = { orphans: boolean; existingOnly: boolean }`，`DEFAULT_PREFS.filters = Object.freeze({ orphans: true, existingOnly: false })`（= 「显示全部」**零回归**默认，对齐 Obsidian 默认）。`parseGraphPrefs` 加 filters 向后兼容：旧 blob 无 `filters` → `orphans: fl.orphans !== false`（默认 true）、`existingOnly: fl.existingOnly === true`（默认 false）。
- 新纯函数 `applyGraphFilters<N extends {id,resolved}, E extends {source,target}>(nodes, edges, filters): { nodes, edges }`——**existingOnly 时先去 `!resolved` 节点 + 触及它们的边，再 `!orphans` 时按【过滤后边集】现算 degree 去 degree-0 节点**（顺序关键：只连到 unresolved 的笔记在 existingOnly 后变孤立，与 Obsidian 一致）。纯函数不 mutate 输入（`.filter` + 末尾 `[...n]/[...e]`）。probe 经 `__geodeGraphFilter` 验证。
- `GraphView.tsx`：rebuild 顶 `applyGraphFilters(raw.nodes, raw.edges, prefs.filters)`（在 local-BFS + degree 采样**之前** → 两者都见过滤后集）；**rebuild useCallback deps 加 `prefs.filters.orphans/existingOnly`** → toggle 改 prefs → rebuild 重建 → `[rev, rebuild]` effect 重触发。`setFilter` 只 setPrefs（**不镜像 stateRef**——filters 仅 rebuild 消费、draw 闭包不读，已核 draw 不读 filters）。设置面板「Filters」组 2 toggle（复制 arrows toggle 模板，data-testid `graph-filter-orphans`/`graph-filter-existing`）。

**对抗评审（reviewer 6 维各独立 + skeptic verify）→ 0 confirmed critical/major + 2 minor（同根因，记为已知 UX 偏差）+ 余证伪：**
- **证伪（核心）**：过滤顺序正确（existingOnly→现算 degree→去孤立，e2e `combined→[a,b]` 证实）；degree 用本地 Map 现算**未误用 stale `node.degree`**；自环/重复边只让 degree 偏大不影响 `>0` 判定；返回拷贝真不 mutate。**local×过滤**：过滤在 BFS 前，anchor 被过滤掉时走 `anchorId=null → localEmpty` 安全分支**不崩溃**。**闭包新鲜度**：rebuild deps 含两 filter 键、读 React `prefs.filters` 非 `s.prefs`；draw 闭包不读 filters 故 setFilter 不镜像无害。**向后兼容**：旧 blob 无 filters→show-all 零回归、DEFAULT freeze 不被 mutate。**分层/data-safety**：view-only、不动 metadata.getGraph、graph 不 import 别 feature。**回归**：r78(force/display/reset)16/16、r28 23/23。`resetSettings` 不重置 filters = **有意对齐 Obsidian**（reset 按钮属 Display/Forces 组、Filters 独立组不被重置）。
- **[minor 已知 UX 偏差·同根因]** 空态文案未区分「无笔记」vs「被过滤清空」：local 模式锚点是孤立笔记 + orphans-off → 锚点被过滤 → 回退「打开笔记查看局部图谱」（但笔记已打开）；global 全被过滤 → 复用「还没有笔记」。根因 = 空态只分 mode 未分「空因」。无崩溃/无数据风险，记为延期（修法：加 `filtersActive` 判定切文案）。

**验证（As-built）**：typecheck 0 · `r84-e2e` **17/17**（applyGraphFilters 4 真值表 + parseGraphPrefs filters 向后兼容 4 + 面板 2 toggle 持久化 + 改渲染节点集 delta）· `r84-probe` **8/8** 真 WKWebView · 回归 r78(16)/r28(23) · 不碰 markdown.ts（r26-bytes 0）· 简化门 clean。

**v1 已知延期**：标签作节点 / 附件作节点（需扩 getGraph 共享索引=审所有消费者）· 分组着色 color groups（按查询/文件夹上色）· 搜索过滤框 · 空态文案分「空因」。

## Round 83 additions — Properties 增强：tags chip 点击搜索 + 属性行键盘导航（候选池第六梯队 ㊼ v1）【As-built v0.80】

> **状态：As-built（v0.80 交付，2026-06-15）。** 给 R22 PropertiesPanel 加两项 Obsidian 风格交互：① tags 类型的 chip 点击 → 在搜索面板查 `#tag`；② 属性行键盘导航（↑/↓ 切行、Enter 进 value 编辑器）。改动单文件 `features/editor/PropertiesPanel.tsx` + i18n + CSS。

**契约（冻结接口）**：
- `ChipsValue` 加可选 `searchTag?: (tag: string) => void`——仅 `ValueEditor` 在 `effType==="tags"` 时透传（aliases/multitext 不传 → chip 仍是不可点 `<span>`）。tag chip 文本变 `<button class="property-chip-text property-chip-search" data-testid="property-chip-search-<key>-<i>">`，点击 `searchTag(item)` → 面板内 `searchTag = (tag) => app.workspace.requestSearch(\`#${tag}\`)`（**复用 R41 TagsPanel/workspace.ts:331 既有机制**：`searchRequest.set` + `setLeftPanel("search")`，SearchPanel 一次性消费进 `search-input`）。chips 存不带 `#`，拼回 `#`。
- 属性行键盘导航：`.property-row`（非 opaque）加 `tabIndex={0}` + `data-prop-row` + `onRowKeyDown`。handler **仅当行壳自身聚焦（`e.target === e.currentTarget`）才动作**：↑/↓ 走 `focusSiblingRow`（`rootRef` 内 `[data-prop-row]` 列表索引 ± 1，越界 `?.focus()` 安全 no-op）、Enter 聚焦 `.property-value` 内首个 `input/select`（回退 button）。**绝不处理从内部字段冒泡的键**。

**对抗评审（reviewer 5 维各独立 + skeptic verify）→ 1 确认 CRITICAL（data-safety 第一底线，已修）+ 2 minor（已知延期）+ 余证伪：**
- **[CRITICAL] Escape 导航把「丢弃编辑」反转成「写入 frontmatter」**：初版 `onRowKeyDown` 的 Escape 分支对**字段内**按键 `e.currentTarget.focus()`（焦点移到行壳）→ 同步触发当前 input 的原生 blur → 各字段 `onBlur` 提交。而字段 Escape 的 onKeyDown 是 `setDraft(stored/"")`（丢弃语义）但 `setDraft` 异步未 flush → blur 闭包读到**用户编辑后的 stale draft** → ScalarInput/Date `commit(stale)` / NameInput `rename(stale)` / ChipsValue `add(stale)` 全部**误写 frontmatter + 反转 Escape 撤销契约**（React 18 冒泡序 target→currentTarget、三处 Escape 均未 stopPropagation）。**修 = 结构性移除 Escape→行的程序化聚焦**（不在写路径塞 setTimeout 时序 hack）：`.property-row` 改 `tabIndex={0}`（Tab 可达=键盘进入行导航的入口），onRowKeyDown 只在行壳聚焦时处理 ↑/↓/Enter，**字段 Escape 完全交回字段自身既有的 discard-且保持焦点**（零改动、零 blur-commit）；字段→行用 Shift+Tab。**补 data-safety e2e**：编辑 count value→39 → Escape → 断言 input 回退 "3" **且 live doc 仍 `count: 3` 不含 `39`**。
- **[minor 已知延期]** opaque 行（无 `data-prop-row`）+ add-property 行不参与 ↑/↓ 导航（前者无可编辑内容合理，后者与 Obsidian 含 add 行略异）。
- **证伪**：`#`-拼接正确（chips strip `#`、searchTag 拼回，同 TagsPanel）；type-menu 开时 Escape/↑↓ 已 stopPropagation 不与 row 打架；`focusSiblingRow` 限定 `rootRef` 不跨面板；越界 `?.focus()` 安全；button `type="button"` 防表单提交；分层合规（features 不互 import、core 无 React）；UI 串全 `t()`、颜色全 CSS 变量；R22/R30 类型编辑/datalist/rename 行为未破。

**验证（As-built）**：typecheck 0 · `r83-e2e` **15/15**（tags chip 渲染/点击 seed `#alpha`·`#beta`/aliases 不可点 + ↑/↓/Enter 导航 + 字段内 ↑↓ 不串行 + **Escape discards 不写 frontmatter** data-safety）· `r83-probe` **3/3** 真 WKWebView（`requestSearch` 同步 seed store + 切 leftPanel）· 回归 r30(properties)25/25 + r24(autosave/flush)12/12 + r23(22) · 不碰 markdown.ts（r26-bytes 0）· 简化门 clean。

**v1 已知延期**：File properties 右侧栏（`RightPanelKind` 无 fileproperties）· Date 值链接对应日记 · hover/embeds 容器应用 cssclasses（R73 限主 EditorPane）· Escape→行的平滑回退（结构安全前提下未做，用 Shift+Tab 替代）· opaque/add 行入导航。

## Round 82 additions — 反链 / 出链面板增强（候选池第六梯队 ㊷ v1）【As-built v0.79】

> **状态：As-built（v0.79 交付，2026-06-15）。** 给 Backlinks 面板的「链接提及」段 + 独立 Outgoing Links 面板加 Obsidian 风格工具栏（排序 + 文本过滤 + backlinks 折叠）。纯前端 view-only（不写 .md、不动 markdown.ts → data-safety 不触发；唯一写=既有 outgoing create-on-click 未动）。

**契约（冻结接口）**：
- 新 `src/core/linkPanel.ts`（纯 TS、零 import）：
  - `export type LinkSortKey = "default" | "name-asc" | "name-desc";`
  - `export function sortAndFilterLinks<T>(items: readonly T[], getName: (item: T) => string, sortKey: LinkSortKey, filter: string): T[]` — 先按投影名 case-insensitive 子串过滤（trim；空=保留全部），再按 sortKey 排序；**`"default"` 不排序 = 保留源序（backlinks 按 source-path、outgoing 按文档序）= 零回归默认**，name-asc/desc 走 `localeCompare` opt-in。纯函数不 mutate `items`。被两面板复用（features 不互 import → 共享逻辑只能落 core），probe 经 `window.__geodeLinkSortFilter` 真值表验证。
- `BacklinksPanel`（linked-mentions 段）：toolbar `data-testid="bl-toolbar"` = `bl-sort`（select）+ `bl-collapse-toggle`（折叠/展开全部）+ `bl-filter`（input）；每源加 `bl-source-toggle`（chevron，`collapsedSources: Set<sourcePath>`）。`shownBacklinks = useMemo(sortAndFilterLinks(data.backlinks, b=>fileTitle(b.sourcePath), blSort, blFilter))`，段头计数改 `shownMentionCount`（过滤随之变小）。
- `OutgoingLinksPanel`：toolbar `data-testid="ol-toolbar"` = `ol-sort` + `ol-filter`，投影名 = `link.alias || link.target`；`shownResolved`/`shownUnresolved` 两 memo，段头计数随过滤变小。

**对抗评审（reviewer 6 维各独立 + skeptic verify）→ 1 确认 MAJOR + 1 MINOR（同根因，已修）+ 余证伪：**
- **[MAJOR] 工具栏状态跨 activePath 不重置 → 新笔记假空**：`blSort`/`blFilter`/`collapsedSources`（及 outgoing `sortKey`/`filter`）绑组件实例，面板常驻不卸载、活动文件由 `activeTab.filePath` 派生 → 二者生命周期解耦。设过滤后切到**确有反链**的新笔记，旧过滤串仍在 → 行数 0 + 显「No mentions match」**假空**（用户误判数据缺失），且与 Obsidian（切档清空搜索框）不符。**修 = 两面板各加 `useEffect(reset, [activePath])`**（sort→default / filter→"" / collapsedSources→new Set()）。**[MINOR] per-source 折叠态对「被过滤掉又回来的源」残留** = 同根因派生，一并消解。**测试遮蔽根因**：r82-e2e 初版全程单一活动文件（无切档复验）→ 23/23 假绿；**补 4 条跨笔记重置断言**（设过滤+排序→切到另一篇有反链的笔记→断言 filter 清空 + sort=default + 新笔记真反链可见）。
- **证伪**：`sortAndFilterLinks` 纯函数（空/纯空格过滤、正则元字符走 includes 不当正则、CJK/Unicode localeCompare、无 mutation）符契约；memo deps 齐全无 stale；view-only（无写 .md，outgoing create-on-click 语义未动，unlinked 扫描 stale-guard 字节未改）；分层合规（core 纯 TS 零 React、features 不互 import）；UI 串全 `t()`、颜色全 CSS 变量；`mentionCount` 删除全仓零残留引用。

**验证（As-built）**：typecheck 0 · `r82-e2e` **27/27**（sortAndFilterLinks 7 真值表 + backlinks sort/filter/collapse-all/per-source toggle + outgoing sort/filter + **跨笔记重置 4 条**）· `r82-probe` **6/6** 真 WKWebView · 回归 r62(outgoing)14/14 + r80(search)17/17 · 不碰 markdown.ts（r26-bytes 0，不涉及渲染）· cargo 无 Rust 改动 · 简化门：删本轮新增即死的 `PanelData.mentionCount` 字段（−3 行、零新符号）。

**v1 已知延期**：show more context（需 `getBacklinks` 携带整段全文 = 改共享索引数据形状，每反链多带数据）· 修改/创建时间排序（需扩 adapter stat = 跨 Rust，同 R80 延期）· unlinked-mentions 段的 sort/filter（本轮仅作用 linked mentions = Obsidian backlinks pane 主体）。

## Round 81 additions — 标签页右键上下文菜单（候选池第六梯队 ㊿ v1）【As-built v0.78】

> **状态：As-built（v0.78 交付，2026-06-15）。** ㊿ v1 = 标签页 `onContextMenu` → 弹菜单：Close / Close others / Close to the right / Close all / Pin·Unpin / Split right / Split down。**纯前端**——基础设施（Pin R39 / Split R37 / closeTab）几乎全有，**只补 3 个批量关闭方法**。两道前置门：① grep 揭露 TabBar 在 `App.tsx:1245`（每 pane 一个，tab DOM 含 onClick/onDoubleClick=pin/onAuxClick=中键关，**零 onContextMenu**）+ `closeTab`/`toggleTabPin`/`splitActivePane` 已有 + `closeOthers/closeRight/closeAll` 缺 + 无通用 ContextMenu 组件（TagsPanel 内联范式最干净）；② WebSearch 确认 Obsidian 标签右键：Close tab / Close others / Close tabs to the right / Close all / Pin / Split。**侧栏面板拖拽/堆叠延期**（LeftPanelKind/RightPanelKind 单值，面板栈是大工程）。

**关键设计（复用既有 + 最小新增）：**
- **`core/workspace.ts` 补 3 方法 + 1 纯函数**：
  - `tabIdsToClose(tabs, targetId, mode: "others"|"right"|"all"): string[]`（**导出纯函数，probe 可测**）：遍历 pane tabs，**跳过 pinned**；`others`=除 target、`right`=index > target、`all`=全部（除 pinned）。
  - `closeOtherTabs(id)`/`closeTabsToRight(id)`/`closeAllTabs(id)` → `findTabLeaf(root, id)` 定位 pane → `tabIdsToClose` → **逐个 `this.closeTab(tid)`**（**data-safety：复用 vetted closeTab 路径，prepending save 属 handle outlives tab，绝不绕过直接 splice**；R39 closeMissingFileTabs 批量先例但那是删文件无 flush 风险，本轮活文件用 per-tab closeTab）。计算 id 列表用快照、逐个 closeTab（id 稳定、findTabLeaf 每次重搜，正确）。
- **`app/App.tsx` TabBar**：① 每 tab `onContextMenu={e => {e.preventDefault(); setMenu({x:e.clientX, y:e.clientY, tabId:tab.id})}}`（与 onClick/onDoubleClick/onAuxClick 不冲突，button 2）；② `menu` state + `menuRef` + close effect（capture `mousedown` 外 / Escape → setMenu(null)，TagsPanel 范式）；③ 菜单 `.tab-context-menu` 内联 div（`position:fixed` + `Math.min(x, innerWidth-W)` 钳制）含 7 项：Close→`closeTab` / Close others→`closeOtherTabs` / Close to the right→`closeTabsToRight` / Close all→`closeAllTabs` / Pin·Unpin→`toggleTabPin`（标签按 `tab.pinned`）/ Split right→`setActiveTab(id)+splitActivePane("row")` / Split down→`splitActivePane("column")`；每项 action 后 setMenu(null)。
- **`core/i18n/dict.app.ts`**：`app.tabClose`(复用 app.closeTab?)/`app.tabCloseOthers`/`app.tabCloseRight`/`app.tabCloseAll`/`app.tabPin`/`app.tabUnpin`/`app.tabSplitRight`/`app.tabSplitDown` 中英。
- **CSS**：`.tab-context-menu`（照搬 `.tag-menu`：fixed/z-index 200/bg-modal/border，全 CSS 变量）放 app 样式（App.tsx 用的 css）。

**testid 面**：`tab-context-menu`/`tabctx-close`/`tabctx-close-others`/`tabctx-close-right`/`tabctx-close-all`/`tabctx-pin`/`tabctx-split-right`/`tabctx-split-down`。

**⚠️ 已知延期（非缺陷，记 ㊿ 续）**：① **侧栏面板拖拽重排 + 多面板堆叠**（LeftPanelKind/RightPanelKind 单值 → 栈，大工程）；② Move to new window（需 pop-out，远期硬边界相关）；③ Close to the LEFT（Obsidian 也无，仅 right）。

**对抗评审（reviewer 7 lens 各独立 + 6 lens data-safety 逐条 skeptic-verify）→ 0 确认缺陷 + 3 nit（采纳 2）：**
- **data-safety 证伪（核心）**：批量关闭走 vetted `closeTab` 逐个，**脏状态属 refcounted `DocumentHandle`（outlives view）非 EditorPane**——切走脏 inactive tab 时 EditorPane 卸载已调度 deferred-drop flush（documents.ts）；多 pane 同文件 handle refcount，关其一不 drop/不早 flush，最后 release 才 flush；closeAll 含 active 脏 tab 也经卸载 flush。**绝不绕过 closeTab 直接 splice**。R24(autosave/flush 字节) 回归绿确认链未退化。
- **证伪其余**：批量迭代（id 快照 + 逐个 closeTab，已关 id findTabLeaf null→no-op，closeAll 关空 pane normalize 折叠正确）；pinned 三 mode 恒跳（`if(pinned)continue` 在 mode 分支前）；菜单 onContextMenu preventDefault 不冲突 onClick/dblclick/aux、`menu&&menuTab` 守 tab 已关、capture mousedown 外关 + Esc；split `setActiveTab(id)`(同设 activePaneId=holder)+`splitActivePane` 对右键非活动 pane/tab 都对；分层（app import core 合法）。
- **采纳 2 nit**：① 菜单定位加下界 `Math.max(0, Math.min(x, innerWidth-200))`（极小视口防负偏移）；② **graph tab 的 Split 项 `disabled`**（`splitActivePane` 对 graph 返 null=no-op，Obsidian 也禁用）+ CSS `:disabled` 态。**未采纳 nit**：clamp 常量 200/280 与 CSS min-width 魔法数字（可接受）。

**验证（As-built）**：typecheck 0 · `r81-e2e` **14/14**（tabIdsToClose 4 真值表 + 右键弹菜单 + close-others 留 target + pin→close-all 留 pinned + split 增 pane + Esc 关）· `r81-probe` **5/5** 真 WKWebView（`tabIdsToClose`）· 回归 r36(tab)47/47 + r37(split)36/36 + r39(pin)17/17 + r24(flush)12/12 + `r26-bytes` 0 · cargo build 绿 · 简化门 **clean**（3 公共方法/closeTabBatch/runMenu/7 菜单项各异不可合并）。

## Round 80 additions — 搜索面板 UI 选项（候选池第六梯队 ㊸）【As-built v0.77】

> **状态：As-built（v0.77 交付，2026-06-15）。** ㊸ v1 = 给 SearchPanel 加 Obsidian 风格结果工具栏：① **排序下拉**（相关性[默认,当前逻辑]/文件名 A-Z·Z-A/匹配数 多·少）；② **折叠全部 + 每文件折叠**；③ **更多上下文**（show-more-context，长行显全行）；④ **复制结果**（剪贴板 Markdown 链接列表）。**纯前端、单文件、不写 .md → data-safety 不触发**。两道前置门：① grep 揭露 SearchPanel.tsx 单文件、排序硬编码 `:232`、`CONTEXT_RADIUS=36` 模块 const、`FileResult`/`LineHit`、无折叠机制、**mtime 排序不可行**（FileNode/VaultAdapter 无 stat）；② WebSearch 确认 Obsidian 搜索：排序（文件名 A-Z 默认/Z-A/修改/创建）+ 折叠结果 + 更多上下文 + 复制结果（三点菜单）。**修改/创建时间排序延期**（需扩 adapter 加 stat=跨 Rust，超 v1 纯前端范围）。

**关键设计（排序可调免重搜 + 上下文免重切）：**
- **`sortResults<T extends {basename,nameMatch,total}>(results, key): T[]`（导出泛型纯函数，probe 可测）**：key ∈ `"relevance"|"name-asc"|"name-desc"|"count-desc"|"count-asc"`；`"relevance"`=当前逻辑（nameMatch → total 降 → basename A-Z，**默认=零回归**）。
- **`allResults` state（全部匹配，不截断）**：搜索 effect 不再 sort/slice（移除 `:232-237` 内联排序）→ `setAllResults(out)`。`results = useMemo(() => sortResults(allResults, sortKey).slice(0, MAX_FILE_RESULTS), [allResults, sortKey])`（排序改变只重排不重搜）；`grandTotal`/`hiddenFiles` 由 `allResults` 派生 memo。
- **`LineHit += fullText, fullMarks`**：`sliceLine` 返回 `{text, marks, fullText, fullMarks}`（full=trimmed 全行 + trimmed-相对 marks，无窗口；短行 text===fullText）→ deriveLineHits 存两形态。render `showMoreContext ? fullText/fullMarks : text/marks`（免重 derive、免重搜）。
- **折叠**：`collapsed: Set<string>`（session，每文件路径）。「折叠/展开全部」按钮（有展开→全折/否则全展）+ 每文件 header chevron（`chevron-down/right`）切 membership；行列表仅 `!collapsed.has(path)` 渲染。**header 文本点开文件、chevron 点折叠**（拆分避冲突）。
- **复制**：按钮 → `navigator.clipboard.writeText(results.map(r=>"- [["+r.basename+"]]").join("\n"))`（R77 blockRef try/catch 先例）+ notice。
- **持久化**：`sortKey`（localStorage `geode.searchSort`）+ `showMoreContext`（`geode.searchContext`）（Obsidian 保留排序偏好）；`collapsed` 不持久（每搜会话）。

**UI 挂点**：`.search-input-wrap` 后插 `.search-toolbar`（sort `<select>` + 折叠 toggle 按钮 + more-context toggle + copy 按钮）。**`core/i18n/dict.panels.ts`**（search.* 命名空间）：`search.sortBy`/`search.sortRelevance`/`search.sortNameAsc`/`search.sortNameDesc`/`search.sortCountDesc`/`search.sortCountAsc`/`search.collapseAll`/`search.expandAll`/`search.moreContext`/`search.copyResults`/`search.copied` 中英。**`app/icons.tsx`**：`copy` 新图标。**`main.tsx`**：`__geodeSearchSort(items, key)` sync 探针（返排序后 basename[]）。

**testid 面**：`search-sort`/`search-collapse-toggle`/`search-context-toggle`/`search-copy`/`search-file-chevron`（每文件折叠）。

**⚠️ 已知延期（非缺陷，记 ㊸ 续）**：① 修改/创建时间排序（需 adapter stat）；② 解释搜索词（explain，search.ts 有 AST）；③ 匹配大小写 UI toggle（R68 有 `case:` 运算符，UI 全局开关延期）；④ 复制格式仅文件链接列表（不含行命中缩进）。

**对抗评审（reviewer 6 lens 各独立 + skeptic-verify + 运行实例复核）→ 0 critical/0 major/2 minor（均修）+ 3 nit：**
- **证伪**：effect 重构等价（totalMatches/totalFiles/hiddenFiles 与原逐项等价、relevance 默认与原硬编码逐字节同序=零回归、cancelled 守卫保持、parsed memo 不 churn、tag-mode setAllResults([]) 隐藏工具栏）；more-context fullMarks 偏移对应 fullText 不越界；折叠 chevron/name onClick 拆分不冲突、collapsed 残留旧 path 无害；分层（main.tsx import feature sortResults 合法、CSS 全主题变量无硬编码色）。
- **修 minor 1**：copyResults 静默无反馈（契约冻结 `search.copied` notice 我漏加）→ 加 `copied` 瞬态 state（复制后按钮 1.5s 显 check 图标 + title「Copied」）+ `search.copied` 键（避免再造第 3 个 toast helper=showBlockNotice 的重复，改按钮态反馈）。
- **修 minor 2**：`navigator.clipboard.writeText` 仅 `.catch` 护 reject，不安全上下文 `navigator.clipboard` undefined 会同步抛 → 整体 `try/catch` 包（对齐 R77 blockRefCommands 先例）。
- **顺带修 nit（R77 教训）**：copy 列表从 `[[basename]]` 改 **`[[path-sans-ext]]`**（重复 basename 粘别处解析错笔记——full path 可移植；e2e root 文件 path===basename 不变）。
- **遗留 nit（记 ㊸ 续）**：① 非法持久化 sortKey（手改 localStorage）→ sortResults 兜 relevance 但 `<select>` 显空（需手动篡改，cosmetic）；② path 含 `]#|^` 元字符仍产坏 wikilink（剪贴板非 .md 写，Obsidian 同口径）。

**验证（As-built）**：typecheck 0 · `r80-e2e` **17/17**（sortResults 5 key 真值表 + 排序下拉改序 + 持久化 + 折叠全部/每文件 + more-context 长行变长 + 复制剪贴板 + **复制按钮反馈**）· `r80-probe` **7/7** 真 WKWebView（`__geodeSearchSort`）· 回归 r68(search)40/40 + r34(find)15/15 + `r26-bytes` 0 · cargo build 绿 · 简化门 **clean**（删了 1 处重复 `.search-file-name` CSS；sortResults 5 case/readSearchPref 镜像 appearance/effect 重构契约决策不回退）。

## Round 79 additions — 外观补全 v1：强调色取色器 + 系统主题三态（候选池第六梯队 ㊺）【As-built v0.76】

> **状态：As-built（v0.76 交付，2026-06-15）。** ㊺ v1 = ① **强调色 Accent color 取色器**（`<input type="color">` → 运行时覆盖 `--accent`/`--accent-hover`/`--accent-muted` + localStorage 持久化）；② **系统主题三态**（`ThemeKind += "system"`，Adapt to system，随 `prefers-color-scheme` 实时）。**纯前端、不写 .md → data-safety 轻**（但改 `workspace.ts` 持久化树 → r45/r50 回归必跑）。两道前置门：① grep 揭露 R50 appearance.ts localStorage 单键 Store+setter 范式可复用 + theme 在 workspace 持久化树二态（`ThemeKind="dark"|"light"`，setTheme 写 `dataset.theme`）+ accent 变量在 app.css；② WebSearch 确认 Obsidian Appearance：accent color + base color scheme「Adapt to system」默认跟随 OS。**字体三族 / inline title / ribbon 显隐 = 延期**（字体需先引入 CSS 字体变量基建，更大）。

**关键设计（theme:changed 载具不变 = 解析后具体值）：**
- **`core/types.ts`**：`ThemeKind = "dark" | "light" | "system"`。**`events.ts` `theme:changed: {theme:"dark"|"light"}` 不变**——事件载 **resolved 具体值**（实际写 dataset 的），`WorkspaceState.theme` 才载 kind（可 "system"）。消费者（compat/themes.ts syncBodyClass、embeds mermaid、graph palette）读 resolved 不破。
- **`core/workspace.ts`**：① **`resolveTheme(kind, systemPrefersDark): "dark"|"light"`（导出纯函数，probe 可测）**：`system`→`systemPrefersDark?"dark":"light"`，否则 kind。② `systemPrefersDark()`（matchMedia try/catch，非浏览器回 true）。③ `setTheme(kind)`：存 kind，`const r=resolveTheme(kind,sys()); dataset.theme=r; emit("theme:changed",{theme:r})`。④ `applyDocumentEffects`：`dataset.theme=resolveTheme(s.theme,sys())`。⑤ `toggleTheme`：`setTheme(resolveTheme(cur,sys())==="dark"?"light":"dark")`（从 system toggle 退到具体反色）。⑥ **`watchSystemTheme()`**（main.tsx boot 调）：matchMedia change 监听，kind==="system" 时重算 dataset + emit resolved。⑦ `sanitizeState:1240` `theme: s.theme==="light"||s.theme==="system" ? s.theme : "dark"`（**向后兼容**：旧 "dark"/"light" 不变，未知回 dark）。`captureLayout`/`applyLayout`（delete/preserve theme 字段）对 "system" 天然正确，零改（R45 全局态契约保持）。
- **`compat/obsidian/themes.ts:225`**：`syncBodyClass` 初始化从 `state.theme`（kind）改读 **`document.documentElement.dataset.theme`**（resolved，applyDocumentEffects 已先写）——否则 "system" 被当 dark 误判。1 行。
- **`core/appearance.ts`**：`accentColor: Store<string>`（默认 ""=无覆盖=主题默认）+ `setAccentColor(c)` + `applyAccentColor(c)`（`/^#[0-9a-fA-F]{6}$/` 校验：合法 hex→`setProperty("--accent",c)` + `--accent-hover`=`color-mix(in srgb, c, white 14%)` + `--accent-muted`=`color-mix(in srgb, c 18%, transparent)`；空/非法→`removeProperty` 三者回 :root 默认）+ localStorage `geode.accentColor` 单键（readString/persistString）。`applyAppearanceSettings()` boot 也 apply accent。
- **`features/settings/SettingsModal.tsx`**：theme segmented 加第 3 按钮 `settings-theme-system`（Icon monitor/laptop）；新 setting-item「强调色」= `<input type="color" data-testid="settings-accent-color">` + Reset 按钮（`settings-accent-reset`→`setAccentColor("")`）。
- **`core/i18n/dict.views.ts`**：`settings.themeSystem`/`settings.accentColor`/`settings.accentColorDesc`/`settings.accentReset` 中英。
- **`main.tsx`**：boot 加 `workspace.watchSystemTheme()`（applyDocumentEffects 后）；`__geodeAppearance` 探针扩 `setAccent(c)`/`accentVar()`/`resolveTheme(kind,sysDark)`（§D：纯逻辑真值表 sync 探针）。

**testid 面**：`settings-theme-system`/`settings-accent-color`/`settings-accent-reset`。

**⚠️ 已知延期（非缺陷，记 ㊺ 续）**：① **字体三族**（界面/正文/等宽——需先在 app.css 引入 `--font-interface/text/monospace` 变量并改 body font-family 读变量）；② Show inline title（文件名作可编辑 H1，碰编辑器）；③ ribbon 显隐；④ App.tsx:687 ribbon 主题图标对 "system" 态不解析具体值（显 moon，cosmetic，segmented 才是主控）；⑤ accent 只覆盖 3 变量（`--selection`/`--link-unresolved` 等含 accent 色调的 rgba 字面量不动）。

**对抗评审（reviewer 7 lens 各独立 + skeptic-verify）→ 0 确认缺陷 + 2 nit（均采纳）：**
- **证伪 7**：① 持久化向后兼容（旧 `"dark"/"light"` blob 无损、未知回 dark、captureLayout 删 theme / applyLayout 保 current 对 "system" 仍 R45 全局态正确）；② `theme:changed` 恒 emit resolved `"dark"|"light"`（events.ts 类型不破、compat/mermaid/graph 消费者拿 resolved）；③ watchSystemTheme 仅 kind==="system" 动作 + matchMedia try/catch + 单例生命周期；④ accent 校验 `<input color>` 恒产合法 hex、脏值 removeProperty 回 :root 默认、color-mix WKWebView 支持、boot 顺序无耦合；⑤ toggleTheme 从 system 退具体反色；⑥ 分层（compat 改读 dataset 不反向依赖、时序 initObsidianCss 远晚于 applyDocumentEffects）；⑦ 测试充分（emulateMedia 真驱动非假绿）。
- **采纳 nit 1**：SettingsModal accent picker 无 override 时 swatch 原硬编码 `#8b7cf6`（违「颜色走 CSS 变量」铁律字面 + light 主题显错色）→ 改 `readCssAccent()` 读 computed `--accent`（`<input color>` 必须 hex 字面，故读实际主题 accent，`#8b7cf6` 仅末路 fallback）。
- **采纳 nit 2**：补 r79-e2e **R45×system 不变式断言**（captureLayout 在 kind=system 仍删 theme + applyLayout 保 current 不取 snapshot）锁工作区持久化向后兼容。

**验证（As-built）**：typecheck 0 · `r79-e2e` **21/21**（resolveTheme 真值表 + accent 覆盖/persist/invalid-drop/reset-clear + 系统三态 emulateMedia 实时跟随 + 显式 dark/light 覆盖 system + segmented 三按钮 + **R45×system 不变式**）· `r79-probe` **7/7** 真 WKWebView（resolveTheme + accent apply sync）· 回归 r45(workspace)10/10 + r50(appearance)15/15 + `r26-bytes` 0（未碰渲染）· cargo build 绿 · 简化门 **clean**（resolveTheme 4 调用点 / readString·persistString 镜像既有 readBool·persistBool / theme:changed emit resolved 是契约不可简化回 kind）。

## Round 78 additions — 图谱设置完整化 v1：显示 + 力 持久化设置面板（候选池第六梯队 ㊵）【As-built v0.75】

> **状态：As-built（v0.75 交付，2026-06-15）。** ㊵ v1 = 把 `GraphView` 当前硬编码的 4 力 + 显示参数抽成齿轮设置面板（滑块）+ localStorage 持久化（沿用既有 `GraphPrefs` blob 扩字段，向后兼容旧 blob）。**纯前端、不写 .md、不动 markdown.ts/vault/editor → data-safety 轻**（GraphPrefs 是 localStorage，损坏自动回默认无丢失）。两道前置门：① grep 揭露 `features/graph/` 仅 GraphView.tsx(887)+graph.css、d3-force 模拟、硬编码点（力 :573-585 / lineWidth :304 / 无箭头 / LABEL_ZOOM :76 / nodeRadius :85）+ `GraphPrefs{mode,depth,showAll}` localStorage blob；② WebSearch 确认 Obsidian 图谱设置：**力**（center/repel/linkForce/linkDistance）+ **显示**（arrows/text-fade/node-size/link-thickness）。

**v1 范围（ROADMAP 建议「显示+力持久化面板 ROI 最高」）**：力 4 滑块 + 显示 4 项（节点大小/连线粗细/文本淡出阈值/箭头开关）。**过滤（标签/附件/孤立节点，动 getGraph）+ 分组着色 = 不在 v1，记延期**。

**关键设计：**
- **`features/graph/graphPrefs.ts`（新，抽出可测纯逻辑）**：`GraphPrefs` 扩 `forces:{center,repel,linkForce,linkDistance}` + `display:{nodeSize,linkThickness,labelThreshold,arrows}`；`DEFAULT_PREFS`（current 值：center 0.06 / repel 200[正幅值,应用取负] / linkForce 0.5 / linkDistance 70 / nodeSize 1 / linkThickness 1 / labelThreshold 0.8 / arrows false）；`parseGraphPrefs(raw: string|null): GraphPrefs`（逐字段校验 + **clamp 到滑块区间** + 缺字段/坏 blob 回默认=**向后兼容旧 `{mode,depth,showAll}` blob**）；`loadPrefs()`（localStorage→parse）/`savePrefs()`。GraphView 从此 import。
- **`features/graph/GraphView.tsx`**：① prefs 镜像进 `stateRef.current.prefs`（render 体赋值，draw 闭包读最新，**不进 draw deps**——空 deps useCallback 稳定性）；② 力构建（rebuild :573-585）从 `stateRef.prefs.forces` 读（非闭包字面值，避 stale）；charge `.strength(-repel)`、center `.strength(center)`、link `.distance(linkDistance).strength(linkForce)`；③ **力滑块 onChange = `applyForces(sim, forces)` 直接 poke 运行中 sim + `alpha(0.3).restart()`**（不重建，布局连续，对齐拖拽 reheats 先例 :677；`applyForces` 用 `sim.force("link"/"charge"/"center")` cast 到 ForceLink/ForceManyBody/ForceCenter）；④ 显示滑块 onChange = setPrefs + `requestDraw()`（draw 读 `s.prefs.display`：lineWidth base=linkThickness、LABEL_ZOOM→labelThreshold、nodeRadius×nodeSize、arrows→画三角箭头）；⑤ `nodeRadius(n, scale=1)` 加 scale 形参（draw+collide 传 nodeSize）。
- **设置面板 UI**：`.graph-toolbar` 加齿轮按钮（`Icon name`）→ toggle `settingsOpen` → `.graph-settings-panel`（Display + Forces 两组滑块行 + arrows checkbox + Reset 按钮）。**滑块 graph 内联**（分层：graph **绝不 import settings feature** 的 `.settings-slider`，自建 `.graph-slider`）。
- **`features/graph/graph.css`**：齿轮 + 浮层（绝对定位贴 toolbar）+ 滑块行样式（颜色走 CSS 变量）。
- **`core/i18n/dict.views.ts`**：`graph.settings`/`graph.forces`/`graph.display`/`graph.forceCenter`/`graph.forceRepel`/`graph.forceLink`/`graph.linkDistance`/`graph.nodeSize`/`graph.linkThickness`/`graph.textFade`/`graph.arrows`/`graph.resetSettings` 双语。
- **`main.tsx`**：always-on sync 探针 `__geodeGraphPrefs(raw?) => raw!==undefined ? parseGraphPrefs(raw) : loadPrefs()`（§D：验证逻辑可测，面板 DOM/canvas browser-E2E only）。

**testid 面**：`graph-settings-toggle`/`graph-settings`/`graph-force-center`/`graph-force-repel`/`graph-force-link`/`graph-link-distance`/`graph-node-size`/`graph-link-thickness`/`graph-text-fade`/`graph-arrows`/`graph-settings-reset`。

**⚠️ 已知延期（非缺陷，记 ㊵ 续）**：① 过滤组（标签/附件作节点、孤立笔记、仅现有文件——动 `metadata.getGraph()`）；② 分组着色（按查询）；③ 局部图谱深度>2 + in/out 方向 + 保存为默认；④ force/display 全局共用一份（Obsidian local/global 各存一份，v1 不拆）。

**对抗评审（reviewer 7 lens 各独立 + skeptic-verify）→ 0 确认缺陷 + 3 nit：**
- **证伪 7**：① prefs 镜像（render 体 `s.prefs=prefs` + setForce/setDisplay/reset 手动同步镜像）无 stale/打架（React18 同事件同步执行 + 后续 re-render 值相同）；② 力 live-poke 力名一致（link/charge/center）、charge 用 `-repel`、sim null 守卫、不触发 rebuild；③ clamp/校验对 NaN/Infinity/字符串/负/超界/旧 blob/null/坏 JSON 全回安全值（`num()` `Number.isFinite`+clamp）；④ draw 箭头几何+nodeRadius 全 9 调用点一致传 nodeSize（点击/碰撞/视觉不错位）；⑤ 分层（graph 不 import settings feature，滑块自建）+ 复用旧 key 向后兼容 + savePrefs try/catch；⑥ onChange 函数式 setPrefs 不丢并发；⑦ 测试充分（canvas/物理 §D 留口非假绿）。
- **采纳 1 nit（已修）**：`DEFAULT_PREFS` 被 parse/reset 按引用返回——`Object.freeze`（含 nested forces/display）加固，防未来就地 mutate 污染默认。
- **nit（记 ㊵ 续，不返工）**：① nodeSize 增大时 collide 半径到下次 rebuild 才更新（契约「display=no physics, requestDraw only」取舍，Obsidian 同）；② 拖滑块每 onChange 一次 savePrefs（blob 微小无 jank）。

**验证（As-built）**：typecheck 0 · `r78-e2e` **16/16**（parseGraphPrefs clamp/向后兼容/corrupt + 齿轮开合 + 4 力滑块+3 显示滑块+arrows 持久化 localStorage + reset 回默认 + sim-null 安全）· `r78-probe` **6/6** 真 WKWebView（`__geodeGraphPrefs` 校验）· `r26-bytes` 0（未碰渲染管线）· cargo build 绿 · 简化门 **clean**（slider 7 调用点 / applyForces 2 调用点 / GRAPH_RANGES 单一真值 / LABEL_ZOOM 死常量已删）。

## Round 77 additions — 块 ID 自动铸造 `^id`（候选池第五梯队【中】㊴）【As-built v0.74】

> **状态：As-built（v0.74 交付，2026-06-15）。** ㊴ = 给段落块创建引用时自动铸 `^id`：v1 = 「复制块引用」/「复制块嵌入」命令——对活动编辑器**光标所在段落块**，若无 `^id` 则铸一个 append 到块末行行尾，并复制 `[[Note#^id]]`/`![[Note#^id]]` 到剪贴板。**写 .md → data-safety 触发**（但走活动编辑器 `view.dispatch` = R40/R33 既有 B-class autosave 路径，非新写路径）。两道前置门：① grep 揭露 R13 已有 `BLOCK_MARKER_RE`/`blocks: BlockRef[]` 索引/`resolveSubpath`（全复用、冻结不动）+ 无「复制块引用」命令/无 `[[#^` 补全；② WebSearch 确认 Obsidian「Copy link to block」= 无块 id 时对光标段落自动铸短随机 id + 复制链接。

**不碰渲染/字节**：`^id` 已在 `markdown.ts:438` strip（阅读视图本就隐藏）→ append `^id` 后渲染 HTML 与无 id 段落**字节相同** → **r26-bytes/markdown.ts 不受影响**（本轮零改 markdown.ts）。

**关键设计（复用 R13 + 既有写路径，零新写机制）：**
- **`core/blockId.ts`（新，纯逻辑）**：
  - `blockRefAt(text, cursorOffset): { id, edit: {from,to,insert} | null } | null` — 定位光标所在块（段落近似：连续非空行向上下扩到空行/代码围栏边界），**复用 R13 frozen `BLOCK_MARKER_RE = /\s\^([A-Za-z0-9-]+)\s*$/`** 判末行是否已有 id（有→reuse，edit=null）；否则铸 id（collision-scan 全文 ids + retry）append ` ^id` 到末行行尾。**返 null（不可铸）**：空行 / 代码围栏内（standalone `^id` 行 Geode metadata 不索引=不可解析，故跳过）/ frontmatter 内（`parseFrontmatter().to` 守卫）。
  - `mintBlockId(existing): string` — `(Math.random().toString(36)+Math.random().toString(36)).replace(/[^a-z0-9]/g,"").slice(0,6)`（6 位 base36，repo 既有 `Math.random().toString(36)` 惯用法 workspace.ts:44，零新依赖；碰撞 retry）。
- **`features/editor/blockRefCommands.ts`（新）**：`copyBlockRef(app, view, embed)` — `blockRefAt(view.state.doc, cursor)` → null 则 notice「无可引用的块」；有 edit 则 `view.dispatch({changes: edit, userEvent:"input.blockid"})`（CM 事务→脏→autosave，**继承 R33/R40 B-class 写守卫 + getView 仅活动文件 DS-1**）；**链接经 `formatLink(metadata, path, path, {embed, subpath:"^"+id})`（评审 MAJOR 修，见下）→ null 则 notice「无安全链接」**（id 仍已铸入）→ `navigator.clipboard.writeText` + 自包含 notice。`registerBlockRefCommands(app, getView)` 注册 2 命令 `editor:copy-block-link`/`editor:copy-block-embed`（无默认热键，对齐 Obsidian）。
- **`core/linkFormat.ts formatLink` 加 `opts.subpath`（R77 additive，R72 契约扩展）**：subpath（如 `^id`/heading）在 resolve-back 验证 + unsafe-char 守卫后的路径文本之后以 `#` 注入（wikilink `[[inner#sub]]` / markdown `[d](href#sub)`）；默认 undefined→空，**R72 既有行为零变**（r72-e2e 26/26 绿）。
- **`core/i18n/dict.blockref.ts`（新）** + i18n.ts 接线：`cmd.copyBlockLink`/`cmd.copyBlockEmbed`/`blockRef.copied`/`blockRef.noBlock` 双语。
- **`app/App.tsx`**：`registerBlockRefCommands(app, () => getActiveFileEditorView(app)?.view ?? null)`（同 formatCommands 接线）。
- **`main.tsx`**：always-on sync 探针 `__geodeBlockRef(text, offset)` → blockRefAt（§D：DOM/剪贴板 browser-E2E only）。

**文件所有权（单 owner）**：先 `core/blockId.ts` → `blockRefCommands.ts` → dict + i18n + App.tsx 接线 → editor.css notice + main.tsx 探针 + e2e/probe。**冻结不动**：markdown.ts `BLOCK_MARKER_RE`/strip、metadata.ts blocks 扫描/resolveSubpath、types.ts BlockRef。

**⚠️ 已知延期（非缺陷，记 ㊴ 续）**：① **代码块/表格/列表项的块 id 不做**（代码块 standalone `^id` Geode metadata 不索引；段落近似对 list/table 是粗近似）；② 无 `[[#^` 补全里铸 id（v1 仅命令触发）；③ switcher 选块仍只列已有 id 的块（不铸）；④ embed `![[note#^id]]` 渲染由既有 R13 embeds 处理，本轮只产链接文本。

**对抗评审（reviewer 7 lens 各独立 + skeptic-verify + 运行实例实测复现）→ 1 确认 MAJOR + 2 minor + 证伪 7：**
- **CONFIRMED MAJOR = 块链接硬编码 basename `[[${name}#^${id}]]` 绕过 R72 `formatLink` 单一真值** → 三症状一根因（reviewer 在运行实例复现）：① **重复 basename**（`A/dup` + `B/dup`）→ 粘到别处解析到错笔记（块引用的根本用途是粘贴别处）；② **文件名含 `WIKILINK_UNSAFE=/[[\]#|^]/` 元字符**（macOS 合法 `Meeting [2024]`/`Q&A #notes`）→ 直接产损坏链接 `[[note]bracket#^id]]`/`[[meet #1#^id]]`；③ 忽略 R72 link-format 设置。**修 = 走 `formatLink(metadata, path, path, {embed, subpath:"^"+id})`**（resolve-back 验证 + unsafe 守卫 + 设置遵循；null→notice「无安全链接」，**`^id` 仍正确铸入活动文件**——铸入无缺陷，只是复制的链接文本要修）。**教训：任何「文件→链接」构造点必走 `formatLink` 单一真值（R72 注释明令），手拼 `[[basename]]` 必踩重复名/元字符/设置三坑**——这是 R72 单一真值契约的第 6 个构造点，新增即接。补 e2e：unsafe 文件名→不复制坏链（id 仍铸）+ unique→shortest。
- **minor ×2（已修）**：① `mintBlockId` 短随机非恒 6 位（`Math.random().toString(36)` 偶得 `"0.i"`）→ 改 `randomId` 循环累积到 ≥6 字符再 slice；② collision-scan 大小写敏感（与 R13 metadata `toLowerCase()` 不一致）→ `used.add(m[1].toLowerCase())`。
- **证伪 7**（data-safety 重点）：写回走 `view.dispatch`→`documents.ts` `local=true`→scheduleSave 置脏 + 关窗 flush 覆盖（铸了不丢）；getView 仅活动文件（DS-1，不写背景文件）；CRLF 经 `vault.normalizeContent` 统一 LF（append offset 无 `\r` 错位）；剪贴板失败 try/catch 吞掉、id 已先铸；frontmatter/fence 守卫正确；分层合规；探针唯一。

**验证（As-built）**：typecheck 0 · `r77-e2e` **14/14**（blockRefAt 段落铸/reuse/空行/围栏/frontmatter null + 命令铸 id 写 doc + 剪贴板链接 + 幂等 + embed + **unsafe 文件名不复制坏链 + unique shortest**）· `r77-probe` **6/6** 真 WKWebView+真 fs · `r72-e2e` **26/26**（formatLink subpath additive 不回退）· `r26-bytes` 0 violations（未碰渲染）· cargo build 绿 · 简化门 **clean**（showBlockNotice↔showExportNotice 跨 feature 不可抽取）。

## Round 76 additions — 任务自定义状态渲染（候选池第五梯队【中】㊳）【As-built v0.73】

> **状态：As-built（v0.73 交付，2026-06-15）。** ㊳ = 阅读视图把 `- [/]`（进行中）`- [-]`（取消）`- [>]`（推迟）`- [<]`（计划）等**非标准复选框态**渲染为带 `data-task` 的 checkbox 并区分样式（Obsidian + 主题约定）。**字节敏感**（动 `core/markdown.ts` 阅读侧 task rule）→ §C：改前已 `r26-bytes --baseline` 重捕（47 cases）。两道前置门：① grep 揭露 task 定义 4 处（渲染 `TASK_RE` 唯一仍窄 `( |x|X)`、toggle/search 已 R40/R68 收敛到 `[^\]]`、**live 走 lezer 硬编码 `[ xX]`**）；② WebSearch 确认 Obsidian `data-task` 约定（放 `<li class="task-list-item" data-task="<char>">`，主题用 `li[data-task="/"]` 选择器画）+ **「自定义复选框态在 live preview 不生效」= Obsidian 本身的限制**（这是阅读视图 + 主题特性）。

**v1 范围决策 = 阅读视图（reading）专属，live 延期**：理由 ① live 的 lezer `TaskList` parser 硬编码 `/^\[[ xX]\][ \t]/`（`@lezer/markdown`），`- [/]` **根本不产 Task 节点** → 支持需自写 lezer 扩展或并行行扫描，高成本高风险；② **Obsidian 自身 live preview 也不渲染自定义态**（WebSearch 证实）——阅读视图才是该特性的主场。故 v1 只做阅读侧，最贴近 Obsidian 行为。

**字节保守设计（关键）**：
- **`core/markdown.ts:195` `TASK_RE` 收敛**：`/^\[( |x|X)\]\s+/` → `/^\[([^\]])\]\s+/`（单个非 `]` 字符 + 空白；闭合 R68/R40 警告的「task 定义漂移」，4 处定义至此全 `[^\]]`）。
- **`is-checked` 判据修正**：`checked = m[1] !== " "` → `checked = m[1] === "x" || m[1] === "X"`（**仅 x/X 算 done**——否则收敛后 `[/]` 被误判 checked 而划删除线）。**对标准态 `[ ]`/`[x]`/`[X]` 字节零变**（`[ ]` 仍 not-checked、`[x]`/`[X]` 仍 checked）。
- **`data-task` 仅对非标准态 emit**：`mark` ∉ {space, x, X} 时 `tokens[i-2].attrSet("data-task", mark)`（markdown-it renderAttrs 自动 escapeHtml 值，`[<]`→`data-task="&lt;"` 安全）。**标准态不加 data-task → `[ ]`/`[x]` 阅读字节逐字节不变**（r26-bytes `list-task` 不变 0 violations）；`[/]` 等是新渲染（无 baseline，加 flagged 语料）。
- **不动 `<input class="task-checkbox">` 字节**（仅给 `<li>` 追加 data-task）→ `export.ts:33` 的 class 串替换、`compat/obsidian/util.ts:466`、`EditorPane.tsx:640` 点击委托全不受影响。

**CSS（区分样式，颜色走变量）**：
- `features/editor/editor.css` 阅读段：`li.task-list-item[data-task]` 通用（checkbox accent 边框=非标准态可见区分）+ `[data-task="-"]`（取消=muted + 文本 line-through）+ `/ > <` 等核心态。
- `features/export/export.css`：镜像同款（导出一致）。

**文件所有权（单 owner，字节敏感串行）**：先 `core/markdown.ts`（改后立即 `r26-bytes` 验标准态字节不变）→ editor.css/export.css → r26-bytes 语料 + e2e/probe。**复用既有 `__geodeRenderMarkdown` 探针**（渲染任意 md → HTML 串）测 data-task/is-checked，**无需新探针**。`core/format.ts`/`search.ts` 不动（已收敛）。

**⚠️ 已知延期（非缺陷，记 ㊳ 续）**：① **live preview 自定义态不渲染**（lezer 硬编码 + Obsidian 自身限制；live `[/]` 仍显文本）；② `data-task` 仅非标准态（标准态靠既有 `is-checked` 类，为字节稳定刻意如此——主题对自定义态用 `li[data-task]` 仍命中）；③ v1 CSS 只画核心态 `/ - > <` 的基础区分，富图标留主题/续轮；④ toggle 命令（R40 `[xX]→" "`、其它→`x`）不动。

**对抗评审（reviewer 7 lens 各独立 + skeptic-verify）→ 1 确认 MAJOR + 证伪 6：**
- **CONFIRMED MAJOR（R70 元教训复发）= 渲染侧收敛后漏了第 5 处 task 定义消费者「点击 toggle」。** 渲染 `TASK_RE` 放宽到 `[^\]]` 让 `[/]` 成为**可点击 checkbox**，但阅读视图点击 toggle 路径 `features/editor/preview.ts:17 toggleTaskOnLine` 仍用窄正则 `( |x|X)` → 点自定义态 checkbox **返回 null 静默死键**（R76 引入「看着能点、点了没反应」的坏交互）。**契约「task 定义 4 处」漏算这第 5 处**（markdown 渲染 + format toggle 命令 + search + live lezer + **阅读点击 toggle**）。**修 = `toggleTaskOnLine` 正则放宽 `( |x|X)`→`[^\]]` + flip 镜像 `format.ts toggleTaskStatus`（`x/X`→空、其余→`x`）**——**标准态 `[ ]`↔`[x]`/`[X]`→`[ ]` 行为逐字节不变**，自定义态 `[/]`→`[x]`（新）。补阅读视图点击 toggle e2e（点 `[/]`→源变 `[x]` + 点 `[x]`→`[ ]` 不回退）锁死。**教训：放宽一个「判定某行是不是 X」的正则 = 给该 X 的所有消费者喂新输入，渲染/toggle/search/导出逐个审，尤其「渲染让它可交互」会顺带激活交互消费者（点击 toggle）。**
- **证伪 6**：标准态字节隔离（r26-bytes `list-task` 0 violations，`[ ]`/`[x]`/`[X]` 渲染 + is-checked 逐字节不变）；data-task 值 escapeHtml 正确（`[<]`→`&lt;`/`[>]`→`&gt;`/`["]`→`&quot;`，无属性注入）；4 处正则（现 5 处）对齐 `[^\]]`；自定义态不 is-checked/不误划删除线（`[-]` 按设计 line-through）；下游 export.ts/compat/data-line 不破（仅给 `<li>` 追加属性、`<input>` class 串不变）；live 延期纯视图差异无数据风险。

**验证（As-built）**：typecheck 0 · `r26-bytes` **标准 `list-task` 0 violations**（48 cases，仅新增 flagged `list-task-custom`，证标准态字节零变）· `r76-e2e` **17/17**（自定义态 data-task+checkbox+非 done + 标准态字节稳定 + 负样本 multi-char/empty/非列表/无空格 + **阅读点击 toggle 自定义态→done + 标准态不变**）· `r76-probe` **8/8** 真 WKWebView · 回归 r26(embeds)12/12 + r35(brackets)25/25 + r68(search task)40/40 绿 · cargo build 绿 · 简化门 **clean**（editor.css↔export.css 自定义态块作用域/变量不同=两渲染面有意各一份不合并）。

## Round 75 additions — `query` 搜索结果嵌入代码块（候选池第五梯队【中】㊲）【As-built v0.72】

> **状态：As-built（v0.72 交付，2026-06-15）。** ㊲ = ` ```query ` 代码块 → 渲染为实时搜索结果列表（复用 `core/search.ts` 解析+执行），reading + live 双态。**字节敏感**（动 `core/markdown.ts` fence renderer）→ data-safety §C：改前已 `r26-bytes --baseline` 重捕（46 cases），改后仅 query fence 字节变、其余 fence 逐字节不变。两道前置门：① grep 确认零实现 + 摸清 search.ts API / markdown.ts fence 分派 / R55 liveBlockWidget 范式；② WebSearch 确认 Obsidian 核心 ` ```query ` = 搜索语法渲染成可折叠分组结果列表。**v1 范围**：分组到文件的可点击结果（`a.internal-link`）+ 总数 + 每文件匹配数；**行内匹配片段（snippet）延期**（见已知延期）。

**镜像 mermaid fence→占位→hydrate 范式（字节隔离）：**
- **`core/markdown.ts` fence renderer（:588）**：加 `lang === "query"` 分支（首词、大小写敏感，同 mermaid 判据）→ 产 `<div class="geode-query" data-query="${escapeHtml(src)}"><pre class="geode-query-source"><code>${src}</code></pre></div>`（占位，保留源码可见直到 hydrate 换实）。**其它一切 fence 落 `defaultFenceRule` 字节不变**（baseline 守卫）。
- **`core/queryEmbed.ts`（新）= 查询执行+渲染单一真值**：`runQueryBlock(raw, ctx: {vault, metadata}): Promise<QueryBlockResult>`（`parseSearchQuery` → error 短路；否则 `vault.getMarkdownFiles()` 逐个 `await vault.read` + `metadata.getMetadata` 组 `SearchInput`（tags 去 `#`、frontmatter.fields）→ `evaluateSearch` → 收集 matched 文件 + ranges.length 计数，按 path 排序）。`QueryBlockResult = { error?: string; total: number; files: { path; basename; count }[] }`。`renderQueryResult(el, result)`：清空 el（textContent 全程，杜绝 XSS）→ 错误 `.geode-query-error` / 否则 `.geode-query-count` 显计数（0 → t("query.empty") "No results"，**As-built：无单独 `.geode-query-empty` 类**）+ 有结果时 `.geode-query-results`（每文件 `.geode-query-file`>`a.internal-link[data-target=path]`+`.geode-query-filecount`）。**结果链接复用既有点击委托**（`a.internal-link[data-target=全路径]`，reading=EditorPane onPreviewClick / live=liveClickHandler，R71/mermaid 先例，**不扩 HydrateContext 签名**）。
- **`core/embeds.ts` hydrateEmbeds（:349）**：加 `hydrateQuery` pass——选 `.geode-query[data-query]`，每个 `await runQueryBlock(data-query, ctx)` → `renderQueryResult(el, result)`；push 进 `Promise.all` passes（:369）。嵌套 transclusion 经既有递归 hydrate 自动覆盖。

**live 预览（复用 R55/R57 机器，零新 widget 类）：**
- **`features/editor/liveQuery.ts`（新）**：`findQueryRanges(state)`（镜像 `findMermaidRanges`，`CodeInfo` 首词 `=== "query"`）+ `liveQuery(app, getPath)` = `liveBlockWidgets({ ranges: findQueryRanges, widget: (source, from) => new HydratedBlockWidget("cm-live-query", source, renderMarkdownToHtml(source, resolve), from, app, getPath) })`。`livePreview.ts:1418` 后注册 `liveQuery(app, getPath)`。
- **`features/editor/liveHydratedWidget.ts` 点击导航（共享 widget 小改）**：`toDOM` 的 mousedown 加 `a.internal-link` 分支——**As-built 订正（评审揭露冻结契约原方案不可实现）**：契约初稿写「`closest(".internal-link")` 后 `return`，交既有导航委托」，但 **live 全局点击委托 `liveClickHandler`（livePreview.ts:1318）只认 `.cm-live-mdlink`/`.cm-live-wikilink`，不认 `.internal-link`** → 只 return 会让 live 态 query 结果点击**无人接手成死链**。实现改为 widget 内**直接导航**：`const link = (e.target).closest("a.internal-link"); if (link) { e.preventDefault(); openWikilink(this.app, link.dataset.target, this.getPath()); return; }`（data-target=已解析全路径→openWikilink 必命中不误建笔记，R71 先例；`preventDefault` 保 widget 不被 reveal 撕掉）。**用 `a.internal-link`（锚点限定）比 `.internal-link` 更安全**：mermaid 的 `.internal-link` 是 SVG `<g>` 非 `<a>`（embeds.ts:200）→ 不误命中、mermaid live 行为零变。**普适正确**（任何 hydrated block 内的 anchor 链接点击都该导航非编辑），非链接点击仍进编辑；table 用独立 `TableWidget` 不受影响；r55/r56 回归绿。

**`core/queryEmbed.css`（或并入既有）**：结果列表样式，配色走 CSS 变量。**`main.tsx`**：always-on sync 探针 `__geodeQueryBlock(raw) => runQueryBlock(raw, {vault, metadata})`（§D：返 {total, paths}，DOM 渲染 browser-E2E only）。

**文件所有权（本轮单 owner，字节敏感顺序实现）**：先 markdown.ts（改后立即 `r26-bytes` 验隔离）→ queryEmbed.ts → embeds.ts → liveQuery.ts/livePreview.ts/liveHydratedWidget.ts → css/probe/calibration。

**⚠️ 已知延期（非缺陷，记 ㊲ 续）**：① **行内匹配片段（snippet）延期**——v1 只显文件链接+计数，不显匹配行高亮（`deriveLineHits`/`sliceLine` 现为 SearchPanel 私有；做 snippet 需下沉到 core 复用，留续轮）；② Obsidian 嵌入查询的渲染选项（collapse/sort/hide title/context）不做；③ 每个 query 块全 vault 扫描（多块 = 多次扫，同 SearchPanel 口径，v1 可接受）；④ 点击只跳文件不跳具体行。

**对抗评审（reviewer 7 lens 各独立 + 逐条 skeptic-verify）→ 0 critical / 0 major / 1 确认 minor（doc 一致性）+ 证伪 8 + nit 5：**
- **确认 minor（doc）= 私改冻结契约 mousedown 方案未上报 → 本节 As-built 已订正**（见上 liveHydratedWidget 段：契约的 `.internal-link`+return 不可实现，实现改 `a.internal-link`+直接 openWikilink，更安全）。无运行时缺陷。
- **证伪 8**：字节隔离（仅 `lang==="query"` 首词大小写敏感分叉，r26-bytes 0 violations，`Query`/`queryx`/`query extra` 不误判）；mermaid/math/table 零回归（table 用独立 TableWidget；mermaid `.internal-link` 是 SVG `<g>` 不匹配 `a.internal-link`）；无双重导航（reading 走 EditorPane 委托、live 走 widget 直接、全局委托不认 `.internal-link`）；SearchInput 构造与 SearchPanel 逐字段一致；XSS（全程 textContent/setAttribute + data-query escapeHtml 往返）；never-throws + trackConnectivity 脱离节点跳写；分层（queryEmbed 仅 import core、liveQuery 不 import 别 feature）；数据安全（零 .md 写、live widget contenteditable=false 纯视图）。
- **nit（记 ㊲ 续）**：① self-match（含 query 块的笔记自身 content 命中自己，同 Obsidian 预期）；② 每块全 vault 扫描（同 SearchPanel 口径，live 因 widget `eq()` 复用 DOM 不逐键重扫）；③ 根级 basename 与子目录同名的 resolveLink 最短路径回退（同 R71/Obsidian，罕见）。

**验证（As-built）**：typecheck 0 · `r26-bytes` **0 violations**（47 cases，仅新增 flagged `code-fence-query`，js fence 等逐字节不变=字节隔离）· `r75-e2e` **16/16**（runQueryBlock match/empty/error + reading 占位→结果 + reading 点击导航 + live widget→结果 + live 点击导航 passthrough + 错误 plate）· `r75-probe` **8/8** 真 WKWebView+真 fs（`__geodeQueryBlock` path/content/none/error/empty）· 回归 r34(search)15/15 + r55(live tables)15/15 + r56(live mermaid)13/13 + r26(embeds)12/12 绿 · cargo build 绿 · 简化门 **clean**（liveQuery↔liveMermaid 结构似但分派不同首词、合并需发明 lang 工厂泛型=STOP；queryEmbed↔SearchPanel 跨 core/feature 不可互 import；探针刻意独立）。

## Round 74 additions — Slides 演示模式（候选池第五梯队【中】㊱）【As-built v0.71】

> **状态：As-built（v0.71 交付，2026-06-15）。** ㊱ = 把当前笔记按 `---` 水平分页 → 全屏 overlay 逐页静态渲染 + 键盘导航（←/→/Space/Esc）+ 页计数。**极简自实现，零新依赖**（非 reveal.js，避硬边界#5）。**v1 纯静态只读**：不嵌 live 编辑、**不写 .md**、**绝不改 `core/markdown.ts`**（消费冻结的 `renderMarkdownToHtml`/`parseFrontmatter().to`，不触字节级管线 → 无 r18-diff/r26-bytes 风险）。两道前置门：① grep 确认 `features/slides` 零实现；② WebSearch 确认 Obsidian 核心 Slides（`---` 独立成行=分页符；←/→/Space 前进、Esc 停；命令「Slides: Start presentation」触发）。

**分层关键**：slides 属 `features/`，**绝不 import 别的 feature**（`features/editor/embeds.ts` 的 `hydrateEmbeds`/`getEmbedUrl` 不可用）→ 直接用 **`@core/markdown renderMarkdownToHtml`** + **`@core/embeds hydrateEmbeds`（core 版，吃 `HydrateContext`）** + 自建 `imageSrc`（`@core/markdown mimeForPath` + `vault.readBinary` + blob URL，slides 本地 cache，overlay 卸载时 `revokeObjectURL`——与 editor 的常驻 urlCache 生命周期不同，故不共享）。resolver 绑 metadata（`resolveLink`/`resolveAttachment`/`resolveMarkdownLink`，以活动笔记 path 为基），与 EditorPane preview 同款。

**新 `features/slides/`（本轮单 owner）：**
- `slides.ts`：`export function splitSlides(text: string): string[]` — 纯逻辑、零 React。**先 `parseFrontmatter(text).to` 剥 frontmatter**（否则 fm 围栏 `---` 被当分页符产幽灵页），再按**整行恰为 `---`**（`line.trim()==="---"`）切 body，**跳过代码围栏**（``` / `~~~` 内的 `---` 不分页）。恒返 ≥1 页（无分隔符=整篇一页）。v1 仅 `---` 分页（`***`/`___` thematic break 不分页，记已知偏差）。
- `SlidesOverlay.tsx`：`export function SlidesOverlay(): JSX.Element | null` — 取活动文本 `documents.get(workspace.getActiveFile())?.getText()`（实时含未保存），`splitSlides` 后渲染当前页：`renderMarkdownToHtml(page, resolveLink, {resolveEmbed, noteEmbeds:true, resolveMdLink})` → `dangerouslySetInnerHTML` → `useEffect` 调 core `hydrateEmbeds(pageEl, ctx)`（ctx.ancestors=`Set([activePath])` 防自嵌入循环）。**window keydown**（不靠焦点，避「需先点击」bug）：←/PageUp→上一页、→/Space/PageDown→下一页（`preventDefault`），Esc 由 App 全局 handler 关 modal（不自接，避双触发）。页计数 `n / total` + 关闭 X + prev/next 箭头。仅 `ws.modal==="slides"` 时挂载；无活动文件 → null。
- `slides.css`：全屏不透明 overlay（fixed + 高 z-index）+ 内容区复用 `.markdown-preview-view`/`.preview-content` 排版类，配色走 CSS 变量。
- `index.ts`：导出 `SlidesOverlay` + `splitSlides`。
- **testid 面（冻结）**：`slides-overlay`、`slides-page`、`slides-counter`、`slides-close`、`slides-prev`、`slides-next`。

**新 `core/i18n/dict.slides.ts`**：`en`/`zh` 双语，键 `cmd.startPresentation` + `slides.close`/`slides.prev`/`slides.next`/`slides.counter`（As-built：契约初稿写的 `slides.empty` 未用——v1 恒 ≥1 页无空态文案；实际加了 prev/next 按钮 aria）；在 `core/i18n.ts` import + 两处 spread（en/zh）。

**跨区接触点（先冻结再动）：**
- `core/types.ts:169` `ModalKind` += `"slides"`（`openModal`/`closeModal` 已吃任意 ModalKind，零改 workspace.ts）。
- `app/App.tsx`：① 命令注册段（~133）加 `commands.register({ id:"slides:start", name:()=>t("cmd.startPresentation"), available:()=>workspace.getActiveFile()!==null, callback:()=>workspace.openModal("slides") })`（无默认热键，对齐 Obsidian）；② modal 挂载段（~847）加 `{ws.modal==="slides" && <SlidesOverlay />}`。Esc 关闭白嫖既有全局 handler（App.tsx:591）。
- 版本三处对齐（package.json / tauri.conf.json / SettingsModal `APP_VERSION`）。

**⚠️ 已知延期（非缺陷，记 ㊱ 续）**：① 仅 `---` 分页（非 `***`/`___`）；② setext H2 下划线 `---`（紧贴文字行）按分页处理（v1 不区分，记偏差）；③ 无 fragment/incremental reveal、无垂直分页、无 speaker notes、无导出 PDF（社区 Advanced Slides 才有，非核心）；④ live 编辑/主题 reveal 样式不嵌。

**对抗评审（reviewer 6 lens 各独立 + 逐条 skeptic-verify，含 reviewer 自写 11 形态 splitSlides 实测 + focus 实测）→ 1 确认 MAJOR（数据安全底线#1）+ 证伪 8 + nit 4：**
- **CONFIRMED-1 MAJOR（数据安全）= overlay 不夺焦 → 演示时静默改写笔记。** 根因：`SlidesOverlay` 挂载时**从不把焦点移出底层 CodeMirror**——overlay 是叠加层（App.tsx 未隐藏 workspace，editor 仍挂载且持焦），slides 的 window-冒泡 keydown **只拦箭头/空格/翻页、不拦字符键**，且对箭头的 `preventDefault` 在冒泡顺序上发生在 CM contentDOM 监听器**之后** → 用户在不透明 overlay 后键入字符**静默插入当前笔记**（reviewer 实测 `"XYZ# Hello..."`）。可达路径：用户自绑 `slides:start` 热键从聚焦编辑器触发 / 直接 `openModal` / 命令面板后 Tab 走回仍挂载的编辑器。**修 = 挂载 `useEffect` 夺焦**（`(document.activeElement)?.blur()` + overlay 根 `tabIndex={-1}` `ref.focus()`）**+ keydown 拦 `Tab`**（`preventDefault` + 重夺焦，禁 Tab 走回编辑器）+ CSS `outline:none`。**套件假绿根因**：原 r74-e2e 走的正是「editor 持焦 + openModal」路径却从不断言文档未变 → 补**无变更不变式**（editor 聚焦→开 slides→`keyboard.type`→`documents.get().getText()` 必不变 + activeElement 非 cm-content）锁死。
- **证伪 8**（已实测）：splitSlides 11 形态全对（fm 剥离无幽灵页/```` ``` ````+`~~~`内`---`不切/未闭合 fence 吞到 EOF/`----`不切/CRLF 安全/恒≥1 页）；blob-URL cleanup 覆盖 in-flight load；imageSrc useCallback 不重复 readBinary；keyboard 函数式 setPage 无 stale；裸箭头/空格不撞修饰键命令（commands 守 defaultPrevented + editable）；分层仅 import @core+@app 用 **core** hydrateEmbeds；纯只读无 .md 写 + 未碰 markdown.ts（r26-bytes 0）；Esc 走 App 全局 window handler 不依赖焦点。
- **nit（记偏差，不阻塞）**：① hover 预览 z-index 60 < slides 200 → 演示中页内链接 hover 卡片被遮（read-only v1 可接受）；② 快速翻页时上一页 async hydrate 写脱离节点=无害浪费（被 GC）。

**验证（As-built）**：typecheck 0 · `r74-e2e` **23/23**（splitSlides 5 形态 + overlay 挂载/计数/←→翻页/clamp/prev-next disabled/按钮导航/Esc+close 关 + **数据安全无变更不变式 2** + 图片 embed 真 hydrate blob src）· `r74-probe` **7/7** 真 WKWebView+真 fs（splitSlides sync 探针 6 形态）· 回归 r26(reading-view)12/12 + r30(properties/modal)25/25 + `r26-bytes` **0 violations**（证未碰 markdown.ts）· cargo build 绿 · 简化门 **clean**（新 feature 5 文件 + 接线，无重复/死代码/脚手架；imageSrc blob 创建跨 feature 不可 import 故有意复制非可消除重复；探针刻意独立）。

## Round 73 additions — `cssclasses` frontmatter 应用到笔记视图容器（候选池第六梯队 ㊼ slice；㉟ 经前置门判 R22 已实现而出队）【As-built v0.70】

> **状态：As-built（v0.70 交付，2026-06-15）。** 两道前置门把 **㉟ Properties 类型化编辑** 判为 **R22 已实现**（PropertiesPanel 已按 `effectivePropertyType` 分派 number/checkbox/date/datetime/chips 控件 + 类型菜单 `propertyTypes.assign` + `.obsidian/types.json` 注册表 + buildSetProperty 写回；ROADMAP L1246「缺类型化编辑」描述失准）→ **出队**。本轮转做 ㊼「Properties 增强（细化 ㉟）」首条真缺口：**`cssclasses` 应用**——Obsidian 核心行为，把笔记 frontmatter 的 `cssclasses`（list/空格串/逗号串）作为 CSS 类加到笔记视图容器，供主题/CSS 片段（`compat/obsidian/themes.ts` 既有 CSS 注入）定向单笔记样式。**纯读 additive**：不写 `.md`、不动 markdown.ts（容器 className 不在 `previewHtml` 字节流内 → 无 r18-diff/r26-bytes 风险）、复用既有 frontmatter 解析。

**`core/metadata.ts` 新增导出（read-only helper）：**
- `getCssClasses(content: string): string[]` — `parseFrontmatter(content)` → 读 `cssclasses` 与遗留单数 `cssclass`（`fmField` 大小写不敏感）→ 各经 `asList`（标量逗号切）→ 每项再按空白 `\s+` 切（CSS 类 token 不含空白；支持「空格分隔串」形）→ 去空、去重、保序。无 frontmatter / 无该键 → `[]`。零写入、不进索引（仅供视图层即时读 live 文本）。

**`features/editor/EditorPane.tsx` 接线（2 处 className）：**
- `const cssClasses = useMemo(() => (handle ? getCssClasses(handle.getText()) : []), [handle, docRevision])` — `docRevision`（handle.revision 镜像，line 167–176）既在 live 也在 preview 随文本变更 bump → 编辑 frontmatter `cssclasses` 后容器类**即时更新**（无需保存/reindex；与 previewHtml 同源 getText()）。`cssSuffix = cssClasses.length ? " " + cssClasses.join(" ") : ""`。
- **应用容器（镜像 Obsidian DOM）**：① live/source = `.editor-cm-host.markdown-source-view.mod-cm6`（line 736，CM host div；CM 只管其 `.cm-editor` 子树，host 自身 className 由 React 安全 patch 不被 CM 覆写）；② preview = `.preview-content.markdown-preview-view.markdown-rendered`（line 776）。两者各 `className={基础串 + cssSuffix}`。主题写 `.markdown-preview-view.<class>` / `.markdown-source-view.<class>` 选择器即命中（迁移叙事：Obsidian 主题对 cssclasses 的 DOM 假设成立）。
- **不动**：`previewHtml`（dangerouslySetInnerHTML 内层，markdown.ts 产物）字节不变；outer `.editor-pane.workspace-leaf` 不加（Obsidian 加在 view 容器非 leaf）。

**⚠️ 已知延期（非缺陷，记 ㊼ 续）**：① **hover 预览 / embeds** 容器不应用 cssclasses（本轮限主 EditorPane 两模式，HoverPreview/embeds.ts 是独立渲染面，留 ㊼ 续）；② **导出**（若有）不应用；③ token **不做 CSS 标识符转义/校验**（Obsidian 同口径，原样 className；转义是消费 CSS 侧职责）。

**文件所有权（单 agent，无并行）**：`core/metadata.ts`（+1 导出函数）· `features/editor/EditorPane.tsx`（+useMemo +2 className）· `.calibration/r73-e2e.mjs` + probe（新）。无跨区签名冲突。

**桌面 probe（§D 纪律）**：首版 probe 用 `document.querySelector` 读容器 className → WKWebView App-Nap 下全 null（DOM 读不可靠，§D 明令查 Store/sync 逻辑而非 DOM，r71-probe 同口径「click 仅 browser-E2E」）→ 改为 always-on sync 探针 `__geodeCssClasses(path)=>getCssClasses(await vault.read(path))`（main.tsx，镜像 `__geodeRenderMarkdown`）：probe 读真 fs 文件 → token，证「real-fs frontmatter → tokens」路径；**DOM 应用（className 落容器）= 仅 browser-E2E**（平台无关 React，浏览器端已证）。

**对抗评审（reviewer 6 lens 各独立 + 逐条 skeptic-verify，含 reviewer 自写 CM keystroke 复核）→ 0 确认缺陷。** 关键证伪：① CM 不覆写 host className（host 在 JSX 无 children → React 只 patch className 属性，CM 只建 `.cm-editor` 子节点 → 零冲突，实测 keystroke 后 token 更新且 `.cm-editor` 子树存活）；② 纯读零写（不进 `previewHtml` 字节流 → r26-bytes 0 violations 证隔离）；③ className token 经 React `className` prop 赋值非 innerHTML → 无 XSS；④ docRevision 在 local 编辑/external reload 均 bump → live+preview 双态响应。**采纳 1 nit**：补 r73-e2e live 态容器响应性断言（原仅 preview 态 external-modify，现加 live cm-host 即时更新 + stale 移除，锁 headline 契约）。

**验证（As-built）**：typecheck 0 · `r73-e2e` **23/23**（list/空格串/逗号串/inline list/遗留 cssclass/去重/无 cssclasses 仅 base/preview+live 双容器/preview+live 双态响应性 stale 移除）· `r73-probe` **8/8** 真 WKWebView+真 fs（token 提取 6 形态）· 回归 r30(25 properties)/r26(12 reading-view)/r26-bytes(**0 violations**) 绿 · cargo build 绿 · 简化门 **clean**（diff ~46 行/3 文件：getCssClasses 已复用 parseFrontmatter/asList/fmField=减法形态；cssSuffix 2 真实调用点；6 个 `__geode*` 探针刻意各自独立=不去重）。

## Round 72 additions — 新链接格式设置 wikilink↔markdown × 最短/相对/绝对（候选池第五梯队【中】㉞-c；㉞ 整项完成）【As-built v0.69】

> **状态：As-built（v0.69 交付,2026-06-15）。** ㉞-c = 让用户选择**新建链接**的形态：链接类型（wikilink `[[..]]` vs markdown `[..](..)`）+ 路径形式（最短 / 相对 / 绝对）。**纯前端 additive**——只改链接**创建**，**不动**改写引擎（linkRewrite.ts）/渲染管线（markdown.ts），故无字节级 r18-diff/r26-bytes 风险（未碰 markdown.ts）。本轮上承前一会话已落地的 `linkFormat.ts` + 5 消费点接线，本会话补 unlinkedMentions 接线 + 对抗评审修 2 根因。

**`core/linkFormat.ts`（新）= 全部「文件→链接」构造的单一真值：**
- `linkUseMarkdown: Store<boolean>`（默认 false=wikilink）/ `linkPathFormat: Store<"shortest"|"relative"|"absolute">`（默认 "shortest"）+ `setLinkUseMarkdown`/`setLinkPathFormat`，localStorage 持久化（`geode.linkUseMarkdown`/`geode.linkPathFormat`），镜像 autoUpdateLinks/appearance 的 Store+setter+try/catch 模式。
- `formatLink(metadata, targetPath, fromPath, opts?: {embed?, alias?}): string | null` — 唯一构造入口。读两个 Store 现算。**契约**：无安全、resolve-back 验证过的形式 → 返回 `null`，调用方**必须跳过**（绝不插入坏链，镜像 internalDropSnippet）。
- **两道硬降级守卫**（Geode resolver 限制强加）：**(a)** wikilink + 相对 → 退最短（resolveLink 不能解析 `../`）；**(b)** embed → 永远 wikilink `![[..]]`（markdown `![](path)` 笔记/图片嵌入在 R71 不渲染，会静默不显示）。
- `wikilinkPath()`（内部，导出供潜在复用）：notes 用 resolveLink、附件用 resolveAttachment 验 resolve-back；最短=basename（解析回本文件）否则全路径；absolute=全路径；`WIKILINK_UNSAFE=/[[\]#|^]/` 命中→null。
- `markdownHref()`（内部）：relative=`relativePath()`（始终 `./`/`../` 前缀，否则 resolveMarkdownLink 当 vault-root/basename）、absolute=全路径、shortest=basename（解析回）否则全路径；resolve-back 验证（resolveMarkdownLink）失败回退全路径否则 null；`encodeMdHref` 末步编码。
- `encodeMdHref(path)`：`%` 先（避双编码）再 ` ()#?` → `%25 %20 %28 %29 %23 %3F`（沿用 R70 同集；`]` 不编码——href 组 `[^\s)]+` 容忍 `]`）。

**5 个「文件→链接」构造点接线**（R71 教训：加多消费点产出必逐个接全）：
1. `core/noteComposer.ts extractReplacement`：plain link 认 markdown 设置 `[name](name.md)`；embed 永远 `![[name]]`（守卫 b）。抽取笔记建在**源笔记同目录**（noteComposerCommands `parentPath(activePath)`）→ basename 必解析回（co-located），path-format moot。
2. `features/editor/attachments.ts internalDropSnippet`（拖 vault 文件入编辑器）：委托 `formatLink`（附件 `embed:!isMd`→守卫 b）。
3. `features/editor/cmExtensions.ts` `[[` 补全：用户已打 `[[` 故类型定死 wikilink，仅 path-format 生效（absolute→全路径，否则 basename 除非重名）。
4. **`core/unlinkedMentions.ts buildLinkInsert`（本会话补）**：markdown 模式 → `formatLink(metadata, activePath, sourcePath, {alias: surfaceText})`=`[surface](href)`，null→throw→skip+report（同 wikilink 契约）；wikilink 分支**逐字节不变**（默认零回退，含 surface-resolves 特例）。
5. `features/settings/SettingsModal.tsx`：toggle（`settings-link-use-markdown`）+ select（`settings-link-path-format`，最短/相对/绝对），CSS 变量 + `t()`。

**⚠️ 已知延期（非缺陷）**：① `attachments.ts` 粘贴/拖入**新建附件**嵌入恒用最短 wikilink（守卫 b 已定 wikilink，path-format 延期=避免对刚建文件走 formatLink 的 resolve-timing 写路径风险）；② `compat/obsidian/metadata.ts fileToLinktext`（faithful Obsidian shim，仅返路径文本）/ `buildCache`（重建**既有**链接 original 文本，须镜像文档现状非新建偏好）——均非新建构造点，正确不改。

**对抗评审（Workflow 9 agent / 4 lens：linkFormat 正确性 + 构造点完备 + 写路径数据安全 + 分层/UI/i18n；逐条 skeptic verify）→ 5 确认 0 证伪 → 去重 2 根因 + 1 注释：**
- **根因 ① MAJOR（3 lens 命中同一处）= unlinkedMentions 改写后校验用错 resolver。** 我加的 markdown 分支让 buildLinkInsert 产 `kind:"markdown"` 链接（href 经 `encodeMdHref` 含 `%20` 或 `../`），但 post-rewrite 校验（unlinkedMentions.ts:385）仍调 `metadata.resolveLink(link.target, sourcePath)`——**wikilink resolver 不 decode `%xx`、不解析 `./../`** → 凡笔记名含空格（或 `()#?%`）/相对路径 → resolveLink 查 `my%20note` 找不到 → `!==activePath` → throw → 逐文件 skip → **mention 静默不链接（headline 功能对常见名失效）**。**这正是 R70 已记录的反模式**（resolveByKind JSDoc：md href 用 wikilink resolver 丢锚点/编码/相对）。**修=`metadata.resolveByKind(link, sourcePath)`**（wikilink→resolveLink 逐字节同款；markdown→resolveMarkdownLink decode+解析相对）。**评审揭露 r72-e2e 自身遮蔽**：原套件只测 `Note.md`（唯一未编码 basename）= 唯一意外通过的组合 → 补 spaced-name + 跨目录相对 ambiguous-basename 两 linkAll 用例锁定。
- **根因 ② MAJOR = formatLink markdown 分支 display 无 `]` 守卫。** 目标 basename 或 alias 含 `]`（macOS/Linux/Obsidian 合法）→ `[a]b](a]b.md)` 经 MARKDOWN_LINK_RE 的 display 组 `[^\]]*` 在首个 `]` 截断 → **不可重解析 → formatLink 返回非 null 坏链，违反自身「null→跳过」契约**（resolve-back 通过因 `]` 是合法 fs 字符）。wikilink 分支对同输入安全（WIKILINK_UNSAFE 含 `]`→null）。**修=display 含 `]`→null**（对齐 WIKILINK_UNSAFE，href 组容忍 `]` 故只守 display）。可经 unlinkedMentions（alias=surfaceText）+ 拖文件触发。
- **注释 ③ NIT**：noteComposer extractReplacement 注释误称抽取笔记建在 vault 根（实为源笔记同目录）；行为正确（co-located 解析回），仅注释纠错。

**验证**：typecheck 0 · `r72-e2e` **26/26**（wiki/md × 最短/相对/绝对 × embed/alias + 编码 + 守卫 a/b + round-trip + unlinked mention 三态[Note/spaced/ambiguous] + extract 三态 + `]` 守卫三态 + 默认不变）· `r72-probe` **15/15** 真 WKWebView+真 fs（含 spaced-name resolveByKind 修复落盘）· 回归 r24(12)/r44(25)/r67(9)/r70(23)/r71(17) 绿 · cargo check/build 绿。**简化门 clean**（无 ≥8 行重复：wikilinkPath/markdownHref 在 resolver/扩展/编码/相对/unsafe 分歧，合并需加参数=STOP；无死代码；2 新 data-testid 合 57/57 设置控件 DOM 约定）。**顺手修**：本节所在文件 ARCHITECTURE.md 在 R70 文档轮被写入 1 个 NUL 字节（offset~16724，line 132 map-key 分隔符 `" "` 被 NUL 替换，致 grep/rg 视为二进制截断）→ `tr '\000' ' '` 复原。

## Round 71 additions — markdown 内部链接渲染 + 点击导航（候选池第五梯队【中】㉞-b）【As-built v0.68】

> **状态：As-built（v0.68 交付,2026-06-15）。** ㉞-b = 让 R70 已索引/已改写的 markdown 链接 `[text](note.md)` 在阅读视图 + live preview **渲染为内部链接并可点击导航**（R70 前只索引/改写，渲染端当外链不导航）。**改 `core/markdown.ts` 阅读视图管线 = 字节契约敏感**：数据安全 §C 纪律——改前 `r26-bytes.mjs --baseline` 重捕，改后 diff 仅 `md-link-internal`/`-sub` 两例变（标记预期），其余 44 例（external/attachment/unresolved/mailto md 链接 + 全部既有 markdown）逐字节不变。
> **关键设计：md 内部链接复用 wikilink 的渲染 + 点击机器**——anchor 用 `data-target = 已解析的 vault 全路径`（非裸 href），阅读视图点击委托 + live 点击都喂 `openWikilink(已解析路径)`，openWikilink 对完整路径 `resolveLink` 必命中 → openFile，**永不进 create-note 分支**。只对解析到 `.md` **笔记**的 md 链接产内部链接（`/\.md$/i` 门控）——附件 md 链接会让 openWikilink 的笔记-only resolver 误建笔记，故附件/unresolved/external 保持旧 `<a href>`（字节不变）。
> **架构卡点**：`renderMarkdownToHtml(source, resolve, opts?)` 只收一个 `resolve`（wikilink 解析器），markdown.ts 内拿不到 sourcePath/metadata → 新增 `RenderMarkdownOptions.resolveMdLink?: (href)=>string|null`，由**每个渲染调用点**绑 `metadata.resolveMarkdownLink(href, sourcePath)`（main.tsx `__geodeRenderMarkdown` / EditorPane renderPreview / compat util / **embeds.ts 转写** / **HoverPreview 卡片**——后两处评审补绑）。
> 验证：typecheck 0 · `r26-bytes.mjs` **0 invariant violations** · `r71-e2e.mjs` **17/17**（阅读+live 渲染/点击导航/根-绝对/角括号/Ctrl-点/相对）· `r71-probe.mjs` **8/8** 真 WKWebView · 回归 r23/r25/r26/r35/r55/r63/r70 绿。
> **简化门**：clean（字节锁定输出 + 契约注入点 + `.md` 门控/decode 皆承重）。
> **对抗评审（Workflow 3 lens byte-render/nav-createnote/adversarial-contract + verify）9 确认 + 3 partial → 修 5 根因 + 记 3 nit**：
>   - **Fix A（minor×2）= live Ctrl/Cmd-点内部 md 链接 window.open 裸路径**（而非导航）→ 内部 md 分支（有 data-link-target）**无视修饰键**走 openWikilink，window.open 仅在无 data-link-target（外链）时。
>   - **Fix B（minor×2）= live 内部 md 链接无 hover 预览**（hoverController.extractTrigger 缺 `.cm-live-mdlink` 分支）→ 加 `.cm-live-mdlink[data-link-target]` 分支（读 data-link-target/subpath，与 wikilink 并列）。
>   - **Fix C（minor）= 笔记转写 + hover 卡片渲染未传 resolveMdLink** → embeds.ts:312 + HoverPreview.tsx:187 补绑，使嵌入/卡片内 md 链接与主阅读视图一致可点。
>   - **Fix D（minor）= 角括号 `[x](<note.md>)` 双端不一致**（markdown-it 阅读视图剥 `<>`，live 不剥）→ livePreview 取 url 后剥一对 `<>` 再解析 + 写 data-url。
>   - **Fix E（MAJOR）= 根-绝对 `[a](/Z.md)` / 相对 href 被 basename 模糊解析到错笔记**（R70 `resolveMarkdownLink` 缺陷，R71 首次让其可点暴露）：`/Z.md` 从子目录解析到 `子目录/Z.md`。**修 = position-bearing href（`/`/`./`/`../` 前缀）走 EXACT 路径解析**（`lowerPathToPath` 精确查），bare basename 保持 resolveLink 最短路径行为。

### 契约（冻结，已纳评审修复）

**core/markdown.ts**：`RenderMarkdownOptions += resolveMdLink?: (href: string) => string | null`；`PreviewEnv += geodeResolveMdLink`；`link_open` 规则：非 external 非 placeholder href，`resolveMdLink(href)` 命中 `.md` 笔记 → 改写 token（`class="internal-link"` + `data-target=已解析路径` + `data-subpath=decode(锚点)` + `href="#"`），否则旧行为不变；`renderMarkdownToHtml` 设 `env.geodeResolveMdLink = opts?.resolveMdLink`。
**core/metadata.ts**：`resolveMarkdownLink` position-bearing 分支（`/`/`./`/`../` 前缀 → `lowerPathToPath` 精确查 `.md`，否则 resolveAttachment；bare → resolveLink ?? resolveAttachment）。
**features/editor/livePreview.ts**：Link 装饰对 `.md`-解析 href 加 `data-link-target=已解析路径` + `data-link-subpath`（剥 `<>` 后解析）；`liveClickHandler` 内部 md 链接（有 data-link-target）无视修饰键 openWikilink。
**features/hover/hoverController.ts**：`extractTrigger` 加 `.cm-live-mdlink[data-link-target]` 分支。
**调用点**：main.tsx / EditorPane / compat util / embeds.ts / HoverPreview.tsx 各绑 `resolveMdLink`。

### 已知偏差 / 待办
- **㉞-c（续）= 新链接格式设置**（wikilink↔md × 最短/相对/绝对），影响全部链接构造点——㉞ 最后一子轮。
- **内部 md 链接保留 `title=href` tooltip**（wikilink 无）——cosmetic（评审 nit），暂留（href 提示有用）。
- **渲染时刻已解析路径存进 data-target，目标随后被重命名/删除 → 点击落 create-note**——阅读视图随 metadata bump 重渲消除陈旧 anchor，实际窗口极窄（评审 nit）。
- **r26-bytes 基线陈旧则字节守卫静默失效**——流程脆弱性（`.calibration` 不入 CI），非代码 bug；每次改 markdown.ts 前必 `--baseline` 重捕。

## Round 70 additions — markdown 标准链接 `[text](note.md)` 重命名改写（候选池第五梯队【中】㉞-a）【As-built v0.67】

> **状态：As-built（v0.67 交付,2026-06-14）。** 验证：typecheck 0 · `r70-e2e.mjs` **23/23**（basename/path/anchor/titled/%20编码/wiki共存/external+self+code跳过/md图片嵌入延后/附件链接改写/folder移动/相对路径/**括号文件名编码/?query保留/锚点md链接算反链+图谱无幽灵节点**/wikilink回归）· `r70-probe.mjs` **9/9** 真 WKWebView 真实 fs · 回归 r44 25 / r47 11 / r28 23 / r62 14 / r66 8 / r24 12 绿。
> **简化门**：clean（verified-rewrite 机制全是承重，kind 分支操作不同语法，helper 有 rationale/≥2 调用点）。
> **对抗评审（Workflow 3 lens engine-datasafety/md-adversarial/contract-regression + verify）12 确认 + 6 partial + 0 证伪 → 修 5 根因 + 自查补 1 崩溃 + 记若干已知偏差**：
>   - **Fix A（major，3 lens 命中）= `encodeMdHref` 只编码空格**：重命名进含 `( ) # ?` 的文件名 → 构造的 href 在 post-rewrite reparse 被 `MARKDOWN_LINK_RE` 的 `[^\s)]+` 截断 / 误读为 anchor → 断言失败 skip，但文件已改名 → **悬空链接**（fail-safe 但合法文件名下产坏链）。**修 = 百分号编码 `% ( ) # ? 空格`**（`%` 先编码避免双编码；`normalizeMdHref` 的 `decodeURIComponent` 是逆）。
>   - **Fix B（major，最大涟漪面）= 下游 `meta.links` 消费者用 `resolveLink` 解析 md href**：R70 把 md 链接塞进 `meta.links`，但 `getBacklinks`/`getOutgoingLinks`/`getGraph`/compat `addLinkRows` 仍用 `resolveLink`（不 decode/不剥 anchor/不解析相对）→ 锚点/编码/相对的 md 链接被误判 unresolved → 图谱幽灵节点 + 反链缺失 + compat `resolvedLinks` 错桶。**修 = 新 `resolveByKind(link, fromPath)` helper**（md 走 resolveMarkdownLink，wiki 走 resolveLink），四处消费者统一改走。
>   - **自查补（review 没抓到）= `getGraph` 崩溃**：md 链接经 resolveByKind 可解析到**附件**路径（resolveMarkdownLink 兜底 resolveAttachment），但图谱节点只建 md 笔记 → `nodes.get(附件).degree++` 崩 `undefined`。**修 = 非笔记解析一律当幽灵**（与 wikilink→附件 既有行为一致）。本轮 e2e 的 graph 断言抓到。
>   - **Fix C（minor）= compat `CachedMetadata.links` 的 `original` 无 content 兜底对 md 链接造 `[[..]]` 形** → 按 kind 重建 `[text](href)`。
>   - **Fix D（minor）= `?query` 尾被丢**：anchor 提取只认 `#` → 改保留首个 `#`/`?` 起的整段尾巴（verbatim）。
>   - **Fix F（minor）= `normalizeMdHref` 相对解析不一致**（`sub/note.md` vault-根相对 vs `sub/../x.md` fromPath 相对）→ base 仅由前缀决定（`./`/`../`→fromPath、其余→根），`.`/`..` 段循环恒跑。
>
> ㉞ = 「链接格式策略 + markdown 链接改写」。**两道前置门**：① grep 确认整个链接索引层**只认 wikilink**（`WIKILINK_RE` 不匹配 `[text](path)`，`LinkRef` 无 kind，`resolveLink` 不解析 md 相对路径/锚点/编码）；② WebSearch 确认 Obsidian 核心：重命名同步更新 markdown 链接 + 「新链接格式」设置（wikilink/markdown × 最短/相对/绝对）。
> **㉞ 拆三轮（数据安全 + 体量，诚实分割）**：
>   - **R70（本轮，㉞-a）= markdown 链接重命名改写**：补 md 链接索引 + 解析 + 把 R16 五步引擎按 kind 分叉，使重命名/移动文件时 `[text](note.md)` 同步改写（关 R16 已知偏差「md 链接不改写」）。**纯数据安全核心，不动 markdown.ts 渲染字节**（不触发 r18-diff）。
>   - **㉞-b（后续）= md 内部链接渲染 + 点击导航**：阅读视图 `internal-link` + live `.cm-live-mdlink` 内部变体 + 接 `openWikilink`（动 markdown.ts → 触发 r18-diff 字节套件，单独一轮）。
>   - **㉞-c（后续）= 新链接格式设置**：wikilink↔markdown + 最短/相对/绝对，影响全部「文件→链接」构造点（cmExtensions/unlinkedMentions/attachments/noteComposer），additive，单独一轮。
>
> **关键设计：复用 R16 `linkRewrite.ts` 五步骨架，按 `LinkRef.kind` 分叉三处字面操作**（splice 校验 / 新文本构造 / 解析），不另起第二条引擎。md 链接解析走**新函数 `resolveMarkdownLink`（绝不改冻结的 `resolveLink`）**。R16 三根因纪律全部沿用（never-cache 读 `readFresh` / splice 字面校验 + post-rewrite 复解析双保险 / path-form only-fix-broken exact match / runTail 串行），**新增 external scheme 排除**（`https:`/`mailto:`/`//` 绝不当 vault 链接改写）。
>
> **新目标文本 = vault 根相对路径（绝对形）**：md 链接改写一律写 `cap.newFile` 的 vault 相对路径（保 `.md`、空格 `%20` 编码、保 `#anchor` + 文本 + `"title"`），**不做 basename 消歧**（无歧义 by construction，规避 stale-prefix bug；作者风格保留留给 ㉞-c 的格式设置）。

### 契约（冻结，实现照此）

**core/types.ts**：`LinkRef += kind: "wikilink" | "markdown"`（**必填**，唯一构造点 `parseNote`）。
**core/metadata.ts**：
- `MARKDOWN_LINK_RE = /(!?)\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+"[^"]*")?\s*\)/g`——`parseNote` 在 `masked` 上扫，`m[1]==="!"`（图片嵌入，延后）/ external scheme / `//` / `#`开头（纯锚点）→ skip；否则 push `{target:m[3], alias:m[2]||undefined, from:m.index, to:m.index+m[0].length, kind:"markdown"}`。wikilink push 加 `kind:"wikilink"`。
- `normalizeMdHref(href, fromPath): string | null`（新，public）——decode `%xx` + 剥 `#anchor`/`?query` + external/`//`→null + 前导 `/`=vault 绝对 + `./`/`../` 基于 fromPath 目录归一化（`..` 越过根→null）→ 返回 vault 相对路径字符串（**不查索引**）。
- `resolveMarkdownLink(href, fromPath): string | null`（新，public）——`const p = normalizeMdHref(...); return p===null ? null : (resolveLink(p,fromPath) ?? resolveAttachment(p,fromPath))`。
**core/linkRewrite.ts**：
- `CaptureEntry += kind: "wikilink" | "markdown"`；capture/rewrite 的 map key = `link.kind + " " + link.target.toLowerCase()`（避 wiki/md 同 target 串碰撞）。
- capture：md link 用 `resolveMarkdownLink` 命中 affectedMd/affectedAtt。
- rewrite：md 分支 = `stillResolvesMd`（path-form 用 `normalizeMdHref` exact 比对 cap.newFile，basename 用 resolveMarkdownLink）跳过未坏 → splice 校验 `^\[…\]\(…\)$` 头尾 + 提取 text/url/title + url 去 anchor 后 `normalizeMdHref` 须 === cap.oldFile → 重组 `[${text}](${encode(newRelPath)}${anchor}${title})` → 同一 post-rewrite 复解析断言（`resolveMarkdownLink(now.target)===expect`）。
- 冻结签名 `renameWithLinkUpdate`/`rewriteLinksForMerge`/`PlannedEdit` 不变；`__geodeRename` 钩子自动覆盖 md 链接（无需新钩子）。

### 文件所有权（chief 单 owner，数据安全核心紧耦合不并行）
`types.ts` + `metadata.ts` + `linkRewrite.ts` + `.calibration/r70-*`。

### 已知偏差 / 待办
- **md 图片嵌入 `![alt](img.png)` 不改写**（本轮只 link 不 embed）——重命名附件后 md 图片仍坏，记 ㉞ 后续。
- **md 内部链接当前不可点击导航**（渲染端未改）——㉞-b（动 markdown.ts → r18-diff，单独一轮）。
- **新目标用 vault 绝对形**，不保作者的相对/basename 风格——㉞-c 格式设置落地后再按偏好。
- **字面括号 href 不被索引**（评审 nit）：`MARKDOWN_LINK_RE` 的 href 组 `[^\s)]+` 在首个 `)` 截断 → 手写 `[x](file(1).md)`（字面括号）索引为残缺 target、重命名漏改。但 Obsidian 自身对 md href 里的括号做 `%28/%29` 编码（编码形 `file%281%29.md` 正常索引+改写，本轮 Fix A 已保证输出编码），故仅影响**手写未编码**的畸形 href。
- **嵌套图片在链接文本内**（评审 nit）：`[txt ![a](img.png) more](note.md)` 中内层 `![a](img.png)` 被当指向 img.png 的 md 链接（文本组 `[^\]]*` 在首个 `]` 截断）——罕见构造，字节安全（仅误命中），未修。
- **尖括号 href `[a](<my note.md>)` / 无扩展名裸 basename / 单引号 title 不索引**（评审 nit）：Obsidian 写 bare %20-编码 href + 双引号 title，这些变体罕见，未索引=重命名不改写，记偏差。
- **splice 校验 as-built = `url === link.target` 字节比对**（比原契约文字「normalizeMdHref(去anchor)===cap.oldFile」更严）——以实现为准。

## Round 69 additions — 全库标签重命名 `#old`→`#new`（候选池第五梯队【中】㉝）【As-built v0.66】

> **状态：As-built（v0.66 交付,2026-06-14）。** 验证：typecheck 0 · `r69-e2e.mjs` **36/36**（inline/nested/boundary/frontmatter array+scalar/code-skip/CJK/no-op/descendant-guard/invalid/open-buffer/junk-item/UI 右键 rename + 无效名守卫）· `r69-probe.mjs` **10/10** 真 WKWebView 实测真实 fs · 回归 r41 21 / r30 25 / r24 12 绿。
> **简化门**：2 net-negative（删两处不可达死分支——`newNorm===oldNorm`（line 111 已 return）、UI `newTag===tag`（已 return））。
> **对抗评审（Workflow 3 lens data-safety/adversarial-inputs/contract-layering-UI + verify）9 确认（多为 minor/nit）+ 2 partial + 4 证伪 → 修 3 根因 + 记 3 已知偏差**：
>   - **Fix A（minor, data-safety lens）= frontmatter 重写集 ⊄ 索引集**：引擎原用 `replace(/^#+/)` + 无空白守卫，但 `parseNote`（metadata.ts:243-248）索引 frontmatter tag 用 `replace(/^#/)` + 丢弃含空白/空项。后果：一个 `parseNote` 从不索引、用户在 Tags 面板看不到的垃圾项（`tags: ["a/b with space"]`）仍会被静默 xform。**修 = frontmatter map 逐字镜像 parseNote 的索引判据**（`replace(/^#/)` + `norm!=="" && !/\s/.test(norm)`）→ 重写集 ⊆ 索引集，绝不动用户看不见的 token（R68「对齐 N 处定义」教训的直接应用）。
>   - **Fix C（minor, contract lens）= 全跳过路径吞掉 skip 数**：`filesChanged===0` 分支只显 `renameNoop`，吞了 `res.skipped.length`（继承自 AllPropertiesPanel 同款）。**修 = 任何分支都拼接 renameSkipped**（R47「接部分失败报告必须消费 skipped」教训）。
>   - **Fix D（nit）= 死 import**：`fmField` 导入但实现内联了 case-insensitive 键查（`Object.keys().find()`），未用 → 删（简化门漏网的 SIMPLIFY-YES③）。
>
> ㉝ = 右键标签 → 全库重命名（含嵌套 `#old/sub`→`#new/sub` + frontmatter `tags:`）。**两道前置门**：① grep 确认 R41 TagsPanel 有标签**面板**但**无重命名**；R16 linkRewrite / R30 propertyRewrite 改写引擎已就绪（标签是另一类引用）；② WebSearch 确认 Obsidian 核心右键标签 → rename 全库（含嵌套）。**数据安全最高敏感轮**（批量改写 .md）。
>
> **关键决策：镜像 R30 `propertyRewrite.ts`（逐文件重构 edit），不是 R16 `linkRewrite.ts`（按 link.from/to 字节偏移）。** 理由：`TagRef`（types.ts:47）**只有 `from` 无 `to`**，且 inline 与 frontmatter 标签在同一 `tags: TagRef[]` 里**不可区分**（frontmatter 的 `from:0` 是哨兵）→ **不能**靠索引偏移做替换。必须在每个命中文件内**重新构造** edit：inline 部分用 `TAG_RE` 重扫 `masked` 现算偏移 splice，frontmatter 部分走 `properties.ts buildSetProperty` 重写 `tags:` 数组（**绝不手写 YAML**）。
>
> **五步算法（逐字镜像 R30 / R16 verified-rewrite 纪律）**：
>  1. **guards**：`oldNorm`/`newNorm` = `replace(/^#+/,"").trim()`；空 / `isValidTagName(newNorm)` 假 / `oldNorm===newNorm` / **`newNorm` 是 `oldNorm` 的后代（`newNorm.startsWith(oldNorm+"/")`，重命名进自己子树）** → 返回空结果（no-op）。
>  2. **capture（写前收敛）**：`await documents.flushAll()` → `await metadata.ensureFresh(getOpenPaths, p=>documents.get(p)?.getText())` → 遍历 `metadata.getAll()`，affected = `meta.tags.some(tagMatches)`。`tagMatches(t) = t===oldNorm || t.startsWith(oldNorm+"/")`（**大小写敏感**——`#Foo`/`#foo` 在 R41 面板即分列，逐变体重命名，可预测，不做跨大小写合并）。
>  3. **逐文件 verified rewrite（串行 runTail，never concurrent）**：真值源 = `documents.get(path)?.getText() ?? await vault.readFresh(path)`（**never cache**）。构造**合并** edit 组（一个 undo 步）：
>     - **inline**：`withoutFm = fm? " ".repeat(fm.to)+content.slice(fm.to) : content`；`masked = maskCodeRegions(withoutFm)`；`for m of masked.matchAll(TAG_RE)` 若 `tagMatches(m[2])`：`hashPos=m.index+m[1].length`；edit `{from:hashPos, to:hashPos+1+m[2].length, insert:"#"+newNorm+m[2].slice(oldNorm.length)}`（保留 `/sub` 尾）。**复用 metadata 导出的 `TAG_RE`**（同一正则=与索引器零分歧，R68「一个概念 N 处定义须对齐」教训）。
>     - **frontmatter**：`key` = `fields` 中 case-insensitive 命中 `tags`/`tag` 的实际键；`list = asList(fmField(fields,key))`；逐项 `norm = raw.replace(/^#+/,"").trim()`，命中 `tagMatches` 则换 `newNorm+norm.slice(oldNorm.length)`（**canonical 无 `#`**），未命中保留原项。`buildSetProperty(content, key, 标量则标量/数组则数组)`（保 arity；entryRoundTrips 自验）。
>     - inline edits（在 `fm.to` 之后）与 frontmatter edit（在 `[0,fm.to]`）**天然不相交**；合并按 `from` 排序。
>  4. **post-rewrite 复解析断言（never blind-write）**：对 `rewritten` 应用 edits 后 `parseNote(path,rewritten)`：① `after.tags.length === before.tags.length`（纯重命名零增减=防 splice 损坏）；② `!after.tags.some(tagMatches)`（旧命名空间全消——因禁后代故安全，无需大小写豁免）；③ `intended>0` 时 `after.tags.filter(newMatches).length >= intended`（新命名空间到位）。任一不符 → throw → per-file `skipped.push`，不停队列。
>  5. **apply**：open 文件 `handle.applyExternalEdits(sortedEdits)`（一次事务=一个 undo 步，触发 autosave）；closed 文件 `await vault.modify(path, rewritten)`（FNV 指纹抑回声）。无 types.json 步（标签非类型化键）。写盘 → `file:modified` → reindex → `metadata.revision` bump → TagsPanel `useStore` 自动刷新。

### 契约（冻结，并行实现照此）

**core/tagRewrite.ts（新建，纯 core）**：
```ts
export interface TagRewriteSkip { path: string; reason: string; }
export interface TagRewriteResult { filesChanged: number; tagsRewritten: number; skipped: TagRewriteSkip[]; }
export interface TagRewriteDeps { vault: Vault; metadata: MetadataIndex; documents: DocumentManager; }
export function isValidTagName(t: string): boolean; // 段为 TAG charset、单斜杠、无空段
export function renameTagAcrossVault(deps: TagRewriteDeps, oldTag: string, newTag: string): Promise<TagRewriteResult>;
```
- `tagsRewritten` = 改写的标签**出现次数**总和（inline + frontmatter）；`filesChanged` = 实际写/改的文件数。
- runTail 串行化（R16/R24/R30 先例）；fire-and-forget 内部 `.catch`。
- 只 import `vault/metadata/documents/properties`，**绝不** import features/app/compat。

**core/metadata.ts**：`export const TAG_RE`（原 module-private，加 `export` 供引擎复用——同一正则零分歧）+ `export function asList`（同）。**索引逻辑零改动**。

**core/i18n/dict.panels.ts**：新增 `tags.rename` / `tags.renamePrompt`（`{tag}`）/ `tags.renameDone`（`{old}{new}{changed}`）/ `tags.renameSkipped`（`{skip}`）/ `tags.renameNoop` / `tags.renameInvalid` / `tags.menu`（en + zh）。

**features/tags/TagsPanel.tsx + tags.css**：右键 `tag-row` → `MenuState{x,y,tag}`（照搬 AllPropertiesPanel 的 onContextMenu + click-outside/Escape，**feature 不 import feature 故复制逻辑**）→ menu（`data-testid="tag-menu"` / `tag-rename`）→ `doRename`：`window.prompt(renamePrompt, tag)` → 前端 `isValidTagName` + 非空非等非后代校验（失败显 `renameInvalid`）→ `renameTagAcrossVault(...).then(消费 res.skipped)` → 结果显 `tags-result`（`role="status"`）。

**main.tsx**：`__geodeRenameTag(oldTag,newTag) => renameTagAcrossVault({vault,metadata,documents},oldTag,newTag)`（镜像 `__geodeRename`；**避开 R34 `__geodeTag`/`__geodeRename` 占用**，R68 命名查重教训）。

### 文件所有权（并行）
| 区 | 独占文件 | 职责 |
|---|---|---|
| chief（主对话） | `tagRewrite.ts`（引擎）·`metadata.ts`（导出 TAG_RE/asList）·`dict.panels.ts`(i18n)·`main.tsx`(hook)·`.calibration/r69-*` | 数据安全核心引擎 + 接线 + 套件 |
| feature implementer | `features/tags/TagsPanel.tsx`·`features/tags/tags.css` | 右键 rename UI（照搬 AllProperties 菜单先例） |

### 已知偏差 / 待办（写给后续轮）
- **大小写敏感重命名**：`#Foo`/`#foo` 视为不同标签（R41 面板即分列），不做跨大小写合并——可预测、保守。Obsidian 实际大小写不敏感合并；未来若需可加。
- **frontmatter `tags:` 格式规范化**：命中文件的 `tags` 字段经 `buildSetProperty` 重序列化（inline `[a,b]` → block list；renamed 项写 canonical 无 `#`）——Obsidian 接受两种，记一句。
- **禁重命名进自己子树**（`old`→`old/x`）：guard 拒（no-op）；UI 显 `renameInvalid`。语义上是合法操作但 post-check「旧消失」断言会与之冲突，v1 不支持。
- **重命名进同文件已有兄弟会留 frontmatter 重复项**（评审 B，minor）：`tags:[a/x, a/y]` rename `a/x`→`a/y` 写出 `[a/y, a/y]`。**有意不去重**——去重需放弃强 `===` count 断言（数据安全轮的更差权衡），且 Obsidian 加载时自动合并重复 frontmatter tag（零功能损害）。post 断言全过（纯重命名，count 不变）。
- **引号标量含逗号被切分**（评审 P2，nit）：`tags: "a, b"`（引号标量内含逗号）经 `asList` 按逗号切成两项、引号语义丢失——但这与 `parseNote` 索引口径**一致**（索引也这么切），故重命名忠实于索引所见，罕见边界，不修。
- **右键菜单极窄窗口负坐标**（评审 F，nit）：`Math.min(x, innerWidth-200)` 无下界——`照搬` AllPropertiesPanel 同款 clamp（契约要求一致），正常桌面窗口不可达，不单独偏离先例去修。

## Round 68 additions — 搜索运算符扩展 `task:` 家族 + `[property]`（候选池第五梯队 ㉜）【As-built v0.65】

> **状态：As-built（v0.65 交付,2026-06-14）。** 第五梯队进【中】首项 ㉜——扩展 R21 冻结的零依赖手写搜索解析器（`core/search.ts`）。**两道前置门**：① grep 确认 R21 已实现 `file/path/content/tag/line/match-case/ignore-case`，但 `task*` 与 `[property]` 当年延后；② WebSearch 确认 `task:`/`task-todo:`/`task-done:` 与 `[property]`/`[property:value]` 均为 Obsidian **核心** search 运算符（非社区插件）。`section:`/`block:` **故意延后**——官方论坛证实它们在 Obsidian 与 `line:` 行为无差异（同行约束），低价值。
> **实现 = R21 解析器最小扩展（不破冻结 grammar）**：① `OPERATOR_RE` 加 `task-todo|task-done|task`（**长变体在前**，否则 `task` 先吃掉 `task-todo` 前缀）；② 新 AST 节点 `{type:"task",state,child}`（复用 `line:` 的行级机制——`splitLines` 惰性 + 每行 `TASK_LINE_RE` 判定 + state 过滤 + child 在行作用域内求值）与 `{type:"property",key,value}`（`parsePrimary` 见 `[` 时 `parseProperty`，对 `SearchInput.frontmatter` 做大小写不敏感键查 + 字符串/数组值子串）；③ `SearchInput += frontmatter?: Readonly<Record<string,string|string[]>>`，`SearchPanel` 从 `app.metadata.getMetadata(f.path).frontmatter.fields` 注入。`task*` 空操作数 = 「任意 task 行」（child=null）。**纯只读**（search 无写路径）；frontmatter 缺省时 property 谓词返回 NO_MATCH（line 552 守卫）。
> 验证：typecheck 0 · `r68-e2e.mjs` **40/40**（task: 家族 11 + 自定义状态 5 + property 11 + 否定/组合 3 + R21 回归 10）· `r68-probe.mjs` **16/16**（真 WKWebView via `__geodeSearchQuery` 纯函数 probe，App-Nap 安全）· 回归 r34 15 / r41 21 / r46 18 / r38 19 绿。
> **简化门**：applied 1 net-negative（task eval 分支扁平化——`const r = expr.child ? evalExpr(...) : MATCH_NO_RANGES; if (!r.matched) continue;`，去一层嵌套）。
> **对抗评审（Workflow 3 lens parser/evaluator/contract-faithful + verify）抓到 2 根因（1 minor×2 lens + 1 nit）+ 1 nit 文档化 → 修 2 改 1 记**：
>   - **根因①（minor, parser+evaluator 双命中）= `TASK_LINE_RE` 的 `[ xX]` 只认空格/x/X**，使自定义复选框态 `[/]`/`[-]`/`[>]`（Obsidian 视任意单字符为复选框）全部不算 task。**关键：这是与代码库自身的不一致**——R40 toggle 命令已**刻意**把 `core/format.ts` `TASK_BOX_RE` 放宽到 `[^\]]`（R40 As-built 明确修过这个「`[ xX]` 太窄」bug 并警告「多处 task 定义会漂移」），R68 等于**第 4 次重新引入窄形**。**修 = `[ xX]`→`[^\]]`**（与 R40 收敛 + 对齐 Obsidian；`done = box[1] !== " "` 既有逻辑天然给出正确切分：空格=todo、其余单字符=done）。`[]`（空盒）/`[ab]`（多字符）正确仍非 task（`\[([^\]])\]` 要求恰好一个非 `]` 字符）。
>   - **根因②（nit）= `[key:]` 空值经 `"".includes` 匹配任意值** → 行为等同 `[key]` 但语义含混。**修 = 空 rawVal 降级 `value=null`**（key-exists 分支），杜绝「空子串匹配一切」。
>   - **已知偏差（nit, 文档化不改码）= 裸 `[link]` 现按属性谓词解析**（R21 中是字面方括号文本）——这是本功能的预期语义（Obsidian 方括号属性语法）。**转义口**：`content:[…]`（fieldOp 用 `wordEnd` 整词读，不破方括号）或 `"[…]"`（引号字面）。三条 e2e 锁死该语义 + 双转义口。
> **核心元教训**：**「一行是不是 task」在本代码库已有 4 处定义（search `TASK_LINE_RE` / format `TASK_BOX_RE` / markdown 渲染 `TASK_RE` / live preview）——新增第 N 处前先 grep 既有的，对齐最宽的那个（R40 已把 `TASK_BOX_RE` 放宽到 `[^\]]` 认任意单字符复选框态），别默认 `[ xX]`**（默认窄形=与 toggle 命令/Obsidian 双重不一致，本轮 + R40 同源「task 定义漂移」）。渲染器 `markdown.ts` `TASK_RE` 仍是 `[ xX]`-only，作为**单独记录的待收敛缺口**（渲染只画勾叉，与搜索/toggle 的「认 task」语义可暂不同步）。

### 契约（交付即实现，已纳评审修复）

**core/search.ts**：① `TASK_LINE_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([^\]])\]/`（任意单非 `]` 字符为复选框态，收敛 R40 `TASK_BOX_RE`）；② `OPERATOR_RE` 含 `task-todo|task-done|task`（长变体在前）；③ AST：`| {type:"task";state:"any"|"todo"|"done";child:SearchExpr|null}`、`| {type:"property";key:string;value:{kind:"text";text:string;caseMode:CaseMode}|null}`；④ `parseProperty()`（`[` → `indexOf("]")`，无 `]`/空 key 返 null 降级为字面；空 value 留 `value=null` 即 key-exists）；⑤ `evalExpr` task 分支（惰性 `splitLines`，`done = box[1] !== " "`，child 在行作用域求值），property 分支（`ctx.input.frontmatter`，大小写不敏感键查，值 null→key-exists 否则字符串/数组子串）；⑥ `rebindField`/`rebindCase` task 递归 child、property 为叶（rebindCase 写 `value.caseMode`）。`SearchInput += frontmatter?: Readonly<Record<string, string | string[]>>`。
**features/search/SearchPanel.tsx**：hoist `const meta = app.metadata.getMetadata(f.path)`，`SearchInput` 加 `frontmatter: meta?.frontmatter?.fields`。
**main.tsx**：`__geodeSearchQuery(query, input)` probe（**改名避开 R34 `__geodeSearch` 对象碰撞**）——`parseSearchQuery` + `evaluateSearch` 跑合成 `SearchInput`，返回 boolean matched。

### 已知偏差 / 待办（写给后续轮）
- **裸 `[…]` = 属性谓词，非字面方括号文本**（R21 偏差）——转义口 `content:[…]` / `"[…]"`。OBSIDIAN-COMPAT 已记。
- **渲染器 `markdown.ts` `TASK_RE` 仍 `[ xX]`-only**——与搜索/format 的 `[^\]]` 待收敛（渲染只画勾叉，语义可暂分离）；未来若画自定义复选框态再统一。
- **`section:`/`block:` 未实现**——Obsidian 与 `line:` 行为无差异，低价值延后。
- **property 值仅字符串子串**——正则 / OR 子查询 / 数值比较（`[count:>5]`）是文档化后续。

## Round 67 additions — 拖拽 vault 文件入编辑器 → 链接/嵌入（候选池第五梯队 ㉛）【As-built v0.64】

> **状态：As-built（v0.64 交付,2026-06-14）。** 第五梯队 ㉛——**【小】项至此清空**，下一项进【中】㉜。**两道前置门**：① grep 确认外部文件摄入（R17 粘贴/拖图片入库）+ 文件树拖拽移动（R28）已在，但 **vault 内文件拖入编辑器生成链接** 是缺口；② WebSearch 确认 Obsidian 核心（help/drag-and-drop：拖文件入编辑器插入链接）。
> **实现 = 编辑器 drop handler（attachments.ts）识别 `EXPLORER_MIME`（核心共享 MIME，explorer dragstart 设、editor 读）**：① `dragover` 接管（explorer 拖只带 EXPLORER_MIME 无 text/plain → CM text-d&d 不接管 → 必须自己 `preventDefault`+`dropEffect="copy"`）；② `drop` 分支在外部文件分支**之前**：读 path → `internalDropSnippet` → sync `view.dispatch` 插入到落点（`posAtCoords ?? selection.head`）。**sync read+dispatch 无 await（无 R44 重入）**，纯编辑器内容插入走 autosave，不写 vault。explorer `effectAllowed` move→**copyMove**（编辑器 copy 光标；R28 tree-move 仍用 move，copyMove 允许）。
> 验证：typecheck 0 · `r67-e2e.mjs` **9/9**（note→[[Name]]/附件→![[name.ext]]/文件夹+未知跳过/纯插入/**重名消歧→全路径**/**特殊字符跳过**/dragover preventDefault）· `r67-probe.mjs` **4/4**（真 Tauri fs：fileExists 区分文件/文件夹——drop folder-skip 依赖它，Memory adapter 可能与真 fs 不同）· 回归 r28[tree drag-move]23/23 + r35 25/25 绿。
> **对抗评审（Workflow 3 lens + verify）抓到 1 主根因（3 lens 命中 major/minor）+ 1 major + nits → 修主根因**。**根因 = 把原始 basename 裸包进 `[[]]`**：① **重名消歧缺失**（3 lens：drop-correctness/dnd/datasafety 都命中）——`[[Spec]]` 在 `A/Spec.md`+`B/Spec.md` 共存时静默解析到错的那个（resolveLink 同名 tiebreak=同文件夹优先/sort 首个）；② **wikilink-unsafe 字符**（`[ ] # | ^`）——`Foo#Bar.md`→`[[Foo#Bar]]` 渲染器 wikilinkTarget 按 `#` 切→错目标（ARCHITECTURE R17 已记的同类限制；validateName 仅拒 `\`/`/`，故这些名合法可拖）。**修 = 复用全代码库的 fileToLinktext 规则（第 4 处：importAttachment/buildLinkInsert/linkRewrite/本轮）**：`internalDropSnippet(app, path, fromPath)` 取「解析回本文件的最短形」——basename 若 `resolve(base,fromPath)===path` 否则全路径；**且 form 含 wikilink-unsafe 字符则返回 null（不插，胜过插一个静默坏链——对齐既有 builder 的「必须可解析否则失败」哲学 + R17 限制）**。**nit 接受**：拖文件夹时 dragover 仍显 copy 光标（drop no-op 正确，仅光标；修需给文件夹加 MIME 标记=契约变更，不成比例）。**证伪**：拖拽落点 caret 反馈（CM 已有 dropCursor）。
> **核心元教训**：**「从文件名构造一个 wikilink」不是 `[[basename]]` 这么简单——它是 fileToLinktext 规则（解析回验 + 重名→全路径 + 特殊字符不可表达则不产出）**，全代码库已在 importAttachment/buildLinkInsert/rename 三处实现。**新写「文件→链接」路径前先 grep 既有的 linktext builder，照它的「解析验证 + 必须可解析否则失败」来，别裸包 basename**（裸包=静默错链/坏链，本轮 + R44 同源「文件名→链接是对抗输入」）。

### 契约（交付即实现，已纳评审修复）

**features/editor/attachments.ts**：`internalDropSnippet(app, path, fromPath): string | null`——`fileExists(path)` 否则 null；`isMd = base.endsWith(".md")`；`resolve = isMd ? resolveLink : resolveAttachment`；`form = resolve(baseForm)===path ? baseForm : resolve(fullForm)===path ? fullForm : null`；`form===null || /[[\]#|^]/.test(form)` → null；否则 `[[form]]`/`![[form]]`。`dragover` handler（EXPLORER_MIME → preventDefault + dropEffect copy + return true）。`drop` handler EXPLORER_MIME 分支（在 files 分支前，sync dispatch 到落点，传 `getPath()`）。import `EXPLORER_MIME` from `@core/explorerMove`。
**features/explorer/Explorer.tsx**：dragstart `effectAllowed = "copyMove"`（原 "move"）。

### 已知偏差 / 待办（写给后续轮）
- **wikilink-unsafe 名（`[ ] # | ^`）的文件拖入不插入**（返回 null）——同 ARCHITECTURE R17 wikilink 限制（全代码库 wikilink builder 共有）；未来若 Geode 支持 markdown 内链 `[name](path)` 可作 fallback（但 metadata 仅索引 wikilink，会失反链）。
- **拖文件夹 dragover 显 copy 光标**（drop no-op）——cosmetic；修需文件夹 MIME 标记（契约变更），接受 nit。
- **多文件拖拽**——explorer 单路径拖，故单插入；Obsidian 支持多选拖，未来若 explorer 多选拖再扩。

## Round 66 additions — 状态栏增强：后链数 + 选中字数（候选池第五梯队 ㉙）【As-built v0.63】

> **状态：As-built（v0.63 交付,2026-06-14）。** 第五梯队 ㉙。**分项 Gate 2**（官方 help 确认 Obsidian 核心状态栏显示「后链数 / 编辑器视图 / 字数」）：后链数 + 选中字数 = 核心 → 做；**光标行:列 = 非核心**（社区插件）→ **移除**（同 ㉔ smart typography 处理）。
> **实现 = 两个纯 view 状态栏项（零核心 API 新增）**：① 新 `backlink-count` 插件——`metadata.getBacklinks(path)` 提及总数，update on active-file:changed + **`metadata.revision.subscribe`（后链随任一笔记的链接变化，跨文件）** + locale；镜像 word-count 生命周期。② word-count 加「N selected words」——读 `documents.getActiveView()` 选区（sync，无文件读），`document:selection-changed` 刷新。**纯前端、零依赖、无 Rust、不碰 vault/document**。
> 验证：typecheck 0 · `r66-e2e.mjs` **8/8**（后链 1→2 跨文件编辑 / 0 后链 / 选中显示+撤选还原 / **打字覆盖选区清除残留**）· `r66-probe.mjs` **3/3**（真 fs/WKWebView：getBacklinks 提及总数 2、0）· 回归 r62/r24 绿。
> **对抗评审（Workflow 3 lens + verify）抓到 1 major 性能回归 + 2 minor，全本轮引入 → 全修**。**MAJOR（2 lens 命中）= 编辑器最热路径回归**：`document:selection-changed` 在**每次光标移动**（含空选区）都触发 → update() 落到 doc-count 路径 → 整篇 `countWords` + `setStatusBarItem`（旧实现每次 new Map + Store 通知**即使文本未变** → App 根**每次光标移动重渲**）+ `plugins.ts` **每次调用 push 一个 disposer（无界增长）**。**修**：① word-count 仅在**选区状态跃迁**时 update（`showingSelection` 追踪，跳过 empty→empty 纯移动）；② **根因修 `plugins.ts setStatusBarItem`**：文本未变则跳过 Store 写（免重渲）+ 仅新增项时 push disposer（免增长）——惠及所有状态栏插件（含 backlink-count 每次 revision 的 disposer 增长）。**minor**：① 打字覆盖选区在**同一事务**塌缩选区（只发 `document:changed` 不发 `selection-changed`）→ 残留「N selected words」→ 加 `document:changed` 监听（`showingSelection` 守卫，不扰常态打字）；② `requestToken` 在选中分支 early-return **之后**才 bump → 慢 doc 读可能覆盖选中显示 → **token bump 移到 update() 顶部**（每个入口都失效在途读）。
> **核心元教训**：**给一个高频事件（`selection-changed` 每次光标移动都发）挂 always-on 监听前，先问「空操作/无变化时它做了多少功」**——本轮无脑 `on(selection-changed, update)` 让每次方向键都整篇 countWords + 全 App 重渲。正确模式 = **状态跃迁门**（只在 empty↔nonEmpty 切换时动）+ **Store/setter 层去重**（值未变不通知）。对抗评审在「加一个状态栏项」这种小改动里抓到热路径 major，再次印证 diff 小不省评审 + 性能改动要想清触发频率 × 单次成本。

### 契约（交付即实现，已纳评审修复）

**core/plugins.ts** `ui.setStatusBarItem(id, text)`：文本未变 early-return（不写 Store）；仅当 item 新增时 push cleanup disposer（重复刷新不增长 `record.disposers`）。
**plugins/backlink-count.ts**（新）：`getBacklinks(path).reduce((n,b)=>n+b.contexts.length,0)` → "N backlinks"；update on active-file:changed + `metadata.revision.subscribe` + `locale.subscribe`（手动 unsub in onunload；Store.subscribe 不立即触发 → 末尾 update() 一次）。注册进 `plugins/index.ts`。
**plugins/word-count.ts**：update() 顶部 bump `requestToken`；选中分支（`getActiveView().path===active && !selection.main.empty` → "N selected words" + `showingSelection=true`）；`document:selection-changed` 仅在 `nonEmpty || showingSelection` 时 update（跳过 empty→empty）；`document:changed` 仅在 `showingSelection` 时 update（清残留）。
**i18n**：`plugin.wordCount.selected` / `plugin.backlinkCount{,.name,.desc}`（en+zh）。

### 已知偏差 / 待办（写给后续轮）
- **光标行:列状态栏项未做**——非 Obsidian 核心（社区插件），按使命不做。
- **后链数 = 提及总数**（sum of contexts，对齐 Backlinks 面板「Linked mentions」）——非「链接笔记数」；Obsidian 口径如此。
- **backlink-count 每 metadata.revision 跑 getBacklinks（O(vault links)）**——与 BacklinksPanel 同（但面板仅挂载时跑，状态栏常驻）；per-save 频率（非 per-keystroke），评审认可可接受；无 snippet 重算。

## Round 65 additions — Footnotes 脚注面板（候选池第五梯队 ㉘）【As-built v0.62】

> **状态：As-built（v0.62 交付,2026-06-14）。** 第五梯队 ㉘。**两道前置门**：① grep 确认脚注**解析存在**（markdown.ts R18 阅读视图渲染脚注）但**无 metadata 索引、无面板**（真缺口，同 ㉓）；② WebSearch 确认 **Obsidian 1.9 把 Footnotes view 做成核心插件**（核心非社区，做）。
> **实现 = metadata 索引 + 纯 view 面板**：① `metadata.ts` 镜像 headings 加脚注索引——`FOOTNOTE_DEF_RE` 行扫描 `[^id]:` on `masked`（排除围栏/frontmatter，offset 与原文对齐），content 从**原文** slice（保留 body 内联代码）；`NoteMetadata.footnotes` + `getFootnotes(path)`。② 新右栏 tab `features/footnotes/`（镜像 OutlinePanel/OutgoingLinksPanel）列 id+content，点击 `jumpTo` 定义（**复用 `geode:scroll-to-heading` 通用 offset 事件**，EditorPane clamp 后滚动，零新事件）。**纯前端、零依赖、无 Rust、不碰 vault/document（评审证伪写竞态）**。
> 验证：typecheck 0 · `r65-e2e.mjs` **12/12**（列 3 定义/围栏排除/**leading 内联代码保留**/计数/跳转/命令/空态）· `r65-probe.mjs` **6/6**（真 fs/WKWebView：getFootnotes 解析 3 定义、围栏排除、原文 content、leading-code 保留）· cargo release 真重建 · metadata 回归 r41/r62/r64/r24/r26-bytes 全绿（脚注索引纯加性，不动 links/tags/headings/blocks/render）。
> **对抗评审（Workflow 3 lens + verify）：1 根因（解析器是阅读视图脚注解析的子集 → 二者分歧）确认 → 部分修 + 部分记限制**。**根因 = R56/R57/R61「检测器须与渲染器对齐」再现**：metadata 脚注解析与 markdown.ts 冻结的 `geode-footnote-def`（R18 权威）规则不一致。**修（content 正确性，本轮做）**：body 以内联代码开头时丢失——原 `contentStart` 从 **masked** 的 `m[2]` 取偏移，贪婪 `[ \t]*` 吃掉 masking 留下的空格 → 漏首段代码。**改 = 从 `]:` 边界（id 字符集排除 `]`，首个 `]:` 即定义的）在原文 slice + trim**，不依赖 masked 内容组。**记为已知限制（本轮不修，proportionate）**：① 1-3 空格缩进的定义被漏（**保持 col-0 锚定 = 与 HEADING_RE/TAG_RE/BLOCK_MARKER_RE 同一代码库约定**，缩进标题同样被大纲漏，评审认可一致性）；② 多行续行 body 不合并（面板 CSS 单行省略号，多行显示价值低；完整 markdown-it 块续行镜像需复刻其 indent/blkIndent 语义，对罕见模式不成比例、且手抄镜像本身有漂移风险——空首行 `[^1]:\n  body` 退化为空 content 行，罕见）。**元教训**：「检测器镜像渲染器」当渲染器逻辑深绑框架（markdown-it 块状态）**无法干净抽取共享**时，权衡=修高价值/常见分歧（内联代码 content）、对低价值/罕见分歧（多行续行）记限制而非强行手抄镜像（手抄镜像可能引入新分歧，违背 lesson 初衷）。
> **证伪**：纯 view 无写（数据安全满足）、duplicate id 保留两条（面板列全部定义，可辩护）、跳转到定义（vs reference，可辩护）。

### 契约（交付即实现，已纳评审修复）

**core/types.ts**：`FootnoteRef { id; content; from }`；`NoteMetadata.footnotes: FootnoteRef[]`；`RightPanelKind += "footnotes"`。
**core/metadata.ts**：`FOOTNOTE_DEF_RE = /^\[\^([^\s[\]]+)\]:.*$/gm`（col-0 锚定）；parseNote 在 headings 后 `matchAll` on `masked`，`afterColon = m.index + m[0].indexOf("]:") + 2`，content 从原文 `content.slice(afterColon, lineEnd).trim()`；`footnotes` 入 return；`getFootnotes(path)` getter。
**features/footnotes/FootnotesPanel.tsx**（新）：`useApp`+`useStore(workspace.state)`+`useStore(metadata.revision)`；`getFootnotes(activePath)`；行 `^id` marker + content；`jumpTo(from)` = openFile + rAF + dispatch `geode:scroll-to-heading {path, from}`；空态。`footnotes.css`（`fn-` 前缀）+ `index.ts`。
**app/App.tsx**（4 处 + 命令）：import；effectiveRight 分支；tab（`data-testid="right-tab-footnotes"`，`Icon footnote`）；body 分支；命令 `app:show-footnotes`。**icons.tsx**：`footnote` 星号图标。**i18n**：`app.tabFootnotes`/`cmd.showFootnotes`/`footnotes.{title,empty,noFootnotes}`（en+zh）。

### 已知偏差 / 待办（写给后续轮）
- **1-3 空格缩进的脚注定义被漏**——col-0 锚定（与 headings/tags/blocks 索引同约定）；缩进定义罕见。未来若要可改 `^ {0,3}`（注意会引入「缩进 `[^x]:` 续行歧义」）。
- **多行脚注 body 续行不合并**——面板单行预览（CSS 省略号）；空首行 `[^1]:\n  body` 退化为空 content 行（罕见）。完整镜像需复刻 markdown-it 块续行语义。
- **跳转到定义行**（非 reference 标记）——v1；未来可加 reference offset 索引支持跳到引用处。
- **duplicate id 保留两条定义**——面板列全部（帮用户发现重复），阅读视图渲染第一条；面板=诊断视图，可辩护。

## Round 64 additions — Outline 内搜索过滤（候选池第五梯队 ㉗）【As-built v0.61】

> **状态：As-built（v0.61 交付,2026-06-14）。** 第五梯队 ㉗。**两道前置门**：① grep `OutlinePanel` 确认无过滤框（真缺口）；② **WebSearch 确认 Obsidian 核心 Outline 插件确有过滤栏**（非社区插件——与 ㉔ smart typography 相反，本项是核心，做）。
> **实现 = 纯 view 过滤**：`OutlinePanel.tsx` 新增 `filterRows(rows, query)` 纯函数（镜像既有 `buildRows`/`visibleRows` 同文件 helper 范式）——大小写不敏感 substring 命中标题，**显示命中 + 其祖先标题**（淡显 `is-ancestor`，保留层级上下文）**不含后代**（对齐 Obsidian：论坛证实其过滤不展开匹配项的子标题）。祖先回溯：对每个命中 index 向前走，加入 level 更浅的行并降低追踪 level（到 level 1 止）。`query` state 切文件清空；过滤时忽略 collapse（`display = filtering ? filtered.rows : shown`）、chevron 变 spacer、无匹配显示 `outline.noMatch`。**纯前端、零依赖、无 Rust、不碰 vault/document（评审证伪写竞态）**。
> 验证：typecheck 0 · `r64-e2e.mjs` **15/15**（过滤=命中+祖先不含后代 / 大小写不敏感 / 无匹配空态 / 清空恢复 / 过滤时跳转可用 / 切文件重置）· 桌面 = 纯 view 无平台面，binary build + **boot smoke r63-probe 4/4**（R64 frontend 在真 WKWebView 启动 + 编辑器栈完好）；浏览器 e2e 跑真 React 组件即双端权威 · 回归编辑器/面板套件不回退。
> **对抗评审（Workflow 3 lens + verify）：2 确认（minor+nit，均本轮引入）+ 10 证伪**。**确认①（minor）**：切文件时 `query` 在**被动 `useEffect`**（paint 后才跑）里重置 → 新笔记先用旧 query 渲染一帧 → 可能闪「无匹配」（React 「在 effect 里按 prop 变化重置 state」反模式）。**修 = `useLayoutEffect`**（DOM 变更后、paint 前同步重置，无闪；曾试 ref-guard during-render 重置但破了重置逻辑→回退到 useLayoutEffect，评审给的备选方案）。**确认②（nit）**：`.outline-item.is-ancestor .outline-label` 的 `color:faint`(0,3,0) specificity 高于 `.outline-item:hover`(0,1,0) → 淡显祖先 hover 不变亮（虽可点）。**修 = 加 `.outline-item.is-ancestor:hover .outline-label { color: var(--text-normal) }`**(0,4,0)。**证伪**：filterRows 祖先回溯逐边角正确（跳级/重名/level≠1 起首/深嵌套/注入全安全）、纯 view 无写、count 徽标显总数（可辩护）、无清除按钮/Escape 清空（可接受）、reset-on-file-change（与既有 collapse 重置一致）。
> **元教训**：**「切文件/换 prop 时重置 UI state」用 `useLayoutEffect`（或 React 的 during-render ref-guard 正式写法），不要用 `useEffect`**——被动 effect 在 paint 后才重置，会先渲染一帧「旧 state × 新数据」的错配（这里旧 query × 新文件标题 → 闪空态）。凡「派生自 prop 的 UI state 需随 prop 变化清零」，要么 during-render 重置（需严格 ref-guard，易错），要么至少 `useLayoutEffect`。

### 契约（交付即实现，已纳评审修复）

**features/outline/OutlinePanel.tsx**：新增 `filterRows(rows: OutlineRow[], query: string): { rows: OutlineRow[]; matched: ReadonlySet<number> }`（非导出，同文件 helper）。`query` useState；`useLayoutEffect([activePath])` 重置 collapsed + query。`filtering = query.trim() !== ""`；`filtered = useMemo(filterRows)`；`display = filtering ? filtered.rows : shown`。过滤输入 `data-testid="outline-filter"`（仅 activePath && rows.length>0 时渲染）；过滤时行 chevron→spacer、`is-ancestor` class 给非命中行、`display.length===0` → `outline.noMatch`。
**features/outline/outline.css**：`.outline-filter` 输入框 + `.outline-item.is-ancestor .outline-label`(淡显) + `.outline-item.is-ancestor:hover .outline-label`(hover 变亮)。
**i18n** `dict.panels.ts`：`outline.filterPlaceholder` + `outline.noMatch`（en+zh）。

### 已知偏差 / 待办（写给后续轮）
- **count 徽标过滤时仍显总标题数**（非过滤后命中数）——可辩护（总览），未来可改显 `命中/总`。
- **过滤框无清除(×)按钮 / 无 Escape 清空**——清空靠手删；Obsidian 同款够用，未来 polish。
- **无匹配空态无 `aria-live` 通知**——a11y 细节，未来 polish。

## Round 63 additions — 多光标 / 多选 foundation（候选池第五梯队 ㉕；㉔ 出队=非核心）【As-built v0.60】

> **状态：As-built（v0.60 交付,2026-06-14）。** 本轮含一个**faithfulness 纠正**和一个**功能**：
> **㉔ Smart typography 出队 = 非 Obsidian 核心**：WebSearch + 官方确认弯引号/em-dash/省略号自动转换是社区插件（mgmeyers/obsidian-smart-typography），**非核心**——与 `{{date+3d}}`（社区 Templater）同类，按「复刻 Obsidian 核心」使命**不做**。**这是「先验证是不是核心功能」的 faithfulness 门**（继 Step 0 grep「是否已实现」之后的第二道前置核查；R60 候选池误登记把社区功能当核心，本轮第二例）。
> **㉕ 多光标 = 2 行 foundation 解锁**：grep + derisk 确认 **真实缺口 = Geode 根本无法持有/渲染 >1 光标**（无 `allowMultipleSelections`、无 `drawSelection`）。命令早已全在 keymap：defaultKeymap `Mod-Alt-↑/↓` addCursorAbove/Below + `Escape` simplifySelection；searchKeymap `Mod-d` selectNextOccurrence + `Mod-Shift-l` selectSelectionMatches——皆因缺 foundation 而**静默 no-op**（R51「框架早给了，价值在解锁」同源）。**修 = buildEditorExtensions 加 4 个标准 CM6 扩展**：`EditorState.allowMultipleSelections.of(true)`（state 持多 range）+ `drawSelection()`（渲染每个 caret，原生只画一个）+ `rectangularSelection()`+`crosshairCursor()`（Alt-drag 列选）。**零新依赖、无 Rust、纯 view/selection 配置不碰写路径**。
> **Cmd+D 冲突的正确裁决**：`Mod+D` 被 `daily-note.ts` 占用（R33 拦截器先到）。一度以为要为 selectNextOccurrence 让位，**但 WebSearch 证实 select-next 是 Obsidian 社区插件非核心** → **保留 daily-note Mod+D 不动**（无 faithfulness 压力、避免跨 feature churn，R53）。selectNextOccurrence 按设计保持 shadowed。
> 验证：typecheck 0 · `r63-e2e.mjs` **8/8**（drawSelection 渲染 3 光标 / addCursorBelow+Above / 多点同时编辑 / Escape clean-path 收起到 1）· `r63-probe.mjs` **4/4**（真 WKWebView：allowMultipleSelections 持 2-range=2，control 无 facet=1）· cargo release 真重建 · 回归 r35 25/r51 10/r34 15/r55 15 全绿（编辑器栈 + 块装饰 atomicRanges 不回退）。
> **对抗评审（Workflow 3 lens + verify）抓到 1 个真实数据安全回归 → 已修**：interaction lens 确认 **fmField 的 Backspace 守卫只查 `selection.main`，而多光标可把一个 SECONDARY 空光标停在被保护的首行正文起点（blockTo+1）；`deleteCharBackward` 对每个 range 生效 → 副光标删掉 frontmatter 闭合 `---` 后的换行 → INT-3 frontmatter 损坏**。**这是本轮 foundation 引入的真回归**（R63 前无 allowMultipleSelections → 只有单 range → `.main` 即完整）。**修 = 守卫改查所有 range**（`selection.ranges.some(r => r.empty && r.head === end+1)`，单光标行为逐字等价）+ r63-e2e 加多光标 frontmatter 守卫用例锁死。其余 finding 非数据安全（markdown emphasis wrap + format/template 命令多光标下仅作用 `selection.main`——文本不丢、仅光标收起，预存行为，属未来「命令多光标化」polish）。**核心元教训**：**「无害的 foundation」会重新激活一个假设单光标的旧守卫**——凡开启 `allowMultipleSelections`，要 grep 所有读 `selection.main` 的**写/删路径守卫**（非纯读展示），逐个问「副光标停在这会绕过它吗」。对抗评审对「11 行启用标准扩展」这种看似 trivial 的改动**仍抓到真数据安全回归**，印证评审不可因 diff 小而省。**附（候选池失准）**：R60 把社区插件功能误登记为核心（㉔ smart typography、㉕ 的「Cmd+D select-next」）——「先 grep 是否已实现」之外还需「先核是不是 Obsidian 核心」（WebSearch/官方），两道前置门一起挡住「做 Obsidian 根本没有的东西」。

### 契约（交付即实现）

**features/editor/cmExtensions.ts** `buildEditorExtensions()`：在 `editorTheme` 后、`closeBracketsKeymap` 前插入 4 个扩展（`EditorState.allowMultipleSelections.of(true)` / `drawSelection()` / `rectangularSelection()` / `crosshairCursor()`）+ 从 `@codemirror/view` import `drawSelection, rectangularSelection, crosshairCursor`。无新命令（keymap 已全有）。
**features/editor/livePreview.ts**（评审修）：fmField 的 Prec.high Backspace 守卫（~L1358）从读 `selection.main` 改为 `selection.ranges.some(r => r.empty && r.head === end+1)`（+ `if (end < 0) return false` 早退）——多光标下任一空光标停在被保护位即吞掉整个 Backspace（保守、与 atomicRanges/changeByRange 的「全 range」语义一致）。单光标逐字等价。
**main.tsx** `__geodeMultiSel.held(allow:boolean):number` 探针——`EditorState.create` 带 2-range 选区，`allow` 决定是否挂 `allowMultipleSelections`，返回 `selection.ranges.length`（true→2 / false→1，control 对）。import 加 `EditorSelection`。

### 已知偏差 / 待办（写给后续轮）
- **格式化/模板/附件命令在多光标下仅作用于主选区**（formatCommands 等读 `selection.main`）——预存行为，未本轮多光标化（Obsidian 会对所有选区生效）；属未来「编辑命令多光标感知」项，非本轮 scope。
- **selectNextOccurrence（Mod-d）被 daily-note 命令 shadow**——按设计（select-next 非 Obsidian 核心；daily-note 是既有 Geode 绑定）。若未来要 select-next，需重绑 daily-note（用户/未来轮决策）。
- **鼠标加光标（Cmd/Alt+click）未配 clickAddsSelectionRange**——Obsidian 核心多光标偏鼠标；Geode 走键盘优先（Mod-Alt-↑/↓）。鼠标点击加光标 + 与 Mod+click wikilink 导航协调属未来 polish。Alt-drag 列选已可用。

## Round 62 additions — 专用「Outgoing Links 出链」侧栏面板（候选池第五梯队 ㉓）【As-built v0.59】

> **状态：As-built（v0.59 交付,2026-06-14）。** 第五梯队 ㉓。**先 grep 现状（铁律）**：出链**数据 + 显示早已存在**——`metadata.getOutgoingLinks()` + `BacklinksPanel` 内嵌「出链」分区（R24 起）。真实缺口 = Obsidian 把 **Outgoing Links 作为独立核心插件面板**（与 Backlinks 分开、可独立打开/切换），Geode 只把它折叠进组合反链面板。**第 5 次「候选池缺口」实为「部分已实现」**（Setext R54 / Setext-dim R55 / `%%` R58 / 粘贴URL·callout R60 / ㉓ 出链 R62）。
> **本轮 = 新增独立 Outgoing Links 右栏 tab**（镜像 OutlinePanel/BacklinksPanel 范式），复用现成 `getOutgoingLinks` 索引；**刻意不动组合 BacklinksPanel**（其出链分区是 Geode 既有便利 UX，重构组合面板哲学属未来项，非 ㉓ scope）→ 出链同时出现在两处 = 评审证伪为「可接受的 deliberate scoping」（Obsidian 用户也可同开 Backlinks + Outgoing Links 两栏）。**纯只读 view**，唯一写 = 点未解析链接 createAndOpen（与 BacklinksPanel 同款，评审数据安全 lens 证伪攻击面：`uniquePath`+`create` 不覆盖、路径守卫拦穿越、rejection 已 catch）。
> 验证：typecheck 0 · `r62-e2e.mjs` **14/14**（tab 开面板/resolved 进 Links·unresolved 进 Unresolved 红/计数 2:1/点击导航/命令重开/两种空态含真 no-active-file `ol-empty`）· `r62-probe.mjs` **5/5**（真 WKWebView：setRightPanel 持久化 + 真 fs metadata getOutgoingLinks resolved=[Alpha,Beta] unresolved=[Ghost Note]）· cargo release 真重建 · 回归 r30[allproperties]25/25 + r41[tags]21/21 面板切换不回退。
> **对抗评审（Workflow 4 lens + verify）：19 finding → 7 确认（全 nit/minor，0 critical/major）+ 12 证伪**。确认修：① 别名链接 `[[a|b]]` 应显示 `b` 非 `a`（对齐 Geode 自身 `display = alias || target` 约定，阅读视图/live 都这么做）；② 用自有 `outgoinglinks.*` i18n 键替代借用 `backlinks.*`（与「Section 组件刻意复制」同一 self-containment 原则）；③ dict.panels.ts 命名空间头注释补全；④ e2e 补真 no-active-file `ol-empty` 用例；⑤ 本节（契约 As-built）。**证伪**：createAndOpen 数据安全（无穿越/无覆盖/已 catch）、subpath `[[a#h1]]`/`[[a#h2]]` 折叠成一行（Obsidian 也按目标笔记去重）、两栏冗余（deliberate）、命令名措辞、Unresolved 分区恒显。
> **元收获**：候选池「缺口」第 5 次实为「部分已实现」——这次 Step 0 grep **救了大半轮**（直接发现 getOutgoingLinks + BacklinksPanel 出链分区已在，把 scope 从「从零做出链」收窄成「抽独立面板」）。「先 grep 现状」已从教训变成本轮**实际挡住返工**的流程。

### 契约（交付即实现，已纳评审修复）

**新增内置右栏面板（非 compat registerView）**：`features/outgoinglinks/OutgoingLinksPanel.tsx`（export `OutgoingLinksPanel`，panel id 字符串 `"outgoinglinks"`）。`useApp` + `useStore(workspace.state)` + `useStore(metadata.revision)`；`findActiveTab` → activePath（仅 markdown）；`getOutgoingLinks(path)` → 按 `resolvedPath ?? "unresolved:"+target.toLowerCase()` 去重 → 拆「Links」(resolved) + 「Unresolved links」(unresolved) 两分区。行：label=`alias || target`，title/dedup/click 锚 target/resolvedPath；resolved→`openFile`，unresolved→`createAndOpen`(`uniquePath`+`create`+`openFile`，catch 错误)。自带 `Section` 组件（分层禁 import 别的 feature）+ `ol-` 前缀 CSS。
**core/types.ts**：`RightPanelKind` 字面量扩 `"outgoinglinks"`，并把 `"tags"`/`"calendar"` 从 `(string & {})` fallback 提为显式字面量（**supersede R41 line 780 的「tags 留 fallback」决定**；纯加性、行为中性——`(string & {})` 早已使 union 非穷尽，无 switch 受影响）。
**app/App.tsx**（4 处 + 命令）：import；`effectiveRight` 三元链 +1 分支；右栏 tab `<button>`（`data-testid="right-tab-outgoinglinks"`，`Icon external-link`，`setRightPanel("outgoinglinks")`）；body 三元链 +1 分支；命令 `app:show-outgoing-links` → `setRightPanel("outgoinglinks")`。**app/icons.tsx**：加 `external-link` 图标。**i18n**：`app.tabOutgoingLinks` + `cmd.showOutgoingLinks` + `outgoinglinks.*`（title/empty/links/noLinks/unresolved/noUnresolved/createTitle/newBadge，en+zh）。

### 文件所有权（本轮单人独占）
- 新建 `src/features/outgoinglinks/`（OutgoingLinksPanel.tsx + outgoinglinks.css + index.ts）+ `src/app/App.tsx`（4 处+命令）+ `src/app/icons.tsx`（图标）+ `src/core/types.ts`（RightPanelKind）+ `src/core/i18n/dict.app.ts` + `dict.panels.ts` + `.calibration/r62-*` + 版本三处。

### 已知偏差 / 待办（写给后续轮）
- **出链显示在两处**（组合 BacklinksPanel 出链分区 + 新独立面板）——deliberate（不动既有组合面板）；真正的 Obsidian 偏差是「Backlinks 面板还带出链分区」，未来若做组合→拆分面板对齐再统一移除。
- **行 label 显示 `alias || target` 的原始 target（含文件夹路径如 `Notes/Welcome`）**，未规整成 resolved basename——与 BacklinksPanel 出链分区一致（Geode 既有约定），属未来「出链行规整」polish 项。
- **subpath 链接 `[[a#h1]]`/`[[a#h2]]` 按目标笔记折叠成一行**——与 Obsidian 一致（按目标去重），非缺陷。

## Round 61 additions — 图片嵌入尺寸 `![[img.png|200]]` / `|200x100`（候选池第五梯队 ㉒）【As-built v0.58】

> **状态：As-built（v0.58 交付,2026-06-14）。** 第五梯队 ㉒ = Obsidian 图片嵌入尺寸语法。官方语义（WebFetch obsidian.md/help/embeds 确认）：`|宽` 只给宽=等比缩放（高 auto）；`|宽x高` 设双维，分隔符**小写 `x`**；**仅图片**支持（video/audio/pdf 无此语法——FileEmbed 分支不动，对照评审 REFUTE）。
> **三态一致**：① 阅读视图 `markdown.ts` 占位 `<img … width="N" height="N">`；② 导出 `export.ts` **零改动**——复用同一 `renderMarkdownToHtml` 占位，`core/embeds.ts` hydrate 只设 `src`，width/height 原样继承（评审证伪「导出会丢尺寸」）；③ live preview `EmbedWidget` 加 `width?/height?` ctor 参数 + `eq` 比对 + `toDOM` 设 `img.width/height`。**核心去漂移**：reading 与 live **共用同一个 `parseEmbedSize` 解析器**（导出器思想——单一权威，两端永不分歧，R56/R57 教训延续）。
> **数字别名当尺寸、非数字别名仍当 alt**：`|200`→`width=200` 且 alt 回落文件名（Obsidian 同款）；`|caption`→`alt="caption"` 无尺寸（**字节级 r26-bytes 不变**）。**零新依赖、无 Rust、纯 view 不改文档**。
> 验证：typecheck 0 · `r26-bytes.mjs` **41 案 0 不变量违反**（非数字别名 `|caption`/`|200x`/`|wide`/`|999999` 字节恒等；`|200`/`|200x100` 改后**重捕基线 + 翻 non-media 锁死**，未来回归即违反）· `r61-e2e.mjs` **15/15**（阅读/live/导出继承/数据安全 doc 不变/边角）· `r61-probe.mjs` **8/8**（真 WKWebView 真 png）· cargo release 真重建 · 回归 r26[嵌入]/r57[live math]不回退。
> **对抗评审：1 根因确认修 + ~9 证伪/nit**。**确认（minor，3 lens 命中、2 verify 判 REAL）**：`parseEmbedSize` 用无上界 `Number(...)` → 巨数别名三端漂移——`Number("9".repeat(21))`→`"1e+21"`、~309 位→`"Infinity"`（阅读/导出发**无效 HTML 属性**→浏览器忽略=intrinsic）；而 live `img.width=N` 的 `unsigned long` IDL setter 走 ToUint32（mod 2³²，10 位即 clamp）→ 同一源阅读 intrinsic、live clamped。**修 = 解析器正则封 5 位 `\d{1,5}`（≤99999px,超任何显示器；< 2³² 且非指数 → 三端逐字节一致 by construction）**——6+ 位降级 alt 文本。**证伪**：video/pdf 尺寸（Obsidian 仅图片）/ caption 当 alt（正确）/ live alt=路径 vs reading=文件名（R11 旧坑,非本轮）/ 空白 trim（正确）/ CSS 不加 `height:auto`（**正确**——加了会破 `|200x100` 强制高）/ 导出继承尺寸（安全）。
> **元收获**：「检测/渲染要字节对齐」（R56/R57）推广到「**N 个渲染端共用一个解析器**」时，**解析器产出必须是所有端都等价接受的值域**——`Number()` 无界在「拼字符串」端（HTML 属性）与「赋 IDL 属性」端（ToUint32）对极端输入给出不同结果，单一权威也会漂移；用**输入约束（位数上限）**而非各端各自防御来收口，让一致性 by construction。

### 契约（交付即实现，已纳评审修复）

**core/markdown.ts**：新导出 `parseEmbedSize(alias: string): {width:number; height?:number} | null`——正则 `/^(\d{1,5})(?:x(\d{1,5}))?$/`（trim 后），非匹配返回 null（别名 = alt 文本）。`WikiLinkInfo` 加 `embedWidth?/embedHeight?: number`。图片分支：`size = parseEmbedSize(alias)`，命中则 `display` 回落 `inner.split("|")[0].trim()`（文件名）+ 设 embedWidth/Height。占位拼装：`width="N"`/`height="N"`（值为 parseEmbedSize 校验过的整数 → 无需 escape）。
**features/editor/livePreview.ts**：import `parseEmbedSize`；`EmbedWidget` ctor 加 `width?/height?`，`eq` 比对，`toDOM` 设 `img.width/img.height`；图片分支 `parseEmbedSize(m[1].slice(imgPipe+1))` 传入（与阅读侧同一别名抽取规则）。
**features/export/export.ts**：**不改**（继承占位的 width/height）。**CSS 不改**（`max-width:100%` 既有；`|宽` 高度默认 auto=等比；`|宽x高` 强制双维——加 `height:auto` 会破强制高，评审证伪）。

### 文件所有权（本轮单人独占）
- `src/core/markdown.ts`（parseEmbedSize + 图片分支 + 占位拼装）+ `src/features/editor/livePreview.ts`（EmbedWidget + 图片分支）+ `.calibration/r61-*` + `.calibration/r26-bytes.mjs`(+baseline 重捕) + 版本三处。**文档清理**：顺手剥 `ARCHITECTURE.md`/`HANDOFF.md` 各 1 个 NUL(0x00)+1 个 US(0x1f) 控制字节（R44/R46 教训那批，破 grep/diff——本轮 grep ARCHITECTURE 整段失灵才暴露；`tr -d` 逐字节核对行数不变）。

### 已知偏差 / 待办（写给后续轮）
- **6+ 位数字别名降级为 alt 文本**（5 位上限=99999px，超任何真实显示器；为「三端值域一致」让步极端输入的忠实度，纯展示可逆，源码不变）。
- **PDF 有独立 `#height=[number]` 子路径参数**（Obsidian PDF 专属，非 `|` 别名机制）——本轮未做，属未来 PDF 增强候选项，别与 ㉒ 混。
- **live preview `<img alt>` = 解析路径，阅读视图 = 文件名/caption**——R11 旧坑（EmbedWidget 自 R11/R26 即 `img.alt = resolvedPath`），非 R61 引入，未改（alt 在 live 通常不可见；改它需碰本轮 diff 外代码 + 可能动字节）。

## Round 57 additions — Live preview 跨行 `$$` 数学 + 共享 HydratedBlockWidget（#⑱）【As-built v0.57】

> **状态：As-built（v0.57 交付,2026-06-14）。** R32+ 候选池第四梯队 #⑱ live 渲染长尾。① 把 R56 mermaid 的「占位 + 异步 hydrate」widget 抽到共享 `liveHydratedWidget.ts` 的 `HydratedBlockWidget`（重构 liveMermaid 复用，r56-e2e 13/13 护航零回退）；
> ② 新 `liveMath.ts`：`$$…$$` **display 数学 live 渲染为 KaTeX**（R18 显式延后的「跨行 `$$` 仅淡显不渲染」缺口）。**关键**：lezer-markdown **无 `$$` 节点** → `findMathBlockRanges` 用**行扫描**（镜像 `core/markdown` 块 math opener/closer/inner-close 规则）+ **renderMarkdownToHtml self-check**（slice 必须渲染出 `geode-math-block` 才纳入 → 渲染器为权威，检测永不与阅读视图分歧，R56 教训）。复用 hydrateEmbeds 的 math pass（KaTeX）。**零新依赖、无 Rust、纯 view 不改文档**。
> 验证:typecheck 0 · `r57-e2e.mjs` **19/19**（7 纯检测[边角:single/inner-close/无闭合/inline] + 8 live widget[**异步 KaTeX headless 真出**/揭示/源码不变] + 4 D1 缩进守卫）· `r57-probe.mjs` **9/9** · cargo release 真实重建 38s · 回归 r56[重构]/r55/r51/r52/r35/r33/r24/r29 不回退。
> **评审 1 minor 修 / 11 维证伪**（重构等价、扫描=渲染器一致[18 输入实测]、slice-vs-context[仅 blockquote 安全方向]、data-safety[零修改/无锁死/无 XSS]、R18 行染色与 R57 widget 干净分工）。**D1（minor）**：列表内缩进 `$$` 的 range 永远=`line.from`（行首）→ 行首守卫对 math 失效 → 被 widget 化（违反「嵌套→源码」契约，与 tables/mermaid 不一致）→ **修=opener 要求 `indent === 0`**（真顶层；缩进 1-3 math 降级源码）。

### 契约（交付即实现，已纳评审修复）

**features/editor/liveHydratedWidget.ts（新，共享）**:`HydratedBlockWidget(cls, source, html, from, app, getPath)` extends WidgetType（toDOM = `div.cls` + innerHTML=占位 html + `void hydrateEmbeds(wrap, app, getPath())` 异步渲染 + mousedown 揭示；eq 比 cls+source+from；ignoreEvent=false）。mermaid + math 共用（仅 cls/testid 不同）。
**features/editor/liveMermaid.ts（重构）**:widget 改用 `new HydratedBlockWidget("cm-live-mermaid", ...)`。
**features/editor/liveMath.ts（新）**:`findMathBlockRanges(state)` 行扫描——**opener `indent === 0`（D1 修）且 trim 起始 `$$`**；inner-close（`$$x$$ foo` 排除）；single-line `$$x$$`；多行扫到结尾 `$$` 行（遇 fence opener 中止）；**renderMarkdownToHtml(slice).includes("geode-math-block") self-check**。`liveMath` = `liveBlockWidgets({ ranges: findMathBlockRanges, widget: new HydratedBlockWidget("cm-live-math", ...) })`。
**livePreview.ts**:`liveMath` 接入。**main.tsx**:`__geodeMath.ranges/placeholder` 探针。**editor.css**:`.cm-live-math`。

### 文件所有权（本轮单人独占）
- `src/features/editor/liveHydratedWidget.ts`（新）+ `liveMath.ts`（新）+ `liveMermaid.ts`（重构）+ `livePreview.ts`（接入）+ `src/main.tsx`（探针）+ `editor.css` + `.calibration/r57-*` + 版本三处。

### 已知偏差 / 待办（写给后续轮）
- **缩进 1-3 的 `$$` 数学块 live 显示源码**（D1 修：仅 `indent===0` 顶层 widget 化；阅读视图仍渲染——一致于「嵌套/缩进→源码」，同 tables/mermaid 行首守卫）。blockquote 内 `$$`（行首 `>`）本就不被扫描。
- **self-check 每候选 renderMarkdownToHtml**（doc/selection 变更时；无 `$$` 文档零 render，3000 行+500 块 ~1ms）——v1 可接受。
- **theme 切换后已渲染 widget 不重渲染**（同 R55/R56）。
- **#⑱ live 渲染长尾仅剩 `%%` 注释隐藏**（其余:Setext 折叠 R54 / 表格 R55 / mermaid R56 / `$$` 数学 R57 均完成）。`%%` 可复用 liveBlockWidget（block `%%…%%`）+ inline mark-hide。

## Round 56 additions — Live preview mermaid + 共享 block widget 抽取（#⑱）【As-built v0.56】

> **状态：As-built（v0.56 交付,2026-06-14）。** R32+ 候选池第四梯队 #⑱ live 渲染长尾。① 把 R55 live 表格的 cursor-aware block widget 机制**抽到共享 `liveBlockWidget.ts`**（重构 liveTables 复用，r55-e2e 15/15 护航零回退）；
> ② 新 `liveMermaid.ts`：` ```mermaid ` 围栏在 **live preview 渲染为图**（R19 显式延后的「live mermaid 需 StateField 跨行 replace」正是 R55 范式）。**复用阅读视图管线**：`renderMarkdownToHtml` 出 `.geode-mermaid` 占位 → `hydrateEmbeds` 异步渲染 SVG（含 R19 的 `mermaidBatchChain` 全局串行链 → 多 widget 不并发串图）。**零新依赖、无 Rust、纯 view 装饰不改文档**。
> 验证:typecheck 0 · `r56-e2e.mjs` **13/13**（5 纯检测/占位 + 8 live widget[渲染**异步 SVG** headless 真出/揭示/源码不变/无报错]）· `r56-probe.mjs` **7/7** · cargo release 真实重建 38s · 回归 r55[重构]/r51/r52/r35/r33/r24/r29 不回退。
> **评审 0 真缺陷 / 5 维全证伪**（重构等价[r55 15/15]、检测=渲染器判定一致[仅 1 安全方向偏差]、异步水合并发[`mermaidBatchChain` 串行实测 2 图无串色]、data-safety[零文档修改/无锁死/无 XSS]、分层）。

### 契约（交付即实现）

**features/editor/liveBlockWidget.ts（新，共享）**:`liveBlockWidgets(spec: { ranges(state), widget(source, from) })` = StateField（create/update[`docChanged||selection` rebuild 否则 `value.map`] + provide decorations+atomicRanges）。`buildDecos`：`spec.ranges` → **行首守卫**（`from !== lineAt(from).from` 跳过=非行首[blockquote/list/缩进]块降级源码）→ selection 相交跳过（揭示）→ `Decoration.replace({block:true, widget})`。**block 装饰必须 StateField（R55 踩坑：ViewPlugin block 装饰崩 RangeSet.spans）**。
**features/editor/liveTables.ts（重构）**:保留 `findTableRanges`（探针）+ `TableWidget`（eq 比 source+from+html）；`liveTables` 改用 `liveBlockWidgets({ ranges: findTableRanges, widget: ... renderMarkdownToHtml ... })`。
**features/editor/liveMermaid.ts（新）**:`findMermaidRanges`（syntaxTree 取 `FencedCode` 且 `node.getChild("CodeInfo")` 首词 `split(/\s+/)[0]==="mermaid"` 大小写敏感——镜像 core/markdown fence renderer 判定，**缺 `unescapeAll`** = 仅 HTML-实体 info 检测窄[安全方向，显源码]）。`MermaidWidget`（toDOM = `.geode-mermaid` 占位 innerHTML + `void hydrateEmbeds(wrap, app, getPath())` 异步 SVG + mousedown 揭示；eq 比 source+from[占位由 source 确定]）。`liveMermaid` = `liveBlockWidgets`。
**livePreview.ts**:`liveTables` + `liveMermaid` 接入 `livePreview()`（仅 live 模式）。**main.tsx**:`__geodeMermaid.ranges/placeholder` 探针。**editor.css**:`.cm-live-mermaid`。

### 文件所有权（本轮单人独占）
- `src/features/editor/liveBlockWidget.ts`（新）+ `liveMermaid.ts`（新）+ `liveTables.ts`（重构）+ `livePreview.ts`（接入）+ `src/main.tsx`（探针）+ `editor.css` + `.calibration/r56-*` + 版本三处。

### 已知偏差 / 待办（写给后续轮）
- **theme 切换后已渲染的 live widget（mermaid SVG / table）不即时重渲染**（StateField 只在 doc/selection rebuild，eq 复用缓存 DOM）——与既有 EmbedWidget 同类限制。
- **HTML-实体 info（如 `` ```mermaid&#32; ``）的 mermaid fence 检测窄 → 显示源码**（检测器缺 `unescapeAll`，安全方向，exotic）。
- **嵌套（blockquote/list）mermaid fence 不 live 渲染**（行首守卫降级源码，同 R55 表格）。
- **#⑱ 余项可复用 `liveBlockWidget`**（`spec.ranges` 是任意函数，不限 syntaxTree 节点）：跨行 `$$` 数学[katex，`$$` 可能需 scan-based ranges 非 lezer 节点]、`%%` 注释隐藏。

## Round 55 additions — Live preview 表格（live tables，#⑱）【As-built v0.55】

> **状态：As-built（v0.55 交付,2026-06-14）。** R32+ 候选池第四梯队 #⑱ live 渲染长尾。GFM 管道表格在 **live preview 渲染为真 `<table>`**（复用阅读视图 `renderMarkdownToHtml`）——
> **Geode 首个 cursor-aware block-replace widget**（ARCHITECTURE R18/R19 标注的「块级跨行 replace 需 StateField」缺口的首次落地）。**零新依赖、无 Rust、纯 view 装饰不改文档**。
> **两个探明前的过时假设被 derisk 证伪**（动手前先测）：① Setext 标题 live **样式早已有**（lezer heading tag→cm-md-h1/2）、下划线 `===` 与 ATX `#` **同样是 `cm-md-h1 cm-md-mark`**（一致，无精修可做）→ 弃 Setext-dim；② 改取 live 表格。
> **关键 CM 约束（踩坑）**：block-replace 装饰**必须经 StateField，不能经 ViewPlugin**（ViewPlugin 提供 block 装饰 → 初次 DocView update 时 `RangeSet.spans` **崩溃**，编辑器白屏）→ 镜像既有 frontmatter `fmField`（StateField + atomicRanges）。
> 验证:typecheck 0 · `r55-e2e.mjs` **15/15**（4 纯检测/渲染 + 8 live widget[渲染/揭示/源码不变/无报错] + 3 nested-table guard）· `r55-probe.mjs` **6/6** · cargo release 真实重建 38s · 回归 r51/r52/r35/r33/r24/r29 不回退。
> **评审 1 major + 2 minor 修 / 5 维 data-safety 核心全证伪**（零文档修改、无编辑锁死、无 XSS 新面）。**major**：blockquote/list/缩进表格的 Table 节点 `from` 不在行首 → 行中块装饰致视图损坏 → **行首守卫**（`from !== lineAt(from).from` 则跳过，这些表格降级显示源码，v1）。**minor**：`eq()` 纳入 html（cell wikilink 解析变化后 rebuild 能换 DOM）。

### 契约（交付即实现，已纳评审修复）

**features/editor/liveTables.ts（新）**:`findTableRanges(state)`（纯，遍历 syntaxTree 取 `Table` 节点，文档序升序，探针复用）。`TableWidget extends WidgetType`（`toDOM` = `div.cm-live-table` + `innerHTML = renderMarkdownToHtml(source, resolve)` + mousedown→`view.dispatch({selection:{anchor:from}})` 揭示源码；`eq` 比 source+from+**html**；`ignoreEvent()=false` 放行 mousedown）。`buildTableDecos(state, app, getPath)`：findTableRanges → **行首守卫跳过非行首表格** → selection 相交则跳过（揭示）→ 否则 `Decoration.replace({block:true, widget})`。`liveTables(app, getPath)` = **StateField**（create/update[`docChanged||selection` 则 rebuild，否则 `value.map(tr.changes)`]，`provide` = `EditorView.decorations.from(f)` + `EditorView.atomicRanges.of(...)`）。
**features/editor/livePreview.ts**:`liveTables(app, getPath)` 接入 `livePreview()` 数组（**仅 live 模式**，source 模式显示原始管道）。
**main.tsx（探针）**:`__geodeTable.ranges(doc)`（`markdown({base:markdownLanguage})`[GFM 表格]+ensureSyntaxTree+findTableRanges）+ `renders(src)`（renderMarkdownToHtml 含 `<table`）。纯函数 App-Nap-safe；live widget 走 E2E。
**editor.css**:`.cm-live-table`（margin/cursor:text）+ `table/th/td`（CSS 变量，镜像 `.preview-content table`）。

### 文件所有权（本轮单人独占）
- `src/features/editor/liveTables.ts`（新）+ `src/features/editor/livePreview.ts`（接入 + import）+ `src/main.tsx`（探针 + import）+ `src/features/editor/editor.css` + `.calibration/r55-*` + 版本三处。

### 已知偏差 / 待办（写给后续轮）
- **blockquote / 列表 / 缩进内的表格不 live 渲染**（行首守卫跳过，显示源码）——内嵌表格需「按行剥 `>`/缩进前缀再 render + 块范围扩到整行」，本轮 out of scope。
- **视口外（大文档未解析区）的表格迟渲染**（StateField 只在 docChanged||selection rebuild，不随 parser 进度）——**光标移动即自愈**，非数据安全，minor。
- **cell 内 `[[wikilink]]` 解析翻转（创建/重命名目标）后 widget 不即时更新**（StateField 不随 metadata-only 变更 rebuild；与既有 EmbedWidget 等同类限制）。
- **每次 doc/selection 变更全文档扫 findTableRanges**（无视口裁剪）——大文档/多表格轻退化，v1 可接受。
- **本轮确立的 cursor-aware block widget 范式（StateField + atomicRanges + selection-reveal + click-to-edit）= 后续 #⑱（mermaid live / 跨行 `$$`·`%%`）的模板**。

## Round 54 additions — Setext 标题折叠（live render 长尾 #⑱）【As-built v0.54】

> **状态：As-built（v0.54 交付,2026-06-14）。** R32+ 候选池第四梯队 #⑱（live 渲染长尾）。**先纠一个过时判断**：探明后发现 Setext 标题（`text\n===`=h1 / `text\n---`=h2）的 **live 样式早已存在**——
> `syntaxHighlighting(mdHighlight)` 把 lezer 的 `t.heading1/2` 映射成 `cm-md-h1/2`，而 lezer **给 Setext 文本也打 heading1/2 tag**（derisk 实测 `"Setext\n==="` → `cm-md-h1`）→ 阅读视图（markdown-it `lheading` 默认开）+ live 都已渲染。**真实缺口 = 折叠**：`folding.ts` 自 R17 起注释明写「SetextHeading is out of scope」→ Setext 标题无折叠点。本轮 = **扩展 foldService 支持 Setext 折叠**。**零新依赖、无 Rust、不碰 `core/markdown.ts`**（阅读视图已对，无需动字节级管线）。
> 验证:typecheck 0 · `r54-e2e.mjs` **11/11**（7 纯 fold-range[Setext H1/H2 section-end / ATX / 段落 null / 下划线行 null / 多行 Setext 首行折 / 续行 null] + 4 live 折叠[editor:toggle-fold → `.cm-foldPlaceholder`]）· `r54-probe.mjs` **8/8** · cargo release 真实重建 38s · 回归 r29[fold 持久化]/r51/r52/r35/r33/r24 不回退。
> **评审 0 真缺陷 / 全维证伪**（折叠几何 / `---`·`===`·frontmatter·fence 歧义 / 探针-live 解析树逐字节一致 / 分层 全清）。**顺带修一个 latent bug**：headingSectionEnd 现在把 Setext 也当 section 终止符 → 「ATX section 后跟 Setext 同级标题」之前会折穿（把 Setext 标题折没），现在在它前停（纯 ATX 文档折叠**逐行不变**，评审实测 old==new）。

### 契约（交付即实现）

**features/editor/folding.ts**:新增 `SETEXT_HEADING_RE = /^SetextHeading([12])$/` + `headingLevel(name)`（ATX 1-6 或 Setext 1-2 统一返回层级，否则 null）。
`headingSectionEnd` 改用 `headingLevel` → ATX **和** Setext 都作 section 终止符（`cursor.from > lineEnd` 守卫排除当前节点；Setext 自身 HeaderMark `===` 的 headingLevel 返回 null 自然跳过）。
`markdownFoldRange` 改用 `headingLevel`：Setext 节点跨「文本行 + 下划线行」两行，但 `from` 落在首（文本）行 → 同一 `ownsLine` + `from: lineEnd`（文本行尾）折叠点对 ATX/Setext 通用；折叠隐藏「下划线 + section」，标记落文本行。**export `markdownFoldRange`** 供探针。
**main.tsx（探针）**:`__geodeFoldRange.range(doc, line1)` = 一次性 `EditorState([markdown()])` + `ensureSyntaxTree` + `markdownFoldRange`，返回 `{from,to}|null`（纯几何，App-Nap-safe；live 折叠 gutter/命令走 E2E）。`import { markdownFoldRange } from "@features/editor/folding"`（与既有 main.tsx import @features/editor/* 一致）。

### 文件所有权（本轮单人独占）
- `src/features/editor/folding.ts`（核心）+ `src/main.tsx`（探针 + 2 import）+ `.calibration/r54-*` + 版本三处。

### 已知偏差 / 待办（写给后续轮）
- **多行 Setext 标题**（下划线作用于多行前驱段落）从首行末折叠 → 折叠会隐藏首行后的续行标题文本（与 ATX 「从首行末折」机制一致，纯 view 态不删字节，可接受）。
- **`===`/`---` 下划线行 live 渲染为 heading 字号**（mdHighlight 把整个 Setext 节点含下划线打成 cm-md-h1/2）→ `===` 显得偏大。**Setext 下划线视觉精修（dim 标记）= 余项**（需 cursor-aware ViewPlugin 装饰，view 依赖、probe 难驱动，单列一轮）。
- **#⑱ 其余长尾**（live 表格 / 跨行 `$$`·`%%` / mermaid live widget）仍缺，**需块级 StateField**（更硬）。

## Round 53 additions — Unique note creator（唯一笔记 / Zettelkasten）【As-built v0.53】

> **状态：As-built（v0.53 交付,2026-06-14）。** R32+ 候选池第四梯队 #㉑（小众核心插件）。Obsidian「Unique note creator」核心插件：一条命令建一篇**时间戳命名**（Zettelkasten id）的新笔记,
> 放可配置文件夹、可选模板、建后打开。**镜像 `core/dailyNote.ts`（R48 可配置日记）**——同款 Store/localStorage/effFolder/模板展开形状,但**去掉日期回解/日历/相对导航**（unique note 永不按 id 回访,故无 parseStamp/isUniquePath/monthGrid）。**零新依赖、无 Rust**。
> **scope 决策（记一句）**：本轮原定候选池既定顺序的 #⑧ 余项 = stacked tabs。探明后发现**真正的 Obsidian stacked tabs = 内容级横向 cascade**（同时挂载所有 tab 的窗格、横向滚动），而 Geode 当前只渲染 active tab 内容 → 忠实实现需同时挂载多个 EditorPane = 大改 + 多编辑器 data-safety 重,超一轮干净交付；做「竖排 tab 条」minimal 版又不忠实。故 **#⑧ stacked tabs 留作专门大轮**,本轮取确定能一轮干净交付的忠实 #㉑ 项。
> 验证:typecheck 0 · `r53-e2e.mjs` **11/11**（5 纯变换 + 5 live create[含**同 tick 竞态**] + 1 设置 UI 接线）· `r53-probe.mjs` **6/6** · cargo release 真实重建 37s · 回归 r48/r50/r44/r24 不回退。
> **评审 1 真缺陷（minor）修 / 11 证伪**：同 tick 双触发原只建一篇（第二次 create 被 `create_new` 拒→catch 见文件已存在→静默打开第一篇而非 `X 1.md`）——非 data-loss（防覆盖原子性可靠）,但违反「每次必建新笔记」语义 → **createUniqueNote 改 collision-retry 循环**（reject 且文件已存在=竞态→重算 uniquePath 拿下一后缀；非竞态失败=路径仍缺→返 null；50 次封顶）+ 补 `Promise.all` 同 tick 双触发回归断言。

### 契约（交付即实现，已纳评审修复）

**core/uniqueNote.ts（新）**:`uniqueNoteFolder`/`uniqueNoteFormat`/`uniqueNoteTemplate` Store<string> + setter（localStorage,镜像 dailyNote）。
`effFolder()`：trim + strip 首尾斜杠,**`""`(root) 是合法默认**（Obsidian unique note 默认在 vault root,**与 dailyNote 回落具名 "Daily Notes" 不同**）,traversal/`.`/`..`/dot-前缀段 → 回落 root。`effFormat()` → trim || `YYYYMMDDHHmmss`。
`uniqueNoteName(date)` = `moment(date).format(effFormat())`（纯）。`uniqueNotePathPreview(date)` = `folder ? folder/name.md : name.md`（纯,pre-collision,探针用）。
`createUniqueNote(vault, workspace, date)`：createFolder(若具名) → 先 `await uniqueNoteContent`（模板展开或空,Obsidian unique note 默认空）→ **collision-retry 循环**：`vault.uniquePath(folder, base)` → `vault.create` → 成功 openFile + return path；reject 且 fileExists=竞态→重算重试；reject 且路径缺=真失败→return null。
**plugins/unique-note.ts（新）**:`unique-note:create` 命令（无默认键,Obsidian 同款）→ `createUniqueNote(app.vault, app.workspace, new Date())`。注册进 `plugins/index.ts` `BUILTIN_PLUGINS`。
**features/settings/SettingsModal.tsx**:AppearanceSection 加「Unique notes」3 字段（folder/format/template,`data-testid="settings-unique-{folder,format,template}"`,useStore + setter,镜像 daily-notes）。
**main.tsx（探针）**:`__geodeUnique`（name/path/setFormat/setFolder,纯函数,App-Nap-safe;create 流走 live E2E）。
**i18n**:`cmd.uniqueNote` + `plugin.uniqueNote.name/desc`（dict.app）+ `settings.uniqueNote{s,Folder,Format,Template}`（dict.views），en+zh。版本 0.52→0.53。

### 文件所有权（本轮单人独占）
- `src/core/uniqueNote.ts`（新）+ `src/plugins/unique-note.ts`（新）+ `src/plugins/index.ts`（注册）+ `src/features/settings/SettingsModal.tsx`（设置）+ `src/main.tsx`（探针）+ `src/core/i18n/dict.{app,views}.ts` + `.calibration/r53-*` + 版本三处。

### 已知偏差 / 待办（写给后续轮）
- **#⑧ stacked tabs 未做**（真 Obsidian 版 = 内容级 cascade,需多 EditorPane 挂载 = 专门大轮；本轮 scope 判断后改取 #㉑）。
- **format 含 "/" → 子目录、含文件系统非法字符 → create 失败优雅降级（返 null 不开）**：均已知偏差（header 注释声明）。路径穿越（format/folder 嵌 `..`）被 `assertSafeRelPath`(JS) + Rust `safe_join` + `create_new` 三层拦死。
- **unique note 默认空内容**（Obsidian 同款；设模板则 expandTemplate）。

## Round 52 additions — 编辑命令补全 II（toggle-comment / indent / 行操作）【As-built v0.52】

> **状态：As-built（v0.52 交付,2026-06-14）。** R32+ 候选池第四梯队 #⑳ 的余项延续（R51 做了 move/copy line，本轮补 5 条编辑命令）。把 `@codemirror/commands` 的 5 个
> **StateCommand** 暴露成命名、palette 可发现、可重绑的命令：`editor:toggle-comment`（`Mod+/`）/`editor:indent`/`editor:unindent`/`editor:insert-blank-line`/`editor:select-line`。
> **关键决策**：① **headline = toggle-comment 产出 Obsidian 的 `%%…%%` 注释**——markdown 语言**自身无 commentTokens**（toggleComment 会 no-op），故 cmExtensions 加一行
> `markdownLanguage.data.of({ commentTokens: { block: { open: "%%", close: "%%" } } })`；toggleComment 无 line-comment token → 落 block 路径 → 把选区/当前行包/解 `%%`（CM 会加内空格 `%% x %%`，仍是合法 Obsidian 注释）。
> ② **`deleteLine` 被排除**：它是 `Command`（需真实 `view.moveVertically`），**纯变换探针驱动不了**（同 R51 洞察：probe 只能跑 StateCommand）；Obsidian 也无此默认命令。**零新依赖、无 Rust、无新 vault 写路径**（每条 = 单 CM transaction → dirty → autosave）。
> 验证:typecheck 0 · `r52-e2e.mjs` **11/11**（7 纯变换 + 3 live 命令 + **1 真实 `Meta+/` 键击路由**）· `r52-probe.mjs` **6/6** · cargo release 真实重建 38s · 回归 r51/r35/r33/r40/r24 不回退。
> **评审 0 真缺陷 / 5 维全证伪**（Mod+/ 冲突 / %% 数据安全 / 类型探针 / 边角 / 分层 i18n 全清）。一条 by-design 备注（非缺陷）：open===close=`%%` 的 toggle 对「字面含 `%%` 的行」有固有歧义（会被判已注释而 uncomment）——任何同分隔符注释 toggle（含 Obsidian `%%`）的本质语义，可逆、非不可逆损坏。

### 契约（交付即实现）

**features/editor/editorEditCommands.ts（新）**:`registerEditorEditCommands(app, getView)` → 注册 5 条命令，thin wrapper 包 `toggleComment`/`indentMore`/`indentLess`/`insertBlankLine`/`selectLine`（全 StateCommand，`(view:EditorView)` 满足 `{state,dispatch}`）。`name` thunk、`available: () => getView()!==null`（阅读视图 palette 隐藏 + hotkey skip + callback no-op）、callback = `cmd(view); view.focus()`。**唯一默认键 = toggle-comment 的 `Mod+/`**（全仓空闲，注释切换通用约定）；indent/unindent 无键（Tab/Shift-Tab 经 defaultKeymap indentWithTab 已缩进，命名命令补 palette 可发现 + 可重绑）。
**cmExtensions.ts**:扩展数组加 `markdownLanguage.data.of({ commentTokens: { block: { open: "%%", close: "%%" } } })`（纯加性 facet，只被 CM comment 命令经 `languageDataAt` 消费；阅读视图 `core/markdown.ts`[markdown-it] 不读 CM languageData → 零影响）。
**app/App.tsx**:`disposers.push(...registerEditorEditCommands(app, () => getActiveFileEditorView(app)?.view ?? null))`（与 format/composer/motion 并列；双侧门控）。
**main.tsx（探针）**:`__geodeEdit.runEdit(cmd, doc, anchor, head)` —— 一次性 `EditorState`（含 `markdown()` + 同款 commentTokens，让 toggleComment 解析到 block token）+ 捕获式 dispatch，返回 `{doc, from, to}`（selectLine 只改选区不改 doc → 必须返回选区）。暴露 toggleComment/indent/unindent/insertBlankLine/selectLine。
**i18n**:`cmd.toggleComment`/`cmd.indent`/`cmd.unindent`/`cmd.insertBlankLine`/`cmd.selectLine`（en+zh）。版本 0.51→0.52。

### 文件所有权（本轮单人独占）
- `src/features/editor/editorEditCommands.ts`（新）+ `src/features/editor/cmExtensions.ts`（+1 行）+ `src/app/App.tsx`（接线 + import）+ `src/main.tsx`（探针）+ `src/core/i18n/dict.app.ts`（5 键）+ `.calibration/r52-*` + 版本三处。

### 已知偏差（写给后续轮）
- **toggle-comment 用 `%% x %%`（CM 加内空格）**：Obsidian 用户惯写 `%%x%%`，但带内空格仍是合法 Obsidian 注释（%% 间任意内容皆注释）。CM toggleBlockComment 默认加内空格，无配置项关闭（除非自写命令）—— 接受。
- **deleteLine / 其它 `Command` 类命令未接**（需真实 view，探针驱动不了；按需可单独接但只能 live 测）。
- **indent 缩进单位 = CM 默认 2 空格**（cmExtensions 无自定义 indentUnit；探针与 live 同源）。

## Round 51 additions — 移动行 / 复制行编辑命令（Line motion）【As-built v0.51】

> **状态：As-built（v0.51 交付,2026-06-14）。** R32+ 候选池第四梯队 #⑳。把 `@codemirror/commands` 的 `moveLineUp`/`moveLineDown`/`copyLineUp`/`copyLineDown`
> 暴露成**命名、palette 可发现、可重绑**的命令（Obsidian 同款 `editor:move-line-up` 等）。**关键认知**:CM 的 `defaultKeymap` **已绑** `Alt-Arrow`→move /
> `Shift-Alt-Arrow`→copy（CM/VS Code/Sublime/Obsidian-CM6 通用约定）→ 这些行为今天已能用,本轮的价值 = **命名化 + 可重绑**,不是新功能。**零新依赖、无 Rust、无新 vault 写路径**（每条命令 = 单 CM transaction → dirty → autosave，与 R33 format 同管线）。
> 验证:typecheck 0 · `r51-e2e.mjs` **10/10**（6 纯变换 + 3 live 命令 + **1 真实 `Alt+ArrowUp` 键击路由**）· `r51-probe.mjs` **6/6** · cargo release 真实重建 37s · 回归 r33/r40/r24 不回退。
> **评审 0 真缺陷 / 4 维全证伪**（热键冲突/StateCommand 类型/边角数据安全/分层 i18n 全清）。评审点名 2 处非缺陷 → **本轮主动处理 1**:键位由 `Mod+Shift+Arrow` 改 `Alt+Arrow`(move)/`Shift+Alt+Arrow`(copy) —— 对齐 CM/Obsidian 约定、消与 defaultKeymap 的冗余、消 macOS 原生 `Cmd+Shift+↑`(选到文档头) 遮蔽;并补真实键击断言（评审点名的覆盖盲点）。

### 契约（交付即实现）

**features/editor/editorMotionCommands.ts（新）**:`registerEditorMotionCommands(app, getView)` → 注册 4 条命令（`editor:move-line-up`/`-down`/`editor:copy-line-up`/`-down`），thin wrapper 包 `@codemirror/commands` 的 4 个 StateCommand。`name` 是 thunk（`() => t(spec.nameKey)`）。`available: () => getView() !== null`（阅读视图无 view → palette 隐藏 + hotkey 跳过 + callback no-op）。callback = `spec.cmd(view); view.focus()`。
**键位**:move = `Alt+ArrowUp`/`Alt+ArrowDown`;copy = `Shift+Alt+ArrowUp`/`Shift+Alt+ArrowDown`。与 CM defaultKeymap **同键**——cmExtensions 的 Prec.highest `app.commands.handleKeydown` 拦截器在 defaultKeymap **之前**匹配 → `preventDefault`+`stopPropagation`+`return true` → defaultKeymap 不再触发 → **单次触发,无双发**（E2E section C 用真实 `Alt+ArrowUp` 键击验证落点 `beta\nalpha\ngamma` = 恰好一次 move）。
**app/App.tsx（接线）**:`disposers.push(...registerEditorMotionCommands(app, () => getActiveFileEditorView(app)?.view ?? null))`（与 registerFormatCommands/registerComposerCommands 并列；`getActiveFileEditorView` 双侧门控 → 命令永不改非活动文件）。
**main.tsx（探针）**:`__geodeMotion.runMotion(cmd, doc, anchor)` —— 用一次性 `EditorState` + 捕获式 dispatch 跑 StateCommand,返回结果 doc（纯函数,桌面 probe 可驱动,不依赖 live view）。暴露 moveUp/moveDown/copyUp/copyDown。
**i18n**:`cmd.moveLineUp`/`cmd.moveLineDown`/`cmd.copyLineUp`/`cmd.copyLineDown`（en+zh，dict.app.ts）。版本 0.50→0.51。

### 文件所有权（本轮单人独占,无并行冲突）
- `src/features/editor/editorMotionCommands.ts`（新）+ `src/app/App.tsx`（接线 1 行 + import）+ `src/main.tsx`（探针）+ `src/core/i18n/dict.app.ts`（4 键）+ `.calibration/r51-*` + 版本三处。

### 已知偏差（写给后续轮）
- **copy-line 现在有默认键**（`Shift+Alt+Arrow`,Obsidian 该命令默认无键）—— 取 CM/VS Code 约定,可重绑/清除。
- **StateCommand 当 (view)=>bool 用**：`moveLineUp` 等签名是 `(target:{state,dispatch})=>bool`,传 `EditorView`（superset）语义正确（CM 内部只读这两字段）。typecheck 0。

## Round 50 additions — 可读行宽 + 拼写检查 + 应用级缩放（Appearance）【As-built v0.50】

> **状态：As-built（v0.50 交付,2026-06-14）。** R32+ 候选池第四梯队 #⑲。Obsidian Appearance 高频设置:**Readable line length** / **拼写检查** /
> **应用级缩放**（Cmd±）。**关键复用**:`.cm-content`/`.preview-content` **已 cap 46em** → 改 CSS 变量 `--readable-line-width` 即可配;
> `workspace.setFontSize(px)` 已存在（clamp + `--editor-font-size` var）→ zoom 命令直接调;CM spellcheck 走 contentDOM 属性（EditorPane useStore+effect 反应式）。**零新依赖、无 Rust、低风险加性轮**。**默认保持现状**（readable ON=现 46em cap;spellcheck OFF）。
> 验证:typecheck 0 · `r50-e2e.mjs` **15/15** · `r50-probe.mjs` **6/6** · cargo release 真实重建 38s · 回归 r33/r24/r25/r49 不回退。
> **评审 2 finding → 1 确认（minor,去重）修**:阅读视图 `.editor-preview > .properties-panel` 仍硬编码 46em（漏跟随）→ readable OFF 时与正文错位 → 改 `var(--readable-line-width, 46em)`（与 `.cm-content`/`.preview-content`/`.editor-loading` 同源）+ 补 E2E 断言。

### 契约（交付即实现，已纳评审修复）

**core/appearance.ts（已落）**:`readableLineLength`/`spellcheckEnabled` Store<boolean> + setter（localStorage,镜像 autoUpdateLinks）。
`setReadableLineLength(on)` → 切 documentElement `--readable-line-width`（on=removeProperty→CSS 46em fallback;off="none"=full width）。`applyAppearanceSettings()` boot 应用。
**main.tsx（已落）**:`applyAppearanceSettings()` boot + `__geodeAppearance` 探针（setReadable/setSpellcheck/readableVar）。

**features/settings/SettingsModal.tsx（B）**:AppearanceSection 加 2 toggle（Readable line length / Spellcheck,镜像 autoUpdate `role="switch"` `.settings-toggle`,`data-testid="settings-readable-toggle"/"settings-spellcheck-toggle"`,`useStore` + setter）。
**features/editor/EditorPane.tsx（B）**:`const spell = useStore(spellcheckEnabled)`;view 创建 effect 后 `view.contentDOM.setAttribute("spellcheck", String(spellcheckEnabled.get()))`;+ `useEffect(() => viewRef.current?.contentDOM.setAttribute("spellcheck", String(spell)), [spell])` 实时切换。
**app/App.tsx（B）**:注册 `app:zoom-in`(Mod+=,`setFontSize(fontSize+1)`)/`app:zoom-out`(Mod+-,`-1`)/`app:zoom-reset`(Mod+0,`setFontSize(16)`)（读 `workspace.state.get().fontSize`）。
**features/editor/editor.css + cmExtensions.ts（B）**:`.cm-content`/`.preview-content`（及编辑器 wrapper 的 46em cap）`max-width: 46em` → `var(--readable-line-width, 46em)`。
**i18n（B）**:`settings.readableLineLength`/`settings.spellcheck`/`cmd.zoomIn`/`cmd.zoomOut`/`cmd.zoomReset`（en+zh）。版本 0.49→0.50。

### 文件所有权
- **me（core + 探针 + 验证,已落核心）**:`src/core/appearance.ts` + `src/main.tsx` + `.calibration/r50-*`。
- **B（UI）**:SettingsModal + EditorPane + App.tsx + editor.css + cmExtensions.ts + i18n + 版本三处。

### 已知偏差（写给后续轮）
- **spellcheck 默认 OFF**（Obsidian 默认 ON;为不改现状取 OFF,用户可开）。
- **readable line length 仅控行宽 cap**（Obsidian 该设置同款;可读宽度值固定 46em 不可调——余项）。
- **zoom 仅调 `--editor-font-size`**（影响正文;UI chrome 字号不随——Obsidian 缩放亦主要正文）。

## Round 49 additions — 文件恢复快照（File recovery snapshots）【As-built v0.49】

> **状态：As-built（v0.49 交付,2026-06-14）。** R32+ 候选池第三梯队 #⑪ 的**另一半**（R42 做了回收站=删除恢复;快照=**编辑恢复**;**#⑪ 至此完成**）。
> Obsidian File recovery：周期保存笔记内容快照,可浏览/还原旧版本。**数据安全相关轮**。**关键复用**：`vault.adapter.writeConfig/readConfig`（相对 `.obsidian/`,
> **配置写不触发 tree 刷新**——镜像 bookmarks/workspaces 安静路径）;`file:modified` 事件触发。**零新依赖、无 Rust**。
> 验证:typecheck 0 · `r49-e2e.mjs` **12/12** · `r49-probe.mjs` **9/9**（含 **on-disk 数据安全终态**:`.obsidian/snapshots/` 写入 + restore 写回 + restore 前 CURRENT 被快照）·
> cargo release 真实重建 37s · 回归 r24/r43/r27/r45/r47 不回退。

### As-built（评审根因修复 — 9 finding → 7 确认[2 major + 5 minor] 全修 + 2 证伪）

对抗评审 3 维（数据安全重点）× find→verify。确认并修复:

1. **【major / 数据安全】坏 JSON 的 `snapshots.json` 被 `readList` 吞错回空 → record 用空 list 覆盖,静默删光其余有效快照**（`vault_write_config` 是裸 `fs::write` 非原子,Geode 自身崩溃/断电可产生截断 JSON;与 R45/R27「坏 JSON 拒写」契约不一致）。**修**：**写路径**与读路径分离容错——recordSnapshot 内对 `readConfig` 结果**显式 STRICT JSON.parse**,malformed 即 throw → enqueue catch（见 #3 日志）→ 跳过 writeConfig、保留磁盘原字节;`listSnapshots`/UI 仍用容错 `readList`。
2. **【major / 数据丢失】restore 前未 flush 活动编辑器 → 脏 buffer 的未保存编辑既不被快照（restore 读磁盘非 buffer）、又在 restore 写盘后被脏 buffer 覆盖**。**修**：`restoreSnapshot` 加 `documents` 依赖,**`await documents.flushAll()`** 后再读当前+force 快照+写回（R47 flush-before-overwrite parity）——未保存编辑落盘并被快照,editor 非脏后 watcher 重载还原内容。
3. **【minor】`enqueue` 静默吞所有 writeConfig/readConfig reject 无日志**（偏离 bookmarks/workspaces guarded 先例）。**修**：`enqueue` 包 `guarded` try/catch + `console.warn` 再 rethrow。
4. **【minor】`lastSnapTs` 在 enqueue 外同步置位,写失败不回滚 → 节流窗口被毒化,60s 内真实变更跳过不重试**。**修**：`lastSnapTs.set` 移进 **写成功/dedup 分支**（失败→不置位→下次保存重试）。
5. **【minor】vault 切换不清 `lastSnapTs` → 新库同名笔记首快照被旧库残留 ts 节流**。**修**：`initSnapshots` 订阅 `vault:changed(load)` → `lastSnapTs.clear()`。
6. **【minor】`restoreSnapshot` reject 时 RecoveryModal `.then` 无 `.catch` → 静默失败 + unhandled rejection**。**修**：modal restore 加 `.catch`（console.error,模态保持）。
7. **【minor】`snapshotsRevision` bump 无条件把 `sel` 重置到最新 → 模态开着时后台保存偷换用户选中项**。**修**：useEffect `setSel(prev => 仍存在则保留 prev,否则最新)`。

> **证伪（未改）**：并发 restoreSnapshot 非原子（append-only + last-writer-wins,无正文丢失,by-design）· `key={s.ts}`/同毫秒 ts 碰撞（throttle 保同文件 ts≥60s,force 还原 ts=now 不撞历史）· 分层/i18n/命令门控/写字节安全（合规）。

> **教训（写给后续轮）**：① **「容错读」不能被「写路径」复用**——`readList` 对坏 JSON 回空对**展示**安全,但 record 的 RMW 复用它就把「读容忍」变成「写破坏」（空 list 覆盖丢历史）。**写路径必须 STRICT-parse 拒覆盖 malformed,读路径才容错**——这是 R45/R27 早立的契约,新数据安全模块（自称「bookmarks precedent」）必须把那层守卫一并抄齐（与 R47「复用引擎复用全部消费契约」、R48「纵深防御扫同族全入口」同源,**第三次**反复出现）。② **「读后覆盖」类操作（restore/merge）一律先 `flushAll`**——脏 buffer 的未保存编辑必须先落盘+捕获,否则覆盖丢编辑 + buffer 反噬还原（R47 merge、R49 restore 同根;凡「读当前→写回」都加 flush）。③ **节流/去抖的「窗口推进」要绑成功不绑尝试**——`lastSnapTs` 置位绑「写成功」而非「尝试」,失败才可重试;副作用状态（throttle/dedup 标记）的更新点 = 操作真正生效点。

### 契约（交付即实现，已纳评审修复）

**core/snapshots.ts（已落,数据安全核心）**：存储 = 每 note 单 JSON `.obsidian/snapshots/<encodeURIComponent(path)>.json` = `{path, snapshots:[{ts,content}]}`
（encodeURIComponent 把 "/" → %2F → 整路径成一个文件名段,无穿越无碰撞）。
```ts
export interface Snapshot { ts: number; content: string; }
export const snapshotsRevision: Store<number>; // 每次写快照 bump → 恢复 UI 重渲
export function recordSnapshot(vault, path, content, now, force?): Promise<void>; // throttle(>=60s,force 绕)+ dedup(同上一份跳)+ prune(MAX_PER_FILE=25,数组 shift)+ 串行 RMW
export function listSnapshots(vault, path): Promise<Snapshot[]>;                   // 旧→新
export function restoreSnapshot(vault, path, ts, now): Promise<boolean>;           // **先 force-快照当前** → vault.modify 写回快照;快照/文件缺失→false no-op
export function initSnapshots(vault, events): () => void;                          // 订阅 file:modified → vault.read → recordSnapshot(Date.now());startup 调一次
export function isSnapshotable(path): boolean;                                     // .md 且非 dot-prefixed 段
```
**main.tsx（已落）**：`initSnapshots(vault, events)` 一次（vault 切换原地 re-point,单订阅有效）+ `__geodeSnapshots` 探针（record/list/restore,确定性 ts）。

**core/types.ts（B）**：`ModalKind` 加 `"recovery"`。
**features/recovery/RecoveryModal.tsx（B,NEW）+ index + css**：镜像 `features/workspaces/WorkspacesModal`。`activePath = app.workspace.getActiveFile()`;
`useStore(snapshotsRevision)` + `useEffect` 异步 `listSnapshots(app.vault, activePath)` → state（旧→新,**展示倒序最新在上**）;每项:时间戳（locale 格式化）+ 选中预览内容（只读）+ 还原按钮（`restoreSnapshot(app.vault, activePath, ts, Date.now())` → closeModal）。无活动文件 → 空态 `t("recovery.noFile")`;无快照 → `t("recovery.empty")`。Escape + overlay 关闭。
**app/App.tsx（B）**：`ws.modal === "recovery" && <RecoveryModal />` + 注册命令 `editor:file-recovery`（无默认键,`available: getActiveFile()!==null`,`openModal("recovery")`)。
**i18n（B）**：`cmd.fileRecovery` + `recovery.title`/`recovery.restore`/`recovery.empty`/`recovery.noFile`/`recovery.preview`（en+zh）。版本 0.48→0.49。

### 文件所有权
- **me（core + 探针 + 接线 + 验证,已落核心）**：`src/core/snapshots.ts` + `src/main.tsx` + `.calibration/r49-*`。
- **B（UI + 命令 + i18n + 版本）**：`src/core/types.ts`(ModalKind) + `src/features/recovery/*`(new) + `src/app/App.tsx` + i18n dict + 版本三处。

### 已知偏差（写给后续轮）
- **每 note 单 JSON 存 N 份全文**（25 版 × 全文 → 文件可大;RMW 每次读写整文件——throttle 60s 限频。大库/大文件性能为余项）。
- **快照按 ts 唯一**（throttle 保同文件 ts≥60s 间隔;force 还原-当前 ts=now 与历史不撞）。
- **改文件名/移动后快照不跟随**（key=路径;rename 后旧快照孤立在旧 key——余项:rename 时迁移 key）。
- **无周期定时器**（仅 on-save 触发;Obsidian 另有定时快照——余项）。

## Round 48 additions — 可配置日记设置（Configurable daily notes）【As-built v0.48】

> **状态：As-built（v0.48 交付,2026-06-14）。** R32+ 候选池第三梯队 #⑫ 的**另一半**（R43 做了日历+导航;**#⑫ 至此完成**）。Obsidian Daily notes 设置：
> **日期格式**（moment token）/ **新文件位置**（文件夹）/ **模板文件**。**关键复用**：镜像既有 `templateFolder`/`templateDateFormat` 的 localStorage
> Store + 设置 UI 范式;`expandTemplate(content, {title, now})` 应用模板;moment 已是依赖（templates.ts 用）。**零新依赖、无 Rust**。
> 验证:typecheck 0 · `r48-e2e.mjs` **13/13** · `r48-probe.mjs` **9/9**（真实 WKWebView 可配置 format/folder）· cargo release 真实重建 37s ·
> 回归 r43-e2e 22 / r43-probe 13 / r23 22 / r28 23 / r42 17 不回退（**moment 改写完全保 R43 over-match 守卫 + createFolder 守卫不破既有**）。

### As-built（评审根因修复 — 9 finding → 6 确认[1 major + 5 minor] + 3 证伪）

对抗评审 3 维 × find→verify。修复 1 major + 1 minor（R46 同根纵深防御）,其余 3 minor 为 misconfiguration 边角（无数据丢失）记已知偏差:

1. **【major】`effFolder()` 只 `trim` 未 strip 斜杠 → 尾斜杠输入（"Daily Notes/"）出双斜杠路径 "Daily Notes//date.md"**（R17 attachmentFolder 已 strip,此为回退）。**修**：`effFolder` `replace(/^\/+|\/+$/g, "")` strip 首尾斜杠 + 拒 空/`.`/`..`/dot-前缀 段 → 回落 DEFAULT（镜像 templates.ts validateDir;连带覆盖文件夹 `..` 穿越 + 静默失败的消费侧）。
2. **【minor / R46 同根】`Vault.createFolder` 缺 `assertSafeRelPath` 守卫**：R46 给 `create()`/`createBinary()` 补了守卫、**漏了 `createFolder`**;配置文件夹 `..` → Memory adapter 污染 folders set（桌面 safe_join 拒但静默）。**修**：`Vault.createFolder` 入口加 `assertSafeRelPath`（双端一致,所有 caller 继承——R46 教训③「纵深防御放核心」的补完）。

> **证伪/已记偏差（未改,均 minor、无数据丢失、misconfiguration 门控）**：① **无日粒度格式（`[note]`/`MMMM YYYY`/周编号）→ 文件名碰撞**（所有日记挤一文件 + 日历 has-note 全亮 + nav 失效）——misconfiguration,默认 YYYY-MM-DD 安全,`create_new` 不丢数据;**余项**:设置加「相邻两日 stamp 相同→校验拒绝 + 实时样例预览」(沿用 templateDateFormat 范式)。② **format 含 FS 非法字符（`:` 等,如 "HH:mm"）→ Windows create 静默失败**（macOS/浏览器成功 → 双端分叉）——Windows-only misconfiguration,Obsidian 同款不 sanitize,sanitize 会破 parse 往返;**余项**:出口 sanitize（需 format↔sanitize 联动）或校验。③ **daily-note 插件描述硬编码 "Daily Notes/"**（配置后失真）——cosmetic i18n;**余项**:描述改通用串。证伪:模板自引用循环（daily note 尚不存在→fileExists false→回落,无循环）· locale-token 跨会话（compat 改全局 moment locale 是既有风险,非 R48 引入）。

> **教训（写给后续轮）**：① **「配置化一个写死值」要把消费侧的规整一起补**——`effFolder` 抄了 templateFolder 的「RAW 存 + trim 消费」却漏了它的 strip-slash/validateDir,尾斜杠就出双斜杠;**镜像一个设置范式,要连它的消费侧规整（strip/validate/default）一起抄**。② **纵深防御补一处要扫同族全部**——R46 给 `create`/`createBinary` 加了路径守卫,`createFolder` 是同族写路径却漏补,R48 配置文件夹一来就暴露;**加一道 core 守卫时,grep 同族所有入口（create/createFolder/createBinary/write/modify）一并对齐**（与 R43「修一类根因全命令面扫同类」同源,反复出现）。③ **把纯函数改成读全局 Store 要全回归既有断言**——`dailyStamp`/`parseDailyStamp` 从纯函数改为读设置 + moment strict parse,r43-e2e/probe 全绿证明 R43 的 over-match 守卫被 moment strict 完整保住(嵌入数字/带日期父目录/非法日期均 null);**用既有回归套件给「行为应不变」的重构兜底**。

### 契约（交付即实现，已纳评审修复）

**core/dailyNote.ts（已落,可配置化）**：新增 localStorage Store + setter（镜像 `core/templates.ts`）:
```ts
export const dailyNoteFolder: Store<string>;   export function setDailyNoteFolder(v: string): void;   // 默认 "Daily Notes"
export const dailyNoteFormat: Store<string>;   export function setDailyNoteFormat(v: string): void;   // 默认 "YYYY-MM-DD"(moment token)
export const dailyNoteTemplate: Store<string>; export function setDailyNoteTemplate(v: string): void; // 默认 ""(无模板)
```
`dailyStamp(date) = moment(date).format(effFormat)`;`dailyNotePath = effFolder/stamp.md`;**`parseDailyStamp` 改 moment STRICT parse**（`moment(basename, effFormat, true)`——**保留 R43 全部 over-match 守卫**:嵌入数字/带日期父目录/非法日期均 → null,r43-e2e 22/22 实测不回退）;`isDailyNotePath` 用 effFolder 前缀。`openOrCreateDailyNote` 应用模板（`dailyNoteTemplate` 设置且文件存在 → `vault.read` + `expandTemplate({title:stamp, now:date})`,否则 `# stamp`）。Store/setter RAW 存、消费处 trim+default-on-empty。**`DAILY_FOLDER` 导出保留**（= 默认值,back-compat）。
**main.tsx**：`__geodeDaily` 探针加 `setFormat`/`setFolder`（E2E/probe 测可配置）[已落]。

**features/settings/SettingsModal.tsx（B）**：AppearanceSection 加「Daily notes」heading + 3 字段（folder/format/template),逐字镜像现有 template 三字段（`<input className="settings-text-input">` + `useStore` + setter + `data-testid="settings-daily-folder"/"settings-daily-format"/"settings-daily-template"`）。
**features/calendar/CalendarPanel.tsx（B）**：加 `useStore(dailyNoteFolder)` + `useStore(dailyNoteFormat)` 反应式（改格式即重渲 has-note 标记）。
**i18n（B）**：`settings.dailyNotes`(heading) + `settings.dailyNoteFolder` + `settings.dailyNoteFormat` + `settings.dailyNoteTemplate`（en+zh,放 `settings.templateFolder` 所在 dict——B grep 确认）。版本 0.47→0.48。

### 文件所有权
- **me（core + 探针 + 验证,已落核心）**：`src/core/dailyNote.ts` + `src/main.tsx`(探针) + `.calibration/r48-*`。
- **B（UI + i18n + 版本）**：`src/features/settings/SettingsModal.tsx` + `src/features/calendar/CalendarPanel.tsx`(反应式) + i18n dict + 版本三处。

### 已知偏差（写给后续轮）
- **FORMAT 含 "/" 不支持**（Obsidian 允许格式建子文件夹;Geode basename 解析假设扁平日期名,format 子文件夹延后）。
- **改格式后旧格式的既存日记不被识别**（parseDailyStamp 只认当前格式;改格式 = 换命名空间,旧日记仍是文件但 isDailyNotePath/has-note 不再认——Obsidian 同款）。
- **模板变量集 = `expandTemplate` 既有**（{{title}}/{{date}}/{{time}} 等;Obsidian daily-note 模板的 {{date:FORMAT}} 内联格式若 expandTemplate 不支持则按其能力）。

## Round 47 additions — 笔记合并（Note composer merge）【As-built v0.47】

> **状态：As-built（v0.47 交付,2026-06-14）。** R32+ 候选池第三梯队 #⑬ 的**另一半**（R44 做了 extract）——**#⑬ 至此完成**。Obsidian「Merge
> current file with another file」：当前笔记内容**追加进目标** + **指向当前笔记的链接全改指目标** + **删当前笔记（入 `.trash`）**。**数据安全关键轮**
> （多文件写 + link 改写 + 删文件）。**关键复用 + refactor**：R16 引擎是 rename-with-link-update（`vault.rename(A,B)` 在 B 存在时拒绝）→ 给
> `doLinkUpdate` 加 **`{move}` 选项**,`move:false` 跳过 rename + remap 用 identity,**复用同一 verified capture→splice→post-rewrite-reassert 引擎**
> （绝不重写一遍那道断言）。**零新依赖、无 Rust**。验证:typecheck 0 · `r47-e2e.mjs` **11/11** · `r47-probe.mjs` **7/7**（含 **on-disk 数据安全终态**:
> target 含两者/source 入 `.trash`/referrer 链改写）· cargo release 真实重建 37s · 回归 r28/r24/r44/r42-e2e 不回退（frozen 引擎不破）。

### As-built（评审根因修复 — 12 finding → 4 确认[全 major,去重] 全修 + 8 证伪）

对抗评审 3 维（数据安全 + frozen 引擎重点）× find→verify。**frozen 引擎 refactor 经证实不破 rename 路径**（r28/r24/r42/r44 全绿）。确认并修复:

1. **【major / 数据安全】merge 丢弃 `LinkRewriteResult.skipped` → source trash 后悬空链无告警**：QuickSwitcher merge 分支 `.then(() => openFile)` 不读 `result.skipped`;被 skip 的 referrer（post-rewrite 断言不符,绝不盲写）仍留 `[[source]]`,而 source 已 trash → 悬空链,用户毫不知情。Explorer rename 路径有 `showLinkUpdateNotice` toast,merge 漏了。**修**：consume `result.skipped` → `showMergeNotice(t("switcher.mergeLinksSkipped",{count}))`（镜像 Explorer DOM toast,带 `data-testid`,因跨 feature 不能 import 故 QuickSwitcher 内重实现）。
2. **【major】merge promise 链无 `.catch` → modify/readFresh/trash 抛错变 unhandledrejection + 静默失败**（modal 已关,用户只见「没反应」）。**修**：`.catch(err => { console.error; showMergeNotice(t("switcher.mergeFailed")); })`,失败不 openFile。
3. **【major / 数据丢失】`flushAll` 失败（source 是锁定/只读活动脏编辑器）→ `readFresh` 读旧磁盘字节 → 合并陈旧内容 + trash source → 未保存编辑丢失**。**修**：`flushAll` 包 try/catch（不抛出 merge）+ 读 source/target 走 **live buffer 优先**（`documents.get(p)?.getText() ?? readFresh(p)`,镜像 linkRewrite 的 `handle?.getText() ?? readFresh`）——buffer 是真值,flush 失败也不丢未保存编辑。
4. **【major】merge-file 命令在 switcher 已开时触发（用户绑热键可达）→ `mergeTargetMode` 泄漏到下次开 switcher → 意外合并**：switcher 已挂载则 `openModal` 不 remount → mount-consume effect 不重跑 → store 留值 → 下次普通开 switcher 消费它 → 把活动文件意外合并掉（+trash!）。**修**：命令 `if (modal === "switcher") return`（已开则 no-op,store 永不置→无泄漏）。

> **证伪/by-design（未改）**：① **target 是脏编辑器时陈旧 buffer 覆盖 merge** —— 证伪（merge target 通常非活动文件;watcher 对 non-dirty editor 才 reload；且 F3 的 buffer-read 已覆盖）· **mergeNotes 的 modify/trash 不在 runTail 队列** —— 真但 minor（merge 用户触发、罕见并发;append-before-trash 兜底）· **不剥离源 frontmatter** —— 非缺陷（Obsidian merge 亦保留;用户可手删）· consume-once StrictMode（已用 useState 快照 + useEffect 清,dev 验证通过）。

> **教训（写给后续轮）**：① **复用既有引擎要复用它的「全部消费契约」,不只是核心逻辑**——merge 复用了 R16 的 verified rewrite,却漏了 R16 调用方都遵守的「读 `result.skipped` 并告警」契约（Explorer/AllProperties/Backlinks 都做了,merge 漏）。**接一个返回「部分失败报告」的 API,必须把报告消费掉**（数据安全的「非静默损坏」底线）。② **fire-and-forget promise 链必须 `.catch`**——`void p.then(...)` 吞掉 rejection 成 unhandledrejection,用户零反馈;凡 UI 触发的 async 副作用都要 catch + 用户可见反馈。③ **「读后写」的读要走 live buffer 不走磁盘**——`flushAll` 可能失败（锁定/只读）,之后 `readFresh` 读到的是 flush 前的旧字节,合并+删源 = 丢未保存编辑;**buffer 是真值,`documents.get()?.getText() ?? readFresh()` 是既有范式**（linkRewrite 早有,merge 该一开始就抄）。④ **一次性 Store「mount 消费」要防「已挂载不 remount」**——命令置 store + openModal,若 modal 已是该值则组件不 remount、consume 不触发、store 泄漏;命令侧加 `if (already-open) return` 守卫。

### 契约（交付即实现，已纳评审修复）

**core/linkRewrite.ts（refactor，已落）**：`doRenameWithLinkUpdate` → `doLinkUpdate(deps, oldPath, newPath, move)`;新增导出
`rewriteLinksForMerge(deps, fromPath, toPath)`（= `doLinkUpdate(...,false)` 走同一 `runTail` 串行队列）。`move:false` 改动:① 跳过
`vault.rename`;② `remap` = identity（不移文件,referrer 留原路径,含 source 自身——其 body 已追加进 target,两处都改写）;③ **始终改写**
（忽略 `autoUpdateLinks` toggle——merge 留悬空链=数据丢失）。其余（capture / stillResolves / 验证 splice / post-rewrite reassert）原样复用。

**core/noteMerge.ts（NEW，已落）**：
```ts
export const mergeTargetMode: Store<string | null>;  // 一次性:merge 命令置 source path,switcher mount 消费
export async function mergeNotes(deps: LinkRewriteDeps, sourcePath: string, targetPath: string): Promise<LinkRewriteResult | null>;
```
`mergeNotes` 流程（**数据安全**）:① `source===target` 或一方缺失 → null;② `documents.flushAll()`（脏编辑器先落盘）;③ `readFresh` 两者;
④ `vault.modify(target, target.trimEnd + "\n\n" + source.trimStart + "\n")`（**追加,target 原内容全保留**）;⑤ `metadata.ensureFresh([target])`
（追加的链接先索引）;⑥ `rewriteLinksForMerge(deps, source, target)`（**source 仍在,capture 可解析**）;⑦ `vault.trash(source)`（**可恢复删,R42,在改写之后**）。
**追加先于删除 → 失败最坏=内容重复,绝不丢失。**

**features/palette/QuickSwitcher.tsx**：mount 时 `const [mergeSource] = useState(() => { const m = mergeTargetMode.get(); mergeTargetMode.set(null); return m; })`（**mount 即消费,Escape 取消不泄漏**）;`activate(row)` 顶部:`mergeSource !== null && row.kind==="file" && row.file.path !== mergeSource` → `closeModal()` + `void mergeNotes({vault, metadata, documents}, mergeSource, row.file.path).then(() => app.workspace.openFile(row.file.path))` + return（选自身=no-op）。placeholder 在 merge 模式显 `t("switcher.placeholderMerge")`。
**app/App.tsx**：注册 `editor:merge-file`（无默认键,`available: () => getActiveFile()!==null`,callback: `mergeTargetMode.set(activeFile); openModal("switcher")`)。
**main.tsx**：`__geodeMerge` 探针（`merge: (s, t) => { void mergeNotes({vault, metadata, documents}, s, t); }`,desktop 可驱动核心[store/vault 级]）。
**i18n**：`cmd.mergeFile` + `switcher.placeholderMerge`（en+zh）。版本 0.46→0.47。

### 文件所有权（并行）
- **me（核心引擎,已落 + 验证）**：`src/core/linkRewrite.ts`(refactor) + `src/core/noteMerge.ts`(new) + `.calibration/r47-*`。
- **B（UI + 命令 + i18n + 版本）**：`src/features/palette/QuickSwitcher.tsx`(merge 模式) + `src/app/App.tsx`(editor:merge-file) + `src/core/i18n/dict.app.ts`(cmd.mergeFile) + `src/core/i18n/dict.panels.ts`(switcher.placeholderMerge,**核对在哪个 dict**) + 版本三处。
- **A（探针）**：`src/main.tsx`(`__geodeMerge`,import mergeNotes from @core/noteMerge + 复用既有 vault/metadata/documents)。

### 已知偏差（写给后续轮）
- **autoUpdateLinks toggle 对 merge 无效**（merge 始终改写,留悬空链=数据丢失,刻意）。
- **跳过的 referrer**（R16 post-rewrite 断言不符→skip+report）合并后留悬空 `[[source]]`,但 source 已入 `.trash` 可恢复;skip 经 result 报告（非静默损坏）。
- **无合并确认对话框**（直接合并;source 入 `.trash` 可恢复兜底）。
- **merge 模式 placeholder 外的视觉提示弱**（仅占位符文案;无显式 merge 横幅）。

## Round 46 additions — `obsidian://` URI 深链（零依赖 in-app 切片）【As-built v0.46】

> **状态：As-built（v0.46 交付,2026-06-14）。** R32+ 候选池第三梯队 #⑮。`obsidian://open|new|search` 深链。**本轮做零依赖 in-app 切片**：纯 URI
> 解析器 + 动作执行器 + 笔记内 `obsidian://` 链接点击在 Geode 内路由（开文件/标题/块、建笔记、搜索）。**🛑 OS 级 deep-link 延后（待用户拍板）**——
> 点击 Geode 外的 `obsidian://` 链接唤起/聚焦 app 需 `tauri-plugin-deep-link` **新运行时依赖 = 硬边界#5**（Cargo.toml 现仅 dialog/updater/process,无 deep-link）→ 本轮不引入。
> 零依赖部分(解析器)即未来 OS handler 的可复用核。**零新依赖、无 Rust**。复用 `openWikilink(app, target, fromPath, subpath?)`(连 `#heading`/`#^block` reveal)。
> 验证:typecheck 0 · `r46-e2e.mjs` **18/18** · `r46-probe.mjs` **9/9**（含 on-disk `obsidian://new` 建文件）· cargo release 真实重建 37s · 回归 r44/r43/r28/r24/r25/r33/r45 不回退。

### As-built（评审根因修复 — 12 finding → 5 确认[全 minor] 全修 + 7 证伪;安全攻击面全证伪）

对抗评审 3 维（安全重点）× find→verify。**安全无 critical/major**：穿越被 `safe_join`(拒 `..`/绝对)+ `create_new` 原子 + `fileExists` 守卫挡住;EditorPane 的 obsidian:// 分支放在通用 `preventDefault` 之前 **强化**(非削弱) R19 SEC-1;`/^obsidian:/i` gate 与 `url.protocol==="obsidian:"` 口径一致(URL 自动小写 protocol)且不一致项都落安全侧;open 穿越经 `openWikilink` 被 basename 中和;search query 复用已硬化的搜索管线。确认并修复（全 minor robustness）:

1. **`obsidian://open` 对不存在/跨库 file 经 `openWikilink` 静默建笔记**（Obsidian `open` 只开不建）：`openWikilink` 的 wikilink 语义是 resolve→若不存在则 create。**修**：`open` 分支先 `app.metadata.resolveLink(target, from) === null → return false`(只开既有,绝不建)。
2. **`MemoryVaultAdapter.createFile` 无路径守卫 → 双端分歧 + 纵深防御缺口**：穿越/控制符只被 Rust `safe_join`(IPC 边界)挡,Memory 端 `new?file=../x` 进内存 map;一旦新增非 Tauri 写路径(如 OS deep-link 直驱 handler)就失守。**修**：core `Vault.create` 入口加 `assertSafeRelPath`(拒空/绝对/`..` 段/控制符 U+0000–U+001F·U+007F,**charCode 扫描非裸字节 regex**)——双端共用、所有 create caller 继承。连带覆盖 #3「new 文件名无清洗（控制符/换行）」。
3. **`new` 文件名未清洗（控制符/换行/超长）**：同 #2 核心守卫拦控制符/换行;超长属各 fs 行为,try/catch 兜住。（既有 `core/attachments.ts sanitizeFileName`/`ILLEGAL_NAME_CHARS` 是同类先例。）
4. **`new` create 失败后仍无条件 `openFile` → 幽灵 tab**（指向不存在文件的坏 tab）：**修**：create 后 `if (!vault.fileExists(path)) return false`,只在确实存在才 open。
5. **`open`/`new` 用 `??` 致 present-but-empty `file=` 遮蔽 path/name**（`file=""` 非 null,`??` 不 fallthrough）：**修**：`file || path` / `file || name`（空串 falsy → fallthrough，"首个非空者胜"）。

> **教训（写给后续轮）**：① **`obsidian://open` ≠ wikilink 点击**——复用 `openWikilink` 顺手继承了它「不存在就建」的语义,但 URI 的 `open` 必须只开既有(Obsidian 口径 + 不可信外部输入不该建文件);**复用一个「带副作用」的 helper 前,先问它的副作用是否属于新调用方的语义**(R45「复用序列化审全字段」同源教训)。② **`??` vs `||` 对用户输入 fallback**——`a ?? b` 只在 null/undefined 落 b,present-but-empty `""` 会遮蔽 b;「首个**非空**者胜」要用 `||`。③ **纵深防御放核心、别只放边界**——路径穿越只被 Rust IPC 边界 `safe_join` 挡,Memory adapter 无守卫,新写路径(URI handler)一来就双端分歧;把路径安全契约下沉到 `core/Vault.create`,所有 adapter + 所有 caller 自动继承。④ **数值控制符范围写成 escape 会渲染成裸字节**（R44 重犯）——`[-]` 经 Write/Edit 可能落成 NUL/US 裸字节(破 grep/diff);**用 charCode 扫描(`ch.charCodeAt(0) < 0x20`)而非控制符 regex 范围**。

### 契约（交付即实现，已纳评审修复）

**core/obsidianUri.ts（NEW，纯解析器）**：
```ts
export type ObsidianAction =
  | { kind: "open"; vault?: string; file?: string; path?: string; heading?: string; block?: string }
  | { kind: "new"; vault?: string; file?: string; name?: string; content?: string }
  | { kind: "search"; vault?: string; query?: string }
  | { kind: "unknown"; action: string; params: Record<string, string> };
export function parseObsidianUri(uri: string): ObsidianAction | null; // 非 obsidian:// → null
```
实现:`new URL(uri)`(try/catch→null);`protocol !== "obsidian:"` → null;`action = url.hostname`(或 pathname 去斜杠);`url.searchParams` 自动百分号解码;switch(action) → open/new/search/unknown。纯函数,无 app。

**features/editor/obsidianUriHandler.ts（NEW）**：
```ts
export async function handleObsidianUri(app: GeodeApp, uri: string): Promise<boolean>; // 处理了返回 true
```
`parseObsidianUri(uri)` → switch（**已纳评审修复**）:
- `open`:target = file **`||`** path（评审 #5:`||` 非 `??`,空串 fallthrough）,无→false;from = activeFile ?? "";**`app.metadata.resolveLink(target, from) === null` → return false**（评审 #1:只开既有、绝不建,不继承 openWikilink 的 create 语义）;subpath = heading ? "#"+heading : block ? "#^"+block : undefined;`await openWikilink(app, target, from, subpath)`;true。
- `new`:name = file **`||`** name,无→false;path = name 带 .md 否则 +".md";`!vault.fileExists(path)` → try `vault.create(path, content ?? "")`(R43 原子 + **core `assertSafeRelPath` 守卫**拒穿越/控制符,失败 console.error);**`!vault.fileExists(path)` → return false**（评审 #4:不开幽灵 tab）;`workspace.openFile(path)`;true。
- `search`:`workspace.requestSearch(query ?? "")`;true。
- `unknown`/其它:false。
- **core `Vault.create` 入口加 `assertSafeRelPath(path)`**（评审 #2,新增）：拒空/绝对/`..`/控制符,双端(Memory+Tauri)一致。
（**vault 参数不强制**:单库 in-app 处理当前库;跨库路由属延后的 OS deep-link 范畴,记已知偏差。）

**features/editor/EditorPane.tsx**：anchor 点击分支(约 L666-672,现对非 `https?:` anchor `preventDefault`)加:`href.startsWith("obsidian://")` → `e.preventDefault()` + `void handleObsidianUri(app, href)` + return（先于通用 preventDefault）。
**main.tsx**：`__geodeUri` 探针(`parse: (uri)=>parseObsidianUri(uri)` 纯 + `handle: (uri)=>{ void handleObsidianUri(app, uri); }`);import parse from @core + handle from @features/editor。版本 0.45→0.46。

### 文件所有权（并行 implementer）
- **A（core 解析器 + main 探针）**：`src/core/obsidianUri.ts`(new) + `src/main.tsx`(`__geodeUri`,import parse[@core] + handle[@features/editor])。
- **B（执行器 + EditorPane hook + 版本）**：`src/features/editor/obsidianUriHandler.ts`(new) + `src/features/editor/EditorPane.tsx`(点击 hook) + 版本三处。
- **me（验证）**：`.calibration/r46-e2e.mjs`（解析对/错、open?file 开文件、open?file&heading reveal、search 开面板、笔记内 obsidian:// 链接点击路由）+ `.calibration/r46-probe.mjs`（`__geodeUri.parse` 纯 + `new` 动作 **on-disk 建文件**验证）。

### 已知偏差（写给后续轮）
- **🛑 OS 级 deep-link 延后(待用户拍板)**：`tauri-plugin-deep-link` 新 crate = 硬边界#5。本轮仅 in-app（笔记内链接 + 探针驱动）。
- **vault 参数不强制**：单库处理当前库;跨库窗口路由 = OS deep-link 范畴,延后。
- **live preview(CM)链接点击未 hook**：仅阅读视图 anchor 点击路由;CM 编辑器内 obsidian:// 点击走 CM 机制,延后（与既有外链点击同口径）。
- **plugin `registerObsidianProtocolHandler` 仍 gap-stub**：内置 in-app 处理非插件路由;插件自定义 action 注册延后。

## Round 45 additions — 保存的工作区布局（Workspaces）【As-built v0.45】

> **状态：As-built（v0.45 交付,2026-06-14）。** R32+ 候选池第三梯队 #⑭。命名保存/切换整个面板布局（pane 树 + tabs + sidebar 状态），存到
> `<vault>/.obsidian/workspaces.json`。**关键复用**：Workspace **已有** `persist()` + `sanitizeState(unknown)→WorkspaceState`（容错校验/迁移）+
> `closeMissingFileTabs(exists)`（剪缺失文件 tab）——命名工作区 = 同一序列化、只换存到磁盘命名槽。持久化**镜像 R27 bookmarks**（串行 RMW +
> vault-switch race guard + 保留未知 key）。**零新依赖、无 Rust**。**数据安全相关轮**（写 `.obsidian/` 用户配置——非笔记,但须非破坏性 + 容错坏 JSON）。
> 验证:typecheck 0 · `r45-e2e.mjs` **10/10** · `r45-probe.mjs` **6/6**（含 on-disk `.obsidian/workspaces.json` 验证）· cargo release 真实重建 37s ·
> 回归 r37/r39/r36/r43/r27-e2e 不回退。
> **⚠️ 契约字面量修正（评审 F2）**：`WORKSPACES_CONFIG` 不是 `".obsidian/workspaces.json"` 而是**裸 `"workspaces.json"`**——`vault.adapter.readConfig/writeConfig`
> **已相对 `<vault>/.obsidian/` 解析**（同 bookmarks 的裸 `"bookmarks.json"`）;字面 `.obsidian/...` 会写错到 `.obsidian/.obsidian/`。implementer A 落地时已正确修正。

### As-built（评审根因修复 — 10 finding → 6 确认[1 major + 5 minor,含 1 doc] 全修 + 4 证伪）

对抗评审 3 维 × find→verify。确认并修复:

1. **【major】`captureLayout` 序列化了 `theme`/`fontSize` → 违反契约「不存外观」+ state↔DOM 主题/字号脱钩**：`{...state, modal:null}` 含 theme+fontSize,存进工作区、load 时 `state.set` 写回但 DOM 主题/字号由独立 effect 应用 → 不同步。**修**：`captureLayout` 落 JSON 后 `delete snapshot.theme/fontSize`;`applyLayout` set 前 `next.theme = current.theme; next.fontSize = current.fontSize`（外观全局,saved 布局绝不改它）。
2. **【minor】`applyLayout` all-exist 常见路径不 emit `active-file:changed`/不重置 `lastActiveFile` → 派生状态（反链/大纲）陈旧**：`closeMissingFileTabs` 只在有文件被剪时触发通知。**修**：`applyLayout` set 后无条件 `this.pruneTabHistory(); this.emitActiveFile();`（对齐 reconcile-with-vault 的结构变更序列）。
3. **【minor】`applyLayout` 不清 session-only `tabHistory` → 旧布局 tab 的 nav 历史残留/与复用 id 串台**：同 #2 修复（`pruneTabHistory()`）一并解决。
4. **【minor】`workspaces.ts` `enqueue` 缺 bookmarks `regEnqueue` 的 try/catch+warn → persist 拒写（malformed-file 守卫 throw）被 `void` 调用方静默吞 → store 与磁盘静默分叉、零日志**。**修**：`enqueue` 包 `guarded` try/catch + `console.warn([workspaces] … failed)` 再 rethrow（bookmarks parity）。
5. **【minor / 数据安全】init 瞬时读失败（store→{}）+ 随后 persist 读成功 → `root.workspaces = store.get()` 只含新存的一个 → 抹掉 Obsidian/其它已存工作区**（desktop IPC 抖动窄窗）。**修**：persist 加守卫——store 空 **且** 磁盘 `workspaces` 非空 → console.warn + return（不覆盖,宁可不写;「内存空但磁盘有」更可能是 init 没成功）。
6. **【minor / doc】ARCHITECTURE 冻结契约 `WORKSPACES_CONFIG` 字面量 stale**（见上「契约字面量修正」）。本 As-built + 契约块已回写裸值。

> **证伪/by-design（未改）**：① **`applyLayout` 不 await flushAll** —— 证伪:EditorPane unmount 自带 flush,与既有 `closeTab`/`closeMissingFileTabs` 等所有「丢 tab」操作同一数据安全前置,载入工作区关 tab 不比它们更危险,**非新增风险**（我赛前自审误判为缺陷,评审对抗验证纠正）· Modal load 把 null 喂 applyLayout（竞态删除）→ sanitizeState 回落默认,非崩溃 · void persist 的 unhandled rejection（与 #4 同源,#4 已加日志）。

> **教训（写给后续轮）**：① **复用既有序列化要审「全字段语义」**——`{...state, modal:null}` 顺手带走了 theme/fontSize,而工作区**只该存布局**;复制一个状态快照时,逐字段问「这字段属于这次快照的语义吗」（modal=session 已排除,但 theme/fontSize=全局外观漏了）。② **结构性改 state 后要走 reconcile 三件套**——`pruneTabHistory` + `purgeNavLocations` + `emitActiveFile` 是 Workspace 既有的「丢/换 tab 后刷新派生态」惯例,applyLayout 是新的结构变更入口,**漏走惯例 → 派生面板陈旧 + session 态残留**;改 state 树的新方法都要对照既有 close/reconcile 方法补齐这套。③ **「逐字镜像 bookmarks」要把诊断也镜像**——只镜像了 RMW 守卫、漏了 try/catch+warn,导致守卫触发时反而最该有的日志没了;**镜像一个范式 = 连它的可观测性一起抄**。④ **赛前自审会误判**——我预判 flush 缺失为缺陷,评审证伪;**对抗验证「证伪」同样有价值,等它出结果再批量修,别抢修未确认项**。

### 契约（交付即实现，已纳评审修复）

**core/workspaces.ts（NEW，镜像 bookmarks.ts 持久化范式）**：
```ts
export const WORKSPACES_CONFIG = "workspaces.json"; // readConfig/writeConfig 已相对 <vault>/.obsidian/ 解析(同 bookmarks 裸 "bookmarks.json");字面 ".obsidian/..." 会双套→写错文件
export const workspacesStore: Store<Record<string, unknown>>; // name → Geode 布局(opaque,保留 Obsidian 原 entry)
export function initWorkspaces(vault: Vault): Promise<void>;   // 读文件 → 填 store(parse `workspaces` map);main.tsx 在 vault 加载时调(镜像 bookmarks.init)
export function listWorkspaceNames(): string[];               // store keys 排序
export function getWorkspaceLayout(name: string): unknown | null;
export function saveWorkspaceLayout(vault: Vault, name: string, layout: unknown): Promise<void>; // store.set + enqueue 写
export function deleteWorkspaceLayout(vault: Vault, name: string): Promise<void>;
```
持久化范式（逐字镜像 bookmarks）:串行 `enqueue` 队列;写时 vault.isOpen 守卫 + adapter 身份 race guard;RMW 读现有 `{...parsed}` **保留所有 top-level key**(`active` 等),`root.workspaces = workspacesStore.get()`(从 store blast,store 含 init 读入的 Obsidian 原 entry → 全保留);现有 `workspaces` 非对象 → **拒写**(不毁用户文件);坏 JSON catch+warn。

**core/workspace.ts（加 2 方法）**：
```ts
captureLayout(): unknown;  // {...state, modal:null} 落 JSON 后 delete theme/fontSize(外观全局,不存;评审 F1)
applyLayout(raw: unknown, exists: (path: string) => boolean): void; // sanitizeState(raw) → next.theme/fontSize = current(保留当前外观) → state.set → closeMissingFileTabs(exists) → pruneTabHistory() + emitActiveFile()(reconcile 派生态/session 历史,评审 F2/F3) → persist()。设 state 即驱动 EditorPane 重挂载开文件(同 restore())
```
**core/types.ts**：`ModalKind` 加 `"workspaces"`。

**features/workspaces/WorkspacesModal.tsx（NEW）+ index + css**：镜像 `features/palette/TemplateSelector.tsx`。列出 `listWorkspaceNames()`(`useStore(workspacesStore)` 反应式),每项 载入(`app.workspace.applyLayout(getWorkspaceLayout(name), app.vault.fileExists)` + closeModal)/删除(`deleteWorkspaceLayout`)按钮 + 顶部文本框「将当前布局存为…」(名非空 → `saveWorkspaceLayout(app.vault, name, app.workspace.captureLayout())`)。Escape + overlay click 关闭。

**app/App.tsx**：`ws.modal === "workspaces" && <WorkspacesModal />`(L744 模态链);注册命令 `workspace:manage`(无默认键,`() => app.workspace.openModal("workspaces")`)。
**main.tsx**：`workspaces.init(vault)` / `initWorkspaces(vault)` 接线(镜像 bookmarks 在 vault load/switch 处,L554-556 区)+ `__geodeWorkspaces` 探针(`save(name)`/`load(name)`/`list()`/`del(name)` 驱动 core,desktop 可驱动[store/vault 级,非 React effect])。
**i18n**：`dict.app.ts` `workspaces.title`/`workspaces.saveAs`/`workspaces.save`/`workspaces.load`/`workspaces.delete`/`workspaces.empty`/`workspaces.placeholder`/`cmd.manageWorkspaces`(en+zh)。版本 0.44→0.45。

### 文件所有权（并行 implementer）
- **A（core + types + main 接线 + 探针）**：`src/core/workspaces.ts`(new) + `src/core/workspace.ts`(captureLayout/applyLayout) + `src/core/types.ts`(ModalKind) + `src/main.tsx`(workspaces.init + `__geodeWorkspaces`)。
- **B（feature 模态 + app + i18n + 版本）**：`src/features/workspaces/*`(new) + `src/app/App.tsx`(模态渲染 + 命令) + `src/core/i18n/dict.app.ts`(workspaces.* + cmd.manageWorkspaces) + 版本三处。
- **me（验证）**：`.calibration/r45-e2e.mjs`（模态端到端:save current→list→load→delete + 容错缺失文件 load）+ `.calibration/r45-probe.mjs`（`__geodeWorkspaces` capture→save→**磁盘 `.obsidian/workspaces.json` on-disk 验证** + list/del）。

### 已知偏差（写给后续轮）
- **Obsidian 工作区 schema 未桥接**：存到 `.obsidian/workspaces.json` 同路径,但 per-workspace 布局值是 **Geode 形状**(非 Obsidian pane 树)。Geode 载入 Obsidian 原 entry → `sanitizeState` 回落默认(优雅降级,不崩);反之 Obsidian 载 Geode entry 亦不识。**path-compatible, schema-divergent**;全 schema 桥接延后。Obsidian 原 entry **非破坏性保留**(RMW blast from store,store 含原 entry)。
- **不存 theme/fontSize/modal**（外观全局 + modal 是 session;Obsidian 工作区亦只存布局）。
- **同名 save 覆盖**（Obsidian 同款）。

## Round 44 additions — Note composer：提取选区 → 新笔记（Extract current selection）【As-built v0.44】

> **状态：As-built（v0.44 交付,2026-06-14）。** R32+ 候选池第三梯队 #⑬ 的 **extract 切片**（#⑬ = 笔记合并/拆分 + 提取替换为链接;本轮做
> **提取选区→新笔记+替换为 `[[link]]`**,**合并 merge 延后**——merge 需「不移动文件只改链接」的 link-rewrite 变体,而 R16 引擎是
> rename-with-link-update[`vault.rename(A,B)` 在 B 已存在时会覆盖],重构冻结的 data-safety 引擎风险高,留 #⑬ 另一半）。
> **零新依赖、无 Rust**（纯前端;新笔记走 R43 已硬化的原子 `vault.create`）。**数据安全相关轮**（用户文本跨文件搬移）。
> 验证:typecheck 0 · `r44-e2e.mjs` **25/25** · `r44-probe.mjs` **17/17** · cargo release 真实重建 37s · 回归 r40/r43/r33-e2e + r42-probe 不回退。

### As-built（评审根因修复 — 13 finding → 5 确认[2 major + 3 minor,去重] 全修 + 8 by-design/证伪）

对抗评审 3 维 × find→verify。确认并修复:

1. **【major / 数据安全】async create 后用旧绝对 offset dispatch → 错删/RangeError**：命令拍下 `main.from/to` 快照 + selected 文本,`await vault.create`（桌面端是跨进程 IPC + `refreshTree`,毫秒级可重入窗口,编辑器**无 readonly 守卫**）后用**陈旧 offset** dispatch。坏路径 A=选区前被插入/删除致 offset 指向不同文本 → **静默删错位置=数据损坏**;坏路径 B=doc 变短致越界 → CM `RangeError`（dispatch 在 try 外,unhandled）。R33 `formatCommands.applyFormat` 是纯同步无 await 窗口故无此问题——这是 create-before-edit 引入 await **独有**的新风险。**修**（R16 splice-verification 精神 = 乐观锁文本指纹）:dispatch 前校验 `main.to <= doc.length && doc.sliceString(main.from,main.to) === selected`,不符则 abort（保留新笔记=无害重复,源不动=零损坏）。
2. **【major】`sanitizeNoteName` 对 `". ."` 类输入塌成 `"."` → 文件名 `"..md"` + 坏链 `"[[.]]"`**：`replace(/^\.+/, "")` 只去**首**点;`". ."` → 去首点 → `" ."` → trim → `"."`（非空,返回）。**修**：去**首尾**点 `/^\.+|\.+$/g`,塌空→"Untitled"（连带修「`note.` 尾点 → `note..md`」）。
3. **【minor】C0 控制字符（NUL/BEL,`\s` 不覆盖非空白控制符）泄漏进文件名+wikilink**：我上一版为去裸字节卫生问题删了控制范围,注释断言「`\s+` 折叠即可」对非空白控制符**为假**。**修**：`\p{Cc}` Unicode 类剥离控制字符（无裸字节、可读）。
4. **【minor】派生名无长度上限 → 超长/86+ CJK 字符超 255 字节 → 桌面 ENAMETOOLONG 静默失败**（浏览器 Memory 无限制 → 双端分歧）。**修**：按 UTF-8 边界（`for...of` 码点迭代）裁到 ≤200 字节（留 uniquePath ` N.md` 余量）。
5. **【minor】纯空白选区（非 empty）建空 Untitled 笔记**：`available` 仅守 `!main.empty`。**修**：`if (selected.trim().length === 0) return;`。

> **证伪/by-design（未改）**：链接 basename 歧义（Obsidian 同款,已记已知偏差）· 多选区只取 main（与 formatCommands 一致、Obsidian 单提取语义）· `getActiveFileEditorView` 双侧门控正确（命令不误改后台文件）· `parentPath` 根空串 + `uniquePath` 三元 prefix 正确 · `extractedContent` 尾部裁剪**不**吃有意义内容（`"x = 1   "→"x = 1"` 实测）· i18n 键注释归属/探针注释（纯文档 nit）。

> **教训（写给后续轮）**：① **引入 `await` 就引入重入窗口**——同步命令（formatCommands）的绝对 offset 永远有效,但 create-before-edit 的 await 期间文档可变,**await 后必须复验捕获跨度再写**（R16 splice-verification、R23「await 后视图重校验」同根反复出现）。② **文件名 sanitize 是对抗输入重灾区**:首尾点/纯点塌成 `.`、控制符泄漏、超长越界——一个看似简单的纯函数藏 3 个 edge,凡「用户文本 → 文件名」必过 控制符/点/长度/元字符 四关。③ 删「belt-and-braces」防御前先想清它防的是什么——我删控制范围只为源卫生,却漏了非空白控制符,**正确做法是换等价干净写法（`\p{Cc}`）而非直接删**。

### 契约（交付即实现，已纳评审修复）

**核心数据安全不变式 = create-before-edit 排序**：先 `vault.create` 把选区文本持久化进新笔记（R43 `create_new` 原子写),
**成功后才** dispatch 源编辑器事务删掉选区。create 失败 → abort、源文件一字不动 → **零丢失**。无 R16 跨文件 link-rewrite（新笔记无入链）。

**core/noteComposer.ts（NEW，纯函数）**：
```ts
export type ExtractMode = "link" | "embed";
// 同时守【文件名】+【wikilink】安全:剥离控制字符(\p{Cc}) + []#^|/\:*?"<> + 折叠空白 + trim
// + 去【首尾】点(防 ".."/"note." 塌成坏名) + 按 UTF-8 边界裁 ≤200 字节;空/全点 → "Untitled"。（评审硬化:控制符/首尾点/长度）
export function sanitizeNoteName(raw: string): string;
// 默认名:选区(跳过空行后)首行若是 ATX 标题取其文字、否则取首非空行 → sanitizeNoteName
export function deriveNoteName(selectedText: string): string;
// 新笔记内容:选区逐字(尾换行规整为单个 \n)
export function extractedContent(selectedText: string): string;
// 替换进源文件选区处的文本:`[[name]]`(link) | `![[name]]`(embed)
export function extractReplacement(noteName: string, mode: ExtractMode): string;
```

**features/editor/noteComposerCommands.ts（NEW）**：`registerComposerCommands(app: GeodeApp, getView: () => EditorView | null): Array<() => void>`。
注册 `editor:extract-selection`（无默认键;`available = getView()!==null && !selection.empty`）。callback 流程（**create-before-edit**）:
① `view`+`activePath=workspace.getActiveFile()` 取真值;② `selected = doc.sliceString(from,to)`,**纯空白则 return**（评审 #5）;③ `name=deriveNoteName(selected)`;
④ `folder=parentPath(activePath)`、`notePath=vault.uniquePath(folder,name)`（碰撞 ` 1`/` 2` 后缀）;⑤ **`await vault.create(notePath, extractedContent(selected))`**——失败 catch+console.error+return（源不动）;
⑥ **await 后乐观锁守卫（评审 #1 数据安全）**:`main.to > doc.length || doc.sliceString(main.from,main.to) !== selected` → console.warn + return（选区被并发改动 → 保留新笔记[无害重复]、不删错源）;
⑦ `finalName=basename(notePath).replace(/\.md$/i,"")`、`view.dispatch({changes:{from,to,insert:extractReplacement(finalName,"link")}, selection:{anchor:from+insert.length}, userEvent:"input.extract"})` + `view.focus()`。**不自动导航到新笔记**（停在源,链接可点;记已知偏差）。

**app/App.tsx**：注册 effect 加 `...registerComposerCommands(app, () => getActiveFileEditorView(app)?.view ?? null)`（紧邻 `registerFormatCommands`,L377 区）。
**main.tsx**：`__geodeComposer` 纯探针（`derive`/`content`/`replacement`,desktop probe + 确定性纯测；命令路径走浏览器 E2E,App effect 后台不跑）。
**i18n**：`dict.app.ts` `cmd.extractSelection`（en+zh）。版本 0.43→0.44。

### 文件所有权（并行 implementer）
- **A（core + 探针 + i18n）**：`src/core/noteComposer.ts`(new) + `src/main.tsx`(`__geodeComposer`) + `src/core/i18n/dict.app.ts`(`cmd.extractSelection`)。
- **B（feature + app wiring + 版本）**：`src/features/editor/noteComposerCommands.ts`(new) + `src/app/App.tsx`(注册) + 版本三处（`package.json`/`src-tauri/tauri.conf.json`/`src/features/settings/SettingsModal.tsx`）。
- **me（验证）**：`.calibration/r44-e2e.mjs`（端到端:开笔记→设选区→execute→新笔记含选区文本+源含 `[[name]]` + 碰撞后缀 + 纯函数对抗输入）+ `.calibration/r44-probe.mjs`（`__geodeComposer` 纯函数,含空/全空白/CJK/非法字符/裸 `#`）。

### 已知偏差（写给后续轮）
- **合并 merge 延后**（= #⑬ 另一半;需 link-rewrite-only 变体,R16 引擎重构风险高）。
- **extract 不自动导航到新笔记**（停在源;Obsidian 会打开新笔记——延后,避免跨 tab flush 复杂度）。
- **链接按 basename `[[name]]`**（uniquePath 仅查目标文件夹;若别处有同名 basename 文件 → 链接歧义,罕见,Obsidian 同款 basename 行为）。
- **embed 模式 core 已支持但未注册命令**（仅 link 命令;embed 变体留后续）。

## Round 43 additions — 日记日历 + 前/后一日导航（Calendar pane + daily-note nav）【As-built v0.43】

> **状态：As-built（v0.43 交付,2026-06-14）。** R32+ 候选池第三梯队 #⑫ 的 **日历切片**（#⑫ = 日记日历 + 可配置日记;本轮做日历 +
> 前后日导航,**可配置设置 UI 延后**,沿用现有 "Daily Notes/YYYY-MM-DD" 约定）。**零新依赖**;**意外动了 1 处 Rust**（评审发现
> `vault_create` 历史 TOCTOU 薄弱点被本轮摆上热路径 → 顺手硬化,见下「As-built」）。侧栏月历**自绘**(CSS grid,无日历库)。
> 验证:typecheck 0 · `r43-e2e.mjs` **22/22** · `r43-probe.mjs` **13/13** · cargo release 真实重建 37s · 回归 r42-probe 10 + r41-e2e 21 不回退。

### As-built（评审根因修复 — 8 条确认 finding 全 minor,逐条已修）

对抗评审 3 维 × find→verify:9 findings,**8 确认（全 minor）+ 1 证伪**（`key=toISOString()`/UTC/分层/颜色/tree 反应式 → 无缺陷）。逐条修复:

1. **`parseDailyStamp` 跑整 path → 父目录日期遮蔽真名**（契约违反 L87「从 basename 抽」）。实测 `"2020-01-01-backup/2026-06-14.md"`→`2020-01-01`、`"12025-06-14.md"`→`2025-06-14`（5 位年 over-match）、`"meeting-2026-06-14-notes.md"`→误匹配。**修**：取 `basename` 再跑 + 锚定 `^(\d{4})-(\d{2})-(\d{2})(?:\.md)?$`。（`parseDailyStamp` 唯一外部用户 = `main.tsx` `__geodeDaily` 探针,喂裸 stamp 仍通过。）
2. **子文件夹日记 next/prev 静默逃出原文件夹**（同根因）：`Archive/2026-06-14.md` 被识别为日记 → next-day 落到 `Daily Notes/2026-06-15.md`。**修**：新增 `isDailyNotePath(path)`（要求 `DAILY_FOLDER + "/"` 前缀 **且** basename 是合法 stamp）门控 `baseDate()`——只有**真**日记才作导航基准,否则回落今天。一并修掉 #1 与「嵌入日期非日记文件误判」(#7)。
3. **`vault_create` 桌面端 `exists()`-then-`fs::write` 截断窗口**（data-safety / 第一底线）：与 R17 为 `vault_write_binary` 修的**同一根因**,当年独漏此命令;`openOrCreateDailyNote`(Mod+D/点日历)把它摆上热路径。外部进程在 check↔write 间落地同名文件 → `fs::write` 截断丢内容。**修**：改 `OpenOptions::new().write(true).create_new(true).open()` + `write_all` + `sync_all` + 失败 `remove_file` 回滚（逐字对齐 write_binary 的 R17 范式）。「绝不截断已存在用户数据」升为系统调用级保证。无 TS 依赖旧错误串（grep 确认,浏览器路径走 MemoryVault 自抛）。
4. **create 失败仅 console.error 不 openFile**：竞态下文件其实已存在却静默无响应。**修**：catch 中 `if (vault.fileExists(path))` 仍 `openFile`,只有真不存在才 return。
5. **月名/星期 locale 裸读 localStorage**（首次运行 zh 浏览器无 `geode.locale` 时与 UI 语言不一致）。**修**：走 i18n `locale` Store（`useStore(locale)`,`useI18n` 本已订阅 → 切语言即重渲）。
6. **上/下月 aria-label 硬编码英文**（违反 UI 字符串一律 `t()` 铁律）。**修**：`calendar.prevMonth`/`calendar.nextMonth` i18n 键（en+zh）。
7. （= #1/#2 同根因,已随 `isDailyNotePath` 门控修掉。）
8. **`monthLabel` 每渲染重建 `Intl.DateTimeFormat` 未 memo**（与同组件 `weekdays` 的 `useMemo` 不一致）。**修**：包 `useMemo([intlLocale, view.year, view.month0])`。

> **教训（写给后续轮）**：① 历史命令的薄弱根因会被新功能「重新激活」——R17 只硬化了 binary 写,普通 `vault_create` 漏网,直到日历把它摆上热路径才暴露;**修一类根因时要全命令面扫一遍同类**。② 正则抽日期**必锚定到 basename**,否则父目录/嵌入数字 over-match;契约写「从 basename」实现却跑整 path = 注释与实现脱节的经典坑。③「识别为日记」与「在哪个文件夹」是两件事——导航基准要**双重门控**（文件夹前缀 + 文件名形态）。

### 契约（交付即实现，已纳评审修复）

**core/dailyNote.ts（NEW，纯函数 + 一个 app-helper）**：
```ts
export const DAILY_FOLDER = "Daily Notes";
export function dailyStamp(date: Date): string;        // 本地 YYYY-MM-DD
export function dailyNotePath(date: Date): string;     // Daily Notes/YYYY-MM-DD.md
export function parseDailyStamp(path: string): Date | null;  // 从 BASENAME 锚定抽 YYYY-MM-DD(?:.md)? → 本地午夜 Date / null（评审硬化）
export function isDailyNotePath(path: string): boolean;       // DAILY_FOLDER/ 前缀 + 合法 stamp basename → 门控 next/prev 导航基准（评审新增）
export function addDays(date: Date, n: number): Date;
export function sameDay(a: Date, b: Date): boolean;
export function monthGrid(year: number, month0: number): Date[][];  // 6×7,周日起,含相邻月填充,各 cell 本地午夜
export function openOrCreateDailyNote(vault: Vault, workspace: Workspace, date: Date): Promise<void>; // 不存在则建 (folder+`# stamp\n\n`) 再 openFile;create 失败但文件已存在(竞态)仍 openFile
```
（`Vault`/`Workspace` 从 core import;`openOrCreateDailyNote` 取显式 vault+workspace 参数 → plugin[AppHandle] 与 feature[GeodeApp] 都可调,解耦。）

**plugins/daily-note.ts**：`openToday` refactor 为 `openOrCreateDailyNote(app.vault, app.workspace, new Date())`;新增 `daily-note:next-day` / `daily-note:prev-day`（无默认键）——基准 `baseDate()` = 活动文件**经 `isDailyNotePath` 门控**确为真日记时取 `parseDailyStamp(activeFile)`、否则今天,`addDays(±1)` 后 openOrCreate。保留 `open-today`（Mod+D）。

**features/calendar/CalendarPanel.tsx（NEW）+ index + css**：右侧栏面板。state = 显示中的 {year, month0}（初始今天）。`useStore(vault.tree)` 反应式。`monthGrid` 渲染 6×7;每格:日数 + today 高亮(`sameDay`) + 有笔记标记(`vault.fileExists(dailyNotePath(cell))`)+ 相邻月 dim(`cell.getMonth()!==month0`);点击 → `openOrCreateDailyNote(app.vault, app.workspace, cell)`。头部:月名+年（`Intl.DateTimeFormat` locale-aware,零 i18n 键）+ 上/下月 + 「今天」按钮。

**app/App.tsx**：右 ribbon `calendar` tab（`data-testid="right-tab-calendar"`,icon `calendar`,`setRightPanel("calendar")`）+ body 分支 + effectiveRight 分支。**icons.tsx 加 `calendar`**（Lucide）。
**main.tsx**：`__geodeDaily` 探针（纯 helpers:dailyStamp/dailyNotePath/parseDailyStamp/monthGrid 维度）。
**i18n**：`dict.app.ts` `app.tabCalendar`;`dict.panels.ts` `calendar.today`。版本 0.42→0.43。

### 文件所有权（并行 implementer）
- **A（core+plugin+probe）**：`src/core/dailyNote.ts`(new) + `src/plugins/daily-note.ts` + `src/main.tsx`(`__geodeDaily`)。
- **B（日历面板+app）**：`src/features/calendar/*`(new) + `src/app/App.tsx`(右面板) + `src/app/icons.tsx`(calendar 图标) + `src/core/i18n/dict.app.ts`(app.tabCalendar) + `src/core/i18n/dict.panels.ts`(calendar.today)。
- **me（验证）**：`.calibration/r43-e2e.mjs`（pure helpers + 面板渲染/today/有笔记/点击开建/月导航 + next/prev-day 命令）+ `.calibration/r43-probe.mjs`（__geodeDaily 纯 helpers + daily-note 命令 store 真值）。

### 已知偏差（写给后续轮）
- **可配置日记设置 UI 延后**（格式/文件夹/模板写死 "Daily Notes/YYYY-MM-DD";#⑫ 另一半）。
- **月历周日起**（非 locale-aware 周起点;Obsidian 可配周一起,延后）。
- **有笔记标记按 fileExists 逐格查**（一个月 ≤42 格,vault.fileExists 是 cache 查,廉价）。
- **create 真失败仅 console.error**（无 toast——Geode core 尚无 notice infra;评审 #4 残留,加 notice 超本轮范围）。
- **次/前日导航不保留来源文件夹**：只认 `DAILY_FOLDER` 下的真日记作基准,非默认布局（用户把日记组织进别处）下 next/prev 回落今天/写回 `Daily Notes`,非数据风险;可配置文件夹随 #⑫ 另一半再议。

## Round 42 additions — 回收站（本地 `.trash/` recoverable delete）【As-built v0.42】

> **状态：As-built（2026-06-14）。数据安全关键轮（已加载 data-safety skill）。** R32+ 候选池第三梯队 #⑪ 的 **trash 切片**
> （#⑪ = 回收站 + 文件恢复快照;本轮只取「本地 `.trash/` 回收站」,**快照 + 专用 UI 延后**）。**修数据安全底线违规**:
> 删除原走 Rust `vault_delete`（`fs::remove_*` **永久删 = 丢数据**）→ 改为移到 `<vault>/.trash/`（**可恢复**）。**零新 crate
> 依赖**（仅 `std::fs::rename`/`create_dir_all`/`read_dir` → **不撞硬边界 #5**；系统回收站[需 `trash` crate]显式不做）。
> `.trash` 自动隐藏:Rust+Memory tree walk 都 skip `.` 前缀 → 不入可见树、不被索引。

### 契约（冻结）

**src-tauri/src/main.rs — 2 新命令（`std::fs` only）+ 注册到 invoke_handler**：
```rust
fn vault_trash(vault, path) -> CmdResult<String>   // safe_join → mkdir .trash → 唯一名（碰撞加 ` <n>`）→ fs::rename → 返回 ".trash/<name>"
fn vault_list_trash(vault) -> CmdResult<Vec<String>> // read_dir(.trash) → [".trash/<entry>", ...]（不存在则空）
```

**src/core/vault.ts**：
- `VaultAdapter` 接口加 `trash(path): Promise<string>`（返回 trash 相对路径）+ `listTrash(): Promise<string[]>`。
- `TauriVaultAdapter`：`trash`→`invoke("vault_trash",{vault,path})`;`listTrash`→`invoke("vault_list_trash",{vault})`。
- `MemoryVaultAdapter`：`trash`=把 `files`/`folders` 条目移到 `.trash/<唯一名>`（含文件夹递归移子项,collision 加 ` <n>`）;
  `listTrash`=过滤 `.trash/` 顶层条目;**`listTree` 加 skip：首段 `startsWith(".")` 的路径不入树**（对齐 Rust walk,防 `.trash` 显示/被索引）。
- `Vault`：`trash(path)`（adapter.trash + 清 cache（path 及其子）+ refreshTree + emit `file:deleted` + `vault:changed "delete"`;返回 trashPath）;
  `listTrash()`（透传 adapter）;`restoreFromTrash(trashRelPath, targetPath)`（**adapter.rename 原始 move,绝不走 Vault.rename 的链接改写** + refreshTree + emit `file:created` + `vault:changed "create"`）。

**接线**：`features/explorer/Explorer.tsx` 删除 `vault.remove(node.path)` → `vault.trash(node.path)`（确认对话文案改「移到回收站」如有）;`compat/obsidian/vault.ts` 的 `trash`/`trashLocal` stub → `vault.trash`（gap 关闭）;**`delete`/`vault.remove` 保留永久删**（内部/未来 empty-trash 用）。版本 0.42。

### 文件所有权（并行 implementer）
- **A（Rust）**：`src-tauri/src/main.rs`（vault_trash + vault_list_trash + 注册）。
- **B（vault.ts 全部）**：`src/core/vault.ts`（接口 + 两 adapter trash/listTrash + Memory listTree dot-skip + Vault trash/listTrash/restoreFromTrash）。
- **C（接线+版本）**：`src/features/explorer/Explorer.tsx` + `src/compat/obsidian/vault.ts` + 三处版本号 + i18n（删除文案如有）。
- **me（验证，数据安全关键）**：`.calibration/r42-e2e.mjs`（memory：删→listTrash 含它→restore 回来→tab/index 反应）+ `.calibration/r42-probe.mjs`（**真二进制：删一个文件 → Node fs 读 `<vault>/.trash/` 确认它在那里、原位置消失（绝不永久丢）→ restore → 回原位**）。

### As-built（评审修复 + 教训）

> **验证**：typecheck 0 + 浏览器 `r42-e2e` **17/17**（trash 可恢复 + restore + 开着 tab 关闭 + 碰撞 + **binary 附件 trash +
> 文件夹含 binary 全移除 + 文件夹 restore 重索引子项 + 空路径拒绝**）+ 桌面 `r42-probe` **10/10**（**真 fs：删除文件物理移到
> `.trash/`、内容保留、restore 回原位**）+ r24/r28/r31-r41 不回退 + r26-bytes 0 + cargo/build 绿。
> **3 维对抗评审 18 finding → 5 修复（3 major + 2 defensive）+ 13 nit/by-design/证伪**。

**3 个 major（已修）**：① **MemoryVaultAdapter.trash 不处理 `binaryFiles`**——浏览器删二进制附件（粘贴的图片）落 else 分支
`throw "Path not found"` → Explorer catch 后静默无反应（桌面 `fs::rename` 不受影响）。修 = 加 `binaryFiles` 分支（move 条目）+
碰撞检测 `taken()` 含 binaryFiles。② **文件夹 trash 遗漏 binaryFiles 子项**——trash 含图片的文件夹时图片滞留 binaryFiles →
`listTree` 把已删文件夹「复活」容纳孤儿 → 树/底层不一致。修 = 文件夹递归分支同时搬 binaryFiles 子项。③ **`restoreFromTrash`
恢复「文件夹」时其 `.md` 子项不重索引**——原 emit `file:created{folderPath}` → metadata `reindexFile` 因非 `.md` 早退 →
backlinks/graph/search/switcher 全缺失至重载。修 = **改 emit `file:renamed{oldPath:trashRel, newPath:target}`**（metadata 对
文件走 reindexFile、对**文件夹走 reindexFolder 递归**;`file:renamed` 事件不改写链接文本——那在显式 `renameWithLinkUpdate`,非
事件监听器）。

**2 个 defensive（已修）**：④ **`vault_trash` 空/`.` 路径无守卫**（safe_join 放行 CurDir → 可对整库根 rename;虽 EINVAL 失败
安全）→ 加显式 `path 空/"."/"./"` → Err。⑤ **trash 前不 flush 活动编辑器**（删开着且脏的文件 → 未保存编辑丢、`.trash` 只存
last-saved;同旧 remove 非回退,但本轮文案改「移到回收站」升了无损预期）→ Explorer.deleteNode 在 trash 前 `await
workspace.flushAll()`（**trash-before-flush = 真正无损**）。

### 已知偏差（写给后续轮）
- **只做本地 `.trash/`，不做系统回收站**（OS trash 需 `trash` crate = 新依赖，硬边界,显式不做）。
- **不做文件恢复快照（File recovery）**（#⑪ 另一半,延后;`.trash` 已修永久删底线）。
- **无专用回收站 UI 面板**（`.trash` 隐藏于树;restore 走核心方法 + 未来 UI;listTrash/restoreFromTrash 已就绪供接）。
- **trash flatten 丢原始目录**：trash `a/b/note.md` → `.trash/note.md`（只取 basename）;`listTrash` **不携带原路径**,
  `restoreFromTrash` 必须由**调用方指定 targetPath**,默认无法自动回原嵌套目录（Obsidian 本地 `.trash` 同样 flatten）——接 restore UI 时注意。
- **`.trash` 碰撞用 ` <n>` 计数后缀**（含点文件夹名如 `My.Notes` 会切成 `My 1.Notes`,双端一致,纯美观）。
- **`vault_trash` 用 `to_string_lossy`**：Linux 非法 UTF-8 文件名 rename 后名字可能损坏（内容不丢;macOS 强制 UTF-8 不触发;未来可对齐 `vault_write` 的 OsString 路径）。
- **碰撞命名 exists()→rename 非原子（TOCTOU）**：外部进程在窄窗口落同名 `.trash` 文件时 Unix rename 覆盖之（覆盖的是已删数据,影响极小）。

## Round 41 additions — 标签面板 + 编辑器 `#` 标签补全（Tags pane + `#` tag completion）【As-built v0.41】

> **状态：As-built（2026-06-14）。** R32+ 候选池第三梯队 #⑩ = 已核实缺口（`metadata.getTagMap()` 有数据无面板消费;
> 编辑器无 `#` 补全源）。两部分同属「标签」：**① 标签面板**（右栏,镜像 R30 allproperties）+ **② `#` 补全源**（镜像 R31
> slashCommands / `[[` wikilink）。**零新运行时依赖**;新增**一个 consume-once Store**（`searchRequest`,镜像 revealTarget）
> 实现「点标签 → 注入搜索」（SearchPanel 已有 `#tag` 浏览,只缺外部注入）。
> **验证**：typecheck 0 + 浏览器 `r41-e2e` **21/21**（纯补全 trigger/candidates + 面板渲染/计数降序/点击注入 + live `#`
> 弹窗+Enter + 退化 frontmatter 标签排除 + `(#` 触发）+ 桌面 `r41-probe` **11/11**（纯逻辑 + searchRequest store 真值）+
> r24/r31-r40 不回退 + `r26-bytes` 0 + cargo/build 绿。**3 维对抗评审 19 finding → 3 确认修复 + 16 nit/by-design/证伪**（详见 As-built）。

### 契约（冻结）

**core/workspace.ts — 搜索注入（consume-once，镜像 revealTarget/addPropertyRequest）**：
```ts
readonly searchRequest = new Store<string | null>(null);
/** Open the left search panel and seed its query (e.g. `#tag` from the Tags pane). */
requestSearch(query: string): void   // searchRequest.set(query); setLeftPanel("search")
```
SearchPanel 消费：`useStore(workspace.searchRequest)` → useEffect 非空时 `setQuery(req)` + `workspace.searchRequest.set(null)`。

**features/tags/TagsPanel.tsx（NEW）+ index.ts + tags.css** — 右侧栏面板：`useStore(metadata.revision)` 反应式;从
`getTagMap(): Map<string,Set<string>>` 建列表，**按计数降序、同计数按名称升序**;每行渲染 `#tag` + 计数（set.size），
点击 → `workspace.requestSearch("#" + tag)`;空态 `t("tags.empty")`。

**app/App.tsx** — 右 ribbon 加 `tags` tab（`data-testid="right-tab-tags"`,icon `hash`,`title=t("app.tabTags")`,
`setRightPanel("tags")`）+ body 分支 `ws.rightPanel === "tags" ? <TagsPanel/>`。`RightPanelKind` 已含 `(string & {})` → "tags" 合法。

**features/editor/tagCompletion.ts（NEW）** — 镜像 slashCommands：
```ts
export const TAG_RE = /(^|[\s(])(#[A-Za-z0-9_\/\-一-鿿]*)$/;  // # + tag chars，行首/空白/( 后（同 metadata gate）
export function tagTrigger(before: string): { query: string } | null;  // 命中→query(去 #)；inside [[ 抑制
export function tagCandidates(tags: string[], query: string): string[]; // 空 query=按名升序;非空=fuzzy 打分
export function tagCompletionSource(app: GeodeApp);  // getTagMap keys → tagCandidates → 插入 #tag
```
触发：单个 `#` + 可选 tag 字符（`##`/`# `(heading) 不触发——多 `#` 或 `#`+空格不匹配;**已知 gap**：裸 `#` 起标题时
闪一下标签列表,空格即关）。apply：替换 `#query` 段为 `#fulltag`。

**cmExtensions.ts** — `autocompletion.override` 数组追加 `tagCompletionSource(app)`（现 `[wikilink, slash]` → 加 tag）。
**main.tsx** — `__geodeTag` 探针（loadExternal 前）：`{ trigger:(before)=>tagTrigger(before), candidates:(query)=>tagCandidates([...metadata.getTagMap().keys()], query) }`。
**i18n** — `dict.panels.ts`：`tags.title`/`tags.empty`/`tags.count`;`dict.app.ts`：`app.tabTags`（ribbon tooltip）。版本 0.40→0.41。

### 文件所有权（并行 implementer）
- **A（编辑器补全）**：`src/features/editor/tagCompletion.ts`(new) + `src/features/editor/cmExtensions.ts`(加 source) + `src/main.tsx`(`__geodeTag`)。
- **B（标签面板+app）**：`src/features/tags/*`(new) + `src/app/App.tsx`(右面板) + `src/core/i18n/dict.panels.ts`(tags.*) + `src/core/i18n/dict.app.ts`(app.tabTags)。
- **C（搜索注入+版本）**：`src/core/workspace.ts`(searchRequest+requestSearch) + `src/features/search/SearchPanel.tsx`(消费) + 三处版本号。
- **me（验证）**：`.calibration/r41-e2e.mjs` + `.calibration/r41-probe.mjs`。

### 探针/E2E 策略
- `#` 补全纯逻辑（tagTrigger/tagCandidates）→ `__geodeTag` 探针双端可驱动（R31 模式）;补全 accept 走浏览器 E2E（live view）。
- 标签面板 = React 组件（live view）→ 浏览器 E2E（点击渲染 + requestSearch 注入 → SearchPanel query）;桌面探针验 `getTagMap` + `requestSearch` store 真值（store 操作可驱动）。

### As-built（评审修复 + 教训）

**3 个确认修复（已修）**：① **`getTagMap()` 无缓存,补全热路径每键全库重建+排序**——CM6 补全源故意省 validFor → 弹窗期间
每键重跑 → 每键 `[...getTagMap().keys()]` 全库遍历 + sort（兄弟 `getPropertyKeys`/`getPropertyKeyCounts` 早有 revision
缓存,唯 getTagMap 没做）。修 = 加 `tagMapCache: {rev, map}` revision 缓存（镜像 propertyKeyCountsCache;返回缓存 Map,
消费方皆只读——同既有 getPropertyKeyCounts 口径）。② **退化 frontmatter 标签泄漏**——`parseNote` 把 frontmatter `tags:`
原样入索引（仅 `replace(/^#/,"")`,无校验）→ `tags: ["#", "bad space"]` 把空串/含空格键塞进 getTagMap,R41 首次直接消费
keys 故新暴露（面板渲染空名行、补全把 `#bad space` 当候选 → accept 插入无效文本）。修 = parseNote 过滤 `tag.trim()!==""
&& !/\\s/.test(tag)`（行内 tag 因 TAG_RE 的 `+` 永不空/带空格,纯 frontmatter 路径,根因修在索引层）。③ **`(#tag` 补全 gate
不一致**——补全 TAG_RE 原 `(^|\\s)` 而 metadata/装饰用 `(^|[\\s(])` → `(#tag` 被索引却不弹补全。修 = 补全 gate 对齐
`(^|[\\s(])`（`#` 偏移不变,`(` 不入 m[2]）。

**16 个 nit/by-design/证伪**：TAG_RE 词中/URL/多井号/heading 边界全正确（`(^|[\\s(])` 守卫）;apply 偏移在行内多 `#`/嵌套
`#a/b`/空 query/词中全正确;三补全源（wikilink/slash/tag）对所有重叠输入互斥（`[[` 守卫逐字同 slash）无候选混合;`#` accept
走 CM 标准事务 → autosave 无新写路径;CJK 仅 BMP 表意（`一-鿿`,kana/Ext-A/Hangul 不收——**三正则[metadata/装饰/补全]同步、
镜像既有限制,非 R41 引入**,记已知限制);代码围栏/行内 code 内 `#` 仍弹补全（三源共有 gap,无 fence 守卫——accept 的 `#tag`
在 code 内本不被索引,无害菜单噪声);**标签计数 = 文件数（Set.size）非出现次数**（合契约 + 同 SearchPanel `#` 浏览器,Obsidian
是出现次数——保真 gap,记)。

### 已知偏差（写给后续轮）
- 裸 `#` 起标题时标签补全闪现（单键,空格即关）——Obsidian 同样 `#` 即弹标签。
- 标签面板与 SearchPanel 的 `#` 浏览器**两套**（面板=持久全库列表;搜索=临时）——Obsidian 亦分离。
- `requestSearch` 是新增的程序化搜索注入（bookmarks 的 search 书签类型曾记此 gap,未来可复用）。
- **标签计数 = 含该标签的文件数（非出现次数）**,与 SearchPanel `#` 浏览器一致;Obsidian 显示出现次数（保真 gap）。
- **`#` 补全 CJK 仅 BMP 表意字（`一-鿿`）**,kana/CJK Ext-A/Hangul/emoji 不触发——与 metadata 索引 + 装饰器**同字符类**（三处同步,改需一起改）。
- **代码围栏/行内 code 内 `#` 仍弹标签补全**（无 syntaxTree 守卫,与 slash/wikilink 三源共有;accept 的 `#tag` 在 code 内不被索引,无害）。

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
