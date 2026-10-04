/**
 * Capability groups — 按能力分组的模型路由 (data model).
 *
 * Two layers, one word for her ("分组"):
 * - API groups (./types.ts): connections — base URL + key + model. She
 *   configures these herself; keys never enter the repo.
 * - Capability groups (this file): ROUTING — named sets of API groups
 *   (ordered: primary first, then fallbacks) tagged by capability.
 *
 * Kinds (vision doc §1):
 * - input: a message carrying this attachment type gets routed to a model
 *   in the group (image_input, voice_input). Fast path first: if the
 *   current chat model can handle it, no routing happens at all.
 * - output: tool backends the AI calls when it wants to produce something
 *   (image_output, video). Never mixed into /chat/completions.
 *
 * Presets ship enabled-but-empty: 图片输入 / 图片输出 / 视频 / 语音输入.
 * She adds members (her API groups) and custom groups herself.
 *
 * Alignment: HF Chat-UI LLM Router (named routes, primary+fallback,
 * routing visible), Open WebUI meta.capabilities (capability tags),
 * LobeHub custom extension tags, LiteLLM (ordered fallback chains).
 * See research/alignment-capability-routing.md §5.
 *
 * PURE module: no React Native imports — unit-testable in node.
 */

export type CapabilityKind = "input" | "output";

/**
 * Well-known capability tags. Any other string is a user-defined custom
 * tag — groups are extensible, the router only special-cases the four
 * presets below (and treats unknown tags as inert organizers).
 */
export const CAPABILITY_TAGS = {
  IMAGE_INPUT: "image_input",
  IMAGE_OUTPUT: "image_output",
  VIDEO: "video",
  VOICE_INPUT: "voice_input",
} as const;

export type CapabilityTag = string;

export interface CapabilityGroupMember {
  /** ApiGroup id — the connection to borrow. */
  groupId: string;
  /**
   * Model override within that connection (defaults to the ApiGroup's own
   * chat model). Lets one endpoint serve several roles, e.g. the same
   * OpenAI-compatible base with a vision model for image_input.
   */
  model?: string;
  /**
   * Output groups only: full endpoint URL to POST to, when the ApiGroup's
   * base URL has no standard path for this capability (e.g. a provider's
   * bespoke video API). When absent, the standard OpenAI-compatible path
   * for the capability is used.
   */
  endpoint?: string;
  /** Output groups only (async backends like video): URL polled for completion. */
  pollEndpoint?: string;
}

export interface CapabilityGroup {
  /** Stable id, generated on creation. */
  id: string;
  /**
   * Preset key for built-ins ("image_input" | "image_output" | "video" |
   * "voice_input"). Undefined for custom groups. The UI translates preset
   * names via i18n (capgroup.preset.*) unless she renamed the group.
   */
  presetId?: string;
  /** Her label. Empty on presets = show the translated preset name. */
  name: string;
  /** Capability tag this group serves. */
  tag: CapabilityTag;
  kind: CapabilityKind;
  /** Ordered members: members[0] is primary, the rest are fallbacks. */
  members: CapabilityGroupMember[];
  enabled: boolean;
  /** Unix ms of creation — stable list ordering. */
  createdAt: number;
}

export function newCapabilityGroupId(): string {
  return `cg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface CapabilityGroupPreset {
  presetId: string;
  tag: CapabilityTag;
  kind: CapabilityKind;
}

/** Built-in groups. Ship enabled but empty — she fills them herself. */
export const CAPABILITY_GROUP_PRESETS: CapabilityGroupPreset[] = [
  { presetId: CAPABILITY_TAGS.IMAGE_INPUT, tag: CAPABILITY_TAGS.IMAGE_INPUT, kind: "input" },
  { presetId: CAPABILITY_TAGS.IMAGE_OUTPUT, tag: CAPABILITY_TAGS.IMAGE_OUTPUT, kind: "output" },
  { presetId: CAPABILITY_TAGS.VIDEO, tag: CAPABILITY_TAGS.VIDEO, kind: "output" },
  { presetId: CAPABILITY_TAGS.VOICE_INPUT, tag: CAPABILITY_TAGS.VOICE_INPUT, kind: "input" },
];

export function seedCapabilityGroups(): CapabilityGroup[] {
  const now = Date.now();
  return CAPABILITY_GROUP_PRESETS.map((p, i) => ({
    id: `cg_preset_${p.presetId}`,
    presetId: p.presetId,
    name: "",
    tag: p.tag,
    kind: p.kind,
    members: [],
    enabled: true,
    createdAt: now + i,
  }));
}

/** Display name: her rename wins, otherwise the translated preset name. */
export function capabilityGroupDisplayName(
  group: CapabilityGroup,
  translatePreset: (presetId: string) => string,
): string {
  if (group.name.trim()) return group.name.trim();
  if (group.presetId) return translatePreset(group.presetId);
  return group.tag;
}

export function validateCapabilityGroup(g: Pick<CapabilityGroup, "tag" | "name">): string | null {
  if (!g.tag.trim()) return "tagRequired";
  return null;
}

/** Move a member up/down inside the ordered member list (primary first). */
export function moveMember(
  members: CapabilityGroupMember[],
  index: number,
  delta: -1 | 1,
): CapabilityGroupMember[] {
  const next = [...members];
  const j = index + delta;
  if (index < 0 || index >= next.length || j < 0 || j >= next.length) return next;
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}
