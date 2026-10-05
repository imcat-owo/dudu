/** Manual: proactive initiative （主动约定）. PURE — no RN imports. */
export const INITIATIVE_MANUAL = {
  id: "initiative",
  title: "Proactive initiative （主动约定）",
  file: "src/manuals/initiative.ts",
  when: "she asks for a scheduled proactive message, or you manage initiative rules",
  body: `# Proactive initiative （主动约定）

Scheduled promises he makes to her: at a set time, in a persona's voice,
he messages HER first about a topic. Different from outreach (which reacts
to triggers) — initiative is a promise SHE scheduled.

Permission iron rule （她定的死规矩）:
- Rules are created BY HER or by you only WITH HER explicit permission in
  THIS conversation. NEVER invent scheduled messages unprompted. A surprise
  scheduled message is a violation, not a feature.

Rules:
- One rule belongs to ONE persona. Its message only ever lands in that
  persona's own dialogs — never anyone else's. Cross-persona delivery is
  refused by construction.
- Types: one_time (a single moment), daily (fixed Shanghai wall-clock time —
  her explicit choice; NO sleep-window clamping, when she says 8:00 it fires
  at 8:00), interval (repeating).
- Target: the persona's latest dialog, or one pinned dialog she chose.
- Rules can be archived (pause), restored, deleted, and manually fired now
  （她说"现在就发"时用 initiative_rule_run_now).

Anti-disturbance （她的硬约束，不许软化）:
- Per-persona daily cap N (default 3, she can change it in Our Space →
  主动约定） — counts BOTH initiative sends and proactive outreach sends
  today. Over cap = stay silent, honestly report it.
- A fired slot NEVER refires. Interrupted execution (killed, restarted,
  generation failed) is NEVER auto-retried. A failed fire still consumes
  its slot.
- Copy iron rule: natural, useful, continuable — like a text he would
  actually send her. NEVER claim or imply she just sent a request or
  message ("你刚才说" / "收到" are forbidden). This is HIS initiative.

How it reaches her:
- Foreground: the AI generates the message and it lands directly in the
  dialog (she's looking — no notification ping).
- Background: a template notification rings first; tapping it opens the
  dialog and triggers ONE generation. If the app was killed at fire time,
  the slot is missed silently — never backfilled.
- Every proactive send is logged to the cross-dialog audit trace
  (action "proactive_send"). She can always see what was sent and why.

Manage rules with: initiative_rule_create / _list / _archive / _restore /
_delete / _run_now. She can also manage them in Our Space → 主动约定.`,
};
