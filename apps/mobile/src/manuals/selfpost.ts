/** Manual: AI self-post trigger (AI 自发帖触发器). PURE — no RN imports. */
export const SELFPOST_MANUAL = {
  id: "selfpost",
  title: "AI self-post trigger （自发帖触发器）",
  file: "src/manuals/selfpost.ts",
  when: "she asks about the AI posting to the feed by itself, '你会自己发动态吗', or wants to configure/see the self-post trigger",
  body: `# AI self-post trigger （自发帖触发器）

At a few quiet moments each day (default 3, on HER clock — never while she
sleeps 06:00–16:00 Asia/Shanghai), the app asks the model ONCE: "do you have
something you genuinely want to post to the Our Space feed right now?" The
model decides — post or SKIP. Skip is silent; a skip is logged, never nagged.

This is the one lane no romance app has shipped (19-app gap research,
2026-10-06): nobody does real AI self-posting. 嘟嘟's version is deliberately
quiet — no notification ping, she finds the post when she opens Our Space.

How a slot runs (fail-closed, in order):
1. Deterministic gate first (no model call on veto): trigger enabled →
   not incognito → not her sleep hours → slot not already fired → within
   the 15-min grace → self-post daily cap (default 1) → shared proactive
   cap (initiative+outreach, default 3) → no proactive send in the last
   60 min → active persona exists → API group configured.
2. ONE model call with context (her moment, recent memories, today's
   events, today's feed, recent skips). Post text or exactly SKIP.
3. Post goes through the same feed_post pipeline (author "ai" — clearly
   the AI's own post). Slot consumed, send recorded, decision logged,
   trace appended.

Her hard constraints (never soften):
- Conservative by design: default 1 post/day, 3 quiet slots. She can turn
  it off entirely, change slots (1-5) and cap (0-3) — only when SHE asks.
- Interrupted slots are never retried; expired slots are consumed silently.
- Never in incognito. selfpost_config and selfpost_post_now are in
  INCOGNITO_BLOCKED_TOOLS.
- The AI NEVER enables it, raises the cap, or adds slots unprompted.

Tools (manualId "selfpost"):
- selfpost_config — read/change config (write; incognito-blocked)
- selfpost_status — today's slots + posts vs cap (read-only)
- selfpost_log — "AI 今天想发没发" decision log (read-only)
- selfpost_post_now — ask the model right now (write; incognito-blocked)

GitHub patterns borrowed: purriatecat/ai-chatbot (quiet-scan + separate
decision call + max-streak cap + world-state veto), Bubblegunn/proactive-gate
(ordered gate, every rejection logged with its reason), eamars/kazusaaichatbot
(deterministic policy before the model call, idempotent slot ledger),
pibot heartbeat (unanswered backoff → the 60-min collision rule).`,
};
