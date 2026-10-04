# P3 Tracking (2026-10-04)

Builder: subagent df931e58. One commit per perspective group on `main`.

| # | Item | Status | Evidence / File:Line | Commit |
|---|------|--------|---------------------|--------|
| 1 | code P3-1 biome drift | fixed | 59 errors+35 warns -> 1 error+33 warns; --write format; removed unused Text import, unused param, fixed noArrayIndexKey w/ stable key; remaining 14 noNonNullAssertion (13 test) + 6 noExplicitAny (test) = pre-existing style drift, risky to rewrite test assertions | d2d2931 |
| 2 | code P3-2 local-agent silent catch | fixed | documented silent-loss pitfall in catch (no logger exists in codebase) | d2d2931 |
| 3 | code P3-3 useChatAgent hook-order comment | already-fixed / verified | comments intact in-code (header + per-call biome-ignore); NOT refactored per task. FINDING: caller local-app.tsx:203 renders ChatScreen WITHOUT key={mode} -- documented discipline NOT enforced; flipping mode in Settings while chat mounted risks hook-order crash. Flagged for parent to escalate (needs AGENTS.md note, which I must not edit). | - |
| 4 | ui P3-1 drag handle cuter | TODO | | |
| 5 | ui P3-2 typing dots livelier | TODO | | |
| 6 | ui P3-3 music time font 12px | TODO | | |
| 7 | xiaomeng P3-1 empty copy voice | TODO | | |
| 8 | xiaomeng P3-2 today card verify | TODO | | |
| 9 | xiaomeng P3-3 couple avatar play | TODO | | |
| 10 | ai dead-code createPetInteractionVideoTools | already-fixed | zero matches repo-wide; removed earlier (pet/tools.ts clean) | - |
| 11 | ai dead-code pet/interactions.ts | already-fixed | file deleted in 3d8edc4 (P2-13/14/15 dead code); nothing imports it | - |
| 12 | ai dead-code logInteraction calls | already-fixed | zero matches in pet-ui.tsx (audit listed 4; removed by sibling work) | - |
| 13 | ai dead-code interaction player layer | already-fixed | zero matches for interactionPlayer/interactionOpacity/setInteractionBoth; remaining "interaction" mentions are live P2-30 comments | - |
| 14 | user P3 task-cards-ui header comment | already-fixed | header rewritten in 1c28319 (task-cards P0-2); no mp4 promise remains | - |
| 15 | user P3 task card stuck timeout | fixed | our-space/task-progress.ts: STUCK_AFTER_MS=24h + sweepStale() called from upsert() and load(); 2 new tests, 13/13 pass | (user group) |
| 16 | user P3 knowledge-ui stale comment/setStore | fixed | knowledge-ui.tsx: header now PDF-supported/Word-coming-soon; removed write-only setStore state + 2 calls + unused SqliteKnowledgeStore import | (user group) |
| 17 | user P3 example skills default-disabled | fixed | skills/store.ts: seed lines 99,117 -> enabled:false (user-created stays true); skills.test.ts updated + new seed-disabled assertion, 13/13 pass. Note: existing installs keep stored values | (user group) |
| 18 | user P3 voice-settings onTest feedback | fixed | voice-settings.tsx: test player now released (prev + unmount), was leaking; clear voice.testOk/testFail i18n keys (zh+en), success/failure colored | (user group) |
| 19 | user P3 incognito media cleanup | fixed | voice msgs: durable persist skipped in incognito (temp URI, chat.tsx); podcasts -> cache dir via ephemeral flag (podcast.ts/tools.ts/local-agent.ts); TTS hash-cache documented as shared (manuals/incognito.ts) | (user group) |
| 20 | user P3 avatar-state making_something/milestone | fixed | mp4s ship (assets/avatar-anim/); wired honestly: agent tracks activeToolName (local-agent.ts tool loop) -> making_something during generate_image/generate_podcast; task card fresh-done -> 8s milestone_level_up (chat.tsx + MILESTONE_CELEBRATION_MS); 3 new tests | (user group) |
| 21 | user P3 voice message durable URI | already-fixed | P2-5 persistVoiceMessage copies to dudu-voice-messages/ before send (chat.tsx:622); playback uses durable URI | - |
| 22 | reviewer theme tests createStore sig | fixed | 4 call sites -> { dataDir } form; theme-store 9/9, theme-ai-tools 6/6 pass | (tests group) |
| 23 | reviewer conversation-jev RUN_ERROR | fixed (test was wrong) | rename c77f0ae changed prefix to [Dudu choice]; test used stale [OpenMuse choice] so input fell through to normal path. Now uses jevActionPrefix constant; 20/20 pass | (tests group) |
| 24 | reviewer jev.test.ts:43 exception | fixed (test was wrong) | same rename root cause; parseJevAction returned null instead of throwing. Now uses jevActionPrefix constant; 16/16 pass | (tests group) |

## Verification log
- tsc: TODO
- biome on touched files: TODO
- full mobile test suite: TODO (n tests)
- zero emoji grep: TODO
- i18n parity: TODO
