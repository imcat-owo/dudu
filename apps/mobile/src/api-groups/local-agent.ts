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
import { type ChatMessage, GroupError, streamChat } from "./direct-transport";
import type { ApiGroup } from "./types";

export interface LocalChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatAgent {
  readonly messages: LocalChatMessage[];
  readonly isRunning: boolean;
  subscribe(listener: { onMessagesChanged?: (e: { messages: LocalChatMessage[] }) => void }): {
    unsubscribe(): void;
  };
  setMessages(messages: LocalChatMessage[]): void;
  addMessage(m: { id: string; role: "user" | "assistant" | "system"; content: string }): void;
  /** Send pending user messages and stream the reply. */
  runTurn(): Promise<void>;
  /** Abort an in-flight turn. */
  stop(): Promise<void>;
}

function historyKey(threadId: string): string {
  return `openmuse.local-chat.${threadId}.v1`;
}

export async function loadLocalHistory(threadId: string): Promise<LocalChatMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(historyKey(threadId));
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

async function saveLocalHistory(threadId: string, messages: LocalChatMessage[]): Promise<void> {
  try {
    // Cap history so one thread can't grow storage unbounded.
    const capped = messages.slice(-200);
    await AsyncStorage.setItem(historyKey(threadId), JSON.stringify(capped));
  } catch {
    // History persistence is best-effort; the session keeps working.
  }
}

export function createLocalAgent(opts: {
  threadId: string;
  getGroup: () => ApiGroup | null;
  systemPrompt?: string;
}): ChatAgent {
  let messages: LocalChatMessage[] = [];
  let running = false;
  let aborter: AbortController | null = null;
  const listeners = new Set<(e: { messages: LocalChatMessage[] }) => void>();

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
      void saveLocalHistory(opts.threadId, messages);
    },
    addMessage(m) {
      messages = [...messages, { id: m.id, role: m.role, content: m.content }];
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
      // Insert the (initially empty) assistant message so the UI streams in place.
      messages = [...messages, { id: replyId, role: "assistant", content: "" }];
      emit();

      const wire: ChatMessage[] = [
        ...(opts.systemPrompt ? [{ role: "system" as const, content: opts.systemPrompt }] : []),
        ...messages
          .filter((m) => m.id !== replyId && (m.role === "user" || m.role === "assistant"))
          .map((m): ChatMessage => ({ role: m.role, content: m.content })),
      ];

      try {
        await streamChat(group, wire, {
          signal: aborter.signal,
          onToken: (delta) => {
            replyText += delta;
            messages = messages.map((m) => (m.id === replyId ? { ...m, content: replyText } : m));
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
        void saveLocalHistory(opts.threadId, messages);
      }
    },
    async stop(): Promise<void> {
      aborter?.abort();
    },
  };
}
