# 续接提示词（重开对话时直接粘贴）

```
继续开发 Geode（C:\Users\16778\Desktop\开发\rock，Obsidian 复刻桌面应用，当前 v0.3.0）。
启用 workflows。

按顺序读这四个文档再动手：
1. docs/ROADMAP.md      — 核心使命（不变项）、四条底线、方向校准、R4 优先级
2. docs/OBSIDIAN-COMPAT.md — 本轮头号输入：Obsidian 插件兼容层的判断/Tier 表/验收套件
3. docs/DEVELOPMENT.md  — 每轮编排节奏（契约→并行 agent→评审+对抗验证→双端验证）、
                          数据安全回归清单、验证手段（?bench=N、AppHandle 探针）
4. docs/ARCHITECTURE.md — 分层规则与核心 API 契约（并行开发的宪法）

本轮目标（R4）：P0 = Obsidian 插件兼容层 T0+T1 + 共享文档模型（两者见 ROADMAP 表）。
实现任何 obsidian API 前，先 WebFetch 对照 docs.obsidian.md 与
github.com/obsidianmd/obsidian-api 的 obsidian.d.ts 校准签名，不凭记忆写 API。
完成标准沿用四条底线 + OBSIDIAN-COMPAT.md 的验收方式（真实插件套件 + 杀手演示）。
```

## 给接续者的三句话背景

- 开发模式已验证三轮：**契约先行 + Workflow 并行 agent + 多维评审 + 逐条对抗验证**，
  R1/R2/R3 共确认 37 处缺陷零误杀，全部修复或显式延期（见 ROADMAP 技术债）。
- 桌面端用 `geode.exe <vault路径>` 直开实测；注意用户可能正在使用机器，
  SendKeys 注入前必须确认前台窗口，失败立即停手查 `git status`。
- PowerShell 5.1 改源码会 mojibake——只用 Read/Edit/Write 工具碰文件。
