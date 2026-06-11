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
- `core/commands.ts` — `CommandRegistry`: `register({id, name, hotkey?, callback})` → disposer, `execute(id)`, `list()`, `revision` store. Hotkeys handled globally by App shell.
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

## Round 16 additions (current) — 重命名自动更新引用 + `[[#h]]` 同文链接

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
  改为 ` ` 转义（运行时字符串等价）——该字节让 ripgrep 把整个文件按二进制
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
