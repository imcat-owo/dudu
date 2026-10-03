# OpenMuse Backend Audit — apps/server/src + packages

> Audit date: 2026-10-03. Method: read actual source, every claim has file:line.
> Rule applied: PARTIAL/STUB is not WORKS. No source files were modified.
> Note: a new standing rule landed in MEMORY.md during this audit (2026-10-03):
> all UI text must be Simplified Chinese, icons preferred over text, system font.
> Backend has no UI strings affected, but any new user-facing error text added later must follow it.

## 1. HTTP route map (all routes, from app.ts + sub-routers)

| Method & Path | Status | Evidence | Gap |
|---|---|---|---|
| GET /api/health | WORKS | app.ts:91 — returns mode, agentConfigured, browserConfigured | none |
| POST /api/session | WORKS | app.ts:101 — access-key auth, 30/min rate limit | none |
| GET /api/google/callback | WORKS | app.ts:115 — OAuth code exchange | none |
| GET /api/workspace | WORKS | app.ts:138 — snapshot + browser reachability downgrade | none |
| /api/agent/* (tasks, goals, monitors, ideas, memories, identity, notifications, sample-page) | WORKS | app.ts:152 → engine/routes.ts:17-107 | none |
| /api/computer/* (snapshot, start, stop, commands, files CRUD, pdf import/export) | PARTIAL | computer-routes.ts:10-44; computer.ts:202-205 returns 503 unless COMPUTER_ENABLED=true | Disabled by default; needs Docker + built image on API host; Render blueprint does not start it |
| GET /api/calendars, GET /api/calendar/events | WORKS | app.ts:154-155 | requires Google connected |
| GET /api/mail/threads/:id | WORKS | app.ts:172 | requires Google connected |
| POST /api/actions, POST /api/actions/:id/decide | WORKS | app.ts:175,181 → actions.ts:33-202 (hash verify, 30-min expiry, idempotency, connection binding) | none |
| GET/POST /api/drafts | WORKS | app.ts:189-190 | none |
| GET /api/main-thread | WORKS | app.ts:205 — requires CopilotKit Intelligence thread | hard dependency on external Intelligence service |
| GET/PUT /api/conversation | WORKS | app.ts:228,231 | none |
| POST /api/files, GET /api/files/:id/content, POST /api/files/:id/fill | WORKS | app.ts:238,252,258 | PDF-only uploads (by design) |
| POST /api/mail/import-attachment | WORKS | app.ts:264 | none |
| POST /api/google/connect, POST /api/google/disconnect | WORKS | app.ts:268,280 → google-auth.ts:75-252 | none |
| POST /api/browsers, GET /api/browsers/:id, POST …/navigate, POST …/close, GET …/read, POST …/reopen, POST …/import-downloads, GET …/preview, GET/POST …/console | WORKS | app.ts:286-325 → browser.ts | requires separate browser worker deployed (BROWSER_WORKER_URL + WORKER_TOKEN); 503 otherwise |
| /api/copilotkit/* (chat streaming) | WORKS | app.ts:329 — 503 with message if no model configured (app.ts:330-334) | requires MODEL + provider key + Intelligence key |
| GET / (root) | WORKS | app.ts:349 | none |

Cross-cutting: CORS allowlist + bodyLimit 12MB (app.ts:43-67); Bearer-or-signed-URL auth middleware (app.ts:126-137); Zod/AppError error mapping, no stack leaks (app.ts:68-90).

## 2. Capability verdicts

| Capability | Status | Evidence (file:line) | Gap |
|---|---|---|---|
| Model provider configuration | PARTIAL | config.ts:123 (`model: process.env.MODEL`); agent.ts:22-24 (keys from `process.env.OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY`); tanstack-agent.ts:29,35,44 (optional `*_BASE_URL` overrides) | Single global config, server-operator env vars only, read once at startup, restart required. No per-user/per-owner config, no multi-provider multi-key, no custom headers/auth per provider, no runtime API or UI to change it. `MODEL` format is `provider/model-id`, only 3 providers (openai, anthropic, google); unknown provider throws (tanstack-agent.ts:54-64) |
| Chat (CopilotKit AG-UI) | WORKS | agent.ts:28-58 (runtime); engine/conversation.ts:18-413 (ConversationAgent, tool loop, Jev choices) | needs MODEL + key + CPK_INTELLIGENCE_API_KEY (config.ts:88-96 — required in every mode, separate paid service, not MIT) |
| Delegated task engine | WORKS | engine/worker.ts:21-50+ (SQL leases, checkpoints, abort); engine/service.ts:42+ (create/control/answer/retry); engine/model.ts:19+ (16-step tool loop, serial tool queue, idempotent ops cache) | none found in code |
| Action approvals (human-in-the-loop) | WORKS | actions.ts:33-118 (propose: hash, expiry, idempotency), actions.ts:119-202 (decide: hash-match 409, expiry, connection binding, outcome_unknown handling) | none found in code |
| Google OAuth + Gmail/Calendar adapters | WORKS | google-auth.ts:75 (connect PKCE), :119 (callback), :171 (refresh), :227 (disconnect+revoke); packages/integrations/src/google.ts:1-60+ (Gmail/Calendar REST); vault.ts:16-30 (AES-256-GCM envelope) | Google Cloud OAuth client setup is operator work; recurring-event edits unsupported by design (google.ts RecurringEventError) |
| Browser worker protocol | WORKS | apps/worker/src/server.ts:52 (GET /health), :61/:65 (/sessions), session actions navigate/close/screenshot/read/input/downloads; browser.ts:59-107 (token auth, 45s timeout, 503 mapping) | separate deployment required; Playwright Chromium + persistent profiles (worker/src/browser.ts) |
| Agent computer / terminal (sandbox) | PARTIAL | computer.ts:202-205 (503 when disabled); computer.ts:236-420+ (Docker sandbox: read-only rootfs, no network, 512MB, leases, receipts, idempotency); computer-tools.ts:24-137 (10 agent tools); computer-routes.ts | Code is complete and hardened, but COMPUTER_ENABLED=false by default (config.ts:137, .env.example). On the current cloud backend it is OFF → every call 503s. Not a stub, but not usable as deployed |
| Files / PDF pipeline | WORKS | app.ts:238-262; files.ts | PDF-only by design |
| Identity / memories / ideas / goals / monitors / notifications | WORKS | engine/routes.ts:17-107; engine/service.ts | none found in code |
| Text-to-speech (AI voice replies) | MISSING | repo-wide grep for tts/text-to-speech/speech/expo-speech across apps+packages+tests: zero hits | No endpoint, no provider integration, no audio pipeline. Mobile VoiceBubble can play audio URIs but nothing synthesizes speech |
| Speech-to-text (voice input understanding) | MISSING | same grep: zero hits | Mobile records audio and embeds it as JSON in message content; server has no transcription — the agent receives it as opaque text, cannot "hear" it |
| MCP client (connect user-supplied MCP servers) | MISSING | repo-wide grep for mcp/modelcontextprotocol across apps+packages+tests: zero hits | No SDK dependency, no registry, no tool bridging. Agent tools are hardcoded in engine/model.ts:86-236 and engine/conversation.ts |
| MCP server (expose tools outward) | MISSING | same grep: zero hits | nothing to expose; packages/backends/src contains only openbot.ts (disabled OpenBot adapter, contract-tested only) |
| Runtime provider-settings API (Kelivo-style) | MISSING | no /api/settings or provider routes exist (full route map above) | See §3a |

## 3. Concrete answers

### (a) What would a mobile client need for Kelivo-style custom API endpoints/keys per provider?

Today: **nothing exists to call.** Provider config is server env vars only
(`MODEL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`,
`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `GOOGLE_GENERATIVE_AI_BASE_URL`),
parsed once in `readConfig()` (config.ts:100-151), single global for all owners,
change = operator edits env + restarts server. `tanstack-agent.ts:adapter()`
reads `process.env` directly per call — it never consults per-owner state.

To build it (server work first, client second):
1. Per-owner provider store: new DB collection (e.g. `provider-configs`) holding
   `{ provider, baseUrl, apiKey, model, customHeaders? }`, apiKey encrypted with
   the existing vault (`packages/integrations/src/vault.ts:16-30`, same envelope
   Google tokens use).
2. New routes, e.g. `GET/PUT/DELETE /api/providers` + `POST /api/providers/:id/test`
   (real ping, error surfaced verbatim — matches the Bridge brief's rule, not this repo's).
3. Change `tanstack-agent.ts:adapter()` to accept resolved credentials per owner
   instead of `process.env`; thread the owner through `ConversationAgent` and
   `executeModelTask` (both already carry `owner`). Support multi-key rotation
   and custom headers here.
4. Mobile: settings UI (Kelivo-style provider cards) calling the new routes.
5. Migration: keep env vars as server-default fallback so current deployment keeps working.

### (b) What would a mobile client need to get AI voice replies via TTS?

**Missing end-to-end.** There is no `/api/speech`, no TTS provider wiring, no
audio storage/delivery path on the server. The mobile `VoiceBubble` can play an
audio URI, but nothing produces one from assistant text, and nothing transcribes
user voice recordings either (STT also MISSING — see table).

To build it:
1. Server: `POST /api/speech` accepting `{ text, voice? }`, proxying to a TTS
   provider (e.g. OpenAI TTS) using the provider-config store from (a);
   return a signed short-lived audio URL (reuse the `auth.sign` pattern used for
   `/api/files/:id/content`, app.ts:126-137) or the bytes directly.
2. Client: "voice reply" toggle in chat; on assistant text message, call the
   endpoint and render the existing `VoiceBubble` with the returned URI.
3. STT (separate, needed for voice *input* to be understood):
   `POST /api/transcribe` accepting the recorded audio upload; insert transcript
   into the message sent to the agent. Without this, hold-to-record messages
   remain opaque JSON blobs the model cannot interpret.
4. Voice choice: user's spec (MEMORY.md voice brief — Mandarin male teen voice,
   breathing, punctuation-as-direction) means provider voice + prosody settings
   must be configurable per provider, not hardcoded.

### (c) What would a mobile client need to connect user-supplied MCP servers (URL + auth)?

**Missing end-to-end.** Zero MCP code anywhere (no `@modelcontextprotocol/sdk`
dependency, no client, no server, no registry). Agent tools are hardcoded
`defineTool` lists in `engine/model.ts` and `engine/conversation.ts`.

To build it:
1. Add MCP client dependency (official SDK; SSE + streamable HTTP transports).
2. Per-owner MCP registry: DB collection `{ name, url, headers/auth (encrypted
   via vault.ts), enabled }` + CRUD routes (e.g. `/api/mcp/servers`) + connection
   test that lists tools (mirrors the Bridge brief §4 step 4 acceptance).
3. Tool bridging: on MCP connect, discover tools and map each to a CopilotKit
   `defineTool` injected into the agent's tool array per request (both
   `ConversationAgent.run` and `executeModelTask` build their tool lists per call,
   so per-owner dynamic injection is architecturally feasible). Enforce the
   existing approval pattern for sensitive tools (reuse `ActionService`
   propose/decide rather than inventing a new gate).
4. Mobile: "MCP servers" settings screen (URL + auth header fields, test button,
   per-server enable toggle, tool list view).
5. Per the user's Bridge rule: external MCP must also be permission-scoped and
   isolated per owner — the single-owner `owner` scoping already used by every
   other collection applies directly.

## 4. Brutal summary

- **Genuinely solid:** HTTP API surface, auth, chat streaming, durable task engine,
  approval flow, Google OAuth + adapters, browser worker protocol, credential vault.
- **Real code, switched off as deployed:** the Docker computer (503 by default).
- **Absent, not stubbed:** TTS, STT, MCP client, MCP server, runtime provider
  configuration. Any plan promising "AI voice replies" or "connect your MCP
  servers" must budget full server+client builds for each — none of it exists
  to wire up.
- **External hard dependencies:** CopilotKit Intelligence key required in every
  mode (config.ts:88-96); browser worker and computer are separate deployments.
