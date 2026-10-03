# 移动端轻量 RAG / 知识库调研报告

> 日期：2026-10-03 · 纯调研，未改代码
> 目标：给嘟嘟（Expo SDK 54 · React Native 0.81 · iOS 优先 · 本地优先、无强制后端）补上"上传文档、就文档提问"的能力。

---

## 一、结论先行（给忙的人）

**完全可以在端侧做 RAG，不需要后端。** 2026 年的工具链已经把路铺好了：

| 环节 | 推荐方案 | 说明 |
|---|---|---|
| 向量存储 | **expo-sqlite（SDK 54 自带 sqlite-vec）** | 官方捆绑扩展，`vec0` 虚拟表做 KNN，无需第三方库 |
| 嵌入（Phase 1） | **调用户已配 API 的 `/v1/embeddings`** | OpenAI 兼容 / Gemini 都有；零新增依赖，零模型下载 |
| 嵌入（Phase 2/3） | **onnxruntime-react-native + all-MiniLM-L6-v2（22MB）** | 全离线；中文文档则用 multilingual-e5-small（113MB） |
| 分块 | 800 字符 / 100 重叠，Markdown 按标题感知 | 手机文档小，这个粒度够用 |
| 检索 | 向量 top-k ＋ 现有 BM25 关键词（memory/search.ts 已有）做混合 | RRF 融合，App 里已有现成代码可复用 |

**关键洞察**：Kelivo 根本没有向量 RAG——它的"world book"是关键词触发（SillyTavern 式），文档是**整个塞进 context**。LibreChat/Open WebUI 的 RAG 是重型服务端方案（Python FastAPI + pgvector + 5 个 Docker 服务），**不适合手机**。我们走端侧轻量路线，反而是差异化。

---

## 二、对标：别人怎么做 RAG

### 2.1 Kelivo —— 没有向量检索（重要）

实查 Kelivo（Chevey339/kelivo）及其 fork 的功能清单：

- **World Book**：关键词触发的世界观条目，SillyTavern 式——用户消息命中关键词才注入，不是语义检索。
- **Memory**：助手记忆，简单存取。
- **文档输入**：PDF/Word/文本作为**多模态附件直接发给模型**（context stuffing），没有切分、没有向量库、没有检索。
- 结论：Kelivo 的"知识库"是**把整篇文档塞进上下文**，文档稍大就爆 context。**这是我们可以超越它的地方**，不是要抄的。

### 2.2 LibreChat —— 重型服务端 RAG（不适合我们）

架构（来自其官方 RAG 架构文档）：

```
用户上传文件 → LibreChat API → RAG API（Python FastAPI + LangChain）
  → 切分（默认 1500 字符 / 100 重叠）
  → 调 Embedding Provider（OpenAI / Ollama / HuggingFace / Azure / Cohere）
  → 存 PostgreSQL + pgvector
提问时：query 向量化 → pgvector 相似度检索 → top chunks 注入 prompt
```

- 需要 **5 个服务**：LibreChat、MongoDB、Meilisearch、RAG API、PostgreSQL/pgvector。
- 这是服务器思维，**手机端照搬等于给自己找罪受**。

### 2.3 Open WebUI —— 同样服务端 pgvector

- 同样依赖 Postgres + pgvector，文档问答是其强项，但同样是"有服务器"的前提。
- 对我们只有参考价值：**切分策略和引用（citation）展示**可以抄。

### 2.4 移动端先行者（2026 年的实证）

几个真实项目的选择，证明端侧 RAG 已跑通：

| 项目 | 向量层 | 嵌入 | 备注 |
|---|---|---|---|
| sengtha/iany（Expo） | op-sqlite + sqlite-vec（`vec0`）+ FTS5 三元分词 | Stage 2 待定 | 混合检索，RRF 融合，专为 Hermes 优化 |
| varunmoka7/noor-mobile | **纯 JS 余弦相似度** | multilingual-e5-small（384 维） | 实测 6,236 个向量 <10ms，**无扩展也够用** |
| equationalapplications/expo-llm-wiki | expo-sqlite + sqlite-vec | 核心引擎与存储解耦 | npm 上已有现成包 |
| jamon8888/hacienda-mobile | op-sqlite + sqlite-vec + FTS5 BM25 | EmbeddingGemma-300M（LiteRT 原生模块） | 最重的一档，裸 RN |

**核心判断**：我们的文档规模（个人用户的几十篇文档、几千个 chunk）下，**向量检索根本不是瓶颈**。纯 JS 余弦在 6k 向量下 <10ms；sqlite-vec 则是官方正统路线。

---

## 三、端侧 RAG 完全可行：各环节选项

### 3.1 向量存储：sqlite-vec 已经是 Expo 官方能力

- **Expo SDK 54 的 expo-sqlite 新增 `loadExtensionAsync`**，官方捆绑 sqlite-vec 扩展（PR expo/expo#38693）：
  ```ts
  import * as SQLite from 'expo-sqlite';
  const db = await SQLite.openDatabaseAsync('dudu.db');
  const ext = SQLite.bundledExtensions['sqlite-vec'];
  await db.loadExtensionAsync(ext.libPath, ext.entryPoint);
  await db.runAsync(`CREATE VIRTUAL TABLE IF NOT EXISTS kb_vec USING vec0(
    id INTEGER PRIMARY KEY, embedding FLOAT[384])`);
  // KNN 查询
  const rows = await db.getAllAsync(
    `SELECT id, distance FROM kb_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 8`,
    [JSON.stringify(queryVec)]);
  ```
- **注意**：扩展默认不启用，bare workflow 需在 `Podfile.properties.json` 加 `expo.sqlite.withSQLiteVecExtension`。我们的 App 用 dev client（`expo-dev-client` 已在依赖里，`start` 脚本即 `--dev-client`），**dev build 和生产包都能用**；Expo Go 里大概率不可用——但我们本来就不用 Expo Go 跑正式功能。
- expo-sqlite 目前**尚未**在 package.json 里，需 `npx expo install expo-sqlite`（SDK 54 对应版本）。
- 替代/降级：**纯 JS 余弦相似度**——向量存普通表（JSON 或 BLOB），查询时全量扫一遍算余弦。几千 chunk 内 <10ms，**零原生依赖、Expo Go 也能跑**。Phase 1 甚至可以直接用这个，Phase 2 再切 sqlite-vec。

### 3.2 嵌入模型：三档选择

| 方案 | 模型/接口 | 体积 | 维度 | 中文 | 离线 | 代价 |
|---|---|---|---|---|---|---|
| **A. API 嵌入（推荐 Phase 1）** | 用户已配 API 的 `/v1/embeddings`（OpenAI 兼容）或 Gemini `text-embedding-004` | 0 | 1536 / 768 | ✅ | ❌（调 API） | 零新增依赖；和我们"BYO key"哲学完全一致 |
| **B. 端侧英文** | `Xenova/all-MiniLM-L6-v2`（ONNX int8）经 onnxruntime-react-native | ~22MB | 384 | ❌（英文为主） | ✅ | 需 dev build；仓库 1-2 年未大更新，需验证 |
| **C. 端侧多语言** | `intfloat/multilingual-e5-small`（ONNX int8） | ~113MB | 384 | ✅ | ✅ | 体积大，需 WiFi 下载 + 进度 UI；e5 系需加 `query:`/`passage:` 前缀 |

- **Phase 1 必须选 A**：用户已经配了 API key，embedding 只是多调一个接口。OpenAI 的 `text-embedding-3-small` 又便宜又好；Gemini 的 embedding 也行。**注意**：我们的智能 API 自适应（capability-probe）可以复用——探测一下该 API 有没有 `/v1/embeddings`，没有就诚实提示。
- **Phase 3 再做 B/C**：onnxruntime-react-native 是原生模块（dev build 可用，Expo Go 不行），tokenizer 要自己接（可用 `@huggingface/transformers` 的 tokenizer 部分，或预置词表）。这是"全离线"的最后一块拼图，但**不是 MVP 必需**。
- transformers.js（`@huggingface/transformers`）**不推荐**用于 RN：它依赖 WebGPU/WASM，在 Hermes 里跑不起来；那是浏览器路线。

### 3.3 切分策略（手机场景）

手机上的文档特点：**小**（几页 PDF、几篇 Markdown、聊天记录导出），不像服务器要处理整本书。

推荐：

- **默认**：800 字符一块，100–150 字符重叠。比 LibreChat 的 1500 更小——手机上检索粒度细一点好，且 800 字符的 chunk 注入 prompt 更省 token。
- **Markdown**：按标题感知切分（`#`/`##` 为边界），保留标题路径作元数据（`doc > 章 > 节`），引用展示时有用。
- **纯文本**：按段落切，段落内再滑窗。
- **chunk id 确定性**：`sha256(docId + index)`，重建索引时可 diff 增量更新。
- **元数据**：docId、文件名、页码（PDF 有的话）、标题路径、chunk 序号。回答时带引用"来自《xxx》第 x 部分"，抄 Open WebUI 的 citation 展示。

### 3.4 PDF/Word 文本提取（最麻烦的一环，诚实说）

- **TXT/MD**：零依赖，直接读。Phase 1 先只支持这俩，**立刻可上线**。
- **PDF**：`react-native-pdf`（已在依赖里）是**阅读器，不是解析器**。RN 上靠谱的解析方案：
  - pdf.js 跑在 WebView 里提取文本（有现成做法，稍重）；
  - 或原生模块（如 `react-native-pdf-lib` 系，已年久）。
  - 建议 Phase 2 再啃，先诚实支持 txt/md。
- **DOCX**：`mammoth` 需要 Node Buffer shim，在 Hermes 里可跑但要折腾；同样 Phase 2。
- **诚实原则**：Phase 1 只做 txt/md，UI 上明确写"PDF/Word 随后支持"，不拿假功能糊弄。

---

## 四、iOS 约束清单

| 约束 | 影响 | 对策 |
|---|---|---|
| 后台 ~30 秒挂起 | 不能依赖后台做大索引 | **索引在前台做**，带进度条；文档小，几秒搞定，不需要后台 |
| expo-background-task 最小间隔 ~15 分钟且不保证 | 定时重建索引不可靠 | 不做定时任务；文档变更时增量索引即可 |
| 存储 | 384 维 float32 ≈ 1.5KB/chunk；1 万 chunk ≈ 15MB | 可忽略；向量表单独一个 db 文件，备份时可排除后重建 |
| 模型下载（Phase 3） | MiniLM 22MB / e5-small 113MB | expo-file-system 下载，**仅 WiFi**，进度条，可删除重下；存 Application Support，不进 iCloud 备份 |
| 内存 | 纯 JS 余弦 6k 向量常驻内存约 9MB（384 维 float32） | 几千 chunk 无压力；上万 chunk 切 sqlite-vec（SQL 侧算距离，不进 JS 堆） |
| Expo Go | sqlite-vec、onnxruntime 都不可用 | Phase 1 的"API 嵌入 + 纯 JS 余弦"在 Expo Go 可跑；Phase 2+ 要求 dev build（我们本来就用 dev client） |

---

## 五、分阶段计划（估工作量）

### Phase 1：能用的知识库（估计 3–5 天 worker 量）

目标：上传 txt/md → 提问时自动检索注入 → 回答带引用。

1. **文档管理**（`src/knowledge/` 新模块）
   - `expo-document-picker` 已在项目里（font.tsx、backup-ui.tsx 在用），直接复用。
   - 文档表：`kb_docs(id, name, type, size, chunkCount, status, createdAt)`。
   - 状态机：`parsing → embedding → ready | failed`，失败诚实报错（沿用项目规矩）。
2. **切分**：`chunking.ts`——800 字符/120 重叠，Markdown 标题感知，确定性 chunk id。
3. **嵌入**：复用用户当前 API 分组，调 `/v1/embeddings`；用 capability-probe 的思路先探测接口在不在，不在就提示"这个 API 没有 embedding 接口，换个分组试试"。
   - embedding 结果按 `sha256(文本+模型)` 缓存，重建索引免费。
4. **存储**：expo-sqlite 普通表存 chunk（`kb_chunks(docId, idx, text, meta)`），向量存 JSON/BLOB 列；检索用**纯 JS 余弦**（<10ms/6k 向量，无需 sqlite-vec，Expo Go 也能跑）。
5. **检索接线**：
   - 新 AI 工具 `knowledge_search(query)`（对标现有 `memory` 的工具模式）；
   - local-agent 里：用户提问时先调 `knowledge_search` 取 top 5（阈值过滤，太不相关就不注入，**不硬塞**），注入为 `<knowledge src="...">` 上下文块；
   - 回答末尾带引用来源（文件名 + 片段）。
6. **UI**："知识库"入口（可放在"我们的空间"里或设置里——听她的），文档列表、上传按钮、索引进度、删除、清空。
7. **测试**：chunking 单测、余弦检索单测、工具接线测试；i18n 中英；零 emoji。

**交付标准**：上传一篇 md，问里面细节，AI 能答出来并标出来源。

### Phase 2：正统向量库 + 混合检索（估计 1 周）

1. `npx expo install expo-sqlite`，启用 sqlite-vec（`Podfile.properties.json` 加 flag）。
2. chunk 表旁边建 `vec0` 虚拟表，KNN 走 SQL。
3. **混合检索**：现有 `src/memory/search.ts` 的 BM25 思路复用到文档（CJK 分词器已有），向量分 + BM25 分做 **RRF（倒数排名融合）**——sengtha/iany 的移动端方案已验证这套在 Hermes 上跑得动。
4. 引用展示升级：精确到"第 x 块 / 标题路径"。
5. PDF 文本提取（WebView + pdf.js 方案 spike，成了就上）。

### Phase 3：全离线嵌入（估计 2 周，含模型 QA）

1. `onnxruntime-react-native`（Expo plugin，需 dev build）+ `all-MiniLM-L6-v2` int8（英文）或 `multilingual-e5-small`（中文，113MB）。
2. tokenizer：用 transformers 的 tokenizer JSON + 纯 TS 实现（Hermes 可跑）。
3. 下载管理：WiFi 下载、进度、删除；设置里开关"离线嵌入"。
4. QA：中英混合文档的检索准确率抽查（至少 50 个 query 的主观评测）。

### 不做（明确）

- 服务端 pgvector / Python RAG API——和"无强制后端"原则冲突。
- 后台定时重建索引——iOS 不保证，不做。
- Phase 1 不碰 PDF/Word 解析——诚实标注。

---

## 六、和现有代码的咬合点

| 现有模块 | 复用方式 |
|---|---|
| `src/memory/search.ts` | BM25 评分 + CJK 分词器直接复用；注释里已写"Stage 2 可加 sqlite-vec + MiniLM"，接口已预留 |
| `src/api-groups/capability-probe.ts` | 探测 `/v1/embeddings` 是否可用的思路直接复用 |
| `src/api-groups/error-classifier.ts` | embedding 接口报错分类（401/429 等）直接复用 |
| `src/skills/` | 知识库的使用说明可以做成一条 skill，AI 自动知道何时该搜知识库 |
| `expo-document-picker` | 已在用，复用 |
| 备份恢复 | 向量表可重建，备份时只备文档原文 + chunk 元数据，不备向量 |

---

## 七、一句话总结

Kelivo 没做向量 RAG（文档直塞 context），LibreChat 的重型服务端方案不适合手机。**端侧轻量 RAG 在 2026 年是铺好路的**：Expo SDK 54 自带 sqlite-vec，我们的 API 分组自带 embedding 接口，现有 memory 模块连 BM25 和接口预留都写好了。Phase 1（3–5 天）就能做出"上传 txt/md、提问带引用"的可用版本；全离线是 Phase 3 的事，不挡 MVP。

*调研完毕，未动代码。*
