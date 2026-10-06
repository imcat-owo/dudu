/**
 * Voice call — app singletons and production wiring.
 *
 * expo-notifications / expo-audio are loaded lazily (dynamic import) so the
 * PURE parts of this module stay importable in node tests. The React
 * controller that owns the recorder/player hooks lives in call-ui.tsx.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { groupStore } from "../api-groups/store";
import type { ApiGroup } from "../api-groups/types";
import { generateOneShot } from "../chat/group-meeting-tools";
import { personaStore } from "../persona/stores";
import type { Persona } from "../persona/types";
import { voiceStore } from "../voice/store";
import { transcribeAudio } from "../voice/stt";
import { synthesizeSpeech } from "../voice/tts";
import type { ProposalStore, RingNotifier } from "./propose";
import type { ChatTurn } from "./session";
import { createVoiceCallTools } from "./tools";

export const proposalStore: ProposalStore = AsyncStorage;

function getActiveGroup(): ApiGroup | null {
  try {
    const snap = groupStore.getSnapshot();
    if (!snap.groups || snap.groups.length === 0) return null;
    return snap.groups.find((g) => g.id === snap.activeId) ?? snap.groups[0] ?? null;
  } catch {
    return null;
  }
}

/** expo-notifications → RingNotifier. Lazy: safe to call in node tests. */
export async function createRingNotifier(): Promise<RingNotifier> {
  const m = await import("expo-notifications");
  return {
    scheduleNotificationAsync: (req) =>
      m.scheduleNotificationAsync({
        identifier: req.identifier,
        content: req.content,
        trigger: {
          type: m.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: req.trigger.seconds,
        },
      }),
    cancelScheduledNotificationAsync: (id: string) => m.cancelScheduledNotificationAsync(id),
  };
}

async function getPersona(personaId: string): Promise<Persona | null> {
  try {
    return await personaStore.get(personaId);
  } catch {
    return null;
  }
}

/** Production AI tools (registered in local-agent.ts). Never throws. */
export function createProductionVoiceCallTools() {
  // Lazy notifier: expo-notifications loads on first actual ring.
  let notifierPromise: Promise<RingNotifier | null> | null = null;
  const lazy = (): RingNotifier => ({
    scheduleNotificationAsync: async (req) => {
      notifierPromise ??= createRingNotifier().catch(() => null);
      const n = await notifierPromise;
      if (!n) throw new Error("Notifications unavailable — open the app to see the call.");
      return n.scheduleNotificationAsync(req);
    },
    cancelScheduledNotificationAsync: async (id: string) => {
      notifierPromise ??= createRingNotifier().catch(() => null);
      const n = await notifierPromise;
      await n?.cancelScheduledNotificationAsync(id).catch(() => {});
    },
  });
  return createVoiceCallTools({
    proposalStore,
    notifier: lazy(),
    getPersona,
    listPersonas: async () => {
      try {
        const ps = await personaStore.list();
        return ps.map((p) => ({ id: p.id, name: p.name }));
      } catch {
        return [];
      }
    },
    nowMs: () => Date.now(),
  });
}

/**
 * System prompt for a voice call: the persona's own prompt plus spoken-style
 * constraints (short turns, no markdown, her language). The model speaks the
 * reply out loud — formatting, lists and long paragraphs don't survive TTS.
 */
export function buildCallSystemPrompt(persona: Persona): string {
  const base = persona.systemPrompt?.trim() || `你是${persona.name || "嘟嘟"}。`;
  return (
    `${base}\n\n` +
    `You are on a LIVE VOICE CALL with her. Your reply will be spoken aloud via TTS.\n` +
    `Hard rules for voice:\n` +
    `- Keep every reply SHORT: 1-3 sentences, like spoken conversation. Never a wall of text.\n` +
    `- Plain text only: no markdown, no lists, no emoji, no stage directions.\n` +
    `- Reply in HER language (the language she just used).\n` +
    `- If you didn't understand, say so briefly and ask her to repeat — never bluff.`
  );
}

function formatHistory(history: ChatTurn[]): string {
  return history.map((t) => `${t.role === "user" ? "她" : "你"}：${t.text}`).join("\n");
}

export interface CallAiAdapters {
  stt: (uri: string) => Promise<string>;
  tts: (sentence: string) => Promise<string>;
  llm: (history: ChatTurn[]) => Promise<string>;
}

/**
 * Build the AI adapters from HER configured API group + voice settings
 * (model/backend agnostic — edge-tts default, custom endpoints respected).
 * Throws a loud, human-readable error when nothing is configured.
 */
export function buildCallAiAdapters(persona: Persona): CallAiAdapters {
  const group = getActiveGroup();
  if (!group) {
    throw new Error("Call needs an API group — configure one first (连接里设置).");
  }
  const snap = voiceStore.getSnapshot();
  const system = buildCallSystemPrompt(persona);
  return {
    stt: (uri: string) => transcribeAudio(uri, group, snap.stt),
    tts: (sentence: string) => synthesizeSpeech(sentence, snap.tts),
    llm: (history: ChatTurn[]) => generateOneShot(group, system, formatHistory(history)),
  };
}
