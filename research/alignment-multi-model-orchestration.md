# 多模型编排对齐调研：谁在做 AI 当包工头、UX 怎么做

**Date:** 2026-10-04
**Scope:** 对齐愿景 `ai-orchestration-vision.md` 的第 2 件「AI 自主编排多模型协作」。重点找**可观察的 UX 模式**——用户怎么看见"哪个模型干了什么"、半成品怎么展示和合并、失败怎么说、钱和耗时怎么透明。
**方法声明：** 下面所有结论都来自我实际读过的代码/文档/页面，不是训练印象。凡是没有第一手验证的都标了"未亲验"。

---

## 一、对齐目标 Top 3（按 UX 可借鉴度排名）

### #1 agentco — 包工头 UX 的现成答案
**是什么：** 一个开源的"虚拟公司"产品：Director 只管规划和派单、从不自己动手；Worker 来一个干一件事、写文件、消失。它的 `docs/SPEC-ui.md` 是一份完整写好的**编排 UX 规范**，几乎每条都能直接抄。

**抄什么（每条都经过验证，在仓库里读到原文）：**
- **计划条（plan strip）：** 计划最多 6 步、每步 ≤10 个字，直接盖在主界面上、运行期间常驻，点开看细节（哪个任务、谁在做、产出什么文件、花了多少钱）。我们的"任务进度小卡片"就是这个东西。
- **plan-only 模式：** Director 规划完**停下来等用户点头**再烧 token 执行；新用户默认打开。理由原文是"scope control"——这正是醒醒要的那种"我先看看你打算干嘛"。
- **一线一人（In Progress）：** 每个 worker 只显示**一行**自己写的 `say` 字段（人类语言、不用额外 LLM 翻译），原地更新、不刷屏；不许出现工具名、JSON、长路径；等上游就明写"Waiting on research results"，绝不留白；等用户时浮到最上并带回复按钮。
- **防懵四问（anti-confusion checklist）：** 每个界面不点开就必须回答——我现在在第几步/共几步？谁在干什么？已经花了多少？有没有在等我？停止按钮在哪？（停止按钮永远可见，不许藏菜单里。）
- **Receipt 协议：** 每个 worker 交回 ≤800 token 的回执，带一个人类可读的 `say` 字段；原始 transcript 和**按 token 的成本表**都是一键可达，但默认不怼脸上。——"用户看见的是公司在干活，不是终端在刷日志；高级日志永远一键可达，不隐藏也不往前推。"
- **诚实失败：** `task.blocked { task_id, reason, question? }` 是第一等事件；失败原因分类后问用户。
- **内部人不露脸：** `concierge`（给 Director 打杂的工具）**不出现在员工列表**——"它是 Director 的工具，不是员工。"我们的路由器探测、内部 helper 调用同理，绝不能渲染成假人设。

**来源：**
- README（Director/Worker 架构、plan+成本表一键可达）：https://github.com/minhvq36/agentco
- SPEC-ui.md（计划条、plan-only、一线一人、防懵四问、SSE 事件、成本表）：https://raw.githubusercontent.com/minhvq36/agentco/main/docs/SPEC-ui.md

### #2 AutoGen Studio — "哪个模型干了什么"的归因机制
**是什么：** 微软 AutoGen 的低代码界面。我 clone 了仓库、读了前端代码（`frontend/src/components/views/playground/chat/`），不是看介绍文章。

**抄什么（代码级验证）：**
- **每条消息带 source 署名：** `rendermessage.tsx` 按 `message.source`（agent 名）渲染归因；LLM 内部调用事件（`llm_call_event`）渲染成紧凑事件行，不跟正文混在一起。——这就是"翻译扔翻译强的"之后，用户在界面上该看到的样子：**每个产出块都署名是哪个模型干的**。
- **运行级汇总行：** `runview.tsx` 在每次运行底部显示 `{N} tokens | {M} messages`；每条消息可展开看 token 数。长消息默认折叠"Show more"。
- **消息流图（message flow graph）：** `agentflow/` 组件把 agent 之间的通信画成节点/边图，一键切换。复杂编排时给用户一个"谁把活儿传给了谁"的总览，而不是让她读 transcript。
- **人工介入请求带倒计时：** `inputrequest.tsx`——AI 需要用户拍板时弹出输入框，带可配置的超时倒计时（默认 3 分钟），超时自动走默认分支。我们的"发消息前确认/审批"就该长这样。

**来源：**
- 仓库前端代码：https://github.com/microsoft/autogen （路径 `python/packages/autogen-studio/frontend/src/components/views/playground/chat/`：`rendermessage.tsx`、`runview.tsx`、`agentflow/`、`inputrequest.tsx`）
- 微软官方介绍（inner monologue + 轮数/耗时/成本展示）：https://www.microsoft.com/en-us/research/blog/introducing-autogen-studio-a-low-code-interface-for-building-multi-agent-workflows/

### #3 Deep Research 四家（Gemini / OpenAI / Perplexity / Anthropic）— 消费级"计划-批准-合并-诚实"全套
**是什么：** 四家 deep research 产品的 UX 已经被别人做过一次完整对比（带一手来源），我读了那份对比 spec 的第 2 节和第 11 节"verified facts"。

**抄什么（每条都有出处）：**
- **计划先行、可编辑、等批准：** Gemini 是"创建计划 → Edit plan → Start research"三步；OpenAI 会先问澄清问题再给可编辑计划，且**运行中可中断**以收窄范围/换来源。这是我们 plan-only 模式在消费级产品的对应物。Anthropic 反例：plan 只写进内部 memory、用户看不见——这是反模式（见第三节）。
- **边跑边播报：** Perplexity 在报告出来前先流式推送 key findings；运行中可追加 follow-up 问题。四家都展示可见的进度。
- **合并时的诚实写法：** 分歧要写出来——"A 说 X[3]，B 说 Y[7]；B 更晚且是一手来源，所以取 Y"；结论带置信度（high/medium/low）加一句话理由；验证不了的进 limitations。这正是我们"诚实原则"的合并层写法：**哪个模型干不了/哪句没把握，直说，不拿假的顶**。
- **规模感的分级：** Anthropic 工程博客公开的派单规则——简单事实 1 个 agent、对比 2–4 个、开放问题 10+；每个子 agent 拿到的是 objective + 输出格式 + 工具指引 + 清晰边界。我们的"按活儿派单"需要这套分级，避免杀鸡用牛刀。
- **成本公开：** Gemini 官方公布过单次任务成本（标准版约 $1–3、Max 版约 $3–7；~80/160 次搜索、250k/900k input tokens）。消费级产品里成本透明是明规则。

**来源：**
- 对比 spec 全文（第 2 节行为对比表、第 11 节一手来源）：https://raw.githubusercontent.com/acaprino/daodan/HEAD/docs/superpowers/specs/2026-08-23-research-deep-research-parity-design.md
- Anthropic orchestrator-worker 工程博客：https://www.anthropic.com/engineering/built-multi-agent-research-system
- Gemini 支持文档（计划流程）：https://support.google.com/gemini/answer/15719111
- OpenAI Deep Research FAQ：https://help.openai.com/en/articles/10500283-deep-research-faq
- Perplexity 博客：https://www.perplexity.ai/hub/blog/introducing-perplexity-deep-research

---

## 二、值得抄的具体机制（按嘟嘟模块归位）

### 2.1 thinking 抽屉 v2（编排发生时的"正在干活"视图）
| 机制 | 从哪抄 | 怎么做 |
|---|---|---|
| 派单条目 = 行动列表项 | agentco In Progress | 每行：模型/分组名 + 一句人话 `say`（"翻译组正在翻第 3 段"），原地更新，不刷屏 |
| 署名 | AutoGen Studio `message.source` | 每个派单产出块署名"谁干的"；内部 LLM 调用事件渲染成紧凑行，不占正文 |
| 并行计数 | agentco plan strip | 同一步多个子任务并行时显示 `⟳ 2/3` |
| 每项成本 | AutoGen Studio runview | 派单项可展开看 token/耗时；一次编排底部一行汇总 |
| 流图总览 | AutoGen Studio agentflow | 编排复杂时（≥3 个模型接力），给一个"谁→谁"的小流图，一键开合 |

### 2.2 任务进度小卡片（已有功能，加编排语义）
- agentco 计划条：≤6 步、每步 ≤10 字、状态 `○未开始 / ⟳进行中 / ✓完成 / ⚠有问题 / ⏸等你`；点某步展开"哪个模型、产出什么、花了多少"。
- **plan-only 默认开**（新用户）：AI 先把"打算派给谁"列出来，醒醒点头/改/删了再跑。对应 Relevance AI 的三档审批（见下）。
- ⏸等你的项永远浮顶 + 停止按钮永远可见（agentco 防懵四问）。

### 2.3 API 分组（"团队花名册"视图）
- agentco Team 面板：每个成员 = 头像、名字、状态、当前任务；点进员工卡看**历史任务、平均成本、模型档位、预算**。我们的 API 分组页就该长这样——智能自适应攒下来的"某模型擅长/老挂"数据，第一次有了用户可见的形状。
- Relevance AI 的**按边审批**：每条委派关系设 Auto Run / Approval Required / Let Agent Decide（AI 按置信度自己决定要不要问人）。抄：每个分组可设"AI 可直接使唤 / 先问我 / AI 看情况"；**新分组默认从严，跑顺了再放宽**（Relevance 官方建议）。
- 来源：https://github.com/relevanceai/relevance-docs/blob/HEAD/site/content/docs/get-started/introduction.mdx ；https://emergent.sh/learn/ai-agents-for-small-business

### 2.4 工具调用 UI
- LangSmith trace 视图：左树右详情；节点按类型着色（LLM 蓝、工具紫）；Gantt 时间线一眼看出并行/串行；每行 run 显示状态、耗时、token。我们的工具调用抽屉详情页照这个信息密度做。
- 来源：https://docs.langchain.com/langsmith/observability-studio ；https://github.com/dwinsi/llmfromscratch/blob/HEAD/saathi-langgraph/docs/book/18-langsmith-observability.md

### 2.5 纸条机制（给"派单"能力配说明书）
- 新能力"多模型派单"本身配一张纸条：什么情况下派单、派单三步（列计划→批→跑）、失败怎么说。AI 用过一次不再注入（现有规矩不变）。
- agentco 的 plan 约束值得抄进纸条：计划步骤数上限、每步字数上限——**写在 prompt 里的是约束，不是建议**。

### 2.6 失败与诚实（死线级）
- 失败卡片四要素：哪个模型挂了 / 失败分类（超时？拒答？看不懂？）/ 已经做了什么（重派一次→换模型→降级）/ 现在需要你做什么。对应 agentco `task.blocked{reason, question?}`。
- **失败升级链**（daodan spec §4.4 验证过的规则）：子任务失败重派一次（换个说法）；还失败就记为 gap，不许拿边角料合成结论；一波里一半以上挂了→**整单停下，如实汇报，不合成**。
- 合并层诚实（Anthropic CitationAgent 思想）：结论逐项可溯源到"哪个模型的哪份产出"；分歧写出来；置信度 + 一句话理由；验证不了的进"没把握"区。——这是"不拿假的顶"在合并层的落地。

### 2.7 钱和耗时透明
- 每次编排结束给 run header（一行）：派了几个模型、各是谁、token、耗时、有没有失败。Anthropic 公开过多模型成本是单聊天的 ~15x——我们不替用户心疼，但必须让她看见。
- MindStudio Usage Explorer 模式：**按模型/按调用**看钱花在哪，哪个分组最烧钱一目了然。
- 来源：https://www.fahimai.com/mindstudio ；https://www.anthropic.com/engineering/built-multi-agent-research-system

### 2.8 中途干预（呼应"AI 忙时她也能说话"）
- OpenAI：运行中可中断以收窄范围；Perplexity：运行中可追加 follow-up。我们的输入框升级（AI 忙时可发新消息）天然承接这个——她中途插话 = 改计划/停某路，AI 接着编排。

---

## 三、反模式（别踩）

1. **黑盒计划（Anthropic Research）：** plan 只写进内部 memory，用户看不见过程。对比 Gemini/OpenAI 的可编辑计划，这是四家里 UX 最弱的一环。嘟嘟要是"AI 自己派单、她只收结果"，等于复刻这个坑——违反她"信息断层"死线。
2. **把模型间扯皮播出来：** agentco 用架构直接禁了 worker 互聊（"agent-to-agent chatter 是最大且最不可控的 token 燃烧源"），所有交换走 Director 或走产物。嘟嘟也一样：**模型之间不许在她面前开会**，她只看 Director 的计划和每家的 `say`。
3. **内部 helper 扮人设：** agentco 的 concierge 不进员工列表。我们的路由探测、重试、降级逻辑是工具行为，**绝不能渲染成"某某模型说…"**——那是造假。
4. **日志当界面：** agentco 的原话——"用户看见的是公司在干活，不是终端在刷日志"。AutoGen Studio 那种全量 inner monologue 是给开发者的，消费级只给"计划+一行say+一键展开"。
5. **Poe 式"只让用户自己 @ "：** Poe 的 multi-bot 是用户手动 @bot 召唤，AI 从不主动派单（验证来源：https://www.analyticsvidhya.com/blog/2024/04/poes-multi-bot-chat-a-game-changer-in-ai-interactivity/ ）。嘟嘟要的是反过来的——**AI 替她 @**，她只管点头。但 Poe 的署名机制（同一线程里每个 bot 的回答 clearly labeled）是归因层的正确答案，抄署名、不抄"手动"。
6. **无声的连锁委派：** Lindy 的 Lindy 之间可以互触发，但没有统一的可视化，全靠事后 task log 翻（验证来源：https://github.com/kbsingh1399/trading/blob/HEAD/.agents/skills/lindy-debug-bundle/SKILL.md 的排障流程反推）。嘟嘟的跨对话框/跨模型调用必须**每一次都落在计划时间线上**，呼应愿景里的"跨对话框留痕"。
7. **静默烧钱：** 多模型 = 多倍 token（Anthropic 实测 15x）。没有 run header 和用量视图，等于让她开盲盒。
8. **计划不问就跑（Gemini 的另一面）：** Gemini 有计划无澄清问题；OpenAI 先问澄清再给计划。任务含糊时先问 2–4 个选择题（daodan §4.2 的做法），别拿着糊计划直接烧钱——这也是她定的"拿不准直接问"。

---

## 四、来源链接（每条结论的上游）

**第一手（我实际读过代码/文档原文）：**
- agentco README + SPEC-ui.md：https://github.com/minhvq36/agentco ／ https://raw.githubusercontent.com/minhvq36/agentco/main/docs/SPEC-ui.md
- AutoGen Studio 前端代码（clone 后读）：https://github.com/microsoft/autogen
- 微软 AutoGen Studio 官方介绍：https://www.microsoft.com/en-us/research/blog/introducing-autogen-studio-a-low-code-interface-for-building-multi-agent-workflows/
- 深研四家对比 spec（含一手来源考证）：https://raw.githubusercontent.com/acaprino/daodan/HEAD/docs/superpowers/specs/2026-08-23-research-deep-research-parity-design.md
- Anthropic 多智能体研究工程博客：https://www.anthropic.com/engineering/built-multi-agent-research-system
- LangSmith Observability 文档：https://docs.langchain.com/langsmith/observability-studio
- Relevance AI 官方文档：https://github.com/relevanceai/relevance-docs/blob/HEAD/site/content/docs/get-started/introduction.mdx
- Google ADK deep-search README（计划-批准两阶段）：https://github.com/google/adk-samples/blob/HEAD/python/agents/deep-search/README.md
- big-agi 的 Gemini Deep Research 指南（collaborative planning）：https://github.com/enricoros/big-agi/blob/HEAD/src/modules/aix/server/dispatch/wiretypes/_upstream/gemini.deep-research.guide.md

**第二手（媒体/评测文章，未亲验产品本身，结论仅取 UX 描述部分）：**
- Poe multi-bot 介绍：https://www.analyticsvidhya.com/blog/2024/04/poes-multi-bot-chat-a-game-changer-in-ai-interactivity/ ；http://messengerbot.app/poe-ai-2026-what-it-is-and-pricing/
- Manus 任务规划 UI 描述：https://medium.com/@macaipiotr/manus-is-real-ai-agent-999a96a30486 ；https://dev.to/sohamehta/my-exclusive-manus-ai-beta-experience-the-future-of-ai-agents-46am
- ChatGPT Agent 行为播报/权限：https://www.itpro.com/technology/artificial-intelligence/everything-you-need-to-know-about-openais-new-agent-for-chatgpt-including-how-to-access-it-and-what-it-can-do
- MindStudio Usage Explorer：https://www.fahimai.com/mindstudio
- Lindy 排障 skill（反推其日志结构）：https://github.com/kbsingh1399/trading/blob/HEAD/.agents/skills/lindy-debug-bundle/SKILL.md
- Relevance/Lindy/n8n 对比：https://theautomationsguide.com/blog/2026-07-06-relevance-ai-vs-lindy-vs-n8n-ai-agents-for-gtm-teams/

---

## 五、模块映射总表

| 嘟嘟模块 | 对齐来源 | 拿什么 |
|---|---|---|
| thinking 抽屉 v2 | agentco In Progress / AutoGen rendermessage | 一行 say + 署名 + 紧凑事件行 + 并行计数 + 可展开 token |
| 任务进度小卡片 | agentco plan strip + 防懵四问 | ≤6 步计划条、五态、点步看详情、⏸浮顶、停止常驻 |
| API 分组 | agentco Team 面板 / Relevance 三档审批 | 团队花名册 + 员工卡（历史/均耗/档位）+ 按边审批（直接/先问/AI定），新分组默认从严 |
| 工具调用 UI | LangSmith trace / AutoGen inputrequest | 左树右详情、类型着色、Gantt 时间线；审批弹窗带超时倒计时 |
| 纸条机制 | agentco plan 约束 | "派单"能力配一张纸条；计划步数/字数上限写成硬约束 |
| 诚实与失败 | Anthropic CitationAgent / daodan §4.4 / agentco task.blocked | 失败四要素卡、失败升级链（重派→换模→记gap→半数挂则停单）、合并层分歧写法+置信度+没把握区 |
| 成本/耗时 | AutoGen runview / MindStudio Usage Explorer / Gemini 成本公开 | run header（一行：谁/多少token/多久/败几次）+ 按模型用量视图 |
| 输入框升级（忙时可发） | OpenAI 中断 / Perplexity 运行中追问 | 她中途插话 = 改计划/停某路，AI 接着编排 |

## 六、未验证 / 待补
- AutoGen Studio 我只读了代码，没跑起来点过界面；Poe、Manus、Lindy、MindStudio 都没亲自用过，结论来自文档和评测文章的 UX 描述。
- CrewAI 官方没有第一方 Studio（只有社区 demo），LangGraph Studio 是开发者 IDE，对消费级借鉴有限——这两个没进 Top 3 的原因。
- You.com 的 ARI 只有发布稿层面的描述（400 来源、chain-of-thought 可见），没有细到可抄的交互，降级为背景参考。
