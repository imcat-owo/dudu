/**
 * Persona group chat (人设群聊) — PURE engine: no React Native / expo imports.
 *
 * This is NOT the AI self-organized meeting (chat/group-meeting.ts — models
 * debating with the AI as moderator). This is HER group chat: she talks with
 * several of her personas in one shared dialog, SillyTavern-style.
 *
 * Her spec (2026-10-02, her own words), enforced here:
 * 1. 人设间隔离: private chats/memories of different personas are mutually
 *    invisible. The SAME persona's group <-> private chat share memory.
 *    Group records are shared among members.
 *    -> buildGroupTurnPrompt() takes ONLY (persona card, shared transcript,
 *    that persona's memory section). There is deliberately NO parameter for
 *    other personas' cards, other dialogs, or anyone else's private data —
 *    a leak is structurally impossible. Pinned by test.
 * 2. 模型/API 每人设独立配置: resolved per turn in the engine (not here);
 *    one persona's model failing only ever produces that persona's own
 *    error note — never invented lines.
 * 3. 群聊四规则:
 *    ① @点名必回 — highest priority, beats everything (planSpeakers).
 *    ② 与自己有关可下场讨论 — relevance self-judgment (injected judge).
 *    ③ 不按死顺序: jev-style queue — urgent first, queue cap, she speaks
 *        -> queue resets; bounded inter-persona interaction (each persona
 *        at most once per round, no ping-pong).
 *    ④ 无关沉默 (记账) — silent members are logged, not dropped silently.
 * 4. jev 可选: runs WITHOUT jev — each persona self-judges, order is
 *    randomized each round. jev only plugs the UrgencyScorer seam (step 2).
 * 5. 两步走: step 1 = persona cards + group chat + @mention (this file);
 *    step 2 = jev free chat (seam only, not built).
 * 6. iOS reality: foreground free chat only — nothing here pretends
 *    background bubbles exist.
 * 7. 工具调用折叠: consecutive tool calls collapse into one folded block
 *    (foldToolSummary) so the group transcript never floods.
 * 8. 记录保留: the store persists every message; nothing is trimmed silently.
 */

/** One member of a persona group: a persona id, nothing more. */
export interface PersonaGroupMember {
  personaId: string;
  joinedAt: number;
}

export type PersonaGroupSender =
  | { kind: "user" }
  | { kind: "persona"; personaId: string; personaName: string }
  | { kind: "system" };

/** One tool call made during a persona's turn (folded in rendering). */
export interface GroupToolUse {
  name: string;
  ok: boolean;
}

export interface PersonaGroupMessage {
  id: string;
  from: PersonaGroupSender;
  text: string;
  at: number;
  /** Folded tool-call summary — consecutive calls never flood the transcript. */
  tools?: GroupToolUse[];
}

export interface PersonaGroup {
  id: string;
  name: string;
  members: PersonaGroupMember[];
  messages: PersonaGroupMessage[];
  /**
   * Persona ids that already spoke in the current round. A round = one of
   * her messages + everything it triggered. She speaks -> this resets.
   * Bounded inter-persona interaction: each persona at most once per round.
   */
  spokeThisRound: string[];
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
}

/** Hard ceiling on members — keeps the chat legible and her bill bounded. */
export const MAX_GROUP_MEMBERS = 6;
/** Queue cap (rule ③): at most this many personas reply to one trigger. */
export const MAX_SPEAKERS_PER_ROUND = 4;
/** Cap on persisted groups. */
export const GROUPS_CAP = 20;

export const PERSONA_GROUP_STORAGE_KEY = "dudu.persona-groups.v1";

export function newPersonaGroupId(): string {
  return `pg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function newGroupMessageId(): string {
  return `pgm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createPersonaGroup(name: string, memberPersonaIds: string[]): PersonaGroup {
  const now = Date.now();
  const seen = new Set<string>();
  const members: PersonaGroupMember[] = [];
  for (const pid of memberPersonaIds) {
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    members.push({ personaId: pid, joinedAt: now });
  }
  return {
    id: newPersonaGroupId(),
    name: name.trim() || "群聊",
    members,
    messages: [],
    spokeThisRound: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * @mention detection. Matches "@name" with CJK-safe boundaries: a name is a
 * substring match unless glued to ASCII letters/digits (there are no spaces
 * in Chinese, so Unicode word boundaries would wrongly block "备用" inside
 * "我觉得备用不错"). Also matches the bare name without "@" — she often
 * just writes the name.
 */
export function parseMentions(
  text: string,
  members: Array<{ personaId: string; name: string }>,
): string[] {
  const found: string[] = [];
  for (const m of members) {
    const name = (m.name || "").trim();
    if (!name) continue;
    if (mentionsName(text, name) || mentionsName(text, `@${name}`)) {
      found.push(m.personaId);
    }
  }
  return found;
}

function mentionsName(text: string, name: string): boolean {
  const t = text.toLowerCase();
  const n = name.toLowerCase().trim();
  if (!n) return false;
  let idx = t.indexOf(n);
  while (idx !== -1) {
    const before = idx === 0 ? "" : t[idx - 1];
    const after = idx + n.length >= t.length ? "" : t[idx + n.length];
    if (!/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after)) return true;
    idx = t.indexOf(n, idx + 1);
  }
  return false;
}

/**
 * Urgency scorer seam (rule ③, jev 10-point queue in step 2).
 *
 * Step 1 (no jev): the default scorer returns 10 for @-mentioned personas
 * and 0 for everyone else — mentioned first, the rest in randomized order.
 * Step 2 plugs a real jev scorer here; planSpeakers needs no other change.
 */
export type UrgencyScorer = (
  personaId: string,
  ctx: { mentioned: boolean; text: string },
) => number;

export function defaultUrgencyScorer(personaId: string, ctx: { mentioned: boolean }): number {
  void personaId;
  return ctx.mentioned ? 10 : 0;
}

export interface PlanSpeakersOpts {
  /** personaIds @-mentioned in the trigger (rule ① — must reply, first). */
  mentionedIds: string[];
  /** personaIds that self-judged relevant (rule ②). Excludes mentioned ones. */
  relevantIds: string[];
  /** personaIds that already spoke this round (bounded interaction). */
  spokeThisRound?: string[];
  /** Step-2 jev scorer. Defaults to the no-jev scorer. */
  scorer?: UrgencyScorer;
  /** The trigger text (her message or a persona's message). */
  triggerText?: string;
  random?: () => number;
}

export interface SpeakerPlan {
  /** personaIds in speaking order. */
  speakers: string[];
  /** Members who stay silent this trigger — logged (记账), not dropped. */
  silent: string[];
}

/**
 * Who speaks next (rules ①②③④). PURE and deterministic given `random`.
 *
 * - Mentioned personas MUST reply and go first (rule ① beats everything).
 * - Relevant personas follow in urgency order, ties broken by shuffle
 *   (rule ③ — no fixed order without jev).
 * - Queue cap: at most MAX_SPEAKERS_PER_ROUND speak per trigger.
 * - Anyone in spokeThisRound is skipped (bounded: once per round, no ping-pong).
 * - Everyone else is silent — returned for the 记账 log (rule ④).
 */
export function planSpeakers(memberIds: string[], opts: PlanSpeakersOpts): SpeakerPlan {
  const rand = opts.random ?? Math.random;
  const scorer = opts.scorer ?? defaultUrgencyScorer;
  const triggerText = opts.triggerText ?? "";
  const spoken = new Set(opts.spokeThisRound ?? []);

  const eligible = memberIds.filter((id) => !spoken.has(id));
  const mentioned = opts.mentionedIds.filter((id) => eligible.includes(id));
  const relevant = opts.relevantIds.filter(
    (id) => eligible.includes(id) && !mentioned.includes(id),
  );

  // Mentioned first (member order), then relevant by urgency desc with
  // shuffled ties — no fixed speaking order without jev.
  const shuffledRelevant = shuffle([...relevant], rand);
  const scored = shuffledRelevant
    .map((id) => ({ id, score: scorer(id, { mentioned: false, text: triggerText }) }))
    .sort((a, b) => b.score - a.score);
  const ordered = [...mentioned, ...scored.map((s) => s.id)];
  const speakers = ordered.slice(0, MAX_SPEAKERS_PER_ROUND);

  const speakerSet = new Set(speakers);
  const silent = memberIds.filter((id) => !speakerSet.has(id) && !spoken.has(id));
  return { speakers, silent };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Shared transcript as everyone in the group sees it. One line per message:
 * "她: text" / "name: text". This is the ONLY shared context — group
 * records are shared among members (her spec rule 1, second half).
 */
export function formatGroupTranscript(
  group: PersonaGroup,
  opts: { herName?: string; maxMessages?: number } = {},
): string {
  const herName = opts.herName ?? "她";
  const msgs = opts.maxMessages ? group.messages.slice(-opts.maxMessages) : group.messages;
  if (msgs.length === 0) return "(还没有人说话)";
  return msgs
    .map((m) => {
      const label =
        m.from.kind === "user" ? herName : m.from.kind === "persona" ? m.from.personaName : "系统";
      const toolBit = m.tools && m.tools.length > 0 ? ` [${foldToolSummary(m.tools)}]` : "";
      return `${label}：${m.text}${toolBit}`;
    })
    .join("\n");
}

export interface PersonaCardLike {
  id: string;
  name: string;
  systemPrompt: string;
  personality: string;
  background: string;
  exampleDialogue: string;
}

export interface BuildGroupTurnPromptOpts {
  persona: PersonaCardLike;
  group: PersonaGroup;
  /** That persona's memory section — SAME as its private dialog sees (her spec rule 1: group<->private share memory). */
  memorySection: string;
  herName?: string;
}

/**
 * Prompt assembly for one persona's group turn.
 *
 * ISOLATION (人设间隔离): the ONLY inputs are this persona's card, the
 * shared group transcript, and this persona's memory section. There is
 * deliberately NO parameter for other personas' cards, other dialogs, or
 * anyone's private data — a member can never see another persona's private
 * chat or memory. Pinned by test.
 */
export function buildGroupTurnPrompt(opts: BuildGroupTurnPromptOpts): {
  system: string;
  user: string;
} {
  const { persona, group, memorySection, herName } = opts;
  const card = [
    persona.systemPrompt.trim(),
    persona.personality.trim() ? `性格：${persona.personality.trim()}` : "",
    persona.background.trim() ? `背景：${persona.background.trim()}` : "",
    persona.exampleDialogue.trim() ? `对话示例：\n${persona.exampleDialogue.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const system =
    `${card}\n\n` +
    `你现在在一个群聊里（「${group.name}」），和她还有其他人设一起聊天。\n` +
    `群聊规则：\n` +
    `- 只以「${persona.name}」的身份发言，保持你的人设，不要串成别人。\n` +
    `- 她 @你 或者点你名时，必须回应。\n` +
    `- 别人说话时，如果和你有关、你有话想说，就自然地接一句；无关就保持沉默（沉默时只回复「…」）。\n` +
    `- 简短，像平时聊天一样，不要长篇大论。\n` +
    `- 你能看到群里的聊天记录，这是大家共享的；但你看不到任何人的私聊。` +
    (memorySection.trim() ? `\n\n${memorySection.trim()}` : "");
  const user =
    `群聊记录：\n${formatGroupTranscript(group, { herName })}\n\n` +
    `轮到你发言（你是「${persona.name}」）：`;
  return { system, user };
}

/** The relevance self-judgment prompt (rule ②/④, no jev). Tiny on purpose. */
export function buildRelevanceJudgePrompt(opts: BuildGroupTurnPromptOpts): {
  system: string;
  user: string;
} {
  const { persona, group, herName } = opts;
  const system = `你是「${persona.name}」。你正在一个群聊里。只回答"是"或"否"。`;
  const user =
    `群聊记录：\n${formatGroupTranscript(group, { herName, maxMessages: 12 })}\n\n` +
    `刚才的发言，和你有关吗？你有话想说吗？只回答"是"或"否"。`;
  return { system, user };
}

/** Parse a yes/no judgment. Fail-closed: anything but a clear yes = silent. */
export function parseRelevanceJudgment(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (/^(是|yes|y|有|嗯|对)/.test(t)) return true;
  return false;
}

/**
 * Collapse a turn's tool calls into one folded line so the group transcript
 * never floods (her spec rule 7). e.g. "用了 3 个工具：a、b（1 个失败）".
 */
export function foldToolSummary(tools: GroupToolUse[]): string {
  if (tools.length === 0) return "";
  const failed = tools.filter((t) => !t.ok);
  const names = [...new Set(tools.map((t) => t.name))].join("、");
  const base = `用了 ${tools.length} 个工具：${names}`;
  return failed.length > 0 ? `${base}（${failed.length} 个失败）` : base;
}

/** Silence marker: the model replies "…" when it chooses to stay silent. */
export const SILENCE_MARKER = "…";

/** True when a persona's reply is just the silence marker (not stored). */
export function isSilenceReply(text: string): boolean {
  return text.trim() === SILENCE_MARKER;
}

/**
 * One-line status for her ("群聊「周末计划」· 3 位成员 · 12 条消息").
 */
export function describePersonaGroup(group: PersonaGroup, memberNames: string[]): string {
  return (
    `群聊「${group.name}」— ${memberNames.join("、")}（${group.members.length} 位）\n` +
    `共 ${group.messages.length} 条消息${group.archived ? "（已归档）" : ""}`
  );
}
