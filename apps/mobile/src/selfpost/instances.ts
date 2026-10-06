/**
 * AI self-post trigger （自发帖触发器） — app singletons and production wiring.
 *
 * expo-notifications is NOT needed (feed posts are quiet — no ping).
 * This module stays importable in node tests: RN imports are lazy.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { groupStore } from "../api-groups/store";
import type { ApiGroup } from "../api-groups/types";
import { crossDialogTraceStore } from "../chat/cross-dialog-instance";
import { shanghaiDayStart } from "../initiative/rules";
import { InitiativeStore } from "../initiative/store";
import { memoryStore } from "../memory/instance";
import { ourSpaceStore } from "../our-space/instance";
import { outreachStore } from "../outreach/instances";
import { personaStore } from "../persona/stores";
import type { Persona } from "../persona/types";
import type { SelfpostExecutorDeps } from "./executor";
import { SelfpostStore } from "./store";
import { createSelfpostTools } from "./tools";

export const selfpostStore = new SelfpostStore(AsyncStorage);
const initiativeStore = new InitiativeStore(AsyncStorage);

async function getActiveGroup(): Promise<ApiGroup | null> {
  try {
    const snap = groupStore.getSnapshot();
    if (!snap.groups || snap.groups.length === 0) return null;
    return snap.groups.find((g) => g.id === snap.activeId) ?? snap.groups[0] ?? null;
  } catch {
    return null;
  }
}

async function getActivePersona(): Promise<Persona | null> {
  try {
    const id = await personaStore.getActiveId().catch(() => null);
    if (!id) return null;
    const p = await personaStore.get(id).catch(() => null);
    return p && p.enabled ? p : null;
  } catch {
    return null;
  }
}

function personaDisplayName(persona: Persona): string {
  const n = persona.name?.trim();
  return n && n.length > 0 ? n : "嘟嘟";
}

function personaVoiceHint(persona: Persona): string {
  return (persona.systemPrompt ?? "").trim().slice(0, 300);
}

function fmtCtxLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 160);
}

export interface SelfpostDepsOptions {
  isIncognito: () => boolean;
}

/** Full production deps for the scheduler/executor. Never throws. */
export async function buildSelfpostDeps(opts: SelfpostDepsOptions): Promise<SelfpostExecutorDeps> {
  return {
    selfpostStore,
    initiativeStore,
    outreachStore,
    addFeedPost: async (text: string) => {
      const post = await ourSpaceStore.addFeedPost("ai", text);
      return { id: post.id };
    },
    listTodayFeed: async () => {
      try {
        const dayStart = shanghaiDayStart(Date.now());
        const posts = await ourSpaceStore.listFeed(30);
        return posts
          .filter((p) => p.createdAt >= dayStart)
          .slice(0, 8)
          .map((p) => `${p.author === "ai" ? "you" : "her"}: ${fmtCtxLine(p.text)}`);
      } catch {
        return [];
      }
    },
    listRecentMemories: async () => {
      try {
        const mems = await memoryStore.listMemories();
        return mems
          .slice(0, 5)
          .map((m) => fmtCtxLine(m.content ?? ""))
          .filter(Boolean);
      } catch {
        return [];
      }
    },
    listTodayEvents: async () => {
      try {
        const dayStart = shanghaiDayStart(Date.now());
        const events = await memoryStore.listEvents(30);
        return events
          .filter((e) => e.at >= dayStart)
          .slice(0, 5)
          .map((e) => fmtCtxLine(e.note ? `${e.op}: ${e.note}` : e.op))
          .filter(Boolean);
      } catch {
        return [];
      }
    },
    getActivePersona,
    personaDisplayName,
    personaVoiceHint,
    getActiveGroup,
    generateText: async (group, systemPrompt, userPrompt) => {
      const { generateOneShot } = await import("../chat/group-meeting-tools");
      return generateOneShot(group, systemPrompt, userPrompt, { timeoutMs: 60_000 });
    },
    isIncognito: opts.isIncognito,
    trace: crossDialogTraceStore,
    nowMs: () => Date.now(),
  };
}

/** Production AI-tool set for local-agent wiring. Synchronous. */
export function createProductionSelfpostTools(isIncognito: () => boolean) {
  const store = selfpostStore;
  return createSelfpostTools({
    selfpostStore: store,
    buildExecutorDeps: () => buildSelfpostDeps({ isIncognito }),
    isIncognito,
    nowMs: () => Date.now(),
  });
}
