/**
 * useChatAgent — the dual-mode seam.
 *
 * Returns a ChatAgent with the same surface in both modes so ChatScreen
 * doesn't fork:
 *   messages / isRunning / subscribe / setMessages / addMessage /
 *   runTurn / stop
 *
 * - cloud: adapts CopilotKit's useAgent (needs CopilotKitProvider above).
 * - local: LocalAgent — direct SSE to the user's API group, no backend.
 *
 * The caller MUST remount when the mode changes (key={mode}) — the two
 * branches call different hooks, so hook order is only stable within one
 * mode's lifetime.
 */

import {
  type Message as CopilotMessage,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-native/headless";
import { useMemo, useReducer, useRef } from "react";
import {
  createLocalAgent,
  type LocalChatMessage,
  loadLocalHistory,
} from "./api-groups/local-agent";
import { useChatMode } from "./api-groups/mode";
import { groupStore } from "./api-groups/store";
import { runConversationTurn } from "./conversation-run";

export interface AgentMessage {
  id: string;
  role: string;
  content?: unknown;
  /** CopilotKit tool fields pass through opaquely in cloud mode. */
  toolCallId?: string;
  toolCalls?: { id: string }[];
  [key: string]: unknown;
}

export interface ChatAgent {
  readonly messages: AgentMessage[];
  readonly isRunning: boolean;
  subscribe(listener: { onMessagesChanged?: (e: { messages: AgentMessage[] }) => void }): {
    unsubscribe(): void;
  };
  setMessages(messages: AgentMessage[]): void;
  addMessage(m: { id: string; role: string; content: string }): void;
  runTurn(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Cloud-only: attach to an existing server thread (connectAgent).
   * Local: noop (no server thread to attach to).
   */
  connect(): Promise<void>;
  /**
   * Transport-level error subscription (e.g. CopilotKit run failures).
   * Local: noop — errors surface via runTurn() rejection instead.
   */
  onTransportError(listener: (error: Error) => void): { unsubscribe(): void };
}

function toAgentMessages(msgs: readonly CopilotMessage[]): AgentMessage[] {
  return [...msgs] as unknown as AgentMessage[];
}

function useCloudAgent({ agentId, threadId }: { agentId: string; threadId: string }): {
  agent: ChatAgent;
  isReady: boolean;
} {
  const { agent, isReady } = useAgent({ agentId, runtimeAgentId: "default", threadId });
  const { copilotkit } = useCopilotKit();

  const chatAgent = useMemo<ChatAgent>(
    () => ({
      get messages() {
        return toAgentMessages(agent.messages ?? []);
      },
      get isRunning() {
        return agent.isRunning;
      },
      subscribe: (listener) =>
        agent.subscribe({
          onMessagesChanged: listener.onMessagesChanged
            ? ({ messages }) =>
                listener.onMessagesChanged?.({ messages: toAgentMessages(messages) })
            : undefined,
        }),
      setMessages: (messages) => agent.setMessages(messages as unknown as CopilotMessage[]),
      addMessage: (m) => agent.addMessage({ id: m.id, role: m.role, content: m.content } as never),
      runTurn: () =>
        runConversationTurn(
          agentId,
          () => copilotkit.runAgent({ agent }),
          (onError) => copilotkit.subscribe({ onError }),
        ),
      stop: () => Promise.resolve().then(() => copilotkit.stopAgent({ agent })),
      connect: () =>
        runConversationTurn(
          agentId,
          () => copilotkit.connectAgent({ agent }),
          (onError) => copilotkit.subscribe({ onError }),
        ),
      onTransportError: (listener) =>
        copilotkit.subscribe({
          onError: (event) => {
            if (event.context?.agentId && event.context.agentId !== agentId) return;
            listener(event.error instanceof Error ? event.error : new Error(String(event.error)));
          },
        }),
    }),
    [agent, agentId, copilotkit],
  );
  return { agent: chatAgent, isReady };
}

function useLocalAgent({ agentId, threadId }: { agentId: string; threadId: string }): {
  agent: ChatAgent;
  isReady: boolean;
} {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const ref = useRef<ChatAgent | null>(null);
  if (!ref.current) {
    const local = createLocalAgent({
      threadId,
      getGroup: () =>
        groupStore.getSnapshot().groups.find((g) => g.id === groupStore.getSnapshot().activeId) ??
        null,
    });
    // Bridge LocalAgent notifications into React renders
    // (cloud mode gets this from useAgent internally).
    local.subscribe({ onMessagesChanged: () => forceUpdate() });
    const agent: ChatAgent = {
      get messages() {
        return local.messages as AgentMessage[];
      },
      get isRunning() {
        return local.isRunning;
      },
      subscribe: (listener) =>
        local.subscribe({
          onMessagesChanged: listener.onMessagesChanged
            ? ({ messages }) =>
                listener.onMessagesChanged?.({ messages: messages as AgentMessage[] })
            : undefined,
        }),
      setMessages: (messages) =>
        local.setMessages(
          messages.map((m) => ({
            id: m.id,
            role: (m.role === "user" || m.role === "assistant" ? m.role : "user") as
              | "user"
              | "assistant",
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          })),
        ),
      addMessage: (m) =>
        local.addMessage({
          id: m.id,
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        }),
      runTurn: () => local.runTurn(),
      stop: () => local.stop(),
      connect: () => Promise.resolve(),
      onTransportError: () => ({ unsubscribe: () => {} }),
    };
    ref.current = agent;
  }
  void agentId;
  return { agent: ref.current, isReady: true };
}

/**
 * Mode-aware agent hook. Remount on mode change (key={mode} at call site).
 */
// eslint-disable-next-line react-hooks/rules-of-hooks
export function useChatAgent(opts: { agentId: string; threadId: string }): {
  agent: ChatAgent;
  isReady: boolean;
} {
  const mode = useChatMode();
  // Each branch is hook-consistent within its own lifetime; the caller
  // remounts when mode flips.
  if (mode === "cloud") {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useCloudAgent(opts);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useLocalAgent(opts);
}

export type { LocalChatMessage };
export { loadLocalHistory };
