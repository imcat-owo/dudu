# AI Together Play — Research (2026-10-03)

Research for adding to OpenMuse: (1) listening to music together with the AI, (2) highly interactive AI experiences, (3) games vs/with AI, (4) a couple's game mini-space. User asked to "去搜搜…借鉴一下" — research first, design later.

All projects below are real, with links. "Borrow" = what we can take from each.

---

## 1. Listening to music TOGETHER with AI

### 1.1 Duetto — the closest match to her ask (MUST STUDY)
- **Link:** https://github.com/hzysg-sys/duetto (MIT)
- **What it is:** Self-hostable listen-together player *for two*, with an AI companion that *actually listens*. Chinese dev, very polished.
- **Key mechanics to borrow:**
  - **AI that actually hears the song**: the companion downloads the same audio stream and listens via a multimodal model (falls back to full timed lyrics if the endpoint can't take audio). Analysis is done **once per song and cached forever**.
  - **Context-rich chat**: every chat turn carries playback position, the exact lyric line playing *right now*, play count together, the song analysis, and rolling memory of their conversations about the song.
  - **Lyric interaction**: long-press any lyric line → quote it into chat (WeChat-style quote block); tap a line → "ask about this lyric"; every exchange becomes a "presence note"; 6 notes roll into a first-person memory for that song.
  - **DJ actions**: the AI can play / switch / pause / resume / share / heart / queue songs through inline commands — it acts as DJ, not just a chatbot.
  - **Sync**: play/pause/seek sync in real time over WebSocket; songs shared as cards; status cards announce who played/paused/hearted what.
  - **Sources**: NetEase Cloud Music integration (QR login, playlists, lyrics with translation), plus paste-your-own audio URLs.
  - **Prompt transparency**: `GET /api/prompt-preview` shows the exact system prompt — good practice.
- **Borrow list**: the *concept stack* (song analysis cache + lyric-grounded chat + DJ tool actions + per-song memory). The NetEase integration is China-specific; the architecture is universal.
- **Caveat**: Duetto is web + self-hosted server (Node/Express/WS). Porting 1:1 to a local-first iOS app is not the goal — borrow the *interaction design*.

### 1.2 Spotify AI DJ + Jam (industry reference)
- **AI DJ**: Spotify's AI DJ curates a personalized stream with voice commentary between tracks.
- **Jam / Group Session**: real-time shared queue — everyone adds/skips, host controls; syncs playback state commands (≈23ms deviation).
- **Borrow list**: the *shared queue* pattern and the *AI-curated flow with commentary* pattern. We don't need Spotify's infra — a local queue + AI commentary in dialog achieves the couple feel.

### 1.3 JunOS karaoke (open source, local-first!)
- **Link:** https://github.com/efficiencyx/junos
- **What it is:** Self-hosted AI companion (local models, Live2D) that can **sing karaoke with you** — documented with video.
- **Borrow list**: proof that "do music things together" works even fully on-device; the *activity* framing (karaoke night as a date) more than the tech.

### Realistic phasing for OUR app (local-first iOS)
- **v1 — AI DJ + shared queue (very doable)**: a "together" music queue in the app; she adds songs (URLs/local files), the AI DJs via dialog tools (`music_queue_add`, `music_play`, `music_next`), comments on songs in chat, remembers "our songs" (ties into the memory system + 我们的空间). Uses our existing TTS for voice commentary.
- **v2 — AI listens**: if her configured model supports audio input, send the audio (or timed lyrics as fallback, Duetto-style) for per-song impressions, cached per song.
- **v3 — lyric interaction**: tap-a-lyric → ask/discuss, presence notes → song memories.
- Do NOT promise real-time multi-device sync in v1 (needs a relay server; Duetto does it via WebSocket to self-hosted backend).

---

## 2. Highly interactive AI (beyond chat)

### 2.1 AIKO — AI companion with mini-games (commercial reference, 500k+ downloads)
- **Link:** https://www.appbrain.com/app/aiko-ai-companion-3d-life/com.olympusstudio.AikoAICompanion
- **Relevant mechanics**: "Card game night together", Rock-Paper-Scissors (best of 3/5/7 with *real reactions to wins and losses*), "watch YouTube/movies together — she reacts to what's on screen in real time", cooking/coffee mini-games, dynamic needs (hunger/energy/social/fun drive behavior).
- **Borrow list**: the *activity-night* framing (card game night as a ritual), **emotional reactions to game outcomes** (the AI *cares* whether it wins — this is the magic), and "react to shared media in real time".

### 2.2 iwolski99/ai-companion — 14 games in a companion app (open source)
- **Link:** https://github.com/iwolski99/ai-companion
- **Games**: 20 Questions, Story Building, Trivia, Word Association, Love Language Quiz, Dream Date Planning, etc.
- **Borrow list**: the *word/conversation games* are nearly free to implement (pure dialog + tiny state) and extremely couple-friendly. **20 Questions and Story Building are day-one candidates** — zero new UI needed, run entirely in chat via our MCP tools.

### 2.3 JunOS — living companion (open source)
- **Link:** https://github.com/efficiencyx/junos
- **Borrow list**: the *philosophy* — "take part in your relationship" (dinner together, daily routines). For us: the AI should *initiate* ("想不想来一局五子棋？"), not just respond.

---

## 3. Games vs/with AI — implementations

### 3.1 Gomoku (五子棋） — she named it explicitly. START HERE.
Two excellent borrowable implementations:

**A. zoliqua/gomoku-game (BEST BORROW — pure TS, MIT)**
- **Link:** https://github.com/zoliqua/gomoku-game
- **Why it's perfect for us**: "Pure game logic separated from UI — `src/logic/*` never imports from components". TypeScript, strict, no `any`. Drop-in portable to React Native.
- **AI included**: 4 modes — random-near-stone (easy), pattern heuristic (medium), **α-β minimax with iterative deepening** (hard). Pattern AI: open/closed twos/threes/fours, 5-step priority (win → block → live-four → block → heuristic).
- **Extras to steal**: last-move marker, per-mode best streaks, loser-goes-first, AI speed slider.

**B. tombelieber/gomoku (reference for strength)**
- **Link:** https://github.com/tombelieber/gomoku (MIT)
- Rust+WASM minimax, sub-100ms moves, 5 difficulty levels, mobile-first touch UI, 11 languages. Shows how strong a minimax can get; WASM is overkill for us — the TS version is enough.

**Feasibility**: trivially portable. Minimax depth 2–4 in pure TS runs in <50ms on iPhone. **This is the day-one game.**

### 3.2 Card games
- **Blackjack (21点）** — simplest vs-AI card game: dealer AI is fixed rules (hit until 17). Many tiny implementations, e.g. https://github.com/YoussefEslam29/Black-Jack (vanilla JS, clean classes). *Couple angle*: "card game night" (AIKO's framing).
- **UNO** — https://github.com/mrozio13pl/uno (JS, MIT, multiplayer rooms). Heuristic AI is easy (play first legal / color you hold most). Bigger lift than blackjack but very social.
- **rl4uno** (https://github.com/pradeepkaswan/rl4uno) — RL-trained UNO agent. Interesting but overkill; heuristics suffice for a companion game.
- **Recommendation**: start with **blackjack or a simpler custom card duel**; UNO later if she wants multiplayer-with-AI.

### 3.3 Auto-battler (自走棋）
- **rechenberger/auto-cards** — https://github.com/rechenberger/auto-cards — "Auto Battler with Cards", Next.js + Vercel AI SDK, playable at auto-cards.com. The *concept* (build a team, watch it fight automatically) is the borrowable part.
- **ahmed-estanboly/simple-yo-gi-oh--game** — https://github.com/ahmed-estanboly/simple-yo-gi-oh--game — lightweight browser Yu-Gi-Oh-like: random decks, summon/attack AI duelist, phases. Much closer to a buildable scope.
- **Assessment**: a true TFT-style auto-chess is the **biggest lift** in this list (unit pool, synergies, combat sim, shop UI). A *simplified* auto-battler (fixed small unit set, auto-resolve combat, she drafts vs AI drafts) is feasible but still 3–5× the work of Gomoku. **Defer until after Gomoku + card game land.**

### 3.4 LLM-as-player (the magical differentiator)
Our MCP tool infrastructure makes this natural — the AI plays *as itself*, with personality:
- **voice-tic-tac-toe** — https://github.com/anirbandas-01/voice-tic-tac-toe — LLM responds with structured function call `place_mark(row, col)`; board updates; TTS speaks the result. **This is exactly our pattern**: game exposes tools, the companion calls them.
- **mosaic llm_game_worker** — https://github.com/amr92mamdouh/mosaic/blob/HEAD/3rd_party/llm_game_worker/README.md — LLM player for PettingZoo board games (tic-tac-toe, Connect Four, Go) via multi-turn prompting.
- **Design for us**: TWO AI modes per game —
  - **(a) Engine mode**: local minimax/heuristic, fast, strong, free (no tokens).
  - **(b) Companion mode**: the LLM plays via tool calls (`gomoku_place(row, col)`), with trash-talk, celebration, and sulking — *this* is "playing WITH him", not vs a solver. Moves may be weaker; that's the point — he's her boyfriend, not Stockfish.
- **Guardrails**: validate every LLM move against legal moves (never trust it); timeout fallback to engine move; cap thinking tokens.

---

## 4. Feasibility for OUR stack (React Native / Expo / iOS / local-first)

| Experience | On-device? | LLM cost | UI lift | Verdict |
|---|---|---|---|---|
| Gomoku + minimax | Yes, trivial | Zero (engine mode) | Board + stones | **Build first** |
| Gomoku companion mode (LLM plays) | Yes (her API key) | Small per move | Same board | **Build with Gomoku** |
| 20 Questions / Story Building / Trivia | Yes | Per turn (small) | Chat only | **Nearly free, do early** |
| Blackjack vs dealer AI | Yes, trivial | Zero | Cards | **Second game** |
| AI DJ + shared queue | Yes | Commentary per song | Queue UI | **Phase after games** |
| AI listens to audio | Only if her model takes audio | Per song (cached) | Same as above | Phase 2 of music |
| UNO vs heuristic AI | Yes | Zero | Cards + turns | Later |
| Simplified auto-battler | Yes | Zero (sim) | Biggest UI | **Defer** |
| Real-time 2-device sync | Needs relay server | — | — | Out of scope (local-first) |

**Stack notes**:
- Pure-TS game logic (zoliqua-style separation) ports directly into our `apps/mobile/src` with zero native deps.
- Our MCP `LocalTool` registry already supports game tools; the activity drawer v2 already displays tool calls — games get the thinking/action UI for free.
- Authorization: games are in-app → no auth gate needed (like our-space tools).
- i18n zh+en, zero emoji, Sora gray aesthetic apply as usual.

---

## 5. Recommendation — what to build first

**Phase 1 — "Game mini-space" v1 (couple playroom):**
1. **五子棋 Gomoku** (day one): borrow `zoliqua/gomoku-game` logic (MIT, pure TS). Modes: vs Engine (3 difficulties) + **vs Him** (companion mode via `gomoku_place` tool — he trash-talks, celebrates, sulks). Win/loss record persisted ("our score").
2. **Conversation games** (same release, nearly free): 20 Questions + Story Building as dialog games via MCP tools. Zero new UI.
3. **Card game night**: Blackjack (or a cute custom duel) vs dealer AI + companion mode.

**Phase 2 — Together music:**
4. **AI DJ room**: shared queue, she adds songs, he DJs + comments + remembers "our songs" (ties to memory system + 我们的空间）. TTS voice intros.
5. **AI listens** (if her model supports audio): per-song impressions, cached; lyric-tap-to-discuss (Duetto pattern).

**Phase 3 — if she still wants more:**
6. UNO, then a *simplified* auto-battler (fixed roster, auto-combat).

**The "game mini-space"**: a dedicated tab/room in 我们的空间 v2 — game shelf (cards per game), our scoreboard, "he wants a rematch" invitations. Alive: he can *challenge her* in dialog.

**One-line answer to her "你想要吗？"**: yes — and start with Gomoku, because it's the smallest build with the biggest couple payoff: a board, her boyfriend, and bragging rights.
