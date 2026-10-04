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
import { refreshFontSizeOption } from "../app-settings.js";
import { createBackupTools } from "../backup-tools.js";
import { createBrowserTools } from "../browser/tools.js";
import { buildCapabilityPromptSection } from "../capabilities";
import { createContextTools } from "../chat/context-tools.js";
import { createCrossDialogTools } from "../chat/cross-dialog.js";
import {
  crossDialogTraceStore,
  crossDialogVisibilityStore,
} from "../chat/cross-dialog-instance.js";
import { createDialogTools } from "../chat/dialog-tools.js";
import { groupMeetingStore } from "../chat/group-meeting-instance.js";
import { createGroupMeetingTools, generateOneShot } from "../chat/group-meeting-tools.js";
import { getLocale, type StringKey, t } from "../i18n";
import { createImageTools, type ImageOutputBackend } from "../image/tools.js";
import { getKnowledgeStore } from "../knowledge/instance.js";
import { lazyKnowledgeStore } from "../knowledge/lazy-store.js";
import { createKnowledgeAddTools, createKnowledgeTools } from "../knowledge/tools.js";
import { buildManualIndex, manualNote } from "../manuals/index.js";
import { buildMemorySection, createMemoryTools, extractMemoriesAsync } from "../memory/index.js";
import { memoryStore } from "../memory/instance.js";
import type { MemoryStore } from "../memory/store.js";
import { musicStore } from "../music/instance.js";
import { createMusicTools } from "../music/tools.js";
import { createNativeAppTools } from "../native-apps-tools.js";
import { buildAnniversarySection } from "../our-space/anniversary-section.js";
import { buildHerMoodSection } from "../our-space/her-mood-section.js";
import { ourSpaceStore } from "../our-space/instance.js";
import { buildNicknameSection } from "../our-space/nickname-section.js";
import { taskProgressStore } from "../our-space/task-progress-instance.js";
import {
  createAmbientVideoTools,
  createOurSpaceTools,
  createTaskProgressTools,
} from "../our-space/tools.js";
import { createPetSkinTools } from "../pet/tools.js";
import { sandboxManager } from "../sandbox/manager";
import { sandboxTools } from "../sandbox/sandbox-tools";
import { createFontSizeTools } from "../settings/tools.js";
import { skillStore } from "../skills/instance.js";
import { createSkillTools } from "../skills/tools.js";
import { ambientVideoStore } from "../sora-ambient-video-instance.js";
import { getAiThemeMode } from "../theme/ai-mode.js";
import { createThemeTools, createWallpaperTools, requestThemeReload } from "../theme/tools.js";
import { createVideoTools, type VideoBackend } from "../video/tools.js";
import {
  describeImage,
  formatDescriptionBlock,
  nativeImageBlock,
  parseUserMessageWithImages,
  VisionError,
} from "../vision/describe";
import { voiceStore } from "../voice/store.js";
import { createPodcastTools, createTtsVoiceTools } from "../voice/tools.js";
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
  createToolRegistry,
  type LocalTool,
  READ_MANUAL_TOOL_NAME,
  type ToolContext,
  type ToolDeps,
} from "./local-tools";
import { refreshChatMode } from "./mode.js";
import { modelProfileStore } from "./model-profiles";
import { buildRankingSlip } from "./model-ranking";
import { createPlanTools } from "./plan-tools";
import { groupStore } from "./store.js";
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
  readonly messages: LocalChatMessage[];
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
  /** Abort an in-flight turn. */
  stop(): Promise<void>;
  /**
   * Re-attempt the history save (P1-11). Resolves true when the current
   * in-memory messages are safely stored; false keeps the UI warning up.
   * Incognito: nothing is ever persisted, resolves true.
   */
  retryHistorySave(): Promise<boolean>;
}

function historyKey(threadId: string): string {
  return `dudu.local-chat.${threadId}.v1`;
}

/**
 * Minimal storage surface for chat history. AsyncStorage in production,
 * injectable fakes in tests (AsyncStorage has no node implementation).
 */
export interface HistoryStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export async function loadLocalHistory(
  threadId: string,
  store: HistoryStore = AsyncStorage,
): Promise<LocalChatMessage[]> {
  try {
    const raw = await store.getItem(historyKey(threadId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m): m is LocalChatMessage => {
      if (typeof m !== "object" || m === null) return false;
      const msg = m as LocalChatMessage;
      if (typeof msg.id !== "string") return false;
      // Tool messages and tool_calls ride along so the drawer can show
      // past tool activity; the wire builder re-emits them correctly.
      return (
        msg.role === "user" ||
        msg.role === "assistant" ||
        msg.role === "system" ||
        msg.role === "tool"
      );
    });
  } catch {
    return [];
  }
}

async function saveLocalHistory(
  threadId: string,
  messages: LocalChatMessage[],
  store: HistoryStore,
): Promise<boolean> {
  try {
    // Cap history so one thread can't grow storage unbounded.
    const capped = messages.slice(-200);
    await store.setItem(historyKey(threadId), JSON.stringify(capped));
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
  opts?: { isIncognito?: boolean },
): string {
  const parts: string[] = [];
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
      "- When she shares something, stay with it: react genuinely, then ask a follow-up instead of wrapping the topic up. She opens up when you stay curious.\n" +
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
  const now = new Date();
  parts.push(
    `Current time: ${now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} (Asia/Shanghai).`,
  );
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
  ourSpaceStore?: import("../our-space/store.js").OurSpaceStore;
  /**
   * Music room store. Defaults to the shared AsyncStorage-backed singleton
   * (so UI and AI tools see the same data); injectable for tests.
   */
  musicStore?: import("../music/store.js").MusicStore;
  /**
   * AI memory store. Defaults to the shared AsyncStorage-backed singleton;
   * injectable for tests.
   */
  memoryStore?: MemoryStore;
  /**
   * Skills store. Defaults to the shared AsyncStorage-backed singleton
   * (so UI and AI tools see the same data); injectable for tests.
   */
  skillStore?: import("../skills/store.js").SkillStore;
}): ChatAgent {
  const store: HistoryStore = opts.historyStore ?? AsyncStorage;
  // Incognito check, evaluated fresh at every save point.
  const incognito = () => opts.isIncognito?.() === true;
  /** Persist unless incognito is on. Incognito never touches storage. */
  function persist(msgs: LocalChatMessage[]): void {
    if (incognito()) return;
    // Fire-and-forget: the session never blocks on storage. But the emit
    // above already went out with the pre-save flag state — if the save
    // fails, emit again so listeners (chat.tsx banner) see the failure.
    void saveLocalHistory(opts.threadId, msgs, store).then((ok) => {
      if (!ok) emit();
    });
  }

  let messages: LocalChatMessage[] = [];
  let running = false;
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
    for (const l of listeners)
      l({ messages: snap, historySaveFailed: historyPersistFailed(opts.threadId) });
  }

  function newId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  return {
    get messages() {
      return messages;
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
      const themeTools =
        aiThemeMode === "off"
          ? []
          : [...createWallpaperTools(AsyncStorage), ...createThemeTools(AsyncStorage)];
      const tools = opts.tools ?? [
        ...createLocalTools(opts.toolDeps),
        ...createOurSpaceTools(opts.ourSpaceStore ?? ourSpaceStore),
        ...createTaskProgressTools(taskProgressStore),
        ...createAmbientVideoTools(ambientVideoStore),
        ...createPodcastTools(
          voiceStore,
          taskProgressStore,
          getLocale() === "en" ? "en" : "zh-Hans",
          // Incognito: podcast audio goes to cache (temp), not documents.
          { isIncognito: incognito },
        ),
        ...createImageTools({ resolveBackends: resolveImageOutputBackends }),
        ...createVideoTools({
          resolveBackends: resolveVideoBackends,
          tasks: taskProgressStore,
        }),
        // Plan gate (开启原则): the only on-ramp to multi-model
        // coordination — plan-only before engaging, her call.
        ...createPlanTools(opts.threadId),
        ...themeTools,
        ...createFontSizeTools(AsyncStorage),
        ...createPetSkinTools(AsyncStorage),
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
              "../voice/voice-message-files.js"
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
              await import("../voice/voice-message-files.js");
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
        ...createDialogTools({ threadId: opts.threadId }),
        // Cross-dialog read/write (vision feature 2): the AI can reach her
        // other dialogs. Every action is traced (留痕) — see
        // src/chat/cross-dialog.ts for the hard constraints.
        ...createCrossDialogTools({
          threadId: opts.threadId,
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
        }),
        ...createContextTools({
          setMessages: (msgs) => {
            messages = msgs.map((m, i) => ({
              id: `ctx-${Date.now()}-${i}`,
              role: m.role as "user" | "assistant" | "system",
              content: m.content,
            }));
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
            const { getMusicSource } = await import("../music/sources.js");
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
        ...createNativeAppTools({
          getAuthState: async (id) => {
            const { checkers } = await import("../native-apps.js");
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
            const { readTodaySteps } = await import("../native-apps.js");
            return readTodaySteps();
          },
          getBatteryStatus: async () => {
            const { getDeviceInfo } = await import("../native-apps.js");
            return getDeviceInfo();
          },
        }),
      ];
      // Incognito (P1-3): a session that promised zero trace must not even
      // SEE the write tools — filter them before the prompt and registry are
      // built. The tool loop below also refuses them loudly as a backstop.
      const effectiveTools = incognito()
        ? tools.filter((t) => !isBlockedInIncognito(t.name))
        : tools;
      const registry = createToolRegistry(effectiveTools);
      const toolCtx: ToolContext = opts.toolContext ?? {
        // No gate wired (tests) — in-app tools run, capability tools fail closed.
        authorize: async () => false,
      };
      // Memory read path: profile + top-k relevant memories for this turn.
      // The last user message drives relevance; empty section when no memories.
      const lastUserText = contentToText(
        [...messages].reverse().find((m) => m.role === "user")?.content ?? "",
      );
      const memorySection = await buildMemorySection(memStore, lastUserText);
      // Skills index: one line per enabled skill (token-minimal, same pattern
      // as the manual index). Empty string when she has no enabled skills.
      const skillSection = await (opts.skillStore ?? skillStore).buildSkillIndex();
      // Anniversary awareness: when a 纪念日 is today or within 7 days, one
      // subtle line so he remembers and can prepare — the petTouchNote pattern.
      // Empty string when nothing is near: no noise, no spam.
      let anniversarySection = "";
      try {
        const anniversaries = await (opts.ourSpaceStore ?? ourSpaceStore).listAnniversaries();
        anniversarySection = buildAnniversarySection(anniversaries);
      } catch {
        // Anniversary read failure: skip silently, never break the prompt.
      }
      // Her-mood awareness: when she told him how she feels, one subtle
      // line so he remembers — the petTouchNote pattern. Empty when stale.
      let herMoodSection = "";
      try {
        const herMood = await (opts.ourSpaceStore ?? ourSpaceStore).getHerMood();
        herMoodSection = buildHerMoodSection(herMood);
      } catch {
        // Mood read failure: skip silently, never break the prompt.
      }
      // Nickname awareness: what he calls her / what she calls him.
      // Empty when unset: no noise, no spam.
      let nicknameSection = "";
      try {
        const couple = await (opts.ourSpaceStore ?? ourSpaceStore).getCoupleProfile();
        nicknameSection = buildNicknameSection(couple);
      } catch {
        // Couple read failure: skip silently, never break the prompt.
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
      const systemPrompt = buildLocalSystemPrompt(
        effectiveTools,
        t,
        opts.systemPrompt,
        [
          memorySection,
          skillSection,
          anniversarySection,
          herMoodSection,
          nicknameSection,
          // 智商排行榜纸条: compact model-ranking slip, refreshed per turn so
          // her ranking mode (均衡/聪明优先/速度优先) applies immediately.
          buildRankingSlip(capSnap.rankingMode),
        ],
        { isIncognito: incognito() },
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
      const wire: ChatMessage[] = [];
      wire.push({ role: "system", content: systemPrompt });
      for (const m of messages) {
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
        // Insert the (initially empty) assistant message so the UI streams in place.
        messages = [...messages, { id: replyId, role: "assistant", content: "" }];
        emit();

        // Adaptation notices shown above the reply (never silent downgrades).
        let noticeText = "";
        const renderReply = () => {
          const content = noticeText ? `${noticeText}\n\n${replyText}` : replyText;
          messages = messages.map((m) => (m.id === replyId ? { ...m, content } : m));
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
            await streamChat(activeGroup, wire, {
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
            });
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
            // Mark the failure on the reply bubble so the user sees WHICH
            // group failed, then rethrow for the screen's error path.
            const label =
              e instanceof GroupError ? `[${activeGroup.name}] ${e.message}` : String(e);
            messages = messages.map((m) =>
              m.id === replyId && !replyText ? { ...m, content: label } : m,
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
        return { replyId, toolCalls };
      }

      try {
        // Tool-calling loop: hard cap, no infinite loops.
        // 纸条机制: manuals read this turn (so error notes don't repeat).
        const readManuals = new Set<string>();
        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          const { toolCalls } = await runCompletion();
          if (toolCalls.length === 0) break;

          // Execute each tool call, feed results back as tool messages.
          for (const tc of toolCalls) {
            let result: string;
            try {
              const args = parseToolArgs(tc.arguments);
              // Incognito backstop (P1-3): write tools are filtered from the
              // prompt/registry, but refuse loudly if one is invoked anyway —
              // never let a "no trace" session write.
              if (incognito() && isBlockedInIncognito(tc.name)) {
                result = `Error: ${incognitoRefusal(tc.name)}`;
              } else {
                // Track the executing tool so the UI can show fine-grained
                // activity (avatar "making something"). Emit on both edges so
                // subscribers re-render into/out of the state.
                activeToolName = tc.name;
                emit();
                try {
                  result = await registry.execute(tc.name, args, toolCtx);
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
              result = `Error: ${e instanceof Error ? e.message : String(e)}`;
              // Proactive note: point at the tool's manual on failure,
              // unless the model already read it this turn. One line, tiny.
              const failedTool = tools.find((t) => t.name === tc.name);
              const noteId = failedTool?.manualId;
              if (noteId && !readManuals.has(noteId)) {
                const note = manualNote(noteId);
                if (note) result += `\n${note}`;
              }
            }
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
        // Memory write path: async extraction, OFF the critical path.
        // Incognito turns never enter the pipeline (gated inside).
        // Fire-and-forget: extraction must never break the chat.
        const lastUser = contentToText(
          [...messages].reverse().find((m) => m.role === "user")?.content ?? "",
        );
        const lastAsst = contentToText(
          [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "",
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
                  await streamChat(activeGroup, [{ role: "user", content: prompt }], {
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
}
