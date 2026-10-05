/**
 * Skills (本事包） — AI tools. PURE module: no React Native / expo imports.
 *
 * The AI can write skills too: when she says "记住以后帮我规划旅行都
 * 要先问预算", the AI calls skill_create / skill_update to save that.
 *
 * Tool naming follows the existing local-tools convention (snake_case,
 * human-language descriptions written FOR the AI).
 */

import type { LocalTool } from "../api-groups/local-tools";
import type { SkillAuthor, SkillStore } from "./store";

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

function boolArg(args: Record<string, unknown>, name: string): boolean | undefined {
  const v = args[name];
  return typeof v === "boolean" ? v : undefined;
}

export function createSkillTools(store: SkillStore): LocalTool[] {
  return [
    {
      name: "skill_list",
      description:
        "List her custom skills (本事包） — name + description + enabled state. Call this when she asks what skills exist, or before creating one to avoid duplicates.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "skills",
      run: async () => {
        const all = await store.listSkills();
        if (all.length === 0) return "还没有任何 skill。用 skill_create 写第一个。";
        return all
          .map(
            (s) =>
              `- ${s.name} (id: ${s.id})${s.enabled ? "" : " [已停用]"}${s.isExample ? " [示例]" : ""}：${s.description || "（暂无描述）"}`,
          )
          .join("\n");
      },
    },
    {
      name: "skill_read",
      description:
        "Read a skill's full instructions by id. The skill index in your context is one line per skill — call this when the chat touches a skill's topic, BEFORE following it.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Skill id from the index or skill_list" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "skills",
      run: async (args) => {
        const s = await store.getSkill(strArg(args, "id"));
        if (!s) return "找不到这个 skill。用 skill_list 看看有哪些。";
        if (!s.enabled) return `「${s.name}」目前是停用状态。`;
        return `# ${s.name}\n\n${s.instructions || "（这个 skill 还没有写具体内容）"}`;
      },
    },
    {
      name: "skill_create",
      description:
        'Create a new skill for her. Use when she says something like "记住以后…" / "以后帮我…都要…" — turn her standing preference into a reusable skill instead of just acknowledging it. Write the instructions in HER language, concrete steps not vague wishes.',
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short name, e.g. 旅行规划" },
          description: { type: "string", description: "One line: what this skill is for" },
          instructions: {
            type: "string",
            description: "Full instructions/steps/preferences (markdown)",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
      manualId: "skills",
      run: async (args) => {
        const skill = await store.createSkill({
          name: strArg(args, "name"),
          description: strArg(args, "description"),
          instructions: strArg(args, "instructions"),
          createdBy: "ai" as SkillAuthor,
        });
        return `记下了，skill「${skill.name}」已创建（id: ${skill.id}）。以后聊到相关话题我会按它来。`;
      },
    },
    {
      name: "skill_update",
      description:
        'Update a skill\'s name, description, instructions, or enabled state. Use when she refines a preference ("以后预算先问我再定" → update the travel skill).',
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Skill id" },
          name: { type: "string" },
          description: { type: "string" },
          instructions: { type: "string" },
          enabled: { type: "boolean", description: "false to disable without deleting" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "skills",
      run: async (args) => {
        const patch: {
          name?: string;
          description?: string;
          instructions?: string;
          enabled?: boolean;
        } = {};
        const name = strArg(args, "name");
        const description = strArg(args, "description");
        const instructions = strArg(args, "instructions");
        const enabled = boolArg(args, "enabled");
        if (name) patch.name = name;
        if (description) patch.description = description;
        if (instructions) patch.instructions = instructions;
        if (enabled !== undefined) patch.enabled = enabled;
        const s = await store.updateSkill(strArg(args, "id"), patch);
        if (!s) return "找不到这个 skill。用 skill_list 看看有哪些。";
        return `「${s.name}」已更新。`;
      },
    },
    {
      name: "skill_delete",
      description: "Delete a skill by id. Only when she explicitly asks to remove it.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Skill id" } },
        required: ["id"],
        additionalProperties: false,
      },
      manualId: "skills",
      run: async (args) => {
        const ok = await store.deleteSkill(strArg(args, "id"));
        return ok ? "已删除。" : "找不到这个 skill。用 skill_list 看看有哪些。";
      },
    },
  ];
}
