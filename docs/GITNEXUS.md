# GitNexus 开发接入

> 版本基线：GitNexus 1.6.6（2026-07-10）
> 仓库：`/Users/cutealexander/Code/active/geode/geode`

GitNexus 把 Geode 的文件、符号、调用、导入、模块聚类和执行流程索引成一个本地知识图谱。它是开发定位与影响分析工具，不替代源码阅读、测试、data-safety 或对抗评审。

## 已配置内容

- 全局 CLI：`/Users/cutealexander/.npm-global/bin/gitnexus`
- Codex MCP：`~/.codex/config.toml` 的 `mcp_servers.gitnexus`
- Codex skills：`~/.agents/skills/gitnexus-*`
- Codex PreToolUse hook：`~/.codex/hooks.json`
- 仓库索引：`.gitnexus/`（本地生成，已 gitignore）
- 项目配置：`.gitnexusrc`

`.gitnexusrc` 使用 `indexOnly`，只生成知识图谱，不自动改写本仓已有的 `AGENTS.md`、`CLAUDE.md` 或 `.claude/skills/`。Geode 的开发契约继续由本仓文档维护。

## 基本命令

所有命令在仓库根目录执行：

```sh
gitnexus status
gitnexus analyze
gitnexus list
```

- `status`：检查索引是否存在、是否过期。
- `analyze`：首次创建或增量刷新索引。
- `list`：查看全局已注册的仓库。
- `analyze --force`：索引损坏或解析器升级后全量重建。
- `clean`：删除当前仓库索引并从全局 registry 注销。

新机器的一次性安装：

```sh
npm install -g gitnexus@latest
gitnexus setup
```

Apple Silicon + Node 24 若出现 `No native build was found`，在全局 GitNexus 安装目录补编译可选 grammar：

```sh
cd "$(npm root -g)/gitnexus"
npm rebuild tree-sitter-dart tree-sitter-proto tree-sitter-swift tree-sitter-kotlin
```

默认不开 embeddings。Geode 以 TypeScript 符号、调用链和结构搜索为主，先使用 BM25 + 图关系；需要语义搜索时再显式运行：

```sh
gitnexus analyze --embeddings
```

## 接入 `/continue` loop

### Step 0 · 定位

```sh
gitnexus status
gitnexus query "本轮功能或问题"
gitnexus context SymbolName
```

用途：

- `query` 找相关模块、执行流程和关键符号；
- `context` 查看符号的调用方、被调用项和所属流程；
- 结果只用于确定阅读范围，最终契约仍以源码和 `ARCHITECTURE.md` 为准。

### Step 1 · 契约与改动前

跨模块改接口、重构、移动或重命名符号前：

```sh
gitnexus impact SymbolName --direction upstream --depth 3
```

`upstream` 回答「谁依赖它」，用于补全所有权表、回归套件和兼容影响。若同名符号歧义，用 `--file` 或 `--uid` 收窄。

### Step 3/4 · 集成与评审

实现完成、评审前：

```sh
gitnexus detect-changes --scope all
```

把 affected processes 和风险级别作为 reviewer 输入。它用于发现遗漏的调用链，不替代 `git diff`、typecheck、E2E、desktop probe 或 data-safety。

### Step 6 · 收尾

提交完成后刷新增量索引：

```sh
gitnexus analyze
gitnexus status
```

这样下一轮读取到的是最新 commit。若当前工作树仍有未提交改动，`analyze` 会按工作树现状建索引；提交后再跑一次可让索引提交信息与代码同步。

## Codex 中的 MCP 用法

重启 Codex 后，GitNexus MCP 会暴露仓库资源与工具。标准顺序：

1. 读 `gitnexus://repos`；
2. 读 `gitnexus://repo/geode/context`，确认 freshness；
3. 按任务使用 `query`、`context`、`impact`、`detect_changes`；
4. 只有需要自定义图查询时才读 `gitnexus://repo/geode/schema` 并使用 `cypher`。

典型任务：

| 任务 | 首选能力 |
|---|---|
| 理解陌生模块 | `query` → `context` → process resource |
| 调试跨模块错误 | `query` 查流程 → `context` 查调用链 |
| 修改公共接口 | `impact --direction upstream` |
| 重构/重命名 | `impact` → `rename` dry-run → 人工核对 |
| 提交前检查 | `detect_changes --scope all` |

## 使用边界

- GitNexus 图来自静态分析；React 状态、动态插件加载、字符串命令 id、Tauri IPC 和运行时 DOM 行为仍需源码与实测核验。
- `.calibration/` 中的大量 probe 可能不会全部成为图中的主流程；回归范围继续以历轮根因和文档矩阵为准。
- 索引过期时先 `gitnexus analyze`，不要依据 stale graph 决定契约。
- 不把 `.gitnexus/` 提交进 Git；可提交 `.gitnexusrc` 作为团队统一配置。
- Codex 新增 MCP 配置后需要重启应用或开启新任务才能加载；当前已运行的任务不会热加载新工具。
