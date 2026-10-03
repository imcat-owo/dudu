# AI Memory Systems — Research for OpenMuse

**Date:** 2026-10-03
**Purpose:** Design the persistent memory system for OpenMuse's in-app AI ("记忆花园" / memory garden).
**Constraints:** React Native/Expo, iOS 26 target, LOCAL-FIRST default (API keys on-device, direct model connections, data stays on phone — memory must work with NO backend).

---

## 1. Best-in-class systems

### 1.1 Mem0 (mem0.ai) — extraction-based memory layer
- **Architecture:** Two-phase pipeline — **extract** facts from conversation → **update** memory bank → **retrieve** top-k at query time.
- **Key decision: ADD-only extraction.** New facts are stored alongside old ones; nothing is overwritten or deleted during extraction. When information changes, both old and new facts survive, preserving temporal context. (Older versions used ADD/UPDATE/DELETE/NOOP operations chosen by LLM function calls.)
- **Retrieval:** Multi-signal — semantic similarity + BM25 keyword matching + entity matching, fused into one score.
- **Entity linking:** Entities extracted from memories into a parallel entity collection; boosts relevant results and resolves the same person/account across sessions. (Replaced the earlier external graph variant `Mem0g`.)
- **Hierarchy:** 4 layers — conversation (in-flight), session (episodic, task-scoped), user (persistent semantic facts/preferences), organizational (shared workspace knowledge). Retrieval queries all layers, ranks user-memory first.
- **Storage:** Vector DB (Qdrant default) + SQL history DB + entity store. Pluggable LLMs/embedders/stores.
- **Benchmarks (self-reported, LOCOMO):** ~26% relative accuracy gain over OpenAI memory, ~90% token reduction, ~91% lower p95 latency vs full-context.
- **License:** Apache 2.0 (core). ~41k GitHub stars (2026).
- Sources: https://mem0.ai/blog/benchmarked-openai-memory-vs-langmem-vs-memgpt-vs-mem0-for-long-term-memory-here-s-how-they-stacked-up, https://mem0.ai/blog/memory-hierarchy-in-ai-systems-from-sensory-to-semantic, https://arxiv.org/pdf/2504.19413

### 1.2 Letta (formerly MemGPT) — OS-inspired self-editing memory
- **Architecture:** Virtual-memory metaphor. Three tiers:
  - **Core memory:** always in the context window (persona + user facts). Bounded. Edited via tool calls (`core_memory_append`, `core_memory_replace`).
  - **Recall memory:** recent conversation history, searchable via `conversation_search`.
  - **Archival memory:** long-term vector store, accessed via `archival_memory_search` / `archival_memory_insert`.
- **Agent-managed:** the agent itself decides when to write/search/modify via tool calls, using an inner monologue. A "heartbeat" mechanism chains multiple memory ops per turn. "Sleep-time" consolidation (dreaming) reorganizes memories offline.
- **Tradeoff:** memory operations are LLM-call-dependent → token cost + latency on every op. No native graph support.
- **Storage:** PostgreSQL + pgvector (hosted); configurable backends self-hosted.
- **Lesson for us:** the *agent-curated* model (AI decides what to remember via tools) is the most honest fit for a companion AI — but the per-op LLM cost argues for a lighter extraction path on mobile.
- Sources: https://github.com/letta-ai/letta, https://github.com/nirdiamant/agent_memory_techniques/blob/HEAD/all_techniques/26_letta_memgpt_patterns/README.md

### 1.3 Zep / Graphiti — temporal knowledge graph
- **Architecture:** Memory as a **temporal knowledge graph**. Three-tier subgraph: **episodes** (raw messages, non-lossy) → **semantic entities** (resolved entities = "what we know") → **communities** (clusters with summaries).
- **Bi-temporal model:** tracks both when a fact was true in the world (valid_from/valid_to) and when the system learned it (transaction time). Contradicted facts are **invalidated, not overwritten** — full historical lineage preserved. Answers "what was true at time T?"
- **Retrieval:** hybrid (semantic embeddings + BM25 + graph traversal) with **no LLM calls during retrieval** → low latency (reported sub-200ms).
- **Benchmarks:** 94.8% DMR (vs 93.4% MemGPT baseline); up to +18.5% accuracy on LongMemEval with ~90% latency reduction.
- **Self-host:** Graphiti is Apache 2.0; needs Neo4j/FalkorDB + an extraction LLM. Zep Cloud is managed-only (Community Edition deprecated).
- **Lesson for us:** temporal invalidation is the right mental model for "she changed her mind / moved cities" — but a full graph DB is overkill on-device. The *idea* (validity intervals, never delete) ports cheaply to a relational schema.
- Sources: https://github.com/getzep/graphiti, https://blog.getzep.com/zep-a-temporal-knowledge-graph-architecture-for-agent-memory/, https://www.marktechpost.com/2025/11/10/comparing-memory-systems-for-llm-agents-vector-graph-and-event-logs/

### 1.4 Cognee — graph-native ECL pipeline
- **Architecture:** ECL (Extract → Cognify → Load). LLM extracts entity-relation triplets → committed as graph edges; embeddings in a parallel vector index; retrieval by **graph traversal** (multi-hop A→B→C reasoning pure vector DBs miss).
- **Memify:** post-processing loop reweights edges by usage, prunes stale nodes, derives new relationships — memory adapts to retrieval patterns.
- **Stores:** graph (Kuzu default) + vector (LanceDB default) + relational (SQLite default). Apache 2.0.
- **Lesson for us:** multi-hop traversal matters for relationship-heavy queries ("who introduced whom"), but for a 1-user companion app the graph is small — entity linking (Mem0-style) gives most of the benefit at a fraction of the complexity.
- Sources: https://docs.cognee.ai, https://github.com/topoteretes/cognee

### 1.5 ChatGPT memory (product)
- **Evolution:** explicit "remember this" (Apr 2024) → **"dreaming"** (auto extraction/editing/sifting, Jun 2025+).
- **Two systems:** (a) saved memories (distilled facts), (b) reference chat history (retrieval over past conversations).
- **User controls:** Settings → Personalization → Memory; view/edit/delete individual entries; "make a correction" / "don't mention this again"; Temporary Chat (fully outside memory); in-chat "forget X".
- **Failure mode (documented):** auto-extraction forms *inaccurate assumptions* (e.g. labels user a DIY enthusiast after a week of light-switch research). Turning "memory" off stops *use* but doesn't delete — full erasure needs explicit delete.
- **Lesson for us:** automatic extraction needs a correction path; "off" must mean off; temporary/incognito must be truly outside memory (we already built this).
- Sources: https://jddaddy.com/how-chatgpt-memory-works-for-free-users-in-2026-and-how-to-control-it/, https://skimnews.com/s/c09a4466/chatgpt-memory-now-updates-itself-how-to-edit-it

### 1.6 Claude memory (product)
- **Design:** memory as **individual categorized entries ("Topics")** — a card index, not a diary. Added *as conversations happen* (not end-of-day summaries). Each topic viewable/editable/deletable; edits apply to all future conversations.
- **Project-scoped memory:** each project has its own memory area.
- **Two mechanisms:** (a) *search* over old conversations (visible in chat, real search with hits); (b) *remembered topics* — loaded automatically, never searched.
- **Sensitive topics:** health/ethnicity/race/gender identity excluded by default (opt-in); SSN/IDs/criminal history/immigration status **never** stored; saving a sensitive topic triggers a user notice.
- **Key quote** (dev.to comparison): *"one service turned individual notes into a diary, the other turned the diary into a card index… the card index is the more honest build."*
- **Lesson for us:** the card-index model (discrete, inspectable, editable entries) is the most honest UX for "she must see what the AI remembers." This maps directly onto 记忆花园.
- Sources: https://dev.to/studiomeyer_io/the-memory-in-chatgpt-and-claude-and-where-it-stops-51ij, https://www.iclarified.com/101902/anthropic-unifies-claude-memory-across-chat-and-cowork, https://sdtimes.com/ai/anthropic-puts-persistent-memory-into-claude-cowork/

### Comparison table

| System | Core idea | Retrieval | Temporal handling | Self-host | On-device fit |
|---|---|---|---|---|---|
| Mem0 | ADD-only fact extraction + entity linking | Multi-signal (vector+BM25+entity) | Old facts preserved alongside new | Yes (Apache 2.0) | Medium — needs vector DB + embedder |
| Letta | OS-like tiers, agent self-edits via tools | Core always-in; recall/archival searched | Via agent curation | Yes | Low — LLM-call-per-op is costly on mobile |
| Zep/Graphiti | Temporal knowledge graph, bi-temporal | Hybrid, no LLM at retrieval | First-class (validity intervals) | Graphiti yes | Low — needs graph DB + extraction LLM |
| Cognee | ECL graph-vector-relational hybrid | Graph traversal + vector | Temporal tracking | Yes | Low — heavy pipeline |
| ChatGPT | Saved memories + chat-history reference | (proprietary) | Dreaming consolidation | No | N/A (cloud) |
| Claude | Topics card-index + conversation search | Topics loaded; convos searched | Per-topic edits | No | N/A (cloud) — but UX model ports directly |

---

## 2. Architecture patterns — tradeoffs

| Pattern | Strengths | Weaknesses | Verdict for OpenMuse |
|---|---|---|---|
| **Pure vector (embed-everything)** | Simple; good fuzzy recall | "Memory soup" (no fact vs episode distinction); needs embedder + vector index; stale facts rank high | Useful as *one signal*, not the whole system |
| **Knowledge graph** | Multi-hop reasoning; explicit relations; temporal queries | Heavy infra (graph DB); extraction LLM cost; overkill for 1-user scale | Borrow the *ideas* (entities, validity), skip the graph DB |
| **Episodic/semantic split** | Matches how memory works; episodes non-lossy, semantics distilled | Two pipelines to maintain | Yes — episodes = chat history (already have), semantics = distilled facts |
| **Structured profile (card index)** | Inspectable, editable, honest UX; cheap | Doesn't scale to thousands of fuzzy recollections | Yes — this IS 记忆花园's data model |
| **Letta-style agent-managed** | Agent curates; most autonomous | Token/latency cost per op; complexity | Partially — agent writes via tools, but extraction should be cheap/async |

**Synthesis:** No single pattern wins. The right design for a local-first companion app is a **hybrid**: structured profile (card index) as the primary store + episodic log (chat history, already exists) + lightweight retrieval (keyword + recency + optional on-device vectors later). Temporal discipline (never silently overwrite; validity intervals) borrowed from Zep; ADD-only instinct borrowed from Mem0; agent-curated writes borrowed from Letta; card-index honesty borrowed from Claude.

---

## 3. On-device feasibility (iOS, React Native/Expo)

**What works on-device today (proven by real projects):**
- **Text embeddings:** `react-native-executorch` (ExecuTorch) runs embedding models on-device; `onnxruntime-react-native` also used. Typical models: ALL_MINILM_L6_V2 (384-dim, ~90MB), EmbeddingGemma-300M (~179MB quantized).
- **Vector search in SQLite:** `op-sqlite` + `sqlite-vec` (vec0 KNN) — proven in production-style projects (`ngnsr/mobile-search` hybrid FTS5+vector via RRF; `sengtha/iany` staged plan: op-sqlite → sqlite-vec → llama.rn).
- **Real precedent:** `software-mansion-labs/react-native-rag` powers **Private Mind**, a privacy-first mobile AI app on the App Store — on-device RAG via `@react-native-rag/executorch` + `@react-native-rag/op-sqlite`.
- **Hybrid search without vectors:** SQLite FTS5 (full-text + BM25 ranking) + recency + tag/entity matching gets surprisingly far for a small (hundreds of facts) memory store — no ML needed.

**Constraints:**
- Native modules (executorch, op-sqlite, sqlite-vec) require **custom dev builds / EAS builds** — they do NOT run in Expo Go. (OpenMuse already builds via EAS/GitHub, so this is compatible.)
- Embedding models add ~90–180MB download; first-run cost. Quantized MiniLM is the pragmatic choice.
- On-device LLM inference (llama.rn) exists but is a separate, heavier lift — NOT needed for memory; extraction can use the chat model API already configured (or a tiny local model later).

**What needs a backend:** nothing, for our design. Full-text + (later) on-device vectors cover retrieval; the chat-model API handles extraction. Cloud mode can optionally use a server-side vector DB, but local mode must not depend on it.

**Recommended staging:**
- **Stage 1 (now):** SQLite (already in app) + FTS5 + structured schema + recency/entity signals. Zero new native deps, zero model downloads.
- **Stage 2 (later):** add `op-sqlite` + `sqlite-vec` + on-device MiniLM embeddings → true semantic retrieval, still 100% offline.

---

## 4. Privacy design

Memory is the most personal data in the app. Non-negotiables (aligned with her existing rules):

1. **Local-first, always.** Memory store lives on-device (SQLite). No backend required, nothing leaves the phone in local mode.
2. **Transparent.** Every memory entry is viewable in 记忆花园 — the card-index model (Claude-style). She sees exactly what the AI remembers.
3. **User-deletable & correctable.** Delete one entry, edit one entry, wipe all. In-dialog: "forget X" / "记住 Y". (ChatGPT's lesson: off must mean off; delete must mean delete.)
4. **Incognito exclusion.** Incognito chats never enter the memory pipeline (already built at the history layer — extend the same gate to extraction).
5. **Sensitive-topic handling.** Follow Claude's lead: never auto-store identity documents / credentials / health-adjacent PII without explicit user instruction; when in doubt, mark "unsure" and ask (this is exactly what 记忆花园's "拿不准" state is for).
6. **Backup honesty.** Memory is included in backup/restore (it's hers); secrets are stripped per the existing backup policy.

---

## 5. Memory operations

**How the AI decides what to remember** (synthesis of best practices):
- **Proactive extraction (primary):** after each turn (async, off the critical path — Mem0-style), the pipeline distills candidate facts. Criteria: durable (still true next month?), personal (about her/preferences/relationship), actionable (changes future behavior). Ephemeral chit-chat is dropped.
- **User-told (override):** "记住 X" / "forget Y" always win over extraction. Explicit instruction beats inference.
- **Dedup via context lookup:** before adding, check similar existing memories (Mem0's step 2) — prevents duplicates.
- **Conflict handling:** ADD-only instinct — when new info contradicts old, keep both with validity timestamps (Zep-style invalidation: mark old as superseded, don't delete). The AI surfaces the *current* one; history stays queryable.
- **Confidence modeling:** each memory carries confidence: `confident` (bloomed), `unsure` (sprout — needs her confirmation), `question` (something the AI wants to ask her). This maps 1:1 onto 记忆花园's three states. Unsure items are shown to her, never silently acted on.
- **Forgetting:** user-initiated (delete/edit); plus time-based decay of *episodic* detail (old chat turns compress) while *semantic* facts persist. Nothing auto-deletes semantic facts — that's her call (ChatGPT's "off doesn't delete" was a scandal; we do the opposite).
- **Correction:** "那不是 X，是 Y" → old fact marked superseded with timestamp, new fact added, both visible in history.

**Cost control:** extraction runs async after the turn (not blocking the reply); retrieval injects only top-k relevant memories (~a few hundred tokens); the always-on "core profile" (Letta-style, ~20 lines: name, key preferences) stays in every system prompt.

---

## 6. Recommended architecture for OpenMuse

### 6.1 Data model (SQLite, no new deps)

```sql
-- Core profile: always in context (~20 lines). One row per key.
user_profile(key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)

-- Memories: the card index (记忆花园). One row = one card.
memories(
  id TEXT PRIMARY KEY,
  content TEXT,              -- the fact, human-readable
  category TEXT,             -- preference | fact | relationship | goal | ...
  confidence TEXT,           -- confident | unsure | question
  valid_from INTEGER,        -- Zep-style: when it became true
  valid_to INTEGER,          -- NULL = currently true; set when superseded
  superseded_by TEXT,        -- id of the newer memory, if any
  source TEXT,               -- chat excerpt / user-told / imported
  created_at INTEGER, updated_at INTEGER
)

-- Episodes: already have chat history; add a lightweight index for retrieval context.
-- (Reuse existing thread/message tables — no new table needed.)

-- Audit log: every memory write, for transparency.
memory_events(id, memory_id, op TEXT, -- add | update | supersede | delete | confirm
              at INTEGER, actor TEXT) -- actor: ai | user
```

FTS5 virtual table over `memories(content)` for keyword/BM25 retrieval. Recency + confidence weight the ranking. (Stage 2: add `sqlite-vec` + on-device MiniLM for semantic signal.)

### 6.2 Write path (async, off critical path)

```
user turn → AI replies (fast path, unaffected)
        └─→ async: extract candidates (chat-model API, tiny prompt)
            → dedup lookup (FTS5 + recency)
            → write to memories (confidence=unsure when inferred, confident when user-told)
            → memory_events log
Incognito ON → pipeline skipped entirely (same gate as history)
```

### 6.3 Read path (per turn, cheap)

```
system prompt gets: user_profile (always, ~20 lines)
                  + top-k memories relevant to this turn
                    (FTS5 keyword + entity match + recency + confidence boost,
                     superseded excluded unless asking about history)
                  ≈ a few hundred tokens, like Mem0's ~90% token saving
```

### 6.4 AI tools (dialog-driven, per her principle)

- `memory_add(content, category)` — explicit remember
- `memory_search(query)` — recall
- `memory_update(id, content)` / `memory_delete(id)` — correct/forget (user asked, or AI with low confidence asking first)
- `memory_confirm(id)` — promote unsure → confident (she confirms in dialog)
- All through the existing tool/authorization flow; all logged to `memory_events`.

### 6.5 记忆花园 UI mapping

| Garden state | Data state | UX |
|---|---|---|
| Bloomed flower | `confidence=confident, valid_to IS NULL` | Full card, she can edit/delete |
| Sprout | `confidence=unsure` | "拿不准" section — tap to confirm/correct/delete |
| Seed / "想问她的" | `confidence=question` | AI's open questions for her |
| Wilted (history) | `valid_to NOT NULL` | Greyed, expandable — "以前是这样的" |

### 6.6 What we deliberately DON'T build (v1)

- Full knowledge-graph DB (overkill for 1 user; entity linking via FTS gives 80%)
- On-device embeddings (Stage 2; FTS5 + recency is enough for hundreds of facts)
- Cross-user/org layers (single-user app)
- Automatic "dreaming" consolidation jobs (extraction-per-turn + supersede-on-conflict covers it; revisit if memory grows past ~1k entries)

---

## 7. Sources

- Mem0: https://mem0.ai/blog/benchmarked-openai-memory-vs-langmem-vs-memgpt-vs-mem0-for-long-term-memory-here-s-how-they-stacked-up · https://mem0.ai/blog/memory-hierarchy-in-ai-systems-from-sensory-to-semantic · https://arxiv.org/pdf/2504.19413
- Letta: https://github.com/letta-ai/letta · https://github.com/nirdiamant/agent_memory_techniques/blob/HEAD/all_techniques/26_letta_memgpt_patterns/README.md
- Zep/Graphiti: https://github.com/getzep/graphiti · https://blog.getzep.com/zep-a-temporal-knowledge-graph-architecture-for-agent-memory/ · https://www.marktechpost.com/2025/11/10/comparing-memory-systems-for-llm-agents-vector-graph-and-event-logs/
- Cognee: https://docs.cognee.ai · https://github.com/topoteretes/cognee
- ChatGPT memory: https://jddaddy.com/how-chatgpt-memory-works-for-free-users-in-2026-and-how-to-control-it/ · https://skimnews.com/s/c09a4466/chatgpt-memory-now-updates-itself-how-to-edit-it
- Claude memory: https://dev.to/studiomeyer_io/the-memory-in-chatgpt-and-claude-and-where-it-stops-51ij · https://www.iclarified.com/101902/anthropic-unifies-claude-memory-across-chat-and-cowork · https://sdtimes.com/ai/anthropic-puts-persistent-memory-into-claude-cowork/
- Comparison: https://mem0.ai/blog/open-source-ai-agents-with-built-in-memory · https://medium.com/open-source-ai-review/7-best-ai-memory-layers-for-ai-agents-in-2026-mem0-zep-letta-and-cognee-compared-9d2c203be555
- On-device: https://github.com/software-mansion/react-native-executorch · https://github.com/software-mansion-labs/react-native-rag · https://github.com/ngnsr/mobile-search · https://github.com/sengtha/iany/blob/HEAD/mobile/SETUP.md · https://github.com/jamon8888/hacienda-mobile/blob/HEAD/docs/superpowers/plans/2026-08-10-on-device-memory-system.md
