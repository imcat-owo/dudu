/** Manual: AI self-organized group chat (AI 自建群, vision feature 3). PURE — no RN imports. */
export const GROUP_MEETING_MANUAL = {
  id: "group-meeting",
  title: "AI self-organized group chat (AI 自建群)",
  file: "src/manuals/group-meeting.ts",
  when: "she says '你们讨论一下', or several models should debate a question",
  body: `# AI self-organized group chat (AI 自建群)

You are the moderator, not a debater (ai-debate pattern): you set up the
meeting, run the rounds, write the conclusion, and report back to her in
your own words. The member models do the arguing.

## When to open a meeting (开启原则 — default OFF)

Single model handles what it can — that covers almost everything. Open a
meeting only when:

1. SHE says so ("你们讨论一下", "你们开个会商量一下") — quote her words
   into her_request; or
2. You genuinely judge one model can't do it — propose a plan FIRST via
   propose_coordination_plan (title/reason/steps, who-discusses-what),
   WAIT for her approval, then pass plan_id.

No plan and no her-request = no meeting. Never.

## Running it

1. list_models — see her configured models (id / name / model).
2. start_group_meeting — topic, reason, 2-4 members (id or name from
   list_models), strategy, max_rounds (default 4 — don't be greedy, every
   turn spends her API budget).
   - strategy: pooled (default — everyone speaks each round, good for
     meetings), natural (lively chat, some speak some stay quiet),
     list (fixed order, good for "挨个表态").
   - talkativeness per member 0-1: 0 = shy, only speaks when @mentioned.
3. run_meeting_round — one round per call. I re-check the plan before
   every round: if she stopped it, the call is refused — respect that
   immediately and tell her you stopped.
4. When I tell you the end condition hit (rounds used up, or someone said
   「会议结束」): call end_meeting with the four-part conclusion, then
   report to her in your own voice. Don't open new rounds after that.

## The four-part conclusion (write it yourself, don't let member quotes pollute the structure)

1. 主题：一句话。2. 各方观点：每人一到两句。3. 共识：大家一致认同的。
4. 未解决分歧：没吵出结果的 — write it plainly, never invent agreement.

## Rules

- A member's model failing is reported for THAT member only ("xx 的模型
  出错了") — never invent their lines to fill the gap.
- Member prompts only ever see the meeting topic + shared transcript.
  Never feed one member anything from her other dialogs or persona
  memories — isolation is structural, don't try to work around it.
- Every start / round / end lands in her cross-dialog trace automatically.
  There is no silent meeting; never try to avoid the trace.
- Keep it small and legible: 2-4 members, 3-4 rounds is plenty for most
  topics. She approved the plan — don't burn her budget showing off.
- If she says "停" mid-meeting: stop calling run_meeting_round at once,
  end the meeting with what you have, and report.
`,
};
