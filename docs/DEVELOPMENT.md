# Geode 开发引导

> 给未来的开发轮次（人类或 AI agent）的最短上手路径。核心使命见 [ROADMAP.md](ROADMAP.md)。

## 5 分钟上手

```sh
npm install
npm run dev          # 浏览器模式：内存 demo vault，UI 全功能，可被 Playwright 验证
npm run tauri dev    # 桌面模式：真实文件系统（首次 Rust 编译约 2 分钟）
npm run typecheck    # TS strict，必须 0 错误
npm run tauri build  # NSIS 安装包 → src-tauri/target/release/bundle/nsis/
```

桌面端调试技巧：`geode.exe <文件夹>` 直接打开该文件夹为 vault（跳过选择对话框）。

## 阅读顺序

1. `docs/ARCHITECTURE.md` — **必读**，分层规则 + 核心 API + 组件契约 + 本轮新增契约
2. `src/core/types.ts` → `vault.ts` → `metadata.ts` → `workspace.ts` — 数据模型主线
3. 你要改的 feature 目录（`src/features/<name>/`）
4. 插件相关看 `docs/PLUGINS.md`

## 不变的开发纪律

- **分层**：core 不依赖 React 组件 / features 互不 import / 颜色一律走 CSS 变量
- **契约先行**：跨模块接口改动先写进 ARCHITECTURE.md 再动代码
- **每轮节奏**（已验证两轮的编排模式）：
  1. 契约扩展（types/events/adapter 接口 + 外壳 stub，构建常绿）
  2. 并行开发（每个 agent 独占目录，prompt 冻结跨区签名）
  3. 集成验证（tsc + vite build + cargo check + 浏览器实测截图）
  4. 多维评审 → 对抗性核实 → 只修确认缺陷
  5. 桌面重建 + 真实文件系统实测 → 提交 + 报告
- **数据安全清单**（动编辑器/vault 必须回归）：自动保存防抖、关窗 flush、
  重命名/删除打开文件、外部修改 vs 脏编辑器（last-writer-wins）、文件夹路径事件

## 验证手段

- 浏览器：Playwright（dev server :1420，`data-testid` 全覆盖）
- 性能：`http://localhost:1420/?bench=10000` 生成确定性合成 vault（不持久化，
  不污染正常 workspace）；`window.__geodePerf` 暴露各环节耗时，口径见 docs/PERFORMANCE.md
- 核心 API 断言：浏览器里 `window.geode.registerPlugin({id,name,onload(app){window.__app=app}})`
  拿 AppHandle，直接驱动 workspace/vault 验证 core 行为（R3 回归即此法）
- 桌面：`geode.exe demo-vault` + 截图；外部改 `demo-vault/*.md` 验证 watcher；
  `demo-vault/.geode/plugins/hello-status.js` 验证外部插件
- i18n（R8）：UI 字符串一律 `t()/useI18n()`（core/i18n.ts，键放对应命名空间的
  core/i18n/dict.*.ts 片段）；验证用设置页 `settings-language` 下拉 + localStorage
  `geode.locale`；watcher 回声口径：`window.__geodeWatchEcho` 计数器、浏览器
  `window.__geodeFireWatch(paths)` 模拟外部事件
- 自动更新（R9）：发布/密钥/签名全流程见 docs/DISTRIBUTION.md；本地 E2E 口径——
  `.update-test/server.mjs` 起 :17321 静态服务器 + 测试构建（conf 临时指 localhost +
  `dangerousInsecureTransportProtocol`，不得提交），探针 `.calibration/r9-up1~3.js`
  （检查/负向篡改签名/正向安装），负向必须含"合法编码错误签名"用例
- demo vault 是回归夹具，测试痕迹要清理后再提交

## macOS 环境口径（R20 起，开发机迁移；R23 起再迁新机
`/Users/cutealexander/Code/active/geode/geode`）

- 浏览器 E2E：Playwright 装在 **`.calibration/`**（gitignore，独立 package.json
  ——**别在仓库根 npm i**，会污染主 package.json；R23 实测变体：`.calibration`
  里若还没有 package.json 就 `npm i`，npm 会向上爬到仓库根照样污染——**先写
  package.json 再装**）；dev server 经 tmux 或后台进程起（R23 新机无 tmux/hook，
  `npm run dev` 后台直跑可用）；curl 探活加 `--noproxy '*'`。
- **桌面 probe 时序纪律（R23 新教训）**：从 shell 后台启动的 release 二进制，
  webview 在 t≈10s 后 setTimeout/写入 promise 可能永不归来（App Nap/WKWebView
  节流）——probe 断言放插件加载后的前几秒完成；进度用 fire-and-forget 写链
  （绝不 await vault 写入再前进）；挂载类断言查贡献点 Store
  （`plugins.sidebarPanels`）而非依赖侧栏展开的 DOM。结果文件重跑前先删
  （vault.create 拒绝已存在路径），probe 会改写 vault 内容——断言夹具每次
  运行前重置。
- **cargo 不在非交互 shell 的默认 PATH**：跑 `cargo check`/`npm run tauri build`
  前缀 `PATH="$HOME/.cargo/bin:$PATH"`——漏掉时 tauri build 报 "failed to run
  cargo metadata" 但管道下游可能呈现 exit 0 假象（R21 踩坑）。
- 桌面验证：`npm run tauri build` 产出裸二进制 `src-tauri/target/release/geode`
  （bundle targets 是 Windows NSIS 配置，macOS 下无 .app/.dmg——验证用裸二进制
  `./geode <vault绝对路径>` 直开即可）。**WKWebView 无 CDP**——桌面 E2E 改用
  probe 插件方案：`<vault>/.geode/plugins/*.js` 探针拿 `window.geode.app` 做
  断言、结果写回 vault 文件，外部读文件判定（r20-probe.js / r20-suite-probe.js
  先例，在 .calibration/theme-vault 与 compat-vault）。`screencapture` 需要
  终端屏幕录制权限（TCC，未授予则截图跳过）。
- 重建资产（gitignore 不随 git 迁移）：compat-vault 5 插件 GitHub 按版本重下；
  `.calibration/theme-vault`（Minimal 主题夹具）；r18-diff 字节级套件**尚未
  在本机重建**——改 core/markdown.ts 前必须先重建（HANDOFF 有命令）。
- Windows 专项（NSIS 安装包/更新链路 E2E/nldates 逐键 CDP 探针）本机不可执行，
  发布相关验证留 Windows 机或 CI。
