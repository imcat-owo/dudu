# 沙箱双后端真机验证计划

> 调研日期：2026-10-03。结论：**两个后端今天在真机上都是"unavailable"**——代码骨架是真的，缺的是两个原生/传输实现。好消息是两条路都有现成方案，不用从零造。

---

## 一、我们代码的现状（亲手读的）

| 模块 | 状态 | 证据 |
|---|---|---|
| `sandbox/types.ts` | ✅ 完整 | `SandboxBackend` 接口定义了双后端契约（89 行） |
| `sandbox/backend-ssh-docker.ts` | ⚠️ 半真 | Docker 协议层是真的（`docker ps --format` 解析、shellEscape、流式 exec，188 行）；但 `SshTransport` 是 `UnavailableSshTransport` 占位——**真 SSH 连接实现缺失** |
| `sandbox/backend-ish.ts` | ⚠️ 半真 | JS 适配器完整，对原生模块契约的描述准确；但 `resolveNativeISH()` 要 `require("./native-ish-shim")`——**这个文件不存在**，后端永远报 `unavailable` |
| `sandbox/manager.ts` | ✅ 完整 | 后端切换、SSH 配置存 SecureStore，191 行 |
| `sandbox/sandbox-tools.ts` | ✅ 完整 | 4 个 AI 工具（sandbox_run/containers/start/stop），走授权门 |
| `sandbox/sandbox-ui.tsx` | ✅ 完整 | 后端切换器、SSH 配置页、容器列表、终端 UI，522 行 |
| 原生构建 | ❌ 没有 | 仓库里没有 `ios/` 目录——**从来没做过 prebuild** |

**一句话：UI、协议、工具全是真的；两个"最后一公里"（SSH 传输、iSH 原生模块）是空的。**

---

## 二、OpenMinis 的 iSH 沙箱是怎么做的

OpenMinis 用的是 `OpenMinis/ish-arm64`——iSH 的 fork，加了 ARM64 客机后端：

- **原理**：纯用户态模拟，没有 hypervisor、没有真 JIT（用的是"threaded code"：预编译 gadget 函数指针数组互相 tailcall，所以不需要可执行内存、不需要 JIT entitlement）。**iOS 26 下这条路依然成立**（iSH 2026-09 还在更新，App Store 正常上架）。
- **打包方式**：3 个静态库（`libish.a`、`libish_emu.a`、`libfakefs.a`）+ `alpine-rootfs.zip` 进 app bundle；首次启动解压到 `~/Documents/alpine-rootfs/`。
- **原生层**：`ISHKernel`（单例，boot/executeCommand/executeCommandAndWait/sendInput）+ `RootfsManager` + `ISHShellExecutor` + `ISHExecutionCoordinator`（一次只跑一个命令、FIFO、10 分钟抢占、100KB 输出上限）。
- **和我们的契约对比**：`backend-ish.ts` 头注释里写的四个类和方法**全部对得上**。但有两个坑：
  1. **"只剩接入原生模块这一步"是轻描淡写了**——OpenMinis 是纯 Swift App，没有 Expo 模块；**包装 ISHKernel 的 Expo 原生模块根本不存在，得我们自己写**（TurboModule，工作量不小）。
  2. **`shutdown()` 在原生层没有对应 API**——kernel 是进程生命周期单例，boot 一次就一直活着。我们的契约 over-promise 了，得改设计。
- **捷径机会**：ish-arm64 自带 `DebugServer`——JSON-RPC over HTTP（`guest.exec`、`fs.readdir`）。理论上 JS 层直接 `fetch("http://localhost:PORT")` 就能调客机命令，**不需要写原生模块**。OpenMinis 自己没用这条路（它直接调 Obj-C），localhost HTTP 在生产 App 里有安全评审面，但值得评估——这是最便宜的验证路径。
- **App Store 政策**：2020 年苹果曾以 2.5.2（不许下载/执行代码）威胁下架 iSH，上诉后保住了，至今在架。OpenMinis 自己就带着这个引擎上架（MacStories 2026-07 评测过）。**风险存在但可过**，最敏感的是"rootfs 增量更新"（装完再下代码）。

---

## 三、iOS 26 的硬约束（2026-10 实测数据）

| 约束 | 结论 |
|---|---|
| fork/exec 真进程 | ❌ 依然禁止。只能用户态模拟 |
| 真 JIT（RWX 内存） | ❌ 依然要 entitlement；iOS 26.4 还**收紧了**（StikDebug 绕法被堵死） |
| 原始 TCP / SSH 22 端口 | ✅ 允许。Termius、Blink Shell 都在 App Store 卖，ATS 只管 HTTP |
| 文件（rootfs 放 Documents/） | ✅ 自家容器随便读写，无新限制 |
| 后台持续跑命令 | ❌ 后台 60 秒窗口内超 48 CPU 秒就被杀（iOS 26.5.2 实测）；`beginBackgroundTask` 只能多买 ~30 秒 |
| 后台对策 | 学 iSH-AOK：**挂起时 checkpoint 存盘**，前台恢复；SSH 会话断了用服务端 tmux 接回去 |

---

## 四、构建链路：Expo Go / dev build / TestFlight 哪个能跑

| | Expo Go | Dev Build（EAS development） | TestFlight/Release |
|---|---|---|---|
| 自定义原生模块 | ❌ 只能用 Expo 自带 | ✅ | ✅ |
| iSH 引擎 | ❌ | ✅（prebuild 后） | ✅ |
| SSH 原生模块 | ❌ | ✅ | ✅ |
| 纯 JS 部分（UI/协议/工具） | ✅ 可先验 | ✅ | ✅ |

**最小验证路径**：`eas build --profile development --platform ios` 打一个 dev build 装到她真机上——dev build 照样有 Fast Refresh，JS 改完秒 reload，原生侧一次 build 管很久。

**SSH 传输的好消息**：`@osuki-dev/react-native-ssh`（russh 的 Rust 实现，Nitro Modules 封装，iOS 预编译二进制，不用装 Rust 工具链，26 天前还在更新）——**这是 2026 年 RN/Expo 上唯一靠谱的 SSH 方案**。`ssh2`（Node 版）在 Hermes 里跑不起来（没有 `net.Socket`），`react-native-ssh`（doeve 版）2023 年就死了。结论：**后端 A 接 `@osuki-dev/react-native-ssh`，实现 `SshTransport` 接口**。

---

## 五、后端 A（云 Docker）服务端要什么

她云服务器（186.241.68.123）上需要：
1. Docker 已装、daemon 在跑（`docker info` 能通）
2. 一个给嘟嘟用的容器（或允许 `docker run` 起新的）
3. SSH 可达：App 从手机直连 22 端口（她的服务器 sshd 钥匙登录已通，见 TOOLS.md）
4. 建议：容器里跑 tmux，SSH 断线重连能接回会话

服务端**不需要**为嘟嘟写任何新代码——`backend-ssh-docker.ts` 直接调 `docker` CLI。

---

## 六、真机验证 checklist（按顺序）

### 阶段 0：Dev build 跑起来
- [ ] `npx expo prebuild` 生成 `ios/`（第一次）
- [ ] `eas build --profile development --platform ios` 出包
- [ ] 她真机安装 dev build，`expo start` 能连上、JS 热更新正常
- **算过**：App 能打开、现有功能（聊天/主题）正常

### 阶段 1：后端 A（云 Docker）——先做这个，它最快
- [ ] `npm i @osuki-dev/react-native-ssh react-native-nitro-modules`，实现 `SshTransport`（`connect`/`exec`/`shell` 三个方法，对着 `transport.ts` 接口填）
- [ ] prebuild + dev build 重打（原生模块变了必须重打）
- [ ] 真机上进沙箱设置，填她服务器的 SSH 配置（host/port/用户名/密钥走 SecureStore）
- [ ] 点连接——**算过**：状态变 `connected`（`connect()` 里会先跑 `docker info` 验证）
- [ ] `docker ps` 列出容器——**算过**：`sandbox_containers` 返回容器列表
- [ ] 跑 `echo hello && uname -a`——**算过**：`exit=0` + 输出
- [ ] 让 AI 在对话框里跑 `sandbox_run`（走授权弹窗）——**算过**：她点同意后返回结果
- [ ] 杀 App 重进，SSH 断线重连——**算过**：tmux 会话接得回去

### 阶段 2：后端 B（本地 iSH）——二选一
**路线 B1（重但正统）**：写 Expo TurboModule 包装 ISHKernel
- [ ] 把 `OpenMinis/ish-arm64` 的三个 `.a` + `alpine-rootfs.zip` 接进 prebuild（config plugin）
- [ ] 写 TurboModule：`boot()` / `isBooted()` / `executeCommandAndWait()` / 输入输出回调
- [ ] 改 `backend-ish.ts`：`resolveNativeISH()` 改走 TurboModule；**删掉或重做 `shutdown()`**（原生没有）
- [ ] 真机验证：boot → `echo hello` → `apk --version` → 跑个 Python 脚本

**路线 B2（轻但要评估）**：DebugServer JSON-RPC over HTTP
- [ ] 验证思路：iSH 引擎内起 localhost HTTP，JS 层 `fetch` 调 `guest.exec`
- [ ] 评估安全面：localhost server 在 App Store 评审里要能解释
- [ ] 如果可行，**零原生模块代码**，纯 JS + prebuild 打包资源

- [ ] 内存验证：跑个吃内存的命令，看 jetsam 线（3-4GB iPhone 上 guest+App 别超 ~1.8GB）
- [ ] 后台验证：切后台 1 分钟再回来——**算过**：不崩，checkpoint 恢复或诚实报错

### 阶段 3：双后端切换
- [ ] App 内 A/B 切换——**算过**：切后端不断开另一边已连的会话要给出提示
- [ ] AI 工具在两个后端下都跑通 `sandbox_run`

---

## 七、关键来源

- OpenMinis ish-arm64：https://github.com/openminis/ish-arm64/blob/HEAD/README_arm64.md
- OpenMinis iSH 集成文档：https://github.com/openminis/openminis/blob/HEAD/docs/specs/ios-sandbox-ish-summary.md
- iSH 上游（2026-09 更新）：https://github.com/ish-app/ish
- iOS 26.4 堵 JIT：https://piunikaweb.com/2026/03/26/ios-26-4-may-break-jit-for-sideloaded-apps/
- react-native-ssh（osuki，当前唯一靠谱方案）：https://github.com/osuki-dev/react-native-ssh
- iSH-AOK 后台/suspend-to-disk：https://github.com/emkey1/ish-aok/blob/HEAD/docs/book/ch28-the-app-around-the-kernel.md
- OpenMinis 后台 CPU governor（iOS 26 实测）：`~/workspace/openminis-fix/repo/docs/ish-bg-cpu-governor-design.md`
- Expo Go vs dev build：https://github.com/efforthye/claude-code-space/blob/HEAD/wiki/concepts/expo-go-vs-dev-build.md

---

## 八、给下一步的建议

1. **先做后端 A**：`@osuki-dev/react-native-ssh` 是现成答案，1-2 天能接完，真机验证当天出结果。这是"把弊端补齐"里性价比最高的。
2. **后端 B 先评估 B2 路线**：如果 DebugServer HTTP 桥走得通，B 的验证成本从"写 TurboModule"降到"打包资源+写 fetch"，差了一个数量级。
3. **`shutdown()` 的契约要改**：原生层没有这个概念，别留着骗人。
4. **后台别指望**：两个后端都要按"前台为主、断线能接回"设计，这是 iOS 的铁律，不是 bug。
