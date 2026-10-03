# 基础设施零件审计：MCP / TTS / BLE（借用，不自造）

> 日期：2026-10-03
> 方法：下面每一个仓库都是实际打开读过的（README、源码、package.json、提交记录），不是凭训练记忆推荐的。不合适的会直说，找不到就继续找。
> 目标栈：Expo SDK 54 / React Native 0.81.5 / iOS 26 / 简体中文优先。

---

## 1. MCP Client（Expo TypeScript 可用）

### 采用：官方 SDK `@modelcontextprotocol/client` v2

- **仓库**：https://github.com/modelcontextprotocol/typescript-sdk
- **状态**：13,504 stars，1,655 commits，活跃（v2 稳定线，对应 2026-07-28 协议）。
- **许可证**：Apache-2.0（v2 新代码；仓库页标注见 README）。
- **借什么**：整个 client 包。`Client` 高层类 + `StreamableHTTPClientTransport`（Streamable HTTP）+ `SSEClientTransport`（ legacy SSE）。stdio 传输出于 iOS 上不可能（不能 spawn 进程），直接不用。

**我实际读到的关键证据：**

1. `packages/client/src/index.ts` L69–71 有官方注释：stdio 相关导出被刻意放到 `./stdio` 子路径，**主入口不含 `child_process`/`cross-spawn` 等进程依赖**。这意味着 `import { Client } from '@modelcontextprotocol/client'` 进 Metro 是安全的，不会重演之前 BLE 那种打包失败。
2. `packages/client/src/client/streamableHttp.ts` L1388–1464：SSE 流式响应用 `response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream()).getReader()` 读取——**依赖 WHATWG ReadableStream + TextDecoderStream**。
3. `packages/client/src/client/sse.ts` L24–26：`import { EventSource } from 'eventsource'`（npm 包）。
4. `eventsource` 包（https://github.com/EventSource/eventsource，1,160 stars，MIT）：README 明确要求运行环境提供 **fetch、ReadableStream、TextDecoder、URL、Event/EventTarget/MessageEvent**。React Native 的 Hermes 默认没有 ReadableStream / TextDecoderStream / EventTarget。

**接到 Expo 应用里的准确做法：**

```ts
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

// 主力：Streamable HTTP（官方推荐的、未废弃的传输）
const transport = new StreamableHTTPClientTransport(new URL('https://mcp.example.com/mcp'), {
  // 简单 Bearer：Zapier 这类自填 MCP 入口就用这个
  authProvider: { token: async () => apiKey },
});
const client = new Client({ name: 'openmuse', version: '0.1.0' });
await client.connect(transport);
const { tools } = await client.listTools();
await client.callTool({ name: '...', arguments: {...} });
await transport.close();
```

- **SSE（legacy）**：`SSEClientTransport` 也在主入口里，但它的 `eventsource` 依赖在 RN 里需要补 polyfill（`web-streams-polyfill` + EventTarget shim），且 SSE 已被官方标记 deprecated。**结论：只实现 Streamable HTTP，不接 SSE**——除非以后遇到只支持 SSE 的老服务器，再加 polyfill。
- **流式响应的坑**：Streamable HTTP 服务器回 `text/event-stream` 时，SDK 要走 ReadableStream 管道。RN 默认没有 → 两个选择：(a) 装 `web-streams-polyfill` 并在入口 `globalThis.ReadableStream` 等打上；(b) 大多数工具调用场景服务器会直接回单条 JSON（非流式），先用 (b) 的路径跑通，流式以后按需加 polyfill。**不要自己手写一套 MCP 协议**，Transport 接口很小，真有特殊需求就实现 SDK 的 `Transport` 接口（start/send/close + onmessage/onerror/onclose），继续复用官方 `Client` 类。
- **OAuth**：SDK 自带 `auth` 模块（`jose` 纯 JS 实现；App 里已有 `react-native-get-random-values`，可满足其随机数需求）。先只做 Bearer/API Key，OAuth 以后再说。
- **注意**：package.json 里 `.d.mts` 引用了 `Buffer` 类型（README 原话要求 tsconfig 加 `"types": ["node"]`），运行时用不到就不用管；真用到了再加 `buffer` polyfill。

**没找到的东西（诚实记录）：** 没有找到生产级的 "Expo 专用 MCP 客户端封装"。搜到的 `mstrmnd-mobile` 只是提了一句 MCP、实际没接线；`@tanstack/ai-mcp` 只是对官方 SDK 传输层的薄封装，没增加 RN 价值。所以结论就是：**直接用官方 SDK，不找二手封装**。

---

## 2. TTS（Expo iOS，中文语音要好）

先说结论：**服务端合成 → 下发音频文件 → App 内 expo-av 播放**（正好对上现有 `voice-message.tsx` 的 VoiceBubble，它本来就是播 URI 的）。`expo-speech` 只做离线兜底。

### 对比表（全部是读过仓库/文档后的判断）

| 方案 | 中文语音质量 | 延迟 | 成本 | 离线 | 许可证 | 结论 |
|---|---|---|---|---|---|---|
| `expo-speech`（系统 TTS） | 差（机械音；iOS 自带中文嗓，播音腔） | 最低（本机） | 免费 | ✅ | Expo 官方模块 | 只做离线兜底；**不能输出音频文件**，喂不进 VoiceBubble，只能现场朗读 |
| `edge-tts`（微软 Edge 神经语音） | 很好（晓晓、云希等中文语音是第一梯队） | 中（走微软云端） | 免费 | ❌ | **GPL-3.0**（仓库根有 `gpl-3.0.txt`；GitHub 页标 NOASSERTION，按严的算） | 质量/价格比最高；**必须放在服务端当独立服务**，不要打包进 App（copyleft）；非官方 API，微软改接口会挂 |
| `Kokoro-82M`（自建） | 中上（英文极好；中文靠 `misaki[zh]`，G2P 是短板，多位评测说中文不如英文细腻） | 中（自家服务器 GPU/CPU） | 免费（自建服务器成本） | ✅（自建后） | Apache-2.0 | 最干净的长期方案；中文质量不如 edge-tts |
| OpenAI TTS API | 好（中文自然） | 中 | 付费（按量） | ❌ | 商业 API | 最省心可靠；有 Key 就直接用 |

**各仓库验证记录：**
- `expo-speech`：https://docs.expo.dev/versions/latest/sdk/speech/ —— API 全部读过：`speak(text, options)` 支持 `voice`/`language`（BCP 47，如 `zh-CN`）/`rate`/`pitch`/`onDone`；`getAvailableVoicesAsync()` 可枚举系统嗓；**iOS 静音模式下无声**（文档原话）；含在 Expo Go 里，无需 dev build。
- `edge-tts`：https://github.com/rany2/edge-tts —— 12,148 stars；commits 页确认 2026-03-22 还有提交（12 个月内活跃）；Python 模块 + 命令行，`--voice zh-CN-XiaoxiaoNeural --write-media out.mp3` 即出文件。
- `Kokoro`：https://github.com/hexgrad/kokoro —— 9,123 stars，Apache-2.0；README 明确 `lang_code='z'` = Mandarin Chinese，需 `pip install misaki[zh]`；中文语音如 `zf_xiaoxiao`（第三方实测提交佐证）。
- OpenAI TTS：`POST https://api.openai.com/v1/audio/speech`，`model: tts-1 / tts-1-hd`，`voice: alloy/echo/fable/onyx/nova/shimmer`，回 mp3 字节（多份 2026 年内的第三方文档交叉确认）。

### 推荐的借法（服务端只做一个 OpenAI 兼容口）

借这个现成的服务端垫片：**https://github.com/datmt/openai-edge-tts-fast-api**（README 已读：`POST /v1/audio/speech`，OpenAI 同款 schema：`model/input/voice/response_format/speed`，后端走 edge-tts，63 天前更新）。App 端代码永远只调 OpenAI 形状的接口：

```
App → POST {自家后端}/v1/audio/speech {input, voice} → mp3 → expo-av 播放进语音气泡
```

以后想换 Kokoro 自建 / OpenAI 官方 / 她的声音克隆（XTTS/GPT-SoVITS），**App 端一行不改**，只换后端实现。这就是 Kelivo 那种"TTS 可配置"的专业做法。

- `expo-speech` 同时接上做兜底：无网 / 后端挂了时，用系统中文嗓现场朗读（`Speech.speak(text, { language: 'zh-CN' })`），并在气泡上标"离线语音"。
- 考虑过但否决：`expo-kokoro-onnx`（手机端跑 Kokoro ONNX）——模型 86–326MB，中文质量打折，复杂度高，收益不如服务端方案。

---

## 3. 蓝牙 BLE（Expo iOS，修好之前 Metro 失败的坑）

### 先说之前为什么失败（git 里看得一清二楚）

`git show eddd51f`：当时的代码 `require("react-native-ble-plx")` 写在 try/catch 里，但**这个包从头到尾就没装进 package.json**。Metro 会静态分析所有 `require()`（try/catch 里也不放过），找不到模块直接报 `Unable to resolve module`。**根因不是"try/catch 写法不对"，是包没装、原生模块没链**。正确的修法是下面三件套，缺一不可：

1. 真装包（`npx expo install …`），正常 `import`，不用 `require` 耍花招；
2. 加 Expo config plugin（写 Info.plist 权限声明和后台 modes）；
3. 打 **dev build**（`expo run:ios` / EAS），Expo Go 里永远跑不起来。

### 采用：`@sfourdrinier/react-native-ble-plx`（fork 的 3.5.x 线）

- **仓库**：https://github.com/sfourdrinier/react-native-ble-plx（`dotintent/react-native-ble-plx` 的 fork）
- **为什么不用上游**：上游 3,441 stars、Apache-2.0，但兼容表只写到 Expo 51 / RN 0.74，`example-expo` 的 package.json 我亲眼看到是 `expo ~51.0.14` + `react-native 0.74.2`，且约 220 天没动静。我们的栈是 **Expo 54 + RN 0.81.5**，上游对不上。
- **为什么用这个 fork**：README 的 Version History 白纸黑字写着 **"3.5.x (This Fork)：Updated the fork for React Native 0.81.4 and Expo SDK 54"**——正好是我们的栈；TurboModule/Fabric 新架构；自带 Expo config plugin；有 `example-expo` 可跑的例子。
- **许可证**：仓库页标 Apache-2.0，但包内 `package.json` 写的是 `"license": "MIT"`——**两者不一致，合入前让法务视角（或我）再核实一次**，按严的当 Apache-2.0 用。
- **stars 说明**：fork 只有 14 stars，达不到"100+ star"的偏好。诚实讲：这是**目前唯一在维护、且对得上 Expo 54 + RN 0.81 的 BLE 库**，上游已实质停滞。借它的 3.5.x 稳定线，不追它现在的 3.9.x（那是给 Expo 57/RN 0.86 的）。

### 接入步骤（照抄它验证过的例子）

它的 `example-expo/app.json`（我读过原文）就是这么配的，直接抄：

```json
{
  "expo": {
    "plugins": [
      ["@sfourdrinier/react-native-ble-plx", {
        "isBackgroundEnabled": true,
        "modes": ["central"],
        "bluetoothAlwaysPermission": "允许“$（PRODUCT_NAME）”连接蓝牙设备以播放语音、同步外设",
        "iosEnableRestoration": true,
        "iosRestorationIdentifier": "com.openmuse.ble.restore",
        "androidEnableForegroundService": true
      }]
    ]
  }
}
```

步骤：
```sh
npx expo install @sfourdrinier/react-native-ble-plx@3.5   # 钉 3.5.x 线，别装 latest（3.9.x 要 Expo 57）
# app.json 加上面的 plugins
npx expo prebuild --clean
npx expo run:ios   # 或 EAS dev build；装到 iOS 26 真机上
```

代码侧（之前被删掉的扫描逻辑原样搬回来，API 一致）：

```ts
import { BleManager } from '@sfourdrinier/react-native-ble-plx'; // 正常 import

const manager = new BleManager();
const state = await manager.state(); // 'PoweredOn' 才扫
manager.startDeviceScan(null, null, (error, device) => { /* 收集 */ });
manager.stopDeviceScan();
manager.destroy();
```

- iOS 26 注意：`bluetoothAlwaysPermission` 的文案按她定的"简体中文、图标优先"口径写；plugin 会写 `NSBluetoothAlwaysUsageDescription` 和 `UIBackgroundModes=central`，不用手改原生工程。
- 之前 `device-permissions.ts` 里删掉的那 40 行扫描逻辑，API 完全对得上，拿回来就能用。

---

## 总览：借什么、不借什么

| 领域 | 借的零件 | 不借/不做 |
|---|---|---|
| MCP | 官方 `@modelcontextprotocol/client` v2（Client + StreamableHTTPClientTransport） | 不找二手 RN 封装（没有像样的）；不用 SSE（deprecated + 要 polyfill）；不用 stdio（iOS 不可能） |
| TTS | 服务端：`openai-edge-tts-fast-api` 垫片（OpenAI 兼容口）+ `edge-tts`；App 端：expo-av 播文件 + `expo-speech` 离线兜底 | 不在手机端跑 TTS 模型；GPL 的 edge-tts 只放服务端 |
| BLE | `@sfourdrinier/react-native-ble-plx@3.5.x` + 它的 config plugin + 抄它的 example-expo 配置 | 不用上游 dotintent（Expo 版本对不上）；不再用 `require` in try/catch 这种写法 |

三块都是"拿现成零件、按验证过的例子装配"，没有手造轮子的部分。MCP 和 TTS 是纯 JS/服务端改动，不碰原生；BLE 是唯一要动原生链路的（prebuild + dev build），按上面的三件套走即可。
