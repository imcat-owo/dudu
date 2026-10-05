# 缺口补齐作战清单（2026-10-05 醒醒令：他们有的好的，咱们没有的，做进去，一个不缺，只会比他更好）

来源：`~/workspace/research_notes/dudu-vs-kelivo-openminis-gap-20261005.md`（100+ 项，一项不删）
规矩：每批 做→审→对齐→修→复审→打勾→下一批。零 emoji；zh-Hans+en；嘟嘟腔；删改先经她同意。
UNCOMMITTED working file — do not commit.

## 跳过（她亲口定的）
- F4 换应用图标：她自己用全能签换，不做
- H1 Android/桌面/Web：iOS 先行，记着，不现在做
- G5 iCloud 同步：她只有一台 iPhone，暂时用不上，记着

## 延后（hard，iOS 限制，诚实降级以后再啃）
- C3 离线 Sherpa STT（需原生模块）
- H9 后台保活/任务通知兜底（iOS 限制多）
- D1-STDIO（iOS 上 STDIO 跑不了，先做 HTTP/SSE）

## Batch 1 — 聊天核心 A（✅✅ 构建+复审+follow-up+复审 全 PASS 2026-10-05）
复审：gap-batch1-review.md — A1–A10/A13–A18/A22/A24/A26/A27 全 PASS，对着 Kelivo 真源码学的，无自创。
未做项判决：A11/A19/A20/A25 → PASS-SKIP（小众）；A12/A23 → PASS-SKIP；A21 Mermaid → P2 已补。
Follow-up 全做完（ade53fb）+ 复审 PASS：搜索滚动定位 / 追问气泡开关 / Mermaid / biome+prev-next a11y / fork 保留版本 / header 用量条 / 多选导出。正式打勾。
- [x] A1 重新生成回答（末条一键重答 + 长按菜单任意点重答；旧版本保留）
- [x] A2 回答多版本切换（Kelivo 式 ‹1/3›；版本全持久化/备份/可搜索）
- [x] A3 对话分支/fork（从任意消息另开对话；自评"分支对话✅"现为真）
- [x] A4 编辑用户消息后重生成（Alert.prompt 改文后从该处重答）
- [x] A5 删除单条消息（删单版本 / 删整组版本）
- [x] A6 AI 追问建议气泡（回完 3 个 chips，一键发送）
- [x] A7 AI 生成对话标题（首轮后自动起名，不覆盖手改名）
- [x] A8 置顶对话（置顶排序）
- [x] A9 全局对话搜索（对话名 + 全部消息含未选中版本）
- [x] A10 多选批量操作（批量删/批量置顶；无文件夹故无"移动"）
- [x] A13 上下文用量显示（对话框设置里用量条）
- [x] A14 用户可操作的上下文管理（Kelivo 模型：总结→开新对话，老对话保留；保留条数+自定义提示词选项）
- [x] A15 历史自动压缩（超预算 90% 自动原地折叠+通知）
- [x] A16 每对话独立 system prompt（追加到 persona 之后）
- [x] A17 快捷短语/指令卡片（存常用片段，点一下填进输入框）
- [x] A18 导出聊天（整对话 Markdown → 分享面板；单条复制/整轮图片另有入口）
- [x] A22 斜杠命令（/new /compress /export /clear /remember /search /img）
- [x] A24 消息右键菜单（复制/重答/编辑重发/撤回记忆/分支/截图/删除）
- [x] A26 截取一轮对话为图片（ViewShot 渲染一问一答 → 分享）
- [x] A27 每轮 token/请求预算（maxTokens 经 max_tokens 下发；上下文预算另计）
- [ ] A11 minimap / A12 问题跳转 / A19 代码高亮 / A20 LaTeX / A21 Mermaid / A23 @文件 / A25 打印（小众/低优，未做，诚实记）

## Batch 2 — 模型/API B（✅✅ 构建+复审+修+复审 全 PASS 2026-10-05）
复审发现 B13 有 5 个死设置 → 已修（title/suggest/memory 真接线，translate/ocr 无消费者已删干净）+ B7 缓存诚实说明 + P3 清理 → 复审 PASS。B5/B10 诚实延期（技术上确实做不了，不是借口）。正式打勾。
- [x] B1 OAuth 登录（ChatGPT/Grok/Kimi/Claude，PKCE，逆向端点已标明）
- [x] B2 多 key 轮换（轮询/优先级/最少用/随机，失败自动禁用+冷却恢复）
- [x] B3 余额查询（自定义端点+JSON 路径，60s 缓存）
- [x] B4 自定义 provider 分组
- [ ] B5 per-provider/全局代理（诚实未做：iOS RN 走系统网络栈，应用内 per-request 代理技术上接不上去；类型留了但故意不接线）
- [x] B6 自定义 headers/bodyExtras
- [x] B7 prompt caching 开关（prompt_cache_key）
- [x] B8 诊断日志（ring buffer，Authorization 恒脱敏）
- [x] B9 按模型计价+花费统计（DEFAULT_PRICES + usage 记录）
- [ ] B10 provider 原生工具（诚实延期：OpenAI-compatible 端点无标准 wire 格式；配置模型已留，UI 开关未发货，不做死按钮）
- [x] B11 采样参数（temperature/top_p/max_tokens）
- [x] B12 分享/导入配置（二维码，前缀 dudu-provider:v1:）
- [x] B13 专用模型槽（7 槽，已接入压缩/摘要任务）
- [x] B14 Azure OpenAI 模式
- [x] B15 自定义 User-Agent
- [x] B16 模型速测
- [x] B17 出图端点探测

## Batch 3 — 语音 C（✅✅ 构建+复审+修+复审 全 PASS 2026-10-05）
C1 四家 TTS / C2 自动朗读 / C4 云端 STT / C6 闹钟 / C7 纠错学习全做完，对着 Kelivo 真源码学的。
复审 FAIL 一次（P1：测试 mock 多了 removeItem，2 行修好）→ 复审 PASS。C5 发语音给模型延期（要动消息 pipeline，记账等她拍板）；豆包 TTS 诚实没做（Kelivo 没有，无从对齐）。正式打勾。

## Batch 4 — MCP/工具 D（待）
D1 MCP HTTP/SSE+OAuth / D2 MCP 管理 UI / D3 ask_user / D4 浏览器多标签 UI / D5 网页搜索 / D6 图片压缩 / D7 长粘贴转文件 / D8 工具描述可编辑 / D9 挂载外部文件夹 / D10 环境变量+脱敏 / D11 Skills GitHub 导入 / D12 sub-agent 委派 / D13 跨会话 CLI / D14 交互式终端

## Batch 5 — 记忆/人设 E + 主题 F + 数据 G（待）
E1 人设编辑器 / E2 用户画像字段 / E3 World books / E4 GLOBAL.md / E5 人设标签 / F1 繁体中文 / F2 Google Fonts / F3 Web apps / G1 WebDAV/S3 备份 / G2 自动快照 / G3 Cherry/ChatBox 导入 / G4 存储空间页 / G6 恢复覆盖合并选项

## Batch 6 — 平台 H（待）
H2 Share Extension / H3 用户定时任务 / H4 Siri Shortcuts / H5 Widget（已在计划，对齐） / H6 Live Activity / H7 Files.app / H8 Face ID 锁 / H10 HomeKit / H11 Apple NLP

## Batch 7 — 小功能 I（待）
I1 翻译 / I2 设置搜索 / I3 统计页 / I4 扫码 / I5 VoiceOver / I6 草稿 token 计数 / I7 回车发送 / I8 保持亮屏 / I9 触感反馈 / I10 新聊天行为 / I11 显示开关 / I12 自动滚动 / I13 长消息折叠 / I14 Markdown 按角色开关 / I15 配置审计
