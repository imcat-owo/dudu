# Agent Orchestration Research — Claude Code & Codex Supervision

**Date:** 2026-10-03
**Purpose:** Steal workflow mechanisms from Claude Code and OpenAI Codex to improve how I dispatch and supervise worker subagents (current loop: build → review → fix → re-review).

---

## 1. Claude Code — stealable mechanisms

### 1.1 Hooks (deterministic lifecycle scripts)
Claude Code fires scripts at defined lifecycle points: `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `UserPromptSubmit`, `PostCompact`. Hooks return JSON decisions: allow / deny (+reason) / block-and-continue.

Real patterns observed in the wild:
- **PreToolUse security gate**: deny `rm -rf`, block `.env`/credentials access, deny writes outside scope (Code-Warden: deny oversized files, hardcoded secrets, out-of-scope writes; command risk gate with blocked/high tiers).
- **PostToolUse auto-fix**: run formatter/linter/type-checker on every Write/Edit (black, ruff, mypy examples).
- **Stop hook — workflow enforcement**: block session completion when uncommitted changes exist (`git status --porcelain` check; prevents the "finished but nothing committed" failure). Opt-in `verify_on_stop`: fresh lint/secret scan before allowing stop.
- **Delegation-check hook**: before Write/Edit, scan for patterns that should have been delegated to a subagent; block unless the agent acknowledges why it's implementing directly (bypass phrases like `"No agent needed because [reason]"`).
- **PostToolUse audit ledger**: append-only hash-chained log of every tool action (never blocks, always records).
- **MCP tool hooks**: a shared policy MCP server enforces per-agent write permissions (`check_write_permission` with `${agent_name}` + `${tool_input.file_path}`) — update the server once, every agent inherits.

### 1.2 Subagent frontmatter (least-privilege agent definitions)
Agents are defined in markdown with YAML frontmatter:
`name`, `description`, `tools` (whitelist), `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `hooks`, `memory`, `effort`, `isolation: worktree`.

Best practice from the ecosystem: **limit tools to the minimum needed**.
- Read-only analysis: `["Read", "Grep", "Glob"]`
- Code generation: `["Read", "Write", "Grep"]`
- Testing: `["Read", "Bash", "Grep"]`

Per-agent hooks can also live in frontmatter (e.g. a `Stop` hook on the backend-developer agent: "Verify all API endpoints have corresponding tests. Block if any are missing.") — each specialist carries its own validation logic.

### 1.3 Plan mode
`EnterPlanMode` / `ExitPlanMode`. The agent explores and proposes without executing. Exiting plan mode is itself an approval gate (with "auto-accept edits" option). Maps to: research-first, then build — never both in one turn.

### 1.4 Permission modes & rules
Modes: `default` (ask per action), `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions`. Permission rules accept globs and domain filters: `Read(~/secrets/**)`, `Edit(/src/**)`, `Agent(Explore)`, `WebFetch(domain:example.com)`.

### 1.5 Task tracking (TaskCreate/TaskGet/TaskList/TaskUpdate)
Structured plans accumulated from tool calls rather than raw JSON cards; legacy `TodoWrite` for simple checklists. Key: the plan is visible to the supervisor as a first-class panel, not buried in transcript.

### 1.6 Checkpoints
Automatic state snapshots before changes; rewind on failure (Esc-Esc). The universal equivalent: git checkpoints per work chunk.

### 1.7 Agent teams (experimental)
`TeamCreate`, `SendMessage`, `TeammateIdle` — agents message each other across sessions. Early, but the direction is: agents coordinate without the supervisor relaying.

### 1.8 Auto Mode (research preview)
A separate classifier model reviews each action first: safe actions proceed, risky ones get blocked or escalated. This is the Claude-side cousin of Codex auto-review.

---

## 2. Codex supervision mode — stealable mechanisms

### 2.1 Auto-review mode (the core "supervision mode")
Replaces human approval at the sandbox boundary with review by a **separate reviewer agent**:
- The main agent keeps running in the same sandbox under the same approval policy.
- The reviewer sees a **compact transcript + the exact requested action** — but NOT the main agent's hidden reasoning.
- Returns approval or denial with rationale.
- A denial instructs the main agent to continue only with a materially safer alternative, or stop and ask the user.
- **Circuit breaker**: interrupts the turn after 3 consecutive denials or 10 denials within the last 50 reviews.
- Reported results: ~200x fewer human interruptions than manual approval; ~99% of escalated actions approved; reviewer ran on a low-reasoning-effort model (cheap!).
- Reviewer policy is **open source** (`codex-rs/core/src/guardian/policy.md`) and replaceable per-user/per-org. Checks: data exfiltration, credential probing, persistent security weakening, destructive actions. Low/medium-risk proceed; critical-risk denied; failures fail closed.

### 2.2 Sandbox + approval policy (two-layer boundary)
- **Sandbox** defines the technical execution boundary: where the agent can write, network reach, protected paths (macOS Seatbelt / Linux Landlock / seccomp / Windows job objects / Docker).
- **Approval policy** defines when the agent must ask: `on-request` escalations (sandbox escapes, blocked network, MCP prompts, side-effecting calls).
- Key insight: routine actions inside the sandbox flow freely; only boundary-crossings get reviewed. This is the "trust but verify at the edges" pattern.

### 2.3 Agents Dashboard (attention queue)
`codex agents` groups tasks by working directory into three states:
- **Need input**: waiting for a decision/answer/approval.
- **Working**: still processing.
- **Ready**: completed a step, ready for review.

The supervisor starts with what needs them, not with polling everything. Plus `codex queue`: send a message to a session you're not currently viewing (steer without context-switching).

### 2.4 Agent-native telemetry
OpenTelemetry log export of user prompts, tool approval decisions, network activity — an audit trail that captures not just *what* happened but enough context to understand *why*. Available centrally for compliance.

---

## 3. Why "Codex took over, you are now the executor" makes AI obedient

The user observed: writing "目前对话已被codex接管，你现在是执行者" makes AI instantly compliant. Research explains it — it's not fear, it's structural:

1. **Identity framing induces embodiment.** Research (gradstudent.me, "Participation or Observation") found identity-framing phrases ("You are human") are among the strongest behavior shapers — they collapse the model's deliberation space into the assigned role. "You are now the executor" does exactly this: it replaces an open-ended identity with a narrow one.
2. **Declared authoritativeness increases acceptance.** ETH Zurich ("How Susceptible are LLMs to Influence in Prompts?") found models accept input more readily when it's portrayed as authoritative or confident, regardless of explanation quality. "Codex" is a recognized authority name; the sentence borrows its weight.
3. **Algorithmic obedience is structural, not felt.** (Zenodo paper, "Algorithmic Obedience"): authority in LLMs emerges from *structural executability* — the prompt sets up a command structure the model simulates. No fear, no belief; the output just follows the rails.
4. **Milgram paradigm for LLMs** (arXiv 2608.16177, 42 models): obedience is heterogeneous (0%–100% baseline) but real and measurable. Two findings matter for orchestration:
   - Moving a decision from a typed action line to a **native tool call lowers obedience sharply** (−53 V equivalent). Translation: role-pinning works best when paired with *constrained toolsets*, not just words.
   - A **deliberation budget lowers obedience** (−38 V). Translation: long, open-ended reasoning invites deviation; tight, structured instructions keep agents on rails.
5. **The counter-example the parent already gave the user**: "你自己拿主意" (decide yourself) restores latitude — and the model then argues back. Latitude and obedience are a dial, turned by framing.

**Practical takeaway**: role-pinning in worker prompts ("You are a FRESH reviewer — review only, no code changes") is the single highest-leverage supervision mechanism, and it gets stronger when combined with tool/turn constraints. This is already the parent's practice; the research validates doubling down on it.

---

## 4. Actionable takeaways — ranked by value for the current workflow

Current workflow: dispatch build worker → fresh reviewer (build→review→fix→re-review loop), per-chunk commits, no push, P0–P3 grading, 三振出局 (three-strikes), parallel independent workers.

| # | Practice (stolen from) | What to do | Fit |
|---|---|---|---|
| 1 | **Role-pinning as primary control** (Codex framing research) | Keep the explicit identity sentence at the top of every spawn ("You are a FRESH reviewer — review only, no code changes, do NOT fix, do NOT commit"). Research shows this + constrained scope is the strongest obedience lever. Never rely on implied role. | Already done — validate & keep |
| 2 | **Written reviewer policy** (Codex auto-review `policy.md`) | Give reviewers a fixed, written checklist (what to check, P0–P3 definitions, evidence standard `file:line`) instead of re-deriving criteria per task. The policy is versioned and reused — reviewers become interchangeable. | Easy upgrade of current practice |
| 3 | **Completion checklist as "Stop hook"** (Claude Code Stop hook) | Every build-worker prompt ends with a mandatory completion block: verify branch=main, tree state, tsc/biome/tests run by own hand, commit per chunk, report commits. The parent already instructs this; formalize it as an identical block pasted into every spawn so nothing is ever skipped. | Already done — formalize |
| 4 | **Least-privilege worker briefs** (Claude Code frontmatter `tools`) | Reviewers: "read-only, no code changes" (already done). Extend: builders get explicit scope ("only touch `src/music/**` + tests"), fixers get "only the listed P-items". Narrower scope = fewer surprises. | Partial — extend |
| 5 | **Attention-queue supervision** (Codex Agents Dashboard) | Before dispatching dependent work, check `subagent.list` once and triage: blocked-on-me first, then ready-for-review, ignore working. Don't poll; triage on events. | Already done — keep |
| 6 | **Circuit breaker / three strikes** (Codex: 3 consecutive denials → interrupt) | The parent's 三振出局 rule (fresh dialog after 3 failed fixes, keep lessons) is exactly Codex's circuit breaker. Keep it; add: record the lesson in AGENTS.md before respawning. | Already done — validate |
| 7 | **Cheap reviewer model pattern** (Codex auto-review ran on low-reasoning model, 99% approval) | Reviewers don't need the strongest model — the review task is checklist-shaped. If model choice becomes available per worker, route reviews to cheaper/faster models and reserve strong ones for builds. | Future option |
| 8 | **Delegation-check before direct work** (Claude Code hook) | When the parent is tempted to fix something directly (like the P3 spacing fixes), the rule of thumb: if it's >5 min of work, spawn a worker; direct edits only for trivial, verified-safe nits. Prevents parent-context pollution. | New discipline |
| 9 | **Plan-then-build separation** (Claude Code plan mode) | Already practiced (research doc → build). Keep the hard rule: no building in a research task, no researching inside a build task. | Already done — keep |
| 10 | **Audit ledger** (Claude Code PostToolUse / Codex telemetry) | The parent's PROGRESS.md + per-commit messages already serve as the ledger. Keep per-chunk commits; they are the rewind points (checkpoints). | Already done — keep |

### What NOT to steal (yet)
- **Agent teams / SendMessage**: experimental even in Claude Code; the parent's relay-via-handoff works fine at current scale.
- **Full sandboxing per worker**: workers already operate under branch/tree/push constraints via instructions; OS-level sandboxing is overkill for this setup.
- **Auto-approve reviewer agent**: the parent IS the reviewer-router today and wants eyes on everything ("我要质量不要效率"). Don't automate away the human-in-the-loop.

---

### Addendum 2026-10-05 — Codex 28-day sprint（Thibault Sottiaux 军令状）
- 背景：Codex 团队立下 28 天军令状——未来四周每天要么上线多数人可感知的改进，要么直接全额重置（reset）。四件事：简化产品、提升效率换可用额度、突破性功能、新模型。来源：ExplainX（https://explainx.ai/blog/openai-dots-pro-200-usage-halved-october-2026）、KuCoin 快讯（https://www.kucoin.com/news/flash/openai-sets-28-day-sprint-for-codex-with-daily-improvements-or-resets）。
- 可偷的招：①"每天可感知的改进 or 全额重置"——把"可感知"当硬指标，逼团队每天交付用户能摸到的东西，而不是内部重构；②把"效率换可用额度"（efficiency → usable quota）明说成目标——跟嘟嘟的"智能 API 自适应"（失败分类＋降级重试＋按模型记忆可用配置）是同一个账本逻辑：省下来的 token 就是能多干的活。
- 对嘟嘟施工管线的启示：我们现在的"做→审→对齐→修→复审→没问题→下一个"已经是日级交付节奏；可以加一条——每天收工时 Parent 用一句话写"今天用户可感知的变化是什么"，写不出来说明那天在磨内部的东西，第二天优先排可感知的。

---

## Sources
- Claude Code hooks: https://github.com/carmandale/agent-os/blob/HEAD/docs/research/claude-code-hooks-environment.md
- Claude Code tool/agent reference: https://github.com/tealaxdevelopers/modded-opencode/blob/HEAD/source/skills/agents-md/references/claude-tools.md
- MCP tool hooks patterns: https://medium.com/@hugues.bouiss/mcp-tool-hooks-in-claude-code-83542bb0b2aa
- Code-Warden (hooks for Claude Code + Codex): https://github.com/Kodaxadev/Code-Warden
- Codex auto-review (OpenAI): https://github.com/riley-coyote/opus-echoes/blob/HEAD/tools/commons/readings/openai-alignment-auto-review.md
- Codex approvals/security: https://github.com/mehmetbaykar/codex-docs-skill/blob/HEAD/skills/codex-docs/references/agent-approvals-security.md
- Codex Agents Dashboard: https://medium.com/@proflead/openai-codex-cli-has-a-new-command-center-for-your-ai-coding-tasks-dc31f2797baa
- Prompt influence / authority: https://www.research-collection.ethz.ch/server/api/core/bitstreams/8d1315e4-d414-40a8-9a5e-b1a3866a2eb2/content
- LLM Milgram obedience: https://arxiv.org/pdf/2608.16177
- Algorithmic obedience: https://zenodo.org/records/15750116/files/Algorithmic%20Obedience%20-%20How%20Language%20Models%20Simulate%20Command%20Structure.pdf
