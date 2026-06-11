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

## R16 候选

| P | 功能 | 备注 |
|---|---|---|
| P1 | 真实发布渠道接通 + Authenticode 证书 | **外部依赖：渠道决策与证书购买需用户拍板**；技术侧只剩改 endpoint 一行 + 填 signCommand。**P2 池已见底——没有此输入，建议暂停特性轮** |
| P2 | 全文搜索专项（基线复测 + 防抖自适应 + 倒排索引远期） | PERFORMANCE.md R3 遗留建议 |
| P2 | 图谱 WebGL/Worker 远期 tier | 不抽样 10k Show all 仍 ~9fps |
| P2 | PDF/音频嵌入、行内 code 装饰对称、[[#h]] 同文链接 | 体验长尾 |

## 已知技术债

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
