/**
 * AI tools for persona group chat (人设群聊) management.
 *
 * The main AI manages groups (create/list/add/remove/set-model/archive);
 * the actual chatting happens in the group chat UI, where SHE talks and the
 * engine drives persona turns. Every management action is traced (留痕) —
 * there is no silent group.
 *
 * Hard constraints:
 * - A group needs 2+ personas (a group of one is a private chat).
 * - Incognito sessions can't create groups (they promised no side effects;
 *   group chats spend her API budget).
 * - Members are personas — resolved by id or exact name, never guessed.
 */

import { type LocalTool, ToolError } from "../api-groups/local-tools";
import type { ApiGroup } from "../api-groups/types";
import type { PersonaApiGroupPrefStore } from "../persona/api-group-pref";
import { describePersonaGroup, MAX_GROUP_MEMBERS, type PersonaCardLike } from "./persona-group";
import type { GroupTracePort } from "./persona-group-engine";
import type { PersonaGroupStore } from "./persona-group-store";

export interface PersonaGroupToolDeps {
  /** The dialog the AI is talking in when it manages groups. */
  threadId: string;
  getPersonaId: () => Promise<string>;
  groups: PersonaGroupStore;
  listPersonas: () => Promise<PersonaCardLike[]>;
  /** Her configured API groups (for per-persona model assignment). */
  listApiGroups: () => ApiGroup[];
  apiGroupPref: PersonaApiGroupPrefStore;
  trace: GroupTracePort;
  isIncognito?: () => boolean;
}

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

async function resolvePersonas(
  deps: PersonaGroupToolDeps,
  refs: unknown,
): Promise<PersonaCardLike[]> {
  if (!Array.isArray(refs) || refs.length === 0) {
    throw new ToolError("至少要指定 2 位人设。用名字或 id。");
  }
  const all = await deps.listPersonas();
  const out: PersonaCardLike[] = [];
  for (const r of refs) {
    const needle = typeof r === "string" ? r.trim() : "";
    if (!needle) throw new ToolError("人设的名字或 id 不能为空。");
    const lower = needle.toLowerCase();
    const byId = all.find((p) => p.id === needle);
    const exact = all.filter((p) => p.name.toLowerCase() === lower);
    const hit = byId ?? (exact.length === 1 ? exact[0] : undefined);
    if (!hit) {
      const names = all.map((p) => `「${p.name}」`).join("、") || "（还没有人设）";
      throw new ToolError(`找不到人设「${needle}」。她的人设有：${names}。`);
    }
    if (!out.some((p) => p.id === hit.id)) out.push(hit);
  }
  return out;
}

function resolveApiGroup(groups: ApiGroup[], ref: string): ApiGroup {
  const needle = ref.trim();
  if (!needle) throw new ToolError("api_group 不能为空。");
  const lower = needle.toLowerCase();
  const byId = groups.find((g) => g.id === needle);
  if (byId) return byId;
  const exact = groups.filter((g) => g.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const available = groups.map((g) => `「${g.name}」(${g.model})`).join("、");
  throw new ToolError(
    `找不到模型「${needle}」。她配好的模型有：${available || "（还没有配置任何模型）"}。`,
  );
}

async function needGroup(deps: PersonaGroupToolDeps, groupId: string) {
  const group = await deps.groups.get(groupId);
  if (!group) throw new ToolError(`找不到群聊「${groupId}」。用 persona_group_list 看看。`);
  if (group.archived) throw new ToolError(`群聊「${group.name}」已归档，先恢复再操作。`);
  return group;
}

export function createPersonaGroupTools(deps: PersonaGroupToolDeps): LocalTool[] {
  const forbidIncognito = () => {
    if (deps.isIncognito?.()) {
      throw new ToolError("这次会话说了不留痕、不花钱，建群聊先等下一次。");
    }
  };

  const trace = async (
    action:
      | "persona_group_create"
      | "persona_group_add_member"
      | "persona_group_remove_member"
      | "persona_group_set_model"
      | "persona_group_archive",
    groupName: string,
    groupId: string,
    summary: string,
    reason: string,
  ) => {
    const personaId = await deps.getPersonaId().catch(() => "");
    await deps.trace
      .append({
        action,
        fromThreadId: deps.threadId,
        fromName: groupName,
        toThreadId: groupId,
        toName: groupName,
        summary,
        reason,
        personaId,
      })
      .catch(() => {});
  };

  return [
    {
      name: "persona_group_create",
      description:
        "建一个人设群聊：她和几位人设在同一个群里聊天（SillyTavern 式群聊）。2-6 位人设。用她明确说过的人设。用 list_personas 先看清名字。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "群名，比如「周末计划群」" },
          personas: {
            type: "array",
            items: { type: "string" },
            description: "成员人设的名字或 id，2-6 位",
          },
        },
        required: ["name", "personas"],
        additionalProperties: false,
      },
      manualId: "persona-group",
      run: async (args) => {
        forbidIncognito();
        const name = strArg(args, "name").trim();
        if (!name) throw new ToolError("群名不能为空。");
        const personas = await resolvePersonas(deps, args.personas);
        if (personas.length < 2) throw new ToolError("群聊至少要 2 位人设。");
        if (personas.length > MAX_GROUP_MEMBERS)
          throw new ToolError(`群聊最多 ${MAX_GROUP_MEMBERS} 位人设。`);
        const group = await deps.groups.create(
          name,
          personas.map((p) => p.id),
        );
        await trace(
          "persona_group_create",
          group.name,
          group.id,
          `建群「${group.name}」：${personas.map((p) => p.name).join("、")}`,
          "her request",
        );
        return (
          `建好了群聊「${group.name}」（id ${group.id}），成员：${personas.map((p) => `「${p.name}」`).join("、")}。` +
          `让她去群聊里说话，@谁谁就回。`
        );
      },
    },
    {
      name: "persona_group_list",
      description: "列出她的人设群聊（名字、成员、消息数）。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      manualId: "persona-group",
      run: async () => {
        const groups = await deps.groups.list();
        if (groups.length === 0) return "她还没有人设群聊。用 persona_group_create 建一个。";
        const personas = await deps.listPersonas();
        const nameOf = (id: string) => personas.find((p) => p.id === id)?.name ?? id;
        return groups
          .map(
            (g) =>
              `${describePersonaGroup(
                g,
                g.members.map((m) => nameOf(m.personaId)),
              )}（id ${g.id}）`,
          )
          .join("\n");
      },
    },
    {
      name: "persona_group_add_member",
      description: "往群聊里加一位人设（用名字或 id 指定）。",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "string", description: "群聊 id（persona_group_list 看）" },
          persona: { type: "string", description: "人设的名字或 id" },
        },
        required: ["group_id", "persona"],
        additionalProperties: false,
      },
      manualId: "persona-group",
      run: async (args) => {
        forbidIncognito();
        const group = await needGroup(deps, strArg(args, "group_id"));
        const [persona] = await resolvePersonas(deps, [strArg(args, "persona")]);
        if (group.members.length >= MAX_GROUP_MEMBERS)
          throw new ToolError(`群聊最多 ${MAX_GROUP_MEMBERS} 位人设，已经满了。`);
        const updated = await deps.groups.addMember(group.id, persona.id);
        if (!updated) throw new ToolError("加人失败，群聊可能已归档。");
        await trace(
          "persona_group_add_member",
          group.name,
          group.id,
          `「${persona.name}」加入群聊「${group.name}」`,
          "her request",
        );
        return `「${persona.name}」加入了群聊「${group.name}」。`;
      },
    },
    {
      name: "persona_group_remove_member",
      description: "把一位人设请出群聊（聊天记录保留）。",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "string", description: "群聊 id" },
          persona: { type: "string", description: "人设的名字或 id" },
        },
        required: ["group_id", "persona"],
        additionalProperties: false,
      },
      manualId: "persona-group",
      run: async (args) => {
        forbidIncognito();
        const group = await needGroup(deps, strArg(args, "group_id"));
        const [persona] = await resolvePersonas(deps, [strArg(args, "persona")]);
        const updated = await deps.groups.removeMember(group.id, persona.id);
        if (!updated) throw new ToolError("请人失败，群聊可能已归档。");
        if (updated.members.length < 2)
          throw new ToolError("群聊至少要留 2 位人设，人不够了就归档吧。");
        await trace(
          "persona_group_remove_member",
          group.name,
          group.id,
          `「${persona.name}」离开群聊「${group.name}」`,
          "her request",
        );
        return `「${persona.name}」离开了群聊「${group.name}」，记录都留着。`;
      },
    },
    {
      name: "persona_group_set_model",
      description:
        "给一位人设单独指定模型/API 分组（每人设独立配置）。不指定就用全局默认。传空字符串恢复默认。",
      parameters: {
        type: "object",
        properties: {
          persona: { type: "string", description: "人设的名字或 id" },
          api_group: {
            type: "string",
            description: "API 分组的 id 或名字；空字符串 = 恢复全局默认",
          },
        },
        required: ["persona", "api_group"],
        additionalProperties: false,
      },
      manualId: "persona-group",
      run: async (args) => {
        forbidIncognito();
        const [persona] = await resolvePersonas(deps, [strArg(args, "persona")]);
        const ref = strArg(args, "api_group").trim();
        if (!ref) {
          await deps.apiGroupPref.set(persona.id, null);
          await trace(
            "persona_group_set_model",
            persona.name,
            persona.id,
            `「${persona.name}」恢复全局默认模型`,
            "her request",
          );
          return `「${persona.name}」恢复用全局默认模型。`;
        }
        const group = resolveApiGroup(deps.listApiGroups(), ref);
        await deps.apiGroupPref.set(persona.id, group.id);
        await trace(
          "persona_group_set_model",
          persona.name,
          group.id,
          `「${persona.name}」改用「${group.name}」`,
          "her request",
        );
        return `「${persona.name}」以后用「${group.name}」（${group.model}）。`;
      },
    },
    {
      name: "persona_group_archive",
      description: "归档一个群聊（记录保留，不再出现在列表；以后可恢复）。",
      parameters: {
        type: "object",
        properties: {
          group_id: { type: "string", description: "群聊 id" },
          archived: {
            type: "boolean",
            description: "true=归档，false=恢复。默认 true。",
          },
        },
        required: ["group_id"],
        additionalProperties: false,
      },
      manualId: "persona-group",
      run: async (args) => {
        forbidIncognito();
        const groupId = strArg(args, "group_id");
        const archived = args.archived === undefined ? true : args.archived === true;
        const group = await deps.groups.get(groupId);
        if (!group) throw new ToolError(`找不到群聊「${groupId}」。`);
        await deps.groups.setArchived(groupId, archived);
        await trace(
          "persona_group_archive",
          group.name,
          groupId,
          archived ? `群聊「${group.name}」已归档` : `群聊「${group.name}」已恢复`,
          "her request",
        );
        return archived
          ? `群聊「${group.name}」已归档，记录都留着。`
          : `群聊「${group.name}」恢复了。`;
      },
    },
  ];
}
