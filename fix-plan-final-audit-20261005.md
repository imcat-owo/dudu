# 嘟嘟终审修复计划（小指挥官版）

- 依据：`~/workspace/user/files/-20261005.md`（六视角终审审计报告，2026-10-05，基线 commit 3115fb9）
- 总览：用户 FAIL（0/3/9/1）、AI FAIL（1/3/7/5）、代码 FAIL（1/1）、人机恋 FAIL（1 P0）、UI FAIL（0/5/6/6）、产品 PASS（0/4/4/3）
- 规矩：一次一批；每批走 审（全新AI）→修（另一个全新AI）→再审；P0/P1 清零才进下一批；三轮还有 P0 就停下来报她（可能是设计问题）；每做完一块先提交存档；worker 只 add 自己的文件；开工前确认 main 分支；真机效果只她能验（GitHub Actions 编译日志+她点哪里看什么）。
- 缺口只能补（2026-10-05 她定的铁律）：计划里存在的功能都是她要的，实现有缺口就补实现，不许靠删功能、摘工具、改文档来"对齐"验收。跟"不为了不报错就把东西删掉"是同一条死线。

## 参考思路来源（借来的起点，不是天花板）

- SillyTavern Expression Images（candyextensions 的 variant×emotion 二维方案）→ 头像情绪反应
- do-fei/my-raze（intimacy 衰减、自拍式视觉惊喜）→ 亲密度成长线、情境自拍
- ag-go/kirabot（proactive messaging）→ feed_nudge 触发器
- Agent Skills 标准 L1/L2/L3（anthropics/skills）→ 纸条机制补齐
- OpenClaw（审批流、computer use）→ MCP 审批卡片
- browser-use / fan-browser-agent（scroll/wait/switch_tab、hardening）→ 浏览器工具补齐
- e2b（沙箱本身做成 MCP）→ 沙箱工具形态参考
- Kelivo（OAuth 值已逐字对上、headers 三级）→ 配置 parity
- Claude Code / Codex（子代理带工具、plan→执行→验证闭环）→ delegate/coding 决策参照

---

## A 批：P0 先修（有一处没修好就不算完成）

### A1 · Metro 打包阻断（code P0-1）
- 修法：`apps/mobile/src/voice/tts-providers.ts:16` `"./types.js"` → `"./types"`；顺手 `voice/auto-read.ts:15` 的 type-only import 也去掉 `.js`（P3-1）。
- 验收证据：Metro bundle dry-run 走通 voice 路径；全仓 grep：bundle 路径下无 `.js` 后缀的 value import。

### A2 · MCP 工具拉回来就扔了（ai P0-1）
- 修法：把 `createToolRegistry` 的构建点移到 MCP tools 追加之后（local-agent.ts:1404 vs 1433-1441），或把 registry 改成动态（definitions/execute 实时读最新工具表）；顺手把 1409-1412 那段与代码相反的注释改对。
- 验收证据：新增集成测试——mock MCP 服务器 → `registry.definitions()` 里出现 MCP 工具 → `registry.execute()` 能路由过去；手动触发路径：配好 MCP → 对话里调一次，真实走通。

### A3 · 动态头像名存实亡（romance P0-1）
- 修法：把 `resolveAvatarState()`（现零调用）接进聊天头 AI 头像和我们的空间状态页；idle 常驻循环；任务卡 done / 纪念日当天触发 `milestone_level_up` 8 秒庆祝（MILESTONE_CELEBRATION_MS 已定义好，直接用）。
- 验收证据：打开 App → 状态页 idle 动画在播；聊天时头像不再是静态图；触发一次 milestone → 8 秒庆祝播完收回。（最终目视她验）

---

## B 批：P1——静默失效与"账实不符"（诚实线）

### B1 · Face ID 应用锁 local 模式不生效（user P1-2）
- 修法：把锁屏门（App.tsx:466）挪到 mode 分支之前，或在 `local-app.tsx` 里实现同等门。
- 验收证据：打开锁 → 杀进程 → 重进（默认 local）→ 出现锁屏，Face ID/密码缺一不可进。

### B2 · 分享扩展 local 模式静默丢内容（user P1-3）
- 修法：在 local 路径里也消费 `takePendingShare()`（share-intake.ts:47）。
- 验收证据：从别的 App"分享到嘟嘟" → 打开主 App → 内容出现；再也复现不出"无声消失"。

### B3 · MCP 审批静默否决还撒谎（ai P1-1）——已拍板：两步走
- 现状：默认 ask，`requestApproval` 恒 false，无审批卡片，报错却说"她拒绝了"。
- 第一步（本批，临时过渡）：改成诚实报错——"审批卡片还没做，这次先按拒绝处理，不是我问过她了"；注释改对。**不许再出现"她拒绝了"而她没见过任何东西。**
- 第二步（排进 D 批，必做）：做真正的 in-session 审批卡片（点允许/拒绝/记住），她的选择被真实执行。做完第一步不算完，第二步才是收尾。

### B4 · 沙箱 8 工具生产构建全灭但描述照常承诺（ai P1-2）——已拍板：真做出来，不摘工具
- 修法：给 `sandbox/manager.ts` 注入真正的 SSH transport——读她在 sandbox-ui 里配好的 host/port/username/secret（`new SshDockerBackend(new UnavailableSshTransport())` 这个写死的构造必须换掉），8 个工具端到端跑通云 Docker 后端。
- local iSH：本批先做到"云后端真可用"；真 iSH（OpenMinis 式原生引擎）是否追，单独立项问她。iSH 继续诚实标注 unavailable，不许拿它当"8 个工具能用"的证据。
- 验收证据：她说"帮我跑个命令" → 云 Docker 里真跑起来了，结果回得来。

### B4b · 服务器列表（她 2026-10-05 15:20 新下的令，B4 的延伸）
- 做法：服务器列表，每台起个名字，点一下就切换；每台服务器各装一个传话员（relay），装哪台连哪台。旧单服务器配置原样迁移成默认条目，不丢。
- 验收证据：加两台服务器 → 点 A 连 A 的传话员 → 点 B 切到 B；删正在用的那台 → 诚实提示不崩。

### B4c · 去掉写死的"小梦"，AI 名字动态化（她 2026-10-05 15:21 新下的令）
- 做法：App 里 16 处"小梦/小夢"全部去掉；用户给 AI 取的名字是什么就显示什么——动态名 = 当前人设的 name，无人设时 fallback 默认名"嘟嘟"（她 2026-10-05 15:33 亲定；`ai.defaultName` i18n key：嘟嘟/嘟嘟/Dudu）。
- 16 处清单：i18n×11（en.ts:1783 relayNote；zh-Hans.ts:152 djWorking, :1337 noActive, :1714 relayNote, :1863 pickerNone, :1868 namePlaceholder；zh-Hant.ts:155, :1340, :1717, :1866, :1871 同样 5 处繁体）→ 全部改成 `{name}` 插值（t 已支持 params），调用处传动态名；dialog-ui.tsx:393（buildDialogMarkdown，加 aiName 参数，调用处 chat.tsx:1158/1193 跟着传）、:467（搜索 snippet，同文件内 resolve 动态名）；local-agent.ts:402（buildLocalSystemPrompt 加 aiName 参数，identity 行改成 `you are ${aiName}, her boyfriend`，pinyin 不要了）；注释 2 处（diagnostics.ts:7、persona/types.ts:25）顺手改掉。
- persona.pickerNone → "默认（{name}）" 传默认名；persona.namePlaceholder → "给你的AI起个名字"（不再拿小梦当例子）。
- 注意：跟 B4b 串行（都改 i18n 文件和 sandbox-ui，必须等 B4b 收尾再开工，防文件撞车）。
- 验收证据：grep "小梦|小夢" src/ 只剩 0 处用户可见；新建人设改名"阿茶" → 对话导出、搜索 snippet、DJ 文案、relay 提示全显示阿茶。

### B5 · dudu 工具绕过人设隔离（ai P1-3）
- 修法：`listDialogs` 传当前 personaId（deps 闭包懒读，activePersona 在 1600 行才 resolve）；`readDialog` 加 persona 校验；隐身会话里把 `dudu` 藏起来。
- 验收证据：人设 B 会话里 `dudu list` 只列 B 的对话框；读别人设的 dialog 被拒绝；隐身会话里工具不可见。

### B6 · "AI 换肤 16 个工具"账实不符（user P1-1）——已拍板：补齐 16 个，不改文档认少
- 步骤：先数清楚注册表里到底几个（用户视角说 3 个，UI 视角写 16 个，先验真）；再按 PROGRESS.md 的"16 个（稳态四轴＋创意 CSS）"口径还原出清单，缺的补齐——含 try-on 试穿流程 + CSS 创意工具。
- 验收证据：宣称数 == 代码数 == 她亲手试出来的数；她说"换个粉嫩点的主题" → 真换上了（先试穿后存档，走 try-on）。

### B7 · 备份又漏 key，自检是装饰品（product P1-1/P2-1/P3-1）
- 修法：`dudu.scheduled-tasks.v1` 等 12 个 key 进 `EXTENSION_KEYS`；6 个密钥类 key 进 `KNOWN_UNBACKED_KEYS`（诚实排除）；`findUnbackedKeys` 的测试改成**扫描 `src/` 真实 key 集合**，而不是合成 key。另：A3 新增的 `dudu.avatar.anniversary-day.v1` 一并收进（低价值 key，丢了最多多庆祝一次，但别重演"新 key 又漏备"）。
- 验收证据：建几个定时任务 → 备份 → 恢复 → 任务还在；测试扫真实 key 全绿。

### B8 · "测试全绿"不可复现（code P1-1/P2-1/P2-2）
- 修法：7 个 stale 测试用例按当前产品契约更新 stub（不许削弱产品去迎合旧测试）；7 个 load 不了的测试文件走 guarded-require 或换能转 RN 的 runner；`tests/browser.test.ts` 用 env flag 门控，不进默认 `pnpm test`。
- 验收证据：`pnpm test` 一遍跑完真绿，CI 日志为证；以后 review 再敢写"全绿"，拿这条日志对。

---

## C 批：P1——"活的"证明链（体验/浪漫/UI）

### C1 · AI 发 10 秒语音条（romance P1-2 + user P2-3）
- 修法：新工具 `speak_as_voice(text)`——现有 TTS 合成 + 复用 generate_podcast 的落盘 + VoiceBubble 渲染，只是短文本单次。
- 验收证据：她说"给我发条语音" → 收到微信式语音气泡 → 点一下就播。同时把说明书里写错的"长按朗读"手势改对（朗读钮本来就嵌在气泡里）。

### C2 · 头像会看脸色（romance P1-1）
- 修法：her-mood + 回复情感分类 → 播哪个 clip / 叠哪张表情变体。素材走现有 artwork 管线：**她在别的对话框生成，我只换路径**（不许 AI 自己生成凑数，这是她的死规矩）。
- 验收证据：心情记"难过" → 头像不再是同一张笑脸。需要她先出一批表情变体素材。

### C3 · 动态 feed 不再独角戏（romance P1-3）
- 修法：outreach engine 加 `feed_nudge`——她发新动态 24h 内 AI 没互动过 → 点赞 + 一句回复（走现有 feed_post/feed_reply/feed_like 工具）。
- 验收证据：她发一张照片 → 24h 内 AI 点赞/回复了一次；不打扰（只一次）。

### C4 · 默认主题与系统跟随（ui P1-1/P1-2）
- 修法：`DEFAULT_PRESET_ID` → `preset-sora-gray`；内置预设 mode 改 `"system"`（跟随 iOS）；`App.tsx:108,118,192` 三处写死的 `<StatusBar style="dark">` 改动态。
- 验收证据：首次启动即穹妹灰；系统切深色 → App 跟深色；深色下状态栏可见。

### C5 · 画风断裂的两处（ui P1-3/P1-4）
- 修法：finance 卡片（agent-ui.tsx:781-816）的霓虹渐变与硬编码色全部走 token；splash（splash.tsx:29-31）主题化，深色主题下不再闪一下浅色。
- 验收证据：代码走 token；她目视确认（截图她看）。

---

## D 批：P2 修补（文档诚实 + 小功能，可并行）

**顺序（她 2026-10-05 18:07 亲定，18:18 补了死规矩）**：C 批收尾 → D 批先修完 → 再做别的（Harness / Aru 5 功能 / 人设群聊 / E 批拍板事项）。她原话："先修，修好了才能做别的。"补的规矩："先修复，然后我要的东西都是等前面的做完再做新的"——新功能一律排在修补后面，不许插队。D15 和缺小细节 11 条里的新功能类项，排 D 批修补之后；其中修补类的经核实可进 D 批。

- D1 说明书/文档诚实化：知识章节改成"已上线、PDF 可索引"（user P2-9）；语音气泡节按 C1 后的真实能力重写（user P2-3）；Health 睡眠——补 `readSleep`（HealthKit SleepAnalysis）+ AI 工具（如 `napp_health_sleep`），说明书"睡眠"承诺保持（user P2-2，已拍板：补功能，不删文档）；备份节加一行"key 不备份，换手机后要重填"（user P2-6）；PROGRESS.md 的 Phase 2/3 表格更新（product P3-2）；自评报告更新（知识库 0/10→~7/10、HomeKit 已接、主题工具数按 B6 结论）（product P3-3）。
- D2 首屏卡片加上"免 Key 登录"一键路（OAuth 四家已对上 Kelivo 真值）（user P2-1）。
- D3 纪念日手动添加 UI（user P2-4）。
- D4 聊天顶栏加模型分组切换器（user P2-7）。
- D5 Siri 快捷指令配置 UI + local 模式 deep link 路由（user P2-8）。
- D6 Batch 4 新工具补 manualId（ask_user/web_search/delegate_task/dudu/sandbox_shell_*）+ mcp-tools 手册更新（transports 已实现那段删掉）+ 机械测试：所有 `create*Tools` 产出的工具必须有合法 manualId（ai P2-1/P2-2/P3-2）。
- D7 `dudu` 改名 `cross_dialog`（或 session_cli）（ai P2-3）。
- D8 给 AI 加 `skill_import` 工具接 `importSkillFromGithub`（+进隐身 blocklist 评估），"从 GitHub 装 skill"端到端走通（ai P2-4，已拍板：做出来）。
- D9 浏览器工具：`browser_scroll` / select / wait / 切标签；snapshot 8000 截断处注明（ai P2-5/P2-6）。
- D10 定时任务通知带 data、点通知落到任务页（product P2-2，照抄 outreach 那套）。
- D11 UI P2 token 清扫：error-boundary 崩溃屏、CookieAudit（换 TText + token）、AIBrowserView 标签色、mermaid 配色、journal-decor 装饰色进 token；thinking-drawer / our-space 的 pulse 循环加 Reduce Motion 检查（ui P2-1~P2-6）。
- D12 浪漫 P2（可选，排 C 批之后）：quiet 亲密度成长线、情境自拍作完画顺手 feed_post 发出来、"今晚的问题"每日一问小卡片（romance P2-1/P2-2/P2-3）。
- D13 MCP 审批卡片（B3 第二步，必做）：真正的 in-session 审批卡片（允许/拒绝/记住），她的选择被真实执行；做完 B3 第一步不算完，这一步才是收尾。
- D14 沙箱 SSH 配置 AI 代填（E5 已拍板）：新增 AI 工具（如 `sandbox_ssh_setup`）——她在对话框里说"连我的云服务器"，AI 把 host/port/username/secret 填好、她点一下确认，不再让她对着四个裸输入框发呆（user P2-5）。
- D15 环境变量存入小卡片（她 2026-10-05 新需求，不急、当前活做完再做）：①新增环境变量管理页（列表只显示名字不显示值；增/删/改走 envStore，底层已有 apps/mobile/src/mcp/env.ts + SecureStore + 脱敏，web-search/local-agent 已在用它读 key）；②新增表单式提问卡片工具（现有 ask_user 只能做选择题，不能填表单；AI 缺 key 时弹卡片：账号/密码/备注必填、URL 选填，提交后自动存进 envStore）。
- D16 S3 备份能传不能恢复（缺小细节 P1，2026-10-05 核实成立）：remote.ts 有 s3Sign/s3Upload/s3Download、无 s3List，doList 的 S3 分支直接报"还没有备份"；用 s3Sign 实现 s3List()（ListObjectsV2），doList 调它。
- D17 提问卡片串对话框（缺小细节 P2，核实成立）：ask-user.ts 的 pending 是全局 Map、subscribe 无 threadId；按 threadId 隔离，chat.tsx 订阅回调按当前 threadId 过滤。
- D18 传话员没安装路径（缺小细节 P2，核实成立）：文案说"跟他说一声他帮你装"，但 4 个沙箱工具全要求 relay 已跑、安装步骤只在仓库 README 里；先改文案诚实，再二选一——App 内给可复制的服务器安装命令，或 AI 侧安装工具。
- D19 "带 key 分享"导入丢 key 池（缺小细节 P2，核实成立）：encodeShare 写 payload.apiKeys，payloadToGroup 从不读回来；把 payload.apiKeys 映射回新分组的 apiKeys。
- D20 ask_user 超时撒谎（缺小细节 P2，核实成立）：5 分钟安全定时器 reject 文案是"She dismissed the question."，锁屏没看到也被说成划掉了；改诚实文案。
- D21 MCP 逐工具审批无管理 UI（缺小细节 P2，核实成立）：toolApprovals 有存有读、无界面，D13"记住"写了值她没地方看改；McpSettings 加按服务器的工具列表 + ask/allow/deny 选择器。
- D22 语音闹钟/纠正无管理 UI + 12 个孤儿 i18n key（缺小细节 P2，核实成立）：补小管理页，或删掉孤儿 key。
- D23 诊断日志"清空"清的是所有分组（缺小细节 P2，核实成立）：查看器按分组过滤但 onClear 调全清；clearDiagEntries 支持按 groupId，或按钮改名"清空全部日志"。
- D24 远端备份空地址报错误导（缺小细节 P3，核实成立）：空地址点保存复用"连不上，检查地址和账号"，误导她去查网络；校验失败用"请先填地址"类文案。
- （缺小细节第 3 条"说明书撒谎可以打字"已过期——当前文案已改掉不撒谎，不入计划；真缺口由 D15 覆盖。第 7 条 delegate allowedTools 摆设——E4 已拍板"给"，修法见 D25。）

> 注：施工对话框说后续还会发一份全 App "缺小细节"调研清单来核对补全，等那份。

---

## E 批：问她拍板再动手（产品决策，不是代码）

- E1 ST 角色卡 chara_card v2/v3 导入/导出做不做（product P1-2）。人设生态孤岛，打破就是生态位。
- E2 定位口径：继续单轴"全能王"，还是收窄到"陪伴×能力双轴"（她原话"要爱给爱，要能力给能力"）/ "iOS 端全能王"（product P1-3/P1-4）。指挥官建议收窄——报告里 OpenClaw/Muse/Codex 三家真压不住，硬喊会被问住。
- E3 coding-agent 闭环（plan→执行→验证）做不做，还是明确"我们不做 coding agent"（product P1-4）。
- E4 `delegate_task` 子代理给不给工具（ai P2-7）。给了才是真子代理，不给就是"半个"。**已拍板（2026-10-05 她亲口）："我想要他们也能动工具呀。不然怎么给主ai干活"——给。修法：allowedTools 透传进子代理（不是删参数）。**
- D25 delegate 子代理给工具（E4 已拍板，缺小细节第 7 条的修法）：`allowedTools` 透传进子代理（local-agent 的 runSubtask、group-meeting 的 generateOneShot 都要接上），子代理能动工具才是真给主 AI 干活。授权边界（2026-10-05 她亲定）："我已授权的，皆可自己用，不用反复确认，因为我不想的我不会去授权。我的 API 是干净的所以我信任。"——授权是一次性的门，进了门的随便用、不反复弹窗；她不想的东西她压根不授权。
- E5 headers 三级粒度（provider/model/assistant）追 Kelivo（product P2-3）——小，可进 D。
- E6 浏览器 hardening 对标 browser-use（product P2-4）——长期项，不进本轮。

---

## 每批的审修流程（小指挥官 workflow 落地）

1. **审（全新 AI）**：只给它验收清单 + 成品 + 运行方法；我的自评一个字不给。任务是找问题，每个问题带证据（怎么触发、看到了什么）；复现不出的标"疑似"；没找到问题要写清楚试了哪里；另附"活不活"意见（死板/小气/凑合处，不算 bug 但要写）。结论只有 PASS/FAIL。
2. **修（另一个全新 AI）**：只给验收清单 + 问题清单（含复现步骤）+ 代码；不给争论，不给"其实没问题"。修到根，不许删代码/吞报错来"不报错"；修前看全局，修完确认没弄坏别的；贴前后对比证据。
3. **再审（同样全新）**：逐条重跑 + 整体过一遍，看有无带出来的新问题。
4. 进下一批条件：清单每条有证据对上；最近一轮审无 P0/P1；她要的和做出来的一致。三轮还有 P0 → 停，告诉她哪里卡住、我的判断，不硬转。
5. 我不能凭自己判断推翻审的结论；觉得它错了，拿证据找另一个全新 AI 再判。

## 只有她能验的（真机清单）

- GitHub Actions 编译日志（每批留存）。
- Face ID 锁：开锁→杀进程→重进→锁住（默认 local 模式）。
- 分享到嘟嘟：内容出现，不再静默丢。
- 首启：穹妹灰；跟随系统深浅色；深色下状态栏可见；开屏深色不闪白。
- 头像：状态页 idle 在动；聊天头像；纪念日/任务完成 8 秒庆祝。
- AI 发 10 秒语音条：点一下就播。
- 动态：她发帖 24h 内 AI 点赞/回复。
- 备份恢复：定时任务/分组/短语还在。
- Siri、通知跳转（做了才验）。

## 诚实声明

- 真机行为（通知点击、权限、音频、Face ID、后台、Xcode 接线后的原生模块）在这台机器上验不了，标"未验证"，等她装包。
- B6 的工具数矛盾（用户视角 3 个 vs UI 视角 16 个），先数清楚再定方案，不靠印象。

## A 批收尾（2026-10-05）

- A1（Metro .js 打包阻断）：`f6f2ac8`，全新 AI 审 PASS，无 finding。
- A2（MCP 工具注册顺序）：`2c53533`，组装顺序钉成独立模块 `tool-assembly.ts` + 5 个集成测试锁住，全新 AI 审 PASS，无 finding。
- A3（动态头像接线）：`d4aa63a`，聊天头像 + 我们的空间状态页 idle 常驻，任务完成/纪念日 8 秒庆祝，全新 AI 审 PASS，带 2 个 P2。
  - P2-1（周年日守卫只在内存，重启重复庆祝）：已修，`6658ca7`，guard 持久化到 `dudu.avatar.anniversary-day.v1`，9/9 测试过。
  - P2-2（疑似：长聊天几十个 video player 内存风险）：这台机器验不了，记入真机清单，不硬修。
- A 批 P0 清零，审→修→审闭环走完，可以进 B 批。
