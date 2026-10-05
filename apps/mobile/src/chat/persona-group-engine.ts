/**
 * Persona group chat — turn engine. Not PURE (drives model calls), but all
 * side effects are injected through deps so tests run it with fakes.
 *
 * One turn (her message in):
 *   1. Her message is appended; the round resets (she speaks -> queue zero,
 *      rule ③).
 *   2. @-mentions are parsed (rule ① — must reply, first).
 *   3. Every other member self-judges relevance (rule ②/④, no jev).
 *   4. planSpeakers orders them: mentioned first, relevant in urgency
 *      order with shuffled ties, queue-capped, once-per-round (rule ③).
 *   5. Each speaker generates with ITS OWN api group (per-persona
 *      model/API — one persona's failure only ever yields that persona's
 *      own error note, never invented lines).
 *   6. One bounded reaction wave: members who haven't spoken this round may
 *      react once to what was just said (no ping-pong, rule ③).
 *   7. Silent members are logged to the trace (记账, rule ④).
 *
 * Prompt assembly goes through buildGroupTurnPrompt() — the ONLY inputs
 * are the speaker's own card, the shared transcript, and that persona's
 * memory section (same view as its private dialog: group<->private share
 * memory; other personas' private data is structurally unreachable).
 */

import type { ApiGroup } from "../api-groups/types";
import { buildMemorySection as buildMemorySectionDefault } from "../memory/read-path";
import type { MemoryStore } from "../memory/store";
import type { NewTraceEntry } from "./cross-dialog-trace";

/** Minimal trace port — the real CrossDialogTraceStore satisfies this. */
export interface GroupTracePort {
  append(entry: NewTraceEntry): Promise<unknown>;
}

import {
  buildGroupTurnPrompt,
  buildRelevanceJudgePrompt,
  defaultUrgencyScorer,
  type GroupToolUse,
  isSilenceReply,
  type PersonaCardLike,
  type PersonaGroup,
  parseMentions,
  planSpeakers,
  type UrgencyScorer,
} from "./persona-group";
import type { PersonaGroupStore } from "./persona-group-store";

/** A tool a group persona may call — the shared pool (memory/knowledge/web). */
export interface GroupTurnTool {
  name: string;
  description: string;
  parameters: unknown;
  run: (args: Record<string, unknown>) => Promise<string>;
}

export interface GroupTurnResult {
  text: string;
  tools: GroupToolUse[];
}

export interface PersonaGroupEngineDeps {
  groups: PersonaGroupStore;
  getPersona: (id: string) => Promise<PersonaCardLike | null>;
  /** Resolve one persona's api group: its own preference, else the active group. */
  resolveApiGroup: (personaId: string) => Promise<ApiGroup | null>;
  /** That persona's memory section — the SAME view its private dialog gets. */
  buildMemorySection: (userText: string) => Promise<string>;
  /**
   * One persona turn. Throws on failure — the engine converts it into that
   * persona's isolated error note (never invented lines, never silent).
   */
  generate: (
    group: ApiGroup,
    system: string,
    user: string,
    tools: GroupTurnTool[],
  ) => Promise<GroupTurnResult>;
  /** Relevance self-judgment (rule ②/④). Default impl: one-shot yes/no call. */
  judge: (persona: PersonaCardLike, system: string, user: string) => Promise<boolean>;
  /** Shared tool pool for group turns. */
  listTools: () => GroupTurnTool[];
  trace: GroupTracePort;
  herName?: string;
  random?: () => number;
  /** Step-2 jev scorer plugs here; step 1 uses the default. */
  scorer?: UrgencyScorer;
}

export interface GroupTurnReport {
  groupId: string;
  /** personaIds that spoke (in order). */
  speakers: string[];
  /** personaIds that stayed silent (logged to trace — 记账). */
  silent: string[];
  /** personaIds whose model failed (isolated error notes were posted). */
  failed: string[];
}

function shortError(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.slice(0, 160);
}

/** cards is keyed by liveIds — a miss here is a bug, fail loudly. */
function mustCard(cards: Map<string, PersonaCardLike>, id: string): PersonaCardLike {
  const c = cards.get(id);
  if (!c) throw new Error(`persona ${id} vanished mid-turn`);
  return c;
}

export async function handleGroupUserMessage(
  deps: PersonaGroupEngineDeps,
  groupId: string,
  text: string,
): Promise<GroupTurnReport> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty message");
  let group = await deps.groups.get(groupId);
  if (!group) throw new Error("group not found");
  if (group.archived) throw new Error("group is archived");

  // Her message opens a new round: append + reset the speaker ledger.
  await deps.groups.appendMessage(groupId, { kind: "user" }, trimmed);
  await deps.groups.resetRound(groupId);
  const refreshed = await deps.groups.get(groupId);
  if (!refreshed) throw new Error("group not found");
  group = refreshed;

  const members = group.members;
  const cards = new Map<string, PersonaCardLike>();
  for (const m of members) {
    const card = await deps.getPersona(m.personaId).catch(() => null);
    if (card) cards.set(m.personaId, card);
  }
  const liveIds = members.map((m) => m.personaId).filter((id) => cards.has(id));
  const named = liveIds.map((id) => ({ personaId: id, name: mustCard(cards, id).name }));

  // Rule ①: @-mentions must reply.
  const mentionedIds = parseMentions(trimmed, named);

  // Rules ②/④: everyone else self-judges relevance (no jev).
  const judgeTargets = liveIds.filter((id) => !mentionedIds.includes(id));
  const relevantIds: string[] = [];
  const wave1Group: PersonaGroup = group;
  await Promise.all(
    judgeTargets.map(async (id) => {
      const persona = mustCard(cards, id);
      const mem = await deps.buildMemorySection(trimmed).catch(() => "");
      const { system, user } = buildRelevanceJudgePrompt({
        persona,
        group: wave1Group,
        memorySection: mem,
        herName: deps.herName,
      });
      try {
        if (await deps.judge(persona, system, user)) relevantIds.push(id);
      } catch {
        // A failed judgment = silent (fail-closed, never force a speech).
      }
    }),
  );

  const plan = planSpeakers(liveIds, {
    mentionedIds,
    relevantIds,
    spokeThisRound: [],
    triggerText: trimmed,
    random: deps.random,
    scorer: deps.scorer ?? defaultUrgencyScorer,
  });

  const report: GroupTurnReport = { groupId, speakers: [], silent: [...plan.silent], failed: [] };

  // Wave 1: replies to her.
  for (const pid of plan.speakers) {
    const ok = await speakOnce(deps, groupId, pid, mustCard(cards, pid), trimmed, report);
    if (ok) report.speakers.push(pid);
  }

  // Wave 2 (bounded): one reaction each for members who haven't spoken.
  const regrouped = await deps.groups.get(groupId);
  if (!regrouped) throw new Error("group not found");
  group = regrouped;
  const wave2Candidates = liveIds.filter((id) => !group.spokeThisRound.includes(id));
  if (wave2Candidates.length > 0 && group.spokeThisRound.length > 0) {
    const recentSaid = group.messages
      .slice(-6)
      .filter((m) => m.from.kind === "persona")
      .map((m) => `${(m.from as { personaName: string }).personaName}：${m.text}`)
      .join("\n");
    const triggerText = recentSaid || trimmed;
    const wave2Relevant: string[] = [];
    const wave2Group: PersonaGroup = group;
    await Promise.all(
      wave2Candidates.map(async (id) => {
        const persona = mustCard(cards, id);
        const mem = await deps.buildMemorySection(triggerText).catch(() => "");
        const { system, user } = buildRelevanceJudgePrompt({
          persona,
          group: wave2Group,
          memorySection: mem,
          herName: deps.herName,
        });
        try {
          if (await deps.judge(persona, system, user)) wave2Relevant.push(id);
        } catch {
          // Failed judgment = silent.
        }
      }),
    );
    const wave2 = planSpeakers(liveIds, {
      mentionedIds: [],
      relevantIds: wave2Relevant,
      spokeThisRound: group.spokeThisRound,
      triggerText,
      random: deps.random,
      scorer: deps.scorer ?? defaultUrgencyScorer,
    });
    for (const pid of wave2.speakers) {
      const ok = await speakOnce(deps, groupId, pid, mustCard(cards, pid), triggerText, report);
      if (ok) report.speakers.push(pid);
    }
    for (const id of wave2.silent) {
      if (!report.silent.includes(id)) report.silent.push(id);
    }
  }

  // 记账 (rule ④): silent members are logged, not dropped silently.
  try {
    await deps.trace.append({
      action: "persona_group_round",
      fromThreadId: groupId,
      fromName: group.name,
      toThreadId: groupId,
      toName: group.name,
      summary: `群聊「${group.name}」一轮：${report.speakers.length} 位发言，沉默 ${report.silent.length} 位${report.failed.length > 0 ? `，${report.failed.length} 位模型出错` : ""}`,
      reason: `her message: ${trimmed.slice(0, 80)}`,
      personaId: report.speakers[0] ?? "",
    });
  } catch {
    // Trace failure must not unsend delivered messages.
  }
  return report;
}

/**
 * One persona speaks once. Returns true when a message was posted.
 * Model failure -> that persona's own isolated error note; others continue.
 */
async function speakOnce(
  deps: PersonaGroupEngineDeps,
  groupId: string,
  personaId: string,
  persona: PersonaCardLike,
  triggerText: string,
  report: GroupTurnReport,
): Promise<boolean> {
  const group = await deps.groups.get(groupId);
  if (!group) return false;
  const apiGroup = await deps.resolveApiGroup(personaId).catch(() => null);
  if (!apiGroup) {
    await deps.groups.appendMessage(
      groupId,
      { kind: "system" },
      `「${persona.name}」没有可用的模型，说不了话。`,
    );
    report.failed.push(personaId);
    return false;
  }
  const memorySection = await deps.buildMemorySection(triggerText).catch(() => "");
  const { system, user } = buildGroupTurnPrompt({
    persona,
    group,
    memorySection,
    herName: deps.herName,
  });
  let result: GroupTurnResult;
  try {
    result = await deps.generate(apiGroup, system, user, deps.listTools());
  } catch (e) {
    // Isolated error: only THIS persona's note, never invented lines.
    await deps.groups.appendMessage(
      groupId,
      { kind: "system" },
      `「${persona.name}」的模型出错了：${shortError(e)}`,
    );
    report.failed.push(personaId);
    return false;
  }
  const text = result.text.trim();
  if (!text || isSilenceReply(text)) {
    // Chose silence after all — respect it, log it.
    if (!report.silent.includes(personaId)) report.silent.push(personaId);
    return false;
  }
  await deps.groups.appendMessage(
    groupId,
    { kind: "persona", personaId, personaName: persona.name },
    text,
    result.tools,
  );
  await deps.groups.markSpoken(groupId, [personaId]);
  return true;
}

/** Default memory-section builder wiring (same view as a private dialog). */
export function defaultMemorySectionBuilder(store: MemoryStore) {
  return (userText: string) => buildMemorySectionDefault(store, userText);
}
