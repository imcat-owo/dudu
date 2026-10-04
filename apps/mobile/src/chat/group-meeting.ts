/**
 * AI self-organized group chat (AI 自建群, vision feature 3).
 *
 * The main AI acts as moderator (ai-debate pattern): it creates a meeting,
 * picks member models from her API groups, drives rounds, and reports the
 * conclusion back to her. It does NOT debate — the members do.
 *
 * Turn-taking copies SillyTavern's mechanics (see
 * research/alignment-ai-group-chat.md), NOT invented:
 * - NATURAL: @mention (full-word name match) must respond -> per-member
 * talkativeness dice -> random fallback. Last speaker is banned from
 * speaking twice in a row (ST's bannedUser).
 * - POOLED: every member speaks once per round, first-speaker rotates.
 * - LIST: every member speaks once per round, fixed order.
 * Per-round cap: a member speaks at most once per round (bounded
 * interaction, no ping-pong loops).
 *
 * Hard constraints (死线), enforced by the tools layer:
 * - 人设记忆隔离: buildMemberPrompt() takes ONLY the meeting (topic +
 * shared transcript). There is no parameter for persona memories or
 * other dialogs — a leak is structurally impossible, and a test pins it.
 * - 留痕: creation / every round / end are appended to the cross-dialog
 * trace (reused from feature 2). No silent meetings.
 * - 开启原则: meetings start only via an approved plan or her explicit
 * "你们讨论一下"; the plan is re-checked before every round.
 *
 * PURE module: no React Native / expo imports. Randomness is injectable
 * for deterministic tests.
 */

export type MeetingStrategy = "natural" | "pooled" | "list";
export type MeetingStatus = "discussing" | "done";

export interface MeetingMember {
  /** Stable id within the meeting: "m1", "m2",... */
  id: string;
  /** Display name, e.g. "主力 (gpt-4o)". Used for @mention matching. */
  displayName: string;
  /** Her API group id — the actual model endpoint. */
  apiGroupId: string;
  /** Model name, for display. */
  model: string;
  /** ST-style talkativeness 0..1. 0 = shy (only speaks when @mentioned). */
  talkativeness: number;
  /** Reserved for when personas land as a code concept. */
  personaId?: string;
}

export interface MeetingMessage {
  id: string;
  memberId: string;
  memberName: string;
  text: string;
  round: number;
  at: number;
}

export interface GroupMeeting {
  id: string;
  name: string;
  topic: string;
  /** Why the meeting was called (her words or the plan). */
  reason: string;
  members: MeetingMember[];
  strategy: MeetingStrategy;
  maxRounds: number;
  roundsCompleted: number;
  status: MeetingStatus;
  transcript: MeetingMessage[];
  /** Four-part conclusion (主题/各方观点/共识/未解决分歧), written at end. */
  conclusion?: string;
  /** The dialog the moderator AI was talking in when it created this. */
  createdByThreadId: string;
  /** Approved plan id, when plan-gated. */
  planId?: string;
  createdAt: number;
  endedAt?: number;
}

/** A member says this (or the round cap hits) and the meeting ends. */
export const MEETING_END_KEYWORD = "会议结束";
/** Hard ceiling on rounds per meeting — no all-night debates on her bill. */
export const MAX_ROUNDS_CAP = 10;
export const DEFAULT_MAX_ROUNDS = 4;
/** Hard ceiling on members per meeting — keeps it legible and bounded. */
export const MAX_MEMBERS = 5;
/** Cap on persisted meetings. */
export const MEETINGS_CAP = 20;

export const MEETING_STORAGE_KEY = "dudu.group-meetings.v1";

export interface StartMeetingInput {
  topic?: unknown;
  reason?: unknown;
  members?: unknown;
  strategy?: unknown;
  maxRounds?: unknown;
}

export interface ParsedMember {
  apiGroupRef: string;
  talkativeness: number;
}

/** Validation shared by the tool and tests. Returns an error key or null. */
export function validateStartMeetingInput(input: StartMeetingInput): string | null {
  if (typeof input.topic !== "string" || !input.topic.trim()) return "topicRequired";
  if (typeof input.reason !== "string" || !input.reason.trim()) return "reasonRequired";
  if (!Array.isArray(input.members) || input.members.length < 2) return "membersRequired";
  if (input.members.length > MAX_MEMBERS) return "tooManyMembers";
  for (const m of input.members) {
    if (typeof m !== "object" || m === null) return "membersInvalid";
    const ref = (m as { apiGroupRef?: unknown }).apiGroupRef;
    if (typeof ref !== "string" || !ref.trim()) return "membersInvalid";
    const t = (m as { talkativeness?: unknown }).talkativeness;
    if (t !== undefined && (typeof t !== "number" || t < 0 || t > 1)) return "talkativenessInvalid";
  }
  if (input.strategy !== undefined && !isStrategy(input.strategy)) return "strategyInvalid";
  if (input.maxRounds !== undefined) {
    const n = input.maxRounds;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_ROUNDS_CAP)
      return "maxRoundsInvalid";
  }
  return null;
}

export function isStrategy(s: unknown): s is MeetingStrategy {
  return s === "natural" || s === "pooled" || s === "list";
}

export function parseMembers(input: StartMeetingInput): ParsedMember[] {
  const raw = input.members as Array<{ apiGroupRef?: unknown; talkativeness?: unknown }>;
  return raw.map((m) => ({
    apiGroupRef: (m.apiGroupRef as string).trim(),
    talkativeness:
      typeof m.talkativeness === "number" ? Math.min(1, Math.max(0, m.talkativeness)) : 0.5,
  }));
}

/**
 * Shared transcript as the members see it. One line per message:
 * "name: text". This is the ONLY shared context members get.
 */
export function formatTranscript(meeting: GroupMeeting): string {
  if (meeting.transcript.length === 0) return "(还没有人发言)";
  return meeting.transcript.map((m) => `${m.memberName}：${m.text}`).join("\n");
}

/**
 * Prompt assembly for one member turn.
 *
 * ISOLATION (人设记忆隔离): the ONLY inputs are the member card, the
 * meeting topic, and the shared transcript. There is deliberately no
 * parameter for persona memories, other dialogs, or her private data —
 * a member can never see anything outside this meeting. Pinned by test.
 */
export function buildMemberPrompt(
  member: MeetingMember,
  meeting: GroupMeeting,
): { system: string; user: string } {
  const system =
    `你是「${member.displayName}」，正在参加一个 AI 内部讨论会。` +
    `你是参会者之一，不是主持人。` +
    `规则：只围绕主题发言，简短有力（200字以内），说人话不说套话。` +
    `如果讨论已经充分、你没有新的东西可说，只回复「${MEETING_END_KEYWORD}」四个字。` +
    `注意：你只能看到本次会议的讨论记录，看不到其他任何对话。`;
  const user =
    `\n${meeting.topic}\n\n` +
    `\n${formatTranscript(meeting)}\n\n` +
    `轮到你发言（你是「${member.displayName}」）：`;
  return { system, user };
}

export interface SelectSpeakersOpts {
  /** Injectable randomness for deterministic tests. */
  random?: () => number;
}

/**
 * Pick who speaks this round. ST NATURAL ported (mention -> dice ->
 * fallback), plus POOLED / LIST for meetings.
 *
 * Returns members in speaking order. A member appears at most once
 * (bounded interaction, no ping-pong).
 */
export function selectSpeakers(
  meeting: GroupMeeting,
  opts: SelectSpeakersOpts = {},
): MeetingMember[] {
  const rand = opts.random ?? Math.random;
  const members = meeting.members;
  if (members.length === 0) return [];

  const lastSpeakerId =
    meeting.transcript.length > 0
      ? meeting.transcript[meeting.transcript.length - 1].memberId
      : null;

  if (meeting.strategy === "list") {
    return [...members];
  }

  if (meeting.strategy === "pooled") {
    // Everyone speaks once per round; the first speaker rotates each
    // round so no one always opens.
    const offset = meeting.roundsCompleted % members.length;
    return members.map((_, i) => members[(offset + i) % members.length]);
  }

  // NATURAL (default): ST's three-stage selection.
  const eligible = members.filter((m) => m.id !== lastSpeakerId || members.length === 1);

  // Stage 1: @mention — full-word name match in the latest message (or the
  // topic on the first round). Mentioned members MUST respond, first.
  const haystack =
    meeting.transcript.length > 0
      ? meeting.transcript[meeting.transcript.length - 1].text
      : meeting.topic;
  const mentioned = eligible.filter((m) => mentionsName(haystack, m.displayName));

  // Stage 2: talkativeness dice for everyone else.
  const rest = eligible.filter((m) => !mentioned.includes(m));
  const diceWinners = rest.filter((m) => rand() < m.talkativeness);

  let picked = [...mentioned, ...diceWinners];

  // Stage 3: fallback — nobody picked, take a random talkative member.
  if (picked.length === 0) {
    const talkative = eligible.filter((m) => m.talkativeness > 0);
    const pool = talkative.length > 0 ? talkative : eligible;
    picked = [pool[Math.floor(rand() * pool.length)]];
  }
  return picked;
}

/** Full-word (word-boundary aware, CJK-safe) name match for @mentions. */
function mentionsName(text: string, name: string): boolean {
  const t = text.toLowerCase();
  const n = name.toLowerCase().trim();
  if (!n) return false;
  // Also try the short name before any " (" suffix, e.g. "主力" from "主力 (gpt-4o)".
  const short = n.split(" (")[0].split("(")[0].trim();
  const candidates = short && short !== n ? [n, short] : [n];
  return candidates.some((c) => {
    let idx = t.indexOf(c);
    while (idx !== -1) {
      const before = idx === 0 ? "" : t[idx - 1];
      const after = idx + c.length >= t.length ? "" : t[idx + c.length];
      // Word boundary: neighbors must not be word chars (letters/digits).
      // CJK chars are not \w, so "主力" matches inside Chinese text.
      if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) return true;
      idx = t.indexOf(c, idx + 1);
    }
    return false;
  });
}

/** True when the meeting should stop after this round. */
export function shouldEndMeeting(meeting: GroupMeeting): boolean {
  if (meeting.roundsCompleted >= meeting.maxRounds) return true;
  return meeting.transcript.some((m) => m.text.includes(MEETING_END_KEYWORD));
}

/**
 * One-line status for the trace and for her ("开会中（3/10 轮）").
 */
export function meetingProgressLabel(meeting: GroupMeeting): string {
  return meeting.status === "done"
    ? "会议结束"
    : `开会中（${meeting.roundsCompleted}/${meeting.maxRounds} 轮）`;
}

/** Compact status text for the meeting_status tool / AI narration. */
export function describeMeeting(meeting: GroupMeeting): string {
  const lines = [
    `会议「${meeting.name}」— ${meetingProgressLabel(meeting)}`,
    `主题：${meeting.topic}`,
    `成员：${meeting.members.map((m) => m.displayName).join("、")}（${meeting.members.length} 位）`,
    `已发言 ${meeting.transcript.length} 条`,
  ];
  if (meeting.conclusion) lines.push(`结论：${meeting.conclusion}`);
  return lines.join("\n");
}
