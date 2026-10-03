# OpenMuse 主题/美化系统 — 架构设计

- 日期：2026-10-03
- 状态：设计稿，未实现。TOP 优先级功能。
- 目标：AI 能美化它能控制的一切（通过 AI 可调用的工具）；用户也能亲手调一切（壁纸、头像、图片、CSS）。
- 约束：界面语言跟随手机系统（中文优先完整）；能用图标就不用字；系统字体、跟随系统字号；iOS 26；Expo 54 / RN 0.81.5。
- 参考：Polaris 北极星主题系统（`audit-parts-ux.md` §6）、Kelivo 主题实现（`/tmp/kelivo/lib/theme/`，已逐文件读过）。

---

## 0. 视觉风格锚点（2026-10-03 她定的）

- **风格锚点**：她的定稿新头像——穹妹风（缘之空）、灰调手绘感、银发双马尾抱着黑色兔子玩偶。原图存档 `artwork/avatar/sora-avatar.webp`（不二改）。
- **主题围绕这个风格设计**：灰调、柔和、手绘质感；预设配色优先从这张图取色（`react-native-image-colors`）。
- **mascot 不变**：仍用她的 10 张像素风小恶魔贴纸（`artwork/mascot/devil-01..10.jpg`），原样使用、不二改。mascot 是功能形象，风格锚点是主题视觉——两套分开。
- **待她生成的配图**（她在别的对话框生成、给 URL，我换上去）：开屏图、空状态图（无聊天列表/无搜索结果）、图片加载占位图、主题预设头图。风格要求：对齐头像的灰调手绘二次元感。

## 1. 在 Expo iOS 上做运行时换肤 —— 可行性结论（已验证）

**核心事实：React Native 没有 CSS 引擎。** 样式是 JS 对象，经 Yoga 排版后直达原生 UIKit。这一点经公开资料多方验证（RN 官方原则文档明确 "CSS strings do not exist at runtime"）。

由此推导出的架构铁律：

1. **主题必须是数据（token 树），不是样式表。** 经 `ThemeContext` 下发，全 App 用 `useTheme()` 取 token 动态拼样式。现状：`apps/mobile/src/ui.tsx` 的 `colors` 是静态导出，`s` 是静态 `StyleSheet`，全仓约 113 处 `colors.` 直接引用 —— 迁移第一步就是把这些接到 ThemeContext 上。
2. **用户写的"CSS"在原生端不可能是真 CSS。** 诚实的两条路：
   - **受限 theme-CSS**：用 `css-to-react-native`（3.2.0，MIT，npm 已验证）把 CSS 文本解析成 RN 样式对象，再映射到我们的 8 个可换肤区域。只支持 RN 认识的属性；不认识的会被 RN 静默丢弃 —— 所以必须有校验层，失败要报给 AI/用户，不能悄悄吞掉。
   - **WebView 内的真 CSS**：`react-native-webview` 已在依赖里，Artifacts 预览窗这类 WebView 内容可以用完整 CSS —— 但那是独立作用域，不属于本主题系统。
3. **配色生成不用手写算法**，借 `@material/material-color-utilities`（0.4.0，Apache-2.0，npm 已验证，纯 JS 无原生依赖，Hermes 可跑）。这是 Material You 颜色引擎的官方 TypeScript 版 —— Kelivo 用的 Dart 版是同一套（`Hct`/`TonalPalette`/`DynamicScheme`）。输入一个主色，输出整套 tonal palette。
4. **从图片提取配色**：`react-native-image-colors`（2.6.0，MIT，npm 已验证），原生模块，要 dev build（本项目本来就走 dev build 出包，没问题）。
5. **壁纸**：`expo-image`（需新增）+ 全屏背景图 + 可调暗度遮罩，完全可行。
6. **头像**：`expo-image-picker`（需新增）+ `expo-file-system` 存本地，URI 存进 identity（现有 `/identity` 的 avatar 字段从预设字符串扩展为支持图片 URI）。
7. **玻璃/渐变**：`expo-blur`、`expo-linear-gradient`（需新增，dev build）。iOS 26 的 Liquid Glass 是系统接管的，App 只能选择"用不用 blur 质感"，改不了玻璃本身。
8. **字体不在主题系统里。** 用户口径是系统字体跟随系统字号 —— 主题数据模型里不许出现 `fontFamily`。这是死规矩。

---

## 2. 主题数据模型

```ts
type SurfaceId =
  | "canvas"    // 01 App 底
  | "card"      // 02 卡片/面板
  | "input"     // 03 输入框/输入栏
  | "userBubble"// 04 用户气泡
  | "aiBubble"  // 05 AI 气泡
  | "accent"    // 06 按钮/链接/高亮
  | "text"      // 07 文字/次要文字/分割线
  | "overlay";  // 08 弹窗/抽屉/导航

type SurfaceTokens = {
  bg: string; fg: string; accent: string;
  border?: string; radius?: number; dim?: number; // dim: 壁纸压暗度 0-1
};

type ThemeBundle = {
  kind: "openmuse-theme-bundle";
  version: 1;
  id: string; name: string; author?: string;
  seed: { primary: string; secondary?: string; tertiary?: string }; // hex
  mode: "light" | "dark" | "system";
  surfaces: Record<SurfaceId, SurfaceTokens>;
  wallpaper?: { uri: string; fit: "cover" | "contain"; dim: number };
  avatar?: { user?: string; assistant?: string }; // 图片 URI
  css?: string;          // 创意模式的受限 theme-CSS 文本
  meta: { createdAt: string; updatedAt: string; label?: string };
};
```

- **解析链**：`seed.primary` → material-color-utilities（HCT tonal palettes）→ 每个 surface 的 bg/fg/accent/border 全套 token。AI/用户只给"感觉"（主色+四轴），引擎算出"整套"。
- **存储**：服务端 per-owner 主题库（仿照 provider-configs 的加密存储思路，主题不涉密可明文存），客户端经 `/api/theme` 拉取 + 本地文件缓存。版本号计数器进 workspace 快照，客户端发现版本变了就刷新 —— AI 改完主题，手机端几秒内生效。
- **8 个区域**直接对应 Polaris 的 01–08 编号思路：AI 按编号施工，不写"气泡""导航栏"这类别名，避免歧义。

---

## 3. AI 工具定义（服务端 `defineTool`，随请求注入工具列表）

注入位置：`apps/server/src/engine/conversation.ts` 的 `tools` 数组（和 `model.ts` 的任务工具列表），per-owner、per-request，和现有工具同一机制。工具只改主题库，不碰任何业务代码。

| 工具名 | 参数（zod） | 说明 |
|---|---|---|
| `get_theme` | `{ section?: "all" \| SurfaceId }` | 读当前主题，返回 JSON。AI 动手前先看。 |
| `apply_theme_coordinates` | `{ targets: "all" \| SurfaceId[], hue: string, hueCount?: 1-5, emotion?: -5..5, meaning?: -5..5, seed?: number, label?: string }` | **稳态模式**。`hue` 支持自然语言（"薄荷偏青绿""晚霞粉"）或 hex；服务端有"感觉词→hex"映射表+钳制（超范围自动夹到边界，抄 Polaris）。 |
| `apply_surface_tokens` | `{ target: SurfaceId, tokens: { bg?, fg?, accent?, border?, radius? } }` | 单区域精修。 |
| `set_wallpaper` | `{ uri?: string, fit?: "cover"\|"contain", dim?: 0-1, extractPalette?: boolean }` | 换壁纸；`extractPalette` 开启则从图取色直接生成主题。 |
| `set_avatar` | `{ uri: string, for: "user" \| "assistant" }` | 换头像。 |
| `read_theme_css` / `edit_theme_css` / `append_theme_css` / `replace_theme_css` | `{ anchor?: string, oldText?: string, newText?: string }` | **创意模式**：只读写那一份受限 theme-CSS。 |
| `preview_theme` | `{ label?: string }` | 试穿：写进沙盒副本不落盘，客户端弹"试穿中"横幅。 |
| `confirm_theme` / `rollback_theme` | `{}` | 确认落盘 / 一键回滚到上一个确认版。 |
| `save_theme_preset` / `list_theme_presets` / `apply_preset` | `{ name?, id? }` | 预设备选集。 |
| `export_theme_bundle` / `import_theme_bundle` | `{ bundle?: object }` | 主题包 JSON 导入导出。 |
| `extract_palette_from_image` | `{ uri: string }` | 返回 `{ dominant, palette[], suggestedText }`。 |

**AI 侧安全**：主题工具按会话设开关（`themeToolMode: stable | creative | off`，默认 stable，抄 Polaris）—— 关掉后模型看不到这类工具。创意 CSS 永远只作用于 8 个 surface 的 token 覆盖层，**布局、交互、业务逻辑不在 AI 可写范围内**。主题变更限流（防 AI 连刷）。

---

## 4. 校验（blockingIssues，失败不应用）

1. **CSS 解析失败**：`css-to-react-native` 抛错 → 拒绝，把错位行号原样回给 AI。
2. **未知 surface / 非法 token**：拒绝并列出合法值。
3. **对比度**：文字/背景对比度 < 4.5 → 警告并自动修正文字色（或要求 AI 重给）。
4. **存档损坏自愈**：bundle 解析失败 → 用默认主题重建并记一条日志（抄 Polaris"主题存档损坏，已重建"）。

---

## 5. 用户亲手调 —— 界面（设置 → 外观）

按使用顺序排（图标优先，文字跟随系统语言）：

1. **主题模式**：跟随系统 / 浅色 / 深色（分段选择器）。
2. **预设**：横滑色卡（内置 4–6 套 + 自己存的），点一下即试穿。
3. **自定义配色**：取色器选主色/副色/点缀色 → 实时预览 → 保存命名。
4. **壁纸**：从相册选 / 移除 / 压暗度滑杆。
5. **头像**：我的头像 / AI 头像（选图或恢复预设）。
6. **AI 换肤**：模式开关（稳态/创意/关）+ "让 AI 换个风格"（一句话描述框）。
7. **高级**：theme-CSS 编辑器（文本框 + 校验按钮）→ 走创意模式同一条校验链。
8. **导入/导出**：主题包 JSON（粘贴 / 二维码 / 分享单，抄 Kelivo 的码）。
9. **回滚**：试穿横幅上的"恢复上一版" + 设置里的版本历史（保留最近 20 个确认版，带时间+标签）。
10. **按人设房间**（人设功能上线后）：每人设独立壁纸+主题（抄 Polaris"协作者房间"）。

---

## 6. 安全网（四件套，缺一不可）

1. **试穿**：先生效预览，不直接落盘；横幅常驻"试穿中 — 应用 / 放弃"。
2. **确认才存档**：每次确认写一个版本（时间+标签），留 20 个。
3. **一键回滚**：任何时候一键回到上一个确认版。
4. **损坏自愈**：bundle 坏了自动重建默认主题，不白屏。

---

## 7. 分享格式

```json
{ "kind": "openmuse-theme-bundle", "version": 1, "id": "...", "name": "...",
  "seed": {...}, "mode": "system", "surfaces": {...},
  "wallpaper": {...}, "avatar": {...}, "css": "..." }
```

- 未知字段忽略、版本号校验 —— 向前兼容。
- 传播方式：JSON 粘贴 / 二维码 / 系统分享单（抄 Kelivo）。

---

## 8. 诚实清单：什么美化不了，为什么

| 美化不了 | 原因 |
|---|---|
| 布局/间距/字号/位置 | RN 没有层叠概念，几何是代码写死的。主题只给圆角档位 + 疏密（紧凑/舒适）两档，不开放任意改。 |
| 字体 | 主题系统默认不管字体（跟系统字体字号走）；但用户可在"外观→字体"里自己上传字体文件（对齐 Kelivo），缺字回退系统字体。上传的字体存在主题包之外、单独管理。 |
| 状态栏、键盘、系统权限弹窗、分享单 | iOS 系统接管，App 改不了。 |
| 任意 CSS 选择器/动画/伪类/media query | `css-to-react-native` 只覆盖 RN 支持的属性子集；布局类属性一律拒绝并报错。 |
| App 图标 | iOS 的 `setAlternateIconName` 要求图标打进包里，运行时换图标只能是构建时预置的几套 —— 算构建期事项，不进主题系统。 |
| iOS 26 Liquid Glass 本体 | 系统渲染的，App 只能选"这块用不用 blur 质感"（`expo-blur`），改不了玻璃。 |
| WebView 之外的内容拿真 CSS | 只有 Artifacts 预览窗这类 WebView 内容能用完整 CSS，那是独立作用域。 |

---

## 9. 聊天头像气泡版式（2026-10-03 她定的）

- 社交软件式布局：AI 的消息＝AI 头像＋气泡居左；用户的消息＝气泡＋用户头像居右。
- **紧凑精致**（2026-10-03 她定的）："我不喜欢太大的，跟老年人用的那种一样"——气泡、头像、间距默认走小而精致的规格，不做老年机风；尺寸由主题 token 驱动，保持全局一致。
- **字号可调**：外观设置里有字号控制（跟随系统 / 小 / 标准 / 大），默认小；这是用户偏好，不进主题包。
- 头像来源：默认用主题包里的 `avatar.assistant` / `avatar.user`；用户在"外观→头像"里可换图，AI 也可用 `set_avatar` 工具换（走同样的试穿→确认链，不直接生效）。
- 头像形状大小归主题 token 管，不写死；气泡颜色走 04/05 区域 token，文字色从主题色系取，不用纯黑纯白。

## 10. 形象出图管线（2026-10-03 她定的）

- **出图工具指定**：走内置 media 图片管线（v1 mascot 已用它产出）。不许团队自己换工具、不用没验证过的出图路子。
- **风格统一做法**：先出一张角色定稿，她点头后锁定；之后所有变体（表情、姿态、主题形象）都以定稿图为 reference 链式生成，不许各画各的。
- **诚实线**：做不出来的，标明做不出来并给替代方案，别用假数据或占位图顶上。

## 11. 落地顺序（2026-10-03 她定的：拆成两段）

1. `ThemeContext` + token 模型，把 `ui.tsx` 的静态 `colors`/`s` 迁过去（Phase 0 顺手做）。
2. 服务端主题库 + `/api/theme` CRUD + 版本同步。
3. 预设 + 设置 → 外观（用户手调全套）。
4. 壁纸 + 头像。
5. AI 工具（先稳态四轴）。
6. 创意 CSS 模式 + 校验链。
7. 分享（JSON/二维码）+ 版本历史/回滚 + 从图取色。
8. 四视角审查，P3 清零，真机验收。

**新增依赖**：`expo-image`、`expo-image-picker`、`expo-blur`、`expo-linear-gradient`、`react-native-image-colors`（+config plugin）、`@material/material-color-utilities`、`css-to-react-native`。全部走 dev build（现状如此，无新增门槛）。

---

## 12. 和 Polaris 的关系（一句话）

Polaris 证明了"AI 工具换肤"这条路走得通，它的**四轴参数语言、试穿→确认→存档→回滚、主题包 JSON、从图取色**照单借；但它的 theme.css 是 web 端的真 CSS，到 Expo iOS 上必须降级为**受限 theme-CSS → token 覆盖**，这是本架构与它唯一不同的地方，也是诚实边界。
