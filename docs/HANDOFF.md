# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.4.0）。
启用 workflows。

按顺序读这四个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、R4 完成记录、R5 优先级
2. docs/OBSIDIAN-COMPAT.md — Tier 表（T0/T1/T1.5 已落地）、R4 套件矩阵、显式缺口表
3. docs/DEVELOPMENT.md  — 每轮编排节奏（契约→并行 agent→评审+对抗验证→双端验证）、
                          数据安全回归清单、验证手段（?bench=N、?obsfixture=1、AppHandle 探针）
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（含 R4 共享文档模型/compat 层契约）

本轮目标（R5）：P0 = compat T2 纵深 — moment 打包 + registerView/ItemView 真实挂载
（套件实测的两大核心功能阻断点：nldates 日期解析、Recent Files/Calendar 面板）。
实现任何 obsidian API 前，先重新生成 .calibration/（gitignore 不入库）：
curl -o .calibration/obsidian.d.ts https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts
然后跑校准 workflow 提取相关签名，不凭记忆写 API。
完成标准沿用四条底线 + OBSIDIAN-COMPAT.md 的套件矩阵（5 插件核心功能列全 ✓ 为 R5 目标）。
```

## 给接续者的三句话背景

- 开发模式已验证四轮：**契约先行 + Workflow 并行 agent（独占文件所有权）+ 多维评审 +
  逐条对抗验证**。R1-R4 共确认 61 处缺陷零误杀，全部修复或显式延期（见 ROADMAP 技术债）。
- 验收套件在 `compat-vault/`（gitignore，本地再生：5 个真实社区插件 + community-plugins.json），
  浏览器注入口 `window.__geodeObsidianPlugins` + `?obsfixture=1` 内置夹具插件；
  桌面端 `geode.exe <vault路径>` 直开实测，SendKeys 注入前必须确认前台窗口。
- PowerShell 5.1 改源码会 mojibake——只用 Read/Edit/Write 工具碰文件。
