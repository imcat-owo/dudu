/**
 * B13: dedicated model slots — small jobs get small (cheap) models.
 *
 * Learned from Kelivo's per-purpose model slots (title/summary/suggest/
 * translate/OCR/memory/compress): each slot binds provider group + model
 * + optional custom prompt + thinking toggle. Auto-titles, summaries and
 * compression stop burning the flagship model's money.
 *
 * Stored in AsyncStorage (not secret — only ids and prompts).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const SLOTS_KEY = "dudu.model-slots.v1";

export type ModelSlotId =
  | "title"
  | "summary"
  | "suggest"
  | "translate"
  | "ocr"
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
  "translate",
  "ocr",
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
 * Resolve a slot to a concrete (groupId, model) pair.
 * Falls back to the active group/model when the slot is unbound.
 */
export function resolveSlot(
  slot: ModelSlot,
  activeGroupId: string | null,
  groupModel: (groupId: string) => string | null,
): { groupId: string | null; model: string | null } {
  const groupId = slot.groupId ?? activeGroupId;
  if (!groupId) return { groupId: null, model: null };
  const model = slot.model ?? groupModel(groupId);
  return { groupId, model };
}
