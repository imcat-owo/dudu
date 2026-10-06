# 七视角审计报告：闪退案 + 新功能（2026-10-06）

> 规矩：七个审稿的都是干净新对话框，跟做事的不是同一批，每个结论都带证据（文件行号+亲手跑的验证），推测标成推测。
> 审计对象：HEAD `f0873e6`（11 个人机恋新功能 + 表情包；⑪ 换装系统已按她要求移除）。
> 崩溃的包：2026-10-05 构建（run 37252981968，commit `76122a8`）——**里面一个新功能都没有**，全是 10-06 才落地的。所以闪退是底座本来就有的问题，跟这轮新功能无关。

## P0：闪退（七个视角一致的头号事项）

- 症状：每次点开，开屏动画（JS 画的，约 1.8 秒）播完，之后立刻闪退。手机里无 `.ips` 崩溃日志。
- 包本身没问题：构建日志干净（BUILD SUCCEEDED），IPA 解开看过，Hermes 字节码完整、资源都在。
- JS 层已排除：开屏能播完 = JS bundle 加载成功；`ErrorBoundary` + `CrashFallback` 实现正确，JS 报错只会显示错误页不会杀进程；启动期 provider 全是 try/catch。
- 头号嫌疑（原生层）：`AIBrowserView`——开屏后首次挂载的第三方原生视图（react-native-webview 套 react-native-view-shot，常驻隐藏挂载），时间点和"开屏刚过就退"完全对上。原生崩溃 ErrorBoundary 拦不住。
- 次要嫌疑：`expo-dev-client` 被打进 Release 包（构建日志里 `-DEX_DEV_MENU_ENABLED=1`）；全能签重签名权限问题（她说签名时什么都没动过，可能性低）。
- 已修（commit `76f33d4`，已 push）：浏览器 WebView 改懒挂载（AI 真用浏览器时才挂）+ 启动里程碑日志（`bootlog.ts`，CrashFallback 底下显示最近 8 条，截图就知道死在哪步）。
- 构建状态：诊断包第一次构建失败——`DuduIntents.swift` 缺 `import UIKit`（xcodebuild：cannot find 'UIApplication' in scope）。已修（`26c8149`，加一行 import），重新构建中。
- 判定方法：新包能进主界面 = WebView 就是凶手；还退 = 看里程碑截图定位。

## 各视角结论

| 视角 | 结论 | Findings |
|---|---|---|
| 闪退专项 | 包没问题，运行时原生崩溃 | 见上 |
| CODE | PASS | P1：expo-dev-client 不该进正式包；P2：零崩溃上报（componentDidCatch 静默）；P2：AIBrowserView 首屏挂载（已在 76f33d4 修）；P3：CrashFallback 用 TText |
| AI-USE | PASS | 工具发现→调用→渲染→手册链条完整；换装移除零残留；P3：无痕里 sticker_list 被拦是 fail-closed 代价，可接受 |
| PRODUCT | 功能侧 PASS，整体被 P0 卡死 | 11 项+表情包全部真实闭环，无死按钮；P3：分段开关没进备份；P3：表情包不进备份要在管理界面写清楚；P3（信息）：AI 表情库开箱就有 10 张小恶魔 |
| ROMANCE | PASS | 克制规则代码里是真的（分段/自拍/打卡/电话/发帖/触达上限）；P3：表情包"一回合一张"只有手册约束，代码没数；P3（告知）：分段时"正在输入"一直亮着 |
| UI | PASS | P3：`translate-ui.tsx:64` 的 `✓` 文本对勾 → 已换成 lucide Check（`9a66c97`） |
| USER | PASS | i18n 三语有编译器级硬保证；用户文案诚实（GIF 首帧、备份不进、换装无残留） |

## 待修清单（按优先级）

1. **P0 闪退**：等新包构建成功 → 她装上验证 → 钉死凶手。
2. **P1**：`expo-dev-client` 移出正式包依赖（如果二分法排除 WebView，它是下一个嫌疑人）。
3. **P2**：崩溃上报（fallback 里把错误写本地，下次启动上报）。
4. **P3**：分段开关进备份；表情包管理界面加"只存本机"提示；表情包一回合一张写进代码。

## 证据说明

每个 finding 背后都有文件行号和亲手跑过的命令（tsc/biome/测试/grep），完整审稿记录在各审稿对话框。推测项（如 WebView 是凶手）已标成推测，判定方法写在上面——新包点一次即见分晓。
