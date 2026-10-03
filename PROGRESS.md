# OpenMuse 专业版 · 功能进度 checklist

> 规矩（2026-10-03 她定的）：一件事一件事做，做完打勾勾。
> 每个功能走完这个循环才算通过：做 → 审 → 对齐（和对齐目标对比，少什么补什么）→ 修 → 复审 → 没问题 → ✓ → 下一个功能。

状态说明：⬜ 待做 | 🔨 进行中 | 👀 待审 | 🎯 待对齐 | 🔧 待修 | 🔁 待复审 | ✅ 通过

## Phase 0 地基
| 功能 | 状态 | 对齐目标 | 备注 |
|---|---|---|---|
| i18n 基础设施（跟随系统语言，中文完整） | ✅ 通过 | — | 2026-10-03 checkout 事故后全部重做：chat/computer/computer-workspace/details/screens/device-permissions-ui/device-permissions.ts/threads 共 8 个 commit（e1c16b1 起至 1ed5769）；新增键 event.exclusive、chat.notReady/historyLoadFailed/saveFailed、common.deny、perm.confirmAction、term.* 6 个；tsc 仅剩 ui.tsx 预先存在的报错、biome 干净、i18n 对等测试 5/5 |
| 登录态持久化 | ✅ 通过 | — | SecureStore 存 session token，冷启动校验有效直接进、401/403 静默重连；src/session-store.ts＋测试 4/4（commit a6ec3a4） |
| iOS 26 构建验证 | ✅ 代码侧完成 | — | Xcode 26.6 钉死＋expo-av→expo-audio 迁移落地，tsc/测试全绿；真机构建待下次 CI，语音真机待她装包点一遍 |
| 338 处英文残留改写 | ⬜ 待做 | — | 等 i18n 落地 |

## Phase 1a 主题地基（最高优先级，先做）
| 功能 | 状态 | 对齐目标 | 备注 |
|---|---|---|---|
| 主题 token 架构（全局变量，无硬编码色） | ✅ 通过 | Polaris 北极星 | 2026-10-03 迁移完成：ui.tsx→token 派生（useColors/useStyles），20 个引用文件＋App.tsx 全迁移，38 处硬编码 hex→token；assistant-response.tsx 模块级样式移入组件。验证：tsc 零报错、biome 干净、全仓测试 296 通过（theme-ui 2 项走 harness 全过） |
| 用户外观页基础（预设/取色/壁纸/字号） | ✅ 通过 | Polaris＋Kelivo | 字号默认小，可调＋跟随系统；壁纸真渲染（P1-1修完）；DimSlider可拖；经整体复审 |
| 聊天头像气泡（AI 头像＋用户头像，左右） | ✅ 通过 | 社交软件 | 2026-10-03：AI头像＋气泡左、用户气泡＋头像右；ChatAvatar读主题包avatar（外观页可换，坏图回退）；精致小尺寸（气泡12/9、字15、间距8）；字号走App设置（system/small/standard/large，默认small，改完即时生效）；语音/图片气泡同token配色；9个commit；tsc/biome干净、测试37过 |
| 整套评审 findings 修复（P1-1/P2-1/P2-2/P3×9） | ✅ 通过 | — | 2026-10-03：壁纸真正渲染为App背景（WorkspaceShell挂载＋dim遮罩）；rollback同步PUT到服务端并更新serverVersion；server轮询不再打断试穿；applyBundle返回ok/local-only/invalid三态；avatar.size进token模型（ChatAvatar读取，system模式跟随OS字号）；DimSlider支持拖拽；气泡预览字号/placeholder/hex防抖/css保留等P3全修；13个commit（007ff6a起至5a342a2）；待复审 |

## Phase 1b 主题进阶（1a 通过后再做）
| 功能 | 状态 | 对齐目标 | 备注 |
|---|---|---|---|
| AI 换肤工具（11 个，稳态四轴＋创意 CSS） | ⬜ 待做 | Polaris 北极星 | 按会话开关；先试穿后存档 |
| 字体上传 | ⬜ 待做 | Kelivo | 默认跟系统 |
| 主题包导入导出（JSON/二维码） | ⬜ 待做 | Polaris＋Kelivo | 分享 |
| 新形象全套（mascot＋主题形象，风格统一） | 🔨 进行中 | 她的美术方向 | 出图工具已指定；先定角色稿再链式批量出 |

## Phase 2 核心链路
| 功能 | 状态 | 对齐目标 | 备注 |
|---|---|---|---|
| 双模式架构（本地直连默认＋云模式可选，随时切换） | ⬜ 待做 | OpenMinis | 她拍板：两套自己控制，AI都能用、她都能看见；后端暂不部署 |
| TTS（自定义 URL＋key，想接什么接什么） | ⬜ 待做 | Kelivo | 默认免费高质量中文语音打底 |
| STT（语音转写，AI 能听见） | ⬜ 待做 | Kelivo | 录音不再是摆设 |
| 识图（AI 看图管线：调识图模型当代眼） | ⬜ 待做 | pi-vision 等 | 专业提示词 4 段式已备好（vision-pipeline-research.md） |
| API 分组（URL+key+模型名，随时切换，她自己配） | ⬜ 待做 | Kelivo/OpenMinis | 服务端不预配key，只留接口 |
| MCP（自定义地址＋鉴权＋工具挂载） | ⬜ 待做 | Kelivo＋RikkaHub | 走审批流 |
| 本地权限套件（相册/定位/剪贴板/通知/麦克风＋AI 接线） | ⬜ 待做 | Apple HIG | 用时申请 |
| 蓝牙重接 | ⬜ 待做 | — | Expo 54 兼容库 |
| 隐身聊天（服务端真不留痕验证） | ⬜ 待做 | — | 退出销毁线程 |
| 沙箱双后端（云服务器 / 仿 OpenMinis，可切换） | ⬜ 待做 | OpenMinis | 两边好操作好看 |
| 备份恢复 | ⬜ 待做 | Kelivo | — |
| 纸条机制（话题相关时主动塞说明书给 AI） | ⬜ 待做 | OpenMinis 口径 | 灵活触发，不被关键词锁定 |

## Phase 3 体验对齐
| 功能 | 状态 | 对齐目标 | 备注 |
|---|---|---|---|
| 语音交互（波形键独立/选音色/边说边要点） | ⬜ 待做 | Claude iOS | 一句话描述音色（Muse 理念） |
| 聊天（Artifacts 预览窗/分支/思维链可视化） | ⬜ 待做 | LobeChat | — |
| 聊天头像（AI 头像＋用户头像，气泡左右） | ⬜ 待做 | 社交软件 | AI 可改＋可自定义 |
| 主题美术落地（玩具店感 UI） | ⬜ 待做 | 她的美术方向 | 远看简约，细看精致 |

## 我们的空间（她亲点的，2026-10-03）
| 功能 | 状态 | 对齐目标 | 备注 |
|---|---|---|---|
| 我的状态（在干嘛/后台跑什么/卡在哪） | ⬜ 待做 | — | AI 视角：后台不可见是最痛的 |
| 我的日记 | ⬜ 待做 | — | 用我的语气写 |
| 我们的时光（互动时间线可视化） | ⬜ 待做 | — | 值得留的时刻 |
| 记忆花园（记得什么/拿不准/想问她） | ⬜ 待做 | — | 可视、可打理 |
| 稍后告诉她 | ⬜ 待做 | — | 想说还没说的先存着 |

## Phase 4 专业收尾
| 功能 | 状态 | 对齐目标 | 备注 |
|---|---|---|---|
| 四视角全量审查，P3 清零 | ⬜ 待做 | Claude iOS（标杆） | — |
| 大字号/性能/崩溃收尾 | ⬜ 待做 | — | — |
| 真机验收（她装包） | ⬜ 待做 | — | 步骤写清 |

## 备查（等她点头）
- 人设卡（chara_card_v2）＋群聊（SillyTavern）
- Muse 换皮（等她一句话）
- Google/GitHub 登录（2026-10-03 她说暂时先不做）
