# Geode Roadmap

## 核心使命（不变项）

> 复刻 Obsidian 的核心用户体验，做成一个**完整、可拓展、可商业交付**的 Windows 桌面知识库应用。
> 本地优先（笔记是用户磁盘上的纯 .md 文件）、键盘优先、插件可拓展。

每一轮迭代都必须守住四条底线：

1. **数据安全**：任何路径下用户的编辑不丢失（自动保存、关窗 flush、重命名/删除/外部修改竞态全覆盖）
2. **构建常绿**：TS strict 0 错误、`cargo check` 通过、生产构建成功才算完成
3. **双端可验证**：浏览器模式（MemoryVaultAdapter）跑 E2E，桌面端实测真实文件系统
4. **契约先行**：跨模块接口先冻结在 `ARCHITECTURE.md`，再并行开发

### 方向校准（2026-06-10，R3 末）

商业主轴确立为 **Obsidian 插件生态一键迁移**：以兼容层（shim）方式实现 Obsidian 插件
API 的分 Tier 兼容，开发中用 WebFetch 对照 `docs.obsidian.md` 与官方 `obsidian.d.ts`
自我校准，用真实插件套件验收。完整判断、Tier 表、法律边界、验收方式见
**`docs/OBSIDIAN-COMPAT.md`**（后续轮次的头号输入）。Geode 原生插件 API 保持第一公民，
shim 建立其上。

## 已完成

### R1 — v0.1（2026-06-10）核心复刻

vault/文件树/CM6 编辑器（wikilink 补全+跳转）/阅读视图/反链/图谱/全文搜索/
命令面板/快速切换/标签页/主题/设置/插件 API + 3 内置插件/Tauri Rust 后端/NSIS 安装包。
评审确认 12 缺陷全修复（2 critical：文件夹重命名丢索引、重命名竞态丢编辑）。

### R2 — v0.2（2026-06-10）实时预览 + 桌面级完整性

**Live Preview**（CM6 选区感知装饰，语法标记就地隐藏/揭示）、三态模式 live/source/reading、
**文件监听**（Rust notify → 编辑器非脏自动重载）、**外部插件** `<vault>/.geode/plugins/*.js`、
大纲面板、frontmatter（aliases 参与链接解析）、侧栏拖拽调宽、右栏 Tab 化。
评审确认 4 缺陷全修复（1 critical：watcher 文件夹路径误判为删除）。

### R3 — v0.3（2026-06-10）分屏 + 万级性能

**分屏 panes**：Workspace 升级为 pane 树（`PaneLeaf`/`PaneSplit`，v1 持久化自动迁移）；
split 拖拽调宽（12% 下限）、tab 跨 pane 拖拽（五分区边缘 drop + 插入指示线）、
Ctrl+\\ / Ctrl+Shift+\\ 分屏命令；同文件多实例非脏实时同步。
**性能**（`?bench=N` 合成 vault，10k 笔记优化前→后）：switcher 打开 471→15ms、
全文搜索最坏 2585→347ms、explorer 展开全部 424→10ms（>200 行虚拟化）、索引 ~110ms。
评审 5 维度 24 finding，对抗验证确认 21（去重 16）全部修复或显式延期。详见 docs/PERFORMANCE.md。

### R4 — v0.4（2026-06-10）Obsidian 插件兼容层 + 共享文档模型

**Obsidian compat T0+T1+T1.5**（`src/compat/obsidian/`，详见 docs/OBSIDIAN-COMPAT.md）：
`.obsidian/plugins` 发现/加载/启停对齐 community-plugins.json；`require("obsidian")` 注入
（+@codemirror/* host 实例 + path shim）；Plugin/Vault(TFile 单例 registry)/MetadataCache/
Workspace/Notice/Modal/Setting DSL/SuggestModal/Menu/最小 Editor 子集；DOM 原型增强；
越级 API warn-stub + 缺口报告进设置页。开发全程对照官方 obsidian.d.ts 校准（160 条签名）。
**共享文档模型**（core/documents.ts）：单文件单脏标志/单防抖保存，多视图逐键同步 +
单 undo 历史（host 移交时移植），根治 R3 双脏 last-writer-wins 与重命名丢 undo 两项债。
评审 5 维度 24 finding 对抗验证全确认（0 误杀）全修复。
**真实插件套件 5/5 加载启用**（Recent Files / Better Word Count / NL Dates /
Paste URL into selection / Calendar），缺口显式记录（moment、registerView 挂载）。

### R5 — v0.5（2026-06-10）compat T2：moment + registerView 真实挂载，套件 5/5 ✓

**moment**（一次性决策落地）：moment-with-locales 2.30.1 单实例，`import { moment }` 与
`window.moment` 同源（套件实测两个 P0 插件只用后者）；`window.app` 同步注入（评审 critical）。
**registerView 真实挂载**：core `SidebarPanelContribution` 贡献点（左 ribbon 按钮/右 tab +
元素宿主）+ compat `SidebarViewLeaf`（setViewState 全生命周期、revealLeaf/detachLeavesOfType/
ensureSideLeaf、legacy layout-ready/splitActiveLeaf/getUnpinnedLeaf）；官方全局原型扩展全集
（Array.contains 等）；MarkdownView extends FileView；onUserEnable 接线。
**editor-change 逐事务化**：core `document:changed` 事件（R3/R4 偏差债清除）。
评审 5 维 20 finding，对抗验证确认 18（2 证伪），全修复。
**套件矩阵 5/5 核心功能 ✓**（R4 为 2/5）：calendar 月历自动挂载、Recent Files 实时列表、
nldates "tomorrow"→`[[date]]` 桌面实测通过；reload 幂等零 error。
截图 docs/screenshots/r5-desktop-killer-demo.png。

### R6 — v0.6（2026-06-10）compat 余项三件 + 快捷键自定义，nldates 自动建议解锁

**EditorSuggest 真实触发**（套件解锁标杆）：core `document:changed` 驱动 EditorSuggestManager
（注册序、首个非 null onTrigger 胜出、async stale-token、popup 键盘捕获先查 suggest.scope
——nldates Shift+Enter 路径、非公开 `this.suggestions.useSelectedItem`、焦点守卫）；Scope 做实。
**MarkdownRenderer.render / requestUrl / request**：markdown-it 管线提取到 core/markdown.ts
共享；requestUrl 官方全形状（RequestUrlResponsePromise 便捷属性、throw 语义、data: URL 层内
解析），桌面走 Rust `http_request`（ureq，`#[tauri::command(async)]`，CORS-free），浏览器 fetch。
**快捷键自定义**：CommandRegistry 覆盖 API（getEffectiveHotkey/setHotkeyOverride/
findHotkeyConflicts/normalizeHotkey + hotkeyFromEvent 单一文法权威、热路径预解析缓存）、
设置页 Hotkeys 节（捕获模式、冲突双行徽标、重置、localStorage 持久化）。
评审 5 维 13 finding 确认（9 根因）2 证伪，全修复（含 1 个 Tauri 2 线程模型事实性错误——
同步命令在主线程跑，30s 阻塞请求会停摆自动保存）。
**桌面实测**（release `geode.exe compat-vault`）：逐键 `@tomorrow` → 弹层 → Enter →
`[[2026-06-11]]`；套件 5/5 不回退、reload 幂等。截图
docs/screenshots/r6-desktop-nldates-autosuggest.png。
教训：nldates 的 onTrigger 锚点是逐键增量建立的（首键 "@" 落锚、后续复用 context.start）
——探针一次性插入整串文本测不到触发，必须逐字符事务模拟真实输入。

### R7 — v0.7（2026-06-10）图谱打磨 + 导出 HTML/PDF

**图谱**（R3 两项债清偿）：fit-to-view（bbox+padding，首次 settle 自动、换锚自动、Fit 按钮）；
最大化窗口居中偏移根因修复（初始 transform 锚定图原点而非内容包围盒 + 未布局 rect + dpr 盲区
三因叠加；桌面实测最大化/还原循环偏移 ≤1%）；**局部图谱**（锚 = `workspace.lastActiveFile`
新 Store，BFS 深度 1|2，仿真只跑子图，锚节点圆环高亮，prefs localStorage 持久化）；
**10k 性能**：度数抽样 RENDER_CAP=3000（Show all 显式切换）+ rAF 合帧按需渲染（settle 后
零重绘）+ 逐边描边/视口剔除/仿真热期标签抑制。bench=10000：settle 43s→**5.8s**、
settle 期 24ms/帧（~42fps）、单帧 3.9ms、idle 0 draw；bench=1000 不回退（60fps 无抽样）。
**导出**：`app:export-html`（自包含单文件，桌面存盘对话框+Rust `export_write` 原子写 /
浏览器下载）+ `app:export-pdf`（print CSS + WebView2 打印对话框 = PDF 路径）；
导出读活文档缓冲（不丢防抖中的编辑）；结果 toast 反馈。
评审 5 维 18 finding（8 唯一根因）全确认 0 证伪，全修复；**浏览器实测另抓 2 个评审漏网的
运行时缺陷**（StrictMode rAF id 未归零→画布永久空白；巨型 Path2D 边批量描边光栅比逐边慢
20 倍——JS 计时不可见，教训：canvas 优化必须帧间隔实测，见 PERFORMANCE.md）。
桌面实测：套件 5/5 不回退（nldates 逐键 `@tomorrow`→`[[2026-06-11]]`、reload 幂等、
calendar 重挂载）、export_write 真实落盘+相对路径拒绝。
截图 docs/screenshots/r7-desktop-graph-maximized.png、r7-bench10k-sampled.png。

### R8 — v0.8（2026-06-11）i18n（中/英）+ watcher 回声抑制

**i18n**（零 npm 依赖，手写 ~80 行运行时）：`core/i18n.ts`（locale Store + localStorage
`geode.locale` 持久化 + `navigator.language` zh 自动检测 + en 回退 + `{param}` 插值 +
`useI18n()` hook——core 第二个 hooks 例外）；字典按 agent 所有权拆 3 个片段文件
（dict.app/panels/views，~188 键，`zh: Record<keyof typeof en, string>` 缺译即类型错误）；
**Command.name thunk 化**（`string | (() => string)` + `getCommandName`，compat 字符串名
不受影响，显示处逐 locale 解析——切语言命令面板/快捷键页即时翻转且无需重注册）；
设置页 Appearance 语言下拉（`settings-language`）；graph tab 持久化标题渲染层覆盖；
中文术语表冻结在契约（向 Obsidian 中文社区对齐）。
**watcher 回声抑制**（R3 P2 债清偿）：modify/create 在 await 写盘前记录 FNV-1a 指纹
（10s TTL），handleExternalChanges 先分流——指纹命中即抑制（保缓存、零事件），全部命中
在 refreshTree 前直接返回（自动保存回声零开销）；不匹配/读错即放行（宁可放过不可错杀）；
探针 `__geodeWatchEcho` 计数器 + Memory 适配器 `__geodeFireWatch` E2E 注入口。
评审 5 维 10 finding：5 确认（对抗验证全部降级 minor）、5 证伪；修 1 处（写失败时
清理指纹，防失败写入的 hash 残留 TTL 窗口误抑制同字节外部修改），4 处记显式已知限制。
浏览器实测：zh-CN 环境自动中文、设置页切换即时全 UI 翻转、重载持久化、命令面板中文名、
回声计数 suppressed 1→2（双批回声）/ external 仅无指纹路径。
桌面 release 实测（v0.8.0 `geode.exe compat-vault`）：套件 5/5 不回退、nldates 逐键
`@tomorrow`→`[[2026-06-12]]`、reload 幂等；真实 notify 链路自写回声 suppressed、
外部 PowerShell 改文件正常重载且 external 计数；中文 UI 截图。
截图 docs/screenshots/r8-browser-zh-settings.png、r8-desktop-zh-suite.png。

### R9 — v0.9（2026-06-11）自动更新链路 + compat suggest 余项

**自动更新**（tauri-plugin-updater + plugin-process，HANDOFF 预授权备选路径——minisign
更新签名与 Authenticode 证书无关，无证书也完整落地；Authenticode 留 `signCommand` 配置位，
购证后填入即可，全流程见 **docs/DISTRIBUTION.md**）：密钥对 `.tauri-keys/`（gitignore，
带密码——**Windows 无法表达空串环境变量，空密码密钥会让构建死等交互提示**，已踩坑入档）；
`core/update.ts` 双端形状（check 持有 Update 于模块级、进度事件映射、浏览器全程降级）；
设置页 About 更新区（检查/发现 v{x}/进度/错误行内全文）+ `app:check-updates` 命令；
conf：`createUpdaterArtifacts` + pubkey + endpoint 占位 + NSIS `passive`。
**compat suggest 余项**（R6 两缺口闭合）：`setInstructions` 真实渲染（官方
`.prompt-instructions` 类名，EditorSuggest popup + SuggestModal；Instruction 两字段
required 照官方）；**纯光标移动重评估 onTrigger**（core 新事件
`document:selection-changed`——syncExtension 在 selectionSet 且非 sync 注解时 emit，
compat 跑同一触发循环）。
评审 5 维 8 finding：3 确认（全 minor：Instruction 类型偏差已修、契约文案已修、
版本号中间态发布时收敛）5 证伪；安全/数据安全/分层三维零 finding。
**桌面更新链路全 E2E**（本地 latest.json + 静态服务器）：0.8.5 运行中应用 → 检查发现
0.9.0 → 下载 → minisign 验签 → NSIS 静默安装到 %LOCALAPPDATA%\Geode → 自动重启为
v0.9.0 ✓；负向两例：篡改签名 "Invalid encoding"、合法编码错误签名
"signature verification failed"，均行内报错且应用存活 ✓。
套件 5/5 不回退；**nldates 指令条 "Shift / Keep text as alias" 真实渲染**（R6 缺口可视
闭合）；光标移开弹层关闭 ✓（移回重开取决于插件 onTrigger 语义——nldates 锚点逐键建立，
官方同行为；fixture 已证明移回重开机制本身工作）；逐键 `@tomorrow`→`[[2026-06-12]]` ✓。
截图 docs/screenshots/r9-desktop-nldates-instructions.png。

### R10 — v0.10（2026-06-11）stale tab 清理 + 插件名本地化 + popup 重定位（compat 缺口表清零）

P1（发布渠道+证书）等用户外部决策未到位，按 HANDOFF 备选取 P2 组合三项：
**stale tab 自动关闭**（R4 残留债清偿）：`workspace.closeMissingFileTabs(exists)`——单次
批量 update、逐 leaf 按 closeTab 邻近规则修 activeTabId、normalize 一次、顺带清理指向
失踪文件的 lastActiveFile（镜像 handleDeleted）；openVaultFlow 与 bootstrap 两个调用点
（后者覆盖"上次会话期间文件被外部删除"）。桌面实测：compat-vault 三 tab → 切 demo-vault
→ 不存在的两个关闭、存在的 Ideas.md 与 graph tab 保留、零残留。
**GeodePlugin.name/description 本地化**（与 R8 Command.name 同模式 thunk 化 +
getPluginName/getPluginDescription；compat manifest 字符串名不受影响）。桌面实测：
设置页插件区"字数统计/日记/随机笔记"。
**compat popup resize/scroll 重定位**（缺口表最后一条清零）：window resize + document
capture 相 scroll 监听，rAF 合帧调既有 position()，拆除时 rAF id 归零（R7 教训沿用）。
桌面实测：弹层开启上滚 80px → popup 精确跟随 80px。
评审 3 维 6 finding **全部被对抗验证证伪（0 确认）**——其一验证者对 activeTabId 规则跑了
1793 用例穷举模拟；一条证伪揭出 R9 的 tauri.conf.json 未入 feat 提交（随 R10 落账）。
套件 5/5 + nldates 指令条/插入 + reload 幂等 + 回声抑制全不回退。
注：本轮浏览器端无独立 E2E（自动化工具会话内掉线），三项均为 webview 同一代码路径，
桌面 release 全覆盖实测。

### R11 — v0.11（2026-06-11）模式切换零重建 + 图片嵌入 `![[...]]`

P2 组合轮（P1 渠道/证书继续等用户决策；安装包瘦身延后——12.4MB 收益边际 vs R5 双副本坑）。
**live↔source 零重建**（R4 前视图重建债清偿）：mode 切片进 CM6 Compartment，切换 =
`reconfigure` 而非销毁重建——选区/滚动/undo 天然保留（桌面实测同一 EditorView DOM +
undo 跨切换）；preview 往返经 session map 尽力恢复（选区 clamp + 双向 scrollTop）。
**图片嵌入**：`![[img.png]]` 在 live preview（EmbedWidget，选区感知 reveal 沿用）与
阅读视图（`<img class="geode-embed">` 占位 + 异步 hydrate）双视图渲染；链路 =
`VaultAdapter.readBinary`（Rust `vault_read_binary` async + base64）→
`metadata.resolveAttachment`（非 md 附件索引，惰性建/树变失效）→ blob URL 模块缓存
（文件事件失效 + revoke）；`renderMarkdownToHtml` 第三参 opts.resolveEmbed——
**无 opts 调用方（compat/export）字节级保持现状**（agent 以 12 用例 diff 验证）；
demo 夹具双端一致（磁盘 png + Memory DEMO_BINARY）。
评审 4 维 11 finding：2 确认（同根因降级 minor：外部改图走 file:created 不失效 blob
缓存——已修订阅）9 证伪；1 条 verify 网络故障未裁决，chief 直接推演记为已知限制
（外部改图后已渲染的 EmbedWidget 显示旧图至 widget 重建，blob 撤销不清已解码位图）。
桌面实测：live img blob 加载 + 阅读视图 hydrate ✓、同 DOM 零重建 + undo 跨切换 ✓、
套件 5/5 + nldates 指令条 + 回声抑制不回退 ✓。截图 r11-desktop-embed-live.png。

### R12 — v0.12（2026-06-11）笔记转写嵌入 `![[note]]` + 导出内联

P2 组合轮，同吃 R11 嵌入管线。官方校准（obsidian.md/help/embeds）：嵌套/循环深度无官方
文档——自定护栏显式入档：**深度上限 5、循环 → 警示牌**；出轮项记缺口（`#^block` 块引用、
PDF/音频/canvas 嵌入均降级链接）。
**core/embeds.ts**（新）：编辑器与导出共用的水合引擎（features 互不 import 的合规解）——
img 占位填充 + 笔记转写递归展开（heading 切片 = 命中行至下一同级标题；二次匹配走
Obsidian stripHeading 语义；循环/超深/缺标题/读失败全降级警示牌或链接牌，全程不抛）。
live preview `NoteEmbedWidget`（与阅读视图同构水合、点击委托导航、display-only 红线）；
导出/打印 detached container 水合，**图片内联 data: URI**（导出文件零 blob:、自包含）。
无 noteEmbeds 调用方（compat/export 旧形态）**字节级不变**（20 用例 diff 验证）。
评审 4 维 ~16 finding：2 确认（均降 minor 已修：heading 匹配补 stripHeading 二次匹配、
note 分支 display 与图片分支对齐）其余证伪。
**桌面实测连带抓出一个预先存在的潜伏缺陷**：PS5.1 时代写入的夹具带 UTF-8 BOM，
markdown-it/metadata 首行标题全失效——修在 Vault.read 唯一咽喉点（剥前导 BOM），
三个夹具文件磁盘归一化。教训：**转写这种"把渲染管线指向任意文件"的特性是潜伏缺陷
放大器，实测必须用真实历史文件**。
桌面实测：全文嵌入/heading 精确切片/缺标题中文警示牌/循环护栏（两层渲染后触发）/
live widget/导出 data URI 全过；套件 5/5 不回退。截图 r12-desktop-transclusion.png。

### R13 — v0.13（2026-06-11）`^block` 块引用（链接+嵌入）+ compat noteEmbeds 接通

P2 组合轮。官方校准（obsidian.d.ts:1283/1462）：`BlockCache { id, position }`、
`CachedMetadata.blocks?: Record<string, BlockCache>`。
**块索引**：parseNote 在 masked 串（fence/frontmatter 排除、偏移稳定）上扫行尾
`/\s\^(id)\s*$/`；块范围 = 段落近似（连续非空行段，显式偏差）；同 id 大小写不敏感
后者胜。**嵌入切片**：`![[note#^id]]` 切 [from,to) 并剥尾标记，缺块走
`editor.embedMissingBlock` 警示牌。**阅读视图剥行尾标记**（有意的全调用方基管线变更，
fence 外；48 用例 diff：仅标记行变化）。**live preview 标记隐藏**（行级 reveal，
fence 排除——评审抓到 agent 实现违反契约"fence 内不处理"，3 finding 同根因 confirmed
major，chief 修复：FencedCode 行集合排除）。**compat**：`getFileCache().blocks` 官方
Record 形状；`MarkdownRenderer.render` 接通 resolveEmbed+noteEmbeds+hydrate（blob 缓存
一次性 fragment 口径），R12 缺口闭合。
评审 3 维 12 finding：4 确认（3 同根因 major 已修 + 1 minor 记债：live preview 的
wikilink 扫描自 R1 起就不跳 fence——既有行为，见技术债）8 证伪。
桌面实测：块切片干净（双行段落、零标记、零邻段）/缺块中文警示牌/阅读视图剥标记 +
fence 保留/live 隐藏 + fence 保留（修复验证）/套件 5/5 不回退。
链接口径：`[[note#^id]]` 解析打开正常；**点击不滚动定位到块/标题**（scroll-to-subpath
显式缺口，远期项）。

### R14 — v0.14（2026-06-11）scroll-to-subpath 定位 + fence 排除统一

P2 组合轮，引用体验闭环收尾。**点击 `[[note#Heading]]`/`[[note#^id]]` → 打开并滚动
定位 + 居中 + 1.2s 闪烁高亮**：`metadata.resolveSubpath`（heading/block 解析统一，
embeds 切片重构调用，14 用例复跑逐字一致）；`workspace.revealTarget` 一次性消费
机制（preview 态挂起、切 live 即消费——显式口径）；internal-link 锚点 `data-subpath`
透传（无 subpath 链接零字节变化，18 用例 diff）；四处点击路径全贯通（阅读视图委托/
live 折叠链接/展开态 Ctrl+Click——评审唯一确认 minor，chief 修复/转写 header）；
闪烁 = revealFlash StateField + `--accent` 透明度 CSS 动画。
**fence 排除统一**（R13 债清偿）：live preview 的 wikilink/嵌入扫描跳过 fencedLines
——fence 内 `[[x]]` 不再装饰，与阅读视图对称（行内 code 不对称保留，Obsidian 同样
不装饰——远期）。
评审 2 维 11 finding：1 确认 minor（Ctrl+Click 展开态漏接，已修）10 证伪。R13 的
"agent 注释不能修订契约"教训生效：editor agent 把 flash effect 形状的契约/指令分歧
如实上报而非自行偏离（按 {from} 收口，as-built 记录）。
桌面实测：锚点 data-subpath ✓、preview 点击挂起→切 live 消费 ✓、heading 光标精确
落位 `# Deep Section` + 滚动 + 闪烁 ✓、block 落位 ✓、闪烁 1.2s 自动淡出 ✓、
套件 5/5 不回退 ✓。

### R15 — v0.15（2026-06-11）整固轮：阅读视图 reveal + 性能基线刷新 + 全量回归

P2 池见底，按 HANDOFF 预授权转整固。**安装包瘦身显式不做**（决策入档 ARCHITECTURE
R15 节：moment 全 locale 是 compat 正确性选择、收益边际、双副本坑风险不对称；重开
条件 = 商业分发有体积硬指标）。
**阅读视图内 reveal**（R14 口径升级）：preview 态直接消费——heading 走 metadata 序号
→ DOM h1-h6[n] 定位（agent 加固：排除嵌入笔记内 heading 的序号干扰，上报后采纳）+
`.preview-reveal-flash`；block 走比例近似滚动（近似口径）。
**性能基线刷新**（headless Edge + CDP，七轮欠账）：bench=10000 零回归——
graphSettle 3958ms（R7 5771 更优）、graphDraw 2.9ms、metadataIndex 185ms（R3 110，
七轮解析增量可接受）、switcher 20ms；R11/R14 新路径（resolveAttachment/resolveSubpath）
≤1ms；bench=1000 控制组正常。详表 PERFORMANCE.md R15 节。
**全量回归**（v0.15.0 release build）：r12（转写+导出 data URI）/r13（块）/r14（定位，
preview 直接消费新口径）探针全绿 + 套件 5/5 + nldates 全链路不回退。
更新链路（r9-up*）自 R9 零改动跳过（记录）。

### R16 — v0.16（2026-06-11）重命名自动更新引用 + `[[#h]]` 同文链接（迁移体验 #1，数据安全重轮）

官方校准（obsidian.md/help + obsidian.d.ts）：设置项 "Automatically update internal
links"、`fileToLinktext` 消歧规则（basename 唯一用 basename，否则全路径）、官方
`Vault.rename` 不更新链接（FileManager.renameFile 才更新——compat 对齐项非缺口）。
**改写引擎**（core/linkRewrite.ts，五步冻结算法）：capture（flushAll + ensureFresh
带缓冲提供者 + 受影响表含文件夹级联/附件/自引用）→ rename → ensureFresh → 逐引用方
verified rewrite（fresh parse 偏移构造性正确、only-fix-broken 按 target 形态严格判定
——path-form 仅精确路径算存活、风格保持 + fileToLinktext 消歧、splice 校验 + 改写前
全量 reparse 断言，**任何不一致 skip+报告绝不盲写**）→ 报告。双路径：打开中文件走
DocumentHandle.applyExternalEdits（CM 单事务，undo 进共享历史、标脏 + 防抖保存）；
未打开走 vault.readFresh + vault.modify（回声指纹）。Rust `vault_write` 原子化（点
前缀 sibling tmp + rename，watcher 噪声过滤天然不见 tmp；崩溃残留启动清扫）。
设置页 "文件与链接" toggle（默认开）+ Explorer skip notice + `__geodeRename` 常驻探针。
**`[[#h]]` 同文链接**（R14 缺口闭合）：四视图守卫放宽（阅读视图锚点 data-target=""、
live 折叠装饰、source 装饰、四处点击链路），openWikilink 空 target → 当前笔记 +
reveal；22 用例 diff 非 `[[#...]]` 字节级一致。compat `fileManager.renameFile` 接通
核心引擎（warn-stub → 真实现）。
评审 4 维 22 finding → **12 确认（1 critical + 4 major）+ 10 证伪**，全修复：
critical = CRLF/LF 偏移基准错位（开着未编辑的 CRLF 引用方会被切错字节——根治 =
vault.read 咽喉点 CRLF→LF 统一 + applyExternalEdits 失配即抛；验证者用真实 CM 包
复现过）；major = 关闭文件读缓存盲写（readFresh）、flush 不 join 在飞行保存
（savePromise）、type-then-close 竞态（句柄活到 flush 完成）；浏览器实测另抓 1 个
评审前缺陷（only-fix-broken 被 resolveLink 的 basename 兜底骗过——path-form 过期
前缀漏改，Obsidian 打开即断）。顺带：metadata.ts R3 时代字面 NUL 字节（ripgrep 把
全文件当二进制跳过）转义根治。
浏览器 E2E：改写前后链接解析等价断言 13 步 + `[[#h]]` 4 步 + toggle 往返 + 开缓冲
Ctrl+Z 回退 + CRLF 触发场景 + 并发改名串行化全绿。桌面 release（v0.16.0
compat-vault 真实文件系统）：磁盘改写（subpath/alias/嵌入保留）✓、文件夹级联 ✓、
开缓冲改写 ✓、引擎写回声全抑制 ✓、零 tmp 残留 ✓、`[[#h]]` live+preview ✓、套件
5/5 + nldates 全链路 + r12/r13/r14 探针全绿不回退。性能：metadataIndexMs 151ms
（优于 R15 基线 185，归一化扫描 ~2ms/10k）。
截图 docs/screenshots/r16-desktop-settings-toggle.png。

### R17 — v0.17（2026-06-11）附件摄入（粘贴/拖拽图片入库）+ 标题/列表折叠（迁移体验 #2）

官方校准（obsidian.md/help/attachments + /folding）：附件位置四选项（子文件夹缺失自动
创建）；折叠 "Fold heading"/"Fold indent" 默认开、悬浮左侧箭头、已折叠常显、
Fold all/Unfold all 命令。
**附件摄入**：编辑器 paste（命名 `Pasted image YYYYMMDDHHMMSS.<ext>`，MIME 映射）/
drop（原名保留，posAtCoords 定点插入）→ `core/attachments.ts` importAttachment
（**模块级串行化**——同秒双粘贴 uniquePath 不再撞名；sanitize 剥前导点/非法字符；
attachmentFolder 设置项 Obsidian attachmentFolderPath 四语义 + validateDir 拒
`..`/点前缀段；大小写不敏感防撞）→ `Vault.createBinary` →
Rust `vault_write_binary`（async + safe_join + **create_new 独占创建直写**——评审
major：原 exists 检查+共享 tmp+rename 是 check-then-act，并发可互踩且 Windows
rename 静默替换；独占性根治，新文件截断风险仅及自身）。插入 `![[linktext]]`
（basename 唯一用 basename 否则全路径，fileToLinktext 精神）；**陈旧偏移守卫**
（评审 major：async 导入期间 doc 变更 → 弃选区替换退化光标纯插入，杜绝删用户字节）。
设置页 "文件与链接" 文本输入（存原文不 trim——评审 major：trim-on-keystroke 锁死
含空格目录名）。桌面 `dragDropEnabled: false`（评审 major：Tauri 默认拦截 OS 文件
拖放，DOM 收不到 drop）。
**折叠**：`features/editor/folding.ts` 冻结语义 foldService（ATX 标题节 = 行末到下一
同级及以上标题前；多行 ListItem；ownsLine 支持缩进 1-3 空格标题；frontmatter 排除
——评审 major：解析器把 YAML 当 markdown，`# 注释` 是真 ATXHeading，折它能吞正文）+
**剥离 lang-markdown 内置 headerIndent foldService**（评审 major：其 Setext/ATX 节
折叠绕过冻结语义；按 facet 结构匹配过滤 support 数组，keymap/补全保留）+ foldGutter
（chevron 默认隐藏、编辑器 hover 显示、已折叠常显）+ 三命令 editor:toggle-fold/
fold-all/unfold-all（fold-all 仅冻结语义自扫描 + ensureSyntaxTree；自定义 keymap
替代 foldKeymap 保持键盘路径一致）+ headingSectionEnd cursorAt 游标真早退（原
iterate O(doc)/查询）。基础扩展列表（不进 modeCompartment）——fold 状态存
EditorState，live↔source 切换天然保留。
评审 4 维 20 finding → **对抗验证 20 确认（去重 ~12 根因：5 major）0 证伪**，全部
修复（细节 ARCHITECTURE R17 As-built）。
浏览器 E2E：粘贴落库+嵌入+live 渲染、同秒双粘贴 ` 1` 后缀、drop 定点、文本粘贴零
干扰、`./imgs` 语义+目录自动创建、`../evil` 零写入响亮报错、fold-all 仅标题/列表、
Setext/fm 伪标题无折叠点、live↔source 折叠保持、嵌入 widget 折叠往返全绿。
桌面 release（v0.17.0 compat-vault 真实文件系统）：磁盘落盘 70 字节往返无损、
同秒双粘贴两文件、零 .geode-tmp 残留、drop handler ✓、折叠全链路（gutter 点击/
fold-all/模式切换保持）✓、套件 5/5 + nldates `[[2026-06-12]]` + r12（转写+导出
data URI，demo-vault）/r13/r14 探针全绿、r16 改写引擎回归全绿（d4 断言修订为
精确语义：引擎写目标绝不 external——rename 事件本就无指纹面走 external，
r17-echo-diag 坐实，R16 原断言绿靠时序运气；写抑制不变量完好）。
截图 docs/screenshots/r17-desktop-fold-ingest.png。

### R18 — v0.18（2026-06-12）Markdown 方言长尾：callouts + ==高亮== + 脚注 + %%注释%% + KaTeX 数学（迁移体验 #3）

迁移体验路线图收官轮。官方校准（obsidian.md/help：callouts + basic/advanced-formatting-syntax）：
callout 13 类型 + 别名表、折叠变体 `+`/`-`、嵌套、未知类型降级 note；`==高亮==`；脚注
（`[^id]` 引用 + `[^id]:` 多行定义 + 行内 `^[text]`，**官方原文行内脚注仅阅读视图**）；
`%%注释%%`（官方"仅编辑视图可见"——阅读视图全剥）；数学 inline `$...$` + 块 `$$...$$`。
**一次性依赖决策**：官方引擎是 MathJax，本轮按 HANDOFF 口径选 **KaTeX**（更轻）——TeX 宏
覆盖面差异显式偏差（不支持宏红降级显示原文，永不抛）；**动态 import**（Vite code-split：
katex 独立异步 chunk 260KB，零数学文档不加载，主 chunk 仅 +约 2KB）；**mermaid 显式不做**
（~1MB、优先级低于数学，入 R19+ 候选）。其余四项零新依赖（手写 markdown-it 规则，不装
任何 markdown-it-* 插件）。导出数学走 **MathML 输出**（自包含单文件零 CSS/字体依赖），
应用内走 html 输出 + 注入 katex CSS。compat 零代码改动（共享管线自动获得全部新语法）。

**core/markdown.ts**：预处理状态机扩展（fence→frontmatter→%%剥除→块标记→wikilink）；
五项手写规则（highlight delimiter / footnote block+inline+tail / callout core rule
blockquote 树改写含嵌套 / math block+inline 含货币护栏 + `$$` 不参与 inline 配对）。
**core/embeds.ts + core/math.ts(新)**：KaTeX 懒加载单例 + math 水合 pass（mathOutput 递归
透传）。**live preview**：highlight/comment（同行隐藏+跨行淡显）/footnote ref 上标/callout
行装饰（data-callout + mask 图标 CSS ::before）/MathWidget。**阅读视图**：callout 折叠点击
委托 + 脚注锚点滚动。**导出/app.css/editor.css**：13 色 callout 色板 + lucide 风格 mask
图标 + 高亮/脚注/数学样式双套（应用变量 + 导出本地变量自包含）。
评审 4 维 **17 finding → 对抗验证 17 确认（0 证伪）**，全部修复（4 major：callout 二次
inline.parse 致行内脚注双收集→改 before("inline") 单次解析；`$$` 块闭合吞行→firstRest
非行尾 `$$` 保字面 + 闭合扫描遇 fence 止损；live 单行 `$$` 无锚定→逐行镜像管线形态；
minor：预处理 fence 状态机三脱节、脚注 id 跨渲染碰撞→render-seq 前缀、KaTeX maxSize DoS、
live callout 嵌套首行误判、live `%%` 行内 code 翻转状态机、live highlight 吞 setext 下划线
（lezer 节点名 `SetextHeading1/2`）、MathWidget 点击死区、live 行内数学转义 `$`）。详见
ARCHITECTURE R18 As-built deltas。
桌面 release（v0.18.0 compat-vault 真实 fs）：双视图实测 17/17、套件 5/5 + nldates +
reload 幂等不回退、r17 折叠+摄入 10/10；字节级 diff 套件 72 用例全绿（33 无新语法字节
一致 + 39 新语法 DOM）。

### R19 — v0.19（2026-06-12）mermaid 图表（R19+ 候选池 #1）

候选池首轮（用户拍板 2026-06-12：「从 mermaid 开始，逐步完成每一项」）。官方校准
（obsidian.md/help advanced-formatting-syntax）：` ```mermaid ` 围栏 + `class A
internal-link;` 图内节点变可点内链（官方明示图内链接不进 graph）。
**唯一新依赖 mermaid ^11（11.15.0）**，KaTeX 先例动态 import（core/mermaid.ts
loadMermaid 单例；主 chunk 零增长，mermaid.core 独立异步 chunk 607KB gzip 145KB
+ 各图类型子 chunk 按需，零图表文档不加载——浏览器实测确认）。
**core/markdown.ts** fence renderer 覆写：info 首词大小写敏感全等 "mermaid" →
`.geode-mermaid[data-mermaid]` 占位（未水合显示源码），其余 fence 走 default
字节级不变。**core/embeds.ts** 水合 pass：initialize（strict + suppressError +
theme）→ 串行 render → SVG 注入 + internal-link 节点 data-target 后处理 +
锚点消毒；`HydrateContext.mermaidTheme`（应用内跟主题/导出恒浅色）。阅读视图
internal-link 点击 → openWikilink；live 维持源码呈现（显式偏差，R20+ polish
候选）；compat 零改动自动受益。
评审 4 维 **13 finding → 对抗验证 11 确认（1 major）/ 2 证伪**，全部修复
（major：strict 模式 `click A "url"` 生成 `<a xlink:href>` 绕过 a[href] 守卫可
导航整 webview→水合层锚点消毒（https 补 `_blank`+noopener / 其余剥除）+ 点击
守卫双层；minor：跨批次 initialize 主题竞态→模块级 promise 链批次原子化、
#id 作用域样式压制 accent→!important、打印杂散临时容器→print guard、陈旧
批次无取消→isConnected 跳过、diff 用例判别缺口、export 错误面板 padding）。
详见 ARCHITECTURE R19 As-built deltas。
桌面 release（v0.19.0 compat-vault 真实 fs）：R19 探针 14/14（双图 SVG/错误
降级保源码/内链点击跳转/锚点消毒/live 源码/打印内联 svg）、套件 5/5 + nldates
`[[2026-06-13]]` + reload 幂等 + 回声 suppressed4/external2 不回退；diff 套件
78 用例全绿。截图 docs/screenshots/r19-desktop-mermaid.png。

### R20 — v0.20（2026-06-12）Obsidian 主题 CSS 兼容层（R19+ 候选池 #2）

**本轮起开发环境迁移至 macOS**（用户云端拷贝项目到本地桌面；Rust 工具链/Playwright/
tmux 重建，gitignored 资产 .calibration/compat-vault 重建——**.tauri-keys 更新签名
私钥未随迁，见 HANDOFF 风险条目**）。官方校准（docs.obsidian.md/Themes + Reference/
CSS variables，2026-06-12 WebFetch）：主题 = `.obsidian/themes/<name>/{manifest.json,
theme.css}` + appearance.json `cssTheme`；snippets = `.obsidian/snippets/*.css` +
`enabledCssSnippets`；作用域 = body 上的 `.theme-dark/.theme-light` 类。
**三层结构**：① 变量桥（`theme-bridge.css` 注入式样式表，镜像真实 Obsidian 形状——
私有 `--geode-ob-*` 模式原语进 .theme-dark/.theme-light、语义变量默认值（字面量 =
Geode 现调色板）进 body{}、Geode 变量 body 作用域 repoint 一跳 var()——**零视觉变化
承诺**：无主题时桥开/关计算样式一致，E2E 断言）；② 类名对齐常驻子集（body theme-dark/
light、workspace*/workspace-leaf、markdown-preview-view/markdown-rendered、
markdown-source-view/mod-cm6 等）；③ 加载链（Rust 新命令 `vault_list_config_dir` +
adapter `listConfigDir` 三实现；appearance.json 读写往返**保留未知键**；总开关
localStorage 默认开 = 逃生口；设置页主题下拉 + snippets 开关列表 + i18n 8 键）。
发现即 Geode 调色板本就镜像 Obsidian dark base 色板且五个 text 变量同名——桥接面
小于预期。compat 接线沿 obsidianLoadReport 先例（AppContext.obsidianCss 句柄下放，
features 零 compat import）。
评审（4 维 workflow + 安全维补跑）**11 finding → 对抗验证全确认（2 major）0 证伪**，
全部修复：major#1 = 桥语义变量锁 .theme-dark 特异性压制主流主题的官方 body{} accent
覆写（Minimal/Things 实测形状；验证者 headless Chrome 复现）→ 私有原语+body 语义
默认三段式重构；major#2 = setObsidianSnippet 并发丢更新 → mutate 内增量 RMW + 单
opChain 串行化全部变更；minor 含 caret 死旋钮接通、插件样式/主题注入序不变量
（订阅 obsidianLoadReport 重建）、appearance.json 坏 JSON 防最小化覆写（fail-visible）、
?raw 声明迁 src/、--background-modifier-error 补全。详见 ARCHITECTURE R20 As-built。
浏览器 E2E（Playwright，新基建 .calibration/r20-e2e.mjs）33/33：恒等/穿透/body{}
accent 回归/双色调选边/并发 toggle 回归/caret/类名/往返/逃生口全绿。桌面（macOS
release 二进制 + **probe 插件自检方案**——WKWebView 无 CDP，`.geode/plugins` 探针
写结果文件）：theme-vault 真实 Minimal 主题 9/9（发现/注入/磁盘往返），compat-vault
套件回归 9/9（**5/5 插件 macOS 真实 fs 加载启用** + calendar 挂载 + R20 层共存）。
已知限制：appearance.json 写非原子（R21+ 候选）；部分桥变量暂无 Geode 消费侧
（默认值面口径）；macOS 桌面截图因 TCC 权限未产出。

### R21 — v0.21（2026-06-12）搜索运算符（R19+ 候选池 #3）

官方校准（obsidian.md/help/plugins/search，2026-06-12 WebFetch）：运算符表 +
引号短语/OR/`-`排除/括号/`/regex/`（JS 风味）+ 默认大小写不敏感。R21 范围 =
`file:` `path:` `content:` `tag:` `line:` `match-case:` `ignore-case:` + 全部布尔
组合语法；**显式延期**（候选池备注）：`block:`/`section:`/`task:`*/属性搜索
`[key:value]`/比较运算。
**core/search.ts（新，纯 TS 零依赖）**：手写 tokenizer + 递归下降 parser →
`SearchExpr` AST + `evaluateSearch` 求值器；冻结语义 8 条入契约（优先级
`-` > 隐式 AND > `OR`、字段重绑、嵌套标签 `/` 边界、空操作数降级字面词、
ranges 只收正向参与命中的 content 锚定区间、零长正则按 code point 步进）。
**SearchPanel**：全文模式接解析器/求值器，行命中由 ranges + 行偏移映射推导、
`<mark>` 按区间渲染；标签浏览模式收窄 `/^#\S*$/` 整查询；parse error 行
（`search-error` testid）+ hint 提运算符；i18n 新 5 键 en/zh。compat 零改动。
评审 4 维 **13 finding → 对抗验证 10 确认（1 critical + 1 major + 8 minor，去重
5 根因）/ 3 证伪**，全修复或入档：critical = `u` flag 零长正则 + emoji surrogate
死循环挂死主线程（V8 lastIndex 回退，验证者看门狗实测）→ code point 步进；
major = U+0130 İ `toLowerCase` 变长致区间漂移 → `LoweredText` 偏移双映射（同长
路径零开销）；minor = `path:#foo` 标签糖劫持（条款修订字面绑定）、行尾 `\n` 区间
归错行被吞、`line:` 内 default 词跳 basename 例外回填契约。已知限制入档：
灾难性回溯正则无护栏（与 Obsidian 同级暴露面，worker 化远期）。
验证：解析器矩阵 51 用例（`.calibration/r21-parser-tests.mjs`）+ 浏览器 E2E
29 断言（`r21-e2e.mjs`）全绿；10k bench searchScanMs 21-69ms（运算符组合查询，
不劣于纯词扫描口径）；桌面 macOS release 二进制 + r21 搜索 probe 插件
（compat-vault 自建夹具驱动真实面板 DOM）+ r20 套件 probe 回归。

### R22 — v0.22（2026-06-12）Properties 可视化编辑（R19+ 候选池 #4）

官方校准（obsidian.md/help/properties + obsidian.d.ts:2954，2026-06-12
WebFetch）：7 类型（text/list/number/checkbox/date/datetime/tags）、类型按
属性名**全库绑定**（`.obsidian/types.json` 共写）、默认属性、显示三选项
Visible/Hidden/Source、`Ctrl+;` 命令。
**数据安全总原则（本轮第一底线）**：面板绝不重写未编辑字节——所有编辑 =
单条目行区间 splice；超出解析子集的构造（嵌套 map、`|`/`>` 块标量、嵌套
flow 序列、夹空行/注释的列表、重复键）= **不透明条目**逐字节保留、面板
只读、永不被改写。
**core/properties.ts（新，纯 TS 零依赖）**：typed 解析（boolean/number/
null/string/string[] + 每条目行区间）+ 三个字节保留 edit builder（不可安全
执行一律 null + 逐笔序列化自验证）+ 类型注册表（types.json RMW 保留未知键、
opChain 串行化、adapter 身份防 vault 切换竞态）。**PropertiesPanel**：7 类
值编辑器（草稿 + blur/Enter 提交 + Escape 还原 + 卸载冲刷）、chips、双
datalist 自动补全、类型菜单（含键盘）、add/rename/delete；live 模式经 CM
块 widget + React portal（稳定容器跨 doc 变更存活），preview 模式同面板
直渲染；显示三模式设置 + `editor:add-property`（Ctrl+;，一次性消费 Store
防挂载竞态）。**compat**：`fileManager.processFrontMatter` 真实现（同引擎
逐 key diff，套件先例双路径）。
评审 5 维 workflow（32 agent）**25 finding → 对抗验证 25 确认 / 2 证伪，
去重 13 根因（3 critical + 5 major + 5 minor）全修复**：critical = 面板
margin 折叠致 CM heightmap 少测、带 fm 笔记全部鼠标点击偏一行（padding
根治）；`---`/`- ` 前缀键名序列化即围栏截断/匿名 opaque（键名谓词 + 往返
自验证）；\r/U+2028/U+2029 杀 re-parse（全终结符拒写）。major 含尾冒号
YAML 合法性（自家子集往返全绿掩蔽——**教训：序列化正确性要用外部解析器
视角评审**，js-yaml 实测）、20k 边缘叠块、widget 边界 Backspace 吞行
（atomicRanges + keymap）、陈旧 add 请求跨文件写入。
验证：单测矩阵 150 用例 + 浏览器 E2E 84 断言 + 评审复现探针修复后反向
全数确认；桌面 macOS r22-props-probe 22/22 + r20 9/9 + r21 14/14 不回退；
10k metadataIndexMs 125.8ms（优于 R16 基线）。
显式延期：Properties 侧栏视图（全库浏览/全局改名）、值建议、text 内链
渲染、JSON frontmatter、嵌套属性编辑、`[key:value]` 属性搜索。

### R23 — v0.23（2026-06-13）模板系统（R19+ 候选池 #5）

> **本轮起开发环境再次迁移**（新机器，仓库路径
> `/Users/cutealexander/Code/active/geode/geode`）：node_modules/.calibration/
> compat-vault/tmux 全部重建（compat 5 插件按原版本 GitHub 重下、Playwright
> 重装、probe 脚本重写——原 gitignored 脚本未随迁）；`.tauri-keys` 更新签名
> 私钥**仍未找回**（见 HANDOFF 风险条目）。

官方校准（obsidian.md/help/plugins/templates，2026-06-13 WebFetch）：设置三项
（模板文件夹 / 日期格式默认 `YYYY-MM-DD` / 时间格式默认 `HH:mm`）；Insert
template（选择器、光标处插入）+ Insert current date/time 三命令；变量
`{{title}}`/`{{date}}`/`{{time}}` + `{{date:FMT}}` moment 令牌。
**core/templates.ts（新，纯 TS）**：设置三 Store（localStorage，存原文消费侧
trim——R17 先例）+ `listTemplates`（消费态段校验返 null 不抛/递归前缀过滤/
localeCompare）+ `expandTemplate`（冻结正则 `/\{\{(title|date|time)(?::([^}]*))?\}\}/gi`
单趟替换——替换值不再扫描，title 不吃格式串，moment 与 compat 同 specifier 单
实例主 chunk 零增长）。**TemplateSelector**（QuickSwitcher 同构 modal，
ModalKind+"templates"，insert/create 双模式一次性 templatePickerMode）+ 四命令
（insert-template 带 preview→live 翻转 / **new-note-from-template 为 Geode 显式
扩展**（官方无此命令，uniquePath + 大小写撞名层、title=唯一化后 basename）/
insert-date / insert-time）+ 设置页模板节三输入 + i18n en/zh。compat 零改动。
评审 5 维 Workflow **13 finding → 12 确认 / 1 证伪（去重 10 根因：1 critical +
1 major）全修复**：critical = preview→live 翻转 + 开 modal 同 commit 时 EditorPane
重建 `view.focus()` 抢走选择器焦点——键入直接污染正文并自动保存（修复 = focus
带 modal 守卫）；major = `getActiveView` 闩锁字段陈旧，insert-date/time 可写进
非活动文件（修复 = 视图须属于活动文件双侧门控）；minor 含 activate 重入守卫/
await 后视图重校验/create 大小写层/`{{date:}}` 契约勘误/版本号三处（顺带根治
**前存缺陷**：About 页 APP_VERSION 自 R16 硬编码 "0.16.0"）。详见 ARCHITECTURE
R23 As-built。
验证：浏览器 E2E 22/22（`.calibration/r23-e2e.mjs`——选择器/过滤/插入/单步
undo/create 唯一后缀/自定义格式/对抗性输入/设置消费/preview 翻转）；桌面
macOS release 真实 fs probe：**r23-templates-probe 10/10**（插入/创建/变量/
calendar 共存）+ **r23-suite-probe 9/9**（**5/5 插件新机重建后加载启用** +
插件命令 + R23 共存）。新环境教训（.calibration npm 污染/后台 app probe 晚期
await 不可靠）入 ARCHITECTURE R23 + DEVELOPMENT macOS 节。
显式延期：`{{date+Nd}}` 偏移语法（官方 Templates 页无）；ribbon 按钮；新建
笔记默认位置设置；模板内嵌套变量展开（单趟口径）。

### R24 — v0.24（2026-06-13）未链接提及（反链面板扩展，R19+ 候选池 #6）

候选池末项（迁移叙事第二梯队收官——清空后只剩发布渠道与性能远期）。官方校准
（obsidian.md/help/plugins/backlinks，2026-06-13 WebFetch）："Unlinked mentions are
backlinks to any unlinked occurrence of the name of the active note"——活动笔记名字
（basename + aliases）在别的笔记正文里没被 `[[..]]` 链接的明文出现；每条「Link」
转链接、每文件「Link all」、面板控件作用其上。
**core/unlinkedMentions.ts（新，纯 TS 零依赖）**：matcher（deriveMentionTerms +
findUnlinkedMentions——**CJK 感知词界**：isLatinWord 双侧都拉丁才算切词，故 "Note"
不命中 "Notebook" 而 CJK 名按子串命中 Obsidian 同向；buildMasked 屏蔽 frontmatter/
代码/行内代码/既有 wikilink span/`[[#subpath]]`/正文 `#tag`；重叠取最长贪婪去重）+
link 引擎（linkAllMentionsInFile/linkOneMention 完整 R16 写纪律：模块 runTail 串行、
flushAll+ensureFresh、open buffer 或 readFresh 真值源、**从 fresh 重派生 offset**、
**post-rewrite 复解析校验**、applyExternalEdits/modify、逐文件 skip+报告，绝不盲写）。
**BacklinksPanel** 新「未链接提及」节（异步全库扫描 = R21 SearchPanel 先例、可取消+
陈旧守卫、每条 Link + 每文件 Link all、高亮片段、默认折叠）。compat 零改动。
评审 5 维 Workflow **13 finding → 7 确认 / 6 证伪，去重 5 根因（2 major + 3 minor）
全修复** + 浏览器 E2E 另抓 1 UI 缺陷（共 6 修复）：major = tag@0 masking 漏洞
（`#Name` 被 Link 改写成 `#[[Name]]` 损坏标签）+ 写校验缺失（`C#` 类含 wikilink 元
字符的名字写出错链，补 R16 post-rewrite 断言转 skip）；minor = `[[#subpath]]` 漏屏蔽 /
重扫闪烁 / zh 漏句号；E2E 抓出默认折叠节首点展不开（`?? true` 与 toggle `!c[key]`
打架，seed `{unlinked:true}` 修复）。详见 ARCHITECTURE R24 As-built。
验证：浏览器 E2E `.calibration/r24-e2e.mjs` **12/12**（检测/排除/Link-all 改写+surface
保留/CJK 子串/tag@0 排除/C# 跳过零改动）+ R23 templates 22/22 不回退 + 生产 build 绿；
桌面 macOS release 真实 fs probe **r24-probe 12/12**（经 `window.__geodeUnlinked` 钩子
驱动真实磁盘 Link-all 改写 + surface 保留 + C# 跳过文件字节不变）+ **r23-suite-probe
9/9 不回退**（5/5 插件加载启用）。
显式延期：Excluded files 模式（Geode 无该设置）；点击提及滚动到 offset（明文锚点，
subpath reveal 不适用）；面板级 Collapse/Show-more-context/排序/搜索过滤工具栏；
matcher 热循环首字符门控 + 保存 burst 去抖（性能优化候选，非缺陷）。

### R25 — v0.25（2026-06-13）悬停预览（Page Preview / Ctrl+hover，R25+ 候选池 #①）

R25+ 候选池（Obsidian 原生功能补课）首项。官方校准（obsidian.md/help/plugins/
page-preview，2026-06-13 WebFetch）：Page preview 核心插件**默认开**；File explorer/
Search/Backlinks 等处 hover 内链即预览，**编辑视图（live/source）需按住 Ctrl（macOS
Cmd）**；设置项可「要求所有预览都按 Ctrl/Cmd」。预览 = 目标笔记（subpath 滚到对应
heading；纯只读，绝不写文件/不改 workspace 状态）。
**core/hover.ts（新，纯 TS 零依赖）**：localStorage 背书的设置 Store
（`pagePreviewEnabled` 默认开 / `pagePreviewRequireModifier` 默认关）+ `HoverTarget`
+ 共享 `hoverStore` 单例（控制器写、卡片订阅——总工程师裁决：单例最省接线）+ 延迟
常量。**features/hover（新）**：`HoverController`（document 级捕获委托，三触发源
首命中胜出——`a.internal-link`[data-target]（阅读/侧栏/嵌入/mermaid）、
`.cm-live-wikilink`[data-link-target]（live 编辑器）、`[data-hover-path]`（explorer/
backlinks）；修饰键规则；`resolveLink` unresolved 不弹卡）+ `HoverPreview` 卡片
（复用 `renderMarkdownToHtml` + 核心 `hydrateEmbeds`、陈旧守卫、subpath 走
`resolveSubpath` 序号定位（镜像 R15 reading reveal）、rAF 定位下方优先溢出翻转、卡内
`a.internal-link` 点击直接 `openFile`+`requestReveal` 导航（不 import editor）、私有
blob 缓存）+ hover.css（CSS 变量）。触发源 owner 加 data 属性（Explorer 文件行 +
Backlinks 三处 + **EditorPane 加 `data-leaf-path`**——源笔记按锚点所在 pane 解析）。
设置两 toggle + i18n en/zh + compat `registerHoverLinkSource` 由 warn-stub 升**真实
无操作登记**（`hoverPopover`/`HoverParent` 保持缺口）。main.tsx `__geodeHover` 探针钩子。
评审 5 维 Workflow **9 finding → 6 确认 / 3 证伪，去重 4 根因（1 major + 3 minor）
全修复** + **浏览器 E2E 另抓 2 个评审漏网缺陷（共 6 修复）**：major = subpath 滚动用
朴素文本匹配而非 `resolveSubpath` 序号（重复标题/嵌入副本/子串误命中——改为镜像
EditorPane R15 序号 + 排除 `.geode-embed-note`）；minor = box-shadow 硬编码
（→ `var(--shadow-modal)` 主题感知）/ 链接源用全局活动文件而非锚点所在 pane（非聚焦
分屏 + 重名 / graph 活动时自链误解析——改 = EditorPane `data-leaf-path` + 控制器
`closest`）/ keydown 重触发对非本平台修饰键放行（gate 到本平台键）；**E2E 抓**：
① live-preview 内链实为 `span.cm-live-wikilink[data-link-target]` 而非
`a.internal-link` → 控制器漏配 → **编辑视图悬停整体失效**（改 = extractTrigger 加
`.cm-live-wikilink` 源）；② subpath 滚动竞态——`placeCard` 的 rAF 设 max-height 晚于
渲染链完成 → 卡片未受限不可滚 → scrollTop 夹到 0（改 = 滚动延后到 rAF，落在定位帧后）。
详见 ARCHITECTURE R25 As-built。
验证：浏览器 E2E `.calibration/r25-e2e.mjs` **17/17**（explorer/阅读/编辑修饰键/
unresolved/subpath 滚动/卡内点击导航/设置 toggle 失效复活）+ R24 12/12 + R23 22/22
不回退 + 生产 build 绿；桌面 macOS release 真实 fs probe **r25-probe 7/7**（经
`window.__geodeHover` 钩子驱动真实磁盘 resolve→read→render，含 unresolved→null）。
显式延期：块引用 `#^id` 子滚动（阅读视图同样无 DOM 标记，卡片停顶部 = R15 同口径，
加块标记需动 markdown.ts 字节管线，缓做）；插件自渲染 `hoverPopover`/`HoverParent`
（Geode 全局 hover 已覆盖其 `a.internal-link`，插件被动受益——记缺口）；嵌套预览
（卡内再 hover）不做（单层，卡内链接点击 = 导航）；图谱节点 hover 延期；backlinks
片段按钮 hover（官方「可加」，未加）。

### R26 — v0.26（2026-06-13）PDF/音视频嵌入（R25+ 候选池 #②）

补齐 R12 缺口「PDF/音频/canvas 嵌入均降级链接」中的 PDF/音频/视频三类。官方校准
（obsidian.md/help/How to/Embed files）：支持嵌入 audio/video/PDF，PDF 带 `#page=N`。
**零新依赖**（CLAUDE.md 硬边界 #5 自主拍板取零依赖路线）：音视频用原生 `<audio>`/
`<video>`，PDF 用原生 `<iframe>`（桌面 WKWebView 与浏览器 Chromium 均原生渲染 PDF）
——**不引入 PDF.js**。**core/markdown.ts**：新增 `AUDIO_EXTS`/`VIDEO_EXTS`/
`fileEmbedKind`/`mimeForPath`（与 `IMAGE_EXTS` 同源单一真值），emission 在 image 分支后
增 file-embed 分支，发射 `<span class="geode-embed-file" data-embed-path/ext/subpath/
display>` 占位（仅 `![[x.{media}]]` 输出变化）。**core/embeds.ts** `hydrateFile`：按 kind
派生 `<audio controls>`/`<video controls>`/`<iframe class=geode-embed-pdf>`，blob 走
`ctx.imageSrc`（feature 用核心 `mimeForPath` 给正确 MIME），PDF `#page=N` 拼接，失败降级
`.geode-embed-failed`。三态接线：阅读视图（核心 hydrate）+ live（`FileEmbedWidget` CM
widget）+ 导出（data-URI）；editor/export 旧 MIME 表删除改 import 核心。
**对抗评审 5 维 0 缺陷**（emission 仅影响媒体附件、escapeHtml 无注入、webm→video、
失败降级、live `eq()` 含 path+ext+subpath）。**字节级守卫**：先落 `__geodeRenderMarkdown`
探针 + `.calibration/r26-bytes.mjs`（36 例语料，改 markdown.ts 前 `--baseline` 快照、
改后 diff），实测**仅 4 媒体用例变、32 非媒体用例字节不变**（Part-A 不变量，替代未
重建的 r18-diff）。详见 ARCHITECTURE R26 As-built。
验证：浏览器 E2E `.calibration/r26-e2e.mjs` **12/12**（阅读+live 三态出元素/`#page=N`/
zip 仍链接）+ r26-bytes 0 违反 + R25 17 / R24 12 / R23 22 不回退 + build 绿；桌面 macOS
release probe **r26-probe 5/5**（`__geodeRenderMarkdown` 真实 fs）。
显式延期：canvas 嵌入 + 其它附件（zip/docx）仍降级链接；导出媒体 data-URI 内联（大
文件体积）；PDF 渲染失败 iframe 无 error 事件（原生查看器口径）；两处遗留 MIME 表
（compat util / hover）未来整合候选。

### R31 — v0.31（2026-06-13）斜杠命令 `/` 菜单（R25+ 候选池 #⑦ = **候选池清空**）

编辑器输入 `/`（行首/空白后）弹命令菜单、随输入实时过滤、Enter/点击执行并删除 `/query`。
官方校准（obsidian.md "Slash commands"）：菜单 + 过滤 + 执行删 query + Esc 关。**分层关键**：
R6 `EditorSuggest` 管线在 `compat/`，而 **features 绝不 import compat** → 改**镜像原生
`[[` wikilink 所用 CM6 `@codemirror/autocomplete` 路径**（features/core 可 import
`@codemirror/*`），给 `autocompletion override` 数组追加 slash 源。**core/fuzzy.ts**（从
`features/palette/fuzzy.ts` 迁入——slash 源在 features/editor 需复用、features 绝不互 import，
纯函数提核；三处 palette 引用改 `@core/fuzzy`，命令面板/快速切换/模板选择排序零回归）。
**features/editor/slashCommands.ts**（新）：`SLASH_RE=/(^|\s)(\/[\w-]*)$/`（行首/空白后门控，
`and/or`·`http://`·`[[a/b` 不误触发）+ `slashTrigger`（纯 gate + **未闭合 `[[` 守卫**）+
`slashCandidates`（全部 `available()!==false` 命令按 fuzzyMatch 降序）+ `slashCommandSource`
（CM6 源，apply 两事务=删 `/query` + `commands.execute`）。**cmExtensions** override 追加；
**main.tsx** `__geodeSlash` 探针（装 loadExternal 前）。**对抗评审 1 critical + 1 major 修复**：
① **【C1】菜单不随输入过滤**——`filter:false`+`validFor` 让 CM 冻结列表（reuse 不重查），
**初版 E2E 一次性快打被去抖掩盖假绿**；修复=去 `validFor`（CM 每键重跑源实时重排）；②
**【M1】slash 在未闭合 `[[` 内 co-fire**（`[[foo /bar`）→ `slashTrigger` 加 `[[` 未闭合守卫。
显式延期：编辑器情境命令子集（展示全部 available 超集）/ 命令图标（core Command 无 icon）/
CJK 后无空格 `/` 不触发（`\s` 不含 CJK，显式偏差）/ 分类分组。验证：浏览器 `r31-e2e`
**21/21**（含 C1 增量过滤锁 2 + M1 wikilink/mid-word 抑制锁 3）+ 桌面 release **probe 10/10**
（真实 runtime 触发门控 + 候选排序）+ R30 25 / R29 19 不回退 + `r26-bytes` 0 违例（markdown.ts
未动）+ typecheck/cargo/build 绿。**🎉 R25+ 候选池（Obsidian 原生功能补课）至此清空**——后续
主线 = 发布渠道 + Authenticode 证书（**待用户拍板**，`.tauri-keys` 私钥未找回）+ 性能远期项。

### R30 — v0.30（2026-06-13）Properties 侧栏视图（R25+ 候选池 #⑥ / R22 显式延期收口）

补齐 R22 显式延期三件：①侧栏 All Properties 视图 ②全局属性改名 ③属性值跨库建议。官方校准
（obsidian.md core plugin "Properties view"）：右侧栏 tab、全库属性名列表（类型图标 + 使用
计数）、右键属性 → Rename（全库改名）。**core/metadata.ts**：`getPropertyKeyCounts()`（key→
文件数，case-insensitive 归并 + per-file dedup，独立缓存 per revision）+ `getPropertyValues(key)`
（全库去重值，list 展平、空串过滤、case-insensitive 配 key——值建议数据源）。**core/propertyRewrite.ts**
（新，零依赖）：`renamePropertyAcrossVault` **逐字镜像 R16 `linkRewrite.ts` 的 verified-rewrite
五步纪律**——flushAll+ensureFresh 收敛 → metadata 发现 affected → 逐文件读 fresh（开着读 buffer
否则 readFresh，绝不 cache）→ `buildRenameProperty`（绝不手写 YAML）+ post-rewrite 复解析断言
→ 开文件 `applyExternalEdits` / 关文件 `vault.modify` → per-file skip+report、module `runTail`
串行；types.json carry（regChain RMW 保未知键，前向兼容不清理）。**features/allproperties/**（新）：
右侧栏面板（filter + 类型图标 + key 名 + 计数 badge + 点击展开文件列表点开 + 右键菜单全局改名走
`window.prompt`）。**PropertiesPanel.tsx**：text/multitext 值编辑器接 per-key 值 datalist（index-based
id 避 key 含空格、仅这两类型渲染省扫描），R22 单 splice/20k 闸/提交语义零回归。**App.tsx** 右 tab
+ dispatch、**types.ts** RightPanelKind += allproperties、**main.tsx** `__geodeProperties` 探针（装
loadExternal 前）。**对抗评审 7 维：1 critical + 2 minor 全修**：① **【C1 critical】case-only 改名
（Author→author）每文件静默失败 → 整轮报 noop**——post-rewrite「旧键须消失」断言大小写不敏感，
把合法小写键误判残留。修复 = 仅 `from.toLowerCase()!==to.toLowerCase()` 才跑该检查（教训：凡
「旧标识须消失」类断言遇 case-only 改名必短路）；② **【m1】** 值 datalist 原对所有类型渲染 + 每渲染
全库扫描 → 收窄到 text/multitext；③ **【m3】** 删死 i18n 键 + menu 接 aria-label。显式保留（m2）：
开文件改名计数滞后至 autosave flush（关文件立即，纯视觉）。验证：浏览器 `.calibration/r30-e2e.mjs`
**25/25** + 桌面 release **probe 10/10**（真实 fs：聚合 + 全局改名值字节保真 + case-only C1 实测）+
R29 19 / R27 22 不回退 + `r26-bytes` 0 违例（markdown.ts 未动）+ typecheck/cargo/build 绿。
显式延期（候选池余项）：跨库属性删除（destructive 全库写）/ 类型侧栏内联改 / search 集成（点 key
注入 `[key]`，R21 属性搜索本延期）/ 改名后旧 types.json key 清理 / 值建议类型化（number/date）/
开文件改名计数即时刷新。

### R29 — v0.29（2026-06-13）折叠持久化 + 阅读视图折叠（R25+ 候选池 #⑤ / R17 显式债收口）

补齐 R17「折叠态零持久化」债 + 阅读视图标题折叠。官方校准（WebFetch 核实）：Obsidian 折叠态
存 **localStorage（不入 vault）**、**按文件**一条 key `${appId}-note-fold-${path}`、value =
`{folds:[{from,to}], lines}`（**0-based 行号**，`from`=折叠起始行/`to`=末行，**无 type 标记**，
编辑/阅读共享同一条）。**Geode 取舍**：镜像 value 形状（便于未来导入真实 vault）但存 localStorage、
key 用 `geode.fold.<path>`——**零新 vault 写路径、零新依赖、不动 markdown.ts 字节管线**。
**core/foldStore.ts**（新，纯 TS 可 import @codemirror/state）：`FoldRange`/`FoldInfo` 类型 +
`loadFoldInfo`（解析/形状校验失败返 null）+ `saveFoldInfo`（empty→removeItem 不留空键）+
`foldInfoFromState`（`foldedRanges` 字符区间→0-based 行）+ `foldRangesFromInfo`（行→字符回投，
越界段 + 非整数/负值守卫丢弃，fail-safe 不抛）。**features/editor/foldPersistence.ts**（新）：
捕获 ViewPlugin——`update` 检测 `foldEffect`/`unfoldEffect` 防抖（400ms）save、`destroy` 同步
flush（覆盖 preview↔editor / tab 关闭两丢失点）；接 `cmExtensions.ts` base 列表（`getPath`
已是入参，零签名改动）。**EditorPane.tsx**：mount 恢复（`loadFoldInfo`→`foldRangesFromInfo`→
`foldEffect`，**无 docChanged→不触发 autosave/标 dirty**）+ 阅读视图标题折叠点击委托
（`onPreviewClick` callout 分支后：闭合 `h1..h6` 折叠其节至下个同/更高级标题，嵌套子标题
独立保持折叠，纯 DOM class toggle 无 doc 写，链接 `!closest('a')` 守卫放行）。
**editor.css**：标题 hover chevron（`.markdown-reading-view` 收窄作用域）+ `.geode-heading-folded`。
**main.tsx**：`__geodeFold` 探针（装 loadExternal 前）。
**对抗评审 1 major + 2 minor 修复**：① **CSS 泄漏（major）** 标题样式初版挂裸 `.markdown-rendered`
→ hover 卡片/compat/`.preview-content` 复用此类、平添死 chevron+cursor → 收窄到
`.markdown-reading-view`（仅编辑器阅读窗）；② **越界 throw（minor）** `foldRangesFromInfo` 加
整数/非负守卫防篡改 localStorage 抛 RangeError 中断 mount；③ **探针去 `peek`（minor）** 契约
对齐 as-built。验证：浏览器 `.calibration/r29-e2e.mjs` **19/19**（探针往返 6 + 真实 CM
fold-all→持久化→preview↔editor 往返**恢复**→unfold 清空 4 + 阅读视图折叠/嵌套独立/链接守卫 9）
+ R28 23 / R27 22 / R25 17 不回退 + typecheck/cargo 绿 + `r26-bytes` **0 违例**（markdown.ts
零改动）；桌面 release **probe 4/4**（WKWebView 真实 localStorage 往返 / empty→removeItem /
malformed→null / key 落盘）。显式延期（候选池余项）：阅读视图折叠持久化 + 与编辑器共享
FoldInfo（需 markdown.ts 给 heading emit `data-line` 改字节管线）/ 删除·改名清理孤儿 fold key /
行数漂移内容级对账 / list-indent 折叠的 reading 视图。

### R28 — v0.28（2026-06-13）文件树拖拽移动（R25+ 候选池 #④）

补齐 Explorer「零 drag 处理」缺口。官方校准：文件/文件夹拖到文件夹 = 移动；文件按名
自动排序、**不可手动重排**（故无插入指示线/无 reorder，只有「放进哪个文件夹」单一落点
高亮）；移动即改名、`renameWithLinkUpdate` 自动更新全库链接。**纯接线轮、零新写路径、
零新依赖**。
**core/explorerMove.ts**（评审后从 feature 迁入 core，单一真值）：`resolveDropTarget`
（结构落点：hover 文件夹→自身/文件→父/空白→根 `""`；no-op + 自身后代守卫）+ `wouldCollide`
（落点撞名，大小写不敏感）+ `findFolder` + `EXPLORER_MIME`。**features/explorer/Explorer.tsx**：
每行 `draggable={!isRenaming}` + `onDragStart`（setData + `setTimeout(0)` 防 Chromium 取消，R3
先例）+ 容器级 `onDragOver/onDrop/onDragLeave`（读 `closest('.explorer-item')` data-path 集中
解析）+ `moveNode`（四守卫：no-op/自身后代/撞名 notice/陈旧 `fileExists||folderExists` →
`renameWithLinkUpdate` → 文件夹则 `remapPaths(expanded)` + `expandAncestors` 展开落点 +
`setSelected`）+ CSS `is-dragging`/`is-drop-target`/`is-drop-root`。**core/vault.ts**：
`MemoryVaultAdapter.rename` 加 `to.exists()` 等价守卫（target 已存在即 throw，**镜像 Rust
后端** main.rs:243，关闭浏览器盲写窗口）。**main.tsx**：`__geodeExplorerMove` 探针（装在
loadExternal 之前）。**i18n**：`explorer.moveCollision`（en+zh）。
**对抗评审 7 维**：2 confirmed minor（① 决策核心分层：bootstrap→feature 耦合 → 迁入 core；
② 浏览器陈旧树盲写窗口 → Memory adapter 加 `to.exists` 守卫两端对齐）**已修**；前缀后代
守卫/macOS 大小写撞名/`closest` 冒泡/`setTimeout(0)`/i18n/CSS 5 维 confirmed-correct。
验证：浏览器 E2E `.calibration/r28-e2e.mjs` **23/23**（移进文件夹+行重挂+链接保持解析/no-op
拒绝/自身后代拒绝/**数据安全：撞名拒绝且目标不被覆盖**/文件夹移动带子项/根落点/draggable 属性
+ 合成 dragover is-drop-target 高亮）+ R27 22 / R25 17 / R24 12 不回退 + typecheck/cargo 绿；
桌面 macOS release **probe 4/4 真实 fs**（file→folder+link 解析 / **撞名不覆盖：Dest/dup.md
真实字节 "DEST ORIGINAL" 完好** / 文件夹移动带子项 / no-op+后代守卫；外部读判定）。
显式延期（候选池余项）：虚拟化大库滚动外落点需先滚动（不做 auto-scroll）；移动期源行 dim
仅锦上添花；拖多选未做（单项移动）。

### R27 — v0.27（2026-06-13）书签 Bookmarks（R25+ 候选池 #③）

补齐「完全缺失」的书签功能。官方校准（obsidian.md/help/Plugins/Bookmarks）：可书签
file/folder/heading/block/search/graph 七类 + group 分组（可嵌套）；侧栏点击打开、拖拽
排序/移组、右键改名/删除/新建组；命令 Bookmark active tab / heading / block。**零新依赖**。
**core/bookmarks.ts**：Obsidian 形状判别联合（顶层 `{items:[...],...保留其它顶层键}`），
持久化镜像 `properties.ts` 序列化 RMW——每次写**重读磁盘只换 items、保留未知顶层键 + 逐项
`_extra` 未知字段**、malformed（非对象/items 非数组）**abort 不覆盖**、vault 切换 adapter
身份守卫；未知 `type` 走 `UNKNOWN_TYPE_MARKER` carrier 原样 round-trip。API：`init`/
`isFileBookmarked`/`add`/`toggleFile`/`removeAt`/`setTitleAt`/`addGroup`/`move`（index 路径
寻址 `[i]`/`[g,c]`）。**features/bookmarks/BookmarksPanel.tsx**：递归树（组可折叠）+ 点击导航
（file→openFile；heading/block→openFile+resolveSubpath+requestReveal，**subpath 去前导 `#`**；
folder→切 explorer；graph→openGraph；search→切搜索面板）+ 右键菜单（Rename/Remove/New group，
镜像 Explorer MenuState）+ 拖拽重排/移组（私有 MIME，镜像 tab DnD，插入指示线）。**App.tsx**：
ribbon 书签按钮 + 渲染分支 + 4 命令（bookmark-file toggle/标签翻转、heading/block under cursor、
show）+ `headingUnderCursor`/`blockUnderCursor` 双门控。**main.tsx**：`bookmarks.init` +
`vault:changed` 重载 + `__geodeBookmarks` 探针（list/toggleFile/add/move/reload，**装在
loadExternal 之前**）。
**对抗评审 9 维**：1 minor（carrier rename 丢 title）+ 1 nit（labelHeading 贪婪剥 `#`）**已修**；
move 索引数学/RMW 保真/`_extra` round-trip/分层/XSS 等维 clean。**E2E 抓获并修掉 1 个评审漏网
根因 = `move()` 跨容器索引漂移导致书签项丢失**（详见 ARCHITECTURE R27 As-built）。
验证：浏览器 E2E `.calibration/r27-e2e.mjs` **22/22**（面板/命令 toggle+标签翻转/heading 命令
Obsidian-shape subpath/点击导航/New group/move 嵌套/持久化 reload/**数据安全：未知顶层键+逐项
字段保真、malformed 不覆盖**）+ R26 12 / R25 17 / R24 12 / R23 22 不回退 + r26-bytes 0 违反
（markdown.ts 未动）+ typecheck/cargo/build 绿；桌面 macOS release **probe 8/8**（真实 fs：
读 Obsidian 形状 bookmarks.json + 嵌套组/标题解析 + toggleFile 真写持久化 + 未知顶层/逐项字段
跨真写保真）。
显式延期（候选池余项）：文件改名/删除不更新书签路径（导航 no-op，不毁内容）；search 书签不注入
query；block 仅收已有 `^id` 块（不自动铸 id）；折叠态不持久化；`app.internalPlugins` bookmarks
instance API 未做。

## 迁移体验路线图（R16-R18，2026-06-11 与用户对齐）

> 背景：R15 后与用户盘点"距离 Obsidian 还差在哪"，确认第一梯队 = 会让 Obsidian
> 老用户立刻撞墙的四件。用户口径：发布暂缓（渠道/证书不催），先补迁移体验。

### ~~R16 — 重命名自动更新引用（第一梯队 #1，数据安全重轮）~~ → **已完成（v0.16，见上）**

### ~~R17 — 附件摄入 + 折叠~~ → **已完成（v0.17，见上）**

### ~~R18 — Markdown 方言长尾~~ → **已完成（v0.18，见上）**

callouts（13 类型+别名+折叠+嵌套）、`==高亮==`、脚注（含行内）、`%%注释%%`、KaTeX 数学
全部双视图 + 导出落地。KaTeX 动态 import（独立 chunk）；**mermaid 显式不做**（入 R19+ 候选）。

### R19+ 候选池（迁移叙事第二梯队，按需取）

> 用户口径（2026-06-12）：**从 mermaid 开始，逐步完成每一项**——候选池即后续
> 轮次的执行队列，每轮取一项直至清空（发布渠道项仍待用户拍板）。

| 功能 | 备注 |
|---|---|
| ~~mermaid 图表~~ | **R19 已完成（v0.19，见上）** |
| ~~主题 CSS 类名兼容层~~ | **R20 已完成（v0.20，见上）**——变量桥+类名对齐+theme/snippets 加载；后续逐步对齐更多类名/变量消费侧 |
| ~~Properties 可视化编辑~~ | **R22 已完成（v0.22，见上）**——余项：侧栏 Properties 视图/全局改名/值建议/text 内链渲染（按需求驱动） |
| ~~模板系统~~ | **R23 已完成（v0.23，见上）**——余项：`{{date+Nd}}` 偏移/ribbon 按钮/新建默认位置（按需求驱动） |
| ~~搜索运算符（path:/tag:/file:/正则）~~ | **R21 已完成（v0.21，见上）**——余项：block:/section:/task:*/属性搜索 `[key:value]`/比较运算（按需求驱动） |
| ~~未链接提及~~ | **R24 已完成（v0.24，见上）**——反链面板「未链接提及」节 + Link/Link-all + CJK 词界；余项：Excluded files / 点击滚动到 offset / Show-more-context（按需求驱动） |
| 真实发布渠道 + Authenticode 证书 | **用户拍板后随时可做**（暂缓口径 2026-06-11）——**候选池清空后这是唯一待办主线项** |
| 图谱 WebGL/Worker、倒排索引、未链接提及扫描去抖/热循环门控 | 性能远期（R24 matcher O(n·m) 全库 eager 扫描；10k 下可加首字符门控 + 保存 burst 300-500ms 去抖，已记 As-built） |
| R18 折叠/数学 polish | callout 标题点击折叠仅阅读视图（live 用 gutter）；跨行 `$$`/块注释 live 淡显不渲染/隐藏；行内脚注 live 零处理（官方同行为）；KaTeX vs MathJax 宏覆盖差异——均显式偏差，见 ARCHITECTURE R18 |
| R19 mermaid polish | live 不渲染图表 widget（源码呈现——块 widget 需 StateField 跨行 replace，与跨行 `$$` 同因）；主题切换后已渲染图保持旧主题至视图重渲染（R11 stale widget 先例）；compat MarkdownRenderer 输出图表带 data-target 但点击接线调用方自理——均显式偏差，见 ARCHITECTURE R19 |

### R25+ 候选池（Obsidian 原生功能补课，2026-06-13 与用户登记）

> 背景：R24 后迁移叙事第二梯队（R19+）执行队列清空。与用户盘点「Geode 距离
> Obsidian 还缺的原生功能」，登记下列**第三梯队候选池**。用户口径（2026-06-13）：
> **不着急一口气都做，但要逐项记录在案**；执行顺序待定——每轮开工前问用户取项
> 或按优先级挑。验收沿用四条底线 + 官方校准（docs.obsidian.md WebFetch）+ 双端
> probe 不回退。下表「当前状态」均经 2026-06-13 代码核实。

| 功能 | 当前状态（已核实）| 范围与切入点提示 |
|---|---|---|
| ~~**悬停预览（Hover preview）**~~ | **R25 已完成（v0.25，见上）**——features/hover 控制器（三触发源含 live `.cm-live-wikilink`）+ 卡片（复用 `renderMarkdownToHtml`+`hydrateEmbeds`、subpath `resolveSubpath` 序号滚动）+ 编辑视图 Ctrl/Cmd 修饰键 + 设置两项 + compat `registerHoverLinkSource` 真无操作登记 | 余项（按需求驱动）：块引用 `#^id` 子滚动（需 markdown.ts 加块 DOM 标记）/ 插件自渲染 `hoverPopover`/`HoverParent` / 嵌套预览 / 图谱节点 hover / backlinks 片段按钮 hover。 |
| ~~**PDF 查看器 + PDF/音频/视频嵌入**~~ | **R26 已完成（v0.26，见上）**——音视频原生 `<audio>`/`<video>`、PDF 原生 `<iframe>`（零新依赖，不用 PDF.js）；阅读/live/导出三态 + `#page=N` 锚点 | 余项（按需求驱动）：canvas 嵌入 / 其它附件类型 / 导出媒体瘦身（当前 data-URI 内联）。 |
| ~~**书签（Bookmarks）**~~ | **R27 已完成（v0.27，见上）**——`core/bookmarks.ts` 兼容 `.obsidian/bookmarks.json` 七类型+嵌套组（序列化 RMW 保真未知键 + carrier round-trip）+ 侧栏面板（递归树/拖拽重排移组/右键改名删除新建组/点击导航）+ 4 命令 + `__geodeBookmarks` 探针 | 余项（按需求驱动）：文件改名/删除联动更新书签路径 / search 书签注入 query / block 自动铸 `^id` / 折叠态持久化 / `app.internalPlugins` bookmarks instance API。 |
| ~~**文件树拖拽移动**~~ | **R28 已完成（v0.28，见上）**——`core/explorerMove.ts` 决策核心（resolveDropTarget 四守卫 + wouldCollide）+ Explorer HTML5 DnD（行 draggable + 容器级 dragover/drop + moveNode 走 `renameWithLinkUpdate`）+ `MemoryVaultAdapter.rename` 加 `to.exists` 守卫镜像 Rust + `__geodeExplorerMove` 探针 | 余项（按需求驱动）：虚拟化大库 auto-scroll / 拖多选 / 拖到标签页打开 / 移动期源行 dim 打磨。 |
| ~~**折叠持久化 + 阅读视图折叠**~~ | **R29 已完成（v0.29，见上）**——`core/foldStore.ts`（镜像 Obsidian `{folds,lines}` 0-based 行形状，存 localStorage `geode.fold.<path>`，零新 vault 写路径）+ `features/editor/foldPersistence.ts`（ViewPlugin 防抖捕获 + destroy flush）+ EditorPane mount 恢复（foldEffect 无 docChanged→不触发 autosave）+ 阅读视图标题折叠点击委托（嵌套独立，纯 DOM toggle）+ `__geodeFold` 探针 | 余项（按需求驱动）：阅读视图折叠持久化 + 与编辑器共享 FoldInfo（需 markdown.ts 给 heading emit `data-line`，改字节管线）/ 文件删除/改名时清理孤儿 fold key / 行数漂移内容级对账 / list-indent 折叠的 reading 视图。 |
| ~~**Properties 侧栏视图**~~ | **R30 已完成（v0.30，见下）**——`core/propertyRewrite.ts`（renamePropertyAcrossVault 镜像 R16 verified-rewrite）+ `metadata.getPropertyKeyCounts/getPropertyValues` + `features/allproperties/` 右侧栏面板（类型图标+计数+展开文件列表+右键全局改名）+ PropertiesPanel 值建议 datalist + `__geodeProperties` 探针 | 余项（按需求驱动）：跨库属性删除 / 类型侧栏内联改 / search 集成（点 key 注入 `[key]`）/ 改名后旧 types.json key 清理 / 值建议类型化 / 开文件改名计数即时刷新（m2 滞后）。 |
| ~~**斜杠命令 `/` 菜单**~~ | **R31 已完成（v0.31，见下）**——`features/editor/slashCommands.ts`（`slashCommandSource` CM6 补全源镜像 `[[` wikilink 路径，**非** compat EditorSuggest——分层铁律 features 绝不 import compat）+ `core/fuzzy.ts`（从 palette 迁入复用）+ `cmExtensions` override 追加 + `__geodeSlash` 探针 | 余项（按需求驱动）：编辑器情境命令子集（我们展示全部 available 超集）/ 命令图标（core Command 无 icon）/ CJK 后无空格 `/` 不触发（显式偏差）/ 分类分组。 |

> 注：上表外，发布渠道 + Authenticode 证书（待用户拍板，`.tauri-keys` 私钥未找回）
> 与性能远期项（图谱 WebGL/Worker、倒排索引、R24 扫描去抖+热循环门控）见 R19+ 表
> 末两行，仍属待办；各轮 polish 余项见 R19+ 表与「已知技术债」。

## 已知技术债

- R17 折叠/摄入显式口径（详见 ARCHITECTURE R17 节）：折叠状态不持久化（tab 重开/
  preview 往返丢，Obsidian 按文件持久化——偏差）；阅读视图无折叠；Setext 标题无
  折叠点（headerIndent 已剥离）；foldNodeProp 回退使 fence/blockquote/table/多行
  段落有 hover 箭头可手动折叠（Obsidian 不提供——fold-all 不卷入）；fold gutter
  在面板最左缘（宽窗口下与正文有距离，Obsidian 贴正文——R18+ polish）；仅图片
  摄入（其他附件类型 R18+）；"Fold heading"/"Fold indent" 细分开关未做（常开）；
  compat `vault.getConfig("attachmentFolderPath")` 仍 undefined；二进制自写无回声
  指纹（桌面多一次树刷新，安全方向）；vault 切换窗口内 in-flight 摄入写新库
  （毫秒级 TOCTOU 同类）。
- R16 改写引擎显式口径（fail-safe 方向，详见 ARCHITECTURE R16 节）：markdown 标准
  链接 `[text](note.md)` 不在解析面、不改写；`[[#h]]` 不进 links 索引（graph 无自环；
  官方 getFileCache().links 含 `#h` 条目——形状偏差）；`![[#h]]` 同文嵌入保持原文；
  `[[#` 无 heading 自动补全；与附件 basename 撞名的 md alias 会在 capture 期遮蔽该
  附件（改名漏改嵌入，绝不误写）；根目录改名且 basename 撞车双形态消歧均败 →
  skip+报告；CRLF 文件打开/保存即 LF 化（咽喉点统一，Obsidian 保留 CRLF——偏差）；
  关闭文件 read→write 间毫秒级 TOCTOU 残留。

- ~~图谱最大化窗口下居中偏移~~（R7 根治：fit-to-view + 布局后初测 + dpr resize 监听）
- compat EditorSuggest：~~纯光标移动不重评估~~~~setInstructions 不渲染~~（R9 双双闭合：
  `document:selection-changed` 事件 + 官方 `.prompt-instructions` 渲染）；
  剩余：popup 不随窗口 resize/scroll 重定位（显式保留）
- moment-with-locales + ureq：安装包体量随轮次缓涨，商业分发前可做按需裁剪
- ~~自身写入回声触发 watcher~~（R8 根治：FNV-1a 指纹分流 + 全抑制快速路径。
  残留显式限制：未 await 的同路径并发写可能把首个回声判为外部——下游 dirty 守卫 +
  内容相等 no-op 全兜住，失败方向安全，仅多一次冗余刷新）
- i18n 已知限制（R8，有意取舍）：CM6 构建期解析的字符串（编辑器 placeholder、任务
  复选框 aria-label、frontmatter 药丸 title）切语言后保持旧语言直到视图/widget 重建
  （模式切换/重开 tab/编辑该行即自愈；代码内已注释）；~~GeodePlugin.name/description
  仍是纯字符串~~（R10 thunk 化根治，内置插件名随语言切换）
- ~~图片/嵌入 `![[...]]` 在 live preview 中保持原文~~（R11 图片 + R12 笔记转写 +
  R13 `^block` 全落地；残留：PDF/音频嵌入降级链接、外部改图后已渲染 widget 显示旧图
  至重建（已知口径）、点击不滚动定位 subpath（R14 候选））
- ~~live preview 的 wikilink 正则扫描不跳 fence~~（R14 统一排除；行内 code 不对称
  保留——Obsidian 同样不装饰，远期）
- parseNote 块范围为段落近似（表格/嵌套列表的复杂块不精确；标记行紧邻 fence 时段落
  扩进 fence 内容——与 Obsidian 行为近似，显式偏差）；列 0 的独立 `^id` 行不被识别
  （冻结正则要求前导空白，Obsidian 认——显式偏差）
- ~~图谱 10k 节点 ~12fps~~（R7 实现按需渲染+抽样：settle 5.8s/42fps、idle 0 draw；
  剩余：Show all 不抽样 10k settle 期 ~9fps，opt-in 可用，WebGL/Worker 远期）
- ~~同文件双 pane 双脏 last-writer-wins~~（R4 共享文档模型根治）
- ~~重命名打开中的文件丢 undo/光标/滚动~~（R4 根治）
- ~~vault 切换后指向新 vault 不存在路径的 tab 不自动关闭~~（R10 根治：
  closeMissingFileTabs，切库+启动双调用点）
- ~~compat `workspace.on('editor-change')` 按保存触发而非逐事务~~（R5 document:changed 根治）
- ~~live↔source 模式切换仍重建视图丢选区/滚动~~（R11 Compartment 重配置根治；
  preview 往返为尽力恢复口径）
- compat 自定义视图不随 workspace 持久化——重启后靠插件自身启动逻辑重建
  （calendar 的 layout-ready 路径可自愈；recent-files 需用户再开，官方行为是布局还原）
- moment-with-locales 全量打包（主 chunk +~330KB min 前）；如需瘦身可改按需 locale 子集
- bench 口径未覆盖 compat 视图挂载/卸载路径（R5 无性能回归实测，10k vault 下未量化）
