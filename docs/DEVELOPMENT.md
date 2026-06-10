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
- 桌面：`geode.exe demo-vault` + 截图；外部改 `demo-vault/*.md` 验证 watcher；
  `demo-vault/.geode/plugins/hello-status.js` 验证外部插件
- demo vault 是回归夹具，测试痕迹要清理后再提交
