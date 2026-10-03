# OpenMuse 移动端审计报告（apps/mobile）

- 日期：2026-10-03
- 范围：`apps/mobile/src` 全部 37 个 TS/TSX 文件 + `apps/mobile/App.tsx` + `app.json`（逐文件读过，非按文件名猜）
- 方法：读源码 + grep 交叉验证（引用关系、API 调用、零结果断言）。未做真机运行验证。
- 判定标准：WORKS = 端到端打通；PARTIAL = 有 UI 但链路缺环；STUB = 代码在但实际不可用/无调用方；MISSING = 不存在。
- 源码一律未改动。

## 总览

| 功能 | 状态 | 证据（file:line） | 要真正能用还缺什么 |
|---|---|---|---|
| AI 对话（收发/流式/工具卡片/附件/停止/重试/队列） | WORKS（客户端链路） | chat.tsx:211（useAgent）、chat.tsx:292-302（runConversationTurn）、chat.tsx:65-135（9 种工具渲染器）、chat.tsx:873-941（输入栏/停止/重试/队列） | 模型/API 配置只能在服务端改，手机端无入口（见下）；欢迎语中英文混杂乱码 chat.tsx:509-512 |
| 用户语音录制→语音气泡 | WORKS（客户端） | voice-message.tsx:222-330（按住录音/expo-av）、chat.tsx:415-420（sendVoice）、chat.tsx:557（VoiceBubble 渲染） | 录音文件只发本地 `file://` URI 给服务端，服务端拿不到音频——无上传、无 STT、无转写，AI 实际"听不见" |
| AI 回复转语音（TTS） | MISSING | 全仓 grep `tts/expo-speech/speak` 在 apps/mobile、apps/server、packages 均为零命中 | 整个 TTS 链路不存在：无合成后端、无服务端接口、无客户端播放 AI 语音的触发点。VoiceBubble（voice-message.tsx:94-190）只能播已有音频文件 |
| 图片生成（/img） | WORKS（客户端+免费第三方） | image-generation.tsx:52-66（Pollinations URL 构造）、chat.tsx:401-404（/img 拦截）、image-generation.tsx:84-131（ImageBubble） | 强依赖 Pollinations 免费服务（无 key、无备用、无模型选择 UI）；只能用户手动 `/img` 触发，AI 自己不会画图（无工具） |
| 隐身聊天 | PARTIAL | chat.tsx:437-459（开关）、chat.tsx:244-247（不加载历史）、chat.tsx:269-276（不保存） | 只掐了客户端本地存取；richThreads 模式下消息仍走 CopilotKit 线程持久化（threads.tsx:38 决定开关），服务端侧是否真正不留痕**未验证**；退出后无"销毁线程"动作 |
| 设备权限（相册/定位/麦克风/通知/剪贴板） | STUB（功能层面） | device-permissions.ts:33-128（expo 原语真实可用）；但 DevicePermissionsSheet **零引用**（grep 全仓无 import，device-permissions-ui.tsx 孤立）；confirmBoundaryAction（device-permissions.ts:173-184）无任何调用方 | 无 UI 入口、无 AI 侧接线：AI 拿不到相册/定位/剪贴板/通知，跨边界确认弹窗从未被触发。UI 文件里还有中英文截断乱码（device-permissions-ui.tsx:73-76） |
| 蓝牙 BLE | STUB（已死） | device-permissions.ts:139-146（check 恒返 false、scan 直接 throw）；react-native-ble-plx 已在 commit eddd51f 删除 | 需重新引入 BLE 原生模块（Expo dev build config plugin 方式）并重写扫描/连接；app.json 里 NSBluetooth*UsageDescription 还留着（app.json:17-18） |
| 浏览器（工具卡片/会话/接管） | WORKS（客户端） | browser-tool-card.tsx:48-80（取会话+预览）、browser-tool-card.tsx:140-160（Take control）、screens.tsx:831（POST /api/browsers） | 依赖服务端 browser worker 在线；卡片内英文未汉化 |
| Agent 电脑（终端/文件） | WORKS（客户端） | computer-workspace.tsx:48（/api/computer）、:97（/api/computer/commands）、:370-462（文件读写/导入导出）；computer-drafts.tsx（草稿内存保留） | 依赖服务端 Docker computer 启用；这是本项目的"沙箱"对应物，iSH 式本机终端在此架构下不存在 |
| 线程管理（多对话/归档/改名） | PARTIAL | threads.tsx:107-282（richThreads 下真实列表/改名/归档，useThreads）；threads.tsx:283-299（非 richThreads 只有主聊天） | 是否可用取决于服务端 `workspace.runtime.richThreads` 开关（threads.tsx:38），手机端无控制 |
| 七个屏幕（Today/Mail/Calendar/Browser/Files/Activity/Connections） | WORKS（客户端，均接真实接口） | screens.tsx:70/449/594/822/926/1057/1173；接口：/api/drafts（screens.tsx:457）、/api/calendar/events（screens.tsx:642）、/api/browsers（screens.tsx:831）、/api/files（screens.tsx:946）、/api/google/connect/disconnect（screens.tsx:1182/1203） | 大量英文残留（见语言节）；Mail 列表依赖服务端邮箱同步 |
| 详情页（邮件/日历/文件/PDF/审批/浏览器详情） | WORKS（客户端） | details.tsx:57-78（路由）；MailDetail/EmailEditor/EventEditor/FileDetail/ReviewDetail/BrowserDetail 均调真实 API | 英文残留多（details.tsx:74 起整段英文） |
| Agent 工作台（任务/委派/Ideas/Goals/通知/人设记忆） | WORKS（客户端） | agent-ui.tsx:93（TaskCard）、268（TaskDetail）、628（ArtifactCard）、877（DelegateSheet）、997（Ideas）、1138（Goals）、1617（Notifications）；agent-workspace.tsx:33（3 秒轮询 /api/agent） | agent-ui.tsx 基本是英文界面（Delegate/Goals/Ideas/Apps 全英文）；无 API/TTS 配置 UI |
| 后端认证 | PARTIAL | api.ts:22-32（/api/session 建会话）、api.ts:5-20（Bearer token）；App.tsx:71-88（登录态） | token 只在 React state（App.tsx:71），**重启 App 就要重新登录**，无 SecureStore/AsyncStorage 持久化，无"记住我"；API_URL 硬编码 fallback（api.ts:1-3），手机端换不了后端地址和模型 key |
| MCP 客户端 | MISSING | 全仓（除 node_modules/.git）grep `mcp` 零命中 | 无 MCP 协议、无"自定义 MCP 地址+鉴权"入口、无工具挂载 |
| Jev 选择卡片 | WORKS（客户端） | jev-tool-card.tsx:93-130（JevToolCard）、jev-actions.ts:44-66（latestJevPanelId） | 英文错误串残留（jev-tool-card.tsx:127） |

## 关键断层（按严重排序）

1. **TTS 整条链路不存在**（MISSING）。用户要的"语音气泡"是"AI 回语音"，现在只有"我发语音"的半边。缺：合成后端选型 → 服务端 `/api/tts` → 客户端"AI 回复转语音"开关与播放。
2. **设备权限有名无实**（STUB）。expo 原语是好的，但 UI 被删到零引用、AI 侧零接线、蓝牙已死。P0 要求的"本地权限套件"目前等于没有。
3. **MCP 不存在**（MISSING）。"MCP/工具"完善无从谈起，先有客户端（自定义 URL+鉴权+工具清单+挂载）再谈 AI 调度。
4. **登录态不持久**（PARTIAL）。token 放内存，杀进程重进就要重新输密钥——专业产品不可接受。
5. **手机端零 API 配置能力**。对齐 Kelivo 要求"API/TTS 配置"，现在模型、key、后端地址全在服务端/构建期定死，手机上改不了、看不见。
6. **语音消息服务端不可达**。用户发的语音以本地 `file://` URI 字符串进对话，服务端 AI 读不到音频。需上传+STT（或转写）才能闭环。
7. **隐身模式服务端未验证**。客户端不存不取，但 CopilotKit Intelligence 线程持久化是否同样跳过，需要服务端证据，否则"隐身"是假的。

## 语言 / 字体

### 新口径（2026-10-03 她定）
界面语言**跟随手机系统语言**，中文优先做完整，其他语言优雅降级；能不写字的地方用图标代替；字体用系统字体、跟随系统字号自适应。

### 现状：i18n 基础设施 MISSING，字符串全部硬编码
- **无 expo-localization、无任何 i18n 库**（package.json 无 i18n 相关依赖，src 全仓无 `getLocales` 调用）。所有文案以内联字符串写死在组件里——要跟随系统语言，必须先建 i18n 层（locale 读取→语言包→fallback），现在是零。
- **中文只做了一半**：338 处英文用户可见字符串残留（脚本全量提取，`"<英文>"` 字面量）。重灾区：
  - `agent-ui.tsx`：Delegate / Goals / Ideas / Apps / 通知几乎全英文（agent-ui.tsx:188-195、208-211、833-850、1029-1030、1110-1127、1318-1330、1448-1517、1632-1657、1705-1823）
  - `details.tsx`：详情页大段英文（details.tsx:74、180、260-271、440-510、592-604、660-704、778-793、892-929、965-970）
  - `screens.tsx`：Today/Mail/Calendar/Browser/Files/Activity/Connections 混杂（screens.tsx:110-115、187-205、240-250、315-329、529-575、686-807、893-919、1049-1166、1188-1253、1311-1403）
  - `computer-workspace.tsx`：终端/文件区全英文（computer-workspace.tsx:131-138、190-209、252-263、334-341、413-659）
  - `chat.tsx`：工具卡片 fallback、队列、错误串英文（chat.tsx:63-130、175、349-352、640、752、767、873-901）
  - `App.tsx`：导航标题/副标题英文（App.tsx:53-68，如 "Connections, capabilities and what your agent remembers."）
  - `device-permissions-ui.tsx`：中英文截断拼接乱码（device-permissions-ui.tsx:73-76 `"助手在 App 内有完整权限。跨出 App 的ing the app boundary asks you first."`、device-permissions-ui.tsx:85、device-permissions-ui.tsx:40）
  - `chat.tsx:509-512`：欢迎语乱码 `"我可以做计划、帮你ur apps, and use my computer to help."`
  - `computer.tsx:226-229`：`"让你的 agent 去查点东西。s browsing sessions will appear here."`
- **系统权限弹窗文案是英文**：`app.json:14-19` 的 `NSMicrophoneUsageDescription` 等五条全是英文——iOS 系统弹窗会直接展示英文，不跟随中文。
- accessibilityLabel 大量英文（chat.tsx:438/677/873/890、screens.tsx:489/853、ui.tsx:416 等）——VoiceOver 用户听到的是英文。

### 字体：基本符合"系统字体"，字号需收尾
- 全 App **无自定义字体**（无 fontFamily，除了两处）：唯一例外是终端区等宽字体 `computer-workspace.tsx:26`（iOS 用 Menlo），这是终端场景的正确做法，保留。
- 字号全部硬编码数字（ui.tsx:35-46：text 15 / muted 14 / small 11 / title 23 等），**未使用 iOS Dynamic Type 样式**；但全仓无 `allowFontScaling={false}`，React Native 默认允许跟随系统字号缩放——所以"跟随系统字号"现状是**被动可用**，不是主动适配。
- 缺口：未验证大字号下的布局溢出；建议对布局敏感处加 `maxFontSizeMultiplier` 保护，而不是关掉缩放。

### 语言/字体要达标还缺什么
1. 引入 locale 读取（expo-localization）+ 语言包机制（zh-Hans 完整，其他语言 fallback 到英文或中文）——现在是零，必须新建。
2. 把 338 处英文残留逐文件改写为语言包 key（中文优先写全）。
3. `app.json` 的 iOS 权限描述改为中文（或随语言包提供多语言 InfoPlist）。
4. 字号：大字号真机验证一遍，溢出处修布局；不关缩放。

## iOS 26 相关提示
- `app.json` 已开 `newArchEnabled: true`，`expo-av` 仍在 plugins（app.json:33）——expo-av 在新版 Expo SDK 已废弃（由 expo-audio 接替），iOS 26 + 新 SDK 升级时录音/播放链路是风险点，动 TTS/语音时一并迁移。
- 后台：agent-workspace 3 秒轮询（agent-workspace.tsx:44-75）+ computer.tsx 10 秒刷新（computer.tsx:130-142），iOS 后台挂起后即停——"保活"需求若有，需另行设计（当前无后台任务代码）。

## 诚实结论
- 真正端到端能用的：AI 对话、用户语音录制与播放、/img 图片生成、浏览器会话与接管、电脑终端/文件、邮件/日历/文件/动态/连接各屏幕、任务与审批流。
- 有名无实的：设备权限（UI 零引用、AI 零接线）、蓝牙（已删除）。
- 完全没有的：TTS、MCP、i18n、登录态持久化、手机端 API 配置。
- 中文只做了一半：338 处英文残留，主要集中在 agent-ui、details、screens、computer-workspace。
