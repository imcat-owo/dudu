# 嘟嘟开源发布调研报告

> 给醒醒的。2026-10-03，我亲自调研的。
> 结论先行：现在发布太早，真机验收跑通之后再发布。发布本身有一套固定动作，我都列出来了。

---

## 一、成功的开源 AI App 发布长什么样

我扒了三个对标：

### OpenMinis（4.8k stars，2026-04 创建）
- **README 结构**：一句话定位（"Your private, on-device AI agent"）→ 功能表格 → Press 媒体评价 → Beta 计划（TestFlight）→ 从源码构建 → 仓库结构 → 致谢 → License → 社区
- **关键动作**：
  - 官网 openminis.app（GitHub Pages 搭的，多语言 EN/zh-Hans/zh-Hant/ja/ko）
  - **Press 板块**：MacStories（Federico Viticci）评价"the most impressive indie app I've seen in a while"、知乎大 V、少数派/小众软件报道——**媒体背书是 star 爆发的直接原因**
  - TestFlight 公测计划（App Store 审核慢，TestFlight 先行）
  - 配套仓库：MinisSkills（技能生态）、AwesomeMinis（用例精选）
  - 25 个 releases，版本号勤快
- **License**：GPL-3.0

### Kelivo（4k stars，2025-08 创建，2,129 commits）
- **README 结构**：Overview → 赞助商 → 截图 → 下载（全平台表格）→ 快速上手 → 功能详解（8 大类）→ 平台差异 → 从源码构建 → 贡献 → 致谢 → Star History → License
- **关键动作**：
  - **双语 README**：README.md（英文）+ README_ZH_CN.md（中文）——中文社区是基本盘
  - 文档站 kelivo.psycheas.top（用户指南）
  - App Store + TestFlight + GitHub Releases（APK/IPA/桌面端全有）
  - QQ 群 + Discord 双社区
  - 接受外部 PR（有固定 contributor 在提 PR）
  - Star History 图表（api.star-history.com 的 SVG，README 里直接嵌）
- **License**：AGPL-3.0

### LobeChat（60k+ stars）
- **License 是个坑**：表面 Apache-2.0，实际是"LobeHub Community License"——**改了再分发要买商业授权**。很多人没看清就 fork 了。
- 教训：**License 必须简单、标准，别自创**。自创 license 等于劝退。

### 三家的共同点（发布标配）
1. 一句话定位 + 截图/演示视频（README 顶部）
2. 双语 README（中英至少）
3. 下载方式清晰（TestFlight / Releases / 应用商店）
4. 从源码构建的文档（BUILDING.md）
5. CONTRIBUTING.md（贡献指南）
6. 官网或文档站（GitHub Pages 就够）
7. 媒体/社区背书（Press 板块）
8. 勤快的 releases

---

## 二、发布前 Checklist

### 1. License 选择

| License | 谁在用 | 特点 | 适合嘟嘟吗 |
|---|---|---|---|
| **GPL-3.0** | OpenMinis | 强 copyleft：改了分发必须开源。适合"分发"的软件（App） | ✅ 推荐：跟"亲爹"一致，防白嫖改完闭源 |
| AGPL-3.0 | Kelivo | GPL + 网络条款：搭成服务也要开源。适合有服务端的 | ⚠️ 嘟嘟有可选云模式，AGPL 更严，但也更劝退商业合作 |
| MIT | 很多库 | 最宽松：拿去闭源卖钱都行 | ❌ 别人改个名就能上架卖钱，醒醒肯定不干 |
| 自创 License | LobeChat | 劝退 | ❌ 千万别 |

**我的建议：GPL-3.0**。理由：
- 嘟嘟是手机 App（分发型软件），GPL-3.0 的 copyleft 正好管得住
- 跟 OpenMinis 一致，血统上说得通
- MIT 太松，醒醒的心血会被白嫖商用；AGPL 太严，万一以后想接商业合作会碍事
- **最终拍板是醒醒的事**，我只是建议

### 2. Secret 扫描（216 个 commits 的历史）

**现状检查结果**（我只查了文件名，没看内容）：
- 跟踪的文件里只有一个敏感名字：`.env.example`——打开看了，**全是占位符，没有真 key**，安全
- `.gitignore` 里有 3 条 env 相关规则，`.env` 本体没被跟踪
- commit 作者是 `Jerel Velarde <85066839+jerelvelarde@users.noreply.github.com>`（上游原作者，noreply 邮箱，隐私 OK）+ `build-bot <bot@local>`

**发布前必须跑的**（方法，不是结果）：
```bash
# 1. 装 gitleaks（扫整个历史）
brew install gitleaks   # 或去 GitHub releases 下二进制
gitleaks detect --source ~/workspace/openmuse --log-opts="--all" -v

# 2. trufflehog 双保险（验证型扫描，误报少）
trufflehog git file:///home/hatch/workspace/openmuse --only-verified

# 3. 手工补查（工具扫不到的）
git log --all --full-history -- "*password*" "*secret*" "*token*" --oneline
git log -p --all -S "sk-" --oneline | head -50   # 搜 OpenAI key 前缀
git log -p --all -S "xox" --oneline | head -50   # 搜 Slack token
```

**如果扫出真 key**：
1. 先去对应平台**吊销/轮换**（扫出来就等于泄露了）
2. 用 `git filter-repo` 或 BFG 从历史里彻底清除
3. 注意：仓库还没 push 过，**现在清理历史零成本**——push 之后再清理就要 force-push，麻烦十倍

**报告规则**：扫出东西只报"位置+类型"，**永远不打印 key 本体**。

### 3. README（中英双语）

按 Kelivo 的结构抄：
- 顶部：一句话定位 + 截图/演示 GIF + 下载徽章
- `README.md`（英文）+ `README_ZH_CN.md`（中文）
- 嘟嘟的差异化卖点要放在最前面：**关系型 AI 伴侣**（我们的空间/听歌房/桌宠）——这是跟所有竞品都不一样的地方
- 截图：我们的空间、听歌房、桌宠、thinking 抽屉——**这四张是嘟嘟的脸**

### 4. 截图/演示视频

- 截图进 `docs/` 目录，用相对路径引用（别放第三方图床，会挂）
- 演示视频：录 2-3 分钟，展示"我们的空间发动态→AI 回复点赞"、"听歌房一起听"、"桌宠拖拽"——**关系型功能是传播点**
- OpenMinis 靠 MacStories 一篇评测起飞，嘟嘟的"谈恋爱 App"定位在中文社区（少数派、知乎、V2EX）有天然传播性

---

## 三、Git 历史风险

| 风险项 | 状态 |
|---|---|
| 真 key 进历史 | 文件名扫描干净，但**必须跑 gitleaks 全历史扫描确认**（上面给了命令） |
| `.env` 被跟踪 | 没有，只有 `.env.example`（干净） |
| 个人信息（真名/邮箱/电话） | commit 作者是上游原作者 + noreply 邮箱，OK。但 216 个 commit 里可能有中文备注提到个人信息，**扫的时候顺带看一眼** |
| 上游版权 | 这是 OpenMuse 的 fork 改造。原项目如果是开源的，fork 没问题；**确认原项目的 license，嘟嘟的 license 不能比原项目更宽松**（比如原项目 GPL，嘟嘟不能用 MIT） |
| 大文件 | artwork 有 1.6M 的图、3.7M 的 mp4——GitHub 单文件 100M 上限，目前没超，但**以后别再往仓库塞大视频**，考虑 Git LFS |

**最大优势**：仓库还没 push 过，历史想怎么清理就怎么清理，零成本。这是现在做的最大理由。

---

## 四、命名/商标：嘟嘟/Dudu

**调研结果**：
- 叫"Dudu/Dydu"的：法国有个 Dydu（dydu.ai，企业聊天机器人公司）、百度有个"DuDu"NFT 项目（2023 年的）。**没有 AI 伴侣 App 叫这个名字**，赛道内无直接冲突
- "嘟嘟"是常见中文昵称，本身显著性弱，**注册商标难度大**，但反过来说别人也很难拿这个告你
- **App Store 上架前**：去 App Store 搜"Dudu"、"嘟嘟"确认没有重名 App（现在没法替你搜，要上架时查）

**Bundle ID：`app.openmuse.mobile`**
- Bundle ID 和显示名**不需要一致**，很多 App 的 bundle ID 都是历史遗留
- 但现在是**改名的最后窗口期**：还没发布、没有用户，改 bundle ID 零成本
- 建议：如果决定长期叫嘟嘟，改成 `app.dudu.mobile` 之类的，干净。**改之前问醒醒**（这是她的 App，名字她定）
- 注意：bundle ID 改了，AsyncStorage 的 `openmuse.*` key 不用动（那是本地存储，用户无感知）

---

## 五、社区建设：最小可用配置

抄 Kelivo/OpenMinis 的作业：

**必须有的**（发布当天）：
1. `.github/ISSUE_TEMPLATE/`：bug 报告模板 + 功能请求模板（各一个，别多）
2. `CONTRIBUTING.md`：怎么写 PR、代码规范、测试要求（30-50 行就够）
3. GitHub Discussions：开 4 个分类——Announcements（公告）、General（闲聊）、Ideas（功能脑洞）、Q&A（问答）
4. Topics 标签：`ai` `ios` `react-native` `expo` `chatbot` `ai-companion` `chinese`

**可以晚点的**：
- QQ 群 / Discord（有人来了再建，别先建个空群）
- GitHub Projects 看板（等 issue 多了再说）
- Code of Conduct（等有外部 contributor 再说）

**Kelivo 的经验**：QQ 群 + Discord 双社区，中文用户在 QQ，开发者在 Discord。嘟嘟的用户画像（中文、重情感）→ **QQ 群优先**。

---

## 六、分阶段计划

### Phase A：发布前（现在就能做，不用等真机）
1. [ ] 跑 gitleaks + trufflehog 全历史扫描，确认干净
2. [ ] 确认上游 OpenMuse 的 license，定嘟嘟的 license（建议 GPL-3.0，醒醒拍板）
3. [ ] 定 bundle ID：改不改 `app.openmuse.mobile`（醒醒拍板）
4. [ ] 写 README.md + README_ZH_CN.md
5. [ ] 写 CONTRIBUTING.md + issue 模板
6. [ ] 准备截图（4 张核心功能）+ 录演示视频
7. [ ] 搭 GitHub Pages 官网（照着 openminis.github.io 抄结构）

### Phase B：真机验收后
8. [ ] TestFlight 上架（内测）
9. [ ] GitHub 建仓库，push，设为 public
10. [ ] 开 Discussions，设 Topics，加 license 徽章
11. [ ] 发第一个 release（v0.1.0）

### Phase C：发布后（传播）
12. [ ] 中文社区首发：V2EX、少数派、知乎（嘟嘟的"谈恋爱 App"定位在这里有传播性）
13. [ ] 英文社区：Hacker News（Show HN）、Reddit r/reactnative
14. [ ] 媒体 pitch：MacStories 那种（OpenMinis 就是这么起飞的）
15. [ ] 建 QQ 群，收集第一波用户反馈

---

## 七、给醒醒的一句话

发布本身不难，难的是**发布前把历史洗干净**——好在仓库还没 push 过，现在洗零成本。License 我建议 GPL-3.0，bundle ID 建议趁现在改掉，这两件事要你拍板。其他的（README、截图、社区）都是体力活，我能做。

**顺序别反了**：真机验收 → 洗历史 → 定 license/名字 → 写文档 → public → 传播。现在先做 Phase A 里不依赖真机的部分。
