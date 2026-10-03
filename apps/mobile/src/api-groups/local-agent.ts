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
  GroupError,
  streamChat,
} from "./direct-transport";
import type { ApiGroup } from "./types";

export interface LocalChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /**
   * Reasoning/thinking text streamed separately from the visible reply
   * (reasoning models). Only present when the model actually returned it —
   * never synthesized. Shown via the thinking drawer UI, never inlined
   * into the visible content.
   */
  thinking?: string;
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
  return `openmuse.local-chat.${threadId}.v1`;
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
    return parsed.filter(
      (m): m is LocalChatMessage =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as LocalChatMessage).id === "string" &&
        ((m as LocalChatMessage).role === "user" || (m as LocalChatMessage).role === "assistant"),
    );
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
    addMessage(m) {
      messages = [
        ...messages,
        {
          id: m.id,
          role: m.role,
          content: m.content,
          ...(m.thinking ? { thinking: m.thinking } : {}),
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

      const replyId = newId("asst");
      let replyText = "";
      let thinkingText = "";
      // Insert the (initially empty) assistant message so the UI streams in place.
      messages = [...messages, { id: replyId, role: "assistant", content: "" }];
      emit();

      // Build the wire messages, resolving image attachments via vision.
      const wire: ChatMessage[] = [];
      if (opts.systemPrompt) wire.push({ role: "system", content: opts.systemPrompt });
      for (const m of messages) {
        if (m.id === replyId || (m.role !== "user" && m.role !== "assistant")) continue;
        if (m.role === "assistant") {
          wire.push({ role: "assistant", content: m.content });
          continue;
        }
        wire.push(await toWireUserMessage(group, m.content, visionCache));
      }

      try {
        await streamChat(group, wire, {
          signal: aborter.signal,
          onToken: (delta) => {
            replyText += delta;
            messages = messages.map((m) => (m.id === replyId ? { ...m, content: replyText } : m));
            emit();
          },
          onThinking: (delta) => {
            thinkingText += delta;
            messages = messages.map((m) =>
              m.id === replyId ? { ...m, thinking: thinkingText } : m,
            );
            emit();
          },
          onDone: () => {},
          // streamChat rejects on error — onError here is informational only.
          onError: () => {},
        });
      } catch (e) {
        // Mark the failure on the reply bubble so the user sees WHICH
        // group failed, then rethrow for the screen's error path.
        const label = e instanceof GroupError ? `[${group.name}] ${e.message}` : String(e);
        messages = messages.map((m) =>
          m.id === replyId && !replyText ? { ...m, content: label } : m,
        );
        emit();
        throw e;
      } finally {
        running = false;
        aborter = null;
        emit();
        persist(messages);
      }
    },
    async stop(): Promise<void> {
      aborter?.abort();
    },
  };
}
