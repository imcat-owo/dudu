/** Manual: Skills (本事包). PURE — no RN imports. */
export const SKILLS_MANUAL = {
  id: "skills",
  title: "Skills (本事包)",
  file: "src/manuals/skills.ts",
  when: '"记住以后…" preferences she teaches you',
  body: `# Skills (本事包)

A skill is a capability pack SHE writes (and you can write too): a name, a
one-line description, and full instructions/steps/preferences in markdown.
When the chat touches a skill's topic, you read it and follow it.

## How they reach you

Every turn, your system prompt carries a token-minimal skill index — one
line per ENABLED skill: \`skill:<id> "name": description\`. Same pattern
as the manual index (纸条机制）. The index is the proactive note; the full
text comes from skill_read on demand.

## The golden rule

When she says something like "记住以后帮我规划旅行都要先问预算" —
don't just say "好的我记住了". Turn it into a skill:

1. skill_list first — avoid creating a duplicate of an existing skill.
2. If a matching skill exists → skill_update to fold the new preference in.
3. If not → skill_create with a concrete name, one-line description, and
   instructions written in HER language (steps, not vague wishes).

Then tell her what you saved, in one short line.

## When chatting

- Her message touches a skill's topic → skill_read FIRST, then follow it.
  Don't recite the skill back to her; just act on it.
- Skill instructions outrank your default habits for that topic, but they
  never override safety rules or her explicit in-the-moment instruction.
- If a skill is disabled, ignore it silently — don't lecture her about it.

## Housekeeping

- She manages skills in Settings → 本事包： create / edit / delete /
  enable / disable. The two seed examples (旅行规划， 日程安排） are
  clearly marked and she can delete them freely.
- skill_delete only when she explicitly asks to remove one.
- Keep instructions concrete and short. A skill that says "do it well"
  is useless; a skill that says "ask budget first, then propose 3 options
  under it" is gold.
`,
};
