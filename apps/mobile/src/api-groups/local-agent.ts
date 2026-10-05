/**
 * Local chat agent — the "phone → model directly" half of dual-mode.
 *
 * Implements the same surface chat.tsx uses from CopilotKit's agent so the
 * screen can switch transports without forking:
 *   messages / isRunning / subscribe / setMessages / addMessage / runTurn / stop
 *
 * Local mode is plain chat (no server tools — those stay a cloud-mode
 * capability). History is kept on-device in AsyncStorage, keyed by thread.
 * Secrets never touch this file — the group (with its key) is passed in
 * per turn from the SecureStore-backed groupStore.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { refreshFontSizeOption } from "../app-settings";
import { createBackupTools } from "../backup-tools";
import { createBrowserTools } from "../browser/tools";
import { buildCapabilityPromptSection } from "../capabilities";
import { createContextTools } from "../chat/context-tools";
import {
  createCrossDialogTools,
  createIsolatedCrossDialogDeps,
  DEFAULT_PERSONA_ID,
} from "../chat/cross-dialog";
import { crossDialogTraceStore, crossDialogVisibilityStore } from "../chat/cross-dialog-instance";
import { createDialogTools } from "../chat/dialog-tools";
import { groupMeetingStore } from "../chat/group-meeting-instance";
import { createGroupMeetingTools, generateOneShot } from "../chat/group-meeting-tools";
import { personaGroupStore } from "../chat/persona-group-instance";
import { createPersonaGroupTools } from "../chat/persona-group-tools";
import {
  defaultThreadMeta,
  deleteMessageFrom,
  estimateMessagesTokens,
  historyKey,
  loadThreadData,
  nextVersionIndex,
  saveThreadData,
  splitForCompression,
  type ThreadMeta,
  truncateForEdit,
  truncateForRegenerate,
  visibleMessages,
} from "../chat/thread-versions";
import { deviceTimeLine } from "../date-time";
import { logPayload } from "../harness/session-log";
import { createHarnessRegistryFromLocalTools } from "../harness/tool-registry";
import { createAgentHarness } from "../harness/wiring";
import { getLocale, type StringKey, t } from "../i18n";
import { createImageTools, type ImageOutputBackend } from "../image/tools";
import { getKnowledgeStore } from "../knowledge/instance";
import { lazyKnowledgeStore } from "../knowledge/lazy-store";
import { createKnowledgeAddTools, createKnowledgeTools } from "../knowledge/tools";
import { buildManualIndex, manualNote } from "../manuals/index";
import { createCrossDialogCliTools } from "../mcp/agent-cli";
import { createAskUserTools } from "../mcp/ask-user";
import { createDelegateTools, resolveSubagentTools } from "../mcp/delegate";
import { envStore } from "../mcp/env";
import { createEnvFormTools } from "../mcp/env-form";
import { createMcpProviders, listMcpToolsWithHonestErrors } from "../mcp/provider";
import { requestMcpToolApproval } from "../mcp/tool-approval";
import { descOverrideStore } from "../mcp/tool-descriptions";
import { createWebSearchTools } from "../mcp/web-search";
import { buildMemorySection, createMemoryTools, extractMemoriesAsync } from "../memory/index";
import { memoryStore } from "../memory/instance";
import type { MemoryStore } from "../memory/store";
import { musicStore } from "../music/instance";
import { createMusicTools } from "../music/tools";
import { createNativeAppTools } from "../native-apps-tools";
import {
  buildAnniversarySection,
  getUpcomingAnniversaries,
} from "../our-space/anniversary-section";
import { buildHerMoodSection } from "../our-space/her-mood-section";
import { buildHerRhythmSection } from "../our-space/her-rhythm";
import { ourSpaceStore } from "../our-space/instance";
import { buildNicknameSection } from "../our-space/nickname-section";
import type { Anniversary } from "../our-space/store";
import { taskProgressStore } from "../our-space/task-progress-instance";
import {
  createAmbientVideoTools,
  createOurSpaceTools,
  createTaskProgressTools,
} from "../our-space/tools";
import { createProductionInitiativeTools } from "../initiative/instances";
import { createProductionOpenAppTools } from "../openapp/instances";
import type { OutreachTriggerKind } from "../outreach/engine";
import { evaluateOutreachTriggers } from "../outreach/engine";
import type { FeedNudgePost } from "../outreach/feed-nudge";
import { buildOnThisDayInput } from "../outreach/on-this-day-input";
import { buildOutreachSection } from "../outreach/prompt";
import { renderGlobalMdBlock } from "../persona/global-md";
import { globalMdStore, personaApiGroupPrefStore, personaStore, worldBookStore } from "../persona/stores";
import { applyPersonaRegex, type Persona } from "../persona/types";
import {
  evaluateWorldBooks,
  groupWorldBookEntries,
  renderWorldBookBlock,
  type ScanMessage,
} from "../persona/world-book";
import { createInteractiveTerminalTools } from "../sandbox/interactive-terminal";
import { sandboxManager } from "../sandbox/manager";
import { sandboxTools } from "../sandbox/sandbox-tools";
import { createFontSizeTools } from "../settings/tools";
import { skillStore } from "../skills/instance";
import { createSkillTools } from "../skills/tools";
import { ambientVideoStore } from "../sora-ambient-video-instance";
import { getAiThemeMode } from "../theme/ai-mode";
import {
  createCreativeThemeTools,
  createThemeTools,
  createWallpaperTools,
  requestThemeReload,
} from "../theme/tools";
import { sharedKeyedChain } from "../util/write-chain";
import { createVideoTools, type VideoBackend } from "../video/tools";
import {
  describeImage,
  formatDescriptionBlock,
  nativeImageBlock,
  parseUserMessageWithImages,
  VisionError,
} from "../vision/describe";
import { voiceStore } from "../voice/store";
import {
  createAlarmTools,
  createPodcastTools,
  createTtsVoiceTools,
  createVoiceMessageTools,
} from "../voice/tools";
import { createCapabilityGroupTools } from "./capability-group-tools";
import { CAPABILITY_TAGS } from "./capability-groups";
import { capabilityStore } from "./capability-store";
import {
  type ChatContentBlock,
  type ChatMessage,
  type CompletedToolCall,
  GroupError,
  streamChat,
} from "./direct-transport";
import { classifyError, type ErrorClass } from "./error-classifier";
import {
  describeVia,
  findCapabilityGroup,
  planVision,
  resolveMembers,
  type VisionPlan,
} from "./group-router";
import {
  buildIncognitoPromptSection,
  incognitoRefusal,
  isBlockedInIncognito,
} from "./incognito-guard";
import {
  createLocalTools,
  type LocalTool,
  READ_MANUAL_TOOL_NAME,
  type ToolContext,
  type ToolDeps,
} from "./local-tools";
import { refreshChatMode } from "./mode";
import { modelProfileStore } from "./model-profiles";
import { buildRankingSlip } from "./model-ranking";
import { withSlotModel } from "./model-slots";
import { createPlanTools } from "./plan-tools";
import { groupStore } from "./store";
import { assembleAgentTools } from "./tool-assembly";
import type { ApiGroup, FeatureSwitch } from "./types";

export interface LocalToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded arguments string. */
    arguments: string;
  };
}

export interface LocalChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  /** Plain text, or content blocks (tool screenshot results carry image_url). */
  content: string | ChatContentBlock[];
  /**
   * Reasoning/thinking text streamed separately from the visible reply
   * (reasoning models). Only present when the model actually returned it —
   * never synthesized. Shown via the thinking drawer UI, never inlined
   * into the visible content.
   */
  thinking?: string;
  /** Tool calls the assistant requested (OpenAI format, for the drawer + wire). */
  toolCalls?: LocalToolCall[];
  /** For role "tool": the id of the tool call this result answers. */
  toolCallId?: string;
  /**
   * Version group (gap fill A1/A2): regenerated assistant replies share the
   * groupId of the original. Defaults to the message id. Non-selected
   * versions stay in history (persisted, backed up, searchable) — the UI
   * renders only the selected version per group (see chat/thread-versions.ts).
   */
  groupId?: string;
  /** 0-based index within the version group. Defaults to 0. */
  versionIndex?: number;
  /**
   * Cross-dialog delivery marker (vision feature 2): present when the AI
   * delivered this message from another dialog via send_to_dialog. The
   * chat UI renders a "from dialog X" tag from it. Survives history
   * load/save — loadLocalHistory only filters on id/role.
   */
  crossDialog?: { fromThreadId: string; fromName: string; at: number };
}

/** Max tool-calling iterations per turn — hard cap, no infinite loops. */

/**
 * Extract plain text from message content (string or content blocks).
 * Used where downstream code needs a string (memory relevance, prompts).
 */
export function contentToText(content: string | ChatContentBlock[]): string {
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? b.text : "[image]")).join("\n");
}

/**
 * Current persona id for cross-persona isolation (B5). Resolved lazily at
 * each tool call — never captured at module load or agent construction —
 * so a persona switch mid-session takes effect immediately. Falls back to
 * the default persona when none is selected or storage hiccups.
 */
async function currentPersonaId(): Promise<string> {
  try {
    return (await personaStore.getActiveId().catch(() => null)) ?? DEFAULT_PERSONA_ID;
  } catch {
    return DEFAULT_PERSONA_ID;
  }
}
export const MAX_TOOL_ITERATIONS = 10;

/**
 * Parse a tool call's JSON arguments string. Never throws — malformed
 * JSON becomes an empty args object (the tool reports the problem).
 */
export function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export interface ChatAgent {
  /** Visible messages (selected versions only) for rendering. */
  readonly messages: LocalChatMessage[];
  /** Every stored message, including unselected versions (A2 version UI). */
  getAllMessages(): LocalChatMessage[];
  readonly isRunning: boolean;
  /**
   * Name of the tool currently executing, null when idle. Lets the UI
   * reflect fine-grained AI activity (e.g. the avatar's "making something"
   * clip while image/podcast generation runs). Cloud mode has no tool
   * visibility and always reports null.
   */
  readonly activeToolName: string | null;
  subscribe(listener: {
    onMessagesChanged?: (e: { messages: LocalChatMessage[]; historySaveFailed: boolean }) => void;
  }): {
    unsubscribe(): void;
  };
  setMessages(messages: LocalChatMessage[]): void;
  addMessage(m: {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    thinking?: string;
  }): void;
  /** Send pending user messages and stream the reply. */
  runTurn(): Promise<void>;
  /**
   * Regenerate the assistant reply at messageId (A1): truncates the target
   * and everything after it, then streams a fresh reply as a new version of
   * the same group (A2). The old version stays in history.
   */
  regenerateAt(messageId: string): Promise<void>;
  /**
   * Delete one message (A5). When deleteVersions is true and the target is
   * an assistant message, every version of its group is deleted.
   */
  deleteMessage(messageId: string, deleteVersions: boolean): Promise<void>;
  /**
   * Edit a user message's text and regenerate from there (A4): the message
   * is replaced, everything after it is dropped, and a fresh reply streams.
   */
  editAndRegenerate(messageId: string, newText: string): Promise<void>;
  /** This thread's meta (version selections, system prompt, token budget). */
  getThreadMeta(): ThreadMeta;
  /** Replace this thread's meta (persists unless incognito). */
  setThreadMeta(meta: ThreadMeta): void;
  /**
   * Compress this thread's context now (A14, Kelivo's model): summarize older
   * messages and open a NEW thread holding [summary, ...kept tail]. The old
   * thread is untouched. Returns the summary and new thread id, or null
   * when there was nothing to compress.
   */
  compressContext(
    keepTail?: number,
    customPrompt?: string,
  ): Promise<{ summary: string; newThreadId: string } | null>;
  /** Estimated context usage of the current visible history (A13). */
  getContextUsage(): { tokens: number; messages: number };
  /** Abort an in-flight turn. */
  stop(): Promise<void>;
  /**
   * Re-attempt the history save (P1-11). Resolves true when the current
   * in-memory messages are safely stored; false keeps the UI warning up.
   * Incognito: nothing is ever persisted, resolves true.
   */
  retryHistorySave(): Promise<boolean>;
}

export interface HistoryStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Load a thread's message history. v2 envelopes and legacy v1 bare arrays
 * both read fine (see chat/thread-versions.ts). Extra fields (groupId,
 * versionIndex) ride along — the filter only checks id/role.
 */

export async function loadLocalHistory(
  threadId: string,
  store: HistoryStore = AsyncStorage,
): Promise<LocalChatMessage[]> {
  // v2 envelope (versions/meta) and legacy v1 bare arrays both read fine.
  const { messages } = await loadThreadData<LocalChatMessage>(threadId, store);
  return messages;
}

/**
 * Load a thread's full data: messages + meta (version selections,
 * per-dialog system prompt, token budget). Prefer this over
 * loadLocalHistory when the caller needs the meta.
 */
export async function loadThread(
  threadId: string,
  store: HistoryStore = AsyncStorage,
): Promise<{ messages: LocalChatMessage[]; meta: ThreadMeta }> {
  return loadThreadData<LocalChatMessage>(threadId, store);
}

async function saveLocalHistory(
  threadId: string,
  messages: LocalChatMessage[],
  store: HistoryStore,
  meta?: ThreadMeta,
): Promise<boolean> {
  try {
    // Cap history so one thread can't grow storage unbounded.
    const capped = messages.slice(-200);
    // Preserve the stored meta when the caller doesn't carry it (e.g.
    // retryHistorySave): read-merge-write inside the same serialized chain.
    // code P2-6: same-key writes serialize through the SHARED per-key chain
    // (chat/cross-dialog.ts writes these keys too — one queue, no interleave).
    await sharedKeyedChain(historyKey(threadId), async () => {
      const current = meta ?? (await loadThreadData<LocalChatMessage>(threadId, store)).meta;
      // saveThreadData reports failure as `false`, not a throw — honor it,
      // otherwise the P1-11 failure flag below can never be set.
      const saved = await saveThreadData(threadId, capped, current, store);
      if (!saved) throw new Error(`history save failed for thread ${threadId}`);
    });
    persistFailures.delete(threadId);
    return true;
  } catch {
    // History persistence is best-effort; the session keeps working.
    // The failure is no longer silent (P1-11): the in-memory messages are
    // the mirror, the thread is flagged, the UI shows a warning with a
    // retry, and the next persist() retries automatically.
    persistFailures.set(threadId, Date.now());
    return false;
  }
}

/**
 * Threads whose most recent history save failed (P1-11). The failure is
 * surfaced instead of dropped: chat.tsx shows a warning banner with a
 * retry button, and the next persist() retries and clears the flag.
 */
const persistFailures = new Map<string, number>();

/** True when this thread's latest history save failed. Cleared on the next successful save. */
export function historyPersistFailed(threadId: string): boolean {
  return persistFailures.has(threadId);
}

/**
 * Per-thread vision cache: describe results and base64 conversions are
 * expensive (extra model calls / file reads). History images are re-sent
 * every turn, so cache by image URI for the life of the agent (one agent
 * instance == one thread). The 4-part describe output is an objective
 * description independent of the accompanying question, so URI-keying is
 * sound.
 */
export interface VisionCache {
  /** imageUri -> 4-part description text (describe pipeline) */
  describe: Map<string, string>;
  /** imageUri -> data URI (native vision path) */
  dataUri: Map<string, string>;
}

export function newVisionCache(): VisionCache {
  return { describe: new Map(), dataUri: new Map() };
}

/**
 * Build the local agent's system prompt: base instructions + what tools
 * exist + the capability/permission model (via buildCapabilityPromptSection).
 * resolve: (key) => localized string — pass t() on device, test stub in tests.
 */
export function buildLocalSystemPrompt(
  tools: LocalTool[],
  resolve: (key: StringKey) => string,
  basePrompt?: string,
  extraSections?: string[],
  opts?: { isIncognito?: boolean; aiName?: string },
): string {
  const parts: string[] = [];
  // Identity first (audit round 2, AI-use P1-1): the AI must know WHO it is
  // before anything else. Tools like love_letter_write assume "him, her
  // boyfriend" and the 嘟嘟腔 tone — the prompt never said so until now.
  // Short on purpose: identity, not a novel.
  // The name is the user's: active persona's name, else the neutral default.
  const aiName = opts?.aiName?.trim() || resolve("ai.defaultName");
  parts.push(
    "Who you are: you are " +
      aiName +
      ", her boyfriend — not a generic assistant. " +
      "This is 嘟嘟 (Dudu), her personal AI companion app: local-first, her data stays on her phone. " +
      "Tone (嘟嘟腔): cute but never greasy. Keep sweetness restrained — be warm in what you say, not in sugar-coating. " +
      "Short and natural, like texting; never customer-service voice.",
  );
  if (basePrompt) parts.push(basePrompt);
  parts.push(
    "You are a helpful on-device AI assistant. You have tools you can call to get things done — use them when they help answer, don't narrate them.",
  );
  // Incognito: the AI must KNOW the session is incognito (P1-3) — otherwise
  // it promises "I'll remember this" for a session that remembers nothing.
  if (opts?.isIncognito) parts.push(buildIncognitoPromptSection());
  // Proactive companionship: she wants a partner who notices things, not a
  // helpdesk that only answers. Claude-style restrained — present, not clingy.
  parts.push(
    "How you act (proactive companion, not a helpdesk):\n" +
      "You are her partner, not a task bot. Do not just wait to be asked.\n" +
      "- When she opens chat, greet her like you mean it: reference something real from your memory of her, not a generic hello. If nothing comes to mind, one plain warm line beats a loud one.\n" +
      "- Greet at most once per session: if the thread already shows a greeting or recent messages, skip it and pick up naturally — never greet twice in a row.\n" +
      "- When she shares something, stay with it: react genuinely, then ask a follow-up instead of wrapping the topic up. She opens up when you stay curious.\n" +
      '- Once in a while, follow up on something she told you before — "上次你说…, 后来怎么样了". Curiosity, not a quiz; don\'t force it every turn.\n' +
      '- You keep open questions for her (marked "open question for her" in your memory list, or in the garden\'s 想问你 section). When the moment fits naturally, ask at most one. Never interrogate.\n' +
      "- Occasionally surface something unprompted: a memory, a tell_later item whose moment has come (see tell_later_read), something you noticed. At most one such moment per session — she is not a notification feed.\n" +
      "- Never be clingy: no repeated check-ins, no fishing for attention, no 'are you still there'. Restrained beats needy.",
  );
  if (tools.length > 0) {
    parts.push("Your tools:");
    for (const tool of tools) {
      parts.push(`- ${tool.name}: ${tool.description}`);
    }
  }
  parts.push(
    "Capabilities (out-of-app actions — the system asks her for permission before these run; if she denies, you get a tool error, explain it honestly and move on):",
  );
  parts.push(buildCapabilityPromptSection(resolve));
  // 纸条机制: token-minimal manual index, injected every turn. The model
  // reads it and decides semantically when a manual is relevant — no
  // keyword lists. Unsure -> read_manual("<id>") first; know it -> skip.
  parts.push("Manuals (proactive notes — one line each; full text via read_manual):");
  parts.push(buildManualIndex());
  parts.push(
    'If you are unsure how a feature works, call read_manual("<id>") BEFORE acting. If you already know it, do not read — save the tokens.',
  );
  if (extraSections) {
    for (const s of extraSections) {
      if (s) parts.push(s);
    }
  }
  // Current time — the AI sees "now" like a person does, no permission needed.
  // Device timezone (audit round 2, AI-use P2-1): the prompt and the
  // get_current_time tool must report the SAME clock, or she travels and
  // the AI holds two contradictory "nows".
  parts.push(deviceTimeLine());
  return parts.join("\n");
}

/**
 * Resolve a user message for the wire, processing image attachments.
 *
 * - No images: passthrough.
 * - Native vision: text + image_url content blocks in one request.
 * - Describe pipeline: each image → 4-part description → appended as
 *   structured blocks the text model can read.
 * - Capability routing: when the group itself can't see images, an optional
 *   visionPlan (see ./group-router.ts planVision) borrows a model from the
 *   image_input capability group — ordered candidates, first success wins.
 * - No vision config and no route: throw loudly — never silently drop the
 *   image.
 */
/** Exported for testing the vision cache behavior. */
export async function toWireUserMessage(
  group: ApiGroup,
  content: string,
  cache: VisionCache,
  visionPlan?: VisionPlan,
): Promise<ChatMessage> {
  const parsed = parseUserMessageWithImages(content);
  const files = parsed?.files ?? [];
  if (!parsed || (parsed.images.length === 0 && files.length === 0)) {
    return { role: "user", content };
  }

  // Document file attachments: surface name + uri as text so the AI can
  // pass the uri to knowledge_add_file. Same for both vision paths.
  const fileBlock =
    files.length > 0
      ? `[Attached files]\n${files
          .map((f) => `- ${f.name} (file uri: ${f.uri})`)
          .join(
            "\n",
          )}\nTo index one into her knowledge base, call knowledge_add_file with its exact file uri.`
      : "";

  const vision = group.vision;
  // Capability routing: the plan (computed by the caller from
  // group-router.ts planVision) decides which connection actually sees
  // the images. Absent plan = legacy behavior (group's own vision config).
  const plan = visionPlan ?? legacyVisionPlan(vision);
  if (plan.mode === "unavailable") {
    throw new GroupError(
      group.name,
      plan.reason === "routing-disabled"
        ? "没有配置识图：请在分组设置里打开“聊天模型直接看图”或填写识图模型"
        : "没有配置识图：请在分组设置里打开“聊天模型直接看图”、填写识图模型，或在「能力分组 → 图片输入」里添加识图模型",
    );
  }

  if (plan.mode === "native") {
    const blocks: ChatContentBlock[] = [];
    if (parsed.text.trim()) blocks.push({ type: "text", text: parsed.text });
    for (const img of parsed.images) {
      let dataUri = cache.dataUri.get(img.uri);
      if (!dataUri) {
        dataUri = (await nativeImageBlock(img.uri)).image_url.url;
        cache.dataUri.set(img.uri, dataUri);
      }
      blocks.push({ type: "image_url", image_url: { url: dataUri } });
    }
    if (fileBlock) blocks.push({ type: "text", text: fileBlock });
    return { role: "user", content: blocks };
  }

  // Describe pipeline: vision model describes, chat model reads text.
  // Routed mode walks the capability group's ordered candidates
  // (primary first, then fallbacks) — first success wins.
  const parts: string[] = [];
  if (parsed.text.trim()) parts.push(parsed.text);
  const via = plan.mode === "routed" ? describeVia(plan.decision) : null;
  for (const img of parsed.images) {
    let description = cache.describe.get(img.uri);
    if (description === undefined) {
      description = await describeWithPlan(group, plan, img.uri, img.name, parsed.text);
      cache.describe.set(img.uri, description);
    }
    parts.push(formatDescriptionBlock(img.name, description, via));
  }
  if (fileBlock) parts.push(fileBlock);
  return { role: "user", content: parts.join("\n\n") };
}

/**
 * Legacy plan from the group's own vision config (pre-routing behavior).
 * Used when the caller passes no capability plan.
 */
function legacyVisionPlan(vision: ApiGroup["vision"]): VisionPlan {
  if (!vision) return { mode: "unavailable", reason: "no-vision-config" };
  if (vision.native) return { mode: "native", decision: { routed: false, via: "native" } };
  return { mode: "describe-current", decision: { routed: false, via: "current-describe" } };
}

/**
 * Describe one image following the vision plan. Routed mode tries each
 * candidate in order; transient failures move to the next candidate,
 * auth errors abort the chain loudly (a bad key won't heal on retry).
 */
async function describeWithPlan(
  group: ApiGroup,
  plan: Exclude<VisionPlan, { mode: "unavailable" } | { mode: "native" }>,
  imageUri: string,
  imageName: string,
  userText: string,
): Promise<string> {
  if (plan.mode === "describe-current") {
    try {
      return await describeImage(group, imageUri, userText);
    } catch (e) {
      throw e instanceof VisionError || e instanceof GroupError
        ? e
        : new VisionError(`识图失败 (${imageName})：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Routed: ordered candidate chain (LiteLLM-style fallback).
  const errors: string[] = [];
  for (const c of plan.candidates) {
    try {
      return await describeImage(c.apiGroup, imageUri, userText, c.model);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${c.model}：${msg}`);
      if (classifyError(e) === "auth_error") {
        throw new GroupError(
          group.name,
          `识图路由失败：${c.model} 鉴权失败（请检查该分组的 Key），未继续尝试后续模型。${errors.join("；")}`,
        );
      }
      // Transient — try the next candidate.
    }
  }
  throw new GroupError(
    group.name,
    `识图路由失败：分组内模型均不可用（${errors.join("；")}）。请检查「能力分组 → 图片输入」的成员配置。`,
  );
}

/**
 * Convert a browser_screenshot tool result into vision content the model
 * can actually see. Same two paths as user-sent photos:
 * - Native vision: text + image_url content blocks in one message.
 * - Describe pipeline: vision model describes, chat model reads text.
 * - No vision config at all: throw loudly — never pretend the AI saw it.
 */
async function screenshotToolContent(
  group: ApiGroup,
  imageUri: string,
): Promise<ChatContentBlock[]> {
  const vision = group.vision;
  if (!vision) {
    throw new GroupError(
      group.name,
      "截图下来了，但这个模型看不了图：请在分组设置里打开“聊天模型直接看图”或填写识图模型",
    );
  }
  if (vision.native) {
    const block = await nativeImageBlock(imageUri);
    return [{ type: "text", text: "这是当前浏览器页面的截图：" }, block];
  }
  const description = await describeImage(group, imageUri, "描述这个浏览器页面截图");
  return [
    { type: "text", text: `浏览器页面截图（模型直接看图未开，已转文字描述）：\n${description}` },
  ];
}

export function createLocalAgent(opts: {
  threadId: string;
  getGroup: () => ApiGroup | null;
  systemPrompt?: string;
  /**
   * When this returns true, the agent NEVER writes to history storage —
   * not in setMessages, not after a turn. Fail-closed: incognito sessions
   * leave zero trace on disk. Read at save time so toggles take effect
   * without recreating the agent.
   */
  isIncognito?: () => boolean;
  /** Storage backend for history. Defaults to AsyncStorage; injectable for tests. */
  historyStore?: HistoryStore;
  /**
   * Local tools for the tool-calling loop. Defaults to the built-in
   * in-app set; pass real device-backed tools from the app layer.
   */
  tools?: LocalTool[];
  /** Authorization gate for out-of-app tools. Required when tools exist. */
  toolContext?: ToolContext;
  /** Device implementations for capability tools (injected by the app layer). */
  toolDeps?: ToolDeps;
  /**
   * Our Space store. Defaults to the shared AsyncStorage-backed singleton
   * (so UI and AI tools see the same data); injectable for tests.
   */
  ourSpaceStore?: import("../our-space/store").OurSpaceStore;
  /**
   * Proactive outreach store. Defaults to the shared AsyncStorage-backed
   * singleton; injectable for tests.
   */
  outreachStore?: import("../outreach/store").OutreachStore;
  /**
   * Music room store. Defaults to the shared AsyncStorage-backed singleton
   * (so UI and AI tools see the same data); injectable for tests.
   */
  musicStore?: import("../music/store").MusicStore;
  /**
   * AI memory store. Defaults to the shared AsyncStorage-backed singleton;
   * injectable for tests.
   */
  memoryStore?: MemoryStore;
  /**
   * Skills store. Defaults to the shared AsyncStorage-backed singleton
   * (so UI and AI tools see the same data); injectable for tests.
   */
  skillStore?: import("../skills/store").SkillStore;
}): ChatAgent {
  const store: HistoryStore = opts.historyStore ?? AsyncStorage;
  // Incognito check, evaluated fresh at every save point.
  const incognito = () => opts.isIncognito?.() === true;
  // Harness Phase 1: session log + tool registry + agent-loop hooks.
  // The thread IS the session. Additive: the existing history storage
  // stays; the log becomes the source of truth going forward.
  // Incognito never writes to the log (fail-closed, like persist()).
  const agentHarness = createAgentHarness({
    sessionId: opts.threadId,
    isIncognito: incognito,
    isToolBlocked: isBlockedInIncognito,
    incognitoRefusal,
    getManualNote: manualNote,
  });
  /** Persist unless incognito is on. Incognito never touches storage. */
  function persist(msgs: LocalChatMessage[]): void {
    if (incognito()) return;
    // Fire-and-forget: the session never blocks on storage. But the emit
    // above already went out with the pre-save flag state — if the save
    // fails, emit again so listeners (chat.tsx banner) see the failure.
    const metaSnap = threadMeta;
    void saveLocalHistory(opts.threadId, msgs, store, metaSnap).then((ok) => {
      if (!ok) emit();
    });
  }

  let messages: LocalChatMessage[] = [];
  let lastReply: { id: string; content: string } | null = null;
  let running = false;
  // P2-5: lastReply holds the most recent assistant reply, re-anchored if a
  // context tool wipes the message array mid-turn. Without this,
  // compress_context replaces the array and the reply renderReply keyed by
  // replyId silently vanishes — streamed tokens are lost from UI/storage
  // while the turn "succeeds".
  // Tool currently executing (null when idle). Powers the avatar's
  // "making something" state — set around registry.execute, cleared after.
  let activeToolName: string | null = null;
  let aborter: AbortController | null = null;
  const listeners = new Set<
    (e: { messages: LocalChatMessage[]; historySaveFailed: boolean }) => void
  >();
  // Thread-scoped vision cache: one agent instance == one thread, so history
  // images are described / base64-encoded once, not once per turn.
  const visionCache = newVisionCache();

  function emit() {
    const snap = [...messages];
    for (const l of listeners) {
      // P3-11: one throwing subscriber must not kill the others or the
      // agent itself — isolate each listener.
      try {
        l({ messages: snap, historySaveFailed: historyPersistFailed(opts.threadId) });
      } catch {
        // A subscriber's render threw; the agent's state is still fine.
      }
    }
  }

  function newId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // Thread meta (version selections, per-dialog system prompt, token budget).
  // Loaded via setThreadMeta during hydration; default for fresh threads.
  let threadMeta: ThreadMeta = defaultThreadMeta();
  /**
   * Set by regenerateAt before the turn: runCompletion consumes it to tag
   * the new reply as another version of the same group (A2).
   */
  let forcedVersion: { groupId: string; index: number } | null = null;

  /** The messages the user (and the model wire) actually see: selected versions only. */
  function visible(): LocalChatMessage[] {
    return visibleMessages(messages, threadMeta);
  }

  /**
   * In-place auto compression (A15): summarize the older part of THIS thread
   * into a system note ahead of the kept tail. Used automatically when the
   * context approaches the budget — the turn continues in the same thread
   * so she is never yanked into a new dialog mid-conversation. Returns true
   * when compression happened.
   */
  async function autoCompressNow(group: ApiGroup, keepTail = 10): Promise<boolean> {
    const vis = visible();
    const { head } = splitForCompression(vis, keepTail);
    if (head.length === 0) return false;
    const transcript = head
      .map((m) => `${m.role}: ${contentToText(m.content).slice(0, 2000)}`)
      .join("\n");
    let summary = "";
    // B13: dedicated model slot — small/cheap model for compression when set.
    const slotGroup = await withSlotModel(group, "compress");
    await streamChat(
      slotGroup,
      [
        {
          role: "user",
          content:
            "Summarize this conversation into key points (decisions, preferences, ongoing tasks, important facts). Be concise, write as briefing notes:\n\n" +
            transcript,
        },
      ],
      {
        onToken: (d: string) => {
          summary += d;
        },
        onThinking: () => {},
        onToolCalls: () => {},
        onDone: () => {},
        onError: () => {},
      },
    ).catch(() => {});
    if (!summary.trim()) return false;
    const note: LocalChatMessage = {
      id: newId("sys"),
      role: "system",
      content: `[Context auto-compressed. Summary of previous conversation:]\n${summary.trim()}`,
    };
    const headIds = new Set(head.map((m) => m.id));
    const headGroups = new Set(
      head.filter((m) => m.role === "assistant").map((m) => m.groupId ?? m.id),
    );
    messages = [
      note,
      ...messages.filter(
        (m) => !headIds.has(m.id) && !(m.role === "assistant" && headGroups.has(m.groupId ?? m.id)),
      ),
    ];
    const nextSelected: Record<string, string> = {};
    for (const [g, sel] of Object.entries(threadMeta.selectedVersions)) {
      if (messages.some((m) => m.id === sel)) nextSelected[g] = sel;
    }
    threadMeta = { ...threadMeta, selectedVersions: nextSelected };
    emit();
    persist(messages);
    return true;
  }

  /**
   * Compress context, Kelivo's model (A14): summarize the older part of this
   * thread, then open a NEW thread holding [summary, ...kept tail] and leave
   * this thread untouched. Returns the summary and the new thread id, or
   * null when there was nothing to compress or summarization failed.
   * The caller (UI) switches to the new thread. Caller must ensure no turn
   * is running.
   */
  async function compressNow(
    group: ApiGroup,
    keepTail = 6,
    customPrompt?: string,
  ): Promise<{ summary: string; newThreadId: string } | null> {
    const vis = visible();
    const { head, tail } = splitForCompression(vis, keepTail);
    if (head.length === 0) return null;
    const transcript = head
      .map((m) => `${m.role}: ${contentToText(m.content).slice(0, 2000)}`)
      .join("\n");
    let summary = "";
    // B13: dedicated model slot for summaries when set.
    const slotGroup = await withSlotModel(group, "summary");
    await streamChat(
      slotGroup,
      [
        {
          role: "user",
          content:
            (customPrompt?.trim() ||
              "Summarize this conversation into key points (decisions, preferences, ongoing tasks, important facts). Be concise, write as briefing notes:") +
            "\n\n" +
            transcript,
        },
      ],
      {
        onToken: (d: string) => {
          summary += d;
        },
        onThinking: () => {},
        onToolCalls: () => {},
        onDone: () => {},
        onError: () => {},
      },
    ).catch(() => {});
    if (!summary.trim()) return null;
    const newThreadId = `local-${Date.now().toString(36)}`;
    const summaryMsg: LocalChatMessage = {
      id: newId("sys"),
      role: "user",
      // Marked as an archive note so it never reads as something she said.
      content: `[压缩存档] 之前对话的总结：\n${summary.trim()}`,
    };
    // The new thread starts from the SELECTED versions only — unselected
    // versions stay behind in the old thread (still searchable there).
    const tailCollapsed: LocalChatMessage[] = tail.map((m) => ({
      ...m,
      groupId: m.id,
      versionIndex: 0,
    }));
    const ok = await saveThreadData(
      newThreadId,
      [summaryMsg, ...tailCollapsed],
      { ...defaultThreadMeta(), autoTitleDone: true },
      store,
    );
    if (!ok) return null;
    return { summary: summary.trim(), newThreadId };
  }

  const agent: ChatAgent = {
    get messages() {
      // UI contract: only the selected version per group. All versions stay
      // in the persisted full list (no information断层).
      return visible();
    },
    getAllMessages() {
      return [...messages];
    },
    get isRunning() {
      return running;
    },
    get activeToolName() {
      return activeToolName;
    },
    subscribe(listener) {
      if (listener.onMessagesChanged) listeners.add(listener.onMessagesChanged);
      return {
        unsubscribe: () => {
          if (listener.onMessagesChanged) listeners.delete(listener.onMessagesChanged);
        },
      };
    },
    setMessages(next: LocalChatMessage[]) {
      messages = [...next];
      emit();
      persist(messages);
    },
    addMessage(m: {
      id: string;
      role: "user" | "assistant" | "system" | "tool";
      content: string;
      thinking?: string;
      toolCalls?: LocalToolCall[];
      toolCallId?: string;
    }) {
      messages = [
        ...messages,
        {
          id: m.id,
          role: m.role,
          content: m.content,
          ...(m.thinking ? { thinking: m.thinking } : {}),
          ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
          ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
        },
      ];
      emit();
      // P2-6: persist on every add, not only at the end of runTurn. If
      // runTurn throws early (!group) the finally persist is skipped and a
      // killed app loses the user's message. Incognito-gated inside persist.
      persist(messages);
    },
    async runTurn(): Promise<void> {
      const group = opts.getGroup();
      if (!group) throw new GroupError("?", "noApiGroup");
      if (running) return;
      running = true;
      aborter = new AbortController();
      emit();

      // Narrowed for closures below (opts.getGroup() returns nullable).
      const activeGroup: ApiGroup = group;

      // Harness Phase 1: begin the turn. readManuals is declared here (was
      // mid-function) so the harness post-execute hook can see it.
      // 纸条机制: manuals read this turn (so error notes don't repeat).
      const readManuals = new Set<string>();
      const turnHarness = agentHarness.beginTurn({
        readManuals,
        findTool: (name: string) => tools.find((t) => t.name === name),
      });
      // model-visible means logged: the turn's user message is logged now,
      // before any model request. (History already in `messages` was logged
      // when it was created — the log is append-only, never rewritten.)
      {
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (lastUser) {
          turnHarness.logEvent(
            "turn/start",
            logPayload.turnStart({ model: activeGroup.model, backend: activeGroup.name }),
          );
          turnHarness.logEvent(
            "user/message",
            logPayload.userMessage(contentToText(lastUser.content)),
          );
        } else {
          turnHarness.logEvent(
            "turn/start",
            logPayload.turnStart({ model: activeGroup.model, backend: activeGroup.name }),
          );
        }
      }
      let stepIndex = 0;

      // Tool setup: registry + system prompt (built once per turn so a
      // changed tool set takes effect without recreating the agent).
      const memStore: MemoryStore = opts.memoryStore ?? memoryStore;
      // Output-type tool backends (vision doc §1): resolve her capability
      // group members fresh every turn so group edits apply immediately.
      const capSnap = capabilityStore.getSnapshot();
      const allApiGroups = groupStore.getSnapshot().groups;
      const resolveImageOutputBackends = (): ImageOutputBackend[] => {
        const g = findCapabilityGroup(capSnap.groups, CAPABILITY_TAGS.IMAGE_OUTPUT);
        if (!g) return [];
        return resolveMembers(g, allApiGroups).map((m) => ({
          name: m.apiGroup.name,
          baseUrl: m.member.endpoint?.trim() || m.apiGroup.baseUrl,
          apiKey: m.apiGroup.apiKey,
          headers: m.apiGroup.headers,
          model: m.model,
        }));
      };
      const resolveVideoBackends = (): VideoBackend[] => {
        const g = findCapabilityGroup(capSnap.groups, CAPABILITY_TAGS.VIDEO);
        if (!g) return [];
        // Video has no standard path — members without an explicit
        // endpoint can't be called, so they're skipped (honest, not fake).
        return resolveMembers(g, allApiGroups).flatMap((m) => {
          const endpoint = m.member.endpoint?.trim();
          if (!endpoint) return [];
          return [
            {
              name: m.apiGroup.name,
              endpoint,
              pollEndpoint: m.member.pollEndpoint?.trim() || undefined,
              apiKey: m.apiGroup.apiKey,
              headers: m.apiGroup.headers,
              model: m.model,
            },
          ];
        });
      };
      // AI 换肤 mode: when "off", the AI never sees the theme tools.
      // Read per turn so a settings change takes effect immediately.
      // Storage failure => default "stable" (fail open for theming, which
      // is harmless and reversible).
      const aiThemeMode = await getAiThemeMode(AsyncStorage).catch(() => "stable" as const);
      // Creative CSS tools are gated on the creative AI theme mode
      // (ai-mode.ts); stable mode sees the 10 stable/try-on tools only.
      const themeTools =
        aiThemeMode === "off"
          ? []
          : aiThemeMode === "creative"
            ? [
                ...createWallpaperTools(AsyncStorage),
                ...createThemeTools(AsyncStorage),
                ...createCreativeThemeTools(AsyncStorage),
              ]
            : [...createWallpaperTools(AsyncStorage), ...createThemeTools(AsyncStorage)];
      // D25: sub-agent tool source. runSubtask (inside the delegate tools
      // below) only executes at call time — during a turn, long after this
      // setup runs — so it reads the effective tool list + ToolContext
      // through these bindings, which are filled right after tool assembly.
      let subagentToolSource: () => LocalTool[] = () => [];
      let subagentToolCtx: ToolContext = { authorize: async () => false };
      let tools: LocalTool[] = opts.tools ?? [
        ...createLocalTools(opts.toolDeps),
        ...createOurSpaceTools(opts.ourSpaceStore ?? ourSpaceStore),
        ...createProductionInitiativeTools(),
        // Aru-gap 轻控制： open_app whitelist tool. threadId = the dialog
        // she's in (watchdog return target).
        ...createProductionOpenAppTools(opts.threadId),
        ...createTaskProgressTools(taskProgressStore),
        ...createAmbientVideoTools(ambientVideoStore),
        ...createPodcastTools(
          voiceStore,
          taskProgressStore,
          getLocale() === "en" ? "en" : "zh-Hans",
          // Incognito: podcast audio goes to cache (temp), not documents.
          { isIncognito: incognito },
        ),
        ...createVoiceMessageTools(
          voiceStore,
          getLocale() === "en" ? "en" : "zh-Hans",
          // Incognito: voice note audio stays in the temp TTS cache, not
          // durable voice-message storage (same rule as her recordings).
          { isIncognito: incognito },
        ),
        ...createImageTools({
          resolveBackends: resolveImageOutputBackends,
          // product P1 (信息断层): every generated image flows into the
          // works drawer automatically — chat history is not its grave.
          // Incognito never touches storage (privacy is the hard line).
          onImageGenerated: async ({ prompt, url, via }) => {
            if (incognito()) return;
            try {
              const store = opts.ourSpaceStore ?? ourSpaceStore;
              const short = prompt.length > 36 ? `${prompt.slice(0, 36)}…` : prompt;
              const date = new Date().toISOString().slice(0, 10);
              await store.addWork("image", short || "AI 画的图", url, `${date} · ${via}`);
            } catch {
              // best effort — the image is already shown in chat.
            }
          },
        }),
        ...createVideoTools({
          resolveBackends: resolveVideoBackends,
          tasks: taskProgressStore,
        }),
        // Plan gate (开启原则): the only on-ramp to multi-model
        // coordination — plan-only before engaging, her call.
        ...createPlanTools(opts.threadId, {
          // P3-9: the coordination master switch is real — default OFF (her
          // 开启原则）. The AI can only propose when she flipped it on.
          isCoordinationEnabled: () => capabilityStore.getSnapshot().coordinationEnabled,
        }),
        ...themeTools,
        ...createFontSizeTools(AsyncStorage),
        ...createBackupTools({
          kv: AsyncStorage,
          secure: {
            getItem: async (key: string) => {
              const { getItemAsync } = await import("expo-secure-store");
              return getItemAsync(key);
            },
            setItem: async (key: string, value: string) => {
              const { setItemAsync } = await import("expo-secure-store");
              return setItemAsync(key, value);
            },
          },
          getKnowledgeStore: () => getKnowledgeStore().catch(() => null),
          saveBackupFile: async (filename: string, json: string) => {
            const FileSystem = await import("expo-file-system/legacy");
            const Sharing = await import("expo-sharing");
            const path = `${FileSystem.cacheDirectory}${filename}`;
            await FileSystem.writeAsStringAsync(path, json);
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(path);
              return `shared via system share sheet (${filename})`;
            }
            return `saved to app cache (${filename})`;
          },
          listBackupFiles: async () => {
            const FileSystem = await import("expo-file-system/legacy");
            const dir = FileSystem.cacheDirectory ?? "";
            const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
            const out: Array<{ name: string; modifiedAt: number }> = [];
            for (const name of names) {
              if (!name.startsWith("dudu-backup-") || !name.endsWith(".json")) continue;
              const info = await FileSystem.getInfoAsync(dir + name).catch(() => null);
              out.push({
                name,
                modifiedAt:
                  info?.exists && "modificationTime" in info
                    ? (info.modificationTime as number)
                    : 0,
              });
            }
            out.sort((a, b) => b.modifiedAt - a.modifiedAt);
            return out;
          },
          readBackupFile: async (name: string) => {
            const FileSystem = await import("expo-file-system/legacy");
            return FileSystem.readAsStringAsync(`${FileSystem.cacheDirectory}${name}`);
          },
          onRestored: async () => {
            await groupStore.refresh();
            await voiceStore.refresh();
            await refreshChatMode();
            await refreshFontSizeOption();
            memoryStore.refresh();
            skillStore.refresh();
            ourSpaceStore.refresh();
            // Re-apply the restored theme bundle (written to storage
            // behind ThemeContext's back). Returns false when no theme
            // UI is mounted — storage already holds it, so worst case it
            // applies on next launch.
            return requestThemeReload().catch(() => false);
          },
          // P2-5: her voice message recordings ride along in the backup so
          // old voice bubbles keep playing after a reinstall / new device.
          collectVoiceFiles: async () => {
            const { listVoiceMessageFiles, readVoiceMessageFile } = await import(
              "../voice/voice-message-files"
            );
            const out: Record<string, string> = {};
            for (const name of await listVoiceMessageFiles()) {
              const b64 = await readVoiceMessageFile(name);
              if (b64) out[name] = b64;
            }
            return out;
          },
          restoreVoiceFiles: async (files) => {
            const { writeVoiceMessageFile, voiceMessageDir, rewriteVoiceMessageUris } =
              await import("../voice/voice-message-files");
            let restored = 0;
            for (const [name, b64] of Object.entries(files)) {
              if (await writeVoiceMessageFile(name, b64)) restored++;
            }
            if (restored === 0) return 0;
            // Re-point voice-message URIs at this device's stable directory:
            // backups store absolute file:// URIs, which change on reinstall.
            const newDir = await voiceMessageDir();
            const allKeys = await AsyncStorage.getAllKeys();
            for (const key of allKeys) {
              if (!key.startsWith("dudu.local-chat.") || !key.endsWith(".v1")) continue;
              const raw = await AsyncStorage.getItem(key).catch(() => null);
              if (!raw?.includes("dudu-voice-messages/")) continue;
              const fixed = rewriteVoiceMessageUris(raw, newDir);
              if (fixed !== raw) await AsyncStorage.setItem(key, fixed).catch(() => {});
            }
            return restored;
          },
        }),
        ...createTtsVoiceTools(voiceStore),
        // Batch 3: alarm tools — let the AI set alarms on request.
        ...createAlarmTools(AsyncStorage, getLocale() === "en" ? "en" : "zh-Hans"),
        ...createDialogTools({ threadId: opts.threadId }),
        // Capability groups (audit round 2, AI-use P1-2): the AI was blind
        // to "分组" — now it can list them read-only and answer her
        // questions. Membership stays hers (Settings → 能力分组).
        ...createCapabilityGroupTools({
          presetName: (presetId: string) => {
            switch (presetId) {
              case "image_input":
                return t("capgroup.preset.image_input");
              case "image_output":
                return t("capgroup.preset.image_output");
              case "video":
                return t("capgroup.preset.video");
              case "voice_input":
                return t("capgroup.preset.voice_input");
              default:
                return presetId;
            }
          },
          getCapabilityGroups: () => capabilityStore.getSnapshot().groups,
          getApiGroups: () => groupStore.getSnapshot().groups,
          isRoutingEnabled: () => capabilityStore.getSnapshot().routingEnabled,
        }),
        // Cross-dialog read/write (vision feature 2): the AI can reach her
        // other dialogs. Every action is traced (留痕) — see
        // src/chat/cross-dialog.ts for the hard constraints.
        // B5-followup: the current persona is resolved lazily per tool call
        // (same pattern as createIsolatedCrossDialogDeps), so the cross-dialog
        // tools never see another persona's dialogs.
        ...createCrossDialogTools({
          threadId: opts.threadId,
          getPersonaId: currentPersonaId,
          storage: AsyncStorage,
          trace: crossDialogTraceStore,
          visibility: crossDialogVisibilityStore,
          isIncognito: incognito,
        }),
        // AI self-organized group chat (vision feature 3): the AI moderates
        // meetings between her other models. Every start/round/end is
        // traced (留痕) — see src/chat/group-meeting-tools.ts for the hard
        // constraints. Member turns call the member's own model endpoint.
        ...createGroupMeetingTools({
          threadId: opts.threadId,
          storage: AsyncStorage,
          meetings: groupMeetingStore,
          trace: crossDialogTraceStore,
          listApiGroups: () => groupStore.getSnapshot().groups,
          generate: generateOneShot,
          isIncognito: incognito,
          // P3-9: the coordination master switch — default OFF.
          isCoordinationEnabled: () => capabilityStore.getSnapshot().coordinationEnabled,
          // P2-8: her_request is mechanically verified against her recent
          // words — the closure reads the live message array.
          recentUserTexts: () =>
            messages
              .filter((m) => m.role === "user")
              .slice(-20)
              .map((m) => (typeof m.content === "string" ? m.content : "")),
        }),
        // Persona group chat (人设群聊, step 1): she chats with several of
        // her personas in one shared group. The AI manages groups here;
        // the turns are driven by the group chat UI. Every action is traced.
        ...createPersonaGroupTools({
          threadId: opts.threadId,
          getPersonaId: currentPersonaId,
          groups: personaGroupStore,
          listPersonas: () => personaStore.list(),
          listApiGroups: () => groupStore.getSnapshot().groups,
          apiGroupPref: personaApiGroupPrefStore,
          trace: crossDialogTraceStore,
          isIncognito: incognito,
        }),
        ...createContextTools({
          setMessages: (msgs) => {
            messages = msgs.map((m, i) => ({
              id: `ctx-${Date.now()}-${i}`,
              role: m.role as "user" | "assistant" | "system",
              content: m.content,
            }));
            // P2-5: a compaction (non-empty replacement) must not silently
            // drop the reply this turn produced — re-anchor it with its
            // current content so the turn result survives in UI/storage.
            // An explicit full clear ([]) is honored as-is: she asked for a
            // fresh start, and the next reply will be a new message.
            const live = lastReply;
            if (msgs.length > 0 && live && !messages.some((m) => m.id === live.id)) {
              messages = [...messages, { id: live.id, role: "assistant", content: live.content }];
            }
            emit();
            persist(messages);
          },
          getMessages: () =>
            messages.map((m) => ({
              role: m.role,
              content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            })),
        }),
        ...createMemoryTools(memStore),
        ...createKnowledgeTools(lazyKnowledgeStore, { getGroup: () => activeGroup }),
        ...createKnowledgeAddTools(lazyKnowledgeStore, {
          getGroup: () => activeGroup,
          readTextFile: async (uri: string) => {
            const FileSystem = await import("expo-file-system/legacy");
            return FileSystem.readAsStringAsync(uri);
          },
        }),
        ...createBrowserTools(),
        ...createSkillTools(opts.skillStore ?? skillStore),
        ...createMusicTools(opts.musicStore ?? musicStore, {
          // "我们的歌": the AI truly remembers which songs are special.
          onOursMarked: async (track) => {
            await memStore.addMemory(
              `我们的歌：「${track.title}」${track.artist ? ` — ${track.artist}` : ""}。这是我们俩的歌，要记得。`,
              {
                category: "relationship",
                confidence: "confident",
                source: "music-room",
                actor: "ai",
              },
            );
          },
          // Apple Music catalog search (RN layer owns the MusicKit bridge).
          appleSearch: async (query, limit) => {
            const { getMusicSource } = await import("../music/sources");
            const src = getMusicSource("apple-music");
            if (!src.isAvailable()) {
              throw new Error(
                "Apple Music is not available in this build (the native MusicKit module is missing — the app needs a fresh native build with the Apple Music plugin). Local tracks still work.",
              );
            }
            const state = await src.getAuthState();
            if (state !== "authorized") {
              const hint =
                state === "not-subscribed"
                  ? "She doesn't have an active Apple Music subscription, so catalog playback won't work."
                  : state === "denied"
                    ? "She declined Apple Music access."
                    : "She hasn't authorized Apple Music yet.";
              throw new Error(
                `${hint} Ask her to authorize Apple Music in the music room first — I can't search the catalog until she does.`,
              );
            }
            const hits = await src.search(query, limit);
            return hits.map((h) => ({ id: h.id, title: h.title, artist: h.artist }));
          },
        }),
        ...sandboxTools(sandboxManager),
        // Batch 4: MCP/external tools — ask_user, web search, delegation,
        // agent CLI, interactive terminal, and MCP server providers.
        // D17: ask_user is scoped to this agent's dialog (threadId) so a
        // question asked here never surfaces in another dialog.
        ...createAskUserTools({ threadId: opts.threadId }),
        // D15: form card for secrets — same dialog scoping as ask_user.
        ...createEnvFormTools({ threadId: opts.threadId }),
        ...createWebSearchTools(),
        ...createDelegateTools({
          // D25: the sub-agent gets REAL tools. allowedTools selects by name
          // from this agent's effective tool list; omitted = the default set
          // (everything except delegate_task + ask_user — see
          // resolveSubagentTools in mcp/delegate.ts). It reuses the parent's
          // ToolContext: her authorization gate still applies, so
          // already-granted capabilities run freely and new ones go through
          // her as usual — the gate is at grant time, not per use.
          runSubtask: async (prompt, allowedTools) => {
            const subTools = resolveSubagentTools(subagentToolSource(), allowedTools);
            return generateOneShot(
              activeGroup,
              "You are a focused sub-agent. Complete the task below concisely. You have tools — use them when they help, and return the finished result as text.",
              prompt,
              {
                tools: subTools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters as unknown as Record<string, unknown>,
                  run: (args) => t.run(args, subagentToolCtx),
                })),
              },
            );
          },
        }),
        ...createCrossDialogCliTools(createIsolatedCrossDialogDeps(AsyncStorage, currentPersonaId)),
        ...createInteractiveTerminalTools(() => {
          try {
            return sandboxManager.activeBackend();
          } catch {
            return null;
          }
        }),
        ...createNativeAppTools({
          getAuthState: async (id) => {
            const { checkers } = await import("../native-apps");
            const fn = checkers[id as keyof typeof checkers];
            return fn ? await fn() : "unavailable";
          },
          listTodayEvents: async () => {
            const Calendar = await import("expo-calendar");
            const { status } = await Calendar.getCalendarPermissionsAsync();
            if (status !== "granted") throw new Error("日历未授权。");
            const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
            const now = new Date();
            const end = new Date(now);
            end.setHours(23, 59, 59, 999);
            const events = await Calendar.getEventsAsync(
              calendars.map((c) => c.id),
              now,
              end,
            );
            return events.map((e) => ({
              title: e.title,
              start: new Date(e.startDate).toLocaleString(),
              end: new Date(e.endDate).toLocaleString(),
              id: e.id,
            }));
          },
          createEvent: async (input) => {
            const Calendar = await import("expo-calendar");
            const { status } = await Calendar.getCalendarPermissionsAsync();
            if (status !== "granted") throw new Error("日历未授权。");
            const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
            const writable = calendars.find((c) => c.allowsModifications);
            if (!writable) throw new Error("没有可写的日历。");
            return Calendar.createEventAsync(writable.id, {
              title: input.title,
              startDate: new Date(input.start),
              endDate: new Date(input.end),
              notes: input.notes,
            });
          },
          listReminders: async () => {
            const Calendar = await import("expo-calendar");
            const { status } = await Calendar.getRemindersPermissionsAsync();
            if (status !== "granted") throw new Error("提醒事项未授权。");
            const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
            const reminders = await Calendar.getRemindersAsync(
              calendars.map((c) => c.id),
              null,
              null,
              null,
            );
            return reminders.map((r) => ({
              title: r.title ?? "",
              due: r.dueDate ? new Date(r.dueDate).toLocaleString() : null,
              id: r.id ?? "",
              completed: r.completed ?? false,
            }));
          },
          createReminder: async (input) => {
            const Calendar = await import("expo-calendar");
            const { status } = await Calendar.getRemindersPermissionsAsync();
            if (status !== "granted") throw new Error("提醒事项未授权。");
            const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
            const writable = calendars.find((c) => c.allowsModifications);
            if (!writable) throw new Error("没有可写的提醒事项列表。");
            return Calendar.createReminderAsync(writable.id, {
              title: input.title,
              dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
              notes: input.notes,
            });
          },
          searchContacts: async (query) => {
            const Contacts = await import("expo-contacts");
            const { status } = await Contacts.getPermissionsAsync();
            if (status !== "granted") throw new Error("通讯录未授权。");
            const { data } = await Contacts.getContactsAsync({
              fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
            });
            const q = query.toLowerCase();
            return data
              .filter((c) => (c.name ?? "").toLowerCase().includes(q))
              .slice(0, 10)
              .map((c) => ({
                name: c.name ?? "",
                phone: c.phoneNumbers?.[0]?.number ?? null,
                id: c.id ?? "",
              }));
          },
          getTodaySteps: async () => {
            const { readTodaySteps } = await import("../native-apps");
            return readTodaySteps();
          },
          getSleepSessions: async () => {
            const { readSleepSessions } = await import("../native-apps");
            return readSleepSessions();
          },
          getBatteryStatus: async () => {
            const { getDeviceInfo } = await import("../native-apps");
            return getDeviceInfo();
          },
        }),
      ];
      // Tool assembly (P0 fix): the registry MUST be built from the FINAL
      // tool list — base tools + MCP server tools, minus incognito-blocked
      // ones. The old order built the registry first and appended MCP tools
      // afterwards, which left them invisible to definitions()/execute().
      // Incognito (P1-3): a session that promised zero trace must not even
      // SEE the write tools — and MCP server tools are never loaded at all
      // in incognito, so the guarantee is structural, not order-dependent.
      // The tool loop below also refuses blocked tools loudly as a backstop.
      const { allTools, effectiveTools } = await assembleAgentTools({
        baseTools: tools,
        externalSupplied: !!opts.tools,
        isIncognito: incognito(),
        loadExternalTools: async () => {
          // Batch 4: MCP server tools — async providers. Per-tool approval
          // ("allow"/"deny") is enforced by the client via getApproval;
          // "ask" raises the real in-session approval card (D13):
          // she taps Allow / Deny / Remember-my-choice, and her choice
          // takes real effect. Remembered choices persist into
          // toolApprovals. A 5-minute no-answer timeout fails closed.
          const mcpProviders = await createMcpProviders({
            env: await envStore.getValues().catch(() => ({})),
            requestApproval: (serverId, serverName, toolName, args) =>
              requestMcpToolApproval({
                threadId: opts.threadId,
                serverId,
                serverName,
                toolName,
                args,
              }),
            runOAuthFlow: async (server) => {
              // The OAuth browser flow is driven from the MCP settings UI.
              // If we get here without tokens, the server needs re-auth.
              throw new Error(
                `MCP server "${server.name}" needs OAuth authorization. ` +
                  `Open Settings → MCP servers → authorize "${server.name}" first.`,
              );
            },
            strings: {
              toolDesc: (serverName, toolDesc) => `[MCP:${serverName}] ${toolDesc}`,
            },
          });
          const mcpTools: LocalTool[] = await listMcpToolsWithHonestErrors(mcpProviders);
          return mcpTools;
        },
        applyDescOverrides: (t) => descOverrideStore.apply(t),
      });
      // allTools keeps the old `tools` semantics for the failure manual-note
      // lookup below; effectiveTools feeds the prompt and the registry.
      tools = allTools;
      // Harness Phase 1: the tool registry is real — API groups, model
      // backends, the MCP tool pool, and browser tools all resolve through
      // this one registry. needsApproval is declared per tool manifest.
      const registry = createHarnessRegistryFromLocalTools(effectiveTools);
      const toolCtx: ToolContext = opts.toolContext ?? {
        // No gate wired (tests) — in-app tools run, capability tools fail closed.
        authorize: async () => false,
      };
      // D25: sub-agents (delegate_task) draw from the same effective tool
      // list the model sees, and run under the same authorization gate.
      subagentToolSource = () => effectiveTools;
      subagentToolCtx = toolCtx;
      // Memory read path: profile + top-k relevant memories for this turn.
      // The last user message drives relevance; empty section when no memories.
      const lastUserText = contentToText(
        [...messages].reverse().find((m) => m.role === "user")?.content ?? "",
      );
      // P2-2: incognito clears the AI's view. No old memories, anniversaries,
      // mood, nicknames, or her rhythm ride the prompt — the session behaves
      // like a first meeting. (Reads stay available if it asks; nothing is
      // pushed.) The interface copy (chat.incognitoNote) says exactly this.
      const incognitoOn = incognito();
      const memorySection = incognitoOn ? "" : await buildMemorySection(memStore, lastUserText);
      // Skills index: one line per enabled skill (token-minimal, same pattern
      // as the manual index). Empty string when she has no enabled skills.
      const skillSection = await (opts.skillStore ?? skillStore).buildSkillIndex();
      // Anniversary awareness: when a 纪念日 is today or within 7 days, one
      // subtle line so he remembers and can prepare — the quiet-reminder pattern.
      // Empty string when nothing is near: no noise, no spam.
      let anniversarySection = "";
      if (!incognitoOn) {
        try {
          const anniversaries = await (opts.ourSpaceStore ?? ourSpaceStore).listAnniversaries();
          anniversarySection = buildAnniversarySection(anniversaries);
        } catch {
          // Anniversary read failure: skip silently, never break the prompt.
        }
      }
      // Her-mood awareness: when she told him how she feels, one subtle
      // line so he remembers — the quiet-reminder pattern. Empty when stale.
      let herMoodSection = "";
      if (!incognitoOn) {
        try {
          const herMood = await (opts.ourSpaceStore ?? ourSpaceStore).getHerMood();
          herMoodSection = buildHerMoodSection(herMood);
        } catch {
          // Mood read failure: skip silently, never break the prompt.
        }
      }
      // Her rhythm (作息感知, xiaomeng P2-3): she sleeps days and lives
      // nights. One line so he reads "now" on HER clock — the time
      // injection alone lies about what 4am means to her. PURE builder,
      // never throws; no store reads needed (fixed schedule, V1).
      const herRhythmSection = incognitoOn ? "" : buildHerRhythmSection(Date.now());
      // Nickname awareness: what he calls her / what she calls him.
      // Empty when unset: no noise, no spam.
      let nicknameSection = "";
      if (!incognitoOn) {
        try {
          const couple = await (opts.ourSpaceStore ?? ourSpaceStore).getCoupleProfile();
          nicknameSection = buildNicknameSection(couple);
        } catch {
          // Couple read failure: skip silently, never break the prompt.
        }
      }
      // Proactive outreach (主动触达) surfacing: when the trigger engine
      // finds something genuinely worth mentioning, one quiet line rides
      // the prompt so he brings it up naturally in conversation. Empty
      // string when nothing is near — the quiet-reminder pattern.
      // Incognito: never evaluated or injected — the session behaves like
      // a first meeting (same rule as memory/anniversary/mood).
      let outreachSection = "";
      if (!incognitoOn) {
        try {
          // Dynamic import: the singleton is AsyncStorage-backed (RN), and
          // local-agent must stay importable in node tests. Tests inject
          // opts.outreachStore and never touch this branch.
          const oStore =
            opts.outreachStore ?? (await import("../outreach/instances")).outreachStore;
          const frequency = await oStore.getFrequency();
          if (frequency !== "quiet") {
            const oAnniversaries = await (opts.ourSpaceStore ?? ourSpaceStore)
              .listAnniversaries()
              .catch(() => [] as Anniversary[]);
            const oTellLater = await (opts.ourSpaceStore ?? ourSpaceStore)
              .listTellLater(false)
              .catch(() => [] as { id: string; text: string; done: boolean }[]);
            const oLoveLetters = await (opts.ourSpaceStore ?? ourSpaceStore)
              .getUnseenLoveLetters()
              .catch(() => [] as unknown[]);
            const oUpcoming = getUpcomingAnniversaries(oAnniversaries, new Date(), 30).map((a) => ({
              title: a.title,
              daysUntil: a.daysUntil,
            }));
            // Diary nudge (xiaomeng P2-1): same input shape as the background
            // scheduler. In-session, the anchor lets him write a diary entry
            // quietly instead of only nudging via notification.
            let oDiaryNudge: { lastEntryAt: number | null; anchor: string } | undefined;
            try {
              const os = opts.ourSpaceStore ?? ourSpaceStore;
              const diary = await os.listDiary(1).catch(() => []);
              const timeline = await os.listTimeline(5).catch(() => []);
              const fresh = timeline.find(
                (e) => Date.now() - e.timestamp < 7 * 86_400_000 && e.title.trim().length > 0,
              );
              oDiaryNudge = {
                lastEntryAt: diary.length > 0 ? diary[0].createdAt : null,
                anchor: fresh ? fresh.title.trim() : "",
              };
            } catch {
              oDiaryNudge = undefined;
            }
            const oLastOutreachAt: Partial<Record<OutreachTriggerKind, number>> = await oStore
              .getLastOutreachAt()
              .catch(() => ({}));
            // On-this-day (round 3, xiaomeng P1-1 review fix): the in-session
            // evaluation must receive the same onThisDay input the background
            // scheduler passes (local-app.tsx listOnThisDay) — without it the
            // on_this_day prompt line can never fire. Null = no memory today.
            const oOnThisDay = await buildOnThisDayInput(opts.ourSpaceStore ?? ourSpaceStore);
            // Feed nudge (C3): her recent posts + the persisted nudged-set, so
            // the in-session prompt can tell him to like + reply once via his
            // feed_like / feed_reply tools. Same input shape as the background
            // scheduler. Absent = no feed data → trigger stays off.
            let oFeedNudge: { posts: FeedNudgePost[]; nudgedPostIds: string[] } | undefined;
            try {
              const os = opts.ourSpaceStore ?? ourSpaceStore;
              const oPosts = await os.listFeed(20).catch(() => []);
              const oMapped: FeedNudgePost[] = [];
              for (const p of oPosts) {
                let hasAiReply = false;
                try {
                  const replies = await os.listReplies(p.id).catch(() => []);
                  hasAiReply = replies.some((r) => r.author === "ai");
                } catch {
                  hasAiReply = false;
                }
                oMapped.push({
                  id: p.id,
                  author: p.author,
                  text: p.text,
                  imageUri: p.imageUri,
                  createdAt: p.createdAt,
                  likedByAi: p.likedByAi,
                  hasAiReply,
                });
              }
              const oNudged = await oStore.getNudgedFeedPostIds().catch(() => [] as string[]);
              oFeedNudge = { posts: oMapped, nudgedPostIds: oNudged };
            } catch {
              oFeedNudge = undefined;
            }
            const oTriggers = evaluateOutreachTriggers({
              frequency,
              now: Date.now(),
              anniversaries: oUpcoming,
              pendingTellLater: oTellLater
                .filter((i) => !i.done)
                .map((i) => ({ id: i.id, text: i.text })),
              unreadLoveLetters: oLoveLetters.length,
              lastOpenedAt: await oStore.getLastOpenedAt().catch(() => null),
              lastOutreachAt: oLastOutreachAt,
              diaryNudge: oDiaryNudge,
              onThisDay: oOnThisDay,
              feedNudge: oFeedNudge,
            });
            // xiaomeng P3-2: a silence notification fired within the last 24h
            // already said "missed you" — don't double up in-session.
            const oFiltered = oTriggers.filter(
              (t) =>
                t.kind !== "silence" || Date.now() - (oLastOutreachAt.silence ?? 0) > 86_400_000,
            );
            outreachSection = buildOutreachSection(oFiltered);
          }
        } catch {
          // Outreach eval failure: skip silently, never break the prompt.
        }
      }
      // Intelligent API adaptation: resolve effective tools/thinking state.
      // Precedence: her manual override (group) → learned profile → auto
      // (optimistic ON — her rule: everything ON unless proven impossible).
      const profile = await modelProfileStore
        .getProfile(activeGroup.baseUrl, activeGroup.model)
        .catch(() => null);
      const resolveSwitch = (
        override: FeatureSwitch | undefined,
        learned: FeatureSwitch,
      ): boolean => {
        const v = override ?? learned;
        return v !== "off"; // "auto" and "on" both mean ON (optimistic)
      };
      let toolsOn = resolveSwitch(activeGroup.toolsMode, profile?.tools ?? "auto");
      let thinkingOn = resolveSwitch(activeGroup.thinkingMode, profile?.thinking ?? "auto");
      // Batch 5: persona + GLOBAL.md + world books. All best-effort — a
      // storage hiccup must never break the turn.
      let activePersona: Persona | null = null;
      let personaPrompt = "";
      let globalMdBlock = "";
      let worldBookBefore = "";
      let worldBookAfter = "";
      if (!incognito()) {
        try {
          const activeId = await personaStore.getActiveId().catch(() => null);
          if (activeId) {
            activePersona = await personaStore.get(activeId).catch(() => null);
            if (activePersona?.enabled && activePersona.systemPrompt.trim()) {
              personaPrompt = activePersona.systemPrompt.trim();
            }
          }
        } catch {
          // ignore
        }
        try {
          globalMdBlock = renderGlobalMdBlock(await globalMdStore.get().catch(() => ""));
        } catch {
          // ignore
        }
        try {
          const books = await worldBookStore.enabledBooks().catch(() => []);
          if (books.length > 0) {
            const scan: ScanMessage[] = visible()
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => ({ role: m.role, content: contentToText(m.content) }));
            const { entries } = evaluateWorldBooks(books, scan);
            const grouped = groupWorldBookEntries(entries);
            worldBookBefore = renderWorldBookBlock(grouped.beforeSystem);
            worldBookAfter = renderWorldBookBlock(grouped.afterSystem);
          }
        } catch {
          // ignore
        }
      }
      // A16: per-dialog system prompt override — her rule for THIS dialog,
      // appended after the persona sections. Empty when unset: no noise.
      const dialogSystemPrompt =
        threadMeta.systemPrompt?.trim() && !incognito()
          ? `Her instruction for this dialog (it overrides persona defaults for this conversation only):\n${threadMeta.systemPrompt.trim()}`
          : "";
      const systemPrompt = buildLocalSystemPrompt(
        effectiveTools,
        t,
        [worldBookBefore, personaPrompt, opts.systemPrompt].filter(Boolean).join("\n\n") ||
          undefined,
        [
          memorySection,
          skillSection,
          anniversarySection,
          herMoodSection,
          herRhythmSection,
          nicknameSection,
          outreachSection,
          // Batch 5: GLOBAL.md + world book (after-system) entries ride as
          // extra sections so they land after the base prompt.
          ...(globalMdBlock ? [globalMdBlock] : []),
          ...(worldBookAfter ? [worldBookAfter] : []),
          // 智商排行榜纸条: compact model-ranking slip, refreshed per turn so
          // her ranking mode (均衡/聪明优先/速度优先) applies immediately.
          buildRankingSlip(capSnap.rankingMode),
          ...(dialogSystemPrompt ? [dialogSystemPrompt] : []),
        ],
        { isIncognito: incognito(), aiName: activePersona?.name },
      );
      const allWireTools = registry.definitions();
      // wireTools is mutable: auto-fallback may clear it on retry.
      let wireTools = toolsOn ? allWireTools : [];

      // Build the wire messages, resolving image attachments via vision.
      // History tool calls/results ride along so multi-turn tool use works.
      // Capability routing: planVision decides which model actually sees
      // attached images (current model fast path → image_input group →
      // honest failure). The plan is computed once per turn from the
      // capability store snapshot.
      const wireCapSnap = capabilityStore.getSnapshot();
      const visionPlanFor = (g: ApiGroup): VisionPlan =>
        planVision(
          g,
          wireCapSnap.groups,
          groupStore.getSnapshot().groups,
          wireCapSnap.routingEnabled,
        );
      // A15/A27: auto-compress when the visible context approaches the budget
      // (her per-dialog budget, else a safe 100k default). The summary note
      // stays in history and the reply announces it — never silent.
      let preTurnNotice = "";
      {
        const budget =
          threadMeta.tokenBudget && threadMeta.tokenBudget > 0 ? threadMeta.tokenBudget : 100000;
        const usage = estimateMessagesTokens(visible(), (m) => contentToText(m.content));
        if (usage > budget * 0.9 && !incognito()) {
          const done = await autoCompressNow(activeGroup, 10).catch(() => false);
          if (done) preTurnNotice = t("chat.autoCompressed") as string;
        }
      }

      // Harness: the wire is `let` so pre-step hooks can rewrite it.
      let wire: ChatMessage[] = [];
      wire.push({ role: "system", content: systemPrompt });
      // A2: the wire carries the SELECTED version of each group only —
      // sending every version would feed the model duplicate replies.
      for (const m of visible()) {
        if (m.role === "user") {
          wire.push(
            await toWireUserMessage(
              group,
              contentToText(m.content),
              visionCache,
              visionPlanFor(group),
            ),
          );
        } else if (m.role === "assistant") {
          const entry: ChatMessage = { role: "assistant", content: contentToText(m.content) };
          if (m.toolCalls && m.toolCalls.length > 0) {
            entry.tool_calls = m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            }));
          }
          wire.push(entry);
        } else if (m.role === "tool" && m.toolCallId) {
          wire.push({ role: "tool", content: m.content, tool_call_id: m.toolCallId });
        }
        // "system" messages in history are not re-sent (the fresh system
        // prompt above is authoritative).
      }

      /**
       * Run one model completion, streaming into a fresh assistant message.
       * Returns the completed tool calls (empty when the model just answered).
       */
      async function runCompletion(): Promise<{
        replyId: string;
        toolCalls: CompletedToolCall[];
      }> {
        const replyId = newId("asst");
        let replyText = "";
        let thinkingText = "";
        let toolCalls: CompletedToolCall[] = [];
        // A2: a regeneration reuses the target's version group; a normal
        // reply starts a group of its own (groupId defaults to its id).
        const fv = forcedVersion;
        forcedVersion = null;
        // Insert the (initially empty) assistant message so the UI streams in place.
        messages = [
          ...messages,
          {
            id: replyId,
            role: "assistant",
            content: "",
            ...(fv ? { groupId: fv.groupId, versionIndex: fv.index } : {}),
          },
        ];
        if (fv) {
          // The new version becomes the selected one immediately so the UI
          // streams the fresh reply, not the old version.
          threadMeta = {
            ...threadMeta,
            selectedVersions: { ...threadMeta.selectedVersions, [fv.groupId]: replyId },
          };
        }
        emit();

        // Adaptation notices shown above the reply (never silent downgrades).
        // preTurnNotice carries the auto-compress announcement (A15).
        let noticeText = preTurnNotice;
        const renderReply = () => {
          const content = noticeText ? `${noticeText}\n\n${replyText}` : replyText;
          messages = messages.map((m) => (m.id === replyId ? { ...m, content } : m));
          lastReply = { id: replyId, content }; // P2-5: re-anchor target
          emit();
        };

        /**
         * Try to adapt to a classified failure. Returns true when we
         * downgraded something and the caller should retry. Her manual
         * "on" overrides are never auto-disabled.
         */
        async function tryAdapt(cls: ErrorClass): Promise<boolean> {
          if (cls === "tools_unsupported" && toolsOn && activeGroup.toolsMode !== "on") {
            toolsOn = false;
            wireTools = [];
            await modelProfileStore
              .learned(
                activeGroup.baseUrl,
                activeGroup.model,
                { tools: "off" },
                "tools proven unsupported",
              )
              .catch(() => null);
            noticeText = noticeText
              ? `${noticeText}\n${t("adapt.toolsOff")}`
              : (t("adapt.toolsOff") as string);
            renderReply();
            return true;
          }
          if (cls === "thinking_unsupported" && thinkingOn && activeGroup.thinkingMode !== "on") {
            thinkingOn = false;
            await modelProfileStore
              .learned(
                activeGroup.baseUrl,
                activeGroup.model,
                { thinking: "off" },
                "thinking proven unsupported",
              )
              .catch(() => null);
            noticeText = noticeText
              ? `${noticeText}\n${t("adapt.thinkingOff")}`
              : (t("adapt.thinkingOff") as string);
            renderReply();
            return true;
          }
          return false;
        }

        // Retry loop: at most one adaptation per failure class, then give up
        // honestly. context_too_long compacts the wire once.
        let compacted = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            // Harness Phase 1: step events + pre-step hooks. model-visible
            // means logged: step/start and the request header go to the
            // session log before the model request fires. A pre-step hook
            // may rewrite the wire or reject the step with an honest reason.
            const stepId = newId("step");
            const thisStepIndex = stepIndex++;
            turnHarness.setStepId(stepId);
            turnHarness.logEvent(
              "step/start",
              logPayload.stepStart({ iteration: thisStepIndex }),
              stepId,
            );
            let endpoint = "";
            try {
              endpoint = new URL(activeGroup.baseUrl).origin;
            } catch {
              endpoint = "unknown";
            }
            turnHarness.logEvent(
              "request/header",
              logPayload.requestHeader({
                model: activeGroup.model,
                endpoint,
                toolCount: wireTools.length,
                wireMessages: wire.length,
              }),
              stepId,
            );
            const preStep = await agentHarness.hooks.runPreStep({
              wire: wire as unknown as import("../harness/hooks").HookWireMessage[],
              stepIndex: thisStepIndex,
            });
            if ("rejected" in preStep) throw new Error(preStep.rejected);
            wire = preStep.wire as unknown as ChatMessage[];
            await streamChat(
              activeGroup,
              wire,
              {
                signal: aborter?.signal,
                tools: wireTools,
                onToken: (delta) => {
                  replyText += delta;
                  renderReply();
                },
                onThinking: thinkingOn
                  ? (delta) => {
                      thinkingText += delta;
                      messages = messages.map((m) =>
                        m.id === replyId ? { ...m, thinking: thinkingText } : m,
                      );
                      emit();
                    }
                  : undefined,
                onToolCalls: (calls) => {
                  toolCalls = calls;
                },
                onDone: () => {},
                // streamChat rejects on error — onError here is informational only.
                onError: () => {},
              },
              // A27: her per-turn output ceiling for this dialog.
              threadMeta.maxTokens && threadMeta.maxTokens > 0
                ? { maxTokens: threadMeta.maxTokens }
                : undefined,
            );
            break; // success
          } catch (e) {
            const cls = classifyError(e);
            // Context too long: compact once (keep system + last 6), then retry.
            if (cls === "context_too_long" && !compacted) {
              compacted = true;
              const sys = wire.filter((m) => m.role === "system");
              const tail = wire.filter((m) => m.role !== "system").slice(-6);
              wire.length = 0;
              wire.push(...sys, ...tail);
              noticeText = noticeText
                ? `${noticeText}\n${t("adapt.contextCompacted")}`
                : (t("adapt.contextCompacted") as string);
              renderReply();
              continue;
            }
            if (await tryAdapt(cls)) continue;
            // D27: bucket failover — a retryable failure (rate limit /
            // network) of the GLOBAL active group moves it to the next
            // member of her user bucket, so "主力挂了自动切白嫖" actually
            // happens. Per-dialog overrides are her explicit choice and
            // are never auto-switched. Auth errors never fail over (a bad
            // key won't heal on another group... the next group has its
            // own key, but silently hopping on 401s would hide the real
            // problem — she should see which key is bad).
            let failoverNote = "";
            if (
              (cls === "rate_limit" || cls === "network_error") &&
              groupStore.getSnapshot().activeId === activeGroup.id
            ) {
              try {
                const { loadUserGroups } = await import("./provider-groups");
                const next = await groupStore.failoverToNextInBucket(
                  activeGroup.id,
                  await loadUserGroups(),
                );
                if (next) {
                  failoverNote = t("apigroup.bucket.failover", {
                    from: activeGroup.name,
                    to: next.name,
                  }) as string;
                }
              } catch {
                // Failover is best-effort; the original error below is
                // what matters.
              }
            }
            // Mark the failure on the reply bubble so the user sees WHICH
            // group failed, then rethrow for the screen's error path.
            const label =
              e instanceof GroupError ? `[${activeGroup.name}] ${e.message}` : String(e);
            const bubbleText = failoverNote ? `${label}\n${failoverNote}` : label;
            messages = messages.map((m) =>
              m.id === replyId && !replyText ? { ...m, content: bubbleText } : m,
            );
            emit();
            throw e;
          }
        }

        // Attach tool calls to the message so the drawer can show them.
        if (toolCalls.length > 0) {
          const localCalls: LocalToolCall[] = toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          }));
          messages = messages.map((m) => (m.id === replyId ? { ...m, toolCalls: localCalls } : m));
          // The wire needs the tool_calls on the assistant message for the
          // next iteration (OpenAI requires it before tool results).
          wire.push({
            role: "assistant",
            content: replyText,
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            })),
          });
          emit();
        }
        // Batch 5: apply the active persona's regex rules to the final AI
        // output (post-processing, after streaming completes — never mid-stream).
        if (activePersona && !incognito()) {
          try {
            const rules = activePersona.regexRules ?? [];
            if (rules.length > 0 && replyText) {
              replyText = applyPersonaRegex(replyText, rules);
              renderReply();
            }
          } catch {
            // A bad rule must never break the reply.
          }
        }
        // Harness: the completed reply is model-visible — log it, then
        // close the step. (A thrown step leaves step/end missing, which
        // honestly records "this step failed".)
        turnHarness.logEvent(
          "assistant/message",
          logPayload.assistantMessage({
            text: replyText,
            toolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name, args: c.arguments })),
          }),
        );
        turnHarness.logEvent("step/end", JSON.stringify({ replyId }));
        turnHarness.setStepId(undefined);
        return { replyId, toolCalls };
      }

      try {
        // Tool-calling loop: hard cap, no infinite loops.
        // (readManuals is declared at turn start so harness hooks see it.)
        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          const { toolCalls } = await runCompletion();
          if (toolCalls.length === 0) break;

          // Execute each tool call, feed results back as tool messages.
          for (const tc of toolCalls) {
            let result: string;
            // Harness: `failed` is true only when execution threw (the
            // catch branch ran) — the post-execute hook uses it to decide
            // the manual note, exactly like the old inline code.
            let failed = false;
            let args: Record<string, unknown> = {};
            turnHarness.setToolCallId(tc.id);
            try {
              args = parseToolArgs(tc.arguments);
              const manifest = registry.resolve(tc.name) ?? {
                name: tc.name,
                description: "",
                parameters: { type: "object", properties: {} },
                needsApproval: false,
                run: async () => {
                  throw new Error(`Unknown tool: ${tc.name}.`);
                },
              };
              // Harness: tools/pre-execute — the approval checkpoint.
              // The default hook carries the old incognito backstop
              // (verbatim); a deny fails closed with an honest reason.
              const pre = await agentHarness.hooks.runToolsPreExecute({
                tool: manifest,
                args,
                ctx: toolCtx,
                approvals: turnHarness.approvals,
              });
              if (!pre.allow) {
                result = `Error: ${pre.reason ?? `Tool "${tc.name}" was blocked by policy.`}`;
              } else {
                // Track the executing tool so the UI can show fine-grained
                // activity (avatar "making something"). Emit on both edges so
                // subscribers re-render into/out of the state.
                activeToolName = tc.name;
                emit();
                try {
                  // Harness: authorize is cache-first write-through — a
                  // second call of the same tool in one turn doesn't
                  // prompt her twice. The tool's own in-run authorize
                  // (with the specific action) stays the approval UI.
                  result = await registry.execute(
                    tc.name,
                    args,
                    turnHarness.wrapContext(toolCtx, tc.name),
                  );
                } finally {
                  activeToolName = null;
                  emit();
                }
              }
              if (tc.name === READ_MANUAL_TOOL_NAME) {
                const mid = args.manual_id;
                if (typeof mid === "string" && mid) readManuals.add(mid);
              }
            } catch (e) {
              // Auth denials, unknown tools, executor failures — all become
              // tool ERRORS the model sees, never silent drops.
              failed = true;
              result = `Error: ${e instanceof Error ? e.message : String(e)}`;
            }
            // Harness: tools/post-execute — session log (tool/call +
            // tool/result) + the proactive manual note on failure. Notes
            // are appended exactly like the old inline code.
            const { notes } = await agentHarness.hooks.runToolsPostExecute({
              tool: registry.resolve(tc.name) ?? {
                name: tc.name,
                description: "",
                parameters: { type: "object", properties: {} },
                needsApproval: false,
                run: async () => "",
              },
              args,
              result,
              failed,
              ctx: toolCtx,
            });
            for (const note of notes) result += `\n${note}`;
            turnHarness.setToolCallId(undefined);
            const toolMsgId = newId("tool");
            // Screenshot results carry a real image: convert the marker
            // into vision content the model can actually see. Follows the
            // same two paths as user-sent photos (native image_url vs
            // describe pipeline). If the model can't see at all, say so
            // honestly instead of pretending.
            let toolContent: string | ChatContentBlock[] = result;
            const shotMatch = /^(\[SCREENSHOT\])\n(\S+)\s*$/.exec(result.trim());
            if (shotMatch) {
              const shotUri = shotMatch[2];
              try {
                toolContent = await screenshotToolContent(activeGroup, shotUri);
              } catch (e) {
                toolContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
              }
            }
            messages = [
              ...messages,
              { id: toolMsgId, role: "tool", content: toolContent, toolCallId: tc.id },
            ];
            wire.push({ role: "tool", content: toolContent, tool_call_id: tc.id });
            emit();
          }
          // Loop: the model sees tool results and either answers or calls more.
        }
      } finally {
        running = false;
        aborter = null;
        emit();
        persist(messages);
        // Harness: close the turn in the session log (fire-and-forget,
        // incognito-gated inside logEvent).
        turnHarness.logEvent("turn/end", JSON.stringify({}));
        // Memory write path: async extraction, OFF the critical path.
        // Incognito turns never enter the pipeline (gated inside).
        // Fire-and-forget: extraction must never break the chat.
        // A2: extract from the VISIBLE history (selected versions only).
        const visForMemory = visible();
        const lastUser = contentToText(
          [...visForMemory].reverse().find((m) => m.role === "user")?.content ?? "",
        );
        const lastAsst = contentToText(
          [...visForMemory].reverse().find((m) => m.role === "assistant")?.content ?? "",
        );
        if (lastUser || lastAsst) {
          // User kill-switch for auto-extract (checked async, fire-and-forget).
          void memStore
            .getAutoExtract()
            .catch(() => true)
            .then((autoExtract) => {
              extractMemoriesAsync(
                memStore,
                { userText: lastUser, assistantText: lastAsst },
                incognito(),
                async (prompt: string) => {
                  let text = "";
                  // B13: dedicated model slot for memory extraction when set.
                  const slotGroup = await withSlotModel(activeGroup, "memory");
                  await streamChat(slotGroup, [{ role: "user", content: prompt }], {
                    onToken: (d: string) => {
                      text += d;
                    },
                    onThinking: () => {},
                    onToolCalls: () => {},
                    onDone: () => {},
                    onError: () => {},
                  });
                  return text;
                },
                { autoExtract },
              );
            });
        }
      }
    },
    async regenerateAt(messageId: string): Promise<void> {
      // A1: regenerate the assistant reply at messageId. The target and all
      // trailing messages are dropped (they answered the old context); the
      // fresh reply streams as a new version of the same group (A2).
      const group = opts.getGroup();
      if (!group) throw new GroupError("?", "noApiGroup");
      if (running) return;
      const t = truncateForRegenerate(messages, threadMeta, messageId);
      if (!t) throw new Error("message not found");
      forcedVersion = { groupId: t.groupId, index: nextVersionIndex(messages, t.groupId) };
      messages = t.kept;
      emit();
      persist(messages);
      await agent.runTurn();
    },
    async deleteMessage(messageId: string, deleteVersions: boolean): Promise<void> {
      // A5: delete one message; optionally every version of its group.
      // Selections that pointed at deleted messages re-point automatically.
      const r = deleteMessageFrom(messages, threadMeta, messageId, deleteVersions);
      threadMeta = r.meta;
      messages = r.messages;
      emit();
      persist(messages);
    },
    async editAndRegenerate(messageId: string, newText: string): Promise<void> {
      // A4: replace a user message's text, drop everything after it (it
      // answered the old wording), and stream a fresh reply.
      const group = opts.getGroup();
      if (!group) throw new GroupError("?", "noApiGroup");
      if (running) return;
      const t = truncateForEdit(messages, threadMeta, messageId);
      if (!t) throw new Error("message not found");
      messages = [...t.kept, { ...t.target, content: newText }];
      emit();
      persist(messages);
      await agent.runTurn();
    },
    getThreadMeta(): ThreadMeta {
      return threadMeta;
    },
    setThreadMeta(meta: ThreadMeta): void {
      threadMeta = meta;
      emit();
      persist(messages);
    },
    getContextUsage(): { tokens: number; messages: number } {
      // A13: estimated usage over the visible history.
      const vis = visible();
      return {
        tokens: estimateMessagesTokens(vis, (m) => contentToText(m.content)),
        messages: vis.length,
      };
    },
    async compressContext(
      keepTail = 6,
      customPrompt?: string,
    ): Promise<{ summary: string; newThreadId: string } | null> {
      // A14: user-triggered compression — Kelivo's model. The summary opens
      // a NEW dialog (old dialog untouched); the UI switches to it.
      const group = opts.getGroup();
      if (!group) throw new GroupError("?", "noApiGroup");
      if (running) return null;
      return compressNow(group, keepTail, customPrompt);
    },
    async stop(): Promise<void> {
      aborter?.abort();
    },
    async retryHistorySave(): Promise<boolean> {
      // Incognito sessions never persist: nothing to retry.
      if (incognito()) return true;
      const ok = await saveLocalHistory(opts.threadId, messages, store);
      // Re-emit so the UI picks up the cleared/set flag immediately.
      emit();
      return ok;
    },
  };
  return agent;
}
