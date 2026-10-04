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
import { useEffect, useMemo, useReducer, useRef } from "react";
import { requestAiAuthorization } from "./ai-authorization";
import { dialogModelOverrideStore } from "./api-groups/dialog-model-override";
import {
  createLocalAgent,
  type LocalChatMessage,
  loadLocalHistory,
} from "./api-groups/local-agent";
import { useChatMode } from "./api-groups/mode";
import { groupStore } from "./api-groups/store";
import { runConversationTurn } from "./conversation-run";
import {
  readClipboard,
  readLocation,
  readRecentPhotos,
  writeClipboard,
} from "./device-permissions";
import { useIncognito } from "./incognito";

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
  /**
   * Name of the tool currently executing, null when idle. Powers the
   * avatar's "making something" state. Cloud mode: always null.
   */
  readonly activeToolName: string | null;
  subscribe(listener: {
    onMessagesChanged?: (e: { messages: AgentMessage[]; historySaveFailed?: boolean }) => void;
  }): {
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
   * Local-only: re-attempt the on-device history save after a failure
   * (P1-11). Cloud mode: undefined (history lives on the server).
   */
  retryHistorySave?(): Promise<boolean>;
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
      get activeToolName() {
        // Cloud mode: no tool visibility.
        return null;
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
  // biome-ignore lint/correctness/useHookAtTopLevel: useLocalAgent runs only in useChatAgent's local branch; remount-on-mode-change (key={mode}) keeps hook order stable.
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  // Incognito is read live at every save point via a ref, so toggling
  // incognito doesn't require recreating the agent — and toggling it ON
  // can never wipe the saved normal history (saves are skipped, not emptied).
  // biome-ignore lint/correctness/useHookAtTopLevel: same remount discipline as above.
  const { incognito } = useIncognito();
  // biome-ignore lint/correctness/useHookAtTopLevel: same remount discipline as above.
  const incognitoRef = useRef(incognito);
  incognitoRef.current = incognito;
  // biome-ignore lint/correctness/useHookAtTopLevel: same remount discipline as above.
  const ref = useRef<ChatAgent | null>(null);
  // biome-ignore lint/correctness/useHookAtTopLevel: same remount discipline as above.
  const cleanupRef = useRef<(() => void) | null>(null);
  // biome-ignore lint/correctness/useHookAtTopLevel: same remount discipline as above.
  useEffect(() => {
    // Unmount = mode switch (whole tree remounts): cancel any in-flight
    // turn and drop the render bridge subscription (P3).
    return () => {
      cleanupRef.current?.();
      void ref.current?.stop().catch(() => {});
    };
  }, []);
  if (!ref.current) {
    const local = createLocalAgent({
      threadId,
      getGroup: () => {
        const snap = groupStore.getSnapshot();
        // Per-dialog override wins over the global active group —
        // she picks it with one tap on the model chip in the header.
        const override = dialogModelOverrideStore.resolveGroup(threadId, snap.groups);
        if (override) return override;
        return snap.groups.find((g) => g.id === snap.activeId) ?? null;
      },
      isIncognito: () => incognitoRef.current,
      // Real device-backed tools: in-app tools need no auth; capability
      // tools go through her authorization gate (fail closed).
      toolDeps: {
        readPhotos: (limit) => readRecentPhotos(limit),
        readLocation: () => readLocation(),
        readClipboard: () => readClipboard(),
        writeClipboard: (text) => writeClipboard(text),
      },
      toolContext: {
        authorize: (req) => requestAiAuthorization(req),
      },
    });
    // Bridge LocalAgent notifications into React renders
    // (cloud mode gets this from useAgent internally).
    const sub = local.subscribe({ onMessagesChanged: () => forceUpdate() });
    cleanupRef.current = () => sub.unsubscribe();
    const agent: ChatAgent = {
      get messages() {
        return local.messages as AgentMessage[];
      },
      get isRunning() {
        return local.isRunning;
      },
      get activeToolName() {
        return local.activeToolName;
      },
      subscribe: (listener) =>
        local.subscribe({
          onMessagesChanged: listener.onMessagesChanged
            ? ({ messages, historySaveFailed }) =>
                listener.onMessagesChanged?.({
                  messages: messages as AgentMessage[],
                  historySaveFailed,
                })
            : undefined,
        }),
      setMessages: (messages) =>
        local.setMessages(
          messages.map((m) => ({
            id: m.id,
            role: (m.role === "user" ||
            m.role === "assistant" ||
            m.role === "tool" ||
            m.role === "system"
              ? m.role
              : "user") as "user" | "assistant" | "system" | "tool",
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            // Preserve tool-call data so the drawer shows past tool activity
            // and the wire can re-emit tool_calls for multi-turn tool use.
            ...(Array.isArray((m as { toolCalls?: unknown }).toolCalls)
              ? {
                  toolCalls: (m as { toolCalls: LocalChatMessage["toolCalls"] }).toolCalls,
                }
              : {}),
            ...(typeof (m as { toolCallId?: unknown }).toolCallId === "string"
              ? { toolCallId: (m as { toolCallId: string }).toolCallId }
              : {}),
            ...(typeof (m as unknown as { thinking?: unknown }).thinking === "string"
              ? { thinking: (m as unknown as { thinking: string }).thinking }
              : {}),
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
      retryHistorySave: () => local.retryHistorySave(),
      connect: () => Promise.resolve(),
      onTransportError: () => ({ unsubscribe: () => {} }),
    };
    ref.current = agent;
  }
  void agentId;
  return { agent: ref.current, isReady: true };
}

/**
 * Mode-aware agent hook. The caller MUST remount on mode change (key={mode}).
 *
 * The two branches call different hooks, so this intentionally breaks the
 * unconditional-hooks rule: it is safe only because the whole tree remounts
 * when `mode` flips, making hook order stable within each mode's lifetime.
 * (eslint-disable comments do not apply to biome; the suppressions below
 * are biome's own ignore syntax with this discipline documented.)
 */
export function useChatAgent(opts: { agentId: string; threadId: string }): {
  agent: ChatAgent;
  isReady: boolean;
} {
  const mode = useChatMode();
  if (mode === "cloud") {
    // biome-ignore lint/correctness/useHookAtTopLevel: remount-on-mode-change (see above).
    return useCloudAgent(opts);
  }
  // biome-ignore lint/correctness/useHookAtTopLevel: remount-on-mode-change (see above).
  return useLocalAgent(opts);
}

export type { LocalChatMessage };
export { loadLocalHistory };
