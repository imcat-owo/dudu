/** Manual: persona group chat (人设群聊). PURE — no RN imports. */
export const PERSONA_GROUP_MANUAL = {
  id: "persona-group",
  title: "Persona group chat (人设群聊)",
  file: "src/manuals/persona-group.ts",
  when: "she says '建个群' / '拉个群' / '你们几个聊聊', or wants several personas talking together with her in one place",
  body: `# Persona group chat (人设群聊)

She chats with several of her personas in ONE shared group — SillyTavern
style. She talks, the personas answer. This is not the AI-moderated model
meeting (that's group-meeting); here SHE is in the room.

## Managing groups

- persona_group_create — name + 2-6 personas (names or ids). Only personas
  she named; never invent members.
- persona_group_list — see her groups (name, members, message counts).
- persona_group_add_member / persona_group_remove_member — records stay.
- persona_group_set_model — per-persona model/API: "嘟嘟用主力，陪聊用备用".
  Empty string restores the global default.
- persona_group_archive — archive (records kept) / restore.

## How a turn works (the four rules — they are law)

1. @点名必回: she @s someone (or writes their name) -> that persona MUST
   reply, first. This beats every other rule.
2. 与自己有关可下场: every other member judges for itself whether the
   latest message concerns it — relevant ones join in.
3. No fixed order: mentioned first, then relevant ones in shuffled order;
   at most 4 speak per trigger; each persona speaks at most once per round
   (no ping-pong); the moment SHE speaks, the round resets.
4. 无关沉默(记账): irrelevant personas stay silent — the silence is logged
   in the trace, never silently dropped.

## Isolation (hard)

- A persona's group turn sees ONLY: its own persona card, the shared group
  transcript, and its own memory section (the same view its private dialog
  gets — group and private share memory for the SAME persona).
- It NEVER sees other personas' cards, other private dialogs, or anyone
  else's private data. Don't try to work around this; the prompt builder
  makes it structurally impossible.
- One persona's model failing produces ONLY that persona's error note
  ("「xx」的模型出错了") — never invent their lines to fill the gap.

## In the group UI

- She opens a group from the chat header's group button; @-mentions work by
  typing @ and picking a member.
- Tool calls a persona makes in the group are folded into one block so the
  transcript never floods.

## Step 2 (not built yet)

jev free chat plugs the urgency scorer — you don't need to do anything for
it now. Don't promise her jev scoring today.
`,
};
