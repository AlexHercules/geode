---
name: data-safety
description: Geode 数据安全与写入正确性回归清单。当改动涉及编辑器（CodeMirror / EditorPane）、vault 读写、文件重命名/删除、自动保存、frontmatter/properties、模板展开、链接改写（rename / 未链接提及 / Link）、阅读视图渲染管线（core/markdown.ts），或任何会写入用户 .md 文件的代码时，加载并逐条执行本清单。覆盖数据安全四类竞态、历轮已知根因 checklist、阅读视图字节级承诺、桌面 probe 时序纪律、可复跑回归资产。
---

# Geode 数据安全回归

> **第一底线**：任何路径下用户编辑不丢失、写入字节不损坏。自主开发模式无人工把关，本清单 = 最后一道安全网。改到上述任何处，**先对照本清单再提交**。

## A · 数据安全竞态清单（动 editor/vault 必过）

1. **自动保存防抖**：编辑 → 等防抖 → 确认落盘。
2. **关窗 / 切 tab flush**：未保存内容在组件销毁前 flush。
3. **重命名打开中的文件**：编辑不丢，引用自动更新（R16 改写引擎）。
4. **删除打开中的文件**：优雅处理不崩。
5. **外部修改 vs 脏编辑器**：last-writer-wins；watcher 仅在编辑器非脏时重载。
6. **文件夹路径事件**：重命名/移动文件夹不被误判为删除、不丢索引。

## B · 写入正确性 — 历轮根因 checklist（写 .md 前逐条对照）

- **首字节门控**（R24）：源文件 `from===0` 的 `#tag` 不能被 `from>0` 守卫漏屏蔽，否则 Link 把标签改写损坏。用按字节 `content[tag.from]==="#"` 门控。
- **wikilink 元字符**（R24）：名字含 `C#` / `F#` / `a|b` 等元字符时，`buildLinkInsert` 必须附带 R16 的 **post-rewrite 复解析断言**，不符即 skip + 报告。声称「镜像 R16」务必把那道断言一并抄上，否则错链静默落盘。
- **默认折叠态显式 seed**（R24）：不要靠 `collapsed.x ?? true` + state 初值 `{}` + toggle `!c[key]`——首点 `!undefined===true` 仍折叠。显式 seed `{x:true}`。
- **焦点抢占**（R23 critical）：同一 React commit 内「翻 preview→live + openModal」时，重建组件的 `view.focus()` effect 会在 modal autoFocus 之后抢焦点 → 键入污染正文并自动保存。`focus()` 必须带 modal 守卫。
- **活动视图门控**（R23 major）：`documents.getActiveView()` 闩锁字段会陈旧 → 第一方写命令可能写进非活动文件。写命令一律走 `getActiveFileEditorView` 双侧门控。
- **frontmatter**（R22）：一律走 `core/properties.ts` builder，**绝不手写 YAML 拼接**；序列化必设外部解析器视角。
- **模板变量**（R23）：走 `core/templates.ts` `expandTemplate`，**单趟替换**冻结语义，绝不重扫替换值。
- **对抗性输入维**（R21）：凡用户可输入文本，评审必设对抗性输入维度（元字符 / 空 / 超长 / CJK / 换行）。

## C · 阅读视图管线（改 `core/markdown.ts` 前）

先重读 ARCHITECTURE 的「字节级承诺」，并**先重建 `.calibration/r18-diff` 字节级套件再跑**（72+ 用例，Part A 33 例须「无新语法时字节一致」）。本机尚未重建——构建方式见 git R18 文档或按基线重新生成。

## D · 桌面 probe 时序纪律（WKWebView 无 CDP）

后台启动的 release 二进制：webview 在 t≈10s 后 `setTimeout`/写 promise 可能**永不归来**（App Nap / 节流）。因此：

- probe 断言放插件加载后的**前几秒**完成；
- 进度用 **fire-and-forget 写链**（绝不 `await` vault 写入再前进）；
- 挂载类断言查贡献点 Store（`plugins.sidebarPanels`）而非依赖侧栏展开的 DOM；
- 结果文件重跑前**先删**（`vault.create` 拒绝已存在路径）；probe 会改写 vault → 断言夹具每次运行前**重置**。

## E · 可复跑回归资产（本机）

- 浏览器：`node .calibration/r24-e2e.mjs`（12 断言）/ `r23-e2e.mjs`（22 断言，需 dev server :1420）。
- 桌面 probe（compat-vault）：`r24-probe`（12，经 `window.__geodeUnlinked` 钩子驱动真实 fs Link 写）/ `r23-suite`（9）/ `r23-templates`（10）。重跑前删 `r24-results.md`、`__r24/` 夹具、`Probe Template*.md`，重置 `Suite Home.md`。
- always-on probe 钩子（main.tsx）：`window.__geodeUnlinked.{find,linkAll,linkOne}`、`window.__geodeRename`——桌面靠它们驱动真实 fs 写校验。

> `.calibration/` 是 gitignore 的、换机不随迁。**风险**：这些回归基线一旦本机未重建即形同失守——长期应把基线数据入库或交 CI，别让回归只是口头约定。
