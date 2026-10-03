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
import { createBrowserTools } from "../browser/tools.js";
import { buildCapabilityPromptSection } from "../capabilities";
import { type StringKey, t } from "../i18n";
import { knowledgeStore } from "../knowledge/instance.js";
import { createKnowledgeTools } from "../knowledge/tools.js";
import { buildManualIndex, manualNote } from "../manuals/index.js";
import { buildMemorySection, createMemoryTools, extractMemoriesAsync } from "../memory/index.js";
import { memoryStore } from "../memory/instance.js";
import type { MemoryStore } from "../memory/store.js";
import { musicStore } from "../music/instance.js";
import { createMusicTools } from "../music/tools.js";
import { voiceStore } from "../voice/store.js";
import { createPodcastTools } from "../voice/tools.js";
import { createNativeAppTools } from "../native-apps-tools.js";
import { ourSpaceStore } from "../our-space/instance.js";
import { taskBuddyVideoStore } from "../our-space/task-buddy-video-instance.js";
import { taskProgressStore } from "../our-space/task-progress-instance.js";
import {
  createAmbientVideoTools,
  createOurSpaceTools,
  createTaskBuddyVideoTools,
  createTaskProgressTools,
} from "../our-space/tools.js";
import { recentInteraction } from "../pet/interactions.js";
import { sandboxManager } from "../sandbox/manager";
import { sandboxTools } from "../sandbox/sandbox-tools";
import { skillStore } from "../skills/instance.js";
import { createSkillTools } from "../skills/tools.js";
import { ambientVideoStore } from "../sora-ambient-video-instance.js";
import {
  describeImage,
  formatDescriptionBlock,
  nativeImageBlock,
  parseUserMessageWithImages,
  VisionError,
} from "../vision/describe";
import {
  type ChatContentBlock,
  type ChatMessage,
  type CompletedToolCall,
  GroupError,
  streamChat,
} from "./direct-transport";
import { classifyError, type ErrorClass } from "./error-classifier";
import {
  createLocalTools,
  createToolRegistry,
  type LocalTool,
  READ_MANUAL_TOOL_NAME,
  type ToolContext,
  type ToolDeps,
} from "./local-tools";
import { modelProfileStore } from "./model-profiles";
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
  subscribe(listener: { onMessagesChanged?: (e: { messages: LocalChatMessage[] }) => void }): {
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
): Promise<void> {
  try {
    // Cap history so one thread can't grow storage unbounded.
    const capped = messages.slice(-200);
    await store.setItem(historyKey(threadId), JSON.stringify(capped));
  } catch {
    // History persistence is best-effort; the session keeps working.
  }
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
): string {
  const parts: string[] = [];
  if (basePrompt) parts.push(basePrompt);
  parts.push(
    "You are a helpful on-device AI assistant. You have tools you can call to get things done — use them when they help answer, don't narrate them.",
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
  // Pet touch — she can feel the desktop pet (桌宠）: pinching its cheek,
  // holding its hand, patting its head. One subtle line so she can react
  // naturally; nothing when she hasn't touched it recently.
  parts.push(petTouchNote());
  return parts.join("\n");
}

/**
 * One-line note about her most recent touch on the desktop pet (last
 * 3 minutes), so the AI can feel it and react like a person would.
 * Empty string when there's nothing recent — no noise, no spam.
 */
function petTouchNote(): string {
  const ev = recentInteraction();
  if (!ev) return "";
  switch (ev.type) {
    case "pinch":
      return "她刚才揪了揪你的脸（桌宠）——可以像被揪住一样小小地反应一下，别大惊小怪。";
    case "reach":
      return "她刚才长按着你，像隔着屏幕想牵你的手——可以把手伸过去回应她，温柔一点。";
    case "headpat":
      return "她刚才拍了拍你的头——可以开心地蹭一下，别太夸张。";
    case "headphones":
      return "她放起了音乐，你戴上了耳机（桌宠）——听歌的时候可以陪她一起晃，别刷屏。";
  }
}

/**
 * Resolve a user message for the wire, processing image attachments.
 *
 * - No images: passthrough.
 * - Native vision: text + image_url content blocks in one request.
 * - Describe pipeline: each image → 4-part description → appended as
 *   structured blocks the text model can read.
 * - No vision config: throw loudly — never silently drop the image.
 */
/** Exported for testing the vision cache behavior. */
export async function toWireUserMessage(
  group: ApiGroup,
  content: string,
  cache: VisionCache,
): Promise<ChatMessage> {
  const parsed = parseUserMessageWithImages(content);
  if (!parsed || parsed.images.length === 0) return { role: "user", content };

  const vision = group.vision;
  if (!vision) {
    throw new GroupError(
      group.name,
      "没有配置识图：请在分组设置里打开“聊天模型直接看图”或填写识图模型",
    );
  }

  if (vision.native) {
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
    return { role: "user", content: blocks };
  }

  // Describe pipeline: vision model describes, chat model reads text.
  const parts: string[] = [];
  if (parsed.text.trim()) parts.push(parsed.text);
  for (const img of parsed.images) {
    let description = cache.describe.get(img.uri);
    if (description === undefined) {
      try {
        description = await describeImage(group, img.uri, parsed.text);
      } catch (e) {
        // Loud, per-image — the user knows exactly which image failed and why.
        throw e instanceof VisionError || e instanceof GroupError
          ? e
          : new VisionError(
              `识图失败 (${img.name})：${e instanceof Error ? e.message : String(e)}`,
            );
      }
      cache.describe.set(img.uri, description);
    }
    parts.push(formatDescriptionBlock(img.name, description));
  }
  return { role: "user", content: parts.join("\n\n") };
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
    void saveLocalHistory(opts.threadId, msgs, store);
  }

  let messages: LocalChatMessage[] = [];
  let running = false;
  let aborter: AbortController | null = null;
  const listeners = new Set<(e: { messages: LocalChatMessage[] }) => void>();
  // Thread-scoped vision cache: one agent instance == one thread, so history
  // images are described / base64-encoded once, not once per turn.
  const visionCache = newVisionCache();

  function emit() {
    const snap = [...messages];
    for (const l of listeners) l({ messages: snap });
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
      const tools = opts.tools ?? [
        ...createLocalTools(opts.toolDeps),
        ...createOurSpaceTools(opts.ourSpaceStore ?? ourSpaceStore),
        ...createTaskProgressTools(taskProgressStore),
        ...createTaskBuddyVideoTools(taskBuddyVideoStore),
        ...createAmbientVideoTools(ambientVideoStore),
        ...createPodcastTools(voiceStore, taskProgressStore),
        ...createMemoryTools(memStore),
        ...createKnowledgeTools(knowledgeStore, { getGroup: () => activeGroup }),
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
      const registry = createToolRegistry(tools);
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
      const systemPrompt = buildLocalSystemPrompt(tools, t, opts.systemPrompt, [
        memorySection,
        skillSection,
      ]);
      const allWireTools = registry.definitions();
      // wireTools is mutable: auto-fallback may clear it on retry.
      let wireTools = toolsOn ? allWireTools : [];

      // Build the wire messages, resolving image attachments via vision.
      // History tool calls/results ride along so multi-turn tool use works.
      const wire: ChatMessage[] = [];
      wire.push({ role: "system", content: systemPrompt });
      for (const m of messages) {
        if (m.role === "user") {
          wire.push(await toWireUserMessage(group, contentToText(m.content), visionCache));
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
              result = await registry.execute(tc.name, args, toolCtx);
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
  };
}
