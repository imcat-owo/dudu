# 嘟嘟多平台计划：Android / 桌面 / Web 调研报告

> 调研日期：2026-10-03。只调研，不改代码。
> 结论一句话：**代码库 90% 已经是跨平台的，iOS-only 的东西很少，而且都有降级保护。Android 是最低垂的果实，桌面用 Tauri 套 Web 壳最划算。**

---

## 1. 代码库里哪些是 iOS-only 的？

用 grep 全仓扫了一遍，iOS-only 的东西比想象中少得多：

### 1.1 真·iOS-only 的原生模块（2 个）

| 模块 | 用在哪 | iOS-only 原因 | 现状 |
|---|---|---|---|
| `@wwdrew/expo-apple-music` | 听歌房 Apple Music 音源、原生应用授权区 | MusicKit 是苹果独家，Android 没有 | **已有保护**：`music/sources.ts:210` 用 `tryRequire` 懒加载，抓不到就降级到 local 音源；`native-apps.ts:161-184` 状态检查也是 try/catch |
| `react-native-health` | 原生应用授权区 HealthKit | 这个库（v1.19.0，很老）只支持 iOS HealthKit | **已有保护**：`native-apps.ts:286,303,325` 三处 `tryRequire("react-native-health")`，抓不到就报 `unavailable`，不崩 |

### 1.2 iOS-only 的配置（1 个）

- `apps/mobile/plugins/with-healthkit.js`：Expo config plugin，只往 iOS entitlements 里加 `com.apple.developer.healthkit`。在 Android 构建时是无害的（不执行 iOS 分支），不用动。

### 1.3 `Platform.OS === "ios"` 的硬编码（2 处， trivial）

- `apps/mobile/src/computer-workspace.tsx:38`：`const mono = Platform.OS === "ios" ? "Menlo" : "monospace"` —— Android 上用 monospace，没问题。
- `apps/mobile/src/chat.tsx:1017`：`<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>` —— Android 本来就不需要 padding，已经处理对了。

### 1.4 其余 Platform.OS  usage（5 个文件，全是 web-vs-native 判断）

`agent-workspace.tsx`、`computer-workspace.tsx`、`details.tsx`、`screens.tsx`、`chat.tsx` 里的 `Platform.OS` 几乎全是 `=== "web"` 判断（web 上用 iframe、下载代替分享、去掉 outline 等）。**没有一处是 `=== "android"` 的反向特例，说明 Android 从没被区别对待过——这是好事，意味着代码天生就是 Android-ready 的。**

### 1.5 已有的平台分流文件

```
apps/mobile/src/BrowserConsole.native.tsx / .web.tsx   ← web 用 iframe
apps/mobile/src/DateFields.native.tsx / .web.tsx
apps/mobile/src/PdfReader.native.tsx / .web.tsx         ← web 用自研翻页器
```

`Platform.select` 全仓 **0 次使用**。平台分流做得很少，因为需要分流的地方很少。

### 1.6 app.json / package.json 早就预留了多平台

- `app.json` 里 `android`（package 名已定）和 `web`（metro bundler）小节**已经存在**。
- `package.json` scripts 里 `build:web`、`build:android`、`build:ios`、`expo run:android` **全都有**，只是没人跑过。

---

## 2. Expo Android 构建：哪些会坏？

把 `package.json` 里每个原生模块过了一遍 Android 兼容性：

### 2.1 开箱即用的（不用动）

| 模块 | Android 状态 |
|---|---|
| expo-battery | ✅ Android 支持 |
| expo-device | ✅ Android 支持 |
| expo-secure-store | ✅ Android 用 EncryptedSharedPreferences |
| expo-audio（录音+播放） | ✅ Android 支持 |
| expo-video（桌宠 mp4） | ✅ Android 支持 |
| expo-calendar / expo-contacts / expo-camera | ✅ Android 支持 |
| expo-clipboard / expo-file-system / expo-image-picker | ✅ Android 支持 |
| expo-location / expo-media-library / expo-sharing / expo-document-picker | ✅ Android 支持 |
| react-native-pdf | ✅ Android 原生支持 |
| react-native-webview | ✅ Android 支持 |
| STT / TTS | ✅ 服务端转写/合成，平台无关 |
| 沙箱 SSH transport | ✅ 本来就是 interface + honest unavailable，平台无关 |

### 2.2 需要动手的三件事

**① Android 权限声明**（`app.json` 里 `android` 小节现在只有 package 名）
需要加的权限：`RECORD_AUDIO`（语音）、`CAMERA`（扫码）、`READ_MEDIA_IMAGES`（相册/听歌房封面）、`ACCESS_FINE_LOCATION`（定位）、`POST_NOTIFICATIONS`（Android 13+ 通知）。都是 expo config plugin 自动处理的，加字符串就行，**约半天工作量**。

**② HealthKit → Health Connect**
`react-native-health` 是 iOS-only。现在有两个选择：
- **方案 A（推荐）**：换成 `@appeeky/expo-healthkit`（GitHub 上 27 天前还在更新，Expo Modules API，一套 JS API 同时调 iOS HealthKit 和 Android Health Connect，SDK 53+，我们 SDK 54 兼容）。改动集中在 `native-apps.ts` 的 healthkit 那一段。
- **方案 B（省事）**：Android 上 healthkit 直接显示"不可用"（现在的 tryRequire 保护已经能做到，零改动）。
建议选 A，一次到位，**约 1-2 天工作量**（含真机验证）。

**③ 推送通知要接 Firebase**
`expo-notifications` 在 Android 上走 FCM，需要：
- Firebase 项目 + `google-services.json`（**不能进公开仓库**，走 EAS secrets 或 CI secrets）
- Android notification channels（Android 8+ 强制要求，`device-permissions.ts` 里现在没建 channel，要加几行）
- 如果暂时不想搞 Firebase，可以先只用**本地通知**（`scheduleNotificationAsync` 不需要 FCM），远程推送以后再说。

### 2.3 Android 上会降级的功能（已有保护，不会崩）

- **Apple Music**：Android 上没有 MusicKit，听歌房自动只剩 local 音源（用户自己导音频文件）。这是**唯一功能缺失**，但属于"苹果生态墙"，不是我们的 bug。
- **HomeKit**：本来就没接，不存在。

### 2.4 构建链路

现在 `.github/workflows/build-ios.yml` 是 macOS runner + Xcode。Android 构建两种走法：
- **EAS Build**（`eas build --platform android`）：最省事，Expo 官方云构建，要配 `eas.json`（现在还没有）。
- **GitHub Actions 自建**：`ubuntu-latest` runner + JDK 17 + Android SDK，`npx expo run:android --variant release` 或 prebuild 后 gradle 打包。和 iOS workflow 结构对称，**约半天能抄出来**。

---

## 3. 桌面端方案对比

| 方案 | 原理 | 包体积 | 工作量 | 缺点 |
|---|---|---|---|---|
| **Tauri v2 套 Web 壳（推荐）** | `expo export --platform web` 产物塞进 Tauri 窗口 | ~5MB | 小（配个 tauri.conf.json + 图标 + 构建脚本） | 跑的是 Web 版（见 §4 的 Web 限制） |
| Electron 套 Web 壳 | 同上，换 Electron | ~150-250MB | 小 | 太重，2026 年新项目不推荐 |
| react-native-macos / react-native-windows | 真原生桌面 App | 轻 | **大**（两套原生工程要维护，Expo 不官方支持，得 eject 或另起项目） | 长期维护成本高 |

**有现成案例**：GitHub 上 `raoof128/aion` 就是 Expo + Tauri v2，Tauri 配 localhost:8083 的 Expo web dev server，窗口 420x780（手机比例），证明这条路是通的。

**Kelivo 是怎么做的**：Flutter，一套 Dart 代码 `flutter build` 直接出 iOS/Android/macOS/Windows/Linux。我们是 Expo RN，**做不到一键全平台**，但 Tauri 套壳能达到 80% 效果，工作量只有 Flutter 方案的零头。这是务实选择。

**不推荐 react-native-macos/windows**：那是给"桌面是主战场"的团队用的。我们桌面是附赠品，不值得另起原生工程。

---

## 4. Web 端：多少能跑，多少跑不了？

### 4.1 已经能跑的（`expo export --platform web` 脚本已存在）

- 聊天全套（流式、markdown、thinking 抽屉、artifacts）
- 我们的空间 v2（动态流、纪念日、作品小抽屉）
- 听歌房 local 音源（expo-audio 支持 web）
- 桌宠（expo-video web 用 HTML5 video，mp4 能播）
- 主题系统、skill 系统、AI 记忆
- BrowserConsole / PdfReader / DateFields 都有 `.web.tsx` 特化版

### 4.2 Web 上一定跑不了的

| 功能 | 原因 | 现状 |
|---|---|---|
| Apple Music | 没有 MusicKit for Web（网页版 MusicKit JS 存在但要单独接，现在没接） | native-apps 显示 unavailable（已有保护） |
| HealthKit/Health Connect | 浏览器没有健康数据 API | 同上 |
| expo-secure-store | Web 不支持（会 warn） | **需要加 AsyncStorage fallback**（现在没有，这是 Web 化的一个真·待办） |
| expo-notifications / calendar / contacts | 浏览器无对应 API | 显示 unavailable（已有保护） |
| 沙箱 Backend B（仿 OpenMinis） | 要原生 iSH | 本来就是 honest unavailable |
| 剪贴板 | expo-clipboard 支持 web ✅（例外，能跑） |

### 4.3 Web 的定位

Web 版适合做**演示/预览/轻量使用**，不适合当主力（原生能力缺太多）。但它的最大价值是**给桌面端当壳**（§3 的 Tauri 方案依赖 Web 导出质量）。

---

## 5. 分阶段计划

### Phase 1：Android（优先级最高，约 2-4 周）

| 步骤 | 工作量 | 风险 |
|---|---|---|
| app.json 加 Android 权限声明 | 半天 | 低 |
| HealthKit → `@appeeky/expo-healthkit`（或暂时标不可用） | 1-2 天 | 中（要真机验证 Health Connect） |
| 推送：先只做本地通知，FCM 以后再说 | 1 天 | 低 |
| 建 Android notification channel（`device-permissions.ts` 加几行） | 半天 | 低 |
| GitHub Actions 加 `build-android.yml`（抄 build-ios.yml） | 半天 | 低 |
| 真机冒烟（她装包走一遍） | 等她 | — |

**Phase 1 做完，嘟嘟就是双平台 App。**

### Phase 2：Web（约 1-2 周）

| 步骤 | 工作量 | 风险 |
|---|---|---|
| SecureStore → AsyncStorage fallback（Web） | 1 天 | 低 |
| `expo export --platform web` 跑通，修 web-only 报错 | 2-3 天 | 中（主要是样式/布局在宽屏下的适配） |
| 部署（Cloudflare Pages / Vercel，静态导出） | 半天 | 低 |

### Phase 3：桌面端 Tauri 套壳（约 1-2 周）

| 步骤 | 工作量 | 风险 |
|---|---|---|
| Tauri v2 工程 + 配 web 导出目录 | 2-3 天 | 低（有现成案例） |
| 图标、窗口尺寸、自动更新 | 2 天 | 低 |
| macOS/Windows/Linux 三平台构建（GitHub Actions） | 2 天 | 中（首次配 signing/notarization） |

### 总工作量估计：约 5-8 周（不含等她真机验证的时间）

### 最大的三个风险

1. **Apple Music 在 Android/Web/桌面全没有**：听歌房在这些平台上只剩 local 音源。这是生态墙，无解，只能诚实说明。
2. **Health Connect 要真机验证**：模拟器测不了，得她或测试机装包。
3. **推送的 Firebase 项目**：要新建 Firebase 项目、管 `google-services.json` 的 secret，是一次性 infra 投入。

---

## 6. 平台分流现状总结

| 指标 | 数量 | 说明 |
|---|---|---|
| `.native.tsx` / `.web.tsx` 配对 | 3 对 | BrowserConsole、DateFields、PdfReader |
| `Platform.OS` 使用文件 | 5 个 | 几乎全是 web-vs-native 判断，只有 2 处 iOS 特例 |
| `Platform.select` | 0 | 没用过 |
| 硬 iOS-only 原生模块 | 2 个 | apple-music、react-native-health，都有 tryRequire 保护 |
| app.json android/web 小节 | 已存在 | 配了一半，权限和细节待补 |
| package.json 多平台脚本 | 已存在 | build:web / build:android / build:ios 全有 |

**结论**：这个代码库的跨平台地基比预期好得多。当初写的时候（有意无意）把平台相关的东西都包了保护层，Android 主要是"补配置 + 补 Health Connect + 建构建链"的事，没有架构级重构。
