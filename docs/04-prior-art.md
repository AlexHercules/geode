# 现有项目调研与借鉴清单

> 调研日期：2026-06。结论先行：**流水线写长篇、设定结构化注入、prose lint 做 CI，三件事都有成熟先例可抄；但"git 分支 = 故事分支 + canon 快照继承 + 沿链分成"这个组合没有人做过**——最接近的项目各占一角，没人拼完整。

## 一、AI 长篇写作流水线（抄工位划分）

| 项目 | 定位 | 可借鉴的具体机制 |
|---|---|---|
| [WriteHERE](https://github.com/principia-ai/WriteHERE)（EMNLP 2025 oral） | 递归任务分解写长文 | 把"写一章"递归分解为可调度的异构子任务（检索/推理/写作三类），任务图动态生长——比固定工位更细的分解粒度，可用于章内场景级拆分 |
| [AIStoryWriter](https://github.com/datacrystals/AIStoryWriter) | 高质量长篇生成 | 大纲→逐章→**逐章修订循环**的多 pass 结构；每章生成后有独立的 outline-revision 检查 |
| [GOAT-Storytelling-Agent](https://github.com/GOAT-AI-lab/GOAT-Storytelling-Agent) | 无人监督写中篇 | 故事元素（人物/场景/事件）作为显式中间数据结构互相约束，而非全靠上下文 |
| [NousResearch/autonovel](https://github.com/NousResearch/autonovel) | 种子概念→成书全自动 | 端到端流水线工程化程度最高（写作→修订→排版→封面→落地页），证明"全程无人"可行，可参考其阶段衔接 |
| [StoryCraftr](https://github.com/raestrada/storycraftr) | CLI 写作工具 | **CLI + 项目目录约定**的形态与我们的本地软件设想一致；worldbuilding/outline/chapters 命令划分 |
| 学术系：Dramatron、Re3、DOC | 分层生成研究 | 共同结论：**层级化（log line→大纲→章纲→正文）+ 每层显式中间产物**是长篇一致性的关键——印证我们的章纲 gate 设计 |

**它们共同没解决的**：① 设定与正文不版本化，改了设定旧章不可追溯；② 一致性靠生成时小心，没有独立的机器裁决 gate；③ 单线叙事，无分支模型。这三点正是我们的差异所在。

## 二、设定结构化与按需注入（抄 canon 的运行时形态）

[SillyTavern World Info / lorebook](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)（[机制详解](https://deepwiki.com/SillyTavern/SillyTavern/6.1-world-info-system)）是事实标准，直接借鉴：

- **条目 = 关键词(keys) + 注入内容(content) + 触发配置**：扫描近期文本命中关键词才注入对应设定——这就是我们"上下文最小权限"的现成实现方案，比"按出场人物手工挑切片"更自动；
- **token 预算分配**：激活条目超预算时按优先级裁剪；
- **递归激活**：注入的设定内容可再触发其他条目（A 人物卡提到 B 组织 → B 组织条目跟着注入），适合网文里盘根错节的势力设定；
- **sticky / cooldown / delay**：条目激活的时间维度控制，可映射为"伏笔埋设后保持在场 N 章"。

落地：`canon/` 里每个条目（人物卡、势力、地点）带 frontmatter `keys:` 字段，草稿工位前跑一个确定性的 lorebook 解析器决定注入集——**注入决策本身是确定性代码，不是 LLM**，符合约束哲学。

## 三、Prose Lint 与文档即代码（抄 gate 的工具层）

| 工具 | 角色 | 用法设想 | 局限 |
|---|---|---|---|
| [Vale](https://github.com/vale-cli/vale) | markup 感知的散文 linter，YAML+正则写自定义规则 | 禁用词表、AI 味词汇表（"不禁""仿佛"滥用）、视角词检查（第一人称分支禁"他想道"）；[GitLab](https://docs.gitlab.com/development/documentation/testing/vale/)、[Datadog](https://www.datadoghq.com/blog/engineering/how-we-use-vale-to-improve-our-documentation-editing-process/)、[Elastic](https://github.com/elastic/vale-rules) 的规则仓库是现成的"风格即代码"范本 | 对中文分词不敏感，规则基本要靠正则自己写 |
| [textlint](https://www.cuobiezi.net/public/labs/guide/textlint.html) | JS 插件化文本 linter | 中日混排规则可复用于中文（[全半角空格等](https://sspai.com/post/55006)）；自定义规则是 JS 函数，表达力比 Vale 强，适合写"句长分布""段落节奏"这类统计型规则 | 中文现成规则少，生态主要是日文 |
| [pycorrector](https://github.com/shibing624/pycorrector) / [ChineseErrorCorrector](https://github.com/TW-NLP/ChineseErrorCorrector)（ACL 2026） | 中文错别字/语法纠错模型 | 定稿 gate 的错别字扫描，输出 ≥阈值错误数即打回 | 模型有误报，作 warning 而非 blocker |
| remark-lint + JSON Schema | Markdown 结构与 frontmatter 校验 | 章纲 yaml、人物卡 frontmatter 的 schema gate，纯确定性 | — |
| promptfoo / deepeval | LLM 评测框架 | **审查团不用自己造**：把"canon 一致性""人物口吻"写成 LLM-rubric assertion，框架自带阈值判定、缓存、CI 集成 | rubric 质量决定一切，需要标注集校准 |

**推荐 gate 分层**（确定性在前，便宜在前）：
1. schema/结构 gate：remark-lint + JSON Schema（毫秒级，零成本）
2. 词法 gate：Vale/textlint 规则包（禁用词、视角、排版）
3. 纠错 gate：pycorrector 类（错别字 warning）
4. LLM 评审 gate：promptfoo 式 rubric 审查团（最贵，最后跑）

## 四、写作软件的项目模型（抄目录与元数据）

- [novelWriter](https://novelwriter.io)：项目 = 纯文本文件树 + 标签系统（@char/@plot/@location 引用，可静态检查"引用了不存在的人物"——**这是免费的确定性一致性 gate**，直接抄）；
- Manuskript：人物卡字段设计（动机/目标/冲突/弧线）可作我们人物卡 schema 的字段参考；
- Obsidian Longform：场景为最小单元、章节是场景的编排——印证章内再分场景的粒度。

## 五、分支协作小说的先行者（确认差异点）

- [Internet Book Project](https://www.internetbookproject.com/)：明确宣称 "git-like branching"、无限分叉——但单元是 **11 个词**，玩具粒度，无设定继承、无分成；
- [StoryFork](https://moge.ai/product/storyfork)、[Multiverse Stories](https://multiversestories.app/)：社交化分支续写——人写，无 AI harness，无 canon pack，分支质量无 gate；
- [Storyfall](https://storyfall.com/)、inklewriter：单作者的选择肢互动小说，不是开放续写。

**结论**：分支续写的需求被反复验证（这些平台存在即证明），但都缺三样：① 机器可执行的设定继承（他们继承的只是"前文"，不是结构化 canon）；② 质量 gate（烂分支污染是这类平台的通病）；③ 沿链分成的经济系统。这三样恰好分别是我们的 harness、gates、charter。**组合本身就是壁垒。**
