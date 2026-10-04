# 按能力分组的模型路由 — 对齐调研报告

**日期**：2026-10-04 ｜ **调研人**：产品研究（subagent）
**对齐对象**：`~/workspace/openmuse/research/ai-orchestration-vision.md` 中的"按能力分组的模型路由（多模态拼装）"
**方法**：全部逐一打开了真实仓库/官方文档/产品页的代码和文档核实，未核实的条目已标注。

---

## 1. Top 对齐目标（排名分先后）

### #1 Hugging Face Chat-UI 的 LLM Router — 最接近"输入类=路由"的现成实现

**为什么排第一**：它是调研里唯一一个把"消息里带了图片 → 自动换一个模型组"做成产品功能的。机制几乎就是愿景文档里写的"输入类=路由"那一段，只是换了个名字。

- **路由策略 JSON**：路由是一组命名 route（`default` / `multimodal` / `agentic`），每个 route 有 `primary_model` + 有序的 `fallback_models`，还有全局兜底 `LLM_ROUTER_FALLBACK_MODEL`。route 按优先级匹配：**有图片输入 → `multimodal` route；选了 MCP → `agentic` route；其他 → `default`**。
- **Multimodal Shortcut**：开了 `LLM_ROUTER_ENABLE_MULTIMODAL=true` 时，图片一出现就直接走 `LLM_ROUTER_MULTIMODAL_MODEL`，连策略文件都不读——相当于愿景里的"图片输入组"。
- **用户侧只看到一个"Omni"虚拟模型**：跟愿景文档"对她一律叫分组，界面不分两套"的思想一致——底下分机制，上面一个入口。
- **路由可见性**：选中的 route 和实际服务的 model 以 `RouterMetadata` 发给前端展示。路由是自动的，但**必须让她看见这次到底走了哪个模型**（这正好呼应愿景的硬约束"跨对话框留痕"精神——自动但不黑箱）。
- **轻量**：路由选择是本地同步启发式，不调用额外的"选择模型"模型，不增加延迟。

来源：官方文档 https://huggingface.co/docs/chat-ui/en/configuration/llm-router （逐行读过，含 routes.json 示例）

### #2 Open WebUI — 能力元数据模型 + 输出类=工具后端的最佳参考

**为什么排第二**：它的 `meta.capabilities` 是最成熟的"每个模型有哪些能力"数据模型，而图片生成被做成**独立引擎（tool backend）**而非聊天模型——这正是愿景里"输出类=工具后端"的分法。

- **每个模型一组能力 checkbox**（代码见 `src/lib/components/workspace/Models/Capabilities.svelte`）：vision、file_upload、file_context、web_search、image_generation、code_interpreter、terminal、usage、citations、status_updates、memory、builtin_tools。**关键细节：未设置的能力默认视为 true**（`MessageInput.svelte` 里 `capabilitiesById[id]?.[capability] ?? true`）——这和嘟嘟"乐观默认：全开，实测不行才降级"完全同构，是现成的业界佐证。
- **图片生成是独立工具后端**：`backend/open_webui/tools/builtin.py` 的 `generate_image` 工具，底层引擎可选 openai / automatic1111 / comfyui / gemini（`routers/images.py` 的 `IMAGE_CONFIG_KEYS`，生成和**编辑**各有一套配置）。聊天模型通过工具描述"Generate an image based on a text prompt"自己决定要不要调——**AI 自主选择**，不是硬编码触发词。
- **生成结果通过事件流内联展示**：`__event_emitter__` 发 `chat:message:files`，图片直接出现在对话流里，模型只需回一句确认。这就是"AI 想生图 → 调组里 endpoint"的端到端闭环。
- **它没做但嘟嘟要补的一块**：消息带图但当前模型没 vision 能力时，Open WebUI 只是弹 toast 报错"Model X is not vision capable"（`Chat.svelte`），**不自动换模型**。愿景文档要的是自动路由到图片输入组——Open WebUI 是反例，证明了只做警告不够。

来源：仓库 https://github.com/open-webui/open-webui（2026-10-04 clone，main 分支）：`src/lib/components/workspace/Models/Capabilities.svelte`、`backend/open_webui/tools/builtin.py`（`generate_image`）、`src/lib/components/chat/MessageInput.svelte`（`getCapableModelIds`）、`src/lib/components/chat/Chat.svelte`（vision 警告）

### #3 LiteLLM Router — 组内选模型的可靠性机制（失败分类/冷却/降级）

**为什么排第三**：愿景里"AI 自动选组内模型，复用智能自适应的探测+记忆"——LiteLLM 是这套机制最完整的开源实现，嘟嘟的智能自适应可以直接对标。

- **命名路由组**：`model_name` 别名对应一组部署；**routing groups** 可以把多个 model_name 绑成一个可调用的虚拟模型（`model: <group_name>` 直接请求，组名出现在 `/v1/models` 里，UI 可发现）——"组即模型"的思想。
- **组内选择策略**：simple-shuffle（加权随机，按 rpm/tpm）、usage-based、latency-based、least-busy、cost-based，可按组覆盖。
- **可靠性层（和策略正交）**：`allowed_fails` 次失败 → 部署进冷却（`cooldown_time`，429 立即冷却）；有序 `fallbacks` 链；还有专门的 `context_window_fallbacks`（上下文超了直接跳组，不在同组里浪费重试）和 `content_policy_fallbacks`（被拒了换 provider）。**失败分类决定"重试还是降级"**，不是一刀切重试。
- 官方文档明确推荐生产用 simple-shuffle（开销最小），复杂策略只在有明确场景时用。

来源：官方文档 https://docs.litellm.ai/docs/routing（读过路由策略、routing groups、session affinity 章节）

---

## 2. 值得抄的具体机制

### 2.1 数据模型：每个模型一份能力档案 + 用户可自定义标签

- **抄 Open WebUI 的 `meta.capabilities` 结构**（`vision / file_upload / web_search / image_generation / ...`），但**抄 LobeHub 的类型分层**：LobeHub 的 `model-bank` 把模型卡分成 `AIChatModelCard / AIImageModelCard / AIVideoModelCard / AITTSModelCard / AIASRModelCard`（`AiModelType` = chat、embedding、tts、asr、image、video、text2music、realtime），图片/视频模型是独立的类型、独立的模型列表。这正是愿景"输出类=工具后端"的类型基础。
  - 来源：https://raw.githubusercontent.com/lobehub/lobehub/canary/packages/model-bank/src/types/aiModel.ts（`ModelAbilities` 含 vision/imageOutput/video/audio 等 9 项；`AiModelTypeSchema`）
- **抄 LobeHub 的自定义扩展能力标签**：用户可以在模型配置里手写 `model<maxToken:vision:reasoning:search:fc:file:imageOutput>` 这种扩展标签（官方文档，有 `video`、`imageOutput` 等）。嘟嘟的"可自定义加组"可以直接用这套：组 = 能力标签的集合，模型打标签即入组。
  - 来源：https://lobehub.com/docs/self-hosting/advanced/model-list（"Extension Capabilities"章节）
- **自动补齐能力档案**：OpenRouter 的 `/v1/models` API 支持按 `output_modalities`（text/image/audio/embeddings）和 `supported_parameters`（如 tools）过滤，模型记录带 `architecture.modality`。开源项目 open-webui-openrouter-pipe 已经演示了"从 OpenRouter 目录推导 vision/audio_input/video_input/image_gen 等 flag，并同步进 Open WebUI 的能力 checkbox"——**探测的第一步可以用目录元数据做初筛，再用实测修正**（这正是嘟嘟"探测+记忆"的思路）。
  - 来源：https://github.com/openrouterteam/docs/blob/HEAD/guides/overview/models.mdx；https://github.com/rbb-dev/open-webui-openrouter-pipe/blob/HEAD/docs/model_catalog_and_routing_intelligence.md

### 2.2 输入类路由：按附件类型触发 + 有序降级 + 留痕

- **抄 HF Chat-UI 的匹配顺序**：图片输入 → 图片组；语音输入 → 语音组；否则默认模型。做成"组"而不是"单个模型"：**组内 primary + fallback 列表**，失败按序试，组全挂才回全局兜底（愿景的"组空了试当前模型，不行老实说"就是最后一环）。
- **路由结果必须可见**：HF 的 `RouterMetadata` 让 UI 显示"这次是哪个模型回的"。建议嘟嘟在消息上打一个轻量标记（比如模型名小字），自动路由不黑箱。
- **原生 fast path**：opencode-vision-analyze 插件的机制很精——主模型本身有 vision 能力时，图片**直接透传、零成本**，不走任何路由；主模型是纯文本时，才把"调 vision 工具"的 hint 注入给 AI，让 AI **带着自己的问题**去调专用 vision 模型（question-aware，比提交时一次性生成通用 caption 更准）。这对应愿景"组空了先试当前模型"：先判当前模型行不行，行就别折腾。
  - 来源：https://raw.githubusercontent.com/mwumli/opencode-vision-analyze/main/README.md（"Native fast path"、"Question-aware descriptions"、"Candidate chain"）
- **组内候选链**：opencode 的 `models` 是有序候选列表，逐个试到成功为止；空配置时自动发现所有 image-capable 模型；`unlisted_fallback` 允许显式名单用完后继续试未列出的。**失败绝不抛异常**——工具返回可读文本，agent 循环里可重试、可转述。嘟嘟组内自动选模型可以直接抄这套语义。

### 2.3 输出类工具后端：独立引擎 + 能力感知参数

- **抄 Open WebUI 的引擎分离**：图片生成/编辑各有一套引擎配置（OpenAI 兼容 / A1111 / ComfyUI / Gemini），AI 通过工具调用，事件流回显。这是"图片输出组"的标准形态。
- **抄 LibreChat 的多工具并存**：DALL-E 3、Flux、GeminiImageGen、Stable Diffusion 是四个独立工具类，各自带自己的 key/endpoint。映射到嘟嘟：图片输出组里的每个 endpoint 就是一个工具实现，AI 按需挑。
  - 来源：`api/app/clients/tools/structured/DALLE3.js` 等（clone 的 https://github.com/danny-avila/LibreChat，main 分支）
- **抄 NanthAI 的"路由安全"规则**（OpenRouter Images API 实践）：
  - 图片输出模型**永远不许进 `/chat/completions`**，传输层直接拒绝——类型错配在入口拦掉，不靠 AI 自觉；
  - 能力感知默认值：用户偏好（数量/比例/清晰度/格式）与模型实际支持的参数取交集，不支持的参数直接丢掉，枚举值选最接近的档——**不拿不支持的参数去撞 API**；
  - 图片生成**没有文本降级**：超时/空结果就是失败，如实返回，不编一个假的顶上（"不行老实说"的硬版本）；
  - 部分成功要有契约（requested/generated/failed 计数），取消要检查。
  - 来源：https://raw.githubusercontent.com/thevarsek/nanthai-edge-oss/HEAD/docs/openrouter-image-api.md（"Routing Safety"、"Capability-aware defaults"）
- **视频=异步任务**：愿景已定"视频慢，走任务进度小卡片"。LobeChat 为此做了独立的 `image` / `video` store：每个模型带自己的参数 schema（`extractDefaultValues`），切换模型时 `preserveSupportedParams` 保留兼容参数。**抄它的"按模型的参数 schema"思想**：组里换模型时只保留对方也支持的参数。
  - 来源：clone 的 https://github.com/lobehub/lobehub（`src/store/image/slices/generationConfig/action.ts`、`src/store/video/`）
- **超时预算**：OpenClaw 给 image_generation 配了独立 `timeoutMs`（默认 180000ms），按调用可覆盖。视频/图片工具必须有独立于聊天超时的超时配置。
  - 来源：https://docs.openclaw.ai/providers/openrouter（"Image generation"章节）

### 2.4 降级与诚实：失败时的标准动作

- **四级降级链**（综合多家）：① 组内下一个模型（有序 fallback）；② 当前聊天模型自己试（愿景原话）；③ 降级为"描述/占位+说明"（如 dsh-llm-vision-bridge 的 `placeholder` 策略：失败时插入一句说明继续，不中断对话）；④ 老实说做不到。**永远不要静默丢附件**——ClawAI 的文档专门论证了：Ollama 纯文本模型收到图片会静默丢弃并自信地编答案，所以他们做了 drop+warn（UI 上打"omitted (no vision model)"标记+审计记录）。
  - 来源：https://raw.githubusercontent.com/ihabkhaled/clawai/HEAD/docs/03-architecture/routing-engine.md（"LOCAL_ONLY + attachments"）；https://github.com/Einskyle/dsh-llm-vision-bridge
- **LiteLLM 的失败分类**值得直接抄进智能自适应：429/5xx → 冷却+换部署重试；400/422/404 → 致命，不重试；401/403 → 换 key/换部署（别把整组打死）；上下文超限 → 直接跳组（别在同组里烧重试）。
- **冷却不是永久拉黑**：LiteLLM 冷却到期自动恢复。嘟嘟"按模型记忆可用配置"里要区分"暂时挂了"和"真不支持"，前者冷却、后者记死。

### 2.5 手动兜底：Poe 的 @点名

- Poe 的多 bot 聊天：`@DALL-E-3` 把图片 bot 点进对话。**AI 自动路由是主路，但给她留一个手动点名的后门**（比如"用XX模型看这张图"），自动失败时她能一句话接管。
  - 来源：https://venturebeat.com/ai/poe-introduces-multi-bot-chat-and-plans-enterprise-tier-to-dominate-ai-chatbot-market?utm_source=pivot5.ai（注：Poe 闭源，此条来自产品报道，未读到代码）

---

## 3. 不要踩的坑（观察到的反模式）

1. **硬编码模型名判断能力**（LibreChat 的 `visionModels` 数组，`packages/data-provider/src/config.ts`）：靠名字里有没有 "vision"/"gpt-4o" 来判定，用户自己配的 endpoint 全不认。嘟嘟的 endpoint 全是用户自配的，这条路是死路——能力必须来自**用户标签 + 探测实测**，不能靠名字猜。
2. **正则表达式判定能力**（Open WebUI 的 `IMAGE_URL_RESPONSE_MODELS_REGEX_PATTERN` 默认 `^gpt-image`）：同上，脆。
3. **静态能力配置、从不实测**（LobeHub 官方文档原话："LobeHub cannot enable capabilities the API doesn't provide"，配了但 API 不支持就是不好使）：嘟嘟的探测+记忆正好是解药——配归配，第一次用先轻量探测，记下来。
4. **静默丢附件**（ClawAI 文档点名批评）：模型看不了图还假装看了，给出自信的错误答案。降级必须**显性**：要么换模型（留痕），要么明确说看不了。
5. **关键词触发路由**（ClawAI 用了 1650+ 关键词数组做意图分类）：脆且难维护。输入类路由应该看**附件类型**（客观事实），输出类看**AI 自己的工具调用意图**，都不要猜用户文字。
6. **提交时阻塞式预分析**（opencode-vision-analyze 明确反对）：不要在用户发图那一刻就同步调 vision 模型生成 caption 堵住整个 turn；用"AI 按需调工具"的方式，失败在 agent 循环里可见、可重试。
7. **失败文本污染共享缓存**（opencode 的教训）：描述缓存只写长度达标的成功结果，短拒绝/失败不写，否则一个坏结果会被所有后续复用。
8. **只给自动、不给手动**（Poe 的反面教材意义）：全自动路由一旦判断错了用户没处说理。自动为主 + 一句话手动指定为辅。

---

## 4. JeecgBoot 核验结论

起始笔记 `~/workspace/research_notes/jeecgboot-ai-ideas-for-dudu-20261004.md` 已逐条对真实仓库核验：

- **属实**：AI 大模型管理（模型列表 + 按模型配参数，支持 ChatGPT/DeepSeek/Claude/千问/Ollama 等）、AI 对话支持发图、AI 流程编排（节点：AI/知识库/分类/分支/JAVA/脚本/子流程/HTTP/直接回复等）、"AI 流程即服务"（编排出可复用的智能体 API）。
  - 来源：https://raw.githubusercontent.com/jeecgboot/JeecgBoot/main/README-AI.md（"AI大模型管理"、"功能列表"、"AIGC能做什么"章节）；仓库 48,077 star、Apache-2.0、默认分支 main（https://api.github.com/repos/jeecgboot/JeecgBoot）
- **对本次能力路由的直接价值有限**：它的模型管理是"选模型+配参数"的静态配置页，没有按能力分组、没有按模态自动路由。它的真正价值如原笔记所说，是"AI 做事目录"（别人拿 AI 干了哪些活的菜单），服务于"要能力给能力"那半边，不直接服务本次路由机制设计。

---

## 5. 落到嘟嘟模块的映射

| 调研发现 | 映射到嘟嘟模块 | 怎么做 |
|---|---|---|
| Open WebUI `meta.capabilities` + LobeHub 自定义扩展标签 | **API 分组 UI** | 分组=能力标签集合；建组时给几个预设（图片输入/图片输出/视频/语音输入）+ 允许自定义标签；每个 endpoint 可打多个标签；未标注的能力沿用乐观默认（Open WebUI 的 `?? true` 佐证） |
| HF Chat-UI routes.json（primary+fallback/组） | **API 分组 UI + 路由执行** | 每个输入类组内可排优先级（primary + fallback 顺序），UI 上就是组的成员排序；"Omni"式统一入口：用户只看到"分组"，底下按附件类型自动走 |
| HF RouterMetadata | **API 分组 UI（展示层）** | 自动路由后在消息上轻量标注实际服务的模型，自动但不黑箱 |
| LiteLLM 失败分类/冷却/按组降级 | **智能 API 自适应** | 把现有探测+记忆升级为：失败分类（429/5xx 冷却重试、400 不重试、401 换 key、上下文超限跳组）；冷却到期自动恢复；区分"暂时挂"和"真不行" |
| opencode-vision-analyze（fast path + 按需工具 + 候选链 + 缓存） | **智能 API 自适应 + 工具后端** | 当前模型有能力就直传（零成本）；没有才走组；组内有序候选链；图片描述按内容哈希缓存（同一张图不重复调 vision） |
| Open WebUI 图片引擎（openai/a1111/comfyui/gemini）+ LibreChat 四图片工具 + NanthAI 路由安全 | **工具后端（图片/视频）** | 图片输出组=一组可切换的引擎 endpoint；传输层硬隔离（图片模型不许进 chat 接口）；参数取交集（不支持的不发）；图片生成无文本降级，失败如实说 |
| LobeChat image/video 独立 store + 按模型参数 schema | **工具后端（视频）+ 任务进度小卡片** | 视频走异步任务+进度卡片；组内换模型时保留兼容参数；图片/视频工具配独立超时（参考 180s 起） |
| Poe @点名 | **API 分组 UI（手动兜底）** | 自动路由为主，支持她一句话手动指定"用XX组/XX模型处理这次" |
| OpenRouter 模型目录（modalities/支持参数过滤） | **智能 API 自适应（探测初筛）** | 用户填 OpenRouter 兼容 endpoint 时，可用目录元数据预填能力标签，再用实测修正 |
| ClawAI drop+warn + 审计 | **智能 API 自适应（诚实层）** | 附件被丢/模型看不了时必须显性提示+留痕，绝不静默编答案 |

---

## 6. 一句话总结

HF Chat-UI 证明了"按附件自动换模型组"在产品里是成立的（它叫 LLM Router）；Open WebUI 证明了"能力标签 + 图片生成做独立工具后端"是成熟分法；LiteLLM 证明了"组内有序降级+失败分类+冷却"是可靠性的标准答案。三家拼起来，正好是愿景文档那三段：**输入类=路由、输出类=工具后端、AI 在组内自动选**。嘟嘟多出来的牌是"探测+记忆"（别家多是静态配置）和"对她只叫分组"（别家把两套机制都露给了用户）。
