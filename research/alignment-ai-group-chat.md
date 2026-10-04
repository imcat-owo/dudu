# AI 群聊与跨对话框编排 · 对齐调研

**Date:** 2026-10-04
**Scope:** Feature 3（跨对话框读写 + AI 自建群）+ per-persona 模型配置与对话框内模型切换
**Status:** 调研完成，供"OpenMuse 项目完善计划书"拍板

一句话结论：SillyTavern 的群聊机制（activation strategy 四种发言调度、talkativeness、成员 JSONL 存储）是最值得抄的现成答案；LobeChat 的 per-agent 模型配置是 per-persona 独立模型的最佳参照；ai-discord-bridge 的 `!discuss` 是"AI 组局开会再汇报"最完整的现成实现。ST 的弱点是模型配置全局化、群聊历史完全共享（无人设记忆隔离概念），这两处嘟嘟必须反着做。

---

## 一、SillyTavern 群聊深潜（读的真代码，不是回忆）

仓库：SillyTavern/SillyTavern（clone 于 2026-10-04，commit 06bde93，分支 master）。

### 1.1 群组 = 一份 JSON 元数据 + 一串 JSONL 聊天

服务端：`src/endpoints/groups.js`。
- 每个群是一份 JSON 文件，存放在用户目录的 groups 文件夹（`src/users.js:85-86` 定义了 `groups` / `groupChats` 两个目录）。
- 创建时的完整字段（`src/endpoints/groups.js:156-190`）：
  - `id`（= Date.now()）、`name`（默认 "Group: 成员名A, 成员名B"）、`members`（成员头像文件名数组——成员用头像文件唯一标识，不是名字）
  - `avatar_url`（群头像）、`allow_self_responses`（允许同一人连发）、`activation_strategy`（发言调度策略）、`generation_mode`（卡片装配模式）、`disabled_members`（被静音的成员）、`fav`、`chat_id`、`chats`（聊天 id 数组，一个群可有多个聊天）、`auto_mode_delay`（自动模式间隔秒数，默认 5）
- 群聊天本身是一份 JSONL 文件（每行一条消息），存在 groupChats 目录；删除群会连带删掉其所有 JSONL（`src/endpoints/groups.js:203-230`）。
- 关键：**群聊历史是单份共享日志**，所有成员看同一份 transcript。每条消息带 `original_avatar` 字段标识实际发言人（`public/scripts/group-chats.js` 中 `activateSwipe` 的用法可佐证）。

### 1.2 发言调度：四种 activation strategy

定义在 `public/scripts/group-chats.js:122-127`：

```js
export const group_activation_strategy = {
    NATURAL: 0,
    LIST: 1,
    MANUAL: 2,
    POOLED: 3,
};
```

每次用户发消息（或触发生成）时，`generateGroupWrapper()`（`group-chats.js:945-1110`）先按策略选出一批"被激活"的成员，然后**逐个循环**：`setCharacterId(chId)` → 调标准 `Generate()` → 该成员发一条消息。也就是说群聊不是一次生成多条，而是"切换当前角色 → 生成 → 下一个角色 → 生成"的串行循环。

四种策略的精确逻辑：

**NATURAL（默认，模拟真实对话流）** `activateNaturalOrder`（`group-chats.js:1242-1322`）：
1. `bannedUser` = 上一条非用户消息的发言人（防止同一个人连发；`allow_self_responses` 开启时取消此禁令）。
2. 从输入文本里按"完整单词"匹配成员名，被点名（@）的成员激活。
3. 每个成员按 `talkativeness` 掷骰子：`Math.random() < talkativeness` 就激活。
4. 如果一个都没激活，从 talkativeness>0 的成员里随机挑一个兜底。

**LIST** `activateListOrder`（`group-chats.js:1180-1195`）：全部启用成员按列表顺序各发一条。

**MANUAL**：用户输入不自动触发任何人；靠手动点成员头像或 `/trigger` 命令指定某人发言。空输入触发时随机选一个未静音成员。

**POOLED** `activatePooledOrder`（`group-chats.js:1197-1241`）：选"自上次用户发言后还没说过话"的成员（随机挑一个）；如果都说过，随机挑一个**排除上一位发言人**的成员。保证轮转不冷场。

### 1.3 talkativeness：人设卡里的群聊专属字段

- 存在人设卡 `data.extensions.talkativeness`（V2 spec 的 extensions 命名空间，见 1.5），读不到时取顶层 `character.talkativeness`，再没有就默认 0.5（`public/scripts/slash-commands.js:5521`、`group-chats.js:1282-1284`）。
- 官方文档定义：0% = Shy（除非被点名否则永不开口），100% = Chatty（必回），新卡默认 50%。在人设编辑器的 "Advanced Definitions" 里用滑杆调。
- 文档：https://docs.sillytavern.app/usage/core-concepts/groupchats/（另有源码镜像 https://github.com/sillytavern/sillytavern-docs/blob/HEAD/Usage/Characters/groupchats.md）

### 1.4 生成模式：SWAP / APPEND / APPEND_DISABLED

定义在 `group-chats.js:129-133`。决定"当前轮到谁发言时，prompt 里装谁的人设卡"：
- **SWAP（默认）**：只装当前发言人的卡（`getGroupCharacterCards` 返回 null 走回退）。
- **APPEND**：把所有成员的 description/personality/scenario/mes_example 拼成一份大卡（`getGroupCharacterCards`，`group-chats.js:477-545`），每次生成全员人设都在上下文里——贵，但成员之间"记得"彼此人设。
- **APPEND_DISABLED**：同 APPEND 但静音成员的人设不拼入。

### 1.5 人设卡 V2 spec：群聊相关字段

Spec：https://raw.githubusercontent.com/malfoyslastname/character-card-spec-v2/main/spec_v2.md
- 核心字段：name / description / personality / scenario / first_mes / mes_example / system_prompt / character_book / tags / creator / character_version。
- **`extensions`**：任意 JSON 键值对，必须用命名空间防冲突（spec 明确建议 `"agnai/voice"` 这类前缀）。**ST 的 talkativeness、depth_prompt 都住在这里**，不是核心字段——这是刻意的设计：群聊调度参数属于"前端行为"，不污染人设本体。
- 结论：嘟嘟给人设加"群聊发言欲""是否允许被 AI 拉会"这类字段时，也该走 extensions 风格的附属命名空间，别塞进人设核心定义。

### 1.6 群创建流程（前端 UI）

`createGroup()`（`group-chats.js:2087-2126`）：
1. 填群名（留空自动生成 "Group: A, B"）、勾 allow_self_responses、选 activation strategy、选 generation mode、设 auto mode delay。
2. 从人设候选列表（可搜索/过滤，`printGroupCandidates`）点选成员加入 `newGroupMembers`，可排序（`reorderGroupMember`）、可静音（disabled_members）。
3. 点创建 → POST `/api/groups/create` → 拿到 id → 进入群编辑/聊天界面。

### 1.7 群聊 UI 要点（可抄的）

- 成员头像拼成群头像（`updateGroupAvatar` / `getGroupAvatar`，`group-chats.js:841-923`）。
- `show_group_chat_queue` 开关：生成时在成员列表显示发言队列序号（`groupChatQueueOrder` Map，`group-chats.js:141`）——用户能看见"接下来谁要说话"，防"AI 背后开小会"的观感。
- 消息按 `original_avatar` 显示对应成员头像和名字；静音成员可隐藏立绘（`hideMutedSprites`）。
- **Auto Mode（自动模式）**：`setAutoModeWorker()` 起一个 `setInterval`（间隔 = `auto_mode_delay`，默认 5 秒），`groupChatAutoModeWorker()`（`group-chats.js:1398-1419`）在无人输入时自动触发 `generateGroupWrapper`。这是 ST 今天最接近"AI 自主群聊"的开关——**但它是用户手动打开的**，且只在当前选中的群里跑。

### 1.8 跨对话框读写：ST 没有

ST 的群聊/私聊是前端 `menu_type` 切换的同一套 chat 数组，没有"AI 跨对话框读写"的概念，也没有 AI 自建群。`/trigger`、auto mode 都是用户触发的。这是嘟嘟 Feature 3 的差异化点，没有现成可抄。

---

## 二、Per-Persona 模型/API 配置与对话框内模型切换

### 2.1 ST：模型是全局的，没有 per-character 绑定（实测结论）

- ST 一次只连一个 API（`main_api` 全局状态），模型切换靠 `/model <name>` slash 命令（`public/scripts/slash-commands.js:2987` 起："Sets the model for the current API"）——**在对话框输入框里直接打 `/model xxx` 就能换，不用进设置**，但换的是全局，群里所有成员下一轮全用新模型。
- Connection Profiles（官方扩展 `public/scripts/extensions/connection-manager/`）：把（API 类型 / 模型 / preset / 密钥 / prompt 后处理等）打包成一个 profile，一键整体切换；UI 在扩展设置页（`settings.html` 下拉框 + 创建/更新/删除按钮）。**profile 也是全局生效，没有绑定到某个人设/某群的逻辑**（index.js 全文无 character 引用，已 grep 验证）。
- 人设卡解析器（`src/character-card-parser.js`）和 CharX（`src/charx.js`）均无 model 字段。
- 结论：ST 的"一人设一模型"只能靠用户手动 `/model` 切换或切 profile 实现，**群里 A 用 GPT、B 用 Claude 这种需求 ST 做不到**。嘟嘟的"模型/API 每人设独立配置"是超越 ST 的点。

### 2.2 LobeChat：per-assistant 模型配置的最佳参照

- 官方文档明说："**Per-Agent choice** — Set different default models for different responsibilities."（https://github.com/mooreliving777/lobehub/blob/HEAD/docs/usage/providers.mdx）
- 每个 assistant 有自己的默认模型；**在同一场对话里可以即时切换模型**："Flexible model switching: You can switch language models instantly within the same chat"（https://github.com/softwarenerd7/olares/blob/HEAD/docs/use-cases/lobechat.md）。切换入口在输入区上方的模型选择器，不用离开对话框。
- 映射：嘟嘟的人设 ≈ LobeChat 的 assistant；抄它的两层——①人设设置里存 `modelId`（默认模型）；②聊天内输入区放模型选择器，切换只影响当前人设/当前对话。

### 2.3 Cherry Studio：assistant.modelId 优先级链

- 模型解析优先级：显式 `uniqueModelId` > `assistant.modelId` > `chat.default_model_id`（https://github.com/effect56/cherry-studio-app-release/blob/HEAD/docs/references/ai/provider-integration.md）。每个 assistant 有 Model tab 可配默认模型和上下文管理。
- 可抄：**"本次指定 > 人设默认 > 全局默认"** 三层回退，语义清晰。

### 2.4 对话框内快速切换 UX 汇总

| 产品 | 入口 | 粒度 |
|---|---|---|
| ST `/model` | 对话框输入框打命令 | 全局 |
| LobeChat | 输入区上方模型选择器 | 当前 assistant/对话 |
| Cherry Studio | assistant 设置 Model tab + 会话内切换 | per-assistant |

嘟嘟建议：人设卡/人设设置里存 `modelConfig`（API 分组 + 模型 + 参数），聊天界面 header 或输入区放一个小模型 pill，点击弹出"本次用 / 设为人设默认"，默认跟人设走。这正好对接已有的"API 分组 + 智能 API 自适应"地基。

---

## 三、其他"AI 自建群 / AI 开会"产品

### 3.1 ai-discord-bridge：`!discuss`（最完整的现成实现）★

https://github.com/robert-kung/ai-discord-bridge（已 clone 读代码）
- `!discuss <topic>`：`bridge/discuss.py::run_discuss()`——A/B 两只 bot 在**共享滚动 transcript**上轮流发言，每轮都看到完整辩论进展；独立回合预算（`MAX_BOT_TURNS`，不占用全局 bot 回合计）；
- 结束条件：某方说出"辩论结束"关键词，或回合预算用完；
- **收尾**：另起一次调用把辩论浓缩成 markdown（主题/双方论点/共识/未解决分歧，300 字内），存进共享知识库，并把结论发回频道。**这就是"AI 组局开会 → 吵出结果 → 汇报给她"的完整闭环**。
- debate mode：A 在回复里 @Bot-B，B 自动接话（README 用法表）——@点名触发，对应嘟嘟群聊 4 规则里的"@点名必回"。
- 记忆设计：`bridge/memory.py`——每频道消息缓冲 + 按 (channel, bot) 生成的合并 system prompt + 定期 flush 成中期摘要。**频道共享记忆 + 各 bot 独立会话**，没有跨 bot 的记忆隔离概念（这正是嘟睟要反着做的地方）。
- 安全上值得抄：`parse_verdict` 只认 evaluator 第一行行首的 `VERDICT: approve`（防 prompt 注入伪造判定）——AI 开会场景下，结论/判定的结构化提取要做同样的"只认格式"处理。

### 3.2 ai-debate（achilleterzo/ai-debate）：结构化辩论桌

https://github.com/achilleterzo/ai-debate
- local-first 的多智能体会话：每个参与者有独立身份、模型、性格、约束、与其他人的动态 affinity，可选 moderator（主持人）。
- 参与者可混用不同 provider/模型（Ollama / OpenAI / Claude 同桌）。
- 可抄：**moderator 角色**（AI 自建群时，主 AI 不下场辩论、只当主持人控场+最后总结）、per-participant 模型（呼应 2.2/2.3）。

### 3.3 character.ai 群聊：用户组局，AI 不自主

- 用户建群，最多 10 个 AI + 10 个人类（https://trtc.io/blog/details/how-to-use-character-ai-group-chat-on-desktop）；只能手机端建（桌面端曾下线，https://www.roborhythms.com/multiple-characters-in-one-character-ai-chat/）。
- 宣布：https://techcrunch.com/?p=2613433（同文提到 Snapchat `@myai` 可被拉进群聊、Meta 在 WhatsApp/Messenger/Instagram 推 AI bots——都是**@触发式**，AI 从不主动开群）。
- 结论：主流产品里**没有"AI 主动建群开会"的先例**，全是用户组局 + @触发。这是嘟嘟的差异化，但也意味着没有 UX 先例可抄，留痕设计必须自己立规矩（见第五节）。

### 3.4 研究侧警示：Agents of Chaos（Northeastern）

https://techxplore.com/news/2026-03-ai-agents-discord-weeks-exposing.html
- 6 个有持久记忆、能自主行动的 agent 在 Discord 跑两周：被轻易诱导出泄露隐私信息、共享文档、删邮件服务器。
- 对嘟嘟的意义：AI 能跨对话框读写 + 自建群 = 自主行动面暴涨，**留痕和隔离不是点缀，是前置条件**。这篇是给"硬约束"背书的外部证据。

---

## 四、对齐目标总排名（Top 3）

### No.1 SillyTavern 群聊机制 —— 抄"形"
- 为什么排第一：唯一经过大规模真实用户验证的"多人设同屏对话"完整实现；activation strategy 四种调度、talkativeness、SWAP/APPEND、JSONL 存储、成员管理 UI，全是现成答案；代码开源可逐行对。
- 抄什么：发言调度算法（NATURAL 的点名+骰子+兜底三段式）、群元数据结构、消息 `original_avatar` 归因、发言队列可视化。
- 不抄：全局模型（嘟嘟要 per-persona）、共享历史无隔离（嘟嘟要隔离）、用户手动组局（嘟嘟要 AI 可自建）。

### No.2 ai-discord-bridge `!discuss` —— 抄"神"
- 为什么排第二："AI 组局 → 共享 transcript 辩论 → 结构化总结 → 汇报"闭环，与"AI 自建群吵出结果再汇报给她"的愿景**逐字对应**；回合预算、结束关键词、结论存档都是可直接落地的机制。
- 抄什么：共享滚动 transcript、独立回合预算、"辩论结束"式自然收敛信号、结论 markdown 四段式（主题/论点/共识/分歧）+ 回发汇报。

### No.3 LobeChat / Cherry Studio 的 per-assistant 模型 —— 抄"配置模型"
- 为什么排第三：Feature 3 的"AI 自建群"要"组建除它以外的 AI 模型/人设"，前提是**人设能绑定不同模型**；LobeChat 的 per-agent 默认模型 + 对话框内即时切换、Cherry 的三层回退（本次 > 人设默认 > 全局默认）是配置侧的标准答案。
- 抄什么：人设设置里的 `modelConfig`、聊天内模型 pill 快捷切换、三层回退语义。

---

## 五、具体要抄的机制（落地清单）

### 群创建流程（AI 自建群）
1. AI 在私聊里说"我拉个会"→ 生成群：name（默认 "Group: A, B" 规则可沿用）、members（AI 选的人设）、activation_strategy（默认 NATURAL）、allow_self_responses（默认关）、talkativeness 沿用人设默认值。
2. **创建即留痕**：群聊以一条系统消息/特殊卡片出现在她的对话框列表，标注"由 AI 创建 · 原因：xxx · 时间"，点进去能看到完整过程。对应硬约束"跨对话框留痕"。
3. AI 不下场辩论时当 moderator（抄 ai-debate）：只控场、到点喊停、写结论。

### 发言调度（turn-taking）
- 直接移植 ST 的 NATURAL 三段式：①点名（@ / 名字完整单词匹配）必回 → ②talkativeness 掷骰子 → ③兜底随机。`bannedUser` 防连发机制保留。
- POOLED 作为"开会模式"专用策略：保证每人自上轮用户发言后都说过话，防冷场。
- LIST 保留给"挨个表态"场景（如投票）。
- MANUAL 对应"她点名谁谁回"。

### 跨对话框读写 UX
- AI 在别的对话框发消息 = 该对话框里出现一条**带特殊标识**的消息（如"小梦代发 · 来自#私聊A"），不是伪装成用户或人设发的。
- AI 查看别的对话框 = 在审计日志里记一条"查看了#对话框B（N 条）"，不打扰用户但可查。
- 发消息动作默认可见、可关（硬约束已有）——开关放在"AI 权限"设置里，关了之后 AI 只能读不能写。

### 留痕 UX（audit log）
- 统一的"AI 动态"时间线：建群、跨对话框读写、开会自动模式、改模型配置，全部按时间列，点一条跳到对应对话框/位置。
- 借鉴 ST `show_group_chat_queue` 的思路：**进行中的事可视化**——AI 开会时，她的对话框列表里该群显示"开会中（3/10 轮）"，点进去看直播。

### per-persona 模型配置
- 人设设置：`modelConfig` = { API 分组 id, 模型名, 参数覆盖 }，默认跟随全局。
- 三层回退：本次指定 > 人设默认 > 全局默认（抄 Cherry Studio）。
- 聊天内切换：header 或输入区放模型 pill，点开可"只这次换"或"设为人设默认"（抄 LobeChat）。
- 群聊里 A 用 GPT、B 用 Claude：ST 做不到，嘟嘟做得到——这是宣传点。

---

## 六、不要踩的坑（反模式）

1. **ST 式共享历史 = 记忆隔离的反面教材**。ST 群聊所有成员看同一份 transcript，没有"人设 A 的私聊记忆"概念。嘟嘟的 AI 自建群时，**编排器只能给每个参会人设喂：群共享上下文 + 该人设自己的记忆**，绝不能把 A 的私聊记忆塞进 B 的 prompt。实现上：prompt 装配函数必须以人设 id 为键做记忆过滤，加单元测试断言"隔离"。
2. **AI 半夜背着她开聊**。ST 的 auto mode 是用户手动开的；嘟嘟的 AI 自建群/自动讨论必须有"她可见"的前置：要么她授意（"你们讨论一下"），要么创建即通知。绝不允许无声创建。
3. **伪装身份**。AI 代发消息必须带标识，不能伪装成她或某个人设"说"的话——@myai 式 bot 都是明示身份的。
4. **无预算的自主循环**。`!discuss` 有 MAX_BOT_TURNS + "辩论结束"关键词双保险；AI 开会必须有回合上限 + 结论超时熔断，防止两只 AI 吵到天亮烧她的 API 钱。
5. **判定/结论的 prompt 注入**。抄 `parse_verdict` 的"只认行首结构化 token"做法：AI 会议结论的提取用固定格式 + 严格解析，别让参会人设的发言内容污染结论字段。
6. **模型切换的惊吓**。ST `/model` 是全局的，用户在群里换模型会影响所有成员。嘟嘟的聊天内切换必须明确作用域（"只换当前人设"还是"全群换"），切换后给一句轻提示。
7. **character.ai 式的功能阉割**：桌面端建群曾被下线、mobile first。嘟嘟是 iOS App，保证群管理全功能在手机端可用，别做成"只能看不能管"。
8. **Agents of Chaos 教训**：给 AI 跨对话框读写能力时，默认关闭写文件/删数据类高危动作（嘟嘟已有"出 App 需授权"原则，群聊编排器同样适用）。

---

## 七、模块映射

| 发现 | 映射到嘟嘟模块 |
|---|---|
| ST activation strategy / talkativeness / bannedUser | 群聊模块（group chat）：发言调度器 |
| ST 群 JSON（members/disabled_members/activation_strategy/generation_mode） | 群聊模块：群数据模型 |
| ST JSONL 聊天存储（一群多聊天） | 存储层：群聊持久化 |
| ST SWAP/APPEND 卡片装配 | 群聊模块：prompt 装配（APPEND 模式注意 token 成本） |
| ST original_avatar 消息归因 / 群头像拼图 / 发言队列 | 群聊 UI：消息气泡 + 群管理页 |
| `!discuss` 共享 transcript + 回合预算 + 四段式结论 | AI 自建群模块（新）：会议编排器 |
| ai-debate moderator | AI 自建群模块：主持人模式 |
| LobeChat per-agent 模型 / Cherry assistant.modelId / 三层回退 | 人设系统：`modelConfig` + API 分组 |
| LobeChat 对话框内即时切换 / ST `/model` | 聊天 UI：模型 pill 快捷切换 |
| AI 动态时间线 / 开会中状态 / 代发标识 | 审计日志模块（新）：audit log |
| 记忆隔离（反 ST 共享历史） | 记忆花园 / 记忆隔离：prompt 装配时的人设级过滤 |
| 发消息默认可见、可关 | 设置：AI 权限开关 |

---

## 八、来源链接（每条结论的出处）

**SillyTavern（全部亲手读过代码，commit 06bde93）：**
- 群聊前端逻辑：https://github.com/SillyTavern/SillyTavern/blob/master/public/scripts/group-chats.js
  - activation strategy 定义 L122-127；生成循环 generateGroupWrapper L945-1110
  - activateNaturalOrder L1242-1322；activatePooledOrder L1197-1241；activateListOrder L1180-1195；activateSwipe L1130-1178
  - talkativeness 读取 L1282-1284；创建流程 createGroup L2087-2126；auto mode worker L1398-1419
- 群服务端：https://github.com/SillyTavern/SillyTavern/blob/master/src/endpoints/groups.js（创建 L156-190，删除 L203-230）
- 用户目录定义：https://github.com/SillyTavern/SillyTavern/blob/master/src/users.js（L85-86）
- `/model` 命令：https://github.com/SillyTavern/SillyTavern/blob/master/public/scripts/slash-commands.js（L2987 起）
- talkativeness 存储：同上 L5359-5366、L5552
- Connection Manager（全局 profile，无 per-character）：https://github.com/SillyTavern/SillyTavern/blob/master/public/scripts/extensions/connection-manager/index.js
- 人设卡 V2 spec：https://raw.githubusercontent.com/malfoyslastname/character-card-spec-v2/main/spec_v2.md
- 官方群聊文档：https://docs.sillytavern.app/usage/core-concepts/groupchats/

**其他产品：**
- ai-discord-bridge `!discuss`：https://github.com/robert-kung/ai-discord-bridge（`bridge/discuss.py::run_discuss`，本地已读）
- ai-debate：https://github.com/achilleterzo/ai-debate
- LobeChat per-agent 模型：https://github.com/mooreliving777/lobehub/blob/HEAD/docs/usage/providers.mdx
- LobeChat 对话框内切换：https://github.com/softwarenerd7/olares/blob/HEAD/docs/use-cases/lobechat.md
- Cherry Studio 模型优先级：https://github.com/effect56/cherry-studio-app-release/blob/HEAD/docs/references/ai/provider-integration.md
- character.ai 群聊：https://techcrunch.com/?p=2613433；https://trtc.io/blog/details/how-to-use-character-ai-group-chat-on-desktop
- Agents of Chaos 研究：https://techxplore.com/news/2026-03-ai-agents-discord-weeks-exposing.html
