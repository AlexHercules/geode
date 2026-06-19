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
大纲面板、~~frontmatter（aliases 参与链接解析）~~[解析早已实现 + R106 suggester surface 收尾]、侧栏拖拽调宽、右栏 Tab 化。
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

### R67 — v0.64（2026-06-14）拖拽 vault 文件入编辑器 → 链接/嵌入（第五梯队 ㉛ → 出队；**【小】项清空**）
两道前置门：grep 确认外部文件摄入(R17)+树拖拽移动(R28)已在但 vault 内文件拖入编辑器是缺口 + WebSearch 确认 Obsidian 核心。
实现 = 编辑器 drop handler 识别 `EXPLORER_MIME`（核心共享 MIME）：dragover 接管（explorer 拖无 text/plain）+ drop 分支 sync 插入到落点；effectAllowed move→copyMove（编辑器 copy 光标，R28 不破）。sync 无 await（无 R44 重入）不写 vault。
验证：typecheck 0 · `r67-e2e` **9/9** · `r67-probe` **4/4**（真 Tauri fs fileExists 区分文件/文件夹）· 回归 r28/r35 绿。
**对抗评审（Workflow 3 lens）1 主根因（3 lens 命中）+1 major → 修**：裸包 basename 的两个病——① 重名消歧缺失（`[[Spec]]` 在 A/Spec+B/Spec 共存时静默链错文件）；② wikilink-unsafe 字符（`Foo#Bar`→渲染器按 # 切→错目标）。**修=复用全代码库 fileToLinktext 规则（第 4 处）**：取解析回本文件的最短形（basename 若解析回本文件否则全路径）+ 含 unsafe 字符则不插（胜过静默坏链）。nit 接受：拖文件夹 dragover copy 光标（drop no-op）。**元教训**：「从文件名构造 wikilink」=fileToLinktext 规则（解析回验+重名→全路径+特殊字符不可表达则不产出），全代码库已 3 处实现；新写「文件→链接」路径先 grep 既有 builder 照它来，别裸包 basename（R44 同源「文件名→链接是对抗输入」）。

### R66 — v0.63（2026-06-14）状态栏增强：后链数 + 选中字数（第五梯队 ㉙ → 出队，核心项）
分项 Gate 2（官方 help 确认 Obsidian 核心状态栏 = 后链数/编辑器视图/字数）：后链数+选中字数=核心 → 做；光标行:列=非核心（社区插件）→ **移除**（同 ㉔）。
实现 = 两个纯 view 状态栏项（零核心 API 新增）：① 新 `backlink-count` 插件（getBacklinks 提及总数，metadata.revision 跨文件更新）；② word-count 加「N selected words」（getActiveView 选区，selection-changed）。
验证：typecheck 0 · `r66-e2e` **8/8** · `r66-probe` **3/3**（真 fs）· 回归绿。
**对抗评审（Workflow 3 lens）抓到 1 major 性能回归 + 2 minor，全本轮引入 → 全修**。MAJOR（2 lens）：`selection-changed` 每次光标移动（含空选区）都触发 → 整篇 countWords + setStatusBarItem（旧实现 Store 即使文本未变也通知 → App 根每次光标移动重渲）+ plugins.ts 每次 push disposer 无界增长。修：① word-count 仅在选区状态跃迁时 update（跳过 empty→empty）；② **根因修 plugins.ts setStatusBarItem**（文本未变跳过 Store 写 + 仅新增项 push disposer，惠及所有状态栏插件）。minor：打字覆盖选区同事务塌缩（只发 document:changed）→ 加 document:changed 监听清残留；requestToken bump 移到 update() 顶部（防慢读覆盖选中显示）。**元教训**：给高频事件（selection-changed 每次光标移动都发）挂 always-on 监听前，先问「空操作/无变化时做了多少功」——正确模式=状态跃迁门 + Store/setter 层去重（值未变不通知）。

### R65 — v0.62（2026-06-14）Footnotes 脚注面板（第五梯队 ㉘ → 出队）
两道前置门：grep 确认脚注解析存在（R18 阅读视图渲染）但无 metadata 索引/无面板（真缺口）+ WebSearch 确认 Obsidian 1.9 把 Footnotes view 做成**核心插件**（核心非社区 → 做）。
实现 = metadata 索引（镜像 headings：`FOOTNOTE_DEF_RE` 行扫描 on masked 排围栏，content 取原文，`getFootnotes`）+ 新右栏 tab `features/footnotes/`（列 id+content，点击 jumpTo 定义复用 `geode:scroll-to-heading`）。纯前端零依赖不碰 vault。
验证：typecheck 0 · `r65-e2e` **12/12** · `r65-probe` **6/6**（真 fs/WKWebView：解析+围栏排除+原文 content+leading-code 保留）· metadata 回归 r41/r62/r64/r24/r26-bytes 全绿。
**对抗评审（Workflow 3 lens）1 根因（解析器是阅读视图脚注解析的子集→分歧，R56/R57「检测=渲染对齐」再现）→ 部分修+部分记限制**。修（content 正确性）：body 以内联代码开头丢失（原从 masked m[2] 取偏移，贪婪空格吃掉 masking 空格）→ **改从 `]:` 边界在原文 slice**。记限制：1-3 空格缩进定义被漏（保持 col-0 锚定=与 HEADING_RE/TAG_RE/BLOCK_MARKER_RE 同约定）；多行续行不合并（面板单行省略号；完整 markdown-it 块续行镜像不成比例）。证伪：纯 view 无写、duplicate id 列全部可辩护、跳转到定义可辩护。**元教训**：渲染器逻辑深绑框架（markdown-it 块状态）无法干净抽共享时，「镜像渲染器」要权衡——修高价值常见分歧、对罕见分歧记限制而非硬手抄镜像（手抄可能引入新分歧）。

### R64 — v0.61（2026-06-14）Outline 内搜索过滤（第五梯队 ㉗ → 出队）
**两道前置门**：① grep 确认 OutlinePanel 无过滤框（真缺口）；② WebSearch 确认 Obsidian 核心 Outline 插件**确有过滤栏**（核心非社区插件 → 做，与 ㉔ 相反）。
**实现 = 纯 view**：`filterRows` 纯函数（镜像 buildRows/visibleRows 范式）大小写不敏感 substring → 显示命中 + 祖先（淡显，保留层级）不含后代（对齐 Obsidian）；query state 切文件清空；过滤忽略 collapse、无匹配空态。纯前端零依赖不碰 vault。
验证：typecheck 0 · `r64-e2e` **15/15** · 桌面纯 view 无平台面 → binary build + boot smoke r63-probe 4/4（真 WKWebView 启动+编辑器栈完好），浏览器 e2e 跑真 React 组件即双端权威 · 回归不退。
**对抗评审（Workflow 3 lens）2 确认（minor+nit，本轮引入）+ 10 证伪**：① 切文件 query 在被动 useEffect（paint 后）重置 → 新笔记先渲一帧旧 query → 可能闪「无匹配」（React 反模式）→ **修=useLayoutEffect**（paint 前重置）；② is-ancestor 淡显 specificity(0,3,0) 压过 hover(0,1,0) → 祖先 hover 不变亮 → 加 `.is-ancestor:hover .outline-label` 规则。证伪：filterRows 逻辑全边角正确、纯 view 无写、count 显总数可辩护。**元教训**：「换 prop 重置 UI state」用 useLayoutEffect（或 during-render ref-guard 正式写法），别用 useEffect——被动 effect paint 后才重置，先渲一帧「旧 state×新数据」错配。

### R63 — v0.60（2026-06-14）多光标 / 多选 foundation（第五梯队 ㉕ → 出队；㉔ 移除=非核心）
**两道前置门**：① **faithfulness 门**——㉔ Smart typography（弯引号/em-dash/省略号）WebSearch 证实是社区插件（mgmeyers）**非 Obsidian 核心** → 与 `{{date+3d}}` 同类**出队不做**（R60 候选池又一次把社区功能误登记为核心）。② **grep/derisk 门**——㉕ 真实缺口 = Geode 根本无法持有/渲染 >1 光标（无 allowMultipleSelections/drawSelection）；命令早全在 keymap（Mod-Alt-↑/↓ addCursor、Esc simplify）只是静默 no-op（R51 同源）。
**修 = 2 行 foundation**：buildEditorExtensions 加 `allowMultipleSelections.of(true)` + `drawSelection()` + `rectangularSelection()`+`crosshairCursor()`（列选）。零依赖、无 Rust、纯 view。Cmd+D 冲突裁决：保留 daily-note Mod+D（select-next 也是社区插件非核心，无让位压力，避免跨 feature churn）。
验证：typecheck 0 · `r63-e2e` **8/8**（渲染 3 光标/addCursorBelow+Above/多点同编/Esc 收起）· `r63-probe` **4/4**（真 WKWebView 持 2-range，control 1）· 回归 r35/r51/r34/r55 全绿。
**对抗评审（Workflow 3 lens）抓到 1 真数据安全回归→已修**：fmField Backspace 守卫只查 `selection.main`，多光标副光标可停在被保护的首行正文起点删掉 frontmatter 闭合换行（INT-3 回归，本轮 foundation 引入）→ **改查所有 range**（`ranges.some`）+ e2e 锁。其余非数据安全（format/wrap 命令多光标下仅作用主选区=预存）。**元教训**：① 开 `allowMultipleSelections` 必 grep 所有读 `selection.main` 的写/删守卫（副光标会绕过单光标假设）；评审对「11 行启用标准扩展」仍抓到真回归，diff 小不可省评审。② 「先 grep 是否已实现」外加「**先核是不是 Obsidian 核心**」（WebSearch）——R60 把社区插件（㉔ smart typography、㉕ 的 Cmd+D select-next）当核心。

### R62 — v0.59（2026-06-14）专用 Outgoing Links 出链面板（第五梯队 ㉓ → 出队）
**Step 0 grep 现状救场**：出链数据(`getOutgoingLinks`)+显示(`BacklinksPanel` 出链分区,R24 起)早已存在 → **㉓ 第 5 次「缺口」实为部分已实现**（Setext R54/Setext-dim R55/`%%` R58/粘贴URL·callout R60）。真缺口 = Obsidian 把 Outgoing Links 作独立核心插件面板,Geode 只折叠进组合反链面板 → 本轮抽**独立右栏 tab**（镜像 OutlinePanel,复用 getOutgoingLinks,拆 Links/Unresolved 两分区 + 命令 `app:show-outgoing-links`）。刻意不动组合 BacklinksPanel（出链同显两处 = 评审证伪为可接受 deliberate scoping）。纯只读 view,唯一写=点未解析 createAndOpen（与反链同款,数据安全证伪）。
验证：typecheck 0 · `r62-e2e` **14/14** · `r62-probe` **5/5**（真 WKWebView setRightPanel 持久化 + 真 fs metadata）· 回归 r30/r41 面板切换不回退。
**对抗评审（Workflow 4 lens + verify）：19 finding → 7 确认（全 nit/minor,0 critical/major）+ 12 证伪**。确认修：别名链接显示 `alias||target`（对齐 Geode 阅读/live 约定）/ 自有 `outgoinglinks.*` i18n 键替代借用 backlinks.*（self-containment）/ dict 头注释补全 / e2e 补真 no-active-file ol-empty / ARCHITECTURE Round 62 节。证伪：createAndOpen 数据安全（无穿越/覆盖/已 catch）、subpath 折叠（Obsidian 同款按目标去重）、两栏冗余（deliberate）。**元教训**：Step 0 grep 现状这次直接把 scope 从「从零做出链」收窄成「抽独立面板」,救了大半轮——「先 grep」从教训变成实际挡返工的流程。

### R61 — v0.58（2026-06-14）图片嵌入尺寸 `![[img.png|200]]` / `|200x100`（第五梯队 ㉒ → 出队）
Obsidian 图片尺寸语法（WebFetch 确认：`|宽`=等比缩放、`|宽x高`=双维、小写 `x`、**仅图片**）。三态一致：阅读视图 `markdown.ts` 占位 `<img width height>`、导出 `export.ts` **零改动**（hydrate 只设 src，尺寸继承）、live `EmbedWidget` 加 width/height。**核心**：reading 与 live **共用 `parseEmbedSize` 单一解析器**（去漂移，R56/R57 延续）。数字别名当尺寸+alt 回落文件名；非数字别名仍当 alt（字节级不变）。**零依赖、无 Rust、纯 view**。
验证：typecheck 0 · `r26-bytes` **41 案 0 违反**（重捕基线 + size 案翻 non-media 锁死）· `r61-e2e` **15/15** · `r61-probe` **8/8**（真 WKWebView 真 png）· 回归 r26/r57 不回退。
**对抗评审（Workflow 4 lens + verify）：1 根因确认修 + ~9 证伪**。确认（minor，3 lens 命中/2 verify REAL）：无上界 `Number()` → 巨数别名三端漂移（阅读/导出发 `"1e+21"`/`"Infinity"` 无效 HTML→intrinsic；live `img.width` 走 ToUint32→clamp）。**修=正则封 5 位 `\d{1,5}`（≤99999px，<2³² 且非指数→三端逐字节一致 by construction）**。证伪：video/pdf 尺寸（Obsidian 仅图片）/ CSS 不加 height:auto（正确）/ 导出继承（安全）。**元教训**：「检测=渲染字节对齐」推广到「N 端共用一解析器」时，**解析器值域必须所有端等价接受**——`Number()` 无界在「拼字符串」端与「赋 IDL 属性」端对极端输入分歧，单一权威也漂移；用输入约束（位数上限）收口。**顺手**剥 ARCHITECTURE/HANDOFF 各 1 NUL+1 US 控制字节（R44/R46 那批，破 grep）。

### R58 — （2026-06-14）#⑱ `%%` 注释探明=stale gap，无代码改动（修正 + #⑱ 收尾 + 交接用户）
原定 R58 = `%%` 注释 live 隐藏（#⑱ 最后一项）。**探明发现 `%%` inline 隐藏 R18 早已完成**：livePreview.ts 既有「same-line `%%comment%%` hiding + cross-line comment-block line-tinting」+ 自己的 `commentDelimOffsets`（镜像 markdown.ts）。实测既有处理：inline `%%comment%%` 光标 off 隐藏 / 光标 inside 揭示 / doc 字节不变，全绿。
本轮一度写了冗余 `liveComments.ts`（与既有冲突，揭示失效暴露了既有实现）→ **已全部 revert**（tree=R57 状态，版本仍 0.57.0，无 feature commit）。
**这是第三次「候选池缺口」实为已完成**（Setext 样式 R54、Setext-dim R55、`%%` R58）。**#⑱ live 渲染长尾视为完成**（仅余 cross-line block `%%` 是 tinting 非完全隐藏的 minor polish，与 R18 纠缠，延后）。
**⚠️ 自主小池清空**：剩余候选池全是大轮/需用户拍板项（#⑧ stacked / #⑯ pop-out / #⑰ canvas / #⑮ deep-link[新 crate] / #⑭ schema）→ **交回用户指定下一步优先级**。

### R57 — v0.57（2026-06-14）Live preview 跨行 `$$` 数学 + 共享 HydratedBlockWidget（R32+ 候选池第四梯队 #⑱ live 渲染长尾）
① 把 R56 mermaid 的「占位+异步 hydrate」widget 抽到共享 `liveHydratedWidget.ts` 的 `HydratedBlockWidget`，重构 liveMermaid 复用（r56-e2e 13/13 护航零回退）。
② 新 `liveMath.ts`：`$$…$$` display 数学 live 渲染为 KaTeX（R18 延后项）。lezer 无 `$$` 节点 → `findMathBlockRanges` 行扫描（镜像 markdown.ts 块规则）+ **renderMarkdownToHtml self-check**（slice 必须出 `geode-math-block` 才纳入→渲染器为权威，检测零分歧）。复用 hydrateEmbeds math pass。
接入 livePreview()（仅 live）+ `__geodeMath` 探针 + CSS。**零新依赖、无 Rust、纯 view 不改文档**。
`r57-e2e` **19/19**（7 纯检测含边角 + 8 live widget 含异步 KaTeX + 4 D1 缩进守卫）+ `r57-probe` **9/9** + 回归 r56/r55/r51/r52/r35/r33/r24/r29 不回退。
**评审 1 minor 修 / 11 维证伪**：D1=列表内缩进 `$$` range 永远 line.from→行首守卫失效→被 widget 化→修=opener 要求 `indent===0`（缩进 math 降级源码，与嵌套表格/mermaid 一致）。

### R56 — v0.56（2026-06-14）Live preview mermaid + 共享 block widget 抽取（R32+ 候选池第四梯队 #⑱ live 渲染长尾）
① 把 R55 live 表格的 cursor-aware block widget 机制抽到共享 `liveBlockWidget.ts`（`liveBlockWidgets(spec)` StateField + atomicRanges + 行首守卫 + selection-reveal），重构 liveTables 复用（r55-e2e 15/15 护航零回退）。
② 新 `liveMermaid.ts`：```mermaid 围栏 live 渲染为图（R19 显式延后的 live mermaid，正是 R55 范式）。`findMermaidRanges`（FencedCode 的 CodeInfo 首词==="mermaid"，镜像 fence renderer）+ `MermaidWidget`（renderMarkdownToHtml 占位 + hydrateEmbeds 异步 SVG，复用 R19 管线含 mermaidBatchChain 串行）。
接入 livePreview()（仅 live）+ `__geodeMermaid` 探针 + CSS。**零新依赖、无 Rust、纯 view 不改文档**。
`r56-e2e` **13/13**（5 纯 + 8 live widget 含异步 SVG headless 真出）+ `r56-probe` **7/7** + 回归 r55/r51/r52/r35/r33/r24/r29 不回退。
**评审 0 真缺陷 / 5 维全证伪**（重构等价、检测=渲染器一致[仅 1 安全方向偏差]、**异步并发被 mermaidBatchChain 全局串行化**[实测 2 图无串色]、data-safety 零修改无 XSS）。

### R55 — v0.55（2026-06-14）Live preview 表格（live tables）（R32+ 候选池第四梯队 #⑱ live 渲染长尾）
GFM 管道表格在 live preview 渲染为真 `<table>`（复用阅读视图 `renderMarkdownToHtml`）——**Geode 首个 cursor-aware block-replace widget**。
`features/editor/liveTables.ts`（NEW）：`findTableRanges`（纯，syntaxTree 取 Table 节点）+ `TableWidget`（innerHTML=renderMarkdownToHtml + mousedown 揭示源码）+ `buildTableDecos`（行首守卫 + selection 相交揭示）+ `liveTables` **StateField**（provide decorations+atomicRanges）。接入 livePreview()（仅 live 模式）+ `__geodeTable` 探针 + CSS。
**关键 CM 约束**：block 装饰必须经 StateField（ViewPlugin 提供 block 装饰→`RangeSet.spans` 崩溃白屏）→ 镜像 frontmatter fmField。**纯 view 装饰不改文档=零数据丢失风险**（cursor/click 揭示源码可编辑）。
`r55-e2e` **15/15**（4 纯 + 8 live widget + 3 nested-table guard）+ `r55-probe` **6/6** + 回归 r51/r52/r35/r33/r24/r29 不回退。
**评审 1 major + 2 minor 修 / data-safety 核心全证伪**：major=blockquote/list/缩进表格的 Table from 不在行首→行中块装饰损坏→行首守卫（降级显示源码）；minor=eq 纳入 html。**确立 cursor-aware block widget 范式**（后续 #⑱ mermaid/跨行 `$$` 复用）。
**scope 记一句**：原定 Setext dim 精修，derisk 证伪（Setext 下划线 `===` 与 ATX `#` 同为 `cm-md-h1 cm-md-mark` 已一致，无精修可做）→ 改取高价值 live 表格。

### R54 — v0.54（2026-06-14）Setext 标题折叠（R32+ 候选池第四梯队 #⑱ live 渲染长尾）
**先纠过时判断**：Setext 标题（`text\n===`/`text\n---`）的 live 样式**早已存在**（`syntaxHighlighting(mdHighlight)` 把 lezer 的 heading1/2 tag 映射成 `cm-md-h1/2`，lezer 给 Setext 文本也打这些 tag）。**真实缺口 = 折叠**（`folding.ts` 自 R17 注释明写「SetextHeading out of scope」）。
本轮扩展 foldService：新增 `SETEXT_HEADING_RE` + `headingLevel(name)`（ATX 1-6/Setext 1-2 统一层级）；`headingSectionEnd` + `markdownFoldRange` 改用它 → Setext 在文本行加折叠点（折隐藏下划线+section）、ATX+Setext 互为 section 终止符。export `markdownFoldRange` + `__geodeFoldRange` 探针。
**顺带修 latent bug**：「ATX section 后跟 Setext 同级标题」之前折穿（把 Setext 折没），现在在它前停（纯 ATX 文档折叠逐行不变）。**零新依赖、无 Rust、不碰 markdown.ts**。
`r54-e2e` **11/11**（7 纯 fold-range + 4 live 折叠）+ `r54-probe` **8/8** + 回归 r29/r51/r52/r35/r33/r24 不回退。**评审 0 真缺陷 / 全维证伪**（折叠几何 / `---`·`===`·frontmatter·fence 歧义 / 探针-live 解析树逐字节一致）。

### R53 — v0.53（2026-06-14）Unique note creator（唯一笔记 / Zettelkasten）（R32+ 候选池第四梯队 #㉑）
`core/uniqueNote.ts`（NEW，镜像 `core/dailyNote.ts` R48）：`uniqueNoteFolder`/`uniqueNoteFormat`/`uniqueNoteTemplate` Store + setter（localStorage）。
`uniqueNoteName(date)` = `moment(date).format(effFormat())`（默认 `YYYYMMDDHHmmss`）；`effFolder()` 默认 `""`=vault root（Obsidian 同款，与 daily 回落具名文件夹不同），traversal/dot 段回落 root。
`createUniqueNote` = createFolder → await content（模板展开或空）→ **collision-retry 循环**（`vault.uniquePath` → `vault.create`，reject 且文件已存在=竞态→重算后缀重试）→ openFile。
`plugins/unique-note.ts`（NEW）：`unique-note:create` 命令（无默认键）。SettingsModal 加 3 字段 + `__geodeUnique` 探针 + i18n（cmd/plugin/settings，en+zh）。**零新依赖、无 Rust**。
`r53-e2e` **11/11**（5 纯变换 + 5 live create[含同 tick 竞态] + 1 设置 UI）+ `r53-probe` **6/6** + 回归 r48/r50/r44/r24 不回退。
**评审 1 真缺陷（minor）修 / 11 证伪**：同 tick 双触发原只建一篇（create_new 拒后静默打开第一篇）→ createUniqueNote collision-retry 循环（拿 `X 1.md`）+ 补 Promise.all 竞态回归断言。
**scope 记一句**：原定 #⑧ stacked tabs，探明真 Obsidian 版 = 内容级 cascade（需多 EditorPane 挂载，大轮）→ 改取确定能一轮干净交付的 #㉑。

### R52 — v0.52（2026-06-14）编辑命令补全 II（toggle-comment / indent / 行操作）（R32+ 候选池第四梯队 #⑳余项）
`features/editor/editorEditCommands.ts`（NEW）：`registerEditorEditCommands(app, getView)` 把 `@codemirror/commands` 的 5 个 StateCommand
（`toggleComment`/`indentMore`/`indentLess`/`insertBlankLine`/`selectLine`）暴露成命名命令（`editor:toggle-comment`[Mod+/]/`editor:indent`/`editor:unindent`/`editor:insert-blank-line`/`editor:select-line`）。
**headline = toggle-comment 产出 Obsidian `%%…%%` 注释**：markdown 自身无 commentTokens → cmExtensions 加 `markdownLanguage.data.of({ commentTokens: { block: { open: "%%", close: "%%" } } })`，
toggleComment 落 block 路径包/解 `%%`。**`deleteLine` 排除**（它是 Command 需真实 view，探针驱动不了；Obsidian 亦无此默认命令）。
App.tsx 接线（getActiveFileEditorView 门控，与 format/composer/motion 并列）+ `__geodeEdit` 探针（一次性 EditorState 含 markdown+commentTokens，返回 {doc,from,to}，selectLine 只改选区）+ i18n 5 键。
**零新依赖、无 Rust、无新 vault 写路径**（单 CM transaction → autosave）。`r52-e2e` **11/11**（7 纯变换 + 3 live + 1 真实 `Meta+/` 键击）+ `r52-probe` **6/6** + 回归 r51/r35/r33/r40/r24 不回退。
**评审 0 真缺陷 / 5 维全证伪**（一条 open===close toggle 固有歧义备注，贴近 Obsidian、可逆，by-design 非缺陷）。

### R51 — v0.51（2026-06-14）移动行 / 复制行编辑命令（Line motion）（R32+ 候选池第四梯队 #⑳）
`features/editor/editorMotionCommands.ts`（NEW）：`registerEditorMotionCommands(app, getView)` 把 `@codemirror/commands` 的
`moveLineUp`/`moveLineDown`/`copyLineUp`/`copyLineDown` 4 个 StateCommand 暴露成命名命令（`editor:move-line-up`/`-down`/`copy-line-up`/`-down`），
thin wrapper，`name` thunk，`available: () => getView()!==null`（阅读视图 no-op），callback = `cmd(view); view.focus()`。
**键位** move=`Alt+ArrowUp/Down`、copy=`Shift+Alt+ArrowUp/Down`（CM/VS Code/Sublime/Obsidian-CM6 通用约定）。
**关键认知**：CM `defaultKeymap` **已绑**这些键 → 行为今天已能用；本轮价值 = **命名化 + palette 可发现 + 可重绑**。键与 defaultKeymap 同键时，
cmExtensions 的 Prec.highest `handleKeydown` 拦截器在 defaultKeymap **之前**匹配 → `preventDefault`+`return true` → **单次触发无双发**。
App.tsx 接线（`getActiveFileEditorView` 双侧门控，与 format/composer 并列）+ `__geodeMotion` 探针（一次性 EditorState 跑纯变换）+ i18n 4 键。
**零新依赖、无 Rust、无新 vault 写路径**（单 CM transaction → autosave，与 R33 同管线）。`r51-e2e` **10/10**（6 纯变换 + 3 live + 1 真实 `Alt+ArrowUp` 键击路由）+ `r51-probe` **6/6** + 回归 r33/r40/r24 不回退。
**评审 0 真缺陷 / 4 维全证伪**；主动处理评审点名 1 项：键位由初版 `Mod+Shift+Arrow` 改 `Alt+Arrow`（对齐约定、消 defaultKeymap 冗余、消 macOS 原生 `Cmd+Shift+↑` 遮蔽）+ 补真实键击断言（评审点名覆盖盲点）。

### R50 — v0.50（2026-06-14）可读行宽 + 拼写检查 + 应用级缩放（Appearance）（R32+ 候选池第四梯队 #⑲）
`core/appearance.ts`（NEW）：`readableLineLength`/`spellcheckEnabled` Store + setter（localStorage，镜像 autoUpdateLinks）。
**Readable line length** = 正文行宽 cap（`.cm-content`/`.preview-content`/`.editor-loading`/reading-view properties-panel）由写死 46em
改 `var(--readable-line-width, 46em)`，`setReadableLineLength(on)` 切 documentElement `--readable-line-width`（OFF=`none`=全宽）。
**Spellcheck** = EditorPane `useStore(spellcheckEnabled)` + effect 设 CM contentDOM `spellcheck` 属性（反应式 + view 重建跟随）。
**Zoom** = `app:zoom-in`(Mod+=)/`app:zoom-out`(Mod+-)/`app:zoom-reset`(Mod+0) → 既有 `workspace.setFontSize`（clamp + `--editor-font-size` var）。
SettingsModal AppearanceSection 2 toggle（镜像 autoUpdate switch）+ `applyAppearanceSettings()` boot 应用 + `__geodeAppearance` 探针 + i18n。
**零新依赖、无 Rust、低风险加性轮**（默认保持现状：readable ON / spellcheck OFF）。验证：typecheck 0 · `r50-e2e.mjs` **15/15** ·
桌面 `r50-probe.mjs` **6/6** · cargo release 真实重建 38s · 回归 r33/r24/r25/r49 不回退。**2 维对抗评审 2 finding → 1 确认（minor，去重）修**
（阅读视图 `.editor-preview > .properties-panel` 硬编码 46em 漏跟随 readable-line→改同源 var + 补 E2E 断言）。显式延期：行宽数值可调 / UI chrome 缩放 / spellcheck 默认 ON。

### R49 — v0.49（2026-06-14）文件恢复快照（File recovery snapshots）（R32+ 候选池第三梯队 #⑪ 另一半 → #⑪ 完成）
**数据安全相关轮。** `core/snapshots.ts`（NEW）：编辑恢复（R42 trash = 删除恢复的另一半）。存储 = 每 note 单 JSON
`.obsidian/snapshots/<encodeURIComponent(path)>.json` = `{path, snapshots:[{ts,content}]}`（复用 `vault.adapter.writeConfig`
建父目录 + **配置写不触发 tree 刷新**，镜像 bookmarks/workspaces 安静路径）。`file:modified` hook（throttle 60s）→ 串行 RMW
append + prune(MAX 25，数组 shift)。**写路径 STRICT-parse 拒覆盖坏 JSON**（读路径 readList 容错）。`restoreSnapshot` 先
`documents.flushAll()` → 读当前 → **force-快照当前** → `vault.modify` 写回（脏 buffer 未保存编辑无损）。`snapshotsRevision` Store。
RecoveryModal（浏览/预览/还原，sel 保留）+ `editor:file-recovery` 命令 + `ModalKind+="recovery"` + `__geodeSnapshots` 探针 + i18n。
**零新依赖、无 Rust。** 验证：typecheck 0 · `r49-e2e.mjs` **12/12** · 桌面 `r49-probe.mjs` **9/9**（**on-disk 数据安全终态**：
`.obsidian/snapshots/` 写入 + restore 写回 OLD + restore 前 CURRENT 被快照[never lost]）· cargo release 真实重建 37s · 回归
r24/r43/r27/r45/r47 不回退。**3 维对抗评审（数据安全重点）9 finding → 7 确认（2 major + 5 minor）逐条修 + 2 证伪**（① 坏 JSON→record
空 list 覆盖丢历史→写路径 STRICT-parse 拒覆盖 ② restore 前不 flush→脏 buffer 覆盖丢未保存编辑→flushAll ③ enqueue 静默吞错→guarded+warn
④ lastSnapTs 写失败毒化节流→绑成功置位 ⑤ vault 切换不清 lastSnapTs→clear ⑥ modal restore 无 .catch ⑦ revision bump 偷换 sel→保留）。
显式延期：周期定时器 / rename 迁移快照 key / 系统回收站[trash crate 待拍板] / 回收站 UI 面板 / 大库存储优化。

### R48 — v0.48（2026-06-14）可配置日记设置（Configurable daily notes）（R32+ 候选池第三梯队 #⑫ 另一半 → #⑫ 完成）
`core/dailyNote.ts` 可配置化：新增 `dailyNoteFolder`/`dailyNoteFormat`/`dailyNoteTemplate` Store + setter（localStorage，
镜像 `templateFolder`）。`dailyStamp = moment(date).format(effFormat)`；`parseDailyStamp` 改 **moment STRICT parse**
（`moment(basename, effFormat, true)`，**完整保留 R43 over-match 守卫**——r43-e2e/probe 实测不回退）；`isDailyNotePath` 用
effFolder 前缀。`openOrCreateDailyNote` 应用模板（`dailyNoteTemplate` 设置且文件存在 → `vault.read` + `expandTemplate`）。
SettingsModal AppearanceSection 加「Daily notes」3 字段（folder/format/template，镜像 template 字段）+ CalendarPanel
`useStore(folder/format)` 反应式 + `__geodeDaily` setFormat/setFolder 探针 + i18n。**零新依赖、无 Rust。** 验证：typecheck 0 ·
`r48-e2e.mjs` **13/13** · 桌面 `r48-probe.mjs` **9/9** · cargo release 真实重建 37s · 回归 r43-e2e 22 / r43-probe 13 / r23 22 /
r28 23 / r42 17 不回退。**3 维对抗评审 9 finding → 6 确认（1 major + 5 minor）→ 修 2 + 3 已知偏差 + 3 证伪**（修：① effFolder
只 trim 未 strip 斜杠→尾斜杠双斜杠路径→strip+validateDir ② `Vault.createFolder` 缺 assertSafeRelPath[R46 同根漏补]→加守卫；
延期 minor：无日粒度格式碰撞[校验+预览余项]、FS 非法字符 Windows 静默失败[sanitize 余项]、插件描述硬编码）。显式延期：月历周一起 /
格式校验预览 / format 子文件夹。

### R47 — v0.47（2026-06-14）笔记合并（Note composer merge）（R32+ 候选池第三梯队 #⑬ 另一半 → #⑬ 完成）
**数据安全关键轮。** `core/linkRewrite.ts` refactor：`doRenameWithLinkUpdate` → `doLinkUpdate(deps, old, new, move)` +
新增 `rewriteLinksForMerge`（`move:false`：跳过 `vault.rename` + remap=identity + 始终改写[忽略 autoUpdateLinks toggle]，
**复用同一 capture→verified splice→post-rewrite-reassert 引擎**，绝不重写断言）。`core/noteMerge.ts`（NEW）：`mergeNotes`
（① source===target/缺失→null ② flushAll[try/catch] ③ 读 live-buffer 优先[`documents.get()?.getText() ?? readFresh`]
④ modify target=追加 ⑤ ensureFresh ⑥ rewriteLinksForMerge ⑦ trash source[R42 可恢复]，**append-before-trash 无损**）+
`mergeTargetMode` 一次性 Store。QuickSwitcher merge 模式（useState 快照 + useEffect 清，StrictMode 安全；consume `result.skipped`
→ notice；`.catch` → notice）+ `editor:merge-file` 命令（switcher 已开则 no-op 防泄漏）+ `__geodeMerge` 探针 + i18n。
**零新依赖、无 Rust。** 验证：typecheck 0 · `r47-e2e.mjs` **11/11** · 桌面 `r47-probe.mjs` **7/7**（**on-disk 数据安全终态**：
target 含两者内容/source 入 `.trash` 内容保留/referrer 链改写无悬空）· cargo release 真实重建 37s · 回归 r28/r24/r44/r42-e2e
不回退（frozen 引擎不破）。**3 维对抗评审（数据安全 + frozen 引擎重点）12 finding → 4 确认（全 major）逐条修 + 8 证伪**
（① merge 丢弃 result.skipped→悬空链无告警→consume+notice ② 链无 .catch→静默失败→catch+notice ③ flushAll 失败读旧磁盘丢未保存编辑→live-buffer 读
④ merge-file 命令 switcher 已开泄漏 mergeTargetMode→守卫）。显式延期：merge 拆分 / 确认对话框 / extract 自动导航 / embed 命令。

### R46 — v0.46（2026-06-14）`obsidian://` URI 深链（零依赖 in-app 切片）（R32+ 候选池第三梯队 #⑮）
`core/obsidianUri.ts`（NEW，纯解析器）：`parseObsidianUri(uri)` → `open/new/search/unknown` 动作（`new URL` +
protocol 严判 + searchParams 百分号解码）。`features/editor/obsidianUriHandler.ts`：`handleObsidianUri(app, uri)`
执行——`open`（`resolveLink` gate **只开既有不建** + `openWikilink` 复用 `#heading`/`#^block` reveal）/`new`
（`vault.create` + `fileExists` 守卫）/`search`（`requestSearch`）。EditorPane anchor 点击 hook（`obsidian://` →
`preventDefault` + 路由 in-app，置于通用 preventDefault 前**强化** R19 SEC-1）。`__geodeUri` 探针。**core `Vault.create`
加 `assertSafeRelPath`**（拒空/绝对/`..`/控制符，双端 Memory+Tauri 一致，纵深防御下沉）。**🛑 OS 级 deep-link 延后**
（`tauri-plugin-deep-link` 新 crate = 硬边界#5，待用户拍板）。**零新依赖、无 Rust。** 验证：typecheck 0 ·
`r46-e2e.mjs` **18/18** · 桌面 `r46-probe.mjs` **9/9**（含 on-disk `obsidian://new` 建文件）· cargo release 真实重建 37s ·
回归 r44/r43/r28/r24/r25/r33/r45 不回退。**3 维对抗评审（安全重点）12 finding → 5 确认（全 minor）逐条修 + 7 证伪**
（安全攻击面**全证伪**：穿越被 safe_join、SEC-1 被强化、scheme 口径一致、search 管线硬化；修：① open 经 openWikilink 静默建笔记→resolveLink
gate ② Memory createFile 无路径守卫→core assertSafeRelPath ③ new 文件名控制符→同②守卫 ④ create 失败仍 openFile 幽灵 tab→fileExists 守卫
⑤ `??` 遮蔽空 file=→`||`）。显式延期：OS scheme 注册（待拍板）/ CM live preview 点击 hook / 跨库路由 / plugin protocol 接通。

### R45 — v0.45（2026-06-14）保存的工作区布局（Workspaces）（R32+ 候选池第三梯队 #⑭）
`core/workspaces.ts`（NEW，镜像 R27 bookmarks 持久化）：命名布局存到 `<vault>/.obsidian/workspaces.json`（裸
`"workspaces.json"`——readConfig/writeConfig 已相对 `.obsidian/` 解析）。串行 enqueue 队列 + vault-switch race guard
（adapter 身份）+ 非破坏性 RMW（`root={...parsed}` 保留 `active` 等 top-level key + Obsidian 原 entry）+ 拒写
malformed（`workspaces` 非对象）+ **空-store 守卫**（store 空但磁盘有 entry → 不覆盖，防 init 失败抹盘）+ enqueue
try/catch+warn。导出 `WORKSPACES_CONFIG`/`workspacesStore`/`initWorkspaces`/`listWorkspaceNames`/`getWorkspaceLayout`/
`saveWorkspaceLayout`/`deleteWorkspaceLayout`。`Workspace.captureLayout`（复用 persist 序列化，**去 theme/fontSize**——外观全局）+
`applyLayout`（`sanitizeState` 容错 + `closeMissingFileTabs` 剪缺失文件 + `pruneTabHistory`/`emitActiveFile` reconcile +
**保留当前外观**）。`features/workspaces/WorkspacesModal`（save-current/list/load/delete，`useStore(workspacesStore)` 反应式）+
`workspace:manage` 命令 + `__geodeWorkspaces` 探针 + i18n + `ModalKind += "workspaces"`。main.tsx 在 vault load/switch
接 `initWorkspaces`（镜像 bookmarks.init）。**零新依赖、无 Rust。** 验证：typecheck 0 · `r45-e2e.mjs` **10/10** · 桌面
`r45-probe.mjs` **6/6**（含 on-disk `.obsidian/workspaces.json` 验证 `probe-ws.root` pane 树）· cargo release 真实重建 37s ·
回归 r37/r39/r36/r43/r27-e2e 不回退。**3 维对抗评审 10 finding → 6 确认（1 major + 5 minor，含 1 doc）逐条修 + 4 证伪**
（① captureLayout 误存 theme/fontSize→delete + applyLayout 保留当前外观 ② applyLayout 不 emit active-file→pruneTabHistory+emitActiveFile
③ 同②session 历史 ④ enqueue 缺 try/catch+warn→拒写静默→补日志 ⑤ init 失败+persist 成功抹盘→空-store 守卫 ⑥ 契约字面量回写；
**证伪**：applyLayout 不 flush[EditorPane unmount 已 flush，与既有 closeTab 同前置]）。显式延期：Obsidian schema 桥接 / 切换快捷键 / `active` 跟随。

### R44 — v0.44（2026-06-14）Note composer：提取选区 → 新笔记（R32+ 候选池第三梯队 #⑬ extract 切片）
`core/noteComposer.ts`（NEW，纯函数）：`sanitizeNoteName`（一个字符类同守文件名+wikilink:剥控制符 `\p{Cc}`
+ `[]#^|/\:*?"<>` + 折叠空白 + 去首尾点 + UTF-8 边界裁 ≤200 字节;空/全点→Untitled）/`deriveNoteName`（首非空行,
ATX 标题取其文字）/`extractedContent`（选区逐字,尾换行规整）/`extractReplacement`（`[[name]]` | `![[name]]`）。
`features/editor/noteComposerCommands.ts`（NEW）：`editor:extract-selection`（无默认键）——选区→建新笔记
（同目录 `uniquePath` 碰撞后缀）→替换为 `[[link]]`。**数据安全不变式 = create-before-edit**（先持久化目标再删源,
create 失败则源不动零丢失）+ **await 后乐观锁守卫**（防 IPC 窗口内并发改动致旧 offset 错删）。App.tsx 注册 +
`__geodeComposer` 探针 + i18n `cmd.extractSelection`。**合并 merge 延后**（= #⑬ 另一半,需 link-rewrite-only 变体）。
**零新依赖、无 Rust。** 验证：typecheck 0 · `r44-e2e.mjs` **25/25** · 桌面 `r44-probe.mjs` **17/17** · cargo release 真实
重建 37s · 回归 r40/r43/r33-e2e + r42-probe 不回退。**3 维对抗评审 13 finding → 5 确认（2 major + 3 minor,去重）逐条修
+ 8 by-design/证伪**（① async create 后旧 offset dispatch 错删/RangeError→乐观锁文本指纹守卫 ② sanitizeNoteName
`". ."`塌成`"."`→坏名→去首尾点 ③ C0 控制符泄漏→`\p{Cc}` ④ 名无长度上限→ENAMETOOLONG→≤200 字节裁 ⑤ 纯空白选区建空笔记→trim 守卫）。
显式延期：合并 merge / extract 自动导航 / embed 命令 / 链接 basename 歧义（Obsidian 同款）。

### R43 — v0.43（2026-06-14）日记日历 + 前/后一日导航（R32+ 候选池第三梯队 #⑫ 日历切片）
`core/dailyNote.ts`（NEW，纯函数 + 1 app-helper）：`dailyStamp`/`dailyNotePath`/`parseDailyStamp`
（basename 锚定 `^YYYY-MM-DD(?:.md)?$`）/`isDailyNotePath`（DAILY_FOLDER 前缀门控）/`addDays`/`sameDay`/
`monthGrid`（6×7 周日起含邻月填充）/`openOrCreateDailyNote`（不存在则建再 open，竞态下文件已存在仍 open）。
`features/calendar/CalendarPanel`（右栏自绘月历：today 高亮、有笔记标记、点击开/建当日笔记、上/下月+今天
导航、月名/星期走 i18n `locale` Store）+ App.tsx 右 ribbon `calendar` tab + icons `calendar`。daily-note
插件 refactor + `next-day`/`prev-day`（无默认键，`isDailyNotePath` 门控基准日）。`__geodedaily` 探针。
**评审顺手修数据安全**：`vault_create` 桌面端 `exists()`-then-`fs::write` TOCTOU 截断窗口（R17 为
`write_binary` 修过的同一根因，独漏此命令；日历把它摆上热路径）→ 改 `create_new` 原子 + rollback。
**零新依赖。** 验证：typecheck 0 · `r43-e2e.mjs` **22/22** · 桌面 `r43-probe.mjs` **13/13**（真实 WKWebView
纯 helpers）· cargo release 真实重建 37s · 回归 r42-probe 10 + r41-e2e 21 不回退。**3 维对抗评审 9 finding
→ 8 确认（全 minor）逐条修 + 1 证伪**（parseDailyStamp 整 path over-match→basename 锚定 / 子文件夹日记
导航逃逸→isDailyNotePath 双门控 / vault_create TOCTOU→create_new / create 失败竞态仍 open / locale 走
Store / aria t() / monthLabel memo）。显式延期：可配置日记设置 UI（格式/文件夹/模板）= #⑫ 另一半；月历周一起；
create 真失败仅 console.error（core 无 toast infra）。

### R35 — v0.35（2026-06-13）括号/引号自动配对 + 选区包裹（R32+ 候选池 #④）

**实测缺口收口**：敲 `[` 得 `[` 不补 `]`，源码无 closeBrackets。本轮按 Obsidian 两设定分两层接通：
**Layer 1（括号/引号）= CM `closeBrackets()` 内置**——对 `( [ { " '`（CM 默认集 = Obsidian「Auto pair
brackets」）提供空选区自动配对、选区包裹、type-over、Backspace 删空配对；引号有 CM 自带的 quote-before-word
守卫（contraction 安全：`don't` 不配对、行首 `'`→`''`）。**Layer 2（markdown 强调符选区包裹）=
`core/bracketWrap.ts` 纯函数 `markdownWrapInput`**——对 `* _ \` ~ = $` 仅**非空选区**触发包裹、保留内层选区
→ additive（`*sel*`→`**sel**`，连按累积 `** ~~ == $$`）；空选区透传单字符（刻意偏离 Obsidian 空配对，避让
行首列表项 / 围栏 / CJK）。接线 `cmExtensions`：`markdownWrapHandler`（`Prec.high` inputHandler）+
`closeBrackets()` + `keymap.of(closeBracketsKeymap)`（放 defaultKeymap 之上，Backspace 删配对优先）+
`__geodeBrackets` 探针（main.tsx，loadExternal 前）。**零新 vault 写路径**（配对/包裹走普通 CM 事务→autosave，
B 类守卫全继承）+ **零新运行时依赖**（`@codemirror/autocomplete` 已在）+ **零 i18n**（纯键入行为）。
**最高风险点 = closeBrackets 的 `[` 配对与 wikilink `]]` 补全协同**：靠 wikilink source 既有 `sliceDoc(to,
to+2)==="]]"` 守卫零冲突（敲 `[[`→`[[]]`、补全 accept→单 `]]`、字面 `[[Note]]` round-trip——type-over
吸收手敲闭合括号，**这正是 r23–r34 既有 `[[` 键入断言零回退的原因**，未改 wikilink 源一字）。**对抗评审 5 维
9 agent → 5 finding → 0 确认 / 5 证伪**（2 个「未测但行为正确」观察硬化成 E2E 断言：apostrophe contraction +
line-start 引号；2 记已知限制：空选区强调符不配对 = 刻意偏离 / closeBrackets 不按代码块上下文门控 = 保真 gap；
1 证伪 = wikilink 光标 `+2` 在 `]]` 已存时正确）。验证：浏览器 `r35-e2e` **25/25** + 桌面 release
`r35-probe` **9/9**（探针 present + 纯 wrap 决策在真 WKWebView 正确 + 启动 error-free）+ r23–r34 全套不回退
（r33 37 / r32 24 / r31 21 / r25 17 / r24 12 / r23 22）+ `r26-bytes` 0 违例 + typecheck/cargo/build 绿。
**桌面探针首次能驱动配对相关真值**（pure fn，无需 live view；不同于 R34 search 必须 live view → 只能验
present+error-free）。

### R34 — v0.34（2026-06-13）编辑器内查找 / 替换（R32+ 候选池 #③）

**实测缺口收口**：`@codemirror/search` 仅 compat loader 引入、features/editor 未接，文内无查找面板。
本轮接通 CM 原生 search：`features/editor/searchCommands.ts`（`registerSearchCommands` 注册
**editor:search（Mod+F）** + **editor:replace（无默认键）** + `editorSearchPhrases()` 17 个 CM phrase
本地化 + `installSearchProbe` `__geodeSearch` 探针）+ `cmExtensions` 加 `search({top:true})` +
`keymap.of(searchKeymap)` + `EditorState.phrases.of(...)` + editorTheme `.cm-search`/`.cm-searchMatch`
主题（纯 CSS 变量，字号走 `--editor-font-size`）。i18n：`cmd.searchFile`/`cmd.replaceFile`（dict.app.ts）
+ 17 `editor.search.*`（dict.views.ts）。**开命令走 app 命令层**：R33 `Prec.highest` 拦截器先处理
Mod+F → searchKeymap 自身 Mod-f 无害遮蔽（不双开）；searchKeymap 仅供面板内键（Enter/Shift-Enter/
Escape/F3/Mod-d）。与左栏全库 SearchPanel 互不影响（两套）。**editor:replace 无默认键 = 刻意取舍**
（macOS Cmd+H=隐藏 App、浏览器=历史，绑它跨端不安全；替换仍可经 Cmd+F 面板的 replace 行 + 命令面板
到达）。**替换=写路径但零新 vault 写**（CM 事务→autosave，命令 + 探针双双活动文件门控 R23 DS-1；
autosave 落盘实测）。**对抗评审 5 维 9 verdict → 7 确认 → 3 根因修复 + 3 记已知限制**：修复 ①
`installSearchProbe` 裸用 `getActiveView()` → 加活动文件门控（探针是生产全局、防写错文件）；② 探针
replaceAll 空查询 CM 会 fall through 到 openSearchPanel → 加 `search===""` no-op 守卫；③ 面板字号
硬编码 13px → 走 `var(--editor-font-size)`。已知限制（CM 上游行为/设计取舍，非缺陷）：① IME 合成期
CM 面板 input 的 keydown 自走 runScopeHandlers 不查 isComposing（find-Enter 只读无害、replace 窄边）；
② Mod+G 被 `app:open-graph` 占用 → CM findNext 遮蔽（findNext 走 Enter/F3/next 按钮）；③ 选区 >100
字符不预填查找框（CM `defaultQuery` 上限；≤100 字符会预填）。**最重要 As-built 结论：功能依赖 live CM
view 时桌面探针无法驱动**——后台 WKWebView 不绘制 → React effect 不执行 → EditorPane view 与命令注册
effect 都不挂载（foreground 也无效），故 R34 桌面探针只验「探针嵌入真二进制 present+全 api + error-free」，
功能真值交浏览器 E2E（详见 ARCHITECTURE R34 节 + data-safety §D）。验证：浏览器 `r34-e2e` **15/15**
（8 probe 含 autosave 落盘 + 7 live 含真键入高亮 `.cm-searchMatch`×3）+ 桌面 release `r34-probe` **3/3**
+ r23–r33 全套不回退（r33 37/probe12 / r32 24 / r31 21 / r25 17 / r24 12 / r23 22）+ `r26-bytes` 0
违例（markdown.ts 未动）+ typecheck/cargo/build 绿。

### R33 — v0.33（2026-06-13）Markdown 格式化命令 + 快捷键（R32+ 候选池 #②）

**实测缺口收口**：选区按 Cmd/Ctrl-B 不加粗、源码无任何 toggle 命令、markdownKeymap 不含格式化键。
本轮镜像 Obsidian 编辑器命令：13 个格式化命令（仅 **Cmd/Ctrl-B 粗 / -I 斜 / -K 链接** 有默认键、
余 10 个无默认键可绑——与 Obsidian 一致）。官方校准 obsidian.md（`*`/`**` 星号记法、Cmd-K=
`[text]()`）。改动：① **`core/format.ts`**（**纯变换放 core = R28 教训：让 `main.tsx` 探针 import
不引入 bootstrap→feature 耦合**）——`applyFormatOp(op,text,from,to): FormatEdit|null` 唯一入口
（命令层 + 探针共用单一真值）；`toggleWrap`（bold/italic/strike/highlight/inline-code，**幂等
toggle + 强调符歧义守卫** `*`≠`**`≠`***`）、`insertLink`（空/URL/文本三态光标）、`toggleList`
（bullet/numbered/checklist 互斥替换）、`toggleBlockquote`/`toggleHeading`（none→H1..H6→none 循环）/
`toggleCodeBlock`/`toggleCallout`。② **`features/editor/formatCommands.ts`**——`applyFormat(view,op)`
读 doc+selection→ 一次原子 CM 事务；`registerFormatCommands(app,getView)` 注册 13 命令，
`available=getView()!==null`、`getView` 由 App 注入 `getActiveFileEditorView(app)?.view`（**活动文件
双侧门控 = R23 DS-1，焦点/活动分叉 fail-safe 不写**）。③ **`cmExtensions.ts`**——新增 `Prec.highest`
CM keydown 拦截器路由 `app.commands.handleKeydown`（**头号根因修复，见下**）。④ `dict.app.ts` 13 个
`cmd.*`（en+zh）；⑤ `main.tsx` `__geodeFormat` 探针（loadExternal 前）。**头号根因**：原生
contenteditable 的 **Cmd+I 会先把选区扩成整行**（Cmd+B 没事 Cmd+I 出错），命令层在 window 冒泡读到
被扩选区 → 把整行斜体；`commands.execute` 直接调却正确 → 锁定是键盘投递（capture 阶段选区仍对、
window 冒泡时已扩）→ 修复 = 把热键路由提到 CM 最高优先级、在原生动作之前处理真选区，命中即
preventDefault+stopPropagation 防 window 双触发。**对抗评审 5 维 18 verdict → 13 确认/部分 → 去重
4 根因修复**：① `lineBounds` 对 doc=`"\n"`+全选 `start>end` → code-block/callout 建 `from>to` 抛
RangeError（加 `end<start→end=start` 守不变量）；② **IME `isComposing` 守卫**（CJK 合成期不误触
命令，zh 用户高频）；③ **`defaultPrevented` 守卫**（防 CM 延迟派发次序双触发）；④ `toggleHeading`
无空格 `#Heading` 产出 `# #Heading`（strip 正则改空格可选 `/^#{1,6} ?/` → 干净 `# Heading`）。其余
证伪：insertLink 光标 off-by-one（评审误数、e2e 实证 selFrom=8 正确）、分屏 undo（与打字同 dispatch
路径无新风险）、多行加粗/选区端点（镜像 Obsidian 非缺陷）。**零新 vault 写路径**（CM 事务→autosave，
B 类写守卫全继承，autosave→`vault.read` 落盘实测）。验证：浏览器 `r33-e2e` **37/37**（26 纯函数
probe + 9 live：Cmd+B/I 包裹+往返、Cmd+K 建链、注册/available + 2 评审修复边界）+ 桌面 release
`r33-probe` **12/12** 真实 WKWebView runtime + r23–r32 全套不回退（r32 24/probe16 / r31 21 / r25 17 /
r24 12 / r23 22）+ `r26-bytes` 0 违例（markdown.ts 未动）+ typecheck/cargo/build 绿。**显式取舍**：
toggle-heading = 循环（none→H1..H6→none）而非二态 toggle（一键更实用，记偏差）；callout/code-block
wrap 后选中整块（非光标定位，可后续打磨）；10 个非 B/I/K 命令无默认键（镜像 Obsidian，用户自绑）。

### R32 — v0.32（2026-06-13）macOS Cmd（Mod）修饰键支持（R32+ 候选池 #① = **头号缺口**）

**实测头号缺口收口**：迁移前 Ctrl+P 开命令面板、**Cmd+P 无反应**——`core/commands.ts` 三处
`if(e.metaKey) return false` 写死拒 Meta、`Mod` collapse 成 `Ctrl`。本轮镜像 Obsidian 热键
语法：**`Mod` 升一等修饰符**（mac→⌘/metaKey、Win/Linux→Ctrl/ctrlKey），`Ctrl` 永远物理
Control，`Meta` 永远 ⌘/Win。官方校准（obsidian.md help "Hotkeys"，2026-06-13 复核）。
**纯键路由，零 vault 写**（data-safety §B/§C 不适用；唯一持久化 = 既有 `geode.hotkeyOverrides`
localStorage，形状不变）。改动：① `core/commands.ts` `detectMacPlatform`/`isMacPlatform` +
`normalizeHotkey`（Mod≠Ctrl 各保留、新序 Mod→Ctrl→Meta→Alt→Shift）+ `parseHotkey`（导出，
`wantMod/wantCtrl/wantMeta`）+ `matchParsedHotkey(p,e,isMac)`（**四态全等比对**，故 mac 下
`Ctrl+P` 不触发 `Mod+P` 绑定）+ `matchHotkey`/`hotkeyFromEvent`（删 metaKey 拒绝、主修饰符录成
可移植 `Mod`）+ 新 `formatHotkey`（mac→Apple 字形 ⌃⌥⇧⌘、非 mac→`Ctrl+`）+ `KeyEventLike`
结构类型；② `app/App.tsx` 13 + `plugins/daily-note.ts` 1 默认键 `Ctrl+…`→`Mod+…`（无一为
`Mod+C/V/X/A/Z` → 编辑器剪贴板/全选/撤销不被命令层吞）；③ `CommandPalette`/`SettingsModal`
显示走 `formatHotkey` + 设置页 capture 文案按平台呈现 `⌘`/`⌥`；④ `main.tsx` `__geodeHotkey`
探针（`match`/`format` 显式收 `isMac` → 单二进制双平台分支确定性自检）。**对抗评审 8 维功能正确性
全部证伪为非问题**（四态匹配 / 编辑器 Cmd 剪贴板不撞 / 可编辑守卫 / 捕获 / 冲突检测 / 字形 /
分层 / 结构类型），仅 2 项收口：版本三处对齐 + daily-note JSDoc 陈旧注释。验证：浏览器
`r32-e2e` **24/24**（20 grammar 双分支 probe + 4 live：**Cmd+P 开面板 / Ctrl+P 不开（镜像
Obsidian）/ 面板 ⌘ 字形 / Cmd+, 开设置**）+ 桌面 release **probe 16/16** 真实 WKWebView runtime
（isMac=true 实测 + 双平台分支）+ r23–r31 全套不回退（22/12/17/12/22/23/19/25/21）+ r30/r31
desktop probe 10/10 + `r26-bytes` 0 违例（markdown.ts 未动）+ typecheck/cargo/build 绿。
**显式取舍**：mac 下 Ctrl+P 不再开面板（Obsidian 同此=修复非回退）；非 mac `Mod` 与 `Ctrl`
同映 ctrlKey、canonical 不同 → 冲突检测不互判（与 Obsidian 存储模型一致，显式小偏差）；compat
插件热键路径（外部插件 `Keymap`/`Scope`）本轮不动（另一套、自包含，按需后续）。

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

### R32+ 候选池（Obsidian 原生功能补课 · 第四梯队 · 键盘/编辑交互优先，2026-06-13 全景调研登记）

> 背景：R31 末 R25+ 候选池清空后，与用户重新「全面盘点 Geode 距离 Obsidian 的原生差距」。
> 本轮（2026-06-13）= **纯调研/规划轮，零代码**：4 并行 explorer 全量盘点 editor / live 渲染 /
> 键盘命令 / feature 表面 + WebFetch 官方 obsidian.md 校准 + **dev :1420 浏览器实测 6 项核心交互**
> （详见 OBSIDIAN-COMPAT「原生功能差距全景调研」）。下表「当前状态」均经代码核实，标注「实测」者
> 经 dev server 运行时实测。执行口径沿用 R25+：逐项按序自主推进，验收 = 四条底线 + 官方校准 +
> 双端 probe 不回退。用户关注重点 = **标题修改 / 实时解译 / 快捷键输入**等具体交互行为，故按
> 「键盘/编辑交互」优先排序。

**实测纠偏（写给后续轮，避免重复发现假缺口）**：列表续行（Enter 续 `- `、`1.`→`2.` 自动重编号）、
Tab/Shift-Tab 列表缩进、空列表项 Backspace 出列 **均已工作**——来自 `@codemirror/lang-markdown`
的 `markdown()` 内置 `markdownKeymap`（`cmExtensions.ts:314` 注释明示「markdown keymap … stay」），
**非缺口**。静态 grep `insertNewlineContinueMarkup` 查不到，是因它打包在 `markdown().support` 内
（dev :1420 实测 `- item`+Enter→`- item\n- `、`1. a`+Enter→`1. a\n2. ` 证实）。

#### 第一梯队 — 键盘 / 编辑器交互（日常高频，多为低成本接线；用户重点）

| 功能 | 当前状态（已核实）| 范围与切入点提示 |
|---|---|---|
| ~~**① macOS Cmd（Mod）修饰键支持**~~ | **R32 已完成（v0.32，见上）**——`core/commands.ts` `isMacPlatform` + `Mod` 升一等修饰符（mac→⌘/metaKey、其余→Ctrl/ctrlKey）+ `matchParsedHotkey(p,e,isMac)` 四态全等 + `formatHotkey`（⌃⌥⇧⌘ / `Ctrl+`）+ 默认键 `Ctrl+…`→`Mod+…` + `__geodeHotkey` 双平台探针。验证 r32-e2e 24/24（含 live Cmd+P 开面板）+ desktop probe 16/16 真实 runtime。 | 显式延期：compat 外部插件 `Keymap`/`Scope` 热键路径（另一套、自包含）；非 mac `Mod`/`Ctrl` 同 ctrlKey 但 canonical 不同 → 冲突检测不互判（与 Obsidian 一致）。 |
| ~~**② Markdown 格式化命令 + 快捷键**~~ | **R33 已完成（v0.33，见上）**——`core/format.ts` `applyFormatOp` 唯一入口（13 op：bold/italic/strike/highlight/inline-code 幂等包裹 + 强调符歧义守卫、link、heading 循环、blockquote/bullet/numbered/checklist/code-block/callout 行变换）+ `features/editor/formatCommands.ts` CM dispatch + 注册 13 命令（仅 Mod+B/I/K 默认键）+ `cmExtensions` `Prec.highest` keydown 拦截器（修原生 Cmd+I 扩选区）+ handleKeydown isComposing/defaultPrevented 守卫 + `__geodeFormat` 探针。验证 r33-e2e 37/37 + desktop probe 12/12 真实 runtime。 | 余项（按需求驱动）：toggle-heading 循环 vs 二态（选了循环）；callout/code-block wrap 后选整块非光标定位；选中文本敲 `[`/`*` 包裹（属 ④ closeBrackets）；多光标包裹；非 B/I/K 命令默认无键（用户自绑）。 |
| ~~**③ 编辑器内查找 / 替换（Cmd/Ctrl-F、Cmd-H）**~~ | **R34 已完成（v0.34，见上）**——`features/editor/searchCommands.ts`（editor:search Mod+F + editor:replace 无默认键 + `editorSearchPhrases()` 17 phrase 本地化 + `__geodeSearch` 探针）+ `cmExtensions` `search({top})`+`searchKeymap`+`EditorState.phrases`+`.cm-search` 主题。开命令走 app 命令层（R33 拦截器先处理）。验证 r34-e2e 15/15（含 autosave 落盘 + 真键入高亮）+ desktop probe 3/3（present+api+error-free）。 | 余项（按需求驱动）：editor:replace 默认键（避 Cmd+H）；IME 合成面板 input（CM 上游）；Mod+G 与 open-graph（findNext 走 Enter/F3）；选区>100 字符预填；查找历史/正则默认；与全库搜索联动。 |
| ~~**④ 括号/引号自动配对 + 选区包裹**~~ | **R35 已完成（v0.35，见上）**——Layer 1 = CM `closeBrackets()`（`( [ { " '` 自动配对+选区包裹+type-over+Backspace 删配对，引号 quote-before-word 守卫）；Layer 2 = `core/bracketWrap.ts` 纯函数 `markdownWrapInput`（`* _ \` ~ = $` 仅非空选区 additive 包裹）；接 `cmExtensions`（`markdownWrapHandler` Prec.high + `closeBrackets()` + `closeBracketsKeymap`）+ `__geodeBrackets` 探针。`[` 配对与 wikilink `]]` 补全靠 `sliceDoc` 守卫零冲突（未改 wikilink 源）。验证 r35-e2e 25/25 + desktop probe 9/9（纯 wrap 决策可在真 WKWebView 驱动）。 | 余项（按需求驱动）：空选区 markdown 强调符配对（刻意偏离，避让列表/围栏/CJK）；closeBrackets 按代码块/数学上下文门控（Obsidian 部分上下文禁配对）；设置开关暴露；多光标包裹。 |
| ~~**⑤ 标签页快捷键**~~ | **R36 已完成（v0.36，见上）**——`core/workspace.ts` 4 纯 store 方法（`cycleActiveTab`/`activateTabAt`/`activateLastTab`/`reopenClosedTab`）+ `recentlyClosed` 栈（cap 20 / session-only / 只 closeTab 入栈 / delete·rename·missing 三处反应式 purge·remap / **vault 切换 reason "load" 清空**）+ App.tsx 13 命令（next/prev-tab=**字面 `Ctrl+Tab`/`Ctrl+Shift+Tab`**、go-to-tab-1..8=`Mod+1..8`、last=`Mod+9`、new-tab=`Mod+T`、reopen=`Mod+Shift+T`）；导航限活动 pane。零新 vault 写路径 / 零新依赖 / 零新探针。r36-e2e 47/47 + r36-probe 18/18。 | 余项（按需求驱动）：TabBar「+」按钮 repoint 到 app:new-tab（现仍调 new-note 替换活动 tab）；new-tab 急切建 Untitled.md（Obsidian 开空白 tab）；recentlyClosed 跨重启持久化；导航跨 pane（现限活动 pane）；go-to-tab 命令面板噪音（8 条）。 |

#### 第二梯队 — 导航 / 工作区结构

| 功能 | 当前状态（已核实）| 范围与切入点提示 |
|---|---|---|
| ~~**⑥ 前进/后退导航历史**~~ | **R37 已完成（v0.37，见上）**——`core/workspace.ts` per-tab `tabHistory` Map（session-only、cap 50）+ `recordNavigation`（hook openFile replace 分支、清 forward）+ `navigateBack/Forward`+`canTabNavigateBack/Forward`+`setTabLocation` + 5 处清理（close/delete/rename/missing/vault-switch）；App.tsx `app:navigate-back/forward`（`Mod+Alt+←/→`，focus-pane 让出默认键）+ TabBar 箭头按钮（反应式靠 useStore，无独立 Store）+ icons.tsx arrow-left/right。与 R36 recentlyClosed 两套独立栈。r37-e2e 36/36 + r37-probe 18/18。 | 余项（按需求驱动）：导航历史跨重启持久化；**split 复制 tab 时历史不随之复制**（已知偏差）；back/forward 限单 tab；导航到删除文件从历史 purge（已做）。 |
| ~~**⑦ 快速切换器子模式 / 文内标题跳转**~~ | **R38 已完成（v0.38，见上）**——`core/switcherSearch.ts` 纯函数（`switcherMode`/`stripSigil`/`searchHeadings`/`searchBlocks`，复用 `metadata.getAll()` + `core/fuzzy`，空 query browse=活动文件优先、非空=fuzzy 打分）+ QuickSwitcher.tsx `#`全库标题/`^`全库块 模式（render hash 图标 + fuzzy 高亮，activate `openFile`+`requestReveal` 跳转）+ `__geodeSwitcher` 探针。r38-e2e 19/19 + r38-probe 13/13。 | 余项（按需求驱动）：`^` 块模式无文本预览（BlockRef 仅 id）；非空搜索不 boost 活动文件（合契约，QS++ 有小加权）；symbol/`@` 模式；同分跨文件非确定序（getAll 既有属性）。 |
| **⑧ 固定标签页 + 堆叠标签 + 链接面板** | **部分**（pinned 切片 **R39 已完成（v0.39，见上）**：`TabState.pinned` + openFile 固定 tab 不替换强制新 tab + recordNavigation skip + `toggleTabPin` + 双击/命令切换 + pin 图标 + split 剔除/reopen 恢复 pin + 持久化；r39-e2e 17/17 + r39-probe 8/8）；**stacked tabs（标签堆叠）+ linked view（local graph/backlinks/outline 跟随某 tab）仍缺** | ⚠️ **R53 探明 scope**：真 Obsidian stacked tabs = **内容级横向 cascade**（同时挂载所有 tab 的窗格、横向滚动），而 Geode 当前 `PaneLeafView` 只渲染 active tab 内容（App.tsx:1142）→ 忠实实现需同时挂载多个 EditorPane = **大改 + 多编辑器 data-safety 重，需专门大轮**（非一轮加性）。仅加 `PaneLeaf.stacked` + 竖排 tab 条是 minimal 但不忠实。linked view = 右侧栏面板加 `linkedLeafId` + UI 控件 + 读 linked leaf 活动文件（中等、散，动 3+ 面板）。两者均非「零依赖小加性轮」，建议作专门轮（或与用户确认 scope）。 |
| ~~**⑨ 键盘切换复选框**~~ | **R40 已完成（v0.40，见上）**——整套复用 R33 format 基建：`core/format.ts` 加纯 op `toggle-task` + `toggleTaskStatus`（任务行翻转勾选含自定义态 `[/]`/`[-]` 就地翻转、非任务行转 `- [ ]`、空行/缩进规则）→ 经 `applyFormatOp` 接通 → `__geodeFormat` 探针自动可驱动；`editor:toggle-checkbox`（`Mod+L`）走既有 applyFormat→CM 事务→autosave。r40-e2e 19/19 + r40-probe 11/11。 | 余项（按需求驱动）：`]` 后无空格的 `- [ ]task` 可 toggle 但渲染层不显示（三处「任务」定义未收敛）；blockquote 内任务不识别；全空多行 select-all 塌缩（极端边角）。 |

#### 第三梯队 — 整块缺失功能

| 功能 | 当前状态（已核实）| 范围与切入点提示 |
|---|---|---|
| ~~**⑩ 标签面板 + 编辑器 `#` 标签补全**~~ | **R41 已完成（v0.41，见上）**——`features/tags/TagsPanel`（右栏，`useStore(metadata.revision)`，getTagMap 计数降序，点击 `workspace.requestSearch("#"+tag)`）+ `features/editor/tagCompletion.ts`（`#` 补全源镜像 slashCommands，gate `(^|[\s(])`，`__geodeTag` 探针）+ cmExtensions override 三源 + 新增 `searchRequest` consume-once Store。getTagMap 加 revision 缓存、frontmatter 退化标签索引层过滤。r41-e2e 21/21 + r41-probe 11/11。 | 余项（按需求驱动）：标签计数=文件数非出现数；CJK 仅 BMP 表意（三正则同步）；code 内仍弹补全（三源共有）；标签重命名/层级折叠；面板搜索框过滤。 |
| **⑪ 回收站 + 文件恢复快照** | **部分 / 数据安全**（本地 `.trash/` 回收站 **R42 已完成（v0.42，见上）**：Rust `vault_trash`/`vault_list_trash`[仅 std::fs 无新 crate] + vault.ts adapter.trash/listTrash[含 binaryFiles] + Vault.trash/listTrash/restoreFromTrash[restore emit file:renamed 重索引文件夹子项] + Explorer trash 前 flushAll 无损 + compat trash 接通 + `.trash` 自动隐藏。**修永久删=丢数据底线**。r42-e2e 17/17 + r42-probe 10/10[真 fs 验证]。**文件恢复快照 R49 已完成（v0.49，见上）**：`core/snapshots.ts`（每 note 单 JSON `.obsidian/snapshots/<encodeURIComponent(path)>.json`，file:modified hook throttle + RMW append + prune 25 + 串行队列；**写路径 STRICT-parse 拒覆盖坏 JSON**；restore **先 flushAll 再 force-快照当前再写回**=无损）+ RecoveryModal（浏览/预览/还原）+ `editor:file-recovery` 命令 + `__geodeSnapshots` 探针。**零新依赖、无 Rust**（复用 `vault.adapter.writeConfig`，配置写不触发 tree 刷新）。r49-e2e 12/12 + r49-probe 9/9[on-disk]。**#⑪ 整体完成**）| 余项（按需）：系统回收站（需 `trash` crate=新依赖，待拍板）；回收站 UI 面板（listTrash/restoreFromTrash 已就绪）；快照周期定时器（现仅 on-save）；rename 时迁移快照 key；大库快照存储优化。 |
| **⑫ 日记日历 + 可配置日记** | **部分**（日历+前后日导航 **R43 已完成（v0.43，见上）**：`core/dailyNote.ts`[dailyStamp/dailyNotePath/parseDailyStamp(basename 锚定)/isDailyNotePath/addDays/sameDay/monthGrid/openOrCreateDailyNote] + `features/calendar/CalendarPanel`[右栏自绘月历,today 高亮/有笔记标记/点击开建/月导航/locale-aware 标签] + daily-note 插件 `next-day`/`prev-day`[isDailyNotePath 门控基准] + `__geodeDaily` 探针。**评审顺手硬化 `vault_create` TOCTOU**[create_new 原子,补 R17 漏网命令]。r43-e2e 22/22 + r43-probe 13/13。**可配置设置 UI R48 已完成（v0.48，见上）**：`core/dailyNote.ts` 加 `dailyNoteFolder`/`dailyNoteFormat`/`dailyNoteTemplate` Store + setter（localStorage，镜像 templateFolder）+ dailyStamp/path/parse/isDailyNotePath 读设置（moment strict parse 保 R43 over-match 守卫）+ openOrCreate 应用模板（expandTemplate）+ SettingsModal daily-notes 3 字段 + Calendar 反应式 + `__geodeDaily` setFormat/setFolder 探针。r48-e2e 13/13 + r48-probe 9/9。**#⑫ 整体完成**）| 余项（按需）：月历周一起可配；无日粒度/非法字符格式校验+样例预览（misconfiguration 兜底）；format 含 "/" 子文件夹支持。 |
| **⑬ 笔记合并/拆分（Note composer）** | **部分**（提取选区→新笔记+替换为链接 **R44 已完成（v0.44，见上）**：`core/noteComposer.ts`[sanitizeNoteName 守文件名+wikilink+控制符+首尾点+≤200 字节 / deriveNoteName 首标题或首行 / extractedContent / extractReplacement link\|embed] + `features/editor/noteComposerCommands.ts`[`editor:extract-selection`,**create-before-edit** 无损 + await 后乐观锁守卫防错删 + uniquePath 碰撞] + App 注册 + `__geodeComposer` 探针 + i18n。r44-e2e 25/25 + r44-probe 17/17。**合并 merge R47 已完成（v0.47，见上）**：`linkRewrite.ts` 加 `{move}` 选项 + `rewriteLinksForMerge`（复用 R16 verified rewrite，不移动文件）+ `core/noteMerge.ts` `mergeNotes`（flush→append→ensureFresh→rewrite→trash，append-before-trash 无损 + live-buffer 读防 flush 失败丢编辑）+ `mergeTargetMode` 一次性 Store + QuickSwitcher merge 模式 + `editor:merge-file` 命令 + `__geodeMerge` 探针。r47-e2e 11/11 + r47-probe 7/7[on-disk]。**#⑬ 整体完成**）| 余项（按需）：extract 自动导航到新笔记；embed 模式命令（core 已支持）；merge 拆分（split current file，Obsidian 无独立命令）；merge 确认对话框。 |
| **⑭ 保存的工作区布局（Workspaces）** | **R45 已完成（v0.45，见上）**：`core/workspaces.ts`（命名持久化到 `.obsidian/workspaces.json`[裸 "workspaces.json"]，镜像 bookmarks 串行 RMW + vault-switch race guard + 保留 Obsidian 原 entry/top-level key + 空-store 守卫不抹盘）+ `Workspace.captureLayout`（复用 persist 序列化，去 theme/fontSize 外观）/`applyLayout`（sanitizeState 容错 + closeMissingFileTabs 剪缺失 + pruneTabHistory/emitActiveFile reconcile + 保留当前外观）+ `WorkspacesModal`（save-current/list/load/delete，`useStore(workspacesStore)` 反应式）+ `workspace:manage` 命令 + `__geodeWorkspaces` 探针。r45-e2e 10/10 + r45-probe 6/6（on-disk）。 | 余项：**Obsidian 工作区 schema 桥接**（当前 path-compatible/schema-divergent，Geode 载 Obsidian entry 回落默认）；切换 UI 加快捷键；workspace.json 的 `active` 跟随。 |
| **⑮ `obsidian://` URI / 深链** | **部分**（in-app 切片 **R46 已完成（v0.46，见上）**：`core/obsidianUri.ts` 纯解析器[parseObsidianUri → open/new/search/unknown] + `features/editor/obsidianUriHandler.ts`[handleObsidianUri 执行:open→resolveLink gate+openWikilink reveal、new→vault.create、search→requestSearch] + EditorPane 笔记内 obsidian:// 链接点击路由 + `__geodeUri` 探针 + core `Vault.create` 加 `assertSafeRelPath` 路径守卫。r46-e2e 18/18 + r46-probe 9/9。**🛑 OS 级 deep-link 待用户拍板**[`tauri-plugin-deep-link` 新 crate=硬边界#5]）| 余项切入：**OS scheme 注册**（须用户批准新依赖 `tauri-plugin-deep-link`，或评估 Tauri 2 内置 scheme 能力）→ Rust 收 URL → 转发 handleObsidianUri；live preview(CM) 链接点击 hook；跨库 vault 路由；plugin `registerObsidianProtocolHandler` 接通。 |
| **⑯ 弹出窗口（Pop-out windows）** | **缺**（compat 明示「single-window host」）| Tauri 多 WebviewWindow——**大工程**，远期。 |
| **⑰ Canvas 白板** | **缺**（零匹配）| JSONCanvas（`.canvas`）无限画布——**大工程**，远期梯队。 |

#### 第四梯队 — 编辑器实时渲染长尾 + 杂项（「实时解译」精修）

| 功能 | 当前状态（已核实）| 范围与切入点提示 |
|---|---|---|
| ~~**⑱ Live preview 表格 / 跨行 `$$`·`%%` / mermaid widget / Setext 标题**~~ | **完成**（**Setext 折叠 R54** / **Live 表格 R55**[首个 cursor-aware block widget] / **Live mermaid R56**[抽共享 `liveBlockWidget`] / **跨行 `$$` 数学 R57**[`liveMath.ts` 行扫描+self-check+`HydratedBlockWidget`+KaTeX] / **`%%` 注释 R18 早已完成**[**R58 探明=stale gap**：livePreview.ts 既有「same-line `%%comment%%` hiding + cross-line block line-tinting」+ 自己的 `commentDelimOffsets`；inline `%%` 隐藏/cursor-reveal/doc 不变实测全绿 → R58 写的 liveComments 冗余已 revert]）| **#⑱ live 渲染长尾视为完成。** 已知偏差：嵌套(blockquote/list/缩进 1-3)表格/mermaid/math 不 live 渲染（降级源码）；**cross-line block `%%…%%` 是 line-tinting 非完全隐藏**（R18 ViewPlugin 跨行 replace 约束；可用 R55 `liveBlockWidget` StateField 升级为隐藏，但与既有 R18 tinting 纠缠=未来小 polish）；theme 切换 widget 不即时重渲染。 |
| ~~**⑲ 拼写检查 / 可读行宽 / 应用级缩放**~~ | **R50 已完成（v0.50，见上）**：`core/appearance.ts`（`readableLineLength`/`spellcheckEnabled` Store + setter，localStorage）。Readable line length = `.cm-content`/`.preview-content`/`.editor-loading`/reading-view properties-panel 的 `max-width` 改 `var(--readable-line-width, 46em)`，setReadableLineLength 切 documentElement var（OFF=none）。Spellcheck = EditorPane `useStore(spellcheckEnabled)` + effect 设 contentDOM。Zoom = `app:zoom-in`/`out`/`reset`（Mod+=/-/0 → `setFontSize`）。SettingsModal 2 toggle + i18n + `__geodeAppearance` 探针。r50-e2e 15/15 + r50-probe 6/6。默认保持现状（readable ON / spellcheck OFF）。 | 余项：可读行宽数值可调（固定 46em）；UI chrome 缩放（仅正文）；spellcheck 默认 ON（取 OFF 不惊扰）。 |
| ~~**⑳ 移动行上下 + 其它编辑命令**~~ | **R51+R52 已完成**：move/copy line（**R51**，`editorMotionCommands.ts`，move=`Alt+ArrowUp/Down`/copy=`Shift+Alt+ArrowUp/Down`，与 CM defaultKeymap 同键经 Prec.highest 拦截器单次触发，r51-e2e 10 + probe 6）；toggle-comment/indent/unindent/insert-blank-line/select-line（**R52**，`editorEditCommands.ts`，toggle-comment=`Mod+/` 产出 Obsidian `%%…%%`[cmExtensions 加 `%%` commentTokens]，其余无键 palette/可重绑，r52-e2e 11 + probe 6）。两轮均 `getActiveFileEditorView` 门控 + `__geode{Motion,Edit}` 纯变换探针 + i18n，零依赖。评审各 0 真缺陷。 | 余项：`deleteLine` 等 `Command` 类（非 StateCommand，需真实 view，探针驱动不了；按需可单独接但只能 live 测）；其它长尾 CM 命令按需逐个。**#⑳ 视为完成。** |
| **㉑ 小众核心插件** | **部分**：**Unique note creator R53 已完成（v0.53，见上）**（`core/uniqueNote.ts` + `plugins/unique-note.ts`，`unique-note:create` 时间戳命名笔记 + 文件夹/格式/模板设置，镜像 dailyNote，collision-retry 防同 tick 双触发，r53-e2e 11 + probe 6，评审 1 minor 修）。**仍缺**：Footnotes view / Slides / Web viewer / Bases / Format converter / Audio recorder | 按需逐个，低优先；Footnotes view（面板，零依赖）/ Format converter（纯转换，零依赖）较清爽可先；Slides/Web viewer/Bases/Audio recorder 偏重或需新能力。 |

#### 第五梯队 — Obsidian 差距补充（R59 候选池续命，2026-06-14 全功能对照登记 · 零依赖小项优先 = loop 燃料）

> **登记口径**：用户要求「再挖一轮 Geode vs Obsidian 差距」。两 agent 交叉比对（Geode R1–R58 已实现清单 × Obsidian 官方四页验证的全功能成本表）得出的**真缺口**——Obsidian 有、Geode 无、且**零新依赖可做**。按成本排序：**【小】= 零依赖一轮可做（loop 主燃料）**、**【中】= 中等一轮**。**纠误**：模板日期偏移 `{{date+3d}}` 属社区 Templater 非核心 Templates，**勿加**（Geode 核心模板口径正确）。

**【小】零依赖 · 高遗漏 · 一轮可干净交付（优先取这些续 loop）**

| 功能 | 当前状态（已核实）| 范围与切入点提示 |
|---|---|---|
| ~~**㉒ 图片嵌入尺寸** `![[img.png\|200]]` / `\|200x100`~~ | ✅ **R61 完成**（v0.58）| 共享 `parseEmbedSize`（reading+live 单一解析器）→ `<img width height>`，导出零改动继承；非数字别名仍当 alt（字节级不变）；评审修巨数三端漂移=正则封 5 位。 |
| ~~**㉓ Outgoing links 出链面板**~~ | ✅ **R62 完成**（v0.59）| 独立右栏 tab `features/outgoinglinks/`（镜像 OutlinePanel，复用 `getOutgoingLinks`，拆 Links/Unresolved 两分区 + `app:show-outgoing-links` 命令）。组合 BacklinksPanel 出链分区刻意保留（deliberate）。**Step 0 grep 现状救场**：出链数据/显示早已存在，真缺口仅是「独立面板」。 |
| ~~**㉔ Smart typography 智能排版**~~ | ❌ **R63 移除：非 Obsidian 核心**（社区插件 mgmeyers/obsidian-smart-typography）| WebSearch + 官方确认：弯引号/em-dash/省略号自动转换是**社区插件**，**非 Obsidian 核心功能**。与 `{{date+3d}}`（社区 Templater）同类 → 按「复刻 Obsidian **核心**」使命**不做**。出队。 |
| ~~**㉕ 多光标 / 多选命令**~~ | ✅ **R63 完成**（v0.60）| 2 行 foundation（`allowMultipleSelections`+`drawSelection`+`rectangularSelection`+`crosshairCursor`）解锁已有 keymap：Mod-Alt-↑/↓ 加光标、Esc 收起、Alt-drag 列选。**纠误**：R60 说的「Cmd+D 选下一个相同词」是社区插件非核心 → 保留 daily-note Mod+D。鼠标点击加光标属未来 polish。 |
| ~~**㉖ 粘贴 URL 到选区变链接 + 自动转 URL**~~ | **R60 出队 = 实为已完成**（code-verify：lang-markdown 内置 `pasteURLAsLink` 一直在扩展栈 `cmExtensions.ts:400-408` + `@lezer/markdown` 处理器 `:458-491`）| 选区非空 + 剪贴板 URL（https/mailto/www）→ `[选区](url)` **今天就能用**。仅「空选区自动转裸 URL」可能差异（按需小补）。**第三次同类：候选池「缺口」实为已实现**。 |
| ~~**㉗ Outline 内搜索过滤**~~ | ✅ **R64 完成**（v0.61）| 大纲顶部过滤输入框（大小写不敏感 substring）；显示匹配标题 + 祖先（淡显，保留层级上下文）不含后代（对齐 Obsidian 核心 Outline 过滤）；无匹配空态；切文件清空。纯前端 `OutlinePanel.tsx` filterRows。**Gate 2 确认**：Obsidian 核心 Outline 确有过滤框（WebSearch），非社区插件。 |
| ~~**㉘ Footnotes view 脚注面板**~~ | ✅ **R65 完成**（v0.62）| 独立右栏 tab `features/footnotes/`（镜像 OutlinePanel）：metadata 新增脚注索引（`getFootnotes`，行扫描 `[^id]:` on masked 排除围栏，content 取原文）；列 id+content，点击 jumpTo 定义（复用 `geode:scroll-to-heading`）。**Gate 2 确认**：Obsidian 1.9 核心 Footnotes view 插件（WebSearch），非社区。纯 view 零依赖。 |
| ~~**㉙ 状态栏增强**~~ | ✅ **R66 完成**（v0.63，核心项）| 新 `backlink-count` 插件（"N backlinks"=后链总提及，metadata.revision 跨文件更新）+ word-count 加「N selected words」（`getActiveView` 选区，`document:selection-changed`）。**Gate 2**：后链数/选中词=Obsidian 核心状态栏项（官方 help 确认）；**光标行:列 移除=非核心**（社区插件，同 ㉔/Smart typography 处理）。 |
| ~~**㉚ Callout 自定义类型 fallback**~~ | **R60 出队 = 实为已完成**（code-verify：`markdown.ts:902-944`）| 任意 `[!foo]` → `class="callout" data-callout="foo"`（主题可 `[data-callout=foo]` 上色）+ 无标题时类型名首字母大写作 fallback 标题（`[!tldr]`→"Tldr"）。**第四次「缺口」实为已完成**（HANDOFF 教训再验证）。 |
| ~~**㉛ 拖拽文件入编辑器生成链接/嵌入**~~ | ✅ **R67 完成**（v0.64）| 编辑器 drop handler（attachments.ts）识别 EXPLORER_MIME（核心共享 MIME）→ vault 内文件拖入：.md → `[[Name]]`、附件 → `![[name.ext]]`，文件夹/未知跳过（`fileExists`）；dragover 接管（explorer 拖只带 EXPLORER_MIME 无 text/plain）；effectAllowed move→copyMove（编辑器 copy 光标，R28 tree-move 不破）。**Gate 2**：Obsidian 核心（help/drag-and-drop 确认）。sync insert 无 await。**第五梯队【小】项至此清空** → 下一项进【中】㉜。 |

**【中】一轮可做（次优先）**

| 功能 | 当前状态（已核实）| 范围与切入点提示 |
|---|---|---|
| ~~**㉜ 搜索运算符扩展**~~ | ✅ **R68 完成核心**（v0.65）| 加 `task:`/`task-todo:`/`task-done:`（复用 line: 行级机制 + TASK_LINE_RE）+ `[property]`/`[property:value]`（frontmatter 子串，新 SearchInput.frontmatter）。`line:` R21 已有。**section:/block: 故意延后**：官方论坛证实它们在 Obsidian 与 line: 行为无差异（低价值）。R21 grammar 不破（40 e2e 含回归）。**评审修 2 根因**：① TASK_LINE_RE `[ xX]`→`[^\]]` 收敛 R40 TASK_BOX_RE（自定义状态 `[/]`/`[-]`/`[>]` 算 task，非空格=done）— 避免「task 定义第 4 次漂移」；② `[key:]` 空值降级为 key-exists（否则空子串匹配任意值）。**已记已知偏差**：`[link]` 现按属性谓词解析（非 R21 字面文本），转义口 `content:[…]`/`"[…]"`。 |
| ~~**㉝ 标签重命名（全库）**~~ | ✅ **R69 完成**（v0.66）| `#old`→`#new` 全库替换（含嵌套 `#old/x`→`#new/x` + frontmatter `tags:`）。新建 `core/tagRewrite.ts` **镜像 R30 propertyRewrite 五步纪律**（NOT R16 偏移式——TagRef 只有 from 无 to）：runTail 串行 + flushAll/ensureFresh capture + never-cache 逐文件读 + inline 复用 metadata 导出的 `TAG_RE` 重扫现算偏移 splice + frontmatter 走 `buildSetProperty`（绝不手写 YAML）+ post-rewrite 复解析断言（count 不变/旧消失/新到位）+ per-file skip。TagsPanel 右键 rename UI（照搬 AllProperties 菜单）。**数据安全**：flushAll + 验证 + 36 e2e + 10 probe 真 fs。**评审修 3 根因**：① frontmatter 重写集对齐 parseNote 索引判据（`/^#/` strip + 丢空白项）⊆ 索引集；② 全跳过仍显 skip 数（R47）；③ 删死 import。**Gate**：grep 确认 R41 无重命名 + R16/R30 引擎已就绪；WebSearch 确认 Obsidian 核心。 |
| ~~**㉞ 链接格式策略 + markdown 链接改写**（拆 3 子轮）~~ | ✅ **整项完成**（㉞-a R70 / ㉞-b R71 / ㉞-c R72）| **㉞-a（R70 ✅）= markdown 链接重命名改写**：补 md 链接索引（`LinkRef.kind`+`MARKDOWN_LINK_RE`）+ `resolveMarkdownLink`/`normalizeMdHref` + R16 五步引擎按 kind 分叉，重命名/移动文件时 `[text](note.md)` 同步改写（含 anchor/%20编码/相对/folder移动；external/code 跳过）。评审修 5 根因（href 编码 `%28%29%23%3F`/下游消费者 `resolveByKind`/compat original/?query 保留/normalizeMdHref 一致）+ 自查补 getGraph 附件崩溃。`resolveByKind` 让 backlinks/graph/outgoing/compat resolvedLinks 正确解析 md href。**数据安全**：23 e2e + 9 probe 真 fs + R16 五步纪律全沿用。**㉞-b（续）= md 内部链接渲染+点击导航**（动 markdown.ts→r18-diff）。**㉞-c（续）= 新链接格式设置**（wikilink↔md×最短/相对/绝对，影响全部链接构造点）。 |
| ~~**㉞-b md 内部链接渲染 + 点击导航**~~ | ✅ **R71 完成**（v0.68）| 阅读视图 markdown.ts `link_open` 对解析到 `.md` 笔记的 md href 产 `internal-link` anchor（`data-target=已解析全路径`，复用 wikilink 点击机器→openWikilink 必命中不误建笔记）+ live `.cm-live-mdlink` 加 data-link-target + hover 预览。新 `RenderMarkdownOptions.resolveMdLink` 由 5 调用点注入。**字节安全**：r26-bytes 0 violations（仅 2 md-internal 例预期变）。**评审修 5 根因**：live Ctrl-点导航/hover/embeds+卡片传 resolveMdLink/角括号剥`<>`/**根-绝对 href 精确解析（修 R70 resolveMarkdownLink basename 模糊 MAJOR）**。17 e2e + 8 probe。 |
| ~~**㉞-c 新链接格式设置**~~ | ✅ **R72 完成**（v0.69）| 新 `core/linkFormat.ts`（`linkUseMarkdown`/`linkPathFormat` Store+setter，localStorage，autoUpdateLinks 先例）= 全部「文件→链接」构造的**单一真值** `formatLink()`（wikilink↔markdown × 最短/相对/绝对 × embed/alias，resolve-back 验证，无安全形→null=调用方跳过）。两道硬降级守卫：(a) wikilink+相对→最短（resolveLink 不解析 `../`）；(b) embed 永远 wikilink `![[..]]`（md 嵌入不渲染，R71）。接 4 构造点：noteComposer extract / 拖文件入编辑器（attachments）/ `[[` 补全 path-format（cmExtensions）/ **unlinked mention「Link」(unlinkedMentions)**。SettingsModal toggle+select UI。**对抗评审（Workflow 9 agent / 4 lens + 逐条 skeptic verify）5 确认→2 根因+1 注释**：① **unlinkedMentions 改写后校验用 wikilink resolver 验 markdown 链接→空格名 href `%20` 静默跳过（修=`resolveByKind`，对齐 R70）**；② **formatLink markdown 分支 display 含 `]` 产不可重解析 `[a]b](..)` 违反 null 契约（修=display 含 `]`→null，对齐 WIKILINK_UNSAFE）**；③ extract 注释纠错。**纯前端 additive**（不写既有 .md、不动改写引擎/渲染）。26 e2e + 15 probe 真 fs + 回归 r24/r44/r67/r70/r71 绿。 |
| ~~**㉟ Properties 类型化编辑 UI**~~ | ✅ **R22 已实现 → 出队**（前置门 gate① grep 揭露描述失准）| **本项无需新轮**：R22 PropertiesPanel 已按 `effectivePropertyType` 分派 number(`type=number`)/checkbox(开关)/date·datetime(原生 picker)/list·tags·aliases(chips) 控件 + 类型图标菜单 `propertyTypes.assign` + `.obsidian/types.json` 注册表 + 写回走 `buildSetProperty`（绝不手写 YAML）。原描述「缺类型化编辑」**失准**（㉒–㉜ 同类候选池失准已制度化两道前置门——本轮 gate① 正是为此而设、成功拦截）。真缺口转入 ㊼（细化 ㉟）。 |
| ~~**㊼ Properties 增强 — cssclasses 应用**~~ | ✅ **R73 完成**（v0.70）| 笔记 frontmatter `cssclasses`（list/空格串/逗号串）+ 遗留单数 `cssclass` 作为 CSS 类应用到笔记视图容器（preview `.markdown-preview-view` + live/source `.markdown-source-view`），供主题/CSS 片段定向单笔记样式（Obsidian 核心 + 迁移叙事）。新 `core/metadata.ts getCssClasses()`（复用 parseFrontmatter/asList/fmField，按 `\s+` 切 token+去重）；EditorPane `useMemo([handle,docRevision])` 即时响应（live+preview 双态，编辑即更新、stale 移除）。**纯读 additive**：不写 .md、不动 markdown.ts（容器 className 不入 `previewHtml` 字节流 → r26-bytes 0 violations）。**对抗评审 6 lens → 0 确认缺陷**（CM 不覆写 host className 实测；className prop 非 innerHTML 无 XSS）+ 采纳 1 nit（补 live 态响应性断言）。23 e2e + 8 probe 真 fs（DOM 应用 browser-only、token 提取经 `__geodeCssClasses` sync 探针真 fs，§D 纪律）+ 回归 r30/r26 绿。**Gate**：grep 确认 ㉟ 类型化编辑 R22 已做 + WebSearch 确认 cssclasses Obsidian 核心。**㊼ 续缺口**：File properties 右侧栏 / 键盘导航 / tags chip 点击搜索 / date 值链日记 / hover+embeds 容器应用。 |
| ~~**㊱ Slides 演示模式**~~ | ✅ **R74 完成**（v0.71）| 极简自实现（**零依赖**，非 reveal.js→避硬边界#5）：当前笔记按整行 `---` 水平分页 → 全屏 overlay 逐页静态渲染（复用 **core** `renderMarkdownToHtml` + **core** `hydrateEmbeds`，分层禁 import editor feature）+ 键盘导航（←/→/Space/PageUp/PageDown）+ Esc 关 + 页计数 + prev/next/close 按钮。新 `features/slides/`（slides.ts `splitSlides` 先剥 frontmatter 再切 body 跳代码围栏 / SlidesOverlay.tsx / slides.css / dict.slides.ts）+ ModalKind+slides + 命令 `slides:start`（available 守活动文件）。**对抗评审 6 lens → 1 确认 MAJOR（数据安全）**：overlay 不夺焦 → 演示时键入静默改写底层笔记（修=挂载夺焦 `blur()`+`tabIndex=-1` focus + 拦 Tab 防走回编辑器；补无变更不变式 e2e 锁死假绿）。23 e2e + 7 probe 真 fs + 回归 r26/r30 + r26-bytes 0 violations（未碰 markdown.ts）。**Gate**：grep 确认 features/slides 零实现 + WebSearch 确认 Obsidian 核心 Slides（`---` 分页/←→Space/Esc）。**v1 已知延期**：仅 `---` 分页（非 `***`/`___`）/ setext `---` 当分页 / 无 fragment·垂直分页·speaker notes·导出 PDF / hover 卡片被 overlay 遮。 |
| ~~**㊲ `query` 搜索结果嵌入代码块**~~ | ✅ **R75 完成**（v0.72）| ` ```query ` 代码块 → 实时搜索结果列表（复用 `core/search.ts` parseSearchQuery+evaluateSearch），reading + live 双态。**字节敏感**（动 markdown.ts fence renderer → §C：改前 r26-bytes --baseline 重捕，改后仅 query fence 变、其余 0 violations）。镜像 mermaid fence→`.geode-query` 占位→hydrate 范式：新 `core/queryEmbed.ts`（runQueryBlock 全 vault 扫描 + renderQueryResult，结果项 `a.internal-link[data-target=path]` 复用既有点击委托）+ embeds.ts hydrateQuery pass + 新 `features/editor/liveQuery.ts`（findQueryRanges + HydratedBlockWidget，复用 R55/R57 机器）。**对抗评审 7 lens → 0 critical/0 major/1 minor（doc 一致性，已订正 As-built）**：共享 widget mousedown 加 `a.internal-link`→openWikilink 导航（契约原 `.internal-link`+return 不可实现，live 委托不认 `.internal-link`）。**v1 已知延期**：行内 snippet（deriveLineHits 仍 SearchPanel 私有）/ collapse-sort 等渲染选项 / 点击只跳文件不跳行。16 e2e + 8 probe 真 fs + r26-bytes 0 violations + 回归 r34/r55/r56/r26 绿。**Gate**：grep 确认零实现 + 摸清 search.ts/markdown.ts fence/R55 范式 + WebSearch 确认 Obsidian 核心。 |
| ~~**㊳ 任务自定义状态渲染**~~ | ✅ **R76 完成（reading v1）**（v0.73）| 阅读视图把 `- [/]`(进行中)/`- [-]`(取消)/`- [>]`(推迟)/`- [<]`(计划) 等非标准复选框态渲染为带 `data-task="<char>"` 的 checkbox + 区分样式（主题用 `li[data-task="/"]` 命中）。**字节敏感**（动 markdown.ts task rule → §C）：**字节保守设计**——`TASK_RE` `( |x|X)`→`[^\]]`（闭合 4 处 task 定义漂移，对齐 R40/R68）+ `is-checked` 仅 x/X + **data-task 仅非标准态 emit** → 标准 `[ ]`/`[x]` 阅读字节**逐字节不变**（r26-bytes `list-task` 0 violations）。editor.css + export.css 自定义态样式。**对抗评审 1 MAJOR（R70 元教训复发）**：渲染收敛让 `[/]` 成可点 checkbox，但**第 5 处 task 定义消费者**「点击 toggle」`preview.ts toggleTaskOnLine` 仍窄 → 死键；修=放宽 `[^\]]` + flip 镜像 format.ts（标准态行为不变、自定义态→done）。**v1 已知延期**：**live preview 自定义态不渲染**（lezer `TaskList` 硬编码 `[ xX]` + Obsidian 自身 live 也不支持自定义态——阅读视图才是该特性主场）。17 e2e + 8 probe 真 fs + r26-bytes 标准 0 violations + 回归 r26/r35/r68 绿。**Gate**：grep 揭露 task 定义 N 处 + WebSearch 确认 Obsidian data-task 约定 + live 限制。 |
| ~~**㊴ 块 ID 自动铸造 `^id`**~~ | ✅ **R77 完成**（v0.74）| 「复制块引用/嵌入」命令：对活动编辑器光标所在段落块，无 `^id` 则铸短随机 id（6 位 base36）append 行尾 + 复制 `[[Note#^id]]`/`![[Note#^id]]`。**写 .md** 走活动编辑器 `view.dispatch`（R33/R40 既有 B-class autosave 路径 + getView 仅活动文件 DS-1，非新写机制）。新 `core/blockId.ts`（blockRefAt：复用 R13 frozen BLOCK_MARKER_RE/blocks 索引、collision-checked mint、空行/围栏/frontmatter 守 null）+ `features/editor/blockRefCommands.ts` 2 命令。**不碰 markdown.ts**（`^id` 已 R13 strip → r26-bytes 0）。**对抗评审 1 MAJOR**：块链接硬编码 basename 绕过 R72 `formatLink` 单一真值（重复名解析错笔记 + 元字符产坏链 + 忽略 link 设置）→ 修=走 `formatLink(…, {subpath:"^"+id})`（给 R72 formatLink additive 加 subpath 形参）。**v1 已知延期**：代码块/表格/列表项块 id（standalone `^id` Geode metadata 不索引）/ `[[#^` 补全里铸 id / switcher 选块铸 id。14 e2e + 6 probe 真 fs + r72-e2e 26 回归 + r26-bytes 0。**Gate**：grep 揭露 R13 块基建全复用 + WebSearch 确认 Obsidian Copy link to block 自动铸。 |

> **第五梯队取用顺序建议**：先清 **【小】㉒–㉛**（每个零依赖一轮，loop 主燃料，㉒图片尺寸/㉓出链面板/㉕多光标 最高价值），再上 **【中】㉜–㊴**。**㉒/㉞/㊴ 动 markdown.ts/改写引擎/写 .md → 触发 data-safety + 字节级套件纪律**，其余多为纯前端。远期大工程（#⑧/⑯/⑰ canvas/pop-out/stacked）+ 需新依赖（#⑮ deep-link、Vim 模式、Web viewer、Audio recorder、Bases）仍须用户拍板。

#### 第六梯队 — Obsidian 差距深挖补充 II（R60 候选池续命，2026-06-14 · 14 域 Workflow 全景对照 + 147 项 code-verify · 零代码调研轮）

> **登记口径**：用户「再挖一轮 Geode vs Obsidian 差距，按文档格式补充」。本轮用 **Workflow 编排 14 个域 explorer**（编辑器 / markdown 三态 / 链接嵌入 / 属性 / 标签 / 搜索 / 图谱 / 工作区标签 / 命令快捷键 / 核心插件×2 / 外观主题 / 文件附件 / compat-API）逐项盘点 Obsidian 功能 → **每条「缺口」断言由对抗核查 agent 在 `src/` grep 证伪**（防 stale gap）。统计：**152 去重候选 → 147 code-verify → 131 确认真缺口（其中 89 NEW，见下表 ㊵–㊿）、3 项证伪（实为已实现）**。本表只列**原生功能**；**compat-API 缺口（商业主轴 = 插件迁移）落 `OBSIDIAN-COMPAT.md`「全景调研 II」缺口表**（file-menu/editor-menu 右键钩子、~~`vault.readBinary`~~[**R111 出队**：readBinary/createBinary 桥接 core 原生二进制 IO；modifyBinary 仍缺]、~~`fileManager.generateMarkdownLink`~~[**R112 出队**：委托 core formatLink，wikilink/markdown+path-format+alias/subpath，连带修 markdown-subpath 未编码]、~~`app.commands`~~[**R113 出队**：executeCommandById/listCommands/commands 架在 core CommandRegistry 上，尊重 available 预检]、~~`MetadataCache.getTags`~~[**R114 出队**：投影 core getTagMap→`Record<string,number>`，`#` 前缀 + distinct 笔记数]、~~`Plugin.registerEditorExtension`~~[**R115 出队**：新 core editorExtensions 注册表桥接 + EditorPane compat compartment，编辑期注册不丢数据]、~~`MarkdownView.getMode/getViewData`~~[**R116 出队**：读子集，getMode hardcode source + getViewData live 源文本；setViewData/setMode 写仍缺]、`registerMarkdownPostProcessor` 等）。
>
> **状态纠正（4 项，均 code-verify · 第三/四次「缺口实为已完成」再验证 HANDOFF 教训）**：
> - **㉖ 粘贴 URL 变链接 → 出队（已完成）**：lang-markdown 内置 `pasteURLAsLink` 一直在扩展栈，选区非空 + 剪贴板 URL → `[选区](url)` 今天可用（`cmExtensions.ts:400-408` / `@lezer/markdown:458-491`）。
> - **㉚ Callout 未知类型 fallback → 出队（已完成）**：`markdown.ts:902-944` 任意 `[!foo]`→`.callout`+`data-callout=foo`+类型名 fallback 标题。
> - **㉕ 多光标 → 细化**：`searchKeymap` 已挂 `Mod-d`，缺 `allowMultipleSelections`+`drawSelection` 致 no-op（补两项即解锁）。
> - **㊳ 任务自定义状态渲染 → 「待核」改「缺」**：阅读视图根本不把 `[/]`/`[-]` 当 checkbox 渲染。

**【小-中】原生功能补全（㊵–㊿，均零依赖，按「价值 × 低成本」排序）**

| 功能 | 当前状态（code-verified）| 范围与切入点提示 |
|---|---|---|
| **㊵ 图谱设置完整化** | **部分**（**显示+力 R78 ✅ + 过滤 R84 ✅ + 分组着色 R90 ✅ + 标签作节点 R99 ✅ + 附件作节点 R101 ✅ + 局部图谱 depth1-5+方向 R103 ✅ + neighbor links R110 ✅**；嵌套标签层级 续）| ~~**显示+力 持久化设置面板**~~（**R78 v0.75**：4 力滑块 + 4 显示 → `graphPrefs.ts` + localStorage。16 e2e + 6 probe）。~~**过滤：孤立笔记 + 仅现有文件 toggle**~~（**R84 v0.81**：**纯客户端**——`GraphNode` 已带 `resolved`+预算 `degree` → 扩 `GraphPrefs.filters={orphans,existingOnly}`（DEFAULT show-all 零回归）+ 新纯函数 `applyGraphFilters(nodes,edges,filters)`（existingOnly 先去 unresolved 再 `!orphans` 按过滤后边集去 degree-0）+ 设置面板 2 toggle，**零改 getGraph**。对抗评审 6 维 → 0 critical/major + 2 minor（空态文案未分「无笔记 vs 被过滤」=已知 UX 偏差）。17 e2e + 8 probe + 回归 r78/r28。**Gate**：grep 揭露 resolved/degree 已在=纯客户端可行 + WebSearch Obsidian Filters 组）。~~**分组着色**~~（**R90 v0.87**：**纯客户端**——`GraphGroup={query,color}` + `GraphPrefs.groups`（DEFAULT []=零回归）+ 新纯函数 `nodeGroupColor(node,groups,default)`（first-match：`path:`前缀/裸文本子串匹配）+ GraphView draw 按 color 分批[groups 空=单批 accent 逐像素等价]+ 设置面板 Groups 列表[color picker+query input+add/remove]。**零改 getGraph**。对抗评审 6 维深挖像素等价+React key=index → **0 confirmed 缺陷**。17 e2e + 8 probe + 回归 r78/r84。**Gate**：grep 揭露 draw 单批次 accent 着色点 + WebSearch Obsidian Groups）。**续缺口**：~~**标签作节点**~~（**R99 v0.96**：**纯客户端**——新纯函数 `graphPrefs.ts buildTagGraph(tagMap,keptNotes)`[每标签一节点 id `tag:`+name 绿、note→tag 边、degree>0 守卫]+ `GraphDisplay.tags` toggle[默认关] + draw 对 `tag:` id 用 `--graph-tag` 绿[先于 nodeGroupColor]。**零改 getGraph/GraphNode 形状**[tag 节点 id 前缀区分沿用 `unresolved:` 惯例]。**对抗评审 → 1 MAJOR[点击 tag 节点 openNode 仅按 resolved→openFile("tag:…")破损持久幽灵 tab，漏给 click handler 加 TAG_PREFIX 守卫]已修=requestSearch 对齐 Obsidian + 探针锁** + 5 维证伪。16 e2e + 7 probe + 回归 r78/r84/r90/r96/r98）· ~~**附件作节点**~~（**R101 v0.98**：纯客户端——`metadata.getAttachmentMap()`[附件→引用笔记集，镜像 getTagMap，revision 缓存]+ `graphPrefs.buildAttachmentGraph`[委托新抽共享 `buildAuxGraph`=2 调用点减法去重，buildTagGraph 亦改委托]+ `GraphDisplay.attachments` toggle[默认关]+ draw `attachment:` id 用 `--graph-attachment` 黄 + **openNode 附件守卫=剥前缀 openFile 真文件**[R99 MAJOR 复用：漏守卫→openFile 幽灵 tab]。**附带修 getGraph**：附件引用不再当 unresolved 幽灵节点[贴近 Obsidian，附件独立类，防双节点]。对抗评审 7 维 → 2 minor[#1 getAttachmentMap 解析与 getGraph resolveByKind 对称化→编码/相对 md 附件链接正确索引；#2 非 md 文件 create 补 reindexFile bump→后置附件节点不延迟]全修+锁测 + 5 维证伪[双节点/openNode 二进制非新入口/getGraph 不误杀缺失笔记/R99 消费者审计全覆盖]。markdown 图片嵌入 `![](…)` 不索引=标记缺口非缺陷。23 e2e + 7 probe 真 WKWebView + 回归 r99/r84/r90/r96/r98。**Gate**：grep 揭露 meta.links 含 `[[img.png]]`/`![[img.png]]`/`[txt](doc.pdf)` 附件链接 + WebSearch Obsidian Attachments=黄节点默认关）· unresolved/连线着色 · 嵌套标签层级 · 标签↔标签连边 · ~~**局部图谱**深度>2 + in/out~~（**R103 v0.100**：local depth 1|2→**1-5** + **Incoming/Outgoing 方向 toggle**。纯函数 `localSubgraph(edges,anchor,depth,{outgoing,incoming})` 一趟建有向 out/inc 两 Map + 方向感知 BFS，替换旧 `bfs(buildAdjacency)`[死 bfs 已删、buildAdjacency 留给 hover]；depth select 5 option + 设置 local-mode 2 toggle。默认 depth:1+both on=旧无向 BFS **逐字节等价**[reviewer 140k fuzz 0 mismatch=零回归]。**Gate 救场**：发现「Daily notes」候选条目陈旧[R43/R48 早完成 daily note+calendar+settings]→改取本项。对抗评审 6 维+等价 fuzz → **0 confirmed**。23 e2e + 8 probe + 回归 r78/r84/r90/r99/r101。**Gate**：grep 揭露 depth 仅 1|2 + WebSearch Obsidian local graph depth+in/out）+ ~~neighbor links~~（**R110 v0.107**：第三 toggle——ON[默认]显示邻居间互连边、OFF 只显触锚点星形边[隐藏两非锚点间边]。新纯函数 `localEdges(edges,keptIds,anchor,neighborLinks)`[替换 GraphView inline 双端边筛=减法+probe 化]；OFF 时 `within.filter(source===anchor||target===anchor)`。**对抗评审改前后边筛逐字符比对 → 零回归 byte-equivalent + 0 confirmed**；已知 depth≥2 深层孤立点=OFF 字面语义、默认 depth=1 干净星形、文档化。10 e2e + 5 probe + 回归 r78/r84/r99/r101/r103。**Gate**：grep 揭露 neighborLinks 未实现 + local 渲染所有 picked 间边 + WebSearch Obsidian neighbor links 语义）+ 保存默认 · 搜索过滤框 · 空态文案分空因。 |
| **㊶ 编辑器设置面板补全** | **部分**（**Strict line breaks R87 ✓ + 行号 gutter + 默认视图模式 R88 ✓ + Tab 缩进 R92 ✓ + 代码块复制按钮 R95 ✓**；其余开关续）| Settings→Editor 大量开关 Geode 无：~~行号 gutter~~（**R88 v0.85**：`showLineNumbers` Store + CM `lineNumberCompartment` 反应式 reconfigure[镜像 modeCompartment/spellcheck]+ 设置 toggle；默认 OFF=Obsidian+零回归；editorTheme 补 gutter 颜色走 `--text-faint`/`--text-muted`[CM 基础 light 主题硬编码色修正]；行号最左 fold 在右共存。对抗评审 0 critical/major + 2 minor[gutter 主题色]已修。13 e2e + 5 probe + 回归 r50/r79/r29）· ~~Tab 缩进宽度 + 用 tab/空格~~（**R92 v0.89**：`indentUsingTabs` Store[默认 ON=Obsidian]+`tabIndentSize` Store[默认 4]+CM `indentCompartment` 反应式 reconfigure[镜像 R88 lineNumberCompartment]→`indentExtensions`=`EditorState.tabSize.of(N)`+`indentUnit.of("\t"|N空格)`，驱动 indentWithTab/editor:indent；设置 toggle+segmented 2/4/8；`__geodeIndentConfig` 探针。**默认对齐 Obsidian=故意翻转**[Geode 旧=CM 默认 2 空格；先例 R87]、**不重写已存 .md**。对抗评审 6 维深挖 CM facet 语义/compartment 生命周期/data-safety 写路径[effects-only reconfigure 不 dirty]/默认翻转 → 0 confirmed；**默认翻转致 live editor:indent 插 `\t` 实跑抓 r52 回归 → pin `__geodeIndentConfig(2,false)` 确定性断言 + 加 tabs-on 集成（r52 12/12）**。21 e2e + 9 probe 真 WKWebView + 回归 r88/r50/r29/r24）· **fold heading / fold indent 分项开关**（`folding.ts` 常开）· 缩进参考线 · 自动配对**开关化**（R35 行为已做）· ~~新标签默认视图/编辑模式~~（**R88 v0.85**：`defaultNewTabMode` Store[live/source/preview，默认 live=零回归]+ workspace.ts openFile 新建分支读它[唯一注入点，graph/reopen/split/layout 各保留自身 mode]+ 设置 segmented[Reading/Live/Source]。`__geodeNewTabMode` 探针）· ~~代码块复制按钮~~（**R95 v0.92**：阅读视图代码块 hover→Copy。**post-render hydration pass**[新 `codeCopy.ts hydrateCodeCopy`，镜像 hydrateEmbeds]——**markdown.ts 不碰→r26-bytes 0**、按钮注入已渲染 DOM；复制 `code.textContent`[trim 尾换行]+ Copied 瞬态 + 幂等守卫。**对抗评审 1 MAJOR[mermaid/query `<pre class=geode-*-source>` source-fallback 同步时仍在 DOM 误加按钮，fixture 用空 div 遮蔽]→ 修 `pre.closest(".geode-mermaid,.geode-query")` 排除 + 真渲染断言；1 minor[note embed 内代码块 async 晚于同步 pass=v1 gap]**。12 e2e + 8 probe 真 WKWebView + r26-bytes 0 + 回归 r26/r25/r75/r55/r94。live preview 复制延期）· ~~**Strict line breaks**~~（**R87 v0.84**：`renderMarkdownToHtml` 渲染前 `md.options.breaks = !opts?.strictLineBreaks`，**默认翻转为 breaks:true 匹配 Obsidian 默认**[单换行→`<br>`]，strict ON=CommonMark；`strictLineBreaks` Store + 7 注入点[EditorPane 反应式 + embeds/hover/slides/export/compat .get() + 探针]+ 设置 toggle。**字节敏感轮**：r26-bytes 加 soft-break 语料 + 改前 baseline 重捕 + 改后仅 3 处段内单换行 case 变[blockquote+soft-break×2]、18 块级 case 字节不变=隔离[0 violations]。对抗评审 5 维深挖单例 breaks 污染+默认翻转 → 0 confirmed critical/major/minor + 2 nit。11 e2e + 6 probe + 回归 r26/r25/r74）。多为纯 UI toggle，接 appearance.ts + cmExtensions compartment。**续缺口**：fold 分项开关 / 缩进参考线 / live preview 代码块复制 / 自由数字缩进输入 + 各 setting-item 补 setting-desc。 |
| **㊷ 反链 / 出链面板增强** | **部分**（**面板头部控件 R82 ✓ + Show more context R98 ✓**；笔记底部内嵌续）| ~~面板头部控件（排序 / 折叠全部 / 搜索过滤）~~（**R82 v0.79**：Backlinks 链接提及段 + 独立 Outgoing 面板加工具栏——排序下拉（默认[保源序=零回归]/文件名 A→Z/Z→A）+ 文本过滤 + （backlinks）折叠全部/每源 chevron。新核心纯函数 `core/linkPanel.ts sortAndFilterLinks(items,getName,sortKey,filter)`（`LinkSortKey`，两面板复用=features 不互 import 故共享逻辑落 core）+ `__geodeLinkSortFilter` 探针。view-only 不写 .md、不动 markdown.ts。**对抗评审 6 维 → 1 确认 MAJOR + 1 MINOR（同根因，已修）**：工具栏状态跨 activePath 不重置 → 切到有反链的新笔记旧过滤串残留 → 假空「No mentions match」（修=两面板各加 `useEffect(reset,[activePath])`；补 4 条跨笔记重置 e2e）。27 e2e + 6 probe 真 WKWebView + 回归 r62/r80。**Gate**：grep 揭露 R62 出链独立面板已在、word-count 选区已做 → 本轮聚焦头部控件。**续缺口**：~~show more context~~（**R98 v0.95**：toggle 片段从匹配行扩展到周围整段[空行分隔块]。**面板侧现算零改 getBacklinks/索引**[规避「需改共享索引」延期理由]——新 `buildParagraph` + linked 仅 toggle 开时 async 重读源、unlinked 扫描顺带建。`moreContext` localStorage 全局持久。**对抗评审 0 critical/major + 2 minor[F1 切档陈旧整段 map 标 activePath guard / F2 依赖 data.backlinks 非 shownBacklinks 免 filter 重读]全修+F1 补 e2e**。15 e2e + 6 probe + 回归 r82/r62/r80/r97）/ backlinks-in-document 笔记底部内嵌（`BacklinksPanel` 仅侧栏挂载）/ 修改·创建时间排序（需 adapter stat=跨 Rust）/ unlinked-mentions 段同享 sort/filter）。**已交付前置项**：字数选区统计（`word-count.ts plugin.wordCount.selected` 早已实现）/ 出链独立面板（= ㉓ R62）。 |
| **㊸ 搜索面板 UI 选项** | **部分**（**v1 排序+折叠+上下文+复制 R80 完成 ✅**；解释/大小写/时间排序续）| ~~排序~~（**R80 v0.77**：下拉 relevance[默认]/文件名 A-Z·Z-A/匹配数 多·少，`sortResults` 纯泛型函数，**allResults state + memo 排序免重搜**，localStorage 持久化）+ ~~折叠结果~~（折叠/展开全部 + 每文件 chevron，`collapsed:Set`）+ ~~更多上下文~~（`LineHit` 加 fullText/fullMarks，sliceLine dual，免重 derive，持久化）+ ~~复制结果~~（剪贴板 `[[path]]` 列表 + 按钮反馈）。纯前端单文件，r26-bytes 0。对抗评审 0 major/2 minor（copy 反馈+clipboard 守卫，均修）。17 e2e + 7 probe + 回归 r68/r34。**Gate**：grep SearchPanel + WebSearch Obsidian 搜索选项。**续缺口**：解释搜索词（explain，search.ts 有 AST）/ 匹配大小写 UI toggle（R68 有 `case:` 运算符）/ **修改·创建时间排序**（需扩 adapter 加 stat=跨 Rust）。 |
| ~~**㊹ wikilink 补全增强**~~ | ✅ **R106-R109 完成**（alias R106 + `[[note#` 标题 R107 + 附件 R108 + `[[note#^` 块 R109）| ~~别名 alias 候选~~（**R106 v0.103**：`[[` 补全 + QuickSwitcher 双双 surface frontmatter aliases——alias 早已 resolve[nameToPaths]，gate 救场发现真缺口是两 suggester 不 surface。新 `metadata.getAliasMap()`[revision 缓存]；`[[` 插 `[[canonical|alias]]`[含 `[`/`]` 的 alias 跳过=防破坏链接结构]；QuickSwitcher 按 alias 开笔记+`↪basename` hint。**对抗评审 → 零回归 byte-equivalent[逐表达式核] + 1 minor[bracket-alias]修+锁 + 1 nit[slice 防泄漏]修**。12 e2e + 4 probe + 回归 r31/r41/r47/r24/r70。**Gate**：grep 揭露 alias 已 resolve、两 suggester 仅用 getMarkdownFiles 不含 alias + WebSearch Obsidian switcher/`[[` 按 alias）。~~`[[note#` 标题补全~~（**R107 v0.104**：`[[<note>#` 触发目标笔记标题补全、`[[#` 当前笔记 self-link、插 `[[note#Heading]]`。新纯函数 `wikilinkHeadingTargets`[resolve note→列 headings→过滤含 `[ ] | #` 的破坏性标题，R106 教训复用]；复用 R106 applyLink。**对抗评审 `git show` 改前后逐字节比对 → 零回归 byte-equivalent + 1 minor[补全源 fromPath 用全局 getActiveFile 而非 per-editor getPath→focus 跨 pane 解析错文件]修**。12 e2e + 6 probe + 回归 r31/r41/r106/r24/r70。**Gate**：grep 揭露 `[[` 补全不解析 `#` + headings 已索引 + WebSearch Obsidian `[[note#`/`[[#`）/ `[[note#^` 块补全（与 ㊴ 块ID 相关）/ ~~附件·非 md 文件候选~~（**R108 v0.105**：`[[` 补全列非 md 附件[图片/pdf/…]、插 `[[image.png]]`/`![[image.png]]` 嵌入。新纯函数 `wikilinkAttachmentCandidates`[getFiles 减 md/无扩展名 → linkText 裸名或歧义全路径、含定界符跳过]；复用 R106 applyLink；dup map 与 resolveAttachment basename map 同 key→歧义判定一致、链接真 resolve 无悬空。**对抗评审 → 零回归 byte-equivalent[纯 append]+ 链接 resolve 双端实证 → 0 confirmed**。12 e2e + 7 probe + 回归 r31/r41/r106/r107/r24/r70。**Gate**：grep 揭露 `[[` 补全只 getMarkdownFiles + WebSearch Obsidian `[[image.png]]`）/ ~~`[[note#^` 块补全~~（**R109 v0.106**：`[[note#^` 列块引用、**显示块文本预览**[按内容选，因块 id 不透明]、插 `[[note#^id]]`。**首个 async 补全源**[BlockRef 无 text→读笔记取预览]；新纯 async `wikilinkBlockTargets`[resolve note→getMetadata.blocks→vault.read→blockPreview 去 marker]；复用 R106 applyLink。**对抗评审读 CM autocomplete 库内部验 async 竞态 → 单 source 单在飞 query + abort 守门丢过期 Promise + validFor 客户端过滤不重读 → 零回归 byte-equivalent + 0 confirmed**。12 e2e + 7 probe + 回归 r31/r41/r106/r107/r108/r24/r70。**Gate**：grep 揭露块已索引[BlockRef]+创建流[blockId.ts]+`[[#^` 补全缺 + WebSearch Obsidian 块补全显文本）/ 多级 `#H1#H2` 续。**㊹ 收官**。另：多级 `[[note#H1#H2]]` 子路径（`markdown.ts:413` 只取首个 `#`）+ 链接 Cmd/Ctrl/中键点击开新标签（零实现，全 src 仅 `App.tsx:472`/`workspace.ts:629` 传 `newTab`）。 |
| **㊺ 外观设置补全** | **部分**（**强调色+系统主题 R79 ✓ + 字体族 R85 ✓ + inline title+ribbon R94 ✓ + tab title bar+状态栏 R100 ✓**；Native title bar/半透明窗口 续[需 Tauri 窗口能力]）| ~~**强调色 Accent color 取色器**~~（**R79 v0.76**：`<input type=color>` → 运行时覆盖 `--accent`+派生 `--accent-hover`/`--accent-muted`（color-mix）+ localStorage 持久化 + reset；hex 校验，非法 removeProperty 回默认）+ ~~**系统主题三态**~~（**R79**：`ThemeKind+="system"`，`resolveTheme(kind,systemPrefersDark)` 纯函数 + matchMedia watchSystemTheme 实时跟随 `prefers-color-scheme`；`theme:changed` 恒载 resolved 具体值；sanitizeState/captureLayout/applyLayout 向后兼容 + R45 全局态保持）。新 `core/workspace.ts resolveTheme` + `core/appearance.ts accentColor`。纯前端、r26-bytes 0。对抗评审 7 lens 0 确认 + 2 nit（accent swatch 读 computed --accent / 补 R45×system 断言）。21 e2e + 7 probe + 回归 r45/r50。**Gate**：grep appearance 基建 + WebSearch Obsidian Appearance。~~**字体三族**~~（**R85 v0.82**：镜像 R79 accent——`sanitizeFontFamily` 纯函数（CSS 注入防护 strip `["'\\;{}()<>]`+控制符，保留 \t\n\r 归一）+ 3 Store/setter（interfaceFont/textFont/monospaceFont）运行时覆盖 `--font-interface`（body）/`--font-text`（`.cm-editor`+`.markdown-reading-view`，未设继承界面）/`--font-monospace`（8 mono 点）+ localStorage，空=removeProperty 回默认栈。SettingsModal 3 text input。**对抗评审 6 维 → 0 critical/major + 2 minor（已修：text 缺失回退应尊重界面覆盖 `var(--font-interface,…)`；控制字符 strip 防声明静默失效）**。21 e2e + 6 probe（`__geodeFontSanitize`）+ 回归 r79/r50。**Gate**：grep appearance 基建 + WebSearch Obsidian Interface/Text/Monospace font。settings mono fallback 故意统一 editor 全栈）。+ ~~**Show inline title + ribbon 显隐**~~（**R94 v0.91**：Show inline title[文件名作 H1 顶部显示，默认 ON=Obsidian，**display-only**——编辑→rename 延期]+ Show ribbon[左侧功能区显隐，默认 ON]。`showInlineTitle`/`showRibbon` Store（镜像 showLineNumbers）；EditorPane `inlineTitleEl` 渲染于 live/source cm-host 同级上方 + reading scroller 首子（text=tab.title，rename 保鲜，React 转义无 XSS）；App.tsx 条件渲染 ribbon nav（OFF 经 Ctrl+,/palette 仍可达无锁死）。`__geodeAppearance.setToggles` 并入既有 probe。**对抗评审 6 维深挖 默认翻转/XSS/ribbon 锁死/反应式生命周期[片段位置稳定不重挂 cm-host=CM view 选区/滚动/undo 存活] → 0 confirmed**。14 e2e + 5 probe + 回归 r23/r25/r26/r30/r50/r88/r74）。+ ~~**Show tab title bar + 状态栏显隐**~~（**R100 v0.97**：两 appearance toggle 逐字镜像 R94 inline title/ribbon——`showTabTitleBar`/`showStatusBar` Store[默认 ON=零回归+Obsidian]+ App.tsx TabBar 条件 return null[hooks 后] + status footer 条件渲染[status 插件项 Store 顶层无条件订阅、footer 卸载不报错] + 设置 2 toggle。`setChrome` 并入 `__geodeAppearance` probe。**对抗评审 6 维深挖 hooks 顺序/脏 tab 丢失/status 插件 unmount → 0 confirmed**[EditorPane 是 TabBar 兄弟不被卸载=脏 tab 不困、PluginElementHost detach/reattach 同 R94、ribbon+tab+status 全隐藏仍 Ctrl+,/palette 可达]。15 e2e + 5 probe + 回归 r94/r36/r66/r50/r99）。**续缺口**：系统字体自动补全建议 / 字体识别 ✓ 标记 / inline title 随内容滚动 + 编辑→rename / Native title bar / 半透明窗口 Translucency（需 Tauri 窗口装饰能力）。 |
| **㊻ 标签面板增强** | **部分**（`TagsPanel.tsx` 48 行扁平）| 嵌套标签 `#a/b` 层级树 + 折叠（现整串扁平一行）+ 排序菜单（`:19` 硬编码 count 降序）+ 点击阅读视图 `#tag` pill / 编辑器 hashtag → 搜索（`markdown.ts:1056` 纯 span 无 onClick）+ 计数语义可选（现按文件数，Obsidian 按出现数 `metadata.ts:553 Set<path>`）。 |
| **㊼ Properties 增强** | **部分**（细化 ㉟；~~cssclasses R73 ✓~~ / ~~tags chip 点击搜索 + 键盘导航 R83 ✓~~）| ~~`cssclasses` 应用~~（**R73**，见上 v0.70 行）+ ~~tags chip 点击搜索 + 属性行键盘导航~~（**R83 v0.80**：tags chip 变可点 button → `app.workspace.requestSearch(\`#${tag}\`)` 复用 R41 机制开搜索面板查 `#tag`（aliases/multitext 不可点）；`.property-row` 加 `tabIndex={0}`+`data-prop-row`+onRowKeyDown → ↑/↓ 切行、Enter 进 value 编辑器（仅行壳聚焦时动作）。**对抗评审 1 确认 CRITICAL（data-safety）**：初版 Escape→程序化聚焦行 → blur 触发字段 onBlur 提交 stale draft → **误写 frontmatter + 反转 Escape 撤销契约** → 修=结构性移除 Escape→行（字段 Escape 交回自身 discard，行用 Tab 进入、Shift+Tab 退出）+ 补「编辑+Escape→doc 不变」data-safety e2e。15 e2e + 3 probe + 回归 r30/r24/r23。**Gate**：grep 揭露 requestSearch（workspace.ts:331）+ TagsPanel R41 先例可复用、property-row 无 tabIndex。**续缺口**：~~File properties 右侧栏 + Cmd+Backspace 删属性 R86 ✓~~ / Date 值链日记 / hover+embeds 容器应用 cssclasses / Escape→行平滑回退 / opaque·add 行入导航。 |
| ↳ ~~**㊼ File properties 右栏 + Cmd+Backspace 删属性**~~ | ✅ **R86 v0.83** | Obsidian「Properties view」核心插件=活动笔记属性右侧栏。新 `features/editor/FilePropertiesPanel.tsx` 复用 R22 PropertiesPanel，但作**独立第二写者**经共享 `DocumentHandle`（acquire/release + **`applyExternalEdits`** 而非裸 setText+modify→live CM 共存安全）。`RightPanelKind+"fileproperties"` + App.tsx 三处接线（tab/effectiveRight/渲染）。Cmd/Ctrl+Backspace 删属性接 R83 onRowKeyDown（柯里化拿 key，复用 removeKey=buildRemoveProperty）。**对抗评审 6 维深挖第二写者+refcount → 0 confirmed critical/major/minor + 1 nit（已修）**：mismatch guard 不误 throw（updateListener 同步物化 this.text）/ refcount 配对 / offset 自洽。11 e2e（含 live CM 共存）+ 6 probe 真 fs（`__geodeFilePropsRemove`）+ 回归 r83/r30/r24。**Gate**：grep 揭露 RightPanelKind 无 fileproperties + applyExternalEdits 是安全第二写者路径 + WebSearch 确认 Properties view 核心 + 删属性快捷键是 Obsidian 未实现的 feature-request（本轮顺带补）。 |
| **㊽ 文件浏览器 + vault 管理增强** | **部分**（**全局新文件位置 R89 ✓ + 文件树排序 R91 ✓ + 右键菜单 R93 ✓ + Excluded files R96 ✓ + Move to R97 ✓ + 非 md 只读查看视图 R102 ✓ + audio/video/pdf 预览 R104 ✓ + denylist 翻转 R105 ✓**；detect-all-extensions / Reveal-in-Finder 续）| ~~排序下拉~~（**R91 v0.88**：名称 A→Z/Z→A 纯展示层——新纯函数 `vault.ts sortTreeNodes(nodes,sortKey)`[folders-first+localeCompare，不动存储序]+`explorerSort` Store[默认 name-asc=零回归]+Explorer flattenVisible 每层 sort+toolbar toggle。时间排序需 adapter stat 延期。对抗评审 6 维深挖零回归+不 mutate → **0 confirmed 缺陷**。10 e2e + 5 probe + 回归 r28）+ ~~右键菜单完整化（新标签/右侧打开·制作副本·根菜单）~~（**R93 v0.90**：gate① 揭露 Explorer 早有行菜单[New note/folder here·Rename·Delete]→朝 Obsidian 平价**加性**补 文件项 Open in new tab/Open to the right[splitActivePane→openFile(paneId)，null→newTab 兜底]/Make a copy[R42 flushAll→readBinary→createBinary，byte-identical] + **空白区根菜单**[node:null 分支，行 stopPropagation 防冒泡] + R81 两轴 clamp + per-item testid。复用 vetted 路径零新依赖。**对抗评审 6 维 → 0 critical/major + 3 minor[Finding 1 MemoryAdapter readBinary 陈旧→两 map 互斥修 / Finding 2 无扩展名 uniquePath 尾点 / Finding 3 flushAll 进 try]全修 + 1 注释**。22 e2e + 9 probe 真 fs + 回归 r28/r91/r24/r23/r89）+ ~~移动到[文件夹 picker]~~（**R97 v0.94**：右键「Move to…」fuzzy 文件夹选择器——新 `MoveToModal.tsx`[镜像 QuickSwitcher chrome+core/fuzzy]+ 纯函数 `core/explorerMove.ts moveTargets(tree,fromPath)`[全文件夹减 self/descendants/current-parent]。选目标→既有 vetted `moveNode`[resolveDropTarget 四守卫+wouldCollide+R16/R70 renameWithLinkUpdate]，**零新写机制**。root 选项 moveNode(null)。**对抗评审 6 维 → 0 critical/major + 1 minor[React key 冲突病态已修]**；data-safety=picker 纯选写全走 moveNode、裸 basename md 链接移后仍解析。15 e2e + 6 probe 真 fs + 回归 r28/r70/r44/r24/r93/r96）/书签 + **Reveal in Finder / 默认程序打开**（需 Tauri opener=硬边界 #5 待拍板）+ detect-all-extensions 开关 + ~~**excluded files 排除列表**~~（**R96 v0.93**：新 `core/excludedFiles.ts isExcluded(path)` 单一谓词[模式 `{regex}<re>` 或 glob `*`/`?`字面，对路径 substring-anywhere；编译缓存 raw 变才重编]接 search[扫描跳过]/graph[rebuild 预过滤 R84 前，两端边才留无悬空]/explorer[is-excluded dim=opacity-only 仍可点开]；`excludedRaw` Store + 设置 textarea。completion/switcher/未链接延期。**对抗评审[subagent 两次中断→chief 亲评 6 维]→ 1 minor[glob 漏 escape `?` 当量词]已修+锁 + 5 维证伪[纯读不写/可见性过滤/缓存无 stale/无悬空边/反应式]**。17 e2e + 12 probe 真 WKWebView + 回归 r80/r68/r84/r78/r93/r91）+ ~~非 md 文件独立查看视图~~（**R102 v0.99**：非 md 图片/二进制开新 `viewType:"attachment"` 只读视图——**数据安全核心**，堵「点 .png 当 md 编辑→损坏二进制」既有 wart。attachment=file-backed（rename/delete/persist 生命周期）但 non-editor（绝不 documents.acquire/autosave）。`core/attachments.ts` fileExtension/isImagePath/isAttachmentPath/imageMime + OTHER_BINARY_EXTS≈50；`workspace.ts` fileViewType（openFile/sanitizeTab/rename **每处从路径重算 viewType**）+ retargetFileTab；AttachmentView 图片→readBinary→blob `<img>`、其余→占位。allowlist=md/文本零回归。**对抗评审 2 MAJOR data-safety[#1 restore/rename 不重算 viewType→二进制回可编辑路径；#2 allowlist 漏未知二进制]全修+锁测 + 自查附带修 MemoryVaultAdapter 二进制 rename/remove**。20 e2e + 11 probe 真 WKWebView + 回归 13 套。**Gate**：grep 揭露 openFile 一律 viewType=markdown + WebSearch Obsidian Unsupported file。续：~~denylist 全翻转~~[R105] / ~~pdf-audio-video 真预览~~[R104] / Reveal-in-Finder[Tauri opener=硬边界#5 待拍板]）+ ~~**Unsupported file denylist 翻转**~~（**R105 v0.102**：`isAttachmentPath` allowlist→denylist——只 md+已知文本/代码+无扩展名可编辑，其余含未知扩展名→只读 attachment[Obsidian Unsupported file 语义]。堵 R102/R104 评审标记「未知二进制仍可编辑→UTF-8 round-trip+autosave 损坏」最后洞。删 OTHER_BINARY_EXTS+加 EDITABLE_TEXT_EXTS+翻 isAttachmentPath 一行。**对抗评审 6 维 → 0 confirmed**[程序化证 EDITABLE∩二进制=∅ + 结构性证可编辑集只收缩=binary→可编辑按构造不可能；nit .plist 有 binary 变体已移出]。12 e2e[含 69-ext symmetric diff] + 6 probe + 回归 r102/r104。**attachment 全链 R102+R104+R105 收官**。**Gate**：grep OTHER_BINARY 仅 isAttachmentPath 用 + WebSearch Obsidian Accepted formats=只 md note）+ ~~**audio/video/pdf 内联预览**~~（**R104 v0.101**：扩 R102 AttachmentView——非图片媒体从只读占位改 `<audio>`/`<video>`/`<embed>` 内联预览。core/attachments 拆 IMAGE/AUDIO/VIDEO mime 三表 + `mediaKind`/`mediaMime`，audio/video/pdf 从 OTHER_BINARY 移入预览 kind；**isAttachmentPath 总集与 R102 字节相同 + 仅新增 {3gp,ogv}**[reviewer 对称差 DROPPED=[] 验证零数据安全回归]。仍只 readBinary 裸读、**绝不 documents.acquire**。对抗评审 6 维 → 1 minor[`in`/方括号穿透原型链误判 `x.toString`→image，改 `Object.hasOwn`]修+锁 + 路由集零丢失证伪。19 e2e + 12 probe + 回归 r102。续：pdf 桌面空白兜底 / 大文件流式）+ ~~**全局新文件位置**~~（**R89 v0.86**：Obsidian「Default location for new notes」三态[vault 根/同文件夹/指定文件夹]。新 `core/newNote.ts` `newNoteLocation`+`newNoteFolder` Store + `resolveNewNoteFolder(activePath)` + `createNewNote(vault,name,activePath,content)`（slash-guard 路径名不嵌套 + folder-ensure + uniquePath 防撞名）。**5 个建笔记调用点收敛**到 createNewNote[QuickSwitcher/wikilinks/backlinks/outgoing/graph]=正向减重复。默认 root=零回归。**对抗评审 4 维深挖 data-safety → 0 critical/major + 2 minor[QuickSwitcher 补 catch / wikilinks 用 fromPath]已修**；非法 folder 路径经 assertSafeRelPath+Rust safe_join 防御、path-bearing name 中间文件夹两端 createFile 自动建。16 e2e + 8 probe 真 fs + 回归 r82/r84/r24。**Gate**：grep 揭露 5 个 `uniquePath("",name)` 硬编码 root 建笔记点 + WebSearch Obsidian 三态。**续缺口**：TemplateSelector/explorer 工具栏新建接 location / Reveal-in-Finder[Tauri opener 依赖待查]）。 |
| **㊾ 命令面板 / 快捷键面板增强** | **缺/部分**| 命令面板最近用命令置顶（`CommandPalette.tsx:33` 空查询无排序）+ pinned commands（固定常用置顶 + 设置区）+ 快捷键面板过滤已分配（`SettingsModal HotkeysSection` 仅文本过滤）+ **一命令多键**（`types.ts:194 hotkey?:string` 单值贯穿全栈）。纯前端/设置层。 |
| **㊿ 标签页右键菜单 + 侧栏面板拖拽/堆叠** | **部分**（**v1 标签页右键菜单 R81 完成 ✅**；侧栏拖拽/堆叠续）| ~~标签页右键上下文菜单~~（**R81 v0.78**：标签 `onContextMenu` → `.tab-context-menu` 7 项（Close / Close others / Close to the right / Close all / 分隔 / Pin·Unpin / Split right·Split down），capture-mousedown 外点 + Esc 关，定位双轴 clamp。新纯函数 `core/workspace.ts tabIdsToClose(tabs,targetId,mode)`（others/right/all × **恒跳 pinned**，三方法单一真值）+ `closeOtherTabs/closeTabsToRight/closeAllTabs` → 私有 `closeTabBatch` 走 findTabLeaf + 逐个 vetted `closeTab`（**绝不直接 splice** → 继承 R24 autosave/flush）。复用 Pin（R36）/Split（R37）既有命令。纯前端、不写 .md、r26-bytes 0。**对抗评审 7 lens + 6 lens data-safety skeptic-verify → 0 确认缺陷 + 3 nit（采纳 2：菜单定位下界 clamp / graph tab 禁 Split + CSS :disabled）**。data-safety 核心证伪：脏状态属 refcounted `DocumentHandle`（outlives view）→ EditorPane 卸载已调度 deferred-drop flush → 批量关闭不丢脏（r24 flush 12/12 回归绿）。14 e2e + 5 probe 真 WKWebView + 回归 r36(47)/r37(36)/r39(17)/r24(12)。**Gate**：grep 揭露 Pin/Split/closeTab 全在、仅缺 3 批量方法 + 菜单 UI + WebSearch Obsidian 标签菜单核心项）+ 侧栏面板拖拽重排 / 多面板堆叠分组（`LeftPanelKind/RightPanelKind` 单值非栈，每侧栏同屏仅 1 面板——续缺口）。**v1 已知延期**：Move to new window（需 pop-out=硬边界）/ Move to right split 子菜单 / 标签拖拽重排。右键菜单依赖 compat `file-menu`/`editor-menu` 钩子同根（见 OBSIDIAN-COMPAT）。 |

> **第六梯队取用顺序建议**：高 ROI 先取 **㊵ 图谱设置**（用户可见度高）、**㊺ 外观补全**（强调色/系统主题日常高频）、**㊸ 搜索 UI**、**㊿ 标签页右键菜单**（交互主入口）。**㊶ 含 strict line breaks 动 markdown.ts → data-safety + 字节级套件**；㊼ cssclasses 纯读 / ㊽ 新文件位置纯前端、Reveal-in-Finder 加 Rust 只读命令——多为只读/前端。**远期 / 需用户拍板（不在本表）**：导入器 Importer（Evernote/Notion/Roam，大工程）· 社区主题应用内浏览器 · Web viewer / Audio recorder / Bases（新能力，硬边界 #5）。
> **⚠️ 设置「重复」纠误（用户提问）**：Templates`{文件夹,日期格式,时间格式}` / Daily`{新文件位置,日期格式,模板位置}` / Unique`{新文件位置,前缀格式,模板位置}` 三区字段看似重复——**code-verify（`SettingsModal.tsx:481/531/581`）确认忠实于 Obsidian**（三个独立核心插件各一套设置）。语义不同：各「位置」指向不同用途文件夹；Templates 的「日期格式」管 `{{date}}` **变量**、Daily 的管文件**名**。**不应合并**（合并即偏离 Obsidian）。真实缺口是 Geode 这些 setting-item **缺 `setting-desc` 说明文字**（Obsidian 每项有澄清描述）→ 看似重复；**补描述即可**（归入 ㊶ 设置面板补全的顺手项）。另：Obsidian 有**全局**「新文件位置」（Files&Links），与各插件位置是**分层**关系（全局默认 + 插件覆盖）而非冗余——Geode 缺此全局项（见 ㊽）。

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
