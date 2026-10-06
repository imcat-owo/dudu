/**
 * AI photo share （主动发照片） — app singletons and production wiring.
 *
 * Delivery rides on the cross-dialog path (persona-isolated dialog
 * resolution + sendToDialog, trace) — the same rails the initiative
 * executor uses. Image generation rides on the REAL image path: her
 * image_output capability group first, free fallback second (the same
 * backends as the generate_image tool), with the works-drawer hook so
 * shared photos don't die in chat history.
 *
 * This module stays importable in node tests: RN imports are lazy.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { groupStore } from "../api-groups/store";
import type { ApiGroup } from "../api-groups/types";
import { crossDialogTraceStore, crossDialogVisibilityStore } from "../chat/cross-dialog-instance";
import { parseImageMessage } from "../image/protocol";
import { createImageTools, type ImageOutputBackend } from "../image/tools";
import { InitiativeStore } from "../initiative/store";
import { memoryStore } from "../memory/instance";
import { ourSpaceStore } from "../our-space/instance";
import { outreachStore } from "../outreach/instances";
import { personaStore } from "../persona/stores";
import type { Persona } from "../persona/types";
import { SelfpostStore } from "../selfpost/store";
import type { PhotoshareExecutorDeps } from "./executor";
import { PhotoshareStore } from "./store";
import { createPhotoshareTools } from "./tools";

export const photoshareStore = new PhotoshareStore(AsyncStorage);
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
    return p?.enabled ? p : null;
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

/** Her image_output capability group → ordered backends. Empty = free fallback only. */
function resolveImageOutputBackends(): ImageOutputBackend[] {
  try {
    // Lazy requires keep this module node-testable (capability-store pulls
    // react). Types are asserted loosely — a shape mismatch fails closed
    // to [] (free fallback), never to a crash.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { capabilityStore } = require("../api-groups/capability-store") as {
      capabilityStore: { getSnapshot(): { groups: unknown[] } };
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CAPABILITY_TAGS } = require("../api-groups/capability-groups") as {
      CAPABILITY_TAGS: { IMAGE_OUTPUT: string };
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { findCapabilityGroup, resolveMembers } = require("../api-groups/group-router") as {
      findCapabilityGroup(groups: unknown[], tag: string): unknown;
      resolveMembers(
        group: unknown,
        apiGroups: unknown[],
      ): Array<{
        apiGroup: {
          name: string;
          baseUrl: string;
          apiKey?: string;
          headers: Record<string, string>;
        };
        member: { endpoint?: string; apiKey?: string };
        model: string;
      }>;
    };
    const capSnap = capabilityStore.getSnapshot();
    const allApiGroups = groupStore.getSnapshot().groups;
    const g = findCapabilityGroup(capSnap.groups, CAPABILITY_TAGS.IMAGE_OUTPUT);
    if (!g) return [];
    return resolveMembers(g, allApiGroups).map((m) => ({
      name: m.apiGroup.name,
      baseUrl: m.member.endpoint?.trim() || m.apiGroup.baseUrl,
      apiKey: m.apiGroup.apiKey ?? m.member.apiKey ?? "",
      headers: m.apiGroup.headers,
      model: m.model,
    }));
  } catch {
    return [];
  }
}

/**
 * Generate one photo through the REAL image path. Never throws a fake
 * result: the generate_image tool throws loudly on failure, and a
 * missing image envelope is treated as failure too.
 */
async function generateImageReal(prompt: string): Promise<{ url: string; via: string }> {
  const tools = createImageTools({
    resolveBackends: resolveImageOutputBackends,
    onImageGenerated: async ({ prompt: p, url, via }) => {
      // Works drawer (作品小抽屉): shared photos live on, not just in chat.
      try {
        const short = p.length > 36 ? `${p.slice(0, 36)}…` : p;
        const date = new Date().toISOString().slice(0, 10);
        await ourSpaceStore.addWork("image", short || "AI 发的照片", url, `${date} · ${via}`);
      } catch {
        // best effort — the photo is already delivered to chat
      }
    },
  });
  const tool = tools.find((t) => t.name === "generate_image");
  if (!tool) throw new Error("generate_image tool missing");
  // generate_image never touches ctx.authorize — the dummy ctx is inert.
  const result = await tool.run({ prompt }, { authorize: async () => false });
  const hit = parseImageMessage(result);
  if (!hit?.uri) throw new Error("image generation returned no usable image");
  return { url: hit.uri, via: "image pipeline" };
}

export interface PhotoshareDepsOptions {
  isIncognito: () => boolean;
}

/** Full production deps for the scheduler/executor. Never throws. */
export async function buildPhotoshareDeps(
  opts: PhotoshareDepsOptions,
): Promise<PhotoshareExecutorDeps> {
  return {
    photoshareStore,
    initiativeStore,
    outreachStore,
    selfpostStore: new SelfpostStore(AsyncStorage),
    storage: AsyncStorage,
    visibility: crossDialogVisibilityStore,
    getActivePersona,
    personaDisplayName,
    personaVoiceHint,
    getActiveGroup,
    generateText: async (group, systemPrompt, userPrompt) => {
      const { generateOneShot } = await import("../chat/group-meeting-tools");
      return generateOneShot(group, systemPrompt, userPrompt, { timeoutMs: 60_000 });
    },
    generateImage: generateImageReal,
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
        const { shanghaiDayStart } = await import("../initiative/rules");
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
    isIncognito: opts.isIncognito,
    trace: crossDialogTraceStore,
    nowMs: () => Date.now(),
  };
}

/** One tick of the photo-share scheduler (called from the foreground loop). Never throws. */
export async function runPhotoshareTick(isIncognito: () => boolean): Promise<void> {
  try {
    const { checkDuePhotoshareSlots } = await import("./scheduler");
    const deps = await buildPhotoshareDeps({ isIncognito });
    await checkDuePhotoshareSlots(deps);
  } catch {
    // Never break the initiative sweep.
  }
}

/** Production AI-tool set for local-agent wiring. Synchronous. */
export function createProductionPhotoshareTools(isIncognito: () => boolean) {
  const store = photoshareStore;
  return createPhotoshareTools({
    photoshareStore: store,
    buildExecutorDeps: () => buildPhotoshareDeps({ isIncognito }),
    isIncognito,
    nowMs: () => Date.now(),
  });
}
