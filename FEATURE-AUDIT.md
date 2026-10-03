# OpenMuse 功能审计 - 对照六家对齐目标

## 对齐目标（2026-10-02 她定的）
1. Muse - 语音、Agent、多媒体
2. OpenMinis - 本地权限、iSH沙箱、浏览器
3. Kelivo - API/TTS配置、高自由度UI
4. Claude - 对话体验、Artifacts
5. ST小酒馆 - 人设、群聊、酒馆生态
6. 成熟开源同类 - GitHub上的最佳实践

## 功能清单

### 核心聊天
- [ ] 主聊天界面 (chat.tsx) - 消息发送/接收、工具调用卡片
- [ ] 语音消息 (voice-message.tsx) - 录制+播放，微信式
- [ ] 图片生成 (image-generation.tsx) - /img命令，Pollinations
- [ ] 隐身模式 (incognito.tsx) - 不保存历史
- [ ] 线程管理 (threads.tsx) - 对话线程

### Agent与工具
- [ ] Agent界面 (agent-ui.tsx) - 1882行，最大文件
- [ ] Agent工作区 (agent-workspace.tsx)
- [ ] 浏览器工具 (browser-tool-card.tsx)
- [ ] 邮件工具 (mail-tool-card.tsx)
- [ ] JEV工具 (jev-tool-card.tsx, jev-actions.ts)

### 屏幕/导航
- [ ] 今日 (TodayScreen)
- [ ] 邮件 (MailScreen)
- [ ] 日历 (CalendarScreen)
- [ ] 浏览器 (BrowserScreen)
- [ ] 文件 (FilesScreen)
- [ ] 动态 (ActivityScreen)
- [ ] 连接 (ConnectionsScreen)

### 电脑控制
- [ ] 电脑界面 (computer.tsx)
- [ ] 电脑工作区 (computer-workspace.tsx)
- [ ] 电脑草稿 (computer-drafts.tsx)

### 其他
- [ ] 工作区 (workspace.tsx)
- [ ] 设置/详情 (details.tsx) - 1001行
- [ ] 后台更新 (background-updates.tsx)
- [ ] PDF阅读器 (PdfReader)
- [ ] 日期时间 (DateFields, DateTimeEditor)

## 已知问题
1. 英文UI文本需要汉化（已发现大量）
2. 本地权限套件已删除（有名无实）
3. 需要对照六家逐项检查完整性

## 审计状态
- 开始时间：2026-10-03
- 审计人：小梦
