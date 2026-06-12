# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（/Users/maoliang/Desktop/geode，Obsidian 复刻桌面应用，当前 v0.22.0，
开发机 macOS——R20 起从 Windows 迁移）。启用 workflows。
远端：https://github.com/AlexHercules/geode（私有，origin/master）——每轮收尾提交后
git push。用户口径（2026-06-11）：发布不着急，暂不做渠道/证书决策。

按顺序读这五个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R22 完成记录、R19+ 候选池（执行队列）
2. docs/OBSIDIAN-COMPAT.md — Tier 表、R22 套件回归（probe 方案）、缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏、数据安全回归清单、macOS 环境口径（必读）
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（R22 节含 properties 子集/序列化
   冻结 + As-built 13 根因修复记录；R21 搜索语义；R16 改写引擎算法动 vault/documents
   前必读）
5. docs/DISTRIBUTION.md — 发布流程（Windows 向，本机仅参考）

候选池执行口径（用户拍板 2026-06-12）：逐项推进，无需再问主线——R19 mermaid ✓、
R20 主题 CSS ✓、R21 搜索运算符 ✓、R22 Properties 可视化编辑 ✓，下一项按建议顺序取
**模板系统（新建套模板 + 日期变量）**，其后未链接提及；真实发布渠道 + Authenticode
证书仍待用户拍板（暂缓口径 2026-06-11，不主动启动）。验收沿用四条底线 +
OBSIDIAN-COMPAT 套件矩阵不回退（macOS 下 = probe 插件方案）。
```

## 给接续者的三句话背景

- 开发模式已验证二十二轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维
  评审 + 逐条对抗验证 + 双端运行时实测**。R22（Properties 面板）评审 25 finding →
  25 确认 2 证伪（去重 13 根因：3 critical + 5 major）：critical 是 ① 面板 widget 的
  margin 折叠逃出 CM 高度测量——**带 frontmatter 笔记所有鼠标点击偏一行**（修复 =
  垂直间距改 padding + flow-root；CM 块 widget 样式必须保证 rect 含全部占位）；
  ② `---`/`- ` 前缀键名序列化即闭合围栏/匿名行（键名谓词收紧 + serializeEntry 逐笔
  往返自验证兜底）；③ \r/U+2028/U+2029 杀 re-parse KV 正则（全行终结符拒写；JS 正则
  字面量内不能写裸 U+2028/2029）。**两条新教训**：序列化正确性必设「外部解析器视角」
  评审维（尾冒号写法自家子集能往返、套件全绿掩蔽，js-yaml 一测即炸）；React 卸载
  清理要在 DOM 摘除前动 activeElement 的，必须 useLayoutEffect（passive cleanup 跑太晚，
  实测踩过）。R21 教训继续有效：用户可输入文本处理必设对抗性输入维。
- **环境是 macOS（R20 迁移）**：dev server 必须 tmux 起（hook 强制）；curl 加
  `--noproxy '*'`；Playwright 在 `.calibration/` 独立 package.json（别在仓库根 npm i）；
  **cargo 不在默认 PATH**——`PATH="$HOME/.cargo/bin:$PATH"` 前缀再跑 cargo/tauri build。
  桌面 = 裸二进制 `src-tauri/target/release/geode <vault>` + **probe 插件自检**
  （WKWebView 无 CDP；`.geode/plugins/*.js` 写结果文件回 vault，重跑前先删结果文件）。
  可复跑验证资产：浏览器 `r20-e2e.mjs` 33 断言 / `r21-e2e.mjs` 29 / `r22-e2e.mjs` 84
  （需 dev server）；node 直跑 `r21-parser-tests.mjs` 51 用例 / `r22-props-tests.mjs`
  150 用例；桌面 probe r20-suite(9)/r21-search(14)/r22-props(22) 在 compat-vault。
  **风险待用户确认：`.tauri-keys/` minisign 更新签名私钥没有随云端迁移到本机**——
  丢失 = 永远无法向已装机用户推更新；原 Windows 机（C:\Users\16778\Desktop\开发\rock)
  或其备份里应该还有，**每轮务必提醒用户找回备份直至确认**。`.calibration/r18-diff`
  字节级 diff 套件也未重建——**改 core/markdown.ts 前先重建**（HANDOFF 历史版本有命令）。
- 守住的老规矩：UI 字符串走 t()/useI18n()（命令键在 dict.app.ts 的 cmd.*）；命令/插件
  name 是 thunk；live↔source 走 modeCompartment；阅读视图管线改动先重读"字节级承诺"+
  跑 diff 套件；agent 行内注释不能修订契约（上报 chief 裁决——R22 五个 agent 共上报
  19 条偏差，全部裁决入档）；frontmatter 相关一律走 core/properties.ts 的 builder
  （绝不手写 YAML 拼接——opaque 条目/键名谓词/往返自验证都在里面）；挂载竞态用
  一次性消费 Store（revealTarget/addPropertyRequest 先例）而非同步 CustomEvent；
  红色错误样式变量是 `--danger`；mermaid 升级前复核 ARCHITECTURE R19 两坑；R16 改写
  引擎五步算法动 vault/documents 前必读。套件 5 插件 + 三个轮次 probe 在 compat-vault
  本机可用（probe 结果文件重跑前先删）。
