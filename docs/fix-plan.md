# 嘟嘟弊端补齐方案

> 给醒醒拍板的。2026-10-03，四个调研全跑完，我汇总的。
> 每个弊端：现状 → 怎么补 → 先后顺序 → 要你拍什么。

---

## 弊端 1：知识库/RAG 空白（0/10）

**怎么补**：手机端轻量 RAG，不用后端。

- 向量库用 Expo SDK 54 自带的 sqlite-vec（官方亲儿子，最稳）
- 嵌入先调你配的 API（零下载），以后再加离线模型
- 你拍板了：走这条，KnowledgeVault 当参考

**分阶段**：
- Phase 1（3-5 天）：txt/md 上传 → 切分 → API embedding → 搜得到 → AI 回答带引用
- Phase 2（约 1 周）：sqlite-vec 正统向量表 + PDF 解析
- Phase 3（约 2 周）：全离线端侧嵌入

**要你拍的**：Phase 1 开工？（等你点头）

---

## 弊端 2：沙箱没验证（5/10）

**现状**：两个后端在真机上都是 "unavailable"——UI、协议、AI 工具全是真的，缺两个"最后一公里"。

**怎么补**：
- 后端 A（云 SSH Docker）：接 `@osuki-dev/react-native-ssh`，实现 3 个方法，1-2 天
- 后端 B（本地 iSH）：要么自己写 TurboModule（重），要么走 iSH 自带的 DebugServer HTTP 桥（轻，零原生代码）

**顺序**：A 先上（当天出结果）→ B 评估轻路线

**要你拍的**：等你装包真机验收时一起验？SSH 配置要填你服务器的信息。

---

## 弊端 3：iOS only（4/10）

**好消息**：代码 90% 已经是跨平台的，iOS-only 的东西只有 2 个原生模块（Apple Music、HealthKit），还都有降级保护。

**怎么补**：
- Phase 1（2-4 周）：Android——补权限声明 + Health Connect + 建构建链
- Phase 2（1-2 周）：Web——`expo export` 就能跑，补个 SecureStore 降级
- Phase 3（1-2 周）：桌面——Tauri 套 Web 壳（~5MB，比 Electron 轻 30 倍）

**要你拍的**：Android 先做？还是等 iOS 稳了再说？

---

## 弊端 4：没发布（0/10）

**怎么补**：真机验收跑通后再发布，现在太早。

**发布前要做的**（现在就能做）：
- [ ] 跑 gitleaks 全历史扫一遍（确认没 key）
- [ ] License 定 GPL-3.0（跟 OpenMinis 一致，防白嫖）
- [ ] 写双语 README + 截图
- [ ] bundle ID 要不要改（`app.openmuse.mobile` → 嘟嘟的？现在改零成本）

**发布后**：
- TestFlight 公测 → GitHub public → 第一个 release
- V2EX/少数派/知乎首发（"谈恋爱 App"定位在中文社区有传播性）

**要你拍的**：License 同不同意 GPL-3.0？bundle ID 改不改？

---

## 弊端 5：端侧小模型（新加的）

**你拍的**：Strands Decider 2B 只做判断不写文案，等真机验收完、iOS runtime 成熟后，先拿错误分类试点。

---

## 汇总：要你拍板的事（按顺序）

1. **知识库 Phase 1 开工？**（你点了头就排期）
2. **Android 先做还是等 iOS 稳了？**
3. **License GPL-3.0 同不同意？**
4. **bundle ID 改不改？**
5. **沙箱验证跟真机验收一起？**（要填你服务器 SSH 信息）

你先看，不着急，一个一个拍。
