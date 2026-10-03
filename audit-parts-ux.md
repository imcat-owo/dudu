# UX 对齐零件：全球 best-in-class 调研

> 调研日期 2026-10-03。原则：能借鉴就别自己设计。以下每条都来自真实仓库/文档原文阅读，不是印象流。
> 约束（来自用户口径）：目标 iOS 26；语言跟随系统（中文优先完整）；能用图标就不用字；系统字体跟字号自适应；OpenMuse 技术栈是 Expo/React Native——Flutter/Kotlin/Swift 的零件只能借模式重写，不能直接搬代码。

## Best pick per area（每区冠军，一句话理由）

| 功能区 | 冠军 | 一句话理由 |
|---|---|---|
| API 提供商配置 | **Kelivo** | 移动端最完整的配置流：预设三 Tab＋OAuth 账号登录＋自定义 endpoint＋多 Key＋分组＋二维码分享，代码已逐文件验证 |
| TTS 配置＋语音消息 | **Kelivo**（配置）＋ **Claude iOS**（交互） | Kelivo：12 家网络 TTS＋系统 TTS、自动朗读、缓存重播、悬浮播放器；Claude：波形键独立于麦克风、边说边显示要点、会话中途可切文字/语音 |
| MCP 服务配置 | **Kelivo** ＋偷 **RikkaHub** 的按人设绑定 | Kelivo：传输类型分段选择器＋JSON 导入＋环境变量/超时/错误详情；RikkaHub 独有"每个助手独立绑定 MCP"值得抄 |
| 人设/角色卡＋群聊 | **SillyTavern** | chara_card_v2 是全生态事实标准（PNG 里嵌 JSON，头像即卡片）；群聊发言策略（@点名→话痨度→随机）久经验证 |
| 聊天 UX（流式/思考/工具卡/Artifacts） | **LobeChat** | 开源实现里对 Claude Artifacts 还原最完整的：独立预览窗＋实时渲染＋分支对话＋思维链可视化 |
| 端侧权限 UX | **Apple HIG** | 平台官方标准：在用到的那一刻才申请、目的字符串写清为什么、拒绝后给去设置的路 |
| AI 主题设计系统 | **Polaris北极星** | 全球独一份的"AI 直接动手换肤"：稳态四轴参数换肤＋创意 CSS 直写＋试穿＋一键回滚，从官网 JS 包逐字扒出 |
| 整体专业度标杆 | **Claude iOS 官方 App** | 实现参考用 Kelivo＋LobeChat 拼 |

---

## 1. Kelivo（https://github.com/Chevey339/kelivo）

Flutter 跨端（含 iOS）LLM 聊天客户端，~4k stars，AGPL-3.0。README 自述 UI 设计大量借鉴 RikkaHub。已 sparse clone 读 `lib/` 全量。

### 1.1 API 提供商配置 —— 照抄对象

**验证**：读了 `lib/features/provider/pages/providers_page.dart`、`widgets/add_provider_sheet.dart`、`pages/provider_detail_page.dart`、`pages/multi_key_manager_page.dart`、`widgets/share_provider_sheet.dart`、`widgets/import_provider_sheet.dart`、`widgets/provider_custom_request_editor.dart`、`pages/model_catalog_page.dart`。

值得抄的具体模式：

- **添加提供商用底部弹出 4 个 Tab**：OpenAI / Google / Claude / OAuth 账号。每个 Tab 是独立表单（name、key、baseUrl；Google 还有 Vertex AI 的 project/location/service-account JSON；OpenAI 有 path `/chat/completions` 和 response API 开关）。——抄：预设表单按厂商分 Tab，而不是一个通用表单。
- **OAuth 账号登录**：ChatGPT / Grok / Kimi Code 走账号登录而不是填 key（`oauth_login_panel.dart`、`oauth_account_card.dart`）。——抄：给不会搞 key 的用户留"登录即用"通道。
- **Multi-Key 管理**：一个提供商可挂多个 key（`multi_key_manager_page.dart`）。——抄：轮换/负载。
- **提供商分组**：可折叠分组＋iOS 风格列表排序（`provider_groups_page.dart`）。——抄：提供商多了不乱。
- **二维码分享/导入**：`share_provider_sheet.dart` 用 `pretty_qr_code` 生成配置二维码，`import_provider_sheet.dart` 扫码导入。——抄：这是她"全程代办、越少动手越好"口径下最省力的配置同步方式。
- **余额徽章**：`provider_balance_badge.dart` 在列表直接显示剩余额度。——抄：花钱的地方一眼可见。
- **自定义请求编辑器**：`provider_custom_request_editor.dart` 可改 HTTP 头和 body。——抄：反代/网关用户刚需。
- **模型目录**：`model_catalog_page.dart` 拉取端点模型列表。——抄：填完 key 点一下就能选模型，不用手打模型名。

### 1.2 TTS 配置 —— 照抄对象

**验证**：读了 `features/settings/pages/tts_settings_page.dart`、`tts_services_page.dart`（2300+ 行）、`features/settings/widgets/asr_services_section.dart`、`shared/widgets/tts_floating_player.dart`。

- **12 种网络 TTS＋系统 TTS**：openai、gemini、azure、minimax、qwen、qwenAudio、groq、xai、elevenlabs、mimo、step、fishAudio（`NetworkTtsKind` 枚举，`tts_services_page.dart:2233`）。每种服务独立配置 key/baseUrl/model/voice（voiceName 或 voiceId）。——抄：TTS 服务做成"服务列表"，每种服务同一种表单结构（key＋地址＋模型＋音色），不要为每家写死界面。
- **朗读 AI 回复自动播放**开关（`ttsAutoPlayAssistantReplies`）。——抄：这正是她要的"AI 发语音"总开关。
- **缓存网络音频以便重播**（`cacheNetworkAudioForReplay`）。——抄：同一句话不重复花钱合成。
- **朗读文本选择模式**（`TtsTextSelectionMode`）：选哪些文本进 TTS、可降级。——抄：markdown/代码块不该朗读的部分可剔除。
- **悬浮 TTS 播放器**（`tts_floating_player.dart`）：全局可播/停。——抄：语音气泡之外的第二播放入口。
- **ASR 服务区独立配置**（`asr_services_section.dart`）：语音输入的识别服务单独选。——抄：TTS 和 STT 解耦配置。

### 1.3 MCP 配置 —— 照抄对象

**验证**：读了 `features/mcp/pages/mcp_page.dart`、`widgets/mcp_server_edit_sheet.dart`、`widgets/mcp_json_import.dart`、`widgets/mcp_environment_picker.dart`、`widgets/mcp_timeout_sheet.dart`、`widgets/mcp_error_details_sheet.dart`、`widgets/mcp_conversation_sheet.dart`；`core/providers/mcp_provider.dart:20` 定义 `enum McpTransportType { sse, http, stdio, inmemory }`。

- **传输类型用分段选择器**：HTTP / SSE / stdio（stdio 只在支持的平台显示，`mcp_server_edit_sheet.dart:168-184`）。stdio 模式再填命令＋工作目录。——抄：三种形态一个表单，动态显隐字段。
- **JSON 导入**（`mcp_json_import.dart`）：粘贴 Claude Desktop 格式的 `mcpServers` JSON 一键导入。——抄：生态通用格式零成本迁移。
- **环境变量选择器＋超时设置＋错误详情弹窗**：连不上时给看得懂的错误（`mcp_error_details_sheet.dart`），而不是"失败"两个字。——抄：排错信息是专业度分水岭。
- **按会话绑定 MCP**（`mcp_conversation_sheet.dart`）：MCP 开关可以绑到单次对话。——抄：和她的"纸条按需下发"思路同构。
- 内置 MCP Fetch 工具（README 特性）。

### 1.4 为什么是 Kelivo 而不是 RikkaHub

RikkaHub（https://github.com/re-ovo/rikkahub，Android Kotlin）是 Kelivo 的 UI 灵感来源，我也 sparse clone 验证了：它确实有移动端 MCP（`SettingMcpPage.kt`、`McpManager.kt`、`McpOAuthDiscoveryClient.kt` 等全套）。但 Kelivo 赢在三点：① 跨端含 iOS（RikkaHub 只有 Android）；② 功能面更全（OAuth 账号登录、多 Key、余额徽章、QR 分享是 RikkaHub 没有的）；③ 从 RikkaHub 那只偷两样它独有的：**按助手（人设）独立绑定 MCP**（`AssistantMcpPage.kt`）和消息分支（tree）。其余以 Kelivo 为准。

---

## 2. SillyTavern（https://github.com/SillyTavern/SillyTavern，文档 https://docs.sillytavern.app）

### 2.1 角色卡 —— 抄标准，不自创格式

**验证**：读了 docs 首页"Character Cards"节、多个 spec 复述源（`coneja-chibi/hoplight` 的 V2 field map、`peterpeet/claude-taverncard-skill` 的模板、`getcatalystiq/agent-plane` 的类型定义，三处互相印证）。

- **chara_card_v2 是事实标准**：`{spec:"chara_card_v2", spec_version:"2.0", data:{...}}`，data 字段：`name` / `description` / `personality` / `scenario` / `first_mes` / `mes_example` / `creator_notes`（永不进 prompt）/ `system_prompt` / `post_history_instructions` / `alternate_greetings[]` / `character_book`（内嵌 lorebook）/ `tags[]` / `creator` / `character_version` / `extensions{}`。
- **存储格式**：PNG 的 tEXt 块，keyword 为 `chara`，值是 UTF-8→base64 的 JSON。**一张 PNG 既是头像又是完整人设定义**，可当图片分享导入。——抄：人设卡导出/导入直接用这个格式，生态里现成的卡（Chub 等站）零成本可用。
- **mes_example 格式**：`<START>\n{{user}}: ...\n{{char}}: ...` 分块，`{{char}}`/`{{user}}` 宏。——抄：别发明自己的示例格式。

### 2.2 群聊 —— 抄发言策略

**验证**：读了官方文档 `https://docs.sillytavern.app/usage/core-concepts/groupchats/`（及 `sillytavern-docs` 仓库 `Usage/Characters/groupchats.md` 同文）。

- **四种发言顺序策略**：Manual（手动点名/`/trigger`）、Natural Order（@点名提取→话痨度→随机）、List Order（按成员列表顺序）、Random。另有 Pooled（优先还没说过话的）。
- **话痨度 Talkativeness**：0% Shy（不被点名绝不说话）～100% Chatty（必回），默认 50%，在角色编辑器的 Advanced Definitions 里调。——抄：这就是她要的"jev 打分/急的先说"的低成本实现：先用话痨度＋@点名，不够再上 jev。
- **@点名只认完整词**：名字是 "Misaka Mikoto" 时，"Misaka"/"Mikoto" 能触发，"Misa" 不行。——抄：@匹配规则写死，避免误触发。
- **成员管理**：增删成员、mute（禁言）、reorder（排序）、force talk（强制某人说）、Allow Self Response（是否允许自问自答）、Group Chat Scenario Override（群聊覆盖场景）。——抄：群聊管理页就按这六个动作做。
- **历史在成员间共享**：群聊记录成员共享（和她定的口径一致）。

---

## 3. 语音：Claude iOS ＋ Muse（Meta）

### 3.1 Claude iOS 语音模式（https://www.engadget.com/2231293/how-to-use-claude-voice-mode/ 等，多源印证）

**验证**：Engadget、ZDNet、Gadgets360 三篇 2026 年 8 月的实测报道口径一致。

- **波形键和麦克风键是两个键**：点右下角黑色波形图标进语音模式（不是麦克风键）。——抄：语音通话模式和"按住录音发语音消息"是两个入口，别混在一起。
- **首次进语音模式先选音色**（多选一），设置里可改 Voice Preferences。——抄：音色选择前置一次，之后不再打扰。
- **边说边在屏幕上显示要点**（live key points）。——抄：语音模式不要只有波形，给文字锚点。
- **同一会话可中途切换文字/语音**，不打断。——抄。
- **打断**：方形停止键打断 Claude；上箭头发送语音消息；＋号调相机/相册/文件；X 退出。免费 20–30 条/天。
- 架构是 turn-based（不是 ChatGPT 的 duplex 全双工），Anthropic 建议一次问一个问题。——实现提示：先做 turn-based，别碰全双工。

### 3.2 Muse（Meta 个人 AI 助手，com.facebook.hatch 系）

**验证**：https://runtimewire.com/article/meta-muse-live-video-chat-voice（2026-09-23，引用 Alexandr Wang 的 X 演示和 Meta 研究博客）。

- 2026-09 新增**实时视频聊天＋可定制的实时语音**（Muse Realtime Avatar：语音和视频从同一流生成，口型表情同步；可用一张参考图驱动 avatar）。
- **"prompt how it sounds"**：用户用自然语言描述想要的声音。——抄这个理念：音色选择不要只做下拉列表，允许一句话描述（"少年音、偏哑、慢一点"），正好接她的声音规格文档。
- 注意：她已亲砍实时语音/视频出 OpenMuse P0，所以这里只借"可描述的音色"理念，不做实时。

---

## 4. LobeChat（https://github.com/lobehub/lobe-chat，~74k stars）

开源阵营里聊天 UX 天花板之一。**验证**：读了 `vual/lobe-chat-pro` 仓库里的官方 changelog `docs/changelog/2024-09-20-artifacts.mdx`、第三方整理的 Artifacts 插件文档（`getkawai/veridium` 的 `lobechat/artifacts-plugin.md`），多源口径一致。

值得抄的：

- **Artifacts 独立预览窗**：AI 生成的实质性内容（>15 行）进独立窗口，支持 SVG 图形、HTML 实时渲染、多格式文档，与对话流分离、可迭代修改。——抄：OpenMuse 的 agent 产物（HTML/代码/文档）不要堆在气泡里，给独立预览＋版本迭代。
- **好 Artifacts 的判定规则**（写进系统提示词）：实质性、可复用、用户可能修改的内容才进 Artifacts；短代码片段、一次性解释不进。——抄：把这套规则原文写进小管家/系统提示词。
- **分支对话**：从任意一条消息开分支（Continuation 接续 / Standalone 另起），树形结构。——抄：和 RikkaHub 的消息分支同构，专业 App 标配。
- **思维链 CoT 可视化**：推理过程分步展开。——抄：thinking 不要只给纯文本，折叠分步。
- 另：插件市场、知识库 RAG 都是成熟模式，按需再抄。

---

## 5. 端侧权限 UX —— Apple HIG（平台官方标准）

**验证**：Apple HIG Privacy 章（通过多个 HIG 镜像仓库交叉验证：`tsdsj/apple-style`、`valentinllpz/apple-human-interface-guidelines`、`carlosziegler/apple-hig-skills`，均标注来源 developer.apple.com/design/human-interface-guidelines/privacy）。

- **只在功能真正需要的那一刻申请**，不要在启动时申请（除非 App 没它跑不起来）。——这就是对她"App 内全权、跨边界才弹窗"口径的官方背书。
- **目的字符串写清为什么**：具体、礼貌、短句，不需要写 App 名（系统已标明）。
- **解释页＋系统弹窗**：如果先放一张解释页，上面只放一个中性按钮通向系统弹窗，不要施压话术。
- **设计好"被拒绝"状态**：给功能降级＋一条去"设置"的路。——抄：权限被拒不是 dead end，界面要留"去设置打开"入口。

---

## 6. 北极星 Polaris（https://apps.apple.com/cn/app/polaris北极星/id6760319873）★ 新增

**身份确认**：App Store CN 搜索 "Polaris北极星"，开发商 欣悦 王，v1.0.13（2026-09-07 更新），官网 https://polaris.aelion.cn/，slogan："一个能和 AI 对话，也会陪你一起长出样子的房间"。**闭源**，无公开仓库——下面是从官网 JS 包（`/assets/main-BE4WFxCZ.js`，1.5MB）里逐字扒出的真实产品文案与工具定义，可照此重实现。

### 6.1 核心架构：换肤是 AI 的工具，不是设置页

- **两组换肤工具**：`theme-stable`（稳态换肤）＋ `theme-creative`（创意换肤），另有 `patchRawCss` / `readThemeCss` / `editThemeCss` / `appendThemeCss` / `insertThemeCss` / `deleteThemeCss` / `replaceThemeCss` / `applyPreset` / `applySurfaceTokens` / `applyThemeCoordinates` / `inspectThemeRender` 共 11 个主题工具。
- **三种模式**（`themeToolMode`）：`stable`（参数化换肤）/ `creative`（CSS 直写）/ `off`（"完全关掉换肤工具。之后普通聊天不会再自动滑进换肤"）。
- **按会话开关工具组**："决定对话里常驻哪些工具，比如换肤、联网、代码和工作区能力；关掉后模型就不会看到那类工具。"——工具对模型可见性是按会话控制的。这正是"纸条"机制在主题上的实例。

### 6.2 稳态换肤：四轴参数（抄这套参数设计）

`applyThemeCoordinates`：整页换肤，参数为 targets（"all" 或 01–08 区域编号）＋ 四轴：

- **hue 主色倾向**：直觉选色相（"薄荷偏青绿、晚霞偏橙粉"）；
- **hueCount 色彩复杂度**：1＝纯色锚点，越大越丰富；
- **emotion 情绪张力**：越大越热烈张扬，越小/负数越冷静收敛；
- **meaning 存在感方向**：越小越像氛围（空气/光/雾），越大越像材料（纸/布/纤维/涂层）；
- 另有 `baseColor`（直接写 hex）、`seed`、`label`。数字超范围系统自动夹取（"超出范围也没关系，系统会自动夹到边界"）。
- **单区域精修** `applySurfaceTokens`：targets 恰好 1 个编号时用；多个编号仍走整体坐标（"围绕这些部分理解意图，不是孤立补丁"）。
- 页面被划为 **01–08 八个可换肤区域**（surface 编号＋标签），AI 按编号施工，不写"气泡""导航栏"这类别名。

### 6.3 创意换肤：把皮肤当文件写

"把当前皮肤当作 theme.css 文件：`replaceThemeCss` 承载完整 CSS；`appendThemeCss` 新增规则；`editThemeCss` 替换已有片段；`insertThemeCss` 贴着已有片段插入。"另有 `applyPreset`（presetId 只能选真实存在的，禁编造）。**分工红线**："卡片 CSS、工作区文件 CSS、键盘/布局/交互修复不走 theme"——主题工具只管 App 壳，不碰内容卡片和交互逻辑。

### 6.4 安全网（抄这三件套，缺一不可）

1. **主题试穿**：先生效预览，不直接落盘；
2. **一键回滚**："真写炸了，长按右侧侧边星星就能把上一张皮肤拉回来"；"右侧半按钮：点按切换对话和房间，长按恢复主题"；
3. **生成校验**：CSS patch 有 `blockingIssues` 校验，失败不应用；"主题存档损坏，已重建"——主题有存档＋损坏自愈。

### 6.5 主题的保存/分享/流转

- **保存当前主题 / 复制当前主题 / 切换主题 / 保存到主题**；主题有存档（"主题复活"）。
- **主题包 JSON**：`kind: "polaris-theme-bundle"` 的 JSON 即皮肤快照，可粘贴导入（对标 Kelivo 的二维码分享，格式不同但思路一致：主题＝可序列化、可传播的数据）。
- **从图片提取配色**："从图片附件提取平均色、主色、建议文字色和主题变量建议"——用户丢一张图，AI 出一套主题变量。
- **按协作者分房间**："先从相册里挑一张图，只铺在这个协作者的房间里"——每个人设（协作者）有独立房间气质＋壁纸；"协作者会影响对话语气、默认设定和房间气质"。

### 6.6 抄什么、怎么抄（给 Expo 的落地清单）

1. 主题＝纯数据（token 树＋CSS 变量），**AI 通过受控工具改主题，不直接写样式代码**（稳态）或**只改 theme.css 一个文件**（创意），与业务组件隔离；
2. 四轴参数（hue/hueCount/emotion/meaning）＋ 01–08 区域编号是现成的、被验证过的"AI 可理解的主题语言"，直接借用；
3. 试穿→确认→存档→一键回滚的四步安全链；
4. 主题包 JSON 导入导出（可与二维码分享结合，抄 Kelivo 的码）；
5. 按会话/按人设的主题＋工具可见性开关（和她的"纸条"＋人设隔离口径天然咬合）。

---

## 7. 总表：每个功能区抄谁

| 功能区 | 抄谁 | 抄的具体东西 |
|---|---|---|
| 提供商配置 | Kelivo | 4-Tab 添加表单、OAuth 账号登录、多 Key、分组排序、二维码分享/导入、余额徽章、模型目录、自定义请求头 |
| TTS | Kelivo | 服务列表制（12 家＋系统）、key/地址/模型/音色四件套、自动朗读开关、缓存重播、文本选择模式、悬浮播放器；ASR 独立配置 |
| 语音消息/语音模式 | Claude iOS | 波形键独立、首次选音色、边说边出要点、会话中途切文字/语音、打断键 |
| 音色理念 | Muse | "一句话描述想要的声音"（prompt how it sounds） |
| MCP | Kelivo＋RikkaHub | 传输分段选择器、JSON 导入、环境变量/超时/错误详情、按会话绑定（Kelivo）；按人设绑定（RikkaHub） |
| 人设卡 | SillyTavern | chara_card_v2 全字段＋PNG 嵌 JSON（头像即卡片）＋mes_example 格式 |
| 群聊 | SillyTavern | 四种发言策略、话痨度 0–100%、@完整词匹配、mute/reorder/force-talk、成员共享历史 |
| Artifacts/分支/思考 | LobeChat | 独立预览窗＋实时渲染、好 Artifacts 判定规则、分支对话、CoT 可视化 |
| 权限 | Apple HIG | 用时申请、目的字符串、拒绝态给去设置的路 |
| 主题 | Polaris北极星 | AI 工具换肤、稳态四轴＋创意 CSS、试穿回滚、主题包 JSON、按人设房间 |
| 整体标杆 | Claude iOS | 交互细节的官方答案；实现用上面几家拼 |

## 验证清单（本报告每条可溯源）

- Kelivo：`/tmp/kelivo`（`Chevey339/kelivo` sparse clone，`lib/` 全读）——`features/provider/*`、`features/settings/pages/tts_*`、`features/mcp/*`
- RikkaHub：`/tmp/rikkahub`（`re-ovo/rikkahub` sparse clone）——`app/src/main/java/me/rerere/rikkahub/ui/pages/setting/SettingMcpPage.kt` 等 MCP 全套、`AssistantMcpPage.kt`
- SillyTavern：`https://docs.sillytavern.app`（Character Cards、Group Chats 章节）、`https://docs.sillytavern.app/usage/core-concepts/groupchats/`、`sillytavern-docs` 仓库 `Usage/Characters/groupchats.md`
- 角色卡 V2：`coneja-chibi/hoplight` 的 `specs/formats/chara-card-v2.md` field map、`peterpeet/claude-taverncard-skill` 的模板、`getcatalystiq/agent-plane` 的类型定义（三源印证）
- Claude 语音：`https://www.engadget.com/2231293/how-to-use-claude-voice-mode/`、`https://www.zdnet.com/article/claudes-ai-voice-mode-is-finally-rolling-out-for-free-heres-what-you-can-do-with-it/`、`https://www.gadgets360.com/ai/news/anthropic-claude-ai-chatbot-voice-mode-feature-real-time-two-way-conversations-rolling-out-8528555/amp`
- Muse：`https://runtimewire.com/article/meta-muse-live-video-chat-voice`
- LobeChat：`vual/lobe-chat-pro` 的 `docs/changelog/2024-09-20-artifacts.mdx`、`getkawai/veridium` 的 `lobechat/artifacts-plugin.md`
- Apple HIG：`developer.apple.com/design/human-interface-guidelines/privacy`（经 `tsdsj/apple-style`、`valentinllpz/apple-human-interface-guidelines`、`carlosziegler/apple-hig-skills` 三镜像交叉验证）
- Polaris北极星：App Store CN `id6760319873`（开发商 欣悦 王，v1.0.13）；官网 `https://polaris.aelion.cn/` 的 `/assets/main-BE4WFxCZ.js`（1.5MB，内含全部主题工具定义与产品文案逐字提取）
- Cherry Studio：`kltng/cataloger-mcp` 的 `tutorial.md`、`qiobn/zotero-research-mcp` 的 `docs/cherry-studio-setup-en.md`（MCP 以 JSON 导入为主，移动端借鉴价值低于 Kelivo，故未选为冠军）
