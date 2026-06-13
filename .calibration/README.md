# .calibration — Geode 回归校准套件

Geode「双端可验证」底线里**浏览器侧**的自动化回归。这里的脚本与基线**入库**，
确保换机、CI、未来轮次都能复跑——不再像过去那样「gitignore 掉、换机即丢」。

## 入库策略（见仓库根 `.gitignore`）

- ✅ 入库：`*.mjs`（各轮 E2E 脚本）、`package.json`、`package-lock.json`、字节级基线数据
- 🚫 忽略：`node_modules/`、`*-results.md`（probe 运行产物）、`__*/` 临时夹具、`*-vault/`（会被 probe 改写的临时 vault）

## 本地怎么跑

```sh
# 1) 装依赖（首次 / 换机）
cd .calibration && npm ci && npx playwright install chromium && cd ..
# 2) 起 dev server（另开终端或后台）
npm run dev                       # :1420
# 3) 跑某轮套件
node .calibration/r24-e2e.mjs     # 未链接提及（12 断言）
node .calibration/r23-e2e.mjs     # 模板系统（22 断言）
```

curl 探活记得加 `--noproxy '*'`（见 CLAUDE.md 环境口径）。

## CI

`.github/workflows/ci.yml` 在 push / PR 自动跑：typecheck → build → 浏览器 E2E（r23 / r24）。
桌面端（Tauri + WKWebView probe）不在 CI，留本地（见 data-safety skill §D 时序纪律）。

## 待重建清单（换机未随迁，动对应代码前先建）

- **r18-diff 字节级套件**（72+ 用例）：改 `core/markdown.ts`（阅读视图管线）前**必须先重建再跑**。构建方式见 git R18 文档；本机尚未重建。
- **compat-vault**（5 个 Obsidian 插件夹具）：按版本从 GitHub 重下；用于 compat 套件 probe。
- **theme-vault**（Minimal 主题夹具）：R20 主题 CSS 套件用。

## 让质量闸在你的 shell 里生效

`.claude/hooks/guard-bash.sh` 会在 `git commit` 前跑 `npm run typecheck`。若你用 nvm 且非交互 shell 未 source node，守卫会警告「找不到 npm」并放行——把 node 放进登录 PATH（或在 `~/.claude/settings.json` 里配 PATH）即可让质量闸真正拦截。
