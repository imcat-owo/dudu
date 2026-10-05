/**
 * B13: dedicated model slots — small jobs get small (cheap) models.
 *
 * Learned from Kelivo's per-purpose model slots (title/summary/suggest/
 * memory/compress): each slot binds a model override. Auto-titles,
 * follow-up suggestions, memory extraction, summaries and compression
 * stop burning the flagship model's money.
 *
 * Stored in AsyncStorage (not secret — only ids and prompts).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ApiGroup } from "./types";

const SLOTS_KEY = "dudu.model-slots.v1";

export type ModelSlotId =
  | "title"
  | "summary"
  | "suggest"
  | "memory"
  | "compress";

export interface ModelSlot {
  id: ModelSlotId;
  /** ApiGroup id, or null = follow the active group. */
  groupId: string | null;
  /** Model override, or null = the group's model. */
  model: string | null;
  /** Custom system prompt for this job, or null = default. */
  prompt: string | null;
  thinking: boolean;
}

export const MODEL_SLOT_IDS: ModelSlotId[] = [
  "title",
  "summary",
  "suggest",
  "memory",
  "compress",
];

export function defaultSlots(): Record<ModelSlotId, ModelSlot> {
  const out = {} as Record<ModelSlotId, ModelSlot>;
  for (const id of MODEL_SLOT_IDS) {
    out[id] = { id, groupId: null, model: null, prompt: null, thinking: false };
  }
  return out;
}

function parse(raw: string | null): Record<ModelSlotId, ModelSlot> {
  const def = defaultSlots();
  if (!raw) return def;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<ModelSlotId, ModelSlot>>;
    for (const id of MODEL_SLOT_IDS) {
      const s = parsed[id];
      if (s && typeof s === "object") def[id] = { ...def[id], ...s, id };
    }
  } catch {
    // fall through with defaults
  }
  return def;
}

export async function loadModelSlots(): Promise<Record<ModelSlotId, ModelSlot>> {
  try {
    return parse(await AsyncStorage.getItem(SLOTS_KEY));
  } catch {
    return defaultSlots();
  }
}

export async function saveModelSlots(slots: Record<ModelSlotId, ModelSlot>): Promise<void> {
  try {
    await AsyncStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
  } catch {
    // ignore
  }
}

/**
 * B13: swap in the dedicated slot model for a background task when the
 * user configured one (small/cheap model for small jobs). Returns the
 * group unchanged when no slot model is set or the lookup fails — never
 * throws. v1 overrides the model on the same group; binding a slot to a
 * different provider group is a follow-up.
 */
export async function withSlotModel(group: ApiGroup, slotId: ModelSlotId): Promise<ApiGroup> {
  try {
    const slots = await loadModelSlots();
    const model = slots[slotId]?.model?.trim();
    if (model && model !== group.model) return { ...group, model };
  } catch {
    // slot lookup is best-effort
  }
  return group;
}
